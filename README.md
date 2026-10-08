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

To open a specific map, add the seed to the URL: `http://localhost:3000/?seed=ABCD-1234`. The URL updates whenever a new map is generated, so you can share a link or reload and get the same map.

Single-file build (all JS and CSS inlined; Google Fonts with a system-font fallback):

```bash
npm run bundle       # → dist/iron-meridian.html (opens straight from disk, no server needed)
                     #   dist/iron-meridian.fragment.html (same, without <html>/<head>/<body>, for hosts that add their own)
```

The multi-file source is the real project. `dist/` is generated output and isn't committed.

Map generation sanity check (200 seeds; checks land counts, connected nations, symmetric adjacency, city ratio, picking, unique names and determinism):

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
tools/
  check-map.mjs   Headless generator checks across many seeds
  bundle.mjs      Inlines everything into one HTML file (dist/)
js/
  main.js         Bootstrap + game loop; wires modules; camera framing; `systems` hook
  map.js          Pure world generation (no DOM): seeded RNG, noise, Voronoi,
                  land/terrain, nations, cities, names, borders, picking
  state.js        GameState + event emitter: the single source of truth;
                  all mutations go through methods that emit events
  render.js       Canvas renderer: cached Path2D layers, terrain patterns,
                  borders, hover/selection, icons, labels; drawFlag()
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
