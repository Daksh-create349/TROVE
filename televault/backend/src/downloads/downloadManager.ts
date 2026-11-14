import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Logger } from "pino";
import type {
  DownloadJob,
  DownloadJobDetail,
  DownloadProgress,
  FileMetadata,
  JobStatus,
  Paginated,
} from "@shared/types";
import type { AppConfig } from "../config/env";
import type { DownloadJobRepository } from "../database/repositories/downloadJobRepository";
import type { FilePartRepository } from "../database/repositories/filePartRepository";
import type { FileRepository } from "../database/repositories/fileRepository";
import type { SettingsRepository } from "../database/repositories/settingsRepository";
import { assertSafeFilename } from "../security/pathSafety";
import { extractFloodWaitSeconds } from "../telegram/gramjsClient";
import type { TelegramService } from "../telegram/telegramService";
import { assertSufficientDiskSpace } from "../uploads/diskSpace";
import { cleanupTempFiles, computeFileMetadataStream } from "../uploads/localFileSource";
import { nowIso } from "../utils/crypto";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "../utils/errors";

const MAX_SEGMENT_RETRIES = 5;
const DEFAULT_CONCURRENCY = 2;
const BOUNDED_CHUNK_SIZE = 64 * 1024; // 64 KB

interface StoredDownloadMeta {
  jobId: string;
  fileId: string;
  targetDirectory: string;
  targetFilename: string;
  targetPath: string;
  totalSize: number;
  sha256: string;
  tempTargetPath: string;
  completedPartIndexes: number[];
  progressBytes: number;
}

interface ActiveDownloadState {
  abortController: AbortController;
  isPaused: boolean;
  isCancelled: boolean;
  currentSegmentIndex: number;
  currentSegmentProgressBytes: number;
  currentSegmentTotalBytes: number;
}

export interface CreateDownloadInput {
  fileId: string;
  targetDirectory?: string | null;
  targetFilename?: string | null;
}

export interface DownloadManagerOptions {
  config: AppConfig;
  logger: Logger;
  telegramService: TelegramService;
  fileRepository: FileRepository;
  filePartRepository: FilePartRepository;
  downloadJobRepository: DownloadJobRepository;
  settingsRepository: SettingsRepository;
}

/**
 * Appends the contents of sourcePath to targetPath using a bounded streaming pipeline.
 */
async function appendFileStream(sourcePath: string, targetPath: string): Promise<void> {
  const readStream = createReadStream(sourcePath, { highWaterMark: BOUNDED_CHUNK_SIZE });
  const writeStream = createWriteStream(targetPath, { flags: "a" });
  await pipeline(readStream, writeStream);
}

/**
 * Moves a file from sourcePath to targetPath, safely falling back to stream copy + unlink
 * if moving across different devices/filesystems (EXDEV).
 */
async function moveFileSafely(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EXDEV") {
      const readStream = createReadStream(sourcePath, { highWaterMark: BOUNDED_CHUNK_SIZE });
      const writeStream = createWriteStream(targetPath);
      await pipeline(readStream, writeStream);
      await fs.unlink(sourcePath);
    } else {
      throw error;
    }
  }
}

export class DownloadManager {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly telegramService: TelegramService;
  private readonly files: FileRepository;
  private readonly parts: FilePartRepository;
  private readonly jobs: DownloadJobRepository;
  private readonly settings: SettingsRepository;

  private readonly metadataDir: string;
  private readonly tempDir: string;

  private readonly activeJobs = new Map<string, ActiveDownloadState>();
  private readonly runningWorkers = new Set<Promise<void>>();
  private readonly queue: string[] = [];
  private activeCount = 0;
  private isShuttingDown = false;

  constructor(options: DownloadManagerOptions) {
    this.config = options.config;
    this.logger = options.logger.child({ module: "download-manager" });
    this.telegramService = options.telegramService;
    this.files = options.fileRepository;
    this.parts = options.filePartRepository;
    this.jobs = options.downloadJobRepository;
    this.settings = options.settingsRepository;

    this.metadataDir = join(this.config.dataDir, "downloads", "metadata");
    this.tempDir = join(this.config.dataDir, "tmp", "downloads");
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.metadataDir, { recursive: true });
    await fs.mkdir(this.tempDir, { recursive: true });

