import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { readMyData, mergeMyData, MyDataError, PROFILE_FILE } from "@/lib/core/my-data.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // always read the file fresh

// "My data" (the second tab on /cv) — facts a job search needs that never belong
// on a CV: date of birth, nationality, availability, notice period, relocation
// appetite, desired salary and floor, languages, EEO answers, free-form notes.
//
// They live in config/profile.yml because that is the one file every mode reads
// ALWAYS (Source-of-Truth Boundary), so a fact saved here is in scope for
// evaluations, cover letters and form answers without a second integration. The
// writer (lib/core/my-data.mjs) is surgical by construction: it patches only the
// lines this tab owns and re-parses the result before writing, so the
// hand-written sections above them cannot be damaged by a save.

function profilePath() {
  return path.join(careerOpsRoot(), "config", PROFILE_FILE);
}

function readText(): string | null {
  try {
    return fs.readFileSync(profilePath(), "utf8");
  } catch {
    return null;
  }
}

const STATUS: Record<string, number> = {
  INVALID_PROFILE: 409,
  INVALID_FIELD: 400,
  INVALID_PAYLOAD: 400,
  WRITE_UNVERIFIED: 500,
};

export async function GET() {
  const text = readText();
  if (text === null) {
    // No profile yet: still render the form (empty) so the tab is usable, and
    // let the first save create the file rather than bounce the user to Config.
    const { values, languages } = readMyData("{}");
    return Response.json({ exists: false, values, languages });
  }
  try {
    const { values, languages } = readMyData(text);
    return Response.json({ exists: true, values, languages });
  } catch (e) {
    const err = e as MyDataError;
    return Response.json({ error: err.message, code: err.code }, { status: STATUS[err.code] ?? 500 });
  }
}

export async function POST(req: Request) {
  let body: { values?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.values || typeof body.values !== "object") {
    return Response.json({ error: "values is required" }, { status: 400 });
  }

  const text = readText() ?? "";
  try {
    const merged = mergeMyData(text, body.values);
    if (!merged.changed) {
      const { values, languages } = readMyData(merged.text);
      return Response.json({ ok: true, saved: false, values, languages });
    }
    const backedUp = atomicWriteWithBackup(profilePath(), merged.text);
    const { values, languages } = readMyData(merged.text);
    return Response.json({
      ok: true,
      saved: true,
      backedUp: !!backedUp,
      absorbed: merged.absorbed,
      values,
      languages,
    });
  } catch (e) {
    const err = e as MyDataError;
    const status = STATUS[err.code] ?? 500;
    return Response.json({ error: err.message || "write failed", code: err.code }, { status });
  }
}
