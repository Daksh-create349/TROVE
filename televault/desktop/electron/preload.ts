import { contextBridge, ipcRenderer } from "electron";
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

async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const res = (await ipcRenderer.invoke("api:request", endpoint, options)) as {
    ok: boolean;
    data?: T;
    error?: { code: string; message: string; details?: unknown };
  };

  if (!res.ok) {
    const error = new Error(res.error?.message || "Request failed");
    (error as unknown as { code?: string; details?: unknown }).code =
      res.error?.code;
    (error as unknown as { code?: string; details?: unknown }).details =
      res.error?.details;
    throw error;
  }

  return res.data as T;
}

const televaultApi = {
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  },
  dialog: {
    selectFiles: (options?: {
      multi?: boolean;
      filters?: { name: string; extensions: string[] }[];
    }) => ipcRenderer.invoke("dialog:select-files", options),
    selectFolder: () => ipcRenderer.invoke("dialog:select-folder"),
    selectUploadFolder: () => ipcRenderer.invoke("dialog:select-upload-folder"),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
  },
  platform: process.platform as "win32" | "darwin" | "linux",
  backend: {
    getInfo: () => ipcRenderer.invoke("backend:get-info"),
    getHealth: () => apiRequest<HealthStatus>("/api/health"),
  },
  telegram: {
    getStatus: () => apiRequest<TelegramStatus>("/api/telegram/status"),
    getProfile: () => apiRequest<TelegramProfile>("/api/telegram/profile"),
    startLogin: (phoneNumber: string, forceSMS = false) =>
      apiRequest<TelegramLoginStartResult>("/api/telegram/auth/start", {
        method: "POST",
        body: JSON.stringify({ phoneNumber, forceSMS: Boolean(forceSMS) }),
      }),
    verifyCode: (code: string) =>
      apiRequest<TelegramLoginCodeResult>("/api/telegram/auth/verify", {
        method: "POST",
        body: JSON.stringify({ code }),
      }),
    verifyPassword: (password: string) =>
      apiRequest<TelegramStatus>("/api/telegram/auth/verify-password", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    disconnect: () =>
      apiRequest<{ disconnected: boolean }>("/api/telegram/disconnect", {
        method: "POST",
      }),
    reconnect: () =>
      apiRequest<{ reconnected: boolean; status: TelegramStatus }>("/api/telegram/reconnect", {
        method: "POST",
      }),
    saveCredentials: (apiId: number, apiHash: string) =>
      ipcRenderer.invoke("telegram:save-credentials", apiId, apiHash) as Promise<{ success: boolean }>,
  },
  files: {
    list: (params?: {
      folderId?: string | null;
      status?: FileStatus;
      search?: string;
      limit?: number;
      offset?: number;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.folderId) searchParams.set("folderId", params.folderId);
      if (params?.status) searchParams.set("status", params.status);
      if (params?.search) searchParams.set("search", params.search);
      if (params?.limit !== undefined)
        searchParams.set("limit", String(params.limit));
      if (params?.offset !== undefined)
        searchParams.set("offset", String(params.offset));

      const query = searchParams.toString();
      return apiRequest<Paginated<FileMetadata>>(
        `/api/files${query ? `?${query}` : ""}`,
      );
    },
    get: (id: string) => apiRequest<FileMetadata>(`/api/files/${id}`),
    getParts: (id: string) => apiRequest<FilePart[]>(`/api/files/${id}/parts`),
    delete: (id: string) =>
      apiRequest<FileDeletionResult>(`/api/files/${id}`, {
        method: "DELETE",
      }),
    getDownloadUrl: (id: string) => {
      let token = "";
      try {
        token = ipcRenderer.sendSync("backend:get-token-sync") || "";
      } catch {
        // fallback
      }
      const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
      return `http://127.0.0.1:4787/api/files/${id}/download${tokenParam}`;
    },
    getPreviewUrl: (id: string) => {
      let token = "";
      try {
        token = ipcRenderer.sendSync("backend:get-token-sync") || "";
      } catch {
        // fallback
      }
      const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
      return `http://127.0.0.1:4787/api/files/${id}/preview${tokenParam}`;
    },
    downloadToPath: async (
      fileId: string,
      targetDirectory?: string,
      targetFilename?: string,
    ) => {
      const res = await apiRequest<{ job: DownloadJob; file: FileMetadata }>(
        "/api/downloads",
        {
          method: "POST",
          body: JSON.stringify({
            fileId,
            targetDirectory,
            targetFilename,
          }),
        },
      );
      return res.job;
    },
  },
  folders: {
    list: () => apiRequest<Folder[]>("/api/folders"),
    create: (name: string, parentId?: string | null) =>
      apiRequest<Folder>("/api/folders", {
        method: "POST",
        body: JSON.stringify({ name, parentId: parentId || null }),
      }),
  },
  uploads: {
    create: (payload: {
      filePath: string;
      originalFilename?: string;
      folderId?: string | null;
      customSegmentSize?: number;
    }) =>
      apiRequest<UploadJobDetail>("/api/uploads", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    createFromPaths: (filePaths: string[], folderId?: string | null) =>
      ipcRenderer.invoke(
        "uploads:from-paths",
        filePaths,
        folderId || null,
      ) as Promise<UploadJobDetail[]>,
    list: (params?: {
      status?: JobStatus;
      fileId?: string;
      limit?: number;
      offset?: number;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.status) searchParams.set("status", params.status);
      if (params?.fileId) searchParams.set("fileId", params.fileId);
      if (params?.limit !== undefined)
        searchParams.set("limit", String(params.limit));
      if (params?.offset !== undefined)
        searchParams.set("offset", String(params.offset));

      const query = searchParams.toString();
      return apiRequest<Paginated<UploadJob>>(
        `/api/uploads${query ? `?${query}` : ""}`,
      );
    },
    get: (id: string) => apiRequest<UploadJobDetail>(`/api/uploads/${id}`),
    pause: (id: string) =>
      apiRequest<UploadJob>(`/api/uploads/${id}/pause`, { method: "POST" }),
    resume: (id: string) =>
      apiRequest<UploadJob>(`/api/uploads/${id}/resume`, { method: "POST" }),
    cancel: (id: string) =>
      apiRequest<UploadJob>(`/api/uploads/${id}/cancel`, { method: "POST" }),
    progress: (id: string) =>
      apiRequest<UploadProgress>(`/api/uploads/${id}/progress`),
  },
  downloads: {
    create: (payload: {
      fileId: string;
      targetDirectory?: string;
      targetFilename?: string;
    }) =>
      apiRequest<{ job: DownloadJob; file: FileMetadata }>("/api/downloads", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    list: (params?: {
      status?: JobStatus;
      fileId?: string;
      limit?: number;
      offset?: number;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.status) searchParams.set("status", params.status);
      if (params?.fileId) searchParams.set("fileId", params.fileId);
      if (params?.limit !== undefined)
        searchParams.set("limit", String(params.limit));
      if (params?.offset !== undefined)
        searchParams.set("offset", String(params.offset));

      const query = searchParams.toString();
      return apiRequest<Paginated<DownloadJob>>(
        `/api/downloads${query ? `?${query}` : ""}`,
      );
    },
    get: (id: string) => apiRequest<DownloadJobDetail>(`/api/downloads/${id}`),
    pause: (id: string) =>
      apiRequest<DownloadJob>(`/api/downloads/${id}/pause`, { method: "POST" }),
    resume: (id: string) =>
      apiRequest<DownloadJob>(`/api/downloads/${id}/resume`, {
        method: "POST",
      }),
    cancel: (id: string) =>
      apiRequest<DownloadJob>(`/api/downloads/${id}/cancel`, {
        method: "POST",
      }),
    progress: (id: string) =>
      apiRequest<DownloadProgress>(`/api/downloads/${id}/progress`),
  },
  storage: {
    getStats: () => apiRequest<StorageStats>("/api/storage/stats"),
    sync: () =>
      apiRequest<StorageSyncStatus>("/api/storage/sync", { method: "POST" }),
    getSyncStatus: () =>
      apiRequest<StorageSyncStatus>("/api/storage/sync/status"),
  },
  profile: {
    get: () => apiRequest<AppProfile | null>("/api/app/profile"),
    save: (displayName: string) =>
      apiRequest<AppProfile>("/api/app/profile", {
        method: "POST",
        body: JSON.stringify({ displayName }),
      }),
    setLocalPassword: (password: string) =>
      ipcRenderer.invoke("profile:set-password", password),
    verifyLocalPassword: (password: string) =>
      ipcRenderer.invoke("profile:verify-password", password),
    hasLocalPassword: () => ipcRenderer.invoke("profile:has-password"),
  },
};

contextBridge.exposeInMainWorld("televault", televaultApi);
