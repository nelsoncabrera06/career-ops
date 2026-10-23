"use client";

import Link from "next/link";
import { Bookmark, BookmarkCheck, Check, Loader2, X } from "lucide-react";
import type { InboxJob } from "@/lib/career-ops";
import type { AtsSource } from "@/lib/explore";
import { ATS_LABEL } from "@/lib/explore";
import { Badge } from "@/components/ui/badge";
import { CompanyLogo } from "@/components/company-logo";
import { cn } from "@/lib/cn";

export type RowScore = { score: number | null; tone: "good" | "warn" | "bad" | "muted"; jobId: string; running: boolean };

function agoLabel(age: number | null): string | null {
  if (age == null) return null;
  if (age <= 0) return "today";
  if (age === 1) return "yesterday";
  if (age < 7) return `${age}d ago`;
  if (age < 30) return `${Math.floor(age / 7)}w ago`;
  return `${Math.floor(age / 30)}mo ago`;
}

/**
 * Instant hover label for the row actions.
 *
 * The native `title` attribute is a ~1s OS-level tooltip that several browsers
 * suppress inside a dense list, and it is the only feedback these icon-only
 * buttons have — the action is invisible until you already know it. This is a
 * CSS-only label instead: no state, no portal, and it sits INSIDE the row
 * (left of the button, vertically centred) because the list's rounded
 * `overflow-hidden` would clip anything drawn above or below it.
 */
function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-full top-1/2 z-20 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-md transition-opacity group-hover/tip:opacity-100 max-sm:hidden"
      >
        {label}
      </span>
    </span>
  );
}

// One raw posting in the triage list. Shows ONLY cheap, free signals + an honest
// "not scored" (CRUDA) — never a fake match%. Once its shortlist eval finishes it
// flips to EVALUADA (a real A–F badge). Save→shortlist / Skip→hidden are free + undoable.
export function TriageRow({
  job,
  source,
  age,
  scored,
  selected,
  shortlisted,
  onToggleSelect,
  onSave,
  onSkip,
  onApplied,
  applying = false,
}: {
  job: InboxJob;
  source: AtsSource | null;
  age: number | null;
  scored?: RowScore;
  selected: boolean;
  shortlisted: boolean;
  onToggleSelect: () => void;
  onSave: () => void;
  onSkip: () => void;
  onApplied: () => void;
  applying?: boolean;
}) {
  const ago = agoLabel(age);
  const evaluated = !!scored && (scored.running || scored.score != null);

  return (
    <li
      className={cn(
        "flex items-center gap-2.5 px-3 py-2.5 transition-colors sm:gap-3 sm:px-4",
        selected ? "bg-brand-soft/50" : "hover:bg-surface-hover",
        evaluated && "opacity-95",
      )}
    >
      {/* multi-select — power-user batch to shortlist */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        aria-label={`Select ${job.company} ${job.role}`}
        className="size-4 shrink-0 accent-brand max-sm:min-h-[44px] max-sm:min-w-[24px]"
      />

      <CompanyLogo name={job.company} size={20} />

      <div className="min-w-0 flex-1">
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open the original job posting"
          className="block truncate text-sm hover:text-brand hover:underline"
        >
          <span className="font-medium text-foreground">{job.company}</span>
          <span className="text-muted"> · {job.role}</span>
        </a>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
          {job.location && <span className="truncate">{job.location}</span>}
          {source && <span className="rounded bg-surface-hover px-1 py-px font-medium text-muted">{ATS_LABEL[source]}</span>}
          {ago && <span>{ago}</span>}
          {/* 🔴 CRUDA: honest "not scored" — no fabricated match%. */}
          {!evaluated && <span className="italic text-muted">not scored</span>}
        </p>
      </div>

      {/* EVALUADA state (right-aligned, visually distinct from raw rows) */}
      {evaluated ? (
        <Link href={`/jobs/${scored!.jobId}`} className="flex shrink-0 items-center gap-1.5 text-xs">
          {scored!.running ? (
            <>
              <Loader2 className="size-3.5 animate-spin text-brand" />
              <span className="text-brand max-sm:hidden">Scoring…</span>
            </>
          ) : (
            <Badge tone={scored!.tone}>{scored!.score}/5</Badge>
          )}
        </Link>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <Tip label={shortlisted ? "In your shortlist" : "Save to shortlist"}>
            <button
              type="button"
              onClick={onSave}
              aria-pressed={shortlisted}
              aria-label={shortlisted ? "In your shortlist" : "Save to shortlist"}
              className={cn(
                "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors max-sm:min-h-[44px] max-sm:min-w-[44px]",
                shortlisted ? "text-brand" : "text-muted hover:bg-surface-hover hover:text-brand",
              )}
            >
              {shortlisted ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
              <span className="max-sm:hidden">{shortlisted ? "Saved" : "Save"}</span>
            </button>
          </Tip>
          <Tip label="Mark applied">
            <button
              type="button"
              onClick={onApplied}
              disabled={applying}
              aria-label={`Mark ${job.company} ${job.role} as applied`}
              className="inline-flex items-center justify-center rounded-md p-1 text-faint transition-colors hover:bg-surface-hover hover:text-emerald-600 disabled:opacity-50 dark:hover:text-emerald-400 max-sm:min-h-[44px] max-sm:min-w-[44px]"
            >
              {applying ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            </button>
          </Tip>
          <Tip label="Skip — hide from the inbox">
            <button
              type="button"
              onClick={onSkip}
              aria-label={`Skip ${job.company} ${job.role}`}
              className="inline-flex items-center justify-center rounded-md p-1 text-faint transition-colors hover:bg-surface-hover hover:text-foreground max-sm:min-h-[44px] max-sm:min-w-[44px]"
            >
              <X className="size-4" />
            </button>
          </Tip>
        </div>
      )}
    </li>
  );
}
