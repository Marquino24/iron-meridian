# Iron Meridian

A browser-based real-time grand strategy game. Vanilla JavaScript (ES modules) and HTML Canvas, with no frameworks and no build step.

**Step 1 scope:** procedurally generated map, 6 nations, pan/zoom, province inspection, nation select.

## Run

ES modules don't load from `file://`, so serve the folder over HTTP:

```bash
npm start            # = npx serve -l 3000 .   → http://localhost:3000
# or
npx serve .
# or, with no Node:
python3 -m http.server 3000
```

Open a specific scenario from the URL: `?era=ww2` (rome, medieval, ww1, ww2, coldwar, modern, fictional), plus `&seed=ABCD-1234` for the fictional world. The URL follows your choice, so reloading keeps it.

Single-file build (all JS and CSS inlined; Google Fonts with a system-font fallback):

```bash
npm run bundle       # → dist/iron-meridian.html (opens straight from disk, no server needed)
                     #   dist/iron-meridian.fragment.html (same, without <html>/<head>/<body>, for hosts that add their own)
```

The multi-file source is the real project. `dist/` is generated output and isn't committed.

Rebuild the era maps from the source datasets (downloads them into `data/raw/` on first run; needs `npm install` for mapshaper, d3-delaunay and polygon-clipping). The output in `data/eras/` is committed, so playing doesn't need this:

```bash
npm install
npm run build:eras          # or: node tools/build-eras.mjs ww2 modern
```

Checks: the fictional generator across 200 seeds, then every era map (province counts, every nation owns land and its capital, exact picking, symmetric adjacency):

```bash
npm test
```

## Sign-in and closed beta

The hosted game (GitHub Pages) requires sign-in through Supabase Auth: Google, Discord, Microsoft, GitHub, Twitch, X or an email magic link (Apple is shown as "Coming soon"). New players request beta access and wait for approval; the owner approves, denies or revokes them in the in-game **Admin** panel.

- `docs/SETUP.md`: step-by-step setup of GitHub Pages, the Supabase project and every sign-in provider.
- `docs/TESTERS.md`: what testers do to get in.
- `supabase/schema.sql`: the beta table, owner check, triggers and row-level security. Run it once in the Supabase SQL editor.
- `js/config.js`: the Supabase project URL and **publishable** key (public by design). Leave them empty to run without sign-in, as local development and the claude.ai preview do. Never put secret keys in any frontend file; `npm test` fails if one appears.

Screen flow: sign-in → beta gate (request access / pending / access not granted) → **main menu** (Single Player, Multiplayer and Sandbox "coming soon", Settings, Admin for the owner, Sign out) → era → nation → game. Every screen has a Back button; the in-game MENU pauses and returns to the main menu with **Resume**.

Without Supabase settings (local development, the claude.ai preview) the sign-in screen offers **Demo sign-in**, which fakes an approved owner account in that browser so the whole flow can be tried. Builds with Supabase settings never show it.

Who can do what is enforced by the database, not the browser: testers can only create and read their own row, the server fills in their name, email and provider and forces status to pending, and only the owner (matched by confirmed email) can change status. `npm run test:policies` runs these rules against a local PostgreSQL; `npm run test:e2e` runs the sign-in flow in a browser against a fake Supabase client.

The game's files are public on GitHub Pages, so the gate controls who can play through the site; it doesn't hide the code or map data itself.

## Map styles and settings

- **Political:** flat nation colours with terrain symbols. Roman and Medieval eras draw it as an old parchment map.
- **Satellite:** NASA Blue Marble (topography and bathymetry, August 2004) reprojected to the game's Miller projection, with extra relief shading, semi-transparent nation colours and crisp borders on top.
- **Terrain:** Natural Earth II land cover with shaded relief and thin nation borders.

