#!/usr/bin/env node
// What the game's own event scripts do to the party, replayed for the point a save is at.
//
// A save holds four party lists, each member with a flag word (locked in, on the bench, with
// you in name only): tools/read-save.js reads those directly, and that is where the page gets
// its padlocks from. What the save does not say, in any place this project knows, is which of
// the four lists is the one in play. The event scripts do: they build the lists when a story
// event ends (party_clear, party_join, ...) and switch between them (party_change). Which way
// a script goes can depend on story flags, so the scripts are not read as a list: they are run,
// on a small interpreter for the game's script machine, against the flags of the save itself.
//
//   const scripts = loadPartyScripts(game);
//   scripts.current(isFlagSet, chapter)   which of the four lists is in play, or null if open
//   scripts.state(isFlagSet, chapter)     the replayed list itself, as a cross-check on the save:
//     { fixed: [ids], away: [ids], here: [ids], unsure: [ids] }, or null when it cannot tell
//
//   fixed   locked into the active party
//   away    with the party in name only: cannot be fielded
//   here    everyone in the list at all, fixed and away included
//   unsure  members the scripts treat differently depending on something a save does not show
//
// Used by server.js and by read-save.js when it is run by hand. Reads script_en.pac and
// t_evtable.tbl; nothing is written.
//
//   node tools/party-log.js          how much was read, per chapter (numbers only)
//   node tools/party-log.js 5        chapter 5's party after each event, for the newest save's
//                                    choices (spoilers for that chapter)
'use strict';
const fs = require('fs');
const path = require('path');
const { GAME_DIR, loadGame, loadTable } = require('./read-save.js');

// party_join's flags, as far as the saves seen so far have confirmed them
const LOCKED = 32;    // cannot be taken out of the active party
const RESERVE = 64;   // starts on the bench
const NO_PLAY = 128;  // listed, but cannot be fielded
const NOT_SHOWN = 0x800; // in the party's list, but not shown: not with you as far as the menu goes
// a member's state in the replay
const LOCK = 1, AWAY = 2, HIDDEN = 4, BENCH = 8;

const CHANGES = /^party_(clear|join|insert|separate|set_force_attacker|set_no_playable|set_no_reserve|change|copy)$/;
const PARTY_FN = /^party_/;
const EVENT = /^EV_(\d\d)_\d\d[A-Z]?_\d\d[A-Z]?$/;
const STEPS_MAX = 400000;  // per event function, all paths together
const PURE_MAX = 4000;     // per helper call evaluated for its result
const WORLDS_MAX = 24;

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

// ---- a compiled script (#scp) ---------------------------------------------------
// A table of functions, then code for a stack machine. Operand bytes per opcode:
const OPERANDS = [5, 1, 4, 4, 4, 4, 4, 4, 4, 1, 1, 4, 2, 0, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 9, 3, 4, 2, 1, 4];
const OP = { PUSH: 0, POP: 1, GET: 2, GET2: 3, REF: 4, PUT: 5, PUT2: 6, LOAD: 7, STORE: 8, RESULT: 9, SETRESULT: 10, JMP: 11, CALL: 12, RET: 13,
  JNZ: 14, JZ: 15, XCALL: 0x22, XCALL2: 0x23, CMD: 0x24, XRET: 0x25, LINE: 0x26, POP2: 0x27, DEBUG: 0x28 };

function parseScript(b) {
  if (b.toString('latin1', 0, 4) !== '#scp') return null;
  const hs = b.readUInt32LE(4), n = b.readUInt32LE(8);
  const str = (o) => { let e = o; while (e < b.length && b[e]) e++; return b.toString('latin1', o, e); };
  const fns = [];
  for (let i = 0; i < n; i++) { const o = hs + i * 32; fns.push({ i, start: b.readUInt32LE(o), argc: b[o + 4], name: str(b.readUInt32LE(o + 28) & 0x3fffffff) }); }
  const sorted = fns.slice().sort((x, y) => x.start - y.start);
  sorted.forEach((f, k) => { f.end = k + 1 < sorted.length ? sorted[k + 1].start : b.length; });
  return { b, fns };
}

