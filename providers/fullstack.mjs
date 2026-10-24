// @ts-check
import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

/** @typedef {import('./_types.js').Provider} Provider */

// FullStack Labs provider — a `job_boards:` entry (one operator, many client
// engagements, so every posting's employer of record is FullStack itself).
//
// Source: FullStack's own talent portal `https://talent.fullstack.com` (a React
// SPA whose HTML shell carries nothing), backed by a public, zero-auth JSON API
// its own front end calls:
//   list:   GET https://api-v1.fullstack.com/api/job-postings/public?page=N
//           → { data: [ …30 rows… ], meta: { page, take, totalCount, pageCount, … } }
//   detail: GET https://api-v1.fullstack.com/api/job-postings/{postingId}
//           (sections[].body HTML — not read here; the list carries no JD text
//           and the scanner is zero-token, so no detail fan-out)
// Public posting URL: https://talent.fullstack.com/jobs/{postingId} — the
// `id` field, NOT `jobId` (jobId is the underlying req and 404s on that route).
//
// The board is ~2.9k postings over 97 pages of 30 (measured 2026-10-23), one
// posting per country for the same req — "Senior Technical Project Manager -
// Remote - Latin America" arrives once each for Costa Rica, Bolivia, Uruguay,
// … so the scanner's company+role dedup folds those into one row by design.
// Rows are NOT date-ordered (page 1 mixes March and October), so a full sweep
// is what gives complete coverage; `max_pages` on the entry decides how deep a
// scan goes.
//
// Pacing is not optional here: the API rate-limits bursts at roughly 20
// requests per minute. Measured 2026-10-23 — 18 requests at 120 ms spacing
// earned a 429 with `Retry-After: 57`, while 22 requests at 3.4 s spacing all
// returned 200. INTER_PAGE_DELAY_MS sits at that observed-safe pace, so a full
// sweep costs ~5–6 minutes of deliberate pacing.
//
// `?search=` / `?filter[…]=` are accepted and silently IGNORED by this endpoint
// (the reported totalCount never moves), so there is no server-side narrowing to
// offer — title_filter / location_filter run locally in scan.mjs as usual.
//
// Auto-detects a careers_url/api on talent.fullstack.com; `provider: fullstack`
// also works.

const LIST_URL = 'https://api-v1.fullstack.com/api/job-postings/public';
const POSTING_BASE = 'https://talent.fullstack.com/jobs/';
const BOARD_HOST = 'talent.fullstack.com';
const PAGE_SIZE = 30;

// 20 pages = 600 postings per scan by default (~70 s at the pace below).
const DEFAULT_MAX_PAGES = 20;
// Runaway bound: the whole board was 97 pages when this was written, so this
// leaves room for it to grow without letting one portals.yml line page forever.
const MAX_PAGES_CAP = 120;
const INTER_PAGE_DELAY_MS = 3400;

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

// NaN-safe: the list sends ISO strings, the detail endpoint epoch ms. `|| 0`
// would also erase a legitimate 1970 timestamp.
function toEpochMs(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Compose the location string from the row's place fields. The list gives a
 * country (`region`) plus its grouping (`regionGroup`, e.g. "Latam"), rarely a
 * city, and a workplace type — so "Costa Rica · Latam · Remote" rather than a
 * bare country name, which location_filter written for an ATS sweep would drop.
 */
function composeLocation(row) {
  const parts = [];
  for (const raw of [row?.city, row?.region, row?.regionGroup, row?.linkedInWorkplaceType]) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value) continue;
    if (parts.some((p) => p.toLowerCase() === value.toLowerCase())) continue;
    parts.push(value);
  }
  return parts.join(' · ');
}

/**
 * Normalize one list row. Exported for unit tests.
 *
 * @param {any} row
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, postedAt?: number, externalId?: string } | null}
 */
