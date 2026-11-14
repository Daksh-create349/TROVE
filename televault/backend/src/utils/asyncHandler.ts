import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";

type AsyncRoute = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

/**
 * Express 5 forwards rejected promises automatically, but this wrapper keeps
 * handler intent explicit and guarantees no floating rejections.
 */
export function asyncHandler(handler: AsyncRoute): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}
