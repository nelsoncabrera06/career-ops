// /api/my-data — the route behind the "My data" tab.
//
// The pure writer is pinned in my-data.test.mjs; what matters here is the file
// boundary: a missing profile is created rather than 500ing, an existing one is
// backed up byte-for-byte, a malformed one is refused instead of overwritten,
// and the whole file is never re-serialized (comments survive).
//
// Same alias-loader convention as profile-write-shape.test.mjs, so the real
// route handler runs with only CAREER_OPS_ROOT redirected.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";
import * as yaml from "js-yaml";

const webSrc = fileURLToPath(new URL("../../src/", import.meta.url));
const loader = `
  import { existsSync } from "node:fs";
  import path from "node:path";
  import { pathToFileURL } from "node:url";
  export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(${JSON.stringify(webSrc)}, specifier.slice(2));
      for (const ext of [".ts", ".tsx", ".mjs", ".js", ""]) {
        if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, pathToFileURL(webSrc));

const { GET, POST } = await import("../../src/app/api/my-data/route.ts");

const COMPENSATION = `compensation:
  # I stated this figure on 2026-10-01 — keep the note
  target_range: "$3,800 USD gross/month"
  currency: "USD"
`;
const PROFILE = `# hand-written profile\ncandidate:\n  full_name: "Nelson"\n\n${COMPENSATION}`;

async function withFixture(source, fn) {
  const root = mkdtempSync(path.join(tmpdir(), "career-ops-my-data-"));
  const config = path.join(root, "config");
  const file = path.join(config, "profile.yml");
  mkdirSync(config);
  if (source !== undefined) writeFileSync(file, source);
  const previous = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  try {
    await fn({ config, file });
  } finally {
    if (previous === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

function post(values) {
  return new Request("http://fixture.invalid/api/my-data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
}

test("GET on a missing profile answers an empty form instead of failing", async () => {
  await withFixture(undefined, async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.exists, false);
    assert.equal(body.values["personal.birth_date"], "");
    assert.deepEqual(body.languages, []);
  });
});

test("POST creates the profile when there is none, with a readable block", async () => {
  await withFixture(undefined, async ({ file }) => {
    const res = await POST(post({ "personal.birth_date": "1989-12-12", languages: [{ language: "Spanish", level: "Native" }] }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).saved, true);
    const parsed = yaml.load(readFileSync(file, "utf8"));
    assert.equal(parsed.personal.birth_date, "1989-12-12");
    assert.deepEqual(parsed.languages, [{ language: "Spanish", level: "Native" }]);
  });
});

test("POST patches compensation in place, keeps comments, and backs up the original", async () => {
  await withFixture(PROFILE, async ({ config, file }) => {
    const res = await POST(post({ "compensation.minimum": "$3,200 USD gross/month" }));
    assert.equal(res.status, 200);
    const text = readFileSync(file, "utf8");
    assert.match(text, /# I stated this figure on 2026-10-01 — keep the note/);
    assert.match(text, /# hand-written profile/);
    const parsed = yaml.load(text);
    assert.equal(parsed.compensation.minimum, "$3,200 USD gross/month");
    assert.equal(parsed.compensation.target_range, "$3,800 USD gross/month");
    const backups = readdirSync(config).filter((n) => n.startsWith("profile.yml.bak-"));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(path.join(config, backups[0]), "utf8"), PROFILE);
  });
});

test("a no-op save writes nothing at all", async () => {
  await withFixture(PROFILE, async ({ config, file }) => {
    const before = readFileSync(file, "utf8");
    const res = await POST(post({ "compensation.target_range": "$3,800 USD gross/month" }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).saved, false);
    assert.equal(readFileSync(file, "utf8"), before);
    assert.equal(readdirSync(config).filter((n) => n.startsWith("profile.yml.bak-")).length, 0);
  });
});

test("a malformed profile is refused, not overwritten", async () => {
  const broken = "- just\n- a list\n";
  await withFixture(broken, async ({ file }) => {
    const res = await POST(post({ "personal.birth_date": "1989-12-12" }));
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /refusing to touch it/i);
    assert.equal(readFileSync(file, "utf8"), broken);
  });
});

test("an invalid date is a 400 and never reaches the file", async () => {
  await withFixture(PROFILE, async ({ file }) => {
    const res = await POST(post({ "personal.birth_date": "31/02/1990" }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "INVALID_FIELD");
    assert.equal(readFileSync(file, "utf8"), PROFILE);
  });
});

test("GET round-trips what POST wrote", async () => {
  await withFixture(PROFILE, async () => {
    await POST(post({ "availability.work_mode": "remote", "availability.notice_period_days": "15" }));
    const body = await (await GET()).json();
    assert.equal(body.exists, true);
    assert.equal(body.values["availability.work_mode"], "remote");
    assert.equal(body.values["availability.notice_period_days"], "15");
  });
});
