// tests/providers/empleosit.test.mjs — EmpleosIT (empleosit.com.ar).
// Offline only: every assertion runs against a fixture of the real card markup
// (captured live 2026-10-21), so CI never depends on the board being reachable.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — empleosit');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/empleosit.mjs')).href);
  const empleosit = mod.default;
  const {
    buildSearchUrl, parseTotalCount, isEmptyResultPage,
    parseAbsoluteDate, canonicalPostingUrl, composeLocation, parseCards,
  } = mod;

  if (empleosit.id === 'empleosit') pass('empleosit.id is "empleosit"');
  else fail(`empleosit.id is ${JSON.stringify(empleosit.id)}`);

  if (typeof empleosit.fetch === 'function') pass('empleosit.fetch is a function');
  else fail('empleosit.fetch is not a function');

  // ── URL shape ────────────────────────────────────────────────────────────
  const p1 = buildSearchUrl(1);
  const p2 = buildSearchUrl(2);

  if (p1.startsWith('https://www.empleosit.com.ar/search-results-jobs/?')
    && p1.includes('action=search')
    && p1.includes('listing_type%5Bequal%5D=Job')
    && p1.includes('listings_per_page=100')
    && p1.includes('sorting_field=activation_date')
    && p1.includes('sorting_order=DESC')
    && p1.includes('page=1')) {
    pass('buildSearchUrl() carries the browsable-board parameters (action, listing type, 100/page, date sort)');
  } else {
    fail(`page 1 URL = ${p1}`);
  }

  // The board's <select> is named `listings_per_page2`, which the site ignores;
  // the wire name its own submitForm() builds is `listings_per_page`.
  if (!p1.includes('listings_per_page2=')) pass('buildSearchUrl() sends the real per-page parameter, not the select\'s name');
  else fail(`buildSearchUrl() sent the select name: ${p1}`);

  if (new URL(p2).searchParams.get('page') === '2') pass('buildSearchUrl() paginates with page=N');
  else fail(`page 2 = ${p2}`);

  if (p1.includes('keywords') === false) {
    pass('buildSearchUrl() sends no keyword — the board is swept whole (no invented default query)');
  } else {
    fail(`buildSearchUrl() sent a keyword: ${p1}`);
  }

  // ── detect() ─────────────────────────────────────────────────────────────
  for (const raw of ['https://www.empleosit.com.ar/', 'https://empleosit.com.ar/ofertas']) {
    const hit = empleosit.detect({ name: 'x', careers_url: raw });
    if (hit && hit.url === 'https://www.empleosit.com.ar/') pass(`detect() claims ${raw}`);
    else fail(`detect() did not claim ${raw}: ${JSON.stringify(hit)}`);
  }
  for (const bogus of [
    { careers_url: 'https://www.empleosit.com.ar.evil.example/' },
    { careers_url: 'https://example.com/' },
    { careers_url: 'http://www.empleosit.com.ar/' },
    { careers_url: 'not a url' },
    {},
  ]) {
    if (empleosit.detect(bogus) === null) pass(`detect() declines ${JSON.stringify(bogus.careers_url ?? null)}`);
    else fail(`detect() wrongly claimed ${JSON.stringify(bogus.careers_url ?? null)}`);
  }

  // ── result total ─────────────────────────────────────────────────────────
  if (parseTotalCount('<h1>Encontramos <span> 548 </span> trabajos disponibles para vos</h1>') === 548) {
    pass('parseTotalCount() reads the board\'s own total');
  } else {
    fail(`parseTotalCount() = ${parseTotalCount('<h1>Encontramos <span> 548 </span> trabajos disponibles para vos</h1>')}`);
  }

  if (parseTotalCount('Encontramos <span> 1 </span> trabajo disponible para vos') === 1) {
    pass('parseTotalCount() handles the singular "trabajo"');
  } else {
    fail('parseTotalCount() failed on the singular form');
  }

  if (parseTotalCount('Encontramos <span> 1.234 </span> trabajos') === 1234) {
    pass('parseTotalCount() tolerates thousands separators');
  } else {
    fail(`thousands separator = ${parseTotalCount('Encontramos <span> 1.234 </span> trabajos')}`);
  }

  for (const raw of ['<html><title>Just a moment...</title></html>', '']) {
    if (parseTotalCount(raw) === null) pass(`parseTotalCount() returns null for ${JSON.stringify(raw.slice(0, 20))}`);
    else fail(`parseTotalCount() invented a total for ${JSON.stringify(raw.slice(0, 20))}`);
  }

  // ── absolute dates ───────────────────────────────────────────────────────
  const OCT13 = Date.UTC(2026, 9, 13, 12, 0, 0);
  if (parseAbsoluteDate('13/10/2026') === OCT13) pass('parseAbsoluteDate() resolves DD/MM/YYYY at 12:00 UTC');
  else fail(`13/10/2026 = ${parseAbsoluteDate('13/10/2026')} (expected ${OCT13})`);

  if (parseAbsoluteDate('5/9/2025') === Date.UTC(2025, 8, 5, 12, 0, 0)) {
    pass('parseAbsoluteDate() accepts single-digit day and month');
  } else {
    fail(`5/9/2025 = ${parseAbsoluteDate('5/9/2025')}`);
  }

  // An impossible date must not roll over into the next month.
  for (const raw of ['31/02/2026', '32/01/2026', '13/13/2026', 'Hoy', '2026-10-13', '', '13/10/26']) {
    if (parseAbsoluteDate(raw) === undefined) pass(`parseAbsoluteDate() rejects ${JSON.stringify(raw)}`);
    else fail(`parseAbsoluteDate(${JSON.stringify(raw)}) invented ${new Date(parseAbsoluteDate(raw)).toISOString()}`);
  }

  // ── posting URL canonicalization ─────────────────────────────────────────
  if (canonicalPostingUrl('https://www.empleosit.com.ar/display-job/130621/DevOps-Senior.html?searchId=1792607048.7697&amp;page=1')
    === 'https://www.empleosit.com.ar/display-job/130621/DevOps-Senior.html') {
    pass('canonicalPostingUrl() drops the per-session searchId/page query');
  } else {
    fail(`canonicalPostingUrl() = ${canonicalPostingUrl('https://www.empleosit.com.ar/display-job/130621/DevOps-Senior.html?searchId=1&page=1')}`);
  }

  // Slugs are not tidied: the board really serves "Project-Manager-SSR--SR".
  if (canonicalPostingUrl('/display-job/130958/Project-Manager-SSR--SR.html')
    === 'https://www.empleosit.com.ar/display-job/130958/Project-Manager-SSR--SR.html') {
    pass('canonicalPostingUrl() resolves a relative href and leaves the slug untouched');
  } else {
    fail(`relative href = ${canonicalPostingUrl('/display-job/130958/Project-Manager-SSR--SR.html')}`);
  }

  for (const bad of ['https://evil.example/display-job/1/x.html', 'http://www.empleosit.com.ar/display-job/1/x.html', '']) {
    if (canonicalPostingUrl(bad) === '') pass(`canonicalPostingUrl() rejects ${JSON.stringify(bad)}`);
    else fail(`canonicalPostingUrl(${JSON.stringify(bad)}) = ${canonicalPostingUrl(bad)}`);
  }

  // ── location composition ─────────────────────────────────────────────────
  const locCases = [
    ['Pilar, Buenos Aires', 'Pilar, Buenos Aires, Argentina'],
    ['Ciudad Autónoma de Buenos Aires (CABA), Buenos Aires', 'Ciudad Autónoma de Buenos Aires (CABA), Buenos Aires, Argentina'],
    // The board's remote marker in both halves — reduced, not repeated.
    ['Remoto, Remoto', 'Argentina · Remoto'],
    ['Remoto', 'Argentina · Remoto'],
    ['', 'Argentina'],
    // Never doubled when the board already says it.
    ['Rosario, Argentina', 'Rosario, Argentina'],
  ];
  for (const [raw, expected] of locCases) {
    if (composeLocation(raw) === expected) pass(`composeLocation(${JSON.stringify(raw)}) = ${JSON.stringify(expected)}`);
    else fail(`composeLocation(${JSON.stringify(raw)}) = ${JSON.stringify(composeLocation(raw))}, expected ${JSON.stringify(expected)}`);
  }

  // ── empty-result copy ────────────────────────────────────────────────────
  if (isEmptyResultPage('<div>No se encontraron publicaciones</div>')
    && !isEmptyResultPage('<html><head><title>Just a moment...</title></head><body></body></html>')
    && !isEmptyResultPage('')) {
    pass('isEmptyResultPage() recognizes the board\'s empty-result copy and nothing else');
  } else {
    fail('isEmptyResultPage() misclassified a page');
  }

  // ── card parsing ─────────────────────────────────────────────────────────
  const card = ({ id, title, slug, company, location, date, brief, badge }) => `
    <div class="oddrow"><div><div class="listing-section listingsection">
      <div class="right-side left"><a href="https://www.empleosit.com.ar/company/453/CyS/"><center><img src="/logo.png" alt="CyS" /></center></a></div>
      <div class="listing-right ">
        <div class="listing-title" >
          <a name="listing_${id}"></a>
          <a href="https://www.empleosit.com.ar/display-job/${id}/${slug}.html?searchId=1792607048.7697&amp;page=1">${title}</a>
          ${badge ? `<span class="full-time New-post">${badge}</span>` : ''}
        </div>
        ${brief ? `<div class="show-brief"><strong>Descripción del empleo:</strong>${brief}</div>` : ''}
        <div class="listing-info"><div class="left-side">
          ${location === null ? '' : `<span class="captions-field location-ico">${location}</span>`}
          ${date === null ? '' : `<span class="captions-field posted-ico">${date}</span>`}<br/>
          ${company === null ? '' : `<span class="captions-field company-ico"><a href="https://www.empleosit.com.ar/company/453/CyS/">${company}</a></span>`}
        </div></div>
      </div>
    </div></div></div>`;

  const FIXTURE = `<div class="results-paging"><h1>Encontramos <span> 3 </span> trabajos disponibles para vos</h1></div>
    ${card({
      id: 130621, title: 'DevOps Senior', slug: 'DevOps-Senior',
      company: 'CyS', location: 'Ciudad Autónoma de Buenos Aires (CABA), Buenos Aires', date: '13/10/2026',
      brief: 'DevOps Senior Duraci&oacute;n: 3 meses, con posibilidad de efectivizaci&oacute;n Modalidad: H&iacute;brida &ndash;...',
      badge: 'Nuevo',
    })}
    ${card({
      id: 100093, title: 'SRE SR', slug: 'SRE-SR',
      company: 'Werben HR', location: 'Remoto, Remoto', date: '12/10/2026',
      brief: 'Locations*: Buenos Aires, Argentina, is preferable...', badge: 'Actualizado',
    })}
    ${card({
      id: 128900, title: 'T&eacute;cnico Inform&aacute;tico', slug: 'Tecnico-Informatico',
      company: null, location: null, date: null, brief: '', badge: '',
    })}`;

  const cards = parseCards(FIXTURE);

  if (cards.length === 3) pass('parseCards() reads every card on the page');
  else fail(`parseCards() returned ${cards.length} cards, expected 3 — ${JSON.stringify(cards.map((c) => c.id))}`);

  const [a, b, c] = cards;

  if (a?.id === '130621') pass('parseCards() takes the id from the listing anchor');
  else fail(`id = ${JSON.stringify(a?.id)}`);

  if (a?.title === 'DevOps Senior') {
    pass('parseCards() reads the title from its anchor, not the title div (no "Nuevo"/"Actualizado" badge leaks in)');
  } else {
    fail(`title = ${JSON.stringify(a?.title)}`);
  }

  if (a?.url === 'https://www.empleosit.com.ar/display-job/130621/DevOps-Senior.html') {
    pass('parseCards() emits the canonical posting URL (no searchId)');
  } else {
    fail(`url = ${JSON.stringify(a?.url)}`);
  }

  if (a?.company === 'CyS') pass('parseCards() extracts the company name');
  else fail(`company = ${JSON.stringify(a?.company)}`);

  if (a?.location === 'Ciudad Autónoma de Buenos Aires (CABA), Buenos Aires, Argentina') {
    pass('parseCards() composes "<city>, Argentina" so location_filter.allow can match');
  } else {
    fail(`location = ${JSON.stringify(a?.location)}`);
  }

  if (a?.postedAt === OCT13) pass('parseCards() resolves the absolute posted date');
  else fail(`postedAt = ${JSON.stringify(a?.postedAt)}`);

  if (a?.description === 'DevOps Senior Duración: 3 meses, con posibilidad de efectivización Modalidad: Híbrida –...') {
    pass('parseCards() decodes the free description snippet and strips its label');
  } else {
    fail(`description = ${JSON.stringify(a?.description)}`);
  }

  if (b?.location === 'Argentina · Remoto') pass('parseCards() reduces the board\'s "Remoto, Remoto" to "Argentina · Remoto"');
  else fail(`remote location = ${JSON.stringify(b?.location)}`);

  if (c?.title === 'Técnico Informático') pass('parseCards() decodes HTML entities in the title');
  else fail(`title = ${JSON.stringify(c?.title)}`);

  // source-policy rule 1: never invent an employer.
  if (c?.company === '?') pass('parseCards() emits "?" when the card exposes no company');
  else fail(`unparsed company = ${JSON.stringify(c?.company)}`);

  if (c?.location === 'Argentina') pass('parseCards() falls back to the board\'s country when the card has no location');
  else fail(`missing location = ${JSON.stringify(c?.location)}`);

  if (c?.postedAt === undefined) pass('parseCards() omits postedAt rather than guessing a missing date');
  else fail(`missing date became ${JSON.stringify(c?.postedAt)}`);

  // Cards that cannot be trusted are dropped, never emitted with a wrong key.
  const BROKEN = `
    <div class="listing-section listingsection"><div class="listing-title" ><a href="https://www.empleosit.com.ar/display-job/1/x.html">No id anchor at all</a></div></div>
    <div class="listing-section listingsection"><a name="listing_2"></a><div class="listing-title" ><a href="https://www.empleosit.com.ar/display-job/2/y.html">   </a></div></div>
    <div class="listing-section listingsection"><a name="listing_3"></a><div class="listing-title" ><a href="https://evil.example/phish">Off-host href</a></div></div>`;
  const brokenCards = parseCards(BROKEN);
  if (brokenCards.length === 1 && brokenCards[0].id === '1') {
    pass('parseCards() derives the id from the display-job path when the listing anchor is missing');
  } else {
    fail(`broken cards = ${JSON.stringify(brokenCards)}`);
  }
  if (!brokenCards.some((x) => x.url.includes('evil.example'))) pass('parseCards() never emits a posting URL off the board host');
  else fail('parseCards() emitted an off-host URL');

  if (parseCards('').length === 0 && parseCards('<html></html>').length === 0
    && parseCards('<div class="listing-section listingsection"></div>').length === 0) {
    pass('parseCards() returns [] for empty and card-less HTML');
  } else {
    fail('parseCards() did not return [] for empty input');
  }

  // ── fetch() end-to-end against a stub ctx (no network) ───────────────────
  const pageOf = (url) => Number(new URL(url).searchParams.get('page'));
  const sleepCalls = [];
  const stubCtx = (pages, { failOnPage = null, sleeps = sleepCalls } = {}) => ({
    async sleep(ms) { sleeps.push(ms); },
    async fetchText(url) {
      const n = pageOf(url);
      if (failOnPage !== null && n === failOnPage) throw new Error('boom');
      return pages(n);
    },
  });

  // The board states its total, so a 548-posting sweep costs exactly 6 requests.
  const planned = [];
  const totalCtx = {
    async sleep() {},
    async fetchText(url) {
      const n = pageOf(url);
      planned.push(n);
      return '<div class="results-paging"><h1>Encontramos <span> 548 </span> trabajos disponibles para vos</h1></div>'
        + card({ id: 1000 + n, title: `Job ${n}`, slug: `Job-${n}`, company: 'ACME', location: 'Pilar, Buenos Aires', date: '13/10/2026', brief: '', badge: '' });
    },
  };
  const totalJobs = await empleosit.fetch({ name: 'EmpleosIT' }, totalCtx);
  if (planned.length === 6) pass('fetch() plans exactly ceil(548/100)=6 pages from the board\'s own total');
  else fail(`fetch() requested ${planned.length} pages for a stated total of 548, expected 6`);
  if (totalJobs.length === 6) pass('fetch() returns one job per page of a complete sweep');
  else fail(`fetch() returned ${totalJobs.length} jobs for 6 pages`);

  // A total that fits in one page must stop after it.
  const onePage = [];
  await empleosit.fetch({ name: 'EmpleosIT' }, {
    async sleep() {},
    async fetchText(url) { onePage.push(pageOf(url)); return FIXTURE; },
  });
  if (onePage.length === 1) pass('fetch() stops after the page count the board\'s total implies');
  else fail(`fetch() requested ${onePage.length} pages for a stated total of 3`);

  // Out-of-range pages clamp to the last page: no fresh ids means stop.
  const repeated = [];
  await empleosit.fetch({ name: 'EmpleosIT' }, {
    async sleep() {},
    async fetchText(url) { repeated.push(pageOf(url)); return FIXTURE.replace(/Encontramos <span> 3 <\/span>/g, ''); },
  });
  if (repeated.length === 2) pass('fetch() stops after the first page that yields no new ids');
  else fail(`fetch() requested ${repeated.length} pages when every page repeated the same cards`);

  const deduped = await empleosit.fetch({ name: 'EmpleosIT' }, stubCtx(() => FIXTURE));
  if (deduped.length === 3) pass('fetch() dedups by posting id when the board re-serves the same cards');
  else fail(`fetch() returned ${deduped.length} jobs after dedup, expected 3`);

  if (deduped.every((j) => j.title && j.url && typeof j.company === 'string' && typeof j.location === 'string')) {
    pass('fetch() returns the normalized {title, url, company, location} shape');
  } else {
    fail(`fetch() shape = ${JSON.stringify(deduped)}`);
  }

  // robots.txt asks for 10s between requests; that pacing is part of the contract.
  if (sleepCalls.length > 0 && sleepCalls.every((ms) => ms === 10000)) {
    pass('fetch() honours robots.txt Crawl-delay: 10 between requests');
  } else {
    fail(`fetch() pacing = ${JSON.stringify([...new Set(sleepCalls)])}`);
  }

  // ── outage vs. empty board ───────────────────────────────────────────────
  let outage = null;
  try {
    await empleosit.fetch({ name: 'EmpleosIT' }, { async sleep() {}, async fetchText() { throw new Error('boom'); } });
  } catch (err) { outage = err; }
  if (outage && /empleosit: page 1/.test(outage.message)) {
    pass('fetch() throws on an unreachable page 1 instead of returning an empty board');
  } else {
    fail(`outage did not throw as expected: ${outage && outage.message}`);
  }

  // HTTP 200 + unreadable body is a scraper break, not an empty board.
  const CHALLENGE = '<html><head><title>Just a moment...</title></head><body><div id="cf-chl"></div></body></html>';
  let challenged = null;
  try {
    await empleosit.fetch({ name: 'EmpleosIT' }, { async sleep() {}, async fetchText() { return CHALLENGE; } });
  } catch (err) { challenged = err; }
  if (challenged && /zero cards and is not the board's empty-result page/.test(challenged.message)) {
    pass('fetch() throws when page 1 is a challenge served with HTTP 200');
  } else {
    fail(`challenge HTML did not throw: ${challenged && challenged.message}`);
  }

  const EMPTY = '<html><body><div>No se encontraron publicaciones</div></body></html>';
  const emptyJobs = await empleosit.fetch({ name: 'EmpleosIT' }, { async sleep() {}, async fetchText() { return EMPTY; } });
  if (Array.isArray(emptyJobs) && emptyJobs.length === 0) {
    pass('fetch() returns [] when the board itself says it has no postings');
  } else {
    fail(`empty board = ${JSON.stringify(emptyJobs)}`);
  }

  // Recall-first: a later page failing keeps what was already collected.
  const partial = await empleosit.fetch({ name: 'EmpleosIT' }, stubCtx(
    (n) => card({ id: 2000 + n, title: `Job ${n}`, slug: `Job-${n}`, company: 'ACME', location: 'Pilar, Buenos Aires', date: '13/10/2026', brief: '', badge: '' })
      .replace('Encontramos <span> 3 </span>', 'Encontramos <span> 548 </span>'),
    { failOnPage: 3 },
  ));
  if (Array.isArray(partial) && partial.length === 2) {
    pass('fetch() keeps the pages collected so far when a later page fails');
  } else {
    fail(`partial failure = ${JSON.stringify(partial)}`);
  }

  // ── ctx.maxPages (verify-portals.mjs health probe) ───────────────────────
  const probeRequests = [];
  await empleosit.fetch({ name: 'EmpleosIT', max_pages: 20 }, {
    async sleep() {},
    maxPages: 1,
    async fetchText(url) {
      probeRequests.push(url);
      return FIXTURE;
    },
  });
  if (probeRequests.length === 1) pass('fetch() honours ctx.maxPages=1 even when max_pages says 20');
  else fail(`ctx.maxPages=1 issued ${probeRequests.length} requests`);

  // While probing, a per-request error must propagate UNWRAPPED so
  // verify-portals.mjs's `err instanceof ProbePageBudgetReached` still works.
  class FakeSentinel extends Error {}
  let sentinel = null;
  let sentinelAttempts = 0;
  try {
    await empleosit.fetch({ name: 'EmpleosIT' }, {
      async sleep() {},
      maxPages: 1,
      async fetchText() { sentinelAttempts++; throw new FakeSentinel(); },
    });
  } catch (err) { sentinel = err; }
  if (sentinel instanceof FakeSentinel) {
    pass('fetch() propagates a probe sentinel unwrapped instead of flattening it to []');
  } else {
    fail(`probe sentinel = ${sentinel && sentinel.constructor.name}`);
  }
  if (sentinelAttempts === 1) {
    pass('fetch() does not retry while probing, so the sentinel costs one request');
  } else {
    fail(`probe sentinel took ${sentinelAttempts} requests`);
  }

  // max_pages is bounded so a bad config cannot hammer the site. The total is
  // stripped so only the cap can stop the loop, and every page yields fresh ids.
  const capped = [];
  await empleosit.fetch({ name: 'EmpleosIT', max_pages: 999 }, {
    async sleep() {},
    async fetchText(url) {
      const n = pageOf(url);
      capped.push(n);
      return card({ id: 3000 + n, title: `Job ${n}`, slug: `Job-${n}`, company: 'ACME', location: 'Pilar, Buenos Aires', date: '13/10/2026', brief: '', badge: '' })
        .replace(/Encontramos <span> 3 <\/span>/g, '');
    },
  });
  // Exactly 20, not "<= 20": every page yields a fresh id, so a provider that
  // stopped at the default 10 would also satisfy <= 20 and the cap would be untested.
  if (capped.length === 20) pass('fetch() caps max_pages at exactly 20 regardless of config');
  else fail(`fetch() requested ${capped.length} pages with max_pages: 999, expected exactly 20`);

  // The default cap keeps a whole-board sweep bounded without config.
  const defaultPages = [];
  await empleosit.fetch({ name: 'EmpleosIT' }, {
    async sleep() {},
    async fetchText(url) {
      const n = pageOf(url);
      defaultPages.push(n);
      return card({ id: 4000 + n, title: `Job ${n}`, slug: `Job-${n}`, company: 'ACME', location: 'Pilar, Buenos Aires', date: '13/10/2026', brief: '', badge: '' })
        .replace(/Encontramos <span> 3 <\/span>/g, '');
    },
  });
  if (defaultPages.length === 10) pass('fetch() defaults to 10 pages when the entry sets no max_pages');
  else fail(`fetch() requested ${defaultPages.length} pages by default, expected 10`);
} catch (err) {
  fail(`empleosit provider test threw: ${err.message}`);
}
