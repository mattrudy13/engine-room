# Engine Room: project notes

Shows what happens underneath a query. v0.1 is **Join Race**: three races that count the work different query
plans do, with a step-by-step close-up of each. Live at https://mattrudy13.github.io/engine-room/ (repo
`mattrudy13/engine-room`, public, GitHub Pages from `main` at the root). Mockups (look A "Gauge panel" was picked):
https://claude.ai/artifact/KiXrbba5sDaeGeGqhViCAn. Ideas for later: `ENHANCEMENTS.md`.

## Versions

- **v0.1** (2026-11-11): Join Race with three races (join methods; broadcast vs shuffle with skew; window vs
  self-join), predict → watch → free play, log-scale switch, close-ups with ½×/1×/2× speed. Two new Query Workbook
  drills (c6, c7) and links both ways.

## Rudy's choices (2026-11-11, ask before changing)

- **Its own site**, not a section of Query Workbook. Audience: Rudy first; a portfolio card maybe later. Not on the
  Board (hub) yet.
- **Join Race first.** The nav has "Delta log · soon" (next) and "Plan reader · soon" (last).
- **Races:** join methods, broadcast vs shuffle (+ skew switch), window vs self-join. No sorting race.
- **Simulated, counting steps of work.** No DuckDB, no timings. Each race's "How the steps are counted" says the model.
- **Predict, watch, then free play:** sliders stay locked until a guess is made; the explanation shows after it.
- **Bars are linear**, with a "Zoom out (log scale)" switch.
- **Close-up** under each race on a tiny example, Play / Step / Reset, with ½× / 1× / 2× speed (Rudy asked for the
  speed control).
- **Look: Gauge panel.** Charcoal #16181b, panels #1f2226, amber #f2a93b for running/actions, green #6cc68a for
  finished. Chivo + Chivo Mono. Dark only (assumed, not asked: the look was designed dark).
- **Query Workbook tie-in:** each race links its drills; Workbook's c1, c5, c6, c7 and w2 link back.

## The step models (`races.js`)

- Join methods (n customers, m transactions): nested n·m; hash n + m; sort-merge n·log₂n + m·log₂m + n + m.
- Broadcast vs shuffle (1M transactions, 4 workers): total = rows sent + rows on the busiest worker. Shuffle sends
  ¾ of all rows; broadcast sends customers × 3. Skew: one customer has 40% of transactions, all on worker 3.
  The caption's crossover is solved, not hard-coded: 250k customers without skew, 350k with it.
- Window vs self-join (5,000 rows, k per customer): self-join n·k (the equi-join pairs every row with every row
  of its customer, then filters); window n·log₂n + n. Self-join wins below about 13 per customer.
- Every lane moves the same steps per frame, so fast lanes really finish first. The slowest takes 6 s.

## Files

- `index.html`, `style.css`, `app.js`: the page. Plain JS modules, no build. Race in the hash (`#joins`,
  `#broadcast`, `#window`). Guesses in localStorage `engineroom:v1`. The origin is shared with Rudy's other Pages
  sites, so keep the key prefix.
- `races.js`: races, controls, step counts, captions. `closeup.js`: tiny-example step generators. Neither touches
  the DOM, so tests import them directly.
- `tests/races.test.mjs`: `npm test` (no dependencies). Pins the numbers the captions and close-up notes quote.
  If a formula changes, update the caption and the test together.
- `favicon.svg`, `apple-touch-icon.png` (rendered from the SVG with headless Chrome at 180px).
- `.claude/launch.json` (git-ignored): `python3 -m http.server 8774`.

## Checking a change

`npm test`, then open the page: make a guess on each race and let it finish, try the slider ends and the log
switch, play each close-up, and look at 1280px and 360px (no sideways scroll). The GitHub-folder server on port
8765 can serve cached files: reload them with `fetch(url, {cache: "reload"})` first.
