import { NextResponse } from "next/server";
import { getDb, currentSchemaVersion } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liveness/readiness probe for Docker and Kubernetes. Reveals no personal data. */
export function GET() {
  try {
    const db = getDb();
    db.prepare("SELECT 1").get();
    return NextResponse.json({ ok: true, schemaVersion: currentSchemaVersion(db) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
