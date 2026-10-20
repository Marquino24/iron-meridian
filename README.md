# Iron Meridian

A browser-based real-time grand strategy game. Vanilla JavaScript (ES modules) and HTML Canvas, with no frameworks and no build step.

**Current scope (step 5):** real-world maps in seven eras, sign-in and closed beta, armies, war and conquest, era resources, city buildings, research, command windows, and computer nations that build, research, recruit, go to war and make peace.

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

## Armies, war and economy

**Resources.** Each era has its own set:

| Eras | Resources |
|---|---|
| Roman, Medieval | Gold, Grain, Iron, Manpower |
| WWI, WWII | Money, Food, Steel, Oil, Manpower |
| Cold War, Modern, Fictional | Money, Food, Steel, Oil, Electronics, Manpower |

Every province yields daily: money 10 × share and manpower 120 × share (share: land 1, city 3, capital 5; the map has no population data, so population follows the same shares), food 8 × fertility (plains 1.5, forest 1, urban 0.6, mountains 0.5), iron/steel 2 × share (+4 in mountains), oil 8 on an oil deposit, electronics 3 × (share − 1) from cities. Buildings add to that, Roads multiply the province's output, and a nation whose capital is held by an enemy produces at half rate. Oil deposits are about 35 real oil regions (Baku, Ploiești, the Persian Gulf, Texas, Maracaibo, Sumatra…) placed on the province that contains them; the Fictional World gets random ones. Income arrives every game hour; hover or tap the resource bar for the breakdown per resource. Everyone starts with about ten days of income plus a stockpile (300 oil, so nations without oil can still field some tanks). Armies have no upkeep yet.

**Buildings** (cities only, levels I–III; cost ×1 / ×2 / ×3.5 and time ×1 / ×1.5 / ×2 per level; one construction per city at a time, paid up front, refunded if cancelled; a captured city keeps its buildings but loses the construction):

| Building | Effect per level | Era names |
|---|---|---|
| Farm | +20 / 40 / 70 food | Latifundium, Manor Farm, Farms, Agriculture |
| Mine / Factory | +10 / 20 / 35 iron or steel; a Factory also +20 / 40 / 70 money, and from the Cold War +4 / 8 / 14 electronics | Iron Mine, Factory |
| Oil Well | +15 / 30 / 50 oil; WWI on, oil-deposit provinces only (the one building allowed outside cities) | Oil Well, Oil Field |
| Barracks | I: infantry, II: + ranged, III: + mobile units; II and III train 15% / 30% faster | Castra, Barracks, Military Base |
| Port | coastal only; needed for ships, II and III build them faster | Harbor, Port, Naval Base |
| Fortifications | +25% defense per level for whoever defends the province | Walls, Castle Walls, Fortifications |
| Roads | +10% output per level, and 15% / 30% / 45% faster movement through the province | Roman Roads, Roads, Railways, Infrastructure |

Starting buildings: capitals have Barracks II, a Mine/Factory, a Farm and (if coastal) a Port; one other city in three has Barracks I (and a Port if coastal).