export function normalizeFullstackJob(row, fallbackCompany) {
  if (!row || typeof row !== 'object') return null;

  const title = typeof row.jobTitle === 'string' ? row.jobTitle.trim() : '';
  if (!title) return null;

  // The public feed only serves published postings; a row that says otherwise
  // is a closed req still lingering in the payload.
  if (row.isPublished === false || row.isJobPublished === false) return null;
  if (typeof row.statusName === 'string' && row.statusName && row.statusName !== 'Published') return null;

  const seg = safeEncodeURIComponent(row.id ?? '');
  if (seg === null || !seg) return null;
  const url = `${POSTING_BASE}${seg}`;

  const company =
    typeof fallbackCompany === 'string' && fallbackCompany.trim() ? fallbackCompany.trim() : 'FullStack Labs';

  /** @type {{ title: string, url: string, company: string, location: string, postedAt?: number, externalId?: string }} */
  const job = { title, url, company, location: composeLocation(row) };
  const postedAt = toEpochMs(row.createdAt);
  if (postedAt !== undefined) job.postedAt = postedAt;
  // The posting's own id (one per country variant of a req), never jobId — see
  // the header note. Not a requisition key, so it is `externalId`.
  if (typeof row.id === 'string' && row.id) job.externalId = row.id;
  return job;
}

/** @type {Provider} */
export default {
  id: 'fullstack',

  detect(entry) {
    for (const candidate of [entry?.careers_url, entry?.api]) {
      if (typeof candidate !== 'string' || !candidate) continue;
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol === 'https:' && parsed.hostname === BOARD_HOST) return { url: candidate };
      } catch {
        // not a URL → not ours
      }
    }
    return null;
  },

  async fetch(entry, ctx) {
    const probing = Number(ctx?.maxPages) > 0;
    const ctxCap = probing ? Number(ctx.maxPages) : Infinity;
    const maxPages = Math.min(resolveMaxPages(entry), ctxCap);
    const fallbackCompany = entry?.name;
    const out = [];
    /** Why the walk stopped: 'complete' | 'cap' | 'fetch-error' | 'unrecognised'. */
    let stopReason = 'complete';
    let reportedPageCount = null;

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);

      let json;
      try {
        // redirect:'error' — fixed literal host (https), so no allowlist is
        // needed, but a 3xx must never be followed to another origin.
        // 429/5xx/transport errors are retried; a 24–57 s Retry-After is
        // honoured up to maxDelayMs * 4 by the helper.
        json = await fetchJsonWithRetry(
          ctx,
          `${LIST_URL}?page=${page}`,
          { redirect: 'error', headers: { accept: 'application/json' } },
          { retries: 3, baseDelayMs: 1_000, maxDelayMs: 20_000 },
        );
      } catch (err) {
        // A probe must see the rejection unwrapped (ProbePageBudgetReached
        // identity). A real scan keeps the pages already collected rather than
        // throwing away a multi-minute sweep — but says so.
        if (probing) throw err;
        if (out.length === 0) throw err;
        stopReason = 'fetch-error';
        console.error(
          `⚠️  fullstack: ${fallbackCompany ?? 'FullStack'} stopped at page ${page} — ${(err && err.message) || err} (keeping ${out.length} postings)`,
        );
        break;
      }

      const rows = json && Array.isArray(json.data) ? json.data : null;
      if (!rows) {
        const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
        throw new Error(`fullstack: unexpected response on page ${page} — expected { data: [...] }, got: [${got}]`);
      }
      const pageCount = json?.meta && Number.isInteger(json.meta.pageCount) ? json.meta.pageCount : null;
      if (pageCount !== null && pageCount > 0) reportedPageCount = pageCount;

      for (const row of rows) {
        const job = normalizeFullstackJob(row, fallbackCompany);
        if (job) out.push(job);
      }

      // Termination reads the SOURCE's row count for this page (before malformed
      // rows were dropped), so one bad row on a full page can't end the walk early.
      if (rows.length === 0) break;
      if (rows.length < PAGE_SIZE) break;
      if (page >= maxPages) {
        // A full page at the boundary: the ceiling truncated a healthy board,
        // unless the source says we were in fact on the last page.
        stopReason = pageCount !== null && page >= pageCount ? 'complete' : 'cap';
      }
    }

    if (stopReason === 'cap') {
      const total = reportedPageCount !== null ? reportedPageCount * PAGE_SIZE : 'more';
      console.error(
        `⚠️  fullstack: ${fallbackCompany ?? 'FullStack'} truncated at max_pages=${maxPages} (${out.length} of ~${total} postings) — raise max_pages on this entry for a deeper sweep`,
      );
    }

    return out;
  },
};
