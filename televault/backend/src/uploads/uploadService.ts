import type { Paginated, UploadJob } from "@shared/types";
import type { AppDatabase } from "../database/database";
import type { FileRepository } from "../database/repositories/fileRepository";
import type { UploadJobRepository } from "../database/repositories/uploadJobRepository";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors";
import { assertJobTransition } from "../utils/jobTransitions";
import { isUniqueViolation } from "../utils/sqlite";

/**
 * Transactional upload job state machine. The actual Telegram upload worker
 * will consume these jobs in a later phase; job and file state already stay
 * consistent here so workers can be added without schema changes.
 */
export class UploadService {
  constructor(
    private readonly database: AppDatabase,
    private readonly files: FileRepository,
    private readonly jobs: UploadJobRepository,
  ) {}

  enqueue(fileId: string): UploadJob {
    return this.database.transaction(() => {
      const file = this.files.getById(fileId);
      if (!file) {
        throw new NotFoundError("File");
      }
      if (file.status === "completed") {
        throw new ConflictError("Completed files cannot be queued for upload");
      }
      if (this.jobs.findActiveByFile(fileId)) {
        throw new ConflictError("This file already has an active upload job");
      }

      try {
        const job = this.jobs.create(fileId);
        this.files.updateStatus(fileId, "queued");
        return job;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError("This file already has an active upload job");
        }
        throw error;
      }
    });
  }

  getJob(id: string): UploadJob {
    const job = this.jobs.getById(id);
    if (!job) {
      throw new NotFoundError("Upload job");
    }
    return job;
  }

  listJobs(input: {
    status?: UploadJob["status"];
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

  start(id: string): UploadJob {
    return this.database.transaction(() => {
      const job = this.getJob(id);
      assertJobTransition(job.status, "processing");
      const file = this.files.getById(job.fileId);
      if (!file) {
        throw new NotFoundError("File");
      }

      const updated = this.jobs.update(id, {
        status: "processing",
        attempts: job.attempts + 1,
        lastError: null,
        startedAt: job.startedAt ?? new Date().toISOString(),
      });
      this.files.updateStatus(job.fileId, "processing");
      return updated!;
    });
  }

  updateProgress(id: string, progressBytes: number): UploadJob {
    return this.database.transaction(() => {
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
    });
  }

  pause(id: string): UploadJob {
    return this.database.transaction(() => {
      const job = this.getJob(id);
      assertJobTransition(job.status, "paused");
      const updated = this.jobs.update(id, { status: "paused" });
      this.files.updateStatus(job.fileId, "paused");
      return updated!;
    });
  }

  resume(id: string): UploadJob {
    return this.database.transaction(() => {
      const job = this.getJob(id);
      assertJobTransition(job.status, "queued");
      const updated = this.jobs.update(id, { status: "queued", lastError: null });
      this.files.updateStatus(job.fileId, "queued");
      return updated!;
    });
  }

  fail(id: string, error: string): UploadJob {
    return this.database.transaction(() => {
      const job = this.getJob(id);
      assertJobTransition(job.status, "failed");
      const updated = this.jobs.update(id, {
        status: "failed",
        lastError: error.slice(0, 2_000),
      });
      this.files.updateStatus(job.fileId, "failed");
      return updated!;
    });
  }

  complete(id: string): UploadJob {
    return this.database.transaction(() => {
      const job = this.getJob(id);
      assertJobTransition(job.status, "completed");
      const file = this.files.getById(job.fileId);
      if (!file) {
        throw new NotFoundError("File");
      }

      const updated = this.jobs.update(id, {
        status: "completed",
        progressBytes: file.totalSize,
        completedAt: new Date().toISOString(),
        lastError: null,
      });
      this.files.updateStatus(job.fileId, "completed");
      return updated!;
    });
  }
}
