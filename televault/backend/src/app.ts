import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import type { Logger } from "pino";
import type { AppConfig } from "./config/env";
import type { AppDatabase } from "./database/database";
import type { ServiceContainer } from "./services";
import { createApiTokenGuard } from "./auth/apiTokenGuard";
import { createErrorHandler, createNotFoundHandler } from "./api/middleware/errorHandler";
import { createRequestLogger } from "./api/middleware/requestLogger";
import { createProfileRouter } from "./api/routes/app";
import { createDownloadsRouter } from "./api/routes/downloads";
import { createFilesRouter } from "./api/routes/files";
import { createFoldersRouter } from "./api/routes/folders";
import { createHealthRouter } from "./api/routes/health";
import { createStorageRouter } from "./api/routes/storage";
import { createTelegramRouter } from "./api/routes/telegram";
import { createUploadsRouter } from "./api/routes/uploads";
import { JSON_BODY_LIMIT } from "./config/constants";
import { buildCorsOptions } from "./security/cors";
import { createHostGuard } from "./security/hostGuard";

export interface CreateAppInput {
  config: AppConfig;
  logger: Logger;
  database: AppDatabase;
  apiToken: string;
  services: ServiceContainer;
}

/**
 * Build the Express application. Health is the only unauthenticated route;
 * every other API route requires the local API token and a loopback Host.
 */
export function createApp(input: CreateAppInput): Express {
  const { config, logger, database, apiToken, services } = input;
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", false);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      strictTransportSecurity: false,
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );
  app.use(createRequestLogger(logger));
  app.use(createHostGuard());
  app.use(cors(buildCorsOptions(config)));
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));

  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  // Health is intentionally public so process supervisors can probe liveness
  // without reading the API token. It reveals no account or file metadata.
  app.use("/api/health", createHealthRouter(database));

  app.use("/api", createApiTokenGuard(apiToken));
  app.use("/api/app", createProfileRouter(services.profileService));
  app.use(
    "/api/files",
    createFilesRouter(
      services.fileService,
      services.fileStreamer,
      services.telegramService,
    ),
  );
  app.use(
    "/api/folders",
    createFoldersRouter(services.folderService, services.folderZipService),
  );
  app.use(
    "/api/storage",
    createStorageRouter(services.storageService, services.storageSyncService),
  );
  app.use("/api/telegram", createTelegramRouter(services.telegramService));
  app.use("/api/uploads", createUploadsRouter(services.uploadManager));
  app.use("/api/downloads", createDownloadsRouter(services.downloadManager));

  app.use(createNotFoundHandler());
  app.use(createErrorHandler(logger));

  return app;
}
