import { Router } from "express";
import type { TelegramService } from "../../telegram/telegramService";
import { createRateLimiter } from "../../security/rateLimit";
import { asyncHandler } from "../../utils/asyncHandler";
import { UnauthorizedError } from "../../utils/errors";
import { sendData } from "../../utils/responses";
import {
  parseOrThrow,
  telegramConfigSchema,
  telegramPasswordSchema,
  telegramPhoneSchema,
  telegramVerifySchema,
} from "../validation/schemas";

const FIFTEEN_MINUTES = 15 * 60 * 1_000;

export function createTelegramRouter(telegramService: TelegramService): Router {
  const router = Router();

  const startLimiter = createRateLimiter({
    windowMs: FIFTEEN_MINUTES,
    max: 8,
    keyPrefix: "telegram-start",
  });
  const verifyLimiter = createRateLimiter({
    windowMs: FIFTEEN_MINUTES,
    max: 20,
    keyPrefix: "telegram-verify",
  });
  const passwordLimiter = createRateLimiter({
    windowMs: FIFTEEN_MINUTES,
    max: 20,
    keyPrefix: "telegram-password",
  });

  router.get("/status", (_req, res) => {
    sendData(res, telegramService.getStatus());
  });

  router.post(
    "/config",
    asyncHandler(async (req, res) => {
      const { apiId, apiHash } = parseOrThrow(telegramConfigSchema, req.body);
      const status = telegramService.configure(apiId, apiHash);
      sendData(res, status);
    }),
  );

  router.get(
    "/profile",
    asyncHandler(async (_req, res) => {
      const profile = await telegramService.getProfile();
      if (!profile) {
        throw new UnauthorizedError("No Telegram account is currently connected");
      }
      sendData(res, profile);
    }),
  );

  router.post(
    "/auth/start",
    startLimiter,
    asyncHandler(async (req, res) => {
      const { phoneNumber, forceSMS } = parseOrThrow(telegramPhoneSchema, req.body);
      sendData(res, await telegramService.beginLogin(phoneNumber, Boolean(forceSMS)));
    }),
  );

  const verifyHandler = asyncHandler(async (req, res) => {
    const { code } = parseOrThrow(telegramVerifySchema, req.body);
    sendData(res, await telegramService.submitCode(code));
  });

  router.post("/auth/verify", verifyLimiter, verifyHandler);
  router.post("/auth/code", verifyLimiter, verifyHandler);

  const passwordHandler = asyncHandler(async (req, res) => {
    const { password } = parseOrThrow(telegramPasswordSchema, req.body);
    sendData(res, await telegramService.submitPassword(password));
  });

  router.post("/auth/verify-password", passwordLimiter, passwordHandler);
  router.post("/auth/password", passwordLimiter, passwordHandler);

  const disconnectHandler = asyncHandler(async (_req, res) => {
    sendData(res, await telegramService.logout());
  });

  router.post("/disconnect", disconnectHandler);
  router.post("/auth/logout", disconnectHandler);

  router.post(
    "/reconnect",
    asyncHandler(async (_req, res) => {
      const ok = await telegramService.reconnect();
      sendData(res, { reconnected: ok, status: telegramService.getStatus() });
    }),
  );

  return router;
}
