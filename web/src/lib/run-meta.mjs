/**
 * Split the run's technical preamble off an assistant message.
 *
 * WHY: every assistant turn starts with two lines the CLI/route emits for
 * honesty, not for the reader — which model is being billed, and whether the
 * runtime can be permission-restricted:
 *
 *   🔧 OpenCode · opencode/deepseek-v4.1-flash
 *   ⚠️ OpenCode cannot be permission-restricted — this agent runs with its default access
 *
 * They must stay REACHABLE (a run that is not fenced must not look like one,
 * #2507), but they are not the answer, and printing them at the top of a chat
 * turn buries the answer. The console renders them folded under a "Run details"
 * summary; this decides what belongs there.
 *
 * Only a LEADING run of such lines is meta: a ⚠️ in the middle of a real answer
 * ("⚠️ the posting is expired") is content, and must not be pulled into the fold.
 *
 * Pure: no imports, no I/O — `node --test` exercises the real rule.
 */

/** The prefixes the routes use for run metadata. `⚠` without the variation
 * selector is included so a plain-ASCII fallback still classifies. */
const META_PREFIXES = ["🔧", "⚠"];

/**
 * @param {unknown} text
 * @returns {{ meta: string[], body: string }}
 */
export function splitRunMeta(text) {
  const lines = String(text ?? "").split("\n");
  const meta = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue; // blank padding is not body yet
    const trimmed = line.trimStart();
    if (!META_PREFIXES.some((p) => trimmed.startsWith(p))) break;
    meta.push(line.trim());
  }
  return { meta, body: lines.slice(i).join("\n").trimStart() };
}
