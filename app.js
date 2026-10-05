(function () {
  'use strict';

  var B = window.BUILD;
  var G = window.GAME;
  var ELS = ['earth', 'water', 'fire', 'wind', 'time', 'space', 'mirage'];
  var EL_SHORT = { earth: 'Ea', water: 'Wa', fire: 'Fi', wind: 'Wi', time: 'Ti', space: 'Sp', mirage: 'Mi' };
  var EL_NAME = { earth: 'Earth', water: 'Water', fire: 'Fire', wind: 'Wind', time: 'Time', space: 'Space', mirage: 'Mirage' };
  var ORDER = ['t', 'ul', 'ur', 'c', 'll', 'lr', 'b'];
  // Slot centres as % of the square dial box: a regular hexagon around the centre, as on the
  // in-game orbment. RING is the hexagon's radius.
  var RING = 35.5, HALF = RING * 0.8660254;
  var POS = {
    t: [50, 50 - RING], ur: [50 + HALF, 50 - RING / 2], lr: [50 + HALF, 50 + RING / 2],
    b: [50, 50 + RING], ll: [50 - HALF, 50 + RING / 2], ul: [50 - HALF, 50 - RING / 2], c: [50, 50]
  };
  var STATUSES = ['Poison', 'Freeze', 'Petrify', 'Sleep', 'Burn', 'Seal', 'Mute', 'Blind', 'Confuse', 'Deathblow', 'Stat Debuff', 'Slow', 'Delay', 'Status Ailments'];
  var POS_NAME = { c: 'Center', t: 'Top', ur: 'Upper-right', lr: 'Lower-right', b: 'Bottom', ll: 'Lower-left', ul: 'Upper-left' };
  var HUE = { estelle: 28, scherazard: 285, olivier: 46, kloe: 256, agate: 4, tita: 38, zin: 150 };
  var KEY = 'sky2-build-v2';

  var CH = null;          // the chapter being shown
  var chapterN = null;
  var live = null;        // pushed by server.js whenever the game writes a save
  var liveOnline = false;
  var notice = '';
  var openKeys = {};      // which <details> are open, kept across re-renders

  // ---- manual state, used when the page is not served by the local live server ----
  var state = { chapter: B.baseChapter, have: {} };
  (B.have || []).forEach(function (k) { state.have[k] = true; });
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) {
      if (G.chapters.indexOf(saved.chapter) !== -1) state.chapter = saved.chapter;
      Object.keys(saved.have || {}).forEach(function (k) { state.have[k] = !!saved.have[k]; });
    }
  } catch (e) { /* storage unavailable: page still works */ }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // ---- small DOM helpers ----
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
    return parent;
  }
  // text with **bold** runs
  function rich(tag, cls, text) {
    var n = el(tag, cls);
    String(text).split(/\*\*(.+?)\*\*/).forEach(function (part, i) {
      if (!part) return;
      n.appendChild(i % 2 ? el('strong', '', part) : document.createTextNode(part));
    });
    return n;
  }
  function details(key, summaryNode, cls, openByDefault) {
    var d = el('details', cls || '');
    d.open = key in openKeys ? !!openKeys[key] : !!openByDefault;
    d.addEventListener('toggle', function () { openKeys[key] = d.open; });
    var s = el('summary');
    if (typeof summaryNode === 'string') s.textContent = summaryNode; else s.appendChild(summaryNode);
    d.appendChild(s);
    return d;
  }
  function byId(id) { return document.getElementById(id); }

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
        r.wants.push({ who: b.name, slot: k, replaces: s.u || null, got: got });
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
      b.accessories.forEach(function (acc) {
        if (lc.accessories.indexOf(acc) !== -1) return;
        var where = '';
        if (isActive(b.id)) {
          if (bagAcc[acc] > 0) { bagAcc[acc]--; where = 'in your bag'; }
          else if (wornBy[acc] && wornBy[acc].length) where = 'take it from ' + wornBy[acc].shift();
          else where = 'none spare';
        }
        list.push({ id: b.id, who: b.name, kind: 'acc', pos: 'Accessory', from: null, to: acc, where: where });
      });
      m.alloc[b.id].todo = list;
      if (isActive(b.id)) m.todo = m.todo.concat(list);
    });
  }

  // ---- pieces ----
  function swapItem(it) {
    var li = el('li');
    add(li, el('span', 'pos', it.pos));
    if (it.from) add(li, el('span', 'from', it.from), el('span', 'arrow', '→'));
    add(li, el('strong', 'to', it.to));
    if (it.where) add(li, el('span', 'where', it.where));
    return li;
  }

  function shortName(name) { return name === 'Scherazard' ? 'Schera' : name; }
  // One letter, or two when someone else on the page starts with the same one.
  function initial(id, name) {
    var all = {};
    if (live) Object.keys(live.characters).forEach(function (k) { all[k] = live.characters[k].name; });
    else if (CH) CH.characters.forEach(function (c) { all[c.id] = c.name; });
    var clash = Object.keys(all).some(function (k) { return k !== id && all[k].charAt(0) === name.charAt(0); });
    return clash ? name.slice(0, 2) : name.charAt(0);
  }
  function avatar(id, name, cls, labelled) {
    var a = el('span', 'avatar' + (cls ? ' ' + cls : ''), initial(id, name));
    var hue = HUE[id];
    if (hue == null) { hue = 0; for (var i = 0; i < id.length; i++) hue = (hue * 31 + id.charCodeAt(i)) % 360; }
    a.style.setProperty('--h', hue);
    if (labelled) { a.title = name; a.setAttribute('role', 'img'); a.setAttribute('aria-label', name); }
    else a.setAttribute('aria-hidden', 'true');
    return a;
  }

  // cells[k] = { name, ok, change, has, later, missing }
  function renderOrbment(lines, locks, cells) {
    var wrap = el('div', 'orbment');
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    function shape(tag, attrs) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      svg.appendChild(n);
    }
    function ring(r, cls, extra) {
      var attrs = { cx: 50, cy: 50, r: r, 'class': cls };
      Object.keys(extra || {}).forEach(function (k) { attrs[k] = extra[k]; });
      shape('circle', attrs);
    }
    // the casing: a round bezel, a face with minute marks, and a hub ring around the centre slot
    ring(49.2, 'dial-bezel');
    ring(45.6, 'dial-face');
    ring(43.4, 'dial-ticks', { pathLength: 120, 'stroke-dasharray': '0.14 0.86' });
    ring(43, 'dial-ticks dial-ticks-major', { pathLength: 12, 'stroke-dasharray': '0.035 0.965', transform: 'rotate(-90.5 50 50)' });
    ring(16.5, 'dial-hub');
    ring(14.2, 'dial-hub dial-hub-dashed');
    // each line is a chain: center, then slot to slot outwards, as on the in-game orbment
    lines.forEach(function (line, i) {
      var pts = line.map(function (k) { return POS[k][0].toFixed(2) + ',' + POS[k][1].toFixed(2); }).join(' ');
      shape('polyline', { points: pts, 'class': 'rail-case' });
      shape('polyline', { points: pts, 'class': 'rail line-' + (i + 1) });
    });
    // sockets: a coloured ring means the slot only takes that element; dashed means an upgrade is pending
    ORDER.forEach(function (k) {
      var c = cells[k] || {};
      shape('circle', { cx: POS[k][0].toFixed(2), cy: POS[k][1].toFixed(2), r: 7.5, 'class': 'socket' + (locks[k] ? ' socket-lock lock-' + locks[k] : '') });
      if (c.later) shape('circle', { cx: POS[k][0].toFixed(2), cy: POS[k][1].toFixed(2), r: 9.4, 'class': 'socket-pending' });
    });
    wrap.appendChild(svg);

    ORDER.forEach(function (k) {
      var c = cells[k] || {};
      var q = c.name ? quartz(c.name) : null;
      var lock = locks[k];
      var node = el('div', 'slot' + (c.change ? ' is-change' : '') + (c.ok ? ' is-ok' : '') + (c.later ? ' is-pending' : '') + (c.name ? '' : ' is-empty'));
      node.style.left = POS[k][0].toFixed(2) + '%';
      node.style.top = POS[k][1].toFixed(2) + '%';
      node.title = POS_NAME[k] + (c.name ? ': ' + c.name + (q.fx ? ' — ' + q.fx : '') : ': empty');
      var orb = el('span', 'orb' + (q ? ' el-' + q.el : ' orb-empty'));
      if (c.ok) orb.appendChild(el('span', 'check', '✓'));
      add(node, orb, el('span', 'q', c.name || 'empty'));
      if (lock) node.appendChild(el('span', 'sub lockname el-text-' + lock, EL_NAME[lock] + ' only'));
      if (c.change) node.appendChild(el('span', 'sub had', 'has ' + (c.has || 'nothing')));
      if (c.later) node.appendChild(el('span', 'sub later', 'later: ' + c.later));
      wrap.appendChild(node);
    });
    return wrap;
  }

  function renderValues(lines, nameAt, caption) {
    var box = el('div', 'values');
    var table = el('table', 'value-table');
    table.appendChild(el('caption', '', caption));
    var hr = el('tr');
    hr.appendChild(el('th', '', ''));
    ELS.forEach(function (e) {
      var th = el('th');
      add(th, el('span', 'dot el-' + e), el('span', 'el-abbr', EL_SHORT[e]));
      th.title = EL_NAME[e];
      hr.appendChild(th);
    });
    add(table, add(el('thead'), hr));
    var tb = el('tbody');
    lines.forEach(function (line, i) {
      var tr = el('tr');
      var th = el('th', 'line-label');
      add(th, el('span', 'swatch line-bg-' + (i + 1)), document.createTextNode('Line ' + (i + 1)));
      tr.appendChild(th);
      lineValues(line, nameAt).forEach(function (v) { tr.appendChild(el('td', v ? '' : 'zero', String(v))); });
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    box.appendChild(table);
    return box;
  }

  function accessoryText(name) {
    var g = G.accessories[name];
    if (!g) return name;
    var blocks = Object.keys(g[1]).map(function (s) { return (s === 'Status Ailments' ? 'all status ailments' : s) + ' ' + g[1][s] + '%'; });
    return name + (g[0] ? ' — ' + g[0] : '') + (blocks.length ? ' · resists ' + blocks.join(', ') : '');
  }

  function artChips(list, cls) {
    var p = el('p', 'chips art-chips');
    list.forEach(function (a) {
      var c = el('span', 'chip art ' + (cls || '') + ' el-' + a.el);
      c.title = 'EP ' + a.ep + ' — ' + a.d;
      add(c, el('span', 'dot'), document.createTextNode(a.name));
      p.appendChild(c);
    });
    return p;
  }

  function renderCharacter(id, m, isReserve) {
    var b = buildOf(id);
    var lc = live ? live.characters[id] : null;
    var alloc = m.alloc[id];
    var name = b ? b.name : lc.name;
    var lines = lc ? lc.lines : b.lines;
    var locks = lc ? lc.locks : b.locks;

    var card = el('article', 'card char');
    card.id = 'char-' + id;
    var head = el('header', 'char-head');
    var who = el('div', 'char-who');
    var title = el('div', 'char-title');
    title.appendChild(el('h3', '', name));
    var todo = alloc && alloc.todo ? alloc.todo : [];
    if (lc && alloc) title.appendChild(el('span', 'status ' + (todo.length ? 'status-todo' : 'status-ok'), todo.length ? todo.length + ' to change' : '✓ matches your save'));
    if (lc && !alloc) title.appendChild(el('span', 'status status-none', 'no build notes this chapter'));
    add(who, title, el('p', 'role', b ? b.role : 'Shown as slotted in your save.'));
    add(head, avatar(id, name), who);
    if (lc) {
      var st = el('p', 'stats');
      [['Lv', lc.level], ['HP', lc.hp], ['EP', lc.ep]].forEach(function (x) {
        st.appendChild(add(el('span', 'stat'), el('b', '', x[0]), document.createTextNode(String(x[1]))));
      });
      head.appendChild(st);
    }
    card.appendChild(head);

    var cells = {}, nameAt = {}, fullAt = {};
    ORDER.forEach(function (k) {
      if (!alloc) { cells[k] = { name: lc.slots[k] }; nameAt[k] = lc.slots[k]; fullAt[k] = lc.slots[k]; return; }
      var a = alloc[k], has = lc ? lc.slots[k] : null;
      nameAt[k] = a.name;
      fullAt[k] = b.slots[k].t;
      cells[k] = { name: a.name, later: a.later, ok: !!lc && has === a.name, change: !!lc && has !== a.name, has: has };
    });

    var body = el('div', 'char-body');
    body.appendChild(renderOrbment(lines, locks, cells));
    var side = el('div', 'char-side');

    if (alloc) {
      var now = todo.filter(function (t) { return t.kind === 'slot'; });
      var later = [];
      ORDER.forEach(function (k) {
        if (!alloc[k].later) return;
        var src = CH.sources[alloc[k].later];
        later.push({ pos: POS_NAME[k], from: alloc[k].name, to: alloc[k].later, where: src ? src.where : '' });
      });
      var changes = el('div', 'changes');
      if (lc && !now.length) changes.appendChild(el('p', 'allset', later.length ? '✓ Slotted correctly for what you own.' : '✓ Matches the build. This is the final layout for this chapter.'));
      if (!lc && !later.length) changes.appendChild(el('p', 'allset', 'This is the final layout for this chapter.'));
      var list = function (heading, cls, items) {
        if (!items.length) return;
        changes.appendChild(el('h4', cls, heading));
        var ul = el('ul', 'swap-list');
        items.forEach(function (it) { ul.appendChild(swapItem(it)); });
        changes.appendChild(ul);
      };
      list(isReserve ? 'Differs from the build' : 'Swap now', 'h-now', now);
      list('Upgrade when you have it', 'h-later', later);
      side.appendChild(changes);
    }

    side.appendChild(renderValues(lines, nameAt, alloc ? 'In-game Value box should read' : 'Value box'));

    var have = artsFor(lines, nameAt);
    var full = alloc ? artsFor(lines, fullAt) : have;
    var names = {};
    have.forEach(function (a) { names[a.name] = true; });
    var gain = full.filter(function (a) { return !names[a.name]; });
    var arts = details('arts-' + id, 'Arts with this layout (' + have.length + ')' + (gain.length ? ' · ' + gain.length + ' more after upgrades' : ''), '', window.innerWidth >= 860);
    arts.appendChild(artChips(have));
    if (gain.length) add(arts, el('h4', 'h-later', 'Unlocked by the upgrades'), artChips(gain, 'art-later'));
    side.appendChild(arts);

    if (b && b.accessories.length || lc) {
      var acc = el('p', 'acc');
      acc.appendChild(el('span', 'acc-label', 'Accessories'));
      var missing = false;
      (b ? b.accessories : []).forEach(function (a) {
        var on = lc && lc.accessories.indexOf(a) !== -1;
        if (lc && !on) missing = true;
        var chip = el('span', 'chip' + (lc ? (on ? ' chip-ok' : ' chip-missing') : ''), (on ? '✓ ' : '') + a);
        chip.title = accessoryText(a);
        acc.appendChild(chip);
      });
      if (lc && (missing || !b || !b.accessories.length)) {
        acc.appendChild(el('span', 'acc-wearing', 'wearing ' + lc.accessories.map(function (x) { return x || 'nothing'; }).join(' + ')));
      }
      side.appendChild(acc);
    }
    body.appendChild(side);
    card.appendChild(body);

    if (b && b.notes.length) {
      var d = details('notes-' + id, 'Why, and things to know');
      var ul = el('ul', 'notes');
      b.notes.forEach(function (n) { ul.appendChild(rich('li', '', n)); });
      d.appendChild(ul);
      card.appendChild(d);
    }
    return card;
  }

  // ---- party-wide views ----
  // Who is shown, with what they have slotted and equipped right now (live), or what the build
  // puts there given what is ticked (manual).
  function members(m, ids) {
    return ids.map(function (id) {
      var b = buildOf(id), lc = live ? live.characters[id] : null;
      if (!lc && !(b && m.alloc[id])) return null;
      var nameAt = {};
      ORDER.forEach(function (k) { nameAt[k] = lc ? lc.slots[k] : m.alloc[id][k].name; });
      return {
        id: id, name: b ? b.name : lc.name, lc: lc, lines: lc ? lc.lines : b.lines, nameAt: nameAt,
        accessories: lc ? lc.accessories.filter(Boolean) : b.accessories
      };
    }).filter(Boolean);
  }

  function meter(label, now, max, cls) {
    var box = el('div', 'meter ' + cls);
    var pct = max ? Math.max(0, Math.min(100, Math.round(now / max * 100))) : 0;
    if (cls !== 'meter-cp' && pct < 90) box.classList.add(pct < 50 ? 'is-low' : 'is-part');
    var top = el('div', 'meter-top');
    add(top, el('span', 'meter-label', label), el('span', 'meter-num', now + ' / ' + max));
    var bar = el('div', 'meter-bar');
    var fill = el('span');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    return add(box, top, bar);
  }

  function renderStatus(m) {
    var card = byId('status');
    var ids = live ? m.active.concat(live.reserve).filter(function (id) { return live.characters[id] && live.characters[id].now; }) : [];
    card.hidden = !ids.length;
    if (!ids.length) return;
    var host = byId('status-body');
    host.textContent = '';
    byId('status-when').textContent = 'as of the save at ' + new Date(live.save.written).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var short = [];
    ids.forEach(function (id) {
      var lc = live.characters[id];
      var bench = m.active.indexOf(id) === -1;
      var row = el('div', 'st-row' + (bench ? ' is-bench' : ''));
      var who = el('div', 'st-who');
      add(who, avatar(id, lc.name), add(el('div', 'st-name'), el('strong', '', lc.name), el('span', 'st-sub', 'Lv ' + lc.level + (bench ? ' · reserve' : ''))));
      var gear = el('div', 'st-gear');
      [['Weapon', lc.weapon], ['Armor', lc.armor], ['Footwear', lc.shoes]].forEach(function (g) {
        add(gear, add(el('span', 'gear' + (g[1] ? '' : ' gear-none')), el('b', '', g[0]), document.createTextNode(g[1] || 'none')));
      });
      add(row, who, meter('HP', lc.now.hp, lc.hp, 'meter-hp'), meter('EP', lc.now.ep, lc.ep, 'meter-ep'), meter('CP', lc.now.cp, lc.now.cpMax, 'meter-cp'), gear);
      host.appendChild(row);
      var low = [lc.now.hp < lc.hp * 0.9 ? 'HP' : '', lc.now.ep < lc.ep * 0.9 ? 'EP' : ''].filter(Boolean);
      if (!bench && low.length) short.push(lc.name + ' (' + low.join(', ') + ')');
    });
    var note = byId('status-note');
    note.className = short.length ? 'quiet' : 'allset';
    note.textContent = short.length ? 'Running low: ' + short.join(', ') + '.' : '✓ Nobody in the party is below 90% HP or EP.';
  }

  // Which Arts the party can cast between them, from what is slotted now.
  function renderArts(m) {
    var host = byId('arts-body');
    host.textContent = '';
    var list = members(m, m.active);
    var who = {};
    list.forEach(function (c) {
      artsFor(c.lines, c.nameAt).forEach(function (a) { (who[a.name] = who[a.name] || {})[c.id] = true; });
    });
    byId('arts-hint').textContent = (live ? 'Worked out from what is slotted in your save right now.' : 'Worked out from the layouts above, for what you have ticked.')
      + ' EP is the base cost, before EP Cut.';
    var avatars = function (a) {
      var p = el('span', 'who');
      list.forEach(function (c) { if (who[a.name][c.id]) p.appendChild(avatar(c.id, c.name, 'avatar-xs', true)); });
      return p;
    };

    var support = G.arts.filter(function (a) { return who[a.name] && a.k === 's'; });
    host.appendChild(el('h3', 'block-h', 'Support Arts'));
    if (!support.length) host.appendChild(el('p', 'quiet', 'None with the current layouts.'));
    else {
      var wrap = el('div', 'table-scroll');
      var t = el('table', 'matrix arts-matrix');
      var hr = el('tr');
      add(hr, el('th', '', 'Art'), el('th', 'num', 'EP'));
      list.forEach(function (c) {
        var th = el('th', 'col-who');
        add(th, avatar(c.id, c.name, 'avatar-xs', true), el('span', 'col-name', shortName(c.name)));
        hr.appendChild(th);
      });
      add(t, add(el('thead'), hr));
      var tb = el('tbody');
      support.forEach(function (a) {
        var tr = el('tr');
        var th = el('th', 'art-name el-' + a.el);
        add(th, el('span', 'dot'), el('strong', '', a.name), el('span', 'fx', a.d));
        add(tr, th, el('td', 'num', String(a.ep)));
        list.forEach(function (c) {
          var td = el('td', 'col-who');
          if (who[a.name][c.id]) td.appendChild(avatar(c.id, c.name, 'avatar-xs', true));
          else td.appendChild(el('span', 'no', '·'));
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      wrap.appendChild(t);
      host.appendChild(wrap);
    }

    host.appendChild(el('h3', 'block-h', 'Attack Arts by element'));
    var grid = el('div', 'el-rows');
    ELS.forEach(function (e) {
      var arts = G.arts.filter(function (a) { return who[a.name] && a.k === 'a' && a.el === e; });
      var row = el('div', 'el-row el-' + e + (arts.length ? '' : ' is-none'));
      row.appendChild(add(el('span', 'el-tag'), el('span', 'dot'), document.createTextNode(EL_NAME[e])));
      var chips = el('div', 'chips');
      arts.forEach(function (a) {
        var chip = el('span', 'chip art-who');
        chip.title = a.name + ' — EP ' + a.ep + '. ' + a.d;
        add(chip, document.createTextNode(a.name), el('span', 'ep', String(a.ep)), avatars(a));
        chips.appendChild(chip);
      });
      if (!arts.length) chips.appendChild(el('span', 'quiet', 'no one in the party has one'));
      row.appendChild(chips);
      grid.appendChild(row);
    });
    host.appendChild(grid);
  }

  // What each party member resists, from the accessories worn and the quartz slotted.
  function resistOf(c) {
    var best = {};
    var take = function (res, from) {
      Object.keys(res || {}).forEach(function (s) {
        if (!best[s] || res[s] > best[s].pct) best[s] = { pct: res[s], from: from };
      });
    };
    c.accessories.forEach(function (a) { if (G.accessories[a]) take(G.accessories[a][1], a); });
    ORDER.forEach(function (k) { if (c.nameAt[k]) take(quartz(c.nameAt[k]).res, c.nameAt[k]); });
    return best;
  }
  function renderGuard(m) {
    var host = byId('guard-body');
    host.textContent = '';
    var list = members(m, m.active);
    var res = list.map(resistOf);
    var spare = {};
    if (live) {
      live.bag.accessories.forEach(function (x) {
        var r = (G.accessories[x.name] || [])[1] || {};
        Object.keys(r).forEach(function (s) { (spare[s] = spare[s] || []).push({ name: x.name, count: x.count, pct: r[s] }); });
      });
    }
    byId('guard-hint').textContent = live
      ? 'From the accessories worn and quartz slotted in your save. The last column is what in your bag would cover a gap.'
      : 'From each build’s accessories and quartz.';
    var rows = STATUSES.filter(function (s) {
      return res.some(function (r) { return r[s]; }) || spare[s] || (s !== 'Status Ailments' && s !== 'Slow');
    });
    var wrap = el('div', 'table-scroll');
    var t = el('table', 'matrix guard-matrix' + (live ? '' : ' no-spare'));
    t.style.setProperty('--n', list.length);
    var hr = el('tr');
    hr.appendChild(el('th', '', 'Status'));
    list.forEach(function (c) {
      var th = el('th', 'col-who');
      add(th, avatar(c.id, c.name, 'avatar-xs', true), el('span', 'col-name', shortName(c.name)));
      hr.appendChild(th);
    });
    if (live) hr.appendChild(el('th', 'col-spare', 'Spare in your bag'));
    add(t, add(el('thead'), hr));
    var tb = el('tbody');
    rows.forEach(function (s) {
      var tr = el('tr');
      tr.appendChild(el('th', '', s === 'Status Ailments' ? 'All status ailments' : s));
      res.forEach(function (r, i) {
        var td = el('td', 'col-who');
        var x = r[s];
        var pill = el('span', 'res ' + (x ? (x.pct >= 100 ? 'res-full' : 'res-part') : 'res-none'), x ? x.pct + '%' : '–');
        pill.title = x ? list[i].name + ': ' + x.pct + '% from ' + x.from : list[i].name + ' has no protection';
        td.appendChild(pill);
        tr.appendChild(td);
      });
      if (live) {
        var td = el('td', 'col-spare');
        (spare[s] || []).sort(function (a, b) { return b.pct - a.pct; }).slice(0, 3).forEach(function (x) {
          td.appendChild(el('span', 'chip chip-sm', x.name + ' ' + x.pct + '%' + (x.count > 1 ? ' ×' + x.count : '')));
        });
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    host.appendChild(wrap);
  }

  // Look-up tables for everything named on this page.
  function valueText(v) {
    return ELS.map(function (e, i) { return v[i] ? EL_NAME[e] + ' ' + v[i] : ''; }).filter(Boolean).join(' · ');
  }
  function renderReference(m) {
    var shown = CH.characters.filter(function (c) { return m.alloc[c.id]; });
    var people = live ? Object.keys(live.characters).map(function (id) { return live.characters[id]; }) : [];

    // quartz: everything in the builds shown, plus whatever is slotted on anyone
    var where = {};
    var note = function (name, text) { if (name) (where[name] = where[name] || []).push(text); };
    var names = {};
    shown.forEach(function (c) {
      ORDER.forEach(function (k) {
        var s = c.slots[k];
        names[s.t] = true;
        if (s.u) names[s.u] = true;
        if (!live) note(m.alloc[c.id][k].name, c.name);
      });
    });
    people.forEach(function (lc) { ORDER.forEach(function (k) { if (lc.slots[k]) { names[lc.slots[k]] = true; note(lc.slots[k], lc.name); } }); });
    if (live) live.bag.quartz.forEach(function (x) { if (names[x.name]) note(x.name, 'bag' + (x.count > 1 ? ' ×' + x.count : '')); });
    var qnames = Object.keys(names).sort(function (a, b) {
      var d = ELS.indexOf(quartz(a).el) - ELS.indexOf(quartz(b).el);
      return d || a.localeCompare(b);
    });
    var qt = byId('ref-quartz');
    qt.textContent = '';
    qnames.forEach(function (n) {
      var q = quartz(n);
      var tr = el('tr');
      add(tr, add(el('th', 'el-' + q.el), el('span', 'dot'), document.createTextNode(n)), el('td', '', valueText(q.v)), el('td', '', q.fx || '—'),
        el('td', where[n] ? '' : 'quiet', where[n] ? where[n].join(', ') : (live ? 'not owned yet' : '—')));
      qt.appendChild(tr);
    });
    byId('ref-quartz-n').textContent = String(qnames.length);

    // accessories: in the builds shown, worn, or spare in the bag
    var aw = {};
    var anote = function (name, text) { if (name) (aw[name] = aw[name] || []).push(text); };
    shown.forEach(function (c) { c.accessories.forEach(function (a) { if (live) aw[a] = aw[a] || []; else anote(a, c.name); }); });
    people.forEach(function (lc) { lc.accessories.forEach(function (a) { anote(a, lc.name); }); });
    if (live) live.bag.accessories.forEach(function (x) { anote(x.name, 'bag' + (x.count > 1 ? ' ×' + x.count : '')); });
    var at = byId('ref-acc');
    at.textContent = '';
    var anames = Object.keys(aw).sort(function (a, b) { return a.localeCompare(b); });
    anames.forEach(function (n) {
      var g = G.accessories[n] || ['', {}];
      var blocks = Object.keys(g[1]).map(function (s) { return (s === 'Status Ailments' ? 'All status ailments' : s) + ' ' + g[1][s] + '%'; }).join(', ');
      var tr = el('tr');
      add(tr, el('th', '', n), el('td', '', g[0] || '—'), el('td', '', blocks || '—'), el('td', aw[n].length ? '' : 'quiet', aw[n].length ? aw[n].join(', ') : 'not owned'));
      at.appendChild(tr);
    });
    byId('ref-acc-n').textContent = String(anames.length);
  }

  // ---- sections ----
  function renderMast() {
    var title = live && live.chapter ? live.chapter.title : (CH ? CH.title + (CH.region ? ' · ' + CH.region : '') : '');
    byId('chapter-chip').textContent = title;
    byId('chapter-chip').hidden = !title;
    var chip = byId('live-chip');
    chip.hidden = !live;
    if (live) {
      var t = new Date(live.save.written);
      chip.classList.toggle('is-off', !liveOnline);
      byId('live-text').textContent = liveOnline
        ? 'Live · game saved ' + t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + ago(t.getTime()) + ')'
        : 'Live sync paused — showing the last save read';
    }
    byId('meta-version').textContent = B.version + ' · updated ' + B.updated;
  }
  function ago(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'just now';
    var mins = Math.round(s / 60);
    if (mins < 60) return mins + ' min ago';
    return Math.round(mins / 60) + ' h ago';
  }

  function tile(label, value, sub, cls) {
    var t = el('div', 'tile ' + (cls || ''));
    add(t, el('span', 'tile-label', label), el('strong', 'tile-value', value));
    if (sub) t.appendChild(el('span', 'tile-sub', sub));
    return t;
  }

  function renderOverview(m) {
    var host = byId('overview');
    host.textContent = '';
    var nameOf = function (id) { var b = buildOf(id); return b ? b.name : (live && live.characters[id] ? live.characters[id].name : id); };
    var left = m.rows.filter(function (r) { return !r.done; }).length;
    var tiles = el('div', 'tiles');
    add(tiles,
      tile('Chapter', live && live.chapter ? live.chapter.title.replace(/:.*$/, '') : CH.title, live && live.chapter ? live.chapter.title.replace(/^[^:]*:\s*/, '') : CH.region),
      tile('Party', String(m.active.length), m.active.map(nameOf).join(' · ')),
      live ? tile('To change now', String(m.todo.length), m.todo.length ? 'slots and accessories' : 'everything matches', m.todo.length ? 'tile-warn' : 'tile-ok')
        : tile('Mode', 'Manual', 'this copy cannot see your save'),
      tile('Still to get', left + ' of ' + m.rows.length, left ? 'upgrades waiting' : 'all upgrades in place', left ? '' : 'tile-ok'));
    host.appendChild(tiles);

    var card = el('section', 'card');
    card.appendChild(el('h2', '', 'This chapter'));
    CH.intro.forEach(function (p) { card.appendChild(rich('p', '', p)); });
    var p = CH.party;
    if (p.rules && p.rules.length) {
      var ul = el('ul', 'party-list');
      p.rules.forEach(function (r) { add(ul, add(el('li'), el('strong', '', r.who), el('span', '', r.text))); });
      card.appendChild(ul);
    }
    if (p.note) card.appendChild(rich('p', 'quiet', p.note));
    if (p.later && p.later.length) {
      var s = el('span');
      add(s, document.createTextNode('Party changes later this chapter '), el('span', 'tag tag-warn', 'light spoilers, this chapter only'));
      var d = details('party-later', s);
      var l = el('ul', 'notes');
      p.later.forEach(function (x) { l.appendChild(rich('li', '', x)); });
      d.appendChild(l);
      card.appendChild(d);
    }
    if (!live) card.appendChild(renderManualControls());
    host.appendChild(card);
  }

  function renderManualControls() {
    var box = el('div', 'manual');
    box.appendChild(el('p', 'quiet', 'This copy cannot see your save, so it shows one chapter at a time and never opens the next one by itself. On the PC you play on, run start-live.cmd and the page follows the save.'));
    var row = el('p', 'manual-row');
    var i = G.chapters.indexOf(chapterN);
    if (i > 0) {
      var back = el('button', 'btn', '← Back to ' + (G.chapters[i - 1] === 9 ? 'the final chapter' : 'Chapter ' + G.chapters[i - 1]));
      back.type = 'button';
      back.addEventListener('click', function () { state.chapter = G.chapters[i - 1]; save(); start(); });
      row.appendChild(back);
    }
    if (i < G.chapters.length - 1) {
      var next = el('button', 'btn btn-strong', 'I have reached the next chapter');
      next.type = 'button';
      next.addEventListener('click', function () {
        if (!window.confirm('Open the notes for the next chapter? They mention that chapter’s party changes and bosses.')) return;
        state.chapter = G.chapters[i + 1]; save(); start();
      });
      row.appendChild(next);
    }
    box.appendChild(row);
    return box;
  }

  function renderNow(m) {
    var host = byId('now-body');
    host.textContent = '';
    if (!live) {
      host.appendChild(el('p', 'quiet', 'Tick what you own in the upgrade list below. The diagrams switch each slot to its upgrade as you tick, and show what to slot in the meantime.'));
      return;
    }
    if (!m.todo.length) {
      add(host, el('p', 'allset big', '✓ Everything matches the build for what you own.'),
        el('p', 'quiet', 'New steps appear here by themselves when you get a quartz from the list below, or when the party changes.'));
      return;
    }
    host.appendChild(el('p', 'quiet', m.todo.length + (m.todo.length === 1 ? ' change' : ' changes') + ' between your save and the build. Updates by itself after the game saves.'));
    var groups = {};
    m.todo.forEach(function (t) { (groups[t.id] = groups[t.id] || []).push(t); });
    m.active.forEach(function (id) {
      if (!groups[id]) return;
      var g = el('div', 'todo-group');
      var h = el('h3', 'todo-who');
      add(h, avatar(id, groups[id][0].who), document.createTextNode(groups[id][0].who), el('span', 'count', String(groups[id].length)));
      var ul = el('ul', 'swap-list');
      groups[id].forEach(function (t) { ul.appendChild(swapItem(t)); });
      add(g, h, ul);
      host.appendChild(g);
    });
  }

  function renderGet(m) {
    var body = byId('get-rows');
    body.textContent = '';
    byId('get').hidden = !m.rows.length;
    m.rows.forEach(function (r) {
      var q = quartz(r.name);
      var tr = el('tr', r.done ? 'is-found' : '');
      var tdCheck = el('td', 'col-check');
      if (live) {
        tdCheck.appendChild(el('span', 'have ' + (r.done ? 'have-ok' : ''), r.done ? '✓' : r.got + '/' + r.wants.length));
      } else {
        var label = el('label', 'tick');
        var box = el('input');
        box.type = 'checkbox';
        box.checked = !!state.have[haveKey(r.name)];
        box.setAttribute('aria-label', 'I have ' + r.name);
        box.addEventListener('change', function () { state.have[haveKey(r.name)] = box.checked; save(); render(); });
        label.appendChild(box);
        tdCheck.appendChild(label);
      }
      var tdName = el('td', 'col-name');
      add(tdName, el('span', 'dot el-' + q.el), el('strong', '', r.name));
      if (q.fx) tdName.appendChild(el('span', 'fx', q.fx));
      var tdWhere = el('td', 'col-where', r.src ? r.src.where : '');
      if (r.src && r.src.tag) tdWhere.appendChild(el('span', 'tag', r.src.tag));
      if (r.src && r.src.also) tdWhere.appendChild(el('span', 'fx', 'also: ' + r.src.also));
      var tdTo = el('td', 'col-to');
      r.wants.forEach(function (w) {
        var line = el('span', 'goes' + (w.got ? ' goes-ok' : ''));
        add(line, el('strong', '', (w.got ? '✓ ' : '') + w.who), document.createTextNode(', ' + POS_NAME[w.slot].toLowerCase()));
        if (w.replaces && !w.got) line.appendChild(el('span', 'fx', 'replaces ' + w.replaces));
        tdTo.appendChild(line);
      });
      add(tr, tdCheck, tdName, tdWhere, tdTo);
      body.appendChild(tr);
    });
    var left = m.rows.filter(function (r) { return !r.done; }).length;
    byId('get-count').textContent = left ? left + ' of ' + m.rows.length + ' still to get' : 'All in place';
    byId('get-hint').textContent = live
      ? 'What the party you have now is waiting for, in priority order. Counted from your save: bag plus everything slotted.'
      : 'Tick what you own and the diagrams below update. Ticks are saved on this device.';
  }

  function renderParty(m) {
    var host = byId('party');
    host.textContent = '';
    m.active.forEach(function (id) {
      if (!buildOf(id) && !(live && live.characters[id])) return;
      host.appendChild(renderCharacter(id, m, false));
    });
    var res = byId('reserve');
    res.textContent = '';
    if (!m.reserve.length) return;
    var d = details('reserve', 'Reserve builds (' + m.reserve.length + ')', 'reserve');
    d.appendChild(el('p', 'quiet', 'Not in the party right now. Their builds are here so they are ready when you swap them in; quartz they hold are treated as free to borrow.'));
    m.reserve.forEach(function (id) { d.appendChild(renderCharacter(id, m, true)); });
    res.appendChild(d);
  }

  function renderBag() {
    var card = byId('bag');
    card.hidden = !live;
    if (!live) return;
    var chips = function (hostId, list, describe) {
      var host = byId(hostId);
      host.textContent = '';
      if (!list.length) { host.appendChild(el('span', 'quiet', 'none')); return; }
      list.forEach(function (x) {
        var d = describe(x.name);
        var chip = el('span', 'chip' + (d.cls ? ' ' + d.cls : ''));
        if (d.dot) chip.appendChild(el('span', 'dot'));
        chip.appendChild(document.createTextNode(x.name));
        if (x.count > 1) chip.appendChild(el('span', 'n', '×' + x.count));
        if (d.title) chip.title = d.title;
        host.appendChild(chip);
      });
    };
    var supplies = live.bag.supplies || [];
    var kind = function (k) { return supplies.filter(function (x) { return x.kind === k; }); };
    var supply = function (name) { return { title: G.supplies[name] || '' }; };
    chips('bag-recovery', kind('Recovery'), supply);
    chips('bag-support', kind('Support'), supply);
    byId('bag-supplies').hidden = !supplies.length;
    chips('bag-quartz', live.bag.quartz, function (name) {
      var q = quartz(name);
      return { cls: 'el-' + q.el, dot: true, title: valueText(q.v) + (q.fx ? ' — ' + q.fx : '') };
    });
    chips('bag-accessories', live.bag.accessories, function (name) { return { title: accessoryText(name) }; });
    var total = function (list) { return list.reduce(function (n, x) { return n + x.count; }, 0); };
    byId('bag-quartz-n').textContent = total(live.bag.quartz) + ' spare';
    byId('bag-accessories-n').textContent = total(live.bag.accessories) + ' spare';
    byId('bag-umat').textContent = String(live.bag.uMaterial);
    var food = live.bag.food;
    byId('bag-food').textContent = food ? food.total + ' dishes of ' + food.kinds + ' kinds' : '—';
  }

  function block(b, key) {
    if (b.p) return rich('p', b.quiet ? 'quiet' : '', b.p);
    if (b.h) return el('h3', 'block-h', b.h);
    if (b.ul || b.ol) {
      var list = el(b.ul ? 'ul' : 'ol', b.ul ? 'notes' : 'steps');
      (b.ul || b.ol).forEach(function (x) { list.appendChild(rich('li', '', x)); });
      return list;
    }
    if (b.table) {
      var wrap = el('div', 'table-scroll');
      var t = el('table', 'plain');
      var hr = el('tr');
      b.table.head.forEach(function (h) { hr.appendChild(el('th', '', h)); });
      add(t, add(el('thead'), hr));
      var tb = el('tbody');
      b.table.rows.forEach(function (row) {
        var tr = el('tr');
        row.forEach(function (cell, i) { tr.appendChild(rich(i ? 'td' : 'th', '', cell)); });
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      wrap.appendChild(t);
      return wrap;
    }
    if (b.cols) {
      var cols = el('div', 'two-col');
      b.cols.forEach(function (col, i) {
        var c = el('div');
        col.forEach(function (x, j) { c.appendChild(block(x, key + '-' + i + '-' + j)); });
        cols.appendChild(c);
      });
      return cols;
    }
    if (b.details) {
      var d = details(key, b.details.summary);
      b.details.blocks.forEach(function (x, i) { d.appendChild(block(x, key + '-' + i)); });
      return d;
    }
    return el('span');
  }

  function renderSections() {
    var host = byId('sections');
    host.textContent = '';
    CH.sections.forEach(function (s) {
      var card = el('section', 'card' + (s.spoiler ? ' spoiler' : ''));
      card.id = 'sec-' + s.id;
      card.appendChild(el('h2', '', s.title));
      var into = card;
      if (s.spoiler) {
        var sum = el('span');
        add(sum, document.createTextNode('Show ' + s.title.toLowerCase() + ' '), el('span', 'tag tag-warn', s.spoiler));
        into = details('sec-' + chapterN + '-' + s.id, sum);
        card.appendChild(into);
      }
      s.blocks.forEach(function (b, i) { into.appendChild(block(b, 'blk-' + chapterN + '-' + s.id + '-' + i)); });
      host.appendChild(card);
    });
  }

  function renderNav(m) {
    var nav = byId('jump');
    nav.textContent = '';
    var link = function (href, text, node) {
      var a = el('a', node ? 'jump-who' : '', node ? null : text);
      a.href = href;
      if (node) { a.appendChild(node); a.title = text; a.setAttribute('aria-label', text); }
      nav.appendChild(a);
    };
    link('#overview', 'Overview');
    link('#now', 'Next steps');
    if (m.rows.length) link('#get', 'Upgrades');
    if (live) link('#status', 'Party');
    link('#orbments', 'Orbments');
    m.active.forEach(function (id) {
      var n = buildOf(id) ? buildOf(id).name : (live && live.characters[id] ? live.characters[id].name : null);
      if (n) link('#char-' + id, n, avatar(id, n, 'avatar-xs'));
    });
    link('#coverage', 'Coverage');
    if (live) link('#bag', 'Bag');
    CH.sections.forEach(function (s) { link('#sec-' + s.id, s.title.replace(/^Chapter notes$/, 'Notes')); });
    link('#reference', 'Reference');
    spy();
  }

  // Marks the nav link of the section being read, and keeps it in view in the nav strip.
  var spyQueued = false;
  function spy() {
    spyQueued = false;
    var nav = byId('jump');
    var links = nav.querySelectorAll('a');
    var current = null;
    for (var i = 0; i < links.length; i++) {
      var target = document.getElementById(links[i].getAttribute('href').slice(1));
      if (target && !target.hidden && target.getBoundingClientRect().top < 140) current = links[i];
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && links.length) current = links[links.length - 1];
    for (var j = 0; j < links.length; j++) links[j].classList.toggle('is-current', links[j] === current);
    if (current && nav.scrollWidth > nav.clientWidth) {
      var left = current.offsetLeft - nav.offsetLeft;
      if (left < nav.scrollLeft + 24 || left + current.offsetWidth > nav.scrollLeft + nav.clientWidth - 24) {
        nav.scrollLeft = left - (nav.clientWidth - current.offsetWidth) / 2;
      }
    }
    nav.parentNode.classList.toggle('can-scroll', nav.scrollWidth > nav.clientWidth + 2);
  }
  window.addEventListener('scroll', function () {
    if (!spyQueued) { spyQueued = true; window.requestAnimationFrame(spy); }
  }, { passive: true });
  window.addEventListener('resize', function () {
    if (!spyQueued) { spyQueued = true; window.requestAnimationFrame(spy); }
  });

  function render() {
    renderMast();
    var app = byId('app');
    app.classList.toggle('is-empty', !CH);
    byId('notice').hidden = !notice;
    byId('notice').textContent = notice;
    if (!CH) return;
    var m = compute();
    renderOverview(m);
    renderNow(m);
    renderGet(m);
    renderStatus(m);
    renderParty(m);
    renderArts(m);
    renderGuard(m);
    renderBag();
    renderSections();
    renderReference(m);
    renderNav(m);
  }

  // ---- loading a chapter ----
  function unseal(text) {
    var bin = atob(text.trim());
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder('utf-8').decode(bytes));
  }

  function showChapter(n, why) {
    if (CH && chapterN === n) { render(); return; }
    if (G.chapters.indexOf(n) === -1) {
      CH = null; chapterN = n;
      notice = (why || 'There are no notes for this chapter.') + ' Notes start at Chapter ' + G.chapters[0] + '.';
      render();
      return;
    }
    fetch('chapters/ch' + n + '.dat', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (text) {
        var changed = CH && chapterN !== n;
        CH = unseal(text); chapterN = n; notice = '';
        render();
        if (changed) window.scrollTo(0, 0);
      })
      .catch(function () {
        CH = null; chapterN = n;
        notice = 'The notes for this chapter could not be loaded. If you opened the file directly, use start-live.cmd or the published page instead.';
        render();
      });
  }

  // Decide which chapter to show: the save's when live, otherwise the one picked by hand.
  function start() {
    if (live && live.chapter) showChapter(live.chapter.n, 'Your save is in ' + live.chapter.title + '.');
    else showChapter(state.chapter);
  }

  // ---- connect to the local server if this page is being served by it ----
  // On GitHub Pages this request fails once and the page stays in manual mode.
  function connect() {
    if (!window.EventSource || !/^https?:$/.test(location.protocol)) { start(); return; }
    fetch('api/state', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.characters) { start(); return; }
        live = data; liveOnline = true;
        start();
        if (/[?&]once\b/.test(location.search)) return; // ?once: read the save a single time and do not keep a connection open
        var es = new EventSource('api/events');
        es.onmessage = function (ev) {
          try { live = JSON.parse(ev.data); liveOnline = true; start(); } catch (e) { /* ignore a bad frame */ }
        };
        es.onopen = function () { liveOnline = true; renderMast(); };
        es.onerror = function () { liveOnline = false; renderMast(); };
        setInterval(renderMast, 30000); // only refreshes the "x min ago" text
      })
      .catch(function () { start(); });
  }
  connect();
})();
