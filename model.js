// The plan: what every slot and every piece of gear should be, given the chapter's build and
// what the save says you own, and the steps to get from one to the other.
//
// Shared by the page (app.js) and by the live server, which works out the same steps for the
// in-game overlay. No DOM in here.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MODEL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ELS = ['earth', 'water', 'fire', 'wind', 'time', 'space', 'mirage'];
  var ORDER = ['t', 'ul', 'ur', 'c', 'll', 'lr', 'b'];
  var POS_NAME = { c: 'Center', t: 'Top', ur: 'Upper-right', lr: 'Lower-right', b: 'Bottom', ll: 'Lower-left', ul: 'Upper-left' };

  // What the plan is worked out from. Set with use() before anything else is called:
  //   G         the game's tables (game-data.js)
  //   CH        the chapter being shown (chapters/chN.dat, unsealed)
  //   chapterN  its number
  //   live      the save as the live server reads it, or null on the published copy
  //   have      what has been ticked by hand, as "chapter:quartz" -> true (published copy only)
  var G = null, CH = null, chapterN = null, live = null, state = { have: {} };
  function use(c) { G = c.G; CH = c.CH; chapterN = c.chapterN; live = c.live || null; state = { have: c.have || {} }; }

  // ---- quartz and Arts, from the game's own tables ----
  function quartz(name) {
    var g = G.quartz[name];
    var note = CH && CH.quartz[name];
    return { el: g ? g[0] : 'mirage', v: g ? g[1] : [0, 0, 0, 0, 0, 0, 0], fx: (note && note.fx) || (g && g[2]) || '', res: (g && g[3]) || {} };
  }
  function lineValues(line, nameAt) {
    var sum = [0, 0, 0, 0, 0, 0, 0];
    line.forEach(function (k) {
      if (!nameAt[k]) return;
      quartz(nameAt[k]).v.forEach(function (x, i) { sum[i] += x; });
    });
    return sum;
  }
  function artsFor(lines, nameAt) {
    var sums = lines.map(function (l) { return lineValues(l, nameAt); });
    return G.arts.filter(function (a) {
      return sums.some(function (s) {
        return ELS.every(function (e, i) { return !a.req[e] || s[i] >= a.req[e]; });
      });
    });
  }

  // ---- weapons, armour and footwear, from the game's own tables ----
  var GEAR_SLOTS = [{ key: 'weapon', k: 'w', label: 'Weapon' }, { key: 'armor', k: 'a', label: 'Armor' }, { key: 'shoes', k: 'f', label: 'Footwear' }];
  var GEAR_KIND = { w: 'Weapon', a: 'Armor', f: 'Footwear' };
  var GEAR_STATS = ['STR', 'ATS', 'DEF', 'ADF', 'SPD', 'MOV', 'EVA', 'AEV', 'CRT', 'ACC', 'HP', 'EP'];
  var GEAR_PCT = { EVA: 1, AEV: 1, CRT: 1, ACC: 1 };
  function gear(name) { return (G.gear && name && G.gear[name]) || null; }
  // What a piece is worth to someone who attacks with STR, or with ATS. Their own attack stat
  // and both defences count in full, the other attack stat barely. A point of SPD counts as
  // eight, which is the rate the game's own accessories trade it at.
  function gearScore(name, stat) {
    var g = gear(name);
    if (!g) return 0;
    var w = { STR: stat === 'str' ? 1 : 0.2, ATS: stat === 'ats' ? 1 : 0.2, DEF: 1, ADF: 1, SPD: 8, MOV: 2, EVA: 2, AEV: 2, CRT: stat === 'str' ? 2 : 0.5, ACC: 1, HP: 0.05, EP: 0.1 };
    var sum = 0;
    Object.keys(g.s).forEach(function (k) { sum += g.s[k] * (w[k] || 0); });
    return sum;
  }
  // (the space inside the strings of signed() and matsText() is a no-break space, so "STR +70" and "×2" never split across lines)
  function signed(k, v) { return k + ' ' + (v > 0 ? '+' : '−') + Math.abs(v) + (GEAR_PCT[k] ? '%' : ''); }
  function gearStats(name) {
    var g = gear(name);
    if (!g) return '';
    var bits = GEAR_STATS.filter(function (k) { return g.s[k]; }).map(function (k) { return signed(k, g.s[k]); });
    if (g.x) bits.push(g.x);
    return bits.join(' · ');
  }
  // what changes when `to` replaces `from`
  function gearGain(to, from) {
    var a = gear(to), b = gear(from);
    if (!a) return '';
    return GEAR_STATS.map(function (k) {
      var d = (a.s[k] || 0) - ((b && b.s[k]) || 0);
      return d ? signed(k, d) : '';
    }).filter(Boolean).join(', ');
  }
  // Has the story reached the point where a tier of shop stock opens or closes? The save says
  // so exactly. Without one, the whole chapter's stock is taken to be in.
  function reached(flag) {
    if (!flag) return true;
    if (live && live.story) return live.story.indexOf(flag) !== -1;
    return Math.floor((flag - 16000) / 1000) <= chapterN;
  }
  function isOpen(win) { return !!win && reached(win[0]) && !(win[1] && reached(win[1])); }
  function matsText(mats) { return mats.map(function (x) { return x[0] + ' ×' + x[1]; }).join(', '); }
  function mira(n) { return String(n).replace(/\B(?=(\d{3})+$)/g, ',') + ' mira'; }
  function chestText(name) {
    var src = CH && CH.gearSrc && CH.gearSrc[name];
    return src ? 'chest, ' + src.where + (src.tag ? ' (' + src.tag + ')' : '') : '';
  }
  // how to get the piece a plan entry names, in a few words
  function gearHow(e) {
    var t = '';
    if (e.how === 'own') t = e.where;
    else if (e.how === 'find') t = chestText(e.name);
    else if (e.how === 'craft') {
      var base = !live ? e.base + (chestText(e.base) ? ' (' + chestText(e.base) + ')' : '')
        : e.baseWhere === 'worn' ? 'the ' + e.base + ' worn now'
          : e.baseWhere === 'in your bag' ? 'the ' + e.base + ' in your bag' : 'the ' + e.base + ' (' + e.baseWhere + ')';
      t = 'upgrade ' + base + ' at an orbal factory · ' + matsText(e.mats);
    } else if (e.how === 'buy') t = 'buy it at a weapon shop · ' + mira(e.price);
    else if (e.how === 'buycraft') t = 'buy ' + e.base + ' (' + mira(e.price) + '), then upgrade it at an orbal factory · ' + matsText(e.mats);
    if (e.make) t += ' (' + e.make.map(function (x) { return x[0] + ' ×' + x[1] + ' is made from ' + x[2] + ' ×' + x[3]; }).join('; ') + ')';
    if (e.short) t += ' — short by ' + matsText(e.short);
    return t;
  }

  // Who should wear what. Ranks every piece each character could use, gives each piece to
  // whoever gets the most out of it, and works out how to get there: equip a spare, upgrade
  // something you own, or buy. Reserve characters only get what is lying around.
  function planGear(m, isActive) {
    m.gear = {}; m.gearWait = []; m.gearOptional = []; m.gearLater = []; m.matsUsed = {}; m.matsHave = {};
    m.gearStale = !!live && !live.bag.gear; // an older live server is still running: it does not report spare gear
    if (!G.gear || m.gearStale) return;
    var order = (CH.gearOrder || []).concat(CH.characters.map(function (c) { return c.id; }));
    order = order.filter(function (id, i) { return order.indexOf(id) === i && m.alloc[id]; });
    var inScope = function (g) { return g.ch != null && g.ch <= chapterN; };

    var free = {}, bag = {}, mats = {}, holders = [], waiting = {};
    if (live) {
      (live.bag.gear || []).forEach(function (x) { bag[x.name] = x.count; free[x.name] = (free[x.name] || 0) + x.count; });
      (live.bag.materials || []).forEach(function (x) { mats[x.name] = x.count; });
      Object.keys(live.characters).forEach(function (id) {
        var lc = live.characters[id];
        if (isActive(id) && !m.alloc[id]) return; // in the party without notes: their gear is theirs
        GEAR_SLOTS.forEach(function (sl) {
          if (!lc[sl.key]) return;
          free[lc[sl.key]] = (free[lc[sl.key]] || 0) + 1;
          holders.push({ name: lc[sl.key], id: id, who: lc.name, bench: !isActive(id) });
        });
      });
    } else {
      // no save to go by: take every chest of the chapters so far as opened
      Object.keys(G.gear).forEach(function (n) { if (G.gear[n].n && inScope(G.gear[n])) free[n] = G.gear[n].n; });
    }
    var owned = JSON.parse(JSON.stringify(free));
    m.matsHave = JSON.parse(JSON.stringify(mats));

    // takes one free copy and says where it physically is
    function claim(name, id) {
      free[name]--;
      if (!live) return '';
      var i, pick = -1;
      for (i = 0; i < holders.length; i++) if (holders[i].name === name && holders[i].id === id) { holders.splice(i, 1); return 'worn'; }
      if (bag[name] > 0) { bag[name]--; return 'in your bag'; }
      for (i = 0; i < holders.length && pick === -1; i++) if (holders[i].name === name && holders[i].bench) pick = i;
      for (i = holders.length - 1; i >= 0 && pick === -1; i--) if (holders[i].name === name) pick = i;
      return pick === -1 ? 'in your bag' : 'take it from ' + holders.splice(pick, 1)[0].who;
    }
    function reach(n, id, mayBuy) {
      var g = G.gear[n], e = null;
      // the bench keeps what it wears and takes from the bag, never from someone else
      var mine = holders.some(function (h) { return h.name === n && h.id === id; });
      if (free[n] > 0 && (mayBuy || mine || bag[n] > 0)) {
        var w = claim(n, id);
        return w === 'worn' ? { how: 'ok' } : { how: live ? 'own' : 'find', where: w };
      }
      if (!mayBuy) return null;
      if (g.from && isOpen(g.up)) {
        var base = g.from[0], bg = G.gear[base];
        if (free[base] > 0) e = { how: 'craft', base: base, baseWhere: claim(base, id), mats: g.from[1] };
        else if (bg && isOpen(bg.sell)) e = { how: 'buycraft', base: base, mats: g.from[1], price: bg.p };
      }
      if (!e && isOpen(g.sell)) e = { how: 'buy', price: g.p };
      return e;
    }
    // a chest find nobody has yet: the piece itself, or the piece its upgrade is made from
    function chestRoot(n) {
      var g = G.gear[n];
      var root = g.n ? n : (g.from && G.gear[g.from[0]] && G.gear[g.from[0]].n ? g.from[0] : null);
      if (!root || !CH.gearSrc || !CH.gearSrc[root]) return null;
      if (owned[root] > 0 || owned[root + '+'] > 0 || (waiting[root] || 0) >= G.gear[root].n) return null;
      return root;
    }

    // Chest armour and footwear are for men or for women only. Who is which is read off the
    // model files, so if the save shows someone wearing the other cut, the rule is dropped for them.
    var cutOf = {};
    order.forEach(function (id) {
      var sex = buildOf(id).sex, lc = live ? live.characters[id] : null;
      var clash = lc && GEAR_SLOTS.some(function (sl) { var g = gear(lc[sl.key]); return g && g.sex && g.sex !== sex; });
      cutOf[id] = clash ? null : sex;
    });
    // every piece a character could use in a slot, best first
    function candidates(id, sl, has) {
      var stat = buildOf(id).stat;
      return Object.keys(G.gear).filter(function (n) {
        var g = G.gear[n];
        if (g.sex && cutOf[id] && g.sex !== cutOf[id]) return false;
        return g.k === sl.k && (sl.k !== 'w' || g.who === id) && (owned[n] > 0 || inScope(g));
      }).map(function (n) { return { id: id, n: n, v: gearScore(n, stat), worn: n === has ? 1 : 0 }; })
        .sort(function (p, q) { return q.v - p.v || q.worn - p.worn || p.n.localeCompare(q.n); });
    }
    // the best they can have without the piece named: what they wear instead of an upgrade not worth making
    function instead(e, anyCost) {
      var sl = GEAR_SLOTS.filter(function (s) { return s.key === e.key; })[0];
      var list = candidates(e.id, sl, e.has);
      for (var i = 0; i < list.length; i++) {
        if (list[i].n === e.name) continue;
        var r = reach(list[i].n, e.id, isActive(e.id));
        if (r && r.mats && !anyCost) { if (r.how === 'craft') free[r.base]++; continue; }
        if (r) { r.name = list[i].n; return r; }
      }
      return null;
    }
    // the best piece of the shop line, bought and upgraded: what a chest piece has to beat
    function shopBest(id, sl) {
      var list = candidates(id, sl, null).filter(function (p) {
        var g = G.gear[p.n], base = g.from && G.gear[g.from[0]];
        return isOpen(g.sell) || (base && isOpen(g.up) && isOpen(base.sell));
      });
      return list.length ? list[0].v : 0;
    }

    order.forEach(function (id) { m.gear[id] = {}; });
    [order.filter(isActive), order.filter(function (id) { return !isActive(id); })].forEach(function (group, pass) {
      var mayBuy = pass === 0 || !live;
      GEAR_SLOTS.forEach(function (sl) {
        // every (character, piece) pair, best fit first; ties go to the earlier character
        var pairs = [];
        group.forEach(function (id, rank) {
          candidates(id, sl, live ? live.characters[id][sl.key] : null).forEach(function (p) { p.rank = rank; pairs.push(p); });
        });
        pairs.sort(function (p, q) { return q.v - p.v || p.rank - q.rank || q.worn - p.worn || p.n.localeCompare(q.n); });
        pairs.forEach(function (p) {
          var mine = m.gear[p.id];
          if (mine[sl.key] && mine[sl.key].name) return;
          var e = reach(p.n, p.id, mayBuy);
          if (e) {
            e.name = p.n; e.later = mine[sl.key] ? mine[sl.key].later : null;
            mine[sl.key] = e;
            return;
          }
          var root = mayBuy && live && !(mine[sl.key] && mine[sl.key].later) ? chestRoot(p.n) : null;
          if (root) {
            waiting[root] = (waiting[root] || 0) + 1;
            mine[sl.key] = { later: { name: root, where: chestText(root) } };
          }
        });
        group.forEach(function (id) {
          var b = buildOf(id), lc = live ? live.characters[id] : null;
          var e = m.gear[id][sl.key] || {};
          var has = lc ? lc[sl.key] : null;
          if (!e.name) { e.name = has; e.how = 'keep'; }
          e.id = id; e.who = b.name; e.key = sl.key; e.label = sl.label; e.has = has;
          e.gain = e.how === 'ok' || e.how === 'keep' ? '' : gearGain(e.name, has);
          // what the piece adds: over what is worn, or with no save, over the piece it would replace
          e.worth = gearScore(e.name, b.stat) - (live ? gearScore(has, b.stat) : e.how === 'buycraft' ? gearScore(e.base, b.stat) : shopBest(id, sl));
          m.gear[id][sl.key] = e;
          if (e.later) m.gearLater.push({ name: e.later.name, id: id, who: b.name, label: sl.label });
        });
      });
    });

    // Upgrades cost materials. Pay for the ones that give the most per U-Material first; what
    // cannot be afforded yet waits.
    // A refined material is worth what it is made from: U-Material ×5 a piece.
    var refine = G.refine || {};
    var unit = function (name) { return name === 'U-Material' ? 1 : (refine[name] && refine[name][0] === 'U-Material' ? refine[name][1] : (/^U-Material/.test(name) ? 50 : 0)); };
    var units = function (e) { return e.mats.reduce(function (n, x) { return n + unit(x[0]) * x[1]; }, 0) || 1; };
    var steps = [];
    order.forEach(function (id) { GEAR_SLOTS.forEach(function (sl) { var e = m.gear[id][sl.key]; if (e.mats) steps.push(e); }); });
    steps.sort(function (a, b) { return b.worth / units(b) - a.worth / units(a); });
    steps.forEach(function (e) {
      // under six points per U-Material is a small gain for the cost: offered, not planned
      if (e.worth / units(e) < 6) {
        var opt = { id: e.id, who: e.who, label: e.label, has: e.has, name: e.name, text: gearHow(e), gain: e.gain };
        var alt = instead(e, !live);
        if (alt) {
          ['name', 'how', 'where', 'base', 'baseWhere', 'mats', 'price'].forEach(function (k) { if (alt[k] == null) delete e[k]; else e[k] = alt[k]; });
          opt.gain = gearGain(opt.name, e.name);
          e.gain = e.how === 'ok' ? '' : gearGain(e.name, e.has);
          e.option = opt;
        } else e.minor = true;
        m.gearOptional.push(opt);
        return;
      }
      if (!live) return;
      var pool = JSON.parse(JSON.stringify(mats)), make = [];
      e.mats.forEach(function (x) {
        var lack = x[1] - (pool[x[0]] || 0), r = refine[x[0]];
        if (lack > 0 && r && (pool[r[0]] || 0) >= lack * r[1]) { // refine what is missing
          pool[r[0]] -= lack * r[1]; pool[x[0]] = (pool[x[0]] || 0) + lack;
          make.push([x[0], lack, r[0], lack * r[1]]);
        }
      });
      var short = e.mats.filter(function (x) { return (pool[x[0]] || 0) < x[1]; }).map(function (x) { return [x[0], x[1] - (pool[x[0]] || 0)]; });
      if (short.length) { e.short = short; m.gearWait.push(e); return; }
      e.mats.forEach(function (x) { pool[x[0]] -= x[1]; });
      if (make.length) e.make = make;
      Object.keys(m.matsHave).forEach(function (n) { if (pool[n] < mats[n]) m.matsUsed[n] = (m.matsUsed[n] || 0) + mats[n] - pool[n]; });
      mats = pool;
    });
  }

  // ---- the model: who is in the party, what each slot should hold right now, what to move ----
  function buildOf(id) {
    return CH.characters.filter(function (c) { return c.id === id; })[0] || null;
  }
  function haveKey(name) { return chapterN + ':' + name; }

  function compute() {
    var m = { active: [], reserve: [], alloc: {}, todo: [], rows: [] };
    if (live) {
      m.active = live.party.slice();
      m.reserve = live.reserve.filter(function (id) { return buildOf(id); });
    } else {
      m.active = (CH.party.pick || []).slice();
      m.reserve = CH.characters.map(function (c) { return c.id; }).filter(function (id) { return m.active.indexOf(id) === -1; });
    }
    var isActive = function (id) { return m.active.indexOf(id) !== -1; };

    // how many copies of each quartz exist: bag plus everything slotted on anyone
    var avail = null;
    if (live) {
      avail = {};
      live.bag.quartz.forEach(function (x) { avail[x.name] = (avail[x.name] || 0) + x.count; });
      Object.keys(live.characters).forEach(function (id) {
        if (isActive(id) && !buildOf(id)) return; // in the party without notes: leave their quartz alone
        ORDER.forEach(function (k) { var n = live.characters[id].slots[k]; if (n) avail[n] = (avail[n] || 0) + 1; });
      });
    }
    m.owned = avail ? JSON.parse(JSON.stringify(avail)) : null;

    // Every slot of every character you have, active party first, in the order the chapter
    // lists its characters. That order is who gets a scarce quartz first.
    var order = CH.characters.map(function (c) { return c.id; });
    var slots = [];
    order.filter(isActive).concat(order.filter(function (id) { return !isActive(id); })).forEach(function (id) {
      if (live && !live.characters[id]) return; // not with you: nothing to allocate
      m.alloc[id] = {};
      ORDER.forEach(function (k) {
        slots.push({ id: id, k: k, s: buildOf(id).slots[k], has: live ? live.characters[id].slots[k] : null, active: isActive(id), res: null });
      });
    });
    function take(n) { if (avail[n] > 0) { avail[n]--; return true; } return false; }
    function pass(test, result) { slots.forEach(function (x) { if (!x.res && test(x)) x.res = result(x); }); }
    var asTarget = function (x) { return { name: x.s.t, later: null }; };
    var asFallback = function (x) { return { name: x.s.u, later: x.s.t }; };
    if (!avail) {
      pass(function (x) { return x.s.u && !state.have[haveKey(x.s.t)]; }, asFallback);
      pass(function () { return true; }, asTarget);
    } else {
      // 1. a target that is already in its slot stays there, so nothing is shuffled for no gain
      pass(function (x) { return x.active && x.has === x.s.t && take(x.s.t); }, asTarget);
      //    ...and so does a stand-in whose upgrade nobody owns yet, even if someone else wants it
      pass(function (x) { return x.active && x.s.u && x.has === x.s.u && !(avail[x.s.t] > 0) && take(x.s.u); }, asFallback);
      // 2. spare copies of a target go out by priority
      pass(function (x) { return take(x.s.t); }, asTarget);
      // 3. a stand-in that is already in its slot stays; 4. then spare stand-ins
      pass(function (x) { return x.active && x.s.u && x.has === x.s.u && take(x.s.u); }, asFallback);
      pass(function (x) { return x.s.u && take(x.s.u); }, asFallback);
      // 5. nothing to put there yet: keep whatever is slotted and wait for the target
      pass(function (x) { return !!x.has; }, function (x) { return { name: x.has, later: x.s.t, waiting: true }; });
      pass(function () { return true; }, function (x) { return { name: x.s.t, later: null, missing: true }; });
    }
    slots.forEach(function (x) { m.alloc[x.id][x.k] = x.res; });

    // rows of the upgrade list: every quartz the active party is still waiting for, or already got
    var rowOf = {};
    order.filter(isActive).forEach(function (id) {
      var b = buildOf(id);
      if (!m.alloc[id]) return;
      ORDER.forEach(function (k) {
        var s = b.slots[k], a = m.alloc[id][k];
        if (!s.u && !a.missing && !a.waiting) return; // a plain slot you already have the quartz for
        var r = rowOf[s.t] || (rowOf[s.t] = { name: s.t, wants: [], got: 0 });
        var got = a.name === s.t && !a.missing;
        r.wants.push({ id: id, who: b.name, slot: k, replaces: s.u || null, got: got });
        if (got) r.got++;
      });
    });
    var names = Object.keys(CH.sources).filter(function (n) { return rowOf[n]; })
      .concat(Object.keys(rowOf).filter(function (n) { return !CH.sources[n]; }));
    m.rows = names.map(function (n) {
      var r = rowOf[n];
      r.src = CH.sources[n] || null;
      r.done = r.got === r.wants.length;
      return r;
    });

    planGear(m, isActive);
    // chest finds the party is still waiting for join the upgrade list
    var gearRow = {};
    m.gearLater.forEach(function (x) {
      var r = gearRow[x.name];
      if (!r) { r = gearRow[x.name] = { name: x.name, gear: true, wants: [], got: 0, done: false, src: CH.gearSrc[x.name] || null }; m.rows.push(r); }
      r.wants.push({ id: x.id, who: x.who, label: x.label, got: false });
    });

    if (live) planMoves(m, isActive);
    return m;
  }

  // Works out, slot by slot, what differs from the save and where the replacement physically is.
  function planMoves(m, isActive) {
    var bag = {};
    live.bag.quartz.forEach(function (x) { bag[x.name] = x.count; });
    var loose = []; // quartz that are free to take: on the bench, or in a slot that is about to change
    Object.keys(live.characters).forEach(function (id) {
      var lc = live.characters[id];
      ORDER.forEach(function (k) {
        var has = lc.slots[k];
        if (!has) return;
        var a = m.alloc[id] && isActive(id) ? m.alloc[id][k] : null;
        if (!isActive(id)) loose.push({ name: has, id: id, who: lc.name, slot: k, bench: true });
        else if (a && a.name !== has) loose.push({ name: has, id: id, who: lc.name, slot: k, bench: false });
      });
    });
    function source(name, id) {
      if (bag[name] > 0) { bag[name]--; return 'in your bag'; }
      var i, x;
      for (i = 0; i < loose.length; i++) {
        x = loose[i];
        if (x.name === name && x.bench) { loose.splice(i, 1); return 'take it from ' + x.who; }
      }
      for (i = 0; i < loose.length; i++) {
        x = loose[i];
        if (x.name !== name) continue;
        loose.splice(i, 1);
        return x.id === id ? 'move it from the ' + POS_NAME[x.slot].toLowerCase() + ' slot'
          : 'take it from ' + x.who + '’s ' + POS_NAME[x.slot].toLowerCase() + ' slot';
      }
      var src = CH.sources[name];
      return 'none spare' + (src ? ' — ' + src.where : ' — synthesize or buy one');
    }
    var wornBy = {}; // accessory name -> bench characters wearing it
    Object.keys(live.characters).forEach(function (id) {
      if (isActive(id)) return;
      live.characters[id].accessories.forEach(function (a) { if (a) (wornBy[a] = wornBy[a] || []).push(live.characters[id].name); });
    });
    var bagAcc = {};
    live.bag.accessories.forEach(function (x) { bagAcc[x.name] = x.count; });

    CH.characters.forEach(function (b) {
      var lc = live.characters[b.id];
      if (!lc || !m.alloc[b.id]) return;
      var list = [];
      ORDER.forEach(function (k) {
        var a = m.alloc[b.id][k], has = lc.slots[k];
        if (has === a.name) return;
        list.push({ id: b.id, who: b.name, kind: 'slot', pos: POS_NAME[k], from: has || 'empty', to: a.name, where: isActive(b.id) ? source(a.name, b.id) : '' });
      });
      GEAR_SLOTS.forEach(function (sl) {
        var e = m.gear[b.id] && m.gear[b.id][sl.key];
        if (!e || e.how === 'ok' || e.how === 'keep' || e.short || e.minor) return;
        list.push({ id: b.id, who: b.name, kind: 'gear', pos: sl.label, from: e.has || 'empty', to: e.name, where: gearHow(e), note: e.gain });
      });
      b.accessories.forEach(function (acc) {
        if (lc.accessories.indexOf(acc) !== -1) return;
        var where = '';
        if (isActive(b.id)) {
          var made = G.accessories[acc] || [];
          if (bagAcc[acc] > 0) { bagAcc[acc]--; where = 'in your bag'; }
          else if (wornBy[acc] && wornBy[acc].length) where = 'take it from ' + wornBy[acc].shift();
          else if (made[3] && isOpen(made[4]) && bagAcc[made[3][0]] > 0) { bagAcc[made[3][0]]--; where = 'upgrade the ' + made[3][0] + ' in your bag at an orbal factory · ' + matsText(made[3][1]); }
          else where = 'none spare';
        }
        list.push({ id: b.id, who: b.name, kind: 'acc', pos: 'Accessory', from: null, to: acc, where: where });
      });
      m.alloc[b.id].todo = list;
      if (isActive(b.id)) m.todo = m.todo.concat(list);
    });
  }

  return {
    use: use, compute: compute, buildOf: buildOf, haveKey: haveKey,
    quartz: quartz, lineValues: lineValues, artsFor: artsFor,
    gear: gear, gearScore: gearScore, gearStats: gearStats, gearGain: gearGain, gearHow: gearHow,
    reached: reached, isOpen: isOpen, matsText: matsText, mira: mira, chestText: chestText,
    ELS: ELS, ORDER: ORDER, POS_NAME: POS_NAME, GEAR_SLOTS: GEAR_SLOTS, GEAR_KIND: GEAR_KIND
  };
});
