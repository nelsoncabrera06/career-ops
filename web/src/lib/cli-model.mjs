/**
 * cli-model.mjs — which model a headless CLI run is ALLOWED to use.
 *
 * Why this module exists (2026-10-28): `opencode run` with no `--model`
 * resolves opencode's OWN default. That default is not the model the user
 * picked in the opencode TUI (`~/.local/state/opencode/model.json` is a TUI
 * recent list that `run` never reads), so it can drift to whatever provider the
 * environment happens to expose. On this machine `OPENROUTER_API_KEY` is
 * exported in the user's shell, the Next server inherits it, and five
 * form-answer runs billed `openai/gpt-6.1-terra-pro` — $1.00/M in, $5.00/M out,
 * ~$0.90 total — while the user believed everything was running on a free
 * deepseek model.
 *
 * The lesson that shapes the policy below: "it was free yesterday" is not a
 * guarantee, because free model ids rotate week to week. So:
 *
 *   1. CAREER_OPS_MODEL_<CLIID>, then CAREER_OPS_MODEL — an explicit choice
 *      always wins. A non-free id is allowed here (the user asked for it) but is
 *      reported as `paid` so the UI can flag it instead of hiding it.
 *   2. opencode — a FREE model read from the live `opencode models` list at run
 *      time. Nothing is pinned in code, so a rotation costs at worst a
 *      re-pick, never a silent paid run. NO free model resolves → the run is
 *      REFUSED. Falling back to opencode's own default is precisely the
 *      failure this module exists to prevent.
 *   3. pi — the `defaultModel` from the user's own `~/.pi/agent/settings.json`,
 *      passed as `--model` so the run cannot drift from that pin either.
 *   4. anything else — REFUSED. Acceptance rule, stated once: every run either
 *      names the model it will use AND hands it to the CLI, or it does not run.
 *      A CLI we cannot pin (grok, copilot, qwen, antigravity, hermes: no model
 *      flag in their argv) has no second option but "whatever it decides", and
 *      that is the same unbounded path that made opencode bill. An operator who
 *      accepts that trade can set CAREER_OPS_ALLOW_UNPINNED=1, which restores
 *      the old permissive behaviour and says `cli-default` out loud.
 *
 * Pure: no I/O, no subprocesses. `run-model.ts` does the reading and passes the
 * results in, which is what makes every branch here testable.
 */

export const MODEL_ENV = "CAREER_OPS_MODEL";

/** Opt back into "let the CLI decide". Anything but 1/true leaves the refusal. */
export const ALLOW_UNPINNED_ENV = "CAREER_OPS_ALLOW_UNPINNED";

/**
 * CLIs whose argv can carry an explicit model (see `args` in clis.ts).
 * The list is a claim about the ARGV, not about the vendor: a CLI that would
 * silently ignore the flag is not pinnable, and pretending otherwise would
 * report a model the run never received.
 */
export const PINNABLE_CLIS = ["opencode", "pi", "claude", "codex"];

