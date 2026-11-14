import { resolve } from "node:path";
import { FloodWaitError, RPCError } from "telegram/errors";
import type { Logger } from "pino";
import type {
  TelegramAccountSummary,
  TelegramConnectionState,
  TelegramLoginCodeResult,
  TelegramLoginStartResult,
  TelegramProfile,
  TelegramStatus,
} from "@shared/types";
import type { AppConfig } from "../config/env";
import type { TelegramAccountRepository } from "../database/repositories/telegramAccountRepository";
import type { SettingsRepository } from "../database/repositories/settingsRepository";
import type { TelegramAccountRow } from "../database/rows";
import type { SecretBox } from "../security/secretBox";
import {
  createLocalSessionStore,
  type SecureSessionStore,
} from "../security/sessionStore";
import { nowIso } from "../utils/crypto";
import {
  AppError,
  ConflictError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from "../utils/errors";
import { backoffDelayMs } from "./backoff";
import {
  createGramJsClient,
  rpcErrorCode,
} from "./gramjsClient";
import type { RemoteFileManifest } from "../uploads/manifest";
import {
  TelegramSignupRequiredError,
  type DownloadSegmentInput,
  type ManagedTelegramClient,
  type SavedMessagesPeer,
  type TelegramClientFactory,
  type TelegramMessageSummary,
  type TelegramUserProfile,
  type UploadCapabilities,
  type UploadSegmentInput,
  type UploadSegmentResult,
} from "./managedClient";

const PHONE_NUMBER_PATTERN = /^\+[1-9]\d{6,14}$/;

interface PendingLogin {
  client: ManagedTelegramClient;
  phoneNumber: string;
  phoneCodeHash: string;
}

function rowToAccountSummary(row: TelegramAccountRow): TelegramAccountSummary {
  return {
    telegramUserId: row.telegram_user_id,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
  };
}

function mapTelegramError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof TelegramSignupRequiredError) {
    return new ConflictError(
      "No Telegram account exists for this phone number. Create one in an official Telegram app first.",
    );
  }

  if (error instanceof FloodWaitError) {
    return new AppError(
      429,
      "RATE_LIMITED",
      `Telegram asked TeleVault to wait ${error.seconds} seconds before retrying`,
    );
  }

  const code = rpcErrorCode(error);
  if (code) {
    if (
      code === "PHONE_CODE_INVALID" ||
      code === "PHONE_CODE_EMPTY" ||
      code === "PHONE_CODE_EXPIRED" ||
      code === "PHONE_CODE_HASH_EMPTY"
    ) {
      return new ValidationError(
        "The Telegram login code is invalid or has expired",
      );
    }
    if (code === "PASSWORD_HASH_INVALID") {
      return new ValidationError(
        "The Telegram two-step verification password is incorrect",
      );
    }
    if (code === "PHONE_NUMBER_FLOOD") {
      return new ValidationError(
        "Telegram temporarily rate-limited login attempts for this number. Please wait a few minutes or try again later.",
      );
    }
    if (
      code === "PHONE_NUMBER_INVALID" ||
      code === "PHONE_NUMBER_BANNED"
    ) {
      return new ValidationError("Telegram rejected this phone number");
    }
    if (
      code === "AUTH_KEY_UNREGISTERED" ||
      code === "AUTH_KEY_DUPLICATED" ||
      code === "SESSION_REVOKED" ||
      code === "USER_DEACTIVATED"
    ) {
      return new UnauthorizedError(
        "The Telegram session is no longer authorized. Sign in again.",
      );
    }
  }

  return new ServiceUnavailableError(
    "Telegram could not complete the request. Check the connection and try again.",
  );
}

export interface TelegramServiceOptions {
  config: AppConfig;
  accounts: TelegramAccountRepository;
  secretBox: SecretBox;
  sessionStore: SecureSessionStore;
  logger: Logger;
  settings?: SettingsRepository;
  clientFactory?: TelegramClientFactory;
}

