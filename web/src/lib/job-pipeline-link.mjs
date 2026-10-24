// Job → tracker-row resolver: which pipeline entry did this evaluate worker land?
//
// A finished evaluate worker only stores the posting URL it was given (job.input);
// the tracker row it created is discovered, not remembered. Matching is by the
// canonical URL key (normalizeUrl) — the same key the tracker uses for dedup —
// because the whole point is that this link can't guess: URL key and tracker key
// agree by construction, while a company+role string match is what the user can
// already eyeball. No match means no link, never a guessed row.
//
// Plain .mjs (same pattern as pipeline-sort.mjs / url-key.mjs's mirror) so
// node --test can import it with no build step and no @/ alias loader.

import { normalizeUrl } from "./core/url-key.mjs";

/**
 * Key for LINKING a worker to its tracker row.
 *
 * normalizeUrl is the base — it never collapses two different gh_jid-type
 * identities (that is the over-normalization guard). One narrow exception is
 * added for LinkedIn /jobs/view/: the path id IS the posting's identity, while
 * `?currentJobId=` is which listing the viewer navigated FROM — session state,
 * not posting state. The core's dedup still treats differing aggregator ids as
 * distinct openings (#3652; it reads RAW ids, not this key): this exception
 * exists only to link the exact posting a worker was launched on, and it must
 * not grow gh_jid-style identity params.
 *
 * @param {string} raw
 * @returns {string}
 */
function linkKey(raw) {
  let u;
  try {
    u = new URL(String(raw ?? "").trim());
  } catch {
    return "";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  if (/(^|\.)linkedin\.com$/i.test(u.hostname) && /^\/jobs\/view\//i.test(u.pathname)) {
    u.search = "";
  }
  return normalizeUrl(u.toString());
}

/**
 * Extract the posting URL from a tracker `URL` cell.
 *
 * merge-tracker renders the cell as a markdown link (`[ashby](https://…)`)
 * because a raw posting URL runs 100+ characters (#3516), so the raw cell is
 * NOT the URL. Mirrors extractCellUrl() in the core's tracker-parse.mjs — that
 * file imports node:fs, so the client bundle cannot take it and keeps this
 * copy. Bare URL cells (older trackers, hand edits) pass through unchanged,
 * exactly as the core's version does.
 *
 * @param {string} cell
 * @returns {string} The href, or the cell itself when it is already bare.
 */
function cellUrl(cell) {
  const value = String(cell ?? "").trim();
  if (!value) return "";
  for (const link of value.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = String(link[2]).trim().replace(/^<|>$/g, "");
    if (/^https?:\/\//i.test(target)) return target;
  }
  return value;
}

/**
 * Find the tracker row an evaluate worker's posting URL landed on.
 *
 * @param {Array<{ url?: string, [k: string]: unknown }>} applications - parsed
 *   tracker rows (the web `Application` shape is fine; only `url` is read).
 * @param {string} inputUrl - the posting URL the worker was launched with.
 * @returns {Record<string, string> | null} The matching row, or null when the
 *   URL keys to nothing (invalid/empty input) or no tracker row carries its key.
 */
export function findPipelineEntry(applications, inputUrl) {
  const key = linkKey(inputUrl);
  if (!key) return null;
  for (const app of applications ?? []) {
    if (!app?.url) continue;
    if (linkKey(cellUrl(app.url)) === key) return app;
  }
  return null;
}
