/**
 * main.js — Bootstrap and game loop.
 *
 * Wires together:  GameState (state.js) ← UI (ui.js)
 *                       ↓ events
 *                  Renderer (render.js) ← Camera/Input (camera.js)
 *                       ↑
 *                  generateMap (map.js)
 *
 * Adding later systems: push an object with `update(state, gameHours)` into
 * `systems` (e.g. economy, unit movement, AI, research). They run every frame
 * with the in-game hours elapsed (0 while paused or on the start screen).
 */

import { generateMap, randomSeed, pickProvince } from './map.js';
import { buildWorldMap } from './world.js';
import { ERAS, DEFAULT_ERA, getEra, loadEraData } from './eras.js';
import { GameState } from './state.js';
import { Renderer } from './render.js';
import { Camera, InputController } from './camera.js';
import { UI } from './ui.js';
import { AuthService, DemoAuthService, authEnabled } from './auth.js';
import { Settings } from './settings.js';
import { Screens } from './menu.js';
import { loadImagery } from './assets.js';
import { Launcher } from './launcher.js';
import { Economy } from './economy.js';
import { Armies } from './armies.js';
import { Combat } from './combat.js';
import { CommandUI } from './command-ui.js';
import { Feed } from './feed.js';
import { hitTest } from './render-units.js';
import { svgIcon, setIconEra } from './icons.js';
import { preloadFlags, onFlagsLoaded } from './flags.js';
import { Buildings } from './buildings.js';
import { WindowManager } from './windows.js';
import { ArmyWindow } from './win-army.js';
import { ProductionWindow, BuildingsWindow } from './win-production.js';
import { Research } from './research.js';
import { ResearchWindow } from './win-research.js';
import { AI } from './ai.js';
import { DiplomacyUI } from './diplomacy-ui.js';
import { Sandbox } from './sandbox.js';
import { Diplomacy } from './diplomacy.js';
import { Victory } from './victory.js';
import { VictoryUI } from './victory-ui.js';
import { DiplomacyWindow } from './win-diplomacy.js';
import { SandboxUI } from './sandbox-ui.js';

const canvas = document.getElementById('map-canvas');
const state = new GameState();
const camera = new Camera();
const renderer = new Renderer(canvas, camera, state);

// Simulation: economy → recruitment and movement → battles and occupation.
const economy = new Economy(state);
const buildings = new Buildings(state, economy);
const armies = new Armies(state, economy);
armies.buildings = buildings;
const combat = new Combat(state, armies);
const research = new Research(state, economy);
research.armies = armies;
research.buildings = buildings;
armies.research = research;
buildings.research = research;
const sim = { economy, buildings, armies, combat, research };
const ai = new AI(state, sim);
sim.ai = ai;
const diplomacy = new Diplomacy(state, sim);
sim.diplomacy = diplomacy;
armies.diplomacy = diplomacy;
const victory = new Victory(state, sim);
sim.victory = victory;
const sandbox = new Sandbox(state, sim);
sim.sandbox = sandbox;
renderer.sim = sim;

/** Simulation systems, run in order each frame with the game hours elapsed. */
const systems = [economy, research, buildings, armies, combat, ai, sandbox, victory];

// --- Camera framing ---------------------------------------------------------

const hudEls = {
  start: document.getElementById('start-screen'),
  topbar: document.getElementById('topbar'),
  panel: document.getElementById('province-panel'),
  status: document.getElementById('statusbar'),
};

/** Screen-space margins covered by HUD panels, so framing targets the visible area. */
function hudInsets() {
  const narrow = window.innerWidth <= 760;
  const ins = { left: 0, right: 0, top: 0, bottom: hudEls.status.offsetHeight };
  if (state.phase === 'setup') {
    const panel = document.querySelector('.screen:not([hidden]) .screen-left');
    if (!narrow && panel) ins.left = panel.getBoundingClientRect().right;
  } else {
    ins.top = hudEls.topbar.offsetHeight + (narrow ? document.getElementById('resources').offsetHeight : 0);
    ins.bottom += document.getElementById('command-bar').offsetHeight;
    if (state.selectedProvinceId >= 0 || state.selectedArmyId >= 0) {
      if (narrow) ins.bottom += hudEls.panel.offsetHeight + 8;
      else ins.right = hudEls.panel.offsetWidth + 12;
    }
  }
  return ins;
}

