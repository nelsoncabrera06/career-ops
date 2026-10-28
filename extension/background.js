// background.js — the only part of the extension that touches tabs.
//
// Deliberately thin. It injects the reader/writer into the page on demand and
// relays one message, nothing else: no network, no answers, no model. That
// keeps the side panel (which does talk to the local app) replaceable without
// touching page access, and keeps the blast radius of a bug here to "the panel
// shows an error".
//
// ACCESS MODEL — why this file owns the action click:
//
// Reading a page needs host access. Two things can give it:
//
//   1. `activeTab`, granted by a real user invocation — and Chrome grants it for
//      a click on the extension's action. Handing the click to Chrome via
//      sidePanel.setPanelBehavior({openPanelOnActionClick:true}) opens the panel
//      but is NOT an invocation the extension sees, so the panel can open on a
//      tab this extension may not read. That was the live bug: "Analizar esta
//      página" answered "Cannot access contents of the page" on a perfectly
//      normal job form. So this file opens the panel itself from
//      chrome.action.onClicked — a documented invocation, and therefore a tab
//      we are allowed to read.
//
//   2. An optional host permission the user grants once (optional_host_permissions
//      in the manifest). This is the durable path: it survives navigation,
//      tab switches, and a panel opened from Chrome's own side-panel menu.
//      The panel requests it; the grant dialog belongs to a click in the panel,
//      so the request is made there, never from here.
//
// There is deliberately NO "<all_urls>" in `permissions`: at install the
// extension can read nothing, and it cannot run on a page nobody asked it to
// look at.

const CONTENT_FILES = ["content/extract-dom.js", "content/content.js"];

// Open the panel ourselves so the click counts as an invocation (activeTab).
// `sidePanel.open` needs the user gesture that this handler is running inside.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open(tab.windowId !== undefined ? { windowId: tab.windowId } : { tabId: tab.id });
  } catch {
    /* older Chrome, or no gesture: the panel opens from Chrome's menu instead */
  }
});

/** The tab the panel is talking about: the active one in the panel's own window. */
async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  let tab = tabs[0];
  // The panel is normally its own surface, not a tab — but it can be opened as
  // one (debugging, or a bookmark). Reading our own page as "the page" produced
  // a nonsense "this tab is not a normal web page" instead of the real form.
  if (tab && /^(chrome|edge|about|chrome-extension):/i.test(tab.url || "")) {
    const others = await chrome.tabs.query({ lastFocusedWindow: true });
    tab = others.find((t) => !/^(chrome|edge|about|chrome-extension|devtools):/i.test(t.url || "") && t.id !== undefined) || tab;
  }
  if (!tab?.id) throw new Error("no active tab");
  if (tab.url && !/^https?:/i.test(tab.url)) throw new Error("this tab is not a normal web page");
  return tab;
}

/**
 * Inject the content script and return the frame ids it reached.
 *
 * Every frame first (an embedded Greenhouse/Ashby form lives in an iframe and is
 * invisible to a main-frame-only read), falling back to the main frame if the
 * browser refuses one of them — a partial read beats none.
 */
async function inject(tabId) {
  try {
    return await injectInto(tabId, true);
  } catch {
    try {
      return await injectInto(tabId, false);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/cannot access|Cannot access contents|The extensions gallery/i.test(msg)) {
        const err = new Error(
          "Chrome no ha dado permiso para leer esta pestaña. Pulsa «Dar acceso» o el icono de career-ops en la barra.",
        );
        err.code = "NO_ACCESS";
        throw err;
      }
      throw new Error(msg);
    }
  }
}

async function injectInto(tabId, allFrames) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames },
    files: CONTENT_FILES,
  });
  return results.map((r) => r.frameId).filter((id) => typeof id === "number");
}

/** Ask one frame a question, treating "no listener" as an empty frame. */
async function ask(tabId, frameId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message, { frameId });
  } catch {
    return null;
  }
}

/**
 * Merge per-frame results. Field ids are namespaced `f{frameId}-{id}`, because
 * an embedded Greenhouse/Ashby form lives in an iframe whose own ids restart at
 * `co0` — without the prefix, frame A's answer would land in frame B's input.
 */
async function extractFromTab() {
  const tab = await activeTab();
  const frames = await inject(tab.id);
  const out = { title: tab.title || "", url: tab.url || "", fields: [], frames: 0 };

  for (const frameId of frames) {
    const res = await ask(tab.id, frameId, { type: "CO_EXTRACT" });
    if (!res?.fields?.length) continue;
    out.frames += 1;
    // The page title of a framed form says nothing useful; the top frame's does.
    if (frameId === 0 && res.title) out.title = res.title;
    // Without host permission Chrome hides `url`; the content script always
    // knows it, so the page's own answer is the better source.
    if (frameId === 0 && res.url) out.url = res.url;
    for (const f of res.fields) out.fields.push({ ...f, id: `f${frameId}-${f.id}`, frameId });
  }

  if (!out.fields.length) {
    throw new Error("no he encontrado campos de formulario en esta página. Abre la aplicación (no la oferta) y vuelve a intentarlo");
  }
  return out;
}

/** Write the approved answers into their frames. Returns what went where. */
async function fillTab(valuesByFrame) {
  const tab = await activeTab();
  const frames = await inject(tab.id);
  const filled = [];
  const unfilled = [];

  for (const frameId of frames) {
    const values = valuesByFrame[frameId];
    if (!values || !Object.keys(values).length) continue;
    const res = await ask(tab.id, frameId, { type: "CO_FILL", values });
    if (!res) {
      for (const id of Object.keys(values)) unfilled.push({ id: `f${frameId}-${id}`, reason: "la página no respondió" });
      continue;
    }
    for (const id of res.filled || []) filled.push(`f${frameId}-${id}`);
    for (const u of res.unfilled || []) unfilled.push({ ...u, id: `f${frameId}-${u.id}` });
  }

  return { filled, unfilled };
}

/**
 * Can we read the active tab right now?
 *
 * A one-line injection is the only honest test: `permissions.contains` reports
 * false while `activeTab` is doing the job, so asking the permissions API
 * instead of the browser would show a "grant access" card on a tab that already
 * works.
 */
async function preflight() {
  try {
    const tab = await activeTab();
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => true });
    return { granted: true };
  } catch (e) {
    const code = e?.code || (/cannot access|Cannot access contents/i.test(String(e?.message || e)) ? "NO_ACCESS" : "ERROR");
    return { granted: false, code, error: String(e?.message || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "CO_PREFLIGHT") {
    preflight().then(
      (data) => sendResponse({ ok: true, data }),
      (e) => sendResponse({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }

  if (msg?.type === "CO_EXTRACT_TAB") {
    extractFromTab().then(
      (data) => sendResponse({ ok: true, data }),
      (e) => sendResponse({ ok: false, error: String(e?.message || e), code: e?.code }),
    );
    return true;
  }

  if (msg?.type === "CO_FILL_TAB") {
    fillTab(msg.valuesByFrame || {}).then(
      (data) => sendResponse({ ok: true, data }),
      (e) => sendResponse({ ok: false, error: String(e?.message || e), code: e?.code }),
    );
    return true;
  }

  return false;
});
