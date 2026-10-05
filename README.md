# Sky 2nd Chapter — Living Build

Party build notes for a Trails in the Sky 2nd Chapter (remake) playthrough.

**Live page:** https://ldallacqua.github.io/trails-sky-2nd-build/

The page covers the current chapter only, and hides boss notes and source links by default to avoid spoilers.

## Updating

- `data.js` holds the build: quartz values, the one-copy quartz checklist, and each character's slots. Edit this to change the build.
- `app.js` draws the orbment diagrams and computes each line's elemental values from `data.js`.
- `index.html` holds the fixed sections (accessories, boss prep, battle plan, notes, change log).
- `styles.css` is the styling.

Pushing to `main` publishes the page through GitHub Pages. No build step.

To preview locally:

```bash
python -m http.server 8732 --directory .
```

Unofficial personal notes; not affiliated with Nihon Falcom or the game's publishers.
