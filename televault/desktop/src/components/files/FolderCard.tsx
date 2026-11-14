import React from "react";
import type { Folder } from "@shared/types";
import { FolderIcon } from "../common/FolderIcon";
import { Trash2, FolderDown } from "lucide-react";

interface FolderCardProps {
  folder: Folder;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDelete?: (folder: Folder) => void;
  onDownloadZip?: (folder: Folder) => void;
}

export function FolderCard({
  folder,
  onClick,
  onContextMenu,
  onDelete,
  onDownloadZip,
}: FolderCardProps) {
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="group relative flex flex-col items-center justify-between rounded-2xl border border-slate-200/60 dark:border-white/[0.08] bg-white/70 dark:bg-[#10141f]/80 p-3 cursor-pointer transition-all duration-200 hover:bg-slate-100/80 dark:hover:bg-[#181f30] hover:border-blue-500/40 shadow-sm select-none"
    >
      {/* Quick Actions (Download ZIP & Delete) */}
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-150 z-10">
        {onDownloadZip && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDownloadZip(folder);
            }}
            className="p-1.5 rounded-lg bg-slate-900/85 hover:bg-blue-600 text-slate-300 hover:text-white transition-all duration-150 shadow-md cursor-pointer"
            title={`Download "${folder.name}" as ZIP`}
          >
            <FolderDown className="h-3 w-3" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(folder);
            }}
            className="p-1.5 rounded-lg bg-slate-900/85 hover:bg-rose-600 text-slate-300 hover:text-white transition-all duration-150 shadow-md cursor-pointer"
            title={`Delete folder "${folder.name}"`}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="flex h-20 w-full items-center justify-center py-1">
        <FolderIcon size={64} />
      </div>
      <div className="mt-2.5 w-full text-center">
        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate w-full block group-hover:text-blue-600 dark:group-hover:text-white transition-colors">
          {folder.name}
        </span>
        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
          {folder.fileCount} {folder.fileCount === 1 ? "item" : "items"}
        </span>
      </div>
    </div>
  );
}

export default FolderCard;
