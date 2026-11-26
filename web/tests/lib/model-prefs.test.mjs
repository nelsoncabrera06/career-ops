// The model choice Config saves — `data/web-settings.json`.
//
// The regression this pins: the choice is what every headless run bills against,
// and it is read SERVER-side (cli-model.mjs). If a save were silently dropped,
// or an entry an older file wrote were dropped on the next save, Config would
// show one model while runs used another.
//
// Run:  node --test tests/lib/model-prefs.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  normalizeCliId,
  normalizeModelId,
  prefsPath,
  readModelPrefs,
  saveModelFor,
  savedModelFor,
} from "../../src/lib/model-prefs.mjs";

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "co-model-prefs-"));
}

test("no file → no choices, and that is not an error", () => {
  const root = scratch();
  assert.deepEqual(readModelPrefs(root), {});
  assert.equal(savedModelFor(root, "opencode"), null);
});

test("a saved model round-trips, keyed by CLI id", async () => {
  const root = scratch();
  const res = await saveModelFor(root, "opencode", "opencode-go/deepseek-v4.1-flash");
  assert.deepEqual(res, { ok: true, cliId: "opencode", model: "opencode-go/deepseek-v4.1-flash" });
  assert.equal(savedModelFor(root, "opencode"), "opencode-go/deepseek-v4.1-flash");
  assert.equal(savedModelFor(root, "claude"), null, "one CLI's choice is not another's");
  assert.deepEqual(JSON.parse(fs.readFileSync(prefsPath(root), "utf8")), {
    version: 1,
    models: { opencode: "opencode-go/deepseek-v4.1-flash" },
  });
});

test("null/'' means Automatic and removes the entry", async () => {
  const root = scratch();
  await saveModelFor(root, "opencode", "opencode/beam-free");
  assert.deepEqual(await saveModelFor(root, "opencode", null), { ok: true, cliId: "opencode", model: null });
  assert.equal(savedModelFor(root, "opencode"), null);
  // Clearing when nothing was saved is a no-op, not a write.
  const before = fs.statSync(prefsPath(root)).mtimeMs;
  await saveModelFor(root, "opencode", null);
  assert.equal(fs.statSync(prefsPath(root)).mtimeMs, before);
});

test("saving the same value twice does not rewrite (or back up) the file", async () => {
  const root = scratch();
  await saveModelFor(root, "opencode", "opencode-go/deepseek-v4.1-flash");
  const first = fs.statSync(prefsPath(root)).mtimeMs;
  await saveModelFor(root, "opencode", "opencode-go/deepseek-v4.1-flash");
  assert.equal(fs.statSync(prefsPath(root)).mtimeMs, first, "an unchanged choice is not a write");
  assert.equal(countBackups(root), 0, "and therefore no backup either");
});

test("a real change keeps one daily backup, not one per save", async () => {
  const root = scratch();
  await saveModelFor(root, "opencode", "opencode/beam-free");
  await saveModelFor(root, "opencode", "opencode-go/deepseek-v4.1-flash");
  await saveModelFor(root, "opencode", "openrouter/anthropic/claude-sonnet-5-5");
  assert.equal(countBackups(root), 1);
  assert.equal(savedModelFor(root, "opencode"), "openrouter/anthropic/claude-sonnet-5-5");
});

function countBackups(root) {
  try {
    return fs.readdirSync(path.join(root, "data")).filter((f) => f.includes("web-settings.json.bak")).length;
  } catch {
    return 0;
  }
}

test("model ids the CLIs actually use are accepted", () => {
  for (const id of [
    "opencode-go/deepseek-v4.1-flash",
    "openrouter/anthropic/claude-sonnet-5-5",
    "deepseek/deepseek-v4.1-flash-1017",
    "claude-haiku-4-5:1m",
  ]) {
    assert.equal(normalizeModelId(id), id, `rejected a real id: ${id}`);
  }
});

test("junk is refused rather than written", () => {
  for (const bad of ["", "   ", "-rf", "model with spaces", "a;b", "x".repeat(200), "foo//", "/leading"]) {
    assert.equal(normalizeModelId(bad), null, `accepted junk: ${JSON.stringify(bad)}`);
  }
  assert.equal(normalizeCliId("OpenCode"), null, "ids are the lowercase form clis.ts spells");
  assert.equal(normalizeCliId("opencode"), "opencode");
});

test("an id outside the engine's live list is refused when the list is known", async () => {
  const root = scratch();
  const res = await saveModelFor(root, "opencode", "opencode/typo-model", ["opencode/beam-free"]);
  assert.equal(res.ok, false);
  assert.match(res.error, /not in the model list/);
  assert.equal(savedModelFor(root, "opencode"), null, "a refused save writes nothing");
});

test("a corrupt file degrades to Automatic and is replaced cleanly on the next save", async () => {
  const root = scratch();
  fs.mkdirSync(path.dirname(prefsPath(root)), { recursive: true });
  fs.writeFileSync(prefsPath(root), "{ this is not json", "utf8");
  assert.deepEqual(readModelPrefs(root), {});
  assert.equal(savedModelFor(root, "opencode"), null);
  await saveModelFor(root, "claude", "claude-haiku-4-5");
  assert.equal(savedModelFor(root, "claude"), "claude-haiku-4-5");
});

test("keys this version does not know about survive a save", async () => {
  const root = scratch();
  fs.mkdirSync(path.dirname(prefsPath(root)), { recursive: true });
  fs.writeFileSync(
    prefsPath(root),
    JSON.stringify({ version: 2, futureSetting: { keep: true }, models: { opencode: "opencode/beam-free" } }),
    "utf8",
  );
  await saveModelFor(root, "claude", "claude-haiku-4-5");
  const file = JSON.parse(fs.readFileSync(prefsPath(root), "utf8"));
  assert.deepEqual(file.futureSetting, { keep: true });
  assert.equal(file.models.opencode, "opencode/beam-free", "another CLI's choice is untouched");
  assert.equal(file.models.claude, "claude-haiku-4-5");
});
