import type { FilePart, FileStatus } from "@shared/types";
import type { AppDatabase, SqliteDatabase } from "../database";
import { mapFilePart, type FilePartRow } from "../rows";
import { newId } from "../../utils/crypto";

export interface CreateFilePartInput {
  partIndex: number;
  partSize: number;
  sha256: string | null;
  telegramMessageId: string | null;
  status: FileStatus;
}

export class FilePartRepository {
  private readonly db: SqliteDatabase;

  constructor(database: AppDatabase) {
    this.db = database.connection;
  }

  createMany(fileId: string, parts: CreateFilePartInput[]): FilePart[] {
    const insert = this.db.prepare(
      `INSERT INTO file_parts (
         id, file_id, part_index, part_size, sha256, telegram_message_id, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    const createdIds: string[] = [];
    for (const part of parts) {
      const id = newId();
      insert.run(
        id,
        fileId,
        part.partIndex,
        part.partSize,
        part.sha256,
        part.telegramMessageId,
        part.status,
      );
      createdIds.push(id);
    }

    if (createdIds.length === 0) {
      return [];
    }

    const placeholders = createdIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT * FROM file_parts WHERE id IN (${placeholders}) ORDER BY part_index ASC`,
      )
      .all(...createdIds) as FilePartRow[];
    return rows.map(mapFilePart);
  }

  listByFile(fileId: string): FilePart[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM file_parts WHERE file_id = ? ORDER BY part_index ASC",
      )
      .all(fileId) as FilePartRow[];
    return rows.map(mapFilePart);
  }

  get(fileId: string, partIndex: number): FilePart | null {
    const row = this.db
      .prepare(
        "SELECT * FROM file_parts WHERE file_id = ? AND part_index = ?",
      )
      .get(fileId, partIndex) as FilePartRow | undefined;
    return row ? mapFilePart(row) : null;
  }

  updateStatus(
    fileId: string,
    partIndex: number,
    status: FileStatus,
    telegramMessageId?: string | null,
    sha256?: string | null,
  ): FilePart | null {
    const result = this.db
      .prepare(
        `UPDATE file_parts
            SET status = ?,
                telegram_message_id = COALESCE(?, telegram_message_id),
                sha256 = COALESCE(?, sha256)
          WHERE file_id = ? AND part_index = ?`,
      )
      .run(status, telegramMessageId ?? null, sha256 ?? null, fileId, partIndex);
    return result.changes > 0 ? this.get(fileId, partIndex) : null;
  }
}
