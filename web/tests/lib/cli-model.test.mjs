import assert from "node:assert/strict";
import { test } from "node:test";

// Imports the REAL policy from src/lib/cli-model.mjs, so the behaviour asserted
// here is the behaviour a run gets. The regression this file pins: opencode run
// with no --model resolves its own default, and on 2026-10-28 that default was a
// paid OpenRouter model (openai/gpt-6.1-terra-pro, $1/$5 per M) — five form
// answers cost ~$0.90 while the user believed everything ran on a free one.
import {
  DEFAULT_FREE_PREFER,
  envKeyFor,
  explicitModel,
  isFreeModel,
  modelLabel,
  parseModelIds,
  pickFreeModel,
  planCliModel,
} from "../../src/lib/cli-model.mjs";

const FREE = ["opencode/beam-free", "opencode/glm-5.3-flash-free", "opencode/deepseek-v4.1-flash-free"];
const MIXED = ["opencode/deepseek-v4.1-flash", "openrouter/openai/gpt-6.1-terra-pro", ...FREE];

test("env keys are per-CLI and uppercase", () => {
  assert.equal(envKeyFor("opencode"), "CAREER_OPS_MODEL_OPENCODE");
  assert.equal(envKeyFor("my-cli"), "CAREER_OPS_MODEL_MY_CLI");
});

test("per-CLI env beats the global one", () => {
  const env = { CAREER_OPS_MODEL: "global/model", CAREER_OPS_MODEL_OPENCODE: "per/model" };
  assert.equal(explicitModel("opencode", env), "per/model");
  assert.equal(explicitModel("pi", env), "global/model");
  assert.equal(explicitModel("pi", {}), null);
});

test("the -free suffix is the whole free test", () => {
  assert.equal(isFreeModel("opencode/deepseek-v4.1-flash-free"), true);
  assert.equal(isFreeModel("opencode/deepseek-v4.1-flash"), false);
  assert.equal(isFreeModel("openrouter/openai/gpt-6.1-terra-pro"), false);
});

test("parseModelIds drops blanks, comments and non-ids", () => {
  assert.deepEqual(parseModelIds("\n# comment\nopencode/a-free\nnot-a-model\n"), ["opencode/a-free"]);
  assert.deepEqual(parseModelIds(""), []);
});

test("pickFreeModel never returns a paid id", () => {
  assert.equal(pickFreeModel(MIXED), "opencode/deepseek-v4.1-flash-free");
  assert.equal(pickFreeModel(["opencode/deepseek-v4.1-flash"]), null);
  assert.equal(pickFreeModel([]), null);
});

test("pickFreeModel honours the preference, then the CLI's own order", () => {
  assert.equal(pickFreeModel(["opencode/beam-free", "opencode/deepseek-v4.1-flash-free"], "deepseek"), "opencode/deepseek-v4.1-flash-free");
  // No match → first free, deterministically (not whichever wins a race).
  assert.equal(pickFreeModel(["opencode/beam-free", "opencode/glm-5.3-flash-free"], "kimi"), "opencode/beam-free");
  assert.equal(DEFAULT_FREE_PREFER, "deepseek");
});

test("opencode resolves a free model from the live list", () => {
  const plan = planCliModel({ cliId: "opencode", freeModels: FREE });
  assert.deepEqual(plan, { ok: true, model: "opencode/deepseek-v4.1-flash-free", source: "free-list", paid: false });
});

test("opencode REFUSES to run when no free model exists", () => {
  // The whole point: falling back to opencode's own default is what billed a
  // paid model. A missing free option must stop the run, not choose one.
  const plan = planCliModel({ cliId: "opencode", freeModels: ["opencode/deepseek-v4.1-flash"] });
  assert.equal(plan.ok, false);
  assert.match(plan.error, /No free opencode model/);
});

test("opencode REFUSES when the model list could not be read", () => {
  const plan = planCliModel({ cliId: "opencode", freeModels: null, freeListError: "boom" });
  assert.equal(plan.ok, false);
  assert.match(plan.error, /boom/);
});

