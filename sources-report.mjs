#!/usr/bin/env node
/**
 * sources-report.mjs — "where am I actually searching?"
 *
 * The scanner's coverage was opaque: `portals.yml` holds two lists
 * (`job_boards:` and `tracked_companies:`), each entry is routed to a provider
 * by an explicit `provider:` field or by provider `detect()` functions, and an
 * enabled entry that no provider claims is skipped by `scan.mjs` **without
 * saying so**. From the outside that looks identical to a working source that
 * simply found nothing — which is exactly the confusion this report removes.
 *
 * It answers, per configured source, in one offline pass:
 *   - which provider claims it (or that none does, and why)
 *   - whether it is enabled
 *   - what it is configured to do (its queries, page cap, target URL)
 *   - what it has actually contributed (postings added to the pipeline, last
 *     time it contributed), read from data/scan-history.tsv
 *
 * NO NETWORK. Provider resolution is pure config matching — the same
 * `resolveProvider()` `scan.mjs` uses — so this is instant and safe to render on
 * every page load. "Is the board answering?" is a different question, answered
 * by `verify-portals.mjs` / `audit-portals.mjs`.
 *
 * Run:
 *   node sources-report.mjs              # JSON (the web app's /api/sources)
 *   node sources-report.mjs --summary    # human table
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { loadProviders, resolveProvider } from './providers/_registry.mjs';

const CODE_ROOT = safeDirname();
const PORTALS_FILE = process.env.CAREER_OPS_PORTALS || join(getCareerOpsRoot(), 'portals.yml');
const SCAN_HISTORY = join(getCareerOpsRoot(), 'data', 'scan-history.tsv');

/** dirname(import.meta.url) — kept in a helper so the top-level stays readable. */
function safeDirname() {
  return new URL('.', import.meta.url).pathname.replace(/\/$/, '');
}

/**
 * Entries are routed by `scan.mjs` through providers/_registry.mjs, so the
 * report resolves them through the same registry, plugins included. Without
 * `mergeProviderPlugins()` a plugin-provided entry reads as an unknown provider
 * while the scanner scans it happily (#4026). No-op for a plugin-free install.
 */
async function buildProviders() {
  const providers = await loadProviders(join(CODE_ROOT, 'providers'));
  try {
    const { mergeProviderPlugins } = await import('./plugins/_engine.mjs');
    await mergeProviderPlugins(providers, { root: CODE_ROOT, dataRoot: getCareerOpsRoot() });
  } catch {
    /* plugins are optional; a failure here must not hide the provider inventory */
  }
  return providers;
}

/**
 * Per-posting activity from the scanner's own ledger, kept as raw rows so each
 * source can be attributed by URL rather than by provider.
 *
 * `scan.mjs` records only postings that reached the pipeline (`added`) or were
 * dropped by the location filter, so this is "what this source DID contribute",
 * not "what it returned". Titles filtered out are never written.
 *
 * Attributing by the `portal` column would be wrong: that column holds
 * `${provider.id}-api`, and one provider can back several entries (seven boards
 * share `getro-api`), which would credit each of them with the others' postings.
 *
 * @returns {Array<{url: string, status: string, firstSeen: string|null}>}
 */
export function readActivityRows(file = SCAN_HISTORY) {
  /** @type {Array<{url:string,status:string,firstSeen:string|null}>} */
  const rows = [];
  let tsv;
  try {
    tsv = readFileSync(file, 'utf8');
  } catch {
    return rows; // no scans yet is not an error
  }
  const lines = tsv.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (i === 0 && line.startsWith('url\t')) continue;
    const cols = line.split('\t');
    if (cols.length < 6) continue;
    const url = cols[0]?.trim();
    if (!url) continue;
    const firstSeen = cols[1]?.trim();
    rows.push({
      url,
      portal: cols[2]?.trim() || null,
      status: cols[5]?.trim() || '',
      firstSeen: /^\d{4}-\d{2}-\d{2}$/.test(firstSeen) ? firstSeen : null,
    });
  }
  return rows;
}

