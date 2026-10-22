import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

/**
 * One configured scanning source, as `sources-report.mjs` describes it.
 *
 * `status` is the whole point of the inventory: `scannable` means `scan.mjs`
 * will walk it, while `no-provider` / `unknown-provider` mean it is enabled but
 * silently skipped on every run — indistinguishable from "found nothing" if you
 * only look at results.
 */
export type SourceStatus =
  | "scannable"
  | "disabled"
  | "no-provider"
  | "unknown-provider"
  | "handoff"
  | "unnamed";

export type SourceActivity = {
  added: number;
  skippedLocation: number;
  lastSeen: string | null;
  /** True when the count came from the provider's ledger label (one enabled entry owns it). */
  byProvider?: boolean;
};

export type Source = {
  name: string;
  kind: "board" | "company";
  /** Position in its own section of portals.yml — unique within a kind, not across kinds. */
  index: number;
  enabled: boolean;
  status: SourceStatus;
  provider: string | null;
  problem: string | null;
  scanMethod: string | null;
  url: string;
  notes: string | null;
  config: { queries?: string[]; locations?: string[]; maxPages?: number; options?: Record<string, unknown> };
  activity: SourceActivity | null;
};

export type SourcesReport = {
  available: boolean;
  portalsFile?: string;
  generatedAt?: string;
  error?: string;
  boards: Source[];
  companies: Source[];
  summary: {
    boards: number;
    boardsEnabled: number;
    boardsScannable: number;
    companies: number;
    companiesEnabled: number;
    companiesScannable: number;
    skipped: number;
    unknownProvider: number;
    handoff: number;
    disabled: number;
    providers?: number;
  };
};

const EMPTY: SourcesReport = {
  available: false,
  boards: [],
  companies: [],
  summary: {
    boards: 0, boardsEnabled: 0, boardsScannable: 0,
    companies: 0, companiesEnabled: 0, companiesScannable: 0,
    skipped: 0, unknownProvider: 0, handoff: 0, disabled: 0,
  },
};

/**
 * Ask the core for the inventory.
 *
 * It shells out to `sources-report.mjs` rather than re-deriving provider
 * resolution here: which provider claims an entry is decided by
 * `resolveProvider()` + each provider's `detect()`, and a second copy of that
 * rule in the web layer would drift from the scanner the first time a provider
 * ships. Offline and instant — provider resolution is pure config matching.
 */
export async function readSourcesReport(): Promise<SourcesReport> {
  let script: string;
  try {
    script = rootScript("sources-report");
  } catch {
    return EMPTY;
  }
  if (!fs.existsSync(script)) return EMPTY;

  const stdout = await new Promise<string>((resolve) => {
    execFile(
      "node",
      [script],
      { cwd: careerOpsRoot(), timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
      (_err, out) => resolve(out || ""),
    );
  });

  const start = stdout.indexOf("{");
  if (start === -1) return EMPTY;
  try {
    const parsed = JSON.parse(stdout.slice(start)) as SourcesReport;
    return { ...EMPTY, ...parsed };
  } catch {
    return EMPTY;
  }
}
