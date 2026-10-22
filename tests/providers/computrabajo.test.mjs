// tests/providers/computrabajo.test.mjs — Computrabajo Argentina (ar.computrabajo.com).
// Offline only: every assertion runs against a fixture of the real card markup
// (captured live 2026-10-21), so CI never depends on the board being reachable.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — computrabajo');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/computrabajo.mjs')).href);
  const computrabajo = mod.default;
  const { buildSearchUrl, parseCards, isEmptyResultPage, parseRelativeDate } = mod;

  if (computrabajo.id === 'computrabajo') pass('computrabajo.id is "computrabajo"');
  else fail(`computrabajo.id is ${JSON.stringify(computrabajo.id)}`);

  if (typeof computrabajo.fetch === 'function') pass('computrabajo.fetch is a function');
  else fail('computrabajo.fetch is not a function');

  // ── URL shape ────────────────────────────────────────────────────────────
  if (buildSearchUrl('devops', null, 1) === 'https://ar.computrabajo.com/trabajo-de-devops') {
    pass('buildSearchUrl() page 1 has no pagination parameter');
  } else {
    fail(`page 1 = ${buildSearchUrl('devops', null, 1)}`);
  }

  // Verified live: ?p=2 returns a different set of posting ids than page 1.
  if (buildSearchUrl('devops', null, 2) === 'https://ar.computrabajo.com/trabajo-de-devops?p=2') {
    pass('buildSearchUrl() paginates with ?p=N');
  } else {
    fail(`page 2 = ${buildSearchUrl('devops', null, 2)}`);
  }

  // A location becomes an -en-{slug} suffix on the keyword path.
  if (buildSearchUrl('site reliability', 'Buenos Aires', 1)
    === 'https://ar.computrabajo.com/trabajo-de-site-reliability-en-buenos-aires') {
    pass('buildSearchUrl() slugifies the query and appends the location segment');
  } else {
    fail(`query+location = ${buildSearchUrl('site reliability', 'Buenos Aires', 1)}`);
  }

  // Hostile input must be neutralized by slugify(), not merely sit behind the
  // fixed origin prefix.
  for (const [query, location] of [['../../evil', null], ['devops', 'https://evil.example']]) {
    const u = buildSearchUrl(query, location, 1);
    const pathname = u.startsWith('https://ar.computrabajo.com/') ? u.slice('https://ar.computrabajo.com'.length) : u;
    if (!pathname.includes('..') && !pathname.includes('//') && /^\/trabajo-de-[a-z0-9-]+(-en-[a-z0-9-]+)?$/.test(pathname)) {
      pass(`buildSearchUrl() slugifies ${JSON.stringify(location ?? query)} into [a-z0-9-] path segments`);
    } else {
      fail(`hostile input reached the URL unneutralized: ${u}`);
    }
  }

  // ── detect() ─────────────────────────────────────────────────────────────
  const claimed = computrabajo.detect?.({ name: 'x', careers_url: 'https://ar.computrabajo.com/' });
  if (claimed && claimed.url === 'https://ar.computrabajo.com/') {
    pass('detect() claims the Argentina edition host');
  } else {
    fail(`detect() did not claim ar.computrabajo.com: ${JSON.stringify(claimed)}`);
  }
  for (const bogus of [
    { careers_url: 'https://www.computrabajo.com.mx/' },
    { careers_url: 'http://ar.computrabajo.com/' },
    { careers_url: 'https://ar.computrabajo.com.evil.example/' },
    { careers_url: 'not a url' },
  ]) {
    if (computrabajo.detect(bogus) === null) {
      pass(`detect() declines ${JSON.stringify(bogus.careers_url)}`);
    } else {
      fail(`detect() wrongly claimed ${JSON.stringify(bogus.careers_url)}`);
    }
  }

  // ── Card parsing ─────────────────────────────────────────────────────────
  const NOW = Date.UTC(2026, 9, 21, 12, 0, 0); // 2026-10-21T12:00:00Z

  const FIXTURE = `
    <article class="box_offer sel " data-id='A1A9473716336A5161373E686DCF3405' data-blind="false" id="A1A9473716336A5161373E686DCF3405" data-lc="ListOffers-Score4-0" data-offers-grid-offer-item-container>
        <h2 class="fs18 fwB prB">
            <a class="js-o-link fc_base" href="/ofertas-de-trabajo/oferta-de-trabajo-de-cloud-infrastructure-devops-specialist-remoto-en-recoleta-A1A9473716336A5161373E686DCF3405#lc=ListOffers-Score4-0">
                Ref.: 21540 Cloud Infrastructure / DevOps Specialist
            </a>
            <div class="tags">
                <span class="tag hide" viewed-offer-tag>
                    <span class="icon i_check_circle_full mr5"></span>
                    Vista
                </span>
            </div>
        </h2>
        <p class="dFlex vm_fx fs16 fc_base mt5">
                <span class="fx_none mr10">
                    <span class="fwB">
                        3,6
                    </span>
                    <span class="star"></span>
                </span>
                <span class="icon i_verificada mr5"></span>
                <a class="fc_base t_ellipsis" href="https://ar.computrabajo.com/empresas/ofertas-de-trabajo-de-adn-recursos-humanos-83C9514433EC04CD" target='_blank' offer-grid-article-company-url>
                    ADN - Recursos Humanos
                </a>
        </p>
        <p class="fs16 fc_base mt5">
            <span class="mr10">
                Recoleta, Capital Federal
            </span>
        </p>
            <div class="fs13 mt15">
                    <span class="dIB mr10">
                        <span class="icon i_salary"></span>
                        $ 2.222,00 (Mensual)
                    </span>
                    <span class="dIB mr10">
                        <span class="icon i_home"></span>
                        Remoto
                    </span>
            </div>
        <p class="fs13 fc_aux mt15">
            Ayer
        </p>
    </article>
    <article class="box_offer  " data-id='FB93A4D3FC4C87BB61373E686DCF3405' data-blind="false" id="FB93A4D3FC4C87BB61373E686DCF3405" data-lc="ListOffers-Score4-1">
        <h2 class="fs18 fwB prB">
            <a class="js-o-link fc_base" href="https://ar.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-infrastructure-devops-automation-lead-FB93A4D3FC4C87BB61373E686DCF3405">
                Infrastructure &amp; DevOps Automation Lead
            </a>
        </h2>
        <p class="dFlex vm_fx fs16 fc_base mt5">
            <a class="fc_base t_ellipsis" href="https://ar.computrabajo.com/cys" target='_blank' offer-grid-article-company-url>
                Confidencial
            </a>
        </p>
        <p class="fs16 fc_base mt5">
            <span class="mr10">
                San Nicol&aacute;s, Buenos Aires
            </span>
        </p>
        <p class="fs13 fc_aux mt15">
            Hace  2  d&#xED;as
        </p>
    </article>
    <article class="box_offer" id="jobcard-broken"><h2><a href="/x">Sin data-id</a></h2></article>
    <article class="box_offer" data-id='999'><h2><a href="/y">   </a></h2></article>
    <article class="box_offer" data-id='ABC123'><h2><a href="https://evil.example/phish">Off-host href</a></h2></article>
    <article class="box_offer" data-id='DEF456'><h2><a href="/ofertas-de-trabajo/oferta-de-trabajo-de-sin-empresa-DEF456">Sin empresa</a></h2>
      <p class="fs16 fc_base mt5"><span class="mr10">C&#xF3;rdoba</span></p>
    </article>
  `;
  const cards = parseCards(FIXTURE, NOW);

  if (cards.length === 3) pass('parseCards() drops cards with no data-id, an empty title, or an off-host href');
  else fail(`parseCards() returned ${cards.length} cards, expected 3 — ${JSON.stringify(cards.map((c) => c.id))}`);

  const [a, b, c] = cards;

  if (a?.title === 'Ref.: 21540 Cloud Infrastructure / DevOps Specialist') {
    pass('parseCards() reads the title from the anchor, not the <h2> (no "Vista"/"Postulado" chips leak in)');
  } else {
    fail(`title = ${JSON.stringify(a?.title)}`);
  }

  if (a?.url === 'https://ar.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-cloud-infrastructure-devops-specialist-remoto-en-recoleta-A1A9473716336A5161373E686DCF3405') {
    pass('parseCards() resolves the posting URL and strips the #lc tracking fragment');
  } else {
    fail(`url = ${JSON.stringify(a?.url)}`);
  }

  if (a?.company === 'ADN - Recursos Humanos') pass('parseCards() extracts the company name');
  else fail(`company = ${JSON.stringify(a?.company)}`);

  // The country is the edition's, and the modality chip rides along.
  if (a?.location === 'Recoleta, Capital Federal, Argentina · Remoto') {
    pass('parseCards() composes "<city>, Argentina · Remoto" so location_filter.allow can match');
  } else {
    fail(`location = ${JSON.stringify(a?.location)}`);
  }

  if (a?.postedAt === NOW - 86_400_000) pass('parseCards() resolves "Ayer" to yesterday');
  else fail(`postedAt (Ayer) = ${JSON.stringify(a?.postedAt)}`);

  if (b?.title === 'Infrastructure & DevOps Automation Lead') pass('parseCards() decodes HTML entities in the title');
  else fail(`title = ${JSON.stringify(b?.title)}`);

  // "Confidencial" is the board's placeholder, not an employer name: it must
  // become the locale-invariant '?' marker (#1596).
  if (b?.company === '?') pass('parseCards() normalizes "Confidencial" to the "?" marker');
  else fail(`confidential company = ${JSON.stringify(b?.company)}`);

  if (b?.location === 'San Nicolás, Buenos Aires, Argentina') {
    pass('parseCards() decodes the location and omits the modality suffix when there is no chip');
  } else {
    fail(`location = ${JSON.stringify(b?.location)}`);
  }

  if (b?.postedAt === NOW - 2 * 86_400_000) pass('parseCards() resolves "Hace 2 días" to two days ago');
  else fail(`postedAt (Hace 2 días) = ${JSON.stringify(b?.postedAt)}`);

  if (c?.company === '?') pass('parseCards() emits "?" when no company anchor exists (source-policy rule 1)');
  else fail(`unparsed company = ${JSON.stringify(c?.company)}`);

  // An off-host href is dropped rather than emitted as a dedup key.
  if (!cards.some((x) => x.url.includes('evil.example'))) pass('parseCards() never emits a posting URL off the board host');
  else fail('parseCards() emitted an off-host URL');

  if (parseCards('').length === 0 && parseCards('<html></html>').length === 0 && parseCards('<article class="box_offer"></article>').length === 0) {
    pass('parseCards() returns [] for empty and card-less HTML');
  } else {
    fail('parseCards() did not return [] for empty input');
  }

  // ── Relative dates ───────────────────────────────────────────────────────
  if (parseRelativeDate('Hoy', NOW) === NOW) pass('parseRelativeDate() resolves "Hoy"');
  else fail(`Hoy = ${parseRelativeDate('Hoy', NOW)}`);

  // An absolute date carries no year; guessing one is how a stale posting is
  // presented as fresh, so it must stay unknown.
  for (const raw of ['15 de octubre', '', 'Reciente']) {
    if (parseRelativeDate(raw, NOW) === undefined) pass(`parseRelativeDate() leaves ${JSON.stringify(raw)} unknown`);
    else fail(`parseRelativeDate(${JSON.stringify(raw)}) invented a date`);
  }

  // ── fetch() end-to-end against a stub ctx (no network) ───────────────────
  const pagesRequested = [];
  const optsSeen = [];
  const stubCtx = {
    // No-op clock: the provider paces requests (INTER_REQUEST_DELAY_MS) and
    // backs off on retry. Without this the suite would sleep for real.
    async sleep() {},
    async fetchText(url, opts) {
      pagesRequested.push(url);
      optsSeen.push(opts);
      // Mirror the live quirk: an out-of-range page re-serves the same cards.
      return FIXTURE;
    },
  };
  const jobs = await computrabajo.fetch(
    { name: 'Computrabajo Argentina', queries: ['devops'], locations: ['buenos-aires'], max_pages: 3 },
    stubCtx,
  );

  if (optsSeen.length && optsSeen.every((o) => o?.redirect === 'error')) pass('fetch() passes redirect: "error" on every request');
  else fail(`fetch() request opts = ${JSON.stringify(optsSeen)}`);

  if (jobs.length === 3) pass('fetch() dedups by posting id when the board re-serves the same cards');
  else fail(`fetch() returned ${jobs.length} jobs, expected 3 after dedup`);

  if (pagesRequested.length === 2) pass('fetch() stops after the first page that yields no new ids');
  else fail(`fetch() requested ${pagesRequested.length} pages: ${JSON.stringify(pagesRequested)}`);

  if (jobs.every((j) => j.title && j.url && typeof j.company === 'string' && typeof j.location === 'string')) {
    pass('fetch() returns the normalized {title, url, company, location} shape');
  } else {
    fail(`fetch() shape = ${JSON.stringify(jobs)}`);
  }

  // ── Outage vs. empty board ───────────────────────────────────────────────
  const failingCtx = { async sleep() {}, async fetchText() { throw new Error('boom'); } };
  let outage = null;
  try {
    await computrabajo.fetch({ name: 'Computrabajo', queries: ['a', 'b'], max_pages: 2 }, failingCtx);
  } catch (err) { outage = err; }
  if (outage && /all \d+ search request\(s\) failed/.test(outage.message)) {
    pass('fetch() throws on a total outage instead of returning an empty board');
  } else {
    fail(`total outage did not throw as expected: ${outage && outage.message}`);
  }

  // Recall-first still holds for a PARTIAL failure: one dead keyword must not
  // take down a board that otherwise answered.
  let firstQuery = true;
  const partialCtx = {
    async sleep() {},
    async fetchText(url) {
      if (firstQuery && url.includes('trabajo-de-dead')) throw new Error('boom');
      firstQuery = false;
      return FIXTURE;
    },
  };
  const partial = await computrabajo.fetch({ name: 'Computrabajo', queries: ['dead', 'alive'], max_pages: 1 }, partialCtx);
  if (Array.isArray(partial) && partial.length === 3) {
    pass('fetch() tolerates one failed keyword when another answers');
  } else {
    fail(`partial failure = ${JSON.stringify(partial)}`);
  }

  // ── zero cards: empty search vs. broken scraper ──────────────────────────
  const EMPTY_PAGE = '<html><body><h1>&#xA1;Ups! Parece que no hay ofertas para el empleo que buscas.</h1></body></html>';
  const CHALLENGE_PAGE = '<html><head><title>Just a moment...</title></head><body><div id="cf-chl"></div></body></html>';

  if (isEmptyResultPage(EMPTY_PAGE) && !isEmptyResultPage(CHALLENGE_PAGE) && !isEmptyResultPage('')) {
    pass('isEmptyResultPage() recognizes the board\'s empty-result copy and nothing else');
  } else {
    fail('isEmptyResultPage() misclassified a page');
  }

  // Accent folding: a copy tweak on "búsqueda"/"busqueda" must not break it.
  if (isEmptyResultPage('Ups, no hay ofertas para el empleo que buscas')) {
    pass('isEmptyResultPage() folds accents and tolerates a dropped "¡"');
  } else {
    fail('isEmptyResultPage() is accent-sensitive');
  }

  const emptyCtx = { async sleep() {}, async fetchText() { return EMPTY_PAGE; } };
  const emptyJobs = await computrabajo.fetch({ name: 'Computrabajo', queries: ['nada'], max_pages: 3 }, emptyCtx);
  if (Array.isArray(emptyJobs) && emptyJobs.length === 0) {
    pass('fetch() returns [] for a genuinely empty search without throwing');
  } else {
    fail(`empty search = ${JSON.stringify(emptyJobs)}`);
  }

  // The bug this guards: HTTP 200 + unreadable body must not count as a page
  // the board answered, or a fully challenged board slips past the outage guard.
  const challengeCtx = { async sleep() {}, async fetchText() { return CHALLENGE_PAGE; } };
  let challenged = null;
  try {
    await computrabajo.fetch({ name: 'Computrabajo', queries: ['a', 'b'], max_pages: 2 }, challengeCtx);
  } catch (err) { challenged = err; }
  if (challenged && /all \d+ search request\(s\) failed/.test(challenged.message)) {
    pass('fetch() throws when every page 1 is a challenge served with HTTP 200');
  } else {
    fail(`challenge HTML did not throw: ${challenged && challenged.message}`);
  }

  // One broken keyword alongside a working one still degrades gracefully.
  const mixedCtx = {
    async sleep() {},
    async fetchText(url) { return url.includes('trabajo-de-roto') ? CHALLENGE_PAGE : FIXTURE; },
  };
  const mixed = await computrabajo.fetch({ name: 'Computrabajo', queries: ['roto', 'bueno'], max_pages: 1 }, mixedCtx);
  if (Array.isArray(mixed) && mixed.length === 3) {
    pass('fetch() tolerates one challenged keyword when another parses');
  } else {
    fail(`mixed challenge/ok = ${JSON.stringify(mixed)}`);
  }

  // ── queries is required ──────────────────────────────────────────────────
  for (const badEntry of [{ name: 'Computrabajo' }, { name: 'Computrabajo', queries: [] }, { name: 'Computrabajo', queries: ['  '] }]) {
    let threw = null;
    try {
      await computrabajo.fetch(badEntry, stubCtx);
    } catch (err) { threw = err; }
    if (threw && /requires a non-empty queries/.test(threw.message)) {
      pass(`fetch() rejects ${JSON.stringify(badEntry.queries ?? null)} queries with a clear message`);
    } else {
      fail(`missing queries did not throw: ${threw && threw.message}`);
    }
  }

  // ── ctx.maxPages (verify-portals.mjs health probe) ───────────────────────
  const probeRequests = [];
  const probeCtx = {
    async sleep() {},
    async fetchText(url) {
      probeRequests.push(url);
      // Every page yields fresh ids, so only ctx.maxPages can stop the loop.
      return FIXTURE.replace(/A1A94737[0-9A-F]+/g, `A1A94737${String(probeRequests.length).padStart(24, '0')}`);
    },
  };
  await computrabajo.fetch({ name: 'Computrabajo', queries: ['x'], max_pages: 10 }, { ...probeCtx, maxPages: 1 });
  if (probeRequests.length === 1) {
    pass('fetch() honours ctx.maxPages=1 even when max_pages says 10');
  } else {
    fail(`ctx.maxPages=1 issued ${probeRequests.length} requests`);
  }

  // While probing, a per-request error must propagate UNWRAPPED so
  // verify-portals.mjs's `err instanceof ProbePageBudgetReached` still works.
  class FakeSentinel extends Error {}
  let sentinel = null;
  let sentinelAttempts = 0;
  try {
    await computrabajo.fetch(
      { name: 'Computrabajo', queries: ['a', 'b'], max_pages: 3 },
      { async sleep() {}, maxPages: 1, async fetchText() { sentinelAttempts++; throw new FakeSentinel(); } },
    );
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

  // max_pages is bounded so a bad config cannot hammer the site.
  const manyPages = [];
  const countingCtx = {
    async sleep() {},
    async fetchText(url) { manyPages.push(url); return FIXTURE.replace(/A1A94737[0-9A-F]+/g, `A1A94737${String(manyPages.length).padStart(24, '0')}`); },
  };
  await computrabajo.fetch({ name: 'Computrabajo', queries: ['x'], max_pages: 999 }, countingCtx);
  // Exactly 10, not "<= 10": the fixture yields a fresh id on every page, so a
  // provider that stopped at 1 or at the default 3 would also satisfy <= 10 and
  // the cap would be untested.
  if (manyPages.length === 10) pass('fetch() caps max_pages at exactly 10 regardless of config');
  else fail(`fetch() requested ${manyPages.length} pages with max_pages: 999, expected exactly 10`);

  // ── entry.config surface ─────────────────────────────────────────────────
  // locations is optional: an entry without it scans nationwide (no -en- suffix).
  const nationwide = [];
  await computrabajo.fetch(
    { name: 'Computrabajo', queries: ['devops'], max_pages: 1 },
    { async sleep() {}, async fetchText(url) { nationwide.push(url); return EMPTY_PAGE; } },
  );
  if (nationwide.length === 1 && nationwide[0] === 'https://ar.computrabajo.com/trabajo-de-devops') {
    pass('fetch() scopes nationwide when the entry sets no locations');
  } else {
    fail(`nationwide request = ${JSON.stringify(nationwide)}`);
  }
} catch (err) {
  fail(`computrabajo provider test threw: ${err.message}`);
}
