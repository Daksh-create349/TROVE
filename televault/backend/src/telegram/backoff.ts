/** Delay before reconnect attempt `attempt` (1-based), capped so retries stay bounded. */
export function backoffDelayMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("Reconnect attempt must be a positive integer");
  }
  const delay = baseMs * 2 ** (attempt - 1);
  return Math.min(maxMs, delay);
}
