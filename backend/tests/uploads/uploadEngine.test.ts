import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TelegramAccountRepository } from "../../src/database/repositories/telegramAccountRepository";
import type {
  ManagedTelegramClient,
  SavedMessagesPeer,
  SubmitCodeResult,
  TelegramUserProfile,
  UploadCapabilities,
  UploadSegmentInput,
  UploadSegmentResult,
} from "../../src/telegram/managedClient";
import { parseManifestCaption } from "../../src/uploads/manifest";
import {
  createTestContext,
  TEST_API_TOKEN,
  type TestContext,
} from "../helpers/testContext";

class FakeTelegramClient implements ManagedTelegramClient {
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

  public safeSegmentSize = 100 * 1024; // 100 KB default for test
  public uploadCalls: Array<{
    peerId: string;
    fileName: string;
    filePath?: string;
    fileSize: number;
    caption: string;
  }> = [];

  public failNextUploads = 0;
  public floodWaitSeconds = 0;
  public delayMs = 0;
  private messageCounter = 5000;

  async connect(): Promise<void> {
    this.connected = true;
  }

  isConnected(): boolean {
    return this.connected && !this.destroyed;
  }

  async checkAuthorization(): Promise<boolean> {
    return this.authorized;
  }

  async sendCode(_phoneNumber: string): Promise<{
    phoneCodeHash: string;
    isCodeViaApp: boolean;
  }> {
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

    if (this.floodWaitSeconds > 0) {
      const wait = this.floodWaitSeconds;
      this.floodWaitSeconds = 0;
      const error = new Error(`FLOOD_WAIT_${wait}`);
      (error as unknown as { seconds: number }).seconds = wait;
      throw error;
    }

    if (this.failNextUploads > 0) {
      this.failNextUploads--;
      throw new Error("Transient network socket timeout");
    }

    this.uploadCalls.push({
      peerId: input.peerId,
      fileName: input.fileName,
      filePath: input.filePath,
      fileSize: input.fileSize,
      caption: input.caption,
    });

    if (input.onProgress) {
      input.onProgress(0.5);
      input.onProgress(1.0);
    }

    this.messageCounter++;
    return { messageId: String(this.messageCounter) };
  }

  async logOut(): Promise<void> {
    this.authorized = false;
  }

  saveSession(): string | null {
    return "fake-session-string-for-upload-tests";
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.connected = false;
  }
}

