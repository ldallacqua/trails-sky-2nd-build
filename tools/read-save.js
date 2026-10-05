#!/usr/bin/env node
// Reads the newest Trails in the Sky 2nd Chapter save and reports the chapter, the party,
// what each character has slotted and equipped (with HP, EP and CP as of the save), and the
// spare quartz, accessories, healing items and U-Material in the bag.
//
// Read-only: it never writes to the save folder or the game folder.
// Needs Node 22.15+ (built-in Zstandard). No dependencies.
//
//   node tools/read-save.js            newest save, text report
//   node tools/read-save.js --json     same, as JSON
//   node tools/read-save.js <file>     a specific savedata file
//
// server.js uses the same functions to keep the page in sync while you play.
//
// Names, chapter titles and orbment layouts come from the game's own English tables at run
// time. Offsets were worked out against the 2026-10 Steam build and are checked before use,
// so a game update that moves them fails loudly instead of lying.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const GAME_DIR = process.env.SKY2_GAME_DIR || 'C:\\Steam\\steamapps\\common\\Trails in the Sky 2nd Chapter';
const SAVE_DIR = process.env.SKY2_SAVE_DIR || path.join(os.homedir(), 'Saved Games', 'Falcom', 'Trails in the Sky 2nd Chapter', 'savedata');

const INV_BASE = 0x128a44;   // per item id: u16 count in the bag, u16 flags
const REC_FIRST = 0x1147bc;  // first character record's orbment block
const REC_SIZE = 0x2a0;
const REC_MAX = 16;
const STATS_BACK = 0x22c;    // char id / level / HP / EP block sits this far before the orbment block
const CHAPTER_AT = 0x5103c;  // script variable: 0x40000000 | chapter number (0 = prologue)
const PARTY_AT = 0x51454;    // u16 character ids, 0xffff ends the list; the first four are the active party
const VAR_TAG = 0x40000000;
const SLOT_ORDER = ['c', 'll', 'ul', 't', 'ur', 'lr', 'b'];
const SLOT_NAME = { c: 'Center', ll: 'Lower-left', ul: 'Upper-left', t: 'Top', ur: 'Upper-right', lr: 'Lower-right', b: 'Bottom' };
const ELEMENTS = ['earth', 'water', 'fire', 'wind', 'time', 'space', 'mirage'];
const QUARTZ = [3700, 4400];
const ACCESSORY = [1500, 1700];
// item kinds, from the item table: [type, sub-type]
const KIND_AT = 0x28;
const SUPPLY = { '1/1': 'Recovery', '1/2': 'Support' };
const FOOD = { '1/3': 1, '1/4': 1, '1/32': 1 };

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

function loadTable(name) {
  const b = readFromPac(path.join(GAME_DIR, 'pac', 'steam', 'table_en.pac'), '/' + name);
  if (b.toString('latin1', 0, 4) !== '#TBL') throw new Error(name + ' has an unexpected format');
  const sections = {};
  const n = b.readUInt32LE(4);
  for (let i = 0; i < n; i++) {
    const o = 8 + i * 80;
    sections[b.toString('latin1', o, o + 64).replace(/\0.*$/, '')] = { offset: b.readUInt32LE(o + 68), size: b.readUInt32LE(o + 72), count: b.readUInt32LE(o + 76) };
  }
  const str = (p) => { let e = p; while (e < b.length && b[e] !== 0) e++; return b.toString('utf8', p, e); };
  const rows = (section) => {
    const s = sections[section];
    if (!s) throw new Error(section + ' section not found in ' + name);
    return Array.from({ length: s.count }, (_, k) => s.offset + k * s.size);
  };
  return { b, str, rows };
}

