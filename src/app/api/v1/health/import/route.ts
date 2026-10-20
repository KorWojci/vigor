import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { ImportValidationError, importHealthPayload, recordRejectedImport } from "@/lib/ingest/health-import";
import { db } from "@/lib/server/context";
import { log } from "@/lib/server/log";
import { authenticateIngest, jsonError, readLimitedText } from "../http";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/health/import — authenticated, idempotent health data ingestion.
 * Contract: docs/import-api.md. Implementation: src/lib/ingest/health-import.ts.
 */
export async function POST(req: Request) {
  const database = db();
  const auth = authenticateIngest(database, req);
  if (auth instanceof NextResponse) return auth;

  const body = await readLimitedText(req, config.maxImportBytes);
  if ("tooLarge" in body) {
    recordRejectedImport(database, { error: `Payload larger than ${config.maxImportBytes} bytes`, tokenId: auth.tokenId });
    return jsonError(413, `Payload too large. Maximum is ${config.maxImportBytes} bytes; split the sync into smaller batches.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    recordRejectedImport(database, { error: "Body is not valid JSON", bytes: body.bytes, tokenId: auth.tokenId });
    return jsonError(400, "Body is not valid JSON. Set the request body type to JSON.");
  }

  try {
    const result = importHealthPayload(database, parsed, { rawBody: body.text, tokenId: auth.tokenId });
    log("info", "health_import", {
      runId: result.importRunId,
      replayed: result.replayed,
      bytes: body.bytes,
      ...result.summary,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ImportValidationError) {
      const p = parsed as { source?: unknown; syncId?: unknown };
      recordRejectedImport(database, {
        source: typeof p?.source === "string" ? p.source.slice(0, 64) : undefined,
        syncId: typeof p?.syncId === "string" ? p.syncId.slice(0, 128) : undefined,
        error: err.message,
        issues: err.issues,
        bytes: body.bytes,
        tokenId: auth.tokenId,
      });
      return jsonError(422, err.message, { issues: err.issues });
    }
    log("error", "health_import_failed", { message: err instanceof Error ? err.message : String(err) });
    return jsonError(500, "Import failed; nothing was stored. It is safe to retry.");
  }
}
