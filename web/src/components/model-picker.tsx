"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { filterCatalog } from "@/lib/model-catalog.mjs";

/**
 * The model picker under "AI Engine" in Config.
 *
 * WHY IT IS A SEPARATE SECTION: the engine list answers "who runs the agent"
 * (one CLI you already have installed and signed in); this answers "which model
 * that engine uses" — a different question with a different consequence, since
 * that is what determines the provider and the cost of a run. OpenCode alone
 * reaches ~4 providers here, so without this section the provider is chosen by
 * a hidden heuristic (a free-model preference) rather than by the user.
 *
 * The choice is saved SERVER-side via /api/models (data/web-settings.json), not
 * in localStorage, because cli-model.mjs decides the model on the server for
 * every run — see lib/model-prefs.mjs for that reasoning.
 */

type CatalogModel = { id: string; name: string; free: boolean };
type CatalogGroup = { provider: string; models: CatalogModel[] };

type Payload = {
  cli: string;
  name: string;
  installed: boolean;
  supportsList: boolean;
  models: string[];
  catalog: CatalogGroup[];
  size: { models: number; providers: number };
  listError: string | null;
  saved: string | null;
  envValue: string | null;
  envKey: string;
  current: {
    model: string | null;
    source: string;
    paid: boolean;
    label: string | null;
    note: { text: string; override: boolean };
  };
};

