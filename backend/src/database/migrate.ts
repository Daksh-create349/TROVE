import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import type { Logger } from "pino";
import { SCHEMA_MIGRATIONS_TABLE } from "../config/constants";
import { createSilentLogger } from "../utils/logger";

export interface MigrationResult {
  currentVersion: number;
  applied: number[];
}

interface MigrationFile {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

interface AppliedMigrationRow {
  version: number;
  name: string;
  checksum: string;
}

const MIGRATION_FILENAME = /^(\d{3,})_([a-zA-Z0-9_-]+)\.sql$/;

function defaultMigrationsDir(): string {
  return resolve(__dirname, "migrations");
}

async function loadMigrationFiles(
  migrationsDir: string,
): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrations: MigrationFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const match = MIGRATION_FILENAME.exec(entry.name);
    if (!match) {
      continue;
    }
    const version = Number(match[1]);
    const name = match[2] ?? entry.name;
    const sql = await readFile(resolve(migrationsDir, entry.name), "utf8");
    migrations.push({
      version,
      name,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    });
  }

  migrations.sort((a, b) => a.version - b.version);

  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index]!.version === migrations[index - 1]!.version) {
      throw new Error(
        `Duplicate database migration version ${migrations[index]!.version}`,
      );
    }
  }

  return migrations;
}

/**
 * Apply all pending SQL migrations inside a transaction and verify checksums
 * of already-applied migrations so the on-disk schema cannot drift silently.
 */
export async function runMigrations(
  db: BetterSqlite3.Database,
  options: { migrationsDir?: string; logger?: Logger } = {},
): Promise<MigrationResult> {
  const logger = options.logger ?? createSilentLogger();
  const migrationsDir = options.migrationsDir ?? defaultMigrationsDir();
  const migrations = await loadMigrationFiles(migrationsDir);

  if (migrations.length === 0) {
    throw new Error(`No database migrations found in ${migrationsDir}`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const appliedRows = db
    .prepare(
      `SELECT version, name, checksum FROM ${SCHEMA_MIGRATIONS_TABLE} ORDER BY version`,
    )
    .all() as AppliedMigrationRow[];

  const appliedByVersion = new Map(
    appliedRows.map((row) => [row.version, row]),
  );

  for (const migration of migrations) {
    const applied = appliedByVersion.get(migration.version);
    if (applied && applied.checksum !== migration.checksum) {
      throw new Error(
        `Database migration ${migration.version}_${migration.name} has changed since it was applied. ` +
          "Create a new migration instead of editing an applied one.",
      );
    }
  }

  const pending = migrations.filter(
    (migration) => !appliedByVersion.has(migration.version),
  );
  const appliedVersions: number[] = [];

  const applyPending = db.transaction(() => {
    for (const migration of pending) {
      logger.info(
        { version: migration.version, name: migration.name },
        "Applying database migration",
      );
      db.exec(migration.sql);
      db.prepare(
        `INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (version, name, checksum) VALUES (?, ?, ?)`,
      ).run(migration.version, migration.name, migration.checksum);
      appliedVersions.push(migration.version);
    }
  });

  if (pending.length > 0) {
    applyPending();
  }

  const currentVersion =
    migrations[migrations.length - 1]?.version ??
    appliedRows[appliedRows.length - 1]?.version ??
    0;
  db.pragma(`user_version = ${currentVersion}`);

  return { currentVersion, applied: appliedVersions };
}

export function getSchemaVersion(db: BetterSqlite3.Database): number {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(version), 0) AS version FROM ${SCHEMA_MIGRATIONS_TABLE}`,
    )
    .get() as { version: number } | undefined;
  return row?.version ?? 0;
}
