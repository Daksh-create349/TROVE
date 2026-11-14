import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../helpers/testContext";
import { SettingsRepository } from "../../src/database/repositories/settingsRepository";
import { TelegramAccountRepository } from "../../src/database/repositories/telegramAccountRepository";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../src/utils/errors";

describe("database repositories and services", () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  describe("profiles", () => {
    it("stores a single profile and updates it in place", () => {
      const { profileService } = context.services;
      expect(profileService.getProfile()).toBeNull();

      const created = profileService.saveProfile("  Daksh  ");
      expect(created.created).toBe(true);
      expect(created.profile.displayName).toBe("Daksh");
      expect(created.profile.id).toMatch(/^[0-9a-f-]{36}$/);

      const updated = profileService.saveProfile("TeleVault Owner");
      expect(updated.created).toBe(false);
      expect(updated.profile.id).toBe(created.profile.id);
      expect(updated.profile.displayName).toBe("TeleVault Owner");
      expect(profileService.getProfile()?.id).toBe(created.profile.id);
    });
  });

  describe("folders", () => {
    it("creates a folder tree and reports file counts", () => {
      const { folderService, fileService } = context.services;
      const root = folderService.createFolder({ name: "Media" });
      const nested = folderService.createFolder({
        name: "Photos",
        parentId: root.id,
      });

      fileService.createFile({
        folderId: nested.id,
        originalFilename: "holiday.jpg",
        totalSize: 10,
      });

      const folders = folderService.listFolders();
      expect(folders).toHaveLength(2);
      expect(folders.find((folder) => folder.id === root.id)?.fileCount).toBe(0);
      expect(folders.find((folder) => folder.id === nested.id)?.fileCount).toBe(1);
      expect(folders.find((folder) => folder.id === nested.id)?.parentId).toBe(
        root.id,
      );
    });

    it("rejects duplicate, unsafe, and orphaned folders", () => {
      const { folderService } = context.services;
      const root = folderService.createFolder({ name: "Media" });

      expect(() => folderService.createFolder({ name: "media" })).toThrow(
        ConflictError,
      );
      expect(() => folderService.createFolder({ name: "../escape" })).toThrow(
        ValidationError,
      );
      expect(() =>
        folderService.createFolder({
          name: "Orphan",
          parentId: "00000000-0000-4000-8000-000000000000",
        }),
      ).toThrow(NotFoundError);
      expect(folderService.getFolder(root.id).name).toBe("Media");
    });

    it("renames folders and enforces sibling uniqueness", () => {
      const { folderService } = context.services;
      folderService.createFolder({ name: "One" });
      const two = folderService.createFolder({ name: "Two" });

      expect(folderService.renameFolder(two.id, "Renamed").name).toBe("Renamed");
      expect(() => folderService.renameFolder(two.id, "one")).toThrow(
        ConflictError,
      );
    });
  });

  describe("files and parts", () => {
    it("stores metadata and logical parts without file contents", () => {
      const { folderService, fileService } = context.services;
      const folder = folderService.createFolder({ name: "Docs" });
      const sha = "A".repeat(64);

      const file = fileService.createFile({
        folderId: folder.id,
        originalFilename: "report.pdf",
        mimeType: "application/pdf",
        totalSize: 10,
        sha256: sha,
        telegramPeerId: "777",
        telegramMessageIds: ["100", "101"],
        parts: [
          {
            partIndex: 0,
            partSize: 5,
            sha256: "b".repeat(64),
            telegramMessageId: "100",
            status: "completed",
          },
          {
            partIndex: 1,
            partSize: 5,
            sha256: "c".repeat(64),
            telegramMessageId: "101",
            status: "completed",
          },
        ],
      });

      expect(file.originalFilename).toBe("report.pdf");
      expect(file.sha256).toBe("a".repeat(64));
      expect(file.partCount).toBe(2);
      expect(file.telegramMessageIds).toEqual(["100", "101"]);
      expect(file.status).toBe("queued");

      const parts = fileService.listParts(file.id);
      expect(parts).toHaveLength(2);
      expect(parts.map((part) => part.partIndex)).toEqual([0, 1]);
      expect(parts[0]?.telegramMessageId).toBe("100");

      const columns = context.database.connection
        .prepare("PRAGMA table_info(files)")
        .all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).not.toContain("content");
      expect(columns.map((column) => column.name)).not.toContain("data");
    });

    it("validates file metadata before writing", () => {
      const { fileService } = context.services;

      expect(() =>
        fileService.createFile({
          originalFilename: "../evil.txt",
          totalSize: 1,
        }),
      ).toThrow(ValidationError);

      expect(() =>
        fileService.createFile({
          originalFilename: "bad.txt",
          totalSize: 10,
          parts: [{ partIndex: 0, partSize: 9, sha256: null, telegramMessageId: null, status: "queued" }],
        }),
      ).toThrow(ValidationError);

      expect(() =>
        fileService.createFile({
          originalFilename: "bad.txt",
          totalSize: 1,
          sha256: "not-a-hash",
        }),
      ).toThrow(ValidationError);

      expect(() =>
        fileService.createFile({
          folderId: "00000000-0000-4000-8000-000000000000",
          originalFilename: "bad.txt",
          totalSize: 1,
        }),
      ).toThrow(NotFoundError);
    });

    it("lists, filters, searches, and paginates file metadata", () => {
      const { folderService, fileService } = context.services;
      const docs = folderService.createFolder({ name: "Docs" });

      fileService.createFile({
        folderId: docs.id,
        originalFilename: "100% real.txt",
        totalSize: 3,
      });
      fileService.createFile({
        originalFilename: "photo.jpg",
        mimeType: "image/jpeg",
        totalSize: 5,
      });
      fileService.createFile({
        originalFilename: "failed.bin",
        totalSize: 7,
        status: "failed",
      });

      const all = fileService.listFiles({ limit: 10, offset: 0 });
      expect(all.pagination.total).toBe(3);

      const inFolder = fileService.listFiles({
        folderId: docs.id,
        limit: 10,
        offset: 0,
      });
      expect(inFolder.items).toHaveLength(1);

      const failed = fileService.listFiles({
        status: "failed",
        limit: 10,
        offset: 0,
      });
      expect(failed.items[0]?.originalFilename).toBe("failed.bin");

      const searched = fileService.listFiles({
        search: "100%",
        limit: 10,
        offset: 0,
      });
      expect(searched.items).toHaveLength(1);
      expect(searched.items[0]?.originalFilename).toBe("100% real.txt");

      const page = fileService.listFiles({ limit: 2, offset: 0 });
      expect(page.items).toHaveLength(2);
      expect(page.pagination.hasMore).toBe(true);
    });
  });

  describe("upload jobs", () => {
    it("runs the queued -> processing -> completed state machine", () => {
      const { fileService, uploadService } = context.services;
      const file = fileService.createFile({
        originalFilename: "upload.bin",
        totalSize: 10,
      });

      const job = uploadService.enqueue(file.id);
      expect(job.status).toBe("queued");
      expect(fileService.getFile(file.id).status).toBe("queued");

      const started = uploadService.start(job.id);
      expect(started.status).toBe("processing");
      expect(started.attempts).toBe(1);
      expect(started.startedAt).not.toBeNull();
      expect(fileService.getFile(file.id).status).toBe("processing");

      expect(uploadService.updateProgress(job.id, 4).progressBytes).toBe(4);
      expect(() => uploadService.updateProgress(job.id, 2)).toThrow(
        ValidationError,
      );

      const paused = uploadService.pause(job.id);
      expect(paused.status).toBe("paused");
      expect(fileService.getFile(file.id).status).toBe("paused");

      expect(uploadService.resume(job.id).status).toBe("queued");
      uploadService.start(job.id);

      const completed = uploadService.complete(job.id);
      expect(completed.status).toBe("completed");
      expect(completed.progressBytes).toBe(10);
      expect(completed.completedAt).not.toBeNull();
      expect(fileService.getFile(file.id).status).toBe("completed");

      expect(() => uploadService.complete(job.id)).toThrow(ConflictError);
      expect(() => uploadService.enqueue(file.id)).toThrow(ConflictError);
    });

    it("prevents duplicate active jobs and supports retry after failure", () => {
      const { fileService, uploadService } = context.services;
      const file = fileService.createFile({
        originalFilename: "retry.bin",
        totalSize: 5,
      });

      const first = uploadService.enqueue(file.id);
      expect(() => uploadService.enqueue(file.id)).toThrow(ConflictError);
      expect(() => uploadService.complete(first.id)).toThrow(ConflictError);

      uploadService.start(first.id);
      const failed = uploadService.fail(first.id, "network down");
      expect(failed.status).toBe("failed");
      expect(failed.lastError).toBe("network down");
      expect(fileService.getFile(file.id).status).toBe("failed");

      const retry = uploadService.enqueue(file.id);
      expect(retry.id).not.toBe(first.id);
      expect(retry.status).toBe("queued");
    });
  });

  describe("download jobs", () => {
    it("only downloads completed files and tracks progress", () => {
      const { fileService, downloadService } = context.services;
      const file = fileService.createFile({
        originalFilename: "done.bin",
        totalSize: 8,
      });

      expect(() =>
        downloadService.enqueue({ fileId: file.id }),
      ).toThrow(ConflictError);

      fileService.updateStatus(file.id, "completed");
      const job = downloadService.enqueue({
        fileId: file.id,
        targetFilename: "copy.bin",
      });
      expect(job.targetFilename).toBe("copy.bin");

      const started = downloadService.start(job.id);
      expect(started.status).toBe("processing");
      downloadService.updateProgress(job.id, 8);
      const completed = downloadService.complete(job.id);
      expect(completed.status).toBe("completed");
      expect(completed.progressBytes).toBe(8);
    });
  });

  describe("settings", () => {
    it("reads seeded defaults and persists JSON values", () => {
      const settings = new SettingsRepository(context.database);
      expect(settings.get("ui.theme")).toBe("system");
      expect(settings.get<number>("uploads.concurrency")).toBe(2);

      settings.set("uploads.concurrency", 4);
      expect(settings.get<number>("uploads.concurrency")).toBe(4);

      settings.set("custom", { enabled: true });
      expect(settings.getAll().find((entry) => entry.key === "custom")?.value).toEqual({
        enabled: true,
      });

      expect(settings.delete("custom")).toBe(true);
      expect(settings.get("custom")).toBeNull();
    });
  });

  describe("telegram account storage", () => {
    it("stores only encrypted sessions and keeps one linked account", () => {
      const accounts = new TelegramAccountRepository(context.database);
      const encrypted = context.secretBox.encrypt("session-string-one");

      accounts.save({
        telegramUserId: "111",
        username: "first",
        firstName: "First",
        lastName: null,
        sessionCiphertext: encrypted,
        lastConnectedAt: "2026-01-01T00:00:00.000Z",
      });

      const first = accounts.getPrimary()!;
      expect(first.session_ciphertext).toBe(encrypted);
      expect(context.secretBox.decrypt(first.session_ciphertext)).toBe(
        "session-string-one",
      );

      accounts.save({
        telegramUserId: "222",
        username: "second",
        firstName: "Second",
        lastName: null,
        sessionCiphertext: context.secretBox.encrypt("session-string-two"),
        lastConnectedAt: "2026-02-01T00:00:00.000Z",
      });

      const rows = context.database.connection
        .prepare("SELECT * FROM telegram_accounts")
        .all() as Array<{ telegram_user_id: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.telegram_user_id).toBe("222");

      const storedAccount = accounts.getPrimary()!;
      accounts.markConnected(
        storedAccount.id,
        "2026-03-01T00:00:00.000Z",
      );
      expect(accounts.getPrimary()?.last_connected_at).toBe(
        "2026-03-01T00:00:00.000Z",
      );

      accounts.clearAll();
      expect(accounts.getPrimary()).toBeNull();
    });
  });
});
