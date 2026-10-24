// fix-navent-urls: repairs the pre-fix ZonaJobs spellings of Bumeran-native
// postings. Both data referents here are local user data (pipeline.md inbox
// rows, scan-history.tsv dedup keys, tracker URL cells); a wrong rewrite would
// break dedup for every future scan, so the tests pin which spellings move and
// which never do. Child-process CLI tests against disposable data roots;
// fictional data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { repointNaventUrl } from '../providers/zonajobs.mjs';
import { fixLines } from '../fix-navent-urls.mjs';
const CODE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PIPELINE_ROW =
  '- [ ] https://www.zonajobs.com.ar/empleos/1118445165.html | Red Tecnológica | Cloud Platform Engineer (AWS / DevOps) | Capital Federal, Buenos Aires, Argentina · Remoto | posted: 2026-09-16';
const HISTORY_ROW =
  'https://www.zonajobs.com.ar/empleos/1118445165.html\t2026-10-21\tzonajobs-api\tCloud Platform Engineer (AWS / DevOps)\tRed Tecnológica\tadded\tCapital Federal, Buenos Aires, Argentina · Remoto';

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-fix-navent-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  return root;
}
function run(root, args = []) {
  const env = { ...process.env };
  for (const k of ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER']) delete env[k];
  env.CAREER_OPS_ROOT = root;
  const r = spawnSync(process.execPath, [join(CODE_ROOT, 'fix-navent-urls.mjs'), ...args], {
    cwd: CODE_ROOT, env, encoding: 'utf-8', timeout: 30_000,
  });
  assert.equal(r.error, undefined);
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const withRoot = (fn) => () => {
  const root = makeRoot();
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
};

test('repointNaventUrl moves only the broken host+10-digit-id spelling', () => {
  assert.equal(
    repointNaventUrl('https://www.zonajobs.com.ar/empleos/1118445165.html'),
    'https://www.bumeran.com.ar/empleos/1118445165.html',
  );
  assert.equal(
    repointNaventUrl('http://zonajobs.com.ar/empleos/2192308999.html'),
    'https://www.bumeran.com.ar/empleos/2192308999.html',
  );
});

test('correct spellings pass through byte-for-byte', () => {
  for (const url of [
    'https://www.zonajobs.com.ar/empleos/2192308.html',       // 7-digit ZonaJobs-native
    'https://www.bumeran.com.ar/empleos/1118445165.html',     // already repointed
    'https://greenhouse.io/acme/jobs/1118445165',             // not Navent at all
    'https://www.zonajobs.com.ar/empleos/1118445165.htmlx',   // not the posting path
    'https://www.zonajobs.com.ar/empleos/11184451651.html',   // 11 digits — a different id
    '',
  ]) {
    assert.equal(repointNaventUrl(url), url, url);
  }
});

test('fixLines repairs a line and leaves every other byte of it in place', () => {
  const { lines, changed } = fixLines([PIPELINE_ROW, '- [ ] https://bumeran.com.ar/empleos/1118445165.html | already | ok | x']);
  assert.equal(changed.length, 1);
  assert.match(changed[0].before, /Cloud Platform Engineer/);
  assert.equal(
    lines[0],
    PIPELINE_ROW.replace('zonajobs.com.ar/empleos/1118445165.html', 'bumeran.com.ar/empleos/1118445165.html'),
  );
  assert.match(lines[0], /\| posted: 2026-09-16$/, 'the rest of the row is intact');
  assert.equal(lines[1], '- [ ] https://bumeran.com.ar/empleos/1118445165.html | already | ok | x');
});

test('CLI dry-run lists both files and writes nothing', withRoot((root) => {
  writeFileSync(join(root, 'data', 'pipeline.md'), `# Pipeline\n\n${PIPELINE_ROW}\n`);
  writeFileSync(join(root, 'data', 'scan-history.tsv'), `url\tfirst_seen\tsource\ttitle\tcompany\tstatus\tlocation\n${HISTORY_ROW}\n`);
  writeFileSync(join(root, 'data', 'applications.md'), '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n');
  const before = readFileSync(join(root, 'data', 'pipeline.md'), 'utf8');
  const r = run(root, ['--dry-run']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Would rewrite pipeline\.md line 3/);
  assert.match(r.out, /Would rewrite scan-history\.tsv line 2/);
  assert.match(r.out, /2 stale Navent URL\(s\) found/);
  assert.match(r.out, /dry-run/);
  assert.equal(readFileSync(join(root, 'data', 'pipeline.md'), 'utf8'), before);
  assert.equal(existsSync(join(root, 'data', 'scan-history.tsv.bak')), false, 'dry-run takes no backup');
}));

test('CLI writes the fix everywhere with a .bak beside each file', withRoot((root) => {
  writeFileSync(join(root, 'data', 'pipeline.md'), `# Pipeline\n\n${PIPELINE_ROW}\n`);
  writeFileSync(join(root, 'data', 'scan-history.tsv'), `url\tfirst_seen\tsource\ttitle\tcompany\tstatus\tlocation\n${HISTORY_ROW}\n`);
  // A tracker row whose URL cell carries the broken spelling is repaired too.
  writeFileSync(
    join(root, 'data', 'applications.md'),
    '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |\n'
      + '|---|------|---------|------|-------|--------|-----|--------|-------|-----|\n'
      + '| 1 | 2026-10-21 | Acme | DevOps | 4.0/5 | Evaluated | ❌ | — | note | [link](https://www.zonajobs.com.ar/empleos/1118445165.html) |\n',
  );
  const r = run(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Rewrote pipeline\.md line 3/);
  assert.match(r.out, /Rewrote scan-history\.tsv line 2/);
  assert.match(r.out, /3 stale Navent URL\(s\) fixed/);
  const pipeline = readFileSync(join(root, 'data', 'pipeline.md'), 'utf8');
  assert.match(pipeline, /bumeran\.com\.ar\/empleos\/1118445165\.html/);
  assert.doesNotMatch(pipeline, /zonajobs\.com\.ar\/empleos\/1118445165/);
  const history = readFileSync(join(root, 'data', 'scan-history.tsv'), 'utf8');
  assert.match(history, /https:\/\/www\.bumeran\.com\.ar\/empleos\/1118445165\.html\t2026-10-21\tzonajobs-api/);
  const tracker = readFileSync(join(root, 'data', 'applications.md'), 'utf8');
  assert.match(tracker, /\[link\]\(https:\/\/www\.bumeran\.com\.ar\/empleos\/1118445165\.html\)/);
  for (const f of ['pipeline.md', 'scan-history.tsv', 'applications.md']) {
    assert.equal(existsSync(join(root, 'data', `${f}.bak`)), true, `${f}.bak exists`);
  }
}));

test('CLI on clean data is a no-op, exit 0', withRoot((root) => {
  writeFileSync(join(root, 'data', 'pipeline.md'), `# Pipeline\n\n- [ ] https://www.bumeran.com.ar/empleos/1118445165.html | Co | Role | Loc | posted: 2026-10-01\n`);
  const r = run(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /0 stale Navent URL\(s\)/);
  assert.match(r.out, /No changes needed/);
}));
