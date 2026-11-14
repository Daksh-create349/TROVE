export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, idx)).toFixed(dm))} ${sizes[idx]}`;
}

export function formatDate(isoString: string): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoString;
  }
}

export function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  if (parts.length > 1) {
    return parts.pop()?.toLowerCase() || "";
  }
  return "";
}

export type FileCategory =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "archive"
  | "code"
  | "other";

export function getFileCategory(mimeType = "", filename = ""): FileCategory {
  const mime = mimeType.toLowerCase();
  const ext = getFileExtension(filename);

  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) {
    return "image";
  }
  if (mime.startsWith("video/") || ["mp4", "mkv", "webm", "avi", "mov", "flv", "wmv"].includes(ext)) {
    return "video";
  }
  if (mime.startsWith("audio/") || ["mp3", "ogg", "wav", "flac", "aac", "m4a"].includes(ext)) {
    return "audio";
  }
  if (
    mime.includes("pdf") ||
    mime.includes("word") ||
    mime.includes("document") ||
    mime.includes("sheet") ||
    mime.includes("presentation") ||
    ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "md"].includes(ext)
  ) {
    return "document";
  }
  if (
    mime.includes("zip") ||
    mime.includes("tar") ||
    mime.includes("compressed") ||
    ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso"].includes(ext)
  ) {
    return "archive";
  }
  if (
    mime.includes("json") ||
    mime.includes("javascript") ||
    mime.includes("typescript") ||
    ["js", "ts", "jsx", "tsx", "py", "rs", "go", "cpp", "c", "h", "html", "css", "sql", "sh"].includes(ext)
  ) {
    return "code";
  }
  return "other";
}

