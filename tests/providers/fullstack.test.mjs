// tests/providers/fullstack.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — fullstack');

/** Build a ctx whose fetchJson answers from a page → payload map and records calls. */
function stubCtx(pages, { reject } = {}) {
  const calls = [];
  const ctx = {
    sleep: async () => {},
    async fetchJson(url, opts) {
      calls.push({ url, opts });
      const page = Number(new URL(url).searchParams.get('page'));
      if (reject && page === reject.page) throw reject.error;
      const payload = pages[page];
      if (payload === undefined) throw new Error(`stub: no page ${page}`);
      return typeof payload === 'function' ? payload() : payload;
    },
  };
  return { ctx, calls };
}

/** A row shaped like the real /api/job-postings/public entry. */
function row(id, title, extra = {}) {
  return {
    id,
    jobId: `req-${id}`,
    jobTitle: title,
    statusName: 'Published',
    isPublished: true,
    isJobPublished: true,
    region: 'Costa Rica',
    regionGroup: 'Latam',
    city: null,
    linkedInWorkplaceType: 'Remote',
    createdAt: '2026-03-20T19:18:06.973',
    ...extra,
  };
}

/** 30 rows — a full page at PAGE_SIZE, so the walk does not stop as short. */
function fullPage(prefix) {
  return Array.from({ length: 30 }, (_, i) => row(`${prefix}-${i}`, `Engineer ${prefix}-${i}`));
}