// the functions of a script that change the party, themselves or through a function they call
function partyChangers(s) {
  const direct = new Set(), callers = new Map();
  for (const f of s.fns) {
    if (PARTY_FN.test(f.name)) continue;
    for (let p = f.start; p < f.end;) {
      const op = s.b[p];
      if (op >= OPERANDS.length) break; // not code this reader knows
      if (op === OP.CALL) {
        const c = s.fns[s.b.readUInt16LE(p + 1)];
        if (c && CHANGES.test(c.name)) direct.add(f.i);
        else if (c) (callers.get(c.i) || callers.set(c.i, new Set()).get(c.i)).add(f.i);
      }
      p += 1 + OPERANDS[op];
    }
  }
  const all = new Set(direct), todo = [...direct];
  while (todo.length) { const x = todo.pop(); for (const c of callers.get(x) || []) if (!all.has(c)) { all.add(c); todo.push(c); } }
  return all;
}

// ---- the party, as the replay keeps it -------------------------------------------
// { cur: index of the party in use, p: { index: { character id: state bits } }, fog }
// fog: something the reader could not follow happened, so the party in use is not known
// until a script clears and rebuilds it.
const newWorld = () => ({ cur: 0, p: {}, fog: false });
const cloneWorld = (w) => ({ cur: w.cur, p: Object.fromEntries(Object.keys(w.p).map((k) => [k, Object.assign({}, w.p[k])])), fog: w.fog });
const worldKey = (w) => w.cur + (w.fog ? '?' : '') + Object.keys(w.p).sort().map((k) => '|' + k + ':' + Object.keys(w.p[k]).sort().map((c) => c + '=' + w.p[k][c]).join(',')).join('');

function change(w, op, a) {
  const num = (x) => typeof x === 'number';
  const index = (x) => (x === 'D' ? w.cur : num(x) ? x : null);
  const party = (x) => { const i = index(x); if (i == null) { w.fog = true; return null; } return w.p[i] || (w.p[i] = {}); };
  const bits = (flags) => (num(flags) ? (flags & LOCKED ? LOCK : 0) | (flags & NO_PLAY ? AWAY : 0) | (flags & NOT_SHOWN ? HIDDEN : 0) | (flags & RESERVE ? BENCH : 0) : null);
  const set = (chr, on, where, bit) => {
    const p = party(where);
    if (!p) return;
    if (!num(chr) || !num(on)) { w.fog = true; return; }
    if (p[chr] != null) p[chr] = on ? p[chr] | bit : p[chr] & ~bit;
  };
  if (op === 'clear') { const i = index(a[0]); if (i == null) w.fog = true; else { w.p[i] = {}; if (i === w.cur) w.fog = false; } }
  else if (op === 'join' || op === 'insert') {
    const chr = a[0], p = party(op === 'join' ? a[1] : a[2]), b = bits(op === 'join' ? a[2] : a[3]);
    if (!p) return;
    if (!num(chr) || b == null) w.fog = true; else p[chr] = b;
  } else if (op === 'separate') { const p = party(a[1]); if (p) { if (num(a[0])) delete p[a[0]]; else w.fog = true; } }
  else if (op === 'set_force_attacker') set(a[0], a[1], a[2], LOCK);
  else if (op === 'set_no_playable') set(a[0], a[1], a[2], AWAY);
  else if (op === 'set_no_reserve') set(a[0], a[1], a[2], HIDDEN);
  else if (op === 'change') { if (num(a[0])) w.cur = a[0]; else w.fog = true; }
  else if (op === 'copy') {
    const to = index(a[0]), from = index(a[1]);
    if (to == null || from == null) w.fog = true; else w.p[to] = Object.assign({}, w.p[from] || {});
  }
}

