#!/usr/bin/env node
/**
 * ensure-edge.mjs — lanza Edge con CDP si no está corriendo, y devuelve
 * una conexión Playwright lista para usar.
 *
 * Uso desde otros scripts:
 *   import { getEdgeBrowser } from './ensure-edge.mjs';
 *   const browser = await getEdgeBrowser();
 *   // ... usar browser ...
 *   await browser.disconnect(); // NO cerrar — es el Edge del usuario
 */

import { chromium } from 'playwright';
import { execSync, spawn } from 'node:child_process';

const CDP_PORT = 9222;
const EDGE_PROFILE = '/Users/nelsoncabrera/.cache/career-ops-browser';
const EDGE_APP = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';

let browser = null;

function isEdgeRunningWithCDP() {
  try {
    const out = execSync(`lsof -i :${CDP_PORT} -sTCP:LISTEN 2>/dev/null`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return out.includes('Microsoft');
  } catch {
    return false;
  }
}

function launchEdge() {
  console.log('Lanzando Edge con perfil de career-ops y CDP...');
  const child = spawn(EDGE_APP, [
    `--user-data-dir=${EDGE_PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`,
    'https://www.linkedin.com'
  ], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}

async function waitForCDP(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
      await browser.disconnect();
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return false;
}

export async function getEdgeBrowser() {
  if (browser && typeof browser.isConnected === 'function' && browser.isConnected()) {
    return browser;
  }

  if (!isEdgeRunningWithCDP()) {
    launchEdge();
    const ready = await waitForCDP();
    if (!ready) {
      throw new Error('Edge no se pudo iniciar con CDP en ' + CDP_PORT);
    }
  }

  browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  return browser;
}

export async function disconnectEdge() {
  // En Playwright CDP no hay disconnect() — la conexión se libera sola
  // cuando el proceso termina. Simplemente limpiamos la referencia.
  browser = null;
}

// Si se ejecuta directamente, hace un test rápido
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const browser = await getEdgeBrowser();
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    const url = page.url();
    const isLoggedIn = !url.includes('/login') && !url.includes('/auth');
    console.log(`URL: ${url}`);
    console.log(isLoggedIn ? '✅ LinkedIn logueado' : '❌ No logueado en LinkedIn');
    // No desconectamos — la conexión CDP se libera al salir el proceso.
    // Edge sigue corriendo con tu perfil.
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}