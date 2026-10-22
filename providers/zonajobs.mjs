// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// ZonaJobs / Bumeran Argentina provider — Navent's Argentine job board.
//
// Why this exists: ZonaJobs and Bumeran are the other volume boards for the
// Argentine domestic market, alongside Computrabajo (providers/computrabajo.mjs).
// The employers posting there are the same population that never appears on
// Greenhouse/Lever/Ashby/Workday, so a reverse-ATS sweep cannot reach them.
//
// THERE IS NO BROWSER HERE, despite the site being a client-rendered SPA. The
// React app talks to a plain JSON endpoint, so a bare HTTPS request works once
// the two things the app always sends are present:
//
//   POST https://www.zonajobs.com.ar/api/avisos/searchV2?pageSize=50&page=0&sort=RECIENTES
//   content-type: application/json
//   x-site-id: ZJAR                       <- without it: 400 "No se incluyo el header x-site-id"
//   body: {"filtros":[],"query":"devops","internacional":false}
//
// (A GET on the same path answers 404 — the route only exists for POST. Both
// quirks were confirmed live, 2026-10-21.)
//
// PAGINATION AND SORT ARE QUERY PARAMETERS; the query text and the facet
// filters are in the BODY. That split is the app's own (`GetAvisosV2` builds
// `params = {pageSize, page, sort}` and `body = {filtros, query, internacional}`),
// and putting `page` in the body silently returns page 0 forever — the mistake
// this comment exists to prevent.
//
// ZONAJOBS AND BUMERAN SERVE THE SAME INVENTORY. Measured live 2026-10-21 on the
// technology area: 433 postings on both hosts, an identical title+company set,
// but each portal mints its own posting id (ZonaJobs `2192308` vs Bumeran
// `1118489954` for the same role). Because the ids differ, the URLs differ, so
// URL dedup cannot merge them — enabling both entries would deliver every
// posting twice. Enable ONE. This provider reads whichever host the entry points
// at (`siteFor()`), so switching is a one-line change.
//
// …and ONE is enough for full coverage, because the pool is already MERGED: a
// search against either host returns both portals' postings, each tagged with its
// own `portal` field (`"zonajobs"` or `"bumeran"`). Posting URLs are therefore
// built on the item's own portal, not on the host we searched — see
// `PORTAL_ORIGINS` / `postingUrl()`. Building them all on the searched host
// silently produced 404s for the other portal's share.
//
// robots.txt (both hosts, 2026-10-21): the disallowed shapes are filter URLs
// carrying `?recientes=true`, `?relevantes=true`, `?localidades=`, the
// `/empleos.html/{100,111}` sort prefixes, and `/empleos-busquedaext-`. This
// provider builds none of them: it posts to `/api/avisos/searchV2` with
// `sort=RECIENTES` (a POST body/query on the API route, not the `=true` page
// filter the rule targets) and links only the `/empleos/{slug}-{id}.html`
// posting pages. Requests are paced and bounded by max_pages.
//
// Wire in via a `job_boards:` entry:
//   - name: Bumeran / ZonaJobs (Argentina)
//     provider: zonajobs
//     careers_url: https://www.zonajobs.com.ar/    # or www.bumeran.com.ar
//     area: tecnologia-sistemas-y-telecomunicaciones   # full-category sweep
//     max_pages: 10
//   # …or, instead of a whole area:
//     queries: ["devops", "site reliability"]

import { BROWSER_LIKE_USER_AGENT, sleep } from './_http.mjs';

const PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 5;
const HARD_PAGE_CAP = 20;
const INTER_REQUEST_DELAY_MS = 1000;

/** The two front doors to one inventory. See the header note. */
const SITES = {
  'www.zonajobs.com.ar': { origin: 'https://www.zonajobs.com.ar', siteId: 'ZJAR', name: 'ZonaJobs' },
  'www.bumeran.com.ar': { origin: 'https://www.bumeran.com.ar', siteId: 'BMAR', name: 'Bumeran' },
};

/** The boards are Argentine editions: the country is a property of the source. */
const COUNTRY = 'Argentina';

/**
 * Which site an entry points at. Null when the URL is not one of the two hosts,
 * so `detect()` never claims a foreign Navent edition (bumeran.com.pe,
 * zonajobs.com.mx …) that this provider was not written against.
 *
 * @param {object} entry
 */
export function siteFor(entry) {
  const raw = entry?.careers_url || entry?.api || '';
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  return SITES[u.hostname] ?? null;
}

/**
 * Search URL for one page. `page` is 0-based on the wire (page 1 is `page=0`).
 *
 * @param {string} origin
 * @param {number} page 1-based, as the caller counts pages
 */
export function buildSearchUrl(origin, page) {
  const qs = new URLSearchParams({
    pageSize: String(PAGE_SIZE),
    page: String(Math.max(0, page - 1)),
    // Newest first: with a bounded page budget, recency is what makes the budget
    // worth spending. The board's other value is RELEVANTES.
    sort: 'RECIENTES',
  });
  return `${origin}/api/avisos/searchV2?${qs.toString()}`;
}