**Command windows.** The command bar (bottom centre; a bottom row on phones) opens three windows that float over the map (drag them by the title bar; on phones they're full-screen sheets, one at a time). The game keeps running underneath. Shortcuts: **A** Army, **P** Production, **B** Buildings, **Esc** closes the top one. Map panning by keyboard uses the arrow keys.
- **Army:** totals per unit type, then every army and fleet with location, units by type, HP and status (idle, moving, in battle, embarked, occupying, retreating). Filter and sort; click a row to fly there and select it.
- **Production:** every city with its recruit queue and construction (progress bars). Bulk recruit: pick a unit and a quantity per city, tick cities (Select all / All with Barracks), see the total cost, confirm. Bulk build works the same for buildings. Cities that can't do it are greyed out with the reason (needs Barracks III, not coastal, already building…).
- **Buildings:** cities as rows, buildings as columns, levels as pips. Tap a cell for the next level's effect, cost and time, then upgrade; tick rows to upgrade one building type in all of them.

The city panel keeps quick single-city actions in **Recruit** and **Build** tabs.

**Research** (window **R**). Each era has its own 28-tech tree in three tiers across Military (10), Economy (9) and Infrastructure (9), themed per era (Roman: Iron Working, Aqueducts, Professional Legions; Medieval: Heavy Plough, Castles, Crossbows; WWI: Machine Guns, Trench Warfare, Railways; WWII: Radar, Blitzkrieg Doctrine, Synthetic Fuel; Cold War: Jet Engines, Satellites, Nuclear Deterrence (a defense bonus, nothing more); Modern: Drones, Cyber Defense, Precision Strikes; the Fictional World uses Modern). All eras share one skeleton of effects and requirements so balance carries across; `docs/TECH.md` lists every era's tree (regenerate with `node tools/print-tech.mjs`).
- **Cost and time:** tier I 400 money, 120 food, 80 steel and 150 game hours (2½ real minutes at 1×); tier II 1,500 / 400 / 300 plus 40 oil and 60 electronics where the era has them, 540 h (9 min); tier III 4,000 / 1,000 / 800 plus 120 oil and 200 electronics, 1,260 h (21 min). Paid when the tech starts; cancelling refunds.
- **Slots and queue:** one slot to start; the tier I Economy tech (Census and Scribes, Monastic Scriptoria, General Staff Office, Operational Research, Mainframe Computers, Supercomputing) opens a second and the tier III one (Imperial Bureaucracy, Universities, Research Laboratories, Big Science, Military-Industrial Complex, AI Research) a third. Up to 5 techs wait in a queue (a tech can be queued behind its own requirements); the first one that's ready and affordable starts by itself when a slot frees up. The Research button shows a badge while a slot is idle.
- **Effects** (they change the real numbers; the Bonuses tab lists everything active with its source techs):
  - unit levels 2 and 3 per role: +15% / +30% attack, defense and HP. New recruits come at the researched level; existing units upgrade when they rest in a city with Barracks (fleets next to a city with a Port), paying 20% of their price (not men or food) per level;
  - level III of every building needs its tech (each building stops at level II until then), including Barracks III (mobile units) and Port III;
  - production +10–25% per resource and +10% everything; Synthetic Fuel (and its era twins) turns 15% of steel output into oil, so oil-poor nations aren't stuck;
  - movement +10/+10/+15%, defense +10% twice, mobile attack +10%, recruitment 15% faster, construction 20% faster and 20% cheaper.
- **Balance:** at 1×, a medium nation that keeps the queue full while spending half its income elsewhere finishes the whole tree in about 2.4–2.6 real hours (`npm test` runs this per era). Tier I techs take minutes.
- **Feedback:** a toast and an event-feed entry when research completes, with its effects.

**Clock.** 1 real second = 1 game hour at 1×; pause / 1× / 2× / 4×.

**Units.** Each era has four units in the same four roles, rock-paper-scissors style: infantry beats mobile, mobile beats ranged, ranged beats infantry (×1.5 damage, ×0.67 the other way). Ships move only through sea zones.

| Era | Infantry | Mobile | Ranged | Naval |
|---|---|---|---|---|
| Roman | Legion | Cavalry | Archers | Trireme |
| Medieval | Men-at-arms | Knights | Longbowmen | Cog |
| WWI | Infantry | Cavalry | Artillery | Dreadnought |
| WWII | Infantry | Tank | Artillery | Destroyer |
| Cold War | Mech Infantry | Main Battle Tank | Artillery | Frigate |
| Modern / Fictional | Infantry | MBT | Rocket Artillery | Destroyer |

Full stats are in `js/units.js` (attack, defense, HP, speed in km/h, cost in era resources, base build hours). Infantry costs mostly money, food and men; mobile units need iron/steel and (WWI on) oil; ranged units need steel; ships need steel, oil and (Cold War on) electronics.

**Armies.** Every nation starts with a garrison in its capital (bigger nations, bigger garrison) and in up to 12 cities; coastal major powers get a home fleet. The player also gets 1–3 field armies near its borders. Click a counter to open its panel (units with HP, split selected / split in half, merge with armies in the same place, stop), then click a province to march there. The route follows neighbouring provinces (fastest by distance × terrain move cost ÷ the slowest unit's speed) and shows its ETA, also as a preview while you hover. From a coastal province an army can embark into a sea zone and land on another coast: slow (era transport speed, 6 h to board and 6 h to land) and weak if caught at sea (¼ attack, ½ defense).

**Recruiting.** In a city you own, the province panel's Recruit tab lists the era's units with stats, cost and build time (or why the city can't build it). Land units need Barracks and ships a Port (see Buildings). Cost is paid when queued (cancel refunds it); each city trains one unit at a time. Finished units appear there as a new army (units finishing in a row join it); ships appear in the adjacent sea zone. A captured city loses its queue.

**War.** Click any foreign province to see its nation and **Declare war** (with a confirmation). Your armies can't enter a nation's land unless you're at war with it; unclaimed land is open to anyone.
- An army entering enemy (or unclaimed) land with no enemy army there occupies it: 6 h, 12 h for a city, 24 h for a capital (progress ring on the map). Moving on resets it. An army on a longer route stops to take each enemy province it passes, then carries on.
- If enemy armies are there, a battle starts (crossed swords). Every game hour each unit hits a random enemy unit for `8 × attack × matchup ÷ (defense × terrain) × random 0.75–1.25`; terrain (forest 1.25, urban 1.4, mountains 1.6) protects only the defender, and damaged units hit softer. Below 20% strength an army retreats to a safe neighbouring province (or fights on if there's none). The battle ends when one side has no armies left.
- Taking a capital halves that nation's production. A nation that loses its last province is conquered, and its remaining armies disband.
- AI nations don't act yet; their garrisons defend and retreat.

**Feedback.** The event feed (bottom left) lists wars, battles, captures and finished units; click an entry to open its battle report (units fielded and lost on each side) or fly to the place. Clicking crossed swords opens the live report.

`npm test` includes `tools/check-war.mjs`, a headless run of the simulation: the German Reich conquering Czechoslovakia (9 provinces, about 20 game days = 8 real minutes at 1×), Italy landing in Albania by sea, recruitment timing, split/merge, capital loss, and spawning plus pathfinding in every era. `tools/e2e/war.test.mjs` plays the same war through the UI in a browser (desktop and phone), `tools/e2e/research.test.mjs` the research window, and `tools/e2e/windows.test.mjs` drives the other command windows (`ERA=modern NATION="United States"` to try another nation).

## Computer nations (AI)

Every nation you don't play runs `js/ai.js`. Each has a personality: **Aggressive**, **Balanced**, **Defensive** or **Expansionist**. Some are set by era (WWII Germany, Japan and Italy Aggressive, the USSR Expansionist; the Roman and Han empires Expansionist; the Mongols Aggressive…), the rest are drawn at random (seeded by name). The nation panel shows a nation's personality, army strength and current wars.

- **Economy:** farms when food runs short, mines/factories for production, barracks in border cities, a port if coastal, forts on threatened borders (and more often for Defensive nations), roads in the capital. It keeps a reserve and spends the military share of its treasury on the army.
- **Research:** the same trees and queue as yours, in personality order (Aggressive: military first; Expansionist: economy; Defensive: infrastructure).
- **Army:** recruits a mix (half infantry, the rest ranged and mobile where barracks allow, a few ships for coastal major powers) in proportion to its economy, 1.5× when at war. New units top up the local garrison (capital 3, border cities 1–2), the rest form field armies that gather at a border city facing the likeliest target.
- **War:** a nation declares war on a neighbour (or, for major powers, a nation across a shared sea zone) when its army is clearly stronger: 1.4× for Aggressive, 1.8× Balanced, 2.8× Defensive, 1.5× Expansionist, lower when the neighbour holds its former land. The chance is per month (Aggressive 30%, Expansionist 18%, Balanced 8%, Defensive 2%; minor nations 30% of that; the world wars 1.2×, the Cold War 0.6×, Modern 0.4×). At war it attacks enemy provinces next to its land (and its own lost provinces) with whole armies (3+ units, stronger than the defenders), scoring targets by value (capital 6, city 3, province 1, own former land ×2), defence and distance. Damaged armies (under 45%) fall back to a city to heal, threatened cities get the nearest army or new recruits, small armies walk to the biggest one to combine. Expansionist nations also march into unclaimed land.
- **Peace:** a nation that is losing (provinces gone and a weaker army, or badly outmatched) or stuck in a long stalemate offers a **white peace**: provinces taken in that war return to their pre-war owner, armies withdraw home, and a 90-day truce follows. AI nations accept unless they're clearly winning; you get a popup to accept or decline. You can offer peace too (nation panel, **Offer white peace**).
- **Healing:** armies resting on their own land recover 3% of their strength per hour in a city, 1% elsewhere.

**Difficulty** (nation screen): **Easy** AIs think 1.6× less often, start half as many wars, need a bigger edge and produce 10% less; **Hard** AIs think more often, pick the weakest-defended high-value targets, attack only with a clear edge, and produce 15% more.

**Feedback:** an AI declaring war on you pauses the game with a full alert; other nations' wars appear in the event feed and as dashed red lines between capitals when zoomed out (toggle with **⚔ Wars** next to the map styles).

**Performance:** nations think on a staggered schedule (major powers every 12 game hours, nations of 25+ provinces daily, 6+ every two days, the smallest every three), each think is split into small steps, and every frame works through the due ones until a time budget runs out (3 ms, shrinking to 0.5 ms and every third frame on a struggling device). The economy updates incrementally (a conquered province moves its cached yield to the new owner) and path searches use A*.

`npm run sim:ai` (`tools/sim-ai.mjs [months] [easy|normal|hard] [era…]`) runs every nation headless for six months and reports growth, wars, peace deals, conquests and the largest share of the map anyone reached.

**Economic weight.** Provinces were cut roughly by land area, so counting them made colonial empires and Siberia huge and compact industrial powers small (WWII Germany earned 410 a day against France's 1,930). `js/development.js` now gives every province a development value: colonies and far frontiers (more than 1,500 km from the capital and not linked to it by land within 4,500 km) produce 0.35×, polar land 0.35×, other nations scale with the square root of their size, and each era's major powers are scaled to their real GDP and population (Maddison-style estimates). The value stays with the province when it's conquered. The 20th-century maps were also rebuilt with each major power's real cities (`majorCities` in `tools/era-config.mjs`; WWII Germany went from 2 cities to 15). `node tools/print-economies.mjs` lists the largest economies per era.

## Map styles and settings

- **Political:** vivid nation colours with terrain symbols, a soft glow along borders, your nation outlined in glowing gold, and a blue ocean with wave crests. Roman and Medieval eras draw it as an old parchment map.
- **Satellite:** NASA Blue Marble (topography and bathymetry, August 2004) reprojected to the game's Miller projection, with extra relief shading, semi-transparent nation colours and crisp borders on top.
- **Terrain:** Natural Earth II land cover with shaded relief and thin nation borders.
- **Clouds** (satellite only, toggle on the style bar): soft clouds with ground shadows that thin out as you zoom in. The menus fly over the satellite map with clouds.

Switch styles with the big Political / Satellite / Terrain buttons (top right, always on screen); the default is in **Settings**, along with graphics quality, UI scale and sound volume.

Graphics quality sets the effects (everything is drawn in code; there are no image files besides the two map rasters):

| | Low (phones) | Medium (tablets) | High (desktop) |
|---|---|---|---|
| Wave crests on the ocean | — | moving, ~12 fps | moving, ~30 fps |
| Clouds | still (baked into the map) | still, with shadows | drifting, with shadows |
| Battle sparks and explosions | still badge | animated | animated |
| Border glow, gold glow on your nation, terrain symbols | — | yes | yes |
| Resolution cap | 1× | 1.5× | 2× |

On Auto the game steps down one level (High → Medium → Low) for the session if frames stay under ~45 fps while you pan or the clock runs. UI scale and sound volume (saved for later; there's no sound yet). Rebuild the imagery with `python3 tools/build-imagery.py` (needs Pillow and NumPy; downloads are described in the script).

## Controls

| Input | Action |
|---|---|
| Drag (mouse / one finger) | Pan, with inertia |
| Scroll wheel / pinch / trackpad pinch | Zoom toward the cursor |
| Arrow keys, `+` / `-` | Pan / zoom |
| Click a province | Inspect it (on the start screen, clicking picks that nation) |
| Click an army marker | Select it; then click a province or sea zone to move, or an enemy marker to attack it |
| Shift + drag (desktop) / hold two fingers still, then spread them (phone, tablet) | Box selection: picks every army of yours inside; the next click moves them all (bar at the bottom: Halt / Clear) |
| Click a merged badge (zoomed out) | Zooms in to split it; your own badge also selects those armies |
| Click crossed swords / a feed entry | Battle report |
| A / P / B / R | Army / Production / Buildings / Research window |
| Esc | Close the top window, else deselect (army first, then province) |
| Space | Pause / resume the clock |

## File structure

```
index.html        Page shell: canvas + HUD markup (top bar, panel, status bar, start screen)
styles.css        HUD theme with era palettes (body[data-theme]), responsive layout
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
  units.js        Era rosters (unit stats) and the rock-paper-scissors matchups
  economy.js      Era resources per nation: stockpiles, daily income with breakdown, capital-lost penalty
  armies.js       Armies and fleets: spawning, land+sea movement graph, pathfinding,
                  marching, split/merge, recruitment queues
  combat.js       Wars, hourly battles, retreats, occupation, capture, conquest
  render-units.js Army markers (era unit icon, nation ring, count, HP bar), merged badges when zoomed out,
                  route arrows with ETA, animated battle clash, occupation rings, box selection, hit testing
  render-fx.js    Ocean, wave crests, clouds, city and capital badges (cached sprites)
  icons.js        Every icon as SVG paths: resources, units per era, buildings, HUD (inline SVG + canvas)
  palette.js      Vivid nation colours from the era data's muted ones
  command-ui.js   Money/manpower bar, army panel, recruit/war sections of the province panel
  feed.js         Event feed and battle report popup
  resources.js    Era resource sets, province yields, oil deposits
  buildings.js    City buildings: levels, effects, construction queue, era names
  ui-kit.js       Shared HUD helpers (number/time formatting, cost chips)
  windows.js      Command bar and window manager (drag, z-order, phone sheets, shortcuts)
  win-army.js     Army window
  win-production.js  Production and Buildings windows (bulk recruit / build)
  tech.js         Era tech trees (shared skeleton + era names, costs per tier)
  research.js     Research per nation: slots, progress, effect queries used by the other systems
  win-research.js Research window (tree view with requirement lines, details)
  development.js  Province development: real economic weight per era, colonies, polar land
  ai.js           Computer nations: personalities, difficulty, staggered thinking
  diplomacy-ui.js War alerts and peace offers
```

## Data model (from `generateMap(seed)`)

- `provinces[]`: `id, name, center, site, polygon, area, neighbors[] (land), seaNeighbors[], coastal, terrain, isCity, isCapital, owner, landmass, elevation`
- `nations[]`: `id, name, shortName, color, flag {pattern, colors}, capitalId`
- `seaZones[]`: `id, center, polygon, neighbors[], coastalProvinces[]` (ready for naval movement)
- `borders[]`: shared edge segments (`land` province↔province, `coast` province↔sea)
- `TERRAIN`: per-terrain `moveCost` (already used for territory growth) and `defense` (a placeholder for combat)

## Extending in later steps

- **Simulation systems** (AI next): add an object with `update(state, gameHours)` to `systems` in `main.js`, next to the economy, armies and combat. It runs every frame with the in-game hours elapsed (0 while paused). An AI can use the same calls the UI does: `armies.order()`, `armies.recruit()`, `combat.declareWar()`.
- **State changes:** add methods to `GameState` that mutate data and `emit` an event. `setOwner()` is the template: the renderer rebuilds borders and colours on `province:owner`, and the panel re-renders.
- **New map layers** (fronts, supply lines): draw them in `Renderer.render()` between the province layer and the screen-space overlay, as `render-units.js` does. Call `renderer.requestRender()` whenever they change.

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