/**
 * Owns the single GramJS client and the in-memory, two-step login flow.
 *
 * Security invariants:
 * - Telegram API credentials come from the environment or secure local settings.
 * - Session strings are encrypted before they reach SQLite and local files.
 * - OTP codes and 2FA passwords are held only in local variables for the
 *   duration of a request; they are never persisted or logged.
 * - The status DTO never contains credentials, session data or phone numbers.
 */
export class TelegramService {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private configured: boolean;
  private apiId: number | null;
  private apiHash: string | null;
  private readonly accounts: TelegramAccountRepository;
  private readonly settings?: SettingsRepository;
  private readonly secretBox: SecretBox;
  private readonly sessionStore: SecureSessionStore;
  private readonly clientFactory: TelegramClientFactory;

  private client: ManagedTelegramClient | null = null;
  private pending: PendingLogin | null = null;
  private account: TelegramAccountSummary | null = null;
  private userProfile: TelegramUserProfile | null = null;
  private savedMessagesPeer: SavedMessagesPeer | null = null;
  private state: TelegramConnectionState;
  private lastError: string | null = null;
  private lastConnectedAt: string | null = null;
  private initialized = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectPromise: Promise<boolean> | null = null;
  private shutdownRequested = false;

  constructor(options: TelegramServiceOptions);
  constructor(
    config: AppConfig,
    accounts: TelegramAccountRepository,
    secretBox: SecretBox,
    logger: Logger,
    sessionStore?: SecureSessionStore,
    clientFactory?: TelegramClientFactory,
  );
  constructor(
    optionsOrConfig: TelegramServiceOptions | AppConfig,
    accounts?: TelegramAccountRepository,
    secretBox?: SecretBox,
    logger?: Logger,
    sessionStore?: SecureSessionStore,
    clientFactory?: TelegramClientFactory,
  ) {
    if ("accounts" in optionsOrConfig) {
      const opts = optionsOrConfig as TelegramServiceOptions;
      this.config = opts.config;
      this.accounts = opts.accounts;
      this.settings = opts.settings;
      this.secretBox = opts.secretBox;
      this.sessionStore = opts.sessionStore;
      this.logger = opts.logger.child({ module: "telegram" });
      this.configured = opts.config.telegram.configured;
      this.apiId = opts.config.telegram.apiId;
      this.apiHash = opts.config.telegram.apiHash;
      this.clientFactory =
        opts.clientFactory ??
        ((session: string) => {
          this.assertConfigured();
          return createGramJsClient({
            apiId: this.apiId!,
            apiHash: this.apiHash!,
            session,
          });
        });
    } else {
      const config = optionsOrConfig as AppConfig;
      this.config = config;
      this.accounts = accounts!;
      this.secretBox = secretBox!;
      this.logger = logger!.child({ module: "telegram" });
      this.configured = config.telegram.configured;
      this.apiId = config.telegram.apiId;
      this.apiHash = config.telegram.apiHash;
      this.sessionStore =
        sessionStore ??
        createLocalSessionStore({
          filePath: resolve(config.dataDir, "telegram.session"),
          secretBox: this.secretBox,
        });
      this.clientFactory =
        clientFactory ??
        ((session: string) => {
          this.assertConfigured();
          return createGramJsClient({
            apiId: this.apiId!,
            apiHash: this.apiHash!,
            session,
          });
        });
    }

    // Attempt to restore credentials from local SQLite settings if not in env
    if (!this.configured && this.settings) {
      const savedApiId = this.settings.get<number>("telegram_api_id");
      const savedApiHash = this.settings.get<string>("telegram_api_hash");
      if (savedApiId && savedApiHash) {
        this.apiId = Number(savedApiId);
        this.apiHash = String(savedApiHash);
        this.configured = true;
        process.env.TELEGRAM_API_ID = String(savedApiId);
        process.env.TELEGRAM_API_HASH = String(savedApiHash);
        this.logger.info({ apiId: savedApiId }, "Telegram credentials restored from SQLite settings");
      }
    }

    this.state = this.configured ? "disconnected" : "unconfigured";
  }

