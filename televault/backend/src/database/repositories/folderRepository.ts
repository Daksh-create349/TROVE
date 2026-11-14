import type { Folder } from "@shared/types";
import type { AppDatabase, SqliteDatabase } from "../database";
import {
  mapFolder,
  type FolderRow,
  type FolderWithCountRow,
} from "../rows";
import { newId } from "../../utils/crypto";

export class FolderRepository {
  private readonly db: SqliteDatabase;

  constructor(database: AppDatabase) {
    this.db = database.connection;
  }

  list(): Folder[] {
    const rows = this.db
      .prepare(
        `SELECT f.*,
                (SELECT COUNT(*) FROM files fi WHERE fi.folder_id = f.id) AS file_count
           FROM folders f
          ORDER BY f.name COLLATE NOCASE ASC, f.id ASC`,
      )
      .all() as FolderWithCountRow[];
    return rows.map(mapFolder);
  }

  getById(id: string): Folder | null {
    const row = this.db
      .prepare(
        `SELECT f.*,
                (SELECT COUNT(*) FROM files fi WHERE fi.folder_id = f.id) AS file_count
           FROM folders f
          WHERE f.id = ?`,
      )
      .get(id) as FolderWithCountRow | undefined;
    return row ? mapFolder(row) : null;
  }

  exists(id: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS found FROM folders WHERE id = ?")
      .get(id) as { found: number } | undefined;
    return row !== undefined;
  }

  findByNameAndParent(name: string, parentId: string | null): Folder | null {
    const query =
      parentId === null
        ? `SELECT f.*,
                  (SELECT COUNT(*) FROM files fi WHERE fi.folder_id = f.id) AS file_count
             FROM folders f
            WHERE f.name = ? AND f.parent_id IS NULL`
        : `SELECT f.*,
                  (SELECT COUNT(*) FROM files fi WHERE fi.folder_id = f.id) AS file_count
             FROM folders f
            WHERE f.name = ? AND f.parent_id = ?`;
    const params = parentId === null ? [name] : [name, parentId];
    const row = this.db.prepare(query).get(...params) as FolderWithCountRow | undefined;
    return row ? mapFolder(row) : null;
  }

  create(input: { name: string; parentId: string | null }): Folder {
    const id = newId();
    this.db
      .prepare("INSERT INTO folders (id, parent_id, name) VALUES (?, ?, ?)")
      .run(id, input.parentId, input.name);
    return this.getById(id)!;
  }

  rename(id: string, name: string): Folder | null {
    const result = this.db
      .prepare("UPDATE folders SET name = ? WHERE id = ?")
      .run(name, id);
    return result.changes > 0 ? this.getById(id) : null;
  }

  delete(id: string): boolean {
    const subtreeIds = this.listSubtreeIds(id);
    if (subtreeIds.length === 0) return false;

    const placeholders = subtreeIds.map(() => "?").join(",");
    // Delete files inside folder subtree (cascades file_parts, upload_jobs)
    this.db.prepare(`DELETE FROM files WHERE folder_id IN (${placeholders})`).run(...subtreeIds);
    // Delete folders in subtree
    const result = this.db.prepare(`DELETE FROM folders WHERE id IN (${placeholders})`).run(...subtreeIds);
    return result.changes > 0;
  }

  /** All folders that are descendants of `id`, including `id` itself. */
  listSubtreeIds(id: string): string[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM folders WHERE id = ?
           UNION ALL
           SELECT f.id FROM folders f JOIN subtree s ON f.parent_id = s.id
         )
         SELECT id FROM subtree`,
      )
      .all(id) as { id: string }[];
    return rows.map((row) => row.id);
  }

  listSubtreeWithPaths(rootId: string): { id: string; name: string; relativePath: string }[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE subtree(id, name, parent_id, relative_path) AS (
           SELECT id, name, parent_id, name AS relative_path
             FROM folders
            WHERE id = ?
           UNION ALL
           SELECT f.id, f.name, f.parent_id, s.relative_path || '/' || f.name
             FROM folders f
             JOIN subtree s ON f.parent_id = s.id
         )
         SELECT id, name, relative_path AS relativePath FROM subtree`,
      )
      .all(rootId) as { id: string; name: string; relativePath: string }[];
    return rows;
  }

  listFilesForSubtree(rootId: string): {
    id: string;
    originalFilename: string;
    totalSize: number;
    relativePath: string;
  }[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE subtree(id, name, parent_id, relative_path) AS (
           SELECT id, name, parent_id, name AS relative_path
             FROM folders
            WHERE id = ?
           UNION ALL
           SELECT f.id, f.name, f.parent_id, s.relative_path || '/' || f.name
             FROM folders f
             JOIN subtree s ON f.parent_id = s.id
         )
         SELECT fi.id,
                fi.original_filename AS originalFilename,
                fi.total_size AS totalSize,
                s.relative_path || '/' || fi.original_filename AS relativePath
           FROM subtree s
           JOIN files fi ON fi.folder_id = s.id
          WHERE fi.status = 'completed'`,
      )
      .all(rootId) as {
        id: string;
        originalFilename: string;
        totalSize: number;
        relativePath: string;
      }[];
    return rows;
  }

  getRow(id: string): FolderRow | null {
    const row = this.db
      .prepare("SELECT * FROM folders WHERE id = ?")
      .get(id) as FolderRow | undefined;
    return row ?? null;
  }
}
