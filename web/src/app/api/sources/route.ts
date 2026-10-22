import { readSourcesReport } from "@/lib/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The configured-source inventory behind the Sources page. Offline: it shells
// out to `sources-report.mjs`, which resolves every portals.yml entry through
// the SAME provider registry `scan.mjs` uses. Rendering the page server-side
// calls readSourcesReport() directly; this route exists for clients that want
// the raw JSON (and mirrors /api/followups, /api/doctor).
export async function GET() {
  const report = await readSourcesReport();
  return Response.json(report);
}
