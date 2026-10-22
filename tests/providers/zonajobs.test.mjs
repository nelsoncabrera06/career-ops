// tests/providers/zonajobs.test.mjs — ZonaJobs / Bumeran Argentina (Navent).
// Offline only: every assertion runs against a fixture of the real
// searchV2 payload shape (captured live 2026-10-21), so CI never depends on the
// board being reachable.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — zonajobs');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/zonajobs.mjs')).href);
  const zonajobs = mod.default;
  const { siteFor, buildSearchUrl, buildSearchBody, parseListingDate, composeLocation, postingUrl, parseResults } = mod;

  if (zonajobs.id === 'zonajobs') pass('zonajobs.id is "zonajobs"');
  else fail(`zonajobs.id is ${JSON.stringify(zonajobs.id)}`);

  if (typeof zonajobs.fetch === 'function') pass('zonajobs.fetch is a function');
  else fail('zonajobs.fetch is not a function');

  // ── site resolution ──────────────────────────────────────────────────────
  const zj = siteFor({ careers_url: 'https://www.zonajobs.com.ar/' });
  if (zj && zj.siteId === 'ZJAR' && zj.origin === 'https://www.zonajobs.com.ar') {
    pass('siteFor() resolves ZonaJobs to site id ZJAR');
  } else {
    fail(`siteFor(zonajobs) = ${JSON.stringify(zj)}`);
  }

  const bm = siteFor({ careers_url: 'https://www.bumeran.com.ar/empleos-area-tecnologia-sistemas-y-telecomunicaciones.html' });
  if (bm && bm.siteId === 'BMAR') pass('siteFor() resolves Bumeran to site id BMAR');
  else fail(`siteFor(bumeran) = ${JSON.stringify(bm)}`);

  // A foreign Navent edition is a different board this provider was not written
  // against — declining it keeps `detect()` from claiming it.
  for (const bogus of [
    { careers_url: 'https://www.bumeran.com.pe/' },
    { careers_url: 'https://www.zonajobs.com.mx/' },
    { careers_url: 'http://www.zonajobs.com.ar/' },
    { careers_url: 'https://www.zonajobs.com.ar.evil.example/' },
    { careers_url: 'not a url' },
    {},
  ]) {
    if (siteFor(bogus) === null && zonajobs.detect?.(bogus) === null) {
      pass(`detect() declines ${JSON.stringify(bogus.careers_url ?? null)}`);
    } else {
      fail(`detect() wrongly claimed ${JSON.stringify(bogus.careers_url ?? null)}`);
    }
  }

  // ── URL + body shape ─────────────────────────────────────────────────────
  // The bug the comment in the provider header is about: pagination in the BODY
  // returns page 0 forever, so it must live in the query string, 0-based.
  const p1 = new URL(buildSearchUrl('https://www.zonajobs.com.ar', 1));
  const p2 = new URL(buildSearchUrl('https://www.zonajobs.com.ar', 2));
  if (p1.pathname === '/api/avisos/searchV2' && p1.searchParams.get('page') === '0') {
    pass('buildSearchUrl() puts page 1 on the wire as page=0');
  } else {
    fail(`page 1 URL = ${p1.href}`);
  }
  if (p2.searchParams.get('page') === '1' && p2.searchParams.get('sort') === 'RECIENTES' && p2.searchParams.get('pageSize') === '50') {
    pass('buildSearchUrl() paginates in the query string, newest first, 50 per page');
  } else {
    fail(`page 2 URL = ${p2.href}`);
  }

  const body = buildSearchBody('devops', [{ id: 'area', value: 'tech' }]);
  if (body.query === 'devops' && body.internacional === false && body.filtros.length === 1) {
    pass('buildSearchBody() carries the query and the facet filters');
  } else {
    fail(`buildSearchBody() = ${JSON.stringify(body)}`);
  }

  // ── dates ────────────────────────────────────────────────────────────────
  if (parseListingDate('21-10-2026') === Date.UTC(2026, 9, 21, 12)) {
    pass('parseListingDate() reads DD-MM-YYYY at 12:00 UTC');
  } else {
    fail(`parseListingDate("21-10-2026") = ${parseListingDate('21-10-2026')}`);
  }
  for (const bad of ['2026-10-21', '31-13-2026', '', null, undefined, 'ayer']) {
    if (parseListingDate(bad) === undefined) pass(`parseListingDate() leaves ${JSON.stringify(bad)} unknown`);
    else fail(`parseListingDate(${JSON.stringify(bad)}) invented a date`);
  }

  // ── location composition ─────────────────────────────────────────────────
  if (composeLocation('Capital Federal, Buenos Aires', 'Presencial') === 'Capital Federal, Buenos Aires, Argentina') {
    pass('composeLocation() appends the edition country and ignores "Presencial"');
  } else {
    fail(`composeLocation(city) = ${JSON.stringify(composeLocation('Capital Federal, Buenos Aires', 'Presencial'))}`);
  }
  if (composeLocation(null, 'Remoto') === 'Argentina · Remoto') {
    pass('composeLocation() gives a fully remote posting a country');
  } else {
    fail(`composeLocation(null, Remoto) = ${JSON.stringify(composeLocation(null, 'Remoto'))}`);
  }
  if (composeLocation('Remoto, Argentina', 'Remoto') === 'Remoto, Argentina') {
    pass('composeLocation() never doubles the country or the remote chip');
  } else {
    fail(`composeLocation(doubling) = ${JSON.stringify(composeLocation('Remoto, Argentina', 'Remoto'))}`);
  }

  if (postingUrl('https://www.zonajobs.com.ar', 2192308) === 'https://www.zonajobs.com.ar/empleos/2192308.html') {
    pass('postingUrl() builds the id-only canonical form');
  } else {
    fail(`postingUrl() = ${postingUrl('https://www.zonajobs.com.ar', 2192308)}`);
  }

  // ── payload mapping ──────────────────────────────────────────────────────
  const PAYLOAD = {
    number: 0,
    size: 50,
    total: 5,
    content: [
      {
        id: 2192308,
        titulo: 'DevOps Engineer Senior',
        empresa: 'Netkel Consulting',
        confidencial: false,
        localizacion: 'Capital Federal, Buenos Aires',
        modalidadTrabajo: 'Híbrido',
        fechaPublicacion: '21-10-2026',
      },
      {
        id: 2192191,
        titulo: 'DevOps Engineer - Azzure',
        empresa: 'Kinetic Talent',
        confidencial: false,
        localizacion: null,
        modalidadTrabajo: 'Remoto',
        fechaPublicacion: '19-10-2026',
      },
      {
        id: 2192400,
        titulo: 'SRE',
        empresa: 'Confidencial',
        confidencial: true,
        localizacion: 'Córdoba',
        fechaPublicacion: 'ayer',
      },
      { id: null, titulo: 'Sin id' },
      { id: 2192500, titulo: '   ' },
      { id: 2192600, titulo: 'Sin empresa' },
    ],
  };

  const cards = parseResults(PAYLOAD, 'https://www.zonajobs.com.ar');
  if (cards.length === 4) pass('parseResults() drops items with no id or an empty title');
  else fail(`parseResults() returned ${cards.length} cards, expected 4`);

  const [a, b, c, d] = cards;

  if (a?.title === 'DevOps Engineer Senior' && a?.company === 'Netkel Consulting') {
    pass('parseResults() maps title and company');
  } else {
    fail(`first card = ${JSON.stringify(a)}`);
  }

  if (a?.url === 'https://www.zonajobs.com.ar/empleos/2192308.html' && a?.id === '2192308') {
    pass('parseResults() emits the stable id-only URL');
  } else {
    fail(`first card url = ${JSON.stringify(a?.url)}`);
  }

  if (a?.postedAt === Date.UTC(2026, 9, 21, 12)) pass('parseResults() parses the listing date');
  else fail(`first card postedAt = ${JSON.stringify(a?.postedAt)}`);

  if (b?.location === 'Argentina · Remoto') pass('parseResults() composes a location for a city-less remote posting');
  else fail(`remote location = ${JSON.stringify(b?.location)}`);

  // A hidden employer is "?", never the board's own name and never the Spanish
  // placeholder (source-policy rule 1, #1596).
  if (c?.company === '?' && c?.postedAt === undefined) {
    pass('parseResults() normalizes a confidential employer to "?" and leaves an unparseable date unknown');
  } else {
    fail(`confidential card = ${JSON.stringify(c)}`);
  }

  if (d?.company === '?' && d?.location === 'Argentina') {
    pass('parseResults() emits "?" when the employer field is missing');
  } else {
    fail(`missing-company card = ${JSON.stringify(d)}`);
  }

  if (parseResults({}, 'https://www.zonajobs.com.ar').length === 0 && parseResults(null, 'x').length === 0) {
    pass('parseResults() returns [] for a payload with no content');
  } else {
    fail('parseResults() did not return [] for an empty payload');
  }

  // ── fetch() end-to-end against a stub ctx (no network) ───────────────────
  const makeItems = (from, count) => Array.from({ length: count }, (_, i) => ({
    id: from + i,
    titulo: `Role ${from + i}`,
    empresa: 'ACME',
    localizacion: 'Capital Federal, Buenos Aires',
    fechaPublicacion: '21-10-2026',
  }));
  const pageOf = (items, total = items.length) => ({ number: 0, size: items.length, total, content: items });

  const urls = [];
  const opts = [];
  const stubCtx = {
    async sleep() {},
    async fetchJson(url, o) {
      urls.push(url);
      opts.push(o);
      const page = Number(new URL(url).searchParams.get('page'));
      return page === 0 ? pageOf(makeItems(1, 50), 53) : pageOf(makeItems(51, 3), 53);
    },
  };

  const jobs = await zonajobs.fetch({ name: 'ZJ', careers_url: 'https://www.zonajobs.com.ar/', area: 'tech', max_pages: 5 }, stubCtx);
  if (jobs.length === 53) pass('fetch() sweeps a whole area and collects every posting');
  else fail(`area sweep returned ${jobs.length} jobs, expected 53`);

  if (urls.length === 2) pass('fetch() stops after the short final page instead of walking to max_pages');
  else fail(`area sweep requested ${urls.length} pages: ${JSON.stringify(urls)}`);

  if (opts.every((o) => o.method === 'POST' && o.headers['x-site-id'] === 'ZJAR' && o.headers['Content-Type'] === 'application/json')) {
    pass('fetch() POSTs with the x-site-id header the endpoint requires');
  } else {
    fail(`fetch() request opts = ${JSON.stringify(opts[0])}`);
  }

  if (opts.every((o) => JSON.parse(o.body).filtros?.[0]?.id === 'area')) {
    pass('fetch() sends the area as a facet filter in the body');
  } else {
    fail(`area body = ${opts[0]?.body}`);
  }

  if (jobs.every((j) => j.title && j.url && typeof j.company === 'string' && typeof j.location === 'string')) {
    pass('fetch() returns the normalized {title, url, company, location} shape');
  } else {
    fail(`fetch() shape = ${JSON.stringify(jobs[0])}`);
  }

  // Bumeran's own site id must be used when the entry points there.
  const bmOpts = [];
  await zonajobs.fetch(
    { name: 'BM', careers_url: 'https://www.bumeran.com.ar/', queries: ['devops'], max_pages: 1 },
    { async sleep() {}, async fetchJson(url, o) { bmOpts.push(o); return pageOf(makeItems(1, 2), 2); } },
  );
  if (bmOpts[0]?.headers['x-site-id'] === 'BMAR') pass('fetch() uses Bumeran\'s site id for a bumeran.com.ar entry');
  else fail(`bumeran site id = ${JSON.stringify(bmOpts[0]?.headers['x-site-id'])}`);

  // Keyword mode: one search per query, deduped by posting id.
  const queryUrls = [];
  const queryCtx = {
    async sleep() {},
    async fetchJson(url, o) {
      queryUrls.push(JSON.parse(o.body).query);
      return pageOf(makeItems(1, 2), 2);
    },
  };
  const deduped = await zonajobs.fetch({ name: 'ZJ', careers_url: 'https://www.zonajobs.com.ar/', queries: ['devops', 'sre'], max_pages: 1 }, queryCtx);
  if (queryUrls.length === 2 && deduped.length === 2) {
    pass('fetch() runs one search per keyword and dedups the overlapping postings');
  } else {
    fail(`keyword mode: ${queryUrls.length} requests, ${deduped.length} jobs`);
  }

  // Outage guard: no search answered at all.
  let outage = null;
  try {
    await zonajobs.fetch(
      { name: 'ZJ', careers_url: 'https://www.zonajobs.com.ar/', queries: ['a', 'b'], max_pages: 1 },
      { async sleep() {}, async fetchJson() { throw new Error('boom'); } },
    );
  } catch (err) { outage = err; }
  if (outage && /all \d+ search request\(s\) failed/.test(outage.message)) {
    pass('fetch() throws on a total outage instead of returning an empty board');
  } else {
    fail(`total outage did not throw: ${outage && outage.message}`);
  }

  // Recall-first: one dead keyword must not take down a board that answered.
  let first = true;
  const partial = await zonajobs.fetch(
    { name: 'ZJ', careers_url: 'https://www.zonajobs.com.ar/', queries: ['dead', 'alive'], max_pages: 1 },
    {
      async sleep() {},
      async fetchJson() {
        if (first) { first = false; throw new Error('boom'); }
        return pageOf(makeItems(7, 1), 1);
      },
    },
  );
  if (Array.isArray(partial) && partial.length === 1) pass('fetch() tolerates one failed keyword when another answers');
  else fail(`partial failure = ${JSON.stringify(partial)}`);

  // A genuinely empty result is a valid answer, not an outage.
  const empty = await zonajobs.fetch(
    { name: 'ZJ', careers_url: 'https://www.zonajobs.com.ar/', queries: ['nada'], max_pages: 3 },
    { async sleep() {}, async fetchJson() { return pageOf([], 0); } },
  );
  if (Array.isArray(empty) && empty.length === 0) pass('fetch() returns [] for a genuinely empty search without throwing');
  else fail(`empty search = ${JSON.stringify(empty)}`);

  // ── config validation ────────────────────────────────────────────────────
  // No built-in search profile: a default would be one user's targeting applied
  // to every install.
  for (const badEntry of [
    { name: 'ZJ', careers_url: 'https://www.zonajobs.com.ar/' },
    { name: 'ZJ', careers_url: 'https://www.zonajobs.com.ar/', queries: [] },
    { name: 'ZJ', careers_url: 'https://www.zonajobs.com.ar/', queries: ['  '] },
  ]) {
    let threw = null;
    try {
      await zonajobs.fetch(badEntry, stubCtx);
    } catch (err) { threw = err; }
    if (threw && /needs either a non-empty queries/.test(threw.message)) {
      pass(`fetch() rejects ${JSON.stringify(badEntry.queries ?? null)} with a clear message`);
    } else {
      fail(`missing queries did not throw: ${threw && threw.message}`);
    }
  }

  let noSite = null;
  try {
    await zonajobs.fetch({ name: 'X', careers_url: 'https://www.bumeran.com.pe/' }, stubCtx);
  } catch (err) { noSite = err; }
  if (noSite && /needs careers_url pointing at/.test(noSite.message)) {
    pass('fetch() refuses to run an entry it cannot resolve to an Argentine edition');
  } else {
    fail(`unresolvable site did not throw: ${noSite && noSite.message}`);
  }

  // ── ctx.maxPages (verify-portals.mjs health probe) ───────────────────────
  const probeUrls = [];
  const probeCtx = {
    async sleep() {},
    async fetchJson(url) {
      probeUrls.push(url);
      // Fresh ids on every page, so only ctx.maxPages can stop the loop.
      return pageOf(makeItems(probeUrls.length * 1000, 50), 9999);
    },
  };
  await zonajobs.fetch(
    { name: 'ZJ', careers_url: 'https://www.zonajobs.com.ar/', area: 'tech', max_pages: 10 },
    { ...probeCtx, maxPages: 1 },
  );
  if (probeUrls.length === 1) pass('fetch() honours ctx.maxPages=1 even when max_pages says 10');
  else fail(`ctx.maxPages=1 issued ${probeUrls.length} requests`);

  class FakeSentinel extends Error {}
  let sentinel = null;
  try {
    await zonajobs.fetch(
      { name: 'ZJ', careers_url: 'https://www.zonajobs.com.ar/', queries: ['a', 'b'], max_pages: 3 },
      { async sleep() {}, maxPages: 1, async fetchJson() { throw new FakeSentinel(); } },
    );
  } catch (err) { sentinel = err; }
  if (sentinel instanceof FakeSentinel) pass('fetch() propagates a probe sentinel unwrapped instead of flattening it to []');
  else fail(`probe sentinel = ${sentinel && sentinel.constructor.name}`);

  // max_pages is bounded so a bad config cannot hammer the site.
  const capped = [];
  await zonajobs.fetch(
    { name: 'ZJ', careers_url: 'https://www.zonajobs.com.ar/', area: 'tech', max_pages: 9999 },
    {
      async sleep() {},
      async fetchJson() {
        capped.push(1);
        return pageOf(makeItems(capped.length * 1000, 50), 99999);
      },
    },
  );
  if (capped.length === 20) pass('fetch() caps max_pages at exactly 20 regardless of config');
  else fail(`fetch() requested ${capped.length} pages with max_pages: 9999, expected exactly 20`);
} catch (err) {
  fail(`zonajobs provider test threw: ${err.message}`);
}
