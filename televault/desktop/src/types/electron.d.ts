import type {
  AppProfile,
  DownloadJob,
  DownloadJobDetail,
  DownloadProgress,
  FileDeletionResult,
  FileMetadata,
  FilePart,
  FileStatus,
  Folder,
  HealthStatus,
  JobStatus,
  Paginated,
  StorageStats,
  StorageSyncStatus,
  TelegramLoginCodeResult,
  TelegramLoginStartResult,
  TelegramProfile,
  TelegramStatus,
  UploadJob,
  UploadJobDetail,
  UploadProgress,
} from "@shared/types";

export interface TelevaultApi {
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };
  dialog: {
    selectFiles: (options?: {
      multi?: boolean;
      filters?: { name: string; extensions: string[] }[];
    }) => Promise<string[] | null>;
    selectFolder: () => Promise<string | null>;
    selectUploadFolder: () => Promise<string | null>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  platform: "win32" | "darwin" | "linux";
  backend: {
    getInfo: () => Promise<{ isReady: boolean; url: string; port: number }>;
    getHealth: () => Promise<HealthStatus>;
  };
  telegram: {
    getStatus: () => Promise<TelegramStatus>;
    getProfile: () => Promise<TelegramProfile>;
    startLogin: (phoneNumber: string, forceSMS?: boolean) => Promise<TelegramLoginStartResult>;
    verifyCode: (code: string) => Promise<TelegramLoginCodeResult>;
    verifyPassword: (password: string) => Promise<TelegramProfile>;
    disconnect: () => Promise<{ disconnected: boolean }>;
    reconnect: () => Promise<{ reconnected: boolean; status: TelegramStatus }>;
    saveCredentials: (apiId: number, apiHash: string) => Promise<{ success: boolean }>;
  };
  files: {
    list: (params?: {
      folderId?: string | null;
      status?: FileStatus;
      search?: string;
      limit?: number;
      offset?: number;
    }) => Promise<Paginated<FileMetadata>>;
    get: (id: string) => Promise<FileMetadata>;
    getParts: (id: string) => Promise<FilePart[]>;
    delete: (id: string) => Promise<FileDeletionResult>;
    getDownloadUrl: (id: string) => string;
    getPreviewUrl: (id: string) => string;
    downloadToPath: (
      fileId: string,
      targetDirectory?: string,
      targetFilename?: string,
    ) => Promise<DownloadJob>;
  };
  folders: {
    list: () => Promise<Folder[]>;
    create: (name: string, parentId?: string | null) => Promise<Folder>;
  };
  uploads: {
    create: (payload: {
      filePath: string;
      originalFilename?: string;
      folderId?: string | null;
      customSegmentSize?: number;
    }) => Promise<UploadJobDetail>;
    createFromPaths: (
      filePaths: string[],
      folderId?: string | null,
    ) => Promise<UploadJobDetail[]>;
    list: (params?: {
      status?: JobStatus;
      fileId?: string;
      limit?: number;
      offset?: number;
    }) => Promise<Paginated<UploadJob>>;
    get: (id: string) => Promise<UploadJobDetail>;
    pause: (id: string) => Promise<UploadJob>;
    resume: (id: string) => Promise<UploadJob>;
    cancel: (id: string) => Promise<UploadJob>;
    progress: (id: string) => Promise<UploadProgress>;
  };
  downloads: {
    create: (payload: {
      fileId: string;
      targetDirectory?: string;
      targetFilename?: string;
    }) => Promise<{ job: DownloadJob; file: FileMetadata }>;
    list: (params?: {
      status?: JobStatus;
      fileId?: string;
      limit?: number;
      offset?: number;
    }) => Promise<Paginated<DownloadJob>>;
    get: (id: string) => Promise<DownloadJobDetail>;
    pause: (id: string) => Promise<DownloadJob>;
    resume: (id: string) => Promise<DownloadJob>;
    cancel: (id: string) => Promise<DownloadJob>;
    progress: (id: string) => Promise<DownloadProgress>;
  };
  storage: {
    getStats: () => Promise<StorageStats>;
    sync: () => Promise<StorageSyncStatus>;
    getSyncStatus: () => Promise<StorageSyncStatus>;
  };
  profile: {
    get: () => Promise<AppProfile | null>;
    save: (displayName: string) => Promise<AppProfile>;
    setLocalPassword: (password: string) => Promise<{ success: boolean }>;
    verifyLocalPassword: (password: string) => Promise<{ valid: boolean }>;
    hasLocalPassword: () => Promise<boolean>;
  };
}

declare global {
  interface Window {
    televault: TelevaultApi;
  }
}
