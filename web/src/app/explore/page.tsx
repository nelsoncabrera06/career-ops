import fs from "node:fs";
import { ExplorerView } from "@/components/explore/explorer-view";
import { seedExploreFilters } from "@/lib/core/portals";
import { configuredBoards } from "@/lib/core/portals-scan";
import { readSourcesReport } from "@/lib/sources";
import { readInbox, readApplications, careerOpsRoot } from "@/lib/career-ops";
import { DEFAULT_FILTERS, type PortalBoard } from "@/lib/explore";

// Read live data at request time so a bare checkout (or `next build` with no
// CAREER_OPS_ROOT) never fails — discovery seeds are best-effort.
export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  let seed: { filters: typeof DEFAULT_FILTERS; seededFrom: string[] } = { filters: DEFAULT_FILTERS, seededFrom: [] };
  try {
    seed = seedExploreFilters();
  } catch {
    /* bare checkout → defaults */
  }

  // The boards this scan can ALSO walk with `scan.mjs` (the second engine: a
  // national board, an aggregator, a tech board — everything the four ATS
  // datasets can't reach). Seeded ON so a first scan actually covers them, and
  // listed so the Sources row shows what is being searched instead of hiding
  // whole markets behind four familiar names.
  let portalBoards: PortalBoard[] = [];
  try {
    const report = await readSourcesReport();
    portalBoards = report.boards
      .filter((b) => b.enabled && b.status === "scannable")
      .map((b) => ({ name: b.name, provider: b.provider }));
    if (!portalBoards.length) {
      // sources-report.mjs unavailable (old checkout): fall back to reading the
      // config directly, which cannot resolve providers but can still list names.
      portalBoards = configuredBoards();
    }
  } catch {
    portalBoards = [];
  }
  seed = { ...seed, filters: { ...seed.filters, portals: portalBoards.map((b) => b.name) } };

  let rootExists = false;
  try {
    rootExists = fs.existsSync(careerOpsRoot());
  } catch {
    /* ignore */
  }
  return (
    <ExplorerView
      seed={seed}
      portalBoards={portalBoards}
      inboxSnapshot={readInbox()}
      appsSnapshot={readApplications()}
      rootExists={rootExists}
    />
  );
}
