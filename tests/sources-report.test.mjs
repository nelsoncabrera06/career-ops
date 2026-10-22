// tests/sources-report.test.mjs — the "where am I searching?" inventory.
// Offline: provider resolution is pure config matching, and every fixture is a
// scratch portals.yml + scan-history.tsv written into a temp directory.
import { pass, fail } from './helpers.mjs';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

console.log('\nSources report');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'sources-report.mjs')).href);
  const { belongsTo, activityFor, activityForSource, readActivityRows, describeSource, buildReport, formatSummary } = mod;

  // ── URL attribution ──────────────────────────────────────────────────────
  // The bug a plain startsWith would ship: one board's postings credited to
  // another whose slug merely starts with the same characters.
  const boundary = [
    ['https://jobs.ashbyhq.com/vapi', 'https://jobs.ashbyhq.com/vapi/abc-123', true],
    ['https://jobs.ashbyhq.com/vapi', 'https://jobs.ashbyhq.com/vapi', true],
    ['https://jobs.ashbyhq.com/vapi/', 'https://jobs.ashbyhq.com/vapi/abc', true],
    ['https://jobs.ashbyhq.com/vapi', 'https://jobs.ashbyhq.com/vapi2/abc', false],
    ['https://jobs.ashbyhq.com/vapi', 'https://jobs.ashbyhq.com/other/abc', false],
    ['https://solid.jobs/public-api/offers/it?campaign=x', 'https://solid.jobs/o/kk7v/career-ops', false],
    ['not a url', 'https://jobs.ashbyhq.com/vapi/abc', false],
    ['https://jobs.ashbyhq.com/vapi', '', false],
  ];
  for (const [source, posting, expected] of boundary) {
    const got = belongsTo(source, posting);
    if (got === expected) pass(`belongsTo() ${expected ? 'matches' : 'refuses'} ${JSON.stringify(posting)} for ${JSON.stringify(source)}`);
    else fail(`belongsTo(${JSON.stringify(source)}, ${JSON.stringify(posting)}) = ${got}, expected ${expected}`);
  }

  // ── activity folding ─────────────────────────────────────────────────────
  const ROWS = [
    { url: 'https://www.empleosit.com.ar/display-job/1/a.html', portal: 'empleosit-api', status: 'added', firstSeen: '2026-10-21' },
    { url: 'https://www.empleosit.com.ar/display-job/2/b.html', portal: 'empleosit-api', status: 'added', firstSeen: '2026-10-20' },
    { url: 'https://www.empleosit.com.ar/display-job/3/c.html', portal: 'empleosit-api', status: 'skipped_location', firstSeen: '2026-10-22' },
    { url: 'https://other.example/job/1', portal: 'greenhouse-api', status: 'added', firstSeen: '2026-10-19' },
  ];

  const act = activityFor('https://www.empleosit.com.ar/', ROWS);
  if (act && act.added === 2 && act.skippedLocation === 1 && act.lastSeen === '2026-10-22') {
    pass('activityFor() counts added/skipped_location and the newest sighting');
  } else {
    fail(`activityFor() = ${JSON.stringify(act)}`);
  }

  if (activityFor('', ROWS) === null && activityFor('https://nothing.example/', ROWS) === null) {
    pass('activityFor() returns null for an empty URL and for a source that contributed nothing');
  } else {
    fail('activityFor() invented activity');
  }

  // ── provider-wide fallback ───────────────────────────────────────────────
  const uniqueProvider = new Map([['empleosit', 1]]);
  const fallback = activityForSource(
    { url: 'https://www.empleosit.com.ar/public-api/thing', provider: 'empleosit', enabled: true },
    ROWS,
    uniqueProvider,
  );
  if (fallback && fallback.added === 2 && fallback.byProvider === true) {
    pass('activityForSource() falls back to the provider total when ONE enabled entry owns that provider');
  } else {
    fail(`unique-provider fallback = ${JSON.stringify(fallback)}`);
  }

  // Two enabled entries share a provider: the ledger label cannot say which one
  // a posting came from, so no number is better than a wrong one.
  const sharedProvider = new Map([['empleosit', 2]]);
  if (activityForSource({ url: 'https://x.example/none', provider: 'empleosit', enabled: true }, ROWS, sharedProvider) === null) {
    pass('activityForSource() reports nothing when the provider is shared by two enabled entries');
  } else {
    fail('activityForSource() attributed a shared provider\'s postings to one entry');
  }

  // A disabled entry contributes nothing by definition.
  if (activityForSource({ url: 'https://x.example/none', provider: 'empleosit', enabled: false }, ROWS, uniqueProvider) === null) {
    pass('activityForSource() reports nothing for a disabled entry');
  } else {
    fail('activityForSource() credited a disabled entry');
  }

  // ── ledger parsing ───────────────────────────────────────────────────────
  const scratch = mkdtempSync(join(tmpdir(), 'sources-report-'));
  const historyFile = join(scratch, 'scan-history.tsv');
  writeFileSync(historyFile, [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus',
    'https://a.example/1\t2026-10-01\templeosit-api\tOne\tACME\tadded',
    'https://a.example/2\tnot-a-date\templeosit-api\tTwo\tACME\tskipped_location',
    'short\trow',
    '',
    'https://a.example/3\t2026-10-05\templeosit-api\tThree\tACME\tadded',
  ].join('\n'), 'utf8');

  const rows = readActivityRows(historyFile);
  if (rows.length === 3) pass('readActivityRows() skips the header, malformed rows and blanks');
  else fail(`readActivityRows() returned ${rows.length} rows, expected 3`);

  if (rows[1].firstSeen === null) pass('readActivityRows() refuses a non-date first_seen instead of inventing one');
  else fail(`non-date first_seen = ${JSON.stringify(rows[1].firstSeen)}`);

  if (readActivityRows(join(scratch, 'missing.tsv')).length === 0) {
    pass('readActivityRows() treats a missing ledger as "no scans yet"');
  } else {
    fail('readActivityRows() threw or invented rows for a missing ledger');
  }

  // ── describeSource classification ────────────────────────────────────────
  // Real registry, so an entry is resolved exactly the way scan.mjs resolves it.
  const { loadProviders } = await import(pathToFileURL(join(ROOT, 'providers/_registry.mjs')).href);
  const providers = await loadProviders(join(ROOT, 'providers'));

  const cases = [
    [{ name: 'Explicit', provider: 'empleosit', careers_url: 'https://www.empleosit.com.ar/' }, 'scannable', 'empleosit'],
    [{ name: 'Detected', careers_url: 'https://ar.computrabajo.com/' }, 'scannable', 'computrabajo'],
    [{ name: 'Off', provider: 'empleosit', enabled: false }, 'disabled', 'empleosit'],
    [{ name: 'Nobody', careers_url: 'https://example.invalid/jobs' }, 'no-provider', null],
    [{ name: 'Typo', provider: 'does-not-exist' }, 'unknown-provider', null],
    [{ name: 'Handoff', careers_url: 'https://example.invalid/jobs', scan_method: 'websearch' }, 'handoff', null],
    [{ careers_url: 'https://example.invalid/jobs' }, 'unnamed', null],
  ];
  for (const [entry, expected, provider] of cases) {
    const got = describeSource(entry, 0, 'board', providers);
    if (got.status === expected && got.provider === provider) {
      pass(`describeSource() classifies ${JSON.stringify(entry.name ?? '(unnamed)')} as ${expected}`);
    } else {
      fail(`describeSource(${JSON.stringify(entry.name)}) = ${got.status}/${got.provider}, expected ${expected}/${provider}`);
    }
  }

  // Config surfaces the fields a user set, and nothing it did not.
  const configured = describeSource({
    name: 'CT',
    provider: 'computrabajo',
    careers_url: 'https://ar.computrabajo.com/',
    queries: ['devops', 'sre'],
    max_pages: 3,
    notes: 'measured',
  }, 0, 'board', providers);
  if (configured.config.queries?.length === 2 && configured.config.maxPages === 3 && configured.notes === 'measured') {
    pass('describeSource() surfaces queries, max_pages and notes');
  } else {
    fail(`describeSource() config = ${JSON.stringify(configured.config)} / ${configured.notes}`);
  }
  if (!('queries' in describeSource({ name: 'X', provider: 'empleosit' }, 0, 'board', providers).config)) {
    pass('describeSource() omits config a source does not set');
  } else {
    fail('describeSource() invented a queries list');
  }

  // ── buildReport end-to-end ───────────────────────────────────────────────
  const portalsFile = join(scratch, 'portals.yml');
  writeFileSync(portalsFile, `
job_boards:
  - name: EmpleosIT
    provider: empleosit
    careers_url: https://www.empleosit.com.ar/
    notes: tech board
  - name: Broken Board
    careers_url: https://nothing-claims-this.example/jobs
  - name: Off Board
    provider: computrabajo
    enabled: false
  - name: Typo Board
    provider: nope
tracked_companies:
  - name: Ashby Co
    careers_url: https://jobs.ashbyhq.com/ashbyco
`, 'utf8');

  const report = await buildReport({ portalsFile, scanHistory: historyFile });
  if (report.available && !report.error) pass('buildReport() reads a portals.yml');
  else fail(`buildReport() failed: ${report.error}`);

  if (report.summary.boards === 4 && report.summary.companies === 1) {
    pass('buildReport() counts both sections');
  } else {
    fail(`summary counts = ${JSON.stringify(report.summary)}`);
  }

  const s = report.summary;
  if (s.boardsScannable === 1 && s.skipped === 1 && s.unknownProvider === 1 && s.disabled === 1 && s.companiesScannable === 1) {
    pass('buildReport() classifies scannable / skipped / unknown-provider / disabled separately');
  } else {
    fail(`summary classification = ${JSON.stringify(s)}`);
  }

  const empleosit = report.boards.find((b) => b.name === 'EmpleosIT');
  if (empleosit?.activity?.added === 2) pass('buildReport() attaches the source\'s own contribution');
  else fail(`EmpleosIT activity = ${JSON.stringify(empleosit?.activity)}`);

  // ── summary text ─────────────────────────────────────────────────────────
  const text = formatSummary(report);
  if (/no provider/.test(text) && /unknown provider/.test(text)) {
    pass('formatSummary() calls out sources that never scan');
  } else {
    fail(`formatSummary() = ${text}`);
  }

  const missing = await buildReport({ portalsFile: join(scratch, 'nope.yml'), scanHistory: historyFile });
  if (missing.available === false && /nothing is being scanned/.test(formatSummary(missing))) {
    pass('buildReport() reports a missing portals.yml instead of an empty inventory');
  } else {
    fail(`missing portals.yml = ${JSON.stringify({ available: missing.available })}`);
  }

  // A malformed user file is an error to act on, not "you have no sources".
  const brokenFile = join(scratch, 'broken.yml');
  writeFileSync(brokenFile, 'job_boards: [ this is not: valid: yaml\n', 'utf8');
  const broken = await buildReport({ portalsFile: brokenFile, scanHistory: historyFile });
  if (broken.error && /could not be read/.test(broken.error) && broken.available) {
    pass('buildReport() surfaces a malformed portals.yml as an error, not as zero sources');
  } else {
    fail(`malformed portals.yml = ${JSON.stringify(broken.error)}`);
  }
} catch (err) {
  fail(`sources-report test threw: ${err.message}`);
}