/** Camera center that puts world point (x, y) in the middle of the visible area. */
function framed(x, y, zoom) {
  const z = camera.clampZoom(zoom);
  const i = hudInsets();
  return { x: x - (i.left - i.right) / 2 / z, y: y - (i.top - i.bottom) / 2 / z, zoom: z };
}

function focusOn(x, y, zoom, duration) {
  const f = framed(x, y, zoom);
  camera.flyTo(f.x, f.y, f.zoom, duration);
}

/** Zoom at which a typical province is `px` screen pixels across. */
const detailZoom = (px) => px / state.map.provinceScale;

/** Camera frame that fits a nation's territory into the visible area. */
function nationFrame(id) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of state.provincesOf(id)) {
    x0 = Math.min(x0, p.bbox.x0); y0 = Math.min(y0, p.bbox.y0);
    x1 = Math.max(x1, p.bbox.x1); y1 = Math.max(y1, p.bbox.y1);
  }
  if (!isFinite(x0)) return null;
  // Far-flung empires (colonies on several continents): frame the capital's region instead.
  const cap = state.getProvince(state.getNation(id).capitalId);
  const i = hudInsets();
  const vw = camera.viewW - i.left - i.right, vh = camera.viewH - i.top - i.bottom;
  let zoom = Math.min(vw / (x1 - x0 + 40), vh / (y1 - y0 + 40));
  let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (zoom < camera.refZoom * 1.2 && cap) { zoom = camera.refZoom * 1.4; cx = cap.center.x; cy = cap.center.y; }
  zoom = Math.min(zoom, detailZoom(120));
  return framed(cx, cy, zoom);
}

/** Whole map, fitted into the area not covered by HUD panels. */
function overviewFrame() {
  const map = state.map;
  const i = hudInsets();
  const zoom = Math.min((camera.viewW - i.left - i.right) / map.width, (camera.viewH - i.top - i.bottom) / map.height);
  return framed(map.width / 2, map.height / 2, zoom);
}

// --- Actions (the only place UI intent turns into camera/state side effects) ---

/** Install a freshly built map and frame it. */
function installMap(map) {
  // Real-world maps need deeper zoom (Europe's provinces are small).
  camera.setWorld(map.width, map.height, map.kind === 'world' ? 16 : 6);
  state.loadMap(map);
  const f = overviewFrame();
  camera.fit();
  camera.x = f.x;
  camera.y = f.y;
  camera.zoom = camera.targetZoom = f.zoom;
  renderer.requestRender();
  // Reflect the scenario in the URL so a reload/share reproduces it.
  // Sandboxed embeds can refuse this, which is harmless.
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('era', map.era.id);
    if (map.era.fictional) url.searchParams.set('seed', map.seed); else url.searchParams.delete('seed');
    history.replaceState(null, '', url);
  } catch { /* ignore */ }
  try { localStorage.setItem('im:era', map.era.id); } catch { /* ignore */ }
}

/** Procedural map for the "Fictional World" era. */
function loadMap(seed) {
  const s = (seed ?? randomSeed()).toUpperCase();
  const t0 = performance.now();
  const map = generateMap(s);
  map.era = getEra('fictional');
  console.info(`[map] seed ${s}: ${map.provinces.length} provinces in ${(performance.now() - t0).toFixed(0)} ms`);
  installMap(map);
}

let eraRequest = 0;
/** Load a real-world era (only that era's data is parsed). */
async function loadEra(id, seed = null) {
  const era = getEra(id);
  if (era.fictional) { loadMap(seed); return; }
  const request = ++eraRequest;
  ui.setLoading(era.id);
  try {
    const t0 = performance.now();
    const data = await loadEraData(era.id);
    if (request !== eraRequest) return; // a newer choice superseded this one
    const map = buildWorldMap(data, era);
    console.info(`[era] ${era.id}: ${map.provinces.length} provinces, ${map.nations.length} nations in ${(performance.now() - t0).toFixed(0)} ms`);
    installMap(map);
  } catch (err) {
    console.error(err);
    document.getElementById('map-stats').innerHTML = `<div class="loading-line">Could not load ${era.label}: ${err.message}</div>`;
  }
}

