"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, ChevronsUpDown, X, Compass, ArrowRight, Trash2, Loader2 } from "lucide-react";
import type { Application, InboxJob } from "@/lib/career-ops";
import { Badge } from "@/components/ui/badge";
import { CompanyLogo } from "@/components/company-logo";
import { canonStatus, scoreNum, scoreTone, statusDot } from "@/lib/format";
import { InboxTriage } from "@/components/inbox/inbox-triage";
import { cn } from "@/lib/cn";
import { companyPresentation, companySearchText } from "@/lib/company-presentation.mjs";
import { aliasesOf } from "@/lib/company-aliases.mjs";
import { compareTrackerNumbers } from "@/lib/pipeline-sort.mjs";

type CompanyGroup = import("@/lib/company-aliases.mjs").CompanyGroup;

// INBOX (the triage queue) is the default tab; the rest filter the tracker.
const TABS = [
  "INBOX",
  "ALL",
  "EVALUATED",
  "APPLIED",
  "RESPONDED",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
  "DISCARDED",
  "SKIP",
] as const;
type Tab = (typeof TABS)[number];

const SORT_KEYS = ["tracker", "company", "role", "score", "status", "date"] as const;
type SortKey = (typeof SORT_KEYS)[number];

export function PipelineView({
  applications,
  inbox,
  companyGroups = [],
  notedIds = [],
}: {
  applications: Application[];
  inbox: InboxJob[];
  companyGroups?: CompanyGroup[];
  /** Tracker numbers carrying a personal note in data/job-notes.json. */
  notedIds?: string[];
}) {
  const noted = useMemo(() => new Set(notedIds.map(String)), [notedIds]);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // The URL is the SINGLE source of truth for tab/min/sort/dir, so the home stat
  // tiles' deep links AND the assistant's filterPipeline/navigate actions drive
  // the table identically (no useState mirror → no desync).
  const pTab = (params.get("tab") ?? "").toUpperCase();
  const tab: Tab = (TABS as readonly string[]).includes(pTab) ? (pTab as Tab) : "INBOX";
  const pMin = parseFloat(params.get("min") ?? "");
  const minFilter: number | null = Number.isFinite(pMin) ? pMin : null;
  const pSort = params.get("sort") ?? "";
  const sortKey: SortKey = (SORT_KEYS as readonly string[]).includes(pSort) ? (pSort as SortKey) : "score";
  const sort = { key: sortKey, dir: (params.get("dir") === "1" ? 1 : -1) as 1 | -1 };

  // Search stays LOCAL for snappy typing; seeded from the URL and re-synced only
  // when the URL's q changes (i.e. the assistant set it) — never per keystroke.
  const [q, setQ] = useState(params.get("q") ?? "");
  const lastUrlQ = useRef(params.get("q") ?? "");
  useEffect(() => {
    const urlQ = params.get("q") ?? "";
    if (urlQ !== lastUrlQ.current) {
      lastUrlQ.current = urlQ;
      setQ(urlQ);
    }
  }, [params]);

  const setParams = useCallback(
    (updates: Record<string, string | number | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v == null || v === "") sp.delete(k);
        else sp.set(k, String(v));
      }
      const qs = sp.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [params, router, pathname],
  );

  // Pending + deduped by URL (pipeline.md can list the same posting twice) so the
  // header count, the tab count and the triage list all agree on one number.
  const pendingInbox = useMemo(() => {
    const seen = new Set<string>();
    const out: InboxJob[] = [];
    for (const j of inbox) {
      if (j.done || seen.has(j.url)) continue;
      seen.add(j.url);
      out.push(j);
    }
    return out;
  }, [inbox]);

  const filtered = useMemo(() => {
    if (tab === "INBOX") return [];
    let rows = applications;
    if (tab !== "ALL") rows = rows.filter((r) => canonStatus(r.status).includes(tab));
    if (minFilter != null) {
      rows = rows.filter((r) => {
        const n = scoreNum(r.score);
        return !Number.isNaN(n) && n >= minFilter;
      });
    }
    if (q.trim()) {
      const needle = q.toLowerCase();
      rows = rows.filter((r) => companySearchText(r, companyGroups).toLowerCase().includes(needle));
    }
    return [...rows].sort((a, b) => {
      if (sort.key === "tracker") return compareTrackerNumbers(a, b) * sort.dir;
      if (sort.key === "score") {
        const an = scoreNum(a.score);
        const bn = scoreNum(b.score);
        const av = Number.isNaN(an) ? -Infinity : an;
        const bv = Number.isNaN(bn) ? -Infinity : bn;
        return (av - bv) * sort.dir;
      }
      const aValue = sort.key === "company" ? companyPresentation(a).label : a[sort.key] || "";
      const bValue = sort.key === "company" ? companyPresentation(b).label : b[sort.key] || "";
      return aValue.localeCompare(bValue) * sort.dir;
    });
  }, [applications, tab, q, sort, minFilter, companyGroups]);

  // ── Bulk removal ──
  // Selecting rows is the one thing the detail page forced you to do one by one:
  // a Discarded evaluation you never applied to is noise, and removing it meant
  // opening it. Selection is confined to the CURRENT filtered set on purpose —
  // switching tab/search clears it, so "Remove 3" can never mean three rows you
  // can no longer see.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [removeErrors, setRemoveErrors] = useState<string[]>([]);
  const headBox = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSelected(new Set());
    setConfirming(false);
    setRemoveErrors([]);
  }, [tab, q, minFilter]);

  // Only rows with a real numeric # can be removed: `tracker.mjs delete --num N`
  // takes an integer, and backfilled rows carry a sentinel (`N/A`, `—`, `-`).
  const visibleIds = useMemo(
    () => filtered.filter((r) => /^\d+$/.test(r.n)).map((r) => r.n),
    [filtered],
  );
  // Advice must fit what is selected: telling someone in the DISCARDED tab to
  // "set the status to Discarded" is nonsense — those rows already are.
  const allSelectedDiscarded = useMemo(() => {
    const rows = filtered.filter((r) => selected.has(r.n));
    return rows.length > 0 && rows.every((r) => canonStatus(r.status).includes("DISCARDED"));
  }, [filtered, selected]);
  const selectedVisible = useMemo(() => visibleIds.filter((id) => selected.has(id)), [visibleIds, selected]);

  useEffect(() => {
    const box = headBox.current;
    if (!box) return;
    box.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
    box.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  }, [selectedVisible, visibleIds]);

  const toggleRow = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((s) => {
      const all = visibleIds.length > 0 && visibleIds.every((id) => s.has(id));
      const next = new Set(s);
      for (const id of visibleIds) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  // Sequential on purpose: /api/tracker/delete shells out to `tracker.mjs delete`,
  // which holds the tracker write-gate for one row at a time (and answers 409 while
  // another delete runs). Rows that FAIL stay selected, so a retry is one click
  // rather than re-picking the survivors.
  const removeSelected = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setRemoving(true);
    setRemoveErrors([]);
    setProgress({ done: 0, total: ids.length });
    const failed: string[] = [];
    const failedIds = new Set<string>();
    for (const [i, id] of ids.entries()) {
      try {
        const res = await fetch("/api/tracker/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ n: id }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          failed.push(`#${id}: ${data.error || "couldn't be removed"}`);
          failedIds.add(id);
        }
      } catch {
        failed.push(`#${id}: couldn't reach the tracker`);
        failedIds.add(id);
      }
      setProgress({ done: i + 1, total: ids.length });
    }
    setSelected(failedIds);
    setRemoving(false);
    setProgress(null);
    if (failed.length === 0) setConfirming(false);
    else setRemoveErrors(failed);
    router.refresh();
  }, [selected, router]);

  const tabTotal =
    tab === "INBOX" ? 0 : tab === "ALL" ? applications.length : applications.filter((r) => canonStatus(r.status).includes(tab)).length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 max-sm:pb-24">
      <div>
        <h1 className="font-display text-2xl tracking-tight text-landing">Pipeline</h1>
        <p className="mt-1 text-sm text-muted">
          <span className="tabular-nums">{pendingInbox.length}</span> in inbox ·{" "}
          <span className="tabular-nums">{applications.length}</span> tracked
        </p>
      </div>

      {/* tabs */}
      <div className="mt-6 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => {
          const count =
            t === "INBOX"
              ? pendingInbox.length
              : t === "ALL"
                ? applications.length
                : applications.filter((r) => canonStatus(r.status).includes(t)).length;
          return (
            <button
              key={t}
              onClick={() => setParams({ tab: t === "INBOX" ? null : t })}
              className={cn(
                // gap-1, not a whitespace text node: flex containers drop
                // whitespace-only anonymous items, which rendered "INBOX0".
                "-mb-px inline-flex items-center justify-center gap-1 border-b-2 px-3 py-2 text-xs font-medium transition-colors max-sm:min-h-[44px]",
                tab === t
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted hover:text-foreground",
              )}
            >
              {t} <span className="text-faint tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Every tracker tab shares the inbox's filter row: a full-width search below
          the tabs — not a cramped field parked in the header — so both surfaces of
          the pipeline read as one system. Same count, same styling as FacetChips. */}
      {tab !== "INBOX" && (
        <div className="mt-4 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by company or role…"
              className="w-full rounded-lg border border-border bg-surface/60 py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40 max-sm:min-h-[44px]"
            />
          </div>
          <span className="shrink-0 text-xs text-muted">
            <span className="tabular-nums text-foreground">{filtered.length}</span>
            <span className="text-faint">/{tabTotal}</span>
          </span>
        </div>
      )}

      {tab !== "INBOX" && minFilter != null && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-faint">Filtered:</span>
          <button
            type="button"
            onClick={() => setParams({ min: null })}
            className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand/15"
            title="Clear score filter"
          >
            score ≥ {minFilter.toFixed(1)}
            <X className="size-3" />
          </button>
        </div>
      )}

      {tab === "INBOX" ? (
        /* ── Inbox: the triage surface (Abundance → Triage → Shortlist → Score) ── */
        pendingInbox.length > 0 ? (
          <InboxTriage inbox={pendingInbox} companyGroups={companyGroups} />
        ) : (
          <InboxEmpty count={0} filtered={false} />
        )
      ) : filtered.length > 0 ? (
        /* ── Tracker table ──
           overflow-x-auto, not overflow-hidden: the rounded corners still clip,
           but a table too wide for the viewport can now be scrolled to instead
           of being silently cut off. min-w keeps the columns readable rather
           than letting w-full crush them on a phone. */
        <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-surface/60 text-left text-xs uppercase tracking-wide text-faint">
              <tr>
                <th className="w-10 pl-4 pr-1 py-2.5">
                  <input
                    ref={headBox}
                    type="checkbox"
                    onChange={toggleAll}
                    aria-label={
                      selectedVisible.length === visibleIds.length && visibleIds.length > 0
                        ? "Deselect all rows"
                        : "Select all rows"
                    }
                    className="size-4 cursor-pointer accent-brand"
                  />
                </th>
                {SORT_KEYS.map((k) => (
                  <th
                    key={k}
                    aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                    className={cn(
                      "whitespace-nowrap px-4 py-2.5 font-medium",
                      k === "date" && "hidden lg:table-cell",
                    )}
                  >
                    <button
                      type="button"
                      className="inline-flex cursor-pointer select-none items-center gap-1 uppercase tracking-wide hover:text-foreground"
                      onClick={() => setParams({ sort: k, dir: sort.key === k ? sort.dir * -1 : -1 })}
                    >
                      {k}
                      <ChevronsUpDown aria-hidden="true" className="size-3" />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r, i) => {
                const company = companyPresentation(r);
                const aliases = aliasesOf(r.company, companyGroups);
                return (
                  <tr
                    key={`${r.n}-${i}`}
                    className={cn(
                      "group transition-colors",
                      selected.has(r.n) ? "bg-brand-soft/40" : "hover:bg-surface/40",
                    )}
                  >
                    <td className="w-10 whitespace-nowrap py-3 pl-4 pr-1">
                      {/^\d+$/.test(r.n) && (
                        <input
                          type="checkbox"
                          checked={selected.has(r.n)}
                          onChange={() => toggleRow(r.n)}
                          aria-label={`Select #${r.n} ${company.label} ${r.role}`}
                          className="size-4 cursor-pointer accent-brand"
                        />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">
                      <Link href={`/pipeline/${r.n}`} className="transition-colors group-hover:text-brand">
                        #{r.n}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/pipeline/${r.n}`} className="flex items-center gap-2.5 transition-colors group-hover:text-brand">
                        <CompanyLogo name={company.logoName} size={20} />
                        {company.label}
                      </Link>
                      {/* The other brands this employer posts under. Visible, not just
                          searchable: the whole point is that the user recognises the
                          name that emailed them. */}
                      {aliases.length > 0 && (
                        <p className="mt-1 text-[11px] text-faint">
                          también: <span className="text-muted">{aliases.join(" · ")}</span>
                        </p>
                      )}
                    </td>
                  <td className="px-4 py-3 text-muted">
                    <Link href={`/pipeline/${r.n}`}>{r.role}</Link>
                    {noted.has(String(r.n)) && <HasNote />}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={scoreTone(r.score)}>{r.score || "—"}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn("size-1.5 shrink-0 rounded-full", statusDot(r.status))} />
                      {r.status}
                    </span>
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-faint tabular-nums lg:table-cell">{r.date}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-12 text-center">
          <p className="font-display text-lg">No matches</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Try a different tab or clear the search.</p>
        </div>
      )}

      {/* Bulk bar. Fixed to the viewport bottom (like the inbox shortlist tray) so
          it stays reachable while the table scrolls; it only exists while rows are
          selected, and the destructive step is a second, explicit click. */}
      {tab !== "INBOX" && selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 sm:pb-5">
          <div className="pointer-events-auto w-full max-w-2xl rounded-2xl border border-border bg-surface px-4 py-3 shadow-xl">
            {!confirming ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-foreground tabular-nums">
                  {selected.size} selected
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setRemoveErrors([]);
                    setConfirming(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-red-400/40 bg-red-500/10 px-3.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/20 dark:text-red-400 max-sm:min-h-[44px]"
                >
                  <Trash2 className="size-3.5" /> Remove from tracker
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-xs text-muted transition-colors hover:text-foreground max-sm:min-h-[44px]"
                >
                  Clear
                </button>
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium text-foreground">
                  Permanently remove {selected.size} application{selected.size === 1 ? "" : "s"} from your tracker?
                </p>
                <p className="mt-1 text-xs text-muted">
                  This can’t be undone. Their report files stay on disk.
                  {!allSelectedDiscarded && (
                    <> To keep the record instead, set the status to Discarded — that is the soft option and stays in the
                    tracker.</>
                  )}
                </p>
                {progress && (
                  <p className="mt-2 text-xs text-muted tabular-nums">
                    Removing {progress.done}/{progress.total}…
                  </p>
                )}
                {removeErrors.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-red-500">
                    {removeErrors.slice(0, 6).map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                    {removeErrors.length > 6 && <li>…and {removeErrors.length - 6} more</li>}
                  </ul>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={removing}
                    onClick={() => void removeSelected()}
                    className="inline-flex items-center gap-1.5 rounded-full bg-red-500 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50 max-sm:min-h-[44px]"
                  >
                    {removing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                    {removing
                      ? `Removing ${progress?.done ?? 0}/${progress?.total ?? selected.size}…`
                      : `Delete ${selected.size}`}
                  </button>
                  <button
                    type="button"
                    disabled={removing}
                    onClick={() => setConfirming(false)}
                    className="rounded-full border border-border px-3.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-50 max-sm:min-h-[44px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={removing}
                    onClick={() => {
                      setConfirming(false);
                      setSelected(new Set());
                    }}
                    className="ml-auto text-xs text-faint transition-colors hover:text-foreground disabled:opacity-50 max-sm:min-h-[44px]"
                  >
                    Clear selection
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// "This row has a personal note" — the 📝 after the role, in ANY tab, with the
// words on hover. CSS-only (no state, no portal): the table's `overflow-x-auto`
// wrapper clips anything drawn above or below a row, so the label sits inline to
// the icon's right. Native `title` is not used on purpose — it is a ~1s OS
// tooltip that several browsers suppress inside a dense list.
function HasNote() {
  return (
    <span className="group/note relative ml-1.5 inline-flex align-middle">
      <span
        role="img"
        aria-label="has personal note"
        className="cursor-help select-none text-xs leading-none transition-transform group-hover/note:scale-110"
      >
        📝
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-full top-1/2 z-20 ml-1.5 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium normal-case tracking-normal text-foreground opacity-0 shadow-md transition-opacity group-hover/note:opacity-100 max-sm:hidden"
      >
        has note
      </span>
    </span>
  );
}

// Empty inbox. Self-sufficient for the mainstream user (a primary in-web action),
// honest for devs (the CLI/file path stays, demoted to progressive transparency).
function InboxEmpty({ count, filtered }: { count: number; filtered: boolean }) {
  if (filtered) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-12 text-center">
        <p className="font-display text-lg">No matches</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Clear the search to see the full inbox.</p>
      </div>
    );
  }
  return (
    <div className="dot-bg mt-4 overflow-hidden rounded-2xl border border-border bg-surface/50 bg-origin-border bg-gradient-to-tr from-brand/10 via-transparent to-transparent shadow-lg">
      <div className="flex items-center gap-2 border-b border-foreground/10 px-5 py-3">
        <span className="size-2.5 rounded-full bg-foreground/15" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-foreground/15" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-foreground/15" aria-hidden="true" />
        <span className="ml-3 font-mono text-xs tracking-wide text-muted">career-ops · inbox</span>
      </div>
      <div className="px-6 py-10 text-center">
        <p className="font-display text-lg">
          Your <span className="text-brand">inbox</span> is empty.
        </p>
        {count > 0 ? (
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">Nothing pending right now.</p>
        ) : (
          <>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted">Find roles that match your CV — free, no tokens spent.</p>
            <Link
              href="/explore?run=1"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground shadow-sm transition-all duration-200 hover:bg-brand-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <Compass className="size-4" /> Run your first free scan <ArrowRight className="size-4" />
            </Link>
            <p className="mx-auto mt-4 max-w-sm text-xs text-muted">
              Prefer the terminal? Run <code className="rounded bg-surface-hover px-1 py-0.5 font-mono">career-ops scan</code>, or add job URLs to{" "}
              <code className="rounded bg-surface-hover px-1 py-0.5 font-mono">data/pipeline.md</code>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
