import { test } from "node:test";
import assert from "node:assert/strict";
import {
  certificationSummary,
  formatCertDate,
  parseCertificationInventory,
  parseCvSections,
  verificationUrl,
} from "../../src/lib/cv/profile-facts.mjs";

const INVENTORY = `# Certifications — Registro completo

| # | Certificación | Emisor | Fecha | Credencial | En CV |
|---|---------------|--------|-------|------------|-------|
| 1 | Claude Code in Action | Anthropic (Skilljar) | 2026-03-01 | \`puinpy7v7hqk\` | ✅ |
| 11 | Machine Learning | Stanford University via Coursera | 2021-11-03 | \`5ZXUS5NAV9XP\` | ✅ |
| 13 | PRDV151: Bitcoin for Everybody | Saylor Academy | 2025-09-19 | \`7713009754NC\` | — |

## Detalle por emisor

| Curso | Fecha | Horas | Créditos | Puntaje |
|-------|-------|-------|----------|---------|
| PRDV151: Bitcoin for Everybody | 2025-09-19 | 12 h | 1.2 | 86.36 |
`;

test("parseCertificationInventory reads the inventory table only", () => {
  const rows = parseCertificationInventory(INVENTORY);
  assert.equal(rows.length, 3, "the per-issuer detail table must not be read as inventory");
  assert.deepEqual(rows[0], {
    n: 1,
    title: "Claude Code in Action",
    issuer: "Anthropic (Skilljar)",
    date: "2026-03-01",
    dateApproximate: false,
    credential: "puinpy7v7hqk",
    verifyUrl: "https://verify.skilljar.com/c/puinpy7v7hqk",
    onCv: true,
  });
  assert.equal(rows[2].title, "PRDV151: Bitcoin for Everybody");
  assert.equal(rows[2].onCv, false);
  assert.equal(rows[2].verifyUrl, null, "Saylor has no known verifier URL — no link is better than a guessed one");
});

test("parseCertificationInventory flags a PDF-derived date without keeping the marker in it", () => {
  const md = `## Inventario

| # | Certificación | Emisor | Fecha | Credencial | En CV |
|---|---|---|---|---|---|
| 2 | Claude 101 | Anthropic (Skilljar) | 2026-03-02 ¹ | \`yfz\` | ✅ |
`;
  const [row] = parseCertificationInventory(md);
  assert.equal(row.date, "2026-03-02");
  assert.equal(row.dateApproximate, true);
});

test("parseCertificationInventory survives a missing file or a file with no table", () => {
  assert.deepEqual(parseCertificationInventory(""), []);
  assert.deepEqual(parseCertificationInventory(null), []);
  assert.deepEqual(parseCertificationInventory("# Certifications\n\nNothing here yet.\n"), []);
});

test("parseCertificationInventory stops at the next heading and skips malformed rows", () => {
  const md = `## Inventario

| # | Certificación | Emisor | Fecha | Credencial | En CV |
|---|---|------|---|---|---|
| 1 | A | B | 2026-01-01 | \`x\` | ✅ |
| not-a-number | B | C | 2026-01-01 | \`y\` | ✅ |
| 2 | short row |

## Otro
| 3 | C | D | 2026-01-01 | \`z\` | ✅ |
`;
  const rows = parseCertificationInventory(md);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "A");
});

test("certificationSummary splits CV-visible from context-only", () => {
  assert.deepEqual(certificationSummary(parseCertificationInventory(INVENTORY)), {
    total: 3,
    onCv: 2,
    contextOnly: 1,
  });
  assert.deepEqual(certificationSummary(undefined), { total: 0, onCv: 0, contextOnly: 0 });
});

test("parseCvSections keeps every ## block in file order", () => {
  const md = `# CV -- Someone

**Location:** Somewhere

## Professional Summary

DevOps engineer.

## Work Experience

### Acme — Remote

**Engineer**
- did things

## Education

**BSc** -- Some University
`;
  const sections = parseCvSections(md);
  assert.deepEqual(
    sections.map((s) => s.heading),
    ["Professional Summary", "Work Experience", "Education"],
  );
  assert.equal(sections[0].body, "DevOps engineer.");
  assert.match(sections[1].body, /### Acme — Remote/);
  assert.match(sections[2].body, /\*\*BSc\*\*/);
  // The H1 header block is not a section: the tab renders sections, not the doc.
  assert.equal(sections.some((s) => s.heading.includes("Somewhere")), false);
});

test("parseCvSections handles no headings, CRLF, and repeated headings", () => {
  assert.deepEqual(parseCvSections("just text\n"), []);
  assert.deepEqual(parseCvSections(""), []);
  assert.equal(parseCvSections("## A\r\nbody\r\n")[0].body, "body");
  const repeated = parseCvSections("## A\nx\n## A\ny\n");
  assert.equal(repeated.length, 2);
  assert.equal(repeated[1].key, "A#2");
});

test("formatCertDate is locale-free and passes non-ISO values through", () => {
  assert.equal(formatCertDate("2026-03-01"), "Mar 2026");
  assert.equal(formatCertDate("2021-11-03"), "Nov 2021");
  assert.equal(formatCertDate("2026-03-02 ¹"), "2026-03-02 ¹");
  assert.equal(formatCertDate(undefined), "");
});

test("verificationUrl only builds links for issuers with a known verifier", () => {
  assert.equal(verificationUrl("Anthropic (Skilljar)", "abc"), "https://verify.skilljar.com/c/abc");
  assert.equal(verificationUrl("Stanford University via Coursera", "XYZ"), "https://coursera.org/verify/XYZ");
  assert.equal(verificationUrl("The Linux Foundation", "LF-1"), null);
  assert.equal(verificationUrl("Anthropic (Skilljar)", ""), null);
});
