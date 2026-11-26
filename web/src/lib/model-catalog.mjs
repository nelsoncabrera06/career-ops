/**
 * `opencode models` (one id per line) → the grouped list Config renders.
 *
 * The provider is the FIRST path segment, which is how both opencode and pi
 * spell their ids — `opencode-go/deepseek-v4.1-flash`, `openrouter/anthropic/
 * claude-sonnet-5-5`, `deepseek/deepseek-v4.1-flash-1017`. Grouping by that
 * segment is what turns a 439-line dump into "these are your providers, these
 * are their models", which is the distinction the engine list alone cannot
 * make: OpenCode is one engine that reaches many providers, so the provider a
 * run bills is chosen HERE, not by picking the engine.
 *
 * Pure: no I/O, so `node --test` exercises the real grouping.
 */
import { isFreeModel } from "./cli-model.mjs";

/**
 * @typedef {{ id: string, name: string, free: boolean }} CatalogModel
 * @typedef {{ provider: string, models: CatalogModel[] }} CatalogGroup
 */

/**
 * @param {string[]} ids model ids as `opencode models` prints them
 * @returns {CatalogGroup[]} providers A→Z, models A→Z inside each
 */
export function modelCatalog(ids) {
  /** @type {Map<string, CatalogModel[]>} */
  const byProvider = new Map();
  for (const raw of ids || []) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id || !id.includes("/")) continue;
    const slash = id.indexOf("/");
    const provider = id.slice(0, slash);
    const name = id.slice(slash + 1);
    if (!provider || !name) continue;
    const group = byProvider.get(provider) ?? [];
    // One entry per id: `opencode models` can list the same id twice (a
    // provider configured twice), and a duplicated row cannot be told apart
    // when it is the selection that is being shown.
    if (group.some((m) => m.id === id)) continue;
    group.push({ id, name, free: isFreeModel(id) });
    byProvider.set(provider, group);
  }
  return [...byProvider.entries()]
    .map(([provider, models]) => ({ provider, models: models.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

/**
 * Case-insensitive substring filter over ids — "deepseek" must find
 * `opencode-go/deepseek-v4.1-flash` without the user knowing the provider
 * prefix. Groups left empty disappear.
 *
 * @param {CatalogGroup[]} catalog
 * @param {string} query
 * @returns {CatalogGroup[]}
 */
export function filterCatalog(catalog, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return catalog || [];
  return (catalog || [])
    .map((g) => ({
      ...g,
      models: g.models.filter((m) => m.id.toLowerCase().includes(needle)),
    }))
    .filter((g) => g.models.length > 0);
}

/** How many models a catalog holds (`439 models across 4 providers`). */
export function catalogSize(catalog) {
  const groups = catalog || [];
  return {
    models: groups.reduce((n, g) => n + g.models.length, 0),
    providers: groups.length,
  };
}

/**
 * Explain, in one sentence, where the effective model came from.
 *
 * The source is the honest part of the choice: a run pinned by `CAREER_OPS_MODEL_*`
 * in the environment ignores what this page saves, and saying "chosen here"
 * while the environment wins would make the picker look broken.
 *
 * @param {string} source plan.source from cli-model.mjs
 * @param {string | null} envValue the env override the server saw, when any
 * @param {string} [envKey] e.g. CAREER_OPS_MODEL_OPENCODE
 * @returns {{ text: string, override: boolean }}
 */
export function sourceNote(source, envValue, envKey) {
  switch (source) {
    case "saved":
      return { text: "Chosen here — applies to every run this app starts.", override: false };
    case "env":
      return {
        text: `Pinned by ${envKey || "CAREER_OPS_MODEL"} in your environment, which wins over this page. Unset it to choose here.`,
        override: true,
      };
    case "free-list":
      return { text: "Automatic: a free model this CLI reports, so a run cannot bill you by surprise.", override: false };
    case "pi-settings":
      return { text: "From your own pi settings (~/.pi/agent/settings.json).", override: envValue ? true : false };
    case "cli-default":
      return { text: "The CLI decides its own default — this runtime accepts no model flag here.", override: false };
    default:
      return { text: "", override: false };
  }
}
