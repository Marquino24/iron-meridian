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

const canvas = document.getElementById('map-canvas');
const state = new GameState();
const camera = new Camera();
const renderer = new Renderer(canvas, camera, state);

/** Simulation systems, run in order each frame. Empty in step 1. */
const systems = [];

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
    ins.top = hudEls.topbar.offsetHeight;
    if (state.selectedProvinceId >= 0) {
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
  if (state.map?.era?.id === id && !getEra(id).fictional) {
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
    state.setPlayerNation(id);
    state.setFocusedNation(-1);
    screens.gameInProgress = true;
    screens.show('game');
    state.setPhase('playing');
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
    pausedSpeed = state.clock.speed;
    state.setSpeed(0);
    state.setPhase('setup');
    screens.show('menu');
    menuCamera();
  },
});

const input = new InputController(canvas, camera, {
  onHover(sx, sy) {
    const w = camera.screenToWorld(sx, sy);
    state.setHovered(pickProvince(state.map, w.x, w.y));
    ui.setCursor(w);
  },
  onLeave() {
    state.setHovered(-1);
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
    } else {
      state.setSelected(id);
    }
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

function applySettings() {
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
  if (style !== 'political' && !renderer.images[style]) {
    try { renderer.setImage(style, await loadImagery(style)); } catch (err) { console.error(err); }
  }
}
document.getElementById('style-toggle').addEventListener('click', (e) => {
  const b = e.target.closest('[data-style]');
  if (b) setMapStyle(b.dataset.style);
});
setMapStyle(mapStyle);

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

state.events.on('phase', (phase) => document.body.classList.toggle('in-game', phase === 'playing'));
state.events.on('map:loaded', () => { if (screens.ambient) menuCamera(); });

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
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (input.update(dt)) renderer.requestRender();
  ambientPan(dt);
  if (camera.update(dt)) renderer.requestRender();

  const gameHours = state.tick(dt);
  for (const system of systems) system.update(state, gameHours);

  renderer.render();
  ui.update(dt, { zoomRel: camera.zoom / camera.refZoom, frameMs: renderer.lastFrameMs });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for debugging from the console.
window.ironMeridian = { state, camera, renderer, loadMap, loadEra, screens, settings, setMapStyle };