const settings = new Settings();

/** Picking an era opens the nation screen once its map is ready. */
async function chooseEra(id) {
  // Reuse the loaded map unless a game was already played on it.
  if (state.map?.era?.id === id && !getEra(id).fictional && !armies.started) {
    screens.show('nation');
    focusOverview();
    return;
  }
  await loadEra(id);
  if (state.map?.era?.id === id) {
    screens.show('nation');
    focusOverview();
  }
}

function focusOverview() {
  const f = overviewFrame();
  camera.flyTo(f.x, f.y, f.zoom, 0.6);
}

const ui = new UI(state, {
  selectEra: (id) => chooseEra(id),
  newMap: loadMap,
  previewNation(id) {
    const f = nationFrame(id);
    if (f) camera.flyTo(f.x, f.y, f.zoom, 0.8);
  },
  deploy(id) {
    state.setSandbox(screens.mode === 'sandbox');
    state.setPlayerNation(id);
    buildings.start();
    economy.start();
    armies.spawnInitial(id);
    ai.start(id, settings.difficulty);
    state.setFocusedNation(-1);
    screens.gameInProgress = true;
    screens.show('game');
    state.setPhase('playing');
    victory.start(victoryUI.config());
    const cap = state.getProvince(state.getNation(id).capitalId);
    state.setSelected(cap.id);
    focusOn(cap.center.x, cap.center.y, Math.max(camera.refZoom * 1.5, detailZoom(80)), 1.2);
  },
  focusProvince(id) {
    const p = state.getProvince(id);
    if (!p) return;
    state.setSelected(id);
    focusOn(p.center.x, p.center.y, Math.max(camera.zoom, detailZoom(80)), 0.6);
  },
  // In-game MENU: pause and go to the main menu (Resume brings you back).
  returnToMenu() {
    state.setSelected(-1);
    state.setSelectedArmy(-1);
    pausedSpeed = state.clock.speed;
    state.setSpeed(0);
    state.setPhase('setup');
    screens.show('menu');
    menuCamera();
  },
});

// --- Orders, notices, event feed ---

const toastEl = document.getElementById('toast');
let toastTimer = 0;
/** Short message near the top of the map (order errors, confirmations). */
function notice(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2800);
}

function orderMove(army, node) {
  const r = armies.order(army.id, node);
  if (r.error) notice(r.peace != null ? `${r.error} Open one of its provinces to do it.` : r.error);
  armies.preview = null;
  renderer.requestRender();
}

/** Your armies picked together (box selection) that still exist. */
function commandGroup() {
  const g = state.armyGroup;
  if (!g) return [];
  return [...g].map((id) => armies.list.get(id)).filter((a) => a && a.nation === state.playerNationId);
}

/** Send every army of a group; `nodeFor(army)` picks each one's target (fleets need sea zones). */
function orderGroup(group, nodeFor) {
  let sent = 0, firstError = null;
  for (const a of group) {
    const node = nodeFor(a);
    if (node < 0) { firstError ??= a.kind === 'naval' ? 'Fleets can only sail through sea zones.' : 'Pick a province or a sea zone.'; continue; }
    const r = armies.order(a.id, node);
    if (r.error) firstError ??= r.error; else sent++;
  }
  armies.preview = null;
  notice(sent ? `${sent} of ${group.length} armies on the move.${firstError && sent < group.length ? ` Others: ${firstError}` : ''}` : firstError ?? 'No army could go there.');
  renderer.requestRender();
}

/** Fly the camera to a province or sea zone without changing the selection. */
function focusNode(node) {
  const p = armies.pos?.[node];
  if (!p) return;
  focusOn(p.x, p.y, Math.max(camera.zoom, detailZoom(70)), 0.6);
}

const feed = new Feed(state, sim, { focusNode });
ui.command = new CommandUI(state, sim, {
  focusNode,
  openBattle: (id) => feed.open(id),
  rerender: () => { ui.renderProvincePanel(); renderer.requestRender(); },
  notice,
});

