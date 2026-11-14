import { Router } from "express";
import type { HealthStatus } from "@shared/types";
import { APP_VERSION } from "../../config/constants";
import type { AppDatabase } from "../../database/database";
import { asyncHandler } from "../../utils/asyncHandler";
import { nowIso } from "../../utils/crypto";
import { sendData } from "../../utils/responses";
import { ServiceUnavailableError } from "../../utils/errors";

export function createHealthRouter(database: AppDatabase): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      if (!database.healthCheck()) {
        throw new ServiceUnavailableError("The TeleVault database is unavailable");
      }

      const data: HealthStatus = {
        status: "ok",
        version: APP_VERSION,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: nowIso(),
        database: {
          status: "ok",
          schemaVersion: database.schemaVersion(),
          fileSizeBytes: database.fileSizeBytes(),
        },
      };
      sendData(res, data);
    }),
  );

  return router;
}
