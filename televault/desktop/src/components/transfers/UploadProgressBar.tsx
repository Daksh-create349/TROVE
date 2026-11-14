import { useEffect, useState } from "react";
import {
  UploadCloud,
  Pause,
  Play,
  X,
  CheckCircle2,
  ChevronUp,
} from "lucide-react";
import { useTransfers } from "../../context/TransferContext";
import { formatBytes } from "../../utils/formatters";

export function UploadProgressBar() {
  const {
    batchUploadStats,
    pauseAllUploads,
    resumeAllUploads,
    cancelAllUploads,
    toggleTransfers,
  } = useTransfers();

  const [showCompletedBanner, setShowCompletedBanner] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);

  // Detect transition from active to finished
  useEffect(() => {
    if (batchUploadStats.isActive) {
      setShowCompletedBanner(false);
    } else if (batchUploadStats.totalFiles > 0 && batchUploadStats.completedFiles >= batchUploadStats.totalFiles) {
      setCompletedCount(batchUploadStats.completedFiles);
      setShowCompletedBanner(true);
      const timer = setTimeout(() => setShowCompletedBanner(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [batchUploadStats.isActive, batchUploadStats.completedFiles, batchUploadStats.totalFiles]);

  if (!batchUploadStats.isActive && !showCompletedBanner) {
    return null;
  }

  if (showCompletedBanner) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-[#0c121e]/95 px-5 py-3 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-3 duration-200 text-xs">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-white text-xs">Upload Completed</span>
          <span className="text-[11px] text-slate-300">
            {completedCount} file(s) safely sliced and encrypted in your Telegram Vault.
          </span>
        </div>
        <button
          onClick={() => setShowCompletedBanner(false)}
          className="ml-2 rounded-lg p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const { isPaused, totalFiles, completedFiles, progressBytes, totalBytes, percentage, currentFilename } = batchUploadStats;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[92%] max-w-2xl rounded-2xl border border-blue-500/30 bg-[#0b0f19]/95 p-3.5 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-3 duration-200 text-xs select-none">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
              isPaused ? "bg-amber-500/20 text-amber-400" : "bg-blue-600/20 text-blue-400"
            }`}
          >
            <UploadCloud className={`h-4 w-4 ${isPaused ? "" : "animate-bounce"}`} />
          </div>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-xs">
                {isPaused ? "Upload Paused" : "Uploading to Telegram Vault"}
              </span>
              <span className="rounded-md bg-blue-500/20 text-blue-300 font-semibold px-1.5 py-0.2 text-[10px]">
                {percentage}%
              </span>
            </div>
            <span className="text-[11px] text-slate-400 truncate">
              {currentFilename ? currentFilename : `Processing ${totalFiles} file(s)...`} •{" "}
              {completedFiles} of {totalFiles} completed • {formatBytes(progressBytes)} / {formatBytes(totalBytes)}
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={isPaused ? resumeAllUploads : pauseAllUploads}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl font-semibold text-2xs transition-all cursor-pointer shadow-xs ${
              isPaused
                ? "bg-blue-600 hover:bg-blue-500 text-white"
                : "bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30"
            }`}
            title={isPaused ? "Resume upload" : "Pause upload"}
          >
            {isPaused ? (
              <>
                <Play className="h-3 w-3 fill-current" />
                <span>Resume</span>
              </>
            ) : (
              <>
                <Pause className="h-3 w-3 fill-current" />
                <span>Pause</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={cancelAllUploads}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-rose-900/60 hover:text-rose-200 text-slate-300 border border-slate-700/60 text-2xs font-medium transition-all cursor-pointer"
            title="Cancel remaining uploads"
          >
            <X className="h-3 w-3" />
            <span>Cancel</span>
          </button>

          <button
            type="button"
            onClick={toggleTransfers}
            className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700/60 transition-colors cursor-pointer"
            title="View transfer details"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Progress track */}
      <div className="w-full h-2 rounded-full bg-slate-800/80 overflow-hidden relative">
        <div
          className={`h-full transition-all duration-300 rounded-full ${
            isPaused
              ? "bg-amber-500"
              : "bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-400"
          }`}
          style={{ width: `${Math.max(2, percentage)}%` }}
        />
      </div>
    </div>
  );
}
