#!/usr/bin/env node
// Pulls a few pieces of the game's own UI art out of your installed copy, for the live page:
//
//   assets/icons.png        the item / quartz / element icon sheet (48 px cells, 21 per row)
//   assets/dial.png         the face of the orbment
//   assets/face/<who>.png   the round portrait of each character who is in your save
//
// The art belongs to the game's publisher. It is read from your own install, written to assets/
// on this PC only, and assets/ is not committed. The published copy of the page never has it and
// falls back to drawn orbs and initials.
//
// Portraits are extracted one character at a time, and only for characters already in the save,
// so the folder never holds a face you have not met.
//
//   node tools/extract-assets.js          extract for the newest save
//   node tools/extract-assets.js --clean  delete assets/
//
// server.js calls ensureAssets() whenever it reads a save. Read-only towards the game folder.

'use strict';
const fs = require('fs');
const path = require('path');
const { GAME_DIR, loadGame, newestSave, readSaveFile } = require('./read-save.js');
const { decodeDds, crop, png } = require('./texture.js');

const OUT = path.join(__dirname, '..', 'assets');
const IMAGE_PAC = path.join(GAME_DIR, 'pac', 'steam', 'image.pac');
const PREFIX = 'asset/dx11/image/';

// ---- archive -----------------------------------------------------------------
let index = null; // name -> [offset, size], built once per process and only when something is missing
function openIndex() {
  if (index) return index;
  const fd = fs.openSync(IMAGE_PAC, 'r');
  try {
    const read = (off, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, off); return b; };
    const head = read(0, 16);
    if (head.toString('latin1', 0, 4) !== 'FPAC') throw new Error('image.pac is not an FPAC archive');
    const count = head.readUInt32LE(4);
    const table = read(16, count * 32);
    let lo = Infinity, hi = 0;
    for (let i = 0; i < count; i++) {
      const at = Number(table.readBigUInt64LE(i * 32 + 8));
      if (at < lo) lo = at;
      if (at > hi) hi = at;
    }
    const names = read(lo, hi - lo + 256); // the names sit together in one block
    index = new Map();
    for (let i = 0; i < count; i++) {
      const o = i * 32;
      const at = Number(table.readBigUInt64LE(o + 8)) - lo;
      const name = names.toString('latin1', at, names.indexOf(0, at));
      index.set(name, [Number(table.readBigUInt64LE(o + 24)), Number(table.readBigUInt64LE(o + 16))]);
    }
  } finally { fs.closeSync(fd); }
  return index;
}
function texture(name) {
  const hit = openIndex().get(PREFIX + name + '.dds');
  if (!hit) return null;
  const fd = fs.openSync(IMAGE_PAC, 'r');
  try {
    const b = Buffer.alloc(hit[1]);
    fs.readSync(fd, b, 0, hit[1], hit[0]);
    return decodeDds(b);
  } finally { fs.closeSync(fd); }
}

// ---- pieces ------------------------------------------------------------------
// A round cut-out, scaled down with a box filter and given a soft edge.
function disc(img, cx, cy, r, size) {
  const out = Buffer.alloc(size * size * 4);
  const k = (2 * r) / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let R = 0, G = 0, B = 0, n = 0;
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const sx = Math.min(img.width - 1, Math.max(0, Math.floor(cx - r + x * k + dx)));
          const sy = Math.min(img.height - 1, Math.max(0, Math.floor(cy - r + y * k + dy)));
          const i = (sy * img.width + sx) * 4;
          R += img.rgba[i]; G += img.rgba[i + 1]; B += img.rgba[i + 2]; n++;
        }
      }
      const edge = Math.max(0, Math.min(1, size / 2 - Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2)));
      const j = (y * size + x) * 4;
      out[j] = R / n; out[j + 1] = G / n; out[j + 2] = B / n; out[j + 3] = edge * 255;
    }
  }
  return { width: size, height: size, rgba: out };
}

const PIECES = {
  'icons.png': () => texture('icons'),
  'dial.png': () => { const t = texture('orbment'); return t && disc(t, 710, 716, 660, 640); }
};
// the framed round portrait sits in the top-left corner of each character's face sheet
const facePiece = (model) => { const t = texture('fc_' + model.replace(/^chr/, 'c')); return t && crop(t, 14, 14, 112, 112); };

function write(file, make) {
  if (fs.existsSync(file)) return true;
  const img = make();
  if (!img) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', png(img));
  fs.renameSync(file + '.tmp', file);
  return true;
}

// Makes sure the art for these characters exists. Returns what the page may use, or null when
// the game's files cannot be read (the page then keeps its drawn look).
//   people: [{ id, model }]
let warned = false;
function ensureAssets(people) {
  try {
    const out = { icons: write(path.join(OUT, 'icons.png'), PIECES['icons.png']), dial: write(path.join(OUT, 'dial.png'), PIECES['dial.png']), faces: [] };
    for (const p of people) {
      if (!p.model || !/^[a-z]+$/.test(p.id)) continue;
      if (write(path.join(OUT, 'face', p.id + '.png'), () => facePiece(p.model))) out.faces.push(p.id);
    }
    return out;
  } catch (e) {
    if (!warned) { warned = true; console.error('assets: ' + e.message + ' (the page will use its drawn look)'); }
    return null;
  }
}

module.exports = { ensureAssets, ASSET_DIR: OUT };

if (require.main === module) {
  if (process.argv.includes('--clean')) {
    fs.rmSync(OUT, { recursive: true, force: true });
    console.log('removed ' + OUT);
  } else {
    const game = loadGame();
    const data = readSaveFile(newestSave().f, game);
    const got = ensureAssets(Object.values(data.characters).map((c) => ({ id: c.id, model: c.model })));
    if (!got) process.exit(1);
    console.log('icons ' + (got.icons ? 'ok' : 'missing') + ', dial ' + (got.dial ? 'ok' : 'missing') + ', portraits: ' + got.faces.join(', '));
    console.log('written to ' + OUT + ' (not committed)');
  }
}
