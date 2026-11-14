import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import type { Logger } from "pino";
import { getSchemaVersion, runMigrations, type MigrationResult } from "./migrate";
import { createSilentLogger } from "../utils/logger";

export type SqliteDatabase = BetterSqlite3.Database;

export interface AppDatabaseOptions {
  readonly?: boolean;
  logger?: Logger;
}

/**
 * Owns the single SQLite connection. All repositories receive this instance
 * and use prepared statements against the same connection.
 */
export class AppDatabase {
  readonly connection: SqliteDatabase;
  private readonly filePath: string;
  private readonly logger: Logger;
  private closed = false;

  constructor(filePath: string, options: AppDatabaseOptions = {}) {
    this.filePath = filePath;
    this.logger = options.logger ?? createSilentLogger();

    if (filePath !== ":memory:") {
      mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
    }

    this.connection = new BetterSqlite3(filePath, {
      readonly: options.readonly ?? false,
      fileMustExist: false,
    });

    this.connection.pragma("foreign_keys = ON");
    this.connection.pragma("journal_mode = WAL");
    this.connection.pragma("synchronous = NORMAL");
    this.connection.pragma("busy_timeout = 5000");
    this.connection.pragma("trusted_schema = OFF");
  }

  async migrate(): Promise<MigrationResult> {
    const result = await runMigrations(this.connection, {
      logger: this.logger,
    });
    this.logger.info(
      { schemaVersion: result.currentVersion, applied: result.applied },
      "Database ready",
    );
    return result;
  }

  schemaVersion(): number {
    return getSchemaVersion(this.connection);
  }

  healthCheck(): boolean {
    try {
      const row = this.connection.prepare("SELECT 1 AS ok").get() as
        | { ok: number }
        | undefined;
      return row?.ok === 1;
    } catch {
      return false;
    }
  }

  fileSizeBytes(): number {
    try {
      const row = this.connection
        .prepare("SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()")
        .get() as { size: number } | undefined;
      return row?.size ?? 0;
    } catch {
      return 0;
    }
  }

  transaction<T>(operation: () => T): T {
    return this.connection.transaction(operation)();
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.connection.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      // Checkpoint is best-effort on shutdown.
    }
    this.connection.close();
    this.logger.info({ filePath: this.filePath }, "Database connection closed");
  }
}
