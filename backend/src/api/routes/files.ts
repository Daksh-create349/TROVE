import { Router } from "express";
import type { FileService } from "../../storage/fileService";
import type { FileStreamer } from "../../downloads/fileStreamer";
import type { TelegramService } from "../../telegram/telegramService";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendData } from "../../utils/responses";
import { listFilesQuerySchema, parseOrThrow } from "../validation/schemas";

export function createFilesRouter(
  fileService: FileService,
  fileStreamer: FileStreamer,
  telegramService: TelegramService,
): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const query = parseOrThrow(listFilesQuerySchema, req.query);
    const result = fileService.listFiles({
      folderId: query.folderId,
      status: query.status,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });
    sendData(res, result);
  });

  router.get("/:id", (req, res) => {
    const result = fileService.getFile(req.params.id as string);
    sendData(res, result);
  });

  router.get("/:id/parts", (req, res) => {
    const result = fileService.listParts(req.params.id as string);
    sendData(res, result);
  });

  router.get(
    "/:id/download",
    asyncHandler(async (req, res) => {
      await fileStreamer.streamFile(req, res, {
        fileId: req.params.id as string,
        disposition: "attachment",
      });
    }),
  );

  router.get(
    "/:id/preview",
    asyncHandler(async (req, res) => {
      await fileStreamer.streamFile(req, res, {
        fileId: req.params.id as string,
        disposition: "inline",
      });
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const result = await fileService.safeDeleteFile(
        req.params.id as string,
        telegramService,
      );
      sendData(res, result);
    }),
  );

  return router;
}
