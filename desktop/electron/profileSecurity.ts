import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";

interface ProfileSecurityRecord {
  hasPassword: boolean;
  saltHex?: string;
  hashHex?: string;
}

export class ProfileSecurityManager {
  private filePath: string | null = null;

  constructor() {
    // Lazy path initialization to prevent calling app.getPath before app.whenReady
  }

  private getFilePath(): string {
    if (!this.filePath) {
      try {
        this.filePath = join(app.getPath("userData"), "local_security.json");
      } catch {
        this.filePath = join(process.cwd(), "local_security.json");
      }
    }
    return this.filePath;
  }

  hasPassword(): boolean {
    const record = this.readRecord();
    return Boolean(record?.hasPassword && record.hashHex && record.saltHex);
  }

  setPassword(password: string): { success: boolean } {
    if (!password || password.length < 4) {
      throw new Error("Password must be at least 4 characters long");
    }

    const salt = randomBytes(32);
    const hash = scryptSync(password, salt, 64, {
      N: 16384,
      r: 8,
      p: 1,
    });

    const record: ProfileSecurityRecord = {
      hasPassword: true,
      saltHex: salt.toString("hex"),
      hashHex: hash.toString("hex"),
    };

    this.writeRecord(record);
    return { success: true };
  }

  verifyPassword(password: string): { valid: boolean } {
    const record = this.readRecord();
    if (!record || !record.hasPassword || !record.hashHex || !record.saltHex) {
      return { valid: true }; // No password configured
    }

    const salt = Buffer.from(record.saltHex, "hex");
    const expectedHash = Buffer.from(record.hashHex, "hex");

    const actualHash = scryptSync(password, salt, 64, {
      N: 16384,
      r: 8,
      p: 1,
    });

    const valid = timingSafeEqual(expectedHash, actualHash);
    return { valid };
  }

  private readRecord(): ProfileSecurityRecord | null {
    const p = this.getFilePath();
    if (!existsSync(p)) {
      return null;
    }
    try {
      const raw = readFileSync(p);
      let jsonString: string;
      if (safeStorage.isEncryptionAvailable()) {
        try {
          jsonString = safeStorage.decryptString(raw);
        } catch {
          jsonString = raw.toString("utf8");
        }
      } else {
        jsonString = raw.toString("utf8");
      }
      return JSON.parse(jsonString) as ProfileSecurityRecord;
    } catch {
      return null;
    }
  }

  private writeRecord(record: ProfileSecurityRecord): void {
    const p = this.getFilePath();
    const jsonString = JSON.stringify(record, null, 2);
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(jsonString);
      writeFileSync(p, encrypted);
    } else {
      writeFileSync(p, jsonString, "utf8");
    }
  }
}

