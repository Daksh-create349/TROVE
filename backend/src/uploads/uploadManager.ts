import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";
import type {
  FileMetadata,
  JobStatus,
  Paginated,
  UploadJob,
  UploadJobDetail,
  UploadProgress,
} from "@shared/types";
import type { AppConfig } from "../config/env";
import type { FilePartRepository } from "../database/repositories/filePartRepository";
import type { FileRepository } from "../database/repositories/fileRepository";
import type { SettingsRepository } from "../database/repositories/settingsRepository";
import type { UploadJobRepository } from "../database/repositories/uploadJobRepository";
import { extractFloodWaitSeconds } from "../telegram/gramjsClient";
import type { TelegramService } from "../telegram/telegramService";
import { nowIso } from "../utils/crypto";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from "../utils/errors";
import { calculateSegments, type SegmentPlan } from "./chunkCalculator";
import { assertSufficientDiskSpace } from "./diskSpace";
import {
  cleanupTempFiles,
  computeFileMetadataStream,
  extractSegmentToTempFile,
} from "./localFileSource";
import { formatManifestCaption, type RemoteFileManifest } from "./manifest";

const MAX_SEGMENT_RETRIES = 5;
const DEFAULT_CONCURRENCY = 2;

interface StoredJobMeta {
  jobId: string;
  fileId: string;
  sourcePath: string;
  originalFilename: string;
  mimeType: string;
  totalSize: number;
  mtimeMs: number;
  sha256: string;
  segmentSize: number;
  isTemporaryStaging: boolean;
  telegramPeerId: string;
  totalParts: number;
  segments: {
    partIndex: number;
    offset: number;
    size: number;
  }[];
}

interface ActiveJobState {
  abortController: AbortController;
  isPaused: boolean;
  isCancelled: boolean;
  currentSegmentIndex: number;
  currentSegmentProgressBytes: number;
  currentSegmentTotalBytes: number;
}

export interface CreateUploadInput {
  filePath: string;
  originalFilename?: string;
  mimeType?: string;
  folderId?: string | null;
  customSegmentSize?: number;
  // Pre-computed if staged from multipart upload
  precomputedSha256?: string;
  precomputedSize?: number;
  precomputedMtimeMs?: number;
  isTemporaryStaging?: boolean;
}

export interface UploadManagerOptions {
  config: AppConfig;
  logger: Logger;
  telegramService: TelegramService;
  fileRepository: FileRepository;
  filePartRepository: FilePartRepository;
  uploadJobRepository: UploadJobRepository;
  settingsRepository: SettingsRepository;
}

export class UploadManager {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly telegramService: TelegramService;
  private readonly files: FileRepository;
  private readonly parts: FilePartRepository;
  private readonly jobs: UploadJobRepository;
  private readonly settings: SettingsRepository;

  private readonly metadataDir: string;
  private readonly stagingDir: string;
  private readonly segmentsDir: string;

  private readonly activeJobs = new Map<string, ActiveJobState>();
  private readonly runningWorkers = new Set<Promise<void>>();
  private readonly queue: string[] = [];
  private activeCount = 0;
  private isShuttingDown = false;

  constructor(options: UploadManagerOptions) {
    this.config = options.config;
    this.logger = options.logger.child({ module: "upload-manager" });
    this.telegramService = options.telegramService;
    this.files = options.fileRepository;
    this.parts = options.filePartRepository;
    this.jobs = options.uploadJobRepository;
    this.settings = options.settingsRepository;

    this.metadataDir = join(this.config.dataDir, "uploads", "metadata");
    this.stagingDir = join(this.config.dataDir, "tmp", "staging");
    this.segmentsDir = join(this.config.dataDir, "tmp", "segments");
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.metadataDir, { recursive: true });
    await fs.mkdir(this.stagingDir, { recursive: true });
    await fs.mkdir(this.segmentsDir, { recursive: true });

