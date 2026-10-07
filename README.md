# Full Faith & Credit

An incremental game about the history of the U.S. dollar, from gold dust at Sutter's Mill (1848) to the Nixon Shock (1971), with the Fiat Era to follow.

**v0.2: the Gold Era rebuilt around mining shifts.** You mine gold by hand in timed rounds. The Mint buys every ounce at the legal price, and you spend those dollars on upgrades and on the charters that move history forward. Nothing unlocks by waiting.

## The loop

1. **Mine a shift (Mine page).** It is a timed round at the rock face. Tap or hold, and your pick hits every rock inside its ring. Rock, quartz, nuggets and rich veins break into gold. Sometimes a huge Mother Lode appears.
2. **The Mint pays.** Each ounce goes into the Treasury vault as reserves, and the Mint issues dollars for it at the official price divided by the gold cover:
   - $20.67 an ounce at first.
   - $35 after the 1934 Gold Reserve Act.
   - Times 2.5 when the 1913 Federal Reserve Act sets 40% cover.
   - Times 4 when the 1945 cut sets 25% cover.
3. **Upgrade (Upgrades page).** Every card says what it does now, what it does next, and what it still requires:
   - **Pickaxe:** bigger reach, harder hits, faster swings, crits.
   - **Shift:** longer shifts, more rock, richer assays, Mother Lode luck.
   - **Tools:** the Shift Foreman, dynamite, the pneumatic rock drill.
   - **Site permits and tiers.**
   - **History:** charters, in order. Each one needs dollars plus a minimum of gold in the vault.
4. **Hire crews (Territory page).** A site works only after you buy its permit. Its crews then mine a share of your mining pace between shifts, and while the game is closed.
   - Each site's crews approach that site's limit with diminishing returns.
   - Tiers raise the limit and evolve the artwork.
5. **Treasury page.** It shows the Mint's formula, the history timeline, the gold window (the Nixon Shock gate) and the locked Fiat Era preview.

## Run it

Open `index.html` in a browser. No build step and no server are needed: the scripts are classic `<script>` files, so they work from `file://`.

To serve it instead, run `python3 -m http.server` and open `http://localhost:8000`.

### On a phone

The repo is a plain static site, so GitHub Pages can host it. In the repo, go to **Settings → Pages**, set **Source** to *Deploy from a branch*, pick **main** and **/ (root)**, and save. A minute later it is live at `https://<user>.github.io/<repo>/`.

- **Navigation:** the pages sit in a bottom navigation bar. The rock face is sized to fill the screen between the header and that bar.
- **Mining:** while a shift runs, dragging on the rock face aims the pick instead of scrolling the page. Holding a finger down keeps swinging. On a touchscreen the pick floats about 88 px above your fingertip (Settings → Pick height: Low, Medium or High) (less near the bottom edge), so your finger never hides the rock: hold just below what you want to hit.
- **Control pad:** on touchscreens a pad under the rock face moves the pick like a laptop trackpad (drag to move, hold to swing), so your finger never covers the rocks. You can still tap rocks directly. Settings can hide the pad.
- **Pick heads:** the pick on the rock face changes as Stronger Pick levels up, from rusty iron (LV 0) to diamond-tipped (LV 55).
- **Tooltips:** tap an underlined term to read it, or **long-press** a site card for its details (a quick tap still buys). Tap anywhere else to close.
- **Saves are per browser.** Use Settings → Export / Import to move one between a phone and a computer.
- **Testing aids:** Settings → Developer tools (or `?debug` in the URL) adds a panel. It can:
  - add dollars or gold;
  - sign the next charter;
  - grant permits and crews;
  - end a shift;
  - summon a Mother Lode;
  - skip ahead an hour.

Claude artifacts need one self-contained file. `python3 tools/build-artifact.py out.html` inlines the CSS and scripts into that form.

## Files

| File | Responsibility |
|---|---|
| `economy.js` | Pure model with no DOM: <ul><li>sites, maps, charters and the shop items</li><li>the Mint formula and `derive()`</li><li>crew simulation</li><li>number formatting and save migration</li></ul> Loads in Node for tests and balancing. |
| `mining.js` | The shift: <ul><li>rock spawning, strikes, crits, dynamite chains, the drill and the Mother Lode, as a pure model</li><li>a canvas view that turns mouse and touch input into swings</li></ul> |
| `svgAssets.js` | All vector art as markup strings: <ul><li>8 sites × 6 visual tiers</li><li>the territory panorama</li><li>shop pictograms and icons</li></ul> |
| `gameEngine.js` | <ul><li>the rAF loop and wall-clock catch-up</li><li>persistence</li><li>the four page controllers</li><li>tooltips, ticker, toasts, modals, sound and developer tools</li></ul> |
| `style.css` | Dark terminal theme. The era palette is swapped with `body[data-era]`. |
| `index.html` | The page shell. |
| `tools/build-artifact.py` | Builds a single-file copy for hosts that wrap pages in their own skeleton. |
| `tools/balance.js` | A simulated player. It prints when each charter is signed and how much income comes from crews. |

## How time works

- **Shifts run on real time** and pause when you leave the Mine page or hide the tab.
- **Crews run on wall-clock time** (`Date.now()`), so a hidden tab or a closed browser is credited exactly. Offline time is capped at 30 days.
- **Accurate catch-up:** crew output is linear between purchases, so one 8-hour step equals 28,800 one-second steps.
- **Away summary:** a "while you were away" summary shows what the crews mined after 60 s or more away.

## Saves

- **Autosave:** to `localStorage` under the key `ffc.save.v2`, every 10 s and when the tab hides or the page closes. Press Ctrl/Cmd+S to save manually.
- **v1 saves:** v1 saves (the pre-shift clicker) can't be converted. On first load the old save is kept under `ffc.save.v1.archive`, and a fresh era starts with your settings, studied terms and play time.
- **Export/import:** in Settings, as an `FFC2:` base64 string.
- **Unreadable save:** it is backed up to `<key>.corrupt.<timestamp>`.
- **Two tabs open:** autosave pauses in the older tab.

## Balance

`node tools/balance.js` simulates an efficient player who holds down and aims at the best cluster with some error. Current numbers:

- **Timeline:** the 1849 charter at about minute 3, Comstock (1859) at 15, Homestake (1876) at 60, the Federal Reserve Act (1913) at 132, and the Gold Pool's collapse (1968) at about 224 minutes. A casual player will take longer.
- **Crews:** they bring in about 5% of income at 15 minutes, 20–30% in the first hour, and 35–45% late. Clicking stays the main source of income.

The tuning levers, all in `economy.js`:

| Lever | What it sets |
|---|---|
| `SITE_LIMIT` | Each site's share of your pace |
| `CREW_HALF` | How quickly crews fill a site |
| `TIER_RULES` / `TIER_MULTS` | Site tier costs and limit multipliers |
| Charter `cost` and `reserves` | The price and vault requirement of each step in history |
| Item `base` / `growth` / `max` | Upgrade prices and caps |
| `MAPS` `hp` / `gold` | How tough and how rich each mine is |

## Hooks for Phase II and III

- **Era state:** `state.era` (`'gold' | 'fiat'`) and `body[data-era]` already drive the whole palette, including the neon strokes inside the SVG art (`.nst` and `.nfl`).
- **Prestige:** `Economy.NIXON` holds the gate (the 1968 charter plus a vault target) and the Credibility formula (`10 × ∛(reserves / target)`). `state.prestige` is reserved for it.
- **Fiat Era preview:** the locked tree reads from `Economy.FIAT_PREVIEW`, and the matching glossary terms are already written.
