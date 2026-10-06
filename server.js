#!/usr/bin/env node
// Local live-sync server for the build page.
//
//   node server.js              serve on http://localhost:8733 and watch the save folder
//   node server.js --open       same, and open the page in your browser
//   node server.js --interval 5 check every 5 seconds (default 3)
//   node server.js --port 9000
//   node server.js --no-assets  do not use the game's art; keep the drawn look
//
// start-overlay.cmd draws the page's next steps on top of the game. It asks this server for
// them (/api/overlay), so the server works the plan out with the same code the page uses.
//
// How it stays cheap: every tick is one stat call per save slot. The save is only read and
// unpacked when its timestamp or size changes, which is whenever the game writes a save.
// The page is told about changes over a single kept-open connection, so it does not poll.
//
// Spoiler gate: chapter notes are only served up to the chapter the save is in, and character
// art only for a character who is in the save.
//
// Game art (menu furniture, icons, portraits, the orbment face) is read from your own install
// into assets/ the first time it is needed. assets/ stays on this PC.
//
// Read-only, local only (127.0.0.1), no dependencies. Needs Node 22.15+.

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { exec } = require('child_process');
const model = require('./model.js');
const { loadGame, newestSave, readSaveFile, SAVE_DIR } = require('./tools/read-save.js');
const { ensureAssets, ASSET_DIR, UI_FILES } = require('./tools/extract-assets.js');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i !== -1 && args[i + 1] ? Number(args[i + 1]) : fallback; };
const PORT = opt('port', 8733);
const INTERVAL = Math.max(1, opt('interval', 3));
const ROOT = __dirname;
const STATIC = {
  '/': 'index.html', '/index.html': 'index.html', '/styles.css': 'styles.css',
  '/app.js': 'app.js', '/model.js': 'model.js', '/data.js': 'data.js', '/game-data.js': 'game-data.js'
};
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.dat': 'text/plain; charset=utf-8', '.png': 'image/png' };
const NO_ASSETS = args.includes('--no-assets');

let game;
try { game = loadGame(); } catch (e) { console.error('Could not read the game tables: ' + e.message); process.exit(1); }

let current = null;      // last good read
let currentKey = '';     // slot + mtime + size of the save that produced it
let lastProblem = '';
const clients = new Set();

function send(res, data) { res.write('data: ' + JSON.stringify(data) + '\n\n'); }

function tick() {
  let newest;
  try {
    newest = newestSave();
    const key = newest.slot + ':' + newest.t + ':' + newest.size;
    if (key === currentKey) return;
    const data = readSaveFile(newest.f, game); // throws if the game is mid-write; retried next tick
    data.save = { slot: newest.slot, written: new Date(newest.t).toISOString() };
    data.interval = INTERVAL;
    // art for the people in this save; null when the game's files cannot be read
    data.assets = NO_ASSETS ? null : ensureAssets(Object.values(data.characters).map((c) => ({ id: c.id, model: c.model })));
    current = data;
    currentKey = key;
    lastProblem = '';
    console.log(new Date().toLocaleTimeString() + '  read ' + newest.slot + ' (saved ' + new Date(newest.t).toLocaleTimeString() + ')' +
      (data.chapter ? '  ' + data.chapter.title : ''));
    for (const res of clients) send(res, current);
  } catch (e) {
    if (e.message !== lastProblem) { lastProblem = e.message; console.log(new Date().toLocaleTimeString() + '  waiting: ' + e.message); }
  }
}

