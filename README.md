<h1 align="center">Sky 2nd Chapter — Living Build</h1>

<p align="center">
  A party-build companion for <i>Trails in the Sky 2nd Chapter</i> (2026 remake) that reads your save file<br>
  and tells you what to slot, what to pick up next, and what your party can cast right now.
</p>

<p align="center">
  <a href="https://ldallacqua.github.io/trails-sky-2nd-build/"><img alt="Open the page" src="https://img.shields.io/badge/open-the%20page-b8862b?style=flat-square"></a>
  <img alt="Node 22.15 or newer" src="https://img.shields.io/badge/node-%E2%89%A5%2022.15-3c873a?style=flat-square">
  <img alt="No dependencies" src="https://img.shields.io/badge/dependencies-0-1d3b53?style=flat-square">
  <img alt="No build step for the page" src="https://img.shields.io/badge/page-plain%20HTML%2C%20CSS%2C%20JS-5a3d1e?style=flat-square">
</p>

<p align="center">
  <a href="https://ldallacqua.github.io/trails-sky-2nd-build/"><img src="docs/orbment.png" alt="An orbment screen: the dial with seven quartz, a help window describing the hovered quartz, the elemental values of each line and the list of usable Arts" width="900"></a>
</p>

## What it does

Guides tell you the ideal build. They do not know what is in your bag. This page does.

Run the small local server next to the game and the page follows your save: it opens the chapter you are in, shows the party you are using, ticks every slot that already matches, and turns the rest into a short to-do list that says where each missing quartz is — in your bag, on a benched character, or in a chest you have not opened yet.

It updates a few seconds after the game saves. No reload, no buttons, nothing to type.

## Highlights

- **Follows the save.** Chapter, active party and reserve, every slot, weapon, armour and accessory, the whole bag, and HP, EP and CP as of the last save.
- **Works out the Arts for you.** Each orbment's lines are traced the way the game does it, the elemental values are added up, and the page lists every Art that layout can cast, with EP cost.
- **Plans with what you own.** A slot can name a target quartz and a stand-in. The page picks the best one you actually have and tells you what to swap when a better one turns up.
- **Spoiler-safe.** Notes for every chapter are in the repo, sealed. The page and the server only open the chapter your save has reached.
- **Checked against the game's own tables.** Slot layouts, element locks, quartz values and effects, accessory resistances and Art requirements are read from the game files, not typed by hand.
- **Looks like the game.** Parchment and gears, banner titles, cream list windows with a red cursor, navy status cards, Bracer Notebook pages. All of it is drawn in CSS.
- **A help window on everything.** Hover or tap a quartz, accessory, Art or item to see what it does and where yours is.
- **Small.** About 4,000 lines of plain JavaScript, HTML and CSS. No framework, no packages, no build step for the page.

## Screenshots

<p align="center">
  <img src="docs/overview.png" alt="Overview: chapter, party, how many changes are waiting and how many upgrades are still to get, above the chapter notes" width="900">
</p>

<p align="center">
  <img src="docs/upgrades.png" alt="Upgrade list: each quartz with how many are owned, where to find it and whose slot it goes in" width="900">
</p>

<p align="center">
  <img src="docs/status.png" alt="Party status: level, HP, EP, CP and gear for each character" width="900">
</p>

<p align="center">
  <img src="docs/phone-overview.png" alt="The overview on a phone" width="300">
  &nbsp;&nbsp;
  <img src="docs/phone-orbment.png" alt="An orbment on a phone" width="300">
</p>

These show the drawn look, which is what the published copy uses. With the game installed, live mode swaps in the game's own icons, portraits and window art (see [Game art](#game-art)).

## Try it

**Just look.** The published copy is at **https://ldallacqua.github.io/trails-sky-2nd-build/**. It cannot see a save, so it starts on one chapter, you tick things by hand, and it asks before opening the next chapter.

