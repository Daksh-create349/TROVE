import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  FileMetadata,
  Folder,
  StorageStats,
  StorageSyncStatus,
  TelegramProfile,
  TelegramStatus,
} from "@shared/types";
import type {
  BreadcrumbItem,
  NavView,
  SortField,
  SortOrder,
  ToastMessage,
  ViewMode,
} from "../types";

interface AppContextValue {
  activeView: NavView;
  setActiveView: (view: NavView) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  currentFolderId: string | null;
  folderBreadcrumbs: BreadcrumbItem[];
  folders: Folder[];
  files: FileMetadata[];
  storageStats: StorageStats | null;
  telegramStatus: TelegramStatus | null;
  telegramProfile: TelegramProfile | null;
  syncStatus: StorageSyncStatus | null;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedFileIds: Set<string>;
  setSelectedFileIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  sortField: SortField;
  setSortField: (field: SortField) => void;
  sortOrder: SortOrder;
  setSortOrder: (order: SortOrder) => void;
  selectedTag: string | null;
  setSelectedTag: (tag: string | null) => void;
  isLoadingFiles: boolean;
  isSyncing: boolean;
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, "id">) => void;
  removeToast: (id: string) => void;
  previewFile: FileMetadata | null;
  openPreview: (file: FileMetadata) => void;
  closePreview: () => void;
  isSettingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  isSetupOpen: boolean;
  openSetup: () => void;
  closeSetup: () => void;
  navigateToFolder: (folderId: string | null, folderName?: string) => void;
  createFolder: (name: string) => Promise<Folder | null>;
  deleteFolder: (folderId: string, folderName?: string) => Promise<boolean>;
  deleteFile: (fileId: string) => Promise<boolean>;
  deleteMultipleFiles: (fileIds: string[]) => Promise<number>;
  downloadFile: (fileId: string, targetDirectory?: string) => Promise<void>;
  startSync: () => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshFiles: () => Promise<void>;
  refreshFolders: () => Promise<void>;
  refreshStats: () => Promise<void>;
  refreshTelegram: () => Promise<void>;
  reconnectTelegram: () => Promise<boolean>;
  isReconnecting: boolean;
  isOnline: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [activeView, setActiveView] = useState<NavView>("overview");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderBreadcrumbs, setFolderBreadcrumbs] = useState<BreadcrumbItem[]>([
    { id: null, name: "Trove Cloud Vault" },
  ]);

  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [telegramProfile, setTelegramProfile] = useState<TelegramProfile | null>(null);
  const [syncStatus, setSyncStatus] = useState<StorageSyncStatus | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const isReconnectingRef = useRef(false);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [previewFile, setPreviewFile] = useState<FileMetadata | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSetupOpen, setIsSetupOpen] = useState(false);

  const addToast = useCallback((toast: Omit<ToastMessage, "id">) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Safe guarded reconnect
  const reconnectTelegram = useCallback(async (): Promise<boolean> => {
    if (!window.televault?.telegram?.reconnect || isReconnectingRef.current) {
      return false;
    }
    isReconnectingRef.current = true;
    setIsReconnecting(true);
    try {
      const res = await window.televault.telegram.reconnect();
      if (res?.status) {
        setTelegramStatus(res.status);
      }
      if (res?.reconnected) {
        try {
          const profile = await window.televault.telegram.getProfile();
          if (profile) setTelegramProfile(profile);
        } catch {
          // not ready
        }
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      isReconnectingRef.current = false;
      setIsReconnecting(false);
    }
  }, []);

  // Telegram Status
  const refreshTelegram = useCallback(async () => {
    try {
      if (!window.televault) return;
      const status = await window.televault.telegram.getStatus();
      setTelegramStatus(status);
      if (status.state === "connected" || status.sessionStored) {
        try {
          const profile = await window.televault.telegram.getProfile();
          if (profile) setTelegramProfile(profile);
        } catch {
          // not ready
        }
        // If session is stored in SQLite but socket is idle/disconnected, auto-reconnect in background with guard
        if (
          status.sessionStored &&
          status.state === "disconnected" &&
          !isReconnectingRef.current
        ) {
          void reconnectTelegram();
        }
      } else {
        setTelegramProfile(null);
      }
    } catch {
      // Backend may be starting
    }
  }, [reconnectTelegram]);

  // Storage Stats
  const refreshStats = useCallback(async () => {
    try {
      if (!window.televault) return;
      const stats = await window.televault.storage.getStats();
      setStorageStats(stats);
      const sync = await window.televault.storage.getSyncStatus();
      setSyncStatus(sync);
    } catch {
      // silent
    }
  }, []);

  // Folders - keeps cached state if offline or network error
  const refreshFolders = useCallback(async () => {
    try {
      if (!window.televault) return;
      const list = await window.televault.folders.list();
      if (Array.isArray(list)) {
        setFolders(list);
      } else if (Array.isArray((list as any)?.items)) {
        setFolders((list as any).items);
      }
    } catch (err) {
      console.warn("Could not refresh vault folders:", err);
      // Retain existing cached folders
    }
  }, []);

  // Files - keeps cached state if offline or network error
  const refreshFiles = useCallback(async () => {
    try {
      if (!window.televault) return;
      setIsLoadingFiles(true);
      const res = await window.televault.files.list({
        folderId: currentFolderId,
        search: searchQuery.trim() || undefined,
        limit: 100,
      });
      if (Array.isArray(res?.items)) {
        setFiles(res.items);
      } else if (Array.isArray(res)) {
        setFiles(res);
      }
    } catch (err) {
      console.warn("Could not refresh vault files:", err);
      // Retain existing cached files
    } finally {
      setIsLoadingFiles(false);
    }
  }, [currentFolderId, searchQuery]);

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([
      refreshTelegram(),
      refreshStats(),
      refreshFolders(),
      refreshFiles(),
    ]);
  }, [refreshTelegram, refreshStats, refreshFolders, refreshFiles]);

  // Network offline / online detection
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      addToast({
        type: "success",
        title: "Internet Restored",
        message: "You are back online. Synchronizing Trove vault...",
      });
      reconnectTelegram().catch(() => {});
      refreshAll().catch(() => {});
    };

    const handleOffline = () => {
      setIsOnline(false);
      addToast({
        type: "warning",
        title: "No Internet Connection",
        message: "Working offline. Your cached files and folders remain safe and accessible.",
      });
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [addToast, reconnectTelegram, refreshAll]);

  // Initial load
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Periodic poll for background sync & telegram state
  useEffect(() => {
    const timer = setInterval(() => {
      refreshTelegram();
      refreshStats();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshTelegram, refreshStats]);

  // Setup wizard can be triggered manually via openSetup()

  const navigateToFolder = useCallback(
    (folderId: string | null, folderName?: string) => {
      setCurrentFolderId(folderId);
      setSelectedFileIds(new Set());
      if (folderId === null) {
        setFolderBreadcrumbs([{ id: null, name: "Trove Cloud Vault" }]);
      } else {
        const name = folderName || folders.find((f) => f.id === folderId)?.name || "Folder";
        setFolderBreadcrumbs((prev) => {
          const existingIdx = prev.findIndex((b) => b.id === folderId);
          if (existingIdx !== -1) {
            return prev.slice(0, existingIdx + 1);
          }
          return [...prev, { id: folderId, name }];
        });
      }
    },
    [folders],
  );

  const createFolder = useCallback(
    async (name: string): Promise<Folder | null> => {
      try {
        if (!window.televault) return null;
        const newFolder = await window.televault.folders.create(name, currentFolderId);
        await refreshFolders();
        addToast({
          type: "success",
          title: "Folder created",
          message: `Created "${name}"`,
        });
        return newFolder;
      } catch (err) {
        addToast({
          type: "error",
          title: "Failed to create folder",
          message: (err as Error).message,
        });
        return null;
      }
    },
    [currentFolderId, refreshFolders, addToast],
  );

  const deleteFolder = useCallback(
    async (folderId: string, folderName?: string): Promise<boolean> => {
      try {
        if (!window.televault) return false;
        await window.televault.folders.delete(folderId);
        addToast({
          type: "success",
          title: "Folder deleted",
          message: folderName ? `Deleted "${folderName}" and all contents` : "Folder deleted",
        });
        if (currentFolderId === folderId) {
          navigateToFolder(null);
        }
        await refreshFolders();
        await refreshFiles();
        await refreshStats();
        return true;
      } catch (err) {
        addToast({
          type: "error",
          title: "Failed to delete folder",
          message: (err as Error).message,
        });
        return false;
      }
    },
    [currentFolderId, navigateToFolder, refreshFolders, refreshFiles, refreshStats, addToast],
  );

  const deleteMultipleFiles = useCallback(
    async (fileIds: string[]): Promise<number> => {
      if (!window.televault || fileIds.length === 0) return 0;
      let count = 0;
      for (const id of fileIds) {
        try {
          const res = await window.televault.files.delete(id);
          if (res?.deleted) count++;
        } catch {
          // continue
        }
      }
      addToast({
        type: "success",
        title: "Files deleted",
        message: `Successfully deleted ${count} file(s) from vault`,
      });
      setSelectedFileIds(new Set());
      await refreshFiles();
      await refreshStats();
      return count;
    },
    [refreshFiles, refreshStats, setSelectedFileIds, addToast],
  );

  const deleteFile = useCallback(
    async (fileId: string): Promise<boolean> => {
      try {
        if (!window.televault) return false;
        const res = await window.televault.files.delete(fileId);
        if (res.deleted) {
          addToast({
            type: "success",
            title: "File deleted",
            message: "Removed file and associated Telegram messages",
          });
          await refreshFiles();
          await refreshStats();
          return true;
        }
        return false;
      } catch (err) {
        addToast({
          type: "error",
          title: "Deletion failed",
          message: (err as Error).message,
        });
        return false;
      }
    },
    [refreshFiles, refreshStats, addToast],
  );

  const downloadFile = useCallback(
    async (fileId: string, targetDirectory?: string) => {
      try {
        if (!window.televault) return;
        const dir = targetDirectory || (await window.televault.dialog.selectFolder());
        if (!dir) return;

        await window.televault.files.downloadToPath(fileId, dir);
        addToast({
          type: "info",
          title: "Download started",
          message: `Downloading to ${dir}`,
        });
      } catch (err) {
        addToast({
          type: "error",
          title: "Download failed to start",
          message: (err as Error).message,
        });
      }
    },
    [addToast],
  );

  const startSync = useCallback(async () => {
    try {
      if (!window.televault) return;
      setIsSyncing(true);
      addToast({
        type: "info",
        title: "Synchronization started",
        message: "Scanning Saved Messages for remote files...",
      });
      const res = await window.televault.storage.sync();
      setSyncStatus(res);
      await refreshAll();
      addToast({
        type: "success",
        title: "Synchronization complete",
        message: `Imported ${res.importedFilesCount} files (${res.scannedMessagesCount} scanned)`,
      });
    } catch (err) {
      addToast({
        type: "error",
        title: "Sync failed",
        message: (err as Error).message,
      });
    } finally {
      setIsSyncing(false);
    }
  }, [refreshAll, addToast]);

  const value: AppContextValue = {
    activeView,
    setActiveView,
    viewMode,
    setViewMode,
    currentFolderId,
    folderBreadcrumbs,
    folders,
    files,
    storageStats,
    telegramStatus,
    telegramProfile,
    syncStatus,
    searchQuery,
    setSearchQuery,
    selectedFileIds,
    setSelectedFileIds,
    sortField,
    setSortField,
    sortOrder,
    setSortOrder,
    selectedTag,
    setSelectedTag,
    isLoadingFiles,
    isSyncing,
    toasts,
    addToast,
    removeToast,
    previewFile,
    openPreview: (file) => setPreviewFile(file),
    closePreview: () => setPreviewFile(null),
    isSettingsOpen,
    openSettings: () => setIsSettingsOpen(true),
    closeSettings: () => setIsSettingsOpen(false),
    isSetupOpen,
    openSetup: () => setIsSetupOpen(true),
    closeSetup: () => setIsSetupOpen(false),
    navigateToFolder,
    createFolder,
    deleteFolder,
    deleteFile,
    deleteMultipleFiles,
    downloadFile,
    startSync,
    refreshAll,
    refreshFiles,
    refreshFolders,
    refreshStats,
    refreshTelegram,
    reconnectTelegram,
    isReconnecting,
    isOnline,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}

