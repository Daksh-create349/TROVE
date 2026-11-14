import { promises as fs } from "node:fs";
import { Api, TelegramClient } from "telegram";
import { CustomFile } from "telegram/client/uploads";
import { Logger as GramJsLogger, LogLevel } from "telegram/extensions/Logger";
import { RPCError } from "telegram/errors";
import { StringSession } from "telegram/sessions";
import { APP_VERSION } from "../config/constants";
import { NotFoundError, ServiceUnavailableError } from "../utils/errors";
import {
  deserializeRemoteManifest,
  formatRemoteManifestCaption,
  type RemoteFileManifest,
  serializeRemoteManifest,
} from "../uploads/manifest";
import {
  TelegramSignupRequiredError,
  type DownloadSegmentInput,
  type ManagedTelegramClient,
  type SavedMessagesPeer,
  type SubmitCodeResult,
  type TelegramMessageSummary,
  type TelegramUserProfile,
  type UploadCapabilities,
  type UploadSegmentInput,
  type UploadSegmentResult,
} from "./managedClient";

export interface GramJsClientOptions {
  apiId: number;
  apiHash: string;
  session: string;
}

export function rpcErrorCode(error: unknown): string | null {
  if (error instanceof RPCError) {
    return error.errorMessage;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "errorMessage" in error &&
    typeof (error as { errorMessage?: unknown }).errorMessage === "string"
  ) {
    return (error as { errorMessage: string }).errorMessage;
  }
  return null;
}

export function isSessionPasswordNeeded(error: unknown): boolean {
  return rpcErrorCode(error) === "SESSION_PASSWORD_NEEDED";
}

export function extractFloodWaitSeconds(error: unknown): number | null {
  if (error && typeof error === "object") {
    if (
      "seconds" in error &&
      typeof (error as { seconds?: unknown }).seconds === "number" &&
      (error as { seconds: number }).seconds > 0
    ) {
      return (error as { seconds: number }).seconds;
    }
    const message =
      (error as { errorMessage?: unknown; message?: unknown }).errorMessage ??
      (error as { message?: unknown }).message;
    if (typeof message === "string") {
      const match = message.match(/(?:FLOOD_WAIT_|FLOOD_PREMIUM_WAIT_)(\d+)/i);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }
  }
  return null;
}

function parseJsonValue(val: unknown): unknown {
  if (!val) return null;
  if (val instanceof Api.JsonNull) return null;
  if (val instanceof Api.JsonBool) return val.value;
  if (val instanceof Api.JsonNumber) return val.value;
  if (val instanceof Api.JsonString) return val.value;
  if (val instanceof Api.JsonArray) {
    return (val.value || []).map(parseJsonValue);
  }
  if (val instanceof Api.JsonObject) {
    const obj: Record<string, unknown> = {};
    for (const item of val.value || []) {
      if (item && item.key) {
        obj[item.key] = parseJsonValue(item.value);
      }
    }
    return obj;
  }
  if (typeof val === "object" && "value" in (val as Record<string, unknown>)) {
    return (val as { value: unknown }).value;
  }
  return val;
}

/**
 * One GramJS MTProto connection. Callers own the instance; this adapter does
 * not open additional clients.
 */
export class GramJsTelegramClient implements ManagedTelegramClient {
  private readonly client: TelegramClient;
  private readonly stringSession: StringSession;

  constructor(private readonly options: GramJsClientOptions) {
    this.stringSession = new StringSession(options.session);
    this.client = new TelegramClient(
      this.stringSession,
      options.apiId,
      options.apiHash,
      {
        connectionRetries: 2,
        requestRetries: 2,
        autoReconnect: false,
        retryDelay: 1_000,
        timeout: 10,
        deviceModel: "TeleVault Desktop",
        systemVersion: process.platform,
        appVersion: APP_VERSION,
        langCode: "en",
        systemLangCode: "en",
        floodSleepThreshold: 0,
        securityChecks: true,
        baseLogger: new GramJsLogger(LogLevel.NONE),
      },
    );
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  isConnected(): boolean {
    return this.client.connected === true;
  }

  checkAuthorization(): Promise<boolean> {
    return this.client.checkAuthorization();
  }

  async sendCode(phoneNumber: string, forceSMS = false): Promise<{
    phoneCodeHash: string;
    isCodeViaApp: boolean;
  }> {
    return this.client.sendCode(
      { apiId: this.options.apiId, apiHash: this.options.apiHash },
      phoneNumber,
      forceSMS,
    );
  }

  async submitCode(input: {
    phoneNumber: string;
    phoneCodeHash: string;
    phoneCode: string;
  }): Promise<SubmitCodeResult> {
    try {
      const result = await this.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: input.phoneNumber,
          phoneCodeHash: input.phoneCodeHash,
          phoneCode: input.phoneCode,
        }),
      );

