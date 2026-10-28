/**
 * extension-request.mjs — validate what the browser extension sends.
 *
 * The extension is a client the server does not control: its payload crosses a
 * process boundary and lands in a prompt that is handed to a CLI with read
 * access to the user's files. So this module treats every string as hostile and
 * bounds it, and it is pure so `node --test` can pin the bounds.
 *
 * The caps are not security theatre. A form with 5,000 "fields" is either a bug
 * or an attempt to make the planner spend its whole budget on a page the user
 * never looked at; either way the honest answer is "no".
 */

export const MAX_FIELDS = 60;
export const MAX_LABEL = 400;
export const MAX_TITLE = 200;
export const MAX_URL = 2000;
export const MAX_OPTIONS = 60;
export const MAX_OPTION = 120;

const FIELD_TYPES = new Set([
  "text",
  "email",
  "tel",
  "url",
  "number",
  "date",
  "textarea",
  "select",
  "checkbox",
  "radio",
  "file",
]);

/** A handle the content script can find again: `co0`, `co12`, … */
const FIELD_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * One form control, exactly as much of it as the planner prompt needs. The shape
 * matches `PromptField` in answer-prompt.mjs, which is what consumes it.
 *
 * @typedef {Object} ExtensionField
 * @property {string} id
 * @property {string} type
 * @property {string} label
 * @property {boolean} required
 * @property {string[]} [options]
 * @property {boolean} [combobox]
 * @property {number} [maxLength]
 */

const str = (v) => (typeof v === "string" ? v : "");

function bounded(s, max) {
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Keep a multi-line answer's line breaks: labels are questions, answers are prose. */
function boundedMultiline(s, max) {
  return s
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/**
 * @param {unknown} raw
 * @returns {ExtensionField|null}
 */
function cleanField(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = str(raw.id);
  if (!FIELD_ID_RE.test(id)) return null;
  const type = str(raw.type).toLowerCase();
  if (!FIELD_TYPES.has(type)) return null;

  const optionsIn = Array.isArray(raw.options) ? raw.options : [];
  const options = optionsIn
    .slice(0, MAX_OPTIONS)
    .map((o) => bounded(str(o), MAX_OPTION))
    .filter(Boolean);

  const maxLength = Number.isFinite(raw.maxLength) && raw.maxLength > 0 ? Math.min(Number(raw.maxLength), 100_000) : undefined;

  return {
    id,
    type,
    label: boundedMultiline(str(raw.label), MAX_LABEL),
    required: raw.required === true,
    ...(options.length ? { options } : {}),
    ...(raw.combobox === true ? { combobox: true } : {}),
    ...(maxLength ? { maxLength } : {}),
  };
}

/**
 * @param {unknown} raw
 * @returns {{ok: true, value: {url: string, title: string, fields: ExtensionField[]}} | {ok: false, error: string}}
 */
export function normalizeExtensionRequest(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "body must be a JSON object" };

  const url = str(raw.url);
  if (url && (!/^https?:\/\//i.test(url) || url.length > MAX_URL)) {
    return { ok: false, error: "url must be a http(s) URL under 2000 characters" };
  }

  if (!Array.isArray(raw.fields)) return { ok: false, error: "fields must be an array" };
  if (raw.fields.length === 0) return { ok: false, error: "no fields on the page — open the application form first" };
  if (raw.fields.length > MAX_FIELDS) {
    return { ok: false, error: `too many fields (${raw.fields.length}); ${MAX_FIELDS} is the limit — is this really one form?` };
  }

  /** @type {ExtensionField[]} */
  const fields = [];
  for (const f of raw.fields) {
    const clean = cleanField(f);
    if (clean) fields.push(clean);
  }
  if (fields.length === 0) return { ok: false, error: "none of the submitted fields were usable" };

  const title = bounded(str(raw.title), MAX_TITLE) || (url ? safeHost(url) : "application form");

  return { ok: true, value: { url, title, fields } };
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "application form";
  }
}

/**
 * The `company/role` line the planner sees.
 *
 * The extension sends the page title, which on an ATS reads like "Backend
 * Engineer - Acme" or "Careers at Acme". The user can correct it in the panel,
 * and a corrected value wins: the planner uses this string to find the matching
 * report in reports/, so a wrong one costs a tailored answer.
 */
export function planTitle({ company, role, pageTitle, url }) {
  const c = bounded(str(company), 120);
  const r = bounded(str(role), 120);
  if (c && r) return `${r} @ ${c}`;
  if (c) return `${bounded(str(pageTitle), MAX_TITLE) || "application form"} @ ${c}`;
  return bounded(str(pageTitle), MAX_TITLE) || (url ? safeHost(url) : "application form");
}
