#!/usr/bin/env node
/**
 * ensure-chrome.mjs — lanza Chrome con CDP si no está corriendo, y devuelve
 * una conexión Playwright lista para usar.
 *
 * Uso desde otros scripts:
 *   import { getChromeBrowser } from './ensure-chrome.mjs';
 *   const browser = await getChromeBrowser();
 *   // ... usar browser ...
 *   await browser.disconnect(); // NO cerrar — es el Chrome de career-ops
 *
 * Corre con un perfil PROPIO de career-ops (`~/.cache/career-ops-chrome`), no
 * con tu perfil diario de Chrome: así no hay que cerrar tu navegador para que
 * arranque el puerto de debug, y un crash no te deja el perfil trabado.
 * Logueate una vez en ese perfil (LinkedIn, ATS con login) y las sesiones
 * quedan guardadas para los próximos runs.
 *
 * Antes esto lanzaba Microsoft Edge; el nombre de archivo viejo era
 * ensure-edge.mjs (reemplazado en 2026-10-23).
 */

import { chromium } from 'playwright';
import { execSync, spawn } from 'node:child_process';

const CDP_PORT = 9222;
const CHROME_PROFILE = '/Users/nelsoncabrera/.cache/career-ops-chrome';
const CHROME_APP = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let browser = null;

function isChromeRunningWithCDP() {
  try {
    const out = execSync(`lsof -i :${CDP_PORT} -sTCP:LISTEN 2>/dev/null`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    // lsof truncates the COMMAND column ("Google", not "Google Chrome"), so
    // match the prefix; an unrelated listener on 9222 still fails loudly in
    // waitForCDP's connectOverCDP instead of being silently accepted.
    return out.includes('Google');
  } catch {
    return false;
  }
}

/**
 * Un Chrome que ya está usando este perfil (con otro puerto de debug, o sin
 * ninguno) se traga el `--remote-debugging-port` y no expone CDP: el lanzamiento
 * parece funcionar y después no hay a qué conectarse. Lo detectamos para avisar
 * con la instrucción exacta en vez de fallar con un timeout mudo.
 */
function isProfileLockedElsewhere() {
  try {
    // pgrep never matches itself, so this can't return the search process.
    const out = execSync(`pgrep -f "user-data-dir=${CHROME_PROFILE}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.trim().length > 0;
  } catch {
    // pgrep exits 1 when nothing matched.
    return false;
  }
}

function launchChrome() {
  if (isProfileLockedElsewhere()) {
    throw new Error(
      `Ya hay un Chrome corriendo con el perfil de career-ops pero sin CDP. Cerralo con: pkill -f career-ops-chrome`,
    );
  }
  console.log('Lanzando Chrome con el perfil de career-ops y CDP...');
  const child = spawn(CHROME_APP, [
    `--user-data-dir=${CHROME_PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    `--remote-debugging-port=${CDP_PORT}`,
  ], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}

async function waitForCDP(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const connected = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
      await connected.disconnect();
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return false;
}

export async function getChromeBrowser() {
  if (browser && typeof browser.isConnected === 'function' && browser.isConnected()) {
    return browser;
  }

  if (!isChromeRunningWithCDP()) {
    launchChrome();
    const ready = await waitForCDP();
    if (!ready) {
      throw new Error('Chrome no se pudo iniciar con CDP en ' + CDP_PORT);
    }
  }

  browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  return browser;
}

export async function disconnectChrome() {
  // En Playwright CDP no hay disconnect() — la conexión se libera sola
  // cuando el proceso termina. Simplemente limpiamos la referencia.
  browser = null;
}

// Alias del nombre viejo (ensure-edge.mjs) para no romper importadores externos.
export const getEdgeBrowser = getChromeBrowser;
export const disconnectEdge = disconnectChrome;

// Si se ejecuta directamente, hace un test rápido
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const connected = await getChromeBrowser();
    const context = connected.contexts()[0] || await connected.newContext();
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    const url = page.url();
    const isLoggedIn = !url.includes('/login') && !url.includes('/auth');
    console.log(`Perfil: ${CHROME_PROFILE}`);
    console.log(`URL: ${url}`);
    console.log(isLoggedIn ? '✅ LinkedIn logueado en el perfil de career-ops' : '❌ Todavía no logueado en LinkedIn en este perfil — logueate en esa ventana una vez y queda');
    // No desconectamos — la conexión CDP se libera al salir el proceso.
    // Chrome sigue corriendo con el perfil de career-ops.
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}
