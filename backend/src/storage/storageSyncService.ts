import type { Logger } from "pino";
import type { StorageSyncStatus } from "@shared/types";
import type { FilePartRepository } from "../database/repositories/filePartRepository";
import type { FileRepository } from "../database/repositories/fileRepository";
import type { TelegramService } from "../telegram/telegramService";
import {
  deserializeRemoteManifest,
  parseManifestCaption,
  parseRemoteManifestCaption,
} from "../uploads/manifest";
import { nowIso } from "../utils/crypto";
import { ConflictError, ServiceUnavailableError } from "../utils/errors";

export interface StorageSyncServiceOptions {
  telegramService: TelegramService;
  fileRepository: FileRepository;
  filePartRepository: FilePartRepository;
  logger: Logger;
}

export class StorageSyncService {
  private readonly telegramService: TelegramService;
  private readonly files: FileRepository;
  private readonly parts: FilePartRepository;
  private readonly logger: Logger;

  private status: StorageSyncStatus = {
    isSyncing: false,
    lastSyncedAt: null,
    scannedMessagesCount: 0,
    importedFilesCount: 0,
    reconstructedPartsCount: 0,
    missingSegmentsCount: 0,
    lastError: null,
  };

  constructor(options: StorageSyncServiceOptions) {
    this.telegramService = options.telegramService;
    this.files = options.fileRepository;
    this.parts = options.filePartRepository;
    this.logger = options.logger.child({ module: "storage-sync" });
  }

  getStatus(): StorageSyncStatus {
    return { ...this.status };
  }

