import {
  Cloud,
  Send,
  UploadCloud,
  FolderUp,
  RefreshCw,
  FolderOpen,
  ArrowRight,
  ShieldCheck,
  HardDrive,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useTransfers } from "../../context/TransferContext";
import { FolderIcon } from "../common/FolderIcon";
import { FileIcon } from "../common/FileIcon";
import { formatBytes } from "../../utils/formatters";

export function OverviewView() {
  const {
    telegramStatus,
    telegramProfile,
    storageStats,
    folders,
    files,
    setActiveView,
    navigateToFolder,
    openPreview,
    startSync,
    isSyncing,
    openSetup,
  } = useApp();

  const { startUploadsFromPaths, startUploadFolder } = useTransfers();

  const activeAccount =
    telegramProfile ||
    (telegramStatus?.account
      ? {
          firstName: telegramStatus.account.firstName || "Telegram User",
          lastName: telegramStatus.account.lastName || "",
          username: telegramStatus.account.username || null,
          id: telegramStatus.account.telegramUserId,
        }
      : null);

  const isConnected =
    telegramStatus?.state === "connected" ||
    Boolean(telegramStatus?.sessionStored && activeAccount);

  const recentFiles = files.slice(0, 8);

  const handleUploadFiles = async () => {
    if (!window.televault) return;
    const paths = await window.televault.dialog.selectFiles({ multi: true });
    if (paths && paths.length > 0) {
      await startUploadsFromPaths(paths);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Primary Card: Telegram Cloud Vault Hero */}
      <div className="relative overflow-hidden rounded-3xl card-gradient-border p-7 shadow-lg transition-colors">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3 max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/25 bg-blue-500/10 px-3 py-1 text-2xs font-semibold text-blue-600 dark:text-blue-400">
              <ShieldCheck className="h-3 w-3" />
              <span>Personal MTProto Storage Engine</span>
            </div>

            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Trove Cloud Vault
            </h1>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Your files are stored in your personal Telegram Saved Messages using
              two-level chunking and authenticated end-to-end SHA-256 verification.
              No bots or public channels required.
            </p>

            {/* Account & Storage Specs */}
            <div className="flex flex-wrap items-center gap-4 pt-1">
              <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <span
                  className={`flex h-2 w-2 rounded-full ${
                    isConnected
                      ? "bg-emerald-500 dark:bg-emerald-400 shadow-sm shadow-emerald-400/50"
                      : "bg-amber-500 dark:bg-amber-400 animate-pulse"
                  }`}
                />
                <span className="font-medium">
                  {isConnected
                    ? activeAccount?.username
                      ? `@${activeAccount.username}`
                      : `${activeAccount?.firstName || "Telegram Account"}`
                    : "Not Connected"}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <Send className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
                <span>Saved Messages Peer</span>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <HardDrive className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400" />
                <span className="text-slate-800 dark:text-slate-200 font-medium">
                  {formatBytes(storageStats?.totalBytes || 0)}
                </span>
                <span>({storageStats?.totalFiles || 0} indexed files)</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            {isConnected ? (
              <>
                <button
                  onClick={handleUploadFiles}
                  className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-500/25 hover:bg-blue-500 transition-all cursor-pointer"
                >
                  <UploadCloud className="h-4 w-4" />
                  <span>Upload Files</span>
                </button>

                <button
                  onClick={startUploadFolder}
                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-[#272b3a] bg-white dark:bg-[#141722] px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-blue-500/50 hover:bg-slate-50 dark:hover:bg-[#1a1e2c] transition-all shadow-xs cursor-pointer"
                  title="Upload an entire folder with subfolders to Trove"
                >
                  <FolderUp className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
                  <span>Upload Folder</span>
                </button>

                <button
                  onClick={startSync}
                  disabled={isSyncing}
                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-[#272b3a] bg-white dark:bg-[#141722] px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-blue-500/50 hover:bg-slate-50 dark:hover:bg-[#1a1e2c] transition-all disabled:opacity-50 shadow-xs cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 text-blue-500 dark:text-blue-400 ${isSyncing ? "animate-spin" : ""}`} />
                  <span>{isSyncing ? "Syncing..." : "Sync Messages"}</span>
                </button>
              </>
            ) : (
              <button
                onClick={openSetup}
                className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-500/30 hover:bg-blue-500 transition-all cursor-pointer"
              >
                <span>Connect Telegram Account</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Decorative background glow */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-blue-600/10 blur-3xl" />
      </div>

      {/* Folders & Locations Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Configured Locations & Folders</h2>
            <span className="text-2xs text-slate-500 dark:text-slate-400 font-mono">({folders.length})</span>
          </div>

          <button
            onClick={() => setActiveView("content")}
            className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors font-medium cursor-pointer"
          >
            <span>Browse All</span>
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        {folders.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {folders.map((folder) => (
              <button
                key={folder.id}
                onClick={() => {
                  setActiveView("content");
                  navigateToFolder(folder.id, folder.name);
                }}
                className="group flex flex-col items-center justify-center rounded-2xl border border-slate-200/80 dark:border-[#1a1c24] bg-white dark:bg-[#0f1117] p-3.5 transition-all duration-200 hover:border-blue-500/40 hover:bg-slate-50 dark:hover:bg-[#141720] shadow-sm cursor-pointer"
              >
                <FolderIcon size={52} />
                <span className="mt-2 text-xs font-medium text-slate-800 dark:text-slate-200 truncate w-full text-center">
                  {folder.name}
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  {folder.fileCount} {folder.fileCount === 1 ? "item" : "items"}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 dark:border-[#1c1e27] bg-white/60 dark:bg-[#0c0d12] p-8 text-center shadow-xs">
            <FolderOpen className="h-8 w-8 text-slate-400 dark:text-slate-600 mb-2" />
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-400">No folders created yet</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-600 mt-0.5">
              Organize your Telegram storage with custom folders from the sidebar.
            </div>
          </div>
        )}
      </div>

      {/* Recent Files Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Recent Files</h2>
            <span className="text-2xs text-slate-500 dark:text-slate-400 font-mono">({recentFiles.length})</span>
          </div>

          <button
            onClick={() => setActiveView("content")}
            className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors font-medium cursor-pointer"
          >
            <span>View All Files</span>
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        {recentFiles.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
            {recentFiles.map((file) => (
              <div
                key={file.id}
                onClick={() => openPreview(file)}
                className="group relative flex flex-col items-center rounded-2xl border border-slate-200/80 dark:border-[#1a1c24] bg-white dark:bg-[#0f1117] p-3 text-center cursor-pointer transition-all duration-200 hover:border-blue-500/40 hover:bg-slate-50 dark:hover:bg-[#141722] shadow-sm"
              >
                <div className="py-1">
                  <FileIcon
                    mimeType={file.mimeType}
                    filename={file.originalFilename}
                    size={46}
                  />
                </div>
                <div className="mt-2 text-xs font-medium text-slate-800 dark:text-slate-200 truncate w-full" title={file.originalFilename}>
                  {file.originalFilename}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  {formatBytes(file.totalSize)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 dark:border-[#1c1e27] bg-white/60 dark:bg-[#0c0d12] p-8 text-center shadow-xs">
            <Cloud className="h-8 w-8 text-slate-400 dark:text-slate-600 mb-2" />
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-400">Vault is empty</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-600 mt-0.5">
              Upload files or click "Sync Messages" to scan existing Telegram Saved Messages.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
