import fs from "node:fs";
import path from "node:path";
import { resolveCli, detectClis } from "@/lib/clis";
import { pickDefaultInstalled } from "@/lib/cli-pick.mjs";
import { careerOpsRoot, readMemory } from "@/lib/career-ops";
import { buildAnswerPrompt } from "@/lib/apply/answer-prompt.mjs";
import { normalizeExtensionRequest, planTitle } from "@/lib/apply/extension-request.mjs";
import { runPlanner } from "@/lib/apply/planner";
import { extractJsonObject } from "@/lib/extract-json-object.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 320;

// Drafting endpoint for the Chrome extension (extension/). Same planner, same
// prompt, same fences as /api/apply/prefill — the difference is where the form
// came from and where the answers go. prefill reads a form its own Playwright
// session opened and writes into that session's page; here the form was read by
// a content script in the user's OWN browser tab, so there is no session and no
// page: the extension receives the answers and writes them itself, after the
// user approves each one.
//
// That split is deliberate. The server never drives the user's browser, so it
// cannot fill or submit anything, and the extension never talks to a model
// directly, so cv.md and the reports stay the single source of truth.
//
// Streaming NDJSON for the same reason as prefill: a planner run is a minute or
// three of nothing happening, and the panel shows the live log instead of a
// spinner that looks stuck.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const parsed = normalizeExtensionRequest(raw);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { url, fields } = parsed.value;
  const title = planTitle({
    company: raw.company,
    role: raw.role,
    pageTitle: parsed.value.title,
    url,
  });

  // The panel sends its saved CLI. Fall back to the machine's obvious default
  // rather than failing — the extension cannot know which CLIs exist until it
  // asks, and the user should not have to configure anything to see it work.
  const requested = typeof raw.cliId === "string" ? raw.cliId : "";
  const clis = detectClis();
  const cliId = requested || pickDefaultInstalled(clis)?.id || "";
  const resolved = cliId ? resolveCli(cliId) : null;
  if (!resolved) {
    return Response.json(
      { error: requested ? `CLI '${requested}' not found on this machine` : "no supported CLI found on this machine" },
      { status: 400 },
    );
  }
  const { spec, binPath } = resolved;

  const t0 = Date.now();
  const encoder = new TextEncoder();
  const logPath = path.join(careerOpsRoot(), ".career-ops-web", "extension-answers.log");
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
  } catch {
    /* ignore */
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* client gone */
        }
      };
      const log = (m: string) => {
        const el = Date.now() - t0;
        emit({ t: "log", m, el });
        try {
          fs.appendFileSync(logPath, `${new Date(t0 + el).toISOString()} [+${(el / 1000).toFixed(1)}s] ${m}\n`);
        } catch {
          /* ignore */
        }
      };
      // Idempotent, like the sibling routes: more than one path reaches fail().
      let failed = false;
      const fail = (m: string, detail?: string) => {
        if (failed) return;
        failed = true;
        log(`ERROR: ${m}`);
        emit({ t: "error", m, ...(detail ? { detail } : {}) });
        controller.close();
      };

      try {
        fs.appendFileSync(logPath, `\n===== extension ${new Date(t0).toISOString()} cli=${cliId} url=${url} =====\n`);
      } catch {
        /* ignore */
      }

      const mem = readMemory().trim();
      const prompt = buildAnswerPrompt({ title, fields, memory: mem });

      log(`Form: "${title}" · ${fields.length} fields · prompt ${prompt.length} chars`);
      log(`Planner: ${cliId} (${binPath})`);
      emit({ t: "form", title, fields: fields.length });

      const result = await runPlanner({
        cliId,
        spec,
        binPath,
        prompt,
        fieldCount: fields.length,
        cwd: careerOpsRoot(),
        t0,
        log,
      });

      if (result.refused) return fail(result.refused);

      if (!result.buf.trim()) {
        return fail(
          result.signal
            ? "planner was killed before producing any output (try again / smaller form)"
            : "planner produced no output (check the CLI works in this folder)",
        );
      }

      const { obj, truncated } = extractJsonObject(result.buf);
      if (!obj) {
        return fail(
          result.signal
            ? "planner was killed mid-answer (form too large/slow) — couldn't recover any fields"
            : "couldn't parse the planner's answer as JSON",
          result.buf.slice(-300),
        );
      }

      const count = Object.keys(obj).length;
      log(`Parsed ${count} answers${truncated ? " (recovered from truncated output)" : ""}`);
      emit({ t: "done", answers: obj, truncated, count });
      controller.close();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