    // Inspect active download jobs after restart
    try {
      const active = this.jobs.list({ limit: 100, offset: 0 });
      for (const job of active.items) {
        if (job.status === "processing" || job.status === "queued") {
          const meta = await this.readMeta(job.id);
          if (!meta) {
            this.jobs.update(job.id, {
              status: "failed",
              lastError: "Download metadata lost after restart",
            });
            continue;
          }

          this.jobs.update(job.id, {
            status: "queued",
            lastError: null,
          });

          if (!this.queue.includes(job.id)) {
            this.queue.push(job.id);
          }
        }
      }
      this.scheduleNext();
    } catch (err) {
      this.logger.warn({ err }, "Failed to reconcile active download jobs on startup");
    }
  }

  private getConcurrency(): number {
    const configured = this.settings.get<number>("downloads.concurrency");
    if (typeof configured === "number" && configured > 0) {
      return configured;
    }
    return DEFAULT_CONCURRENCY;
  }

  private metaFilePath(jobId: string): string {
    return join(this.metadataDir, `${jobId}.meta.json`);
  }

  private async saveMeta(meta: StoredDownloadMeta): Promise<void> {
    await fs.writeFile(this.metaFilePath(meta.jobId), JSON.stringify(meta, null, 2), "utf8");
  }

  private async readMeta(jobId: string): Promise<StoredDownloadMeta | null> {
    try {
      const content = await fs.readFile(this.metaFilePath(jobId), "utf8");
      return JSON.parse(content) as StoredDownloadMeta;
    } catch {
      return null;
    }
  }

  private async deleteMeta(jobId: string): Promise<void> {
    try {
      await fs.unlink(this.metaFilePath(jobId));
    } catch {
      // Ignore missing meta files
    }
  }

  async createDownload(input: CreateDownloadInput): Promise<{
    job: DownloadJob;
    file: FileMetadata;
  }> {
    if (this.isShuttingDown) {
      throw new ServiceUnavailableError("Download engine is shutting down");
    }

    const telegramStatus = this.telegramService.getStatus();
    if (telegramStatus.state !== "connected") {
      throw new ServiceUnavailableError(
        "Telegram is not connected. Connect your account before downloading.",
      );
    }

    const file = this.files.getById(input.fileId);
    if (!file) {
      throw new NotFoundError(`File not found: ${input.fileId}`);
    }

    if (file.status !== "completed") {
      throw new ConflictError("Only completed files can be downloaded");
    }

    const targetDirectory = input.targetDirectory
      ? input.targetDirectory.trim()
      : join(this.config.dataDir, "downloads");

    if (!isAbsolute(targetDirectory)) {
      throw new ValidationError("targetDirectory must be an absolute path");
    }

    const targetFilename = input.targetFilename
      ? assertSafeFilename(input.targetFilename)
      : assertSafeFilename(file.originalFilename);

    const targetPath = join(targetDirectory, targetFilename);

    await fs.mkdir(targetDirectory, { recursive: true });
    await assertSufficientDiskSpace(targetDirectory, file.totalSize);

    const job = this.jobs.create({
      fileId: file.id,
      targetDirectory,
      targetFilename,
    });

    const tempTargetPath = join(this.tempDir, `${job.id}.reconstructing.bin`);

    const meta: StoredDownloadMeta = {
      jobId: job.id,
      fileId: file.id,
      targetDirectory,
      targetFilename,
      targetPath,
      totalSize: file.totalSize,
      sha256: file.sha256 || "",
      tempTargetPath,
      completedPartIndexes: [],
      progressBytes: 0,
    };
    await this.saveMeta(meta);

    this.logger.info(
      { jobId: job.id, fileId: file.id, targetPath, totalSize: file.totalSize },
      "Created download job",
    );

    this.queue.push(job.id);
    this.scheduleNext();

    return { job, file };
  }

  private scheduleNext(): void {
    if (this.isShuttingDown) {
      return;
    }

    const concurrency = this.getConcurrency();
    while (this.activeCount < concurrency && this.queue.length > 0) {
      const nextJobId = this.queue.shift();
      if (!nextJobId) {
        break;
      }
      this.activeCount++;
      const workerPromise = this.processJob(nextJobId).finally(() => {
        this.activeCount--;
        this.runningWorkers.delete(workerPromise);
        this.scheduleNext();
      });
      this.runningWorkers.add(workerPromise);
    }
  }

  private async processJob(jobId: string): Promise<void> {
    const meta = await this.readMeta(jobId);
    if (!meta) {
      this.logger.error({ jobId }, "Download metadata not found; failing job");
      this.jobs.update(jobId, { status: "failed", lastError: "Job metadata lost" });
      return;
    }

    const abortController = new AbortController();
    const activeState: ActiveDownloadState = {
      abortController,
      isPaused: false,
      isCancelled: false,
      currentSegmentIndex: 0,
      currentSegmentProgressBytes: 0,
      currentSegmentTotalBytes: 0,
    };
    this.activeJobs.set(jobId, activeState);

    const initialJob = this.jobs.getById(jobId);
    if (
      !initialJob ||
      initialJob.status === "failed" ||
      initialJob.status === "paused" ||
      activeState.isCancelled ||
      activeState.isPaused
    ) {
      this.activeJobs.delete(jobId);
      return;
    }

    const attempts = (initialJob.attempts ?? 0) + 1;
    this.jobs.update(jobId, {
      status: "processing",
      startedAt: initialJob.startedAt ?? nowIso(),
      attempts,
      lastError: null,
    });

    try {
      // Handle empty (0-byte) file
      if (meta.totalSize === 0) {
        await fs.writeFile(meta.targetPath, Buffer.alloc(0));
        this.jobs.update(jobId, {
          status: "completed",
          progressBytes: 0,
          completedAt: nowIso(),
          lastError: null,
        });
        await this.deleteMeta(jobId);
        return;
      }

      const parts = this.parts.listByFile(meta.fileId);
      parts.sort((a, b) => a.partIndex - b.partIndex);

      if (parts.length === 0) {
        throw new ConflictError("No segment parts found for file");
      }

      for (const part of parts) {
        if (!part.telegramMessageId) {
          throw new ConflictError(`File part ${part.partIndex} has no Telegram message ID`);
        }

        if (activeState.isCancelled) {
          throw new Error("JOB_CANCELLED");
        }
        if (activeState.isPaused || this.isShuttingDown) {
          throw new Error("JOB_PAUSED");
        }

        if (meta.completedPartIndexes.includes(part.partIndex)) {
          continue; // Already downloaded and appended
        }

        activeState.currentSegmentIndex = part.partIndex;
        activeState.currentSegmentProgressBytes = 0;
        activeState.currentSegmentTotalBytes = part.partSize;

        const tempChunkPath = join(this.tempDir, `${jobId}_chunk_${part.partIndex}.bin`);

        // Download segment with retries and rate limit handling
        let downloaded = false;
        let segmentAttempts = 0;
        let lastSegmentError: unknown = null;

        while (!downloaded && segmentAttempts < MAX_SEGMENT_RETRIES) {
          if (activeState.isCancelled) {
            throw new Error("JOB_CANCELLED");
          }
          if (activeState.isPaused || this.isShuttingDown) {
            throw new Error("JOB_PAUSED");
          }

          segmentAttempts++;
          try {
            await this.telegramService.downloadSegment({
              messageId: part.telegramMessageId,
              targetPath: tempChunkPath,
              abortSignal: abortController.signal,
              onProgress: (ratio) => {
                activeState.currentSegmentProgressBytes = Math.round(ratio * part.partSize);
              },
            });
            downloaded = true;
          } catch (err) {
            lastSegmentError = err;
            if (activeState.isCancelled || activeState.isPaused || this.isShuttingDown) {
              break;
            }

            const floodSeconds = extractFloodWaitSeconds(err);
            if (floodSeconds && floodSeconds > 0) {
              this.logger.warn(
                { jobId, segment: part.partIndex, floodSeconds },
                "Telegram flood wait during download; sleeping required duration",
              );
              await new Promise((r) => setTimeout(r, floodSeconds * 1000));
              continue;
            }

            const delayMs = Math.min(1000 * Math.pow(2, segmentAttempts), 16000);
            this.logger.warn(
              { jobId, segment: part.partIndex, segmentAttempts, delayMs, err },
              "Transient error downloading segment; retrying",
            );
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }

        if (!downloaded) {
          await cleanupTempFiles([tempChunkPath]);
          if (activeState.isCancelled) {
            throw new Error("JOB_CANCELLED");
          }
          if (activeState.isPaused || this.isShuttingDown) {
            throw new Error("JOB_PAUSED");
          }
          throw lastSegmentError || new Error(`Failed to download segment ${part.partIndex}`);
        }

        // Verify segment SHA-256 hash
        const chunkMeta = await computeFileMetadataStream(tempChunkPath);
        if (part.sha256 && chunkMeta.sha256 !== part.sha256.toLowerCase()) {
          await cleanupTempFiles([tempChunkPath]);
          throw new ConflictError(
            `Downloaded segment ${part.partIndex} hash mismatch (expected ${part.sha256}, got ${chunkMeta.sha256})`,
          );
        }

        // Append chunk to target reconstruction file
        await appendFileStream(tempChunkPath, meta.tempTargetPath);
        await cleanupTempFiles([tempChunkPath]);

        meta.completedPartIndexes.push(part.partIndex);
        meta.progressBytes += part.partSize;
        await this.saveMeta(meta);

        this.jobs.update(jobId, { progressBytes: meta.progressBytes });
      }

      // Reconstructed file complete: verify overall SHA-256
      const reconstructedMeta = await computeFileMetadataStream(meta.tempTargetPath);
      if (meta.sha256 && reconstructedMeta.sha256 !== meta.sha256.toLowerCase()) {
        await cleanupTempFiles([meta.tempTargetPath]);
        throw new ConflictError(
          `Reconstructed file SHA-256 integrity check failed (expected ${meta.sha256}, got ${reconstructedMeta.sha256})`,
        );
      }

      // Move completed file to user target destination
      await moveFileSafely(meta.tempTargetPath, meta.targetPath);

      this.jobs.update(jobId, {
        status: "completed",
        progressBytes: meta.totalSize,
        completedAt: nowIso(),
        lastError: null,
      });

      this.logger.info(
        { jobId, fileId: meta.fileId, targetPath: meta.targetPath },
        "File download completed and verified successfully",
      );

      await this.deleteMeta(jobId);
    } catch (error) {
      const message = (error as Error).message || String(error);
      if (message === "JOB_PAUSED") {
        this.jobs.update(jobId, { status: "paused" });
        this.logger.info({ jobId }, "Download job paused");
      } else if (message === "JOB_CANCELLED") {
        this.jobs.update(jobId, { status: "failed", lastError: "Download cancelled by user" });
        await cleanupTempFiles([meta.tempTargetPath]);
        await this.deleteMeta(jobId);
        this.logger.info({ jobId }, "Download job cancelled");
      } else {
        this.logger.error({ jobId, error }, "Download job failed");
        this.jobs.update(jobId, { status: "failed", lastError: message });
        await cleanupTempFiles([meta.tempTargetPath]);
      }
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  async pauseJob(id: string): Promise<DownloadJob> {
    const job = this.jobs.getById(id);
    if (!job) {
      throw new NotFoundError(`Download job not found: ${id}`);
    }

    if (job.status !== "processing" && job.status !== "queued") {
      throw new BadRequestError(`Cannot pause job in status '${job.status}'`);
    }

    const active = this.activeJobs.get(id);
    if (active) {
      active.isPaused = true;
      active.abortController.abort();
    } else {
      const idx = this.queue.indexOf(id);
      if (idx !== -1) {
        this.queue.splice(idx, 1);
      }
    }
    this.jobs.update(id, { status: "paused" });

    return this.jobs.getById(id)!;
  }

  async resumeJob(id: string): Promise<DownloadJob> {
    const job = this.jobs.getById(id);
    if (!job) {
      throw new NotFoundError(`Download job not found: ${id}`);
    }

    if (job.status !== "paused" && job.status !== "failed") {
      throw new BadRequestError(`Cannot resume job in status '${job.status}'`);
    }

    this.jobs.update(id, { status: "queued", lastError: null });

    if (!this.queue.includes(id)) {
      this.queue.push(id);
    }
    this.scheduleNext();

    return this.jobs.getById(id)!;
  }

  async cancelJob(id: string): Promise<DownloadJob> {
    const job = this.jobs.getById(id);
    if (!job) {
      throw new NotFoundError(`Download job not found: ${id}`);
    }

    if (job.status === "completed") {
      throw new BadRequestError("Cannot cancel completed download job");
    }

    const active = this.activeJobs.get(id);
    if (active) {
      active.isCancelled = true;
      active.abortController.abort();
    } else {
      const idx = this.queue.indexOf(id);
      if (idx !== -1) {
        this.queue.splice(idx, 1);
      }
    }

    this.jobs.update(id, { status: "failed", lastError: "Download cancelled by user" });

    const meta = await this.readMeta(id);
    if (meta) {
      await cleanupTempFiles([meta.tempTargetPath]);
      await this.deleteMeta(id);
    }

    return this.jobs.getById(id)!;
  }

  getProgress(id: string): DownloadProgress {
    const job = this.jobs.getById(id);
    if (!job) {
      throw new NotFoundError(`Download job not found: ${id}`);
    }

    const file = this.files.getById(job.fileId);
    if (!file) {
      throw new NotFoundError(`File not found for job: ${id}`);
    }

    const active = this.activeJobs.get(id);
    let progressBytes = job.progressBytes;
    let currentSegmentIndex = 0;
    let currentSegmentProgressBytes = 0;
    let currentSegmentTotalBytes = 0;

    if (active) {
      currentSegmentIndex = active.currentSegmentIndex;
      currentSegmentProgressBytes = active.currentSegmentProgressBytes;
      currentSegmentTotalBytes = active.currentSegmentTotalBytes;
      progressBytes = Math.min(
        file.totalSize,
        job.progressBytes + currentSegmentProgressBytes,
      );
    }

    const progressPercentage =
      file.totalSize === 0
        ? job.status === "completed"
          ? 100
          : 0
        : Math.min(100, Math.round((progressBytes / file.totalSize) * 10000) / 100);

    return {
      jobId: job.id,
      fileId: file.id,
      status: job.status,
      progressBytes,
      totalBytes: file.totalSize,
      progressPercentage,
      currentSegmentIndex,
      totalSegments: file.partCount,
      currentSegmentProgressBytes,
      currentSegmentTotalBytes,
      attempts: job.attempts,
      lastError: job.lastError,
    };
  }

  getJobDetail(id: string): DownloadJobDetail {
    const job = this.jobs.getById(id);
    if (!job) {
      throw new NotFoundError(`Download job not found: ${id}`);
    }

    const file = this.files.getById(job.fileId);
    if (!file) {
      throw new NotFoundError(`File not found for job: ${id}`);
    }

    const parts = this.parts.listByFile(file.id);
    return { job, file, parts };
  }

  listJobs(input: {
    status?: JobStatus;
    fileId?: string;
    limit: number;
    offset: number;
  }): Paginated<DownloadJob> {
    const result = this.jobs.list(input);
    return {
      items: result.items,
      pagination: {
        total: result.total,
        limit: input.limit,
        offset: input.offset,
        hasMore: input.offset + result.items.length < result.total,
      },
    };
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    for (const [jobId, active] of this.activeJobs.entries()) {
      active.isPaused = true;
      active.abortController.abort();
      this.jobs.update(jobId, { status: "paused" });
    }
    await Promise.allSettled(Array.from(this.runningWorkers));
    this.activeJobs.clear();
  }
}

