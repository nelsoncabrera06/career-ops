import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as yaml from "js-yaml";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import type { DiscoveredOffer, ExploreFilters, FitBand, ScanEvent } from "@/lib/explore";
import {
  buildSweepConfig,
  parseSweepReceipt,
  receiptOffers,
  sweepableBoards,
  sweepAnnotations,
} from "./portals-sweep.mjs";

/**
 * The SECOND discovery engine behind one Fresh scan.
 *
 * `scan-ats-full.mjs` reads four public ATS datasets. Everything else the user
 * configured in `portals.yml` — a national board like Computrabajo, an
 * aggregator like ZonaJobs/Bumeran, a tech board like EmpleosIT, a single
 * eightfold tenant — is only reachable through `scan.mjs`, which the web layer
 * never invoked: those boards were scanned only when the user remembered to run
 * the CLI, and a Fresh scan said nothing about them at all. That silence is the
 * bug this file fixes.
 *
 * Rules it keeps:
 *  • Config, not code. The sweep runs `scan.mjs` with an EPHEMERAL config file
 *    (CAREER_OPS_PORTALS), exactly like the ATS sweep does, so the user's real
 *    `portals.yml` is never rewritten and no filter semantics are duplicated
 *    here — the core still decides what passes its title/location filters.
 *  • `--dry-run`: discovery writes nothing. Chosen offers reach the pipeline
 *    only through the explicit "Add to pipeline" path.
 *  • Honest failure. A timeout or a crash is reported as a source that did not
 *    finish, never as "no new roles".
 */

/** Boards the sweep can actually run, read from the user's real `portals.yml`.
 *  Server-only; never throws — a missing/broken config yields [] and the sweep
 *  simply does not happen (the ATS sweep is unaffected). */
export function configuredBoards(): { name: string; provider: string | null }[] {
  try {
    const doc = yaml.load(fs.readFileSync(path.join(careerOpsRoot(), "portals.yml"), "utf8"));
    return sweepableBoards(doc);
  } catch {
    return [];
  }
}

export type PortalsSweepResult = {
  offers: DiscoveredOffer[];
  /** Boards the sweep was asked to walk (0 = nothing ran). */
  boards: number;
  /** Killed at the deadline, or crashed without a receipt. */
  incomplete: boolean;
  /** Why it did not finish, when it did not. */
  error?: string;
};

function cleanupTemp(file: string): void {
  try {
    if (file.startsWith(os.tmpdir()) && file.includes("career-ops-explore-sweep-")) fs.unlinkSync(file);
  } catch {
    /* best-effort */
  }
}

/**
 * Run `scan.mjs` over the selected boards, ONE CHILD PER BOARD in parallel,
 * each stopped after `timeoutMs`, streaming what they found into `sink`.
 *
 * One child for every board used to lose the whole sweep to its slowest board:
 * `scan.mjs` emits its offers only in the receipt at the end, so a single board
 * that outlasted the deadline (FullStack Labs walks ~100 pages and can take
 * 5-6 minutes) took every other board's results with it. Per-board children
 * bound each board separately, so a slow or broken board is named as incomplete
 * while the others still deliver their offers.
 */
