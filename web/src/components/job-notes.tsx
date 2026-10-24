"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, NotebookPen, Check, Trash2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * "My notes" on one job — a plain textarea over `data/job-notes.json`.
 *
 * Deliberately NOT auto-saved on every keystroke: the user asked for a place to
 * write and then save, and a silent background write on a local file is the
 * kind of thing you want to be explicit about (and it keeps the "unsaved"
 * state visible). Cmd/Ctrl+Enter saves too.
 *
 * The note is personal and free-form (a recruiter's email, a call summary, what
 * to send and by when). It is stored beside the tracker, never inside it — see
 * lib/job-notes.mjs for why.
 */
export function JobNotes({
  n,
  initialText = "",
  initialUpdated = "",
}: {
  n: string;
  initialText?: string;
  initialUpdated?: string;
}) {
  const [text, setText] = useState(initialText);
  const [saved, setSaved] = useState(initialText);
  const [updated, setUpdated] = useState(initialUpdated);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(initialText.trim() !== "");
  const [flash, setFlash] = useState("");
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  const dirty = text !== saved;

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(""), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  // Warn before a reload/tab close with unsaved text — the one real cost of
  // requiring an explicit save.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const save = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n, text }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        text?: string;
        updated?: string;
        deleted?: boolean;
      };
      if (!res.ok) {
        setError(data.error || "Couldn't save the note.");
        return;
      }
      setSaved(data.text ?? "");
      setText(data.text ?? "");
      setUpdated(data.updated ?? "");
      setFlash(data.deleted ? "Note deleted" : "Saved");
    } catch {
      setError("Couldn't reach the server — the note was not saved.");
    } finally {
      setBusy(false);
    }
  }, [n, text]);

  const remove = useCallback(async () => {
    setText("");
    setSaved("");
    setUpdated("");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n, text: "" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Couldn't delete the note.");
        return;
      }
      setFlash("Note deleted");
    } catch {
      setError("Couldn't reach the server — the note was not deleted.");
    } finally {
      setBusy(false);
    }
  }, [n]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (dirty && !busy) void save();
    }
  };

  const savedLabel = updated ? new Date(updated).toLocaleString() : "";

  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface/40">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o);
            // Opening the editor is the moment to put the caret where the user
            // is about to type — otherwise the toggle feels like a dead end.
            if (!open) requestAnimationFrame(() => areaRef.current?.focus());
          }}
          aria-expanded={open}
          className="inline-flex items-center gap-2 text-sm font-medium text-foreground max-sm:min-h-[44px]"
        >
          <NotebookPen className="size-4 text-muted" />
          My notes
          {!open && saved.trim() !== "" && (
            <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[11px] font-normal text-muted">has note</span>
          )}
          {!open && dirty && <span className="text-[11px] font-normal text-brand">unsaved</span>}
          <ChevronDown className={cn("size-4 text-faint transition-transform", open && "rotate-180")} />
        </button>
        {flash && (
          <span role="status" className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="size-3.5" /> {flash}
          </span>
        )}
      </div>

      {open && (
        <div className="border-t border-border px-4 py-3">
          <label htmlFor={`job-notes-${n}`} className="sr-only">
            Personal notes for this job
          </label>
          <textarea
            id={`job-notes-${n}`}
            ref={areaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={5}
            placeholder="Anything personal about this job — who emailed you, what they asked for, what you promised to send, next steps…"
            className="w-full resize-y rounded-lg border border-border bg-background/60 px-3 py-2 text-sm leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40"
          />

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-faint">
              {savedLabel ? `Last saved ${savedLabel}` : "Not saved yet"}
              {dirty && <span className="ml-2 text-brand">· unsaved changes</span>}
            </p>
            <div className="flex items-center gap-2">
              {saved.trim() !== "" && (
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-red-500 disabled:opacity-50 max-sm:min-h-[44px]"
                >
                  <Trash2 className="size-3.5" /> Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy || !dirty}
                title="Save note (⌘/Ctrl + Enter)"
                className="inline-flex items-center justify-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50 max-sm:min-h-[44px]"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                {busy ? "Saving…" : "Save note"}
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-2 text-xs text-red-500">
              {error}
            </p>
          )}
          <p className="mt-2 text-[11px] text-faint">
            Stored in <code className="rounded bg-surface-hover px-1 py-0.5 font-mono">data/job-notes.json</code> — your own
            notes, separate from the evaluation summary in the tracker.
          </p>
        </div>
      )}
    </section>
  );
}
