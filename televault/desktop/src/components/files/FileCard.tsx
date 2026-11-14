import React, { useState } from "react";
import type { FileMetadata } from "@shared/types";
import { Check } from "lucide-react";
import { FileIcon } from "../common/FileIcon";
import { formatBytes, getFileCategory } from "../../utils/formatters";

interface FileCardProps {
  file: FileMetadata;
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export function FileCard({
  file,
  isSelected,
  onSelect,
  onOpen,
  onContextMenu,
}: FileCardProps) {
  const [imageError, setImageError] = useState(false);
  const category = getFileCategory(file.mimeType, file.originalFilename);
  const isImage = category === "image" && !imageError;

  return (
    <div
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      className={`group relative flex flex-col items-center justify-between rounded-2xl p-3 cursor-pointer transition-all duration-200 select-none border ${
        isSelected
          ? "border-blue-500 bg-blue-500/15 shadow-md shadow-blue-500/20 ring-1 ring-blue-500/50"
          : "border-slate-200/60 dark:border-white/[0.08] bg-white/70 dark:bg-[#10141f]/80 hover:bg-slate-100/80 dark:hover:bg-[#181f30] hover:border-slate-300 dark:hover:border-white/20 shadow-sm"
      }`}
    >
      {/* macOS Selection Checkmark Pill */}
      <div
        className={`absolute top-2.5 left-2.5 z-10 flex h-4 w-4 items-center justify-center rounded-full transition-all ${
          isSelected
            ? "bg-blue-600 text-white shadow-sm"
            : "border border-slate-300 dark:border-slate-600 bg-white/60 dark:bg-black/40 opacity-0 group-hover:opacity-100"
        }`}
      >
        {isSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
      </div>

      {/* macOS Floating Icon / Image Preview (No harsh black inner box) */}
      <div className="flex h-20 w-full items-center justify-center py-1">
        {isImage ? (
          <img
            src={
              window.televault?.files?.getPreviewUrl
                ? window.televault.files.getPreviewUrl(file.id)
                : `http://127.0.0.1:4787/api/files/${file.id}/preview`
            }
            alt={file.originalFilename}
            onError={() => setImageError(true)}
            className="h-20 w-20 object-cover rounded-xl shadow-md border border-slate-200 dark:border-white/10 transition-transform duration-200 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <FileIcon
            mimeType={file.mimeType}
            filename={file.originalFilename}
            size={54}
          />
        )}
      </div>

      {/* File Info */}
      <div className="mt-2.5 w-full text-center">
        <div
          className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate w-full group-hover:text-blue-600 dark:group-hover:text-white transition-colors"
          title={file.originalFilename}
        >
          {file.originalFilename}
        </div>
        <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
          {formatBytes(file.totalSize)}
        </div>
      </div>
    </div>
  );
}

export default FileCard;
