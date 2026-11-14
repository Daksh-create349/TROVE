import { ZipArchive } from "archiver";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";
import type { Request, Response } from "express";
import type { Logger } from "pino";
import type { FolderRepository } from "../database/repositories/folderRepository";
import type { FileRepository } from "../database/repositories/fileRepository";
import type { FilePartRepository } from "../database/repositories/filePartRepository";
import type { TelegramService } from "../telegram/telegramService";
import { cleanupTempFiles } from "../uploads/localFileSource";
import { NotFoundError, ServiceUnavailableError } from "../utils/errors";

export interface FolderZipServiceOptions {
  folderRepository: FolderRepository;
  fileRepository: FileRepository;
  filePartRepository: FilePartRepository;
  telegramService: TelegramService;
  dataDir: string;
  logger: Logger;
}

export class FolderZipService {
  private readonly folders: FolderRepository;
  private readonly files: FileRepository;
  private readonly parts: FilePartRepository;
  private readonly telegramService: TelegramService;
  private readonly tempDir: string;
  private readonly logger: Logger;

  constructor(options: FolderZipServiceOptions) {
    this.folders = options.folderRepository;
    this.files = options.fileRepository;
    this.parts = options.filePartRepository;
    this.telegramService = options.telegramService;
    this.tempDir = join(options.dataDir, "tmp", "zip-stream");
    this.logger = options.logger.child({ module: "folder-zip-service" });
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  async streamFolderZip(req: Request, res: Response, folderId: string): Promise<void> {
    const telegramStatus = this.telegramService.getStatus();
    if (telegramStatus.state !== "connected") {
      throw new ServiceUnavailableError(
        "Telegram is not connected. Connect your account before downloading.",
      );
    }

    const rootFolder = this.folders.getById(folderId);
    if (!rootFolder) {
      throw new NotFoundError("Folder");
    }

    const subfolders = this.folders.listSubtreeWithPaths(folderId);
    const files = this.folders.listFilesForSubtree(folderId);

    const safeZipFilename = rootFolder.name.replace(/[/\\?%*:|"<>]/g, "_") + ".zip";

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(safeZipFilename)}"`,
    );

    const archive = new ZipArchive({ zlib: { level: 6 } });

    let isAborted = false;
    const abortHandler = () => {
      isAborted = true;
      archive.abort();
    };
    req.on("close", abortHandler);

    archive.on("error", (err: unknown) => {
      this.logger.error({ err, folderId }, "Archiver error while creating ZIP");
      if (!res.headersSent) {
        res.status(500).end();
      } else if (!res.writableEnded) {
        res.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    });

    archive.pipe(res);

    try {
      // 1. Add directories so empty folders are preserved in the zip
      for (const folder of subfolders) {
        if (folder.relativePath) {
          archive.append(Buffer.alloc(0), { name: folder.relativePath + "/" });
        }
      }

      // 2. Add files
      for (const file of files) {
        if (isAborted || res.destroyed || res.writableEnded) break;

        // Empty file handling
        if (file.totalSize === 0) {
          archive.append(Buffer.alloc(0), { name: file.relativePath });
          continue;
        }

        const fileParts = this.parts.listByFile(file.id);
        fileParts.sort((a, b) => a.partIndex - b.partIndex);

        if (fileParts.length === 0) {
          this.logger.warn({ fileId: file.id }, "No parts found for file during ZIP download");
          continue;
        }

        if (fileParts.length === 1) {
          const part = fileParts[0];
          if (!part || !part.telegramMessageId) continue;

          const tempChunkPath = join(
            this.tempDir,
            `zip_${file.id}_0_${Date.now()}.bin`,
          );

          try {
            await this.telegramService.downloadSegment({
              messageId: part.telegramMessageId,
              targetPath: tempChunkPath,
            });

            if (isAborted || res.destroyed) break;

            await new Promise<void>((resolve, reject) => {
              const entryHandler = (entry: { name: string }) => {
                if (entry.name === file.relativePath) {
                  archive.off("entry", entryHandler);
                  resolve();
                }
              };
              archive.on("entry", entryHandler);
              archive.once("error", reject);
              archive.file(tempChunkPath, { name: file.relativePath });
            });
          } finally {
            await cleanupTempFiles([tempChunkPath]);
          }
        } else {
          // Multi-part file: stream segments sequentially into a temp file
          const assembledTempPath = join(
            this.tempDir,
            `zip_assembled_${file.id}_${Date.now()}.bin`,
          );
          const writeStream = createWriteStream(assembledTempPath, { flags: "a" });

          try {
            for (const part of fileParts) {
              if (isAborted || res.destroyed) break;
              if (!part.telegramMessageId) continue;

              const tempChunkPath = join(
                this.tempDir,
                `zip_part_${file.id}_${part.partIndex}_${Date.now()}.bin`,
              );

              try {
                await this.telegramService.downloadSegment({
                  messageId: part.telegramMessageId,
                  targetPath: tempChunkPath,
                });

                const readStream = createReadStream(tempChunkPath);
                for await (const chunk of readStream) {
                  if (isAborted || res.destroyed) break;
                  writeStream.write(chunk);
                }
              } finally {
                await cleanupTempFiles([tempChunkPath]);
              }
            }

            writeStream.end();
            await once(writeStream, "finish");

            if (isAborted || res.destroyed) break;

            await new Promise<void>((resolve, reject) => {
              const entryHandler = (entry: { name: string }) => {
                if (entry.name === file.relativePath) {
                  archive.off("entry", entryHandler);
                  resolve();
                }
              };
              archive.on("entry", entryHandler);
              archive.once("error", reject);
              archive.file(assembledTempPath, { name: file.relativePath });
            });
          } finally {
            await cleanupTempFiles([assembledTempPath]);
          }
        }
      }

      if (!isAborted && !res.destroyed) {
        await archive.finalize();
      }
    } finally {
      req.off("close", abortHandler);
    }
  }
}
