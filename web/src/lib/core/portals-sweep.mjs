// Pure helpers for the Explorer's `portals.yml` sweep — the second discovery
// engine behind the same Fresh scan.
//
// The reverse-ATS sweep (`scan-ats-full.mjs`) only knows four datasets:
// Greenhouse, Lever, Ashby and Workday. Everything a user configures in
// `portals.yml` under `job_boards` — Computrabajo, ZonaJobs/Bumeran, EmpleosIT,
// GetOnBoard, an eightfold tenant — is unreachable from it, so a "Fresh" scan
// used to be silent about whole markets even though `scan.mjs` reads them
// perfectly well. This module holds the parts of bridging them that are pure
// data transformation, so `node --test` can assert them (the web suite is .mjs
// and cannot import the .ts orchestrator):
//
//   • which boards are worth sweeping,
//   • the ephemeral config handed to `scan.mjs` (the user's real `portals.yml`
//     is never rewritten — same posture as `writeTempPortals` for the ATS sweep),
//   • reading `scan.mjs --json`'s receipt back into plain offers.
//
// Deliberately NOT here: any filter matching. The sweep supplies config and lets
// `scan.mjs` decide what passes, because a second copy of the title/location
// precedence in the web layer is exactly how the two halves start disagreeing
// (web/AGENTS.md, rule 1).

import { titleFit } from "../title-fit.mjs";

/** Boards are sweepable when they are declared and not opted out. A board with
 *  no provider at all is skipped by `scan.mjs` on every run, so including it
 *  would only add a no-op target (the Sources page flags those separately). */
export function sweepableBoards(doc) {
  const boards = doc && typeof doc === "object" && Array.isArray(doc.job_boards) ? doc.job_boards : [];
  return boards
    .filter((b) => b && typeof b === "object" && typeof b.name === "string" && b.name.trim() && b.enabled !== false)
    .map((b) => ({ name: b.name, provider: typeof b.provider === "string" ? b.provider : null }));
}

/** One YAML list block is `serializePortals`'s job; here the filters arrive as
 *  an object so the caller keeps the precedence rules in one place (`scan.mjs`). */
function filterSection(f) {
  const out = {};
  if (f.positive.length || f.negative.length) {
    out.title_filter = {};
    if (f.positive.length) out.title_filter.positive = [...f.positive];
    if (f.negative.length) out.title_filter.negative = [...f.negative];
  }
  if (f.blockHard.length || f.allow.length || f.block.length || f.alwaysAllow.length) {
    out.location_filter = {};
    if (f.blockHard.length) out.location_filter.block_hard = [...f.blockHard];
    if (f.alwaysAllow.length) out.location_filter.always_allow = [...f.alwaysAllow];
    if (f.allow.length) out.location_filter.allow = [...f.allow];
    if (f.block.length) out.location_filter.block = [...f.block];
  }
  return out;
}

/**
 * Build the ephemeral config for one sweep.
 *
 * Kept from the user's file: every top-level key that is not a target list
 * (`title_filter`, `location_filter`, `job_boards`, `tracked_companies`) — so
 * their `scan:` options, trust filter, salary filter and cooldown settings keep
 * behaving as configured. Replaced: the two filter sections, because the chips
 * on screen are what the user is searching with and both engines must honour
 * them; and the target lists, because the sweep runs only the boards the user
 * selected.
 *
 * `tracked_companies` is emptied on purpose: those are company careers pages,
 * most of them on the four ATS the reverse-ATS sweep already walks, and running
 * them twice per scan would double the request budget for the same rows. The
 * boards are what the ATS sweep cannot reach, which is the whole point.
 *
 * @param {object} doc  the parsed user portals.yml
 * @param {{positive:string[],negative:string[],allow:string[],block:string[],alwaysAllow:string[],blockHard:string[]}} f
 * @param {string[]} names  board names to include (empty = every sweepable board)
 */
export function buildSweepConfig(doc, f, names) {
  const source = doc && typeof doc === "object" ? doc : {};
  const wanted = Array.isArray(names) && names.length ? new Set(names) : null;
  const keep = new Set(["title_filter", "location_filter", "job_boards", "tracked_companies"]);
  const out = {};
  for (const [k, v] of Object.entries(source)) if (!keep.has(k)) out[k] = v;

  const boards = Array.isArray(source.job_boards) ? source.job_boards : [];
  out.job_boards = boards.filter(
    (b) => b && typeof b === "object" && b.enabled !== false && (!wanted || wanted.has(b.name)),
  );
  out.tracked_companies = [];
  Object.assign(out, filterSection(f));
  return out;
}

/** The receipt is ONE JSON line on stdout (`emitJsonReceipt`). Anything else the
 *  child prints — dotenv banners, a provider's warning — must not stop the read,
 *  so scan the lines bottom-up and take the first object that looks like a
 *  receipt. Returns null when the child produced none (killed, or crashed). */
export function parseSweepReceipt(stdout) {
  const lines = String(stdout ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && typeof parsed.version === "string") return parsed;
    } catch {
      /* not the receipt — keep looking upward */
    }
  }
  return null;
}

/**
 * Receipt offers → the shape the Explorer renders. Only `http(s)` postings are
 * kept: the card links out to them, and a provider that returned something else
 * is a bug upstream, not a row to show. `source` (the board label the scanner
 * recorded) doubles as the offer's `ats` badge, so a Computrabajo find reads
 * "Computrabajo" instead of being flattened into a generic "portals".
 */
export function receiptOffers(receipt) {
  const list = receipt && Array.isArray(receipt.offers) ? receipt.offers : [];
  const out = [];
  const seen = new Set();
  for (const o of list) {
    if (!o || typeof o !== "object") continue;
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    const company = typeof o.company === "string" ? o.company : "";
    const title = typeof o.title === "string" ? o.title : "";
    if (!company || !title) continue;
    seen.add(url);
    out.push({
      url,
      company,
      title,
      location: typeof o.location === "string" ? o.location : "",
      source: typeof o.source === "string" && o.source ? o.source : "portals.yml",
      postedAt: typeof o.posted_at === "string" ? o.posted_at : "",
    });
  }
  return out;
}

/**
 * The two free annotations the Explorer's cards show, computed from the title
 * alone: which keyword matched (`matchedKeyword`, transparency) and the
 * title-vs-profile band (#3260 — a hint, never a score). Same helpers the ATS
 * sweep uses, so a row reads identically whichever engine found it.
 */
export function sweepAnnotations(title, positives, targets) {
  const out = {};
  const lower = String(title ?? "").toLowerCase();
  for (const k of positives) {
    if (k && lower.includes(String(k).toLowerCase())) {
      out.matchedKeyword = k;
      break;
    }
  }
  if (Array.isArray(targets) && targets.length) {
    const f = titleFit(title, targets);
    if (f) out.fit = { band: f.band, score: f.score };
  }
  return out;
}
