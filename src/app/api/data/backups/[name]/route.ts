import fs from "node:fs";
import { Readable } from "node:stream";
import { backupPath } from "@/lib/data/manage";
import { currentUser } from "@/lib/server/context";

export const dynamic = "force-dynamic";

/** Downloads a backup file from the data directory (session-authenticated). */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  if (!(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const { name } = await ctx.params;
  const p = backupPath(name);
  if (!p) return new Response("Not found", { status: 404 });
  const stream = Readable.toWeb(fs.createReadStream(p)) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(fs.statSync(p).size),
      "Cache-Control": "no-store",
    },
  });
}
