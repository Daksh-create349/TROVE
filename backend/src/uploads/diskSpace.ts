import { promises as fs } from "node:fs";
import { AppError } from "../utils/errors";

const DEFAULT_SAFETY_MARGIN_BYTES = 50 * 1024 * 1024; // 50 MB

export async function getAvailableDiskSpace(dirPath: string): Promise<number> {
  try {
    const stats = await fs.statfs(dirPath);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    // If statfs is unsupported on this platform or drive, fallback gracefully
    return Number.MAX_SAFE_INTEGER;
  }
}

export async function assertSufficientDiskSpace(
  dirPath: string,
  requiredBytes: number,
  safetyMarginBytes: number = DEFAULT_SAFETY_MARGIN_BYTES,
): Promise<void> {
  const available = await getAvailableDiskSpace(dirPath);
  if (available < requiredBytes + safetyMarginBytes) {
    throw new AppError(
      503,
      "SERVICE_UNAVAILABLE",
      `Insufficient disk space: available ${Math.round(available / 1024 / 1024)} MB, required ${Math.round((requiredBytes + safetyMarginBytes) / 1024 / 1024)} MB`,
    );
  }
}
