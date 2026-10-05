# Sky 2nd Chapter — Living Build

Party build notes for a Trails in the Sky 2nd Chapter (remake) playthrough.

The page shows **one chapter at a time**. Notes for every later chapter are already written, but they stay sealed until the save reaches that chapter. Boss notes and within-chapter party changes are collapsed by default.

## Two ways to open it

**Live (on the PC you play on).** Double-click `start-live.cmd`, or run:

```bash
node server.js --open
```

This opens http://localhost:8733 and follows your save by itself:

- it reads which chapter you are in and opens that chapter's notes, and only that chapter's
- it reads who is in your party; cards follow the party, with reserve builds kept below
- every slot and accessory shows a tick when it already matches the build
- the upgrade list counts what you own (bag plus everything slotted) against what the party wants
- the to-do list says where each missing quartz is: in your bag, on a benched character, or not owned
- party status shows everyone's HP, EP, CP and gear as of the last save
- party Arts shows who can cast what with the quartz slotted right now
- status protection shows who resists what, and which spare accessory in the bag would cover a gap
- the bag lists healing items, spare quartz and spare accessories, each with what it does

It updates a few seconds after the game writes a save (the autosave slot is written every few minutes and after menu changes). No reload, no buttons.

**Published.** https://ldallacqua.github.io/trails-sky-2nd-build/ is the same page without the server. It cannot see your save, so you tick things by hand, and it asks before opening the next chapter.

## Spoilers

- `chapters/chN.dat` are the chapter notes, base64-sealed so that browsing the repo, a diff or a search does not show a chapter you have not reached.
- The live server refuses to hand out a chapter beyond the one in your save.
- Characters who are not with you in the save are not shown, even if the chapter notes have a build for them.
- `chapters-src/` holds the readable originals. It is not committed. `node tools/build.js --unseal` recreates it from the sealed files.

## How light it is

Every 3 seconds the server makes one `stat` call per save slot. It only reads and unpacks the save (about 150 KB, a few milliseconds) when the file's timestamp or size changes. The page keeps one connection open and is told when something changed, so it does not poll. Change the interval with `--interval 10`.

The server is read-only, listens on 127.0.0.1 only, and has no dependencies. It needs Node 22.15 or newer and the Steam version of the game. Set `SKY2_GAME_DIR` or `SKY2_SAVE_DIR` if your paths differ.

## Files

- `chapters-src/chN.js` (not committed) is the build for one chapter: party rules, where each quartz comes from, each character's target slots and accessories, boss prep and notes. A slot is either a quartz name or `[target, stand-in until you own it]`. `_lib.js` has the shared build templates.
- `tools/build.js` turns those into `chapters/chN.dat` and `game-data.js`. It takes every character's line layout and slot locks, every quartz colour, value and effect, every accessory's stats and resistances, and every Art's requirements, EP cost and description from the game's own tables, and refuses to build if a note puts a quartz where it cannot go. `--report N` prints chapter N's lines, values and Arts. `--check-fx` prints each hand-written quartz effect line next to what the table says.
- `app.js` draws the page: it works out what each slot should hold given what is owned, compares that with the save, and computes the Arts each layout gives.
- `server.js` is the local live-sync server. `tools/read-save.js` reads a save and also works on its own: `node tools/read-save.js`.
- `data.js` has the version and the chapter the published copy starts on.

Names, chapter titles, layouts and Art requirements are read from the game's files; the save offsets were found by inspection, so the reader checks the layout first and stops with an error if a game update moves things.

Add `?once` to the live URL to read the save a single time without keeping a connection open; that is what the screenshot checks use.

Pushing to `main` publishes the page through GitHub Pages. No build step on the server side; run `node tools/build.js` before committing when the notes change.

Unofficial personal notes; not affiliated with Nihon Falcom or the game's publishers.
