import { NextResponse } from "next/server";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { requireAthleteId } from "@/lib/session";
import { getJob } from "@/lib/jobs";

const OUT_DIR = process.env.WORK_DIR
  ? path.join(process.env.WORK_DIR, "out")
  : path.join(process.cwd(), ".worker", "out");

/**
 * Serves the finished MP4 from the worker's local disk. When this moves to
 * object storage, this route becomes a redirect to a signed URL.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let athleteId: string;
  try {
    athleteId = await requireAthleteId();
  } catch {
    return NextResponse.json({ error: "session-expired" }, { status: 401 });
  }

  const job = await getJob(id);
  if (!job || job.athleteId !== athleteId || job.status !== "done") {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  // `id` comes from the database, but join it defensively anyway — a path
  // traversal here would serve arbitrary files off the worker's disk.
  const file = path.join(OUT_DIR, `${path.basename(id)}.mp4`);
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="stravinator-${path.basename(id)}.mp4"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
