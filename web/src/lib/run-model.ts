import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseModelIds, planCliModel } from "./cli-model.mjs";
import type { CliSpec } from "./clis";

/**
 * run-model.ts — the I/O half of the model policy.
 *
 * `cli-model.mjs` decides; this reads the two inputs it needs (opencode's live
 * model list, pi's pinned default) and hands them over. Kept apart so the
 * decision is testable without spawning anything.
 *
 * Both reads are cached: `opencode models` shells out, and every chat turn and
 * every form field would otherwise pay for it.
 */

/** Free ids rotate weekly, not by the second — 10 minutes is plenty. */
const MODELS_TTL_MS = 10 * 60 * 1000;
/** `opencode models` is a local list, but a hung binary must not hang a request. */
const MODELS_TIMEOUT_MS = 15_000;

type ModelList = { ids: string[] | null; error: string | null };

const modelListCache = new Map<string, { at: number; value: ModelList }>();

/**
 * `opencode models` → the ids this install can reach.
 *
 * A failure is NOT swallowed into "no models": `planCliModel` treats an
 * unreadable list as a refusal, because the alternative is falling back to the
 * exact billable default this whole policy exists to avoid.
 */
export function listOpencodeModels(binPath: string): ModelList {
  const cached = modelListCache.get(binPath);
  if (cached && Date.now() - cached.at < MODELS_TTL_MS) return cached.value;

  let value: ModelList;
  try {
    const stdout = execFileSync(binPath, ["models"], {
      encoding: "utf8",
      timeout: MODELS_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const ids = parseModelIds(stdout);
    value = ids.length ? { ids, error: null } : { ids: null, error: "the models command listed nothing" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    value = { ids: null, error: msg.slice(0, 200) };
  }
  modelListCache.set(binPath, { at: Date.now(), value });
  return value;
}

let piCache: { at: number; model: string | null } | null = null;

/**
 * pi's own pinned default, from `~/.pi/agent/settings.json`.
 *
 * This is the user's file, not ours: passing it as `--model` makes a headless
 * run land on the same model the interactive session uses, instead of trusting
 * that pi's resolution order stays put.
 */
export function readPiDefaultModel(): string | null {
  if (piCache && Date.now() - piCache.at < MODELS_TTL_MS) return piCache.model;
  let model: string | null = null;
  try {
    const p = path.join(os.homedir(), ".pi", "agent", "settings.json");
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as { defaultModel?: unknown };
    if (typeof raw.defaultModel === "string" && raw.defaultModel.trim()) model = raw.defaultModel.trim();
  } catch {
    /* absent settings = pi decides, and the badge says so */
  }
  piCache = { at: Date.now(), model };
  return model;
}

export type RunModel =
  | { ok: true; model: string | null; source: string; paid: boolean }
  | { ok: false; error: string };

/**
 * The model this run will use, resolved per the policy in cli-model.mjs.
 *
 * Only `opencode` can fail: it is the runtime whose "no model" path has a
 * history of picking a paid provider on its own.
 */
export function resolveRunModel(spec: CliSpec, binPath: string): RunModel {
  let freeModels: string[] | null = null;
  let freeListError: string | null = null;
  if (spec.id === "opencode") {
    const list = listOpencodeModels(binPath);
    freeModels = list.ids;
    freeListError = list.error;
  }
  return planCliModel({
    cliId: spec.id,
    env: process.env,
    freeModels,
    freeListError,
    piDefaultModel: spec.id === "pi" ? readPiDefaultModel() : null,
  });
}

/** Test seam: drop the caches so a later call re-reads. */
export function resetRunModelCaches() {
  modelListCache.clear();
  piCache = null;
}
