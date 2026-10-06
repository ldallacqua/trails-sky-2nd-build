#!/usr/bin/env node
// Builds the page's data from the chapter notes and the game's own tables.
//
//   node tools/build.js            chapters-src/chN.js  ->  chapters/chN.dat, and game-data.js
//   node tools/build.js --report 5 also print chapter 5's lines, values and Arts per character
//   node tools/build.js --check-fx also print each hand-written effect line next to the table's
//   node tools/build.js --unseal   recreate chapters-src/ from chapters/*.dat (fresh clone)
//
// Chapter files are "sealed" (base64) so that browsing the repo, a diff or a search does not
// spoil a chapter you have not reached. The page opens only the chapter the save is in.
// chapters-src/ holds the readable originals and is not committed.
//
// For every character the tool takes the line layout and slot locks from the game's orbment
// table, and every quartz colour and elemental value from the game's quartz table, then checks
// the notes against them: unknown names, a quartz in a slot it cannot go in, or two of the same
// kind on one orbment stop the build.

'use strict';
const fs = require('fs');
const path = require('path');
const { loadGame, loadTable, loadShop, ELEMENTS, SLOT_ORDER, CHAPTER_FLAG } = require('./read-save.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'chapters-src');
const OUT = path.join(ROOT, 'chapters');
const args = process.argv.slice(2);

function seal(obj) { return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64'); }
function unseal(text) { return JSON.parse(Buffer.from(text, 'base64').toString('utf8')); }

if (args.includes('--unseal')) {
  fs.mkdirSync(SRC, { recursive: true });
  const fx = {};
  for (const f of fs.readdirSync(OUT).filter((x) => /^ch\d+\.dat$/.test(x))) {
    const target = path.join(SRC, f.replace('.dat', '.js'));
    const ch = unseal(fs.readFileSync(path.join(OUT, f), 'utf8'));
    for (const name of Object.keys(ch.quartz)) if (ch.quartz[name].fx) fx[name] = ch.quartz[name].fx;
    if (fs.existsSync(target)) { console.log('kept   ' + target); continue; }
    fs.writeFileSync(target, '// Recreated from ' + f + '. Spoilers for this chapter.\nmodule.exports = ' + JSON.stringify(ch.source, null, 2) + ';\n');
    console.log('wrote  ' + target);
  }
  const fxFile = path.join(SRC, '_fx.js');
  if (!fs.existsSync(fxFile)) {
    fs.writeFileSync(fxFile, '// Short effect text per quartz. Recreated from the sealed chapters.\nmodule.exports = ' + JSON.stringify(fx, null, 2) + ';\n');
    console.log('wrote  ' + fxFile);
  }
  process.exit(0);
}

// ---- game data ---------------------------------------------------------------
const game = loadGame();
const idByName = new Map();
for (const [id, name] of game.items) if (!idByName.has(name)) idByName.set(name, id);
const cidById = new Map();
for (const [cid, p] of game.people) cidById.set(p.id, cid);

const orb = loadTable('t_orbment.tbl');
const quartzValues = new Map(); // item id -> { element: n }
const quartzMake = new Map(); // item id -> { level: slot level it needs, cost: sepith by element, or null }
for (const e of orb.rows('QuartzParam')) {
  const v = {};
  ELEMENTS.forEach((el, k) => { const x = orb.b[e + 32 + k]; if (x) v[el] = x; });
  quartzValues.set(orb.b.readUInt16LE(e), v);
  const cost = ELEMENTS.map((_, k) => orb.b.readUInt16LE(e + 18 + k * 2));
  quartzMake.set(orb.b.readUInt16LE(e), { level: orb.b.readUInt16LE(e + 16), cost: cost.some(Boolean) ? cost : null });
}
// What raising a slot costs: person -> slot -> [sepith by element to reach level 2, to reach level 3].
// The table has seven rows a person, in dial order, each ending in (open, level 2, level 3) per element.
const slotCost = {};
{
  const seen = new Map();
  for (const e of orb.rows('OrbmentSlotParam')) {
    const cid = orb.b.readUInt32LE(e), n = seen.get(cid) || 0;
    seen.set(cid, n + 1);
    const who = game.people.get(cid), key = SLOT_ORDER[n];
    if (!who || !key) continue;
    (slotCost[who.id] = slotCost[who.id] || {})[key] = [2, 4].map((at) => ELEMENTS.map((_, k) => orb.b.readUInt16LE(e + 20 + k * 6 + at)));
  }
}
const colourOf = (id) => ELEMENTS[Math.floor(id / 100) - 37];
const familyOf = (id) => Math.floor(id / 10);

const skill = loadTable('t_skill.tbl');
const skillName = new Map();
for (const e of skill.rows('SkillParam')) {
  const id = skill.b.readUInt16LE(e);
  if (!skillName.has(id)) skillName.set(id, skill.str(skill.b.readUInt32LE(e + 0x98)).trim());
}
const clean = (text) => text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const skillRow = new Map();
for (const e of skill.rows('SkillParam')) { const id = skill.b.readUInt16LE(e); if (!skillRow.has(id)) skillRow.set(id, e); }
const artElement = (id) => (id < 115 ? 'earth' : id < 135 ? 'water' : id < 150 ? 'fire' : id < 165 ? 'wind' : id < 180 ? 'time' : id < 195 ? 'space' : 'mirage');
const arts = [];
for (const e of orb.rows('ArtsParam')) {
  const id = orb.b.readUInt32LE(e);
  const req = {};
  ELEMENTS.forEach((el, k) => { const x = orb.b[e + 4 + k]; if (x) req[el] = x; });
  if (!skillName.get(id)) continue;
  const row = skillRow.get(id);
  arts.push({
    name: skillName.get(id), el: artElement(id), req,
    ep: skill.b.readUInt32LE(row + 0x88),                    // base EP cost
    d: clean(skill.str(skill.b.readUInt32LE(row + 0xa8))),   // the game's own description
    k: skill.b.readUInt32LE(row + 0x30) === 15 ? 'a' : 's'   // attack Art or support Art
  });
}

// ---- what quartz and accessories do, from the item table -----------------------
// Flat stat bonuses sit in fixed fields; everything else is a list of (effect id, value, value)
// whose wording comes from the game's own help table. Only effects whose number convention was
// checked against the in-game text are worded here; the rest are left out rather than guessed.
const STAT_FIELDS = [[0x94, 'Max HP', ''], [0x98, 'Max EP', ''], [0x9c, 'STR', ''], [0xa0, 'DEF', ''], [0xa4, 'ATS', ''], [0xa8, 'ADF', ''],
  [0xb4, 'ACC', '%'], [0xb8, 'EVA', '%'], [0xbc, 'AEV', '%'], [0xc0, 'CRT', '%'], [0xc4, 'SPD', ''], [0xc8, 'MOV', '']];
const help = loadTable('t_itemhelp.tbl');
const template = new Map();
for (const e of help.rows('SkillEffectHelpData')) template.set(help.b.readUInt32LE(e), help.str(help.b.readUInt32LE(e + 8)).trim());
const PLAIN = new Set([1001, 1002, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1017, 1018, 1019, 1020, 1032, 1033, 1035, 1036,
  1041, 1042, 1047, 1048, 1049, 1050, 1051, 1052, 1053, 1054, 1055, 1058, 1067, 1073, 1077, 1078, 1083, 1087, 1092, 1093]);
const itemTable = loadTable('t_item.tbl');
const itemRow = new Map();
for (const e of itemTable.rows('ItemTableData')) itemRow.set(itemTable.b.readUInt32LE(e), e);
function itemInfo(id) {
  const b = itemTable.b, o = itemRow.get(id);
  const stats = [], extra = [], res = {};
  for (const [at, label, unit] of STAT_FIELDS) {
    const v = b.readInt32LE(o + at);
    if (v) stats.push(label + ' ' + (v > 0 ? '+' : '−') + Math.abs(v) + unit);
  }
  for (let p = 0x3c; p < 0x8c; p += 16) {
    const fx = b.readUInt32LE(o + p), v = b.readInt32LE(o + p + 4), v2 = b.readInt32LE(o + p + 8);
    const t = template.get(fx);
    if (!fx || !t) continue;
    const m = /^Resist (.+) \(%d%%\)$/.exec(t);
    if (m) res[m[1]] = v;
    else if (PLAIN.has(fx)) extra.push(t.replace('%d', v).replace(/%%/g, '%').replace(/\.$/, ''));
    else if (fx === 1076) extra.push('CP gain rate +' + (v - 100) + '%');
    else if (fx === 1065 || fx === 1066) extra.push(t.replace('%d', v2));
    else if (fx === 1024) extra.push('EP cost ×' + (100 - v) / 100);
    else if (fx === 1021) extra.push('Arts casting time ×' + v / 100);
    else if (fx === 47) extra.push('Impede ' + v + '%');
    else if ((fx >= 1059 && fx <= 1063) || fx === 1088) extra.push(t.replace('%s', '').trim());
    else if (fx === 1081 || fx === 1082 || fx === 1090 || fx === 1091) extra.push(t.replace(/\.$/, ''));
  }
  // same shape as the stat bonuses: "DEF +35%", and a real minus sign
  for (let k = 0; k < extra.length; k++) {
    extra[k] = extra[k].replace(/([A-Za-z])([+-])(?=\d)/g, '$1 $2').replace(/ -(?=\d)/g, ' −')
      .replace(/ UP when critical health/, ' up at critical HP').replace(/ when critical health/, ' at critical HP');
  }
  return { stats, extra, res, desc: clean(itemTable.str(b.readUInt32LE(o + 0xe8))) };
}
const kindOf = (id) => itemTable.b[itemRow.get(id) + 0x28] + '/' + itemTable.b[itemRow.get(id) + 0x29];

// ---- weapons, armour and footwear ----------------------------------------------
// What each piece gives, who can use it, when shops sell it, what it is upgraded from and at
// what cost, and which chests hold one: from the item, shop, chest and place tables.
const shop = loadShop();
const chapterOf = (flag) => Math.floor((flag - CHAPTER_FLAG) / 1000);
const gate = (flags) => { const f = flags.filter((x) => x >= CHAPTER_FLAG); return f.length ? Math.min(...f) : 0; };
// [flag that opens it, flag that closes it] for an item on one of the shop lists; 0 = no such flag
function shopWindow(list, id) {
  const r = shop.stock.find((x) => x.list === list && x.item === id);
  if (!r || (r.from.length && !gate(r.from))) return null; // not listed, or opened by something other than the story
  return [gate(r.from), gate(r.until)];
}
// A few pieces are on no common list, only on one shop's own, from a point in the story on.
// Only ordinary shops count: the medal exchange does not take mira, and the special ones want
// something rarer. Stock a shop has had since it opened says nothing about when you get there,
// so only rows that open on a story flag are taken.
function ownShopWindow(id) {
  for (const r of shop.own) {
    const s = shop.shops.get(r.list);
    if (r.item !== id || !s || s.type > 3 || !gate(r.from)) continue;
    return { win: [gate(r.from), gate(r.until)], where: s.name };
  }
  return null;
}
function recipeOf(id) {
  const r = shop.recipes.get(id);
  if (!r || r.count !== 1 || !game.items.get(r.base)) return null;
  return [game.items.get(r.base), r.mats.map(([m, n]) => [game.items.get(m), n])];
}

// chests: item id -> [{ where, tag }]
const placeTable = loadTable('t_place.tbl');
const placesOn = new Map(); // map file -> names of the places on it, in table order
for (const e of placeTable.rows('PlaceTableData')) {
  const map = placeTable.str(placeTable.b.readUInt32LE(e + 8));
  const name = placeTable.str(placeTable.b.readUInt32LE(e + 96)).trim();
  if (name) (placesOn.get(map) || placesOn.set(map, []).get(map)).push(name);
}
// A chest is named after the road it is on ("Malga_Treasure07_r") and filed under its map.
// Roads share one map per region, so the road is matched by name; a dungeon has its own map.
function chestPlace(map, object) {
  const names = placesOn.get(map) || [];
  const words = (/^[A-Za-z]+/.exec(object) || [''])[0].match(/[A-Z][a-z]+/g) || [];
  const shared = (n) => words.filter((w) => n.indexOf(w) !== -1).length;
  const hits = words.length ? names.filter((n) => n.indexOf(words[0]) === 0) : [];
  if (hits.length) return hits.sort((a, b) => shared(b) - shared(a) || a.length - b.length)[0];
  return names[0] || '';
}
const chestsOf = new Map();
const tbox = loadTable('t_tbox.tbl');
for (const e of tbox.rows('TBoxParam')) {
  const map = tbox.str(tbox.b.readUInt32LE(e)), object = tbox.str(tbox.b.readUInt32LE(e + 8));
  const monster = tbox.str(tbox.b.readUInt32LE(e + 24)).indexOf('M') !== -1;
  const at = tbox.b.readUInt32LE(e + 48), n = tbox.b.readUInt32LE(e + 56);
  for (let k = 0; k + 1 < n; k += 2) { // pairs of item id, count
    const id = tbox.b.readUInt16LE(at + k * 2);
    if (!chestsOf.has(id)) chestsOf.set(id, []);
    chestsOf.get(id).push({ where: chestPlace(map, object), tag: monster ? 'monster chest' : '' });
  }
}

// refined materials: name -> [what it is made from, how many]
const refine = {};
for (const [id, r] of shop.recipes) {
  if (itemRow.has(id) && kindOf(id) === '20/5' && !r.mats.length && game.items.get(r.base)) refine[game.items.get(id)] = [game.items.get(r.base), r.count];
}

const GEAR_KIND = { 11: 'w', 12: 'a', 13: 'f' };
const STAT_KEYS = { 'Max HP': 'HP', 'Max EP': 'EP' };
const allGear = {};   // name -> what the page needs to rank it, cost it and say where it comes from
const gearChests = {}; // name -> { where, tag }, kept per chapter so a place name never leaks early
for (const [id, name] of game.items) {
  const o = itemRow.get(id);
  const k = o == null ? null : GEAR_KIND[itemTable.b[o + 0x28]];
  if (!k || !name || allGear[name]) continue;
  const b = itemTable.b;
  const s = {};
  for (const [at, label] of STAT_FIELDS) { const v = b.readInt32LE(o + at); if (v) s[STAT_KEYS[label] || label] = v; }
  const g = { k, s };
  if (k === 'w') { // the first entry of the wielder list is who the weapon is for
    const cid = b.readUInt16LE(b.readUInt32LE(o + 0x08));
    g.who = game.people.has(cid) ? game.people.get(cid).id : 'c' + cid;
  }
  const extra = itemInfo(id).extra.join(', ');
  if (extra) g.x = extra;
  if (game.icons.get(id) != null) g.i = game.icons.get(id);
  g.p = b.readUInt32LE(o + 0xd0);
  // armour and footwear from chests are cut for men or for women: an M or an F among the item's flags
  const cut = /[MF]/.exec(itemTable.str(b.readUInt32LE(o + 0x20)));
  if (cut && k !== 'w') g.sex = cut[0].toLowerCase();
  const own = ownShopWindow(id);
  const sell = shopWindow(k === 'w' ? 1006 : 1007, id) || (own && own.win), up = shopWindow(1002, id), from = recipeOf(id);
  if (sell) g.sell = sell;
  if (sell && own && sell === own.win) g.at = own.where; // sold at this one shop only
  if (up && from) { g.up = up; g.from = from; }
  if (chestsOf.has(id)) { g.n = chestsOf.get(id).length; gearChests[name] = chestsOf.get(id)[0]; }
  allGear[name] = g;
}
// The chapter a piece first turns up in: when shops start selling it, or when its upgrade opens.
// A chest find has neither, so it takes the chapter of the upgrade made from it.
for (const g of Object.values(allGear)) {
  const opens = g.sell ? g.sell[0] : (g.up ? g.up[0] : 0);
  if (opens) g.ch = chapterOf(opens);
}
for (const g of Object.values(allGear)) {
  const base = g.from && allGear[g.from[0]];
  if (base && base.ch == null && g.ch != null) base.ch = g.ch;
}

// ---- chapters ----------------------------------------------------------------
const FX = require(path.join(SRC, '_fx.js'));
const problems = [];

function quartzInfo(name, where) {
  const id = idByName.get(name);
  if (id == null || !quartzValues.has(id)) { problems.push(where + ': "' + name + '" is not a quartz in the game table'); return null; }
  return { id, el: colourOf(id), v: quartzValues.get(id), fx: FX[name] || '' };
}

function buildChapter(src) {
  const quartz = {};
  const use = (name, where) => {
    const q = quartzInfo(name, where);
    if (q) quartz[name] = { el: q.el, v: q.v, fx: q.fx };
    return q;
  };
  const characters = src.characters.map((c) => {
    const cid = cidById.get(c.id);
    const where = 'ch' + src.n + ' ' + c.id;
    if (cid == null) { problems.push(where + ': unknown character id'); return null; }
    const lay = game.layouts.get(cid);
    const slots = {};
    const families = new Map();
    for (const k of SLOT_ORDER) {
      const raw = c.slots[k];
      if (!raw) { problems.push(where + ': slot ' + k + ' has no quartz'); continue; }
      const t = Array.isArray(raw) ? raw[0] : raw;
      const u = Array.isArray(raw) ? raw[1] : null;
      slots[k] = u ? { t, u } : { t };
      for (const name of [t, u]) {
        if (!name) continue;
        const q = use(name, where + ' ' + k);
        if (!q) continue;
        if (lay.locks[k] && q.el !== lay.locks[k]) problems.push(where + ': ' + name + ' (' + q.el + ') cannot go in the ' + lay.locks[k] + '-locked slot ' + k);
      }
      const tq = idByName.get(t);
      if (tq != null) {
        if (families.has(familyOf(tq))) problems.push(where + ': ' + t + ' and ' + families.get(familyOf(tq)) + ' are the same kind of quartz');
        families.set(familyOf(tq), t);
      }
    }
    for (const a of c.accessories || []) if (!idByName.has(a)) problems.push(where + ': accessory "' + a + '" is not in the game table');
    // Which attack stat their gear should feed. Said in the notes, or read off the build:
    // someone slotted for Arts (Mind or Cast) wants ATS, everyone else STR.
    if (c.stat && c.stat !== 'str' && c.stat !== 'ats') problems.push(where + ': stat must be "str" or "ats"');
    const forArts = (n) => /^(Mind|Cast) \d$/.test(n || '');
    const caster = Object.values(slots).some((s) => forArts(s.t) || forArts(s.u));
    return {
      id: c.id, name: game.people.get(cid).name, role: c.role || '', stat: c.stat || (caster ? 'ats' : 'str'),
      // No table states it, but the model files of the women are numbered from 5000 and the men's are not.
      sex: /^chr5/.test(game.people.get(cid).model) ? 'f' : 'm',
      lines: lay.lines, locks: lay.locks, slots,
      accessories: c.accessories || [], notes: c.notes || []
    };
  }).filter(Boolean);
  for (const id of src.gearOrder || []) {
    if (!characters.some((c) => c.id === id)) problems.push('ch' + src.n + ': gearOrder has ' + id + ' but there is no build for them');
  }
  // where the chest finds of this chapter and the ones before it are
  const gearSrc = {};
  for (const name of Object.keys(gearChests)) {
    if (allGear[name].ch != null && allGear[name].ch <= src.n && gearChests[name].where) gearSrc[name] = gearChests[name];
  }
  for (const name of Object.keys(src.sources || {})) use(name, 'ch' + src.n + ' sources');
  for (const id of (src.party && src.party.pick) || []) {
    if (!characters.some((c) => c.id === id)) problems.push('ch' + src.n + ': party.pick has ' + id + ' but there is no build for them');
  }
  // Stages: stretches of the chapter with their own lineup or advice. The notes name the
  // objective the game shows when one starts and the one it shows when it is over; here those
  // become the story flags the save is checked for.
  const steps = game.objectives.filter((o) => o.chapter === src.n);
  const flagOf = (x, where) => {
    if (x == null) return null;
    const hit = steps.filter((o) => (typeof x === 'number' ? o.from[0] === x : o.text === x));
    if (hit.length === 1) return hit[0].from[0];
    problems.push(where + ': ' + JSON.stringify(x) + (hit.length ? ' is the text of ' + hit.length + ' objectives; give the flag number instead' : ' is not an objective of this chapter'));
    return null;
  };
  const known = (id) => characters.some((c) => c.id === id);
  // A lineup: who the game requires (fixed), who is away, and everyone else best first, each
  // with the reason. '=' as a third entry means "as good as the one above": the page then
  // keeps whichever of the two is already in the party. set: the game picks all four itself.
  const lineupOf = (L, where) => {
    if (!L) return null;
    for (const id of (L.fixed || []).concat(L.away || [], (L.rank || []).map((r) => r[0]))) {
      if (!cidById.has(id)) problems.push(where + ' lineup: nobody in the game is called ' + id);
    }
    let tier = 0;
    return {
      set: !!L.set, fixed: L.fixed || [], away: L.away || [], note: L.note || '',
      rank: (L.rank || []).map((r, k) => { if (k && r[2] !== '=') tier++; return { id: r[0], why: r[1] || '', tier }; })
    };
  };
  const party = Object.assign({}, src.party || {});
  party.lineup = lineupOf(party.lineup, 'ch' + src.n) ||
    { set: false, fixed: [], away: [], note: '', rank: (party.pick || []).map((id, k) => ({ id, why: '', tier: k })) };
  // Shops that synthesize quartz of their own (the notes name them and say from which objective
  // each can be used): quartz -> { where, from }. Their stock is read from the shop table.
  const synth = {};
  for (const st of src.stations || []) {
    const where = 'ch' + src.n + ' station ' + st.name;
    const rows = shop.own.filter((r) => r.list === st.list && quartzMake.has(r.item) && quartzMake.get(r.item).cost && !r.from.length);
    if (!rows.length) problems.push(where + ': shop ' + st.list + ' synthesizes no quartz in the game table');
    const from = flagOf(st.from, where);
    for (const r of rows) synth[game.items.get(r.item)] = { where: st.name, from };
    for (const name of Object.keys(src.sources || {})) {
      if (src.sources[name].where.indexOf(st.name) === 0 && !synth[name]) problems.push(where + ': the notes send you here for ' + name + ', but the game table does not list it at this shop');
    }
  }
  const stages = (src.stages || []).map((s, i) => {
    const where = 'ch' + src.n + ' stage ' + (i + 1);
    if (s.from == null || !s.title) problems.push(where + ': needs a title and a from');
    for (const id of (s.party || []).concat(Object.keys(s.characters || {}))) if (!known(id)) problems.push(where + ': there is no build for ' + id);
    for (const id of Object.keys(s.characters || {})) {
      for (const k of Object.keys(s.characters[id])) if (k !== 'role' && k !== 'notes') problems.push(where + ' ' + id + ': only role and notes can change with a stage');
    }
    return {
      from: flagOf(s.from, where), until: flagOf(s.until, where), title: s.title || '', note: s.note || '', text: s.text || [],
      party: s.party || null, rules: s.rules || null, characters: s.characters || {},
      // a stage that names all four is one where the game sets the lineup
      lineup: lineupOf(s.lineup, where) || (s.party ? { set: true, fixed: s.party, away: [], note: '', rank: [] } : null)
    };
  });
  return {
    n: src.n, title: src.title, region: src.region || '', intro: src.intro || [],
    party, sources: src.sources || {}, quartz, characters,
    gearOrder: src.gearOrder || [], gearSrc, stages, synth,
    // the objective from which workshops raise slots to level 3 (one chapter only names it; no
    // table of the game's says when, so this one comes from the guides)
    slot3From: src.slot3From ? flagOf(src.slot3From, 'ch' + src.n + ' slot3From') : null,
    sections: src.sections || [], source: src
  };
}

// values of one line, and the Arts a character gets, at the target build
function lineSum(ch, c, line) {
  const sum = {};
  ELEMENTS.forEach((e) => { sum[e] = 0; });
  for (const k of line) { const v = ch.quartz[c.slots[k].t].v; for (const e of Object.keys(v)) sum[e] += v[e]; }
  return sum;
}
function artsFor(ch, c) {
  const sums = c.lines.map((l) => lineSum(ch, c, l));
  return arts.filter((a) => sums.some((s) => Object.keys(a.req).every((e) => s[e] >= a.req[e]))).map((a) => a.name);
}

const files = fs.readdirSync(SRC).filter((f) => /^ch\d+\.js$/.test(f)).sort((a, b) => parseInt(a.slice(2), 10) - parseInt(b.slice(2), 10));
const built = files.map((f) => buildChapter(require(path.join(SRC, f))));

if (problems.length) {
  console.error('Not written. Fix these first:\n  ' + problems.join('\n  '));
  process.exit(1);
}

// every quartz in the game: name -> [colour, values in element order]. Lets the page draw and
// add up whatever is actually slotted, not only what the notes mention.
const allQuartz = {};
for (const [id, v] of quartzValues) {
  const name = game.items.get(id);
  if (!name) continue;
  const info = itemInfo(id);
  // effect text: the hand-written line when there is one, otherwise worded from the table
  // ...then the slot level it needs, what it costs to synthesize, and when workshops offer it
  const mk = quartzMake.get(id) || { level: 1, cost: null };
  allQuartz[name] = [colourOf(id), ELEMENTS.map((e) => v[e] || 0), FX[name] || info.stats.concat(info.extra).join(', '), info.res,
    mk.level, mk.cost, mk.cost ? shopWindow(1000, id) : null];
}
// every accessory: name -> [stats and effects, { status: % resisted }, cell on the game's icon sheet]
const allAccessories = {};
// healing and support items: name -> the game's description
const supplies = {};
for (const [id, name] of game.items) {
  if (!name || !itemRow.has(id)) continue;
  const kind = kindOf(id);
  if (kind === '14/11' && !allAccessories[name]) {
    const info = itemInfo(id);
    allAccessories[name] = [info.stats.concat(info.extra).join(', '), info.res, game.icons.get(id)];
    // an upgraded accessory also says what it is made from, and when that opens
    const up = shopWindow(1002, id), from = recipeOf(id);
    if (up && from) allAccessories[name].push(from, up);
  } else if ((kind === '1/1' || kind === '1/2') && !supplies[name]) supplies[name] = itemInfo(id).desc;
}

fs.mkdirSync(OUT, { recursive: true });
for (const ch of built) {
  fs.writeFileSync(path.join(OUT, 'ch' + ch.n + '.dat'), seal(ch));
  console.log('ch' + ch.n + '.dat  ' + ch.characters.map((c) => c.name).join(', '));
}
fs.writeFileSync(path.join(ROOT, 'game-data.js'),
  '// Generated by tools/build.js from the game’s own tables. Do not edit.\n' +
  '// Sealed like the chapter files, because it lists every quartz in the game by name.\n' +
  'window.GAME = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob("' +
  seal({ chapters: built.map((c) => c.n), arts, quartz: allQuartz, accessories: allAccessories, gear: allGear, refine, supplies, slotCost }) +
  '"), function (c) { return c.charCodeAt(0); })));\n');
console.log('game-data.js  ' + arts.length + ' Arts, ' + Object.keys(allQuartz).length + ' quartz, ' + Object.keys(allAccessories).length + ' accessories, ' +
  Object.keys(allGear).length + ' weapons, armour and footwear, chapters ' + built.map((c) => c.n).join(' '));

// --check-fx: put the hand-written effect lines next to what the table says, to catch slips
if (args.includes('--check-fx')) {
  for (const name of Object.keys(FX)) {
    const info = itemInfo(idByName.get(name));
    console.log(name.padEnd(16) + FX[name] + '\n' + ''.padEnd(16) + '  table: ' + info.stats.concat(info.extra).join(', '));
  }
}

const r = args.indexOf('--report');
if (r !== -1) {
  const ch = built.find((c) => String(c.n) === args[r + 1]);
  if (!ch) { console.error('no chapter ' + args[r + 1]); process.exit(1); }
  for (const c of ch.characters) {
    console.log('\n' + c.name);
    c.lines.forEach((l, i) => {
      const s = lineSum(ch, c, l);
      console.log('  Line ' + (i + 1) + '  ' + l.map((k) => c.slots[k].t).join(' > '));
      console.log('          ' + ELEMENTS.map((e) => e.slice(0, 2) + ' ' + s[e]).join('  '));
    });
    console.log('  Arts: ' + artsFor(ch, c).join(', '));
  }
}
