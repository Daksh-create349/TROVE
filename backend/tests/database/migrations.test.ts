import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../helpers/testContext";
import { tableExists } from "../../src/utils/sqlite";

const EXPECTED_TABLES = [
  "app_profiles",
  "telegram_accounts",
  "files",
  "file_parts",
  "folders",
  "upload_jobs",
  "download_jobs",
  "settings",
  "schema_migrations",
];

describe("database migrations", () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it("creates every required table and records the schema version", () => {
    for (const table of EXPECTED_TABLES) {
      expect(tableExists(context.database.connection, table), table).toBe(true);
    }
    expect(context.database.schemaVersion()).toBe(3);
    expect(context.database.connection.pragma("user_version", { simple: true })).toBe(3);
  });

  it("is idempotent and verifies checksums of applied migrations", async () => {
    const secondRun = await context.database.migrate();
    expect(secondRun.applied).toEqual([]);
    expect(secondRun.currentVersion).toBe(3);

    context.database.connection
      .prepare("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1")
      .run();

    await expect(context.database.migrate()).rejects.toThrow(/has changed/);
  });

  it("enforces foreign keys", () => {
    expect(() =>
      context.database.connection
        .prepare(
          `INSERT INTO files (
             id, folder_id, original_filename, mime_type, total_size,
             part_count, telegram_message_ids, status
           ) VALUES ('f1', 'missing-folder', 'a.bin', 'application/octet-stream', 1, 0, '[]', 'queued')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("enforces the single-profile constraint and check constraints", () => {
    const db = context.database.connection;
    db.prepare(
      "INSERT INTO app_profiles (id, singleton, display_name) VALUES ('p1', 1, 'Owner')",
    ).run();

    expect(() =>
      db
        .prepare(
          "INSERT INTO app_profiles (id, singleton, display_name) VALUES ('p2', 1, 'Other')",
        )
        .run(),
    ).toThrow(/UNIQUE/i);

    expect(() =>
      db
        .prepare(
          `INSERT INTO files (
             id, original_filename, mime_type, total_size, part_count,
             telegram_message_ids, status
           ) VALUES ('bad-size', 'a.bin', 'application/octet-stream', -1, 0, '[]', 'queued')`,
        )
        .run(),
    ).toThrow(/CHECK/i);

    expect(() =>
      db
        .prepare(
          `INSERT INTO files (
             id, original_filename, mime_type, total_size, part_count,
             telegram_message_ids, status
           ) VALUES ('bad-json', 'a.bin', 'application/octet-stream', 1, 0, 'not-json', 'queued')`,
        )
        .run(),
    ).toThrow(/CHECK/i);

    expect(() =>
      db.prepare("INSERT INTO settings (key, value) VALUES ('bad', 'nope')").run(),
    ).toThrow(/CHECK/i);
  });

  it("enforces case-insensitive unique folder names within a parent", () => {
    const db = context.database.connection;
    db.prepare("INSERT INTO folders (id, name) VALUES ('folder-a', 'Documents')").run();
    expect(() =>
      db.prepare("INSERT INTO folders (id, name) VALUES ('folder-b', 'documents')").run(),
    ).toThrow(/UNIQUE/i);
  });

  it("maintains updated_at with database triggers", () => {
    const db = context.database.connection;
    context.services.profileService.saveProfile("Owner");
    const profile = context.services.profileService.getProfile()!;

    db.prepare(
      "UPDATE app_profiles SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
    ).run(profile.id);
    db.prepare("UPDATE app_profiles SET display_name = 'Renamed' WHERE id = ?").run(
      profile.id,
    );

    const row = db
      .prepare("SELECT display_name, updated_at FROM app_profiles WHERE id = ?")
      .get(profile.id) as { display_name: string; updated_at: string };
    expect(row.display_name).toBe("Renamed");
    expect(row.updated_at > "2000-01-01T00:00:00.000Z").toBe(true);
  });

  it("rolls back failed transactions", () => {
    const db = context.database.connection;
    expect(() =>
      context.database.transaction(() => {
        db.prepare("INSERT INTO folders (id, name) VALUES ('tx-folder', 'Tx')").run();
        throw new Error("force rollback");
      }),
    ).toThrow("force rollback");

    const row = db
      .prepare("SELECT COUNT(*) AS count FROM folders WHERE id = 'tx-folder'")
      .get() as { count: number };
    expect(row.count).toBe(0);
  });

  it("cascades file parts and jobs and nulls folder references", () => {
    const db = context.database.connection;
    const folder = context.services.folderService.createFolder({ name: "Docs" });
    const file = context.services.fileService.createFile({
      folderId: folder.id,
      originalFilename: "notes.txt",
      totalSize: 4,
      parts: [
        {
          partIndex: 0,
          partSize: 4,
          sha256: "a".repeat(64),
          telegramMessageId: "42",
          status: "completed",
        },
      ],
    });
    context.services.uploadService.enqueue(file.id);

    db.prepare("DELETE FROM folders WHERE id = ?").run(folder.id);
    const updatedFile = context.services.fileService.getFile(file.id);
    expect(updatedFile.folderId).toBeNull();

    context.services.fileService.deleteFile(file.id);
    const parts = db
      .prepare("SELECT COUNT(*) AS count FROM file_parts WHERE file_id = ?")
      .get(file.id) as { count: number };
    const jobs = db
      .prepare("SELECT COUNT(*) AS count FROM upload_jobs WHERE file_id = ?")
      .get(file.id) as { count: number };
    expect(parts.count).toBe(0);
    expect(jobs.count).toBe(0);
  });
});
