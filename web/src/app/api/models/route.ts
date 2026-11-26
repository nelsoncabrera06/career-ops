import { NextResponse } from "next/server";
import { KNOWN, resolveCli } from "@/lib/clis";
import { listOpencodeModels, resolveRunModel } from "@/lib/run-model";
import { explicitModel, envKeyFor, modelLabel } from "@/lib/cli-model.mjs";
import { catalogSize, modelCatalog, sourceNote } from "@/lib/model-catalog.mjs";
import { savedModelFor, saveModelFor } from "@/lib/model-prefs.mjs";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // the answer changes as soon as Config saves

/**
 * The AI MODEL Config offers for one engine — and the single write path for
 * that choice (`data/web-settings.json`, see lib/model-prefs.mjs).
 *
 * WHY THIS IS A ROUTE AND NOT localStorage: the engine pick (saved-cli.ts) is a
 * browser-side hint, but the model is decided SERVER-side by cli-model.mjs for
 * every route that spawns a CLI. The server cannot read localStorage, so the
 * choice has to live where the decision is made — otherwise Config would show a
 * selection that no run ever uses.
 *
 * Only opencode has a command that lists models (`opencode models`). The other
 * runtimes are reported honestly as `supportsList: false` with a free-text id
 * field, rather than a made-up list of ids this code cannot verify.
 */

const LISTABLE = new Set(["opencode"]);

type ModelList = { ids: string[] | null; error: string | null };

function listFor(cliId: string, binPath: string | null): ModelList {
  if (!binPath || !LISTABLE.has(cliId)) return { ids: null, error: null };
  if (cliId === "opencode") return listOpencodeModels(binPath);
  return { ids: null, error: null };
}

/** The whole picture for one CLI: what is saved, what wins, and what is listable. */
function describe(rawCliId: string) {
  const cliId = rawCliId;
  const spec = KNOWN.find((c) => c.id === cliId);
  if (!spec) return { error: `unknown CLI '${cliId}'`, status: 400 as const };

  const resolved = resolveCli(cliId);
  const binPath = resolved?.binPath ?? null;
  const installed = Boolean(binPath);

  const list = listFor(cliId, binPath);
  const catalog = list.ids ? modelCatalog(list.ids) : [];
  const saved = savedModelFor(careerOpsRoot(), cliId);
  const envValue = explicitModel(cliId, process.env);
  const envKey = envKeyFor(cliId);

  // The plan is what a run would actually get right now — resolved by the SAME
  // function the run routes use, so "what Config says" and "what a run does"
  // cannot drift into two answers.
  const plan = installed && resolved ? resolveRunModel(spec, resolved.binPath) : null;

  return {
    cli: cliId,
    name: spec.name,
    installed,
    binPath,
    supportsList: LISTABLE.has(cliId) && installed,
    models: list.ids ?? [],
    catalog,
    size: catalogSize(catalog),
    listError: list.error,
    saved,
    envValue,
    envKey,
    current: plan
      ? plan.ok
        ? {
            model: plan.model,
            source: plan.source,
            paid: plan.paid,
            label: modelLabel(spec.name, plan),
            note: sourceNote(plan.source, envValue, envKey),
          }
        : { model: null, source: "refused", paid: false, label: modelLabel(spec.name, plan), note: { text: plan.error, override: false } }
      : { model: null, source: "not-installed", paid: false, label: null, note: { text: "", override: false } },
  };
}

export async function GET(req: Request) {
  const cli = new URL(req.url).searchParams.get("cli") ?? "";
  const payload = describe(cli);
  if ("error" in payload) return NextResponse.json({ error: payload.error }, { status: payload.status });
  return NextResponse.json(payload);
}

/**
 * Save the choice for one engine. `model: null` (or "") clears it back to
 * Automatic, which is a real option rather than an absence of one: it restores
 * the policy's own free pick.
 */
export async function PUT(req: Request) {
  let body: { cli?: unknown; model?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (typeof body.cli !== "string" || !body.cli) {
    return NextResponse.json({ error: "cli required" }, { status: 400 });
  }
  const spec = KNOWN.find((c) => c.id === body.cli);
  if (!spec) return NextResponse.json({ error: `unknown CLI '${String(body.cli)}'` }, { status: 400 });

  // Validate against the live list when the runtime can produce one: a typo or
  // a model that rotated out is refused HERE, where the user can see why,
  // instead of being saved and then failing inside a headless run.
  const resolved = resolveCli(spec.id);
  const list = listFor(spec.id, resolved?.binPath ?? null);
  const result = await saveModelFor(careerOpsRoot(), spec.id, body.model, list.ids);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const payload = describe(spec.id);
  if ("error" in payload) return NextResponse.json({ error: payload.error }, { status: payload.status });
  return NextResponse.json(payload);
}
