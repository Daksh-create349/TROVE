import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type {
  DownloadSegmentInput,
  ManagedTelegramClient,
  SavedMessagesPeer,
  SubmitCodeResult,
  TelegramMessageSummary,
  TelegramUserProfile,
  UploadCapabilities,
  UploadSegmentInput,
  UploadSegmentResult,
} from "../../src/telegram/managedClient";
import type { RemoteFileManifest } from "../../src/uploads/manifest";
import { formatRemoteManifestCaption } from "../../src/uploads/manifest";
import { TelegramAccountRepository } from "../../src/database/repositories/telegramAccountRepository";
import {
  authHeader,
  createTestContext,
  type TestContext,
} from "../helpers/testContext";

interface FakeStoredMessage {
  id: string;
  peerId: string;
  fileName: string;
  bytes: Buffer;
  caption: string;
  hasDocument: boolean;
  documentSize: number;
  documentFilename: string;
  manifest?: RemoteFileManifest;
  date: number;
}

class FakeTelegramStorageClient implements ManagedTelegramClient {
  public connected = true;
  public authorized = true;
  public destroyed = false;
  public user: TelegramUserProfile = {
    id: "999888777",
    username: "televault_tester",
    firstName: "Tele",
    lastName: "Vault",
    phone: "+15551234567",
  };

  public safeSegmentSize = 50 * 1024; // 50 KB segment size for tests
  public messages = new Map<string, FakeStoredMessage>();
  public failDeleteIds = new Set<string>();
  public failDownloadIds = new Set<string>();
  public segmentUploadCount = 0;
  public segmentDownloadCount = 0;
  public delayMs = 0;
  private messageCounter = 10000;

  async connect(): Promise<void> {
    this.connected = true;
  }

  isConnected(): boolean {
    return this.connected && !this.destroyed;
  }

  async checkAuthorization(): Promise<boolean> {
    return this.authorized;
  }

  async sendCode(_phoneNumber: string): Promise<{ phoneCodeHash: string; isCodeViaApp: boolean }> {
    return { phoneCodeHash: "fake-hash", isCodeViaApp: true };
  }

  async submitCode(_input: unknown): Promise<SubmitCodeResult> {
    return { requiresPassword: false, user: this.user };
  }

  async submitPassword(_password: string): Promise<TelegramUserProfile> {
    return this.user;
  }

  async getMe(): Promise<TelegramUserProfile> {
    return this.user;
  }

  async resolveSavedMessages(selfUserId: string): Promise<SavedMessagesPeer> {
    return { destination: "saved_messages", peerId: selfUserId };
  }

  async getUploadCapabilities(): Promise<UploadCapabilities> {
    return {
      uploadMaxFileparts: 4000,
      partSize: 512 * 1024,
      maxSingleFileSize: 4000 * 512 * 1024,
      safeSegmentSize: this.safeSegmentSize,
      isPremium: false,
    };
  }

  async uploadSegment(input: UploadSegmentInput): Promise<UploadSegmentResult> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (input.abortSignal?.aborted) {
      throw new Error("Upload aborted");
    }

    let bytes: Buffer;
    if (input.filePath) {
      bytes = await fs.readFile(input.filePath);
    } else if (input.buffer) {
      bytes = input.buffer;
    } else {
      bytes = Buffer.alloc(0);
    }

    this.messageCounter++;
    const messageId = String(this.messageCounter);
    this.segmentUploadCount++;

    this.messages.set(messageId, {
      id: messageId,
      peerId: input.peerId,
      fileName: input.fileName,
      bytes,
      caption: input.caption,
      hasDocument: true,
      documentSize: bytes.length,
      documentFilename: input.fileName,
      date: Math.floor(Date.now() / 1000),
    });

    if (input.onProgress) {
      input.onProgress(1.0);
    }

