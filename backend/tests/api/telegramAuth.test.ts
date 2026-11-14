import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type {
  ManagedTelegramClient,
  SavedMessagesPeer,
  SubmitCodeResult,
  TelegramUserProfile,
} from "../../src/telegram/managedClient";
import {
  createTestContext,
  type TestContext,
} from "../helpers/testContext";

class MockTelegramClient implements ManagedTelegramClient {
  public connected = false;
  public authorized = false;
  public destroyed = false;
  public loggedOut = false;
  public sessionString = "mock-gramjs-string-session-abcdef123456";
  public user: TelegramUserProfile = {
    id: "999888777",
    username: "televault_user",
    firstName: "Tele",
    lastName: "Vault",
    phone: "+15551234567",
  };
  public requires2FA = false;
  public validCode = "12345";
  public validPassword = "correct-2fa-password";
  public failAuthorization = false;
  public failConnect = false;

  constructor(public readonly initialSession: string = "") {
    if (initialSession.length > 0) {
      this.authorized = true;
    }
  }

  async connect(): Promise<void> {
    if (this.failConnect) {
      throw new Error("Connection failed");
    }
    this.connected = true;
  }

  isConnected(): boolean {
    return this.connected && !this.destroyed;
  }

  async checkAuthorization(): Promise<boolean> {
    if (this.failAuthorization) {
      return false;
    }
    return this.authorized;
  }

  async sendCode(_phoneNumber: string): Promise<{
    phoneCodeHash: string;
    isCodeViaApp: boolean;
  }> {
    return { phoneCodeHash: "mock-code-hash-xyz", isCodeViaApp: true };
  }

  async submitCode(input: {
    phoneNumber: string;
    phoneCodeHash: string;
    phoneCode: string;
  }): Promise<SubmitCodeResult> {
    if (input.phoneCode !== this.validCode) {
      const err = new Error("PHONE_CODE_INVALID");
      (err as unknown as { errorMessage: string }).errorMessage =
        "PHONE_CODE_INVALID";
      throw err;
    }
    if (this.requires2FA) {
      return { requiresPassword: true };
    }
    this.authorized = true;
    return {
      requiresPassword: false,
      user: this.user,
    };
  }

  async submitPassword(password: string): Promise<TelegramUserProfile> {
    if (password !== this.validPassword) {
      const err = new Error("PASSWORD_HASH_INVALID");
      (err as unknown as { errorMessage: string }).errorMessage =
        "PASSWORD_HASH_INVALID";
      throw err;
    }
    this.authorized = true;
    return this.user;
  }

  async getMe(): Promise<TelegramUserProfile> {
    return this.user;
  }

  async resolveSavedMessages(selfUserId: string): Promise<SavedMessagesPeer> {
    return { destination: "saved_messages", peerId: selfUserId };
  }

  async getUploadCapabilities() {
    return {
      uploadMaxFileparts: 4000,
      partSize: 512 * 1024,
      maxSingleFileSize: 4000 * 512 * 1024,
      safeSegmentSize: 4000 * 512 * 1024 - 50 * 1024 * 1024,
      isPremium: false,
    };
  }

  async uploadSegment(_input: unknown) {
    return { messageId: "12345" };
  }

  async logOut(): Promise<void> {
    this.loggedOut = true;
    this.authorized = false;
  }

  saveSession(): string | null {
    return this.sessionString;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.connected = false;
  }
}

