import type { Request, RequestHandler } from "express";
import { AppError } from "../utils/errors";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Small in-memory fixed-window limiter for sensitive Telegram authentication
 * endpoints. This intentionally avoids a dependency; it is per-process and
 * resets on restart, which is appropriate for a single-user local service.
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  keyPrefix: string;
  key?: (req: Request) => string;
}): RequestHandler {
  const buckets = new Map<string, Bucket>();

  return (req, res, next) => {
    const now = Date.now();
    const key = `${options.keyPrefix}:${options.key ? options.key(req) : req.ip ?? "unknown"}`;
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, options.max - bucket.count);
    res.setHeader("RateLimit-Limit", String(options.max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      next(
        new AppError(
          429,
          "RATE_LIMITED",
          "Too many authentication attempts. Try again later.",
        ),
      );
      return;
    }

    // Opportunistic cleanup keeps the map bounded for a long-lived process.
    if (buckets.size > 1_000) {
      for (const [bucketKey, entry] of buckets) {
        if (entry.resetAt <= now) {
          buckets.delete(bucketKey);
        }
      }
    }

    next();
  };
}
