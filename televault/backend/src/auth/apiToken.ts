import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AppConfig } from "../config/env";

export interface ApiTokenInfo {
  token: string;
  source: "env" | "file";
  filePath: string | null;
}

/**
 * Resolve the local API token. A token supplied through the environment is
 * authoritative; otherwise a random token is generated once and stored with
 * owner-only permissions inside the private data directory.
 */
export async function resolveApiToken(
  config: AppConfig,
): Promise<ApiTokenInfo> {
  if (config.apiToken) {
    return { token: config.apiToken, source: "env", filePath: null };
  }

  const filePath = resolve(config.dataDir, "api-token");
  try {
    const existing = (await readFile(filePath, "utf8")).trim();
    if (existing.length >= 32) {
      return { token: existing, source: "file", filePath };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const token = randomBytes(48).toString("base64url");
  try {
    await writeFile(filePath, `${token}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    return { token, source: "file", filePath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const existing = (await readFile(filePath, "utf8")).trim();
      if (existing.length >= 32) {
        return { token: existing, source: "file", filePath };
      }
    }
    throw error;
  }
}