describe("Telegram MTProto Authentication & Service", () => {
  let context: TestContext;
  let mockClient: MockTelegramClient;
  let clientFactoryCalls: string[] = [];
  let requires2FA = false;

  beforeEach(async () => {
    clientFactoryCalls = [];
    requires2FA = false;
    mockClient = new MockTelegramClient();

    context = await createTestContext(
      {
        TELEGRAM_API_ID: "123456",
        TELEGRAM_API_HASH: "0123456789abcdef0123456789abcdef",
      },
      {
        telegramClientFactory: (session: string) => {
          clientFactoryCalls.push(session);
          mockClient = new MockTelegramClient(session);
          mockClient.requires2FA = requires2FA;
          return mockClient;
        },
      },
    );
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

  describe("Initial connection state", () => {
    it("reports disconnected when configured but no session is stored", async () => {
      const response = await authed("get", "/api/telegram/status");
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({
        configured: true,
        state: "disconnected",
        sessionStored: false,
        account: null,
        lastConnectedAt: null,
        lastError: null,
      });
    });

    it("rejects profile request when not connected", async () => {
      const response = await authed("get", "/api/telegram/profile");
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("Single-factor authentication flow", () => {
    it("completes full auth via start -> verify, persists session securely, resolves Saved Messages", async () => {
      // 1. Start auth
      const startRes = await authed("post", "/api/telegram/auth/start").send({
        phoneNumber: "+15551234567",
      });
      expect(startRes.status).toBe(200);
      expect(startRes.body.data).toEqual({ isCodeViaApp: true });

      // Check status during awaiting_code
      const awaitingStatus = await authed("get", "/api/telegram/status");
      expect(awaitingStatus.body.data.state).toBe("awaiting_code");

      // 2. Submit OTP via /auth/verify
      const verifyRes = await authed("post", "/api/telegram/auth/verify").send({
        code: "12345",
      });
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.state).toBe("connected");
      expect(verifyRes.body.data.requiresPassword).toBe(false);
      expect(verifyRes.body.data.account).toMatchObject({
        telegramUserId: "999888777",
        username: "televault_user",
        firstName: "Tele",
        lastName: "Vault",
      });

      // 3. Status is now connected
      const connectedStatus = await authed("get", "/api/telegram/status");
      expect(connectedStatus.body.data).toMatchObject({
        configured: true,
        state: "connected",
        sessionStored: true,
        account: {
          telegramUserId: "999888777",
          username: "televault_user",
          firstName: "Tele",
          lastName: "Vault",
        },
      });
      expect(connectedStatus.body.data.lastConnectedAt).toBeTruthy();

      // 4. GET /api/telegram/profile returns full profile with Saved Messages peer
      const profileRes = await authed("get", "/api/telegram/profile");
      expect(profileRes.status).toBe(200);
      expect(profileRes.body.data).toEqual({
        id: "999888777",
        username: "televault_user",
        firstName: "Tele",
        lastName: "Vault",
        phone: "+15551234567",
        savedMessagesPeerId: "999888777",
      });

      // 5. Verify session security invariants
      // Session store contains the session string
      const storedSession = await context.sessionStore.load();
      expect(storedSession).toBe(mockClient.sessionString);

      // SQLite contains ciphertext, never plaintext session
      const dbRow = context.database.connection
        .prepare("SELECT * FROM telegram_accounts WHERE telegram_user_id = ?")
        .get("999888777") as { session_ciphertext: string };
      expect(dbRow).toBeTruthy();
      expect(dbRow.session_ciphertext).not.toBe(mockClient.sessionString);
      expect(dbRow.session_ciphertext.startsWith("v1.")).toBe(true);
      expect(context.secretBox.decrypt(dbRow.session_ciphertext)).toBe(
        mockClient.sessionString,
      );

      // Responses never leak session or token
      const rawResponses = JSON.stringify([
        startRes.body,
        verifyRes.body,
        connectedStatus.body,
        profileRes.body,
      ]);
      expect(rawResponses).not.toContain(mockClient.sessionString);
      expect(rawResponses).not.toContain("0123456789abcdef0123456789abcdef");
    });

    it("rejects invalid OTP and stays in awaiting_code", async () => {
      await authed("post", "/api/telegram/auth/start").send({
        phoneNumber: "+15551234567",
      });

      const badCode = await authed("post", "/api/telegram/auth/verify").send({
        code: "99999",
      });
      expect(badCode.status).toBe(400);
      expect(badCode.body.error.code).toBe("VALIDATION_ERROR");

      const status = await authed("get", "/api/telegram/status");
      expect(status.body.data.state).toBe("awaiting_code");
    });

    it("rejects malformed code input", async () => {
      await authed("post", "/api/telegram/auth/start").send({
        phoneNumber: "+15551234567",
      });

      const malformed = await authed("post", "/api/telegram/auth/verify").send({
        code: "abc",
      });
      expect(malformed.status).toBe(400);
    });

    it("supports backward-compatible /auth/code alias", async () => {
      await authed("post", "/api/telegram/auth/start").send({
        phoneNumber: "+15551234567",
      });

      const res = await authed("post", "/api/telegram/auth/code").send({
        code: "12345",
      });
      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe("connected");
    });
  });

  describe("Two-step verification (2FA) flow", () => {
    it("transitions to awaiting_password when 2FA is enabled and completes auth on password verify", async () => {
      // Configure mock to require 2FA
      requires2FA = true;

      // 1. Start auth
      await authed("post", "/api/telegram/auth/start").send({
        phoneNumber: "+15551234567",
      });

      // 2. Submit OTP -> detects 2FA
      const verifyRes = await authed("post", "/api/telegram/auth/verify").send({
        code: "12345",
      });
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data).toEqual({
        state: "awaiting_password",
        requiresPassword: true,
      });

      // Status shows awaiting_password
      const awaitingStatus = await authed("get", "/api/telegram/status");
      expect(awaitingStatus.body.data.state).toBe("awaiting_password");

      // 3. Submit wrong 2FA password -> 400
      const badPasswordRes = await authed(
        "post",
        "/api/telegram/auth/verify-password",
      ).send({
        password: "wrong-password",
      });
      expect(badPasswordRes.status).toBe(400);
      expect(badPasswordRes.body.error.code).toBe("VALIDATION_ERROR");

      // Still awaiting_password
      const stillAwaiting = await authed("get", "/api/telegram/status");
      expect(stillAwaiting.body.data.state).toBe("awaiting_password");

      // 4. Submit correct 2FA password -> completes login
      const goodPasswordRes = await authed(
        "post",
        "/api/telegram/auth/verify-password",
      ).send({
        password: "correct-2fa-password",
      });
      expect(goodPasswordRes.status).toBe(200);
      expect(goodPasswordRes.body.data.state).toBe("connected");
      expect(goodPasswordRes.body.data.account).toMatchObject({
        telegramUserId: "999888777",
        username: "televault_user",
      });

      // 5. GET /api/telegram/profile returns profile
      const profile = await authed("get", "/api/telegram/profile");
      expect(profile.status).toBe(200);
      expect(profile.body.data.id).toBe("999888777");
    });

    it("supports backward-compatible /auth/password alias", async () => {
      requires2FA = true;
      await authed("post", "/api/telegram/auth/start").send({
        phoneNumber: "+15551234567",
      });
      await authed("post", "/api/telegram/auth/verify").send({
        code: "12345",
      });

      const res = await authed("post", "/api/telegram/auth/password").send({
        password: "correct-2fa-password",
      });
      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe("connected");
    });
  });

  describe("Disconnect and safe logout", () => {
    it("calls Telegram logOut, clears local session store and database", async () => {
      // Connect first
      await authed("post", "/api/telegram/auth/start").send({
        phoneNumber: "+15551234567",
      });
      await authed("post", "/api/telegram/auth/verify").send({
        code: "12345",
      });

      expect(await context.sessionStore.load()).toBeTruthy();

      // Disconnect
      const disconnectRes = await authed(
        "post",
        "/api/telegram/disconnect",
      );
      expect(disconnectRes.status).toBe(200);
      expect(disconnectRes.body.data.state).toBe("disconnected");
      expect(disconnectRes.body.data.account).toBeNull();
      expect(disconnectRes.body.data.sessionStored).toBe(false);

      // Session is wiped
      expect(await context.sessionStore.load()).toBeNull();
      const accountsInDb = context.database.connection
        .prepare("SELECT * FROM telegram_accounts")
        .all();
      expect(accountsInDb).toHaveLength(0);

      // Profile returns 401
      const profileRes = await authed("get", "/api/telegram/profile");
      expect(profileRes.status).toBe(401);

      // Mock client was logged out and destroyed
      expect(mockClient.loggedOut).toBe(true);
      expect(mockClient.destroyed).toBe(true);
    });

    it("supports backward-compatible /auth/logout alias", async () => {
      await authed("post", "/api/telegram/auth/start").send({
        phoneNumber: "+15551234567",
      });
      await authed("post", "/api/telegram/auth/verify").send({
        code: "12345",
      });

      const res = await authed("post", "/api/telegram/auth/logout");
      expect(res.status).toBe(200);
      expect(res.body.data.state).toBe("disconnected");
    });
  });

  describe("Session restoration after application restart", () => {
    it("restores active session on startup without user re-authentication", async () => {
      // 1. Authenticate in current session
      await authed("post", "/api/telegram/auth/start").send({
        phoneNumber: "+15551234567",
      });
      await authed("post", "/api/telegram/auth/verify").send({
        code: "12345",
      });

      const savedSession = await context.sessionStore.load();
      expect(savedSession).toBeTruthy();

      // 2. Simulate app restart with a fresh TelegramService
      const restoredClient = new MockTelegramClient(savedSession!);
      let restoredFactoryCalled = false;

      const freshContext = await createTestContext(
        {
          TELEGRAM_API_ID: "123456",
          TELEGRAM_API_HASH: "0123456789abcdef0123456789abcdef",
          DATA_DIR: context.dataDir,
        },
        {
          sessionStore: context.sessionStore,
          telegramClientFactory: (_session: string) => {
            restoredFactoryCalled = true;
            return restoredClient;
          },
        },
      );

      // Initialize service
      await freshContext.services.telegramService.initialize();

      expect(restoredFactoryCalled).toBe(true);
      expect(freshContext.services.telegramService.getStatus().state).toBe(
        "connected",
      );
      expect(
        freshContext.services.telegramService.getStatus().account?.telegramUserId,
      ).toBe("999888777");

      await freshContext.cleanup();
    });

    it("purges session and requires reauth if session is rejected by Telegram", async () => {
      // 1. Authenticate in current session
      await authed("post", "/api/telegram/auth/start").send({
        phoneNumber: "+15551234567",
      });
      await authed("post", "/api/telegram/auth/verify").send({
        code: "12345",
      });

      const savedSession = await context.sessionStore.load();
      expect(savedSession).toBeTruthy();

      // 2. Simulate restart where Telegram rejects authorization
      const rejectedClient = new MockTelegramClient(savedSession!);
      rejectedClient.failAuthorization = true;

      const freshContext = await createTestContext(
        {
          TELEGRAM_API_ID: "123456",
          TELEGRAM_API_HASH: "0123456789abcdef0123456789abcdef",
          DATA_DIR: context.dataDir,
        },
        {
          sessionStore: context.sessionStore,
          telegramClientFactory: (_session) => rejectedClient,
        },
      );

      await freshContext.services.telegramService.initialize();

      const status = freshContext.services.telegramService.getStatus();
      expect(status.state).toBe("disconnected");
      expect(status.lastError).toContain("no longer authorized");

      // Invalid session is cleared from storage
      expect(await freshContext.sessionStore.load()).toBeNull();

      await freshContext.cleanup();
    });
  });

  describe("Connection health check and backoff reconnect", () => {
    it("reports healthy connection state when client is connected", async () => {
      await authed("post", "/api/telegram/auth/start").send({
        phoneNumber: "+15551234567",
      });
      await authed("post", "/api/telegram/auth/verify").send({
        code: "12345",
      });

      const health = await context.services.telegramService.checkHealth();
      expect(health).toEqual({
        connected: true,
        state: "connected",
        lastError: null,
      });
    });

    it("reconnects successfully with bounded backoff", async () => {
      await authed("post", "/api/telegram/auth/start").send({
        phoneNumber: "+15551234567",
      });
      await authed("post", "/api/telegram/auth/verify").send({
        code: "12345",
      });

      // Disconnect socket without wiping session
      await mockClient.destroy();
      expect(context.services.telegramService.getStatus().state).toBe(
        "disconnected",
      );

      // Reconnect
      const reconnected = await context.services.telegramService.reconnect({
        maxAttempts: 2,
        baseMs: 5,
        maxMs: 20,
      });
      expect(reconnected).toBe(true);
      expect(context.services.telegramService.getStatus().state).toBe(
        "connected",
      );
    });
  });

  describe("Single managed client instance", () => {
    it("does not create a new client connection for each status or profile request", async () => {
      await authed("post", "/api/telegram/auth/start").send({
        phoneNumber: "+15551234567",
      });
      await authed("post", "/api/telegram/auth/verify").send({
        code: "12345",
      });

      const initialCount = clientFactoryCalls.length;

      // Make several status and profile requests
      await authed("get", "/api/telegram/status");
      await authed("get", "/api/telegram/profile");
      await authed("get", "/api/telegram/status");
      await authed("get", "/api/telegram/profile");

      // No new client instances were created
      expect(clientFactoryCalls.length).toBe(initialCount);
    });
  });
});
