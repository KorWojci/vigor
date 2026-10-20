import { NextResponse } from "next/server";
import { z } from "zod";
import { SYNC_TARGET_INTERVAL_MINUTES } from "@/lib/config";
import { getCursors, getSyncStatus, recordClientStatus } from "@/lib/ingest/sync-status";
import { getSetting } from "@/lib/settings";
import { db } from "@/lib/server/context";
import { authenticateIngest, jsonError, readLimitedText } from "../http";

export const dynamic = "force-dynamic";

/**
 * GET  /api/v1/health/status?source=vigor-ios — connection test + server-side sync state and the
 *      cursors last acknowledged for that source (lets a reinstalled companion resume).
 * POST /api/v1/health/status — the companion reports its local queue/attempt state.
 */
export async function GET(req: Request) {
  const database = db();
  const auth = authenticateIngest(database, req);
  if (auth instanceof NextResponse) return auth;
  const source = new URL(req.url).searchParams.get("source");
  const s = getSyncStatus(database);
  return NextResponse.json(
    {
      ok: true,
      serverTime: new Date().toISOString(),
      schemaVersion: 1,
      targetIntervalMinutes: getSetting(database, "syncIntervalMinutes") ?? SYNC_TARGET_INTERVAL_MINUTES,
      state: s.state,
      lastSuccessAt: s.lastSuccessAt ? new Date(s.lastSuccessAt).toISOString() : null,
      lastAttemptAt: s.lastAttemptAt ? new Date(s.lastAttemptAt).toISOString() : null,
      cursors: source ? getCursors(database, source).map((c) => ({ scope: c.scope, value: c.value, updatedAt: new Date(c.updatedAt).toISOString() })) : [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const reportSchema = z.object({
  source: z.string().min(1).max(64),
  pendingSamples: z.number().int().nonnegative().nullable().optional(),
  lastAttemptAt: z.string().datetime({ offset: true }).nullable().optional(),
  lastSuccessAt: z.string().datetime({ offset: true }).nullable().optional(),
  lastError: z.string().max(500).nullable().optional(),
  details: z.record(z.unknown()).optional(),
});

export async function POST(req: Request) {
  const database = db();
  const auth = authenticateIngest(database, req);
  if (auth instanceof NextResponse) return auth;
  const body = await readLimitedText(req, 64 * 1024);
  if ("tooLarge" in body) return jsonError(413, "Payload too large");
  let parsed;
  try {
    parsed = reportSchema.safeParse(JSON.parse(body.text));
  } catch {
    return jsonError(400, "Body is not valid JSON");
  }
  if (!parsed.success) return jsonError(422, "Invalid status report", { issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
  const r = parsed.data;
  recordClientStatus(database, {
    source: r.source,
    pendingSamples: r.pendingSamples,
    lastAttemptAt: r.lastAttemptAt ? Date.parse(r.lastAttemptAt) : null,
    lastSuccessAt: r.lastSuccessAt ? Date.parse(r.lastSuccessAt) : null,
    lastError: r.lastError,
    details: r.details,
  });
  return NextResponse.json({ ok: true });
}
