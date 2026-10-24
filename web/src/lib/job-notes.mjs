/**
 * Personal notes on a single job — `data/job-notes.json`, keyed by tracker row
 * number (the same `n` the web uses as `/pipeline/{n}`).
 *
 * WHY A SEPARATE FILE, not the tracker's Notes cell:
 *   The tracker Notes column is written by the pipeline (evaluation summary,
 *   `set-status.mjs --note`, `--replace-note`). It is a machine-appended summary
 *   with `; ` semantics; a human typing paragraphs into it would either be
 *   appended-after ("; your note") or clobber evaluation notes. These notes are
 *   the user's own, free-form, and never rewritten by a CLI run — so they live
 *   beside the tracker, not inside it.
 *
 * The shape is a plain object:
 *   { "85": { "text": "Kleva asked for a video intro…", "updated": "2026-10-24T…" } }
 *
 * Kept free of Next imports (fs/path only) so `node --test` can exercise it.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const NOTES_FILE_REL = path.join("data", "job-notes.json");
export const MAX_NOTE_LEN = 20_000;
const MAX_ID_LEN = 64;
const ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** Absolute path of the notes store for a career-ops data root. */
export function notesPath(root) {
  return path.join(root, NOTES_FILE_REL);
}

/**
 * A job key: the tracker's `#` column, or a report id. Deliberately narrow —
 * it is used as a JSON object key, and anything exotic (slashes, dots-only,
 * newlines) is refused rather than normalized, so two spellings can never
 * become two entries for one job.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function jobKey(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length > MAX_ID_LEN || !ID_RE.test(s)) return null;
  if (/^\.+$/.test(s)) return null;
  return s;
}

/**
 * Normalize note text: LF line endings only, no NULs (JSON-safe either way, but
 * a NUL in a text file is a sign of the wrong input), trailing whitespace
 * trimmed at the very end. Interior whitespace and markdown are preserved —
 * this is the user's own writing.
 *
 * @param {unknown} raw
 * @returns {{ ok: true, text: string } | { ok: false, error: string }}
 */
export function normalizeNoteText(raw) {
  if (typeof raw !== "string") return { ok: false, error: "text must be a string" };
  const text = raw.replace(/\r\n?/g, "\n").replace(/\0/g, "").replace(/\s+$/, "");
  if (text.length > MAX_NOTE_LEN) return { ok: false, error: `note is longer than ${MAX_NOTE_LEN} characters` };
  return { ok: true, text };
}

/** @returns {Record<string, { text: string, updated: string }>} — empty when the file is absent or unparseable. */
export function readAllNotes(root) {
  let raw;
  try {
    raw = fs.readFileSync(notesPath(root), "utf8");
  } catch {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A hand-edited or truncated file must not take the whole page down. The
    // write path keeps a .bak of whatever was there before (see writeAllNotes),
    // so the broken content is still recoverable from disk.
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    const key = jobKey(k);
    if (!key) continue;
    const text = typeof v === "string" ? v : v && typeof v === "object" ? v.text : null;
    const updated = v && typeof v === "object" && typeof v.updated === "string" ? v.updated : "";
    if (typeof text !== "string" || text === "") continue;
    out[key] = { text, updated };
  }
  return out;
}

/** One job's note, or null. */
export function noteFor(root, rawId) {
  const key = jobKey(rawId);
  if (!key) return null;
  return readAllNotes(root)[key] ?? null;
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
      /* the write already failed; the leftover is unstageable (.gitignore `*.tmp*`) */
    }
    throw err;
  }
}

// Serialize read-modify-write inside this process so two tabs saving at once
// cannot lose one note to a stale read. Cross-process (a hand edit while the web
// runs) is not covered — the .bak below makes that recoverable, and the CLI
// never writes this file.
let chain = Promise.resolve();
function serialize(fn) {
  const next = chain.then(fn, fn);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Save (or delete, when the normalized text is empty) one job's note.
 *
 * @param {string} root career-ops data root
 * @param {unknown} rawId tracker row number / report id
 * @param {unknown} rawText the note body
 * @returns {Promise<{ ok: true, key: string, text: string, updated: string, deleted?: true } | { ok: false, error: string }>}
 */
export function saveNote(root, rawId, rawText) {
  const key = jobKey(rawId);
  if (!key) return Promise.resolve({ ok: false, error: "id must be a tracker row number" });
  const norm = normalizeNoteText(rawText);
  if (!norm.ok) return Promise.resolve(norm);

  return serialize(() => {
    const file = notesPath(root);
    const all = readAllNotes(root);
    const previous = all[key] ?? null;

    if (norm.text.trim() === "") {
      if (!previous) return { ok: true, key, text: "", updated: "", deleted: true };
      delete all[key];
      backupOnce(file);
      atomicWriteJson(file, all);
      return { ok: true, key, text: "", updated: "", deleted: true };
    }

    if (previous && previous.text === norm.text) {
      // Idempotent: an unchanged note is not a write, so "Save" on an already
      // saved body does not rewrite the file or move the "last saved" time.
      return { ok: true, key, text: previous.text, updated: previous.updated };
    }

    const updated = new Date().toISOString();
    all[key] = { text: norm.text, updated };
    backupOnce(file);
    atomicWriteJson(file, all);
    return { ok: true, key, text: norm.text, updated };
  });
}

/**
 * Snapshot the pre-write file once per day (not once per keystroke-save), so a
 * bad write is recoverable without one backup per save.
 */
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
