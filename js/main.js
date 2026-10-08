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
import { GameState } from './state.js';
import { Renderer } from './render.js';
import { Camera, InputController } from './camera.js';
import { UI } from './ui.js';

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
    if (!narrow) ins.left = hudEls.start.offsetWidth;
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

/** Whole map, fitted into the area not covered by HUD panels. */
function overviewFrame() {
  const map = state.map;
  const i = hudInsets();
  const zoom = Math.min((camera.viewW - i.left - i.right) / map.width, (camera.viewH - i.top - i.bottom) / map.height);
  return framed(map.width / 2, map.height / 2, zoom);
}

// --- Actions (the only place UI intent turns into camera/state side effects) ---

function loadMap(seed) {
  const s = (seed ?? randomSeed()).toUpperCase();
  const t0 = performance.now();
  const map = generateMap(s);
  console.info(`[map] seed ${s}: ${map.provinces.length} provinces, ${map.seaZones.length} sea zones in ${(performance.now() - t0).toFixed(0)} ms`);
  camera.setWorld(map.width, map.height);
  state.loadMap(map);
  const f = overviewFrame();
  camera.fit();
  camera.x = f.x;
  camera.y = f.y;
  camera.zoom = camera.targetZoom = f.zoom;
  renderer.requestRender();
  // Reflect the seed in the URL so a reload/share reproduces the map.
  // Sandboxed embeds can refuse this, which is harmless.
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('seed', s);
    history.replaceState(null, '', url);
  } catch { /* ignore */ }
}

const ui = new UI(state, {
  newMap: loadMap,
  previewNation(id) {
    const a = renderer.nationAnchor(id);
    if (a) focusOn(a.x, a.y, camera.refZoom * 1.5, 0.8);
  },
  deploy(id) {
    state.setPlayerNation(id);
    state.setFocusedNation(-1);
    state.setPhase('playing');
    const cap = state.getProvince(state.getNation(id).capitalId);
    state.setSelected(cap.id);
    focusOn(cap.center.x, cap.center.y, camera.refZoom * 2.4, 1.2);
  },
  focusProvince(id) {
    const p = state.getProvince(id);
    if (!p) return;
    state.setSelected(id);
    focusOn(p.center.x, p.center.y, Math.max(camera.zoom, camera.refZoom * 2.4), 0.6);
  },
  returnToMenu() {
    state.setSelected(-1);
    state.setPhase('setup');
    if (state.playerNationId >= 0) ui.choosePendingNation(state.playerNationId);
    const f = overviewFrame();
    camera.flyTo(f.x, f.y, f.zoom, 0.8);
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
      if (id >= 0) ui.choosePendingNation(state.getProvince(id).owner);
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

let initialSeed = null;
try { initialSeed = new URLSearchParams(window.location.search).get('seed'); } catch { /* ignore */ }
loadMap(initialSeed);

// --- Main loop ---

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (input.update(dt)) renderer.requestRender();
  if (camera.update(dt)) renderer.requestRender();

  const gameHours = state.tick(dt);
  for (const system of systems) system.update(state, gameHours);

  renderer.render();
  ui.update(dt, { zoomRel: camera.zoom / camera.refZoom, frameMs: renderer.lastFrameMs });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for debugging from the console.
window.ironMeridian = { state, camera, renderer, loadMap };