    // Inspect and recover unfinished uploads across application restart
    try {
      const active = this.jobs.list({ limit: 100, offset: 0 });
      for (const job of active.items) {
        if (job.status === "processing" || job.status === "queued") {
          const meta = await this.readMeta(job.id);
          if (!meta) {
            this.jobs.update(job.id, {
              status: "failed",
              lastError: "Upload metadata lost after restart",
            });
            this.files.updateStatus(job.fileId, "failed");
            continue;
          }

          // Verify original source file still exists
          let sourceStat;
          try {
            sourceStat = await fs.stat(meta.sourcePath);
          } catch {
            this.jobs.update(job.id, {
              status: "failed",
              lastError: `Source file not found after restart: ${meta.sourcePath}`,
            });
            this.files.updateStatus(job.fileId, "failed");
            continue;
          }

          // Compare source size and modification timestamp
          if (
            sourceStat.size !== meta.totalSize ||
            Math.floor(sourceStat.mtimeMs) !== Math.floor(meta.mtimeMs)
          ) {
            this.jobs.update(job.id, {
              status: "failed",
              lastError: `Source file was modified while upload was interrupted: ${meta.sourcePath}`,
            });
            this.files.updateStatus(job.fileId, "failed");
            if (meta.isTemporaryStaging) {
              await cleanupTempFiles([meta.sourcePath]);
            }
            await this.deleteMeta(job.id);
            continue;
          }

          // Validate previously uploaded segments
          const parts = this.parts.listByFile(meta.fileId);
          const completedBytes = parts
            .filter((p) => p.status === "completed")
            .reduce((sum, p) => sum + p.partSize, 0);

          // Reset any part stuck in 'processing' back to 'queued' so it is sliced fresh
          for (const p of parts) {
            if (p.status === "processing") {
              this.parts.updateStatus(meta.fileId, p.partIndex, "queued");
            }
          }

          this.jobs.update(job.id, {
            status: "queued",
            progressBytes: completedBytes,
            lastError: null,
          });
          this.files.updateStatus(job.fileId, "queued");

          if (!this.queue.includes(job.id)) {
            this.queue.push(job.id);
          }
        }
      }
      this.scheduleNext();
    } catch (err) {
      this.logger.warn({ err }, "Failed to reconcile active upload jobs on startup");
    }
  }

  getStagingDir(): string {
    return this.stagingDir;
  }

  private getConcurrency(): number {
    const configured = this.settings.get<number>("uploads.concurrency");
    if (typeof configured === "number" && configured > 0) {
      return configured;
    }
    return DEFAULT_CONCURRENCY;
  }

  private metaFilePath(jobId: string): string {
    return join(this.metadataDir, `${jobId}.meta.json`);
  }

  private async saveMeta(meta: StoredJobMeta): Promise<void> {
    await fs.writeFile(this.metaFilePath(meta.jobId), JSON.stringify(meta, null, 2), "utf8");
  }

  private async readMeta(jobId: string): Promise<StoredJobMeta | null> {
    try {
      const content = await fs.readFile(this.metaFilePath(jobId), "utf8");
      return JSON.parse(content) as StoredJobMeta;
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

  async createUpload(input: CreateUploadInput): Promise<{
    job: UploadJob;
    file: FileMetadata;
  }> {
    if (this.isShuttingDown) {
      throw new ServiceUnavailableError("Upload engine is shutting down");
    }

    const telegramStatus = this.telegramService.getStatus();
    if (telegramStatus.state !== "connected") {
      throw new ServiceUnavailableError(
        "Telegram is not connected. Connect your account before uploading.",
      );
    }

    const savedPeer = this.telegramService.getSavedMessagesPeer();
    if (!savedPeer) {
      throw new ServiceUnavailableError(
        "Saved Messages destination is not available. Please re-check Telegram connection.",
      );
    }

    // Resolve file metadata
    let sourceMeta: {
      path: string;
      size: number;
      mtimeMs: number;
      sha256: string;
    };

    if (
      input.precomputedSha256 &&
      input.precomputedSize !== undefined &&
      input.precomputedMtimeMs !== undefined
    ) {
      sourceMeta = {
        path: input.filePath,
        size: input.precomputedSize,
        mtimeMs: input.precomputedMtimeMs,
        sha256: input.precomputedSha256,
      };
    } else {
      sourceMeta = await computeFileMetadataStream(input.filePath);
    }

    // Determine upload capabilities and segment plan
    const capabilities = await this.telegramService.getUploadCapabilities();
    let segmentSize = capabilities.safeSegmentSize;
    if (input.customSegmentSize && input.customSegmentSize > 0) {
      segmentSize = Math.min(input.customSegmentSize, capabilities.safeSegmentSize);
    }

    const plan: SegmentPlan = calculateSegments(sourceMeta.size, segmentSize);

    // Ensure there is sufficient disk space to hold at least one segment chunk
    await assertSufficientDiskSpace(this.segmentsDir, Math.min(sourceMeta.size, segmentSize));

    // Extract original filename
    const originalFilename =
      input.originalFilename ||
      input.filePath.split(/[\\/]/).pop() ||
      "unnamed.bin";
    const mimeType = input.mimeType || "application/octet-stream";

    // Create file record
    const file = this.files.create({
      folderId: input.folderId ?? null,
      originalFilename,
      mimeType,
      totalSize: sourceMeta.size,
      sha256: null, // Will be marked complete after all segments succeed
      partCount: plan.totalParts,
      telegramPeerId: savedPeer.peerId,
      telegramMessageIds: [],
      status: "queued",
    });

    // Create file_parts records
    if (plan.segments.length > 0) {
      this.parts.createMany(
        file.id,
        plan.segments.map((s) => ({
          partIndex: s.partIndex,
          partSize: s.size,
          sha256: null,
          telegramMessageId: null,
          status: "queued",
        })),
      );
    }

    // Create upload job record
    const job = this.jobs.create(file.id);

    // Save job metadata to disk for resume capability
    const meta: StoredJobMeta = {
      jobId: job.id,
      fileId: file.id,
      sourcePath: sourceMeta.path,
      originalFilename,
      mimeType,
      totalSize: sourceMeta.size,
      mtimeMs: sourceMeta.mtimeMs,
      sha256: sourceMeta.sha256,
      segmentSize,
      isTemporaryStaging: Boolean(input.isTemporaryStaging),
      telegramPeerId: savedPeer.peerId,
      totalParts: plan.totalParts,
      segments: plan.segments,
    };
    await this.saveMeta(meta);

    this.logger.info(
      { jobId: job.id, fileId: file.id, totalParts: plan.totalParts, totalSize: sourceMeta.size },
      "Created upload job",
    );

    // Enqueue job and trigger scheduler
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
      this.logger.error({ jobId }, "Job metadata not found on disk; failing job");
      this.jobs.update(jobId, { status: "failed", lastError: "Job metadata lost" });
      return;
    }

    const abortController = new AbortController();
    const activeState: ActiveJobState = {
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
    this.files.updateStatus(meta.fileId, "processing");

    try {
      // Handle empty (0-byte) file upload
      if (meta.totalSize === 0) {
        const caption = formatManifestCaption({
          version: 1,
          fileId: meta.fileId,
          partIndex: 0,
          totalParts: 1,
          partSha256: meta.sha256,
        });

        const uploadResult = await this.telegramService.uploadSegment({
          peerId: meta.telegramPeerId,
          fileName: meta.originalFilename,
          filePath: meta.sourcePath,
          fileSize: 0,
          caption,
          abortSignal: abortController.signal,
        });

        const manifest: RemoteFileManifest = {
          manifestVersion: 1,
          fileId: meta.fileId,
          originalFilename: meta.originalFilename,
          totalSize: 0,
          mimeType: meta.mimeType,
          sha256: meta.sha256,
          totalParts: 0,
          parts: [],
          createdAt: nowIso(),
        };

        const uploadedIds = [uploadResult.messageId];
        try {
          const manifestResult = await this.telegramService.uploadManifest({
            peerId: meta.telegramPeerId,
            manifest,
          });
          uploadedIds.push(manifestResult.messageId);
        } catch (err) {
          this.logger.warn({ jobId, err }, "Failed to write remote manifest for empty file");
        }

        this.files.markCompleted({
          id: meta.fileId,
          sha256: meta.sha256,
          telegramMessageIds: uploadedIds,
          telegramPeerId: meta.telegramPeerId,
        });

        this.jobs.update(jobId, {
          status: "completed",
          progressBytes: 0,
          completedAt: nowIso(),
          lastError: null,
        });

        if (meta.isTemporaryStaging) {
          await cleanupTempFiles([meta.sourcePath]);
        }
        await this.deleteMeta(jobId);
        return;
      }

      const parts = this.parts.listByFile(meta.fileId);
      const uploadedMessageIds: string[] = [];

      // Collect already completed parts and message IDs
      for (const part of parts) {
        if (part.status === "completed" && part.telegramMessageId) {
          uploadedMessageIds.push(part.telegramMessageId);
        }
      }

      for (const segmentSpec of meta.segments) {
        if (activeState.isCancelled) {
          throw new Error("JOB_CANCELLED");
        }
        if (activeState.isPaused || this.isShuttingDown) {
          throw new Error("JOB_PAUSED");
        }

        const existingPart = parts.find((p) => p.partIndex === segmentSpec.partIndex);
        if (existingPart && existingPart.status === "completed" && existingPart.telegramMessageId) {
          continue; // Already successfully uploaded
        }

        activeState.currentSegmentIndex = segmentSpec.partIndex;
        activeState.currentSegmentProgressBytes = 0;
        activeState.currentSegmentTotalBytes = segmentSpec.size;

        const tempSegmentPath = join(
          this.segmentsDir,
          `${jobId}_part_${segmentSpec.partIndex}.bin`,
        );

        // 1. Extract segment to bounded temp file while calculating SHA-256
        const extracted = await extractSegmentToTempFile({
          sourcePath: meta.sourcePath,
          offset: segmentSpec.offset,
          size: segmentSpec.size,
          targetTempPath: tempSegmentPath,
          expectedMtimeMs: meta.mtimeMs,
          expectedTotalSize: meta.totalSize,
        });

        // 2. Format manifest caption: TVLT:v1:<file-uuid>:<part-index>:<total-parts>:<part-sha256>
        const caption = formatManifestCaption({
          version: 1,
          fileId: meta.fileId,
          partIndex: segmentSpec.partIndex,
          totalParts: meta.totalParts,
          partSha256: extracted.sha256,
        });

        // 3. Upload with retries and rate limit handling
        let uploaded = false;
        let segmentAttempts = 0;
        let lastSegmentError: unknown = null;
        let messageId = "";

        while (!uploaded && segmentAttempts < MAX_SEGMENT_RETRIES) {
          if (activeState.isCancelled) {
            throw new Error("JOB_CANCELLED");
          }
          if (activeState.isPaused || this.isShuttingDown) {
            throw new Error("JOB_PAUSED");
          }

          segmentAttempts++;
          try {
            const uploadResult = await this.telegramService.uploadSegment({
              peerId: meta.telegramPeerId,
              fileName: meta.originalFilename,
              filePath: extracted.path,
              fileSize: extracted.size,
              caption,
              abortSignal: abortController.signal,
              onProgress: (ratio) => {
                activeState.currentSegmentProgressBytes = Math.round(
                  ratio * extracted.size,
                );
              },
            });
            messageId = uploadResult.messageId;
            uploaded = true;
          } catch (err) {
            lastSegmentError = err;
            if (activeState.isCancelled || activeState.isPaused || this.isShuttingDown) {
              break;
            }

            const floodSeconds = extractFloodWaitSeconds(err);
            if (floodSeconds && floodSeconds > 0) {
              this.logger.warn(
                { jobId, segment: segmentSpec.partIndex, floodSeconds },
                "Telegram flood wait encountered; sleeping required duration",
              );
              await new Promise((r) => setTimeout(r, floodSeconds * 1000));
              continue;
            }

            // Exponential backoff for transient errors
            const delayMs = Math.min(1000 * Math.pow(2, segmentAttempts), 16000);
            this.logger.warn(
              { jobId, segment: segmentSpec.partIndex, segmentAttempts, delayMs, err },
              "Transient error uploading segment; retrying",
            );
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }

        // Clean up temp segment file regardless of success or failure
        await cleanupTempFiles([extracted.path]);

        if (!uploaded) {
          if (activeState.isCancelled) {
            throw new Error("JOB_CANCELLED");
          }
          if (activeState.isPaused || this.isShuttingDown) {
            throw new Error("JOB_PAUSED");
          }
          throw lastSegmentError || new Error(`Failed to upload segment ${segmentSpec.partIndex}`);
        }

        // 4. Update part state in database
        this.parts.updateStatus(
          meta.fileId,
          segmentSpec.partIndex,
          "completed",
          messageId,
          extracted.sha256,
        );
        uploadedMessageIds.push(messageId);

        // 5. Update file and job progress
        this.files.setTelegramReferences({
          id: meta.fileId,
          telegramPeerId: meta.telegramPeerId,
          telegramMessageIds: uploadedMessageIds,
        });

        // Compute total uploaded bytes so far
        const completedParts = this.parts.listByFile(meta.fileId);
        const progressBytes = completedParts
          .filter((p) => p.status === "completed")
          .reduce((sum, p) => sum + p.partSize, 0);

        this.jobs.update(jobId, { progressBytes });
      }

      // Write remote metadata manifest to Saved Messages
      const allCompletedParts = this.parts.listByFile(meta.fileId);
      const manifest: RemoteFileManifest = {
        manifestVersion: 1,
        fileId: meta.fileId,
        originalFilename: meta.originalFilename,
        totalSize: meta.totalSize,
        mimeType: meta.mimeType,
        sha256: meta.sha256,
        totalParts: meta.totalParts,
        parts: allCompletedParts.map((p) => ({
          partIndex: p.partIndex,
          partSize: p.partSize,
          sha256: p.sha256 || "",
          telegramMessageId: p.telegramMessageId || "",
        })),
        createdAt: nowIso(),
      };

      try {
        const manifestResult = await this.telegramService.uploadManifest({
          peerId: meta.telegramPeerId,
          manifest,
        });
        uploadedMessageIds.push(manifestResult.messageId);
      } catch (err) {
        this.logger.warn({ jobId, err }, "Failed to write remote manifest message");
      }

      // All segments successfully uploaded!
      this.files.markCompleted({
        id: meta.fileId,
        sha256: meta.sha256,
        telegramMessageIds: uploadedMessageIds,
        telegramPeerId: meta.telegramPeerId,
      });

      this.jobs.update(jobId, {
        status: "completed",
        progressBytes: meta.totalSize,
        completedAt: nowIso(),
        lastError: null,
      });

      this.logger.info(
        { jobId, fileId: meta.fileId, partsCount: uploadedMessageIds.length },
        "File upload completed successfully",
      );

      // Clean up temporary staged file if applicable
      if (meta.isTemporaryStaging) {
        await cleanupTempFiles([meta.sourcePath]);
      }

      // Remove job metadata
      await this.deleteMeta(jobId);
    } catch (error) {
      const message = (error as Error).message || String(error);
      if (message === "JOB_PAUSED") {
        this.jobs.update(jobId, { status: "paused" });
        this.files.updateStatus(meta.fileId, "paused");
        this.logger.info({ jobId }, "Upload job paused");
      } else if (message === "JOB_CANCELLED") {
        this.jobs.update(jobId, { status: "failed", lastError: "Upload cancelled by user" });
        this.files.updateStatus(meta.fileId, "failed");
        if (meta.isTemporaryStaging) {
          await cleanupTempFiles([meta.sourcePath]);
        }
        await this.deleteMeta(jobId);
        this.logger.info({ jobId }, "Upload job cancelled");
      } else {
        this.logger.error({ jobId, error }, "Upload job failed");
        this.jobs.update(jobId, { status: "failed", lastError: message });
        this.files.updateStatus(meta.fileId, "failed");
        if (error instanceof ConflictError && meta.isTemporaryStaging) {
          await cleanupTempFiles([meta.sourcePath]);
          await this.deleteMeta(jobId);
        }
      }
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  async pauseJob(id: string): Promise<UploadJob> {
    const job = this.jobs.getById(id);
    if (!job) {
      throw new NotFoundError(`Upload job not found: ${id}`);
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
    this.files.updateStatus(job.fileId, "paused");

    return this.jobs.getById(id)!;
  }

  async resumeJob(id: string): Promise<UploadJob> {
    const job = this.jobs.getById(id);
    if (!job) {
      throw new NotFoundError(`Upload job not found: ${id}`);
    }

    if (job.status !== "paused" && job.status !== "failed") {
      throw new BadRequestError(`Cannot resume job in status '${job.status}'`);
    }

    this.jobs.update(id, { status: "queued", lastError: null });
    this.files.updateStatus(job.fileId, "queued");

    if (!this.queue.includes(id)) {
      this.queue.push(id);
    }
    this.scheduleNext();

    return this.jobs.getById(id)!;
  }

  async cancelJob(id: string): Promise<UploadJob> {
    const job = this.jobs.getById(id);
    if (!job) {
      throw new NotFoundError(`Upload job not found: ${id}`);
    }

    if (job.status === "completed") {
      throw new BadRequestError("Cannot cancel completed upload job");
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
    this.jobs.update(id, { status: "failed", lastError: "Upload cancelled by user" });
    this.files.updateStatus(job.fileId, "failed");

    const meta = await this.readMeta(id);
    if (meta?.isTemporaryStaging) {
      await cleanupTempFiles([meta.sourcePath]);
    }
    await this.deleteMeta(id);

    return this.jobs.getById(id)!;
  }

  getProgress(id: string): UploadProgress {
    const job = this.jobs.getById(id);
    if (!job) {
      throw new NotFoundError(`Upload job not found: ${id}`);
    }

    const file = this.files.getById(job.fileId);
    if (!file) {
      throw new NotFoundError(`File not found for job: ${id}`);
    }

    const parts = this.parts.listByFile(file.id);
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
    } else {
      const nextPending = parts.find((p) => p.status !== "completed");
      if (nextPending) {
        currentSegmentIndex = nextPending.partIndex;
        currentSegmentTotalBytes = nextPending.partSize;
      }
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

  getJobDetail(id: string): UploadJobDetail {
    const job = this.jobs.getById(id);
    if (!job) {
      throw new NotFoundError(`Upload job not found: ${id}`);
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
  }): Paginated<UploadJob> {
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
