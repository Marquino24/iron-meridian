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
data/eras/        Prebuilt era maps (one JSON per era, ~250–370 KB each)
tools/
  build-eras.mjs  Real borders → playable era maps (see "Era data" below)
  era-config.mjs  Per-era sovereignty fixes, names, major powers, capitals, city lists
  check-map.mjs   Fictional generator checks across many seeds
  check-eras.mjs  Era map checks
  bundle.mjs      Inlines everything (code, CSS, all era data) into one HTML file (dist/)
js/
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
| Modern | [Natural Earth](https://www.naturalearthdata.com) 1:50m Admin-0 | current release | Public domain |
| City points for 20th-century eras and Modern | Natural Earth 1:50m populated places | — | Public domain |

How a map is built (`tools/build-eras.mjs`):

1. **Sovereignty:** each feature is grouped under its ruler (historical-basemaps `SUBJECTO`, Natural Earth `SOVEREIGNT`), so colonies belong to their empire (British Raj → United Kingdom in 1914). A few manual fixes are in `era-config.mjs` (`aliases`), for example the German colonies in 1914. Features that name a people or culture rather than a state ("Khoisan", "Paleo-Siberian hunter-gatherers") become unclaimed land that keeps the name as a region label.
2. **Geometry:** mapshaper cleans, dissolves by ruler, simplifies to 12% and clips to 58°S–84°N (Antarctica cut). Then the Miller projection is applied.
3. **Provinces:** each country gets seeds in proportion to area^0.68 (unclaimed land at 30% weight), with a minimum of one, and every sizeable island gets its own. Real cities are fixed seeds, so every city sits in its own province. The Voronoi cells are clipped to the country's real outline.
4. **Adjacency:** every province edge records what lies across it: another province, or a sea zone (Voronoi cells of ocean sample points, kept for naval units).
5. **Terrain:** mountains come from about 35 real ranges, forests from climate bands, and cities are often urban.

The GPL-3.0 license of historical-basemaps applies to the generated files in `data/eras/` (except `modern.json`) and to the single-file build that embeds them. Keep the attribution, which the start screen also shows.
