import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createTestContext, type TestContext } from "../helpers/testContext";

describe("HTTP API", () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  function authed(method: "get" | "post", path: string) {
    return request(context.app)[method](path).set(
      "X-Televault-Token",
      context.apiToken,
    );
  }

  describe("health", () => {
    it("is public, structured, and reports the real database state", async () => {
      const response = await request(context.app).get("/api/health");

      expect(response.status).toBe(200);
      expect(response.headers["x-request-id"]).toMatch(
        /^[0-9a-f-]{36}$/,
      );
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toMatchObject({
        ok: true,
        data: {
          status: "ok",
          version: "0.1.0",
          database: { status: "ok", schemaVersion: 3 },
        },
      });
      expect(response.body.data.database.fileSizeBytes).toBeGreaterThan(0);
      expect(response.body.data.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe("local API authentication", () => {
    it("requires the API token on all non-health routes", async () => {
      const missing = await request(context.app).get("/api/app/profile");
      expect(missing.status).toBe(401);
      expect(missing.body.ok).toBe(false);
      expect(missing.body.error.code).toBe("UNAUTHORIZED");
      expect(missing.body.requestId).toBeTruthy();

      const wrong = await request(context.app)
        .get("/api/app/profile")
        .set("X-Televault-Token", "wrong-token-that-is-long-enough");
      expect(wrong.status).toBe(401);
    });

    it("rejects unknown routes and malformed JSON consistently", async () => {
      const notFound = await authed("get", "/api/does-not-exist");
      expect(notFound.status).toBe(404);
      expect(notFound.body.error.code).toBe("NOT_FOUND");

      const malformed = await request(context.app)
        .post("/api/app/profile")
        .set("X-Televault-Token", context.apiToken)
        .set("Content-Type", "application/json")
        .send('{"displayName":');
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("app profile", () => {
    it("returns null before a profile exists, then creates and updates it", async () => {
      const empty = await authed("get", "/api/app/profile");
      expect(empty.status).toBe(200);
      expect(empty.body.data).toBeNull();

      const created = await authed("post", "/api/app/profile").send({
        displayName: "Daksh",
      });
      expect(created.status).toBe(201);
      expect(created.body.data.displayName).toBe("Daksh");
      expect(created.body.data.id).toBeTruthy();

      const updated = await authed("post", "/api/app/profile").send({
        displayName: "TeleVault Owner",
      });
      expect(updated.status).toBe(200);
      expect(updated.body.data.id).toBe(created.body.data.id);

      const fetched = await authed("get", "/api/app/profile");
      expect(fetched.body.data.displayName).toBe("TeleVault Owner");
    });

    it("validates profile input", async () => {
      const empty = await authed("post", "/api/app/profile").send({
        displayName: "   ",
      });
      expect(empty.status).toBe(400);
      expect(empty.body.error.code).toBe("VALIDATION_ERROR");
      expect(Array.isArray(empty.body.error.details)).toBe(true);

      const control = await authed("post", "/api/app/profile").send({
        displayName: "bad\u0000name",
      });
      expect(control.status).toBe(400);
    });
  });

  describe("files, folders, and storage stats", () => {
    it("serves real database records with consistent pagination", async () => {
      const folder = context.services.folderService.createFolder({
        name: "Documents",
      });
      context.services.fileService.createFile({
        folderId: folder.id,
        originalFilename: "contract.pdf",
        mimeType: "application/pdf",
        totalSize: 1234,
      });

      const folders = await authed("get", "/api/folders");
      expect(folders.status).toBe(200);
      expect(folders.body.data.items).toHaveLength(1);
      expect(folders.body.data.items[0]).toMatchObject({
        name: "Documents",
        fileCount: 1,
      });

      const files = await authed("get", "/api/files");
      expect(files.status).toBe(200);
      expect(files.body.data.items[0]).toMatchObject({
        originalFilename: "contract.pdf",
        totalSize: 1234,
      });
      expect(files.body.data.pagination).toEqual({
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
      });

      const filtered = await authed(
        "get",
        `/api/files?folderId=${folder.id}&status=queued&limit=1`,
      );
      expect(filtered.status).toBe(200);
      expect(filtered.body.data.items).toHaveLength(1);

      const stats = await authed("get", "/api/storage/stats");
      expect(stats.status).toBe(200);
      expect(stats.body.data).toMatchObject({
        totalFiles: 1,
        totalBytes: 1234,
        totalParts: 0,
        completedFiles: 0,
        failedFiles: 0,
        filesByStatus: {
          queued: 1,
          processing: 0,
          paused: 0,
          failed: 0,
          completed: 0,
        },
      });
      expect(stats.body.data.databaseBytes).toBeGreaterThan(0);
      expect(stats.body.data.dataDirectoryBytes).toBeGreaterThan(0);
    });

    it("rejects invalid query parameters", async () => {
      const badLimit = await authed("get", "/api/files?limit=0");
      expect(badLimit.status).toBe(400);

      const badStatus = await authed("get", "/api/files?status=nope");
      expect(badStatus.status).toBe(400);

      const badFolder = await authed("get", "/api/files?folderId=not-a-uuid");
      expect(badFolder.status).toBe(400);
    });
  });

  describe("telegram status", () => {
    it("reports an unconfigured integration without leaking secrets", async () => {
      const response = await authed("get", "/api/telegram/status");
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({
        configured: false,
        state: "unconfigured",
        sessionStored: false,
        account: null,
        lastConnectedAt: null,
        lastError: null,
      });

      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain("sessionCiphertext");
      expect(serialized).not.toContain("apiHash");
      expect(serialized).not.toContain("phoneNumber");
    });

    it("returns a real 503 instead of faking a Telegram connection", async () => {
      const response = await authed("post", "/api/telegram/auth/start").send({
        phoneNumber: "+15551234567",
      });
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("SERVICE_UNAVAILABLE");
    });

    it("validates the phone number before touching Telegram", async () => {
      const response = await authed("post", "/api/telegram/auth/start").send({
        phoneNumber: "555-1234",
      });
      expect(response.status).toBe(400);
    });
  });

  describe("security middleware", () => {
    it("allows local browser origins and rejects foreign origins", async () => {
      const allowed = await request(context.app)
        .get("/api/health")
        .set("Origin", "http://localhost:5173");
      expect(allowed.status).toBe(200);
      expect(allowed.headers["access-control-allow-origin"]).toBe(
        "http://localhost:5173",
      );

      const preflight = await request(context.app)
        .options("/api/files")
        .set("Origin", "http://127.0.0.1:5173")
        .set("Access-Control-Request-Method", "GET")
        .set("Access-Control-Request-Headers", "x-televault-token");
      expect(preflight.status).toBe(204);

      const denied = await request(context.app)
        .get("/api/health")
        .set("Origin", "https://evil.example");
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe("FORBIDDEN");
    });

    it("rejects non-loopback Host headers (DNS rebinding defense)", async () => {
      const response = await request(context.app)
        .get("/api/health")
        .set("Host", "evil.example");
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    });
  });
});