/**
 * Request body for one search. `query` is the free-text term; `filters` are the
 * board's own facets (`[{id:'area', value:'tecnologia-…'}]`).
 *
 * @param {string} query
 * @param {Array<{id:string, value:string}>} [filters]
 */
export function buildSearchBody(query, filters = []) {
  return { filtros: filters, query: String(query ?? ''), internacional: false };
}

/**
 * "21-10-2026" → epoch ms at 12:00 UTC (midday keeps the date stable across
 * timezones, and scan-history stores a plain YYYY-MM-DD).
 *
 * Returns undefined rather than guessing when the shape is anything else: an
 * absent date is "unknown", never "stale".
 *
 * @param {unknown} raw
 * @returns {number|undefined}
 */
export function parseListingDate(raw) {
  const m = String(raw ?? '').trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return undefined;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return undefined;
  const ms = Date.UTC(year, month - 1, day, 12, 0, 0);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Compose the location string so `location_filter.allow` can match it.
 *
 * The board reports "Capital Federal, Buenos Aires" — a city and province, never
 * a country — or null for a fully remote posting. As with Computrabajo, the
 * country comes from the edition, not from an inference about the posting.
 *
 * @param {unknown} city
 * @param {unknown} modality
 */
export function composeLocation(city, modality) {
  const base = typeof city === 'string' && city.trim() ? city.trim() : '';
  const mod = typeof modality === 'string' ? modality.trim() : '';
  let loc = base;
  if (!loc) loc = COUNTRY;
  else if (!/argentina/i.test(loc)) loc = `${loc}, ${COUNTRY}`;
  // Only a remote modality is appended: "Presencial"/"Híbrido" add nothing a
  // filter would want, and "Remoto" is the token an allow-list looks for.
  if (mod && /remoto/i.test(mod) && !/remoto/i.test(loc)) loc += ` · ${mod}`;
  return loc;
}

/**
 * Where each portal's postings actually live. A search against EITHER host
 * returns the MERGED Navent pool, and every item carries its own `portal` field
 * (measured 2026-10-21 on the technology area: a ZonaJobs search answers 431
 * items — 152 `portal: "zonajobs"` with 7-digit ids and 279 `portal: "bumeran"`
 * with 10-digit ids). Building every URL on the host we searched therefore
 * produces 404s for the other portal's share: `zonajobs.com.ar/empleos/1118490931`
 * redirects to `/404`, while `bumeran.com.ar/empleos/1118490931` resolves.
 */
const PORTAL_ORIGINS = {
  zonajobs: 'https://www.zonajobs.com.ar',
  bumeran: 'https://www.bumeran.com.ar',
};

// Legacy ZonaJobs identifiers (10-digit IDs) are served from Bumeran's merged
// Navent inventory even when an old scan row labels the source zonajobs-api.
// Current ZonaJobs-native IDs are 7 digits. Keep the ID-only permalink stable,
// but choose the matching host from the observed ID shape when portal metadata
// is absent/stale.

/**
 * A stable posting URL, on the posting's OWN portal. The board's own links carry
 * a human slug (`/empleos/analista-funcional->-industria-farmaceutica-2192219.html`)
 * that the client rewrites from the title; the id-only form resolves to the same
 * page and does not change when an employer edits the title, so it is the better
 * dedup key.
 *
 * `portal` is the item's own `portal` field; an unknown/absent value falls back
 * to the host we searched, which is correct for the majority portal and keeps a
 * future portal name from producing a broken URL.
 *
 * @param {unknown} portal  the item's `portal` field
 * @param {unknown} id
 * @param {string} fallbackOrigin  the host this search was sent to
 */
export function postingUrl(portal, id, fallbackOrigin) {
  const key = typeof portal === 'string' ? portal.trim().toLowerCase() : '';
  const value = String(id).trim();
  const origin = PORTAL_ORIGINS[key] ?? (/^\d{10}$/.test(value) ? PORTAL_ORIGINS.bumeran : fallbackOrigin);
  return `${origin}/empleos/${value}.html`;
}

/**
 * Map one API payload's `content[]` to posting records.
 *
 * @param {{content?: Array<object>}} payload
 * @param {string} origin
 * @returns {Array<{id:string,title:string,url:string,company:string,location:string,postedAt?:number}>}
 */
export function parseResults(payload, origin) {
  const items = Array.isArray(payload?.content) ? payload.content : [];
  const out = [];
  for (const item of items) {
    const id = item?.id;
    const title = typeof item?.titulo === 'string' ? item.titulo.trim() : '';
    if (id === undefined || id === null || !String(id).trim()) continue;
    if (!title) continue;

    // "Confidencial" is the board's own placeholder for a hidden employer, not a
    // company name; the locale-invariant '?' marker is the tracker convention
    // (#1596) and never substitutes the board's name (source-policy rule 1).
    const companyRaw = typeof item?.empresa === 'string' ? item.empresa.trim() : '';
    const company = item?.confidencial === true || /^confidencial$/i.test(companyRaw) || !companyRaw
      ? '?'
      : companyRaw;

    /** @type {{id:string,title:string,url:string,company:string,location:string,postedAt?:number}} */
    const card = {
      id: String(id),
      title,
      url: postingUrl(item?.portal, id, origin),
      company,
      location: composeLocation(item?.localizacion, item?.modalidadTrabajo),
    };
    const postedAt = parseListingDate(item?.fechaPublicacion);
    if (postedAt !== undefined) card.postedAt = postedAt;
    out.push(card);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'zonajobs',

  // Host-based: an entry pointing at either Argentine edition is one this
  // provider can read. A foreign Navent edition is declined, not guessed at.
  detect(entry) {
    const site = siteFor(entry);
    return site ? { url: site.origin } : null;
  },

  async fetch(entry, ctx) {
    const site = siteFor(entry);
    if (!site) {
      throw new Error(
        `zonajobs: entry "${entry?.name || 'ZonaJobs'}" needs careers_url pointing at `
        + 'https://www.zonajobs.com.ar/ or https://www.bumeran.com.ar/',
      );
    }

    const queries = Array.isArray(entry.queries)
      ? entry.queries.map((q) => String(q).trim()).filter(Boolean)
      : [];
    const area = typeof entry.area === 'string' && entry.area.trim() ? entry.area.trim() : '';
    // No built-in search profile. A default here would be one user's targeting
    // silently applied to every install (same rule as computrabajo/occ/wttj).
    if (!queries.length && !area) {
      throw new Error(
        `zonajobs: entry "${entry.name || site.name}" needs either a non-empty queries: [...] list `
        + 'or an area: "<board area slug>" to sweep (e.g. area: tecnologia-sistemas-y-telecomunicaciones).',
      );
    }

    // verify-portals.mjs's health probe sets ctx.maxPages (1): one page is enough
    // to tell a live board from a broken one, and it must not walk the board.
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const entryMaxPages = Math.min(
      Number.isInteger(entry.max_pages) && entry.max_pages > 0 ? entry.max_pages : DEFAULT_MAX_PAGES,
      HARD_PAGE_CAP,
    );
    const maxPages = probing ? Math.min(entryMaxPages, ctx.maxPages) : entryMaxPages;

    // One request plan per search: a full-category sweep, or one per keyword.
    /** @type {Array<{label:string, query:string, filters:Array<{id:string,value:string}>}>} */
    const searches = [];
    if (area) searches.push({ label: `area:${area}`, query: '', filters: [{ id: 'area', value: area }] });
    for (const q of queries) searches.push({ label: `"${q}"`, query: q, filters: [] });

    const seen = new Set();
    const jobs = [];
    const errors = [];
    let succeeded = 0;

    for (const search of searches) {
      for (let page = 1; page <= maxPages; page++) {
        await sleep(INTER_REQUEST_DELAY_MS, ctx);

        let payload;
        try {
          // While probing, propagate unwrapped so verify-portals.mjs's error
          // identity checks (ProbePageBudgetReached) still work.
          payload = await ctx.fetchJson(buildSearchUrl(site.origin, page), {
            method: 'POST',
            headers: {
              'User-Agent': BROWSER_LIKE_USER_AGENT,
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'x-site-id': site.siteId,
              Origin: site.origin,
              Referer: `${site.origin}/`,
            },
            body: JSON.stringify(buildSearchBody(search.query, search.filters)),
          });
        } catch (err) {
          if (probing) throw err;
          // Recall-first: one bad keyword/page must not kill the whole board,
          // but a first page that fails is recorded for the outage guard below.
          if (page === 1) errors.push(`${search.label}: ${(err && err.message) || err}`);
          break;
        }

        const cards = parseResults(payload, site.origin);
        if (page === 1) succeeded++;

        if (!cards.length) break;

        let fresh = 0;
        for (const card of cards) {
          if (seen.has(card.id)) continue;
          seen.add(card.id);
          fresh++;
          jobs.push({
            title: card.title,
            url: card.url,
            company: card.company,
            location: card.location,
            ...(card.postedAt !== undefined ? { postedAt: card.postedAt } : {}),
          });
        }

        // Stop on a short page, on a repeated one, or once the board's own total
        // says there is nothing left. `total` is the only signal that survives
        // the board re-serving page 1 for an out-of-range page.
        const total = Number(payload?.total);
        if (fresh === 0) break;
        if (cards.length < PAGE_SIZE) break;
        if (Number.isFinite(total) && page * PAGE_SIZE >= total) break;
      }
    }

    // Total outage: not one search answered. Returning [] would read downstream
    // as a live board with no matching jobs.
    if (succeeded === 0 && errors.length) {
      throw new Error(`zonajobs: all ${errors.length} search request(s) failed — ${errors[0]}`);
    }

    return jobs;
  },
};