// Cell on the game's icon sheet (21 cells per row). Upgraded gear names its own cell; everything
// else gets the cell of its kind: weapons by who wields them, quartz by element.
function iconCell(t, e) {
  const type = t.b[e + KIND_AT], sub = t.b[e + KIND_AT + 1], own = t.b[e + KIND_AT + 2];
  if (own) return own;
  if (type === 0x0b) return 21 + (t.b[t.b.readUInt32LE(e + 0x08)] || 0);
  if (type === 0x0c) return 2;
  if (type === 0x0d) return 3;
  if (type === 0x0e) return 4;
  if (type === 0x12) return 84 + (sub - 20);
  if (type === 0x01 && (sub === 1 || sub === 2)) return 1;
  return null;
}

function loadItemNames(kinds, icons) {
  const t = loadTable('t_item.tbl');
  const names = new Map();
  for (const e of t.rows('ItemTableData')) {
    const id = t.b.readUInt32LE(e);
    names.set(id, t.str(t.b.readUInt32LE(e + 0xe0)));
    if (kinds) kinds.set(id, t.b[e + KIND_AT] + '/' + t.b[e + KIND_AT + 1]);
    if (icons) icons.set(id, iconCell(t, e));
  }
  return names;
}

// Everything the reader needs from the game, loaded once.
//   items     id -> English name
//   kinds     id -> "type/sub-type" as the item table has it
//   icons     id -> cell on the game's icon sheet, or null
//   people    character id -> { id, name } for everyone who has an orbment
//   layouts   character id -> { lines: [[slot keys from the center outwards]], locks: { slot: element } }
//   chapters  chapter number -> title
function loadGame() {
  const kinds = new Map(), icons = new Map();
  const items = loadItemNames(kinds, icons);

  const orb = loadTable('t_orbment.tbl');
  const layouts = new Map();
  const seen = new Map(); // character id -> rows so far, which is also the slot's position on the dial
  for (const e of orb.rows('OrbmentSlotParam')) {
    const cid = orb.b.readUInt32LE(e);
    const n = seen.get(cid) || 0;
    seen.set(cid, n + 1);
    const key = SLOT_ORDER[n];
    if (!key) continue;
    if (!layouts.has(cid)) layouts.set(cid, { chains: {}, locks: {} });
    const lay = layouts.get(cid);
    const line = orb.b[e + 4], pos = orb.b[e + 5], lock = orb.b[e + 6];
    if (lock) lay.locks[key] = ELEMENTS[lock - 1];
    if (line !== 0xff) (lay.chains[line] = lay.chains[line] || []).push({ key, pos });
  }
  for (const [cid, lay] of layouts) {
    const lines = Object.keys(lay.chains).sort((a, b) => a - b)
      .map((l) => ['c'].concat(lay.chains[l].sort((a, b) => a.pos - b.pos).map((s) => s.key)));
    layouts.set(cid, { lines, locks: lay.locks });
  }

  const nm = loadTable('t_name.tbl');
  const people = new Map();
  for (const e of nm.rows('NameTableData')) {
    const cid = nm.b.readUInt32LE(e);
    if (!layouts.has(cid) || people.has(cid)) continue;
    const name = nm.str(nm.b.readUInt32LE(e + 8));
    people.set(cid, { id: name.toLowerCase().replace(/[^a-z]+/g, ''), name, model: nm.str(nm.b.readUInt32LE(e + 0x20)) });
  }

  const ch = loadTable('t_chapter.tbl');
  const chapters = new Map();
  for (const e of ch.rows('ChapterParam')) {
    const n = ch.b.readUInt16LE(e);
    if (!chapters.has(n)) chapters.set(n, ch.str(ch.b.readUInt32LE(e + 0x18)));
  }
  return { items, kinds, icons, people, layouts, chapters };
}

