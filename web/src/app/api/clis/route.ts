import { NextResponse } from "next/server";
import { detectClis, KNOWN } from "@/lib/clis";
import { resolveRunModel } from "@/lib/run-model";
import { modelLabel } from "@/lib/cli-model.mjs";

export const dynamic = "force-dynamic";

/**
 * Detects which agnostic CLIs are installed on THIS machine (local-first). The
 * web delegates career-ops to one of these in headless mode, on the user's own
 * auth/tokens — no API key needed.
 *
 * Each installed entry also carries the MODEL a run would use right now, from
 * the same policy every route applies (cli-model.mjs). It is here because the
 * CLI name alone does not say what a run costs: `pi` and `opencode` both look
 * identical in a picker, and opencode with no model once billed a paid
 * OpenRouter default. A caller that shows a picker can therefore show the model
 * next to it instead of discovering it in a bill.
 *
 * Cost: only INSTALLED entries are resolved, and the one I/O read (opencode's
 * model list) is cached in run-model.ts for 10 minutes.
 */
export async function GET() {
  const clis = detectClis().map((c) => {
    const plain = (): Record<string, unknown> => ({ ...c, model: null, modelSource: null, paid: false, modelError: null, label: null });
    if (!c.installed || !c.path) return plain();
    const spec = KNOWN.find((k) => k.id === c.id);
    if (!spec) return plain();
    const plan = resolveRunModel(spec, c.path);
    if (!plan.ok) {
      // `label` is rendered SERVER-SIDE on purpose: the "(paid)" marker is a
      // policy decision (cli-model.mjs suppresses it for the user's own pi pin,
      // which bills but is expected), and a client should not re-implement it.
      return { ...plain(), modelError: plan.error, label: modelLabel(c.name, plan) };
    }
    return { ...c, model: plan.model, modelSource: plan.source, paid: plan.paid, modelError: null, label: modelLabel(c.name, plan) };
  });
  return NextResponse.json({ clis });
}
