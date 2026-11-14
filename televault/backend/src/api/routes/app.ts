import { Router } from "express";
import type { ProfileService } from "../../profiles/profileService";
import { sendCreated, sendData } from "../../utils/responses";
import { parseOrThrow, createProfileSchema } from "../validation/schemas";

export function createProfileRouter(profileService: ProfileService): Router {
  const router = Router();

  router.get("/profile", (_req, res) => {
    sendData(res, profileService.getProfile());
  });

  router.post("/profile", (req, res) => {
    const { displayName } = parseOrThrow(createProfileSchema, req.body);
    const { profile, created } = profileService.saveProfile(displayName);
    if (created) {
      sendCreated(res, profile);
    } else {
      sendData(res, profile);
    }
  });

  return router;
}
