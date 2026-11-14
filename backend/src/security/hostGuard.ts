import type { RequestHandler } from "express";
import { ForbiddenError } from "../utils/errors";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHostname(hostHeader: string): string | null {
  const value = hostHeader.trim();
  if (!value) {
    return null;
  }

  if (value.startsWith("[")) {
    const closing = value.indexOf("]");
    if (closing === -1) {
      return null;
    }
    return value.slice(1, closing).toLowerCase();
  }

  const colon = value.lastIndexOf(":");
  return (colon === -1 ? value : value.slice(0, colon)).toLowerCase();
}

/**
 * Defend against DNS-rebinding: the HTTP Host header must resolve to a
 * loopback name even though the listener is already bound to loopback.
 */
export function createHostGuard(): RequestHandler {
  return (req, _res, next) => {
    const hostHeader = req.headers.host;
    if (!hostHeader) {
      next(new ForbiddenError("Requests must include a loopback Host header"));
      return;
    }

    const hostname = normalizeHostname(hostHeader);
    if (!hostname || !LOOPBACK_HOSTNAMES.has(hostname)) {
      next(new ForbiddenError("TeleVault only accepts loopback requests"));
      return;
    }

    next();
  };
}