/** `CAREER_OPS_MODEL_OPENCODE`, `CAREER_OPS_MODEL_CLAUDE`, … */
export function envKeyFor(cliId) {
  return `${MODEL_ENV}_${String(cliId || "").replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
}

/**
 * The explicit model the environment names for this CLI, or null.
 * Per-CLI beats the global var: a global value would otherwise pin every CLI to
 * one provider's model id, which only opencode/pi ids could satisfy.
 */
export function explicitModel(cliId, env = {}) {
  const per = env?.[envKeyFor(cliId)];
  if (typeof per === "string" && per.trim()) return per.trim();
  const all = env?.[MODEL_ENV];
  if (typeof all === "string" && all.trim()) return all.trim();
  return null;
}

/**
 * opencode Zen marks a free model with a `-free` suffix
 * (`opencode/deepseek-v4.1-flash-free`). Every free id observed follows it, and
 * no paid id does, so the suffix is the whole test.
 */
export function isFreeModel(id) {
  return typeof id === "string" && /-free$/.test(id.trim());
}

/** `opencode models` output → ids. Ignores blank lines and comments. */
export function parseModelIds(stdout) {
  return String(stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("/"));
}

export const DEFAULT_FREE_PREFER = "deepseek";

/**
 * A free model id, preferring one whose name contains `prefer`.
 *
 * Deterministic on purpose: the CLI's own order decides among equally-good
 * candidates, so repeated runs pick the same model instead of flipping between
 * free options mid-session.
 */
export function pickFreeModel(ids, prefer = DEFAULT_FREE_PREFER) {
  const free = (ids || []).filter(isFreeModel);
  if (!free.length) return null;
  const needle = String(prefer || "").toLowerCase();
  const preferred = needle ? free.find((id) => id.toLowerCase().includes(needle)) : null;
  return preferred || free[0];
}

/**
 * @typedef {{ ok: true, model: string|null, source: string, paid: boolean }} PlanOk
 *   `model: null` means the CLI runs on its own default, which some runtimes
 *   (grok, copilot, …) do not let us name up front.
 * @typedef {{ ok: false, error: string }} PlanFail
 */

/**
 * Decide the model for one run.
 *
 * @param {object} opts
 * @param {string} opts.cliId
 * @param {Record<string,string|undefined>} [opts.env]
 * @param {string[]|null} [opts.freeModels] from `opencode models`, or null when unknown
 * @param {string|null} [opts.freeListError] why the list could not be read
 * @param {string|null} [opts.piDefaultModel] `defaultModel` from pi's settings.json
 * @param {string} [opts.prefer]
 * @returns {PlanOk|PlanFail}
 */
export function planCliModel({
  cliId,
  env = {},
  freeModels = null,
  freeListError = null,
  piDefaultModel = null,
  prefer = DEFAULT_FREE_PREFER,
}) {
  const explicit = explicitModel(cliId, env);
  if (explicit) {
    return { ok: true, model: explicit, source: "env", paid: !isFreeModel(explicit) };
  }

  const allowUnpinned = (() => {
    const v = env?.[ALLOW_UNPINNED_ENV];
    return v === "1" || v === "true";
  })();

  if (cliId === "opencode") {
    if (freeListError) {
      return {
        ok: false,
        error:
          `Could not read opencode's model list (${freeListError}). Refusing to run: ` +
          "opencode without --model falls back to its own default, which has billed a paid " +
          `OpenRouter model before. Fix the list, or set ${envKeyFor("opencode")}=provider/model, ` +
          "or switch the CLI to pi.",
      };
    }
    const picked = pickFreeModel(freeModels || [], prefer);
    if (!picked) {
      return {
        ok: false,
        error:
          "No free opencode model found. Refusing to run rather than let opencode choose its " +
          `own (possibly paid) default. Set ${envKeyFor("opencode")}=provider/model to pick one ` +
          "explicitly, or switch the CLI to pi.",
      };
    }
    return { ok: true, model: picked, source: "free-list", paid: false };
  }

  if (cliId === "pi") {
    if (piDefaultModel) {
      return { ok: true, model: piDefaultModel, source: "pi-settings", paid: !isFreeModel(piDefaultModel) };
    }
    // No readable pi default: let pi apply its own, and say so honestly.
    return { ok: true, model: null, source: "cli-default", paid: false };
  }

  if (allowUnpinned) return { ok: true, model: null, source: "cli-default", paid: false };

  if (!PINNABLE_CLIS.includes(cliId)) {
    return {
      ok: false,
      error:
        `'${cliId}' cannot be pinned to a model — its argv has no model flag, so a run would ` +
        "use whatever that CLI decides on its own (the unbounded path that billed a paid " +
        "OpenRouter model here). Use pi or opencode, or set " +
        `${envKeyFor(cliId)}=provider/model if this CLI does accept one, or accept the ` +
        `trade explicitly with ${ALLOW_UNPINNED_ENV}=1.`,
    };
  }
  return {
    ok: false,
    error:
      `No model resolved for '${cliId}'. Refusing to run rather than let it pick its own. ` +
      `Set ${envKeyFor(cliId)}=provider/model (or ${MODEL_ENV}), or switch the CLI to pi.`,
  };
}

/**
 * One-line badge text for the UI: `opencode · deepseek-v4.1-flash-free`.
 *
 * `plan.paid` is deliberately NOT the only input. It is the honest fact
 * (`!isFreeModel`), and for pi's own pinned deepseek it is `true` because that
 * model bills $0.15/$0.60 per M — cheap, but not free. Marking it on every
 * normal chat turn would train the user to ignore the marker, so it is shown
 * only where it carries information: a model this module picked automatically
 * (nothing automatic is ever paid by construction) or one the environment
 * pinned. The user's OWN pi default gets no marker — they chose it, and its
 * name already says which model it is.
 */
export function modelLabel(cliName, plan) {
  const name = cliName || "CLI";
  if (!plan || plan.ok === false) return `${name} · no model`;
  const model = plan.model || "CLI default";
  const memorable = plan.paid && plan.source !== "pi-settings";
  return `${name} · ${model}${memorable ? " (paid)" : ""}`;
}
