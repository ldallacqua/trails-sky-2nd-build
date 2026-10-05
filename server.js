#!/usr/bin/env node
// Local live-sync server for the build page.
//
//   node server.js              serve on http://localhost:8733 and watch the save folder
//   node server.js --open       same, and open the page in your browser
//   node server.js --interval 5 check every 5 seconds (default 3)
//   node server.js --port 9000
//   node server.js --no-assets  do not use the game's art; keep the drawn look
//
// How it stays cheap: every tick is one stat call per save slot. The save is only read and
// unpacked when its timestamp or size changes, which is whenever the game writes a save.
// The page is told about changes over a single kept-open connection, so it does not poll.
//
// Spoiler gate: chapter notes are only served up to the chapter the save is in, and a portrait
// only for a character who is in the save.
//
// Game art (icons, portraits, the orbment face) is read from your own install into assets/ the
// first time it is needed. assets/ stays on this PC.
//
// Read-only, local only (127.0.0.1), no dependencies. Needs Node 22.15+.

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { loadGame, newestSave, readSaveFile, SAVE_DIR } = require('./tools/read-save.js');
const { ensureAssets, ASSET_DIR } = require('./tools/extract-assets.js');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i !== -1 && args[i + 1] ? Number(args[i + 1]) : fallback; };
const PORT = opt('port', 8733);
const INTERVAL = Math.max(1, opt('interval', 3));
const ROOT = __dirname;
const STATIC = {
  '/': 'index.html', '/index.html': 'index.html', '/styles.css': 'styles.css',
  '/app.js': 'app.js', '/data.js': 'data.js', '/game-data.js': 'game-data.js'
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
  const asset = /^\/assets\/(icons|dial|face\/([a-z]+))\.png$/.exec(url);
  if (asset) {
    const got = current && current.assets;
    const ok = got && (asset[2] ? got.faces.indexOf(asset[2]) !== -1 && current.characters[asset[2]] : got[asset[1]]);
    if (!ok) { res.writeHead(404); res.end('Not found'); return; }
    fs.readFile(path.join(ASSET_DIR, asset[1] + '.png'), (err, body) => {
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
