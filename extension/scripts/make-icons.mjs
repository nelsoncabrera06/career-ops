#!/usr/bin/env node
/**
 * make-icons.mjs — render the toolbar icons with no image dependency.
 *
 * MV3 icons must be PNG, so this writes them by hand: raw RGBA rows, zlib for
 * the pixel data, CRC32 for the chunks. A rounded brand-orange tile with a dark
 * checkmark — the same "approved, by you" idea the panel is built around, and
 * enough to be recognisable at 16px.
 *
 *   node extension/scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'icons');

const BRAND = [217, 100, 42]; // hsl(26 73% 51%) — the dashboard's brand colour
const INK = [24, 20, 16];

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Distance from a point to a line segment — the stroke of the checkmark. */
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function render(size) {
  const s = size / 128; // design grid is 128
  const radius = 28 * s;
  const half = size / 2;
  const stroke = 13 * s;
  const rows = [];

  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size * 4 + 1); // filter byte 0 + RGBA
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      // Rounded-square coverage: 1 inside, 0 outside, with a soft edge.
      const qx = Math.abs(px - half) - (half - radius);
      const qy = Math.abs(py - half) - (half - radius);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
      const tile = Math.max(0, Math.min(1, 0.5 - outside));

      // Checkmark: two strokes, antialiased by distance.
      const d = Math.min(
        segDist(px, py, 36 * s, 66 * s, 54 * s, 84 * s),
        segDist(px, py, 54 * s, 84 * s, 92 * s, 44 * s),
      );
      const mark = Math.max(0, Math.min(1, (stroke / 2 - d) + 0.5));

      const i = 1 + x * 4;
      row[i] = Math.round(INK[0] + (BRAND[0] - INK[0]) * tile);
      row[i + 1] = Math.round(INK[1] + (BRAND[1] - INK[1]) * tile);
      row[i + 2] = Math.round(INK[2] + (BRAND[2] - INK[2]) * tile);
      row[i + 3] = Math.round(255 * Math.max(tile, mark));
      if (mark > 0 && tile > 0) {
        // Punch the check in dark ink on top of the orange tile.
        row[i] = Math.round(BRAND[0] * (1 - mark) + INK[0] * mark);
        row[i + 1] = Math.round(BRAND[1] * (1 - mark) + INK[1] * mark);
        row[i + 2] = Math.round(BRAND[2] * (1 - mark) + INK[2] * mark);
        row[i + 3] = 255;
      }
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = join(OUT, `icon-${size}.png`);
  writeFileSync(file, render(size));
  console.log(`wrote ${file}`);
}
