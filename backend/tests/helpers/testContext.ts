import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import type { Logger } from "pino";
import { createApp } from "../../src/app";
import {
  ensureDataDirectories,
  loadConfig,
  type AppConfig,
} from "../../src/config/env";
import { AppDatabase } from "../../src/database/database";
import { SecretBox } from "../../src/security/secretBox";
import {
  MemorySessionStore,
  type SecureSessionStore,
} from "../../src/security/sessionStore";
import { createServices, type ServiceContainer } from "../../src/services";
import type { TelegramClientFactory } from "../../src/telegram/managedClient";
import { createSilentLogger } from "../../src/utils/logger";

export const TEST_API_TOKEN =
  "test-token-0123456789abcdef0123456789abcdef";

export interface TestContextOptions {
  sessionStore?: SecureSessionStore;
  telegramClientFactory?: TelegramClientFactory;
}

export interface TestContext {
  dataDir: string;
  config: AppConfig;
  logger: Logger;
  database: AppDatabase;
  secretBox: SecretBox;
  sessionStore: SecureSessionStore;
  services: ServiceContainer;
  app: Express;
  apiToken: string;
  cleanup: () => Promise<void>;
}

export async function createTestContext(
  envOverrides: NodeJS.ProcessEnv = {},
  options?: TestContextOptions,
): Promise<TestContext> {
  const dataDir = await mkdtemp(join(tmpdir(), "televault-test-"));
  const config = loadConfig({
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "4787",
    DATA_DIR: dataDir,
    LOG_LEVEL: "silent",
    LOG_PRETTY: "false",
    TELEVAULT_API_TOKEN: TEST_API_TOKEN,
    ALLOWED_ORIGINS: "",
    ALLOW_NULL_ORIGIN: "false",
    ...envOverrides,
  });

  await ensureDataDirectories(config);
  const logger = createSilentLogger();
  const database = new AppDatabase(config.databasePath, { logger });
  await database.migrate();

  const secretBox = new SecretBox(randomBytes(32));
  const sessionStore = options?.sessionStore ?? new MemorySessionStore();
  const services = createServices({
    config,
    database,
    logger,
    secretBox,
    sessionStore,
    telegramClientFactory: options?.telegramClientFactory,
  });
  const app = createApp({
    config,
    logger,
    database,
    apiToken: TEST_API_TOKEN,
    services,
  });

  return {
    dataDir,
    config,
    logger,
    database,
    secretBox,
    sessionStore,
    services,
    app,
    apiToken: TEST_API_TOKEN,
    async cleanup() {
      await services.downloadManager.shutdown();
      await services.uploadManager.shutdown();
      await services.telegramService.shutdown();
      database.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

export function authHeader(token: string): Record<string, string> {
  return { "X-Televault-Token": token };
}
