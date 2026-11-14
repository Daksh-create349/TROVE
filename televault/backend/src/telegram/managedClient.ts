import type { RemoteFileManifest } from "../uploads/manifest";

/**
 * The slice of a GramJS client TeleVault actually uses.
 *
 * The production adapter calls the installed GramJS methods. Tests supply
 * another implementation so the login state machine can be exercised without
 * opening a socket.
 */
export interface TelegramUserProfile {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

export interface SavedMessagesPeer {
  destination: "saved_messages";
  peerId: string;
}

export type SubmitCodeResult =
  | { requiresPassword: false; user: TelegramUserProfile }
  | { requiresPassword: true };

export interface UploadCapabilities {
  uploadMaxFileparts: number;
  partSize: number;
  maxSingleFileSize: number;
  safeSegmentSize: number;
  isPremium: boolean;
}

export interface UploadSegmentInput {
  peerId: string;
  fileName: string;
  filePath?: string;
  buffer?: Buffer;
  fileSize: number;
  caption: string;
  mimeType?: string;
  onProgress?: (progress: number) => void;
  abortSignal?: AbortSignal;
}

export interface UploadSegmentResult {
  messageId: string;
}

export interface DownloadSegmentInput {
  peerId?: string;
  messageId: string;
  targetPath: string;
  onProgress?: (ratio: number) => void;
  abortSignal?: AbortSignal;
}

export interface TelegramMessageSummary {
  id: string;
  caption: string;
  hasDocument: boolean;
  documentSize?: number;
  documentFilename?: string;
  date: number;
}

export interface ManagedTelegramClient {
  connect(): Promise<void>;
  isConnected(): boolean;
  checkAuthorization(): Promise<boolean>;
  sendCode(phoneNumber: string, forceSMS?: boolean): Promise<{
    phoneCodeHash: string;
    isCodeViaApp: boolean;
  }>;
  submitCode(input: {
    phoneNumber: string;
    phoneCodeHash: string;
    phoneCode: string;
  }): Promise<SubmitCodeResult>;
  submitPassword(password: string): Promise<TelegramUserProfile>;
  getMe(): Promise<TelegramUserProfile>;
  resolveSavedMessages(selfUserId: string): Promise<SavedMessagesPeer>;
  getUploadCapabilities(): Promise<UploadCapabilities>;
  uploadSegment(input: UploadSegmentInput): Promise<UploadSegmentResult>;
  downloadSegment(input: DownloadSegmentInput): Promise<{ size: number }>;
  getMessages(peerId: string, messageIds: string[]): Promise<TelegramMessageSummary[]>;
  iterMessages(
    peerId: string,
    options?: { limit?: number; offsetId?: string },
  ): Promise<TelegramMessageSummary[]>;
  deleteMessages(
    peerId: string,
    messageIds: string[],
  ): Promise<{ deletedIds: string[]; failedIds: string[] }>;
  sendManifest(input: {
    peerId: string;
    manifest: RemoteFileManifest;
  }): Promise<{ messageId: string }>;
  downloadManifest(input: {
    peerId: string;
    messageId: string;
  }): Promise<RemoteFileManifest | null>;
  logOut(): Promise<void>;
  saveSession(): string | null;
  destroy(): Promise<void>;
}

export type TelegramClientFactory = (session: string) => ManagedTelegramClient;

/** GramJS reports this when the phone exists but has not registered an account. */
export class TelegramSignupRequiredError extends Error {
  constructor() {
    super("Telegram account signup is required");
    this.name = "TelegramSignupRequiredError";
  }
}
