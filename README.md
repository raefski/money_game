# Full Faith & Credit

An incremental game about the history of the U.S. dollar, from gold dust at Sutter's Mill (1848) to the Nixon Shock (1971), with the Fiat Era to follow.

**Phase I prototype:** the Gold Era clicker, evolving SVG sites, the game loop, and save/load.

## Run it

Open `index.html` in a browser. No build step and no server are needed: the scripts are classic `<script>` files, so they work from `file://`.

To serve it instead, run `python3 -m http.server` and open `http://localhost:8000`.

### On a phone

The repo is a plain static site, so GitHub Pages can host it: in the repo go to **Settings → Pages**, set **Source** to *Deploy from a branch*, pick **main** and **/ (root)**, and save. A minute later it is live at `https://<user>.github.io/<repo>/`.

- **Tooltips:** touch has no hover. Tap an underlined term to read it, or **long-press** a site card or research tile for its details (a quick tap still buys). Tap anywhere else to close.
- **Saves are per browser.** A phone and a computer keep separate saves. Use Settings → Export / Import to move one.
- **Testing aids:** Settings → Developer tools adds a panel to add gold, add sites, research everything and skip time. It also works with `?debug` in the URL.
- **Smoothness:** the late game runs a lot of SVG animation. If an older phone stutters, turn on Settings → Reduced motion.

Claude artifacts need one self-contained file. `python3 tools/build-artifact.py out.html` inlines the CSS and scripts into that form.

## Files

| File | Responsibility |
|---|---|
| `economy.js` | Pure model with no DOM: buildings, upgrades, the historical timeline, the glossary, formulas, the event-stepped `simulate()`, number formatting and save migration. Loads in Node for tests and balancing. |
| `svgAssets.js` | All vector art as markup strings: 8 buildings × 6 visual tiers, the territory panorama, the low-poly nugget with its evolving tool, and the icons. |
| `gameEngine.js` | rAF render loop, wall-clock simulation catch-up, persistence, actions, the view layer, tooltips, ticker, lucky strikes, modals, sound and debug tools. |
| `style.css` | Dark terminal theme. The era palette is swapped with `body[data-era]`. |
| `index.html` | The dashboard shell. |
| `tools/build-artifact.py` | Builds a single-file copy for hosts that wrap pages in their own skeleton. |

## How time works

`requestAnimationFrame` only renders. The economy always advances by real elapsed `Date.now()` time:

- **Backgrounded tab:** the 10-second autosave keeps advancing the simulation, and a "while you were away" summary appears on return (after 60 s or more).
- **Closed browser:** offline progress is credited on the next load, capped at 30 days.
- **Accuracy:** `Economy.simulate()` steps from event to event (buff expiry, milestone bonuses), so one 8-hour step gives the same result as 28,800 one-second steps.

## Saves

- **Autosave:** to `localStorage` under the key `ffc.save.v1`, every 10 s and on tab hide or page close. Press Ctrl/Cmd+S to save manually.
- **Export/import:** in Settings, as an `FFC1:` base64 string.
- **Migration:** `Economy.migrate()` validates and merges any save onto current defaults, so adding content later won't break old saves.
- **Unreadable save:** it is backed up to `ffc.save.v1.corrupt.<timestamp>` and the game starts a fresh era.
- **Two tabs open:** autosave pauses in the older tab.

## Debug mode

Turn on **Settings → Developer tools**, or open `index.html?debug`, to show a panel with buttons to add gold, add sites, research everything, warp time, spawn a lucky strike, and preview the fiat theme. The panel starts collapsed on phones.

The game object is also exposed on `window.FFC` in the browser console.

## Balance (first run)

A greedy-buyer simulation reaches 1971 (1T oz mined) in about 3.7 h. Saving up the 1T oz "Sever the Gold Peg" cost then takes about 30 more minutes. Catching lucky strikes speeds this up.

The tuning levers are near the top of `economy.js`:

- `COST_GROWTH`
- `MILESTONE_BONUS`
- `TIER_RULES`
- the building `rate` and `baseCost` values

## Hooks for Phase II and III

- **Era state:** `state.era` (`'gold' | 'fiat'`) and `body[data-era]` already drive the whole palette, including the neon strokes inside the SVG art (`.nst` and `.nfl`).
- **Prestige:** `Economy.NIXON` holds the reset cost and the Credibility formula (`10 × ∛(gold mined / 1T)`). `state.prestige` is reserved for it.
- **Fiat Era preview:** the locked tree reads from `Economy.FIAT_PREVIEW`, and the matching glossary terms are written already.