// ---- the in-game overlay -----------------------------------------------------------
// The steps the page lists under "Next steps", worked out here so the overlay needs no browser.
// Recomputed only when the save, the chapter notes or the game data change.
const SHEET_QUARTZ = 84;  // first quartz orb on the game's icon sheet, one per element
let overlayKey = '', overlayBody = '';
function mtime(file) { try { return fs.statSync(path.join(ROOT, file)).mtimeMs; } catch (e) { return 0; } }
function overlay() {
  if (!current) return JSON.stringify({ ok: false, problem: lastProblem || 'no save read yet' });
  const n = current.chapter ? current.chapter.n : null;
  const notes = path.join('chapters', 'ch' + n + '.dat');
  const key = [currentKey, mtime(notes), mtime('game-data.js'), mtime('model.js')].join('|');
  if (key === overlayKey) return overlayBody;
  const out = {
    ok: true, chapter: current.chapter ? current.chapter.title : '', saved: current.save.written,
    art: !!(current.assets && current.assets.icons), faces: current.assets ? current.assets.faces : [],
    notes: false, steps: [], waiting: 0, optional: 0, stage: '', note: '', lineup: '', lineupOk: false
  };
  try {
    const box = { window: {}, atob, TextDecoder, Uint8Array };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'game-data.js'), 'utf8'), box);
    const G = box.window.GAME;
    const CH = JSON.parse(Buffer.from(fs.readFileSync(path.join(ROOT, notes), 'utf8'), 'base64').toString('utf8'));
    model.use({ G, CH, chapterN: n, live: current, have: {} });
    const m = model.compute();
    const icon = (name) => {
      if (G.quartz[name]) return { cell: SHEET_QUARTZ + model.ELS.indexOf(G.quartz[name][0]), el: G.quartz[name][0] };
      if (G.gear[name]) return { cell: G.gear[name].i == null ? null : G.gear[name].i };
      if (G.accessories[name]) return { cell: G.accessories[name][2] == null ? null : G.accessories[name][2] };
      return {};
    };
    const inParty = (e) => m.active.indexOf(e.id) !== -1;
    out.notes = true;
    out.steps = m.todo.map((t) => ({
      id: t.id, who: t.who, pos: t.pos, from: t.from, to: t.to, where: t.where || '', gain: t.note || '',
      fromIcon: icon(t.from), toIcon: icon(t.to)
    }));
    out.waiting = m.gearWait.filter(inParty).length;
    out.optional = m.gearOptional.filter(inParty).length;
    if (m.stage) { out.stage = m.stage.title; out.note = m.stage.note; }
    // the four in the save against the four the notes would field here
    out.lineupOk = !!(m.lineup && m.lineup.pick.length && m.lineup.same);
    if (m.lineup && !m.lineup.same) {
      const nameOf = (id) => (current.characters[id] && current.characters[id].name) || id;
      out.lineup = m.lineup.swaps.map((s) => 'Bring ' + nameOf(s.in) + ' in for ' + nameOf(s.out) + '.').join(' ');
    }
  } catch (e) {
    out.problem = n == null ? 'chapter not recognised' : 'no build notes for this chapter';
  }
  overlayKey = key;
  overlayBody = JSON.stringify(out);
  return overlayBody;
}

function serveFile(res, file) {
  fs.readFile(path.join(ROOT, file), (err, body) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)], 'Cache-Control': 'no-store' });
    res.end(body);
  });
}

const server = http.createServer((req, res) => {
  // local pages only: refuse requests that arrive under another host name
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  if (host !== 'localhost' && host !== '127.0.0.1') { res.writeHead(403); res.end(); return; }
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  const url = req.url.split('?')[0];

  if (url === '/api/state') {
    if (!current) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: lastProblem || 'no save read yet' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(current));
    return;
  }
  if (url === '/api/overlay') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(overlay());
    return;
  }
  if (url === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    if (current) send(res, current);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  const chapter = /^\/chapters\/ch(\d+)\.dat$/.exec(url);
  if (chapter) {
    // Notes for a chapter the save has not reached are not handed out.
    const reached = current && current.chapter ? current.chapter.n : -1;
    if (Number(chapter[1]) > reached) { res.writeHead(403); res.end('Not reached yet'); return; }
    serveFile(res, path.join('chapters', 'ch' + Number(chapter[1]) + '.dat'));
    return;
  }
  const asset = /^\/assets\/(?:(icons|dial)|ui\/([a-z-]+)|(face|eyes|body)\/([a-z]+))\.png$/.exec(url);
  if (asset) {
    const got = current && current.assets;
    const kinds = { face: 'faces', eyes: 'eyes', body: 'bodies' };
    let ok = false, file = '';
    if (got && asset[1]) { ok = !!got[asset[1]]; file = asset[1]; }
    else if (got && asset[2]) { ok = !!got.ui && UI_FILES.indexOf(asset[2]) !== -1; file = path.join('ui', asset[2]); }
    else if (got) { ok = got[kinds[asset[3]]].indexOf(asset[4]) !== -1 && !!current.characters[asset[4]]; file = path.join(asset[3], asset[4]); }
    if (!ok) { res.writeHead(404); res.end('Not found'); return; }
    fs.readFile(path.join(ASSET_DIR, file + '.png'), (err, body) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME['.png'], 'Cache-Control': 'max-age=86400' });
      res.end(body);
    });
    return;
  }
  const file = STATIC[url];
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  serveFile(res, file);
});

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? 'Port ' + PORT + ' is already in use. Is the live server already running?' : e.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://localhost:' + PORT + '/';
  console.log('Live build page: ' + url);
  console.log('Watching ' + SAVE_DIR + ' every ' + INTERVAL + ' s. Close this window to stop.');
  tick();
  setInterval(tick, INTERVAL * 1000);
  setInterval(() => { for (const res of clients) res.write(': keep-alive\n\n'); }, 25000);
  if (args.includes('--open') && process.platform === 'win32') exec('start "" "' + url + '"');
});
