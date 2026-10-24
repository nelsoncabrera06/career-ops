/**
 * company-aliases.mjs — "this posting is the same employer under three brands".
 *
 * The problem it solves: an Argentine group posts one role through its staffing
 * arm, under the end employer's name in the body, and the holding's name in the
 * footer. ZonaJobs listed "Netkel Consulting", the ad text opened with "En Cosys
 * Global estamos en la búsqueda…", and the interview invite came signed "Grupo
 * Kelsoft". The tracker can only hold ONE company string, so a search for the
 * two names that aren't in the row returns nothing — the posting looks lost even
 * though it is right there.
 *
 * The fix is deliberately NOT to stuff three names into the `company` cell: that
 * field is the identity key for logos, analytics, dedup and the tracker's own
 * tooling (core/company-history.mjs, tracker-merge). Instead the aliases live in
 * their own user file (`data/company-aliases.json`), are attached to a row only
 * for DISPLAY and SEARCH, and never rewrite the row.
 *
 * Pure on purpose (no fs, no Next): the client components that search and render
 * rows import this directly, and `node --test` can exercise the real functions.
 * The file read lives in career-ops.ts, next to every other data-file reader.
 */

/**
 * Fold a company name to its matching form: accents removed, lowercased, and
 * every run of non-alphanumerics collapsed to a single space.
 *
 * Accent folding matters here — "Tecnología" and "Tecnologia" are the same
 * employer as far as a user typing into a search box is concerned, and the
 * source files are hand-written in Spanish.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function normalizeCompanyName(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * @typedef {{names: string[], note?: string}} CompanyGroup
 */

/**
 * Parse `data/company-aliases.json`.
 *
 * Accepts the documented shape
 *   `{ "groups": [{ "names": ["A", "B"], "note": "why" }] }`
 * and, for hand-editing convenience, a bare array of groups or of name arrays
 * (`[["A","B"]]`). Anything malformed is SKIPPED rather than thrown: a bad entry
 * must not take the whole pipeline page down, and a group with fewer than two
 * usable names carries no information anyway.
 *
 * @param {unknown} raw - parsed JSON, or a JSON string, or nothing.
 * @returns {CompanyGroup[]}
 */
export function parseCompanyGroups(raw) {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!value || typeof value !== "object") return [];
  const list = Array.isArray(value) ? value : Array.isArray(value.groups) ? value.groups : [];

  /** @type {CompanyGroup[]} */
  const groups = [];
  for (const entry of list) {
    const names = Array.isArray(entry) ? entry : entry && typeof entry === "object" ? entry.names : null;
    if (!Array.isArray(names)) continue;
    // Trim + drop blanks BEFORE dedupe, so "Netkel " and "Netkel" collapse.
    const cleaned = [];
    const seen = new Set();
    for (const name of names) {
      if (typeof name !== "string") continue;
      const display = name.trim();
      const key = normalizeCompanyName(display);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      cleaned.push(display);
    }
    if (cleaned.length < 2) continue;
    /** @type {CompanyGroup} */
    const group = { names: cleaned };
    if (entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.note === "string" && entry.note.trim()) {
      group.note = entry.note.trim();
    }
    groups.push(group);
  }
  return groups;
}

/**
 * Every OTHER brand in the same group as `name`, in the group's own order.
 *
 * Returns `[]` for a company no group mentions, so callers can stay
 * unconditional (`aliasesOf(x, groups).map(render)`) instead of branching.
 *
 * @param {unknown} name
 * @param {CompanyGroup[]} groups
 * @returns {string[]}
 */
export function aliasesOf(name, groups) {
  const key = normalizeCompanyName(name);
  if (!key || !Array.isArray(groups)) return [];
  for (const group of groups) {
    const keys = group.names.map(normalizeCompanyName);
    if (!keys.includes(key)) continue;
    return group.names.filter((n) => normalizeCompanyName(n) !== key);
  }
  return [];
}

/**
 * The rows a query should match for one company: the name itself plus its
 * aliases. Used by the search boxes so `kelsoft` finds a row filed as "Netkel".
 *
 * @param {unknown} name
 * @param {CompanyGroup[]} groups
 * @returns {string[]}
 */
export function searchableCompanyNames(name, groups) {
  const self = String(name ?? "").trim();
  return self ? [self, ...aliasesOf(self, groups)] : aliasesOf(self, groups);
}
