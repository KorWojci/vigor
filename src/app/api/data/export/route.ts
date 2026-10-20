import { exportStream } from "@/lib/data/manage";
import { currentUser, db } from "@/lib/server/context";

export const dynamic = "force-dynamic";

/** Streams a JSON export of all personal data (session-authenticated). */
export async function GET() {
  if (!(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const name = `vigor-export-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(exportStream(db()), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
