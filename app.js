(function () {
  'use strict';

  var B = window.BUILD;
  var ELS = ['earth', 'water', 'fire', 'wind', 'time', 'space', 'mirage'];
  var EL_SHORT = { earth: 'Ea', water: 'Wa', fire: 'Fi', wind: 'Wi', time: 'Ti', space: 'Sp', mirage: 'Mi' };
  var EL_NAME = { earth: 'Earth', water: 'Water', fire: 'Fire', wind: 'Wind', time: 'Time', space: 'Space', mirage: 'Mirage' };
  var ORDER = ['t', 'ul', 'ur', 'c', 'll', 'lr', 'b'];
  var POS = { t: [50, 8], ul: [17, 28], ur: [83, 28], c: [50, 46], ll: [17, 64], lr: [83, 64], b: [50, 82] };
  var POS_NAME = { c: 'Center', t: 'Top', ur: 'Upper-right', lr: 'Lower-right', b: 'Bottom', ll: 'Lower-left', ul: 'Upper-left' };
  var KEY = 'sky2-build-state';

  // ---- manual state, used when the page is not served by the local live server ----
  var state = { found: {}, applied: false };
  B.uniques.forEach(function (u) { state.found[u.key] = !!u.found; });
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && saved.version === B.version) {
      Object.keys(saved.found || {}).forEach(function (k) {
        if (k in state.found) state.found[k] = !!saved.found[k];
      });
      state.applied = !!saved.applied;
    }
  } catch (e) { /* storage unavailable: page still works */ }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: B.version, found: state.found, applied: state.applied }));
    } catch (e) { /* ignore */ }
  }

  // ---- live state, pushed by server.js whenever the game writes a save ----
  var live = null;
  var liveOnline = false;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function uniqueByKey(key) {
    return B.uniques.filter(function (u) { return u.key === key; })[0];
  }

  function bagCount(name, kind) {
    if (!live) return 0;
    var hit = live.bag[kind || 'quartz'].filter(function (x) { return x.name === name; })[0];
    return hit ? hit.count : 0;
  }

  // Who has this quartz slotted: [{ id, name, slot }]
  function holders(name) {
    var out = [];
    if (!live) return out;
    Object.keys(live.characters).forEach(function (id) {
      var c = live.characters[id];
      ORDER.forEach(function (k) { if (c.slots[k] === name) out.push({ id: id, name: c.name, slot: k }); });
    });
    return out;
  }

  function isFound(key) {
    if (!live) return state.found[key];
    var name = uniqueByKey(key).name;
    return bagCount(name) > 0 || holders(name).length > 0;
  }

  // What should sit in a slot right now, given which one-copy quartz are owned.
  function resolve(slot) {
    if (slot.needs && !isFound(slot.needs)) return { name: slot.until, later: slot.target };
    return { name: slot.target, later: null };
  }

  function buildChar(id) {
    return B.characters.filter(function (c) { return c.id === id; })[0];
  }

  function liveChar(ch) {
    return live && live.characters[ch.id] ? live.characters[ch.id] : null;
  }

  // Where to get a quartz that is wanted in `ch` but not slotted there yet.
  function sourceHint(name, ch) {
    if (bagCount(name) > 0) return 'in your bag';
    var others = holders(name).filter(function (h) {
      if (h.id === ch.id) return false;
      var b = buildChar(h.id);
      // free to take if that character is benched, or should not have it in that slot
      return !b || resolve(b.slots[h.slot]).name !== name;
    });
    if (others.length) return 'take it from ' + others[0].name;
    var own = holders(name).filter(function (h) { return h.id === ch.id && resolve(ch.slots[h.slot]).name !== name; });
    if (own.length) return 'move it from the ' + POS_NAME[own[0].slot].toLowerCase() + ' slot';
    return 'none spare — synthesize or buy one';
  }

  function accessorySource(name, ch) {
    if (bagCount(name, 'accessories') > 0) return 'in your bag';
    var who = null;
    Object.keys(live.characters).forEach(function (id) {
      if (id !== ch.id && !buildChar(id) && live.characters[id].accessories.indexOf(name) !== -1) who = live.characters[id].name;
    });
    return who ? 'take it from ' + who : 'none spare';
  }

  // Everything that differs between the save and the build for one character.
  function todoFor(ch) {
    var lc = liveChar(ch);
    var out = [];
    if (!lc) return out;
    ORDER.forEach(function (k) {
      var want = resolve(ch.slots[k]).name;
      var has = lc.slots[k];
      if (has !== want) out.push({ kind: 'slot', pos: POS_NAME[k], from: has || 'empty', to: want, where: sourceHint(want, ch) });
    });
    ch.accessories.forEach(function (a) {
      if (lc.accessories.indexOf(a) === -1) {
        out.push({ kind: 'acc', pos: 'Accessory', from: null, to: a, where: accessorySource(a, ch) });
      }
    });
    return out;
  }

  function lineValues(ch, line) {
    var sum = {};
    ELS.forEach(function (e) { sum[e] = 0; });
    line.forEach(function (k) {
      var q = B.quartz[resolve(ch.slots[k]).name];
      Object.keys(q.v).forEach(function (e) { sum[e] += q.v[e]; });
    });
    return sum;
  }

  function lineOf(ch, key) {
    for (var i = 0; i < ch.lines.length; i++) {
      if (key !== 'c' && ch.lines[i].indexOf(key) !== -1) return i + 1;
    }
    return 0;
  }

  // ---- checklist ----
  function renderChecklist() {
    var body = document.getElementById('unique-rows');
    body.textContent = '';
    B.uniques.forEach(function (u) {
      var have = isFound(u.key);
      var tr = el('tr', have ? 'is-found' : '');
      var tdCheck = el('td', 'col-check');
      var label = el('label', 'tick');
      var box = el('input');
      box.type = 'checkbox';
      box.checked = have;
      box.disabled = !!live;
      box.setAttribute('aria-label', 'I have ' + u.name);
      box.addEventListener('change', function () {
        state.found[u.key] = box.checked;
        save();
        renderAll();
      });
      label.appendChild(box);
      tdCheck.appendChild(label);

      var tdName = el('td', 'col-name');
      tdName.appendChild(el('span', 'dot el-' + B.quartz[u.name].el));
      tdName.appendChild(el('strong', '', u.name));
      tdName.appendChild(el('span', 'fx', B.quartz[u.name].fx));

      var tdWhere = el('td', '', u.where);
      if (u.chest) tdWhere.appendChild(el('span', 'tag', u.chest));

      var tdTo = el('td');
      tdTo.appendChild(el('strong', '', u.to));
      tdTo.appendChild(document.createTextNode(', ' + u.slot));
      tdTo.appendChild(el('span', 'fx', 'replaces ' + u.replaces));

      tr.appendChild(tdCheck); tr.appendChild(tdName); tr.appendChild(tdWhere); tr.appendChild(tdTo);
      body.appendChild(tr);
    });
    document.getElementById('find-hint').textContent = live
      ? 'One copy of each this chapter. Ticked automatically from your save.'
      : 'One copy of each this chapter. Tick what you have and the diagrams below update. Ticks are saved on this device.';
  }

  // ---- character cards ----
  function renderOrbment(ch) {
    var lc = liveChar(ch);
    var wrap = el('div', 'orbment');
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    ORDER.forEach(function (k) {
      if (k === 'c') return;
      var ln = document.createElementNS(svgNS, 'line');
      ln.setAttribute('x1', POS.c[0]); ln.setAttribute('y1', POS.c[1]);
      ln.setAttribute('x2', POS[k][0]); ln.setAttribute('y2', POS[k][1]);
      ln.setAttribute('class', 'spoke line-' + lineOf(ch, k));
      ln.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(ln);
    });
    wrap.appendChild(svg);

    ORDER.forEach(function (k) {
      var slot = ch.slots[k];
      var r = resolve(slot);
      var q = B.quartz[r.name];
      var has = lc ? lc.slots[k] : null;
      var ok = lc && has === r.name;
      var changed = lc ? !ok : (!state.applied && slot.shot && slot.shot !== r.name);
      var node = el('div', 'slot' + (changed ? ' is-change' : '') + (ok ? ' is-ok' : '') + (r.later ? ' is-pending' : ''));
      node.style.left = POS[k][0] + '%';
      node.style.top = POS[k][1] + '%';
      node.title = POS_NAME[k] + ': ' + r.name + ' — ' + q.fx;

      var orb = el('span', 'orb el-' + q.el + (slot.lock ? ' lock lock-' + slot.lock : ''));
      if (ok) orb.appendChild(el('span', 'check', '✓'));
      node.appendChild(orb);
      node.appendChild(el('span', 'q', r.name));
      if (slot.lock) node.appendChild(el('span', 'sub lockname el-text-' + slot.lock, EL_NAME[slot.lock] + ' only'));
      if (changed) node.appendChild(el('span', 'sub had', lc ? 'has ' + (has || 'nothing') : 'was ' + slot.shot));
      if (r.later) node.appendChild(el('span', 'sub later', 'later: ' + r.later));
      wrap.appendChild(node);
    });
    return wrap;
  }

  function renderValues(ch) {
    var box = el('div', 'values');
    var table = el('table', 'value-table');
    table.appendChild(el('caption', '', 'In-game Value box should read'));
    var thead = el('thead');
    var hr = el('tr');
    hr.appendChild(el('th', '', ''));
    ELS.forEach(function (e) {
      var th = el('th');
      th.appendChild(el('span', 'dot el-' + e));
      th.appendChild(el('span', 'el-abbr', EL_SHORT[e]));
      th.title = EL_NAME[e];
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tb = el('tbody');
    ch.lines.forEach(function (line, i) {
      var tr = el('tr');
      var th = el('th', 'line-label');
      th.appendChild(el('span', 'swatch line-bg-' + (i + 1)));
      th.appendChild(document.createTextNode('Line ' + (i + 1)));
      tr.appendChild(th);
      var v = lineValues(ch, line);
      ELS.forEach(function (e) { tr.appendChild(el('td', v[e] ? '' : 'zero', String(v[e]))); });
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    box.appendChild(table);
    return box;
  }

  function swapItem(it, withWhere) {
    var li = el('li');
    li.appendChild(el('span', 'pos', it.pos));
    if (it.from) {
      li.appendChild(el('span', 'from', it.from));
      li.appendChild(el('span', 'arrow', '→'));
    }
    li.appendChild(el('strong', 'to', it.to));
    if (withWhere && it.where) li.appendChild(el('span', 'where', it.where));
    return li;
  }

  function renderChanges(ch) {
    var lc = liveChar(ch);
    var now = [], later = [];
    if (lc) {
      now = todoFor(ch).filter(function (t) { return t.kind === 'slot'; });
    }
    ORDER.forEach(function (k) {
      var slot = ch.slots[k];
      var r = resolve(slot);
      if (!lc && !state.applied && slot.shot && slot.shot !== r.name) {
        now.push({ pos: POS_NAME[k], from: slot.shot, to: r.name });
      }
      if (r.later) {
        var u = uniqueByKey(slot.needs);
        later.push({ pos: POS_NAME[k], from: r.name, to: r.later, where: u ? u.where : '' });
      }
    });
    var box = el('div', 'changes');
    if (!now.length && !later.length) {
      box.appendChild(el('p', 'allset', lc ? '✓ Matches the build. This is the final layout.' : 'Nothing to change. This is the final layout.'));
      return box;
    }
    function list(title, cls, items) {
      if (!items.length) return;
      box.appendChild(el('h4', cls, title));
      var ul = el('ul', 'swap-list');
      items.forEach(function (it) { ul.appendChild(swapItem(it, true)); });
      box.appendChild(ul);
    }
    if (lc && !now.length) box.appendChild(el('p', 'allset', '✓ Slotted correctly for what you own.'));
    list('Swap now', 'h-now', now);
    list('Swap when found', 'h-later', later);
    return box;
  }

  function renderAccessories(ch) {
    var lc = liveChar(ch);
    var acc = el('p', 'acc');
    acc.appendChild(el('span', 'acc-label', 'Accessories'));
    var missing = false;
    ch.accessories.forEach(function (a) {
      var on = lc && lc.accessories.indexOf(a) !== -1;
      if (lc && !on) missing = true;
      acc.appendChild(el('span', 'chip' + (lc ? (on ? ' chip-ok' : ' chip-missing') : ''), (on ? '✓ ' : '') + a));
    });
    if (missing) {
      acc.appendChild(el('span', 'acc-wearing', 'wearing ' + lc.accessories.map(function (x) { return x || 'nothing'; }).join(' + ')));
    }
    return acc;
  }

  function renderCharacter(ch) {
    var lc = liveChar(ch);
    var card = el('article', 'card char');
    card.id = ch.id;
    var head = el('header', 'char-head');
    var title = el('div', 'char-title');
    title.appendChild(el('h3', '', ch.name));
    if (lc) {
      var n = todoFor(ch).length;
      title.appendChild(el('span', 'status ' + (n ? 'status-todo' : 'status-ok'), n ? n + ' to change' : '✓ matches your save'));
    }
    head.appendChild(title);
    head.appendChild(el('p', 'role', ch.role));
    card.appendChild(head);

    var top = el('div', 'char-body');
    top.appendChild(renderOrbment(ch));
    var side = el('div', 'char-side');
    side.appendChild(renderChanges(ch));
    side.appendChild(renderValues(ch));
    side.appendChild(renderAccessories(ch));
    top.appendChild(side);
    card.appendChild(top);

    if (ch.arts.length) {
      var d1 = el('details');
      d1.appendChild(el('summary', '', 'Arts this layout gives'));
      var dl = el('dl', 'arts');
      ch.arts.forEach(function (a) {
        dl.appendChild(el('dt', '', a.label));
        dl.appendChild(el('dd', '', a.list));
      });
      d1.appendChild(dl);
      card.appendChild(d1);
    }
    var d2 = el('details');
    d2.appendChild(el('summary', '', 'Why, and things to know'));
    var ul = el('ul', 'notes');
    ch.notes.forEach(function (n) { ul.appendChild(el('li', '', n)); });
    d2.appendChild(ul);
    card.appendChild(d2);
    return card;
  }

  function renderCharacters() {
    var host = document.getElementById('characters');
    // keep open/closed state of the details across re-renders
    var open = {};
    host.querySelectorAll('article').forEach(function (a) {
      open[a.id] = Array.prototype.map.call(a.querySelectorAll('details'), function (d) { return d.open; });
    });
    host.textContent = '';
    B.characters.forEach(function (ch) {
      var card = renderCharacter(ch);
      (open[ch.id] || []).forEach(function (isOpen, i) {
        var d = card.querySelectorAll('details')[i];
        if (d) d.open = isOpen;
      });
      host.appendChild(card);
    });
  }

  // ---- "Do now" ----
  function renderDoNow() {
    var manual = document.getElementById('do-now');
    var auto = document.getElementById('do-now-live');
    var btn = document.getElementById('applied-toggle');
    if (!live) {
      auto.hidden = true; manual.hidden = false; btn.hidden = false;
      manual.classList.toggle('is-done', state.applied);
      btn.textContent = state.applied ? 'Show these steps again' : 'I have done these';
      btn.setAttribute('aria-pressed', state.applied ? 'true' : 'false');
      return;
    }
    manual.hidden = true; btn.hidden = true; auto.hidden = false;
    auto.textContent = '';
    var total = 0;
    var ul = el('ul', 'swap-list todo-list');
    B.characters.forEach(function (ch) {
      todoFor(ch).forEach(function (t) {
        total++;
        var li = swapItem({ pos: ch.name + ' · ' + t.pos, from: t.from, to: t.to, where: t.where }, true);
        ul.appendChild(li);
      });
    });
    if (!total) {
      auto.appendChild(el('p', 'allset big', '✓ Everything matches the build for what you own.'));
      auto.appendChild(el('p', 'quiet', 'New steps appear here by themselves when you find one of the quartz below.'));
    } else {
      auto.appendChild(el('p', 'quiet', total + (total === 1 ? ' change' : ' changes') + ' between your save and the build. This list updates by itself after the game saves.'));
      auto.appendChild(ul);
    }
  }

  // ---- bag ----
  function renderBag() {
    var card = document.getElementById('bag');
    card.hidden = !live;
    if (!live) return;
    var chips = function (hostId, list) {
      var host = document.getElementById(hostId);
      host.textContent = '';
      if (!list.length) { host.appendChild(el('span', 'quiet', 'none')); return; }
      list.forEach(function (x) { host.appendChild(el('span', 'chip', x.name + (x.count > 1 ? ' ×' + x.count : ''))); });
    };
    chips('bag-quartz', live.bag.quartz);
    chips('bag-accessories', live.bag.accessories);
    document.getElementById('bag-umat').textContent = String(live.bag.uMaterial);
  }

  // ---- live bar ----
  function ago(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'just now';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    return Math.round(m / 60) + ' h ago';
  }

  function renderLiveBar() {
    var bar = document.getElementById('live-bar');
    bar.hidden = !live;
    if (!live) return;
    var t = new Date(live.save.written);
    bar.classList.toggle('is-off', !liveOnline);
    document.getElementById('live-text').textContent = liveOnline
      ? 'Live from your save · game last saved ' + t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + ago(t.getTime()) + ')'
      : 'Live sync paused — the local server is not answering. Showing the last save it read.';
  }

  function renderAll() {
    renderChecklist();
    renderCharacters();
    renderDoNow();
    renderBag();
    renderLiveBar();
    var left = B.uniques.filter(function (u) { return !isFound(u.key); }).length;
    document.getElementById('unique-count').textContent =
      left ? left + ' of ' + B.uniques.length + ' still to find' : 'All found';
  }

  document.getElementById('applied-toggle').addEventListener('click', function () {
    state.applied = !state.applied;
    save();
    renderAll();
  });

  document.getElementById('meta-version').textContent = B.version;
  document.getElementById('meta-updated').textContent = B.updated;
  document.getElementById('meta-chapter').textContent = B.chapter;
  renderAll();

  // ---- connect to the local server if this page is being served by it ----
  // On GitHub Pages this request fails once and the page stays in manual mode.
  function connect() {
    if (!window.EventSource || !/^https?:$/.test(location.protocol)) return;
    fetch('api/state', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.characters) return;
        live = data; liveOnline = true;
        renderAll();
        var es = new EventSource('api/events');
        es.onmessage = function (ev) {
          try { live = JSON.parse(ev.data); liveOnline = true; renderAll(); } catch (e) { /* ignore a bad frame */ }
        };
        es.onopen = function () { liveOnline = true; renderLiveBar(); };
        es.onerror = function () { liveOnline = false; renderLiveBar(); };
        setInterval(renderLiveBar, 30000); // only refreshes the "x min ago" text
      })
      .catch(function () { /* no local server: manual mode */ });
  }
  connect();
})();
