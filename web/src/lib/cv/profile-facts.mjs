/**
 * profile-facts.mjs — pure parsers behind the /cv "Profile" tab.
 *
 * The tab answers one question: "what does the system actually know about me?"
 * Its three sources are already canonical, and none of them is duplicated here:
 *
 *   - `cv.md`                  → the CV itself, split into its `## <section>` blocks
 *   - `data/certifications.md` → the full credential inventory (the CV is a subset)
 *   - `config/profile.yml`     → the facts that never go on a CV (read elsewhere,
 *                                by the same `readMyData` the "My data" tab uses)
 *
 * Plain `.mjs`, no I/O and no imports, so `node --test` can pin both parsers
 * without a build step or an `@/` alias loader (web/AGENTS.md, "Testing").
 */

/** Split a markdown document into its `## <heading>` blocks, in file order. */
export function parseCvSections(md) {
  const out = [];
  if (typeof md !== "string" || !md.trim()) return out;
  let current = null;
  const seen = new Map();
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      current = { heading: m[1].trim(), body: "" };
      // A repeated heading keeps both blocks readable instead of merging them
      // silently; the key is only used by the UI, never as an identity.
      const n = (seen.get(current.heading) ?? 0) + 1;
      seen.set(current.heading, n);
      if (n > 1) current.key = `${current.heading}#${n}`;
      out.push(current);
      continue;
    }
    if (current) current.body += line + "\n";
  }
  return out.map((s) => ({ ...s, body: s.body.trim() }));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `2026-03-01` → `Mar 2026`. Fixed month names and UTC arithmetic, so the server
 * and the client always render the same string (no locale, no hydration diff).
 * Anything that is not an ISO date is passed through untouched.
 */
export function formatCertDate(iso) {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso ?? "");
  const [, y, mo] = m;
  const idx = Number(mo) - 1;
  if (idx < 0 || idx > 11) return String(iso);
  return `${MONTHS[idx]} ${y}`;
}

/**
 * Where a credential can be checked, when the issuer has a public verifier.
 * Deliberately limited to the two issuers whose URL shape is stable and known;
 * anything else returns null rather than a guessed link, because a dead
 * "verify" link on a profile page is worse than no link.
 */
export function verificationUrl(issuer, credential) {
  const id = String(credential ?? "").trim();
  if (!id) return null;
  const who = String(issuer ?? "").toLowerCase();
  if (who.includes("skilljar") || who.includes("anthropic")) {
    return `https://verify.skilljar.com/c/${encodeURIComponent(id)}`;
  }
  if (who.includes("coursera")) {
    return `https://coursera.org/verify/${encodeURIComponent(id)}`;
  }
  return null;
}

/**
 * Rows of the inventory table in `data/certifications.md`.
 *
 * Scoped to the `## Inventario` section when that heading is present: the file
 * also carries a per-issuer detail table (Saylor's hours/credits/score) with a
 * different column count and no `#` column, and reading that one as an inventory
 * row would print a course twice — once with the wrong fields. When the heading
 * is missing (the user reorganised the file), the whole document is scanned
 * instead, which still excludes that detail table by the column test below.
 *
 * Accepts a row only when the first cell is an integer and all six columns the
 * inventory declares are present; a malformed line is skipped, never guessed at.
 */
export function parseCertificationInventory(md) {
  if (typeof md !== "string") return [];
  const all = md.split(/\r?\n/);
  const start = all.findIndex((l) => /^##\s+Inventario\s*$/i.test(l));
  const lines = start === -1 ? all : all.slice(start + 1);

  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+/.test(line)) break; // next section ends the table
    if (!line.trim().startsWith("|")) continue;

    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 6) continue;
    const [n, title, issuer, date, credential, onCv] = cells;
    if (!/^\d+$/.test(n)) continue; // header row / separator row

    const id = credential.replace(/`/g, "").trim();
    // The inventory marks a date derived from the PDF's own creation date with a
    // superscript ¹ (the certificate prints none). The marker is kept as a flag,
    // not as part of the date, so it renders as "Mar 2026" plus a note.
    const dateApproximate = date.includes("¹");
    rows.push({
      n: Number(n),
      title,
      issuer,
      date: date.replace(/\s*¹\s*$/, "").trim(),
      dateApproximate,
      credential: id,
      verifyUrl: verificationUrl(issuer, id),
      onCv: onCv.includes("✅"),
    });
  }
  return rows;
}

/** `{ total, onCv, contextOnly }` for the tab's one-line summary. */
export function certificationSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const onCv = list.filter((r) => r.onCv).length;
  return { total: list.length, onCv, contextOnly: list.length - onCv };
}
