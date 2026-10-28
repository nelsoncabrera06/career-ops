/**
 * my-data.mjs — the "My data" tab's model over config/profile.yml.
 *
 * WHY THIS EXISTS
 *
 * A job search needs facts that never belong on a CV: date of birth (age gates,
 * some forms), nationality and document number (paperwork), notice period,
 * availability date, relocation/travel appetite, desired salary and floor,
 * languages with levels, and the EEO answers application forms insist on. None
 * of that is a CV line, all of it is asked repeatedly, and every mode already
 * reads config/profile.yml ALWAYS — so profile.yml is where it lives (it is the
 * "single source of truth for your personal data", per its own header). A
 * separate file would be out of the Source-of-Truth Boundary and every mode
 * would silently ignore it.
 *
 * WHY NOT A PLAIN yaml.dump OF THE WHOLE FILE
 *
 * The rest of the file is hand-written and heavily commented (archetypes,
 * narrative, location policy, language notes). Re-emitting it through
 * yaml.dump() would silently delete every comment — the one thing the user
 * cannot recover from a .bak without diffing. So the writer is SURGICAL, in two
 * modes:
 *
 *   - A section that already exists in the file (`compensation:` today, with
 *     the user's own provenance comments inside it) is patched LINE BY LINE:
 *     only the `  key: value` lines the form owns are rewritten, so comments,
 *     ordering and keys the form does not show are untouched.
 *   - A section that does not exist yet (`personal:`, `availability:`,
 *     `languages:`) is written into ONE marker-delimited block at the end of
 *     the file, which this module owns and rewrites wholesale.
 *
 * Either way the result is re-parsed and compared against the intent before it
 * is handed back. That is not decoration: a line-based edit that eats the wrong
 * lines is exactly the data-loss class this repo keeps a .bak chain for. If the
 * re-parse disagrees, the write is refused, not attempted.
 *
 * AUTHORITY
 *
 * The form is authoritative for the fields it shows. A field the payload omits
 * is left untouched; a field the payload sends as an empty string is removed.
 * Any key living inside a managed block that the form does not know about is
 * preserved (a hand-written extra in `personal:` survives a UI save).
 *
 * Ported nowhere: pure functions, no fs, no YAML-file IO — so `node --test` can
 * pin all of the above (tests/lib/my-data.test.mjs).
 */

import * as yaml from "js-yaml";
import {
  BLOCK_END,
  BLOCK_START,
  FIELDS,
  LIST_KEY,
  MANAGED_KEYS,
  MyDataError,
  PROFILE_FILE,
  asScalarString,
  isPlainObject,
  normalizePayload,
} from "./my-data-spec.mjs";

// Re-exported so callers (and the test suite) keep one import path for the
// whole feature; the browser-facing editor imports my-data-spec.mjs directly.
export {
  BLOCK_END,
  BLOCK_START,
  FIELDS,
  LIST_KEY,
  MANAGED_KEYS,
  MyDataError,
  PROFILE_FILE,
  ageFrom,
  normalizeField,
  normalizePayload,
} from "./my-data-spec.mjs";

// ------------------------------------------------------------------ parsing

/** Validate the profile text as a YAML mapping. */
export function parseProfile(text) {
  // js-yaml refuses an empty document, but "empty" and "comment-only" are the
  // normal state on a fresh install — this writer is allowed to fill them in.
  // A real scalar/list/null document is broken and still refused below.
  const content = String(text || "")
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("#"));
  if (!content.length) return {};

  let parsed;
  try {
    parsed = yaml.load(text);
  } catch (err) {
    throw new MyDataError("INVALID_PROFILE", `config/${PROFILE_FILE} is not valid YAML: ${String(err.message).split("\n")[0]}`);
  }
  if (parsed === undefined) parsed = {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MyDataError(
      "INVALID_PROFILE",
      `config/${PROFILE_FILE} must contain named settings, not a list or single value — refusing to touch it.`,
    );
  }
  return parsed;
}

/** The published list of languages, normalized for the editor. */
function readLanguages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => isPlainObject(e) && asScalarString(e.language).trim())
    .map((e) => ({ language: asScalarString(e.language), level: asScalarString(e.level) }));
}

/**
 * What the tab shows for an existing profile. Unknown keys inside a managed
 * section are NOT returned (the form cannot represent them) but the writer
 * preserves them — see mergeMyData().
 *
 * @returns {{ values: Record<string, string>, languages: {language: string, level: string}[] }}
 */
export function readMyData(text) {
  const parsed = parseProfile(text);
  const values = {};
  for (const field of FIELDS) {
    const [section, key] = field.path.split(".");
    const node = parsed[section];
    values[field.path] = isPlainObject(node) ? asScalarString(node[key]) : "";
  }
  return { values, languages: readLanguages(parsed[LIST_KEY]) };
}

// --------------------------------------------------------- text-level edits

