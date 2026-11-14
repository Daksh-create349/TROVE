import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { ConflictError, NotFoundError } from "../utils/errors";

const BOUNDED_CHUNK_SIZE = 64 * 1024; // 64 KB bounded read/write buffer

export interface SourceFileMetadata {
  path: string;
  size: number;
  mtimeMs: number;
  sha256: string;
}

export interface ExtractedSegment {
  path: string;
  sha256: string;
  size: number;
}

/**
 * Computes the SHA-256 hash, size, and modification timestamp of a local file
 * using a bounded streaming pipeline without loading the file into RAM.
 */
export async function computeFileMetadataStream(
  filePath: string,
): Promise<SourceFileMetadata> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(`Source file not found: ${filePath}`);
    }
    throw error;
  }

  const hash = createHash("sha256");
  const stream = createReadStream(filePath, {
    highWaterMark: BOUNDED_CHUNK_SIZE,
  });

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  // Re-verify that the file was not modified while hashing
  const statAfter = await fs.stat(filePath);
  if (
    statAfter.size !== stat.size ||
    Math.floor(statAfter.mtimeMs) !== Math.floor(stat.mtimeMs)
  ) {
    throw new ConflictError(
      `Source file was modified while hashing: ${filePath}`,
    );
  }

  return {
    path: filePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: hash.digest("hex"),
  };
}

/**
 * Extracts a byte-range segment [offset, offset + size - 1] from the source file
 * and writes it to targetTempPath using a bounded 64 KB stream buffer.
 *
 * Verifies that the source file size and modification time have not changed.
 */
export async function extractSegmentToTempFile(input: {
  sourcePath: string;
  offset: number;
  size: number;
  targetTempPath: string;
  expectedMtimeMs: number;
  expectedTotalSize: number;
}): Promise<ExtractedSegment> {
  let stat;
  try {
    stat = await fs.stat(input.sourcePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(`Source file not found: ${input.sourcePath}`);
    }
    throw error;
  }

  if (
    stat.size !== input.expectedTotalSize ||
    Math.floor(stat.mtimeMs) !== Math.floor(input.expectedMtimeMs)
  ) {
    throw new ConflictError(
      `Source file was modified during upload: ${input.sourcePath}`,
    );
  }

  await fs.mkdir(dirname(input.targetTempPath), { recursive: true });

  // Handle empty segment (e.g. 0-byte file)
  if (input.size === 0) {
    await fs.writeFile(input.targetTempPath, Buffer.alloc(0));
    const emptySha256 = createHash("sha256").digest("hex");
    return {
      path: input.targetTempPath,
      sha256: emptySha256,
      size: 0,
    };
  }

  const hash = createHash("sha256");
  const readStream = createReadStream(input.sourcePath, {
    start: input.offset,
    end: input.offset + input.size - 1,
    highWaterMark: BOUNDED_CHUNK_SIZE,
  });

  const writeStream = createWriteStream(input.targetTempPath);

  try {
    readStream.on("data", (chunk: Buffer | string) => {
      hash.update(chunk);
    });

    await pipeline(readStream, writeStream);

    // Verify source file again after reading
    const statAfter = await fs.stat(input.sourcePath);
    if (
      statAfter.size !== input.expectedTotalSize ||
      Math.floor(statAfter.mtimeMs) !== Math.floor(input.expectedMtimeMs)
    ) {
      throw new ConflictError(
        `Source file was modified during segment extraction: ${input.sourcePath}`,
      );
    }

    return {
      path: input.targetTempPath,
      sha256: hash.digest("hex"),
      size: input.size,
    };
  } catch (error) {
    // Clean up temporary file on failure
    try {
      await fs.unlink(input.targetTempPath);
    } catch {
      // Ignore cleanup error on failure
    }
    throw error;
  }
}

/**
 * Safely removes a list of temporary files if they exist.
 */
export async function cleanupTempFiles(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await fs.unlink(path);
    } catch {
      // Ignore missing or locked files during cleanup
    }
  }
}
