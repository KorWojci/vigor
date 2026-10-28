import fs from "node:fs";
import { Readable } from "node:stream";
import { exerciseMediaFilePath, getExerciseMedia } from "@/lib/training/exercise-media";
import { currentUser, db } from "@/lib/server/context";

export const dynamic = "force-dynamic";

/** Serves a cached exercise demonstration GIF (session-authenticated; never fetched from the third party at request time). */
export async function GET(_req: Request, ctx: { params: Promise<{ exerciseId: string }> }) {
  if (!(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const { exerciseId } = await ctx.params;
  const media = getExerciseMedia(db(), Number(exerciseId));
  if (!media) return new Response("Not found", { status: 404 });
  const filePath = exerciseMediaFilePath(media.gifFile);
  if (!filePath || !fs.existsSync(filePath)) return new Response("Not found", { status: 404 });
  const stream = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(fs.statSync(filePath).size),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
