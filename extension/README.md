# career-ops — extensión de aplicación asistida

Panel lateral de Chrome para rellenar la aplicación que tienes abierta, con
**tus** datos, en **tu** navegador. No sustituye al flujo `/apply` de la web:
aquél abre su propio Playwright; éste trabaja en la pestaña donde ya estás
logueado, con tus sesiones, tu 2FA y tus contraseñas guardadas.

```text
tu pestaña (formulario real)
   │  content script: lee los campos, escribe los que apruebas
   ▼
extensión (panel lateral)
   │  POST /api/apply/extension/answers
   ▼
career-ops local  →  tu CLI (claude/codex/opencode/…)
   │  lee cv.md, config/profile.yml, reports/
   ▼
respuestas  →  las revisas  →  se escriben  →  TÚ envías
```

## Lo que no hace, por diseño

- **No envía nada.** No hay ruta de código que pulse «Enviar»: el content
  script no tiene acceso a botones, y `tests/extension-bundle-sync.test.mjs`
  falla si aparece un `.submit()`/`requestSubmit()` en el código que se ejecuta.
- **No llama a ningún modelo.** Las respuestas las redacta la app local con tu
  CLI y tus ficheros; la extensión sólo transporta el formulario y las
  respuestas.
- **No nace con permiso para ver tus pestañas.** Al instalar no puede leer nada.
  Obtiene acceso de dos formas, y sólo esas dos: (a) `activeTab`, que dura lo que
  dura la pestaña en la que pulsaste el icono; o (b) un permiso de sitio que TÚ
  concedes una vez con el botón **Dar acceso** del panel, y que Chrome enseña en
  su propio diálogo. No hay `<all_urls>` en `permissions`.
- **No rellena preguntas legales, de visado, salario o demográficas.** El
  servidor ya las rechaza (`web/src/lib/apply/answer-prompt.mjs`) y el panel las
  deja desmarcadas con la etiqueta *revísalo tú*.

## Instalación (una vez)

```bash
# 1. Iconos y copia del extractor de campos (generado, no se edita a mano)
node extension/scripts/make-icons.mjs
node extension/scripts/build.mjs

# 2. Autoriza la extensión en la app local — imprime el id y la línea exacta
node extension/scripts/extension-id.mjs --env
#   → CAREER_OPS_ALLOWED_ORIGINS=chrome-extension://<id>
#   Añádela a web/.env.local (esa línea ya está puesta si clonaste esto tal cual).

# 3. Arranca la app
cd web && npm run dev
```

En Chrome:

1. `chrome://extensions` → activa **Modo de desarrollador**.
2. **Cargar descomprimida** → elige esta carpeta (`extension/`).
3. Fija el icono en la barra. Al pulsarlo, la extensión abre el panel lateral
   **y** recibe `activeTab` para esa pestaña.

> **Por qué el icono importa.** `activeTab` es un permiso que Chrome concede al
> *invocar* la extensión, y abrir el panel desde el menú de Chrome no es una
> invocación. Si el panel ya estaba abierto y navegas a otra oferta, o lo abres
> desde el menú lateral, el panel te ofrecerá **Dar acceso** (un diálogo de
> Chrome, una vez por navegador) y a partir de ahí funciona siempre.

> Si mueves la carpeta o recargas la extensión, el id no cambia: está fijado por
> el campo `key` del manifiesto. Si lo regeneras con `--force`, el id cambia y
> hay que actualizar `CAREER_OPS_ALLOWED_ORIGINS`.

## Uso

1. Abre **la aplicación** (no la oferta): el formulario con los campos.
2. Pulsa el icono → panel lateral → **Analizar esta página**.
3. Opcional: escribe empresa y puesto. Es lo que usa para localizar el reporte
   de esa oferta; sin eso usa el título de la página.
4. **Redactar respuestas**. Verás el log en vivo (una ejecución del planner
   tarda entre uno y tres minutos).
5. Revisa y edita cada respuesta. Desmarca lo que no quieras; lo que está
   marcado se escribe en la página.
6. **Rellenar aprobados**. El panel te dice qué quedó pendiente y por qué
   (combobox de react-select, subida de fichero, opción que no coincide).
7. Revisa el formulario y envíalo tú.

**Copiar todo** vuelve a poner las respuestas en el portapapeles, por si el ATS
no coopera.

## Qué lee y cómo

`content/extract-dom.js` es **generado** desde
`web/src/lib/apply/extract-dom.mjs`, el mismo módulo que usa el flujo `/apply`
de la web vía Playwright. Una sola implementación de «qué es un campo de
formulario», sin deriva entre los dos caminos:

```bash
node extension/scripts/build.mjs          # regenerar
node extension/scripts/build.mjs --check  # falla si está desincronizado (lo corre el test suite)
```

Cubre inputs, textareas, selects, radios, checkboxes y widgets tipo react-select
(estos últimos se detectan y se dejan para tu mano: escribir a ciegas en un
combobox puede borrar la selección). Funciona con formularios en iframe
(Greenhouse/Ashby embebidos): cada marco se lee y se rellena por separado, con
los ids aislados por marco.

## Ficheros

| Fichero | Qué es |
|---|---|
| `manifest.json` | MV3; `key` fija el id de la extensión |
| `background.js` | Único punto que toca pestañas: inyecta y enruta mensajes |
| `content/content.js` | Responde a extraer/rellenar. Sin red, sin envío |
| `content/extract-dom.js` | **Generado** desde `web/src/lib/apply/extract-dom.mjs` |
| `sidepanel.html/.css/.js` | La interfaz y la única parte que habla con la app local |
| `scripts/` | `build`, `make-icons`, `new-key`, `extension-id` |

## Problemas típicos

| Síntoma | Causa |
|---|---|
| «sin conexión» | `web` no está corriendo, o `CAREER_OPS_ALLOWED_ORIGINS` no incluye el id (`--env` te lo imprime). |
| «Chrome no me deja leer esta pestaña» | El panel ya estaba abierto antes de llegar a esa página (o lo abriste desde el menú lateral), así que no hubo clic de invocación. Pulsa **Dar acceso**, o el icono de career-ops con la pestaña delante. |
| «no he encontrado campos» | Estás en la oferta, no en el formulario. Abre el «Apply». |
| Algún campo queda «necesitan tu mano» | Combobox, fichero o una opción que no coincide letra por letra. |
