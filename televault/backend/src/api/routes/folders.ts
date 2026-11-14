import { Router } from "express";
import type { FolderService } from "../../folders/folderService";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendData } from "../../utils/responses";
import { createFolderSchema, parseOrThrow } from "../validation/schemas";

export function createFoldersRouter(folderService: FolderService): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    sendData(res, { items: folderService.listFolders() });
  });

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const input = parseOrThrow(createFolderSchema, req.body);
      const folder = folderService.getOrCreateFolder(input);
      sendData(res, folder, 201);
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const folder = folderService.getFolder(req.params.id as string);
      sendData(res, folder);
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      folderService.deleteFolder(req.params.id as string);
      sendData(res, { deleted: true, id: req.params.id });
    }),
  );

  return router;
}