function detectNewline(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** Remove the marker-delimited block this module writes, if present. */
function stripBlock(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === BLOCK_START.trim());
  if (start === -1) return text;
  const end = lines.findIndex((l, i) => i > start && l.trim() === BLOCK_END.trim());
  const stop = end === -1 ? lines.length : end + 1;
  // Take the blank separator line(s) above the block with it.
  let from = start;
  while (from > 0 && lines[from - 1].trim() === "") from--;
  lines.splice(from, stop - from);
  return lines.join("\n");
}

/**
 * Remove one top-level `key:` block (its indented content plus its own leading
 * comment lines). Stops at the next line that starts a new top-level key, so a
 * comment that describes the NEXT section is never eaten.
 */
function stripTopLevelBlock(text, key) {
  const lines = text.split("\n");
  const startRe = new RegExp(`^${key}:[ \\t]*(#.*)?$`);
  const start = lines.findIndex((l) => startRe.test(l));
  if (start === -1) return text;

  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === "") {
      end++;
      continue;
    }
    const indented = /^[ \t]/.test(line);
    const listItem = /^[ \t]*[-*][ \t]/.test(line) || /^[ \t]*-\s*$/.test(line);
    if (indented || listItem) {
      end++;
      continue;
    }
    break;
  }
  // Blank lines before the next section are not part of this one.
  while (end > start + 1 && lines[end - 1].trim() === "") end--;

  // Leading comment lines directly above the key describe this key.
  let from = start;
  while (from > 0 && /^#/.test(lines[from - 1])) from--;

  lines.splice(from, end - from);
  return lines.join("\n");
}

/**
 * The span a `key: value` line occupies: the line itself plus any more-indented
 * continuation (a folded `>-` scalar, a nested mapping). Blank lines count only
 * when more-indented content follows, so a section separator is never eaten.
 */
function valueSpanEnd(lines, i) {
  const keyIndent = lines[i].match(/^[ \t]*/)[0].length;
  let end = i + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === "") {
      end++;
      continue;
    }
    const indent = line.match(/^[ \t]*/)[0].length;
    if (indent > keyIndent) {
      end++;
      continue;
    }
    break;
  }
  while (end > i + 1 && lines[end - 1].trim() === "") end--;
  return end;
}

/** Where a top-level `section:` block ends (exclusive). */
function sectionEnd(lines, start) {
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === "") {
      end++;
      continue;
    }
    if (/^[ \t]/.test(line)) {
      end++;
      continue;
    }
    break;
  }
  while (end > start + 1 && lines[end - 1].trim() === "") end--;
  return end;
}

function serializeScalar(key, value) {
  // These are short single-line facts (a salary, a mode, a currency). A newline
  // would turn the line into a block scalar and the in-place patch would have to
  // rewrite its indentation — flatten instead of pretending to support it.
  const one = String(value).replace(/\s*\n+\s*/g, " ").trim();
  return yaml.dump({ [key]: one }, { lineWidth: 100, noRefs: true }).trimEnd();
}

/**
 * Rewrite (or add, or remove) one immediate child of an existing top-level
 * section, in place. Comment lines and untouched keys stay exactly as they were.
 */
export function patchSectionKey(text, section, key, value) {
  const nl = detectNewline(text);
  const lines = text.split("\n");
  const startRe = new RegExp(`^${section}:[ \\t]*(#.*)?$`);
  const start = lines.findIndex((l) => startRe.test(l));
  if (start === -1) return null;
  const end = sectionEnd(lines, start);

  const keyRe = new RegExp(`^([ \\t]+)${key}:[ \\t]*(.*)$`);
  let at = -1;
  for (let i = start + 1; i < end; i++) {
    if (keyRe.test(lines[i])) {
      at = i;
      break;
    }
  }

  if (at !== -1) {
    const indent = lines[at].match(/^([ \t]+)/)[1];
    const stop = valueSpanEnd(lines, at);
    if (value === "") lines.splice(at, stop - at);
    else lines.splice(at, stop - at, ...serializeScalar(key, value).split("\n").map((l) => `${indent}${l}`));
    return lines.join("\n");
  }

  if (value === "") return lines.join("\n"); // nothing to remove

  // Insert as the section's last child, matching its existing indentation.
  let indent = null;
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(/^([ \t]+)\S/);
    if (m) {
      indent = m[1];
      break;
    }
  }
  if (indent === null) indent = "  ";
  const added = serializeScalar(key, value).split("\n").map((l) => `${indent}${l}`);
  lines.splice(end, 0, ...added);
  return lines.join(nl);
}

function serializeBlock(doc, keys, nl) {
  const present = keys.filter((k) => {
    const v = doc[k];
    if (Array.isArray(v)) return v.length > 0;
    return isPlainObject(v) && Object.keys(v).length > 0;
  });
  if (!present.length) return "";
  const subset = {};
  for (const k of present) subset[k] = doc[k];
  const body = yaml.dump(subset, { lineWidth: 100, noRefs: true, sortKeys: false });
  const block = `${BLOCK_START}\n${body}${BLOCK_END}`;
  return block.split("\n").join(nl);
}

