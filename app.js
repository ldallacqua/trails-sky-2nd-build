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

  // ---- the game's own art, when the live server has extracted it from your install ----
  function art() { return live && live.assets ? live.assets : null; }
  function hasArt(kind, id) { var a = art(); return !!(a && a[kind] && a[kind].indexOf(id) !== -1); }
  // one cell of the game's icon sheet (48 px cells, 21 per row)
  function sheet(cell, cls) {
    var s = el('span', 'gi' + (cls ? ' ' + cls : ''));
    s.style.setProperty('--gx', cell % 21);
    s.style.setProperty('--gy', Math.floor(cell / 21));
    s.setAttribute('aria-hidden', 'true');
    return s;
  }
  var SHEET_ROW = { art: 42, element: 63, quartz: 84 };
  // status icons, matched to their names with the game's Combat Notebook
  var STATUS_CELL = { Poison: 315, Petrify: 316, Burn: 317, Freeze: 318, Sleep: 319, Seal: 320, Mute: 321, Confuse: 322, Blind: 323, Delay: 324, 'Stat Debuff': 325, Deathblow: 326 };
  // the mark in front of an element, Art or quartz name: the game's icon, or a drawn orb
  function mark(element, kind, cls) {
    var a = art(), i = ELS.indexOf(element);
    if (a && a.icons && i !== -1) return sheet(SHEET_ROW[kind] + i, cls);
    return el('span', 'dot el-' + element + (kind === 'quartz' ? ' dot-orb' : '') + (cls ? ' ' + cls : ''));
  }
  function itemIcon(cell, cls) {
    var a = art();
    return a && a.icons && cell != null ? sheet(cell, cls) : null;
  }
  function statusIcon(name) { return itemIcon(STATUS_CELL[name]); }

  // The round badge that opens every title banner: a gear, a red seal, and a menu icon on it.
  // The icon is the game's when its art is there (cell = its place in assets/ui/menu.png),
  // otherwise a drawn one (symbol = an <svg> symbol in index.html).
  var NS = 'http://www.w3.org/2000/svg';
  function medal(symbol, cell, cls) {
    var m = el('span', 'medal' + (cls ? ' ' + cls : ''));
    m.setAttribute('aria-hidden', 'true');
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'mi-svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    var use = document.createElementNS(NS, 'use');
    use.setAttribute('href', '#i-' + symbol);
    svg.appendChild(use);
    var i = el('i', 'mi');
    i.style.setProperty('--i', cell);
    return add(m, svg, i);
  }
  // A title banner, as at the top of each in-game menu: "Orbment-Quartz".
  function banner(badge, small, big, tag) {
    var h = el('header', 'banner');
    var bar = el('div', 'banner-bar');
    var t = el(tag || 'h2', 'gold');
    if (small) t.appendChild(el('span', 't-sm', small + '-'));
    t.appendChild(document.createTextNode(big));
    bar.appendChild(t);
    add(h, badge, bar);
    return { node: h, bar: bar, title: t };
  }
  // The dark header strip of a list window: "Quartz ......... Unequipped/Total".
  function pillHead(left, right, tag) {
    var h = el(tag || 'h4', 'pill-head');
    var l = el('span');
    if (typeof left === 'string') l.textContent = left; else l.appendChild(left);
    h.appendChild(l);
    if (right != null) h.appendChild(typeof right === 'string' ? el('span', '', right) : right);
    return h;
  }
  function lvBadge(level) {
    var b = el('span', 'lv');
    b.title = 'Level ' + level;
    add(b, el('small', '', 'Lv'), el('b', '', String(level)));
    return b;
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
    if (hasArt('faces', id)) {
      var img = el('img');
      img.src = 'assets/face/' + id + '.png';
      img.alt = '';
      a.textContent = '';
      a.classList.add('has-face');
      a.appendChild(img);
    }
    if (labelled) { a.title = name; a.setAttribute('role', 'img'); a.setAttribute('aria-label', name); }
    else a.setAttribute('aria-hidden', 'true');
    return a;
  }

  // ---- help window ----
  // Hover, focus or tap anything given a tip and a window says what it is, in the manner of the
  // help bar at the bottom of the game's menus.
  var tipBox = byId('tip');
  var tipFor = null;
  function tip(node, build, focusable) {
    node._tip = build;
    node.classList.add('has-tip');
    if (focusable) node.tabIndex = 0;
    return node;
  }
  function tipTarget(n) {
    while (n && n !== document) { if (n._tip) return n; n = n.parentNode; }
    return null;
  }
  function placeTip() {
    if (!tipFor) return;
    if (!document.body.contains(tipFor)) { hideTip(); return; }
    var r = tipFor.getBoundingClientRect();
    var anchor = tipFor.querySelector('.orb') || tipFor;
    var a = anchor.getBoundingClientRect();
    var w = tipBox.offsetWidth, h = tipBox.offsetHeight, vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var left = Math.max(8, Math.min(vw - w - 8, a.left + a.width / 2 - w / 2));
    var top = a.top - h - 10;
    var below = top < 8;
    if (below) top = Math.min(vh - h - 8, r.bottom + 10);
    tipBox.style.left = Math.round(left) + 'px';
    tipBox.style.top = Math.round(Math.max(8, top)) + 'px';
    tipBox.classList.toggle('is-below', below);
    tipBox.style.setProperty('--arrow', Math.round(Math.max(18, Math.min(w - 18, a.left + a.width / 2 - left))) + 'px');
  }
  function showTip(node) {
    var body = node._tip();
    if (!body) { hideTip(); return; }
    tipFor = node;
    tipBox.textContent = '';
    tipBox.appendChild(body);
    tipBox.hidden = false;
    placeTip();
  }
  function hideTip() { tipFor = null; tipBox.hidden = true; }
  document.addEventListener('mouseover', function (e) {
    var n = tipTarget(e.target);
    if (n) { if (n !== tipFor) showTip(n); } else if (tipFor) hideTip();
  });
  document.addEventListener('touchstart', function (e) {
    var n = tipTarget(e.target);
    if (n) { if (n !== tipFor) showTip(n); } else if (tipFor) hideTip();
  }, { passive: true });
  document.addEventListener('focusin', function (e) { var n = tipTarget(e.target); if (n) showTip(n); });
  document.addEventListener('focusout', function () { hideTip(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });
  window.addEventListener('scroll', placeTip, { passive: true });
  window.addEventListener('resize', hideTip);

  function valueText(v) {
    return ELS.map(function (e, i) { return v[i] ? EL_NAME[e] + ' ' + v[i] : ''; }).filter(Boolean).join(' · ');
  }
  function resistText(res) {
    return Object.keys(res || {}).map(function (s) { return (s === 'Status Ailments' ? 'all status ailments' : s) + ' ' + res[s] + '%'; }).join(', ');
  }
  // where your copies of a quartz or accessory are
  function ownedText(name, kind) {
    if (!live) return '';
    var on = [], bag = 0;
    Object.keys(live.characters).forEach(function (id) {
      var lc = live.characters[id];
      if (kind === 'quartz') ORDER.forEach(function (k) { if (lc.slots[k] === name) on.push(lc.name); });
      else lc.accessories.forEach(function (a) { if (a === name) on.push(lc.name); });
    });
    live.bag[kind === 'quartz' ? 'quartz' : 'accessories'].forEach(function (x) { if (x.name === name) bag = x.count; });
    var bits = [];
    if (on.length) bits.push((kind === 'quartz' ? 'slotted on ' : 'worn by ') + on.join(', '));
    if (bag) bits.push(bag + ' spare in your bag');
    return bits.length ? 'Yours: ' + bits.join(' · ') : 'You do not have one yet.';
  }
  function tipFrame(icon, name, sub) {
    var box = el('div', 'tip-in');
    var head = el('p', 'tip-name');
    add(head, icon, el('strong', '', name));
    if (sub) head.appendChild(el('span', 'tip-sub', sub));
    box.appendChild(head);
    return box;
  }
  function tipLine(box, cls, text) { if (text) box.appendChild(el('p', cls, text)); return box; }

  // ctx (all optional): { pos, lock, has, later, missing }
  function tipQuartz(name, ctx) {
    ctx = ctx || {};
    if (!name) {
      var empty = tipFrame(null, (ctx.pos ? ctx.pos + ' slot' : 'Slot') + ': empty');
      return tipLine(empty, 'tip-meta', ctx.lock ? 'Only takes ' + EL_NAME[ctx.lock] + ' quartz.' : 'Takes any quartz.');
    }
    var q = quartz(name);
    var box = tipFrame(mark(q.el, 'quartz'), name);
    var line = el('p', 'tip-line');
    line.appendChild(el('span', '', EL_NAME[q.el] + ' Element [Elemental Value:'));
    var any = false;
    ELS.forEach(function (e, i) {
      if (!q.v[i]) return;
      any = true;
      var one = el('span', 'tip-val');
      one.title = EL_NAME[e];
      add(one, mark(e, 'element'), document.createTextNode('×' + q.v[i]));
      if (!art()) one.appendChild(el('span', 'tip-el', ' ' + EL_NAME[e]));
      line.appendChild(one);
    });
    if (!any) line.appendChild(el('span', '', 'none'));
    line.lastChild.appendChild(document.createTextNode(']'));
    box.appendChild(line);
    tipLine(box, 'tip-fx', q.fx || 'No extra effect.');
    var res = resistText(q.res);
    if (res && q.fx.toLowerCase().indexOf('resist') === -1) tipLine(box, 'tip-fx', 'Resists ' + res);
    if (ctx.pos) {
      var slot = ctx.pos + ' slot' + (ctx.lock ? ' · only takes ' + EL_NAME[ctx.lock] : '');
      if (ctx.missing) slot += ' · you do not own this one yet';
      else if (ctx.change) slot += ' · currently holds ' + (ctx.has || 'nothing');
      tipLine(box, 'tip-meta', slot);
      if (ctx.later) tipLine(box, 'tip-meta', 'Upgrade to ' + ctx.later + ' when you have it.');
    }
    tipLine(box, 'tip-meta', ownedText(name, 'quartz'));
    var src = CH && CH.sources[name];
    if (src) tipLine(box, 'tip-meta', 'Find it: ' + src.where + (src.tag ? ' (' + src.tag + ')' : '') + (src.also ? ' · also ' + src.also : ''));
    return box;
  }
  function tipAccessory(name) {
    var g = G.accessories[name] || ['', {}];
    var box = tipFrame(itemIcon(g[2]), name, 'Accessory');
    tipLine(box, 'tip-fx', g[0]);
    var res = resistText(g[1]);
    if (res) tipLine(box, 'tip-fx', 'Resists ' + res);
    if (!g[0] && !res) tipLine(box, 'tip-meta', 'No stats on record.');
    return tipLine(box, 'tip-meta', ownedText(name, 'accessory'));
  }
  function tipArt(a, casters) {
    var box = tipFrame(mark(a.el, 'art'), a.name, 'EP ' + a.ep);
    tipLine(box, 'tip-fx', a.d);
    var need = ELS.map(function (e) { return a.req[e] ? EL_NAME[e] + ' ' + a.req[e] : ''; }).filter(Boolean).join(' + ');
    if (need) tipLine(box, 'tip-meta', 'Needs on one line: ' + need);
    if (casters) tipLine(box, 'tip-meta', 'Cast by ' + casters);
    return box;
  }
  function tipItem(name, text) {
    return tipLine(tipFrame(itemIcon(1), name), 'tip-fx', text || 'No description on record.');
  }
  function tipText(title, text) { return tipLine(tipFrame(null, title), 'tip-meta', text); }
  // a quartz or accessory name with its icon, and a tip
  function thing(name, tag, cls) {
    var isQ = !!G.quartz[name];
    var n = el(tag || 'span', (cls ? cls + ' ' : '') + 'thing');
    add(n, isQ ? mark(quartz(name).el, 'quartz') : itemIcon((G.accessories[name] || [])[2]), document.createTextNode(name));
    if (isQ) tip(n, function () { return tipQuartz(name); });
    else if (G.accessories[name]) tip(n, function () { return tipAccessory(name); });
    return n;
  }

  // ---- pieces ----
  function swapItem(it) {
    var li = el('li', 'row swap');
    add(li, el('span', 'pos', it.pos));
    var what = el('span', 'swap-what');
    if (it.from) add(what, it.from === 'empty' ? el('span', 'from', 'empty') : thing(it.from, 'span', 'from'), el('span', 'arrow', '▸'));
    what.appendChild(thing(it.to, 'strong', 'to'));
    li.appendChild(what);
    if (it.where) li.appendChild(el('span', 'where', it.where));
    return li;
  }

  // cells[k] = { name, ok, change, has, later, missing }
  function renderOrbment(lines, locks, cells) {
    var got = art();
    var wrap = el('div', 'orbment' + (got && got.dial ? ' has-dial' : ''));
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
      node.setAttribute('aria-label', POS_NAME[k] + ' slot: ' + (c.name || 'empty'));
      var orb = el('span', 'orb' + (q ? ' el-' + q.el : ' orb-empty'));
      if (q && got && got.icons) {
        orb.classList.add('orb-art');
        orb.style.setProperty('--gx', (SHEET_ROW.quartz + ELS.indexOf(q.el)) % 21);
        orb.style.setProperty('--gy', Math.floor((SHEET_ROW.quartz + ELS.indexOf(q.el)) / 21));
      }
      if (c.ok) orb.appendChild(el('span', 'check', '✓'));
      add(node, orb, el('span', 'q', c.name || 'empty'));
      if (lock) node.appendChild(el('span', 'sub lockname lock-' + lock, EL_NAME[lock] + ' only'));
      if (c.change) node.appendChild(el('span', 'sub had', 'has ' + (c.has || 'nothing')));
      if (c.later) node.appendChild(el('span', 'sub later', 'later: ' + c.later));
      tip(node, function () {
        return tipQuartz(c.name, { pos: POS_NAME[k], lock: lock, has: c.has, change: c.change, later: c.later, missing: c.missing });
      }, true);
      wrap.appendChild(node);
    });
    return wrap;
  }

  // The Value box of the orbment menu: one row per line, one column per element.
  function renderValues(lines, nameAt, caption) {
    var box = el('div', 'window values');
    var table = el('table', 'value-table');
    var hr = el('tr');
    hr.appendChild(el('th', 'value-cap', caption));
    ELS.forEach(function (e) {
      var th = el('th');
      add(th, mark(e, 'element'), el('span', 'el-abbr', EL_SHORT[e]));
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
    var res = resistText(g[1]);
    return (g[0] || '') + (g[0] && res ? ' · ' : '') + (res ? 'resists ' + res : '');
  }

  // The "Usable Arts / EP Cost" list of the orbment menu.
  function artRows(list, cls) {
    var ul = el('ul', 'rows rows-arts');
    list.forEach(function (a) {
      var li = el('li', 'row art-row el-' + a.el + (cls ? ' ' + cls : ''));
      add(li, mark(a.el, 'art'), el('span', 'art-n', a.name), el('span', 'ep', String(a.ep)));
      tip(li, function () { return tipArt(a); });
      ul.appendChild(li);
    });
    return ul;
  }

  function renderCharacter(id, m, isReserve) {
    var b = buildOf(id);
    var lc = live ? live.characters[id] : null;
    var alloc = m.alloc[id];
    var name = b ? b.name : lc.name;
    var lines = lc ? lc.lines : b.lines;
    var locks = lc ? lc.locks : b.locks;

    var card = el('article', 'screen char' + (isReserve ? ' is-reserve' : ''));
    card.id = 'char-' + id;
    var badge = el('span', 'medal medal-face');
    badge.appendChild(avatar(id, name));
    var head = banner(badge, 'Orbment', name, 'h3');
    head.node.classList.add('banner-char');
    var todo = alloc && alloc.todo ? alloc.todo : [];
    if (lc && alloc) head.bar.appendChild(el('span', 'state ' + (todo.length ? 'state-todo' : 'state-ok'), todo.length ? todo.length + ' to change' : '✓ matches your save'));
    if (lc && !alloc) head.bar.appendChild(el('span', 'state state-none', 'no build notes this chapter'));
    head.bar.appendChild(el('p', 'banner-sub', b ? b.role : 'Shown as slotted in your save.'));
    if (hasArt('eyes', id)) {
      var eyes = el('span', 'eyes');
      eyes.style.backgroundImage = 'url(assets/eyes/' + id + '.png)';
      eyes.setAttribute('aria-hidden', 'true');
      head.bar.appendChild(eyes);
      head.node.classList.add('has-eyes');
    }
    card.appendChild(head.node);

    var cells = {}, nameAt = {}, fullAt = {};
    ORDER.forEach(function (k) {
      if (!alloc) { cells[k] = { name: lc.slots[k] }; nameAt[k] = lc.slots[k]; fullAt[k] = lc.slots[k]; return; }
      var a = alloc[k], has = lc ? lc.slots[k] : null;
      nameAt[k] = a.name;
      fullAt[k] = b.slots[k].t;
      cells[k] = { name: a.name, later: a.later, missing: a.missing, ok: !!lc && has === a.name, change: !!lc && has !== a.name, has: has };
    });

    var body = el('div', 'char-body');
    var left = el('div', 'char-dial');
    if (lc) {
      var mini = el('div', 'mini-status');
      add(mini, lvBadge(lc.level));
      if (lc.now) add(mini, meter('HP', lc.now.hp, lc.hp, 'meter-hp'), meter('EP', lc.now.ep, lc.ep, 'meter-ep'));
      else add(mini, el('span', 'mini-num', 'HP ' + lc.hp), el('span', 'mini-num', 'EP ' + lc.ep));
      left.appendChild(mini);
    }
    left.appendChild(renderOrbment(lines, locks, cells));
    body.appendChild(left);
    var side = el('div', 'char-side');

    if (alloc) {
      var now = todo.filter(function (t) { return t.kind === 'slot'; });
      var later = [];
      ORDER.forEach(function (k) {
        if (!alloc[k].later) return;
        var src = CH.sources[alloc[k].later];
        later.push({ pos: POS_NAME[k], from: alloc[k].name, to: alloc[k].later, where: src ? src.where : '' });
      });
      var changes = el('div', 'window changes');
      if (lc && !now.length) changes.appendChild(el('p', 'allset', later.length ? '✓ Slotted correctly for what you own.' : '✓ Matches the build. This is the final layout for this chapter.'));
      if (!lc && !later.length) changes.appendChild(el('p', 'allset', 'This is the final layout for this chapter.'));
      var list = function (heading, cls, items) {
        if (!items.length) return;
        changes.appendChild(pillHead(heading, String(items.length)));
        var ul = el('ul', 'rows ' + cls);
        items.forEach(function (it) { ul.appendChild(swapItem(it)); });
        changes.appendChild(ul);
      };
      list(isReserve ? 'Differs from the build' : 'Swap now', 'rows-now', now);
      list('Upgrade when you have it', 'rows-later', later);
      side.appendChild(changes);
    }

    side.appendChild(renderValues(lines, nameAt, alloc ? 'Value' : 'Value'));

    var have = artsFor(lines, nameAt);
    var full = alloc ? artsFor(lines, fullAt) : have;
    var names = {};
    have.forEach(function (a) { names[a.name] = true; });
    var gain = full.filter(function (a) { return !names[a.name]; });
    var arts = el('div', 'window arts-window');
    arts.appendChild(pillHead('Usable Arts (' + have.length + ')', 'EP Cost'));
    if (have.length) arts.appendChild(artRows(have));
    else arts.appendChild(el('p', 'quiet', 'None with this layout.'));
    if (gain.length) {
      arts.appendChild(pillHead('Unlocked by the upgrades (' + gain.length + ')', 'EP Cost'));
      arts.appendChild(artRows(gain, 'art-later'));
    }
    side.appendChild(arts);

    if (b && b.accessories.length || lc) {
      var acc = el('div', 'window acc');
      acc.appendChild(pillHead('Accessories', lc ? 'Worn' : null));
      var ul = el('ul', 'rows');
      var want = b ? b.accessories : [];
      want.forEach(function (a) {
        var on = lc && lc.accessories.indexOf(a) !== -1;
        var li = el('li', 'row acc-row' + (lc ? (on ? ' is-on' : ' is-missing') : ''));
        add(li, thing(a, 'span', 'acc-n'), el('span', 'acc-fx', accessoryText(a)));
        if (lc) li.appendChild(el('span', 'acc-state', on ? '✓' : 'not worn'));
        ul.appendChild(li);
      });
      if (lc) lc.accessories.forEach(function (a) {
        if (!a || want.indexOf(a) !== -1) return;
        var li = el('li', 'row acc-row is-other');
        add(li, thing(a, 'span', 'acc-n'), el('span', 'acc-fx', accessoryText(a)), el('span', 'acc-state', want.length ? 'worn instead' : 'worn'));
        ul.appendChild(li);
      });
      if (!ul.children.length) ul.appendChild(el('li', 'row quiet', 'none'));
      acc.appendChild(ul);
      side.appendChild(acc);
    }
    body.appendChild(side);
    card.appendChild(body);

    if (b && b.notes.length) {
      var d = details('notes-' + id, 'Why, and things to know', 'memo');
      var nl = el('ul', 'notes');
      b.notes.forEach(function (n) { nl.appendChild(rich('li', '', n)); });
      d.appendChild(nl);
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
    var num = el('span', 'meter-num');
    add(num, el('b', '', String(now)), document.createTextNode(' / '), el('span', '', String(max)));
    var bar = el('div', 'meter-bar');
    var fill = el('span');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    return add(box, el('span', 'meter-label', label), num, bar);
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
      var box = el('article', 'st-card' + (bench ? ' is-bench' : ''));
      if (hasArt('bodies', id)) {
        var fig = el('img', 'st-art');
        fig.src = 'assets/body/' + id + '.png';
        fig.alt = '';
        fig.loading = 'lazy';
        box.appendChild(fig);
        box.classList.add('has-figure');
      }
      var main = el('div', 'st-main');
      var who = el('div', 'st-who');
      add(who, lvBadge(lc.level), avatar(id, lc.name), el('strong', 'st-name', lc.name), bench ? el('span', 'st-tag', 'Reserve') : null);
      var gear = el('ul', 'st-gear');
      var cells = lc.icons || {};
      [['Weapon', lc.weapon, cells.weapon], ['Armor', lc.armor, cells.armor], ['Footwear', lc.shoes, cells.shoes]].forEach(function (g) {
        var li = el('li', 'gear' + (g[1] ? '' : ' gear-none'));
        add(li, g[1] ? itemIcon(g[2]) : null, el('b', '', g[0]), document.createTextNode(g[1] || 'none'));
        gear.appendChild(li);
      });
      lc.accessories.forEach(function (a) {
        var li = el('li', 'gear' + (a ? '' : ' gear-none'));
        if (a) add(li, itemIcon((G.accessories[a] || [])[2]), el('b', '', 'Accessory'), document.createTextNode(a));
        else add(li, el('b', '', 'Accessory'), document.createTextNode('none'));
        if (a && G.accessories[a]) tip(li, function () { return tipAccessory(a); });
        gear.appendChild(li);
      });
      add(main, who, meter('HP', lc.now.hp, lc.hp, 'meter-hp'), meter('EP', lc.now.ep, lc.ep, 'meter-ep'), meter('CP', lc.now.cp, lc.now.cpMax, 'meter-cp'), gear);
      box.appendChild(main);
      host.appendChild(box);
      var low = [lc.now.hp < lc.hp * 0.9 ? 'HP' : '', lc.now.ep < lc.ep * 0.9 ? 'EP' : ''].filter(Boolean);
      if (!bench && low.length) short.push(lc.name + ' (' + low.join(', ') + ')');
    });
    var note = byId('status-note');
    note.className = 'helpbar ' + (short.length ? 'is-warn' : 'is-ok');
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
    var casters = function (a) { return list.filter(function (c) { return who[a.name][c.id]; }).map(function (c) { return c.name; }).join(', '); };
    var avatars = function (a) {
      var p = el('span', 'who');
      list.forEach(function (c) { if (who[a.name][c.id]) p.appendChild(avatar(c.id, c.name, 'avatar-xs', true)); });
      return p;
    };

    var support = G.arts.filter(function (a) { return who[a.name] && a.k === 's'; });
    if (!support.length) add(host, pillHead('Support Arts', null, 'h4'), el('p', 'quiet', 'None with the current layouts.'));
    else {
      var wrap = el('div', 'table-scroll');
      var t = el('table', 'list matrix arts-matrix');
      var hr = el('tr');
      add(hr, el('th', '', 'Support Arts'), el('th', 'num', 'EP'));
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
        add(th, mark(a.el, 'art'), el('strong', '', a.name), el('span', 'fx', a.d));
        add(tr, th, el('td', 'num', String(a.ep)));
        list.forEach(function (c) {
          var td = el('td', 'col-who');
          if (who[a.name][c.id]) td.appendChild(el('span', 'yes', '●'));
          else td.appendChild(el('span', 'no', '·'));
          tr.appendChild(td);
        });
        tip(tr, function () { return tipArt(a, casters(a)); });
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      wrap.appendChild(t);
      host.appendChild(wrap);
    }

    host.appendChild(pillHead('Attack Arts by element', 'EP · who', 'h4'));
    var grid = el('div', 'el-rows');
    ELS.forEach(function (e) {
      var arts = G.arts.filter(function (a) { return who[a.name] && a.k === 'a' && a.el === e; });
      var row = el('div', 'el-row el-' + e + (arts.length ? '' : ' is-none'));
      row.appendChild(add(el('span', 'el-tag'), mark(e, 'element'), document.createTextNode(EL_NAME[e])));
      var chips = el('div', 'chips');
      arts.forEach(function (a) {
        var chip = el('span', 'chip art-who');
        add(chip, el('span', 'art-n', a.name), el('span', 'ep', String(a.ep)), avatars(a));
        tip(chip, function () { return tipArt(a, casters(a)); });
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
    var t = el('table', 'list matrix guard-matrix' + (live ? '' : ' no-spare'));
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
      var label = s === 'Status Ailments' ? 'All status ailments' : s;
      tr.appendChild(add(el('th', 'st-name-cell'), statusIcon(s), document.createTextNode(label)));
      res.forEach(function (r, i) {
        var td = el('td', 'col-who');
        var x = r[s];
        var pill = el('span', 'res ' + (x ? (x.pct >= 100 ? 'res-full' : 'res-part') : 'res-none'), x ? x.pct + '%' : '–');
        tip(pill, function () {
          return tipText(list[i].name + ' · ' + label, x ? x.pct + '% from ' + x.from + (x.pct >= 100 ? ' (immune)' : '') : 'No protection.');
        });
        td.appendChild(pill);
        tr.appendChild(td);
      });
      if (live) {
        var td = el('td', 'col-spare');
        (spare[s] || []).sort(function (a, b) { return b.pct - a.pct; }).slice(0, 3).forEach(function (x) {
          var chip = el('span', 'chip chip-sm');
          add(chip, itemIcon((G.accessories[x.name] || [])[2]), document.createTextNode(x.name + ' ' + x.pct + '%' + (x.count > 1 ? ' ×' + x.count : '')));
          tip(chip, function () { return tipAccessory(x.name); });
          td.appendChild(chip);
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
      add(tr, thing(n, 'th', 'el-' + q.el), el('td', '', valueText(q.v)), el('td', '', q.fx || '—'),
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
      add(tr, thing(n, 'th'), el('td', '', g[0] || '—'), el('td', '', blocks || '—'), el('td', aw[n].length ? '' : 'quiet', aw[n].length ? aw[n].join(', ') : 'not owned'));
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
    var v = el('strong', 'tile-value');
    if (typeof value === 'string') v.textContent = value; else v.appendChild(value);
    add(t, el('span', 'tile-label', label), v);
    if (sub) t.appendChild(el('span', 'tile-sub', sub));
    return t;
  }

  // A page of the Bracer Notebook: the frame for everything that is prose rather than a list.
  function notebook(tabSmall, tabBig, title) {
    var n = el('section', 'note');
    var tab = el('span', 'note-tab');
    add(tab, el('small', '', tabSmall), document.createTextNode(tabBig));
    var page = el('div', 'note-page');
    if (title) page.appendChild(el('h2', 'note-h', title));
    add(n, tab, page);
    return { node: n, page: page };
  }
  function chapterLabel() { return live && live.chapter ? live.chapter.title.replace(/:.*$/, '') : (CH ? CH.title : ''); }

  function renderOverview(m) {
    var host = byId('overview');
    host.textContent = '';
    var nameOf = function (id) { var b = buildOf(id); return b ? b.name : (live && live.characters[id] ? live.characters[id].name : id); };
    var left = m.rows.filter(function (r) { return !r.done; }).length;
    var tiles = el('div', 'tiles');
    add(tiles,
      tile('Chapter', live && live.chapter ? live.chapter.title.replace(/:.*$/, '') : CH.title, live && live.chapter ? live.chapter.title.replace(/^[^:]*:\s*/, '') : CH.region),
      tile('Party', art() ? add.apply(null, [el('span', 'tile-faces')].concat(m.active.map(function (id) { return avatar(id, nameOf(id), 'avatar-sm', true); }))) : String(m.active.length),
        m.active.map(nameOf).join(' · ')),
      live ? tile('To change now', String(m.todo.length), m.todo.length ? 'slots and accessories' : 'everything matches', m.todo.length ? 'tile-warn' : 'tile-ok')
        : tile('Mode', 'Manual', 'this copy cannot see your save'),
      tile('Still to get', left + ' of ' + m.rows.length, left ? 'upgrades waiting' : 'all upgrades in place', left ? '' : 'tile-ok'));
    host.appendChild(tiles);

    var nb = notebook('Notes', chapterLabel(), 'This chapter');
    var card = nb.page;
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
    host.appendChild(nb.node);
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
    host.className = 'panel';
    byId('now-count').textContent = live ? (m.todo.length ? m.todo.length + (m.todo.length === 1 ? ' change' : ' changes') : 'all set') : '';
    if (!live) {
      host.appendChild(el('p', 'quiet', 'Tick what you own in the upgrade list below. The diagrams switch each slot to its upgrade as you tick, and show what to slot in the meantime.'));
      return;
    }
    if (!m.todo.length) {
      host.classList.add('is-done');
      add(host, el('span', 'stamp'), el('p', 'allset big', '✓ Everything matches the build for what you own.'),
        el('p', 'quiet', 'New steps appear here by themselves when you get a quartz from the list below, or when the party changes.'));
      return;
    }
    host.appendChild(el('p', 'quiet', m.todo.length + (m.todo.length === 1 ? ' change' : ' changes') + ' between your save and the build. Updates by itself after the game saves.'));
    var groups = {};
    m.todo.forEach(function (t) { (groups[t.id] = groups[t.id] || []).push(t); });
    var grid = el('div', 'todo-grid');
    m.active.forEach(function (id) {
      if (!groups[id]) return;
      var g = el('div', 'todo-group');
      var who = el('a', 'todo-who');
      who.href = '#char-' + id;
      add(who, avatar(id, groups[id][0].who, 'avatar-xs'), document.createTextNode(groups[id][0].who));
      var ul = el('ul', 'rows rows-now');
      groups[id].forEach(function (t) { ul.appendChild(swapItem(t)); });
      add(g, pillHead(who, String(groups[id].length), 'h3'), ul);
      grid.appendChild(g);
    });
    host.appendChild(grid);
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
        var have = el('span', 'have ' + (r.done ? 'have-ok' : (r.got ? 'have-part' : 'have-none')));
        add(have, el('b', '', String(r.got)), document.createTextNode('/ ' + r.wants.length));
        have.title = r.got + ' of ' + r.wants.length + ' in place';
        tdCheck.appendChild(have);
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
      tdName.appendChild(thing(r.name, 'strong'));
      if (q.fx) tdName.appendChild(el('span', 'fx', q.fx));
      var tdWhere = el('td', 'col-where', r.src ? r.src.where : '');
      if (r.src && r.src.tag) tdWhere.appendChild(el('span', 'tag', r.src.tag));
      if (r.src && r.src.also) tdWhere.appendChild(el('span', 'fx', 'also: ' + r.src.also));
      var tdTo = el('td', 'col-to');
      r.wants.forEach(function (w) {
        var line = el('span', 'goes' + (w.got ? ' goes-ok' : ''));
        add(line, art() ? avatar(w.id, w.who, 'avatar-xs') : null, el('strong', '', (w.got ? '✓ ' : '') + w.who), document.createTextNode(', ' + POS_NAME[w.slot].toLowerCase()));
        if (w.replaces && !w.got) line.appendChild(el('span', 'fx', 'replaces ' + w.replaces));
        tdTo.appendChild(line);
      });
      add(tr, tdCheck, tdName, tdWhere, tdTo);
      body.appendChild(tr);
    });
    var left = m.rows.filter(function (r) { return !r.done; }).length;
    byId('get-count').textContent = left ? left + ' of ' + m.rows.length + ' still to get' : 'all in place';
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
    var rows = function (hostId, list, describe) {
      var host = byId(hostId);
      host.textContent = '';
      if (!list.length) { host.appendChild(el('li', 'row quiet', 'none')); return; }
      list.forEach(function (x) {
        var d = describe(x.name);
        var li = el('li', 'row item-row' + (d.cls ? ' ' + d.cls : ''));
        add(li, d.icon, el('span', 'item-n', x.name), el('span', 'n', '×' + x.count));
        if (d.tip) tip(li, d.tip);
        host.appendChild(li);
      });
    };
    var supplies = live.bag.supplies || [];
    var kind = function (k) { return supplies.filter(function (x) { return x.kind === k; }); };
    var supply = function (name) { return { icon: itemIcon(1), tip: function () { return tipItem(name, G.supplies[name]); } }; };
    rows('bag-recovery', kind('Recovery'), supply);
    rows('bag-support', kind('Support'), supply);
    byId('bag-supplies').hidden = !supplies.length;
    rows('bag-quartz', live.bag.quartz, function (name) {
      var q = quartz(name);
      return { cls: 'el-' + q.el, icon: mark(q.el, 'quartz'), tip: function () { return tipQuartz(name); } };
    });
    rows('bag-accessories', live.bag.accessories, function (name) {
      return { icon: itemIcon((G.accessories[name] || [])[2]), tip: function () { return tipAccessory(name); } };
    });
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
      var nb = notebook(chapterLabel(), s.title.replace(/^Chapter notes$/, 'Notes'), s.title);
      nb.node.id = 'sec-' + s.id;
      if (s.spoiler) nb.node.classList.add('spoiler');
      var into = nb.page;
      if (s.spoiler) {
        var sum = el('span');
        add(sum, document.createTextNode('Show ' + s.title.toLowerCase() + ' '), el('span', 'tag tag-warn', s.spoiler));
        into = details('sec-' + chapterN + '-' + s.id, sum);
        nb.page.appendChild(into);
      }
      s.blocks.forEach(function (b, i) { into.appendChild(block(b, 'blk-' + chapterN + '-' + s.id + '-' + i)); });
      host.appendChild(nb.node);
    });
  }

  function renderNav(m) {
    var nav = byId('jump');
    nav.textContent = '';
    var link = function (href, text, node) {
      var a = el('a', node ? 'jump-who' : 'tab', node ? null : text);
      a.href = href;
      if (node) { a.appendChild(node); a.title = text; a.setAttribute('aria-label', text); }
      nav.appendChild(a);
      return a;
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
      if (target && !target.hidden && target.getBoundingClientRect().top < 150) current = links[i];
    }
    if (!current && links.length) current = links[0];
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && links.length) current = links[links.length - 1];
    for (var j = 0; j < links.length; j++) links[j].classList.toggle('is-current', links[j] === current);
    if (current && nav.scrollWidth > nav.clientWidth) {
      var left = current.offsetLeft - nav.offsetLeft;
      if (left < nav.scrollLeft + 52 || left + current.offsetWidth > nav.scrollLeft + nav.clientWidth - 52) {
        nav.scrollLeft = left - (nav.clientWidth - current.offsetWidth) / 2;
      }
    }
    navEdges();
  }
  // When the tabs do not all fit, the strip scrolls: show which way there is more.
  function navEdges() {
    var nav = byId('jump');
    var max = nav.scrollWidth - nav.clientWidth;
    nav.parentNode.classList.toggle('can-left', max > 2 && nav.scrollLeft > 2);
    nav.parentNode.classList.toggle('can-right', max > 2 && nav.scrollLeft < max - 2);
  }
  (function () {
    var nav = byId('jump');
    nav.addEventListener('scroll', navEdges, { passive: true });
    var step = function (dir) { nav.scrollLeft += dir * Math.max(160, nav.clientWidth * 0.6); };
    byId('jump-prev').addEventListener('click', function () { step(-1); });
    byId('jump-next').addEventListener('click', function () { step(1); });
    // a mouse wheel over the strip moves it sideways
    nav.addEventListener('wheel', function (e) {
      if (nav.scrollWidth <= nav.clientWidth + 2 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      var before = nav.scrollLeft;
      nav.style.scrollBehavior = 'auto';
      nav.scrollLeft += e.deltaY;
      nav.style.scrollBehavior = '';
      if (nav.scrollLeft !== before) e.preventDefault();
    }, { passive: false });
  })();
  window.addEventListener('scroll', function () {
    if (!spyQueued) { spyQueued = true; window.requestAnimationFrame(spy); }
  }, { passive: true });
  window.addEventListener('resize', function () {
    if (!spyQueued) { spyQueued = true; window.requestAnimationFrame(spy); }
  });

  function render() {
    hideTip();
    renderMast();
    var app = byId('app');
    var a = art();
    document.body.classList.toggle('has-art', !!a);
    document.body.classList.toggle('has-ui', !!(a && a.ui));
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
