/**
 * extract-dom.mjs — the ONE page-side implementation of "read the application
 * form" and "write an answer into a field".
 *
 * Two callers share it:
 *
 *   1. `apply/extract.ts` — Playwright passes these functions to
 *      `frame.evaluate()`, so they run inside the page the headless apply
 *      session opened.
 *   2. `extension/content/content.js` — the Chrome extension runs the very same
 *      file as a content script in the user's own browser tab (copied there by
 *      `extension/scripts/build.mjs`, which fails if the two drift).
 *
 * The whole point of living here is that the second caller must not grow a
 * second, subtly-different idea of what a form field is. Playwright serialises
 * a function with `toString()`, so both functions below must stay SELF-CONTAINED:
 * every helper is declared inside, and nothing may reference module scope.
 *
 * They are also plain JS on purpose — `node --test` can import this file with no
 * loader, and the extension can run it with no build.
 */

/**
 * Read every application control on the page and TAG each one with a stable
 * `data-co-field` handle, so a later fill phase can locate it deterministically.
 * Generic DOM/a11y introspection — clean ATS (Ashby/Lever/Greenhouse) work well;
 * Workday best-effort.
 *
 * @returns {{title: string, fields: Array<Record<string, unknown>>}}
 */
export function extractFormDom() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
  // generic placeholders that masquerade as labels (Ashby/react-select)
  const isGenericPh = (s) => /^(start typing|select\b|choose|search\b|type\b|--|please select|e\.?g\.?)/i.test(s.trim());
  // a usable label: not empty, not a UUID, not a generic placeholder
  const ok = (s) => {
    const t = (s || "").trim();
    return t && !isUuid(t) && !isGenericPh(t) ? t : "";
  };
  // Pure label text: a wrapping <label>Gender<select>…</select></label> would
  // otherwise swallow all option text (Lever). Strip controls/options first.
  const pure = (node) => {
    if (!node) return "";
    const c = node.cloneNode(true);
    c.querySelectorAll?.("input, select, textarea, option, button, [role=option], [class*='menu' i]").forEach((n) => n.remove());
    return clean(c.textContent);
  };

  // The field WRAPPER (Ashby `ashby-application-form-field-entry`, Greenhouse
  // `select__container`/`field`, generic `form-group`/`fieldset`) — deliberately
  // NOT a bare `div` (that matches the immediate parent and misses the real label
  // which lives one wrapper up).
  function fieldGroup(el) {
    return el.closest(
      '[class*="field-entry" i], [class*="fieldEntry" i], [class*="form-group" i], [class*="question" i], [class*="field__" i], [class*="__field" i], fieldset, [class*="field" i]',
    );
  }

  function labelFor(el) {
    const aria = el.getAttribute("aria-label");
    if (ok(aria)) return aria;
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const t = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ");
      if (ok(t)) return t;
    }
    const id = el.id;
    if (id) {
      const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (l && ok(pure(l))) return pure(l);
    }
    const parentLabel = el.closest("label");
    if (parentLabel && ok(pure(parentLabel))) return pure(parentLabel);
    // the question title inside the field wrapper (handles Ashby's
    // `ashby-application-form-question-title`, Greenhouse `select__label`, etc.)
    const grp = fieldGroup(el);
    if (grp) {
      const lab = grp.querySelector(
        'label, legend, [class*="question-title" i], [class*="heading" i], [class*="label" i], [class*="title" i]',
      );
      if (lab && ok(pure(lab))) return pure(lab);
    }
    // walk up a few ancestors for a nearby label/heading
    let c = el.parentElement;
    for (let i = 0; i < 4 && c; i++, c = c.parentElement) {
      const lab = c.querySelector('label, legend, [class*="label" i], [class*="title" i], h3, h4, h5');
      if (lab && ok(pure(lab))) return pure(lab);
    }
    const ph = el.placeholder;
    if (ok(ph)) return ph;
    const name = el.name;
    return ok(name); // never a UUID/placeholder; "" → caller shows "Untitled"
  }

  // The QUESTION of a radio group — NOT the first option's label. Look for a
  // radiogroup/fieldset aria-label/legend, else the first label/heading in the
  // group's container that isn't one of the options.
  function groupLabel(firstRadio, options) {
    const rg = firstRadio.closest("[role=radiogroup], fieldset");
    if (rg) {
      const al = rg.getAttribute("aria-label");
      if (al) return al;
      const lb = rg.getAttribute("aria-labelledby");
      if (lb) {
        const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ");
        if (t.trim()) return t;
      }
      const legend = rg.querySelector("legend");
      if (legend?.textContent?.trim()) return legend.textContent;
    }
    const optSet = new Set(options.map((o) => o.toLowerCase()));
    const container = fieldGroup(firstRadio) || firstRadio.parentElement?.parentElement || firstRadio.parentElement;
    if (container) {
      const cands = container.querySelectorAll(
        'label, legend, h1, h2, h3, h4, h5, h6, [class*="question-title" i], [class*="heading" i], [class*="label" i], [class*="title" i], [class*="question" i]',
      );
      for (const c of Array.from(cands)) {
        const t = pure(c);
        if (t && t.length > 2 && t.length < 160 && !optSet.has(t.toLowerCase()) && !isUuid(t) && !isGenericPh(t)) return t;
      }
    }
    return "";
  }

  const fields = [];
  const seenRadio = new Set();
  const els = Array.from(document.querySelectorAll("input, textarea, select"));
  let n = 0;

  for (const el of els) {
    const tag = el.tagName.toLowerCase();
    const itype = (el.type || "").toLowerCase();
    if (tag === "input" && ["hidden", "submit", "button", "image", "reset"].includes(itype)) continue;
    if (el.offsetParent === null && itype !== "radio" && itype !== "checkbox") continue;
    // skip ATS "autofill from resume / parse my CV" helper widgets (Ashby) — these
    // are convenience uploaders, not real application fields.
    if (el.closest('[class*="autofill" i]')) continue;

    // react-select widgets render an extra internal/autosize <input> next to the
    // real role=combobox input. Keep ONLY the combobox; drop the dummy (it's the
    // "Untitled field" noise). The combobox carries the question's aria label.
    const inReactSelect = el.closest('[class*="select__"], .select-shell');
    const isCombobox = el.getAttribute("role") === "combobox";
    if (inReactSelect && tag === "input" && !isCombobox) continue;

    const required = el.required || el.getAttribute("aria-required") === "true";
    const nativeId = el.id || undefined;
    const nativeName = el.name || undefined;
    const fid = `co${n++}`;

    if (isCombobox) {
      el.setAttribute("data-co-field", fid);
      fields.push({ id: fid, type: "select", combobox: true, label: clean(labelFor(el)), required, options: [], nativeId, nativeName });
      continue;
    }

    if (itype === "radio") {
      const name = el.name;
      if (name && seenRadio.has(name)) {
        n--;
        continue;
      }
      if (name) seenRadio.add(name);
      const group = Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`));
      const options = group.map((r) => clean(labelFor(r) || r.value)).filter(Boolean);
      group.forEach((r, i) => {
        r.setAttribute("data-co-field", fid);
        r.setAttribute("data-co-option", options[i] ?? String(i));
      });
      fields.push({ id: fid, type: "radio", label: clean(groupLabel(el, options)) || name, required, options });
      continue;
    }

    el.setAttribute("data-co-field", fid);

    if (tag === "select") {
      const options = Array.from(el.options).map((o) => clean(o.textContent)).filter((o) => o && !/^(select|choose|--)/i.test(o));
      fields.push({ id: fid, type: "select", label: clean(labelFor(el)), required, options, nativeId, nativeName });
      continue;
    }
    const type = tag === "textarea" ? "textarea" : ["email", "tel", "url", "number", "date", "checkbox", "file"].includes(itype) ? itype : "text";
    const ml = el.maxLength;
    fields.push({
      id: fid,
      type,
      label: clean(labelFor(el)),
      required,
      maxLength: ml && ml > 0 ? ml : undefined,
      value: el.value || undefined,
      nativeId,
      nativeName,
    });
  }
  return { title: document.title, fields };
}

/**
 * Write answers into the fields `extractFormDom()` tagged.
 *
 * Values arrive as `{ [data-co-field]: string }`. Only fields the caller
 * approved are written — this function has no opinion about which answers are
 * good, and it NEVER submits, clicks, or navigates anything. That refusal is
 * structural: the only interactions here are setting values and dispatching the
 * events a framework needs to notice them.
 *
 * The React/Vue value-setter dance is required, not decorative: assigning
 * `el.value` on a controlled input updates the DOM but not the framework's
 * state, so the form posts the OLD value. Calling the prototype setter bypasses
 * the instance's own setter and then firing a bubbling `input` makes the
 * framework re-read it — the same thing a real keystroke does.
 *
 * @param {{ [id: string]: string }} values
 * @returns {{filled: string[], unfilled: Array<{id: string, reason: string}>}}
 */
export function fillFormDom(values) {
  const filled = [];
  const unfilled = [];

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  function notify(el) {
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
  }

  for (const [id, rawValue] of Object.entries(values || {})) {
    const value = String(rawValue ?? "");
    const el = document.querySelector(`[data-co-field="${CSS.escape(id)}"]`);
    if (!el) {
      unfilled.push({ id, reason: "field no longer on the page (re-analyze)" });
      continue;
    }

    if (el.getAttribute("role") === "combobox") {
      // react-select: the real control is a custom widget. Typing + Enter is the
      // only honest way to set it, and a wrong Enter can clear the selection, so
      // this stays a manual step instead of a silent no-op.
      unfilled.push({ id, reason: "combobox — choose it by hand" });
      continue;
    }

    const itype = (el.type || "").toLowerCase();

    if (itype === "radio") {
      // Radio groups carry one id shared by every option; match the option text.
      const options = Array.from(document.querySelectorAll(`[data-co-field="${CSS.escape(id)}"][type=radio]`));
      const want = value.trim().toLowerCase();
      const hit = options.find((r) => (r.getAttribute("data-co-option") || "").trim().toLowerCase() === want);
      if (!hit) {
        unfilled.push({ id, reason: `no option matches "${value}"` });
        continue;
      }
      hit.checked = true;
      notify(hit);
      filled.push(id);
      continue;
    }

    if (itype === "checkbox") {
      const want = /^(yes|true|1|sí|si)$/i.test(value.trim());
      if (el.checked !== want) {
        el.click();
      }
      filled.push(id);
      continue;
    }

    if (el.tagName === "SELECT") {
      const want = value.trim().toLowerCase();
      const opt = Array.from(el.options).find((o) => (o.textContent || "").trim().toLowerCase() === want);
      if (!opt) {
        unfilled.push({ id, reason: `no option matches "${value}"` });
        continue;
      }
      el.value = opt.value;
      notify(el);
      filled.push(id);
      continue;
    }

    if (itype === "file") {
      // A file input cannot be populated from script without a real user gesture
      // and a file the page never sees. Leave it to the human — and say so.
      unfilled.push({ id, reason: "file upload — attach the CV by hand" });
      continue;
    }

    // Free text, textarea, email, tel, url, number, date (yyyy-mm-dd for date).
    setNativeValue(el, value);
    notify(el);
    filled.push(id);
  }

  return { filled, unfilled };
}
