// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Computrabajo Argentina provider — ar.computrabajo.com.
//
// Why this exists: Computrabajo is the volume job board for the Argentine
// domestic market, and the employers filling it (PyMEs, consultoras, retail
// groups, local software houses) never appear on Greenhouse, Lever, Ashby,
// Workday or SuccessFactors. A reverse-ATS sweep therefore has no path to them
// at all — not a filter to loosen, a structural hole. Same reasoning as
// providers/occ.mjs for Mexico; this is the Argentina edition.
//
// There is no public JSON API. The search pages are server-rendered HTML, so
// the offer cards are parsed out of the markup with the same tiny-tag-extractor
// approach as occ.mjs / weworkremotely.mjs, rather than adding an HTML-parser
// dependency.
//
// URL shapes (verified live 2026-10-21):
//   https://ar.computrabajo.com/trabajo-de-{keyword-slug}
//   https://ar.computrabajo.com/trabajo-de-{keyword-slug}-en-{location-slug}
// Pagination IS a query parameter here (unlike OCC's slug suffix):
//   https://ar.computrabajo.com/trabajo-de-{keyword-slug}?p=2
// `?p=2` was verified to return a different set of posting ids than page 1, and
// `?p=99` returns the board's own empty-result page rather than page 1. The loop
// below still stops on "no new ids", so an out-of-range page is cheap either way.
//
// Card shape (one per posting, 20 per page):
//   <article class="box_offer sel " data-id='A1A9473716336A5161373E686DCF3405' data-blind="false" ...>
//     <h2 class="fs18 fwB prB">
//       <a class="js-o-link fc_base" href="/ofertas-de-trabajo/oferta-de-trabajo-de-...-A1A94737...#lc=...">
//         TITLE
//       </a>
//       <div class="tags"> ... Postulado / Vista ... </div>
//     </h2>
//     <p class="dFlex vm_fx fs16 fc_base mt5">        <- rating + company
//       <span class="fx_none mr10"><span class="fwB">3,6</span>...</span>
//       <span class="icon i_verificada mr5"></span>
//       <a class="fc_base t_ellipsis" href="..." offer-grid-article-company-url>COMPANY</a>
//     </p>
//     <p class="fs16 fc_base mt5"><span class="mr10">CITY, PROVINCE</span></p>
//     <div class="fs13 mt15">
//       <span class="dIB mr10"><span class="icon i_salary"></span>$ 2.222,00 (Mensual)</span>
//       <span class="dIB mr10"><span class="icon i_home"></span>Remoto</span>
//     </div>
//     <p class="fs13 fc_aux mt15">Ayer</p>            <- relative posting date
//
// Two markup details worth keeping when editing the parser:
//   - The company anchor is NOT always an /empresas/ URL (some employers get a
//     direct brand host such as https://ar.computrabajo.com/cys), so it is
//     matched by its `offer-grid-article-company-url` marker / class, never by
//     its href.
//   - The <h2> also carries a sibling <div class="tags"> with "Postulado" /
//     "Vista" state chips, so the title is read from the anchor alone. Stripping
//     the whole <h2> to text would leak those chips into the job title.
//
// Location carries the edition's country. Computrabajo AR reports a city and
// province ("Recoleta, Capital Federal", "Olivos, Buenos Aires"), or nothing but
// a modality chip for a remote posting. A `location_filter.allow` written for an
// international ATS sweep lists "Argentina" / "Buenos Aires" / "Remote" and
// would silently drop most of this board — "Capital Federal" matches none of
// them, and the board says "Remoto", not "Remote". So each Job's `location` is
// composed as `<city>, Argentina` plus a `· Remoto` suffix when the modality
// chip is present: the country is a property of the SOURCE (this is the
// Argentina edition of the board), not an inference about the posting.
//
// robots.txt (read from ar.computrabajo.com, 2026-10-21): `User-agent: *`
// disallows /hojas-de-vida/*, /curriculums/*, /Ajax/*, /_services/*, /go/* and
// /ofertas-de-trabajo/* paths carrying a filter query (`*dis=`, `*sal=`,
// `*pubdate=`, `*emp=`, …), plus a few /empresas/* filter paths. The paths this
// provider reads — /trabajo-de-* search pages and the /ofertas-de-trabajo/
// posting URLs handed out by the listing — are NOT disallowed: the disallowed
// shapes all carry a filter query string the provider never builds. Requests are
// paced and bounded by max_pages (default 3, hard cap 10).
//
// Wire in via a `job_boards:` entry with `provider: computrabajo`:
//   - name: Computrabajo Argentina
//     provider: computrabajo
//     queries: ["devops", "site reliability"]   # REQUIRED — see below
//     locations: ["buenos-aires"]              # optional; omit for nationwide
//     max_pages: 3                             # optional, default 3, hard cap 10
//
// `queries` is required and has no default, for the same reason as occ: this is
// a keyword-search board with no browsable "all jobs" listing, so a built-in
// default would be one user's search profile silently applied to everyone
// else's scan.

