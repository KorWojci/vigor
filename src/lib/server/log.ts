/**
 * Minimal structured logger. Never pass request bodies, health values or Authorization headers;
 * `redact` strips any accidental secrets from free-form messages.
 */
const SECRET_PATTERNS = [/Bearer\s+\S+/gi, /vgr_[A-Za-z0-9_-]+/g];

export function redact(s: string): string {
  return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, "[REDACTED]"), s);
}

export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  const out = redact(line);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}
