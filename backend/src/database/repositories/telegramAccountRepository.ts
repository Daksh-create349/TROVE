import type { AppDatabase, SqliteDatabase } from "../database";
import type { TelegramAccountRow } from "../rows";
import { newId } from "../../utils/crypto";

export interface SaveTelegramAccountInput {
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  sessionCiphertext: string;
  lastConnectedAt: string;
}

export class TelegramAccountRepository {
  private readonly db: SqliteDatabase;

  constructor(database: AppDatabase) {
    this.db = database.connection;
  }

  /**
   * TeleVault is a single-account desktop app: saving an account replaces any
   * previously linked Telegram account and its encrypted session.
   */
  save(input: SaveTelegramAccountInput): TelegramAccountRow {
    const saveTransaction = this.db.transaction(() => {
      const existing = this.db
        .prepare(
          "SELECT * FROM telegram_accounts WHERE telegram_user_id = ?",
        )
        .get(input.telegramUserId) as TelegramAccountRow | undefined;

      this.db.prepare("DELETE FROM telegram_accounts").run();

      if (existing) {
        this.db
          .prepare(
            `INSERT INTO telegram_accounts (
               id, telegram_user_id, username, first_name, last_name,
               session_ciphertext, session_updated_at, status, last_connected_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
          )
          .run(
            existing.id,
            input.telegramUserId,
            input.username,
            input.firstName,
            input.lastName,
            input.sessionCiphertext,
            input.lastConnectedAt,
            input.lastConnectedAt,
          );
        return this.getById(existing.id)!;
      }

      const id = newId();
      this.db
        .prepare(
          `INSERT INTO telegram_accounts (
             id, telegram_user_id, username, first_name, last_name,
             session_ciphertext, session_updated_at, status, last_connected_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        )
        .run(
          id,
          input.telegramUserId,
          input.username,
          input.firstName,
          input.lastName,
          input.sessionCiphertext,
          input.lastConnectedAt,
          input.lastConnectedAt,
        );
      return this.getById(id)!;
    });

    return saveTransaction();
  }

  getPrimary(): TelegramAccountRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM telegram_accounts
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1`,
      )
      .get() as TelegramAccountRow | undefined;
    return row ?? null;
  }

  getById(id: string): TelegramAccountRow | null {
    const row = this.db
      .prepare("SELECT * FROM telegram_accounts WHERE id = ?")
      .get(id) as TelegramAccountRow | undefined;
    return row ?? null;
  }

  updateSession(id: string, sessionCiphertext: string): void {
    this.db
      .prepare(
        `UPDATE telegram_accounts
            SET session_ciphertext = ?, session_updated_at = ?
          WHERE id = ?`,
      )
      .run(sessionCiphertext, new Date().toISOString(), id);
  }

  markConnected(id: string, lastConnectedAt: string): void {
    this.db
      .prepare(
        `UPDATE telegram_accounts
            SET status = 'active', last_connected_at = ?
          WHERE id = ?`,
      )
      .run(lastConnectedAt, id);
  }

  markStatus(id: string, status: "active" | "logged_out" | "error"): void {
    this.db
      .prepare("UPDATE telegram_accounts SET status = ? WHERE id = ?")
      .run(status, id);
  }

  clearAll(): void {
    this.db.prepare("DELETE FROM telegram_accounts").run();
  }
}
