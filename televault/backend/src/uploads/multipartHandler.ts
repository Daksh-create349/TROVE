import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import { join } from "node:path";
import type { Request } from "express";
import busboy from "busboy";
import { BadRequestError, ValidationError } from "../utils/errors";
import { assertSufficientDiskSpace } from "./diskSpace";

export interface MultipartUploadResult {
  filePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  sha256: string;
  mtimeMs: number;
  folderId: string | null;
  segmentSize?: number;
}

/**
 * Handles streaming multipart file upload directly to disk using busboy
 * and bounded buffers, computing the SHA-256 hash on the fly.
 */
export async function handleMultipartUpload(
  req: Request,
  stagingDir: string,
): Promise<MultipartUploadResult> {
  await fs.mkdir(stagingDir, { recursive: true });
  await assertSufficientDiskSpace(stagingDir, 10 * 1024 * 1024);

  return new Promise<MultipartUploadResult>((resolve, reject) => {
    let bb: busboy.Busboy;
    try {
      bb = busboy({ headers: req.headers });
    } catch (error) {
      return reject(
        new BadRequestError(
          `Failed to initialize multipart parser: ${(error as Error).message}`,
        ),
      );
    }

    let fileFound = false;
    let fileWritten = false;
    let targetFilePath = "";
    let originalFileName = "";
    let detectedMimeType = "application/octet-stream";
    let folderId: string | null = null;
    let segmentSize: number | undefined;
    let totalBytes = 0;
    const hash = createHash("sha256");

    let fileStreamPromise: Promise<void> | null = null;

    bb.on("field", (name, value) => {
      if (name === "folderId" && value) {
        folderId = value.trim() || null;
      } else if (name === "segmentSize" && value) {
        const parsed = parseInt(value, 10);
        if (!isNaN(parsed) && parsed > 0) {
          segmentSize = parsed;
        }
      } else if (name === "fileName" && value && !originalFileName) {
        originalFileName = value.trim();
      }
    });

    bb.on("file", (fieldname, file, info) => {
      if (fileFound) {
        // TeleVault only accepts one file per upload request
        file.resume();
        return;
      }
      fileFound = true;
      if (!originalFileName) {
        originalFileName = info.filename || "upload.bin";
      }
      detectedMimeType = info.mimeType || "application/octet-stream";
      targetFilePath = join(stagingDir, "source.bin");

      const writeStream = createWriteStream(targetFilePath);

      fileStreamPromise = new Promise<void>((fResolve, fReject) => {
        file.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          hash.update(chunk);
        });

        file.on("error", (err) => {
          writeStream.destroy();
          fReject(err);
        });

        writeStream.on("error", (err) => {
          file.destroy();
          fReject(err);
        });

        writeStream.on("finish", () => {
          fileWritten = true;
          fResolve();
        });

        file.pipe(writeStream);
      });
    });

    bb.on("error", (err) => {
      if (targetFilePath) {
        fs.unlink(targetFilePath).catch(() => {});
      }
      reject(new BadRequestError(`Multipart parsing error: ${(err as Error).message}`));
    });

    bb.on("finish", async () => {
      if (!fileFound || !fileStreamPromise) {
        return reject(new ValidationError("No file was uploaded in the request"));
      }

      try {
        await fileStreamPromise;
        const stat = await fs.stat(targetFilePath);

        resolve({
          filePath: targetFilePath,
          fileName: originalFileName,
          fileSize: stat.size,
          mimeType: detectedMimeType,
          sha256: hash.digest("hex"),
          mtimeMs: stat.mtimeMs,
          folderId,
          segmentSize,
        });
      } catch (err) {
        if (targetFilePath) {
          fs.unlink(targetFilePath).catch(() => {});
        }
        reject(err);
      }
    });

    req.pipe(bb);
  });
}

