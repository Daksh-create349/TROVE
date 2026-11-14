export interface TeleVaultManifest {
  version: 1;
  fileId: string;
  partIndex: number;
  totalParts: number;
  partSha256: string;
}

export interface RemoteFileManifestPart {
  partIndex: number;
  partSize: number;
  sha256: string;
  telegramMessageId: string;
}

export interface RemoteFileManifest {
  manifestVersion: 1;
  fileId: string;
  originalFilename: string;
  totalSize: number;
  mimeType: string;
  sha256: string;
  totalParts: number;
  parts: RemoteFileManifestPart[];
  createdAt: string;
}

const MANIFEST_REGEX =
  /^TVLT:v1:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):(\d+):(\d+):([a-f0-9]{64})$/i;

const REMOTE_MANIFEST_CAPTION_REGEX =
  /^TVLT:v1:MANIFEST:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):([a-f0-9]{64})$/i;

export function formatManifestCaption(manifest: TeleVaultManifest): string {
  return `TVLT:v1:${manifest.fileId}:${manifest.partIndex}:${manifest.totalParts}:${manifest.partSha256.toLowerCase()}`;
}

export function parseManifestCaption(caption: string): TeleVaultManifest | null {
  const match = caption.trim().match(MANIFEST_REGEX);
  if (!match) {
    return null;
  }

  const [, fileId, partIndexStr, totalPartsStr, partSha256] = match;
  if (!fileId || !partIndexStr || !totalPartsStr || !partSha256) {
    return null;
  }

  const partIndex = parseInt(partIndexStr, 10);
  const totalParts = parseInt(totalPartsStr, 10);

  if (isNaN(partIndex) || isNaN(totalParts) || totalParts < 0 || partIndex < 0 || (totalParts > 0 && partIndex >= totalParts)) {
    return null;
  }

  return {
    version: 1,
    fileId,
    partIndex,
    totalParts,
    partSha256: partSha256.toLowerCase(),
  };
}

export function formatRemoteManifestCaption(fileId: string, sha256: string): string {
  return `TVLT:v1:MANIFEST:${fileId}:${sha256.toLowerCase()}`;
}

export function parseRemoteManifestCaption(
  caption: string,
): { fileId: string; sha256: string } | null {
  const match = caption.trim().match(REMOTE_MANIFEST_CAPTION_REGEX);
  if (!match || !match[1] || !match[2]) {
    return null;
  }
  return {
    fileId: match[1],
    sha256: match[2].toLowerCase(),
  };
}

export function serializeRemoteManifest(manifest: RemoteFileManifest): Buffer {
  return Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
}

export function deserializeRemoteManifest(
  content: string | Buffer,
): RemoteFileManifest | null {
  try {
    const str = typeof content === "string" ? content : content.toString("utf8");
    const parsed = JSON.parse(str) as RemoteFileManifest;
    if (
      parsed &&
      parsed.manifestVersion === 1 &&
      typeof parsed.fileId === "string" &&
      typeof parsed.originalFilename === "string" &&
      typeof parsed.totalSize === "number" &&
      typeof parsed.sha256 === "string" &&
      typeof parsed.totalParts === "number" &&
      Array.isArray(parsed.parts)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
