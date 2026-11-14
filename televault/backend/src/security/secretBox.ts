import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AppConfig } from "../config/env";
import { AppError } from "../utils/errors";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const VERSION = "v1";

/**
 * Authenticated encryption for Telegram session strings at rest.
 *
 * Session strings are bearer credentials for the user's Telegram account and
 * must never be stored in plaintext, returned over HTTP or written to logs.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== KEY_BYTES) {
      throw new Error(`SecretBox requires a ${KEY_BYTES}-byte key`);
    }
    this.key = Buffer.from(key);
  }

  encrypt(plaintext: string): string {
    if (typeof plaintext !== "string" || plaintext.length === 0) {
      throw new Error("Cannot encrypt an empty secret");
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  decrypt(payload: string): string {
    const parts = payload.split(".");
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new AppError(
        500,
        "INTERNAL_ERROR",
        "Stored Telegram session has an unsupported format",
        { expose: false },
      );
    }

    const iv = Buffer.from(parts[1] ?? "", "base64url");
    const tag = Buffer.from(parts[2] ?? "", "base64url");
    const ciphertext = Buffer.from(parts[3] ?? "", "base64url");

    if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length === 0) {
      throw new AppError(
        500,
        "INTERNAL_ERROR",
        "Stored Telegram session is corrupted",
        { expose: false },
      );
    }

    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      throw new AppError(
        500,
        "INTERNAL_ERROR",
        "Stored Telegram session could not be decrypted",
        { cause: error, expose: false },
      );
    }
  }
}

function decodeMasterKey(raw: string, source: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(raw.trim(), "base64");
  } catch {
    throw new Error(`${source} is not valid base64`);
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(`${source} must decode to exactly ${KEY_BYTES} bytes`);
  }
  return key;
}

/**
 * Load the master encryption key from TELEVAULT_MASTER_KEY or from a
 * generated, owner-only key file inside the private data directory.
 */
export async function loadSecretBox(
  config: AppConfig,
): Promise<{ secretBox: SecretBox; source: "env" | "file" }> {
  if (config.masterKey) {
    return {
      secretBox: new SecretBox(
        decodeMasterKey(config.masterKey, "TELEVAULT_MASTER_KEY"),
      ),
      source: "env",
    };
  }

  const keyPath = resolve(config.dataDir, "master.key");
  try {
    const existing = await readFile(keyPath, "utf8");
    return {
      secretBox: new SecretBox(
        decodeMasterKey(existing, "master key file"),
      ),
      source: "file",
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  const generated = randomBytes(KEY_BYTES);
  await writeFile(keyPath, generated.toString("base64"), {
    mode: 0o600,
    flag: "wx",
  });
  return {
    secretBox: new SecretBox(generated),
    source: "file",
  };
}
