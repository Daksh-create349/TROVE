import type { AppDatabase, SqliteDatabase } from "../database";

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

export interface SettingEntry {
  key: string;
  value: unknown;
  updatedAt: string;
}

export class SettingsRepository {
  private readonly db: SqliteDatabase;

  constructor(database: AppDatabase) {
    this.db = database.connection;
  }

  get<T = unknown>(key: string): T | null {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    if (!row) {
      return null;
    }
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  getAll(): SettingEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM settings ORDER BY key ASC")
      .all() as SettingRow[];
    return rows.map((row) => {
      let value: unknown = null;
      try {
        value = JSON.parse(row.value);
      } catch {
        value = null;
      }
      return { key: row.key, value, updatedAt: row.updated_at };
    });
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, JSON.stringify(value));
  }

  delete(key: string): boolean {
    const result = this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
    return result.changes > 0;
  }
}