      if (result instanceof Api.auth.AuthorizationSignUpRequired) {
        throw new TelegramSignupRequiredError();
      }
      if (!(result instanceof Api.auth.Authorization)) {
        throw new ServiceUnavailableError(
          "Telegram returned an unexpected sign-in response",
        );
      }
      return {
        requiresPassword: false,
        user: toTelegramUser(result.user),
      };
    } catch (error) {
      if (isSessionPasswordNeeded(error)) {
        return { requiresPassword: true };
      }
      throw error;
    }
  }

  async submitPassword(password: string): Promise<TelegramUserProfile> {
    const user = await this.client.signInWithPassword(
      { apiId: this.options.apiId, apiHash: this.options.apiHash },
      {
        password: async () => password,
        onError: async (error: Error) => {
          throw error;
        },
      },
    );
    return toTelegramUser(user);
  }

  async getMe(): Promise<TelegramUserProfile> {
    return toTelegramUser(await this.client.getMe());
  }

  async resolveSavedMessages(selfUserId: string): Promise<SavedMessagesPeer> {
    try {
      const peer = await this.client.getInputEntity("me");
      if (peer instanceof Api.InputPeerUser) {
        return {
          destination: "saved_messages",
          peerId: String(peer.userId),
        };
      }
      if (peer instanceof Api.InputPeerSelf) {
        return { destination: "saved_messages", peerId: selfUserId };
      }
    } catch {
      // Fall back to selfUserId if peer resolution encounters an error.
    }
    return { destination: "saved_messages", peerId: selfUserId };
  }

  async getUploadCapabilities(): Promise<UploadCapabilities> {
    const defaultParts = 4000;
    const premiumParts = 8000;
    const partSize = 512 * 1024; // 512 KB MTProto part size

    let uploadMaxFilepartsDefault = defaultParts;
    let uploadMaxFilepartsPremium = premiumParts;

    try {
      const appConfig = await this.client.invoke(new Api.help.GetAppConfig({}));
      if (appConfig instanceof Api.help.AppConfig && appConfig.config) {
        const parsed = parseJsonValue(appConfig.config) as Record<string, unknown> | null;
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.upload_max_fileparts_default === "number") {
            uploadMaxFilepartsDefault = parsed.upload_max_fileparts_default;
          }
          if (typeof parsed.upload_max_fileparts_premium === "number") {
            uploadMaxFilepartsPremium = parsed.upload_max_fileparts_premium;
          }
        }
      }
    } catch {
      // Fallback to standard Telegram defaults if GetAppConfig fails
    }

    let isPremium = false;
    try {
      const me = await this.client.getMe();
      if (me instanceof Api.User && Boolean(me.premium)) {
        isPremium = true;
      }
    } catch {
      // Ignore profile check errors, default to non-premium
    }

    const uploadMaxFileparts = isPremium
      ? uploadMaxFilepartsPremium
      : uploadMaxFilepartsDefault;
    const maxSingleFileSize = uploadMaxFileparts * partSize;
    // 50 MB safety margin to prevent edge-case server rejections
    const safetyMargin = 50 * 1024 * 1024;
    const safeSegmentSize = Math.max(partSize, maxSingleFileSize - safetyMargin);

    return {
      uploadMaxFileparts,
      partSize,
      maxSingleFileSize,
      safeSegmentSize,
      isPremium,
    };
  }

  async uploadSegment(input: UploadSegmentInput): Promise<UploadSegmentResult> {
    if (input.abortSignal?.aborted) {
      throw new Error("Upload aborted");
    }

    const file = new CustomFile(
      input.fileName,
      input.fileSize,
      input.filePath ?? "",
      input.buffer,
    );

    const attributes: Api.TypeDocumentAttribute[] = [
      new Api.DocumentAttributeFilename({ fileName: input.fileName }),
    ];

    type ProgressCallback = ((progress: number) => void) & { isCanceled?: boolean };
    const progressCallback: ProgressCallback = (progress: number) => {
      if (input.abortSignal?.aborted) {
        progressCallback.isCanceled = true;
        throw new Error("Upload aborted");
      }
      if (input.onProgress) {
        input.onProgress(progress);
      }
    };

    if (input.abortSignal) {
      input.abortSignal.addEventListener(
        "abort",
        () => {
          progressCallback.isCanceled = true;
        },
        { once: true },
      );
    }

    const result = await this.client.sendFile(input.peerId || "me", {
      file,
      caption: input.caption,
      forceDocument: true,
      fileSize: input.fileSize,
      attributes,
      workers: 1,
      progressCallback,
    });

    const messageId = String(result.id);
    return { messageId };
  }

  async downloadSegment(input: DownloadSegmentInput): Promise<{ size: number }> {
    if (input.abortSignal?.aborted) {
      throw new Error("Download aborted");
    }
    const numId = parseInt(input.messageId, 10);
    const messages = await this.client.getMessages(input.peerId || "me", { ids: [numId] });
    const message = messages[0];
    if (!message || !message.media) {
      throw new NotFoundError(`Telegram message ${input.messageId} or document not found`);
    }

    type ProgressCallback = ((ratio: number) => void) & { isCanceled?: boolean };
    const progressCallback: ProgressCallback = (ratio: number) => {
      if (input.abortSignal?.aborted) {
        progressCallback.isCanceled = true;
        throw new Error("Download aborted");
      }
      if (input.onProgress) {
        input.onProgress(ratio);
      }
    };

    if (input.abortSignal) {
      input.abortSignal.addEventListener(
        "abort",
        () => {
          progressCallback.isCanceled = true;
        },
        { once: true },
      );
    }

    await this.client.downloadMedia(message, {
      outputFile: input.targetPath,
      progressCallback: progressCallback as any,
    });

    const stat = await fs.stat(input.targetPath);
    return { size: stat.size };
  }

  async getMessages(
    peerId: string,
    messageIds: string[],
  ): Promise<TelegramMessageSummary[]> {
    const numIds = messageIds
      .map((id) => parseInt(id, 10))
      .filter((id) => !isNaN(id));
    if (numIds.length === 0) return [];

    const messages = await this.client.getMessages(peerId || "me", { ids: numIds });
    return messages.filter(Boolean).map(toMessageSummary);
  }

  async iterMessages(
    peerId: string,
    options?: { limit?: number; offsetId?: string },
  ): Promise<TelegramMessageSummary[]> {
    const limit = options?.limit ?? 50;
    const offsetId = options?.offsetId ? parseInt(options.offsetId, 10) : undefined;

    const messages = await this.client.getMessages(peerId || "me", {
      limit,
      offsetId,
    });
    return messages.filter(Boolean).map(toMessageSummary);
  }

  async deleteMessages(
    peerId: string,
    messageIds: string[],
  ): Promise<{ deletedIds: string[]; failedIds: string[] }> {
    const deletedIds: string[] = [];
    const failedIds: string[] = [];

    for (const id of messageIds) {
      const numId = parseInt(id, 10);
      if (isNaN(numId)) {
        failedIds.push(id);
        continue;
      }
      try {
        await this.client.deleteMessages(peerId || "me", [numId], { revoke: true });
        deletedIds.push(id);
      } catch {
        failedIds.push(id);
      }
    }

    return { deletedIds, failedIds };
  }

  async sendManifest(input: {
    peerId: string;
    manifest: RemoteFileManifest;
  }): Promise<{ messageId: string }> {
    const buffer = serializeRemoteManifest(input.manifest);
    const caption = formatRemoteManifestCaption(input.manifest.fileId, input.manifest.sha256);
    const fileName = `manifest_${input.manifest.fileId}.json`;
    const file = new CustomFile(fileName, buffer.length, "", buffer);
    const attributes = [new Api.DocumentAttributeFilename({ fileName })];

    const result = await this.client.sendFile(input.peerId || "me", {
      file,
      caption,
      forceDocument: true,
      fileSize: buffer.length,
      attributes,
      workers: 1,
    });

    return { messageId: String(result.id) };
  }

  async downloadManifest(input: {
    peerId: string;
    messageId: string;
  }): Promise<RemoteFileManifest | null> {
    const numId = parseInt(input.messageId, 10);
    if (isNaN(numId)) return null;

    const messages = await this.client.getMessages(input.peerId || "me", { ids: [numId] });
    const message = messages[0];
    if (!message || !message.media) return null;

    const buffer = await this.client.downloadMedia(message);
    if (!buffer || !(buffer instanceof Buffer)) return null;

    return deserializeRemoteManifest(buffer);
  }

  async logOut(): Promise<void> {
    if (this.client.connected) {
      await this.client.invoke(new Api.auth.LogOut());
    }
  }

  saveSession(): string | null {
    if (!(this.client.session instanceof StringSession)) {
      return null;
    }
    const saved = this.client.session.save();
    return saved.length > 0 ? saved : null;
  }

  async destroy(): Promise<void> {
    try {
      await this.client.destroy();
    } catch {
      // The socket may already be closed.
    }
  }
}

export function createGramJsClient(options: GramJsClientOptions): ManagedTelegramClient {
  return new GramJsTelegramClient(options);
}

export function toTelegramUser(user: Api.TypeUser): TelegramUserProfile {
  if (!(user instanceof Api.User)) {
    throw new ServiceUnavailableError("Telegram did not return a user account");
  }
  return {
    id: String(user.id),
    username: user.username ?? null,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    phone: user.phone ?? null,
  };
}

export function toMessageSummary(message: Api.Message): TelegramMessageSummary {
  let hasDocument = false;
  let documentSize: number | undefined;
  let documentFilename: string | undefined;

  if (
    message.media instanceof Api.MessageMediaDocument &&
    message.media.document instanceof Api.Document
  ) {
    hasDocument = true;
    documentSize = Number(message.media.document.size);
    if (message.media.document.attributes) {
      for (const attr of message.media.document.attributes) {
        if (attr instanceof Api.DocumentAttributeFilename) {
          documentFilename = attr.fileName;
          break;
        }
      }
    }
  }

  return {
    id: String(message.id),
    caption: message.message || "",
    hasDocument,
    documentSize,
    documentFilename,
    date: message.date,
  };
}