// ---- the script machine ------------------------------------------------------------
// Values on the stack: a number (an integer the script pushed or worked out), 'D' (the "default"
// marker), 'r<n>' (a raw word: return addresses, and 0 for a fresh local), 'x' (text, a float),
// or null when it is not known. A call pushes a marker and a return address, then the
// arguments, last one first; the function called pops its arguments and returns to the address.
function value(v) {
  if (v === 0x7fffffff) return 'D';
  const t = v >>> 30, x = v & 0x3fffffff;
  if (t === 1) return x >= 0x20000000 ? x - 0x40000000 : x;
  return t === 0 ? 'r' + x : 'x';
}
const truth = (v) => (typeof v === 'number' ? v !== 0 : v === 'r0' ? false : typeof v === 'string' && v[0] === 'r' ? true : null);
const BINARY = {
  0x10: (x, y) => x + y, 0x11: (x, y) => x - y, 0x12: (x, y) => x * y, 0x13: (x, y) => (y ? Math.trunc(x / y) : null), 0x14: (x, y) => (y ? x % y : null),
  0x15: (x, y) => +(x === y), 0x16: (x, y) => +(x !== y), 0x17: (x, y) => +(x > y), 0x18: (x, y) => +(x >= y), 0x19: (x, y) => +(x < y), 0x1a: (x, y) => +(x <= y),
  0x1b: (x, y) => x & y, 0x1c: (x, y) => x | y, 0x1d: (x, y) => +(!!x && !!y), 0x1e: (x, y) => +(!!x || !!y)
};
const UNARY = { 0x1f: (x) => -x, 0x20: (x) => +(x === 0), 0x21: (x) => ~x };

// Runs one function of a script from its start.
//   world given: every way the function can go is followed (a condition the reader cannot
//     work out is taken both ways); returns the party as each way leaves it.
//   world null: the function is only wanted for its result; returns it, or null if that
//     depends on something unknown.
function run(s, fn, args, world, isSet, changers, depth) {
  const b = s.b, pure = !world;
  let steps = 0;
  const limit = pure ? PURE_MAX : STEPS_MAX;
  const ends = new Map(), seen = new Set();
  let result = null, failed = false;
  const todo = [{ pc: fn.start, st: ['r0', 'END'].concat(args.slice().reverse()), res: null, w: world }];
  const mark = (m) => { // true if this exact situation was already followed
    const k = m.pc + '#' + m.st.join(',') + '#' + m.res + '#' + (m.w ? worldKey(m.w) : '');
    if (seen.has(k)) return true;
    seen.add(k);
    return false;
  };
  while (todo.length && !failed) {
    const m = todo.pop();
    const st = m.st;
    for (;;) {
      if (++steps > limit) { failed = true; break; }
      const pc = m.pc, op = b[pc];
      if (op >= OPERANDS.length) { failed = true; break; }
      m.pc = pc + 1 + OPERANDS[op];
      if (op === OP.PUSH) st.push(value(b.readUInt32LE(pc + 2)));
      else if (op === OP.POP || op === OP.POP2) st.length = Math.max(0, st.length - (b[pc + 1] >> 2));
      else if (op === OP.GET) { const v = st[st.length + (b.readInt32LE(pc + 1) >> 2)]; st.push(v === undefined ? null : v); }
      else if (op === OP.GET2 || op === OP.REF || op === OP.LOAD) st.push(null);
      else if (op === OP.PUT) { const v = st.pop(), at = st.length + (b.readInt32LE(pc + 1) >> 2); if (at >= 0) st[at] = v; }
      else if (op === OP.PUT2 || op === OP.STORE) st.pop();
      else if (op === OP.RESULT) st.push(m.res);
      else if (op === OP.SETRESULT) m.res = st.pop();
      else if (op === OP.JMP) {
        const to = b.readUInt32LE(pc + 1);
        // a jump back is a loop: stop if it comes round to a situation already seen
        if (to <= pc) { m.pc = to; if (mark(m)) break; } else m.pc = to;
      } else if (op === OP.JZ || op === OP.JNZ) {
        const t = truth(st.pop()), to = b.readUInt32LE(pc + 1);
        if (t == null) {
          if (pure) { failed = true; break; }
          const other = { pc: to, st: st.slice(), res: m.res, w: cloneWorld(m.w) };
          if (!mark(other)) todo.push(other);
          if (mark(m)) break;
        } else if (t === (op === OP.JNZ)) m.pc = to;
      } else if (op >= 0x10 && op <= 0x1e) {
        const y = st.pop(), x = st.pop();
        st.push(typeof x === 'number' && typeof y === 'number' ? BINARY[op](x, y) : null);
      } else if (op >= 0x1f && op <= 0x21) { const x = st.pop(); st.push(typeof x === 'number' ? UNARY[op](x) : null); }
      else if (op === OP.CMD) m.res = null; // the engine's own commands: whatever they return is not known here
      else if (op === OP.XRET) st.push('x', 'x');
      else if (op === OP.XCALL || op === OP.XCALL2) { st.length = Math.max(0, st.length - b[pc + 9] - 2); m.res = null; }
      else if (op === OP.RET) {
        const to = st.pop(); st.pop();
        if (to === 'END') { if (pure) result = m.res; else ends.set(worldKey(m.w), m.w); break; }
        if (typeof to !== 'string' || to[0] !== 'r') { failed = true; break; }
        m.pc = +to.slice(1);
      } else if (op === OP.CALL) {
        const c = s.fns[b.readUInt16LE(pc + 1)];
        if (!c) { failed = true; break; }
        const a = []; for (let k = 0; k < c.argc; k++) a.push(st[st.length - 1 - k]);
        const done = (res) => { st.length = Math.max(0, st.length - c.argc - 2); m.res = res; };
        if (c.name === 'flag') done(typeof a[0] === 'number' ? +!!isSet(a[0]) : null);
        else if (CHANGES.test(c.name)) { if (m.w) change(m.w, c.name.slice(6), a); done('r0'); }
        else if (PARTY_FN.test(c.name)) done(null); // a question about the party: not answered here
        else if (!pure && changers.has(c.i)) m.pc = c.start; // step into it: it changes the party
        else done(depth < 4 ? run(s, c, a, null, isSet, changers, depth + 1) : null);
      }
      // LINE and DEBUG do nothing
    }
  }
  if (pure) return failed ? null : result;
  if (failed || !ends.size) { const w = cloneWorld(world); w.fog = true; return [w]; }
  return [...ends.values()];
}