/** Select an army and fly to it (Army window rows). */
function selectArmy(id) {
  const a = armies.list.get(id);
  if (!a) return;
  state.setSelected(-1);
  state.setSelectedArmy(id);
  const p = armies.armyPos(a);
  focusOn(p.x, p.y, Math.max(camera.zoom, detailZoom(70)), 0.6);
}

/** Open a city's panel from a window (on phones the window makes way for it). */
function openCity(id) {
  if (window.innerWidth <= 760) windows.closeAll();
  ui.actions.focusProvince(id);
}

const windows = new WindowManager(state, [
  new ArmyWindow(state, sim, { selectArmy, closeWindow: (id) => windows.close(id) }),
  new ProductionWindow(state, sim, { notice, openCity }),
  new BuildingsWindow(state, sim, { notice, openCity }),
  new ResearchWindow(state, sim, { notice }),
  new DiplomacyWindow(state, sim, {
    notice,
    focusNation(id) {
      const cap = state.getProvince(state.getNation(id)?.capitalId);
      if (cap) focusOn(cap.center.x, cap.center.y, Math.max(camera.zoom, camera.refZoom * 1.5), 0.8);
    },
  }),
]);

// Research button badge: idle slots while there's something you could research.
let badgeTimer = 0;
function updateBadges(dt) {
  badgeTimer += dt;
  if (badgeTimer < 0.5) return;
  badgeTimer = 0;
  const me = state.playerNationId;
  if (state.phase !== 'playing' || me < 0) { windows.setBadge('research', ''); return; }
  const idle = research.idle(me);
  const any = research.tree.some((t) => research.status(me, t.id) === 'available');
  windows.setBadge('research', idle && any ? String(idle) : '', `${idle} research slot${idle === 1 ? '' : 's'} idle`);
}

// A small toast when research completes (the feed keeps the details).
state.events.on('feed', (e) => { if (e.toast) notice(e.toast); });

new DiplomacyUI(state, sim, { focusNode, notice });

// Win conditions: setup choice, score widget, leaderboard, end screen.
const victoryUI = new VictoryUI(state, sim, {
  settings,
  toMenu: () => ui.actions.returnToMenu(),
  focusNation(id) {
    const cap = state.getProvince(state.getNation(id)?.capitalId);
    if (cap) focusOn(cap.center.x, cap.center.y, Math.max(camera.zoom, camera.refZoom * 1.5), 0.8);
  },
});

// Sandbox toolbar (only shown in sandbox games).
const sandboxUI = new SandboxUI(state, sim, {
  notice,
  pickProvince: (x, y) => pickProvince(state.map, x, y),
  focusNation(id) {
    const cap = state.getProvince(state.getNation(id)?.capitalId);
    if (cap) focusOn(cap.center.x, cap.center.y, Math.max(camera.zoom, camera.refZoom * 1.5), 0.8);
  },
});

// Difficulty (nation screen) and the war-lines toggle (map style bar).
function renderDifficulty() {
  for (const b of document.querySelectorAll('#difficulty [data-difficulty]')) {
    const on = b.dataset.difficulty === settings.difficulty;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  }
}
document.getElementById('difficulty').addEventListener('click', (e) => {
  const b = e.target.closest('[data-difficulty]');
  if (b) { settings.set('difficulty', b.dataset.difficulty); renderDifficulty(); }
});
renderDifficulty();
const warLinesBtn = document.getElementById('btn-war-lines');
function renderWarLines() {
  renderer.showWarLines = settings.values.warLines !== false;
  warLinesBtn.classList.toggle('active', renderer.showWarLines);
  warLinesBtn.setAttribute('aria-pressed', String(renderer.showWarLines));
  renderer.requestRender();
}
warLinesBtn.addEventListener('click', () => { settings.set('warLines', !renderer.showWarLines); renderWarLines(); });
renderWarLines();
const cloudsBtn = document.getElementById('btn-clouds');
function renderClouds() {
  const on = settings.values.clouds !== false;
  renderer.setClouds(on);
  cloudsBtn.classList.toggle('active', on);
  cloudsBtn.setAttribute('aria-pressed', String(on));
}
cloudsBtn.addEventListener('click', () => { settings.set('clouds', settings.values.clouds === false); renderClouds(); });
renderClouds();
// Army markers carry flags: redraw once an era's flag sheet arrives.
onFlagsLoaded(() => renderer.requestRender());
// Inline SVG icons wherever the markup asks for one.
for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = svgIcon(el.dataset.icon);

