import type { Server } from "node:http";
import { loadConfig, ensureDataDirectories, describeTelegramConfig } from "./config/env";
import { AppDatabase } from "./database/database";
import { createApp } from "./app";
import { createServices } from "./services";
import { resolveApiToken } from "./auth/apiToken";
import { loadSecretBox } from "./security/secretBox";
import { createLogger } from "./utils/logger";

async function main(): Promise<void> {
  const config = loadConfig();
  await ensureDataDirectories(config);

  const logger = createLogger(config);
  logger.info(
    {
      nodeEnv: config.nodeEnv,
      host: config.host,
      port: config.port,
      dataDir: config.dataDir,
      telegram: describeTelegramConfig(config),
    },
    "Starting TeleVault backend",
  );

  const database = new AppDatabase(config.databasePath, { logger });
  await database.migrate();

  const { secretBox, source: keySource } = await loadSecretBox(config);
  const apiToken = await resolveApiToken(config);
  const services = createServices({ config, database, logger, secretBox });

  if (apiToken.source === "file") {
    logger.info(
      { tokenFile: apiToken.filePath },
      "Local API token loaded from the private data directory",
    );
  } else {
    logger.info("Local API token loaded from TELEVAULT_API_TOKEN");
  }
  logger.debug({ masterKeySource: keySource }, "Master encryption key loaded");

  const app = createApp({
    config,
    logger,
    database,
    apiToken: apiToken.token,
    services,
  });

  const server: Server = app.listen(config.port, config.host, () => {
    logger.info(
      { url: `http://${config.host}:${config.port}`, apiPrefix: "/api" },
      "TeleVault backend is listening on loopback only",
    );
    // Connection restoration must never block the HTTP listener.
    void services.telegramService.initialize().catch((error: unknown) => {
      logger.warn({ err: error }, "Telegram initialization failed");
    });
    void services.uploadManager.initialize().catch((error: unknown) => {
      logger.warn({ err: error }, "Upload manager initialization failed");
    });
    void services.downloadManager.initialize().catch((error: unknown) => {
      logger.warn({ err: error }, "Download manager initialization failed");
    });
    void services.fileStreamer.initialize().catch((error: unknown) => {
      logger.warn({ err: error }, "File streamer initialization failed");
    });
  });

  server.on("error", (error) => {
    logger.fatal({ err: error }, "HTTP server error");
    process.exitCode = 1;
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, "Shutting down TeleVault backend");

    const forceExit = setTimeout(() => {
      logger.error("Graceful shutdown timed out; forcing exit");
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    try {
      await services.downloadManager.shutdown();
    } catch (error) {
      logger.warn({ err: error }, "Error while shutting down download manager");
    }

    try {
      await services.uploadManager.shutdown();
    } catch (error) {
      logger.warn({ err: error }, "Error while shutting down upload manager");
    }

    try {
      await services.telegramService.shutdown();
    } catch (error) {
      logger.warn({ err: error }, "Error while disconnecting Telegram client");
    }

    database.close();
    clearTimeout(forceExit);
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection (non-fatal, backend keeping alive)");
  });
  process.on("uncaughtException", (error) => {
    logger.error({ err: error }, "Uncaught exception (backend keeping alive)");
  });
}

void main().catch((error: unknown) => {
  // Configuration and migration failures happen before a logger necessarily
  // exists; write a safe message without dumping environment variables.
  console.error(
    "TeleVault backend failed to start:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exitCode = 1;
});
