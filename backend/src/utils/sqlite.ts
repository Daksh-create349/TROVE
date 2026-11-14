import type { SqliteDatabase } from "../database/database";

interface SqliteErrorLike {
  code?: unknown;
}

export function sqliteErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const code = (error as SqliteErrorLike).code;
  return typeof code === "string" ? code : null;
}

export function isUniqueViolation(error: unknown): boolean {
  return sqliteErrorCode(error)?.startsWith("SQLITE_CONSTRAINT_UNIQUE") ?? false;
}

export function isForeignKeyViolation(error: unknown): boolean {
  return (
    sqliteErrorCode(error)?.startsWith("SQLITE_CONSTRAINT_FOREIGNKEY") ?? false
  );
}

export function isCheckViolation(error: unknown): boolean {
  return sqliteErrorCode(error)?.startsWith("SQLITE_CONSTRAINT_CHECK") ?? false;
}

export function isNotNullViolation(error: unknown): boolean {
  return (
    sqliteErrorCode(error)?.startsWith("SQLITE_CONSTRAINT_NOTNULL") ?? false
  );
}

export function tableExists(
  db: SqliteDatabase,
  tableName: string,
): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .get(tableName) as { name: string } | undefined;
  return row !== undefined;
}
