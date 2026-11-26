// The assistant's technical preamble, folded out of the answer.
//
// Run:  node --test tests/lib/run-meta.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { splitRunMeta } from "../../src/lib/run-meta.mjs";

test("a plain answer has no meta and is returned untouched", () => {
  const text = "## Verdict\n\nStrong fit for the role.";
  assert.deepEqual(splitRunMeta(text), { meta: [], body: text });
});

test("the two leading run lines are folded off, the answer stays", () => {
  const text = [
    "🔧 OpenCode · opencode/deepseek-v4.1-flash",
    "⚠️ OpenCode cannot be permission-restricted — this agent runs with its default access",
    "",
    "Here is what I found.",
  ].join("\n");
  const { meta, body } = splitRunMeta(text);
  assert.equal(meta.length, 2);
  assert.match(meta[0], /^🔧 OpenCode/);
  assert.match(meta[1], /^⚠️ OpenCode/);
  assert.equal(body, "Here is what I found.");
});

test("a meta-only turn (streaming, nothing else yet) leaves an empty body", () => {
  const { meta, body } = splitRunMeta("🔧 OpenCode · model\n\n");
  assert.equal(meta.length, 1);
  assert.equal(body, "");
});

test("a warning inside a real answer is content, not meta", () => {
  const text = "Short answer: apply.\n\n⚠️ the posting closes Friday.";
  const { meta, body } = splitRunMeta(text);
  assert.deepEqual(meta, []);
  assert.equal(body, text);
});

test("leading blank lines do not hide the preamble", () => {
  const { meta, body } = splitRunMeta("\n\n🔧 model\n\nBody.");
  assert.deepEqual(meta, ["🔧 model"]);
  assert.equal(body, "Body.");
});

test("a plain ASCII warning is still recognized", () => {
  const { meta } = splitRunMeta("⚠ runtime runs with default access\nBody");
  assert.equal(meta.length, 1);
});

test("empty / non-string input is safe", () => {
  assert.deepEqual(splitRunMeta(""), { meta: [], body: "" });
  assert.deepEqual(splitRunMeta(null), { meta: [], body: "" });
  assert.deepEqual(splitRunMeta(undefined), { meta: [], body: "" });
});
