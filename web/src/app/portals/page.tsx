import { Radar } from "lucide-react";
import { PortalsView } from "@/components/portals-view";
import { SourcesInventory, SourcesUnavailable } from "@/components/sources-inventory";
import { readSourcesReport } from "@/lib/sources";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const report = await readSourcesReport();

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center gap-3">
        <Radar className="size-6 text-brand" />
        <h1 className="font-display text-2xl tracking-tight text-landing">Portals</h1>
      </div>
      <p className="mt-1.5 max-w-xl text-sm text-muted">
        Where career-ops searches. Every job board and company board configured in{" "}
        <code className="text-foreground">portals.yml</code>, which provider reads it, and what it has actually brought in
        — so a board that is switched off, or silently skipped, is visible instead of looking like a quiet week.
      </p>

      {report.available || report.error ? <SourcesInventory report={report} /> : <SourcesUnavailable />}

      <section className="mt-12 border-t border-border pt-8">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Live health check</h2>
        <p className="mt-2 max-w-xl text-sm text-muted">
          The list above is config. This is the network: it asks every enabled source whether it answers right now, and
          catches the boards that have quietly broken — a broken board disappears from every future scan without
          erroring.
        </p>
        <div className="mt-5">
          <PortalsView />
        </div>
      </section>
    </div>
  );
}
