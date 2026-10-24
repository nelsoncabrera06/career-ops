import { test } from "node:test";
import assert from "node:assert/strict";
import { aliasesOf, normalizeCompanyName, parseCompanyGroups, searchableCompanyNames } from "../../src/lib/company-aliases.mjs";
import { companySearchText } from "../../src/lib/company-presentation.mjs";

// The case this feature exists for: one posting, three brand names (the staffing
// arm printed on the board, the end employer in the ad body, the holding in the
// invite email).
const GROUPS = [
  {
    names: ["Netkel Consulting", "Cosys Global", "Grupo Kelsoft"],
    note: "Cosys Global redacta la búsqueda, Netkel publica, Kelsoft es el holding",
  },
];

test("normalizeCompanyName folds accents, case and punctuation", () => {
  for (const raw of ["Grupo Kelsoft", "grupo kelsoft", "  GRUPO   KELSOFT  ", "Grupo-Kelsoft", "Grupo  Kelsoft."]) {
    assert.equal(normalizeCompanyName(raw), "grupo kelsoft");
  }
  assert.equal(normalizeCompanyName("Tecnología"), "tecnologia");
  assert.equal(normalizeCompanyName(""), "");
  assert.equal(normalizeCompanyName(null), "");
});

test("aliasesOf returns every OTHER brand of the group, whichever name you ask with", () => {
  assert.deepEqual(aliasesOf("Netkel Consulting", GROUPS), ["Cosys Global", "Grupo Kelsoft"]);
  // Asking with any member yields the same group — that is what makes the search
  // symmetric: the row is filed under one of them, the user may know another.
  assert.deepEqual(aliasesOf("Grupo Kelsoft", GROUPS), ["Netkel Consulting", "Cosys Global"]);
  assert.deepEqual(aliasesOf("netkel  consulting", GROUPS), ["Cosys Global", "Grupo Kelsoft"]);
});

test("aliasesOf is empty — not throwing — for an unknown or missing company", () => {
  assert.deepEqual(aliasesOf("Supabase", GROUPS), []);
  assert.deepEqual(aliasesOf("", GROUPS), []);
  assert.deepEqual(aliasesOf(undefined, GROUPS), []);
  assert.deepEqual(aliasesOf("Netkel Consulting", []), []);
});

test("parseCompanyGroups accepts the documented shape and tolerates junk", () => {
  assert.deepEqual(parseCompanyGroups({ groups: GROUPS }), GROUPS);
  // Bare array of name arrays, for hand-editing.
  assert.deepEqual(parseCompanyGroups([["A", "B"]]), [{ names: ["A", "B"] }]);
  assert.deepEqual(parseCompanyGroups(JSON.stringify({ groups: GROUPS })), GROUPS);
  // A single name carries no alias information; malformed entries are skipped
  // rather than taking the whole pipeline page down.
  assert.deepEqual(parseCompanyGroups({ groups: [{ names: ["Only One"] }, { names: "nope" }, null, 7] }), []);
  assert.deepEqual(parseCompanyGroups(null), []);
  assert.deepEqual(parseCompanyGroups("not json"), []);
  assert.deepEqual(parseCompanyGroups(""), []);
});

test("parseCompanyGroups dedupes names and drops blanks", () => {
  assert.deepEqual(parseCompanyGroups([["Netkel ", "netkel", "  ", "Cosys Global"]]), [
    { names: ["Netkel", "Cosys Global"] },
  ]);
});

test("companySearchText matches a row filed under any of its brands", () => {
  const row = { company: "Netkel Consulting", via: "—", role: "DevOps Engineer Senior" };
  for (const needle of ["netkel", "cosys", "kelsoft", "grupo kelsoft"]) {
    assert.match(companySearchText(row, GROUPS).toLowerCase(), new RegExp(needle), `should match ${needle}`);
  }
  // Without the groups the behaviour is exactly what it was before.
  assert.doesNotMatch(companySearchText(row).toLowerCase(), /kelsoft/);
  assert.match(companySearchText(row).toLowerCase(), /netkel/);
});

test("searchableCompanyNames keeps the company first, aliases after", () => {
  assert.deepEqual(searchableCompanyNames("Cosys Global", GROUPS), ["Cosys Global", "Netkel Consulting", "Grupo Kelsoft"]);
  assert.deepEqual(searchableCompanyNames("Supabase", GROUPS), ["Supabase"]);
});
