import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  DownloadJob,
  DownloadProgress,
  UploadJob,
  UploadProgress,
} from "@shared/types";
import { useApp } from "./AppContext";

export interface ActiveTransferItem {
  id: string;
  type: "upload" | "download";
  fileId: string;
  filename: string;
  status: string;
  progressBytes: number;
  totalBytes: number;
  percentage: number;
  currentSegment: number;
  totalSegments: number;
  speedBytesPerSec: number;
  estimatedRemainingSeconds?: number;
  error?: string | null;
}

export interface BatchUploadStats {
  isActive: boolean;
  isPaused: boolean;
  totalFiles: number;
  completedFiles: number;
  progressBytes: number;
  totalBytes: number;
  percentage: number;
  currentFilename: string;
  speedBytesPerSec: number;
}

interface TransferContextValue {
  uploads: UploadJob[];
  downloads: DownloadJob[];
  activeTransfers: ActiveTransferItem[];
  activeCount: number;
  batchUploadStats: BatchUploadStats;
  isTransfersOpen: boolean;
  setIsTransfersOpen: (open: boolean) => void;
  toggleTransfers: () => void;
  startUploadsFromPaths: (paths: string[]) => Promise<void>;
  startUploadFolder: () => Promise<void>;
  pauseUpload: (id: string) => Promise<void>;
  resumeUpload: (id: string) => Promise<void>;
  cancelUpload: (id: string) => Promise<void>;
  pauseAllUploads: () => Promise<void>;
  resumeAllUploads: () => Promise<void>;
  cancelAllUploads: () => Promise<void>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  cancelDownload: (id: string) => Promise<void>;
  refreshTransfers: () => Promise<void>;
}

const TransferContext = createContext<TransferContextValue | null>(null);

