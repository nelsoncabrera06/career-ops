// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// EmpleosIT provider — empleosit.com.ar, the Argentine tech-only job board.
//
// Why this exists: Computrabajo (providers/computrabajo.mjs) is the volume
// board for the whole Argentine domestic market, which means most of what it
// returns is not engineering. This is the country's dedicated IT board: every
// posting on it is a technology role, and the employers filling it are the local
// software houses, consultoras and product teams that never appear on
// Greenhouse, Lever, Ashby, Workday or SuccessFactors. A reverse-ATS sweep has
// no path to them at all — not a filter to loosen, a structural hole.
//
// SERVER-RENDERED, NO API, NO AUTH. Search results are plain HTML, parsed with
// the same tiny-tag-extractor approach as computrabajo.mjs / occ.mjs, so no
// HTML-parser dependency is added.
//
// THE WHOLE BOARD IS BROWSABLE — this is the important difference from
// Computrabajo. `search-results-jobs/?action=search&listing_type[equal]=Job`
// with no keyword returns every open posting (verified live 2026-10-21:
// "Encontramos 548 trabajos disponibles para vos", which matches the 548
// /display-job URLs in sitemap.xml exactly). There is therefore no `queries:`
// requirement and no invented default keyword list: one sweep covers the board,
// and scan.mjs's title_filter / location_filter do the narrowing afterwards.
//
// URL shape (verified live 2026-10-21):
//   https://www.empleosit.com.ar/search-results-jobs/?action=search
//     &listing_type[equal]=Job      <- restricts to Job listings (the board also
//                                      carries other listing types)
//     &view=list
//     &listings_per_page=100        <- the board's own maximum (10/20/50/100);
//                                      measured: 100 cards per page at this value
//     &sorting_field=activation_date&sorting_order=DESC
//                                   <- newest first, so a truncated sweep keeps
//                                      the freshest postings
//     &page=N                       <- 1-based
// `listings_per_page` is the parameter the board's own per-page selector submits
// (its <select> is named `listings_per_page2`, which is NOT the wire name — the
// inline submitForm() rewrites it to `listings_per_page`; sending the select's
// name instead is silently ignored and every page comes back at 10 results).
// `?page=N` past the end clamps to the last page rather than erroring, so the
// loop below stops on the first page that yields no new ids.
//
// 548 postings / 100 per page = 6 pages for a complete sweep, and the board
// states its own total ("Encontramos <span> N </span> trabajos…"), so the loop
// plans its page count from that number and does not spend a request confirming
// the end.
//
// robots.txt (fetched 2026-10-21) — everything this provider reads is allowed:
//   User-agent: *
//   Allow: /
//   Disallow: /files/files
//   Crawl-delay: 10
// INTER_REQUEST_DELAY_MS below honors that delay between every request,
// including the first (same convention as jobbankca.mjs honoring its
// `Crawl-delay: 5`). It is the one real cost of this provider: a complete sweep
// is ~6 requests, i.e. ~60s of deliberate pacing. EmpleosIT is a small board, so
// that buys full coverage rather than a sample, and the pacing is what keeps the
// board answering.
//
// Card shape (one per posting):
//   <div class="oddrow">                                  <- or "evenrow"
//     <div><div class="listing-section listingsection">
//       <div class="right-side left"><a href="/company/453/CyS/"><img ...></a></div>
//       <div class="listing-right ">
//         <div class="listing-title" >
//           <a name="listing_130621"></a>
//           <a href="https://www.empleosit.com.ar/display-job/130621/DevOps-Senior.html?searchId=...&page=1">DevOps Senior</a>
//           <span class="full-time New-post">Nuevo</span>   <- or "Updated-post"
//         </div>
//         <div class="show-brief">
//           <strong>Descripción del empleo:</strong>DevOps Senior Duración: 3 meses...
//         </div>
//         <div class="listing-info"><div class="left-side">
//           <span class="captions-field location-ico">Ciudad Autónoma de Buenos Aires (CABA), Buenos Aires</span>
//           <span class="captions-field posted-ico">13/10/2026</span><br/>
//           <span class="captions-field company-ico"><a href="/company/453/CyS/">CyS</a></span>
//         </div></div>
//       </div>
//     </div></div>
//   </div>
//
// Two markup details worth keeping when editing the parser:
//   - The "Nuevo" / "Actualizado" badge sits inside `.listing-title` next to the
//     anchor, so the title is read from the anchor alone. Stripping the whole
//     title div to text would leak those chips into the job title.
//   - The card's real href carries a per-session `?searchId=…&page=…` query
//     string. The canonical posting URL is the path part alone — that is what
//     the provider emits, so two scans never produce two dedup keys for one
//     posting.
//
// Dates here are ABSOLUTE (`posted-ico` is always DD/MM/YYYY, measured across
// the board), unlike Computrabajo's relative "Ayer" / "Hace 2 días". They are
// converted to epoch ms at 12:00 UTC on that day, so the value cannot drift a day
// backwards for a user in a negative-offset timezone. An unparseable or
// impossible date (31/02/2026) returns undefined rather than rolling over into
// March: a wrong-but-plausible date is worse than an admitted unknown.
//
// Location carries the board's own country. The board reports "<city>, <province>"
// ("Pilar, Buenos Aires"), or "Remoto, Remoto" for a remote posting — never the
// word "Argentina", and never the English "Remote". A `location_filter.allow`
// written for an international ATS sweep lists "Argentina" / "Buenos Aires" /
// "Remote" and would silently drop the remote half of this board. So each Job's
// `location` is composed as `<city>, Argentina`, and a remote posting as
// `Argentina · Remoto` (with a literal "Remoto, Remoto" reduced to that form
// rather than repeated). The country is a property of the SOURCE — this is the
// Argentine tech board — not an inference about the posting.
//
// Wire in via a `job_boards:` entry with `provider: empleosit`:
//   - name: EmpleosIT
//     provider: empleosit
//     careers_url: https://www.empleosit.com.ar/
//     max_pages: 10        # optional, default 10, hard cap 20
//
// No `queries:` — see the browsable-board note above.

