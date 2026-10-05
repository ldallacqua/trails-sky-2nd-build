#!/usr/bin/env node
// Reads the newest Trails in the Sky 2nd Chapter save and prints what each character
// has slotted and equipped, plus spare quartz, accessories and U-Material in the bag.
//
// Read-only: it never writes to the save folder or the game folder.
// Needs Node 22.15+ (built-in Zstandard). No dependencies.
//
//   node tools/read-save.js            newest save, text report
//   node tools/read-save.js --json     same, as JSON
//   node tools/read-save.js <file>     a specific savedata file
//
// Item names come from the game's own English table at run time; nothing from the game
// is stored in this repo. Offsets were worked out against the 2026-10 Steam build and are
// checked before use, so a game update that moves them fails loudly instead of lying.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const GAME_DIR = process.env.SKY2_GAME_DIR || 'C:\\Steam\\steamapps\\common\\Trails in the Sky 2nd Chapter';
const SAVE_DIR = process.env.SKY2_SAVE_DIR || path.join(os.homedir(), 'Saved Games', 'Falcom', 'Trails in the Sky 2nd Chapter', 'savedata');

const INV_BASE = 0x128a44;   // per item id: u16 count in the bag, u16 flags
const REC_FIRST = 0x1147bc;  // first character's orbment block
const REC_SIZE = 0x2a0;
const STATS_BACK = 0x22c;    // level / HP / EP block sits this far before the orbment block
const SLOT_ORDER = ['c', 'll', 'ul', 't', 'ur', 'lr', 'b'];
const SLOT_NAME = { c: 'Center', ll: 'Lower-left', ul: 'Upper-left', t: 'Top', ur: 'Upper-right', lr: 'Lower-right', b: 'Bottom' };
const QUARTZ = [3700, 4400];
const ACCESSORY = [1500, 1700];

// ---- game tables -------------------------------------------------------------
function readFromPac(pacFile, wantedName) {
  const fd = fs.openSync(pacFile, 'r');
  const read = (off, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, off); return b; };
  try {
    const head = read(0, 16);
    if (head.toString('latin1', 0, 4) !== 'FPAC') throw new Error(pacFile + ' is not an FPAC archive');
    const count = head.readUInt32LE(4);
    const table = read(16, count * 32);
    for (let i = 0; i < count; i++) {
      const o = i * 32;
      const nameOff = Number(table.readBigUInt64LE(o + 8));
      const raw = read(nameOff, 160);
      const name = raw.toString('latin1', 0, raw.indexOf(0));
      if (name.endsWith(wantedName)) {
        return read(Number(table.readBigUInt64LE(o + 24)), Number(table.readBigUInt64LE(o + 16)));
      }
    }
  } finally { fs.closeSync(fd); }
  throw new Error(wantedName + ' not found in ' + pacFile);
}

function loadItemNames() {
  const b = readFromPac(path.join(GAME_DIR, 'pac', 'steam', 'table_en.pac'), '/t_item.tbl');
  if (b.toString('latin1', 0, 4) !== '#TBL') throw new Error('t_item.tbl has an unexpected format');
  const sections = b.readUInt32LE(4);
  for (let i = 0; i < sections; i++) {
    const o = 8 + i * 80;
    if (b.toString('latin1', o, o + 64).replace(/\0.*$/, '') !== 'ItemTableData') continue;
    const offset = b.readUInt32LE(o + 68), size = b.readUInt32LE(o + 72), count = b.readUInt32LE(o + 76);
    const names = new Map();
    for (let k = 0; k < count; k++) {
      const e = offset + k * size;
      const p = b.readUInt32LE(e + 0xe0);
      let end = p; while (end < b.length && b[end] !== 0) end++;
      names.set(b.readUInt32LE(e), b.toString('utf8', p, end));
    }
    return names;
  }
  throw new Error('ItemTableData section not found');
}

// ---- save --------------------------------------------------------------------
function newestSave() {
  const dirs = fs.readdirSync(SAVE_DIR).filter((d) => /^save\d+$/.test(d));
  let best = null;
  for (const d of dirs) {
    const f = path.join(SAVE_DIR, d, 'savedata');
    if (!fs.existsSync(f)) continue;
    const t = fs.statSync(f).mtimeMs;
    if (!best || t > best.t) best = { f, t, slot: d };
  }
  if (!best) throw new Error('no saves found in ' + SAVE_DIR);
  return best;
}

