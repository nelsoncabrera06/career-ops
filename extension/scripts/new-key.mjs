#!/usr/bin/env node
/**
 * new-key.mjs — pin the extension id (run once; the manifest is then committed).
 *
 * Chrome derives an unpacked extension's id from its `key`: base64 of the DER
 * SubjectPublicKeyInfo of an RSA keypair. Writing one into manifest.json means
 * the id stays the same across machines and folder moves, which is what makes
 * naming it in CAREER_OPS_ALLOWED_ORIGINS worth doing.
 *
 * Only the PUBLIC key is stored — the manifest ships in the repo, and its
 * private half is never needed (nothing is signed here). Regenerating it
 * changes the id, so also re-run the env line: node extension/scripts/extension-id.mjs --env
 */

import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extensionIdFromKey } from './extension-id.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(resolve(HERE, '..'), 'manifest.json');

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
if (manifest.key && !process.argv.includes('--force')) {
  console.error('manifest.json already has a key. Replacing it CHANGES the extension id and breaks any allowlist entry.');
  console.error('If that is what you want: node extension/scripts/new-key.mjs --force');
  process.exit(1);
}

// `key` sits first so a diff shows it changed, rather than hiding in the middle.
const next = { key: spki, ...manifest };
writeFileSync(MANIFEST, JSON.stringify(next, null, 2) + '\n');

console.log(`extension id: ${extensionIdFromKey(spki)}`);
console.log(`next: put CAREER_OPS_ALLOWED_ORIGINS=chrome-extension://${extensionIdFromKey(spki)} in web/.env.local`);
