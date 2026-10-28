/**
 * my-data-spec.mjs — the field list of the "My data" tab, plus its pure
 * validation helpers.
 *
 * Deliberately free of imports. The tab's editor is a CLIENT component, and the
 * YAML writer next door imports js-yaml: importing the writer just to learn which
 * fields exist would ship a YAML parser to the browser. So the spec (what the form
 * shows, and what the writer will accept) lives here, and my-data.mjs re-exports
 * it — one definition, two consumers, no drift between them.
 */

export const MANAGED_KEYS = ["personal", "availability", "languages", "compensation"];

export const BLOCK_START = "# --- career-ops: my data (edited by the web UI's \"My data\" tab) ---";
export const BLOCK_END = "# --- /career-ops: my data ---";

/** File name under config/, for messages and the route. */
export const PROFILE_FILE = "profile.yml";

/**
 * Every scalar the form owns: `path` is the dotted YAML location, `kind` drives
 * validation. Kept as data (not as UI code) so the editor and the writer can
 * never disagree about which keys are managed.
 */
export const FIELDS = [
  { path: "personal.birth_date", kind: "date" },
  { path: "personal.nationality", kind: "text" },
  { path: "personal.pronouns", kind: "text" },
  { path: "personal.document_id", kind: "text" },
  { path: "personal.gender", kind: "text" },
  { path: "personal.disability", kind: "text" },
  { path: "personal.veteran", kind: "text" },
  { path: "personal.notes", kind: "multiline" },
  { path: "availability.earliest_start", kind: "text" },
  { path: "availability.notice_period_days", kind: "int" },
  {
    path: "availability.work_mode",
    kind: "enum",
    options: ["remote", "hybrid", "onsite", "flexible", "any"],
  },
  // Preference and constraint are two different facts, and collapsing them loses
  // the useful half. "remote" + this flag = "I want remote, and I will still show
  // up to an office" — an offer is not a mismatch, it is a preference not met.
  { path: "availability.accepts_any_work_mode", kind: "bool" },
  { path: "availability.relocate", kind: "enum", options: ["no", "maybe", "yes"] },
  { path: "availability.relocate_to", kind: "text" },
  { path: "availability.travel_percent", kind: "text" },
  { path: "compensation.target_range", kind: "text" },
  { path: "compensation.minimum", kind: "text" },
  { path: "compensation.currency", kind: "text" },
  { path: "compensation.target_range_local", kind: "text" },
  { path: "compensation.location_flexibility", kind: "text" },
];

/** Free-form list field: [{ language, level }]. Replaced wholesale by the form. */
export const LIST_KEY = "languages";

export function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** YAML scalars → the string the form shows. Numbers/bools stringified, the rest "". */
export function asScalarString(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

export class MyDataError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MyDataError";
    this.code = code;
  }
}

// -------------------------------------------------------------- validation

/** dd/mm/yyyy or dd-mm-yyyy → yyyy-mm-dd (the tab is used from es-AR too). */
function toIsoDate(raw) {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function isRealDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Validate one field's submitted value. Returns the value to write, "" meaning
 * "remove the key". Throws MyDataError INVALID_FIELD on garbage — a silently
 * coerced date is worse than a refused save, because the wrong age then travels
 * into every form.
 */
export function normalizeField(field, raw) {
  const s = asScalarString(raw).trim();
  if (!s) return "";
  switch (field.kind) {
    case "date": {
      const iso = toIsoDate(s);
      if (!iso || !isRealDate(iso)) {
        throw new MyDataError("INVALID_FIELD", `${field.path}: "${s}" is not a date (use YYYY-MM-DD or DD/MM/YYYY).`);
      }
      return iso;
    }
    case "int": {
      const n = Number(s);
      if (!Number.isInteger(n) || n < 0 || n > 3650) {
        throw new MyDataError("INVALID_FIELD", `${field.path}: "${s}" is not a whole number.`);
      }
      return String(n);
    }
    case "bool": {
      if (["true", "yes", "1", "on"].includes(s.toLowerCase())) return "true";
      if (["false", "no", "0", "off"].includes(s.toLowerCase())) return "false";
      throw new MyDataError("INVALID_FIELD", `${field.path}: "${s}" is not a yes/no value.`);
    }
    case "enum": {
      const v = s.toLowerCase();
      if (!field.options.includes(v)) {
        throw new MyDataError("INVALID_FIELD", `${field.path}: "${s}" is not one of ${field.options.join(", ")}.`);
      }
      return v;
    }
    default:
      return s;
  }
}

/**
 * Turn a submitted payload into write intent.
 *
 * Absent = "leave it alone". Present-but-empty = "delete the key". That
 * distinction is the difference between a partial form and a form the user
 * saved after clearing a field, and collapsing the two is how a save silently
 * wipes data it never showed.
 *
 * @returns {{ fields: [string, string][], languages?: {language:string, level:string}[] }}
 */
export function normalizePayload(payload) {
  if (!isPlainObject(payload)) {
    throw new MyDataError("INVALID_PAYLOAD", "expected an object of field values");
  }
  const fields = [];
  for (const field of FIELDS) {
    if (!(field.path in payload)) continue;
    fields.push([field.path, normalizeField(field, payload[field.path])]);
  }

  let languages;
  if (LIST_KEY in payload) {
    const raw = payload[LIST_KEY];
    if (!Array.isArray(raw)) throw new MyDataError("INVALID_PAYLOAD", "languages must be a list");
    languages = raw
      .map((e) => ({
        language: asScalarString(isPlainObject(e) ? e.language : "").trim(),
        level: asScalarString(isPlainObject(e) ? e.level : "").trim(),
      }))
      .filter((e) => e.language);
  }
  return { fields, languages };
}

/** Age from an ISO birth date, or null. Used for the "you are N" hint. */
export function ageFrom(iso, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "") || !isRealDate(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  let age = now.getUTCFullYear() - y;
  const before = now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d);
  if (before) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}
