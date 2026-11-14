import { useEffect, useState } from "react";
import { X, Download, Copy, ShieldCheck, FileText, Check, AlertCircle } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { formatBytes, formatDate, getFileCategory } from "../../utils/formatters";

export function FilePreviewModal() {
  const { previewFile, closePreview, downloadFile, addToast } = useApp();
  const [copiedSha, setCopiedSha] = useState(false);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoadingText, setIsLoadingText] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  const file = previewFile;
  const category = file ? getFileCategory(file.mimeType, file.originalFilename) : "other";
  const isPdf =
    file?.originalFilename.toLowerCase().endsWith(".pdf") ||
    Boolean(file?.mimeType && file.mimeType.toLowerCase().includes("pdf"));

  const previewUrl =
    file && window.televault?.files?.getPreviewUrl
      ? window.televault.files.getPreviewUrl(file.id)
      : file
      ? `http://127.0.0.1:4787/api/files/${file.id}/preview`
      : "";

  // Reset loading states when preview file changes
  useEffect(() => {
    setIsImageLoading(true);
    setImageError(false);
    setTextContent(null);
  }, [file?.id]);

  // If text/code/markdown file (not PDF), fetch content to render in preview
  useEffect(() => {
    if (
      file &&
      !isPdf &&
      (category === "document" || category === "code") &&
      file.totalSize < 1024 * 1024 &&
      previewUrl
    ) {
      setIsLoadingText(true);
      fetch(previewUrl)
        .then(async (res) => {
          if (!res.ok) throw new Error(`Preview HTTP error ${res.status}`);
          const text = await res.text();
          let isJsonError = false;
          try {
            const parsed = JSON.parse(text);
            if (parsed && (parsed.ok === false || parsed.error)) {
              isJsonError = true;
            }
          } catch {
            // Not a JSON error, normal code/text file
          }
          if (isJsonError) {
            throw new Error("Invalid preview response");
          }
          return text;
        })
        .then((text) => setTextContent(text))
        .catch(() => setTextContent(null))
        .finally(() => setIsLoadingText(false));
    } else {
      setTextContent(null);
    }
  }, [file, category, isPdf, previewUrl]);

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closePreview]);

  if (!file) return null;

  const handleCopySha = () => {
    if (file.sha256) {
      navigator.clipboard.writeText(file.sha256);
      setCopiedSha(true);
      setTimeout(() => setCopiedSha(false), 2000);
      addToast({ type: "info", title: "Copied SHA-256", message: file.sha256 });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="flex h-[90vh] w-[90vw] max-w-5xl flex-col rounded-3xl border border-slate-200 dark:border-[#232634] bg-white dark:bg-[#0d0e14] shadow-2xl overflow-hidden transition-colors">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#1c1e27] bg-slate-50/80 dark:bg-[#090a0e] px-5 py-3 transition-colors">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900 dark:text-white truncate max-w-md">
                {file.originalFilename}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <span>{formatBytes(file.totalSize)}</span>
                <span>•</span>
                <span>{file.mimeType || "application/octet-stream"}</span>
                <span>•</span>
                <span>
                  {file.partCount} {file.partCount === 1 ? "segment" : "segments"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadFile(file.id)}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-md shadow-blue-500/20 hover:bg-blue-500 transition-all cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download</span>
            </button>

            <button
              onClick={closePreview}
              className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Main Content Area */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Preview Viewport */}
          <div className="flex-1 flex items-center justify-center bg-slate-100/60 dark:bg-[#07080a] p-4 overflow-auto transition-colors">
            {isPdf ? (
              <iframe
                src={previewUrl}
                title={file.originalFilename}
                className="h-full w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white shadow-2xl"
              />
            ) : category === "image" ? (
              <div className="relative flex items-center justify-center h-full w-full">
                {isImageLoading && !imageError && (
                  <div className="absolute flex flex-col items-center gap-2 text-slate-500">
                    <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                    <span className="text-xs">Streaming image from Telegram...</span>
                  </div>
                )}
                {imageError ? (
                  <div className="flex flex-col items-center justify-center p-6 text-center space-y-3">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-200 dark:bg-slate-800 text-slate-500">
                      <AlertCircle className="h-6 w-6 text-amber-500" />
                    </div>
                    <span className="text-xs text-slate-400">Image preview could not be streamed.</span>
                    <button
                      onClick={() => downloadFile(file.id)}
                      className="flex items-center gap-2 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-md shadow-blue-500/20 hover:bg-blue-500"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Download File</span>
                    </button>
                  </div>
                ) : (
                  <img
                    src={previewUrl}
                    alt={file.originalFilename}
                    onLoad={() => setIsImageLoading(false)}
                    onError={() => {
                      setImageError(true);
                      setIsImageLoading(false);
                    }}
                    className={`max-h-full max-w-full rounded-2xl object-contain shadow-2xl transition-opacity duration-200 ${
                      isImageLoading ? "opacity-0" : "opacity-100"
                    }`}
                  />
                )}
              </div>
            ) : category === "video" ? (
              <video
                src={previewUrl}
                controls
                autoPlay
                className="max-h-full max-w-full rounded-2xl shadow-2xl"
              />
            ) : category === "audio" ? (
              <div className="flex flex-col items-center justify-center p-8 space-y-4 rounded-3xl bg-white dark:bg-[#12141c] border border-slate-200 dark:border-[#1e202a] shadow-lg">
                <div className="h-16 w-16 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 animate-pulse">
                  <FileText className="h-8 w-8" />
                </div>
                <div className="text-center">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    {file.originalFilename}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{formatBytes(file.totalSize)}</div>
                </div>
                <audio src={previewUrl} controls className="w-72" />
              </div>
            ) : isLoadingText ? (
              <div className="flex flex-col items-center justify-center p-8 space-y-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                <div className="text-xs text-slate-500 dark:text-slate-400">Loading text preview...</div>
              </div>
            ) : textContent !== null ? (
              <pre className="h-full w-full overflow-auto rounded-2xl bg-white dark:bg-[#0c0d12] p-5 font-mono text-xs text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-[#1a1c24] select-text leading-relaxed shadow-inner">
                {textContent}
              </pre>
            ) : (
              <div className="flex flex-col items-center justify-center text-center p-8 space-y-3">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-200/70 dark:bg-[#141722] border border-slate-300 dark:border-[#232738] text-slate-500 dark:text-slate-400">
                  <FileText className="h-8 w-8" />
                </div>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Inline preview unavailable for this file format
                </div>
                <p className="text-xs text-slate-500 max-w-xs">
                  This file is safely stored in Telegram Saved Messages across {file.partCount} segment(s).
                  Download it to open in your system application.
                </p>
                <button
                  onClick={() => downloadFile(file.id)}
                  className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors shadow-lg shadow-blue-500/20 cursor-pointer"
                >
                  <Download className="h-4 w-4" />
                  <span>Download File</span>
                </button>
              </div>
            )}
          </div>

          {/* Metadata Inspector Sidebar */}
          <div className="w-full md:w-72 border-t md:border-t-0 md:border-l border-slate-200 dark:border-[#1c1e27] bg-white dark:bg-[#0a0b10] p-4 overflow-y-auto space-y-4 text-xs transition-colors">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Verification & Integrity
              </div>
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium text-2xs">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>SHA-256 Verified Storage</span>
                </div>
                {file.sha256 ? (
                  <div className="space-y-1">
                    <div className="font-mono text-[10px] text-slate-700 dark:text-slate-300 break-all bg-slate-100 dark:bg-black/40 p-1.5 rounded border border-slate-200 dark:border-white/5">
                      {file.sha256}
                    </div>
                    <button
                      onClick={handleCopySha}
                      className="flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400 hover:underline transition-colors cursor-pointer"
                    >
                      {copiedSha ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      <span>{copiedSha ? "Copied!" : "Copy Hash"}</span>
                    </button>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">Hash calculated upon first transfer</div>
                )}
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                File Details
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-[#161822]">
                  <span className="text-slate-400">Filename:</span>
                  <span className="font-medium text-slate-700 dark:text-slate-200 truncate max-w-[140px]" title={file.originalFilename}>
                    {file.originalFilename}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-[#161822]">
                  <span className="text-slate-400">Size:</span>
                  <span className="font-medium text-slate-700 dark:text-slate-200">{formatBytes(file.totalSize)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-[#161822]">
                  <span className="text-slate-400">Segments:</span>
                  <span className="font-medium text-slate-700 dark:text-slate-200">{file.partCount} chunks</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 dark:border-[#161822]">
                  <span className="text-slate-400">Format:</span>
                  <span className="font-medium text-slate-700 dark:text-slate-200 truncate max-w-[140px]">{file.mimeType}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Indexed:</span>
                  <span className="font-medium text-slate-700 dark:text-slate-200">{formatDate(file.createdAt)}</span>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={() => downloadFile(file.id)}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 py-2.5 text-xs font-semibold text-white shadow-md shadow-blue-500/25 transition-all cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download to Local Disk</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
