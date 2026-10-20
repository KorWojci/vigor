import type { DB } from "../db";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";

export const SESSION_COOKIE = "vigor_session";
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
export const MIN_PASSWORD_LENGTH = 10;

export interface User {
  id: number;
  username: string;
}

export function hasUser(db: DB): boolean {
  return !!db.prepare("SELECT 1 FROM users LIMIT 1").get();
}

export function createUser(db: DB, username: string, password: string): User {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  const info = db
    .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)")
    .run(username.trim(), hashPassword(password), Date.now());
  return { id: Number(info.lastInsertRowid), username: username.trim() };
}

/** Creates the initial user from VIGOR_ADMIN_PASSWORD when no user exists yet. */
export function ensureBootstrapUser(db: DB, adminPassword: string | undefined): void {
  if (adminPassword && !hasUser(db)) createUser(db, "admin", adminPassword);
}

export function authenticate(db: DB, username: string, password: string): User | null {
  const row = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(username.trim()) as
    | { id: number; username: string; password_hash: string }
    | undefined;
  if (!row) {
    // Spend comparable time to avoid revealing whether the user exists.
    verifyPassword(password, hashPassword("timing-equaliser"));
    return null;
  }
  return verifyPassword(password, row.password_hash) ? { id: row.id, username: row.username } : null;
}

export function changePassword(db: DB, userId: number, current: string, next: string): void {
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as { password_hash: string } | undefined;
  if (!row || !verifyPassword(current, row.password_hash)) throw new Error("Current password is incorrect.");
  if (next.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(next), userId);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function createSession(db: DB, userId: number): { token: string; expiresAt: number } {
  const token = randomToken();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
    sha256(token),
    userId,
    now,
    expiresAt,
    now,
  );
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  return { token, expiresAt };
}

export function getSessionUser(db: DB, token: string | undefined): User | null {
  if (!token) return null;
  const now = Date.now();
  const row = db
    .prepare(
      `SELECT u.id, u.username, s.id AS sid, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), now) as { id: number; username: string; sid: string; last_seen_at: number } | undefined;
  if (!row) return null;
  if (now - row.last_seen_at > 3600_000) db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now, row.sid);
  return { id: row.id, username: row.username };
}

export function deleteSession(db: DB, token: string | undefined): void {
  if (token) db.prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
}
