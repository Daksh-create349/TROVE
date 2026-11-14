import type {
  FileMetadata,
  FileStatus,
  Paginated,
} from "@shared/types";
import type { AppDatabase, SqliteDatabase } from "../database";
import { mapFile, type FileRow } from "../rows";
import { newId } from "../../utils/crypto";

export interface CreateFileRowInput {
  id?: string | null;
  folderId: string | null;
  originalFilename: string;
  mimeType: string;
  totalSize: number;
  sha256: string | null;
  partCount: number;
  telegramPeerId: string | null;
  telegramMessageIds: string[];
  status: FileStatus;
}

export interface ListFilesInput {
  folderId?: string | null;
  status?: FileStatus;
  search?: string;
  limit: number;
  offset: number;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export class FileRepository {
  private readonly db: SqliteDatabase;

  constructor(database: AppDatabase) {
    this.db = database.connection;
  }

  create(input: CreateFileRowInput): FileMetadata {
    const id = input.id ?? newId();
    this.db
      .prepare(
        `INSERT INTO files (
           id, folder_id, original_filename, mime_type, total_size, sha256,
           part_count, telegram_peer_id, telegram_message_ids, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.folderId,
        input.originalFilename,
        input.mimeType,
        input.totalSize,
        input.sha256,
        input.partCount,
        input.telegramPeerId,
        JSON.stringify(input.telegramMessageIds),
        input.status,
      );
    return this.getById(id)!;
  }

  getById(id: string): FileMetadata | null {
    const row = this.db
      .prepare("SELECT * FROM files WHERE id = ?")
      .get(id) as FileRow | undefined;
    return row ? mapFile(row) : null;
  }

  getRow(id: string): FileRow | null {
    const row = this.db
      .prepare("SELECT * FROM files WHERE id = ?")
      .get(id) as FileRow | undefined;
    return row ?? null;
  }

  list(input: ListFilesInput): Paginated<FileMetadata> {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (input.folderId !== undefined) {
      if (input.folderId === null) {
        clauses.push("folder_id IS NULL");
      } else {
        clauses.push("folder_id = ?");
        params.push(input.folderId);
      }
    }

    if (input.status !== undefined) {
      clauses.push("status = ?");
      params.push(input.status);
    }

    if (input.search !== undefined && input.search.length > 0) {
      clauses.push("original_filename LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(input.search)}%`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM files ${where}`)
      .get(...params) as { total: number };

    const rows = this.db
      .prepare(
        `SELECT * FROM files
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, input.limit, input.offset) as FileRow[];

    return {
      items: rows.map(mapFile),
      pagination: {
        total: totalRow.total,
        limit: input.limit,
        offset: input.offset,
        hasMore: input.offset + rows.length < totalRow.total,
      },
    };
  }

  updateStatus(id: string, status: FileStatus): FileMetadata | null {
    const result = this.db
      .prepare("UPDATE files SET status = ? WHERE id = ?")
      .run(status, id);
    return result.changes > 0 ? this.getById(id) : null;
  }

  markCompleted(input: {
    id: string;
    sha256: string;
    telegramMessageIds: string[];
    telegramPeerId: string | null;
  }): FileMetadata | null {
    const result = this.db
      .prepare(
        `UPDATE files
            SET status = 'completed',
                sha256 = ?,
                telegram_message_ids = ?,
                telegram_peer_id = COALESCE(?, telegram_peer_id)
          WHERE id = ?`,
      )
      .run(
        input.sha256,
        JSON.stringify(input.telegramMessageIds),
        input.telegramPeerId,
        input.id,
      );
    return result.changes > 0 ? this.getById(input.id) : null;
  }

  setTelegramReferences(input: {
    id: string;
    telegramPeerId: string | null;
    telegramMessageIds: string[];
  }): FileMetadata | null {
    const result = this.db
      .prepare(
        `UPDATE files
            SET telegram_peer_id = ?, telegram_message_ids = ?
          WHERE id = ?`,
      )
      .run(
        input.telegramPeerId,
        JSON.stringify(input.telegramMessageIds),
        input.id,
      );
    return result.changes > 0 ? this.getById(input.id) : null;
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM files WHERE id = ?").run(id);
    return result.changes > 0;
  }

  stats(): {
    totalFiles: number;
    totalBytes: number;
    completedFiles: number;
    failedFiles: number;
    totalParts: number;
    filesByStatus: Record<FileStatus, number>;
  } {
    const aggregate = this.db
      .prepare(
        `SELECT COUNT(*) AS total_files,
                COALESCE(SUM(total_size), 0) AS total_bytes,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_files,
                COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_files
           FROM files`,
      )
      .get() as {
        total_files: number;
        total_bytes: number;
        completed_files: number;
        failed_files: number;
      };

    const parts = this.db
      .prepare("SELECT COUNT(*) AS total_parts FROM file_parts")
      .get() as { total_parts: number };

    const statusRows = this.db
      .prepare("SELECT status, COUNT(*) AS count FROM files GROUP BY status")
      .all() as { status: FileStatus; count: number }[];

    const filesByStatus: Record<FileStatus, number> = {
      queued: 0,
      processing: 0,
      paused: 0,
      failed: 0,
      completed: 0,
    };
    for (const row of statusRows) {
      filesByStatus[row.status] = row.count;
    }

    return {
      totalFiles: aggregate.total_files,
      totalBytes: aggregate.total_bytes,
      completedFiles: aggregate.completed_files,
      failedFiles: aggregate.failed_files,
      totalParts: parts.total_parts,
      filesByStatus,
    };
  }
}
