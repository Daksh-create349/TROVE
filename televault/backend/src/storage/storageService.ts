import { readdir, stat, statfs } from "node:fs/promises";
import { join } from "node:path";
import type { StorageStats } from "@shared/types";
import type { AppConfig } from "../config/env";
import type { AppDatabase } from "../database/database";
import type { FileRepository } from "../database/repositories/fileRepository";

async function directorySizeBytes(directory: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    try {
      if (entry.isSymbolicLink()) {
        // Never follow symlinks when accounting for local storage.
        continue;
      }
      if (entry.isDirectory()) {
        total += await directorySizeBytes(entryPath);
      } else if (entry.isFile()) {
        const fileStat = await stat(entryPath);
        total += fileStat.size;
      }
    } catch {
      // Files can disappear while scanning; ignore them.
    }
  }
  return total;
}

export class StorageService {
  constructor(
    private readonly database: AppDatabase,
    private readonly config: AppConfig,
    private readonly files: FileRepository,
  ) {}

  async getStats(): Promise<StorageStats> {
    const fileStats = this.files.stats();
    const dataDirectoryBytes = await directorySizeBytes(this.config.dataDir);

    let diskFreeBytes: number | null = null;
    let diskTotalBytes: number | null = null;
    try {
      const fsStats = await statfs(this.config.dataDir);
      diskFreeBytes = fsStats.bavail * fsStats.bsize;
      diskTotalBytes = fsStats.blocks * fsStats.bsize;
    } catch {
      // statfs is not available on every platform/filesystem combination.
    }

    return {
      ...fileStats,
      databaseBytes: this.database.fileSizeBytes(),
      dataDirectoryBytes,
      diskFreeBytes,
      diskTotalBytes,
    };
  }
}
