"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "@/lib/config";
import { authenticate, createSession, createUser, deleteSession, hasUser, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth/users";
import { clearHits, clientKey, isLimited, recordHit } from "@/lib/server/rate-limit";
import { db } from "@/lib/server/context";
import { log } from "@/lib/server/log";

async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function loginAction(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const key = `login:${clientKey(await headers())}`;
  if (isLimited(key, 8, 15 * 60_000)) return { error: "Too many attempts. Wait 15 minutes and try again." };
  const user = authenticate(db(), String(form.get("username") ?? ""), String(form.get("password") ?? ""));
  if (!user) {
    recordHit(key);
    log("warn", "login_failed");
    return { error: "Incorrect username or password." };
  }
  clearHits(key);
  const { token } = createSession(db(), user.id);
  await setSessionCookie(token);
  redirect("/");
}

export async function setupAction(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const database = db();
  if (hasUser(database)) redirect("/login");
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (!/^[a-zA-Z0-9._-]{2,40}$/.test(username)) return { error: "Username: 2–40 letters, digits, '.', '_' or '-'." };
  if (password !== confirm) return { error: "Passwords do not match." };
  try {
    const user = createUser(database, username, password);
    const { token } = createSession(database, user.id);
    await setSessionCookie(token);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the account." };
  }
  redirect("/settings?tab=profile&ok=Welcome%20to%20Vigor.%20Set%20your%20time%20zone%20and%20units%20first.");
}

export async function logoutAction() {
  const jar = await cookies();
  deleteSession(db(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
