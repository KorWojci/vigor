import type { DB } from "../db";
import { randomToken, sha256 } from "./crypto";

/**
 * Ingestion tokens authenticate the iPhone (companion app or Shortcut) against the import API.
 * Only a SHA-256 hash is stored; the plain token is shown once, at creation.
 */
export const TOKEN_PREFIX = "vgr_";

export interface ApiTokenInfo {
  id: number;
  name: string;
  tokenPrefix: string;
  scope: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export function createApiToken(db: DB, name: string, scope = "health:import"): { token: string; info: ApiTokenInfo } {
  const token = TOKEN_PREFIX + randomToken(32);
  const now = Date.now();
  const info = db
    .prepare("INSERT INTO api_tokens (name, token_hash, token_prefix, scope, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(name.trim() || "iPhone", sha256(token), token.slice(0, 10), scope, now);
  return {
    token,
    info: { id: Number(info.lastInsertRowid), name: name.trim() || "iPhone", tokenPrefix: token.slice(0, 10), scope, createdAt: now, lastUsedAt: null, revokedAt: null },
  };
}

export function listApiTokens(db: DB): ApiTokenInfo[] {
  return db
    .prepare(
      `SELECT id, name, token_prefix AS tokenPrefix, scope, created_at AS createdAt, last_used_at AS lastUsedAt,
       revoked_at AS revokedAt FROM api_tokens ORDER BY revoked_at IS NOT NULL, created_at DESC`,
    )
    .all() as ApiTokenInfo[];
}

export function revokeApiToken(db: DB, id: number): void {
  db.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(Date.now(), id);
}

/** Revokes a token and issues a replacement with the same name. */
export function rotateApiToken(db: DB, id: number): { token: string; info: ApiTokenInfo } | null {
  const row = db.prepare("SELECT name, scope FROM api_tokens WHERE id = ?").get(id) as { name: string; scope: string } | undefined;
  if (!row) return null;
  return db.transaction(() => {
    revokeApiToken(db, id);
    return createApiToken(db, row.name, row.scope);
  })();
}

/** Parses an `Authorization: Bearer …` header and returns the matching active token id. */
export function verifyBearer(db: DB, header: string | null, scope = "health:import"): { tokenId: number } | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!m) return null;
  const row = db
    .prepare("SELECT id, scope FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL")
    .get(sha256(m[1])) as { id: number; scope: string } | undefined;
  if (!row || row.scope !== scope) return null;
  db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(Date.now(), row.id);
  return { tokenId: row.id };
}