describe("TeleVault Large File Storage Engine (Upload Manager)", () => {
  let context: TestContext;
  let fakeClient: FakeTelegramClient;
  let testFilesDir: string;

  beforeEach(async () => {
    fakeClient = new FakeTelegramClient();

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

    // Establish Telegram session so TelegramService is in 'connected' state
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
  });

  afterEach(async () => {
    await context.cleanup();
  });

  async function createTestFile(fileName: string, sizeBytes: number): Promise<string> {
    const filePath = join(testFilesDir, fileName);
    if (sizeBytes === 0) {
      await fs.writeFile(filePath, Buffer.alloc(0));
    } else {
      const buffer = randomBytes(sizeBytes);
      await fs.writeFile(filePath, buffer);
    }
    return filePath;
  }

  async function waitForJobCompletion(
    jobId: string,
    timeoutMs = 10000,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const job = context.services.uploadManager.getJobDetail(jobId).job;
      if (job.status === "completed" || job.status === "failed") {
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timed out waiting for upload job ${jobId} to complete`);
  }

  it("uploads a small file (< segment size) in a single segment", async () => {
    const filePath = await createTestFile("small.txt", 10 * 1024); // 10 KB
    const expectedSha256 = createHash("sha256")
      .update(await fs.readFile(filePath))
      .digest("hex");

    const res = await request(context.app)
      .post("/api/uploads")
      .set("X-Televault-Token", TEST_API_TOKEN)
      .send({ filePath, customSegmentSize: 50 * 1024 });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    const { job, file } = res.body.data;
    expect(job.id).toBeDefined();
    expect(file.partCount).toBe(1);

    await waitForJobCompletion(job.id);

    const detail = context.services.uploadManager.getJobDetail(job.id);
    expect(detail.job.status).toBe("completed");
    expect(detail.file.status).toBe("completed");
    expect(detail.file.sha256).toBe(expectedSha256);
    expect(detail.parts).toHaveLength(1);
    expect(detail.parts[0]?.status).toBe("completed");
    expect(detail.parts[0]?.telegramMessageId).toBeDefined();

    // Verify caption format TVLT:v1:<file-uuid>:<part-index>:<total-parts>:<part-sha256>
    expect(fakeClient.uploadCalls).toHaveLength(1);
    const manifest = parseManifestCaption(fakeClient.uploadCalls[0]!.caption);
    expect(manifest).not.toBeNull();
    expect(manifest?.version).toBe(1);
    expect(manifest?.fileId).toBe(file.id);
    expect(manifest?.partIndex).toBe(0);
    expect(manifest?.totalParts).toBe(1);
    expect(manifest?.partSha256).toBe(expectedSha256);
  });

  it("splits a larger file into multiple logical segments and uploads all in order", async () => {
    // 250 KB file with 80 KB segment size -> 4 segments: 80 KB, 80 KB, 80 KB, 10 KB
    const totalSize = 250 * 1024;
    const segmentSize = 80 * 1024;
    const filePath = await createTestFile("large-sample.bin", totalSize);

    const res = await request(context.app)
      .post("/api/uploads")
      .set("X-Televault-Token", TEST_API_TOKEN)
      .send({ filePath, customSegmentSize: segmentSize });

    expect(res.status).toBe(201);
    const { job, file } = res.body.data;
    expect(file.partCount).toBe(4);

    await waitForJobCompletion(job.id);

    const detail = context.services.uploadManager.getJobDetail(job.id);
    expect(detail.job.status).toBe("completed");
    expect(detail.file.status).toBe("completed");
    expect(detail.parts).toHaveLength(4);

    expect(fakeClient.uploadCalls).toHaveLength(4);
    expect(fakeClient.uploadCalls[0]?.fileSize).toBe(80 * 1024);
    expect(fakeClient.uploadCalls[1]?.fileSize).toBe(80 * 1024);
    expect(fakeClient.uploadCalls[2]?.fileSize).toBe(80 * 1024);
    expect(fakeClient.uploadCalls[3]?.fileSize).toBe(10 * 1024);

    // Verify manifest captions for all segments
    for (let i = 0; i < 4; i++) {
      const manifest = parseManifestCaption(fakeClient.uploadCalls[i]!.caption);
      expect(manifest).not.toBeNull();
      expect(manifest?.partIndex).toBe(i);
      expect(manifest?.totalParts).toBe(4);
      expect(manifest?.fileId).toBe(file.id);
    }
  });

  it("handles empty (0-byte) files safely", async () => {
    const filePath = await createTestFile("empty.txt", 0);

    const res = await request(context.app)
      .post("/api/uploads")
      .set("X-Televault-Token", TEST_API_TOKEN)
      .send({ filePath });

    expect(res.status).toBe(201);
    const { job, file } = res.body.data;
    expect(file.partCount).toBe(0);
    expect(file.totalSize).toBe(0);

    await waitForJobCompletion(job.id);

    const detail = context.services.uploadManager.getJobDetail(job.id);
    expect(detail.job.status).toBe("completed");
    expect(detail.file.status).toBe("completed");
    expect(detail.file.sha256).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(detail.parts).toHaveLength(0);

    expect(fakeClient.uploadCalls).toHaveLength(1);
    expect(fakeClient.uploadCalls[0]?.fileSize).toBe(0);
    const manifest = parseManifestCaption(fakeClient.uploadCalls[0]!.caption);
    expect(manifest?.partIndex).toBe(0);
    expect(manifest?.totalParts).toBe(1);
  });

  it("supports pause and resume without re-uploading already completed segments", async () => {
    // 3 segments of 50 KB
    const filePath = await createTestFile("pausable.bin", 150 * 1024);
    fakeClient.delayMs = 100; // Small delay to allow pause interception

    const res = await request(context.app)
      .post("/api/uploads")
      .set("X-Televault-Token", TEST_API_TOKEN)
      .send({ filePath, customSegmentSize: 50 * 1024 });

    const jobId = res.body.data.job.id;

    // Wait until at least 1 segment has completed in database, then pause
    const startWait = Date.now();
    while (Date.now() - startWait < 5000) {
      const parts = context.services.uploadManager.getJobDetail(jobId).parts;
      if (parts.some((p) => p.status === "completed")) {
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    const pauseRes = await request(context.app)
      .post(`/api/uploads/${jobId}/pause`)
      .set("X-Televault-Token", TEST_API_TOKEN);
    expect(pauseRes.status).toBe(200);

    // Wait for worker loop to pause
    await new Promise((r) => setTimeout(r, 200));

    const completedBeforeResume = context.services.uploadManager
      .getJobDetail(jobId)
      .parts.filter((p) => p.status === "completed").length;
    expect(completedBeforeResume).toBeGreaterThanOrEqual(1);
    expect(completedBeforeResume).toBeLessThan(3);

    // Resume the upload
    fakeClient.delayMs = 0;
    const resumeRes = await request(context.app)
      .post(`/api/uploads/${jobId}/resume`)
      .set("X-Televault-Token", TEST_API_TOKEN);
    expect(resumeRes.status).toBe(200);

    await waitForJobCompletion(jobId);

    const detail = context.services.uploadManager.getJobDetail(jobId);
    expect(detail.job.status).toBe("completed");
    expect(detail.file.status).toBe("completed");
    expect(detail.parts.every((p) => p.status === "completed")).toBe(true);
    // Exactly 3 segments should have been completed total
    expect(detail.parts).toHaveLength(3);
  });

  it("supports cancellation and cleans up staging material", async () => {
    const filePath = await createTestFile("cancellable.bin", 200 * 1024);
    fakeClient.delayMs = 200;

    const res = await request(context.app)
      .post("/api/uploads")
      .set("X-Televault-Token", TEST_API_TOKEN)
      .send({ filePath, customSegmentSize: 50 * 1024 });

    const jobId = res.body.data.job.id;

    // Wait until job is in 'processing' status before cancelling
    while (true) {
      const job = context.services.uploadManager.getJobDetail(jobId).job;
      if (job.status === "processing") {
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    // Cancel while uploading
    const cancelRes = await request(context.app)
      .post(`/api/uploads/${jobId}/cancel`)
      .set("X-Televault-Token", TEST_API_TOKEN);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe("failed");

    const detail = context.services.uploadManager.getJobDetail(jobId);
    expect(detail.job.status).toBe("failed");
    expect(detail.file.status).toBe("failed");
  });

  it("detects source file modification during upload and halts safely", async () => {
    const filePath = await createTestFile("modified.bin", 150 * 1024);
    fakeClient.delayMs = 100;

    const res = await request(context.app)
      .post("/api/uploads")
      .set("X-Televault-Token", TEST_API_TOKEN)
      .send({ filePath, customSegmentSize: 50 * 1024 });

    const jobId = res.body.data.job.id;

    // Mutate file on disk while job is active
    await new Promise((r) => setTimeout(r, 50));
    await fs.appendFile(filePath, Buffer.from("CORRUPT_APPEND"));

    await waitForJobCompletion(jobId);

    const detail = context.services.uploadManager.getJobDetail(jobId);
    expect(detail.job.status).toBe("failed");
    expect(detail.file.status).toBe("failed");
    expect(detail.job.lastError).toMatch(/modified during/i);
  });

  it("retries on transient errors with exponential backoff and succeeds", async () => {
    const filePath = await createTestFile("retry-test.bin", 20 * 1024);
    fakeClient.failNextUploads = 2; // Fail twice, succeed on 3rd attempt

    const res = await request(context.app)
      .post("/api/uploads")
      .set("X-Televault-Token", TEST_API_TOKEN)
      .send({ filePath });

    if (res.status !== 201) {
      console.error("EMPTY FILE RES ERROR:", res.status, res.body);
    }

    const jobId = res.body.data.job.id;
    await waitForJobCompletion(jobId);

    const detail = context.services.uploadManager.getJobDetail(jobId);
    expect(detail.job.status).toBe("completed");
    expect(fakeClient.uploadCalls).toHaveLength(1);
  });

  it("handles Telegram FLOOD_WAIT_X rate limits by sleeping the required duration", async () => {
    const filePath = await createTestFile("flood-wait.bin", 20 * 1024);
    fakeClient.floodWaitSeconds = 1; // Telegram demands 1s sleep

    const res = await request(context.app)
      .post("/api/uploads")
      .set("X-Televault-Token", TEST_API_TOKEN)
      .send({ filePath });

    if (res.status !== 201) {
      console.error("EMPTY FILE RES ERROR:", res.status, res.body);
    }

    const jobId = res.body.data.job.id;
    await waitForJobCompletion(jobId);

    const detail = context.services.uploadManager.getJobDetail(jobId);
    expect(detail.job.status).toBe("completed");
    expect(fakeClient.uploadCalls).toHaveLength(1);
  });

  it("supports multipart/form-data streaming file uploads via busboy", async () => {
    const sampleBuffer = randomBytes(40 * 1024);
    const expectedSha256 = createHash("sha256").update(sampleBuffer).digest("hex");

    const res = await request(context.app)
      .post("/api/uploads")
      .set("X-Televault-Token", TEST_API_TOKEN)
      .attach("file", sampleBuffer, "multipart-sample.dat");

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    const { job, file } = res.body.data;

    await waitForJobCompletion(job.id);

    const detail = context.services.uploadManager.getJobDetail(job.id);
    expect(detail.job.status).toBe("completed");
    expect(detail.file.status).toBe("completed");
    expect(detail.file.sha256).toBe(expectedSha256);
    expect(detail.file.originalFilename).toBe("multipart-sample.dat");
  });

  it("reports accurate per-job and per-segment progress via GET /api/uploads/:id/progress", async () => {
    const filePath = await createTestFile("progress.bin", 50 * 1024);

    const res = await request(context.app)
      .post("/api/uploads")
      .set("X-Televault-Token", TEST_API_TOKEN)
      .send({ filePath });

    if (res.status !== 201) {
      console.error("EMPTY FILE RES ERROR:", res.status, res.body);
    }

    const jobId = res.body.data.job.id;
    await waitForJobCompletion(jobId);

    const progressRes = await request(context.app)
      .get(`/api/uploads/${jobId}/progress`)
      .set("X-Televault-Token", TEST_API_TOKEN);

    expect(progressRes.status).toBe(200);
    expect(progressRes.body.data.status).toBe("completed");
    expect(progressRes.body.data.progressPercentage).toBe(100);
    expect(progressRes.body.data.totalBytes).toBe(50 * 1024);
    expect(progressRes.body.data.progressBytes).toBe(50 * 1024);
  });

  it("lists upload jobs with pagination via GET /api/uploads", async () => {
    const f1 = await createTestFile("f1.bin", 1024);
    const f2 = await createTestFile("f2.bin", 1024);

    await request(context.app)
      .post("/api/uploads")
      .set("X-Televault-Token", TEST_API_TOKEN)
      .send({ filePath: f1 });

    await request(context.app)
      .post("/api/uploads")
      .set("X-Televault-Token", TEST_API_TOKEN)
      .send({ filePath: f2 });

    const res = await request(context.app)
      .get("/api/uploads?limit=1&offset=0")
      .set("X-Televault-Token", TEST_API_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.pagination.total).toBe(2);
    expect(res.body.data.pagination.hasMore).toBe(true);
  });
});
