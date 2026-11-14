import type { CorsOptions } from "cors";
import type { AppConfig } from "../config/env";
import { ForbiddenError } from "../utils/errors";

const LOCALHOST_ORIGIN =
  /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/;

/**
 * Only the local desktop UI may call the API from a browser context.
 * Requests without an Origin header (curl, the desktop process itself) are
 * allowed because they still require the local API token.
 */
export function buildCorsOptions(config: AppConfig): CorsOptions {
  const explicitOrigins = new Set(config.allowedOrigins);

  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (
        LOCALHOST_ORIGIN.test(origin) ||
        explicitOrigins.has(origin) ||
        (config.allowNullOrigin && origin === "null")
      ) {
        callback(null, true);
        return;
      }
      callback(
        new ForbiddenError("This browser origin is not allowed to call TeleVault"),
      );
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "X-Televault-Token",
      "X-Request-Id",
    ],
    exposedHeaders: ["X-Request-Id"],
    credentials: false,
    maxAge: 600,
    optionsSuccessStatus: 204,
  };
}