  async sync(): Promise<StorageSyncStatus> {
    if (this.status.isSyncing) {
      throw new ConflictError("Storage synchronization is already in progress");
    }

    const telegramStatus = this.telegramService.getStatus();
    if (telegramStatus.state !== "connected") {
      throw new ServiceUnavailableError(
        "Telegram is not connected. Connect your account before syncing.",
      );
    }

    this.status.isSyncing = true;
    this.status.lastError = null;

    try {
      this.logger.info("Starting remote synchronization scan of Saved Messages");

      // 1. Paged scan of Saved Messages
      const PAGE_SIZE = 100;
      let offsetId: string | undefined;
      const allMessages: Array<{
        id: string;
        caption: string;
        hasDocument: boolean;
        documentSize?: number;
        documentFilename?: string;
      }> = [];

      while (true) {
        const batch = await this.telegramService.iterMessages({
          limit: PAGE_SIZE,
          offsetId,
        });

        if (batch.length === 0) {
          break;
        }

        allMessages.push(...batch);

        if (batch.length < PAGE_SIZE) {
          break;
        }

        offsetId = batch[batch.length - 1]?.id;
      }

      this.status.scannedMessagesCount = allMessages.length;
      let importedFilesCount = 0;
      let reconstructedPartsCount = 0;
      let missingSegmentsCount = 0;

      // Group found markers
      const manifestMessages: Array<{ id: string; fileId: string; sha256: string }> = [];
      const segmentMessages: Array<{
        messageId: string;
        fileId: string;
        partIndex: number;
        totalParts: number;
        partSha256: string;
        documentSize: number;
        documentFilename: string;
      }> = [];

      for (const msg of allMessages) {
        if (!msg.caption) continue;

        // Check for remote manifest caption: TVLT:v1:MANIFEST:<file-uuid>:<sha256>
        const manifestInfo = parseRemoteManifestCaption(msg.caption);
        if (manifestInfo) {
          manifestMessages.push({
            id: msg.id,
            fileId: manifestInfo.fileId,
            sha256: manifestInfo.sha256,
          });
          continue;
        }

        // Check for segment caption: TVLT:v1:<file-uuid>:<part-index>:<total-parts>:<part-sha256>
        const segInfo = parseManifestCaption(msg.caption);
        if (segInfo) {
          segmentMessages.push({
            messageId: msg.id,
            fileId: segInfo.fileId,
            partIndex: segInfo.partIndex,
            totalParts: segInfo.totalParts,
            partSha256: segInfo.partSha256,
            documentSize: msg.documentSize ?? 0,
            documentFilename: msg.documentFilename ?? "unnamed.bin",
          });
        }
      }

      const importedFileIds = new Set<string>();

      // 2. Process Manifest Messages first
      for (const manifestMsg of manifestMessages) {
        if (importedFileIds.has(manifestMsg.fileId)) {
          continue; // Handle duplicate manifests by keeping first valid
        }

        try {
          const manifest = await this.telegramService.downloadManifest({
            messageId: manifestMsg.id,
          });

          if (!manifest || manifest.manifestVersion !== 1) {
            continue; // Skip invalid or unsupported manifest version
          }

          const existingFile = this.files.getById(manifest.fileId);
          if (!existingFile) {
            // Reconstruct missing file and segment records in SQLite
            this.files.create({
              id: manifest.fileId,
              folderId: null,
              originalFilename: manifest.originalFilename,
              mimeType: manifest.mimeType,
              totalSize: manifest.totalSize,
              sha256: manifest.sha256,
              partCount: manifest.totalParts,
              telegramPeerId: this.telegramService.getSavedMessagesPeer()?.peerId || null,
              telegramMessageIds: [
                ...manifest.parts.map((p) => p.telegramMessageId),
                manifestMsg.id,
              ],
              status: "completed",
            });

            if (manifest.parts.length > 0) {
              this.parts.createMany(
                manifest.fileId,
                manifest.parts.map((p) => ({
                  partIndex: p.partIndex,
                  partSize: p.partSize,
                  sha256: p.sha256,
                  telegramMessageId: p.telegramMessageId,
                  status: "completed",
                })),
              );
              reconstructedPartsCount += manifest.parts.length;
            }

            importedFilesCount++;
            importedFileIds.add(manifest.fileId);
          } else {
            importedFileIds.add(manifest.fileId);
          }
        } catch (err) {
          this.logger.warn({ manifestMsg, err }, "Failed to import remote manifest");
        }
      }

      // 3. Process Segment Messages (Loose Segments without manifests)
      const segmentsByFile = new Map<string, typeof segmentMessages>();
      for (const seg of segmentMessages) {
        if (importedFileIds.has(seg.fileId)) {
          continue; // Already processed via manifest
        }
        const list = segmentsByFile.get(seg.fileId) || [];
        list.push(seg);
        segmentsByFile.set(seg.fileId, list);
      }

      for (const [fileId, segList] of segmentsByFile.entries()) {
        const existingFile = this.files.getById(fileId);
        if (existingFile) {
          continue;
        }

        const totalParts = segList[0]!.totalParts;
        const partMap = new Map<number, (typeof segList)[0]>();
        for (const seg of segList) {
          if (!partMap.has(seg.partIndex)) {
            partMap.set(seg.partIndex, seg);
          }
        }

        // Check if all parts are present
        let allPresent = true;
        for (let i = 0; i < totalParts; i++) {
          if (!partMap.has(i)) {
            allPresent = false;
            missingSegmentsCount++;
          }
        }

        if (allPresent) {
          const sortedParts: typeof segmentMessages = [];
          for (let i = 0; i < totalParts; i++) {
            sortedParts.push(partMap.get(i)!);
          }

          const totalSize = sortedParts.reduce((sum, p) => sum + p.documentSize, 0);
          const originalFilename = sortedParts[0]?.documentFilename || "recovered.bin";

          this.files.create({
            id: fileId,
            folderId: null,
            originalFilename,
            mimeType: "application/octet-stream",
            totalSize,
            sha256: null,
            partCount: totalParts,
            telegramPeerId: this.telegramService.getSavedMessagesPeer()?.peerId || null,
            telegramMessageIds: sortedParts.map((p) => p.messageId),
            status: "completed",
          });

          this.parts.createMany(
            fileId,
            sortedParts.map((p) => ({
              partIndex: p.partIndex,
              partSize: p.documentSize,
              sha256: p.partSha256,
              telegramMessageId: p.messageId,
              status: "completed",
            })),
          );

          importedFilesCount++;
          reconstructedPartsCount += totalParts;
          importedFileIds.add(fileId);
        }
      }

      // 4. Validate existing SQLite files against Telegram messages
      const remoteMsgIdSet = new Set(allMessages.map((m) => m.id));
      const localFiles = this.files.list({ limit: 500, offset: 0 });

      for (const file of localFiles.items) {
        if (file.status === "completed" && file.telegramMessageIds.length > 0) {
          // Check if any referenced message was deleted from Telegram
          const missingRemote = file.telegramMessageIds.some(
            (id) => !remoteMsgIdSet.has(id),
          );
          if (missingRemote) {
            this.files.updateStatus(file.id, "failed");
            this.logger.warn(
              { fileId: file.id },
              "Remote messages deleted from Telegram; marking file as failed",
            );
          }
        }
      }

      this.status.importedFilesCount = importedFilesCount;
      this.status.reconstructedPartsCount = reconstructedPartsCount;
      this.status.missingSegmentsCount = missingSegmentsCount;
      this.status.lastSyncedAt = nowIso();

      this.logger.info(
        {
          scanned: this.status.scannedMessagesCount,
          importedFiles: importedFilesCount,
          reconstructedParts: reconstructedPartsCount,
          missingSegments: missingSegmentsCount,
        },
        "Remote synchronization completed",
      );

      return { ...this.status };
    } catch (error) {
      const message = (error as Error).message || String(error);
      this.status.lastError = message;
      this.logger.error({ error }, "Remote synchronization failed");
      throw error;
    } finally {
      this.status.isSyncing = false;
    }
  }
}

