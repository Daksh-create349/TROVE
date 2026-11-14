import type {
  ErrorRequestHandler,
  RequestHandler,
} from "express";
import { ZodError } from "zod";
import type { ApiFailure } from "@shared/types";
import type { Logger } from "pino";
import {
  AppError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
} from "../../utils/errors";
import { formatZodIssues } from "../validation/schemas";
import { getRequestId } from "./requestLogger";

interface BodyParserError {
  type?: string;
  status?: number;
  statusCode?: number;
}

export function createNotFoundHandler(): RequestHandler {
  return (_req, _res, next) => {
    next(new NotFoundError("Route"));
  };
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const requestId = getRequestId(res) ?? undefined;
    let appError: AppError;

    if (error instanceof AppError) {
      appError = error;
    } else if (error instanceof ZodError) {
      appError = new ValidationError(
        "The request is invalid",
        formatZodIssues(error),
      );
    } else {
      const parserError = error as BodyParserError;
      if (
        parserError.type === "entity.too.large" ||
        parserError.status === 413 ||
        parserError.statusCode === 413
      ) {
        appError = new PayloadTooLargeError();
      } else if (
        parserError.type === "entity.parse.failed" ||
        (error instanceof SyntaxError && parserError.status === 400)
      ) {
        appError = new ValidationError("The JSON request body is malformed");
      } else {
        appError = new AppError(
          500,
          "INTERNAL_ERROR",
          "An unexpected error occurred",
          { expose: false, cause: error },
        );
      }
    }

    const logContext = {
      requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: appError.status,
      code: appError.code,
      err: error,
    };

    if (appError.status >= 500) {
      logger.error(logContext, "Request failed");
    } else {
      logger.warn(logContext, "Request rejected");
    }

    const body: ApiFailure = {
      ok: false,
      error: {
        code: appError.code,
        message: appError.expose
          ? appError.message
          : "An unexpected error occurred",
        ...(appError.expose && appError.details !== undefined
          ? { details: appError.details }
          : {}),
      },
      ...(requestId ? { requestId } : {}),
    };

    res.status(appError.status).json(body);
  };
}