import { BROWSER_LIKE_USER_AGENT, fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const ORIGIN = 'https://www.empleosit.com.ar';
const HOST = 'www.empleosit.com.ar';
const SEARCH_PATH = '/search-results-jobs/';

/** The board's own maximum, and the parameter its per-page selector really sends. */
const PER_PAGE = 100;

/** 10 pages = 1000 postings; the board carried 548 when this was written. */
const DEFAULT_MAX_PAGES = 10;

/** Hard ceiling on a configured `max_pages`, so one entry cannot sweep forever. */
const HARD_PAGE_CAP = 20;

/** robots.txt: `Crawl-delay: 10`. Applied between every request, including the first. */
const INTER_REQUEST_DELAY_MS = 10000;

/** Mirrors the board's own edition. See the location note in the header. */
const COUNTRY = 'Argentina';

/** Strip tags, decode entities, collapse whitespace. */
function text(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Build one search-results URL.
 *
 * URLSearchParams is used deliberately: the board's parameters are bracketed
 * (`listing_type[equal]`), and it serializes those to `listing_type%5Bequal%5D`
 * the same way the board's own pages do.
 *
 * @param {number} page 1-based
 */
export function buildSearchUrl(page) {
  const params = new URLSearchParams({
    action: 'search',
    'listing_type[equal]': 'Job',
    view: 'list',
    listings_per_page: String(PER_PAGE),
    sorting_field: 'activation_date',
    sorting_order: 'DESC',
    page: String(page),
  });
  return `${ORIGIN}${SEARCH_PATH}?${params.toString()}`;
}

/**
 * The board's own result total — "Encontramos <span> 548 </span> trabajos
 * disponibles para vos".
 *
 * Read so the loop can plan `ceil(total / PER_PAGE)` pages instead of spending a
 * request to discover the end. Returns null when the copy is absent (a challenge
 * page, a markup change), which simply leaves the caller on its configured cap.
 *
 * @param {string} html
 * @returns {number|null}
 */
export function parseTotalCount(html) {
  const m = String(html).match(/Encontramos\s*<span>\s*([\d.,]+)\s*<\/span>\s*trabajos?/i);
  if (!m) return null;
  const n = Number(m[1].replace(/[.,]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * The board's own "this search matched nothing" copy.
 *
 * Needed because a zero-card parse is ambiguous: a genuinely empty board, an SDK
 * challenge page served with HTTP 200, and a markup change all produce the same
 * `[]`. Treating them alike is how a broken scraper reads as a healthy board with
 * no jobs.
 *
 * @param {string} html
 * @returns {boolean}
 */
export function isEmptyResultPage(html) {
  return /no se encontraron publicaciones/i.test(text(html));
}

/**
 * Parse the card's absolute `DD/MM/YYYY` date into epoch ms at 12:00 UTC.
 *
 * Noon, not midnight: a midnight-UTC timestamp rendered in Buenos Aires (UTC-3)
 * falls on the previous day, which would show a posting as a day older than the
 * board says.
 *
 * An impossible date is rejected rather than allowed to roll over — Date.UTC
 * happily turns 31/02 into 03/03, and a silently corrected date is worse than an
 * admitted unknown. The round-trip check below is what catches it.
 *
 * @param {string} raw
 * @returns {number|undefined}
 */
export function parseAbsoluteDate(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return undefined;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const ms = Date.UTC(year, month - 1, day, 12, 0, 0);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return undefined;
  return ms;
}

/**
 * Resolve a card href to its canonical posting URL: absolute, https, this board's
 * host, and without the per-session `searchId` / `page` query so the dedup key is
 * stable across scans. A card never legitimately points off-host, so anything
 * that does is dropped rather than emitted as a posting key.
 *
 * @param {string} href
 * @returns {string}
 */
export function canonicalPostingUrl(href) {
  const clean = String(href || '').split('#')[0].trim();
  if (!clean) return '';
  let u;
  try {
    u = new URL(clean, ORIGIN);
  } catch {
    return '';
  }
  if (u.protocol !== 'https:') return '';
  if (u.hostname !== HOST && u.hostname !== 'empleosit.com.ar') return '';
  u.search = '';
  return u.href;
}

/**
 * Compose the location string. See the location note in the header: the country
 * comes from the board, not from the posting.
 *
 * "Remoto, Remoto" is the board's remote marker in both halves; it is reduced to
 * `Argentina · Remoto` rather than repeated or treated as a city.
 *
 * @param {string} raw
 */
export function composeLocation(raw) {
  const loc = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!loc) return COUNTRY;
  if (/^remoto$/i.test(loc.split(',')[0].trim())) return `${COUNTRY} · Remoto`;
  if (new RegExp(`(^|[,\\s])${COUNTRY}$`, 'i').test(loc)) return loc;
  return `${loc}, ${COUNTRY}`;
}

/**
 * Parse the posting cards out of one rendered results page.
 *
 * @param {string} html
 * @returns {Array<{id:string,title:string,url:string,company:string,location:string,description?:string,postedAt?:number}>}
 */
export function parseCards(html) {
  const out = [];
  // Split on the card class rather than regex-matching a whole card: the markup
  // nests divs several levels deep and a greedy match would swallow the next one.
  // Measured: this class appears exactly once per posting, nothing else.
  const chunks = String(html).split('class="listing-section listingsection"');
  for (const chunk of chunks.slice(1)) {
    // The id anchor is the most reliable identity, but fall back to the
    // display-job path when the anchor is missing.
    const idM = chunk.match(/<a name="listing_(\d+)"/)
      || chunk.match(/display-job\/(\d+)\//);
    if (!idM) continue;
    const id = idM[1];

    // Title: the anchor inside .listing-title, never the div's full text (it also
    // holds the "Nuevo" / "Actualizado" badges).
    const titleM = chunk.match(/<div class="listing-title"[^>]*>([\s\S]*?)<\/div>/);
    const linkM = titleM ? titleM[1].match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/) : null;
    const title = linkM ? text(linkM[2]) : '';
    if (!title) continue;

    const url = linkM ? canonicalPostingUrl(decodeEntities(linkM[1])) : '';
    if (!url) continue;

    // Company: the span's inner HTML, stripped — some cards link it, some don't.
    const compM = chunk.match(/<span class="captions-field company-ico">([\s\S]*?)<\/span>/);
    const company = compM ? text(compM[1]) : '';

    const locM = chunk.match(/<span class="captions-field location-ico">([\s\S]*?)<\/span>/);
    const dateM = chunk.match(/<span class="captions-field posted-ico">([\s\S]*?)<\/span>/);

    // The card's own description snippet, already truncated by the board with a
    // trailing "…". Free — no extra request — and consumed only by
    // scan.mjs's content_filter, never rendered as the JD.
    const briefM = chunk.match(/<div class="show-brief"[^>]*>([\s\S]*?)<\/div>/);
    const description = briefM
      ? text(briefM[1]).replace(/^Descripci[oó]n del empleo:\s*/i, '').trim()
      : '';

    /** @type {{id:string,title:string,url:string,company:string,location:string,description?:string,postedAt?:number}} */
    const card = {
      id,
      title,
      url,
      // Never substitute the board's own name for a missing employer:
      // source-policy rule 1.
      company: company || '?',
      location: composeLocation(text(locM ? locM[1] : '')),
    };
    if (description) card.description = description;
    const postedAt = dateM ? parseAbsoluteDate(text(dateM[1])) : undefined;
    if (postedAt !== undefined) card.postedAt = postedAt;
    out.push(card);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'empleosit',

  // A single vendor host (not a per-employer tenant), so the host itself is the
  // signature: an entry pointing anywhere on this board is one this provider reads.
  detect(entry) {
    const raw = entry?.api || entry?.careers_url || '';
    let u;
    try {
      u = new URL(String(raw));
    } catch {
      return null;
    }
    if (u.protocol !== 'https:') return null;
    if (u.hostname !== HOST && u.hostname !== 'empleosit.com.ar') return null;
    return { url: `${ORIGIN}/` };
  },

  async fetch(entry, ctx) {
    // verify-portals.mjs's health probe sets ctx.maxPages (1): it only needs the
    // first page to tell a live board from a broken one and must not walk the
    // whole board. Honour it as a ceiling over the entry's own cap.
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const entryMaxPages = Math.min(
      Number.isInteger(entry?.max_pages) && entry.max_pages > 0 ? entry.max_pages : DEFAULT_MAX_PAGES,
      HARD_PAGE_CAP,
    );
    const maxPages = probing ? Math.min(entryMaxPages, ctx.maxPages) : entryMaxPages;

    const seen = new Set();
    const jobs = [];
    /** @type {string|null} */
    let firstPageError = null;
    let plannedPages = maxPages;

    for (let page = 1; page <= Math.min(maxPages, plannedPages); page++) {
      await sleep(INTER_REQUEST_DELAY_MS, ctx);

      const url = buildSearchUrl(page);
      let html;
      try {
        html = await fetchTextWithRetry(ctx, url, {
          headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT },
          redirect: 'error',
        // isRetryableError() treats a status-less rejection as retryable, and
        // verify-portals.mjs's budget sentinel is status-less: retrying it would
        // burn the probe's remaining budget re-raising the same stop signal. The
        // probe wants one page, so it gets one request.
        }, probing ? { retries: 0 } : {});
      } catch (err) {
        // While probing, propagate unwrapped so verify-portals.mjs's
        // error-identity checks still work.
        if (probing) throw err;
        // Page 1 failing means the board is unreachable — the caller must see an
        // outage, not an empty board. A later page failing keeps what was already
        // collected: recall-first, one bad page is not a dead board.
        if (page === 1) firstPageError = `page 1: ${(err && err.message) || err}`;
        break;
      }

      const cards = parseCards(html);

      if (!cards.length) {
        if (!isEmptyResultPage(html)) {
          // A 200 with an unreadable body is a scraper break, not an empty board:
          // a challenge interstitial or a markup change lands here, and counting
          // it as "no jobs" is how a dead scraper reads as a healthy board.
          if (page === 1) firstPageError = `page 1 parsed to zero cards and is not the board's empty-result page (challenge or markup change) — ${url}`;
        }
        break;
      }

      // Plan from the board's own total once page 1 states it, so a complete
      // sweep costs exactly ceil(total / PER_PAGE) requests.
      const total = parseTotalCount(html);
      if (page === 1 && total !== null && total > 0) {
        plannedPages = Math.min(maxPages, Math.ceil(total / PER_PAGE));
      }

      // Stop on the first page that yields no new ids: an out-of-range page
      // clamps to the last page, and re-emitting it would duplicate the tail.
      let fresh = 0;
      for (const c of cards) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        fresh++;
        jobs.push({
          title: c.title,
          url: c.url,
          company: c.company,
          location: c.location,
          ...(c.description ? { description: c.description } : {}),
          ...(c.postedAt !== undefined ? { postedAt: c.postedAt } : {}),
        });
      }
      if (fresh === 0) break;
    }

    // Total outage: page 1 never produced a readable board. Returning [] here
    // would read downstream as a live board that simply has no matching jobs.
    if (firstPageError) throw new Error(`empleosit: ${firstPageError}`);

    // An empty array here is honest only because the two ways to reach it are
    // both real: the board said "No se encontraron publicaciones", or the sweep
    // legitimately ran out of cards. Everything else threw above.
    return jobs;
  },
};
