import type { DownloadJob, JobStatus } from "@shared/types";
import type { AppDatabase, SqliteDatabase } from "../database";
import { mapDownloadJob, type DownloadJobRow } from "../rows";
import { newId } from "../../utils/crypto";

export interface DownloadJobPatch {
  status?: JobStatus;
  progressBytes?: number;
  attempts?: number;
  lastError?: string | null;
  targetDirectory?: string | null;
  targetFilename?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export class DownloadJobRepository {
  private readonly db: SqliteDatabase;

  constructor(database: AppDatabase) {
    this.db = database.connection;
  }

  create(input: {
    fileId: string;
    targetDirectory: string | null;
    targetFilename: string | null;
  }): DownloadJob {
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO download_jobs (id, file_id, target_directory, target_filename)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, input.fileId, input.targetDirectory, input.targetFilename);
    return this.getById(id)!;
  }

  getById(id: string): DownloadJob | null {
    const row = this.db
      .prepare("SELECT * FROM download_jobs WHERE id = ?")
      .get(id) as DownloadJobRow | undefined;
    return row ? mapDownloadJob(row) : null;
  }

  list(input: {
    status?: JobStatus;
    fileId?: string;
    limit: number;
    offset: number;
  }): { items: DownloadJob[]; total: number } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (input.status !== undefined) {
      clauses.push("status = ?");
      params.push(input.status);
    }
    if (input.fileId !== undefined) {
      clauses.push("file_id = ?");
      params.push(input.fileId);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM download_jobs ${where}`)
      .get(...params) as { total: number };
    const rows = this.db
      .prepare(
        `SELECT * FROM download_jobs ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT ? OFFSET ?`,
      )
      .all(...params, input.limit, input.offset) as DownloadJobRow[];

    return { items: rows.map(mapDownloadJob), total: totalRow.total };
  }

  findActiveByFile(fileId: string): DownloadJob | null {
    const row = this.db
      .prepare(
        `SELECT * FROM download_jobs
          WHERE file_id = ? AND status IN ('queued', 'processing', 'paused')
          LIMIT 1`,
      )
      .get(fileId) as DownloadJobRow | undefined;
    return row ? mapDownloadJob(row) : null;
  }

  update(id: string, patch: DownloadJobPatch): DownloadJob | null {
    const assignments: string[] = [];
    const params: unknown[] = [];

    if (patch.status !== undefined) {
      assignments.push("status = ?");
      params.push(patch.status);
    }
    if (patch.progressBytes !== undefined) {
      assignments.push("progress_bytes = ?");
      params.push(patch.progressBytes);
    }
    if (patch.attempts !== undefined) {
      assignments.push("attempts = ?");
      params.push(patch.attempts);
    }
    if (patch.lastError !== undefined) {
      assignments.push("last_error = ?");
      params.push(patch.lastError);
    }
    if (patch.targetDirectory !== undefined) {
      assignments.push("target_directory = ?");
      params.push(patch.targetDirectory);
    }
    if (patch.targetFilename !== undefined) {
      assignments.push("target_filename = ?");
      params.push(patch.targetFilename);
    }
    if (patch.startedAt !== undefined) {
      assignments.push("started_at = ?");
      params.push(patch.startedAt);
    }
    if (patch.completedAt !== undefined) {
      assignments.push("completed_at = ?");
      params.push(patch.completedAt);
    }

    if (assignments.length === 0) {
      return this.getById(id);
    }

    params.push(id);
    const result = this.db
      .prepare(`UPDATE download_jobs SET ${assignments.join(", ")} WHERE id = ?`)
      .run(...params);
    return result.changes > 0 ? this.getById(id) : null;
  }
}