function unpack(file) {
  const buf = fs.readFileSync(file);
  const off = Number(buf.readBigUInt64LE(0)), len = Number(buf.readBigUInt64LE(8));
  if (buf.readUInt32LE(off) !== 0xfd2fb528) throw new Error('save does not start with a Zstandard block');
  return zlib.zstdDecompressSync(buf.subarray(off, off + len));
}

function readSave(file, names) {
  const b = unpack(file);
  const nm = (id) => (id === 0 ? null : (names.get(id) || '#' + id));
  const isQuartz = (v) => v === 0 || (v >= QUARTZ[0] && v < QUARTZ[1]);

  // sanity check: the first record must look like an orbment block
  const first = SLOT_ORDER.map((_, k) => b.readUInt32LE(REC_FIRST + k * 4));
  if (!first.every(isQuartz) || !first.some(Boolean)) {
    throw new Error('save layout not recognised (game updated?). Offsets in this script need re-finding.');
  }

  const characters = [];
  for (let i = 0; i < 16; i++) {
    const o = REC_FIRST + i * REC_SIZE;
    const q = SLOT_ORDER.map((_, k) => b.readUInt32LE(o + k * 4));
    if (!q.every(isQuartz)) break;
    const costume = nm(b.readUInt32LE(o + 19 * 4));
    if (!costume || !q.some(Boolean)) continue; // not a playable party record
    const gear = [14, 15, 16, 17, 18].map((k) => nm(b.readUInt32LE(o + k * 4)));
    const s = o - STATS_BACK;
    characters.push({
      name: costume.split(' - ')[0],
      level: b.readUInt32LE(s + 4), hp: b.readUInt32LE(s + 12), ep: b.readUInt32LE(s + 20),
      slots: Object.fromEntries(SLOT_ORDER.map((k, n) => [k, nm(q[n])])),
      weapon: gear[0], armor: gear[1], shoes: gear[2], accessories: [gear[3], gear[4]]
    });
  }

  const bag = { quartz: [], accessories: [], uMaterial: 0 };
  for (const [id, name] of names) {
    const count = b.readUInt16LE(INV_BASE + id * 4);
    if (!count) continue;
    if (id >= QUARTZ[0] && id < QUARTZ[1]) bag.quartz.push({ name, count });
    else if (id >= ACCESSORY[0] && id < ACCESSORY[1]) bag.accessories.push({ name, count });
    else if (name === 'U-Material') bag.uMaterial = count;
  }
  return { characters, bag };
}

// ---- report ------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const fileArg = args.find((a) => !a.startsWith('--'));
  const src = fileArg ? { f: fileArg, t: fs.statSync(fileArg).mtimeMs, slot: path.basename(path.dirname(fileArg)) } : newestSave();

  // work on a copy so the game never sees its file held open
  const tmp = path.join(os.tmpdir(), 'sky2-save-' + process.pid + '.bin');
  fs.copyFileSync(src.f, tmp);
  let data;
  try { data = readSave(tmp, loadItemNames()); } finally { fs.unlinkSync(tmp); }
  data.save = { slot: src.slot, written: new Date(src.t).toISOString() };

  if (json) { console.log(JSON.stringify(data, null, 1)); return; }

  console.log('Save: ' + src.slot + ', written ' + new Date(src.t).toLocaleString() + '\n');
  for (const c of data.characters) {
    console.log(c.name + '  Lv ' + c.level + '  HP ' + c.hp + '  EP ' + c.ep);
    for (const k of ['t', 'ul', 'ur', 'c', 'll', 'lr', 'b']) {
      console.log('   ' + SLOT_NAME[k].padEnd(12) + (c.slots[k] || '(empty)'));
    }
    console.log('   Gear        ' + [c.weapon, c.armor, c.shoes].map((x) => x || '(none)').join(' / '));
    console.log('   Accessories ' + c.accessories.map((x) => x || '(none)').join(' + ') + '\n');
  }
  const list = (xs) => xs.map((x) => x.name + (x.count > 1 ? ' x' + x.count : '')).join(', ') || '(none)';
  console.log('Spare quartz in the bag:\n  ' + list(data.bag.quartz) + '\n');
  console.log('Spare accessories in the bag:\n  ' + list(data.bag.accessories) + '\n');
  console.log('U-Material: ' + data.bag.uMaterial);
}

try { main(); } catch (e) { console.error('read-save: ' + e.message); process.exit(1); }
