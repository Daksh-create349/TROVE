import { resolve } from "node:path";
import type { Logger } from "pino";
import type { AppConfig } from "./config/env";
import type { AppDatabase } from "./database/database";
import { DownloadJobRepository } from "./database/repositories/downloadJobRepository";
import { FilePartRepository } from "./database/repositories/filePartRepository";
import { FileRepository } from "./database/repositories/fileRepository";
import { FolderRepository } from "./database/repositories/folderRepository";
import { ProfileRepository } from "./database/repositories/profileRepository";
import { SettingsRepository } from "./database/repositories/settingsRepository";
import { TelegramAccountRepository } from "./database/repositories/telegramAccountRepository";
import { UploadJobRepository } from "./database/repositories/uploadJobRepository";
import { DownloadManager } from "./downloads/downloadManager";
import { DownloadService } from "./downloads/downloadService";
import { FileStreamer } from "./downloads/fileStreamer";
import { FolderService } from "./folders/folderService";
import { FolderZipService } from "./folders/folderZipService";
import { ProfileService } from "./profiles/profileService";
import type { SecretBox } from "./security/secretBox";
import {
  createLocalSessionStore,
  type SecureSessionStore,
} from "./security/sessionStore";
import { FileService } from "./storage/fileService";
import { StorageService } from "./storage/storageService";
import { StorageSyncService } from "./storage/storageSyncService";
import type { TelegramClientFactory } from "./telegram/managedClient";
import { TelegramService } from "./telegram/telegramService";
import { UploadManager } from "./uploads/uploadManager";
import { UploadService } from "./uploads/uploadService";

export interface ServiceContainer {
  profileService: ProfileService;
  folderService: FolderService;
  folderZipService: FolderZipService;
  fileService: FileService;
  uploadService: UploadService;
  uploadManager: UploadManager;
  downloadService: DownloadService;
  downloadManager: DownloadManager;
  fileStreamer: FileStreamer;
  storageSyncService: StorageSyncService;
  storageService: StorageService;
  telegramService: TelegramService;
}

export interface CreateServicesInput {
  config: AppConfig;
  database: AppDatabase;
  logger: Logger;
  secretBox: SecretBox;
  sessionStore?: SecureSessionStore;
  telegramClientFactory?: TelegramClientFactory;
}

/**
 * Composition root for the domain layer. Repositories share the single SQLite
 * connection; services own transactions and validation.
 */
export function createServices(input: CreateServicesInput): ServiceContainer {
  const { config, database, logger, secretBox } = input;

  const profileRepository = new ProfileRepository(database);
  const folderRepository = new FolderRepository(database);
  const fileRepository = new FileRepository(database);
  const filePartRepository = new FilePartRepository(database);
  const uploadJobRepository = new UploadJobRepository(database);
  const downloadJobRepository = new DownloadJobRepository(database);
  const telegramAccountRepository = new TelegramAccountRepository(database);
  const settingsRepository = new SettingsRepository(database);

  const sessionStore =
    input.sessionStore ??
    createLocalSessionStore({
      filePath: resolve(config.dataDir, "telegram.session"),
      secretBox,
    });

  const telegramService = new TelegramService({
    config,
    accounts: telegramAccountRepository,
    settings: settingsRepository,
    secretBox,
    sessionStore,
    logger,
    clientFactory: input.telegramClientFactory,
  });

  const uploadManager = new UploadManager({
    config,
    logger,
    telegramService,
    fileRepository,
    filePartRepository,
    uploadJobRepository,
    settingsRepository,
  });

  const downloadManager = new DownloadManager({
    config,
    logger,
    telegramService,
    fileRepository,
    filePartRepository,
    downloadJobRepository,
    settingsRepository,
  });

  const fileStreamer = new FileStreamer({
    telegramService,
    fileRepository,
    filePartRepository,
    dataDir: config.dataDir,
    logger,
  });

  const folderZipService = new FolderZipService({
    folderRepository,
    fileRepository,
    filePartRepository,
    telegramService,
    dataDir: config.dataDir,
    logger,
  });

  const storageSyncService = new StorageSyncService({
    telegramService,
    fileRepository,
    filePartRepository,
    logger,
  });

  return {
    profileService: new ProfileService(profileRepository),
    folderService: new FolderService(folderRepository),
    folderZipService,
    fileService: new FileService(
      database,
      fileRepository,
      filePartRepository,
      folderRepository,
    ),
    uploadService: new UploadService(
      database,
      fileRepository,
      uploadJobRepository,
    ),
    uploadManager,
    downloadService: new DownloadService(
      database,
      fileRepository,
      downloadJobRepository,
    ),
    downloadManager,
    fileStreamer,
    storageSyncService,
    storageService: new StorageService(database, config, fileRepository),
    telegramService,
  };
}