/** Drop the query/fragment and any trailing slash, so prefix comparison is stable. */
function comparand(url) {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.href.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/**
 * Does a posting URL belong to this source's own URL?
 *
 * A plain `startsWith` would credit `/vapi` with `/vapi2`'s postings, so the
 * match must land on a path boundary.
 */
export function belongsTo(sourceUrl, postingUrl) {
  const base = comparand(sourceUrl);
  const target = comparand(postingUrl);
  if (!base || !target) return false;
  if (target === base) return true;
  if (!target.startsWith(base)) return false;
  const next = target[base.length];
  return next === '/' || next === '?' || next === '#';
}

/**
 * Fold the ledger into one source's activity: postings added, dropped by the
 * location filter, and the most recent date it contributed anything.
 *
 * @param {string} sourceUrl
 * @param {Array<{url:string,status:string,firstSeen:string|null}>} rows
 */
export function activityFor(sourceUrl, rows) {
  if (!sourceUrl) return null;
  let added = 0;
  let skippedLocation = 0;
  let lastSeen = null;
  for (const row of rows) {
    if (!belongsTo(sourceUrl, row.url)) continue;
    if (row.status === 'added') added++;
    else if (row.status === 'skipped_location') skippedLocation++;
    if (row.firstSeen && (!lastSeen || row.firstSeen > lastSeen)) lastSeen = row.firstSeen;
  }
  if (!added && !skippedLocation && !lastSeen) return null;
  return { added, skippedLocation, lastSeen };
}

/**
 * Activity for one source, with the one fallback that is still exact.
 *
 * Some entries point `careers_url` at an API endpoint (`solid.jobs/public-api/…`)
 * while the postings live on a different path (`solid.jobs/o/…`), so the URL
 * match finds nothing even though the source contributes. When a provider backs
 * exactly ONE enabled entry, the ledger's `${provider.id}-api` label can only
 * mean that entry — so its provider-wide total is that source's own. With two or
 * more enabled entries sharing a provider the label is ambiguous and no number
 * is reported, rather than a wrong one.
 *
 * @param {{url:string, provider:string|null, enabled:boolean}} source
 * @param {Array<{url:string,status:string,firstSeen:string|null}>} rows
 * @param {Map<string, number>} enabledByProvider
 */
export function activityForSource(source, rows, enabledByProvider) {
  const byUrl = activityFor(source.url, rows);
  if (byUrl) return byUrl;
  if (!source.provider || !source.enabled) return null;
  if ((enabledByProvider.get(source.provider) ?? 0) !== 1) return null;
  let added = 0;
  let skippedLocation = 0;
  let lastSeen = null;
  for (const row of rows) {
    if (!row.portal || row.portal !== `${source.provider}-api`) continue;
    if (row.status === 'added') added++;
    else if (row.status === 'skipped_location') skippedLocation++;
    if (row.firstSeen && (!lastSeen || row.firstSeen > lastSeen)) lastSeen = row.firstSeen;
  }
  if (!added && !skippedLocation && !lastSeen) return null;
  return { added, skippedLocation, lastSeen, byProvider: true };
}

/**
 * Config worth showing, per entry, whichever provider reads it. Deliberately
 * generic: the report must not hardcode one provider's knobs, so it surfaces the
 * fields portals.yml itself documents (`queries`, `locations`, `max_pages`) plus
 * whatever the board nests under its own id.
 */
function configOf(entry, providerId) {
  const out = {};
  if (Array.isArray(entry.queries) && entry.queries.length) out.queries = [...entry.queries];
  if (Array.isArray(entry.locations) && entry.locations.length) out.locations = [...entry.locations];
  if (Number.isInteger(entry.max_pages) && entry.max_pages > 0) out.maxPages = entry.max_pages;
  const nested = providerId ? entry[providerId] : null;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) out.options = nested;
  return out;
}

/**
 * Classify one entry. Mirrors `findUnclaimedEntries()`'s eligibility rules
 * (audit-portals.mjs) so this report and `verify-pipeline.mjs` check 15 can never
 * disagree about whether a source scans.
 *
 * @param {object} entry
 * @param {number} index
 * @param {"board"|"company"} kind
 * @param {Map<string, object>} providers
 */
export function describeSource(entry, index, kind, providers) {
  const name = typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : null;
  const enabled = entry?.enabled !== false;
  const url = [entry?.careers_url, entry?.api, entry?.url].find((v) => typeof v === 'string' && v.trim()) || '';

  const resolved = providers.size > 0 ? resolveProvider(entry, providers) : null;
  const providerId = resolved?.provider?.id ?? null;

  /** @type {"scannable"|"disabled"|"no-provider"|"unknown-provider"|"handoff"|"unnamed"} */
  let status;
  if (!name) status = 'unnamed';
  else if (!enabled) status = 'disabled';
  else if (providerId) status = 'scannable';
  else if (resolved?.error) status = 'unknown-provider';
  else if (typeof entry?.scan_method === 'string' && entry.scan_method.trim()) status = 'handoff';
  else status = 'no-provider';

  // A disabled entry may still resolve (its provider is configured); keep the id
  // so a user re-enabling it can see what would run.
  return {
    name: name || '(sin nombre)',
    kind,
    index,
    enabled,
    status,
    provider: providerId,
    problem: resolved?.error ?? null,
    scanMethod: typeof entry?.scan_method === 'string' ? entry.scan_method : null,
    url,
    notes: typeof entry?.notes === 'string' && entry.notes.trim() ? entry.notes.trim() : null,
    config: configOf(entry || {}, providerId),
    // Filled by buildReport(): attribution needs the whole set of entries, since
    // a provider shared by two entries cannot say which one a posting came from.
    activity: null,
  };
}

