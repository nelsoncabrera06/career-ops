// Personal job notes: data/job-notes.json, keyed by tracker row number.
//
// The store is deliberately separate from the tracker's Notes column, which the
// pipeline owns (evaluation summary, set-status --note/--replace-note). These
// tests pin the properties that keep that separation safe: a narrow key space,
// idempotent saves, delete-by-empty, and a write that cannot truncate the file.
//
// Run (from web/, as `npm test` does):  node --test tests/lib/job-notes.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "..", "src", "lib", "job-notes.mjs");

const { jobKey, normalizeNoteText, readAllNotes, noteFor, saveNote, notesPath, MAX_NOTE_LEN } = await import(
  pathToFileURL(SRC).href
);

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-notes-"));
}

test("jobKey accepts tracker row numbers and refuses path-ish input", () => {
  assert.equal(jobKey("85"), "85");
  assert.equal(jobKey(" 85 "), "85");
  assert.equal(jobKey("064"), "064");
  // Refused, not normalized: a key that can leave data/ or collide with a
  // second spelling of the same job is the one thing this store must not do.
  assert.equal(jobKey("../etc/passwd"), null);
  assert.equal(jobKey("a/b"), null);
  assert.equal(jobKey(""), null);
  assert.equal(jobKey(".."), null);
  assert.equal(jobKey("8 5"), null);
  assert.equal(jobKey(null), null);
  assert.equal(jobKey(85), null);
  assert.equal(jobKey("x".repeat(65)), null);
});

test("normalizeNoteText keeps the user's markdown, normalizes line endings, trims the tail", () => {
  const r = normalizeNoteText("line one\r\nline two\r\n\r\n- bullet *emph*\n\n");
  assert.equal(r.ok, true);
  assert.equal(r.text, "line one\nline two\n\n- bullet *emph*");
  // Interior whitespace is the user's layout — only the trailing run goes.
  assert.equal(normalizeNoteText("a\n\n\nb").text, "a\n\n\nb");
  assert.equal(normalizeNoteText(1).ok, false);
  assert.equal(normalizeNoteText("x".repeat(MAX_NOTE_LEN + 1)).ok, false);
});

test("save → read → idempotent save → delete", async () => {
  const root = tmpRoot();
  assert.equal(noteFor(root, "85"), null, "absent store reads as no note");

  const first = await saveNote(root, "85", "Kleva pidió un video de presentación.\nProyecto: career-ops");
  assert.equal(first.ok, true);
  assert.match(first.updated, /^\d{4}-\d{2}-\d{2}T/);

  const read = noteFor(root, "85");
  assert.equal(read.text, "Kleva pidió un video de presentación.\nProyecto: career-ops");
  assert.equal(read.updated, first.updated);

  // Unchanged body is not a write: no new timestamp, and the file is untouched.
  const before = fs.readFileSync(notesPath(root), "utf8");
  const again = await saveNote(root, "85", "Kleva pidió un video de presentación.\nProyecto: career-ops");
  assert.equal(again.ok, true);
  assert.equal(again.updated, first.updated);
  assert.equal(fs.readFileSync(notesPath(root), "utf8"), before);

  // Whitespace-only body deletes the entry rather than storing a blank note.
  const del = await saveNote(root, "85", "   \n\t\n");
  assert.equal(del.ok, true);
  assert.equal(del.deleted, true);
  assert.equal(noteFor(root, "85"), null);
  assert.deepEqual(readAllNotes(root), {});
});

test("a bad key writes nothing", async () => {
  const root = tmpRoot();
  const res = await saveNote(root, "../evil", "x");
  assert.equal(res.ok, false);
  assert.equal(fs.existsSync(notesPath(root)), false);
});

test("notes for different jobs are independent", async () => {
  const root = tmpRoot();
  await saveNote(root, "85", "Kleva note");
  await saveNote(root, "86", "Other note");
  assert.equal(noteFor(root, "85").text, "Kleva note");
  assert.equal(noteFor(root, "86").text, "Other note");
  await saveNote(root, "85", "");
  assert.equal(noteFor(root, "85"), null);
  assert.equal(noteFor(root, "86").text, "Other note");
});

test("a corrupt store does not break the read path", async () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(notesPath(root), "{ this is not json", "utf8");
  assert.deepEqual(readAllNotes(root), {});
  assert.equal(noteFor(root, "85"), null);
  // ...and a save repairs it.
  const res = await saveNote(root, "85", "recovered");
  assert.equal(res.ok, true);
  assert.equal(noteFor(root, "85").text, "recovered");
});

test("concurrent saves all land", async () => {
  const root = tmpRoot();
  await Promise.all(Array.from({ length: 12 }, (_, i) => saveNote(root, String(i), `note ${i}`)));
  const all = readAllNotes(root);
  assert.equal(Object.keys(all).length, 12);
  for (let i = 0; i < 12; i++) assert.equal(all[String(i)].text, `note ${i}`);
});
