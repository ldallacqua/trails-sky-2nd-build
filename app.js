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

  // ---- state (ticks are remembered on this device only) ----
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

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function uniqueByKey(key) {
    return B.uniques.filter(function (u) { return u.key === key; })[0];
  }

  // What sits in a slot right now, given which one-copy quartz are owned.
  function resolve(slot) {
    if (slot.needs && !state.found[slot.needs]) return { name: slot.until, later: slot.target };
    return { name: slot.target, later: null };
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
      var tr = el('tr', state.found[u.key] ? 'is-found' : '');
      var tdCheck = el('td', 'col-check');
      var label = el('label', 'tick');
      var box = el('input');
      box.type = 'checkbox';
      box.checked = state.found[u.key];
      box.setAttribute('aria-label', 'I have ' + u.name);
      box.addEventListener('change', function () {
        state.found[u.key] = box.checked;
        save();
        renderAll();
      });
      label.appendChild(box);
      tdCheck.appendChild(label);

      var tdName = el('td', 'col-name');
      var dot = el('span', 'dot el-' + B.quartz[u.name].el);
      tdName.appendChild(dot);
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
  }

  // ---- character cards ----
  function renderOrbment(ch) {
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
      var changed = !state.applied && slot.shot && slot.shot !== r.name;
      var node = el('div', 'slot' + (changed ? ' is-change' : '') + (r.later ? ' is-pending' : ''));
      node.style.left = POS[k][0] + '%';
      node.style.top = POS[k][1] + '%';
      node.title = POS_NAME[k] + ': ' + r.name + ' — ' + q.fx;

      var orb = el('span', 'orb el-' + q.el + (slot.lock ? ' lock lock-' + slot.lock : ''));
      node.appendChild(orb);
      node.appendChild(el('span', 'q', r.name));
      if (slot.lock) node.appendChild(el('span', 'sub lockname el-text-' + slot.lock, EL_NAME[slot.lock] + ' only'));
      if (changed) node.appendChild(el('span', 'sub had', 'was ' + slot.shot));
      if (r.later) node.appendChild(el('span', 'sub later', 'later: ' + r.later));
      wrap.appendChild(node);
    });
    return wrap;
  }

  function renderValues(ch) {
    var box = el('div', 'values');
    var table = el('table', 'value-table');
    var cap = el('caption', '', 'In-game Value box should read');
    table.appendChild(cap);
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

  function renderChanges(ch) {
    var now = [], later = [];
    ORDER.forEach(function (k) {
      var slot = ch.slots[k];
      var r = resolve(slot);
      if (!state.applied && slot.shot && slot.shot !== r.name) {
        now.push({ pos: POS_NAME[k], from: slot.shot, to: r.name });
      }
      if (r.later) {
        var u = uniqueByKey(slot.needs);
        later.push({ pos: POS_NAME[k], from: r.name, to: r.later, where: u ? u.where : '' });
      }
    });
    var box = el('div', 'changes');
    if (!now.length && !later.length) {
      box.appendChild(el('p', 'allset', 'Nothing to change. This is the final layout.'));
      return box;
    }
    function list(title, cls, items, withWhere) {
      if (!items.length) return;
      box.appendChild(el('h4', cls, title));
      var ul = el('ul', 'swap-list');
      items.forEach(function (it) {
        var li = el('li');
        li.appendChild(el('span', 'pos', it.pos));
        li.appendChild(el('span', 'from', it.from));
        li.appendChild(el('span', 'arrow', '→'));
        li.appendChild(el('strong', 'to', it.to));
        if (withWhere && it.where) li.appendChild(el('span', 'where', it.where));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    list('Swap now', 'h-now', now, false);
    list('Swap when found', 'h-later', later, true);
    return box;
  }

  function renderCharacter(ch) {
    var card = el('article', 'card char');
    card.id = ch.id;
    var head = el('header', 'char-head');
    head.appendChild(el('h3', '', ch.name));
    head.appendChild(el('p', 'role', ch.role));
    card.appendChild(head);

    var top = el('div', 'char-body');
    top.appendChild(renderOrbment(ch));
    var side = el('div', 'char-side');
    side.appendChild(renderChanges(ch));
    side.appendChild(renderValues(ch));

    var acc = el('p', 'acc');
    acc.appendChild(el('span', 'acc-label', 'Accessories'));
    ch.accessories.forEach(function (a) { acc.appendChild(el('span', 'chip', a)); });
    side.appendChild(acc);
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

  function renderDoNow() {
    var box = document.getElementById('do-now');
    var btn = document.getElementById('applied-toggle');
    box.classList.toggle('is-done', state.applied);
    btn.textContent = state.applied ? 'Show these steps again' : 'I have done these';
    btn.setAttribute('aria-pressed', state.applied ? 'true' : 'false');
  }

  function renderAll() {
    renderChecklist();
    renderCharacters();
    renderDoNow();
    var left = B.uniques.filter(function (u) { return !state.found[u.key]; }).length;
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
})();
