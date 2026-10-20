/**
 * Tiny in-memory sliding-window limiter (single process, single user — sufficient here).
 * Used to slow down password guessing and token guessing on the import API.
 */
const buckets = new Map<string, number[]>();

function recent(key: string, windowMs: number, now: number): number[] {
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  buckets.set(key, hits);
  return hits;
}

/** True when `key` already has `limit` or more hits in the window. */
export function isLimited(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  return recent(key, windowMs, now).length >= limit;
}

export function recordHit(key: string, now = Date.now()): void {
  if (buckets.size > 10_000) buckets.clear();
  const hits = buckets.get(key) ?? [];
  hits.push(now);
  buckets.set(key, hits);
}

export function clearHits(key: string): void {
  buckets.delete(key);
}

export function clientKey(headers: Headers): string {
  // Behind a trusted reverse proxy the first X-Forwarded-For hop is the client.
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || headers.get("x-real-ip") || "local";
}
