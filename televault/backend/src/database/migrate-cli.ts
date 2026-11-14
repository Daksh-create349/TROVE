import { loadConfig, ensureDataDirectories } from "../config/env";
import { createLogger } from "../utils/logger";
import { AppDatabase } from "./database";

/**
 * Standalone migration command: `npm run db:migrate`.
 * The server also runs migrations automatically before accepting requests.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  await ensureDataDirectories(config);
  const logger = createLogger(config);
  const database = new AppDatabase(config.databasePath, { logger });

  try {
    const result = await database.migrate();
    logger.info(
      {
        schemaVersion: result.currentVersion,
        applied: result.applied,
      },
      "Migration command completed",
    );
  } finally {
    database.close();
  }
}

void main().catch((error: unknown) => {
  console.error("Database migration failed:", error);
  process.exitCode = 1;
});
