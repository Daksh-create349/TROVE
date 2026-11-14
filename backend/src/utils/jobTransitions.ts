import type { JobStatus } from "@shared/types";
import { ConflictError } from "../utils/errors";

const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["processing", "paused", "failed"],
  processing: ["paused", "failed", "completed"],
  paused: ["queued", "processing", "failed"],
  failed: ["queued"],
  completed: [],
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertJobTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransitionJob(from, to)) {
    throw new ConflictError(
      `Job cannot transition from "${from}" to "${to}"`,
    );
  }
}