import { BROWSER_LIKE_USER_AGENT, fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const ORIGIN = 'https://ar.computrabajo.com';
const DEFAULT_MAX_PAGES = 3;
const HARD_PAGE_CAP = 10;
const DAY_MS = 86_400_000;

/** Mirrors the board's own edition. See the location note in the header. */
const COUNTRY = 'Argentina';

/** Pacing between page requests, matching the parser providers (occ, jobbankca, careerviet). */
const INTER_REQUEST_DELAY_MS = 750;

/** Strip tags, decode entities, collapse whitespace. */
function text(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Accents are folded because the board's own slugs are unaccented. */
function slugify(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Build one search URL. Page 1 has no `p`, later pages take `?p=N` on the
 * keyword path (see the URL-shape note above).
 *
 * @param {string} query
 * @param {string|null} location
 * @param {number} page
 */
export function buildSearchUrl(query, location, page) {
  const q = slugify(query);
  const loc = location ? `-en-${slugify(location)}` : '';
  const base = `${ORIGIN}/trabajo-de-${q}${loc}`;
  return page > 1 ? `${base}?p=${page}` : base;
}

/**
 * The board's own "this search matched nothing" copy.
 *
 * Needed because a zero-card parse is ambiguous: a genuinely empty search, an
 * out-of-range page (`?p=99` re-serves this page, not page 1) and a markup
 * change all produce the same `[]`. Treating them alike is how a broken scraper
 * reads as a healthy board with no jobs.
 *
 * @param {string} html
 * @returns {boolean}
 */
export function isEmptyResultPage(html) {
  const plain = text(html).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /no hay ofertas para el empleo/i.test(plain);
}

/**
 * Turn the card's relative date ("Hoy", "Ayer", "Hace 2 días") into epoch ms.
 *
 * Only the forms with an unambiguous meaning are converted. An absolute date
 * ("15 de octubre") carries no year and guessing one is how a stale posting gets
 * presented as fresh, so it returns undefined — scan.mjs ignores postedAt
 * anyway, and consumers treat an absent date as "unknown", never as stale.
 *
 * @param {string} raw
 * @param {number} now
 * @returns {number|undefined}
 */
export function parseRelativeDate(raw, now = Date.now()) {
  const s = String(raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (!s) return undefined;
  if (s === 'hoy') return now;
  if (s === 'ayer') return now - DAY_MS;
  const m = s.match(/^hace\s+(\d+)\s+dias?$/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 0) return now - n * DAY_MS;
  }
  return undefined;
}

/**
 * Resolve a card href to an absolute http(s) URL on this board's own host.
 * A card never legitimately points off-host, so anything that does is dropped
 * rather than emitted as the posting's dedup key.
 *
 * @param {string} href
 * @returns {string}
 */
function absolutePostingUrl(href) {
  const clean = String(href || '').split('#')[0].trim();
  if (!clean) return '';
  let u;
  try {
    u = new URL(clean, ORIGIN);
  } catch {
    return '';
  }
  if (u.protocol !== 'https:' || u.hostname !== 'ar.computrabajo.com') return '';
  return u.href;
}

/**
 * Compose the location string. See the header note: the country comes from the
 * board edition, not from the posting.
 *
 * @param {string} city
 * @param {string} modality
 */
function composeLocation(city, modality) {
  const parts = [];
  if (city) parts.push(city);
  parts.push(COUNTRY);
  let loc = parts.join(', ');
  if (modality && !city.toLowerCase().includes(modality.toLowerCase())) loc += ` · ${modality}`;
  return loc;
}

/**
 * Parse the offer cards out of one rendered search page.
 *
 * @param {string} html
 * @param {number} [now] epoch ms used to resolve "Hoy" / "Ayer" / "Hace N días"
 * @returns {Array<{id:string,title:string,url:string,company:string,location:string,postedAt?:number}>}
 */
export function parseCards(html, now = Date.now()) {
  const out = [];
  // Split on the card class rather than regex-matching a whole card: the markup
  // nests divs several levels deep and a greedy match would swallow the next one.
  const chunks = String(html).split('<article class="box_offer');
  for (const chunk of chunks.slice(1)) {
    const idM = chunk.match(/data-id='([0-9A-Fa-f]+)'/);
    if (!idM) continue;
    const id = idM[1];

    // Title: the anchor inside <h2>, never the <h2>'s full text (it also holds
    // the "Postulado" / "Vista" state chips).
    const h2M = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    const linkM = h2M ? h2M[1].match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/) : null;
    const title = linkM ? text(linkM[2]) : '';
    if (!title) continue;

    const url = linkM ? absolutePostingUrl(linkM[1]) : '';
    if (!url) continue;

    // Company: matched by its own marker/class, never by href — some employers
    // get a brand host instead of an /empresas/ path.
    const compM = chunk.match(/<a[^>]*offer-grid-article-company-url[^>]*>([\s\S]*?)<\/a>/)
      || chunk.match(/<a[^>]*class="fc_base t_ellipsis"[^>]*>([\s\S]*?)<\/a>/);
    const company = compM ? text(compM[1]) : '';

    // Location sits in a <p> whose only child is <span class="mr10">. The
    // company row uses a different class list (dFlex vm_fx …), so the two
    // paragraphs cannot be confused.
    const locM = chunk.match(/<p class="fs16 fc_base mt5">\s*<span class="mr10">([\s\S]*?)<\/span>/);
    const city = locM ? text(locM[1]) : '';

    // Modality chip ("Remoto") lives next to the salary chip, told apart by the
    // i_home icon.
    const modM = chunk.match(/<span class="dIB mr10">\s*<span class="icon i_home"><\/span>\s*([^<]*)<\/span>/);
    const modality = modM ? text(modM[1]) : '';

    const dateM = chunk.match(/<p class="fs13 fc_aux mt15">\s*([^<]*)<\/p>/);

    /** @type {{id:string,title:string,url:string,company:string,location:string,postedAt?:number}} */
    const card = {
      id,
      title,
      url,
      // "Confidencial" is the board's own placeholder for a hidden employer, not
      // a company name: use the locale-invariant '?' marker (#1596) rather than
      // letting the Spanish string leak into reports.
      company: !company || /^confidencial$/i.test(company) ? '?' : company,
      location: composeLocation(city, modality),
    };
    // text() first: the board entity-encodes the accent ("d&#xED;as"), and a
    // raw capture would never match the accented form.
    const postedAt = dateM ? parseRelativeDate(text(dateM[1]), now) : undefined;
    if (postedAt !== undefined) card.postedAt = postedAt;
    out.push(card);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'computrabajo',

  // The board is a single vendor host (not a per-employer tenant), so the host
  // itself is the signature: an entry pointing at the Argentina edition is one
  // this provider can read.
  detect(entry) {
    const raw = entry?.api || entry?.careers_url || '';
    let u;
    try {
      u = new URL(String(raw));
    } catch {
      return null;
    }
    if (u.protocol !== 'https:') return null;
    return u.hostname === 'ar.computrabajo.com' ? { url: u.href } : null;
  },

  async fetch(entry, ctx) {
    // No default queries: Computrabajo is a keyword-search board with no
    // browsable "all jobs" listing, so a built-in list would be one profile's
    // search silently applied to every user. Fail loudly instead (cf. occ, wttj).
    const queries = Array.isArray(entry.queries)
      ? entry.queries.map((q) => String(q).trim()).filter(Boolean)
      : [];
    if (!queries.length) {
      throw new Error(
        `computrabajo: entry "${entry.name || 'Computrabajo'}" requires a non-empty queries: [...] list `
        + '(e.g. queries: ["devops", "site reliability"]) — Computrabajo is a keyword-search '
        + 'board and has no default listing to scan.',
      );
    }

    const locations = Array.isArray(entry.locations) && entry.locations.length
      ? entry.locations : [null];

    // verify-portals.mjs's health probe sets ctx.maxPages (1): it only needs the
    // first page to tell a live board from a broken one and must not walk the
    // whole board. Honour it as a ceiling over the entry's own cap.
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const entryMaxPages = Math.min(
      Number.isInteger(entry.max_pages) && entry.max_pages > 0 ? entry.max_pages : DEFAULT_MAX_PAGES,
      HARD_PAGE_CAP,
    );
    const maxPages = probing ? Math.min(entryMaxPages, ctx.maxPages) : entryMaxPages;

    const seen = new Set();
    const jobs = [];
    const errors = [];
    let succeeded = 0; // query/location pairs whose first request the board answered

    for (const query of queries) {
      for (const location of locations) {
        let answered = false;
        for (let page = 1; page <= maxPages; page++) {
          await sleep(INTER_REQUEST_DELAY_MS, ctx);

          const url = buildSearchUrl(query, location, page);
          let html;
          try {
            html = await fetchTextWithRetry(ctx, url, {
              headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT },
              redirect: 'error',
            // isRetryableError() treats a status-less rejection as retryable, and
            // verify-portals.mjs's budget sentinel is status-less: retrying it
            // would burn the probe's remaining budget re-raising the same stop
            // signal. The probe wants one page, so it gets one request.
            }, probing ? { retries: 0 } : {});
            answered = true;
          } catch (err) {
            // While probing, propagate unwrapped so verify-portals.mjs's
            // error-identity checks still work.
            if (probing) throw err;
            // Otherwise recall-first: one bad keyword/location/page must not kill
            // the whole board, but record it for the outage guard below.
            if (page === 1) errors.push(`"${query}"${location ? `/${location}` : ''}: ${(err && err.message) || err}`);
            break;
          }

          const cards = parseCards(html);
          if (!cards.length) {
            // A first page that parses to nothing is only "no matches" when the
            // board says so. Anything else — a challenge interstitial, an error
            // page, a markup change — is a scraper break, and must not count as
            // a page the board answered, or it would slip past the outage guard
            // below on a 200 the way OCC's used to slip past on a 403.
            if (page === 1 && !isEmptyResultPage(html)) {
              answered = false;
              errors.push(`"${query}"${location ? `/${location}` : ''}: page 1 parsed to zero cards and is not the board's empty-result page (challenge or markup change) — ${url}`);
            }
            break;
          }

          // Stop on the first page that yields no new ids: an out-of-range page
          // serves the empty-result page, and a board that re-serves page 1 must
          // not be re-added max_pages times.
          let fresh = 0;
          for (const c of cards) {
            if (seen.has(c.id)) continue;
            seen.add(c.id);
            fresh++;
            jobs.push({
              title: c.title,
              url: c.url,
              // Never substitute the board's own name for a missing employer:
              // source-policy rule 1.
              company: c.company || '?',
              location: c.location,
              ...(c.postedAt !== undefined ? { postedAt: c.postedAt } : {}),
            });
          }
          if (fresh === 0) break;
        }
        if (answered) succeeded++;
      }
    }

    // Total outage: every query/location pair's first request failed. Returning
    // [] here would read downstream as a live board that simply has no matching
    // jobs.
    if (succeeded === 0 && errors.length) {
      throw new Error(`computrabajo: all ${errors.length} search request(s) failed — ${errors[0]}`);
    }

    return jobs;
  },
};
