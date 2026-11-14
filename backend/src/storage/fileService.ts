import type {
  FileDeletionResult,
  FileMetadata,
  FilePart,
  FileStatus,
  Paginated,
} from "@shared/types";
import type { AppDatabase } from "../database/database";
import type {
  CreateFilePartInput,
  FilePartRepository,
} from "../database/repositories/filePartRepository";
import type {
  FileRepository,
  ListFilesInput,
} from "../database/repositories/fileRepository";
import type { FolderRepository } from "../database/repositories/folderRepository";
import type { TelegramService } from "../telegram/telegramService";
import { assertSafeFilename } from "../security/pathSafety";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../utils/errors";
import { isSha256Hex } from "../utils/crypto";
import {
  isCheckViolation,
  isForeignKeyViolation,
  isUniqueViolation,
} from "../utils/sqlite";

export interface CreateFileInput {
  folderId?: string | null;
  originalFilename: string;
  mimeType?: string;
  totalSize: number;
  sha256?: string | null;
  partCount?: number;
  telegramPeerId?: string | null;
  telegramMessageIds?: string[];
  status?: FileStatus;
  parts?: CreateFilePartInput[];
}

const MIME_TYPE = /^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]{0,126}\/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]{0,126}$/;

function normalizeSha256(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const normalized = value.toLowerCase();
  if (!isSha256Hex(normalized)) {
    throw new ValidationError("sha256 must be a 64-character hexadecimal digest");
  }
  return normalized;
}

function validateMimeType(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    return "application/octet-stream";
  }
  const mimeType = value.trim();
  if (!MIME_TYPE.test(mimeType) || mimeType.length > 255) {
    throw new ValidationError("mimeType is not a valid MIME type");
  }
  return mimeType;
}

export class FileService {
  constructor(
    private readonly database: AppDatabase,
    private readonly files: FileRepository,
    private readonly parts: FilePartRepository,
    private readonly folders: FolderRepository,
  ) {}

  createFile(input: CreateFileInput): FileMetadata {
    const originalFilename = assertSafeFilename(input.originalFilename);
    const mimeType = validateMimeType(input.mimeType);

    if (!Number.isSafeInteger(input.totalSize) || input.totalSize < 0) {
      throw new ValidationError("totalSize must be a non-negative integer");
    }

    const partCount = input.partCount ?? input.parts?.length ?? 0;
    if (!Number.isSafeInteger(partCount) || partCount < 0) {
      throw new ValidationError("partCount must be a non-negative integer");
    }

    if (input.folderId) {
      if (!this.folders.exists(input.folderId)) {
        throw new NotFoundError("Folder");
      }
    }

    const parts = input.parts ?? [];
    if (parts.length > 0) {
      if (parts.length !== partCount) {
        throw new ValidationError("partCount must match the number of parts");
      }

      const sorted = [...parts].sort((a, b) => a.partIndex - b.partIndex);
      let totalSize = 0;
      for (const [position, part] of sorted.entries()) {
        if (part.partIndex !== position) {
          throw new ValidationError(
            "Part indexes must be contiguous and start at 0",
          );
        }
        if (!Number.isSafeInteger(part.partSize) || part.partSize <= 0) {
          throw new ValidationError("Every part must have a positive integer size");
        }
        totalSize += part.partSize;
      }
      if (totalSize !== input.totalSize) {
        throw new ValidationError(
          "The sum of part sizes must equal totalSize",
        );
      }
    }

    const status = input.status ?? "queued";
    if (
      !["queued", "processing", "paused", "failed", "completed"].includes(
        status,
      )
    ) {
      throw new ValidationError("Invalid file status");
    }

    const telegramMessageIds = (input.telegramMessageIds ?? []).map(String);
    if (telegramMessageIds.some((id) => id.length === 0 || id.length > 64)) {
      throw new ValidationError("telegramMessageIds contains an invalid id");
    }

    try {
      return this.database.transaction(() => {
        const file = this.files.create({
          folderId: input.folderId ?? null,
          originalFilename,
          mimeType,
          totalSize: input.totalSize,
          sha256: normalizeSha256(input.sha256),
          partCount,
          telegramPeerId: input.telegramPeerId ?? null,
          telegramMessageIds,
          status,
        });

        if (parts.length > 0) {
          this.parts.createMany(
            file.id,
            parts.map((part) => ({
              ...part,
              sha256: normalizeSha256(part.sha256),
            })),
          );
        }

        return file;
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new NotFoundError("Folder");
      }
      if (isUniqueViolation(error)) {
        throw new ConflictError("A file part index is duplicated");
      }
      if (isCheckViolation(error)) {
        throw new ValidationError("File metadata violates a database constraint");
      }
      throw error;
    }
  }

  getFile(id: string): FileMetadata {
    const file = this.files.getById(id);
    if (!file) {
      throw new NotFoundError("File");
    }
    return file;
  }

  listFiles(input: ListFilesInput): Paginated<FileMetadata> {
    return this.files.list(input);
  }

  listParts(fileId: string): FilePart[] {
    this.getFile(fileId);
    return this.parts.listByFile(fileId);
  }

  updateStatus(id: string, status: FileStatus): FileMetadata {
    const file = this.files.updateStatus(id, status);
    if (!file) {
      throw new NotFoundError("File");
    }
    return file;
  }

  setTelegramReferences(input: {
    id: string;
    telegramPeerId: string | null;
    telegramMessageIds: string[];
  }): FileMetadata {
    const file = this.files.setTelegramReferences(input);
    if (!file) {
      throw new NotFoundError("File");
    }
    return file;
  }

  deleteFile(id: string): void {
    if (!this.files.delete(id)) {
      throw new NotFoundError("File");
    }
  }

  async safeDeleteFile(
    id: string,
    telegramService: TelegramService,
  ): Promise<FileDeletionResult> {
    const file = this.getFile(id);
    const parts = this.parts.listByFile(id);

    const partMessageIds = parts
      .map((p) => p.telegramMessageId)
      .filter((m): m is string => typeof m === "string" && m.length > 0);
    const fileMessageIds = (file.telegramMessageIds ?? []).filter(
      (m): m is string => typeof m === "string" && m.length > 0,
    );

    const allMessageIds = Array.from(
      new Set([...partMessageIds, ...fileMessageIds]),
    );

    let deletedIds: string[] = [];
    let failedIds: string[] = [];

    if (allMessageIds.length > 0) {
      if (telegramService.isConnected()) {
        const deleteResult = await telegramService.deleteMessages(
          allMessageIds,
          file.telegramPeerId ?? undefined,
        );
        deletedIds = deleteResult.deletedIds;
        failedIds = deleteResult.failedIds;
      }
    }

    if (failedIds.length > 0) {
      this.files.setTelegramReferences({
        id: file.id,
        telegramPeerId: file.telegramPeerId,
        telegramMessageIds: failedIds,
      });

      throw new AppError(
        502,
        "INTERNAL_ERROR",
        "Some remote Telegram messages could not be deleted",
        {
          expose: true,
          details: {
            fileId: id,
            deleted: false,
            deletedTelegramMessages: deletedIds,
            failedTelegramMessages: failedIds,
          },
        },
      );
    }

    this.files.delete(id);

    return {
      fileId: id,
      deleted: true,
      deletedTelegramMessages: deletedIds,
      failedTelegramMessages: [],
    };
  }
}
