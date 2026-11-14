import type {
  AppProfile,
  DownloadJob,
  FileMetadata,
  FilePart,
  FileStatus,
  Folder,
  JobStatus,
  UploadJob,
} from "@shared/types";

export interface ProfileRow {
  id: string;
  singleton: number;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface FolderWithCountRow extends FolderRow {
  file_count: number;
}

export interface FileRow {
  id: string;
  folder_id: string | null;
  original_filename: string;
  mime_type: string;
  total_size: number;
  sha256: string | null;
  part_count: number;
  telegram_peer_id: string | null;
  telegram_message_ids: string;
  status: FileStatus;
  created_at: string;
  updated_at: string;
}

export interface FilePartRow {
  id: string;
  file_id: string;
  part_index: number;
  part_size: number;
  sha256: string | null;
  telegram_message_id: string | null;
  status: FileStatus;
  created_at: string;
  updated_at: string;
}

export interface UploadJobRow {
  id: string;
  file_id: string;
  status: JobStatus;
  progress_bytes: number;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface DownloadJobRow extends UploadJobRow {
  target_directory: string | null;
  target_filename: string | null;
}

export interface TelegramAccountRow {
  id: string;
  telegram_user_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  session_ciphertext: string;
  session_updated_at: string;
  status: "active" | "logged_out" | "error";
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export function parseTelegramMessageIds(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry): entry is string | number =>
          typeof entry === "string" || typeof entry === "number",
      )
      .map(String);
  } catch {
    return [];
  }
}

export function mapProfile(row: ProfileRow): AppProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapFolder(row: FolderWithCountRow): Folder {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    fileCount: row.file_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapFile(row: FileRow): FileMetadata {
  return {
    id: row.id,
    folderId: row.folder_id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    totalSize: row.total_size,
    sha256: row.sha256,
    partCount: row.part_count,
    telegramPeerId: row.telegram_peer_id,
    telegramMessageIds: parseTelegramMessageIds(row.telegram_message_ids),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapFilePart(row: FilePartRow): FilePart {
  return {
    id: row.id,
    fileId: row.file_id,
    partIndex: row.part_index,
    partSize: row.part_size,
    sha256: row.sha256,
    telegramMessageId: row.telegram_message_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapUploadJob(row: UploadJobRow): UploadJob {
  return {
    id: row.id,
    fileId: row.file_id,
    status: row.status,
    progressBytes: row.progress_bytes,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function mapDownloadJob(row: DownloadJobRow): DownloadJob {
  return {
    id: row.id,
    fileId: row.file_id,
    status: row.status,
    progressBytes: row.progress_bytes,
    attempts: row.attempts,
    lastError: row.last_error,
    targetDirectory: row.target_directory,
    targetFilename: row.target_filename,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}