/** Deep-ish structural comparison via a stable JSON of the given top-level keys. */
function topLevelSnapshot(obj, skipKeys) {
  const out = {};
  for (const k of Object.keys(obj).sort()) {
    if (skipKeys.includes(k)) continue;
    out[k] = obj[k];
  }
  return JSON.stringify(out);
}

// ----------------------------------------------------------------- merge

/**
 * Produce the new profile text.
 *
 * @param {string} text  current config/profile.yml contents
 * @param {unknown} payload  submitted form values (see normalizePayload)
 * @returns {{ text: string, absorbed: string[], inPlace: string[], changed: boolean }}
 */
export function mergeMyData(text, payload) {
  const original = parseProfile(text);
  const { fields, languages } = normalizePayload(payload);
  const nl = detectNewline(text);

  // A section the user already wrote (compensation, today) is patched in place:
  // its own comments — "$3,800 is the figure I stated on 2026-10-01" — are the
  // reason this file is readable, and regenerating the block would erase them.
  const withoutBlock = stripBlock(text);
  const outer = parseProfile(withoutBlock);
  const inPlace = MANAGED_KEYS.filter((k) => isPlainObject(outer[k]));

  // Start from whatever the managed sections already hold (including keys the
  // form does not know about), then apply the form on top.
  const doc = {};
  for (const key of MANAGED_KEYS) {
    const current = original[key];
    if (isPlainObject(current)) doc[key] = { ...current };
    else if (Array.isArray(current)) doc[key] = [...current];
  }
  for (const key of MANAGED_KEYS) if (!(key in doc)) doc[key] = key === LIST_KEY ? [] : {};

  const kindOf = (path) => FIELDS.find((f) => f.path === path)?.kind;
  for (const [path, value] of fields) {
    const [section, key] = path.split(".");
    if (!isPlainObject(doc[section])) doc[section] = {};
    if (value === "") delete doc[section][key];
    // A yes/no fact is stored as a YAML boolean, not as the string "true": it is
    // read by humans in the file, and `accepts_any_work_mode: 'true'` reads like
    // a typo. readMyData() stringifies it back for the form either way.
    else doc[section][key] = kindOf(path) === "bool" ? value === "true" : value;
  }
  if (languages) doc[LIST_KEY] = languages.length ? languages : [];

  // Drop sections that ended up empty so the block does not grow `personal: {}`.
  for (const key of MANAGED_KEYS) {
    const v = doc[key];
    if (Array.isArray(v)) {
      if (!v.length) delete doc[key];
    } else if (isPlainObject(v) && !Object.keys(v).length) {
      delete doc[key];
    }
  }

  // --- rewrite ----------------------------------------------------------
  const absorbed = MANAGED_KEYS.filter((k) => k in outer && !inPlace.includes(k));
  let out = withoutBlock;
  for (const key of MANAGED_KEYS) {
    if (inPlace.includes(key)) continue;
    out = stripTopLevelBlock(out, key);
  }
  for (const [path, value] of fields) {
    const [section, key] = path.split(".");
    if (!inPlace.includes(section)) continue;
    // Unchanged value, unchanged line: re-emitting it would only restyle the
    // user's own quoting (`"$3,800 …"` → `$3,800 …`) and show up as a diff.
    const before = isPlainObject(original[section]) ? asScalarString(original[section][key]) : "";
    if (before === value && value !== "") continue;
    const patched = patchSectionKey(out, section, key, value);
    if (patched !== null) out = patched;
  }
  // Only the file's tail: stripping trailing spaces on every line would quietly
  // rewrite a folded scalar (`>-`) whose indented text is not ours to touch.
  out = out.replace(/[ \t]*\n*$/, "") + nl;
  const block = serializeBlock(doc, MANAGED_KEYS.filter((k) => !inPlace.includes(k)), nl);
  out = block ? `${out}${nl}${block}${nl}` : out;

  // --- prove it --------------------------------------------------------
  const reparsed = parseProfile(out); // also catches a duplicated key
  for (const key of MANAGED_KEYS) {
    const expected = doc[key] === undefined ? undefined : doc[key];
    const actual = reparsed[key];
    if (JSON.stringify(expected ?? null) !== JSON.stringify(actual ?? null)) {
      throw new MyDataError(
        "WRITE_UNVERIFIED",
        `refusing to write: the edited profile would read back "${key}" differently than intended.`,
      );
    }
  }
  if (topLevelSnapshot(original, MANAGED_KEYS) !== topLevelSnapshot(reparsed, MANAGED_KEYS)) {
    throw new MyDataError(
      "WRITE_UNVERIFIED",
      "refusing to write: the edit would have changed a section outside \"My data\".",
    );
  }

  return { text: out, absorbed, inPlace, changed: out !== text };
}

