/**
 * TeleVault shared API contracts.
 *
 * These types are the single source of truth for the HTTP layer and are
 * consumed by the backend now and by the desktop client in a later phase.
 * They contain metadata only: never Telegram credentials or session strings.
 */

export const FILE_STATUSES = [
  "queued",
  "processing",
  "paused",
  "failed",
  "completed",
] as const;

export type FileStatus = (typeof FILE_STATUSES)[number];

export const JOB_STATUSES = [
  "queued",
  "processing",
  "paused",
  "failed",
  "completed",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface Paginated<T> {
  items: T[];
  pagination: Pagination;
}

export interface AppProfile {
  id: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FileMetadata {
  id: string;
  folderId: string | null;
  originalFilename: string;
  mimeType: string;
  totalSize: number;
  sha256: string | null;
  partCount: number;
  telegramPeerId: string | null;
  telegramMessageIds: string[];
  status: FileStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FilePart {
  id: string;
  fileId: string;
  partIndex: number;
  partSize: number;
  sha256: string | null;
  telegramMessageId: string | null;
  status: FileStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UploadJob {
  id: string;
  fileId: string;
  status: JobStatus;
  progressBytes: number;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface UploadProgress {
  jobId: string;
  fileId: string;
  status: JobStatus;
  progressBytes: number;
  totalBytes: number;
  progressPercentage: number;
  currentSegmentIndex: number;
  totalSegments: number;
  currentSegmentProgressBytes: number;
  currentSegmentTotalBytes: number;
  attempts: number;
  lastError: string | null;
}

export interface UploadJobDetail {
  job: UploadJob;
  file: FileMetadata;
  parts: FilePart[];
}

export interface DownloadJob {
  id: string;
  fileId: string;
  status: JobStatus;
  progressBytes: number;
  attempts: number;
  lastError: string | null;
  targetDirectory: string | null;
  targetFilename: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface DownloadProgress {
  jobId: string;
  fileId: string;
  status: JobStatus;
  progressBytes: number;
  totalBytes: number;
  progressPercentage: number;
  currentSegmentIndex: number;
  totalSegments: number;
  currentSegmentProgressBytes: number;
  currentSegmentTotalBytes: number;
  attempts: number;
  lastError: string | null;
}

export interface DownloadJobDetail {
  job: DownloadJob;
  file: FileMetadata;
  parts: FilePart[];
}

export interface StorageSyncStatus {
  isSyncing: boolean;
  lastSyncedAt: string | null;
  scannedMessagesCount: number;
  importedFilesCount: number;
  reconstructedPartsCount: number;
  missingSegmentsCount: number;
  lastError: string | null;
}

export interface FileDeletionResult {
  fileId: string;
  deleted: boolean;
  deletedTelegramMessages: string[];
  failedTelegramMessages: string[];
}

export interface StorageStats {
  totalFiles: number;
  totalBytes: number;
  completedFiles: number;
  failedFiles: number;
  totalParts: number;
  filesByStatus: Record<FileStatus, number>;
  databaseBytes: number;
  dataDirectoryBytes: number;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
}

export type TelegramConnectionState =
  | "unconfigured"
  | "disconnected"
  | "connecting"
  | "awaiting_code"
  | "awaiting_password"
  | "connected"
  | "error";

export interface TelegramAccountSummary {
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface TelegramStatus {
  configured: boolean;
  state: TelegramConnectionState;
  sessionStored: boolean;
  account: TelegramAccountSummary | null;
  lastConnectedAt: string | null;
  lastError: string | null;
}

export interface TelegramProfile {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  savedMessagesPeerId: string | null;
}

export interface TelegramLoginStartResult {
  isCodeViaApp: boolean;
}

export interface TelegramLoginCodeResult {
  state: TelegramConnectionState;
  requiresPassword: boolean;
  account?: TelegramAccountSummary | null;
}

export interface HealthStatus {
  status: "ok";
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  database: {
    status: "ok";
    schemaVersion: number;
    fileSizeBytes: number;
  };
}
