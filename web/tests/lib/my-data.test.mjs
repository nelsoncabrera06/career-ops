// "My data" tab model (src/lib/core/my-data.mjs).
//
// This writer edits config/profile.yml — a user-layer file with no git
// recovery. The properties pinned here are the ones that make that safe, plus
// the ones that make it useful: a date of birth survives as a STRING (unquoted,
// js-yaml reads it back as a Date and the whole age story breaks), clearing a
// field removes it, a field the payload omits is left alone, and every comment
// outside the managed block is still there afterwards.
//
// Run (from web/, as `npm test` does):  node --test tests/lib/my-data.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as yaml from "js-yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "..", "src", "lib", "core", "my-data.mjs");

const { readMyData, mergeMyData, normalizeField, ageFrom, FIELDS, BLOCK_START, MyDataError } = await import(
  pathToFileURL(SRC).href
);

const PROFILE = `# Career-Ops Profile Configuration
# user layer, hand-written, comments matter

candidate:
  full_name: "Jane Smith"
  location: "Buenos Aires, Argentina"

target_roles:
  primary:
    - "DevOps Engineer"

# Compensation note the user wrote by hand:
# "$3,800 is the figure I stated on 2026-10-01"
compensation:
  target_range: "$3,800 USD gross/month"
  currency: "USD"
  minimum: "$3,200 USD gross/month"
  location_flexibility: "Remote strongly preferred"

language:
  output: es
`;

test("readMyData: blank profile reports every field, keeps compensation values", () => {
  const { values, languages } = readMyData(PROFILE);
  assert.equal(values["personal.birth_date"], "");
  assert.equal(values["compensation.target_range"], "$3,800 USD gross/month");
  assert.equal(values["compensation.minimum"], "$3,200 USD gross/month");
  assert.deepEqual(languages, []);
  assert.equal(Object.keys(values).length, FIELDS.length);
});

test("readMyData seconds nothing about a string that happens to be a date", () => {
  const out = mergeMyData(PROFILE, { "personal.birth_date": "1989-12-12" }).text;
  // Unquoted, YAML reads 1989-12-12 as a Date — the age then becomes NaN and the
  // value no longer round-trips through the editor.
  assert.match(out, /birth_date: '?1989-12-12'?/);
  assert.equal(typeof yaml.load(out).personal.birth_date, "string");
  assert.equal(readMyData(out).values["personal.birth_date"], "1989-12-12");
});

test("dd/mm/yyyy in and ISO out; impossible dates are refused", () => {
  assert.equal(normalizeField({ path: "personal.birth_date", kind: "date" }, "12/12/1989"), "1989-12-12");
  assert.equal(normalizeField({ path: "personal.birth_date", kind: "date" }, "05-03-1990"), "1990-03-05");
  assert.throws(() => normalizeField({ path: "personal.birth_date", kind: "date" }, "1989-02-30"), /not a date/);
  assert.throws(() => normalizeField({ path: "personal.birth_date", kind: "date" }, "soon"), /not a date/);
});

test("enums and ints validate instead of silently coercing", () => {
  const wm = FIELDS.find((f) => f.path === "availability.work_mode");
  assert.equal(normalizeField(wm, "Remote"), "remote");
  assert.throws(() => normalizeField(wm, "sometimes"), /not one of/);
  const n = FIELDS.find((f) => f.path === "availability.notice_period_days");
  assert.equal(normalizeField(n, "30"), "30");
  assert.throws(() => normalizeField(n, "-1"), /whole number/);
});

test("the work-mode acceptance flag is stored as a YAML boolean, not a \"true\" string", () => {
  const yes = FIELDS.find((f) => f.path === "availability.accepts_any_work_mode");
  assert.equal(normalizeField(yes, "true"), "true");
  assert.equal(normalizeField(yes, "no"), "false");
  assert.throws(() => normalizeField(yes, "sometimes"), /yes\/no/);

  const out = mergeMyData(PROFILE, {
    "availability.work_mode": "remote",
    "availability.accepts_any_work_mode": "true",
  }).text;
  const parsed = yaml.load(out);
  assert.equal(parsed.availability.accepts_any_work_mode, true, "a real boolean in the file");
  assert.equal(parsed.availability.work_mode, "remote", "preference and acceptance coexist");
  assert.equal(readMyData(out).values["availability.accepts_any_work_mode"], "true", "and the form reads it back");

  const off = mergeMyData(out, { "availability.accepts_any_work_mode": "false" }).text;
  assert.equal(yaml.load(off).availability.accepts_any_work_mode, false);
  assert.equal(readMyData(off).values["availability.accepts_any_work_mode"], "false");
});

test("work_mode accepts the \"any\" escape hatch", () => {
  const wm = FIELDS.find((f) => f.path === "availability.work_mode");
  assert.equal(normalizeField(wm, "Any"), "any");
  assert.equal(readMyData(mergeMyData(PROFILE, { "availability.work_mode": "any" }).text).values["availability.work_mode"], "any");
});