  getStatus(): TelegramStatus {
    const stored = this.accounts.getPrimary();
    let effectiveState = this.state;

    if (this.reconnectPromise !== null && effectiveState !== "connected") {
      effectiveState = "connecting";
    } else if (
      effectiveState === "connected" &&
      this.client !== null &&
      this.client.isConnected() === false
    ) {
      effectiveState = "disconnected";
    }

    return {
      configured: this.configured,
      state: effectiveState,
      sessionStored: stored !== null,
      account: this.account ?? (stored ? rowToAccountSummary(stored) : null),
      lastConnectedAt:
        stored?.last_connected_at ?? this.lastConnectedAt ?? null,
      lastError: this.lastError,
    };
  }

  isConnected(): boolean {
    return this.getStatus().state === "connected";
  }

  configure(apiId: number, apiHash: string): TelegramStatus {
    this.apiId = apiId;
    this.apiHash = apiHash;
    this.configured = true;
    if (this.state === "unconfigured") {
      this.state = "disconnected";
    }
    process.env.TELEGRAM_API_ID = String(apiId);
    process.env.TELEGRAM_API_HASH = apiHash;

    if (this.settings) {
      try {
        this.settings.set("telegram_api_id", apiId);
        this.settings.set("telegram_api_hash", apiHash);
      } catch (err) {
        this.logger.warn({ err }, "Could not persist Telegram credentials to settings");
      }
    }

    this.logger.info({ apiId }, "Telegram credentials dynamically configured and saved");

    const stored = this.accounts.getPrimary();
    if (stored && this.state === "disconnected") {
      this.initialized = false;
      void this.initialize().catch((err) => {
        this.logger.warn({ err }, "Auto-restore of stored Telegram session failed during configuration");
      });
    }

    return this.getStatus();
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.pingTimer = setInterval(() => {
      if (this.state === "connected" && this.client && this.client.isConnected()) {
        if (typeof this.client.ping === "function") {
          this.client.ping().catch(() => {});
        }
      }
    }, 30_000);
  }

