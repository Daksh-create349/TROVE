import { existsSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { MIN_API_TOKEN_LENGTH } from "./constants";

/**
 * Locate the backend package root from either `src/config` (tsx) or
 * `dist/backend/src/config` (compiled). This keeps `.env` and the default
 * data directory anchored to `backend/` regardless of the process cwd.
 */
function findBackendRoot(startDirectory: string): string {
  let current = startDirectory;
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(resolve(current, "package.json"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return process.cwd();
}

const backendRoot = findBackendRoot(__dirname);
dotenv.config({ path: resolve(backendRoot, ".env"), quiet: true });

const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const;

const optionalString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().optional());

const optionalPositiveInt = z.preprocess((value) => {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  return Number(value);
}, z.number().int().positive().optional());

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4787),
    DATA_DIR: z.string().default("./data"),
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
    LOG_PRETTY: z.enum(["true", "false"]).optional(),
    TELEGRAM_API_ID: optionalPositiveInt,
    TELEGRAM_API_HASH: optionalString,
    TELEVAULT_API_TOKEN: optionalString,
    TELEVAULT_MASTER_KEY: optionalString,
    ALLOWED_ORIGINS: z.string().default(""),
    ALLOW_NULL_ORIGIN: z.enum(["true", "false"]).default("false"),
    TELEGRAM_CONNECT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(20_000),
  })
  .superRefine((value, ctx) => {
    if ((value.TELEGRAM_API_ID === undefined) !== (value.TELEGRAM_API_HASH === undefined)) {
      ctx.addIssue({
        code: "custom",
        message:
          "TELEGRAM_API_ID and TELEGRAM_API_HASH must be configured together",
        path: ["TELEGRAM_API_ID"],
      });
    }

    if (value.TELEVAULT_API_TOKEN !== undefined && value.TELEVAULT_API_TOKEN.length < MIN_API_TOKEN_LENGTH) {
      ctx.addIssue({
        code: "custom",
        message: `TELEVAULT_API_TOKEN must be at least ${MIN_API_TOKEN_LENGTH} characters`,
        path: ["TELEVAULT_API_TOKEN"],
      });
    }

    if (!["127.0.0.1", "::1", "localhost"].includes(value.HOST)) {
      ctx.addIssue({
        code: "custom",
        message:
          "HOST must be a loopback address (127.0.0.1, ::1 or localhost). TeleVault never listens on public interfaces.",
        path: ["HOST"],
      });
    }
  })
  .transform((value) => {
    const dataDir = resolve(backendRoot, value.DATA_DIR);
    const apiHash = value.TELEGRAM_API_HASH;
    const apiId = value.TELEGRAM_API_ID;
    const configured =
      apiId !== undefined && apiHash !== undefined && apiHash.length > 0;

    return {
      nodeEnv: value.NODE_ENV,
      host: value.HOST,
      port: value.PORT,
      dataDir,
      databasePath: resolve(dataDir, "televault.db"),
      logLevel: value.LOG_LEVEL,
      logPretty:
        value.LOG_PRETTY !== undefined
          ? value.LOG_PRETTY === "true"
          : value.NODE_ENV === "development",
      telegram: {
        configured,
        apiId: apiId ?? null,
        apiHash: apiHash ?? null,
        connectTimeoutMs: value.TELEGRAM_CONNECT_TIMEOUT_MS,
      },
      apiToken: value.TELEVAULT_API_TOKEN ?? null,
      masterKey: value.TELEVAULT_MASTER_KEY ?? null,
      allowedOrigins: value.ALLOWED_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
      allowNullOrigin: value.ALLOW_NULL_ORIGIN === "true",
    };
  });

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${detail}`);
  }
  return parsed.data;
}

/**
 * Create the private application data directories. The database directory is
 * intentionally separate from user-facing downloads.
 */
export async function ensureDataDirectories(
  config: AppConfig,
): Promise<{ dataDir: string; downloadsDir: string; tempDir: string }> {
  const downloadsDir = resolve(config.dataDir, "downloads");
  const tempDir = resolve(config.dataDir, "tmp");
  for (const directory of [config.dataDir, downloadsDir, tempDir]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }

  // Tighten permissions on the database file if it already exists. On
  // platforms where chmod is a no-op this resolves without failing.
  if (existsSync(config.databasePath)) {
    try {
      await chmod(config.databasePath, 0o600);
    } catch {
      // Best effort: not all filesystems support POSIX modes.
    }
  }

  return { dataDir: config.dataDir, downloadsDir, tempDir };
}

/**
 * Safe description of the Telegram configuration for logs. Credentials are
 * never emitted, even in development logs.
 */
export function describeTelegramConfig(config: AppConfig): {
  configured: boolean;
} {
  return {
    configured: config.telegram.configured,
  };
}
