/**
 * Backend-facing type barrel.
 *
 * The canonical API contracts live in `shared/types` so the future desktop
 * client can consume exactly the same definitions. This module re-exports them
 * for backend code and adds types that are internal to the service layer.
 */
export type {
  ApiFailure,
  ApiResponse,
  ApiSuccess,
  AppProfile,
  DownloadJob,
  FileMetadata,
  FilePart,
  FileStatus,
  Folder,
  HealthStatus,
  JobStatus,
  Paginated,
  Pagination,
  StorageStats,
  TelegramAccountSummary,
  TelegramConnectionState,
  TelegramLoginCodeResult,
  TelegramLoginStartResult,
  TelegramStatus,
  UploadJob,
} from "@shared/types";

import type { FileStatus } from "@shared/types";

/** Common pagination input for internal service calls. */
export interface PaginationInput {
  limit: number;
  offset: number;
}

/** Filters accepted by the file metadata listing service. */
export interface FileListFilters extends PaginationInput {
  folderId?: string | null;
  status?: FileStatus;
  search?: string;
}
