import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { UnauthorizedError } from "../utils/errors";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Guard every non-health API route with a local API token. Comparisons use
 * fixed-length digests to avoid leaking token length through timing.
 */
export function createApiTokenGuard(
  expectedToken: string,
  options: { publicPaths?: string[] } = {},
): RequestHandler {
  const expected = digest(expectedToken);
  const publicPaths = new Set(options.publicPaths ?? []);

  return (req, _res, next) => {
    if (publicPaths.has(req.path)) {
      next();
      return;
    }

    const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
    const provided =
      req.get("x-televault-token") ||
      req.get("x-trove-token") ||
      queryToken;
    if (!provided) {
      next(new UnauthorizedError("A valid Trove API token is required"));
      return;
    }

    const actual = digest(provided);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      next(new UnauthorizedError("The Trove API token is invalid"));
      return;
    }

    next();
  };
}
