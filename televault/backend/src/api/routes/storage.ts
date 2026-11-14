import { Router } from "express";
import type { StorageService } from "../../storage/storageService";
import type { StorageSyncService } from "../../storage/storageSyncService";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendData } from "../../utils/responses";

export function createStorageRouter(
  storageService: StorageService,
  storageSyncService: StorageSyncService,
): Router {
  const router = Router();

  router.get(
    "/stats",
    asyncHandler(async (_req, res) => {
      sendData(res, await storageService.getStats());
    }),
  );

  router.post(
    "/sync",
    asyncHandler(async (_req, res) => {
      sendData(res, await storageSyncService.sync());
    }),
  );

  router.get("/sync/status", (_req, res) => {
    sendData(res, storageSyncService.getStatus());
  });

  return router;
}