// Group bar: shown while several armies are picked together.
const groupBar = document.getElementById('group-bar');
function renderGroupBar() {
  const group = commandGroup();
  groupBar.hidden = group.length < 2;
  if (groupBar.hidden) return;
  const units = group.reduce((t, a) => t + a.units.length, 0);
  const moving = group.filter((a) => a.seg || a.path.length).length;
  groupBar.innerHTML = `${svgIcon('army')}<span><b>${group.length} armies</b> · ${units} units${moving ? ` · ${moving} moving` : ''}</span>
    <small>Click a destination to move them all</small>
    <button type="button" class="btn small" data-group="stop">Halt</button>
    <button type="button" class="btn small ghost" data-group="clear">Clear</button>`;
}
groupBar.addEventListener('click', (e) => {
  const b = e.target.closest('[data-group]');
  if (!b) return;
  if (b.dataset.group === 'stop') for (const a of commandGroup()) armies.stop(a.id);
  else state.setSelectedArmy(-1);
  renderGroupBar();
  renderer.requestRender();
});
state.events.on('select:group', renderGroupBar);
state.events.on('armies', () => { if (state.armyGroup) renderGroupBar(); });

const input = new InputController(canvas, camera, {
  captureDrag: () => sandboxUI.wantsDrag(),
  onPaint(sx, sy) {
    sandboxUI.paintAt(camera.screenToWorld(sx, sy));
  },
  onHover(sx, sy) {
    const w = camera.screenToWorld(sx, sy);
    const id = pickProvince(state.map, w.x, w.y);
    state.setHovered(id);
    ui.setCursor(w);
    // Route preview with ETA while one of your armies is selected.
    const sel = armies.list.get(state.selectedArmyId);
    if (sel && sel.nation === state.playerNationId && state.phase === 'playing' && !hitTest(renderer, sx, sy)) {
      armies.setPreview(sel.id, armies.targetAt(sel, id, w.x, w.y));
    } else armies.preview = null;
    renderer.requestRender();
  },
  onLeave() {
    state.setHovered(-1);
  },
  onBoxChange(box) {
    renderer.selectBox = box;
    renderer.requestRender();
  },
  onBox(box) {
    if (state.phase !== 'playing') return;
    const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1);
    const y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
    const ids = [];
    for (const h of renderer.hits) {
      const cx = (h.x0 + h.x1) / 2, cy = (h.y0 + h.y1) / 2;
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
      for (const id of h.kind === 'army' ? [h.id] : h.kind === 'cluster' ? h.ids : []) {
        if (armies.list.get(id)?.nation === state.playerNationId) ids.push(id);
      }
    }
    if (!ids.length) { notice('No armies of yours inside the box.'); return; }
    // Field armies lead; garrisons only join when nothing else was boxed.
    const field = ids.filter((id) => !armies.list.get(id).garrison);
    state.setArmyGroup(field.length ? field : ids);
    if (field.length > 1 || (!field.length && ids.length > 1)) notice(`${(field.length ? field : ids).length} armies selected. Click a destination to move them all.`);
  },
  onPan() {
    renderer.requestRender();
  },
  onClick(sx, sy) {
    const w = camera.screenToWorld(sx, sy);
    const id = pickProvince(state.map, w.x, w.y);
    if (state.phase === 'setup') {
      const owner = state.getProvince(id)?.owner ?? -1;
      if (owner >= 0) ui.choosePendingNation(owner);
      return;
    }
    if (sandboxUI.onMapClick(w, id)) return;
    const hit = hitTest(renderer, sx, sy);
    const sel = armies.list.get(state.selectedArmyId);
    const commanding = sel && sel.nation === state.playerNationId;
    const group = commandGroup();
    if (hit?.kind === 'battle') { feed.open(hit.id); return; }
    if (hit?.kind === 'cluster') {
      // Merged badge: your own ones are picked as a group; any badge zooms in to split it up.
      if (hit.nation === state.playerNationId) state.setArmyGroup(hit.ids);
      focusOn(hit.wx, hit.wy, Math.max(camera.zoom * 2.5, detailZoom(34)), 0.6);
      return;
    }
    if (hit?.kind === 'army') {
      const target = armies.list.get(hit.id);
      // With your armies selected, clicking an enemy marker attacks it.
      if (commanding && target && target.nation !== sel.nation) {
        const node = target.seg ? target.seg.to : target.node;
        if (group.length > 1) orderGroup(group, () => node); else orderMove(sel, node);
        return;
      }
      state.setSelected(-1);
      state.setSelectedArmy(hit.id === state.selectedArmyId && group.length < 2 ? -1 : hit.id);
      return;
    }
    if (commanding && group.length > 1) {
      orderGroup(group, (a) => armies.targetAt(a, id, w.x, w.y));
      return;
    }
    if (commanding) {
      const node = armies.targetAt(sel, id, w.x, w.y);
      if (node < 0) { notice(sel.kind === 'naval' ? 'Fleets can only sail through sea zones.' : 'Pick a province or a sea zone.'); return; }
      orderMove(sel, node);
      return;
    }
    if (id < 0) state.setSelectedArmy(-1);
    state.setSelected(id);
  },
});