// ---- the game's story events, with the functions of theirs that change the party ----
function loadPartyScripts(game) {
  game = game || loadGame();
  const t = loadTable('t_evtable.tbl');
  // story events in the order the game runs them, each with the flag it sets when it is over
  const events = t.rows('EventTableData').map((e) => ({ name: t.str(t.b.readUInt32LE(e + 8)), flag: t.b.readUInt32LE(e + 48), run: [] }))
    .filter((e) => EVENT.test(e.name) && e.flag);
  const byName = new Map();
  for (const e of events) { e.chapter = +EVENT.exec(e.name)[1]; (byName.get(e.name) || byName.set(e.name, []).get(e.name)).push(e); }
  const stats = { files: 0, kept: 0, bytes: 0, stray: {} };
  for (const [, bytes] of pacFiles(path.join(GAME_DIR, 'pac', 'steam', 'script_en.pac'), (n) => /\/scena\//.test(n))) {
    const s = parseScript(bytes);
    if (!s) continue;
    stats.files++;
    const changers = partyChangers(s);
    if (!changers.size) continue;
    let used = false;
    for (const i of changers) {
      const f = s.fns[i], m = /^(EV_\d\d_\d\d[A-Z]?_\d\d[A-Z]?)(_END)?$/.exec(f.name);
      const hit = m && byName.get(m[1]);
      if (!hit) { // party changes outside a story event's own function: requests, talks, helpers
        const ch = /^EV_(\d\d)_/.exec(f.name);
        if (ch) stats.stray[+ch[1]] = (stats.stray[+ch[1]] || 0) + 1;
        continue;
      }
      // the event's own function runs first, then its _END (which also runs when the event is skipped)
      for (const e of hit) { e.run.push({ s, f, changers, end: !!m[2] }); e.run.sort((x, y) => x.end - y.end); }
      used = true;
    }
    if (used) { stats.kept++; stats.bytes += bytes.length; }
  }
  const people = (cid) => (game.people.has(cid) ? game.people.get(cid).id : null);

  // every way the party can stand for a save whose flags are given: usually exactly one
  function worlds(isSet, upTo, trace) {
    let list = [newWorld()];
    for (const e of events) {
      if (!e.run.length || !isSet(e.flag)) continue;
      if (upTo != null && e.chapter > upTo) continue;
      for (const r of e.run) {
        const next = new Map();
        for (const w of list) for (const out of run(r.s, r.f, [], cloneWorld(w), isSet, r.changers, 0)) next.set(worldKey(out), out);
        list = [...next.values()];
        if (list.length > WORLDS_MAX) { list = [Object.assign(list[0], { fog: true })]; }
      }
      if (trace) trace(e, list);
    }
    return list;
  }
  function summary(list) {
    if (!list.length || list.some((w) => w.fog)) return null;
    const seen = new Map(); // character id -> the state bits in each world, -1 for not there
    list.forEach((w, k) => {
      const p = w.p[w.cur] || {};
      for (const cid of Object.keys(p)) {
        const id = people(+cid);
        if (!id) continue; // a guest who is not played
        if (!seen.has(id)) seen.set(id, new Array(list.length).fill(-1));
        seen.get(id)[k] = p[cid] & (LOCK | AWAY | HIDDEN);
      }
    });
    const out = { fixed: [], away: [], here: [], unsure: [] };
    for (const [id, v] of seen) {
      if (v.some((x) => x !== v[0])) { out.unsure.push(id); continue; }
      out.here.push(id);
      if (v[0] & (AWAY | HIDDEN)) out.away.push(id); else if (v[0] & LOCK) out.fixed.push(id);
    }
    return out;
  }
  return {
    events, stats,
    state: (isSet, upTo) => summary(worlds(isSet, upTo)),
    // which of the save's four parties is in use, or null when the scripts leave that open
    current: (isSet, upTo) => { const list = worlds(isSet, upTo); return list.length && list.every((w) => w.cur === list[0].cur) ? list[0].cur : null; },
    trace: (isSet, upTo, each) => { worlds(isSet, upTo, (e, list) => each(e, summary(list), list.length)); },
    // the replay as it stands, all four parties: for tests that build a save to match
    worlds
  };
}

module.exports = { loadPartyScripts, LOCKED };

if (require.main === module) {
  const zlib = require('zlib');
  const { newestSave } = require('./read-save.js');
  const scripts = loadPartyScripts();
  const want = process.argv[2] == null ? null : parseInt(process.argv[2], 10);
  if (want == null) {
    const per = {};
    for (const e of scripts.events) { const c = (per[e.chapter] = per[e.chapter] || { events: 0, changing: 0 }); c.events++; if (e.run.length) c.changing++; }
    console.log(scripts.stats.files + ' event scripts read, ' + scripts.stats.kept + ' kept (' + Math.round(scripts.stats.bytes / 1e6) + ' MB)');
    for (const c of Object.keys(per)) console.log('chapter ' + c + ': ' + per[c].events + ' story events, ' + per[c].changing + ' change the party');
  } else {
    // the newest save's own flags decide the choices; the chapter's events are taken as all played
    const raw = fs.readFileSync(newestSave().f);
    const off = Number(raw.readBigUInt64LE(0)), len = Number(raw.readBigUInt64LE(8));
    const sv = zlib.zstdDecompressSync(raw.subarray(off, off + len));
    const story = new Map(scripts.events.map((e) => [e.flag, e.chapter]));
    const isSet = (f) => (story.has(f) ? story.get(f) <= want : !!(sv[0xc + (f >> 3)] & (1 << (f & 7))));
    scripts.trace(isSet, want, (e, st, n) => {
      if (e.chapter !== want) return;
      console.log(e.flag + '  ' + (st ? 'fixed: ' + (st.fixed.join(', ') || '-') + '   away: ' + (st.away.join(', ') || '-') + '   here: ' + st.here.join(', ') +
        (st.unsure.length ? '   unsure: ' + st.unsure.join(', ') : '') : 'not known') + (n > 1 ? '   (' + n + ' ways)' : ''));
    });
  }
}
