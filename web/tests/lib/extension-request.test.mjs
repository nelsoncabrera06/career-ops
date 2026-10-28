import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeExtensionRequest, planTitle, MAX_FIELDS, MAX_LABEL } from "../../src/lib/apply/extension-request.mjs";

// --- normalizeExtensionRequest -------------------------------------------

test("accepts one well-formed field", () => {
  const r = normalizeExtensionRequest({
    url: "https://jobs.ashbyhq.com/acme/123",
    title: "Backend Engineer - Acme",
    fields: [{ id: "co0", type: "textarea", label: "Why us?", required: true }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.fields.length, 1);
  assert.equal(r.value.fields[0].label, "Why us?");
  assert.equal(r.value.fields[0].required, true);
});

test("rejects a non-object body", () => {
  for (const bad of [null, "x", 42, []]) {
    assert.equal(normalizeExtensionRequest(bad).ok, false);
  }
});

test("rejects a missing or empty field list", () => {
  assert.equal(normalizeExtensionRequest({ fields: [] }).ok, false);
  assert.equal(normalizeExtensionRequest({}).ok, false);
});

test("rejects more fields than the cap, and says which cap", () => {
  const fields = Array.from({ length: MAX_FIELDS + 1 }, (_, i) => ({ id: `co${i}`, type: "text", label: `f${i}` }));
  const r = normalizeExtensionRequest({ fields });
  assert.equal(r.ok, false);
  assert.match(r.error, new RegExp(String(MAX_FIELDS)));
});

test("drops individual unusable fields instead of failing the whole form", () => {
  const r = normalizeExtensionRequest({
    fields: [
      { id: "co0", type: "text", label: "Name" },
      { id: "../../etc/passwd", type: "text", label: "traversal" },
      { id: "co1", type: "made-up", label: "unknown type" },
      null,
    ],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.value.fields.map((f) => f.id),
    ["co0"],
  );
});

test("fails when nothing at all was usable", () => {
  const r = normalizeExtensionRequest({ fields: [{ id: "bad id", type: "text" }] });
  assert.equal(r.ok, false);
});

test("bounds an oversized label", () => {
  const r = normalizeExtensionRequest({ fields: [{ id: "co0", type: "text", label: "x".repeat(5000) }] });
  assert.equal(r.ok, true);
  assert.equal(r.value.fields[0].label.length, MAX_LABEL);
});

test("keeps question line breaks but collapses runs of spaces", () => {
  const r = normalizeExtensionRequest({ fields: [{ id: "co0", type: "textarea", label: "Line one\n\n   Line   two" }] });
  assert.equal(r.value.fields[0].label, "Line one\n\nLine two");
});

test("rejects a non-http(s) url but keeps an absent one", () => {
  assert.equal(normalizeExtensionRequest({ url: "javascript:alert(1)", fields: [{ id: "co0", type: "text" }] }).ok, false);
  assert.equal(normalizeExtensionRequest({ url: "", fields: [{ id: "co0", type: "text" }] }).ok, true);
});

test("caps options and drops empty ones", () => {
  const r = normalizeExtensionRequest({
    fields: [{ id: "co0", type: "select", label: "Auth", options: ["Yes", "", "No"] }],
  });
  assert.deepEqual(r.value.fields[0].options, ["Yes", "No"]);
});

test("carries combobox and maxLength through, and omits them when absent", () => {
  const withBoth = normalizeExtensionRequest({
    fields: [{ id: "co0", type: "select", label: "Loc", combobox: true, maxLength: 40 }],
  });
  assert.equal(withBoth.value.fields[0].combobox, true);
  assert.equal(withBoth.value.fields[0].maxLength, 40);

  const withNeither = normalizeExtensionRequest({ fields: [{ id: "co0", type: "text", label: "Name" }] });
  assert.equal("combobox" in withNeither.value.fields[0], false);
  assert.equal("maxLength" in withNeither.value.fields[0], false);
});

// --- planTitle ------------------------------------------------------------

test("planTitle prefers the user's company + role", () => {
  assert.equal(planTitle({ company: "Acme", role: "Backend Engineer", pageTitle: "Careers", url: "" }), "Backend Engineer @ Acme");
});

test("planTitle falls back to the page title, then the host", () => {
  assert.equal(planTitle({ pageTitle: "Backend Engineer - Acme", url: "https://x.test" }), "Backend Engineer - Acme");
  assert.equal(planTitle({ pageTitle: "", url: "https://jobs.example.test/apply" }), "jobs.example.test");
});

test("planTitle keeps the company when only that was given", () => {
  assert.equal(planTitle({ company: "Acme", pageTitle: "Apply", url: "" }), "Apply @ Acme");
});
