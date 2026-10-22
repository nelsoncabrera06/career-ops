#!/usr/bin/env node
/**
 * fetch-jd.mjs — read a job description from its ATS's public API instead of
 * the rendered page (#2582).
 *
 * A headless caller that wants a JD today has one option: fetch the posting
 * page and strip HTML. That is 10-30k tokens of nav and markup on a
 * server-rendered board, and on a JS-rendered one (Ashby, Greenhouse's
 * embedded boards) it returns an unrendered shell — correctly detected as thin
 * and discarded — so the caller falls through to WebFetch, which hits the same
 * shell and fails the same way. Meanwhile the ATS's own public JSON endpoint,
 * the one liveness checks already use, ships the full JD body for free.
 *
 *   node fetch-jd.mjs <url>
 *
 * JD text on stdout, exit 0, when a known ATS answers with real content.
 * Exit 1 with empty stdout and no stderr noise otherwise — a miss is the
 * expected "fall back to the browser path" case, not an error condition, and
 * a visible miss is the whole point: never a fabricated JD.
 *
 * Coverage is JD_TEXT_API_ATS (liveness-api.mjs): Greenhouse (including
 * company careers pages that carry only `?gh_jid=`), Lever, Ashby, Workday,
 * SmartRecruiters. Every fetch runs through fetchJdViaKnownApi() in browser-extract.mjs
 * — the same dispatch its own `jd` mode uses — so this script and the
 * interactive extractor cannot drift on which ATS is API-fetchable.
 */

import { fetchJdViaKnownApi } from './browser-extract.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCareerOpsRoot } from './path-resolver.mjs';

const TEXT_CAP = 20_000; // a batch report reads the whole JD; no token-budget reason to cap tighter
const TIMEOUT_MS = 15_000;

function getInboxContext(url) {
  try {
    const root = getCareerOpsRoot();
    const rows = readFileSync(join(root, 'data', 'pipeline.md'), 'utf8').split(/\r?\n/);
    for (const row of rows) {
      const match = row.match(/^\s*-\s*\[[ xX]\]\s*(.*?)\s*$/);
      if (!match) continue;
      const fields = match[1].split('|').map((field) => field.trim());
      if (fields[0] !== url) continue;
      return { company: fields[1] || '', title: fields[2] || '' };
    }
  } catch {
    // The URL may be evaluated outside the inbox; the extractor can use its slug.
  }
  return {};
}

async function main() {
  const url = process.argv[2];

  if (!url) {
    console.error('usage: node fetch-jd.mjs <url>');
    process.exit(1);
  }

  const result = await fetchJdViaKnownApi(url, TEXT_CAP, TIMEOUT_MS, getInboxContext(url));
  // No stderr, by design: the caller's browser/WebFetch fallback is the
  // intended next step, and warning on every non-covered host would make the
  // normal path look broken.
  if (!result) process.exit(1);

  const header = result.title ? `${result.title}\n\n` : '';
  process.stdout.write(header + result.text);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(`fetch-jd: unexpected error — ${err?.message || err}`);
    process.exit(1);
  });
}
