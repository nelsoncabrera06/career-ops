import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { noteFor, saveNote, jobKey } from "@/lib/job-notes.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // always read the file fresh

// Personal notes on one job (`/pipeline/{n}` → "My notes").
//
// This is NOT /api/status: that route writes the tracker's status cell and
// delegates to set-status.mjs (shared lock + ledger). These notes live in their
// own file (data/job-notes.json, see lib/job-notes.mjs) precisely so a user's
// own writing can never collide with the pipeline's evaluation summary in the
// tracker Notes column.

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!jobKey(id)) return NextResponse.json({ error: "id must be a tracker row number" }, { status: 400 });
  const note = noteFor(careerOpsRoot(), id);
  return NextResponse.json({ id, text: note?.text ?? "", updated: note?.updated ?? "" });
}

export async function POST(req: Request) {
  let body: { id?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (!jobKey(body.id)) {
    return NextResponse.json({ error: "id must be a tracker row number" }, { status: 400 });
  }
  if (typeof body.text !== "string") {
    return NextResponse.json({ error: "text must be a string" }, { status: 400 });
  }

  const result = await saveNote(careerOpsRoot(), body.id, body.text);
  if (!result.ok) {
    // A too-long note is the caller's mistake; anything else here is ours.
    const clientError = /longer than|must be/.test(result.error);
    return NextResponse.json({ error: result.error }, { status: clientError ? 400 : 500 });
  }
  return NextResponse.json(result);
}
