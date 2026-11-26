import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { readMyData } from "@/lib/core/my-data.mjs";
import { parseCertificationInventory, parseCvSections } from "@/lib/cv/profile-facts.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // always read the files fresh

// "Profile" (the third tab on /cv) — a READ-ONLY view of what the system knows.
//
// It adds no data and invents no source: cv.md stays the CV, data/certifications.md
// stays the credential inventory (whose CV-visible rows are a subset), and
// config/profile.yml stays the store for facts that never appear on a CV. This
// route only assembles the three readers the other tabs already use, so the tab
// can never disagree with them — there is no second copy to drift.
//
// Why the inventory and not just the CV: the CV is deliberately a subset (a course
// kept for blockchain/fintech targets is not on it), and "what do you know about
// me?" is a question about the whole, not the published slice.

type Read = { text: string | null; error?: string };

/** A missing file is not a malformed file — ENOENT is `null`, anything else is an error. */
function readUserFile(p: string): Read {
  try {
    return { text: fs.readFileSync(p, "utf8") };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { text: null };
    return { text: null, error: (e as Error).message };
  }
}

export async function GET() {
  const root = careerOpsRoot();

  const cv = readUserFile(path.join(root, "cv.md"));
  const certs = readUserFile(path.join(root, "data", "certifications.md"));
  const profile = readUserFile(path.join(root, "config", "profile.yml"));

  let values: Record<string, unknown> = {};
  let languages: unknown[] = [];
  let profileError = profile.error;
  if (profile.text) {
    try {
      ({ values, languages } = readMyData(profile.text));
    } catch (e) {
      // A profile.yml the reader cannot parse is surfaced, not silently emptied.
      profileError = (e as Error).message;
    }
  }

  return Response.json({
    cv: { exists: cv.text !== null, sections: parseCvSections(cv.text ?? "") },
    certifications: {
      exists: certs.text !== null,
      rows: parseCertificationInventory(certs.text ?? ""),
      error: certs.error,
    },
    myData: { exists: profile.text !== null, values, languages, error: profileError },
  });
}
