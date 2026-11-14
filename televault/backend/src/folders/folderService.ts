import type { Folder } from "@shared/types";
import type { FolderRepository } from "../database/repositories/folderRepository";
import { assertSafeFilename } from "../security/pathSafety";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors";
import { isForeignKeyViolation, isUniqueViolation } from "../utils/sqlite";

export class FolderService {
  constructor(private readonly folders: FolderRepository) {}

  listFolders(): Folder[] {
    return this.folders.list();
  }

  getFolder(id: string): Folder {
    const folder = this.folders.getById(id);
    if (!folder) {
      throw new NotFoundError("Folder");
    }
    return folder;
  }

  getOrCreateFolder(input: { name: string; parentId?: string | null }): Folder {
    const name = assertSafeFilename(input.name);
    const parentId = input.parentId ?? null;
    const existing = this.folders.findByNameAndParent(name, parentId);
    if (existing) {
      return existing;
    }
    return this.createFolder({ name, parentId });
  }

  createFolder(input: { name: string; parentId?: string | null }): Folder {
    const name = assertSafeFilename(input.name);
    const parentId = input.parentId ?? null;

    if (parentId !== null) {
      if (parentId === "") {
        throw new ValidationError("parentId cannot be empty");
      }
      if (!this.folders.exists(parentId)) {
        throw new NotFoundError("Parent folder");
      }
    }

    try {
      return this.folders.create({ name, parentId });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          "A folder with this name already exists in the parent folder",
        );
      }
      if (isForeignKeyViolation(error)) {
        throw new NotFoundError("Parent folder");
      }
      throw error;
    }
  }

  renameFolder(id: string, name: string): Folder {
    const safeName = assertSafeFilename(name);
    try {
      const folder = this.folders.rename(id, safeName);
      if (!folder) {
        throw new NotFoundError("Folder");
      }
      return folder;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          "A folder with this name already exists in the parent folder",
        );
      }
      throw error;
    }
  }

  deleteFolder(id: string): void {
    const deleted = this.folders.delete(id);
    if (!deleted) {
      throw new NotFoundError("Folder");
    }
  }
}
