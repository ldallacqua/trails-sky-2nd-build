# Sky 2nd Chapter — Living Build

Party build notes for a Trails in the Sky 2nd Chapter (remake) playthrough.

The page covers the current chapter only, and hides boss notes and source links by default to avoid spoilers.

## Two ways to open it

**Live (on the PC you play on).** Double-click `start-live.cmd`, or run:

```bash
node server.js --open
```

This opens http://localhost:8733 and follows your save by itself:

- every slot and accessory shows a tick when it already matches the build
- the find list ticks itself when you pick up a quartz
- the to-do list is worked out from the save, and says where each missing quartz is (in your bag, on a benched character, or not owned)
- your spare quartz and accessories are listed

It updates a few seconds after the game writes a save (the autosave slot is written every few minutes and after menu changes). No reload, no buttons.

**Published.** https://ldallacqua.github.io/trails-sky-2nd-build/ is the same page without the server. It cannot see your save, so you tick things by hand.

## How light it is

Every 3 seconds the server makes one `stat` call per save slot. It only reads and unpacks the save (about 150 KB, a few milliseconds) when the file's timestamp or size changes. The page keeps one connection open and is told when something changed, so it does not poll. Change the interval with `--interval 10`.

The server is read-only, listens on 127.0.0.1 only, and has no dependencies. It needs Node 22.15 or newer and the Steam version of the game. Set `SKY2_GAME_DIR` or `SKY2_SAVE_DIR` if your paths differ.

## Files

- `data.js` holds the build: quartz values, the one-copy quartz checklist, and each character's target slots and accessories. Edit this to change the build.
- `app.js` draws the orbment diagrams, computes each line's elemental values, and compares the build with the save when the live server is present.
- `index.html` holds the fixed sections (boss prep, battle plan, notes, change log).
- `server.js` is the local live-sync server.
- `tools/read-save.js` reads a save. It also works on its own: `node tools/read-save.js` prints the same data as text.

Item names are read from the game's files at run time; none of the game's data is stored in this repo. The save offsets were found by inspection, so the reader checks the layout first and stops with an error if a game update moves things.

Pushing to `main` publishes the page through GitHub Pages. No build step.

Unofficial personal notes; not affiliated with Nihon Falcom or the game's publishers.
