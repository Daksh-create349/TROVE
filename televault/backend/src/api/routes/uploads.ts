import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ValidationError } from "../../utils/errors";
import { sendCreated, sendData } from "../../utils/responses";
import { handleMultipartUpload } from "../../uploads/multipartHandler";
import type { UploadManager } from "../../uploads/uploadManager";
import {
  createUploadJsonSchema,
  listUploadsQuerySchema,
  parseOrThrow,
} from "../validation/schemas";

export function createUploadsRouter(uploadManager: UploadManager): Router {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      if (req.is("multipart/form-data")) {
        const stagingResult = await handleMultipartUpload(
          req,
          uploadManager.getStagingDir(),
        );

        const result = await uploadManager.createUpload({
          filePath: stagingResult.filePath,
          originalFilename: stagingResult.fileName,
          mimeType: stagingResult.mimeType,
          folderId: stagingResult.folderId,
          customSegmentSize: stagingResult.segmentSize,
          precomputedSha256: stagingResult.sha256,
          precomputedSize: stagingResult.fileSize,
          precomputedMtimeMs: stagingResult.mtimeMs,
          isTemporaryStaging: true,
        });

        sendCreated(res, result);
        return;
      }

      if (req.is("application/json")) {
        const body = parseOrThrow(createUploadJsonSchema, req.body);
        const result = await uploadManager.createUpload({
          filePath: body.filePath,
          originalFilename: body.originalFilename,
          mimeType: body.mimeType,
          folderId: body.folderId,
          customSegmentSize: body.customSegmentSize ?? body.segmentSize,
          isTemporaryStaging: false,
        });

        sendCreated(res, result);
        return;
      }

      throw new ValidationError(
        "Request Content-Type must be multipart/form-data or application/json",
      );
    }),
  );

  router.get("/", (req, res) => {
    const query = parseOrThrow(listUploadsQuerySchema, req.query);
    const result = uploadManager.listJobs({
      status: query.status,
      fileId: query.fileId,
      limit: query.limit,
      offset: query.offset,
    });
    sendData(res, result);
  });

  router.get("/:id", (req, res) => {
    const result = uploadManager.getJobDetail(req.params.id as string);
    sendData(res, result);
  });

  router.post(
    "/:id/pause",
    asyncHandler(async (req, res) => {
      const result = await uploadManager.pauseJob(req.params.id as string);
      sendData(res, result);
    }),
  );

  router.post(
    "/:id/resume",
    asyncHandler(async (req, res) => {
      const result = await uploadManager.resumeJob(req.params.id as string);
      sendData(res, result);
    }),
  );

  router.post(
    "/:id/cancel",
    asyncHandler(async (req, res) => {
      const result = await uploadManager.cancelJob(req.params.id as string);
      sendData(res, result);
    }),
  );

  router.get("/:id/progress", (req, res) => {
    const result = uploadManager.getProgress(req.params.id as string);
    sendData(res, result);
  });

  return router;
}