**Live, next to your game.** You need the Steam version of the game on Windows and [Node.js](https://nodejs.org/) 22.15 or newer.

```bash
git clone https://github.com/ldallacqua/trails-sky-2nd-build.git
cd trails-sky-2nd-build
node server.js --open
```

That opens http://localhost:8733. On Windows you can also double-click `start-live.cmd`. There is nothing to install.

If your game or saves are not in the default places, set `SKY2_GAME_DIR` and `SKY2_SAVE_DIR` first.

## How live mode works

```mermaid
flowchart TD
    G["The game writes a save"] --> S["server.js checks the save folder every 3 s"]
    S -- "a file changed" --> R["read-save.js unpacks and parses it"]
    R -- "pushed over one open connection" --> P["The page compares the save with the build and redraws"]
    T["The game's tables"] --> B["build.js validates the chapter notes"]
    B --> C["Sealed chapter files"]
    C -- "up to your chapter only" --> P
```

- **Cheap.** Each tick is one `stat` call per save slot. A save is only read and unpacked (about 150 KB, a few milliseconds) when its timestamp or size changes. The page does not poll.
- **Read-only.** The server never writes to the save folder or the game folder.
- **Local.** It listens on 127.0.0.1 only.

## Spoiler-safe by design

The notes cover every chapter, and none of that should leak to someone who is still playing.

- Chapter notes are stored as `chapters/chN.dat`, base64-sealed, so browsing the repo, reading a diff or searching it does not show a chapter you have not reached.
- The live server refuses to hand out a chapter beyond the one in your save.
- Characters who are not with you in the save are not shown, even when the notes have a build for them.
- Boss notes and party changes inside a chapter are collapsed until you open them.

## Built from the game's data

Earlier versions of these notes were typed by hand and got things wrong: items under the wrong name, a quartz in a slot it cannot go in. So the page's data is now built, not written.

`tools/build.js` reads the game's own tables and takes from them every character's line layout and slot locks, every quartz's colour, elemental value and effect, every accessory's stats and resistances, and every Art's requirements, EP cost and description. The chapter notes only say *which* quartz goes *where*. The build stops with an error if a note names something that does not exist, puts a quartz in a slot that is locked to another element, or slots two of the same kind on one orbment.

Names are the English ones from the game's files, so what the page says is what the menu says.

## Game art

The page is styled after the game's menus, and every part of that is drawn in CSS, so the published copy ships no images from the game.

In live mode the server can go one step further. The first time it needs them, it reads a few textures from **your own install** and writes them to `assets/`: the icon sheet, the orbment face, window corners, gears and menu icons, and a portrait, cut-in and standing art per character. The page then uses those instead of the drawn versions.

- `assets/` is in `.gitignore`. The art belongs to the game's publisher; it is never committed or published. Only the extractor is.
- Character art is extracted one character at a time, only for characters in your save, and the server refuses to serve any other.
- `node server.js --no-assets` keeps the drawn look. `node tools/extract-assets.js --clean` deletes the folder.

The decoder is in the repo and has no dependencies: `tools/texture.js` unpacks LZ4, decodes BC7 and writes PNG in about 240 lines.

## What is in the repo

| File | What it does |
|---|---|
| `index.html`, `styles.css`, `app.js` | The page. `app.js` works out what each slot should hold given what you own, compares that with the save, traces the orbment lines and computes the Arts. |
| `server.js` | The local live server: watches the save folder, pushes changes to the page, gates chapters and character art. |
| `tools/read-save.js` | Reads a save: chapter, party, slots, gear, bag. Also runs on its own. |
| `tools/build.js` | Validates the chapter notes against the game's tables and writes `chapters/*.dat` and `game-data.js`. |
| `tools/extract-assets.js`, `tools/texture.js` | Pull art out of the game's image archive and decode it. |
| `chapters/chN.dat` | Sealed notes, one per chapter. |
| `game-data.js` | Generated: quartz, accessories, Arts and orbment layouts from the game's tables. |
| `data.js` | Version, and the chapter the published copy starts on. |

## Commands

| Command | What it does |
|---|---|
| `node server.js --open` | Start live mode and open the page. |
| `node server.js --port 9000` | Use another port (default 8733). |
| `node server.js --interval 10` | Check the save folder every 10 seconds (default 3). |
| `node server.js --no-assets` | Do not use the game's art. |
| `node tools/read-save.js` | Print what the newest save contains. Add `--json` for JSON, or pass a save file. |
| `node tools/build.js` | Rebuild `chapters/*.dat` and `game-data.js` from the notes. |
| `node tools/build.js --unseal` | Recreate the readable notes in `chapters-src/` from the sealed files. **This is the spoiler switch.** |
| `node tools/build.js --report N` | Print chapter N's lines, values and Arts per character. |
| `node tools/build.js --check-fx` | Compare the hand-written quartz effect lines with the game's table. |
| `node tools/extract-assets.js --clean` | Delete the extracted art. |

Add `?once` to the live URL to read the save a single time without keeping a connection open. That is handy for screenshots and tests.

## Editing the notes

The readable notes live in `chapters-src/` (one `chN.js` per chapter, plus shared templates in `_lib.js`). That folder is not committed; `--unseal` recreates it on a fresh clone. A slot is either a quartz name or `[target, stand-in until you own it]`.

After changing a note, run `node tools/build.js` and commit the regenerated files. Pushing to `main` publishes the page through GitHub Pages.

## Limits

- **Steam version on Windows.** The default paths, `start-live.cmd` and `--open` assume it. The server itself is plain Node and takes the two paths from environment variables.
- **The save layout was found by inspection.** The reader checks the layout before trusting it and stops with an error if a game update moves things, rather than showing wrong data.
- **The builds are one player's choices.** They were written for a single playthrough. The page follows any save, but the advice reflects that party and those priorities.

## Credits

- Chapter research draws on Japanese guide sites, cross-checked against the game's tables.
- The BC7 decoder in `tools/texture.js` is a port of [bcdec](https://github.com/iOrange/bcdec) (MIT).
- Fonts: [Tinos](https://fonts.google.com/specimen/Tinos), [Zen Maru Gothic](https://fonts.google.com/specimen/Zen+Maru+Gothic) and [Barlow Condensed](https://fonts.google.com/specimen/Barlow+Condensed), from Google Fonts.

This is an unofficial fan project. It is not affiliated with or endorsed by Nihon Falcom or the game's publishers. *Trails in the Sky* and all names from the game belong to their owners. No game files are included in this repository.
