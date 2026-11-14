import { isAbsolute } from "node:path";
import type { DownloadJob, Paginated } from "@shared/types";
import type { AppDatabase } from "../database/database";
import type { DownloadJobRepository } from "../database/repositories/downloadJobRepository";
import type { FileRepository } from "../database/repositories/fileRepository";
import { assertSafeFilename } from "../security/pathSafety";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors";
import { assertJobTransition } from "../utils/jobTransitions";
import { isUniqueViolation } from "../utils/sqlite";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function validateTargetDirectory(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const directory = value.trim();
  if (directory.length === 0 || directory.length > 1_024) {
    throw new ValidationError("targetDirectory must be a valid path");
  }
  if (CONTROL_CHARACTERS.test(directory) || !isAbsolute(directory)) {
    throw new ValidationError("targetDirectory must be an absolute path");
  }
  return directory;
}

export class DownloadService {
  constructor(
    private readonly database: AppDatabase,
    private readonly files: FileRepository,
    private readonly jobs: DownloadJobRepository,
  ) {}

  enqueue(input: {
    fileId: string;
    targetDirectory?: string | null;
    targetFilename?: string | null;
  }): DownloadJob {
    const file = this.files.getById(input.fileId);
    if (!file) {
      throw new NotFoundError("File");
    }
    if (file.status !== "completed") {
      throw new ConflictError("Only completed files can be downloaded");
    }

    const targetFilename =
      input.targetFilename === undefined || input.targetFilename === null
        ? file.originalFilename
        : assertSafeFilename(input.targetFilename);
    const targetDirectory = validateTargetDirectory(
      input.targetDirectory ?? null,
    );

    try {
      return this.jobs.create({
        fileId: input.fileId,
        targetDirectory,
        targetFilename,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("This file already has an active download job");
      }
      throw error;
    }
  }

  getJob(id: string): DownloadJob {
    const job = this.jobs.getById(id);
    if (!job) {
      throw new NotFoundError("Download job");
    }
    return job;
  }

  listJobs(input: {
    status?: DownloadJob["status"];
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

  start(id: string): DownloadJob {
    const job = this.getJob(id);
    assertJobTransition(job.status, "processing");
    return this.jobs.update(id, {
      status: "processing",
      attempts: job.attempts + 1,
      lastError: null,
      startedAt: job.startedAt ?? new Date().toISOString(),
    })!;
  }

  updateProgress(id: string, progressBytes: number): DownloadJob {
    const job = this.getJob(id);
    if (job.status !== "processing") {
      throw new ConflictError("Progress can only be recorded for a processing job");
    }
    const file = this.files.getById(job.fileId);
    if (!file) {
      throw new NotFoundError("File");
    }
    if (
      !Number.isSafeInteger(progressBytes) ||
      progressBytes < job.progressBytes ||
      progressBytes > file.totalSize
    ) {
      throw new ValidationError(
        "progressBytes must be an integer between the current progress and the file size",
      );
    }
    return this.jobs.update(id, { progressBytes })!;
  }

  pause(id: string): DownloadJob {
    const job = this.getJob(id);
    assertJobTransition(job.status, "paused");
    return this.jobs.update(id, { status: "paused" })!;
  }

  resume(id: string): DownloadJob {
    const job = this.getJob(id);
    assertJobTransition(job.status, "queued");
    return this.jobs.update(id, { status: "queued", lastError: null })!;
  }

  fail(id: string, error: string): DownloadJob {
    const job = this.getJob(id);
    assertJobTransition(job.status, "failed");
    return this.jobs.update(id, {
      status: "failed",
      lastError: error.slice(0, 2_000),
    })!;
  }

  complete(id: string): DownloadJob {
    const job = this.getJob(id);
    assertJobTransition(job.status, "completed");
    const file = this.files.getById(job.fileId);
    if (!file) {
      throw new NotFoundError("File");
    }
    return this.jobs.update(id, {
      status: "completed",
      progressBytes: file.totalSize,
      completedAt: new Date().toISOString(),
      lastError: null,
    })!;
  }
}
