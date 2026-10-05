#!/usr/bin/env node
// Pulls pieces of the game's own UI art out of your installed copy, for the live page:
//
//   assets/icons.png        the item / quartz / element / status icon sheet (48 px cells, 21 per row)
//   assets/dial.png         the face of the orbment
//   assets/ui/*.png         menu furniture: the parchment background, panel corners, bars, gears,
//                           the Bracer emblem, the menu icons
//   assets/face/<who>.png   the round portrait of each character who is in your save
//   assets/eyes/<who>.png   their cut-in strip, used on the character banners
//   assets/body/<who>.png   their standing art, used in the party status
//
// The art belongs to the game's publisher. It is read from your own install, written to assets/
// on this PC only, and assets/ is not committed. The published copy of the page never has it and
// falls back to a look drawn in CSS.
//
// Character art is extracted one character at a time, and only for characters already in the
// save, so the folder never holds a face you have not met.
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
// Bump when a piece below changes shape, so an older assets/ folder is rebuilt.
const SET = '3';

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
let decoded = new Map(); // textures decoded during one ensureAssets() pass
function texture(name) {
  if (decoded.has(name)) return decoded.get(name);
  const hit = openIndex().get(PREFIX + name + '.dds');
  let img = null;
  if (hit) {
    const fd = fs.openSync(IMAGE_PAC, 'r');
    try {
      const b = Buffer.alloc(hit[1]);
      fs.readSync(fd, b, 0, hit[1], hit[0]);
      img = decodeDds(b);
    } finally { fs.closeSync(fd); }
  }
  decoded.set(name, img);
  return img;
}

// ---- image helpers -----------------------------------------------------------
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
// Scales down with a box filter, weighting colour by alpha so edges do not pick up a dark fringe.
function shrink(img, w, h) {
  const out = Buffer.alloc(w * h * 4);
  const kx = img.width / w, ky = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * ky), y1 = Math.max(y0 + 1, Math.floor((y + 1) * ky));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * kx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * kx));
      let R = 0, G = 0, B = 0, A = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * img.width + sx) * 4, a = img.rgba[i + 3];
          R += img.rgba[i] * a; G += img.rgba[i + 1] * a; B += img.rgba[i + 2] * a; A += a; n++;
        }
      }
      const j = (y * w + x) * 4;
      if (A) { out[j] = R / A; out[j + 1] = G / A; out[j + 2] = B / A; }
      out[j + 3] = A / n;
    }
  }
  return { width: w, height: h, rgba: out };
}
// The box that holds everything visible.
function bounds(img, threshold) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.rgba[(y * img.width + x) * 4 + 3] <= threshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}
function paste(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    src.rgba.copy(dst.rgba, ((dy + y) * dst.width + dx) * 4, y * src.width * 4, (y + 1) * src.width * 4);
  }
}
const piece = (name, x, y, w, h) => () => { const t = texture(name); return t && crop(t, x, y, w, h); };

// ---- what is taken -------------------------------------------------------------
// The gold menu icons of the camp menu, lined up in 128 px cells.
const MENU_ICONS = [ // order matters: app.js names them by position
  [1578, 1105, 89, 125],  // 0 sword     (Equip)
  [1690, 1125, 110, 86],  // 1 jacket    (Costume)
  [1572, 1250, 89, 90],   // 2 orbment   (Orbment)
  [1704, 1253, 81, 95],   // 3 wrench    (System)
  [1562, 1364, 106, 119], // 4 bottle    (Item)
  [1708, 1383, 72, 79],   // 5 people    (Party)
  [1573, 1499, 87, 96],   // 6 face      (Status)
  [1576, 1635, 80, 101]   // 7 rosette   (Reward)
];
function menuStrip() {
  const t = texture('camp000');
  if (!t) return null;
  const out = { width: 128 * MENU_ICONS.length, height: 128, rgba: Buffer.alloc(128 * MENU_ICONS.length * 128 * 4) };
  MENU_ICONS.forEach((b, i) => paste(out, crop(t, b[0], b[1], b[2], b[3]), i * 128 + ((128 - b[2]) >> 1), (128 - b[3]) >> 1));
  return out;
}