function page(rows, meta = {}) {
  return { data: rows, meta: { page: 1, take: 30, pageCount: 9, totalCount: 270, ...meta } };
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/fullstack.mjs')).href);
  const provider = mod.default;
  const { normalizeFullstackJob } = mod;

  if (provider.id === 'fullstack') pass('fullstack.id is "fullstack"');
  else fail(`fullstack.id is ${JSON.stringify(provider.id)}`);

  // ── normalizeFullstackJob ──
  const full = normalizeFullstackJob(row('abc-1', '  Senior SRE  '), 'Entry Name');
  if (
    full &&
    full.title === 'Senior SRE' &&
    full.url === 'https://talent.fullstack.com/jobs/abc-1' &&
    full.company === 'Entry Name' &&
    full.location === 'Costa Rica · Latam · Remote' &&
    full.postedAt === Date.parse('2026-03-20T19:18:06.973') &&
    full.externalId === 'abc-1'
  ) {
    pass('normalizeFullstackJob maps title/id → url/company/location/postedAt, using the posting id (not jobId) in the URL');
  } else {
    fail(`normalizeFullstackJob full row = ${JSON.stringify(full)}`);
  }

  // company falls back to "FullStack Labs" when the entry has no usable name.
  const coDefault = normalizeFullstackJob(row('abc-2', 'T'));
  const coBlank = normalizeFullstackJob(row('abc-3', 'T'), '   ');
  if (coDefault?.company === 'FullStack Labs' && coBlank?.company === 'FullStack Labs') {
    pass('normalizeFullstackJob falls back to "FullStack Labs" when entry.name is absent/blank');
  } else {
    fail(`normalizeFullstackJob company fallbacks = ${JSON.stringify({ a: coDefault?.company, b: coBlank?.company })}`);
  }

  // location composition: city, deduped regionGroup, workplace; no stray separators.
  const us = normalizeFullstackJob(row('abc-4', 'T', { city: 'Austin', region: 'USA', regionGroup: 'USA' }));
  const sparse = normalizeFullstackJob(row('abc-5', 'T', { region: null, regionGroup: null, linkedInWorkplaceType: null }));
  if (us?.location === 'Austin · USA · Remote' && sparse?.location === '') {
    pass('normalizeFullstackJob composes location without repeating the region group, and yields "" when fields are absent');
  } else {
    fail(`normalizeFullstackJob locations = ${JSON.stringify({ us: us?.location, sparse: sparse?.location })}`);
  }

  // createdAt: epoch ms number accepted; absent/unparseable → postedAt omitted.
  const epoch = normalizeFullstackJob(row('abc-6', 'T', { createdAt: 1774034286973 }));
  const noDate = normalizeFullstackJob(row('abc-7', 'T', { createdAt: null }));
  const badDate = normalizeFullstackJob(row('abc-8', 'T', { createdAt: 'not-a-date' }));
  if (
    epoch?.postedAt === 1774034286973 &&
    noDate && !('postedAt' in noDate) &&
    badDate && !('postedAt' in badDate)
  ) {
    pass('normalizeFullstackJob accepts epoch-ms createdAt and omits postedAt when absent/unparseable');
  } else {
    fail(`normalizeFullstackJob date handling = ${JSON.stringify({ epoch: epoch?.postedAt, noDate, badDate })}`);
  }

  // drops: empty title, missing id, unpublished/other status, non-object.
  const drops = [
    normalizeFullstackJob(row('abc-9', '   ')),
    normalizeFullstackJob(row('', 'No id')),
    normalizeFullstackJob({ ...row('abc-10', 'Closed'), isPublished: false }),
    normalizeFullstackJob({ ...row('abc-11', 'Draft'), statusName: 'Draft' }),
    normalizeFullstackJob(null),
  ];
  if (drops.every((r) => r === null)) {
    pass('normalizeFullstackJob drops empty title / missing id / unpublished / non-Published status / non-object rows');
  } else {
    fail(`normalizeFullstackJob drops = ${JSON.stringify(drops)}`);
  }

  // ── detect() ──
  const hitRoot = provider.detect({ careers_url: 'https://talent.fullstack.com/' });
  const hitJob = provider.detect({ careers_url: 'https://talent.fullstack.com/jobs/abc-1' });
  const hitApi = provider.detect({ api: 'https://talent.fullstack.com/api' });
  const missHost = provider.detect({ careers_url: 'https://example.com/jobs' });
  const missSplitHost = provider.detect({ careers_url: 'https://fullstack.com.evil.example/jobs' });
  const missInsecure = provider.detect({ careers_url: 'http://talent.fullstack.com/' });
  const missMalformed = provider.detect({ careers_url: 'not a url' });
  const missNull = provider.detect({ careers_url: null });
  const missNone = provider.detect({});
  if (
    hitRoot?.url && hitJob?.url && hitApi?.url &&
    missHost === null && missSplitHost === null && missInsecure === null &&
    missMalformed === null && missNull === null && missNone === null
  ) {
    pass('detect() claims talent.fullstack.com careers_url/api and returns null (never throws) for other hosts, non-HTTPS, malformed and missing input');
  } else {
    fail(`detect() = ${JSON.stringify({ hitRoot, hitJob, hitApi, missHost, missSplitHost, missInsecure, missMalformed, missNull, missNone })}`);
  }

  // ── fetch(): normalization of the real response shape ──
  {
    const { ctx, calls } = stubCtx({ 1: page([row('p1-a', 'A'), row('p1-b', 'B')], { pageCount: 1 }) });
    const jobs = await provider.fetch({ name: 'Entry Name' }, ctx);
    if (jobs.length === 2 && jobs[0].url === 'https://talent.fullstack.com/jobs/p1-a' && jobs[1].title === 'B') {
      pass('fetch() normalizes { data: [...] } rows into Jobs');
    } else {
      fail(`fetch() rows = ${JSON.stringify(jobs)}`);
    }
    if (calls.length === 1 && calls.every((c) => c.opts?.redirect === 'error')) {
      pass('fetch() passes redirect: "error" on the list request');
    } else {
      fail(`fetch() request opts = ${JSON.stringify(calls.map((c) => c.opts))}`);
    }
  }

  // ── fetch(): malformed rows are skipped, the page survives ──
  {
    const { ctx } = stubCtx({ 1: page([row('ok-1', 'Good'), row('bad-2', ''), null, row('ok-3', 'Also good')], { pageCount: 1 }) });
    const jobs = await provider.fetch({ name: 'Entry Name' }, ctx);
    if (jobs.length === 2) pass('fetch() skips malformed rows instead of losing the page');
    else fail(`fetch() malformed-row handling returned ${jobs.length} jobs`);
  }

  // ── empty vs broken envelope ──
  {
    const { ctx } = stubCtx({ 1: page([], { pageCount: 0, totalCount: 0 }) });
    const jobs = await provider.fetch({ name: 'Entry Name' }, ctx);
    if (Array.isArray(jobs) && jobs.length === 0) pass('fetch() returns [] for a present-but-empty data[]');
    else fail(`fetch() empty board = ${JSON.stringify(jobs)}`);
  }
  for (const [label, payload] of [
    ['missing envelope', {}],
    ['wrong container key', { results: [] }],
    ['wrong container type', { data: {} }],
    ['bare array', []],
    ['bare string', 'nope'],
  ]) {
    const { ctx } = stubCtx({ 1: payload });
    let err = null;
    try {
      await provider.fetch({ name: 'Entry Name' }, ctx);
    } catch (e) {
      err = e;
    }
    if (err && /unexpected response/.test(err.message)) pass(`fetch() throws a descriptive error for a ${label}`);
    else fail(`fetch() ${label} → ${err ? err.message : 'resolved without throwing'}`);
  }

  // ── pagination: the provider's own DEFAULT_MAX_PAGES stops the walk ──
  {
    const pages = {};
    for (let p = 1; p <= 60; p++) pages[p] = page(fullPage(`p${p}`), { pageCount: 60, totalCount: 1800 });
    const { ctx, calls } = stubCtx(pages);
    const jobs = await provider.fetch({ name: 'Big Board' }, ctx);
    if (calls.length === 20 && jobs.length === 600) {
      pass('fetch() stops at its own DEFAULT_MAX_PAGES (20) even though the source reports 60 pages');
    } else {
      fail(`fetch() default page bound: ${calls.length} requests, ${jobs.length} jobs`);
    }
  }

  // ── pagination: ctx.maxPages stops it earlier (probe) ──
  {
    const pages = {};
    for (let p = 1; p <= 60; p++) pages[p] = page(fullPage(`p${p}`), { pageCount: 60 });
    const { ctx, calls } = stubCtx(pages);
    const jobs = await provider.fetch({ name: 'Big Board', max_pages: 40 }, { ...ctx, maxPages: 1 });
    if (calls.length === 1 && jobs.length === 30) pass('fetch() honours ctx.maxPages: 1 with exactly one list request (probe)');
    else fail(`fetch() probe cap: ${calls.length} requests, ${jobs.length} jobs`);
  }

  // ── entry max_pages is honoured and hard-capped ──
  {
    const pages = {};
    for (let p = 1; p <= 60; p++) pages[p] = page(fullPage(`p${p}`), { pageCount: 60 });
    const { ctx, calls } = stubCtx(pages);
    await provider.fetch({ name: 'Big Board', max_pages: 3 }, ctx);
    if (calls.length === 3) pass('fetch() honours entry.max_pages');
    else fail(`fetch() entry.max_pages: ${calls.length} requests`);
  }

  // ── a short page ends the walk naturally ──
  {
    const { ctx, calls } = stubCtx({ 1: page(fullPage('a'), { pageCount: 9 }), 2: page([row('tail-1', 'Tail')]) });
    const jobs = await provider.fetch({ name: 'Entry Name' }, ctx);
    if (calls.length === 2 && jobs.length === 31) pass('fetch() stops on a short page');
    else fail(`fetch() short-page stop: ${calls.length} requests, ${jobs.length} jobs`);
  }

  // ── fetch error mid-walk keeps the pages already collected ──
  {
    const throttle = Object.assign(new Error('429 Too Many Requests'), { status: 429, retryAfter: '60' });
    const { ctx, calls } = stubCtx({ 1: page(fullPage('a'), { pageCount: 9 }), 3: page(fullPage('c')) }, { reject: { page: 2, error: throttle } });
    const jobs = await provider.fetch({ name: 'Entry Name' }, ctx);
    // 1 request for page 1, then the retry policy's 4 attempts (retries: 3) on
    // page 2 — all rejected — and no request for page 3.
    const pageThreeHits = calls.filter((c) => c.url.includes('page=3')).length;
    if (calls.length === 5 && pageThreeHits === 0 && jobs.length === 30) {
      pass('fetch() keeps pages 1..N and stops when a page fetch fails mid-walk');
    } else {
      fail(`fetch() mid-walk failure: ${calls.length} requests, ${pageThreeHits} for page 3, ${jobs.length} jobs`);
    }
  }

  // ── a probe propagates a fetch rejection unwrapped ──
  {
    const budget = Object.assign(new Error('probe request budget reached'), { name: 'ProbePageBudgetReached' });
    const { ctx } = stubCtx({}, { reject: { page: 1, error: budget } });
    let err = null;
    try {
      await provider.fetch({ name: 'Entry Name' }, { ...ctx, maxPages: 1 });
    } catch (e) {
      err = e;
    }
    if (err === budget) pass('fetch() propagates a ctx.fetch rejection unwrapped while probing (ProbePageBudgetReached identity survives)');
    else fail(`fetch() probe rejection = ${err ? `${err.name}: ${err.message}` : 'resolved without throwing'}`);
  }
} catch (e) {
  fail(`fullstack provider tests crashed: ${e.stack || e.message}`);
}