export function ModelPicker({ cliId, cliName }: { cliId: string; cliName: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Which row is in flight (`__auto__` for Automatic), so only that one spins.
  const [saving, setSaving] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setData(null);
    setQuery("");
    fetch(`/api/models?cli=${encodeURIComponent(cliId)}`)
      .then(async (r) => ({ ok: r.ok, body: (await r.json()) as Payload & { error?: string } }))
      .then(({ ok, body }) => {
        if (!alive) return;
        if (!ok) {
          setError(body.error ?? "Could not read the model list");
          return;
        }
        setData(body);
        setDraft(body.saved ?? "");
      })
      .catch(() => {
        if (alive) setError("Could not reach the local server for the model list");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [cliId]);

  async function choose(model: string | null) {
    const key = model ?? "__auto__";
    setSaving(key);
    setError(null);
    try {
      const r = await fetch("/api/models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cli: cliId, model }),
      });
      const body = (await r.json()) as Payload & { error?: string };
      if (!r.ok) {
        setError(body.error ?? "Could not save that model");
        return;
      }
      setData(body);
      setDraft(body.saved ?? "");
    } catch {
      setError("Could not save that model");
    } finally {
      setSaving(null);
    }
  }

  const catalog = data?.catalog ?? [];
  const groups = useMemo(() => filterCatalog(catalog, query) as CatalogGroup[], [catalog, query]);
  const saved = data?.saved ?? null;
  const loadingAny = saving !== null;
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  // With 439 models the saved one is off-screen on load, and a selection you
  // cannot see reads as "nothing is chosen". Bring it into view once the
  // catalog paints — once per engine/choice, not on every keystroke in the
  // search box. Computed against the scroll container instead of
  // scrollIntoView(), which would also move the page under the user.
  useEffect(() => {
    const box = listRef.current;
    const el = selectedRef.current;
    if (!box || !el || query) return;
    const top = el.offsetTop - box.offsetTop;
    box.scrollTop = Math.max(0, top - box.clientHeight / 2 + el.clientHeight / 2);
  }, [saved, data?.cli, query]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface/50 px-4 py-3 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Reading the models {cliName} can reach…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface/30 px-4 py-3 text-sm text-muted">
        {error ?? "No model information available for this engine."}
      </div>
    );
  }

  const { current } = data;

  return (
    <div className="space-y-3">
      {/* What a run would actually use right now. */}
      <div className="rounded-xl border border-border bg-surface/50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-faint">In use:</span>
          <span className="font-mono text-xs text-foreground">{current.label ?? "—"}</span>
          {current.paid && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              paid
            </span>
          )}
          {saved && saved === current.model && !current.note.override && (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              saved
            </span>
          )}
        </div>
        {current.note.text && (
          <p className={cn("mt-1 text-xs", current.note.override ? "text-amber-700 dark:text-amber-400" : "text-faint")}>
            {current.note.text}
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
          {error}
        </p>
      )}

      {/* Automatic = the policy's own pick (free when a free model exists). It is
          not shown as selected when the policy currently REFUSES to run (a
          pinnable CLI with no model resolved): an option that cannot produce a
          run must not look like the active one. */}
      <Row
        selected={!saved && current.source !== "refused"}
        onClick={() => choose(null)}
        busy={saving === "__auto__"}
        disabled={loadingAny}
        title="Automatic"
        subtitle={
          data.supportsList
            ? "Let career-ops pick — a free model from the list below, never a silent paid one."
            : "Let the engine use its own default."
        }
        trailing={null}
      />

      {data.supportsList ? (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${data.size.models} models across ${data.size.providers} providers…`}
              className="w-full rounded-xl border border-border bg-surface/60 py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50"
            />
          </div>
          <div ref={listRef} className="max-h-[22rem] space-y-4 overflow-y-auto rounded-xl border border-border bg-surface/30 p-3">
            {groups.length === 0 ? (
              <p className="px-1 py-2 text-xs text-faint">
                {catalog.length === 0
                  ? "This engine listed no models. Check that it is signed in to a provider."
                  : "No model matches that search."}
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.provider}>
                  <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                    {g.provider}
                    <span className="ml-1 font-normal normal-case tracking-normal text-faint">({g.models.length})</span>
                  </p>
                  <div className="space-y-1">
                    {g.models.map((m) => (
                      <Row
                        key={m.id}
                        selected={saved === m.id}
                        onClick={() => choose(m.id)}
                        busy={saving === m.id}
                        disabled={loadingAny}
                        title={m.name}
                        subtitle={m.id}
                        free={m.free}
                        trailing={null}
                        rowRef={saved === m.id ? selectedRef : undefined}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          {data.listError && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              The engine&apos;s model list could not be read ({data.listError}). Saving a model id will fail until it can.
            </p>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-border bg-surface/50 px-4 py-3">
          <p className="text-xs text-faint">
            {data.name} does not list its models, so type the id it accepts (for example{" "}
            <span className="font-mono">claude-sonnet-5-5</span>).
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="provider/model"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface/60 px-3 py-2 font-mono text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50"
            />
            <button
              type="button"
              onClick={() => choose(draft.trim() || null)}
              disabled={loadingAny || draft.trim() === (saved ?? "")}
              className="shrink-0 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50 max-sm:min-h-[44px]"
            >
              {saving === (draft.trim() || "__auto__") ? <Loader2 className="size-4 animate-spin" /> : "Use model"}
            </button>
          </div>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-faint">
        Applies to every run this app starts — evaluations, CVs, chat. Providers and their keys live in{" "}
        <span className="font-mono">{data.name}</span>&apos;s own configuration; this only chooses among what it reports.
      </p>
    </div>
  );
}

function Row({
  selected,
  onClick,
  busy,
  disabled,
  title,
  subtitle,
  free,
  trailing,
  rowRef,
}: {
  selected: boolean;
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  title: string;
  subtitle: string;
  free?: boolean;
  trailing?: React.ReactNode;
  rowRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={rowRef}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
        selected ? "border-brand/50 bg-brand-soft" : "border-transparent hover:bg-surface-hover",
        disabled && !busy && "opacity-70",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {busy ? (
          <Loader2 className="size-3.5 animate-spin text-muted" />
        ) : selected ? (
          <Check className="size-4 text-brand" />
        ) : (
          <span className="size-3.5 rounded-full border border-border" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm", selected ? "text-foreground" : "text-muted")}>{title}</span>
        <span className="block truncate font-mono text-[11px] text-faint">{subtitle}</span>
      </span>
      {free && (
        <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          free
        </span>
      )}
      {trailing}
    </button>
  );
}