/**
 * Build the whole report. Exported so tests (and any future CLI consumer) can
 * point it at a scratch directory instead of the user's real files.
 *
 * @param {{portalsFile?: string, scanHistory?: string}} [opts]
 */
export async function buildReport({ portalsFile = PORTALS_FILE, scanHistory = SCAN_HISTORY } = {}) {
  const available = existsSync(portalsFile);
  const report = {
    available,
    portalsFile: portalsFile.replace(getCareerOpsRoot(), '.'),
    generatedAt: new Date().toISOString(),
    boards: [],
    companies: [],
    summary: {
      boards: 0, boardsEnabled: 0, boardsScannable: 0,
      companies: 0, companiesEnabled: 0, companiesScannable: 0,
      skipped: 0, unknownProvider: 0, handoff: 0, disabled: 0,
    },
  };
  if (!available) return report;

  let doc;
  try {
    const yaml = await import('js-yaml');
    doc = yaml.load(readFileSync(portalsFile, 'utf8')) || {};
  } catch (err) {
    // A malformed portals.yml is a user-actionable error, not "no sources".
    return { ...report, error: `portals.yml could not be read: ${err.message}` };
  }

  const providers = await buildProviders();
  const activity = readActivityRows(scanHistory);

  const boards = Array.isArray(doc.job_boards) ? doc.job_boards : [];
  const companies = Array.isArray(doc.tracked_companies) ? doc.tracked_companies : [];

  report.boards = boards.map((e, i) => describeSource(e, i, 'board', providers));
  report.companies = companies.map((e, i) => describeSource(e, i, 'company', providers));

  // A provider backing exactly one ENABLED entry can be attributed whole (see
  // activityForSource()); two or more and the ledger label is ambiguous.
  const enabledByProvider = new Map();
  for (const src of [...report.boards, ...report.companies]) {
    if (!src.enabled || !src.provider) continue;
    enabledByProvider.set(src.provider, (enabledByProvider.get(src.provider) || 0) + 1);
  }
  for (const src of [...report.boards, ...report.companies]) {
    src.activity = activityForSource(src, activity, enabledByProvider);
  }

  for (const src of [...report.boards, ...report.companies]) {
    const isBoard = src.kind === 'board';
    if (isBoard) report.summary.boards++;
    else report.summary.companies++;
    if (src.enabled) {
      if (isBoard) report.summary.boardsEnabled++;
      else report.summary.companiesEnabled++;
    }
    if (src.status === 'scannable') {
      if (isBoard) report.summary.boardsScannable++;
      else report.summary.companiesScannable++;
    }
    if (src.status === 'disabled') report.summary.disabled++;
    if (src.status === 'no-provider') report.summary.skipped++;
    if (src.status === 'unknown-provider') report.summary.unknownProvider++;
    if (src.status === 'handoff') report.summary.handoff++;
  }

  report.summary.providers = providers.size;
  return report;
}

function pad(s, n) {
  const str = String(s);
  return str.length >= n ? str : str + ' '.repeat(n - str.length);
}

/** Human table. Only the sources that actually run, unless `all` is set. */
export function formatSummary(report, { all = false } = {}) {
  if (!report.available) return `No portals.yml at ${report.portalsFile} — nothing is being scanned yet.`;
  if (report.error) return report.error;
  const out = [];
  const s = report.summary;
  out.push(`Boards: ${s.boardsScannable}/${s.boardsEnabled} enabled scannable (${s.boards} configured)`);
  out.push(`Companies: ${s.companiesScannable}/${s.companiesEnabled} enabled scannable (${s.companies} configured)`);
  if (s.skipped) out.push(`⚠️  ${s.skipped} enabled source(s) have no provider and are skipped on every scan`);
  if (s.unknownProvider) out.push(`❌ ${s.unknownProvider} source(s) name an unknown provider`);
  if (s.handoff) out.push(`→ ${s.handoff} source(s) hand off to websearch`);
  out.push('');
  for (const [label, rows] of [['BOARDS', report.boards], ['COMPANIES', report.companies]]) {
    const shown = rows.filter((r) => all || (r.enabled && r.status !== 'no-provider' && r.status !== 'unknown-provider'));
    if (!shown.length) continue;
    out.push(`${label} (${shown.length}${all ? '' : ' shown'})`);
    out.push(`  ${pad('name', 34)} ${pad('provider', 20)} ${pad('state', 9)} ${pad('added', 6)} last`);
    for (const r of shown) {
      out.push(`  ${pad(r.name, 34)} ${pad(r.provider || '—', 20)} ${pad(r.status, 9)} ${pad(r.activity?.added ?? '—', 6)} ${r.activity?.lastSeen || '—'}`);
    }
    out.push('');
  }
  return out.join('\n').trimEnd();
}

async function main(argv) {
  const report = await buildReport();
  if (argv.includes('--summary')) {
    console.log(formatSummary(report, { all: argv.includes('--all') }));
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith('sources-report.mjs')) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`sources-report: ${err.message}`);
    process.exit(1);
  });
}
