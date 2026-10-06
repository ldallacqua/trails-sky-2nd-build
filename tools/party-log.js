#!/usr/bin/env node
// Who the game itself puts in the party, and who it locks there, at each point of the story.
//
// The game's event scripts rebuild the party at story events: party_clear, then party_join for
// everyone who is around, with a flag on the ones you cannot take out (the padlock in the party
// menu). This replays those calls in story order and gives, for each chapter, the party state
// after every event that changes it:
//
//   loadPartyLog(game) -> Map(chapter -> [{ flag, fixed: [ids], away: [ids], here: [ids] }])
//
//   flag   the story flag the game sets when the event is over
//   fixed  locked into the active party
//   away   with the party in name only: cannot be fielded
//   here   everyone who is in the party at all, fixed and away included
//
// Used by tools/build.js only. Reads script_en.pac and t_evtable.tbl; nothing is written.
//
//   node tools/party-log.js          counts per chapter
//   node tools/party-log.js 5        that chapter's log (spoilers for that chapter)
'use strict';
const fs = require('fs');
const path = require('path');
const { GAME_DIR, loadGame, loadTable } = require('./read-save.js');

const LOCKED = 32; // party_join's flag for a member who cannot be taken out

// every file of an FPAC archive whose name matches, as [name, bytes]
function* pacFiles(pacFile, test) {
  const fd = fs.openSync(pacFile, 'r');
  const read = (off, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, off); return b; };
  try {
    const head = read(0, 16);
    if (head.toString('latin1', 0, 4) !== 'FPAC') throw new Error(pacFile + ' is not an FPAC archive');
    const count = head.readUInt32LE(4);
    const table = read(16, count * 32);
    for (let i = 0; i < count; i++) {
      const o = i * 32;
      const raw = read(Number(table.readBigUInt64LE(o + 8)), 160);
      const name = raw.toString('latin1', 0, raw.indexOf(0));
      if (test(name)) yield [name, read(Number(table.readBigUInt64LE(o + 24)), Number(table.readBigUInt64LE(o + 16)))];
    }
  } finally { fs.closeSync(fd); }
}

// A compiled script (#scp): a table of functions, then stack-machine code. A call to a function
// of the same file is: line marker, push caller, push return address, push the arguments (last
// one first), then 0x0c and the function's index. Constants are pushed as 00 04 <u32>, tagged
// in the top two bits (01 = integer). Only calls whose arguments are all plain pushes are read
// in full; anything computed shows up as null.
function partyCalls(b) {
  if (b.toString('latin1', 0, 4) !== '#scp') return [];
  const hs = b.readUInt32LE(4), n = b.readUInt32LE(8);
  const str = (o) => { let e = o; while (e < b.length && b[e]) e++; return b.toString('latin1', o, e); };
  const fns = [];
  for (let i = 0; i < n; i++) { const o = hs + i * 32; fns.push({ i, start: b.readUInt32LE(o), name: str(b.readUInt32LE(o + 28) & 0x3fffffff) }); }
  const wanted = new Map(fns.filter((f) => /^party_(clear|join|separate|set_force_attacker|set_no_playable)$/.test(f.name)).map((f) => [f.i, f.name.slice(6)]));
  if (!wanted.size) return [];
  const sorted = fns.slice().sort((x, y) => x.start - y.start);
  const first = sorted[0].start;
  const owner = (addr) => { let f = null; for (const x of sorted) { if (x.start <= addr) f = x; else break; } return f ? f.name : ''; };
  const int = (v) => { if ((v >>> 30) !== 1) return null; const x = v & 0x3fffffff; return x >= 0x20000000 ? x - 0x40000000 : x; };
  const calls = [];
  for (let o = first; o + 3 <= b.length; o++) {
    if (b[o] !== 0x0c || !wanted.has(b.readUInt16LE(o + 1))) continue;
    // the return address pushed before the arguments pins the start of the call
    let q = -1;
    for (let k = o - 6; k >= o - 120 && k >= first; k--) if (b[k] === 0x00 && b[k + 1] === 0x04 && b.readUInt32LE(k + 2) === o + 3) { q = k; break; }
    if (q < 0) continue;
    const args = [];
    let p = q + 6, whole = true;
    while (p < o) {
      if (b[p] === 0x00 && b[p + 1] === 0x04) { args.push(int(b.readUInt32LE(p + 2))); p += 6; }
      else if (b[p] === 0x02 || b[p] === 0x03 || b[p] === 0x04) { args.push(null); p += 5; }
      else { whole = false; break; }
    }
    args.reverse();
    calls.push({ fn: owner(o), op: wanted.get(b.readUInt16LE(o + 1)), who: whole ? args[0] : null, a: args });
  }
  return calls;
}

function loadPartyLog(game) {
  game = game || loadGame();
  // story events in the order the game runs them, each with the flag it sets when it is over
  const t = loadTable('t_evtable.tbl');
  const events = t.rows('EventTableData').map((e) => ({ name: t.str(t.b.readUInt32LE(e + 8)), flag: t.b.readUInt32LE(e + 48) }))
    .filter((e) => /^EV_\d\d_\d\d_\d\d$/.test(e.name) && e.flag);
  const ops = new Map(); // event name -> its party calls, in the order they are made
  for (const [, bytes] of pacFiles(path.join(GAME_DIR, 'pac', 'steam', 'script_en.pac'), (n) => /\/scena\//.test(n))) {
    for (const c of partyCalls(bytes)) {
      const m = /^(EV_\d\d_\d\d_\d\d)/.exec(c.fn);
      if (m) (ops.get(m[1]) || ops.set(m[1], []).get(m[1])).push(c);
    }
  }
  const idOf = (cid) => (game.people.has(cid) ? game.people.get(cid).id : null);
  const state = new Map(); // character id -> { lock, away }
  const log = new Map();
  for (const ev of events) {
    const list = ops.get(ev.name);
    if (!list) continue;
    for (const c of list) {
      if (c.op === 'clear') { state.clear(); continue; }
      const id = c.who == null ? null : idOf(c.who);
      if (!id) continue; // a guest, or someone picked by a variable
      if (c.op === 'join') state.set(id, { lock: !!(c.a[2] & LOCKED), away: false });
      else if (c.op === 'separate') state.delete(id);
      else if (!state.has(id)) continue;
      else if (c.op === 'set_force_attacker') state.get(id).lock = !!c.a[1];
      else if (c.op === 'set_no_playable') state.get(id).away = !!c.a[1];
    }
    const chapter = parseInt(ev.name.slice(3, 5), 10);
    const here = [...state.keys()];
    const entry = { flag: ev.flag, fixed: here.filter((i) => state.get(i).lock && !state.get(i).away), away: here.filter((i) => state.get(i).away), here };
    (log.get(chapter) || log.set(chapter, []).get(chapter)).push(entry);
  }
  return log;
}

module.exports = { loadPartyLog, LOCKED };

if (require.main === module) {
  const log = loadPartyLog();
  const want = process.argv[2] == null ? null : parseInt(process.argv[2], 10);
  for (const [ch, list] of [...log].sort((a, b) => a[0] - b[0])) {
    if (want == null) { console.log('chapter ' + ch + ': ' + list.length + ' party changes, ' + list.filter((e) => e.fixed.length).length + ' with someone locked'); continue; }
    if (ch !== want) continue;
    for (const e of list) console.log(e.flag + '  fixed: ' + (e.fixed.join(', ') || '-') + '   away: ' + (e.away.join(', ') || '-') + '   here: ' + e.here.join(', '));
  }
}