export function runPortalsSweep(
  filters: ExploreFilters,
  onEvent: (e: ScanEvent) => void,
  sink: { offers: DiscoveredOffer[]; seen: Set<string> },
  timeoutMs: number,
  roleTargets: string[] = [],
): Promise<PortalsSweepResult> {
  const scanScript = (() => {
    try {
      return rootScript("scan");
    } catch {
      return null;
    }
  })();
  if (!scanScript || !fs.existsSync(scanScript) || filters.portals.length === 0) {
    return Promise.resolve({ offers: [], boards: 0, incomplete: false });
  }

  let doc: unknown = null;
  try {
    doc = yaml.load(fs.readFileSync(path.join(careerOpsRoot(), "portals.yml"), "utf8"));
  } catch {
    return Promise.resolve({ offers: [], boards: 0, incomplete: false });
  }

  const base = buildSweepConfig(doc as Record<string, unknown>, filters, filters.portals);
  const selected = Array.isArray(base.job_boards)
    ? base.job_boards.filter((b): b is { name: string } => !!b && typeof b.name === "string")
    : [];
  if (selected.length === 0) {
    // Nothing selected survives in the config (a board renamed, or every
    // selected entry disabled since the page was rendered) — say so, don't scan.
    return Promise.resolve({ offers: [], boards: 0, incomplete: false });
  }

  return new Promise<PortalsSweepResult>((resolve) => {
    const seconds = String(Math.max(1, filters.sinceDays || 7));
    const failures: string[] = [];
    const out: DiscoveredOffer[] = [];
    let remaining = selected.length;

    onEvent({ kind: "atsStart", ats: "portals", companies: selected.length });

    const settleOne = () => {
      remaining -= 1;
      if (remaining > 0) return;
      onEvent({ kind: "atsDone", ats: "portals", unreachable: failures.length });
      resolve({
        offers: out,
        boards: selected.length,
        incomplete: failures.length > 0,
        error: failures.length ? failures.join("; ") : undefined,
      });
    };

    for (const board of selected) {
      // Each child gets a config with just its own board, so one board's
      // deadline cannot consume another's.
      const config = buildSweepConfig(doc as Record<string, unknown>, filters, [board.name]);
      const temp = path.join(os.tmpdir(), `career-ops-explore-sweep-${randomUUID()}.yml`);
      try {
        fs.writeFileSync(temp, yaml.dump(config, { lineWidth: 120 }), "utf8");
      } catch {
        failures.push(`${board.name}: could not write a scan config`);
        settleOne();
        continue;
      }

      const child = spawn(
        process.execPath,
        [scanScript, "--dry-run", "--json", "--quiet", "--since", seconds],
        { cwd: careerOpsRoot(), env: { ...process.env, CAREER_OPS_PORTALS: temp } },
      );

      let outBuf = "";
      let timedOut = false;
      let hardKiller: ReturnType<typeof setTimeout> | undefined;
      let settled = false;

      const settle = (error?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(killer);
        if (hardKiller) clearTimeout(hardKiller);
        cleanupTemp(temp);
        if (error) failures.push(error);
        settleOne();
      };

      const killer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        hardKiller = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* ignore */
          }
        }, 5_000);
      }, timeoutMs);

      child.stdout?.on("data", (d: Buffer) => {
        outBuf += d.toString();
      });
      child.on("error", (e) => {
        settle(`${board.name}: ${e instanceof Error ? e.message : "failed to start"}`);
      });
      child.on("close", () => {
        const receipt = parseSweepReceipt(outBuf) as Parameters<typeof receiptOffers>[0];
        if (!receipt) {
          settle(timedOut ? `${board.name} timed out before finishing` : `${board.name}: no readable result`);
          return;
        }

        for (const r of receiptOffers(receipt) as {
          url: string;
          company: string;
          title: string;
          location: string;
          source: string;
          postedAt: string;
        }[]) {
          if (sink.seen.has(r.url)) continue; // already surfaced by another board or the ATS sweep
          sink.seen.add(r.url);
          // sweepAnnotations lives in a plain-JS module (portals-sweep.mjs), so its
          // inferred return type widens `fit.band` to string. titleFit() only ever
          // returns a FitBand, so state that here rather than narrowing per call.
          const ann = sweepAnnotations(r.title, filters.positive, roleTargets) as {
            matchedKeyword?: string;
            fit?: { band: FitBand; score: number };
          };
          const offer: DiscoveredOffer = {
            company: r.company,
            title: r.title,
            location: r.location,
            postedAt: r.postedAt,
            // The board label doubles as the badge: "Computrabajo Argentina" reads
            // as the source it came from, not as a generic "portals".
            ats: r.source,
            source: r.source,
            url: r.url,
            ...ann,
          };
          out.push(offer);
          sink.offers.push(offer);
          onEvent({ kind: "offer", offer });
        }
        settle(timedOut ? `${board.name} timed out before finishing` : undefined);
      });
    }
  });
}
