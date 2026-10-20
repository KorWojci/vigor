import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "../config";
import { getDb } from "../db";
import { getSessionUser, ensureBootstrapUser, hasUser, SESSION_COOKIE, type User } from "../auth/users";
import { getSettings, type Settings } from "../settings";

/** Database handle for server components, actions and route handlers. */
export function db() {
  const d = getDb();
  ensureBootstrapUser(d, config.adminPassword);
  return d;
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSessionUser(db(), token);
}

/** Use at the top of every protected page and server action. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect(hasUser(db()) ? "/login" : "/setup");
  return user;
}

export interface AppContext {
  user: User;
  settings: Settings;
  tz: string;
}

export async function appContext(): Promise<AppContext> {
  const user = await requireUser();
  const settings = getSettings(db());
  return { user, settings, tz: settings.timezone };
}