// ---- save --------------------------------------------------------------------
// Cheap: one stat call per save slot. Used by the server on every tick.
function newestSave() {
  const dirs = fs.readdirSync(SAVE_DIR).filter((d) => /^save\d+$/.test(d));
  let best = null;
  for (const d of dirs) {
    const f = path.join(SAVE_DIR, d, 'savedata');
    let st;
    try { st = fs.statSync(f); } catch (e) { continue; }
    if (!best || st.mtimeMs > best.t) best = { f, t: st.mtimeMs, size: st.size, slot: d };
  }
  if (!best) throw new Error('no saves found in ' + SAVE_DIR);
  return best;
}

function unpack(buf) {
  const off = Number(buf.readBigUInt64LE(0)), len = Number(buf.readBigUInt64LE(8));
  if (off + len > buf.length || buf.readUInt32LE(off) !== 0xfd2fb528) throw new Error('save is incomplete or not in the expected format');
  return zlib.zstdDecompressSync(buf.subarray(off, off + len));
}

// Reads one savedata file. The file is read in a single call and never held open.
function readSaveFile(file, game) {
  const b = unpack(fs.readFileSync(file));
  const nm = (id) => (id === 0 ? null : (game.items.get(id) || '#' + id));
  const isQuartz = (v) => v === 0 || (v >= QUARTZ[0] && v < QUARTZ[1]);

  // sanity check: the first record must look like an orbment block
  const first = SLOT_ORDER.map((_, k) => b.readUInt32LE(REC_FIRST + k * 4));
  if (!first.every(isQuartz) || !first.some(Boolean)) {
    throw new Error('save layout not recognised (game updated?). Offsets in tools/read-save.js need re-finding.');
  }

  // Each record carries its own character id; records are not stored in id order.
  const characters = {};
  const idOf = new Map();
  for (let index = 0; index < REC_MAX; index++) {
    const o = REC_FIRST + index * REC_SIZE;
    const s = o - STATS_BACK;
    const cid = b.readUInt32LE(s);
    const who = game.people.get(cid);
    const level = b.readUInt32LE(s + 4);
    if (!who || idOf.has(cid) || level === 0 || level > 200) continue;
    const q = SLOT_ORDER.map((_, k) => b.readUInt32LE(o + k * 4));
    if (!q.every(isQuartz)) continue;
    const gearIds = [14, 15, 16, 17, 18].map((k) => b.readUInt32LE(o + k * 4));
    const gear = gearIds.map(nm);
    const cell = (id) => (id && game.icons ? game.icons.get(id) : null);
    const lay = game.layouts.get(cid);
    idOf.set(cid, who.id);
    characters[who.id] = {
      id: who.id, name: who.name, model: who.model, level,
      hp: b.readUInt32LE(s + 16), ep: b.readUInt32LE(s + 24),
      // as of the moment the game wrote this save
      now: { hp: b.readUInt32LE(s + 12), ep: b.readUInt32LE(s + 20), cp: b.readUInt32LE(s + 28), cpMax: b.readUInt32LE(s + 32) },
      slots: Object.fromEntries(SLOT_ORDER.map((k, n) => [k, nm(q[n])])),
      lines: lay.lines, locks: lay.locks,
      weapon: gear[0], armor: gear[1], shoes: gear[2], accessories: [gear[3], gear[4]],
      icons: { weapon: cell(gearIds[0]), armor: cell(gearIds[1]), shoes: cell(gearIds[2]) }
    };
  }
  if (!characters.estelle) throw new Error('save layout not recognised: Estelle\u2019s record was not found.');

  // party order: the first four are in the active party, the rest are in reserve
  const party = [];
  for (let k = 0; k < 16; k++) {
    const cid = b.readUInt16LE(PARTY_AT + k * 2);
    if (cid === 0xffff) break;
    if (idOf.has(cid) && party.indexOf(idOf.get(cid)) === -1) party.push(idOf.get(cid));
  }
  // Records exist for people who are not with you right now. Leave them out, so nothing
  // downstream can show a character before the story does.
  for (const id of Object.keys(characters)) if (party.indexOf(id) === -1) delete characters[id];

  let chapter = null;
  const raw = b.readUInt32LE(CHAPTER_AT);
  if ((raw & 0xf0000000) === VAR_TAG && game.chapters.has(raw & 0xffff)) {
    const n = raw & 0xffff;
    chapter = { n, title: game.chapters.get(n) };
  }

  const bag = { quartz: [], accessories: [], supplies: [], food: { kinds: 0, total: 0 }, uMaterial: 0 };
  for (const [id, name] of game.items) {
    const count = b.readUInt16LE(INV_BASE + id * 4);
    if (!count) continue;
    if (id >= QUARTZ[0] && id < QUARTZ[1]) bag.quartz.push({ name, count });
    else if (id >= ACCESSORY[0] && id < ACCESSORY[1]) bag.accessories.push({ name, count });
    else if (name === 'U-Material') bag.uMaterial = count;
    else if (game.kinds && SUPPLY[game.kinds.get(id)]) bag.supplies.push({ name, count, kind: SUPPLY[game.kinds.get(id)] });
    else if (game.kinds && FOOD[game.kinds.get(id)]) { bag.food.kinds++; bag.food.total += count; }
  }
  return { chapter, party: party.slice(0, 4), reserve: party.slice(4), characters, bag };
}