test("comments and every untouched section survive the write", () => {
  const out = mergeMyData(PROFILE, { "personal.nationality": "Argentina" }).text;
  assert.match(out, /# Compensation note the user wrote by hand:/);
  assert.match(out, /# "\$3,800 is the figure I stated on 2026-10-01"/);
  assert.match(out, /# Career-Ops Profile Configuration/);
  assert.match(out, /  full_name: "Jane Smith"/);
  assert.match(out, /  output: es/);
});

test("compensation is patched in place — one section, comments intact, nothing absorbed", () => {
  const { text, absorbed, inPlace } = mergeMyData(PROFILE, {
    "personal.birth_date": "1989-12-12",
    "compensation.target_range": "$4,200 USD gross/month",
  });
  assert.deepEqual(absorbed, []);
  assert.deepEqual(inPlace, ["compensation"]);
  assert.equal(text.split("\n").filter((l) => l === "compensation:").length, 1, "never two definitions");
  const parsed = yaml.load(text);
  assert.equal(parsed.compensation.target_range, "$4,200 USD gross/month");
  assert.equal(parsed.compensation.currency, "USD", "an untouched sibling stays");
  assert.equal(parsed.compensation.location_flexibility, "Remote strongly preferred");
  // The block holds only the sections that did not already exist.
  const block = text.slice(text.indexOf(BLOCK_START));
  assert.match(block, /personal:/);
  assert.doesNotMatch(block, /compensation:/);
  // The user's own provenance comments are still where they were.
  assert.match(text, /# \"\$3,800 is the figure I stated on 2026-10-01\"/);
});

test("patching a sibling leaves a folded scalar alone; patching it replaces the whole span", () => {
  const folded = `compensation:\n  target_range: "$3,800"\n  location_flexibility: >-\n    Remote preferred, one week per month\n    on-site when the team meets\n  currency: USD\n`;
  const sibling = mergeMyData(folded, { "compensation.minimum": "$3,200" }).text;
  assert.match(sibling, /location_flexibility: >-\n    Remote preferred, one week per month\n    on-site when the team meets\n/);
  const replaced = mergeMyData(folded, { "compensation.location_flexibility": "Fully remote" }).text;
  assert.equal(yaml.load(replaced).compensation.location_flexibility, "Fully remote");
  assert.doesNotMatch(replaced, /one week per month/);
  assert.equal(yaml.load(replaced).compensation.currency, "USD");
});

test("a field the payload omits is left alone; an empty one is removed", () => {
  const withData = mergeMyData(PROFILE, {
    "personal.birth_date": "1989-12-12",
    "personal.nationality": "Argentina",
  }).text;
  const partial = mergeMyData(withData, { "personal.nationality": "" }).text;
  const v = readMyData(partial).values;
  assert.equal(v["personal.nationality"], "");
  assert.equal(v["personal.birth_date"], "1989-12-12", "omitted field must not be wiped");
});

test("unknown keys inside a managed section are preserved across saves", () => {
  const handEdited = mergeMyData(PROFILE, { "personal.birth_date": "1989-12-12" }).text.replace(
    "personal:\n",
    "personal:\n  nickname: Nico\n",
  );
  const out = mergeMyData(handEdited, { "personal.nationality": "Argentina" }).text;
  const parsed = yaml.load(out);
  assert.equal(parsed.personal.nickname, "Nico");
  assert.equal(parsed.personal.birth_date, "1989-12-12");
});

test("languages are replaced wholesale and empty rows dropped", () => {
  const out = mergeMyData(PROFILE, {
    languages: [
      { language: "Español", level: "Nativo" },
      { language: "", level: "Nativo" },
      { language: "Inglés", level: "C1" },
    ],
  }).text;
  assert.deepEqual(readMyData(out).languages, [
    { language: "Español", level: "Nativo" },
    { language: "Inglés", level: "C1" },
  ]);
});

test("merge is idempotent — saving twice changes nothing the second time", () => {
  const payload = { "personal.birth_date": "1989-12-12", "availability.work_mode": "remote" };
  const once = mergeMyData(PROFILE, payload).text;
  const twice = mergeMyData(once, payload);
  assert.equal(twice.text, once);
  assert.equal(twice.changed, false);
});

test("a profile that is not a mapping is refused, not overwritten", () => {
  assert.throws(
    () => mergeMyData("- just\n- a list\n", { "personal.birth_date": "1989-12-12" }),
    (err) => err instanceof MyDataError && err.code === "INVALID_PROFILE",
  );
});

test("ageFrom is exact on the birthday and the day before", () => {
  assert.equal(ageFrom("1989-12-12", new Date("2026-12-12T12:00:00Z")), 37);
  assert.equal(ageFrom("1989-12-12", new Date("2026-12-11T12:00:00Z")), 36);
  assert.equal(ageFrom("", new Date()), null);
  assert.equal(ageFrom("1989-02-30", new Date()), null);
});