const PIECES = {
  'icons.png': () => texture('icons'),
  'dial.png': () => { const t = texture('orbment'); return t && disc(t, 710, 716, 660, 640); },
  // the camp menu's stone-and-emblem backdrop; the page tints it to parchment
  'ui/bg.png': () => { const t = texture('camp000'); return t && shrink(crop(t, 128, 10, 1920, 1080), 1280, 720); },
  'ui/menu.png': menuStrip,
  // window furniture (nine-slice sources)
  'ui/panel.png': piece('window3', 1543, 3, 131, 138),
  'ui/panel-dark.png': piece('window3', 1399, 3, 131, 138),
  'ui/glass.png': piece('window3', 1835, 299, 131, 138),
  'ui/status.png': piece('window3', 1162, 513, 229, 160),
  'ui/bar.png': piece('window3', 56, 714, 789, 65),
  'ui/bar-lit.png': piece('window3', 56, 812, 790, 66),
  'ui/head.png': piece('window3', 1155, 404, 564, 89),
  'ui/plate.png': piece('shop000', 1434, 1515, 600, 98),
  // loose parts
  'ui/gear.png': piece('window3', 1404, 504, 113, 113),
  'ui/seal.png': piece('window3', 1556, 526, 69, 68),
  'ui/cursor.png': piece('window3', 789, 925, 67, 48),
  'ui/chevron.png': piece('window3', 904, 922, 49, 96),
  'ui/cog-a.png': piece('window3', 1176, 818, 111, 111),
  'ui/cog-b.png': piece('window3', 1288, 926, 90, 90),
  'ui/cog-c.png': piece('window3', 1185, 935, 86, 86),
  'ui/cog-d.png': piece('window3', 1388, 945, 72, 73),
  'ui/wheel.png': piece('btl001', 1624, 600, 407, 407),
  'ui/ring.png': piece('btl001', 1480, 17, 545, 546),
  'ui/emblem.png': piece('note000', 1775, 11, 196, 184),
  'ui/crest.png': piece('note000', 1775, 220, 243, 227),
  'ui/stamp.png': piece('note000', 1775, 623, 183, 165)
};
const UI = Object.keys(PIECES).filter((f) => f.indexOf('ui/') === 0);

// Per character. The face sheet holds a framed round portrait and a cut-in strip of the eyes;
// the status sheet holds the standing art.
const sheet = (prefix, model) => texture(prefix + model.replace(/^chr/, 'c'));
const PEOPLE = {
  face: (model) => { const t = sheet('fc_', model); return t && crop(t, 14, 14, 112, 112); },
  eyes: (model) => { const t = sheet('fc_', model); return t && crop(t, 142, 4, 320, 89); },
  body: (model) => {
    const t = sheet('st_', model);
    const b = t && bounds(t, 24);
    if (!b) return null;
    const cut = crop(t, b[0], b[1], b[2], b[3]);
    const h = Math.min(cut.height, 520);
    return shrink(cut, Math.max(1, Math.round(cut.width * h / cut.height)), h);
  }
};

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
//   returns { icons, dial, ui, faces: [id], eyes: [id], bodies: [id] }
let warned = false;
function ensureAssets(people) {
  try {
    const mark = path.join(OUT, '.set');
    if (fs.existsSync(OUT) && (!fs.existsSync(mark) || fs.readFileSync(mark, 'utf8') !== SET)) fs.rmSync(OUT, { recursive: true, force: true });
    const out = {
      icons: write(path.join(OUT, 'icons.png'), PIECES['icons.png']),
      dial: write(path.join(OUT, 'dial.png'), PIECES['dial.png']),
      ui: UI.every((f) => write(path.join(OUT, f), PIECES[f])),
      faces: [], eyes: [], bodies: []
    };
    for (const p of people) {
      if (!p.model || !/^[a-z]+$/.test(p.id)) continue;
      if (write(path.join(OUT, 'face', p.id + '.png'), () => PEOPLE.face(p.model))) out.faces.push(p.id);
      if (write(path.join(OUT, 'eyes', p.id + '.png'), () => PEOPLE.eyes(p.model))) out.eyes.push(p.id);
      if (write(path.join(OUT, 'body', p.id + '.png'), () => PEOPLE.body(p.model))) out.bodies.push(p.id);
    }
    if (!fs.existsSync(mark)) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(mark, SET); }
    return out;
  } catch (e) {
    if (!warned) { warned = true; console.error('assets: ' + e.message + ' (the page will use its drawn look)'); }
    return null;
  } finally {
    decoded = new Map(); // do not keep decoded textures in memory between saves
  }
}

module.exports = { ensureAssets, ASSET_DIR: OUT, UI_FILES: UI.map((f) => f.slice(3, -4)) };

if (require.main === module) {
  if (process.argv.includes('--clean')) {
    fs.rmSync(OUT, { recursive: true, force: true });
    console.log('removed ' + OUT);
  } else {
    const game = loadGame();
    const data = readSaveFile(newestSave().f, game);
    const got = ensureAssets(Object.values(data.characters).map((c) => ({ id: c.id, model: c.model })));
    if (!got) process.exit(1);
    console.log('icons ' + (got.icons ? 'ok' : 'missing') + ', dial ' + (got.dial ? 'ok' : 'missing') + ', menu art ' + (got.ui ? 'ok' : 'missing'));
    console.log('portraits: ' + got.faces.join(', '));
    console.log('standing art: ' + got.bodies.join(', '));
    console.log('written to ' + OUT + ' (not committed)');
  }
}
