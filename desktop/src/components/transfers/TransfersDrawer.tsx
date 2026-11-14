import { useState } from "react";
import {
  X,
  Play,
  Pause,
  Trash2,
  UploadCloud,
  DownloadCloud,
  CheckCircle2,
  AlertCircle,
  Activity,
} from "lucide-react";
import { useTransfers } from "../../context/TransferContext";
import { formatBytes } from "../../utils/formatters";

export function TransfersDrawer() {
  const {
    activeTransfers,
    isTransfersOpen,
    setIsTransfersOpen,
    pauseUpload,
    resumeUpload,
    cancelUpload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
  } = useTransfers();

  const [tab, setTab] = useState<"all" | "uploads" | "downloads">("all");

  if (!isTransfersOpen) return null;

  const filteredTransfers = activeTransfers.filter((t) => {
    if (tab === "uploads") return t.type === "upload";
    if (tab === "downloads") return t.type === "download";
    return true;
  });

  return (
    <div className="fixed bottom-4 right-4 z-40 flex w-96 flex-col rounded-2xl border border-[#232634] bg-[#0d0e14]/98 shadow-2xl backdrop-blur-xl animate-in slide-in-from-bottom-3 duration-200 overflow-hidden text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#1c1e27] bg-[#08090d] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-blue-400" />
          <span className="font-bold text-white">Transfers Manager</span>
          <span className="rounded-full bg-blue-500/20 px-2 py-0.2 text-[10px] font-semibold text-blue-400">
            {activeTransfers.length}
          </span>
        </div>

        <button
          onClick={() => setIsTransfersOpen(false)}
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#1c1e27] bg-[#0a0b10] px-3 pt-1.5 gap-2">
        <button
          onClick={() => setTab("all")}
          className={`pb-1.5 px-2 text-2xs font-semibold transition-colors border-b-2 ${
            tab === "all"
              ? "border-blue-500 text-white"
              : "border-transparent text-slate-400 hover:text-slate-300"
          }`}
        >
          All Transfers
        </button>
        <button
          onClick={() => setTab("uploads")}
          className={`pb-1.5 px-2 text-2xs font-semibold transition-colors border-b-2 ${
            tab === "uploads"
              ? "border-blue-500 text-white"
              : "border-transparent text-slate-400 hover:text-slate-300"
          }`}
        >
          Uploads
        </button>
        <button
          onClick={() => setTab("downloads")}
          className={`pb-1.5 px-2 text-2xs font-semibold transition-colors border-b-2 ${
            tab === "downloads"
              ? "border-blue-500 text-white"
              : "border-transparent text-slate-400 hover:text-slate-300"
          }`}
        >
          Downloads
        </button>
      </div>

      {/* Transfers List */}
      <div className="max-h-80 overflow-y-auto p-3 space-y-2.5 divide-y divide-white/5">
        {filteredTransfers.length > 0 ? (
          filteredTransfers.map((item) => {
            const isUpload = item.type === "upload";
            const isCompleted = item.status === "completed";
            const isPaused = item.status === "paused";
            const isFailed = item.status === "failed";
            const isProcessing = item.status === "processing" || item.status === "queued";

            return (
              <div key={item.id} className="pt-2 first:pt-0 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="rounded-lg p-1.5 bg-[#141620] border border-white/5 shrink-0">
                      {isUpload ? (
                        <UploadCloud className="h-3.5 w-3.5 text-blue-400" />
                      ) : (
                        <DownloadCloud className="h-3.5 w-3.5 text-emerald-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-slate-200 truncate" title={item.filename}>
                        {item.filename}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        <span>{formatBytes(item.progressBytes)} / {formatBytes(item.totalBytes)}</span>
                        {item.totalSegments > 1 && (
                          <span>• Part {item.currentSegment} of {item.totalSegments}</span>
                        )}
                        <span className="capitalize font-mono text-slate-500">[{item.status}]</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {isProcessing && (
                      <button
                        onClick={() => (isUpload ? pauseUpload(item.id) : pauseDownload(item.id))}
                        title="Pause"
                        className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-amber-400 transition-colors"
                      >
                        <Pause className="h-3 w-3" />
                      </button>
                    )}

                    {isPaused && (
                      <button
                        onClick={() => (isUpload ? resumeUpload(item.id) : resumeDownload(item.id))}
                        title="Resume"
                        className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-emerald-400 transition-colors"
                      >
                        <Play className="h-3 w-3" />
                      </button>
                    )}

                    {!isCompleted && (
                      <button
                        onClick={() => (isUpload ? cancelUpload(item.id) : cancelDownload(item.id))}
                        title="Cancel"
                        className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}

                    {isCompleted && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    )}

                    {isFailed && (
                      <span title={item.error || "Failed"}>
                        <AlertCircle className="h-3.5 w-3.5 text-rose-400" />
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 w-full rounded-full bg-[#181b26] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      isCompleted
                        ? "bg-emerald-500"
                        : isFailed
                        ? "bg-rose-500"
                        : isPaused
                        ? "bg-amber-500"
                        : "bg-blue-500 shadow-sm shadow-blue-500/50"
                    }`}
                    style={{ width: `${Math.min(100, item.percentage)}%` }}
                  />
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center text-slate-500">
            <Activity className="h-6 w-6 text-slate-700 mb-1" />
            <span className="text-2xs">No active or recent transfers</span>
          </div>
        )}
      </div>
    </div>
  );
}
