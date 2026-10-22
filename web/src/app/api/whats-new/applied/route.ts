import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { careerOpsRoot, readApplications, rootScript } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

function cleanCell(value: unknown, max = 500): string {
  return typeof value === "string" ? value.replace(/[\t\r\n|]+/g, " ").trim().slice(0, max) : "";
}

function samePosting(a: string, b: string): boolean {
  const href = (value: string) => value.match(/\]\((https?:\/\/[^)]+)\)/)?.[1] || value;
  try {
    const x = new URL(href(a));
    const y = new URL(href(b));
    x.hash = y.hash = "";
    return x.href.replace(/\/$/, "") === y.href.replace(/\/$/, "");
  } catch {
    return false;
  }
}

async function run(script: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return execFileAsync(process.execPath, [script, ...args], { cwd, env, timeout: 60_000, maxBuffer: 2_000_000 });
}

/** Record a manually submitted application without spending tokens on evaluation. */
export async function POST(req: Request) {
  let body: { offer?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const offer = body.offer || {};
  const url = cleanCell(offer.url, 2_000);
  const company = cleanCell(offer.company, 200);
  const role = cleanCell(offer.title, 300);
  if (!/^https?:\/\//i.test(url) || !company || !role) {
    return Response.json({ error: "a posting URL, company and role are required" }, { status: 400 });
  }
  const existing = readApplications().find((app) => app.applyLink && samePosting(app.applyLink, url));

  const root = careerOpsRoot();
  const reserveScript = rootScript("reserve-report-num");
  const mergeScript = rootScript("merge-tracker");
  if (!fs.existsSync(reserveScript) || !fs.existsSync(mergeScript)) {
    return Response.json({ error: "manual application tracking needs the career-ops scripts" }, { status: 503 });
  }

  const codeRoot = path.dirname(reserveScript);
  const env = { ...process.env, CAREER_OPS_ROOT: root };
  if (existing) {
    const statusScript = rootScript("set-status");
    try {
      await run(statusScript, ["--row", existing.n, "Applied", "--source", "web", "--json"], codeRoot, env);
      return Response.json({ ok: true, existing: true, n: existing.n });
    } catch (error) {
      console.error(`/api/whats-new/applied: status update failed: ${error instanceof Error ? error.message : String(error)}`);
      return Response.json({ error: "could not update this tracker row to Applied" }, { status: 500 });
    }
  }
  let num = "";
  let addition = "";
  try {
    const reserved = await run(reserveScript, [], codeRoot, env);
    num = reserved.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^\d+$/.test(line)).at(-1) || "";
    if (!num) throw new Error("could not reserve a tracker number");

    const dir = path.join(root, "batch", "tracker-additions");
    fs.mkdirSync(dir, { recursive: true });
    addition = path.join(dir, `${num}-manual-applied-${Date.now()}.tsv`);
    const dateParts = new Intl.DateTimeFormat("en", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const date = `${dateParts.find((p) => p.type === "year")?.value}-${dateParts.find((p) => p.type === "month")?.value}-${dateParts.find((p) => p.type === "day")?.value}`;
    const headers = ["num", "date", "company", "role", "status", "score", "pdf", "report", "notes", "url"];
    const fields = [num, date, company, role, "Applied", "N/A", "❌", "—", "Applied manually from Fresh matches; not evaluated", url];
    fs.writeFileSync(addition, `${headers.join("\t")}\n${fields.join("\t")}\n`, { flag: "wx", encoding: "utf8" });
    await run(mergeScript, [], codeRoot, env);

    const saved = readApplications().find((app) => app.applyLink && samePosting(app.applyLink, url));
    if (!saved) throw new Error("the tracker merge completed without a matching application row");
    await run(reserveScript, ["--release", num], codeRoot, env);
    return Response.json({ ok: true, n: saved.n });
  } catch (error) {
    // merge-tracker moves a merged TSV to its archive. Remove only an unmerged
    // temporary addition; release its reservation so a failed click leaves no
    // phantom tracker number behind.
    if (addition && fs.existsSync(addition)) {
      try { fs.unlinkSync(addition); } catch { /* report the original failure */ }
    }
    if (num) {
      try { await run(reserveScript, ["--release", num], codeRoot, env); } catch { /* stale reservation GC is the final fallback */ }
    }
    console.error(`/api/whats-new/applied: ${error instanceof Error ? error.message : String(error)}`);
    return Response.json({ error: "could not record the application; check Pipeline before retrying" }, { status: 500 });
  }
}
