import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";
import type { Request, Response } from "express";
import type { Logger } from "pino";
import type { FilePartRepository } from "../database/repositories/filePartRepository";
import type { FileRepository } from "../database/repositories/fileRepository";
import type { TelegramService } from "../telegram/telegramService";
import { cleanupTempFiles, computeFileMetadataStream } from "../uploads/localFileSource";
import { ConflictError, NotFoundError, ServiceUnavailableError } from "../utils/errors";

const BOUNDED_CHUNK_SIZE = 64 * 1024; // 64 KB

export interface FileStreamerOptions {
  telegramService: TelegramService;
  fileRepository: FileRepository;
  filePartRepository: FilePartRepository;
  dataDir: string;
  logger: Logger;
}

export class FileStreamer {
  private readonly telegramService: TelegramService;
  private readonly files: FileRepository;
  private readonly parts: FilePartRepository;
  private readonly tempDir: string;
  private readonly logger: Logger;

  constructor(options: FileStreamerOptions) {
    this.telegramService = options.telegramService;
    this.files = options.fileRepository;
    this.parts = options.filePartRepository;
    this.tempDir = join(options.dataDir, "tmp", "stream");
    this.logger = options.logger.child({ module: "file-streamer" });
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  async streamFile(
    req: Request,
    res: Response,
    input: { fileId: string; disposition: "attachment" | "inline" },
  ): Promise<void> {
    const telegramStatus = this.telegramService.getStatus();
    if (telegramStatus.state !== "connected") {
      throw new ServiceUnavailableError(
        "Telegram is not connected. Connect your account before downloading.",
      );
    }

    const file = this.files.getById(input.fileId);
    if (!file) {
      throw new NotFoundError(`File not found: ${input.fileId}`);
    }

    if (file.status !== "completed") {
      throw new ConflictError("Only completed files can be downloaded");
    }

    const safeFilename = file.originalFilename.replace(/["\r\n\\]/g, "_");

    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader("Content-Length", String(file.totalSize));
    if (file.sha256) {
      res.setHeader("ETag", `"${file.sha256}"`);
    }
    res.setHeader(
      "Content-Disposition",
      `${input.disposition}; filename="${safeFilename}"`,
    );

    // Empty file handling
    if (file.totalSize === 0) {
      res.end();
      return;
    }

    const parts = this.parts.listByFile(file.id);
    parts.sort((a, b) => a.partIndex - b.partIndex);

    if (parts.length === 0) {
      throw new ConflictError("No segment parts found for file");
    }

    for (const part of parts) {
      if (!part.telegramMessageId) {
        throw new ConflictError(`File part ${part.partIndex} has no Telegram message ID`);
      }
    }

    let isAborted = false;
    const abortHandler = () => {
      isAborted = true;
    };
    req.on("close", abortHandler);

    const hash = createHash("sha256");

    try {
      for (const part of parts) {
        if (isAborted || res.destroyed || res.writableEnded) {
          break;
        }

        const tempChunkPath = join(
          this.tempDir,
          `stream_${file.id}_${part.partIndex}_${Date.now()}.bin`,
        );

        try {
          // Download segment chunk from Telegram
          await this.telegramService.downloadSegment({
            messageId: part.telegramMessageId!,
            targetPath: tempChunkPath,
          });

          // Verify segment integrity before streaming
          const chunkMeta = await computeFileMetadataStream(tempChunkPath);
          if (part.sha256 && chunkMeta.sha256 !== part.sha256.toLowerCase()) {
            this.logger.error(
              { fileId: file.id, partIndex: part.partIndex },
              "Segment integrity check failed during HTTP streaming",
            );
            res.destroy(new Error("Segment integrity verification failed"));
            return;
          }

          // Stream chunk bytes to client with bounded buffer
          const readStream = createReadStream(tempChunkPath, {
            highWaterMark: BOUNDED_CHUNK_SIZE,
          });

          for await (const chunk of readStream) {
            if (isAborted || res.destroyed) {
              break;
            }
            hash.update(chunk);
            if (!res.write(chunk)) {
              await once(res, "drain");
            }
          }
        } finally {
          await cleanupTempFiles([tempChunkPath]);
        }
      }

      if (!isAborted && !res.destroyed) {
        const finalSha256 = hash.digest("hex");
        if (file.sha256 && finalSha256 !== file.sha256.toLowerCase()) {
          this.logger.error(
            { fileId: file.id, expected: file.sha256, actual: finalSha256 },
            "Total reconstructed file SHA-256 mismatch during streaming",
          );
          res.destroy(new Error("File integrity check failed: SHA-256 mismatch"));
          return;
        }
        res.end();
      }
    } finally {
      req.off("close", abortHandler);
    }
  }
}

