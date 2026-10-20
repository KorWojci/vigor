import { NextResponse } from "next/server";
import type { DB } from "@/lib/db";
import { verifyBearer } from "@/lib/auth/api-tokens";
import { clientKey, isLimited, recordHit } from "@/lib/server/rate-limit";

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** Authenticates an ingestion request. Returns the token id or an error response. */
export function authenticateIngest(db: DB, req: Request): { tokenId: number } | NextResponse {
  const key = `ingest-auth-fail:${clientKey(req.headers)}`;
  if (isLimited(key, 30, 60_000)) return jsonError(429, "Too many failed authentication attempts; try again in a minute.");
  const auth = verifyBearer(db, req.headers.get("authorization"));
  if (!auth) {
    recordHit(key);
    return jsonError(401, "Missing or invalid bearer token. Send 'Authorization: Bearer <token>' (create a token in Settings → Integrations).", {}, {
      "WWW-Authenticate": 'Bearer realm="vigor"',
    });
  }
  return auth;
}

/** Reads the request body as text, enforcing a byte limit even without Content-Length. */
export async function readLimitedText(req: Request, maxBytes: number): Promise<{ text: string; bytes: number } | { tooLarge: true }> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return { tooLarge: true };
  if (!req.body) return { text: "", bytes: 0 };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), bytes };
}