export function TransferProvider({ children }: { children: React.ReactNode }) {
  const { currentFolderId, addToast, refreshFiles, refreshStats, refreshFolders } = useApp();
  const [uploads, setUploads] = useState<UploadJob[]>([]);
  const [downloads, setDownloads] = useState<DownloadJob[]>([]);
  const [uploadProgressMap, setUploadProgressMap] = useState<Record<string, UploadProgress>>({});
  const [downloadProgressMap, setDownloadProgressMap] = useState<Record<string, DownloadProgress>>({});
  const [isTransfersOpen, setIsTransfersOpen] = useState(false);

  // Reference to track whether transfers are active without causing re-render loops
  const hasActiveTransfersRef = useRef(false);
  const isPollingRef = useRef(false);

  const refreshTransfers = useCallback(async () => {
    try {
      if (!window.televault) return;
      const [upList, downList] = await Promise.all([
        window.televault.uploads.list({ limit: 50 }).catch(() => ({ items: [], pagination: { total: 0, limit: 50, offset: 0, hasMore: false } })),
        window.televault.downloads.list({ limit: 50 }).catch(() => ({ items: [], pagination: { total: 0, limit: 50, offset: 0, hasMore: false } })),
      ]);
      const upItems = Array.isArray(upList?.items) ? upList.items : [];
      const downItems = Array.isArray(downList?.items) ? downList.items : [];

      setUploads(upItems);
      setDownloads(downItems);

      const hasActive =
        upItems.some((u) => u.status === "processing" || u.status === "queued") ||
        downItems.some((d) => d.status === "processing" || d.status === "queued");
      hasActiveTransfersRef.current = hasActive;
    } catch {
      // silent
    }
  }, []);

  // Battery-efficient polling loop: polls active progress only when jobs are active
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    let isCancelled = false;

    const tick = async () => {
      if (isCancelled || isPollingRef.current) return;
      isPollingRef.current = true;

      try {
        if (!window.televault) return;

        // 1. Fetch updated jobs list
        const [upList, downList] = await Promise.all([
          window.televault.uploads.list({ limit: 50 }).catch(() => null),
          window.televault.downloads.list({ limit: 50 }).catch(() => null),
        ]);

        if (isCancelled) return;

        const upItems: UploadJob[] = Array.isArray(upList?.items) ? upList.items : [];
        const downItems: DownloadJob[] = Array.isArray(downList?.items) ? downList.items : [];

        setUploads(upItems);
        setDownloads(downItems);

        const activeUploads = upItems.filter(
          (u) => u.status === "processing" || u.status === "queued",
        );
        const activeDownloads = downItems.filter(
          (d) => d.status === "processing" || d.status === "queued",
        );

        hasActiveTransfersRef.current = activeUploads.length > 0 || activeDownloads.length > 0;

        // 2. Fetch detailed chunk progress for active items
        if (activeUploads.length > 0) {
          const upProgresses = await Promise.all(
            activeUploads.map((j) => window.televault.uploads.progress(j.id).catch(() => null)),
          );
          if (!isCancelled) {
            setUploadProgressMap((prev) => {
              const next = { ...prev };
              for (const p of upProgresses) {
                if (p) next[p.jobId] = p;
              }
              return next;
            });
          }
        }

        if (activeDownloads.length > 0) {
          const downProgresses = await Promise.all(
            activeDownloads.map((j) => window.televault.downloads.progress(j.id).catch(() => null)),
          );
          if (!isCancelled) {
            setDownloadProgressMap((prev) => {
              const next = { ...prev };
              for (const p of downProgresses) {
                if (p) next[p.jobId] = p;
              }
              return next;
            });
          }
        }
      } catch {
        // silent
      } finally {
        isPollingRef.current = false;
        if (!isCancelled) {
          // If transfers are active, poll smoothly every 1200ms; when idle, conserve battery and poll every 8000ms
          const delay = hasActiveTransfersRef.current ? 1200 : 8000;
          timer = setTimeout(tick, delay);
        }
      }
    };

    // Initial check
    tick();

    return () => {
      isCancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []); // Run once on mount! Zero infinite loops.

  const startUploadsFromPaths = useCallback(
    async (paths: string[]) => {
      if (!paths || paths.length === 0 || !window.televault) return;
      try {
        hasActiveTransfersRef.current = true;
        addToast({
          type: "info",
          title: "Starting upload",
          message: `Queuing ${paths.length} file(s)...`,
        });
        await window.televault.uploads.createFromPaths(paths, currentFolderId);
        await refreshTransfers();
        await refreshFolders();
        await refreshFiles();
        await refreshStats();
      } catch (err) {
        addToast({
          type: "error",
          title: "Upload failed",
          message: (err as Error).message,
        });
      }
    },
    [currentFolderId, addToast, refreshTransfers, refreshFolders, refreshFiles, refreshStats],
  );

  const startUploadFolder = useCallback(async () => {
    if (!window.televault) return;
    try {
      const folderPath = await window.televault.dialog.selectUploadFolder();
      if (!folderPath) return;
      await startUploadsFromPaths([folderPath]);
    } catch (err) {
      addToast({
        type: "error",
        title: "Folder upload failed",
        message: (err as Error).message,
      });
    }
  }, [startUploadsFromPaths, addToast]);

  const pauseUpload = useCallback(
    async (id: string) => {
      try {
        if (!window.televault) return;
        await window.televault.uploads.pause(id);
        await refreshTransfers();
      } catch (err) {
        addToast({ type: "error", title: "Pause failed", message: (err as Error).message });
      }
    },
    [refreshTransfers, addToast],
  );

  const resumeUpload = useCallback(
    async (id: string) => {
      try {
        if (!window.televault) return;
        hasActiveTransfersRef.current = true;
        await window.televault.uploads.resume(id);
        await refreshTransfers();
      } catch (err) {
        addToast({ type: "error", title: "Resume failed", message: (err as Error).message });
      }
    },
    [refreshTransfers, addToast],
  );

  const cancelUpload = useCallback(
    async (id: string) => {
      try {
        if (!window.televault) return;
        await window.televault.uploads.cancel(id);
        await refreshTransfers();
        await refreshFiles();
        await refreshStats();
      } catch (err) {
        addToast({ type: "error", title: "Cancel failed", message: (err as Error).message });
      }
    },
    [refreshTransfers, refreshFiles, refreshStats, addToast],
  );

  const pauseAllUploads = useCallback(async () => {
    try {
      if (!window.televault) return;
      const active = uploads.filter((u) => u.status === "processing" || u.status === "queued");
      for (const u of active) {
        await window.televault.uploads.pause(u.id).catch(() => {});
      }
      await refreshTransfers();
      addToast({ type: "info", title: "Uploads paused", message: "In-flight uploads paused." });
    } catch (err) {
      addToast({ type: "error", title: "Pause failed", message: (err as Error).message });
    }
  }, [uploads, refreshTransfers, addToast]);

  const resumeAllUploads = useCallback(async () => {
    try {
      if (!window.televault) return;
      hasActiveTransfersRef.current = true;
      const paused = uploads.filter((u) => u.status === "paused");
      for (const u of paused) {
        await window.televault.uploads.resume(u.id).catch(() => {});
      }
      await refreshTransfers();
      addToast({ type: "info", title: "Uploads resumed", message: "Resumed uploads." });
    } catch (err) {
      addToast({ type: "error", title: "Resume failed", message: (err as Error).message });
    }
  }, [uploads, refreshTransfers, addToast]);

  const cancelAllUploads = useCallback(async () => {
    try {
      if (!window.televault) return;
      const uncompleted = uploads.filter(
        (u) => u.status === "processing" || u.status === "queued" || u.status === "paused",
      );
      for (const u of uncompleted) {
        await window.televault.uploads.cancel(u.id).catch(() => {});
      }
      hasActiveTransfersRef.current = false;
      await refreshTransfers();
      await refreshFiles();
      await refreshStats();
      addToast({ type: "info", title: "Uploads cancelled", message: "Cancelled remaining uploads." });
    } catch (err) {
      addToast({ type: "error", title: "Cancel failed", message: (err as Error).message });
    }
  }, [uploads, refreshTransfers, refreshFiles, refreshStats, addToast]);

  const pauseDownload = useCallback(
    async (id: string) => {
      try {
        if (!window.televault) return;
        await window.televault.downloads.pause(id);
        await refreshTransfers();
      } catch (err) {
        addToast({ type: "error", title: "Pause failed", message: (err as Error).message });
      }
    },
    [refreshTransfers, addToast],
  );

  const resumeDownload = useCallback(
    async (id: string) => {
      try {
        if (!window.televault) return;
        hasActiveTransfersRef.current = true;
        await window.televault.downloads.resume(id);
        await refreshTransfers();
      } catch (err) {
        addToast({ type: "error", title: "Resume failed", message: (err as Error).message });
      }
    },
    [refreshTransfers, addToast],
  );

  const cancelDownload = useCallback(
    async (id: string) => {
      try {
        if (!window.televault) return;
        await window.televault.downloads.cancel(id);
        await refreshTransfers();
      } catch (err) {
        addToast({ type: "error", title: "Cancel failed", message: (err as Error).message });
      }
    },
    [refreshTransfers, addToast],
  );

  // Compute normalized active transfer items
  const activeTransfers: ActiveTransferItem[] = useMemo(() => {
    const list: ActiveTransferItem[] = [];
    const safeUploads = Array.isArray(uploads) ? uploads : [];
    const safeDownloads = Array.isArray(downloads) ? downloads : [];

    for (const up of safeUploads) {
      const prog = uploadProgressMap[up.id];
      list.push({
        id: up.id,
        type: "upload",
        fileId: up.fileId,
        filename: `Upload: ${up.fileId.substring(0, 8)}...`,
        status: up.status,
        progressBytes: prog ? prog.progressBytes : up.progressBytes,
        totalBytes: prog ? prog.totalBytes : up.progressBytes,
        percentage: prog ? prog.progressPercentage : up.status === "completed" ? 100 : 0,
        currentSegment: prog ? prog.currentSegmentIndex + 1 : 0,
        totalSegments: prog ? prog.totalSegments : 1,
        speedBytesPerSec: 0,
        error: up.lastError,
      });
    }

    for (const down of safeDownloads) {
      const prog = downloadProgressMap[down.id];
      list.push({
        id: down.id,
        type: "download",
        fileId: down.fileId,
        filename: down.targetFilename || `Download: ${down.fileId.substring(0, 8)}...`,
        status: down.status,
        progressBytes: prog ? prog.progressBytes : down.progressBytes,
        totalBytes: prog ? prog.totalBytes : down.progressBytes,
        percentage: prog ? prog.progressPercentage : down.status === "completed" ? 100 : 0,
        currentSegment: prog ? prog.currentSegmentIndex + 1 : 0,
        totalSegments: prog ? prog.totalSegments : 1,
        speedBytesPerSec: 0,
        error: down.lastError,
      });
    }

    return list;
  }, [uploads, downloads, uploadProgressMap, downloadProgressMap]);

  // Aggregate Batch Upload Stats
  const batchUploadStats: BatchUploadStats = useMemo(() => {
    const activeOrPaused = uploads.filter(
      (u) => u.status === "processing" || u.status === "queued" || u.status === "paused",
    );
    const completed = uploads.filter((u) => u.status === "completed");
    const isPaused = activeOrPaused.length > 0 && activeOrPaused.every((u) => u.status === "paused");
    const isActive = activeOrPaused.length > 0;

    let totalBytes = 0;
    let progressBytes = 0;
    let currentFilename = "";

    for (const u of activeOrPaused) {
      const prog = uploadProgressMap[u.id];
      const tot = prog?.totalBytes || u.progressBytes || 1;
      const cur = prog?.progressBytes || u.progressBytes || 0;
      totalBytes += tot;
      progressBytes += Math.min(cur, tot);
      if (u.status === "processing" && !currentFilename) {
        currentFilename = u.fileId ? `File ${u.fileId.substring(0, 8)}...` : "";
      }
    }

    const percentage =
      totalBytes > 0 ? Math.min(100, Math.round((progressBytes / totalBytes) * 100)) : 0;

    return {
      isActive,
      isPaused,
      totalFiles: activeOrPaused.length + completed.length,
      completedFiles: completed.length,
      progressBytes,
      totalBytes,
      percentage,
      currentFilename,
      speedBytesPerSec: 0,
    };
  }, [uploads, uploadProgressMap]);

  const activeCount =
    uploads.filter((u) => u.status === "processing" || u.status === "queued").length +
    downloads.filter((d) => d.status === "processing" || d.status === "queued").length;

  const value: TransferContextValue = {
    uploads,
    downloads,
    activeTransfers,
    activeCount,
    batchUploadStats,
    isTransfersOpen,
    setIsTransfersOpen,
    toggleTransfers: () => setIsTransfersOpen((prev) => !prev),
    startUploadsFromPaths,
    startUploadFolder,
    pauseUpload,
    resumeUpload,
    cancelUpload,
    pauseAllUploads,
    resumeAllUploads,
    cancelAllUploads,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    refreshTransfers,
  };

  return <TransferContext.Provider value={value}>{children}</TransferContext.Provider>;
}

export function useTransfers() {
  const context = useContext(TransferContext);
  if (!context) {
    throw new Error("useTransfers must be used within a TransferProvider");
  }
  return context;
}

