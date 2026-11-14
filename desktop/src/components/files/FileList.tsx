import React from "react";
import type { FileMetadata } from "@shared/types";
import { Download, Trash2, Eye, Check } from "lucide-react";
import { FileIcon } from "../common/FileIcon";
import { formatBytes, formatDate, getFileCategory } from "../../utils/formatters";
import { useApp } from "../../context/AppContext";

interface FileListProps {
  files: FileMetadata[];
  selectedFileIds: Set<string>;
  onSelect: (fileId: string, e: React.MouseEvent) => void;
  onSelectAll: () => void;
  onOpen: (file: FileMetadata) => void;
  onContextMenu: (file: FileMetadata, e: React.MouseEvent) => void;
}

export function FileList({
  files,
  selectedFileIds,
  onSelect,
  onSelectAll,
  onOpen,
  onContextMenu,
}: FileListProps) {
  const { downloadFile, deleteFile } = useApp();

  const allSelected = files.length > 0 && files.every((f) => selectedFileIds.has(f.id));

  return (
    <div className="w-full overflow-x-auto select-none rounded-xl border border-[#1a1c24] bg-[#0c0d12]">
      <table className="w-full text-left text-xs border-collapse">
        <thead>
          <tr className="border-b border-[#1c1e27] bg-[#0a0b0e] text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <th className="w-8 py-2.5 pl-3">
              <div
                onClick={onSelectAll}
                className={`flex h-3.5 w-3.5 items-center justify-center rounded border cursor-pointer ${
                  allSelected
                    ? "border-blue-500 bg-blue-500 text-white"
                    : "border-slate-700 bg-slate-900"
                }`}
              >
                {allSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
              </div>
            </th>
            <th className="py-2.5 px-3">Name</th>
            <th className="py-2.5 px-3">Category</th>
            <th className="py-2.5 px-3">Size</th>
            <th className="py-2.5 px-3">Date Added</th>
            <th className="py-2.5 px-3 text-right pr-4">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#161720]">
          {files.map((file) => {
            const isSelected = selectedFileIds.has(file.id);
            const category = getFileCategory(file.mimeType, file.originalFilename);

            return (
              <tr
                key={file.id}
                onClick={(e) => onSelect(file.id, e)}
                onDoubleClick={() => onOpen(file)}
                onContextMenu={(e) => onContextMenu(file, e)}
                className={`group cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-blue-600/15 text-white"
                    : "text-slate-300 hover:bg-[#12141c]"
                }`}
              >
                <td className="w-8 py-2.5 pl-3">
                  <div
                    className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
                      isSelected
                        ? "border-blue-500 bg-blue-500 text-white"
                        : "border-slate-700 bg-slate-900 opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    {isSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                  </div>
                </td>

                <td className="py-2 px-3">
                  <div className="flex items-center gap-2.5">
                    <FileIcon
                      mimeType={file.mimeType}
                      filename={file.originalFilename}
                      size={24}
                    />
                    <span className="font-medium text-slate-200 group-hover:text-white truncate max-w-xs">
                      {file.originalFilename}
                    </span>
                  </div>
                </td>

                <td className="py-2 px-3 text-slate-400 capitalize">
                  {category}
                </td>

                <td className="py-2 px-3 text-slate-400 font-mono text-2xs">
                  {formatBytes(file.totalSize)}
                </td>

                <td className="py-2 px-3 text-slate-400 text-2xs">
                  {formatDate(file.createdAt)}
                </td>

                <td className="py-2 px-3 text-right pr-4">
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(file);
                      }}
                      title="Preview"
                      className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-blue-400 transition-colors"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadFile(file.id);
                      }}
                      title="Download"
                      className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-emerald-400 transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteFile(file.id);
                      }}
                      title="Delete"
                      className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-rose-400 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