Switch styles in game (bottom right); the default is in **Settings**, along with graphics quality (Low / Medium / High; Low on phones and Medium on tablets by default, and on Auto the game drops to Low by itself if panning gets choppy), UI scale and sound volume (saved for later; there's no sound yet). Rebuild the imagery with `python3 tools/build-imagery.py` (needs Pillow and NumPy; downloads are described in the script).

## Controls

| Input | Action |
|---|---|
| Drag (mouse / one finger) | Pan, with inertia |
| Scroll wheel / pinch / trackpad pinch | Zoom toward the cursor |
| WASD / arrow keys, `+` / `-` | Pan / zoom |
| Click a province | Inspect it (on the start screen, clicking picks that nation) |
| Esc | Deselect |
| Space | Pause / resume the clock |

## File structure

```
index.html        Page shell: canvas + HUD markup (top bar, panel, status bar, start screen)
styles.css        Tactical HUD theme, responsive layout
package.json      npm start / npm test
data/eras/        Prebuilt era maps (one JSON per era, ~0.6–1.4 MB each; gzip ~0.2–0.4 MB)
assets/           satellite.webp, terrain.webp (4096×2051, Miller projection)
tools/
  build-eras.mjs  Real borders → playable era maps (see "Era data" below)
  era-config.mjs  Per-era sovereignty fixes, names, major powers, capitals, city lists
  check-map.mjs   Fictional generator checks across many seeds
  check-eras.mjs  Era map checks
  build-imagery.py  Reprojects Blue Marble and Natural Earth rasters into assets/
  bundle.mjs      Inlines everything (code, CSS, gzip'd era data, imagery) into one HTML file (dist/)
docs/             SETUP.md (hosting + Supabase + providers), TESTERS.md
supabase/
  schema.sql      Beta table, owner check, triggers, row-level security
  test/           Policy tests on plain PostgreSQL with a mock auth schema
vendor/           @supabase/supabase-js 2.117.3 (UMD, MIT), loaded only when sign-in is on
privacy.html, terms.html   Linked from the sign-in screen and provider consent screens
js/
  config.js       Supabase URL + publishable key, provider list
  auth.js         Supabase client wrapper: sign-in, beta row, realtime, admin queries
  launcher.js     Sign-in screen (incl. preview demo sign-in), beta gate screens, admin panel
  menu.js         Main menu, era/nation/settings screens, Back navigation
  settings.js     Saved settings and device-based quality defaults
  assets.js       Loads map imagery on demand
  brand-icons.js  Provider logos (simple-icons, CC0)
  main.js         Bootstrap + game loop; era loading; camera framing; `systems` hook
  eras.js         Era list (labels, start dates) and era data loading
  world.js        Decodes an era file into the runtime map (same shape as map.js output)
  projection.js   Miller projection, lat/lon formatting, graticule (shared with the build)
  map.js          Fictional world generation (no DOM): seeded RNG, noise, Voronoi,
                  land/terrain, nations, cities, names, borders, picking
  state.js        GameState + event emitter: the single source of truth;
                  all mutations go through methods that emit events
  render.js       Canvas renderer: cached static layer, level of detail, culling,
                  chunked borders, terrain patterns, labels without overlaps; drawFlag()
  camera.js       Camera (smooth zoom, inertia, fly-to, clamping) and
                  InputController (pointer events, pinch, wheel, keys)
  ui.js           DOM HUD: start screen, top bar/clock, province panel, status bar
```

## Data model (from `generateMap(seed)`)

- `provinces[]`: `id, name, center, site, polygon, area, neighbors[] (land), seaNeighbors[], coastal, terrain, isCity, isCapital, owner, landmass, elevation`
- `nations[]`: `id, name, shortName, color, flag {pattern, colors}, capitalId`
- `seaZones[]`: `id, center, polygon, neighbors[], coastalProvinces[]` (ready for naval movement)
- `borders[]`: shared edge segments (`land` province↔province, `coast` province↔sea)
- `TERRAIN`: per-terrain `moveCost` (already used for territory growth) and `defense` (a placeholder for combat)

## Extending in later steps

- **Simulation systems** (economy, units, AI, research): add an object with `update(state, gameHours)` to `systems` in `main.js`. It runs every frame with the in-game hours elapsed (0 while paused).
- **State changes:** add methods to `GameState` that mutate data and `emit` an event. `setOwner()` is the template: the renderer rebuilds borders and colours on `province:owner`, and the panel re-renders.
- **New map layers** (units, fronts, supply lines): draw them in `Renderer.render()` between the province layer and the screen-space overlay. Call `renderer.requestRender()` whenever they change.
- **Pathfinding:** `province.neighbors` plus `TERRAIN[...].moveCost`. The `MinHeap` in `map.js` is ready to reuse.

## Era data

| Era | Source | Data year used | License |
|---|---|---|---|
| Roman Empire (AD 117) | [historical-basemaps](https://github.com/aourednik/historical-basemaps) | 100 (no 117 file exists) | GPL-3.0 |
| Medieval (1200) | historical-basemaps | 1200 | GPL-3.0 |
| World War I (1914) | historical-basemaps | 1914 | GPL-3.0 |
| World War II (1939) | historical-basemaps | 1938 (no 1939 file exists) | GPL-3.0 |
| Cold War (1960) | historical-basemaps | 1960 | GPL-3.0 |
| Modern | [Natural Earth](https://www.naturalearthdata.com) 1:10m admin-1 regions (states, provinces) and 1:50m countries | current release | Public domain |
| City points for 20th-century eras and Modern | Natural Earth 1:50m populated places | — | Public domain |
| Satellite imagery | [NASA Blue Marble Next Generation](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/) | August 2004 | Public domain |
| Terrain imagery and relief | Natural Earth II and shaded relief, 1:50m rasters | — | Public domain |

How a map is built (`tools/build-eras.mjs`):

1. **Sovereignty:** each feature is grouped under its ruler (historical-basemaps `SUBJECTO`, Natural Earth `SOVEREIGNT`), so colonies belong to their empire (British Raj → United Kingdom in 1914). A few manual fixes are in `era-config.mjs` (`aliases`), for example the German colonies in 1914. Features that name a people or culture rather than a state ("Khoisan", "Paleo-Siberian hunter-gatherers") become unclaimed land that keeps the name as a region label.
2. **Geometry:** mapshaper cleans, dissolves by ruler, simplifies to 12% and clips to 58°S–84°N (Antarctica cut). Then the Miller projection is applied.
3. **Provinces (historical eras, ~3,600 each):** each country gets seeds in proportion to area^0.68 (unclaimed land at 30% weight), with a minimum of one, and every sizeable island gets its own. Real cities are fixed seeds, so every city sits in its own province. The Voronoi cells are clipped to the country's real outline.
   **Provinces (modern, ~4,000):** real admin-1 regions with their names. Countries the dataset splits very finely (the UK's local authorities, Slovenia's municipalities…) use the dataset's own region grouping when that's closer to their province budget; regions too small to click merge into the nearest region of the same country; very large ones (Siberian oblasts, Australian states, Canadian territories) are split into seeded parts named by direction ("Krasnoyarsk Krai North").
4. **Adjacency:** every province edge records what lies across it: another province, or a sea zone (Voronoi cells of ocean sample points, kept for naval units).
5. **Terrain:** mountains come from about 35 real ranges, forests from climate bands, and cities are often urban.

The GPL-3.0 license of historical-basemaps applies to the generated files in `data/eras/` (except `modern.json`) and to the single-file build that embeds them. Keep the attribution, which the start screen also shows.