// --- Sizing ---

new ResizeObserver(() => {
  renderer.resize();
  input.updateRect();
}).observe(canvas);
renderer.resize();

// --- Boot ---

let params = new URLSearchParams();
try { params = new URLSearchParams(window.location.search); } catch { /* ignore */ }
let savedEra = null;
try { savedEra = localStorage.getItem('im:era'); } catch { /* ignore */ }
const initialEra = [params.get('era'), params.get('seed') ? 'fictional' : null, savedEra, DEFAULT_ERA]
  .find((id) => id && ERAS.some((e) => e.id === id));
loadEra(initialEra, params.get('seed'));

// --- Settings applied to the renderer and page ---

// When quality is on Auto, watch real frame times and step down one level
// (High → Medium → Low) for this session if they stay under ~45 fps, while
// the map moves or the game runs: heavy effects go first on slower machines.
let autoLowered = false;
const motion = { time: 0, frames: 0 };
function adaptQuality(dt) {
  if (!settings.qualityIsAuto || renderer.quality === 'low') return;
  if (!renderer.cameraMoving() && !(state.phase === 'playing' && state.clock.speed > 0)) return;
  // Accumulate across gestures: ~3 s is enough to judge.
  motion.time += dt;
  motion.frames++;
  if (motion.time < 3) return;
  const avg = motion.time / motion.frames;
  motion.time = 0;
  motion.frames = 0;
  if (avg > 1 / 45) {
    autoLowered = true;
    const to = renderer.quality === 'high' ? 'medium' : 'low';
    renderer.setQuality(to);
    console.info(`[quality] ${(1 / avg).toFixed(0)} fps: switched to ${to} for this session`);
  }
}

function applySettings() {
  autoLowered = false;
  renderer.setQuality(settings.quality);
  document.documentElement.style.setProperty('--ui-scale', settings.uiScale);
}
applySettings();
let mapStyle = settings.mapStyle;
settings.onChange((key) => {
  if (key === 'mapStyle') setMapStyle(settings.mapStyle);
  applySettings();
});

/** Map style for this session (the in-game toggle); Settings holds the default. */
async function setMapStyle(style) {
  mapStyle = style;
  for (const b of document.querySelectorAll('#style-toggle [data-style]')) {
    const on = b.dataset.style === style;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  }
  renderer.setStyle(style);
  document.body.classList.toggle('style-satellite', style === 'satellite');
  if (style !== 'political' && !renderer.images[style]) {
    try { renderer.setImage(style, await loadImagery(style)); } catch (err) { console.error(err); }
  }
}
document.getElementById('style-toggle').addEventListener('click', (e) => {
  const b = e.target.closest('[data-style]');
  if (b) setMapStyle(b.dataset.style);
});
setMapStyle(mapStyle);
// The menus fly over the satellite map with clouds.
loadImagery('satellite').then((img) => { if (!renderer.images.satellite) renderer.setImage('satellite', img); }).catch(() => {});

// --- Screens: sign-in → beta gate → main menu → era → nation → game ---