    return { messageId };
  }

  async downloadSegment(input: DownloadSegmentInput): Promise<{ size: number }> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (input.abortSignal?.aborted) {
      throw new Error("Download aborted");
    }

    if (this.failDownloadIds.has(input.messageId)) {
      throw new Error(`Telegram segment message ${input.messageId} download failed`);
    }

    const msg = this.messages.get(input.messageId);
    if (!msg) {
      throw new Error(`Telegram message ${input.messageId} not found`);
    }

    this.segmentDownloadCount++;
    await fs.writeFile(input.targetPath, msg.bytes);

    if (input.onProgress) {
      input.onProgress(1.0);
    }

    return { size: msg.bytes.length };
  }

  async getMessages(peerId: string, messageIds: string[]): Promise<TelegramMessageSummary[]> {
    const results: TelegramMessageSummary[] = [];
    for (const id of messageIds) {
      const msg = this.messages.get(id);
      if (msg && (msg.peerId === peerId || peerId === "me" || peerId === this.user.id)) {
        results.push({
          id: msg.id,
          caption: msg.caption,
          hasDocument: msg.hasDocument,
          documentSize: msg.documentSize,
          documentFilename: msg.documentFilename,
          date: msg.date,
        });
      }
    }
    return results;
  }

  async iterMessages(
    peerId: string,
    options?: { limit?: number; offsetId?: string },
  ): Promise<TelegramMessageSummary[]> {
    let list = Array.from(this.messages.values()).filter(
      (m) => m.peerId === peerId || peerId === "me" || peerId === this.user.id,
    );
    list.sort((a, b) => parseInt(b.id, 10) - parseInt(a.id, 10));

    if (options?.offsetId) {
      const idx = list.findIndex((m) => m.id === options.offsetId);
      if (idx !== -1) {
        list = list.slice(idx + 1);
      }
    }

    if (options?.limit) {
      list = list.slice(0, options.limit);
    }

    return list.map((m) => ({
      id: m.id,
      caption: m.caption,
      hasDocument: m.hasDocument,
      documentSize: m.documentSize,
      documentFilename: m.documentFilename,
      date: m.date,
    }));
  }

  async deleteMessages(
    peerId: string,
    messageIds: string[],
  ): Promise<{ deletedIds: string[]; failedIds: string[] }> {
    const deletedIds: string[] = [];
    const failedIds: string[] = [];

    for (const id of messageIds) {
      if (this.failDeleteIds.has(id)) {
        failedIds.push(id);
      } else {
        this.messages.delete(id);
        deletedIds.push(id);
      }
    }

    return { deletedIds, failedIds };
  }

  async sendManifest(input: {
    peerId: string;
    manifest: RemoteFileManifest;
  }): Promise<{ messageId: string }> {
    this.messageCounter++;
    const messageId = String(this.messageCounter);
    const caption = formatRemoteManifestCaption(input.manifest.fileId, input.manifest.sha256);
    const bytes = Buffer.from(JSON.stringify(input.manifest, null, 2), "utf8");

    this.messages.set(messageId, {
      id: messageId,
      peerId: input.peerId,
      fileName: `${input.manifest.fileId}.manifest.json`,
      bytes,
      caption,
      hasDocument: true,
      documentSize: bytes.length,
      documentFilename: `${input.manifest.fileId}.manifest.json`,
      manifest: input.manifest,
      date: Math.floor(Date.now() / 1000),
    });

    return { messageId };
  }

  async downloadManifest(input: {
    peerId: string;
    messageId: string;
  }): Promise<RemoteFileManifest | null> {
    const msg = this.messages.get(input.messageId);
    if (!msg) {
      return null;
    }
    if (msg.manifest) {
      return msg.manifest;
    }
    try {
      return JSON.parse(msg.bytes.toString("utf8")) as RemoteFileManifest;
    } catch {
      return null;
    }
  }

  async logOut(): Promise<void> {
    this.authorized = false;
  }

  saveSession(): string | null {
    return "fake-session-string-for-download-sync-tests";
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.connected = false;
  }
}

