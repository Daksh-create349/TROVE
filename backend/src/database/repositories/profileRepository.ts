import type { AppProfile } from "@shared/types";
import type { AppDatabase, SqliteDatabase } from "../database";
import {
  mapProfile,
  type ProfileRow,
} from "../rows";
import { newId } from "../../utils/crypto";

export class ProfileRepository {
  private readonly db: SqliteDatabase;

  constructor(database: AppDatabase) {
    this.db = database.connection;
  }

  get(): AppProfile | null {
    const row = this.db
      .prepare("SELECT * FROM app_profiles WHERE singleton = 1")
      .get() as ProfileRow | undefined;
    return row ? mapProfile(row) : null;
  }

  upsert(displayName: string): { profile: AppProfile; created: boolean } {
    const existing = this.get();
    if (existing) {
      this.db
        .prepare("UPDATE app_profiles SET display_name = ? WHERE id = ?")
        .run(displayName, existing.id);
      return { profile: this.get()!, created: false };
    }

    const id = newId();
    this.db
      .prepare(
        "INSERT INTO app_profiles (id, singleton, display_name) VALUES (?, 1, ?)",
      )
      .run(id, displayName);
    return { profile: this.get()!, created: true };
  }
}
