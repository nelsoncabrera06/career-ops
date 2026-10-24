// Human-facing company identity for tracker entries. The canonical `company`
// field remains the end employer, so `?` must never be replaced with the
// recruiter or agency recorded in `via`.

import { aliasesOf } from "./company-aliases.mjs";

const DIRECT_VIA = /^(n\/?a|tbd|none|null|-|—|–)$/i;

/**
 * Return the label and logo identity appropriate for an application row.
 * This module is plain JavaScript so the UI and its Node regression tests use
 * exactly the same behavior.
 *
 * @param {{ company?: string, via?: string }} application
 * @returns {{ label: string, logoName: string }}
 */
export function companyPresentation({ company = "", via = "" } = {}) {
  const companyName = String(company).trim();
  const intermediary = String(via).trim();

  if (companyName !== "?") return { label: company, logoName: company };
  if (intermediary && !DIRECT_VIA.test(intermediary)) {
    return {
      label: `Confidential · via ${intermediary}`,
      logoName: intermediary,
    };
  }
  return { label: "Confidential employer", logoName: "Confidential employer" };
}

/** @param {{ company?: string, via?: string, role?: string }} application
 *  @param {{names: string[], note?: string}[]} [groups] brand groups from
 *  data/company-aliases.json — see company-aliases.mjs. Optional so every
 *  existing caller (and test) keeps working unchanged. */
export function companySearchText(application, groups = []) {
  const { label } = companyPresentation(application);
  const base = `${application?.company ?? ""} ${application?.via ?? ""} ${label} ${application?.role ?? ""}`;
  // The aliases are why this function takes the groups at all: a row filed as
  // "Netkel Consulting" must answer a search for "Cosys Global" or "Kelsoft".
  const aliases = aliasesOf(application?.company ?? "", groups);
  return aliases.length ? `${base} ${aliases.join(" ")}` : base;
}
