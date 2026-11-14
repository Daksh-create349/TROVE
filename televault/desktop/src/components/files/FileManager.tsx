import React, { useEffect, useState, useMemo, useCallback } from "react";
import type { FileMetadata, Folder } from "@shared/types";
import { UploadCloud, FolderOpen, ArrowUpDown, Trash2, Download, X, FolderUp, AlertTriangle, Loader2 } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useTransfers } from "../../context/TransferContext";
import { FolderCard } from "./FolderCard";
import { FileCard } from "./FileCard";
import { FileList } from "./FileList";
import { ContextMenu } from "./ContextMenu";
import type { ContextMenuState, SortField } from "../../types";
import { getFileCategory } from "../../utils/formatters";

export function FileManager() {
  const {
    activeView,
    viewMode,
    currentFolderId,
    folders,
    files,
    isLoadingFiles,
    navigateToFolder,
    openPreview,
    selectedFileIds,
    setSelectedFileIds,
    sortField,
    setSortField,
    sortOrder,
    setSortOrder,
    selectedTag,
    deleteFolder,
    deleteMultipleFiles,
    downloadFile,
  } = useApp();

  const { startUploadsFromPaths, startUploadFolder } = useTransfers();

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);
  const [isConfirmingBatchDelete, setIsConfirmingBatchDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
  });

  // Current folder's subfolders
  const currentSubfolders = useMemo(() => {
    return (folders || []).filter((f) => f && f.parentId === currentFolderId);
  }, [folders, currentFolderId]);

  // Filtered & sorted files
  const displayFiles = useMemo(() => {
    let list = [...(files || [])];

    // Filter by view
    if (activeView === "photos") {
      list = list.filter((f) => {
        const cat = getFileCategory(f.mimeType, f.originalFilename);
        return cat === "image" || cat === "video";
      });
    }

    // Filter by tag if selected
    if (selectedTag) {
      list = list.filter((f) => f.originalFilename.toLowerCase().includes(selectedTag));
    }

    // Sort
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") {
        cmp = a.originalFilename.localeCompare(b.originalFilename);
      } else if (sortField === "size") {
        cmp = a.totalSize - b.totalSize;
      } else if (sortField === "date") {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (sortField === "type") {
        cmp = (a.mimeType || "").localeCompare(b.mimeType || "");
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });

    return list;
  }, [files, activeView, selectedTag, sortField, sortOrder]);

  // Handle Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const paths: string[] = [];
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        // In Electron, File objects have a path property
        const filePath = (file as unknown as { path?: string }).path;
        if (filePath) {
          paths.push(filePath);
        }
      }
    }

    if (paths.length > 0) {
      await startUploadsFromPaths(paths);
    }
  };

  // Selection handlers
  const handleSelectFile = useCallback((fileId: string, e: React.MouseEvent) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (e.ctrlKey || e.metaKey) {
        if (next.has(fileId)) next.delete(fileId);
        else next.add(fileId);
      } else {
        next.clear();
        next.add(fileId);
      }
      return next;
    });
  }, [setSelectedFileIds]);

  const handleSelectAll = useCallback(() => {
    setSelectedFileIds((prev) => {
      if (prev.size === displayFiles.length) {
        return new Set();
      }
      return new Set(displayFiles.map((f) => f.id));
    });
  }, [displayFiles, setSelectedFileIds]);

  // Context menu handlers
  const handleFileContextMenu = (file: FileMetadata, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedFileIds(new Set([file.id]));
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      file,
    });
  };

  const handleFolderContextMenu = (folder: Folder, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      folder,
    });
  };

  // Batch actions on multiple selected files
  const executeBatchDelete = useCallback(async () => {
    const ids = Array.from(selectedFileIds);
    if (ids.length === 0) return;
    setIsDeleting(true);
    try {
      await deleteMultipleFiles(ids);
      setSelectedFileIds(new Set());
    } finally {
      setIsDeleting(false);
      setIsConfirmingBatchDelete(false);
    }
  }, [selectedFileIds, deleteMultipleFiles, setSelectedFileIds]);

  const executeFolderDelete = useCallback(async () => {
    if (!folderToDelete) return;
    setIsDeleting(true);
    try {
      await deleteFolder(folderToDelete.id, folderToDelete.name);
    } finally {
      setIsDeleting(false);
      setFolderToDelete(null);
    }
  }, [folderToDelete, deleteFolder]);

  const handleDownloadSelected = useCallback(async () => {
    const ids = Array.from(selectedFileIds);
    if (ids.length === 0) return;
    for (const id of ids) {
      await downloadFile(id);
    }
  }, [selectedFileIds, downloadFile]);

  // Keyboard shortcuts (Delete, Space for preview, Ctrl+A)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        handleSelectAll();
      } else if (e.key === "Delete") {
        if (selectedFileIds.size > 0) {
          e.preventDefault();
          setIsConfirmingBatchDelete(true);
        }
      } else if (e.key === " " && selectedFileIds.size > 0) {
        e.preventDefault();
        const id = Array.from(selectedFileIds)[0];
        const file = displayFiles.find((f) => f.id === id);
        if (file) openPreview(file);
      } else if (e.key === "Escape") {
        setSelectedFileIds(new Set());
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedFileIds, displayFiles, handleSelectAll, openPreview, setSelectedFileIds]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex-1 overflow-y-auto p-6"
    >
      {/* Drag & Drop Visual Overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-40 m-4 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-blue-500 bg-blue-950/70 p-6 backdrop-blur-md animate-in fade-in zoom-in-95 pointer-events-none">
          <UploadCloud className="h-14 w-14 text-blue-400 animate-bounce mb-3" />
          <div className="text-base font-bold text-white">Drop files to upload to Telegram Cloud Vault</div>
          <div className="text-xs text-blue-200 mt-1">Files will be safely sliced and stored in Saved Messages</div>
        </div>
      )}

      {/* Controls Bar: Sort, Multi-select action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-2 border-b border-slate-200/60 dark:border-[#161720]">
        <div className="flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400">
          <span>Items: {displayFiles.length + currentSubfolders.length}</span>

          {displayFiles.length > 0 && (
            <button
              type="button"
              onClick={handleSelectAll}
              className="px-2 py-0.5 rounded text-2xs font-semibold text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
            >
              {selectedFileIds.size === displayFiles.length ? "Deselect All" : "Select All"}
            </button>
          )}

          {selectedFileIds.size > 0 && (
            <div className="flex items-center gap-1.5 animate-in fade-in">
              <span className="rounded bg-blue-600/15 text-blue-600 dark:text-blue-400 font-bold px-2 py-0.5 text-2xs">
                {selectedFileIds.size} selected
              </span>

              {/* Download Selected */}
              <button
                type="button"
                onClick={handleDownloadSelected}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900 border border-blue-200 dark:border-blue-800 text-2xs font-semibold transition-all cursor-pointer shadow-xs"
                title="Download selected files"
              >
                <Download className="h-3 w-3" />
                <span>Download</span>
              </button>

              {/* Delete Selected (Opens Confirmation) */}
              <button
                type="button"
                onClick={() => setIsConfirmingBatchDelete(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900 border border-rose-200 dark:border-rose-800 text-2xs font-semibold transition-all cursor-pointer shadow-xs"
                title="Delete selected files from vault"
              >
                <Trash2 className="h-3 w-3" />
                <span>Delete ({selectedFileIds.size})</span>
              </button>

              {/* Clear Selection */}
              <button
                type="button"
                onClick={() => setSelectedFileIds(new Set())}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xs transition-colors cursor-pointer"
                title="Clear selection"
              >
                <X className="h-3 w-3" />
                <span>Clear</span>
              </button>
            </div>
          )}
        </div>

        {/* Sort selector */}
        <div className="flex items-center gap-1.5 text-2xs text-slate-400">
          <ArrowUpDown className="h-3 w-3 text-slate-500" />
          <span>Sort by:</span>
          {(["name", "size", "date", "type"] as SortField[]).map((field) => (
            <button
              key={field}
              onClick={() => toggleSort(field)}
              className={`capitalize px-2 py-0.5 rounded transition-colors cursor-pointer ${
                sortField === field
                  ? "bg-[#181a24] text-blue-400 font-medium"
                  : "hover:text-slate-200"
              }`}
            >
              {field} {sortField === field ? (sortOrder === "asc" ? "↑" : "↓") : ""}
            </button>
          ))}
        </div>
      </div>

      {/* Subfolders Section */}
      {currentSubfolders.length > 0 && (
        <div className="mb-6">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Folders
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
            {currentSubfolders.map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                onClick={() => navigateToFolder(folder.id, folder.name)}
                onContextMenu={(e) => handleFolderContextMenu(folder, e)}
                onDelete={(f) => setFolderToDelete(f)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Files Section */}
      <div>
        {currentSubfolders.length > 0 && displayFiles.length > 0 && (
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Files
          </div>
        )}

        {isLoadingFiles ? (
          <div className="flex flex-col items-center justify-center p-12 text-slate-500">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent mb-2" />
            <span className="text-xs">Loading vault items...</span>
          </div>
        ) : displayFiles.length > 0 ? (
          viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
              {displayFiles.map((file) => (
                <FileCard
                  key={file.id}
                  file={file}
                  isSelected={selectedFileIds.has(file.id)}
                  onSelect={(e) => handleSelectFile(file.id, e)}
                  onOpen={() => openPreview(file)}
                  onContextMenu={(e) => handleFileContextMenu(file, e)}
                />
              ))}
            </div>
          ) : (
            <FileList
              files={displayFiles}
              selectedFileIds={selectedFileIds}
              onSelect={handleSelectFile}
              onSelectAll={handleSelectAll}
              onOpen={openPreview}
              onContextMenu={handleFileContextMenu}
            />
          )
        ) : currentSubfolders.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 dark:border-[#1c1e27] bg-slate-50/50 dark:bg-[#0c0d12] p-12 text-center">
            <FolderOpen className="h-10 w-10 text-slate-400 dark:text-slate-600 mb-2.5" />
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">This location is empty</div>
            <div className="text-xs text-slate-500 mt-1 max-w-sm">
              Drag and drop files or folders here, or use the buttons below to store items in your personal Telegram Saved Messages.
            </div>
            <div className="flex items-center gap-3 mt-5">
              <button
                type="button"
                onClick={async () => {
                  if (!window.televault) return;
                  const paths = await window.televault.dialog.selectFiles({ multi: true });
                  if (paths && paths.length > 0) {
                    await startUploadsFromPaths(paths);
                  }
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-blue-500/20 hover:bg-blue-500 transition-all cursor-pointer"
              >
                <UploadCloud className="h-4 w-4" />
                <span>Upload Files</span>
              </button>
              <button
                type="button"
                onClick={startUploadFolder}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-[#20283e] bg-white dark:bg-[#11192e] px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-blue-500/40 hover:text-blue-500 dark:hover:text-white transition-all cursor-pointer shadow-xs"
              >
                <FolderUp className="h-4 w-4 text-sky-500" />
                <span>Upload Folder</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Context Menu */}
      <ContextMenu state={contextMenu} onClose={() => setContextMenu({ isOpen: false, x: 0, y: 0 })} />

      {/* Delete Single Folder Confirmation Modal */}
      {folderToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-2xl border border-rose-500/30 bg-[#0e121d] p-5 shadow-2xl text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-500">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">Delete Folder</h3>
              <p className="text-xs text-slate-400">
                Are you sure you want to delete <span className="font-semibold text-white">"{folderToDelete.name}"</span> and all items inside it from your vault?
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setFolderToDelete(null)}
                className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={executeFolderDelete}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-600/30 transition-all cursor-pointer disabled:opacity-50"
              >
                {isDeleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Delete Folder</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Delete Selected Files Confirmation Modal */}
      {isConfirmingBatchDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-2xl border border-rose-500/30 bg-[#0e121d] p-5 shadow-2xl text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-500">
              <Trash2 className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">Delete Selected Files</h3>
              <p className="text-xs text-slate-400">
                Are you sure you want to permanently delete <span className="font-bold text-white">{selectedFileIds.size}</span> file(s) from your vault and Telegram storage?
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setIsConfirmingBatchDelete(false)}
                className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={executeBatchDelete}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-600/30 transition-all cursor-pointer disabled:opacity-50"
              >
                {isDeleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Delete {selectedFileIds.size} File(s)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