let pausedSpeed = 1;
let launcher = null;
const screens = new Screens({
  settings,
  actions: {
    resume() {
      screens.show('game');
      state.setPhase('playing');
      state.setSpeed(pausedSpeed || 1);
      const cap = state.getProvince(state.playerNation?.capitalId);
      if (cap) focusOn(cap.center.x, cap.center.y, Math.max(camera.refZoom * 1.5, detailZoom(80)), 0.8);
    },
    signOut() { launcher?.signOut(); },
  },
});

/** A wide, slowly drifting view of the world behind the menus. */
function menuCamera() {
  const map = state.map;
  if (!map) return;
  camera.flyTo(map.width * 0.45, map.height * 0.42, camera.refZoom * (map.kind === 'world' ? 1.7 : 1.15), 1.0);
}
let ambientDir = 1;
function ambientPan(dt) {
  if (!screens.ambient || camera.flight || input.pointers.size) return;
  const map = state.map;
  if (!map) return;
  camera.panBy(-ambientDir * 16 * dt, 0);
  if (camera.x > map.width * 0.72) ambientDir = -1;
  if (camera.x < map.width * 0.28) ambientDir = 1;
  renderer.requestRender();
}

// Keep a newly selected army in view (on phones the panel covers the lower part of the map).
state.events.on('select:army', (id) => {
  const a = armies.list.get(id);
  if (!a || state.phase !== 'playing') return;
  requestAnimationFrame(() => {
    if (camera.flight) return; // already flying there (e.g. zooming into a merged badge)
    const p = armies.armyPos(a);
    const s = camera.worldToScreen(p.x, p.y);
    const i = hudInsets();
    const m = 40;
    // Phones: always centre it, so the land around it (where you'll tap next) is in view.
    if (window.innerWidth <= 760) focusOn(p.x, p.y, camera.zoom, 0.5);
    else if (s.x < i.left + m || s.x > camera.viewW - i.right - m || s.y < i.top + m || s.y > camera.viewH - i.bottom - m) focusOn(p.x, p.y, camera.zoom, 0.5);
  });
});
state.events.on('phase', (phase) => document.body.classList.toggle('in-game', phase === 'playing'));
state.events.on('map:loaded', (map) => {
  setIconEra(map.era?.id);
  preloadFlags(map.era?.id);
  document.body.dataset.theme = map.era?.id ?? 'fictional';
  screens.gameInProgress = false; // a new map ends any game in progress
  if (screens.ambient) menuCamera();
});

// Real sign-in when Supabase is configured; otherwise (claude.ai preview,
// local dev) a demo sign-in that fakes an approved owner on this device.
screens.show(null);
launcher = new Launcher(authEnabled() ? new AuthService() : new DemoAuthService());
launcher.run().then(() => {
  screens.show('menu');
  menuCamera();
});

// --- Main loop ---

let last = performance.now();
let lastSimDraw = 0;
let lastAnim = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (input.update(dt)) renderer.requestRender();
  ambientPan(dt);
  if (camera.update(dt)) renderer.requestRender();

  ai.adaptBudget(dt);
  const gameHours = state.tick(dt);
  for (const system of systems) system.update(state, gameHours);
  // Armies move and battles pulse: redraw for that at most 30 times a second
  // (camera moves still redraw every frame).
  if (gameHours > 0 && armies.list.size && now - lastSimDraw > 32) { lastSimDraw = now; renderer.requestRender(); }
  // Waves, clouds and battle effects animate at the quality's rate (Low: frozen).
  renderer.setAmbient(!!screens.ambient && !!renderer.images.satellite);
  if (renderer.animating() && now - lastAnim > 1000 / renderer.animFps()) { lastAnim = now; renderer.requestRender(); }
  feed.update(dt);
  windows.update(dt);
  updateBadges(dt);
  victoryUI.update(dt);

  renderer.render();
  adaptQuality(dt);
  ui.update(dt, { zoomRel: camera.zoom / camera.refZoom, frameMs: renderer.lastFrameMs });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for debugging from the console.
window.ironMeridian = { state, camera, renderer, loadMap, loadEra, screens, settings, setMapStyle, sim, feed, windows, ai, sandboxUI, victoryUI };
