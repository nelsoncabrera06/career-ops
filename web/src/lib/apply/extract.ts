import type { Page, Frame } from "playwright-core";
// The page-side reader lives in a plain .mjs so the Chrome extension runs the
// EXACT same code against the user's own tab (extension/scripts/build.mjs copies
// it, and fails if the copy drifts). Playwright serialises a function with
// toString(), so the function must not close over module scope — see the
// module header there.
import { extractFormDom } from "./extract-dom.mjs";

export type ApplyField = {
  id: string; // our stable handle, also set as data-co-field on the live element
  type: "text" | "email" | "tel" | "url" | "number" | "date" | "textarea" | "select" | "checkbox" | "radio" | "file";
  label: string;
  required: boolean;
  options?: string[];
  maxLength?: number;
  value?: string;
  combobox?: boolean; // react-select-style widget → fill via click+type+Enter, not selectOption
  nativeId?: string; // the live element's id/name — used to match ATS API schemas (Greenhouse)
  nativeName?: string;
};

export type ExtractedForm = { title: string; url: string; fields: ApplyField[] };

// Extract the application form's STRUCTURE (not pixels) and TAG each control with
// a stable `data-co-field` id on the LIVE page (which the session keeps open), so
// the later fill phase can locate each field deterministically. Generic DOM/a11y
// introspection — clean ATS (Ashby/Lever/Greenhouse) work well; Workday best-effort.
export async function extractForm(ctx: Page | Frame): Promise<ExtractedForm> {
  const data = await ctx.evaluate(extractFormDom);

  return { title: data.title, url: ctx.url(), fields: data.fields as ApplyField[] };
}