  private stopKeepAlive(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  async getProfile(): Promise<TelegramProfile | null> {
    const stored = this.accounts.getPrimary();
    const account = this.account ?? (stored ? rowToAccountSummary(stored) : null);
    if (!account) {
      return null;
    }

    if (this.client && !this.client.isConnected()) {
      this.client.connect().catch(() => {});
    }

    if (this.userProfile && this.savedMessagesPeer) {
      return {
        id: account.telegramUserId,
        username: account.username,
        firstName: account.firstName,
        lastName: account.lastName,
        phone: this.userProfile.phone ?? null,
        savedMessagesPeerId: this.savedMessagesPeer.peerId,
      };
    }

    if (this.client && this.client.isConnected()) {
      try {
        const me = await this.client.getMe();
        const savedPeer = await this.client.resolveSavedMessages(me.id);
        this.userProfile = me;
        this.savedMessagesPeer = savedPeer;
        return {
          id: me.id,
          username: me.username,
          firstName: me.firstName,
          lastName: me.lastName,
          phone: me.phone ?? null,
          savedMessagesPeerId: savedPeer.peerId,
        };
      } catch {
        // Fall back to account summary below
      }
    }

    return {
      id: account.telegramUserId,
      username: account.username,
      firstName: account.firstName,
      lastName: account.lastName,
      phone: null,
      savedMessagesPeerId: this.savedMessagesPeer?.peerId ?? account.telegramUserId,
    };
  }

  getSavedMessagesPeer(): SavedMessagesPeer | null {
    return this.savedMessagesPeer;
  }

  private assertConnected(): ManagedTelegramClient {
    this.assertConfigured();
    if (this.state !== "connected" || !this.client) {
      throw new ServiceUnavailableError("Telegram is not connected");
    }
    if (!this.client.isConnected()) {
      this.client.connect().catch(() => {});
    }
    return this.client;
  }

  async getUploadCapabilities(): Promise<UploadCapabilities> {
    const client = this.assertConnected();
    return client.getUploadCapabilities();
  }

  async uploadSegment(input: UploadSegmentInput): Promise<UploadSegmentResult> {
    const client = this.assertConnected();
    return client.uploadSegment(input);
  }

  async downloadSegment(input: DownloadSegmentInput): Promise<{ size: number }> {
    const client = this.assertConnected();
    return client.downloadSegment({
      peerId: input.peerId ?? this.savedMessagesPeer?.peerId ?? "me",
      ...input,
    });
  }

  async getMessages(
    messageIds: string[],
    peerId?: string,
  ): Promise<TelegramMessageSummary[]> {
    const client = this.assertConnected();
    return client.getMessages(peerId ?? this.savedMessagesPeer?.peerId ?? "me", messageIds);
  }

  async iterMessages(
    options?: { limit?: number; offsetId?: string },
    peerId?: string,
  ): Promise<TelegramMessageSummary[]> {
    const client = this.assertConnected();
    return client.iterMessages(peerId ?? this.savedMessagesPeer?.peerId ?? "me", options);
  }

  async deleteMessages(
    messageIds: string[],
    peerId?: string,
  ): Promise<{ deletedIds: string[]; failedIds: string[] }> {
    const client = this.assertConnected();
    return client.deleteMessages(peerId ?? this.savedMessagesPeer?.peerId ?? "me", messageIds);
  }

  async uploadManifest(input: {
    manifest: RemoteFileManifest;
    peerId?: string;
  }): Promise<{ messageId: string }> {
    const client = this.assertConnected();
    return client.sendManifest({
      peerId: input.peerId ?? this.savedMessagesPeer?.peerId ?? "me",
      manifest: input.manifest,
    });
  }

  async downloadManifest(input: {
    messageId: string;
    peerId?: string;
  }): Promise<RemoteFileManifest | null> {
    const client = this.assertConnected();
    return client.downloadManifest({
      peerId: input.peerId ?? this.savedMessagesPeer?.peerId ?? "me",
      messageId: input.messageId,
    });
  }

  /**
   * Restore a previously authorized session, if one exists. Network failures
   * are contained here so the HTTP server can start independently.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    if (!this.configured) {
      this.state = "unconfigured";
      this.logger.info(
        "Telegram API credentials are not configured; Telegram features are disabled",
      );
      return;
    }

    const stored = this.accounts.getPrimary();
    let session = await this.sessionStore.load();
    if (!session && stored) {
      try {
        session = this.secretBox.decrypt(stored.session_ciphertext);
        await this.sessionStore.save(session);
      } catch {
        session = null;
      }
    }

    if (!session || !stored) {
      this.state = "disconnected";
      this.logger.info("No stored Telegram session; sign-in is required");
      return;
    }

    this.state = "connecting";
    let client: ManagedTelegramClient | null = null;

    try {
      client = this.clientFactory(session);
      await this.connectWithTimeout(client);

      const authorized = await client.checkAuthorization();
      if (!authorized) {
        await this.destroyClient(client);
        await this.sessionStore.clear();
        this.accounts.clearAll();
        this.state = "disconnected";
        this.lastError =
          "The stored Telegram session is no longer authorized. Sign in again.";
        this.logger.warn(
          "Stored Telegram session was rejected by Telegram and has been removed",
        );
        return;
      }

      const me = await client.getMe();
      const savedPeer = await client.resolveSavedMessages(me.id);

      this.client = client;
      this.account = {
        telegramUserId: me.id,
        username: me.username,
        firstName: me.firstName,
        lastName: me.lastName,
      };
      this.userProfile = me;
      this.savedMessagesPeer = savedPeer;
      this.state = "connected";
      this.lastError = null;
      this.lastConnectedAt = nowIso();
      this.accounts.markConnected(stored.id, this.lastConnectedAt);

      // GramJS can refresh the auth key while connecting; persist the updated
      // session so a restart does not lose it.
      const refreshed = client.saveSession();
      if (refreshed && refreshed !== session) {
        await this.sessionStore.save(refreshed);
        this.accounts.updateSession(
          stored.id,
          this.secretBox.encrypt(refreshed),
        );
      }

      this.startKeepAlive();
      this.logger.info(
        { telegramUserId: this.account.telegramUserId },
        "Telegram session restored",
      );
    } catch (error) {
      if (client) {
        await this.destroyClient(client);
      }
      this.client = null;
      const code = rpcErrorCode(error);
      if (
        code === "AUTH_KEY_UNREGISTERED" ||
        code === "SESSION_REVOKED" ||
        code === "USER_DEACTIVATED"
      ) {
        await this.sessionStore.clear();
        this.accounts.clearAll();
        this.state = "disconnected";
        this.lastError = "The stored Telegram session has been revoked. Sign in again.";
        this.logger.warn({ code }, "Stored Telegram session revoked by Telegram");
        return;
      }
      this.state = "disconnected";
      this.lastError =
        "Telegram could not connect. Check the network and retry.";
      this.logger.warn(
        { errorCode: code, errorName: (error as Error)?.name },
        "Telegram session restore failed; session retained in SQLite",
      );
    }
  }

  async beginLogin(
    phoneNumber: string,
    forceSMS = false,
  ): Promise<TelegramLoginStartResult> {
    this.assertConfigured();
    if (!PHONE_NUMBER_PATTERN.test(phoneNumber)) {
      throw new ValidationError(
        "phoneNumber must be in international E.164 format, for example +15551234567",
      );
    }
    if (this.state === "connected") {
      throw new ConflictError("A Telegram account is already connected");
    }

    await this.clearPending();
    if (this.client) {
      await this.destroyClient(this.client);
      this.client = null;
      this.account = null;
      this.userProfile = null;
      this.savedMessagesPeer = null;
    }

    this.state = "connecting";
    this.lastError = null;
    const client = this.clientFactory("");

    try {
      await this.connectWithTimeout(client);
      const { phoneCodeHash, isCodeViaApp, timeout } = await client.sendCode(
        phoneNumber,
        forceSMS,
      );

      this.pending = { client, phoneNumber, phoneCodeHash };
      this.state = "awaiting_code";
      this.logger.info(
        { isCodeViaApp, forceSMS, timeout },
        "Telegram login code requested",
      );
      return { isCodeViaApp, timeout };
    } catch (error) {
      await this.destroyClient(client);
      this.state = "disconnected";
      this.lastError = "Telegram sign-in could not be started";
      this.logger.warn(
        { errorCode: rpcErrorCode(error) },
        "Telegram login could not be started",
      );
      throw mapTelegramError(error);
    }
  }

  async submitCode(code: string): Promise<TelegramLoginCodeResult> {
    this.assertConfigured();
    const pending = this.pending;
    if (!pending || this.state !== "awaiting_code") {
      throw new ConflictError(
        "No Telegram login is awaiting a code. Start sign-in again.",
      );
    }
    if (!/^\d{4,8}$/.test(code)) {
      throw new ValidationError("The Telegram login code is malformed");
    }

    try {
      const result = await pending.client.submitCode({
        phoneNumber: pending.phoneNumber,
        phoneCodeHash: pending.phoneCodeHash,
        phoneCode: code,
      });

      if (result.requiresPassword) {
        this.state = "awaiting_password";
        this.lastError = null;
        return { state: this.state, requiresPassword: true };
      }

      await this.finalizeLogin(pending, result.user);
      return {
        state: this.state,
        requiresPassword: false,
        account: this.account,
      };
    } catch (error) {
      this.lastError = mapTelegramError(error).message;
      this.logger.warn(
        { errorCode: rpcErrorCode(error) },
        "Telegram login code was rejected",
      );
      throw mapTelegramError(error);
    }
  }

  async submitPassword(password: string): Promise<TelegramStatus> {
    this.assertConfigured();
    const pending = this.pending;
    if (!pending || this.state !== "awaiting_password") {
      throw new ConflictError(
        "No Telegram login is awaiting a two-step verification password",
      );
    }
    if (password.length < 1 || password.length > 256) {
      throw new ValidationError(
        "The two-step verification password must be between 1 and 256 characters",
      );
    }

    try {
      const user = await pending.client.submitPassword(password);
      await this.finalizeLogin(pending, user);
      return this.getStatus();
    } catch (error) {
      this.lastError = mapTelegramError(error).message;
      this.logger.warn(
        { errorCode: rpcErrorCode(error) },
        "Telegram two-step verification failed",
      );
      throw mapTelegramError(error);
    }
  }

  async logout(): Promise<TelegramStatus> {
    this.shutdownRequested = true;
    this.stopKeepAlive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.shutdownRequested = false;

    await this.clearPending();

    if (this.client) {
      try {
        if (this.client.isConnected()) {
          await this.client.logOut();
        }
      } catch (error) {
        this.logger.warn(
          { errorCode: rpcErrorCode(error) },
          "Telegram logout request failed; removing the local session anyway",
        );
      }
      await this.destroyClient(this.client);
      this.client = null;
    }

    await this.sessionStore.clear();
    this.accounts.clearAll();
    this.account = null;
    this.userProfile = null;
    this.savedMessagesPeer = null;
    this.lastConnectedAt = null;
    this.lastError = null;
    this.state = this.configured ? "disconnected" : "unconfigured";
    this.logger.info("Telegram account unlinked and local session removed");
    return this.getStatus();
  }

  async checkHealth(): Promise<{
    connected: boolean;
    state: TelegramConnectionState;
    lastError: string | null;
  }> {
    if (!this.configured) {
      return { connected: false, state: "unconfigured", lastError: null };
    }
    if (!this.client) {
      const stored = this.accounts.getPrimary();
      return {
        connected: false,
        state: this.state,
        lastError:
          this.lastError ??
          (stored
            ? "Session saved but client not connected"
            : "No session saved"),
      };
    }

    try {
      if (!this.client.isConnected()) {
        this.client.connect().catch(() => {});
      }

      return {
        connected: this.state === "connected",
        state: this.state,
        lastError: this.lastError,
      };
    } catch (error) {
      return {
        connected: false,
        state: this.state,
        lastError: (error as Error).message,
      };
    }
  }

  async reconnect(
    options: {
      maxAttempts?: number;
      baseMs?: number;
      maxMs?: number;
    } = {},
  ): Promise<boolean> {
    if (this.reconnectPromise) {
      return this.reconnectPromise;
    }
    this.reconnectPromise = this.performReconnect(options).finally(() => {
      this.reconnectPromise = null;
    });
    return this.reconnectPromise;
  }

  private async performReconnect(
    options: {
      maxAttempts?: number;
      baseMs?: number;
      maxMs?: number;
    } = {},
  ): Promise<boolean> {
    if (!this.configured) {
      return false;
    }
    if (this.state === "connected" && this.client?.isConnected()) {
      return true;
    }

    const stored = this.accounts.getPrimary();
    let session = await this.sessionStore.load();
    if (!session && stored) {
      try {
        session = this.secretBox.decrypt(stored.session_ciphertext);
      } catch {
        session = null;
      }
    }

    if (!session || !stored) {
      this.state = "disconnected";
      return false;
    }

    const maxAttempts = options.maxAttempts ?? 3;
    const baseMs = options.baseMs ?? 1_000;
    const maxMs = options.maxMs ?? 10_000;

    this.state = "connecting";
    this.lastError = null;

    // Destroy existing client first so we don't hold two concurrent clients with same auth key!
    if (this.client) {
      await this.destroyClient(this.client);
      this.client = null;
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (this.shutdownRequested) {
        break;
      }

      let client: ManagedTelegramClient | null = null;
      try {
        client = this.clientFactory(session);
        await this.connectWithTimeout(client);

        const authorized = await client.checkAuthorization();
        if (!authorized) {
          await this.destroyClient(client);
          await this.sessionStore.clear();
          this.accounts.clearAll();
          this.state = "disconnected";
          this.lastError =
            "The stored Telegram session is no longer authorized. Sign in again.";
          this.logger.warn(
            "Stored Telegram session was rejected during reconnect and has been removed",
          );
          return false;
        }

        const me = await client.getMe();
        const savedPeer = await client.resolveSavedMessages(me.id);

        this.client = client;
        this.account = {
          telegramUserId: me.id,
          username: me.username,
          firstName: me.firstName,
          lastName: me.lastName,
        };
        this.userProfile = me;
        this.savedMessagesPeer = savedPeer;
        this.state = "connected";
        this.lastError = null;
        this.lastConnectedAt = nowIso();
        this.accounts.markConnected(stored.id, this.lastConnectedAt);

        const refreshed = client.saveSession();
        if (refreshed && refreshed !== session) {
          await this.sessionStore.save(refreshed);
          this.accounts.updateSession(
            stored.id,
            this.secretBox.encrypt(refreshed),
          );
        }

        this.startKeepAlive();
        this.logger.info("Telegram connection re-established");
        return true;
      } catch (error) {
        if (client) {
          await this.destroyClient(client);
        }
        const code = rpcErrorCode(error);
        if (
          code === "AUTH_KEY_UNREGISTERED" ||
          code === "SESSION_REVOKED" ||
          code === "USER_DEACTIVATED"
        ) {
          await this.sessionStore.clear();
          this.accounts.clearAll();
          this.state = "disconnected";
          this.lastError = "The stored Telegram session has been revoked. Sign in again.";
          this.logger.warn({ code }, "Stored Telegram session revoked during reconnect");
          return false;
        }

        this.logger.warn(
          { attempt, maxAttempts, errorCode: code },
          "Telegram reconnect attempt failed",
        );

        if (attempt < maxAttempts && !this.shutdownRequested) {
          const delay = backoffDelayMs(attempt, baseMs, maxMs);
          await new Promise<void>((resolve) => {
            this.reconnectTimer = setTimeout(() => {
              this.reconnectTimer = null;
              resolve();
            }, delay);
          });
        }
      }
    }

    this.state = "disconnected";
    this.lastError = "Telegram reconnection paused; will retry automatically";
    return false;
  }

  /** Disconnect without revoking the stored session. */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true;
    this.stopKeepAlive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.clearPending();
    if (this.client) {
      await this.destroyClient(this.client);
      this.client = null;
    }
  }

