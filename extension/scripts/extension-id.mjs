#!/usr/bin/env node
/**
 * extension-id.mjs — print the extension's stable id and the env line the web
 * app needs to accept it.
 *
 * A browser extension calls /api from a `chrome-extension://<id>` origin, which
 * the dashboard's guard refuses by default (it is cross-site to Fetch Metadata
 * no matter what). The user opts it in by name:
 *
 *   CAREER_OPS_ALLOWED_ORIGINS=chrome-extension://<id>
 *
 * The id is derived from the manifest's `key` field, which pins it: loading the
 * unpacked extension from any path, on any machine, yields the same id. Without
 * a `key`, Chrome derives the id from the directory path, so moving the folder
 * would silently change it and break the allowlist.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(resolve(HERE, '..'), 'manifest.json');

export function extensionIdFromKey(publicKeyBase64) {
  const der = Buffer.from(publicKeyBase64, 'base64');
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
}

// Imported by new-key.mjs, which writes the key this module reads — so the
// reading only happens when this file is the entry point.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  if (!manifest.key) {
    console.error('manifest.json has no "key" — the id would depend on the folder path. Run: node extension/scripts/new-key.mjs');
    process.exit(1);
  }

  const id = extensionIdFromKey(manifest.key);
  console.log(id);
  if (process.argv.includes('--env')) {
    console.log(`CAREER_OPS_ALLOWED_ORIGINS=chrome-extension://${id}`);
  }
}
