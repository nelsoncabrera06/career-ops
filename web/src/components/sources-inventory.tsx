import { AlertTriangle, CircleSlash, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Source, SourceActivity, SourcesReport } from "@/lib/sources";

/**
 * The configured-source inventory, rendered server-side from
 * `sources-report.mjs` (so it is on screen immediately — the previous page
 * showed nothing until you clicked a button, which is exactly the opacity this
 * replaces).
 *
 * It answers one question: *where is career-ops searching, and where is it
 * silently not?* Every entry in `portals.yml` appears exactly once, groupable by
 * whether `scan.mjs` actually walks it.
 */

const STATE: Record<Source["status"], { dot: string; label: string; chip: string }> = {
  scannable: { dot: "bg-emerald-500", label: "scans", chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  disabled: { dot: "bg-zinc-400", label: "off", chip: "bg-surface-hover text-muted" },
  "no-provider": { dot: "bg-amber-500", label: "no provider", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  "unknown-provider": { dot: "bg-red-500", label: "bad provider", chip: "bg-red-500/15 text-red-700 dark:text-red-400" },
  handoff: { dot: "bg-sky-500", label: "websearch", chip: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  unnamed: { dot: "bg-amber-500", label: "unnamed", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
};

/** Scanning sources first, then disabled, then the ones that never run. */
function rank(s: Source): number {
  if (s.status === "scannable") return 0;
  if (s.status === "handoff") return 1;
  if (s.status === "disabled") return 2;
  return 3;
}

function order(a: Source, b: Source): number {
  return rank(a) - rank(b) || a.name.localeCompare(b.name);
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function activityLine(activity: SourceActivity | null): string | null {
  if (!activity) return null;
  const parts: string[] = [];
  if (activity.added) parts.push(`${activity.added} added`);
  if (activity.skippedLocation) parts.push(`${activity.skippedLocation} filtered by location`);
  if (!parts.length) return activity.lastSeen ? `seen ${activity.lastSeen}` : null;
  return activity.lastSeen ? `${parts.join(" · ")} · last ${activity.lastSeen}` : parts.join(" · ");
}

export function SourcesInventory({ report }: { report: SourcesReport }) {
  if (!report.available) {
    return (
      <p className="mt-6 rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
        No <code className="text-foreground">portals.yml</code> yet — nothing is being scanned. Ask the assistant to set
        up the sources to watch.
      </p>
    );
  }
  if (report.error) {
    return (
      <p className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
        {report.error}
      </p>
    );
  }

  const boards = [...report.boards].sort(order);
  const on = boards.filter((b) => b.status === "scannable");
  const off = boards.filter((b) => b.status !== "scannable");
  const companies = [...report.companies].sort(order);
  const silent = [...report.boards, ...report.companies].filter(
    (s) => s.status === "no-provider" || s.status === "unknown-provider",
  );
  const s = report.summary;
  // Distinct providers actually backing an enabled, scannable source — the
  // installed-provider count includes dozens that no entry routes to.
  const providersInUse = new Set(
    [...report.boards, ...report.companies]
      .filter((src) => src.status === "scannable" && src.provider)
      .map((src) => src.provider),
  ).size;

  return (
    <>
      {/* headline: how much of the config is actually being walked */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat value={`${s.boardsScannable}/${s.boardsEnabled}`} label="job boards scanning" />
        <Stat value={`${s.companiesScannable}/${s.companiesEnabled}`} label="company boards scanning" />
        <Stat value={s.skipped + s.unknownProvider} label="skipped silently" tone={s.skipped + s.unknownProvider > 0 ? "warn" : "ok"} />
        <Stat value={providersInUse} label="providers in use" />
      </div>

      {silent.length > 0 && (
        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-4" />
            {silent.length} enabled {silent.length === 1 ? "source is" : "sources are"} skipped on every scan
          </div>
          <p className="mt-1 text-muted">
            {s.unknownProvider > 0 && (
              <>
                {s.unknownProvider} name a provider that does not exist; the rest have no provider claiming them.{" "}
              </>
            )}
            Nothing is fetched for them, and a scan reports no error — they look exactly like a source that found
            nothing.
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted">
            {silent.map((src) => (
              <li key={`${src.kind}-${src.index}`}>{src.name}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
          Job boards · {on.length} scanning
        </h2>
        {on.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
            No job boards are enabled. Add one under <code className="text-foreground">job_boards:</code> in{" "}
            <code className="text-foreground">portals.yml</code>.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface/40">
            {on.map((b) => (
              <SourceRow key={`board-${b.index}`} source={b} />
            ))}
          </ul>
        )}
      </section>

      {off.length > 0 && (
        <details className="mt-6 rounded-2xl border border-border bg-surface/30 px-4 py-3">
          <summary className="cursor-pointer text-sm text-muted">
            {off.length} configured {off.length === 1 ? "board is" : "boards are"} not scanning
          </summary>
          <ul className="mt-3 divide-y divide-border">
            {off.map((b) => (
              <SourceRow key={`board-off-${b.index}`} source={b} compact />
            ))}
          </ul>
        </details>
      )}

      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
          Company boards · {s.companiesScannable} scanning of {s.companiesEnabled} enabled
        </h2>
        <p className="mt-1 text-xs text-faint">
          One board per employer (Greenhouse, Ashby, Lever…). {s.handoff > 0 && <>{s.handoff} fall back to a websearch. </>}
          Open the list to check a specific company.
        </p>
        <details className="mt-3 rounded-2xl border border-border bg-surface/30 px-4 py-3">
          <summary className="cursor-pointer text-sm text-muted">
            All {companies.length} configured companies
          </summary>
          <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {companies.map((c) => (
              <li key={`company-${c.index}`} className="flex items-center gap-2 text-sm">
                <span className={cn("size-1.5 shrink-0 rounded-full", STATE[c.status].dot)} />
                <span className="truncate">{c.name}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-faint">{c.provider ?? STATE[c.status].label}</span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <p className="mt-8 text-xs text-faint">
        Backed by <code className="text-muted">portals.yml</code> — edit it directly or ask the assistant. This list is
        what <code className="text-muted">scan.mjs</code> walks; whether a board is answering right now is the live check
        below.
      </p>
    </>
  );
}

function SourceRow({ source, compact = false }: { source: Source; compact?: boolean }) {
  const state = STATE[source.status];
  const activity = activityLine(source.activity);
  const queries = source.config.queries ?? [];

  return (
    <li className={cn("px-4", compact ? "py-2" : "py-3")}>
      <div className="flex items-center gap-2.5">
        <span className={cn("size-1.5 shrink-0 rounded-full", state.dot)} />
        <span className="text-sm font-medium">{source.name}</span>
        {source.provider ? (
          <span className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[10px] text-muted">{source.provider}</span>
        ) : null}
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", state.chip)}>{state.label}</span>
        {activity && <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">{activity}</span>}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-4">
        {source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="truncate font-mono text-[11px] text-faint transition-colors hover:text-brand"
          >
            {hostOf(source.url)}
          </a>
        ) : null}
        {source.config.maxPages ? (
          <span className="text-[11px] text-faint">max {source.config.maxPages} pages</span>
        ) : null}
        {queries.length > 0 ? (
          <span className="flex items-center gap-1 text-[11px] text-faint">
            <Search className="size-3" />
            {queries.slice(0, 6).join(" · ")}
            {queries.length > 6 && ` +${queries.length - 6}`}
          </span>
        ) : null}
        {source.status === "no-provider" && !source.url ? (
          <span className="text-[11px] text-faint">no URL to derive a provider from</span>
        ) : null}
        {source.notes ? <span className="text-[11px] text-faint">{source.notes}</span> : null}
      </div>
    </li>
  );
}

function Stat({ value, label, tone = "neutral" }: { value: string | number; label: string; tone?: "neutral" | "ok" | "warn" }) {
  return (
    <div className="rounded-2xl border border-border bg-surface/50 p-4">
      <div
        className={cn(
          "text-3xl font-semibold tabular-nums",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
          tone === "ok" && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-faint">{label}</div>
    </div>
  );
}

/** Used by the page when the report could not be read at all. */
export function SourcesUnavailable() {
  return (
    <p className="mt-6 flex items-center gap-2 rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
      <CircleSlash className="size-4" />
      <span>
        <code className="text-foreground">sources-report.mjs</code> not found — this needs a complete career-ops checkout.
      </span>
    </p>
  );
}
