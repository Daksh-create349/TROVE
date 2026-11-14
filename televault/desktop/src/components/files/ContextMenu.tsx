import { useEffect, useRef } from "react";
import {
  Eye,
  Download,
  Copy,
  Trash2,
  FileText,
  FolderOpen,
} from "lucide-react";
import type { ContextMenuState } from "../../types";
import { useApp } from "../../context/AppContext";

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
}

export function ContextMenu({ state, onClose }: ContextMenuProps) {
  const { openPreview, downloadFile, deleteFile, navigateToFolder, addToast } = useApp();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (!state.isOpen) return null;

  // Clamp positioning to keep menu inside viewport
  const x = Math.min(state.x, window.innerWidth - 200);
  const y = Math.min(state.y, window.innerHeight - 240);

  const handleCopySha256 = () => {
    if (state.file?.sha256) {
      navigator.clipboard.writeText(state.file.sha256);
      addToast({ type: "info", title: "Copied SHA-256", message: state.file.sha256 });
    }
    onClose();
  };

  const handleCopyMessageIds = () => {
    if (state.file?.telegramMessageIds && state.file.telegramMessageIds.length > 0) {
      const ids = state.file.telegramMessageIds.join(", ");
      navigator.clipboard.writeText(ids);
      addToast({ type: "info", title: "Copied Message IDs", message: ids });
    }
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{ left: x, top: y }}
      className="fixed z-50 w-48 rounded-xl border border-[#232634] bg-[#0f1118]/95 p-1 shadow-2xl backdrop-blur-md text-xs text-slate-200 animate-in fade-in zoom-in-95 duration-100"
    >
      {state.folder ? (
        <button
          onClick={() => {
            navigateToFolder(state.folder!.id, state.folder!.name);
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-blue-600 hover:text-white transition-colors"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          <span>Open Folder</span>
        </button>
      ) : state.file ? (
        <>
          <button
            onClick={() => {
              openPreview(state.file!);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-blue-600 hover:text-white transition-colors"
          >
            <Eye className="h-3.5 w-3.5 text-blue-400" />
            <span>Preview</span>
          </button>

          <button
            onClick={() => {
              downloadFile(state.file!.id);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-blue-600 hover:text-white transition-colors"
          >
            <Download className="h-3.5 w-3.5 text-emerald-400" />
            <span>Download</span>
          </button>

          <div className="my-1 h-px bg-slate-800" />

          {state.file.sha256 && (
            <button
              onClick={handleCopySha256}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[#1a1c26] text-slate-400 hover:text-slate-200 transition-colors"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>Copy SHA-256</span>
            </button>
          )}

          <button
            onClick={handleCopyMessageIds}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[#1a1c26] text-slate-400 hover:text-slate-200 transition-colors"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Copy Message IDs</span>
          </button>

          <div className="my-1 h-px bg-slate-800" />

          <button
            onClick={() => {
              deleteFile(state.file!.id);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-rose-400 hover:bg-rose-600 hover:text-white transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete File</span>
          </button>
        </>
      ) : null}
    </div>
  );
}
