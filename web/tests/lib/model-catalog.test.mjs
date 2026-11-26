// `opencode models` → the grouped catalog Config renders.
//
// The point of the grouping: an engine reaches many providers (opencode lists
// opencode, opencode-go, openrouter, anthropic), and the provider is what a run
// bills. A flat 439-line list hides that; grouping by the first path segment
// states it.
//
// Run:  node --test tests/lib/model-catalog.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { catalogSize, filterCatalog, modelCatalog, sourceNote } from "../../src/lib/model-catalog.mjs";

const IDS = [
  "opencode-go/deepseek-v4.1-flash",
  "opencode/deepseek-v4.1-flash-free",
  "opencode/beam-free",
  "openrouter/anthropic/claude-sonnet-5-5",
  "anthropic/claude-haiku-4-5",
];

test("models group by their first path segment, providers A→Z", () => {
  const catalog = modelCatalog(IDS);
  assert.deepEqual(
    catalog.map((g) => g.provider),
    ["anthropic", "opencode", "opencode-go", "openrouter"],
  );
  const opencode = catalog.find((g) => g.provider === "opencode");
  assert.deepEqual(
    opencode?.models.map((m) => m.name),
    ["beam-free", "deepseek-v4.1-flash-free"],
    "models are alphabetical inside a provider",
  );
});

test("a multi-segment id keeps its provider as the first segment only", () => {
  const group = modelCatalog(["openrouter/anthropic/claude-sonnet-5-5"]).find((g) => g.provider === "openrouter");
  assert.equal(group?.models[0].id, "openrouter/anthropic/claude-sonnet-5-5");
  assert.equal(group?.models[0].name, "anthropic/claude-sonnet-5-5");
});

test("the -free suffix is shown as a free model, and nothing else is", () => {
  const catalog = modelCatalog(IDS);
  const free = catalog.flatMap((g) => g.models).filter((m) => m.free).map((m) => m.id);
  assert.deepEqual(free, ["opencode/beam-free", "opencode/deepseek-v4.1-flash-free"]);
});

test("duplicate and malformed lines are dropped, not rendered twice", () => {
  const catalog = modelCatalog(["opencode/beam-free", "opencode/beam-free", "", "  ", "no-slash", "/x", "x/"]);
  assert.equal(catalogSize(catalog).models, 1);
});

test("an empty or missing list is an empty catalog, not a crash", () => {
  assert.deepEqual(modelCatalog([]), []);
  assert.deepEqual(modelCatalog(null), []);
  assert.deepEqual(catalogSize(null), { models: 0, providers: 0 });
});

test("search matches the id including its provider prefix", () => {
  const catalog = modelCatalog(IDS);
  const hits = filterCatalog(catalog, "deepseek");
  assert.deepEqual(
    hits.map((g) => g.provider),
    ["opencode", "opencode-go"],
    "a group with no match disappears",
  );
  assert.equal(filterCatalog(catalog, "DEEPSEEK").length, 2, "case-insensitive");
  assert.equal(filterCatalog(catalog, "").length, catalog.length, "an empty query filters nothing");
});

test("the source note says when the environment overrides the saved choice", () => {
  const env = sourceNote("env", "opencode-go/deepseek-v4.1-flash", "CAREER_OPS_MODEL_OPENCODE");
  assert.equal(env.override, true);
  assert.match(env.text, /CAREER_OPS_MODEL_OPENCODE/);

  const saved = sourceNote("saved", null, "CAREER_OPS_MODEL_OPENCODE");
  assert.equal(saved.override, false);
  assert.match(saved.text, /every run/);

  const auto = sourceNote("free-list", null, "CAREER_OPS_MODEL_OPENCODE");
  assert.match(auto.text, /free model/i);
});