test("an explicit env model is honoured and flagged when paid", () => {
  const free = planCliModel({ cliId: "opencode", env: { CAREER_OPS_MODEL_OPENCODE: "opencode/beam-free" }, freeModels: [] });
  assert.deepEqual(free, { ok: true, model: "opencode/beam-free", source: "env", paid: false });

  const paid = planCliModel({ cliId: "opencode", env: { CAREER_OPS_MODEL_OPENCODE: "openrouter/openai/gpt-6.1-terra-pro" }, freeModels: FREE });
  assert.deepEqual(paid, { ok: true, model: "openrouter/openai/gpt-6.1-terra-pro", source: "env", paid: true });
});

test("pi uses its own pinned default, and never refuses", () => {
  // paid: true is the honest fact — deepseek-v4.1-flash bills $0.15/$0.60 per M.
  // It is the user's OWN pin, so modelLabel does not mark it below.
  assert.deepEqual(
    planCliModel({ cliId: "pi", piDefaultModel: "deepseek/deepseek-v4.1-flash-1017" }),
    { ok: true, model: "deepseek/deepseek-v4.1-flash-1017", source: "pi-settings", paid: true },
  );
  // Unreadable settings: pi decides, and the badge says so instead of inventing.
  assert.deepEqual(planCliModel({ cliId: "pi", piDefaultModel: null }), {
    ok: true,
    model: null,
    source: "cli-default",
    paid: false,
  });
});

test("a CLI whose argv cannot carry a model is REFUSED", () => {
  // grok/copilot/qwen/antigravity/hermes have no model flag in their argv, so
  // "pin it" is not an offer we can keep. Refusing is the only honest answer:
  // the alternative is running on whatever that CLI decides, which is the
  // unbounded path that billed a paid model.
  for (const cliId of ["grok", "copilot", "qwen", "antigravity", "hermes"]) {
    const plan = planCliModel({ cliId, freeModels: [] });
    assert.equal(plan.ok, false, cliId);
    assert.match(plan.error, /cannot be pinned/);
  }
});

test("a pinnable CLI with no resolved model is refused, and names the fix", () => {
  for (const cliId of ["claude", "codex"]) {
    const plan = planCliModel({ cliId, freeModels: [] });
    assert.equal(plan.ok, false, cliId);
    assert.match(plan.error, new RegExp(`CAREER_OPS_MODEL_${cliId.toUpperCase()}`));
  }
});

test("an explicit env model makes claude/codex runnable again", () => {
  assert.deepEqual(planCliModel({ cliId: "claude", env: { CAREER_OPS_MODEL_CLAUDE: "claude-haiku-4-5" } }), {
    ok: true,
    model: "claude-haiku-4-5",
    source: "env",
    paid: true,
  });
});

test("CAREER_OPS_ALLOW_UNPINNED=1 restores the permissive behaviour", () => {
  assert.deepEqual(planCliModel({ cliId: "grok", env: { CAREER_OPS_ALLOW_UNPINNED: "1" } }), {
    ok: true,
    model: null,
    source: "cli-default",
    paid: false,
  });
  // Anything but 1/true leaves the refusal in place.
  assert.equal(planCliModel({ cliId: "grok", env: { CAREER_OPS_ALLOW_UNPINNED: "0" } }).ok, false);
});

test("modelLabel shows the model, and marks a paid one", () => {
  assert.equal(modelLabel("OpenCode", { ok: true, model: "opencode/beam-free", source: "free-list", paid: false }), "OpenCode · opencode/beam-free");
  assert.equal(
    modelLabel("OpenCode", { ok: true, model: "openrouter/openai/gpt-6.1-terra-pro", source: "env", paid: true }),
    "OpenCode · openrouter/openai/gpt-6.1-terra-pro (paid)",
  );
  assert.equal(modelLabel("Pi", { ok: true, model: null, source: "cli-default", paid: false }), "Pi · CLI default");
  assert.equal(modelLabel("Pi", { ok: false, error: "x" }), "Pi · no model");
  // The user's own pi pin is paid but expected: no marker, or the marker stops
  // meaning anything on the run that is actually expensive.
  assert.equal(
    modelLabel("Pi", { ok: true, model: "deepseek/deepseek-v4.1-flash-1017", source: "pi-settings", paid: true }),
    "Pi · deepseek/deepseek-v4.1-flash-1017",
  );
});
