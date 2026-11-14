import { relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { AppError, ForbiddenError, ValidationError } from "../utils/errors";

const WINDOWS_RESERVED_NAMES =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Validate a user-supplied filename. Only a bare filename is accepted: path
 * separators, traversal segments, control characters and platform-reserved
 * device names are rejected.
 */
export function assertSafeFilename(filename: string): string {
  if (typeof filename !== "string") {
    throw new ValidationError("Filename must be a string");
  }

  const name = filename.trim();
  if (name.length === 0) {
    throw new ValidationError("Filename cannot be empty");
  }
  if (name.length > 255) {
    throw new ValidationError("Filename cannot exceed 255 characters");
  }
  if (CONTROL_CHARACTERS.test(name)) {
    throw new ValidationError("Filename contains control characters");
  }
  if (
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    /^[a-zA-Z]:/.test(name)
  ) {
    throw new ValidationError(
      "Filename must not contain path separators or traversal segments",
    );
  }
  if (/[<>:"|?*]/.test(name)) {
    throw new ValidationError(
      "Filename contains characters that are not portable across platforms",
    );
  }
  if (/[. ]$/.test(name)) {
    throw new ValidationError("Filename cannot end with a dot or a space");
  }
  if (WINDOWS_RESERVED_NAMES.test(name)) {
    throw new ValidationError("Filename uses a reserved device name");
  }

  return name;
}

/** True when `candidate` is the base directory or one of its descendants. */
export function isPathInside(baseDir: string, candidate: string): boolean {
  const base = resolve(baseDir);
  const target = resolve(candidate);
  const relation = relative(base, target);
  return (
    relation === "" ||
    (!relation.startsWith("..") && !relation.startsWith(sep) && relation !== "..")
  );
}

/**
 * Resolve path segments beneath a trusted base directory. This is the only
 * supported way to turn client input into a filesystem path.
 *
 * Each segment must be a single, plain path component. Separators, traversal
 * segments, drive letters, and control characters are rejected on every
 * platform so behavior does not depend on the host OS.
 */
export function resolveWithin(
  baseDir: string,
  ...segments: string[]
): string {
  for (const segment of segments) {
    if (typeof segment !== "string" || segment.length === 0) {
      throw new ValidationError("Path segments cannot be empty");
    }
    if (CONTROL_CHARACTERS.test(segment)) {
      throw new ValidationError("Path segments cannot contain control characters");
    }
    if (
      segment === "." ||
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\") ||
      /^[a-zA-Z]:/.test(segment)
    ) {
      throw new ForbiddenError(
        "The requested path escapes the TeleVault data directory",
      );
    }
  }

  if (segments.length === 0) {
    return resolve(baseDir);
  }

  const resolved = resolve(baseDir, ...segments);
  if (!isPathInside(baseDir, resolved)) {
    throw new ForbiddenError("The requested path escapes the TeleVault data directory");
  }
  return resolved;
}

/**
 * Symlink-aware containment check for paths that already exist on disk.
 * Use this before reading or writing a file supplied by the client.
 */
export async function assertRealPathWithin(
  baseDir: string,
  candidate: string,
): Promise<void> {
  let realBase: string;
  let realCandidate: string;
  try {
    realBase = await realpath(baseDir);
    realCandidate = await realpath(candidate);
  } catch (error) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "The requested path does not exist or cannot be resolved",
      { cause: error },
    );
  }

  if (!isPathInside(realBase, realCandidate)) {
    throw new ForbiddenError(
      "The requested path escapes the TeleVault data directory",
    );
  }
}
