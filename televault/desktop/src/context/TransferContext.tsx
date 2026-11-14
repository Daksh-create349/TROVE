import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

interface TransferContextValue {
  uploads: UploadJob[];
  downloads: DownloadJob[];
  activeTransfers: ActiveTransferItem[];
  activeCount: number;
  isTransfersOpen: boolean;
  setIsTransfersOpen: (open: boolean) => void;
  toggleTransfers: () => void;
  startUploadsFromPaths: (paths: string[]) => Promise<void>;
  startUploadFolder: () => Promise<void>;
  pauseUpload: (id: string) => Promise<void>;
  resumeUpload: (id: string) => Promise<void>;
  cancelUpload: (id: string) => Promise<void>;
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

  const refreshTransfers = useCallback(async () => {
    try {
      if (!window.televault) return;
      const [upList, downList] = await Promise.all([
        window.televault.uploads.list({ limit: 30 }).catch(() => ({ items: [], pagination: { total: 0, limit: 30, offset: 0, hasMore: false } })),
        window.televault.downloads.list({ limit: 30 }).catch(() => ({ items: [], pagination: { total: 0, limit: 30, offset: 0, hasMore: false } })),
      ]);
      setUploads(Array.isArray(upList?.items) ? upList.items : Array.isArray(upList) ? upList : []);
      setDownloads(Array.isArray(downList?.items) ? downList.items : Array.isArray(downList) ? downList : []);
    } catch {
      setUploads([]);
      setDownloads([]);
    }
  }, []);

  // Poll active job progress
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    const poll = async () => {
      try {
        if (!window.televault) return;
        const safeUploads = Array.isArray(uploads) ? uploads : [];
        const safeDownloads = Array.isArray(downloads) ? downloads : [];

        const activeUploadJobs = safeUploads.filter(
          (u) => u.status === "processing" || u.status === "queued",
        );
        const activeDownloadJobs = safeDownloads.filter(
          (d) => d.status === "processing" || d.status === "queued",
        );

        if (activeUploadJobs.length > 0) {
          const upProgresses = await Promise.all(
            activeUploadJobs.map((j) => window.televault.uploads.progress(j.id).catch(() => null)),
          );
          setUploadProgressMap((prev) => {
            const next = { ...prev };
            for (const p of upProgresses) {
              if (p) next[p.jobId] = p;
            }
            return next;
          });
        }

        if (activeDownloadJobs.length > 0) {
          const downProgresses = await Promise.all(
            activeDownloadJobs.map((j) => window.televault.downloads.progress(j.id).catch(() => null)),
          );
          setDownloadProgressMap((prev) => {
            const next = { ...prev };
            for (const p of downProgresses) {
              if (p) next[p.jobId] = p;
            }
            return next;
          });
        }

        // Periodically refresh job lists
        await refreshTransfers();
      } catch {
        // silent
      } finally {
        timer = setTimeout(poll, 1000);
      }
    };

    poll();

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [uploads, downloads, refreshTransfers]);

  const startUploadsFromPaths = useCallback(
    async (paths: string[]) => {
      if (!paths || paths.length === 0 || !window.televault) return;
      try {
        addToast({
          type: "info",
          title: "Starting uploads",
          message: `Queuing ${paths.length} file(s)...`,
        });
        setIsTransfersOpen(true);
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
    [currentFolderId, addToast, refreshTransfers, refreshFiles, refreshStats],
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
      } catch (err) {
        addToast({ type: "error", title: "Cancel failed", message: (err as Error).message });
      }
    },
    [refreshTransfers, refreshFiles, addToast],
  );

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
  const activeTransfers: ActiveTransferItem[] = [];
  const safeUploads = Array.isArray(uploads) ? uploads : [];
  const safeDownloads = Array.isArray(downloads) ? downloads : [];

  for (const up of safeUploads) {
    const prog = uploadProgressMap[up.id];
    activeTransfers.push({
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
    activeTransfers.push({
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

  const activeCount =
    uploads.filter((u) => u.status === "processing" || u.status === "queued").length +
    downloads.filter((d) => d.status === "processing" || d.status === "queued").length;

  const value: TransferContextValue = {
    uploads,
    downloads,
    activeTransfers,
    activeCount,
    isTransfersOpen,
    setIsTransfersOpen,
    toggleTransfers: () => setIsTransfersOpen((prev) => !prev),
    startUploadsFromPaths,
    startUploadFolder,
    pauseUpload,
    resumeUpload,
    cancelUpload,
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

