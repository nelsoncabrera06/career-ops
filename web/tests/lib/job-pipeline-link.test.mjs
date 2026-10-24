// findPipelineEntry: an evaluate worker's posting URL must resolve to the ONE
// tracker row it produced — via the canonical URL key, the same dedup key the
// tracker itself writes rows under (merge-tracker.mjs #3516's link cells).
//
// A wrong match here links the job page (and its reader) to someone else's
// evaluation; a missed match is merely "no link shown", which is why no
// fallback heuristic (company/role fuzz) is tolerated below.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findPipelineEntry } from "../../src/lib/job-pipeline-link.mjs";

test("an exact match resolves", () => {
  const row = { n: "94", url: "https://jobs.ashbyhq.com/supabase/abc" };
  assert.equal(findPipelineEntry([row], "https://jobs.ashbyhq.com/supabase/abc"), row);
});

test("tracking params, trailing slash, scheme and case never break the match", () => {
  const row = { n: "94", url: "https://jobs.ashbyhq.com/supabase/abc" };
  assert.equal(
    findPipelineEntry([row], "http://JOBS.ashbyhq.com/supabase/abc/?gh_src=abc123&utm_medium=x"),
    row,
  );
});

test("a linked URL cell resolves — merge-tracker writes [label](href) (#3516)", () => {
  const row = { n: "94", url: "[ashby](https://jobs.ashbyhq.com/supabase/abc)" };
  assert.equal(findPipelineEntry([row], "https://jobs.ashbyhq.com/supabase/abc?gh_src=feed"), row);
});

test("an id-bearing query keeps rows apart — the over-normalization guard", () => {
  // Same host+path, different jid = different openings (url-key.mjs exists
  // precisely for this). Never link one onto the other.
  const a = { n: "94", url: "https://boards.greenhouse.io/acme/jobs/1001" };
  const b = { n: "95", url: "https://boards.greenhouse.io/acme/jobs/2002" };
  assert.equal(findPipelineEntry([a, b], "https://boards.greenhouse.io/acme/jobs/2002"), b);
  assert.equal(findPipelineEntry([a, b], "https://boards.greenhouse.io/acme/jobs/1001"), a);
});

test("no tracker row carries the URL → null (no link, no guess)", () => {
  const row = { n: "94", url: "https://jobs.ashbyhq.com/supabase/abc" };
  assert.equal(findPipelineEntry([row], "https://jobs.lever.co/other/xyz"), null);
});

test("a non-URL input (pasted JD text) resolves to nothing", () => {
  const row = { n: "94", url: "https://jobs.ashbyhq.com/supabase/abc" };
  assert.equal(findPipelineEntry([row], "Release Engineer — Supabase"), null);
  assert.equal(findPipelineEntry([row], ""), null);
});

test("rows with no URL cell are skipped, and an empty key cannot match an empty cell", () => {
  const noUrlRow = { n: "12", url: "" };
  assert.equal(findPipelineEntry([noUrlRow], "https://jobs.ashbyhq.com/supabase/abc"), null);
  assert.equal(findPipelineEntry([noUrlRow], ""), null);
});

test("linkedin: currentJobId is session state, the path id is the posting", () => {
  // The worker was launched from a listing sidebar "?currentJobId=" and the
  // tracker keeps the bare /jobs/view/{id} URL — the same posting, both ways.
  const row = { n: "94", url: "[linkedin.com](https://www.linkedin.com/jobs/view/4481906233/)" };
  assert.equal(
    findPipelineEntry([row], "https://www.linkedin.com/jobs/view/4481906233/?currentJobId=4481906233"),
    row,
  );
  assert.equal(findPipelineEntry([row], "https://www.linkedin.com/jobs/view/99999999/?currentJobId=4481906233"), null);
});

test("linkedin: a DIFFERENT path id never folds onto another row", () => {
  const a = { n: "94", url: "https://www.linkedin.com/jobs/view/111" };
  const b = { n: "95", url: "https://www.linkedin.com/jobs/view/222" };
  assert.equal(findPipelineEntry([a, b], "https://www.linkedin.com/jobs/view/222?currentJobId=111"), b);
  assert.equal(findPipelineEntry([a, b], "https://www.linkedin.com/jobs/view/333"), null);
});

test("the linkedin exception does not leak to identity-bearing jid params", () => {
  // gh_jid is the posting identity itself (url-key.mjs exists to keep these
  // apart); a currentJobId-style strip must never apply there.
  const a = { n: "94", url: "https://boards.greenhouse.io/acme/jobs/1001?gh_jid=1001" };
  assert.equal(findPipelineEntry([a], "https://boards.greenhouse.io/acme/jobs/1001?gh_jid=2002"), null);
});
