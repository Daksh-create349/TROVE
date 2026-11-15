import React, { useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  RefreshCw,
  UploadCloud,
  FolderUp,
  LayoutGrid,
  List,
  Activity,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useTransfers } from "../../context/TransferContext";
import { WindowsWindowControls } from "../common/WindowsWindowControls";

export function Header() {
  const {
    folderBreadcrumbs,
    navigateToFolder,
    viewMode,
    setViewMode,
    searchQuery,
    setSearchQuery,
    startSync,
    isSyncing,
  } = useApp();

  const { startUploadsFromPaths, startUploadFolder, activeCount, toggleTransfers } = useTransfers();
  const isMac = typeof window !== "undefined" && window.televault?.platform === "darwin";

  const handleUploadClick = async () => {
    if (!window.televault) return;
    const paths = await window.televault.dialog.selectFiles({ multi: true });
    if (paths && paths.length > 0) {
      await startUploadsFromPaths(paths);
    }
  };

  // Keyboard accessibility shortcuts for Windows & Mac
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when user is typing in input fields
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

      // Ctrl+K / Cmd+K: Focus global search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("header-search-input")?.focus();
        return;
      }

      // Ctrl+O: Open Upload File dialog (when not in an input)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o" && !isInput) {
        e.preventDefault();
        handleUploadClick();
        return;
      }

      // F5 / Ctrl+R: Trigger Telegram Sync (when not in an input)
      if ((e.key === "F5" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r")) && !isInput) {
        e.preventDefault();
        if (!isSyncing) {
          startSync();
        }
        return;
      }

      // Alt+Left: Navigate back in breadcrumbs (Windows standard Explorer shortcut)
      if (e.altKey && e.key === "ArrowLeft" && !isInput) {
        if (folderBreadcrumbs.length > 1) {
          e.preventDefault();
          const prev = folderBreadcrumbs[folderBreadcrumbs.length - 2];
          navigateToFolder(prev ? prev.id : null);
        }
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [folderBreadcrumbs, isSyncing, navigateToFolder, startSync]);

  return (
    <header
      className={`flex h-12 w-full items-center justify-between border-b border-slate-200/80 dark:border-[#141e38] bg-white/80 dark:bg-[#070b15] ${
        isMac ? "px-4" : "pl-4 pr-0"
      } select-none relative transition-colors app-drag-region`}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Left: Navigation history & Breadcrumbs */}
      <div
        className="relative z-10 app-no-drag flex items-center gap-3 pointer-events-auto"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {/* Back / Forward buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (folderBreadcrumbs.length > 1) {
                const prev = folderBreadcrumbs[folderBreadcrumbs.length - 2];
                navigateToFolder(prev ? prev.id : null);
              }
            }}
            disabled={folderBreadcrumbs.length <= 1}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#181a24] hover:text-slate-800 dark:hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
            title="Back"
          >
            <ChevronLeft className="h-4 w-4 pointer-events-none" />
          </button>
          <button
            type="button"
            disabled
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 opacity-30 pointer-events-none"
            title="Forward"
          >
            <ChevronRight className="h-4 w-4 pointer-events-none" />
          </button>
        </div>

        {/* Breadcrumb path */}
        <div className="flex items-center gap-1.5 text-xs">
          {folderBreadcrumbs.map((crumb, idx) => {
            const isLast = idx === folderBreadcrumbs.length - 1;
            return (
              <React.Fragment key={crumb.id || "root"}>
                {idx > 0 && <span className="text-slate-400 dark:text-slate-600">/</span>}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigateToFolder(crumb.id, crumb.name);
                  }}
                  className={`rounded px-1.5 py-0.5 transition-colors cursor-pointer ${
                    isLast
                      ? "font-semibold text-slate-900 dark:text-white pointer-events-none"
                      : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#181a24] hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Center: Search input */}
      <div
        className="relative z-10 app-no-drag flex-1 max-w-md px-4 pointer-events-auto"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 h-3.5 w-3.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
          <input
            id="header-search-input"
            type="text"
            placeholder="Search files, extensions, tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-[#1e202a] bg-slate-50 dark:bg-[#12141c] py-1 pl-8 pr-12 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:border-blue-500/60 focus:bg-white dark:focus:bg-[#161822] focus:outline-none transition-all"
          />
          <kbd className="absolute right-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-1 py-0.2 text-[9px] font-mono text-slate-500 dark:text-slate-400 pointer-events-none">
            {isMac ? "⌘K" : "Ctrl+K"}
          </kbd>
        </div>
      </div>

      {/* Right: Actions, View Toggles & Window Controls */}
      <div
        className="relative z-10 app-no-drag flex items-center gap-2 pointer-events-auto"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {/* Sync Saved Messages */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            startSync();
          }}
          disabled={isSyncing}
          title="Synchronize Telegram Saved Messages"
          className="flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 dark:border-[#1e202a] bg-slate-50 dark:bg-[#12141c] px-2.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:border-blue-500/40 hover:text-blue-600 dark:hover:text-white transition-all disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`h-3 w-3 text-blue-500 dark:text-blue-400 ${isSyncing ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">{isSyncing ? "Syncing..." : "Sync"}</span>
        </button>

        {/* Upload Files Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleUploadClick();
          }}
          title="Upload files to Trove"
          className="flex h-7 items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-2.5 text-xs font-medium text-white shadow-sm shadow-blue-500/25 transition-all cursor-pointer"
        >
          <UploadCloud className="h-3.5 w-3.5" />
          <span>Upload</span>
        </button>

        {/* Upload Folder Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            startUploadFolder();
          }}
          title="Upload an entire folder to Trove"
          className="flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 dark:border-[#1e202a] bg-slate-50 dark:bg-[#12141c] px-2.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:border-blue-500/40 hover:text-blue-600 dark:hover:text-white transition-all cursor-pointer"
        >
          <FolderUp className="h-3.5 w-3.5 text-sky-500 dark:text-sky-400" />
          <span className="hidden sm:inline">Upload Folder</span>
        </button>

        {/* Active Transfers indicator */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleTransfers();
          }}
          title="Active transfers drawer"
          className={`flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors cursor-pointer ${
            activeCount > 0
              ? "border-blue-500/40 bg-blue-600/15 text-blue-600 dark:text-blue-300"
              : "border-slate-200 dark:border-[#1e202a] bg-slate-50 dark:bg-[#12141c] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
          }`}
        >
          <Activity className={`h-3.5 w-3.5 ${activeCount > 0 ? "animate-pulse text-blue-500" : ""}`} />
          {activeCount > 0 && <span className="font-semibold text-2xs">{activeCount}</span>}
        </button>

        {/* View Toggle (Grid / List) */}
        <div className="flex items-center rounded-lg border border-slate-200 dark:border-[#1e202a] bg-slate-50 dark:bg-[#12141c] p-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setViewMode("grid");
            }}
            title="Grid view"
            className={`rounded p-1 transition-colors cursor-pointer ${
              viewMode === "grid" ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setViewMode("list");
            }}
            title="List view"
            className={`rounded p-1 transition-colors cursor-pointer ${
              viewMode === "list" ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Window controls (Windows/Linux only - intentionally omitted on macOS) */}
        {!isMac && (
          <>
            <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-1" />
            <WindowsWindowControls />
          </>
        )}
      </div>
    </header>
  );
}
