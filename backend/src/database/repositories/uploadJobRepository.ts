import type { JobStatus, UploadJob } from "@shared/types";
import type { AppDatabase, SqliteDatabase } from "../database";
import { mapUploadJob, type UploadJobRow } from "../rows";
import { newId } from "../../utils/crypto";

export interface UploadJobPatch {
  status?: JobStatus;
  progressBytes?: number;
  attempts?: number;
  lastError?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export class UploadJobRepository {
  private readonly db: SqliteDatabase;

  constructor(database: AppDatabase) {
    this.db = database.connection;
  }

  create(fileId: string): UploadJob {
    const id = newId();
    this.db
      .prepare("INSERT INTO upload_jobs (id, file_id) VALUES (?, ?)")
      .run(id, fileId);
    return this.getById(id)!;
  }

  getById(id: string): UploadJob | null {
    const row = this.db
      .prepare("SELECT * FROM upload_jobs WHERE id = ?")
      .get(id) as UploadJobRow | undefined;
    return row ? mapUploadJob(row) : null;
  }

  list(input: {
    status?: JobStatus;
    fileId?: string;
    limit: number;
    offset: number;
  }): { items: UploadJob[]; total: number } {
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
      .prepare(`SELECT COUNT(*) AS total FROM upload_jobs ${where}`)
      .get(...params) as { total: number };
    const rows = this.db
      .prepare(
        `SELECT * FROM upload_jobs ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT ? OFFSET ?`,
      )
      .all(...params, input.limit, input.offset) as UploadJobRow[];

    return { items: rows.map(mapUploadJob), total: totalRow.total };
  }

  findActiveByFile(fileId: string): UploadJob | null {
    const row = this.db
      .prepare(
        `SELECT * FROM upload_jobs
          WHERE file_id = ? AND status IN ('queued', 'processing', 'paused')
          LIMIT 1`,
      )
      .get(fileId) as UploadJobRow | undefined;
    return row ? mapUploadJob(row) : null;
  }

  update(id: string, patch: UploadJobPatch): UploadJob | null {
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
      .prepare(`UPDATE upload_jobs SET ${assignments.join(", ")} WHERE id = ?`)
      .run(...params);
    return result.changes > 0 ? this.getById(id) : null;
  }
}
