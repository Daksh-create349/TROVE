import { HardDrive, FileCheck, Layers, Cpu } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useTransfers } from "../../context/TransferContext";
import { formatBytes } from "../../utils/formatters";

export function HeaderStats() {
  const { storageStats } = useApp();
  const { activeCount } = useTransfers();

  const totalBytes = storageStats?.totalBytes || 0;
  const totalFiles = storageStats?.totalFiles || 0;
  const cacheBytes = (storageStats?.databaseBytes || 0) + (storageStats?.dataDirectoryBytes || 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-3 border-b border-slate-200/80 dark:border-[#141e38] bg-white/80 dark:bg-[#070a14] select-none transition-colors">
      {/* Metric 1: Total Stored */}
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-[#19243d] bg-slate-50/80 dark:bg-[#0c1324] p-2.5 transition-all hover:border-blue-500/30">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <HardDrive className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Total Stored
          </div>
          <div className="text-xs font-bold text-slate-800 dark:text-white truncate">
            {formatBytes(totalBytes)}
          </div>
        </div>
      </div>

      {/* Metric 2: Indexed Files */}
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-[#1a1c24] bg-slate-50/80 dark:bg-[#0f1117] p-2.5 transition-all hover:border-emerald-500/30">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <FileCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Indexed Files
          </div>
          <div className="text-xs font-bold text-slate-800 dark:text-white truncate">
            {totalFiles}
          </div>
        </div>
      </div>

      {/* Metric 3: Local SQLite Cache */}
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-[#1a1c24] bg-slate-50/80 dark:bg-[#0f1117] p-2.5 transition-all hover:border-purple-500/30">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
          <Layers className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Local Cache
          </div>
          <div className="text-xs font-bold text-slate-800 dark:text-white truncate">
            {formatBytes(cacheBytes)}
          </div>
        </div>
      </div>

      {/* Metric 4: Active Upload Queue */}
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-[#1a1c24] bg-slate-50/80 dark:bg-[#0f1117] p-2.5 transition-all hover:border-cyan-500/30">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
          <Cpu className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Upload Queue
          </div>
          <div className="text-xs font-bold text-slate-800 dark:text-white truncate">
            {activeCount > 0 ? `${activeCount} active` : "Idle"}
          </div>
        </div>
      </div>
    </div>
  );
}

export default HeaderStats;
