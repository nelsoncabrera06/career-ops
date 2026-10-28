// content.js — bridges the side panel to the page.
//
// The heavy lifting is NOT here: `extractFormDom()` / `fillFormDom()` come from
// content/extract-dom.js, which is generated from
// web/src/lib/apply/extract-dom.mjs — the same functions the dashboard's
// Playwright apply flow uses. This file only answers messages.
//
// It has no network access and no answers of its own. It writes exactly the
// values it is handed, and it cannot click anything: there is no code path here
// that reaches a button, a link, or a form submit.

if (!globalThis.__coApplyReady) {
  globalThis.__coApplyReady = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "CO_EXTRACT") {
      try {
        const { title, fields } = extractFormDom();
        // `location.href` rather than the tab's URL: without host permission
        // Chrome hides tab.url, but the page always knows where it is.
        sendResponse({ ok: true, title, url: location.href, fields });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
      return false;
    }

    if (msg?.type === "CO_FILL") {
      try {
        sendResponse({ ok: true, ...fillFormDom(msg.values || {}) });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
      return false;
    }

    return false;
  });
}
