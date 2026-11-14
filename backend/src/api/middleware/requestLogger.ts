import { randomUUID } from "node:crypto";
import pinoHttp from "pino-http";
import type { Logger } from "pino";
import type { RequestHandler } from "express";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

export function getRequestId(res: {
  getHeader(name: string): unknown;
}): string | null {
  const value = res.getHeader("x-request-id");
  return typeof value === "string" ? value : null;
}

/**
 * Structured request logging. Request and response bodies are never logged,
 * and credential-bearing headers are redacted by pino.
 */
export function createRequestLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId(req, res) {
      const incoming = req.headers["x-request-id"];
      const requestId =
        typeof incoming === "string" && REQUEST_ID_PATTERN.test(incoming)
          ? incoming
          : randomUUID();
      res.setHeader("x-request-id", requestId);
      return requestId;
    },
    customLogLevel(_req, res, error) {
      if (error || res.statusCode >= 500) {
        return "error";
      }
      if (res.statusCode >= 400) {
        return "warn";
      }
      return "info";
    },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['x-televault-token']",
        "res.headers['set-cookie']",
      ],
      censor: "[redacted]",
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  });
}
