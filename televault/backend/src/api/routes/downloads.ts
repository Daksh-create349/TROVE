import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendCreated, sendData } from "../../utils/responses";
import type { DownloadManager } from "../../downloads/downloadManager";
import {
  createDownloadSchema,
  listDownloadsQuerySchema,
  parseOrThrow,
} from "../validation/schemas";

export function createDownloadsRouter(downloadManager: DownloadManager): Router {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(createDownloadSchema, req.body);
      const result = await downloadManager.createDownload({
        fileId: body.fileId,
        targetDirectory: body.targetDirectory,
        targetFilename: body.targetFilename,
      });
      sendCreated(res, result);
    }),
  );

  router.get("/", (req, res) => {
    const query = parseOrThrow(listDownloadsQuerySchema, req.query);
    const result = downloadManager.listJobs({
      status: query.status,
      fileId: query.fileId,
      limit: query.limit,
      offset: query.offset,
    });
    sendData(res, result);
  });

  router.get("/:id", (req, res) => {
    const result = downloadManager.getJobDetail(req.params.id as string);
    sendData(res, result);
  });

  router.post(
    "/:id/pause",
    asyncHandler(async (req, res) => {
      const result = await downloadManager.pauseJob(req.params.id as string);
      sendData(res, result);
    }),
  );

  router.post(
    "/:id/resume",
    asyncHandler(async (req, res) => {
      const result = await downloadManager.resumeJob(req.params.id as string);
      sendData(res, result);
    }),
  );

  router.post(
    "/:id/cancel",
    asyncHandler(async (req, res) => {
      const result = await downloadManager.cancelJob(req.params.id as string);
      sendData(res, result);
    }),
  );

  router.get("/:id/progress", (req, res) => {
    const result = downloadManager.getProgress(req.params.id as string);
    sendData(res, result);
  });

  return router;
}