module.exports = { GAME_DIR, SAVE_DIR, SLOT_NAME, SLOT_ORDER, ELEMENTS, loadTable, loadItemNames, loadGame, newestSave, readSaveFile };

// ---- command line ------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const fileArg = args.find((a) => !a.startsWith('--'));
  const src = fileArg ? { f: fileArg, t: fs.statSync(fileArg).mtimeMs, slot: path.basename(path.dirname(fileArg)) } : newestSave();
  const data = readSaveFile(src.f, loadGame());
  data.save = { slot: src.slot, written: new Date(src.t).toISOString() };

  if (json) { console.log(JSON.stringify(data, null, 1)); return; }

  console.log('Save: ' + src.slot + ', written ' + new Date(src.t).toLocaleString());
  console.log('Chapter: ' + (data.chapter ? data.chapter.title : 'not recognised'));
  const nameOf = (id) => data.characters[id].name;
  console.log('Party: ' + data.party.map(nameOf).join(', ') + (data.reserve.length ? '   Reserve: ' + data.reserve.map(nameOf).join(', ') : '') + '\n');
  for (const c of Object.values(data.characters)) {
    console.log(c.name + '  (Lv ' + c.level + ', HP ' + c.now.hp + '/' + c.hp + ', EP ' + c.now.ep + '/' + c.ep + ', CP ' + c.now.cp + '/' + c.now.cpMax + ')');
    for (const k of ['t', 'ul', 'ur', 'c', 'll', 'lr', 'b']) {
      console.log('   ' + SLOT_NAME[k].padEnd(12) + (c.slots[k] || '(empty)') + (c.locks[k] ? '   [' + c.locks[k] + ' only]' : ''));
    }
    console.log('   Lines       ' + c.lines.map((l) => l.join('>')).join('   '));
    console.log('   Gear        ' + [c.weapon, c.armor, c.shoes].map((x) => x || '(none)').join(' / '));
    console.log('   Accessories ' + c.accessories.map((x) => x || '(none)').join(' + ') + '\n');
  }
  const list = (xs) => xs.map((x) => x.name + (x.count > 1 ? ' x' + x.count : '')).join(', ') || '(none)';
  console.log('Spare quartz in the bag:\n  ' + list(data.bag.quartz) + '\n');
  console.log('Spare accessories in the bag:\n  ' + list(data.bag.accessories) + '\n');
  console.log('Healing and support items:\n  ' + list(data.bag.supplies) + '\n');
  console.log('Food: ' + data.bag.food.total + ' across ' + data.bag.food.kinds + ' kinds');
  console.log('U-Material: ' + data.bag.uMaterial);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('read-save: ' + e.message); process.exit(1); }
}
