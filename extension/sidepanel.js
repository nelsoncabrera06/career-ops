// sidepanel.js — the whole UI of the extension.
//
// Three responsibilities, in this order: talk to the local career-ops app, show
// what came back, and write ONLY what the user ticked into the page. There is no
// submit button anywhere in this file, and the content script it talks to has no
// code path to one either.

const DEFAULT_SERVER = "http://localhost:3000";
// What "Dar acceso" asks for. Chrome shows ONE dialog for the whole set, and the
// grant is durable — which is the point: `activeTab` dies on navigation and on
// a panel that was already open, and an ATS form is exactly where you notice.
const SITE_ORIGINS = ["https://*/*", "http://*/*"];
const STORE_KEY = "co:settings";

// Questions that must never be answered by a model on the user's behalf: they
// are legal, financial or demographic statements only the candidate can make.
// The server already refuses them (see answer-prompt.mjs); this is the second
// gate, because a skipped gate upstream must not become an auto-filled visa
// answer here.
const SENSITIVE =
  /(visa|sponsor|work\s*authori|authoriz|right to work|salary|compensation|expect|notice period|gender|ethnic|race\b|veteran|disabilit|date of birth|\bssn\b|social security|criminal|clearance|diversity)/i;

const state = {
  server: DEFAULT_SERVER,
  cliId: "",
  clis: [],
  connected: false,
  busy: false,
  title: "",
  url: "",
  frames: 0,
  fields: [],
  answers: {},
  approved: new Set(),
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- settings

async function loadSettings() {
  try {
    const saved = (await chrome.storage.local.get(STORE_KEY))[STORE_KEY] || {};
    if (typeof saved.server === "string" && saved.server) state.server = saved.server.replace(/\/+$/, "");
    if (typeof saved.cliId === "string") state.cliId = saved.cliId;
  } catch {
    /* storage unavailable — defaults are fine */
  }
  $("serverUrl").value = state.server;
}

async function saveSettings() {
  try {
    await chrome.storage.local.set({ [STORE_KEY]: { server: state.server, cliId: state.cliId } });
  } catch {
    /* private mode */
  }
}

// -------------------------------------------------------------- connection

function setStatus(text, kind) {
  $("statusText").textContent = text;
  const dot = $("statusDot");
  dot.className = `dot${kind ? ` ${kind}` : ""}`;
}

async function connect({ quiet = false } = {}) {
  if (!quiet) setStatus("conectando…");
  try {
    const res = await fetch(`${state.server}/api/clis`, { cache: "no-store" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `la app respondió ${res.status}`);
    }
    const { clis } = await res.json();
    state.clis = (clis || []).filter((c) => c.installed);
    state.connected = true;
    setStatus("conectada", "on");
    fillCliSelect();
    return true;
  } catch (e) {
    state.connected = false;
    setStatus("sin conexión", "off");
    if (!quiet) {
      const msg = String(e?.message || e);
      setLog(
        `No pude hablar con ${state.server}.\n\n` +
          `• ¿Está corriendo? cd web && npm run dev\n` +
          `• ¿Está esta extensión autorizada? CAREER_OPS_ALLOWED_ORIGINS=chrome-extension://${chrome.runtime.id} en web/.env.local\n\n` +
          `Detalle: ${msg}`,
      );
      $("settings").hidden = false;
    }
    return false;
  }
}

function fillCliSelect() {
  const sel = $("cliSelect");
  sel.replaceChildren();
  if (!state.clis.length) {
    const opt = document.createElement("option");
    opt.textContent = "ninguno instalado";
    opt.value = "";
    sel.append(opt);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  for (const cli of state.clis) {
    const opt = document.createElement("option");
    opt.value = cli.id;
    opt.textContent = cli.name;
    sel.append(opt);
  }
  const keep = state.clis.some((c) => c.id === state.cliId) ? state.cliId : state.clis[0].id;
  state.cliId = keep;
  sel.value = keep;
}

// -------------------------------------------------------------------- log

function showAccess(detail) {
  $("access").hidden = false;
  $("accessTitle").textContent = "Chrome no me deja leer esta pestaña";
  if (detail) $("accessHint").textContent = detail;
  setStatus("falta permiso", "off");
}

function hideAccess() {
  $("access").hidden = true;
}

/** Ask for site access. Must stay the FIRST call in its click handler: Chrome
 *  only shows the dialog while the user gesture is still live, so an `await`
 *  before it silently loses the prompt. */
function requestSiteAccess() {
  return chrome.permissions.request({ origins: SITE_ORIGINS });
}

function setLog(text, { append = false } = {}) {
  $("log").hidden = false;
  $("logBody").textContent = append ? `${$("logBody").textContent}\n${text}` : text;
  $("logBody").scrollTop = $("logBody").scrollHeight;
}

function logLine(m) {
  setLog(m, { append: true });
}

// --------------------------------------------------------------- extracting

async function analyze() {
  if (state.busy) return;
  setBusy(true);
  state.answers = {};
  state.approved.clear();
  $("result").hidden = true;
  $("copy").hidden = true;
  $("log").hidden = true;
  setStatus("leyendo la página…");

  try {
    const res = await chrome.runtime.sendMessage({ type: "CO_EXTRACT_TAB" });
    if (!res?.ok) {
      if (res?.code === "NO_ACCESS") return showAccess(res.error);
      throw new Error(res?.error || "no pude leer la página");
    }
    hideAccess();

    const { title, url, fields, frames } = res.data;
    state.title = title;
    state.url = url;
    state.frames = frames;
    state.fields = fields;
    setStatus("página leída", "on");
    renderFields();
    $("meta").hidden = false;
    $("fieldCount").textContent = `${fields.length} campo${fields.length === 1 ? "" : "s"}`;
    $("frameNote").textContent = frames > 1 ? `en ${frames} marcos` : "";
    $("draft").disabled = fields.length === 0;
  } catch (e) {
    setStatus("sin conexión", "off");
    setLog(`No pude leer esta página.\n\n${String(e?.message || e)}`);
  } finally {
    setBusy(false);
  }
}

// ----------------------------------------------------------------- drafting

async function draft() {
  if (state.busy || !state.fields.length) return;
  if (!state.connected) {
    const ok = await connect({ quiet: true });
    if (!ok) return;
  }
  setBusy(true);
  setStatus("redactando…");
  $("log").hidden = false;
  $("logBody").textContent = "";
  $("logTitle").textContent = "Redactando respuestas…";

  try {
    const res = await fetch(`${state.server}/api/apply/extension/answers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: state.url,
        title: state.title,
        company: $("company").value.trim(),
        role: $("role").value.trim(),
        cliId: state.cliId,
        fields: state.fields.map(({ id, type, label, required, options, combobox, maxLength }) => ({
          id,
          type,
          label,
          required,
          ...(options ? { options } : {}),
          ...(combobox ? { combobox: true } : {}),
          ...(maxLength ? { maxLength } : {}),
        })),
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `la app respondió ${res.status}`);
    }

    await readNdjson(res, (evt) => {
      if (evt.t === "log") logLine(evt.m);
      if (evt.t === "error") throw new Error(evt.m);
      if (evt.t === "done") applyAnswers(evt.answers, evt.truncated);
    });
    setStatus("respuestas listas", "on");
  } catch (e) {
    setStatus("error", "off");
    setLog(`No pude redactar.\n\n${String(e?.message || e)}`);
  } finally {
    setBusy(false);
  }
}

/** Read the server's NDJSON stream line by line. */
async function readNdjson(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      onEvent(evt);
    }
  }
}

function applyAnswers(answers, truncated) {
  state.answers = answers || {};
  state.approved.clear();

  for (const field of state.fields) {
    const answer = state.answers[field.id];
    if (!answer) continue;
    const value = String(answer.value ?? "");
    if (!value.trim()) continue;
    const needsReview = answer.needs_confirmation === true || SENSITIVE.test(field.label || "");
    if (!needsReview) state.approved.add(field.id);
  }

  renderFields();
  $("copy").hidden = false;
  if (truncated) logLine("⚠️ la respuesta del modelo se cortó: algunos campos pueden faltar");
}

// ------------------------------------------------------------------- render

function renderFields() {
  const list = $("fields");
  list.replaceChildren();

  for (const field of state.fields) {
    const answer = state.answers[field.id];
    const value = String(answer?.value ?? field.value ?? "");
    const needsReview = answer?.needs_confirmation === true || SENSITIVE.test(field.label || "");
    const approved = state.approved.has(field.id);

    const li = document.createElement("li");
    li.className = `field${approved ? "" : " off"}`;
    li.dataset.id = field.id;

    const head = document.createElement("div");
    head.className = "field-head";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = approved;
    box.setAttribute("aria-label", `incluir ${field.label || "campo"}`);
    box.addEventListener("change", () => {
      if (box.checked) state.approved.add(field.id);
      else state.approved.delete(field.id);
      li.classList.toggle("off", !box.checked);
      updateApprovedCount();
    });

    const label = document.createElement("span");
    label.className = "field-label";
    label.textContent = field.label || "(sin etiqueta)";

    const tag = document.createElement("span");
    tag.className = `tag${needsReview ? " warn" : ""}`;
    tag.textContent = needsReview ? "revísalo tú" : field.type;

    head.append(box, label, tag);

    const input = document.createElement("textarea");
    input.value = value;
    input.placeholder = field.type === "checkbox" ? "sí / no" : "respuesta";
    if (field.maxLength) input.maxLength = field.maxLength;
    input.addEventListener("input", () => {
      state.answers[field.id] = { ...(state.answers[field.id] || {}), value: input.value, needs_confirmation: needsReview };
    });

    li.append(head, input);

    if (needsReview) {
      const note = document.createElement("div");
      note.className = "field-note";
      note.textContent = "Pregunta legal, salarial o demográfica: decídelo tú, no la relleno por defecto.";
      li.append(note);
    }

    list.append(li);
  }

  updateApprovedCount();
}

function updateApprovedCount() {
  const n = state.approved.size;
  $("fillbar").hidden = state.fields.length === 0;
  $("approvedCount").textContent = `${n} aprobado${n === 1 ? "" : "s"}`;
  $("fill").disabled = n === 0;
}

// -------------------------------------------------------------------- fill

async function fill() {
  if (state.busy) return;
  const valuesByFrame = {};

  for (const field of state.fields) {
    if (!state.approved.has(field.id)) continue;
    const raw = state.answers[field.id]?.value ?? "";
    const value = String(raw).trim();
    if (!value) continue;
    const m = /^f(\d+)-(.*)$/.exec(field.id);
    if (!m) continue;
    const [, frameId, localId] = m;
    (valuesByFrame[frameId] ||= {})[localId] = value;
  }

  if (!Object.keys(valuesByFrame).length) return;

  setBusy(true);
  setStatus("rellenando…");
  try {
    const res = await chrome.runtime.sendMessage({ type: "CO_FILL_TAB", valuesByFrame });
    if (!res?.ok) throw new Error(res?.error || "no pude escribir en la página");

    const { filled, unfilled } = res.data;
    setStatus(`${filled.length} rellenado${filled.length === 1 ? "" : "s"}`, "on");
    showResult(filled, unfilled);
    markFilled(filled);
  } catch (e) {
    setStatus("error", "off");
    setLog(`No pude rellenar.\n\n${String(e?.message || e)}`);
  } finally {
    setBusy(false);
  }
}

function markFilled(ids) {
  const done = new Set(ids);
  for (const li of $("fields").children) {
    if (!done.has(li.dataset.id)) continue;
    const tag = li.querySelector(".tag");
    if (tag) {
      tag.className = "tag done";
      tag.textContent = "escrito";
    }
  }
}

function showResult(filled, unfilled) {
  const box = $("result");
  box.replaceChildren();
  box.hidden = false;

  const head = document.createElement("strong");
  head.textContent = `${filled.length} campo${filled.length === 1 ? "" : "s"} escrito${filled.length === 1 ? "" : "s"} en la página.`;
  box.append(head);

  const tail = document.createElement("p");
  tail.style.margin = "6px 0 0";
  tail.style.color = "var(--muted)";
  tail.textContent = "Revisa el formulario antes de enviarlo. La extensión no lo envía.";
  box.append(tail);

  if (unfilled.length) {
    const sub = document.createElement("p");
    sub.style.margin = "8px 0 0";
    sub.textContent = "Necesitan tu mano:";
    box.append(sub);

    const ul = document.createElement("ul");
    for (const item of unfilled) {
      const field = state.fields.find((f) => f.id === item.id);
      const li = document.createElement("li");
      li.textContent = `${field?.label || item.id} — ${item.reason}`;
      ul.append(li);
    }
    box.append(ul);
  }
}

// -------------------------------------------------------------------- copy

async function copyAll() {
  const lines = [];
  for (const field of state.fields) {
    const value = String(state.answers[field.id]?.value ?? "").trim();
    if (!value) continue;
    lines.push(`${field.label || "(sin etiqueta)"}\n${value}`);
  }
  if (!lines.length) return;
  try {
    await navigator.clipboard.writeText(lines.join("\n\n"));
    setStatus("copiado", "on");
  } catch {
    setStatus("no se pudo copiar", "off");
  }
}

// ------------------------------------------------------------------- wiring

function setBusy(busy) {
  state.busy = busy;
  for (const id of ["analyze", "draft", "fill", "retry", "copy"]) {
    const el = $(id);
    if (!el) continue;
    if (busy) el.dataset.wasDisabled = el.disabled ? "1" : "";
    el.disabled = busy ? true : el.dataset.wasDisabled !== "1";
  }
  if (!busy) {
    $("fill").disabled = state.approved.size === 0;
    $("draft").disabled = state.fields.length === 0;
  }
}

$("analyze").addEventListener("click", analyze);
$("draft").addEventListener("click", draft);
$("fill").addEventListener("click", fill);
$("copy").addEventListener("click", copyAll);
$("retry").addEventListener("click", () => connect());

$("grant").addEventListener("click", () => {
  // Called synchronously, then awaited: the gesture is what opens the dialog.
  const request = requestSiteAccess();
  request
    .then((granted) => {
      if (!granted) {
        showAccess("Has denegado el permiso. Puedes reintentarlo, o pulsar el icono de career-ops en la barra.");
        return;
      }
      hideAccess();
      setStatus("acceso concedido", "on");
      return analyze();
    })
    .catch(() => showAccess("Chrome no ha abierto el diálogo de permisos. Pulsa el icono de career-ops en la barra."));
});

$("accessRetry").addEventListener("click", () => analyze());

$("settingsToggle").addEventListener("click", () => {
  $("settings").hidden = !$("settings").hidden;
});

$("serverUrl").addEventListener("change", async (e) => {
  state.server = (e.target.value || DEFAULT_SERVER).replace(/\/+$/, "");
  await saveSettings();
  await connect();
});

$("cliSelect").addEventListener("change", async (e) => {
  state.cliId = e.target.value;
  await saveSettings();
});

$("logToggle").addEventListener("click", () => {
  const body = $("logBody");
  const hidden = body.hidden;
  body.hidden = !hidden;
  $("logToggle").textContent = hidden ? "ocultar" : "mostrar";
});

(async function init() {
  await loadSettings();
  const ok = await connect({ quiet: true });
  if (!ok) {
    setStatus("sin conexión", "off");
    return;
  }

  // Ask the browser — not permissions.contains — whether this tab is readable:
  // activeTab makes scripting work while contains() still answers false.
  try {
    const pre = await chrome.runtime.sendMessage({ type: "CO_PREFLIGHT" });
    if (pre?.ok && pre.data && pre.data.granted === false && pre.data.code === "NO_ACCESS") {
      showAccess(
        "Pasa cuando el panel ya estaba abierto antes de llegar a esta página. Un clic y queda resuelto para las próximas.",
      );
    }
  } catch {
    /* preflight is advice, not a gate */
  }
})();