  private assertConfigured(): void {
    if (!this.configured || this.apiId === null || this.apiHash === null) {
      throw new ServiceUnavailableError(
        "Telegram is not configured. Set TELEGRAM_API_ID and TELEGRAM_API_HASH.",
      );
    }
  }

  private async connectWithTimeout(client: ManagedTelegramClient): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new ServiceUnavailableError("Timed out connecting to Telegram"),
        );
      }, this.config.telegram.connectTimeoutMs);
    });

    try {
      await Promise.race([client.connect(), timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async finalizeLogin(
    pending: PendingLogin,
    user: TelegramUserProfile,
  ): Promise<void> {
    const session = pending.client.saveSession();
    if (!session) {
      throw new ServiceUnavailableError(
        "Telegram did not return a usable session",
      );
    }

    const savedPeer = await pending.client.resolveSavedMessages(user.id);
    const summary: TelegramAccountSummary = {
      telegramUserId: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
    };
    const connectedAt = nowIso();

    // Persist to secure storage adapter
    await this.sessionStore.save(session);

    // Persist encrypted to SQLite
    this.accounts.save({
      telegramUserId: summary.telegramUserId,
      username: summary.username,
      firstName: summary.firstName,
      lastName: summary.lastName,
      sessionCiphertext: this.secretBox.encrypt(session),
      lastConnectedAt: connectedAt,
    });

    this.client = pending.client;
    this.pending = null;
    this.account = summary;
    this.userProfile = user;
    this.savedMessagesPeer = savedPeer;
    this.state = "connected";
    this.lastError = null;
    this.lastConnectedAt = connectedAt;
    this.startKeepAlive();
    this.logger.info(
      { telegramUserId: summary.telegramUserId },
      "Telegram account connected",
    );
  }

  private async clearPending(): Promise<void> {
    if (!this.pending) {
      return;
    }
    const pending = this.pending;
    this.pending = null;
    await this.destroyClient(pending.client);
  }

  private async destroyClient(client: ManagedTelegramClient): Promise<void> {
    try {
      await client.destroy();
    } catch {
      // The socket may already be gone; there is nothing useful to do.
    }
  }
}
