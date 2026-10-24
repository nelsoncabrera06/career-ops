#!/usr/bin/env node
/**
 * fix-navent-urls.mjs — Repair stale ZonaJobs/Bumeran posting URLs in local data
 *
 * The zonajobs provider (providers/zonajobs.mjs) once built every URL on the
 * host it searched, but the Navent inventory is SHARED: a Bumeran-native
 * posting (10-digit id) answers /404 on zonajobs.com.ar and only resolves on
 * its own portal (measured 2026-10-24 — /empleos/1118490158.html is /404 on
 * ZonaJobs, the live posting on Bumeran). The provider was fixed to emit the
 * item's own portal; this script repairs the data written before that fix —
 * the exact broken spellings the user still clicks on the dashboard's Fresh
 * cards and inbox rows.
 *
 * It rewrites ONLY the broken spelling, via repointNaventUrl() from the
 * provider (the one place the ID-shape rule lives) — the working reverse
 * spelling (Bumeran host) and every other byte of every file pass through
 * untouched. Repaired files: data/pipeline.md, data/scan-history.tsv, and the
 * tracker's URL cells when a row carries the stale spelling.
 *
 * Run: node fix-navent-urls.mjs [--dry-run]
 */

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { repointNaventUrl } from './providers/zonajobs.mjs';
import { openTrackerTransaction } from './tracker-utils.mjs';
import { validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

// One stale spelling per line may repeat in odd rows; a blanket line-level
// replace is safe everywhere because repointNaventUrl matches ONLY the
// /404-ing spelling and returns its input unchanged otherwise. Exported for
// the tests and so callers can repair their own snippets; the CLI below is
// the user-facing path.
export function fixLines(lines) {
  const changed = [];
  const out = lines.map((line, i) => {
    const fixed = line.replace(/\bhttps?:\/\/(?:www\.)?zonajobs\.com\.ar\/empleos\/\d{10}\.html\b/g,
      (m) => repointNaventUrl(m));
    if (fixed !== line) changed.push({ line: i + 1, before: line, after: fixed });
    return fixed;
  });
  return { lines: out, changed };
}

const KNOWN_FLAGS = ['--help', '-h', '--dry-run'];
const USAGE = `Usage: node fix-navent-urls.mjs [options]

  Repairs postings in data/pipeline.md and data/scan-history.tsv (and tracker
  URL cells) written before the zonajobs provider built URLs on the item's own
  portal: a 10-digit (Bumeran-native) id answers /404 on zonajobs.com.ar.
  Every such URL is repointed to www.bumeran.com.ar; nothing else changes.

  Options:
  --dry-run        List what would change without writing any file
  -h, --help       Show this help and exit
  `;

const IS_CLI = isMainModule(import.meta.url);

if (IS_CLI) {
const args = process.argv.slice(2);
validateFlags(args, KNOWN_FLAGS, USAGE);
const DRY_RUN = args.includes('--dry-run');
const CAREER_OPS = getCareerOpsRoot();

const jobs = [];
const pipelineFile = join(CAREER_OPS, 'data', 'pipeline.md');
const historyFile = join(CAREER_OPS, 'data', 'scan-history.tsv');
if (existsSync(pipelineFile)) jobs.push({ file: pipelineFile, label: 'pipeline.md' });
if (existsSync(historyFile)) jobs.push({ file: historyFile, label: 'scan-history.tsv' });

let trackerTx = null;
const trackerFile = resolveTrackerPath(CAREER_OPS);
if (existsSync(trackerFile)) {
  if (!DRY_RUN) {
    try {
      trackerTx = await openTrackerTransaction(trackerFile);
    } catch (err) {
      console.error(`Cannot acquire tracker lock: ${err.message}`);
      process.exit(1);
    }
    process.once('exit', () => {
      try { trackerTx.close(); } catch {}
    });
  }
  jobs.push({ file: trackerFile, label: 'applications.md', txn: 'tracker' });
}

let total = 0;
for (const job of jobs) {
  const content = job.txn === 'tracker' && trackerTx ? trackerTx.read() : readFileSync(job.file, 'utf8');
  const { lines, changed } = fixLines(content.split('\n'));
  total += changed.length;
  for (const { line, before, after } of changed) {
    console.log(`${DRY_RUN ? 'Would rewrite' : 'Rewrote'} ${job.label} line ${line}:`);
    console.log(`  - ${before}`);
    console.log(`  + ${after}`);
  }
  if (DRY_RUN || changed.length === 0) continue;
  // Backup first, written from the bytes this run actually read.
  const backupPath = `${job.file}.bak`;
  writeFileSync(backupPath, content);
  if (job.txn === 'tracker' && trackerTx) trackerTx.replace(lines.join('\n'));
  else writeFileSync(job.file, lines.join('\n'));
  console.log(`✅ ${job.label}: ${changed.length} URL(s) fixed (backup: ${backupPath})`);
}

console.log(`\n📊 ${total} stale Navent URL(s) ${DRY_RUN ? 'found' : 'fixed'}`);
if (DRY_RUN) console.log('(dry-run — no changes written)');
else if (total === 0) console.log('✅ No changes needed');
} // end IS_CLI
