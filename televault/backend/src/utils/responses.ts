import type { Response } from "express";
import type { ApiSuccess } from "@shared/types";

export function sendData<T>(res: Response, data: T, status = 200): void {
  const body: ApiSuccess<T> = { ok: true, data };
  res.status(status).json(body);
}

export function sendCreated<T>(res: Response, data: T): void {
  sendData(res, data, 201);
}

export function sendNoContent(res: Response): void {
  res.status(204).end();
}