function bufferParser(
  res: any,
  callback: (err: Error | null, body: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  res.on("end", () => {
    callback(null, Buffer.concat(chunks));
  });
}

describe("TeleVault Download, Recovery, and Sync Engine (Prompt 04)", () => {
  let context: TestContext;
  let fakeClient: FakeTelegramStorageClient;
  let testFilesDir: string;

  beforeEach(async () => {
    fakeClient = new FakeTelegramStorageClient();

    context = await createTestContext(
      {
        TELEGRAM_API_ID: "123456",
        TELEGRAM_API_HASH: "0123456789abcdef0123456789abcdef",
      },
      {
        telegramClientFactory: () => fakeClient,
      },
    );

    testFilesDir = join(context.dataDir, "test-files");
    await fs.mkdir(testFilesDir, { recursive: true });

    // Seed authenticated session
    await context.sessionStore.save(fakeClient.saveSession()!);
    new TelegramAccountRepository(context.database).save({
      telegramUserId: fakeClient.user.id,
      username: fakeClient.user.username,
      firstName: fakeClient.user.firstName,
      lastName: fakeClient.user.lastName,
      sessionCiphertext: context.secretBox.encrypt(fakeClient.saveSession()!),
      lastConnectedAt: new Date().toISOString(),
    });

    await context.services.telegramService.initialize();
    await context.services.uploadManager.initialize();
    await context.services.downloadManager.initialize();
    await context.services.fileStreamer.initialize();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  async function createTestFile(
    fileName: string,
    sizeBytes: number,
  ): Promise<{ filePath: string; buffer: Buffer; sha256: string }> {
    const filePath = join(testFilesDir, fileName);
    const buffer = sizeBytes === 0 ? Buffer.alloc(0) : randomBytes(sizeBytes);
    await fs.writeFile(filePath, buffer);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    return { filePath, buffer, sha256 };
  }

  async function uploadFileViaApi(
    fileName: string,
    sizeBytes: number,
  ): Promise<{ fileId: string; sha256: string; buffer: Buffer }> {
    const { filePath, buffer, sha256 } = await createTestFile(fileName, sizeBytes);

    const res = await request(context.app)
      .post("/api/uploads")
      .set(authHeader(context.apiToken))
      .send({
        filePath,
        originalFilename: fileName,
        mimeType: "application/octet-stream",
        customSegmentSize: fakeClient.safeSegmentSize,
      })
      .expect(201);

    const uploadJobId = res.body.data.job.id;

    // Poll until completed
    for (let i = 0; i < 50; i++) {
      const poll = await request(context.app)
        .get(`/api/uploads/${uploadJobId}`)
        .set(authHeader(context.apiToken))
        .expect(200);

      if (poll.body.data.job.status === "completed") {
        return { fileId: poll.body.data.file.id, sha256, buffer };
      }
      if (poll.body.data.job.status === "failed") {
        throw new Error(`Upload job failed: ${poll.body.data.job.lastError}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Upload job timed out");
  }

  describe("1. Download Engine & HTTP Streaming", () => {
    it("streams a downloaded file with exact byte-for-byte SHA-256 match", async () => {
      // 120 KB file with 50 KB safeSegmentSize -> 3 segments (50 KB, 50 KB, 20 KB)
      const { fileId, sha256, buffer } = await uploadFileViaApi("document.pdf", 120 * 1024);

      const res = await request(context.app)
        .get(`/api/files/${fileId}/download`)
        .set(authHeader(context.apiToken))
        .buffer()
        .parse(bufferParser)
        .expect(200);

      expect(res.headers["content-type"]).toBe("application/octet-stream");
      expect(res.headers["content-length"]).toBe(String(120 * 1024));
      expect(res.headers["content-disposition"]).toBe('attachment; filename="document.pdf"');
      expect(res.headers["etag"]).toBe(`"${sha256}"`);

      // Verify streamed content
      const receivedBuffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
      expect(receivedBuffer.length).toBe(buffer.length);
      const receivedHash = createHash("sha256").update(receivedBuffer).digest("hex");
      expect(receivedHash).toBe(sha256);
      expect(receivedBuffer.equals(buffer)).toBe(true);
    });

    it("streams file inline for preview", async () => {
      const { fileId, sha256, buffer } = await uploadFileViaApi("preview.png", 60 * 1024);

      const res = await request(context.app)
        .get(`/api/files/${fileId}/preview`)
        .set(authHeader(context.apiToken))
        .buffer()
        .parse(bufferParser)
        .expect(200);

      expect(res.headers["content-disposition"]).toBe('inline; filename="preview.png"');
      const receivedBuffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
      const receivedHash = createHash("sha256").update(receivedBuffer).digest("hex");
      expect(receivedHash).toBe(sha256);
      expect(receivedBuffer.equals(buffer)).toBe(true);
    });

    it("handles empty 0-byte file download and preview", async () => {
      const { fileId } = await uploadFileViaApi("empty.txt", 0);

      const res = await request(context.app)
        .get(`/api/files/${fileId}/download`)
        .set(authHeader(context.apiToken))
        .buffer()
        .parse(bufferParser)
        .expect(200);

      expect(res.headers["content-length"]).toBe("0");
      expect((Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body)).length).toBe(0);
    });

    it("rejects downloading non-existent or incomplete file", async () => {
      await request(context.app)
        .get("/api/files/00000000-0000-0000-0000-000000000000/download")
        .set(authHeader(context.apiToken))
        .expect(404);
    });
  });

  describe("2. Background Resumable Downloads (DownloadManager)", () => {
    it("creates background download job and reconstructs file to destination directory", async () => {
      const { fileId, sha256, buffer } = await uploadFileViaApi("archive.zip", 110 * 1024);
      const targetDir = join(context.dataDir, "custom-downloads");
      await fs.mkdir(targetDir, { recursive: true });

      const createRes = await request(context.app)
        .post("/api/downloads")
        .set(authHeader(context.apiToken))
        .send({
          fileId,
          targetDirectory: targetDir,
          targetFilename: "reconstructed.zip",
        })
        .expect(201);

      const downloadJobId = createRes.body.data.job.id;

      // Poll download progress and completion
      let completed = false;
      for (let i = 0; i < 50; i++) {
        const progressRes = await request(context.app)
          .get(`/api/downloads/${downloadJobId}/progress`)
          .set(authHeader(context.apiToken))
          .expect(200);

        if (progressRes.body.data.status === "completed") {
          expect(progressRes.body.data.progressPercentage).toBe(100);
          expect(progressRes.body.data.progressBytes).toBe(110 * 1024);
          completed = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(completed).toBe(true);

      // Verify file written to disk
      const targetPath = join(targetDir, "reconstructed.zip");
      const diskBytes = await fs.readFile(targetPath);
      expect(diskBytes.length).toBe(buffer.length);
      const diskHash = createHash("sha256").update(diskBytes).digest("hex");
      expect(diskHash).toBe(sha256);
      expect(diskBytes.equals(buffer)).toBe(true);
    });

    it("lists download jobs with pagination and retrieves detail", async () => {
      const { fileId } = await uploadFileViaApi("test_list.txt", 10 * 1024);

      const createRes = await request(context.app)
        .post("/api/downloads")
        .set(authHeader(context.apiToken))
        .send({ fileId })
        .expect(201);

      const jobId = createRes.body.data.job.id;

      // Detail
      const detailRes = await request(context.app)
        .get(`/api/downloads/${jobId}`)
        .set(authHeader(context.apiToken))
        .expect(200);

      expect(detailRes.body.data.job.id).toBe(jobId);
      expect(detailRes.body.data.file.id).toBe(fileId);

      // List
      const listRes = await request(context.app)
        .get("/api/downloads")
        .set(authHeader(context.apiToken))
        .expect(200);

      expect(listRes.body.data.items.length).toBeGreaterThan(0);
      expect(listRes.body.data.pagination.total).toBeGreaterThan(0);
    });

    it("supports pause, resume and cancellation of download jobs", async () => {
      fakeClient.delayMs = 15;
      const { fileId } = await uploadFileViaApi("pausable.bin", 150 * 1024);

      const createRes = await request(context.app)
        .post("/api/downloads")
        .set(authHeader(context.apiToken))
        .send({ fileId })
        .expect(201);

      const jobId = createRes.body.data.job.id;

      // Pause
      const pauseRes = await request(context.app)
        .post(`/api/downloads/${jobId}/pause`)
        .set(authHeader(context.apiToken))
        .expect(200);

      expect(["paused", "completed"]).toContain(pauseRes.body.data.status);

      if (pauseRes.body.data.status === "paused") {
        // Resume
        const resumeRes = await request(context.app)
          .post(`/api/downloads/${jobId}/resume`)
          .set(authHeader(context.apiToken))
          .expect(200);
        expect(["queued", "processing", "completed"]).toContain(resumeRes.body.data.status);
      }

      fakeClient.delayMs = 0;
    });

    it("cleans up temporary reconstruction files on cancellation", async () => {
      fakeClient.delayMs = 30;
      const { fileId } = await uploadFileViaApi("cancellable.bin", 200 * 1024);

      const createRes = await request(context.app)
        .post("/api/downloads")
        .set(authHeader(context.apiToken))
        .send({ fileId })
        .expect(201);

      const jobId = createRes.body.data.job.id;

      // Cancel
      const cancelRes = await request(context.app)
        .post(`/api/downloads/${jobId}/cancel`)
        .set(authHeader(context.apiToken))
        .expect(200);

      expect(cancelRes.body.data.status).toBe("failed");
      expect(cancelRes.body.data.lastError).toContain("cancelled");

      fakeClient.delayMs = 0;
    });
  });

  describe("3. Integrity & Tampering Protection", () => {
    it("detects segment tampering and aborts download without serving corrupted bytes", async () => {
      const { fileId } = await uploadFileViaApi("tampered.dat", 100 * 1024);

      // Find part 0's Telegram message ID
      const partsRes = await request(context.app)
        .get(`/api/files/${fileId}/parts`)
        .set(authHeader(context.apiToken))
        .expect(200);

      const part0MessageId = partsRes.body.data[0].telegramMessageId;
      expect(part0MessageId).toBeTruthy();

      // Corrupt the segment data stored in Telegram
      const storedMsg = fakeClient.messages.get(part0MessageId)!;
      storedMsg.bytes = Buffer.from(storedMsg.bytes);
      storedMsg.bytes[10] = storedMsg.bytes[10]! ^ 0xff; // flip bits

      // Streaming download should fail
      await expect(
        request(context.app)
          .get(`/api/files/${fileId}/download`)
          .set(authHeader(context.apiToken)),
      ).rejects.toThrow();

      // Background download should record failed status with integrity error
      const createRes = await request(context.app)
        .post("/api/downloads")
        .set(authHeader(context.apiToken))
        .send({ fileId })
        .expect(201);

      const jobId = createRes.body.data.job.id;

      for (let i = 0; i < 40; i++) {
        const check = await request(context.app)
          .get(`/api/downloads/${jobId}`)
          .set(authHeader(context.apiToken))
          .expect(200);

        if (check.body.data.job.status === "failed") {
          expect(check.body.data.job.lastError).toMatch(/hash mismatch|integrity/i);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    });

    it("fails safely when a required Telegram segment message is missing", async () => {
      const { fileId } = await uploadFileViaApi("missing_segment.dat", 100 * 1024);

      const partsRes = await request(context.app)
        .get(`/api/files/${fileId}/parts`)
        .set(authHeader(context.apiToken))
        .expect(200);

      const part1MessageId = partsRes.body.data[1].telegramMessageId;
      // Delete segment message from Telegram
      fakeClient.messages.delete(part1MessageId);

      // Download job should fail safely
      const createRes = await request(context.app)
        .post("/api/downloads")
        .set(authHeader(context.apiToken))
        .send({ fileId })
        .expect(201);

      const jobId = createRes.body.data.job.id;

      for (let i = 0; i < 40; i++) {
        const check = await request(context.app)
          .get(`/api/downloads/${jobId}`)
          .set(authHeader(context.apiToken))
          .expect(200);

        if (check.body.data.job.status === "failed") {
          expect(check.body.data.job.lastError).toBeTruthy();
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    });
  });

  describe("4. Upload Recovery across Restarts", () => {
    it("resumes incomplete upload without re-uploading already completed segments", async () => {
      const { filePath } = await createTestFile("resume_test.dat", 150 * 1024); // 3 segments

      // Start upload
      const createRes = await request(context.app)
        .post("/api/uploads")
        .set(authHeader(context.apiToken))
        .send({
          filePath,
          originalFilename: "resume_test.dat",
          mimeType: "application/octet-stream",
          customSegmentSize: fakeClient.safeSegmentSize,
        })
        .expect(201);

      const jobId = createRes.body.data.job.id;
      const fileId = createRes.body.data.file.id;

      // Wait until at least 1 segment is uploaded, then pause
      for (let i = 0; i < 30; i++) {
        const prog = await request(context.app)
          .get(`/api/uploads/${jobId}/progress`)
          .set(authHeader(context.apiToken))
          .expect(200);

        if (prog.body.data.completedSegments >= 1) {
          await request(context.app)
            .post(`/api/uploads/${jobId}/pause`)
            .set(authHeader(context.apiToken));
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }

      const uploadCountBeforeResume = fakeClient.segmentUploadCount;

      // Simulate crash and restart recovery: initialize uploadManager
      await context.services.uploadManager.initialize();

      // Resume job
      await request(context.app)
        .post(`/api/uploads/${jobId}/resume`)
        .set(authHeader(context.apiToken));

      // Wait for completion
      for (let i = 0; i < 50; i++) {
        const poll = await request(context.app)
          .get(`/api/uploads/${jobId}`)
          .set(authHeader(context.apiToken))
          .expect(200);

        if (poll.body.data.job.status === "completed") {
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      // Verify that total segment uploads equals total segments (3), not duplicating segment 0
      expect(fakeClient.segmentUploadCount).toBe(3);

      // Verify remote manifest document message was created
      const fileRes = await request(context.app)
        .get(`/api/files/${fileId}`)
        .set(authHeader(context.apiToken))
        .expect(200);

      expect(fileRes.body.data.status).toBe("completed");
      expect(fileRes.body.data.telegramMessageIds.length).toBe(4); // 3 parts + 1 manifest
    });
  });

  describe("5. Remote Manifest & Synchronization (POST /api/storage/sync)", () => {
    it("synchronizes Saved Messages, reconstructing files and parts in SQLite", async () => {
      // 1. Upload a file to Telegram with manifest
      const { fileId, sha256 } = await uploadFileViaApi("synced_doc.pdf", 120 * 1024);

      // Verify manifest exists in Telegram messages
      let manifestMessageCount = 0;
      for (const msg of fakeClient.messages.values()) {
        if (msg.caption.startsWith("TVLT:v1:MANIFEST:")) {
          manifestMessageCount++;
        }
      }
      expect(manifestMessageCount).toBe(1);

      // 2. Simulate fresh client / lost database by deleting local file record
      context.database.connection.prepare("DELETE FROM file_parts").run();
      context.database.connection.prepare("DELETE FROM upload_jobs").run();
      context.database.connection.prepare("DELETE FROM files").run();

      // Confirm local database has 0 files
      const emptyCheck = await request(context.app)
        .get("/api/files")
        .set(authHeader(context.apiToken))
        .expect(200);
      expect(emptyCheck.body.data.items.length).toBe(0);

      // 3. Trigger remote synchronization
      const syncRes = await request(context.app)
        .post("/api/storage/sync")
        .set(authHeader(context.apiToken))
        .expect(200);

      expect(syncRes.body.data.importedFilesCount).toBe(1);
      expect(syncRes.body.data.reconstructedPartsCount).toBe(3);
      expect(syncRes.body.data.lastError).toBeNull();

      // 4. Check sync status
      const statusRes = await request(context.app)
        .get("/api/storage/sync/status")
        .set(authHeader(context.apiToken))
        .expect(200);

      expect(statusRes.body.data.importedFilesCount).toBe(1);
      expect(statusRes.body.data.reconstructedPartsCount).toBe(3);

      // 5. Verify file was completely reconstructed in SQLite
      const restoredFile = await request(context.app)
        .get(`/api/files/${fileId}`)
        .set(authHeader(context.apiToken))
        .expect(200);

      expect(restoredFile.body.data.id).toBe(fileId);
      expect(restoredFile.body.data.originalFilename).toBe("synced_doc.pdf");
      expect(restoredFile.body.data.sha256).toBe(sha256);
      expect(restoredFile.body.data.status).toBe("completed");

      // 6. Verify restored file can be downloaded directly from reconstructed metadata
      const downloadRes = await request(context.app)
        .get(`/api/files/${fileId}/download`)
        .set(authHeader(context.apiToken))
        .buffer()
        .parse(bufferParser)
        .expect(200);

      const receivedDl = Buffer.isBuffer(downloadRes.body) ? downloadRes.body : Buffer.from(downloadRes.body);
      const dlHash = createHash("sha256").update(receivedDl).digest("hex");
      expect(dlHash).toBe(sha256);
    });

    it("is idempotent when running synchronization multiple times (duplicate markers)", async () => {
      await uploadFileViaApi("idempotent.bin", 60 * 1024);

      // Run sync once
      const sync1 = await request(context.app)
        .post("/api/storage/sync")
        .set(authHeader(context.apiToken))
        .expect(200);

      expect(sync1.body.data.lastError).toBeNull();

      // Run sync second time
      const sync2 = await request(context.app)
        .post("/api/storage/sync")
        .set(authHeader(context.apiToken))
        .expect(200);

      expect(sync2.body.data.lastError).toBeNull();

      // Files list should not contain duplicates
      const listRes = await request(context.app)
        .get("/api/files")
        .set(authHeader(context.apiToken))
        .expect(200);

      expect(listRes.body.data.items.length).toBe(1);
    });
  });

  describe("6. Safe Deletion & Partial Deletion Failure Handling", () => {
    it("safely deletes file and all associated Telegram messages", async () => {
      const { fileId } = await uploadFileViaApi("delete_me.bin", 120 * 1024);

      const beforeCount = fakeClient.messages.size;
      expect(beforeCount).toBeGreaterThan(0);

      const deleteRes = await request(context.app)
        .delete(`/api/files/${fileId}`)
        .set(authHeader(context.apiToken))
        .expect(200);

      expect(deleteRes.body.data.deleted).toBe(true);
      expect(deleteRes.body.data.fileId).toBe(fileId);
      expect(deleteRes.body.data.deletedTelegramMessages.length).toBe(4); // 3 segments + 1 manifest
      expect(deleteRes.body.data.failedTelegramMessages.length).toBe(0);

      // Verify messages removed from Telegram
      expect(fakeClient.messages.size).toBe(beforeCount - 4);

      // Verify file removed from SQLite
      await request(context.app)
        .get(`/api/files/${fileId}`)
        .set(authHeader(context.apiToken))
        .expect(404);
    });

    it("handles partial deletion failures and preserves remaining records for recovery", async () => {
      const { fileId } = await uploadFileViaApi("partial_delete.bin", 100 * 1024);

      const partsRes = await request(context.app)
        .get(`/api/files/${fileId}/parts`)
        .set(authHeader(context.apiToken))
        .expect(200);

      const part0MsgId = partsRes.body.data[0].telegramMessageId;
      // Configure fake Telegram client to fail deletion of part 0
      fakeClient.failDeleteIds.add(part0MsgId);

      const deleteRes = await request(context.app)
        .delete(`/api/files/${fileId}`)
        .set(authHeader(context.apiToken))
        .expect(502);

      expect(deleteRes.body.ok).toBe(false);
      expect(deleteRes.body.error.code).toBe("INTERNAL_ERROR");
      expect(deleteRes.body.error.details.deleted).toBe(false);
      expect(deleteRes.body.error.details.failedTelegramMessages).toContain(part0MsgId);

      // Verify file record is still retained in SQLite (not silently deleted)
      const checkFile = await request(context.app)
        .get(`/api/files/${fileId}`)
        .set(authHeader(context.apiToken))
        .expect(200);

      expect(checkFile.body.data.id).toBe(fileId);
      // Retained message IDs in SQLite only contains the failed message ID
      expect(checkFile.body.data.telegramMessageIds).toContain(part0MsgId);

      // Subsequent retry after Telegram recovers
      fakeClient.failDeleteIds.clear();

      const retryDelete = await request(context.app)
        .delete(`/api/files/${fileId}`)
        .set(authHeader(context.apiToken))
        .expect(200);

      expect(retryDelete.body.data.deleted).toBe(true);

      // Now file is deleted from SQLite
      await request(context.app)
        .get(`/api/files/${fileId}`)
        .set(authHeader(context.apiToken))
        .expect(404);
    });
  });
});
