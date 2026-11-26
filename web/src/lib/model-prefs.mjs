/**
 * Which model each AI engine should run — `data/web-settings.json`.
 *
 * WHY A SERVER-SIDE FILE, not localStorage (where the engine pick lives):
 *   The model decides what a run costs and which provider it bills, and the
 *   decision is made SERVER-side, in cli-model.mjs, by every route that spawns
 *   a CLI. localStorage is invisible to those routes, so a choice stored there
 *   would look saved in Config while every run kept using something else — the
 *   exact "highlight-only looks configured" failure saved-cli.ts documents for
 *   the engine pick. This file is read by run-model.ts, so what Config shows is
 *   what a run gets.
 *
 * Precedence (cli-model.mjs): an explicit `CAREER_OPS_MODEL_<CLI>` in the
 * environment beats this file, and this file beats the automatic free pick.
 * The environment is the operator's escape hatch, so it wins — and Config says
 * so out loud instead of silently looking ignored.
 *
 * Shape (a plain object, forward-compatible by ignoring unknown keys):
 *   { "version": 1, "models": { "opencode": "opencode-go/deepseek-v4.1-flash" } }
 *
 * An absent / empty entry means "Automatic": the policy's own pick.
 *
 * Kept free of Next imports (fs/path only) so `node --test` can exercise it.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const PREFS_FILE_REL = path.join("data", "web-settings.json");
export const MAX_MODEL_LEN = 120;

/** A CLI id as clis.ts spells it (`opencode`, `claude`, `qwen`, …). */
const CLI_ID_RE = /^[a-z][a-z0-9._-]{0,31}$/;

/**
 * The id shapes the agent CLIs actually accept, in ONE argv element:
 *   opencode-go/deepseek-v4.1-flash
 *   openrouter/anthropic/claude-sonnet-5-5
 *   deepseek/deepseek-v4.1-flash-1017
 *   claude-haiku-4-5:1m
 * No whitespace and no shell metacharacters — argv is spawned without a shell,
 * but a value that could only work through a shell is a mistake worth refusing.
 */
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,119}$/;

/** Absolute path of the prefs file for a career-ops data root. */
export function prefsPath(root) {
  return path.join(root, PREFS_FILE_REL);
}

/**
 * @param {unknown} raw
 * @returns {string | null} the id, or null when it is not a usable model id.
 */
export function normalizeModelId(raw) {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || id.length > MAX_MODEL_LEN) return null;
  if (!MODEL_ID_RE.test(id)) return null;
  // No empty path segments: `foo//bar` and a trailing slash are typos, and a CLI
  // told to run them fails inside the run instead of here.
  if (id.split("/").some((segment) => segment === "")) return null;
  return id;
}

/** @param {unknown} raw @returns {string | null} */
export function normalizeCliId(raw) {
  const id = typeof raw === "string" ? raw.trim() : "";
  return CLI_ID_RE.test(id) ? id : null;
}

/**
 * Every saved choice, by CLI id. Tolerant by design: a hand-edited or truncated
 * file must degrade to "Automatic", never take a run down — an unusable entry is
 * dropped and the rest of the file still applies.
 *
 * @param {string} root career-ops data root
 * @returns {Record<string, string>}
 */
export function readModelPrefs(root) {
  return prefsFrom(readRawPrefs(root));
}

/**
 * The raw parsed file (for the writer, which must not drop keys it does not
 * know about — a later version of this file may hold more than models).
 */
function readRawPrefs(root) {
  let raw;
  try {
    raw = fs.readFileSync(prefsPath(root), "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/** Valid entries only: an unusable one is dropped, the rest of the file applies. */
function prefsFrom(parsed) {
  const models = parsed?.models;
  if (!models || typeof models !== "object" || Array.isArray(models)) return {};
  const out = {};
  for (const [cliId, value] of Object.entries(models)) {
    const cli = normalizeCliId(cliId);
    const model = normalizeModelId(value);
    if (cli && model) out[cli] = model;
  }
  return out;
}

/** The model saved for one CLI, or null for "Automatic". */
export function savedModelFor(root, rawCliId) {
  const cliId = normalizeCliId(rawCliId);
  if (!cliId) return null;
  return readModelPrefs(root)[cliId] ?? null;
}

function atomicWriteJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* the write already failed; the leftover is unstageable */
    }
    throw err;
  }
}

// Two tabs saving at once must not lose one choice to a stale read. Cross-process
// writes are not covered (nothing else writes this file), and the .bak keeps a
// hand edit recoverable.
let chain = Promise.resolve();
function serialize(fn) {
  const next = chain.then(fn, fn);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function backupOnce(file) {
  try {
    if (!fs.existsSync(file)) return;
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const bak = `${file}.bak-${stamp}`;
    if (fs.existsSync(bak)) return;
    fs.copyFileSync(file, bak);
  } catch {
    /* a failed backup must never block the save itself */
  }
}

/**
 * Save one CLI's model choice, or clear it with `null` / `""` → "Automatic".
 *
 * `allowed` is the catalog the caller could enumerate (opencode's live list).
 * When it is available the id MUST be in it: a typo or a model that rotated out
 * of the list is refused here, instead of being written, silently accepted by
 * Config, and then failing on the next run with the CLI's own error. CLIs with
 * no list command pass `allowed: null` and get shape validation only.
 *
 * @param {string} root career-ops data root
 * @param {unknown} rawCliId
 * @param {unknown} rawModel
 * @param {string[] | null} [allowed]
 * @returns {Promise<{ ok: true, cliId: string, model: string | null } | { ok: false, error: string }>}
 */
export function saveModelFor(root, rawCliId, rawModel, allowed = null) {
  const cliId = normalizeCliId(rawCliId);
  if (!cliId) return Promise.resolve({ ok: false, error: "cli must be a CLI id such as 'opencode'" });

  const isAutomatic = rawModel === null || rawModel === undefined || rawModel === "";
  if (!isAutomatic) {
    const model = normalizeModelId(rawModel);
    if (!model) return Promise.resolve({ ok: false, error: "that is not a valid model id (expected provider/model)" });
    if (allowed && !allowed.includes(model)) {
      return Promise.resolve({ ok: false, error: `'${model}' is not in the model list this CLI reports` });
    }
  }
  const model = isAutomatic ? null : normalizeModelId(rawModel);

  return serialize(() => {
    const file = prefsPath(root);
    const raw = readRawPrefs(root);
    const models = prefsFrom(raw);

    if (model === null) {
      if (!(cliId in models)) return { ok: true, cliId, model: null }; // idempotent
      delete models[cliId];
    } else {
      if (models[cliId] === model) return { ok: true, cliId, model }; // idempotent
      models[cliId] = model;
    }
    backupOnce(file);
    // Spread the previous file so keys this version does not know about (a
    // future setting saved by a newer web build sharing the same data root)
    // survive a save here instead of being silently deleted.
    atomicWriteJson(file, { ...raw, version: raw.version ?? 1, models });
    return { ok: true, cliId, model };
  });
}
