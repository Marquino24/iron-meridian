/**
 * ui.js — DOM HUD: top bar, province panel, status bar, start screen.
 *
 * The UI reads from GameState and reacts to its events. It never touches the
 * camera or map generation directly; anything with side effects goes through
 * the `actions` object supplied by main.js.
 *
 * actions: {
 *   newMap(seed), previewNation(id), deploy(id), focusProvince(id), returnToMenu()
 * }
 */

import { TERRAIN, AREA_KM2_PER_UNIT, gridRef } from './map.js';
import { drawFlag } from './render.js';
import { SPEEDS, START_DATE } from './state.js';

const $ = (sel, root = document) => root.querySelector(sel);
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n, w = 2) => String(n).padStart(w, '0');
const fmtArea = (units) => `${Math.round((units * AREA_KM2_PER_UNIT) / 100) * 100} km²`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Paint a flag into a <canvas> at device resolution. */
function paintFlag(canvas, flag) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || Number(canvas.dataset.w) || 30;
  const h = canvas.clientHeight || Number(canvas.dataset.h) || 20;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawFlag(ctx, flag, 0, 0, w, h);
}

function flagCanvas(flag, w, h, cls = 'flag') {
  const c = document.createElement('canvas');
  c.className = cls;
  c.dataset.w = w;
  c.dataset.h = h;
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  paintFlag(c, flag);
  return c;
}

export class UI {
  constructor(state, actions) {
    this.state = state;
    this.actions = actions;
    this.pendingNation = -1;
    this.lastClockText = '';
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.statusTimer = 0;

    this.el = {
      hud: $('#hud'),
      playerFlag: $('#player-flag'),
      playerName: $('#player-name'),
      clockDay: $('#clock-day'),
      clockDate: $('#clock-date'),
      clockTime: $('#clock-time'),
      speedGroup: $('#speed-group'),
      menuBtn: $('#btn-menu'),
      panel: $('#province-panel'),
      start: $('#start-screen'),
      seedInput: $('#seed-input'),
      seedLoad: $('#btn-load-seed'),
      newMap: $('#btn-new-map'),
      mapStats: $('#map-stats'),
      nationGrid: $('#nation-grid'),
      deploy: $('#btn-deploy'),
      statusGrid: $('#status-grid'),
      statusProvince: $('#status-province'),
      statusZoom: $('#status-zoom'),
      statusPerf: $('#status-perf'),
      statusSeed: $('#status-seed'),
    };

    this.bindStartScreen();
    this.bindTopBar();
    this.bindPanel();

    const ev = state.events;
    ev.on('map:loaded', () => this.onMapLoaded());
    ev.on('phase', (phase) => this.onPhase(phase));
    ev.on('player', () => this.renderPlayer());
    ev.on('select', () => this.renderProvincePanel());
    ev.on('province:owner', () => this.renderProvincePanel());
    ev.on('hover', (id) => this.renderHoverStatus(id));
    ev.on('clock:speed', () => this.renderSpeed());
  }

  // --- Start screen --------------------------------------------------------

  bindStartScreen() {
    const { seedInput, seedLoad, newMap, deploy, nationGrid } = this.el;
    newMap.addEventListener('click', () => this.actions.newMap(null));
    seedLoad.addEventListener('click', () => this.loadTypedSeed());
    seedInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.loadTypedSeed(); });
    deploy.addEventListener('click', () => {
      if (this.pendingNation >= 0) this.actions.deploy(this.pendingNation);
    });
    nationGrid.addEventListener('click', (e) => {
      const card = e.target.closest('[data-nation]');
      if (card) this.choosePendingNation(Number(card.dataset.nation));
    });
    nationGrid.addEventListener('pointerover', (e) => {
      const card = e.target.closest('[data-nation]');
      if (card) this.state.setFocusedNation(Number(card.dataset.nation));
    });
    nationGrid.addEventListener('pointerleave', () => this.state.setFocusedNation(this.pendingNation));
  }

  loadTypedSeed() {
    const seed = this.el.seedInput.value.trim();
    if (seed) this.actions.newMap(seed);
  }

  onMapLoaded() {
    const { state, el } = this;
    const map = state.map;
    this.pendingNation = -1;
    el.seedInput.value = map.seed;
    el.statusSeed.textContent = map.seed;

    const cities = map.provinces.filter((p) => p.isCity).length;
    el.mapStats.innerHTML = [
      ['PROVINCES', map.provinces.length],
      ['CITIES', cities],
      ['NATIONS', map.nations.length],
      ['SEA ZONES', map.seaZones.length],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');

    el.nationGrid.innerHTML = '';
    for (const n of map.nations) {
      const stats = state.nationStats(n.id);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'nation-card';
      card.dataset.nation = n.id;
      card.style.setProperty('--nation', n.color);
      card.innerHTML = `
        <div class="nation-card-head">
          <span class="flag-slot"></span>
          <div>
            <div class="nation-name">${escapeHtml(n.name)}</div>
            <div class="nation-capital">CAPITAL · ${escapeHtml(map.provinces[n.capitalId].name.toUpperCase())}</div>
          </div>
        </div>
        <div class="nation-stats">
          <span><b>${stats.provinces}</b> PROV</span>
          <span><b>${stats.cities}</b> CITIES</span>
          <span><b>${fmtArea(stats.area)}</b></span>
        </div>`;
      card.querySelector('.flag-slot').replaceWith(flagCanvas(n.flag, 36, 24));
      el.nationGrid.appendChild(card);
    }
    this.renderDeployButton();
    this.renderProvincePanel();
  }

  /** Called from the card list or by clicking territory on the map. */
  choosePendingNation(id) {
    this.pendingNation = id;
    this.state.setFocusedNation(id);
    for (const card of this.el.nationGrid.children) {
      card.classList.toggle('selected', Number(card.dataset.nation) === id);
    }
    this.renderDeployButton();
    this.actions.previewNation(id);
  }

  renderDeployButton() {
    const n = this.state.getNation(this.pendingNation);
    this.el.deploy.disabled = !n;
    this.el.deploy.textContent = n ? `ASSUME COMMAND — ${n.shortName.toUpperCase()}` : 'SELECT A NATION';
  }

  onPhase(phase) {
    const playing = phase === 'playing';
    this.el.start.classList.toggle('hidden', playing);
    this.el.hud.classList.toggle('setup', !playing);
    this.renderProvincePanel();
    if (playing) this.renderPlayer();
  }

  // --- Top bar -------------------------------------------------------------

  bindTopBar() {
    const group = this.el.speedGroup;
    group.innerHTML = SPEEDS.map((s) => `<button type="button" data-speed="${s}" title="${s ? `${s}× speed` : 'Pause (Space)'}">${s ? `${s}×` : '❚❚'}</button>`).join('');
    group.addEventListener('click', (e) => {
      const b = e.target.closest('[data-speed]');
      if (b) this.state.setSpeed(Number(b.dataset.speed));
    });
    this.el.menuBtn.addEventListener('click', () => this.actions.returnToMenu());
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'Escape') this.state.setSelected(-1);
      if (e.key === ' ' && this.state.phase === 'playing') {
        e.preventDefault();
        this.state.setSpeed(this.state.clock.speed === 0 ? 1 : 0);
      }
    });
    this.renderSpeed();
  }

  renderPlayer() {
    const n = this.state.playerNation;
    if (!n) return;
    this.el.playerName.textContent = n.name.toUpperCase();
    this.el.playerName.style.setProperty('--nation', n.color);
    paintFlag(this.el.playerFlag, n.flag);
  }

  renderSpeed() {
    for (const b of this.el.speedGroup.children) {
      b.classList.toggle('active', Number(b.dataset.speed) === this.state.clock.speed);
    }
  }

  // --- Province panel --------------------------------------------------------

  bindPanel() {
    this.el.panel.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="close"]')) this.state.setSelected(-1);
      const nb = e.target.closest('[data-province]');
      if (nb) this.actions.focusProvince(Number(nb.dataset.province));
    });
  }

  renderProvincePanel() {
    const { state, el } = this;
    const p = state.getProvince(state.selectedProvinceId);
    const open = !!p && state.phase === 'playing';
    el.panel.classList.toggle('open', open);
    el.panel.setAttribute('aria-hidden', String(!open));
    if (!open) return;

    const owner = state.getNation(p.owner);
    const terrain = TERRAIN[p.terrain];
    const isPlayer = owner.id === state.playerNationId;
    const tags = [
      p.isCapital ? '<span class="tag gold">★ CAPITAL</span>' : '',
      p.isCity && !p.isCapital ? '<span class="tag">■ CITY</span>' : '',
      p.coastal ? '<span class="tag cyan">COASTAL</span>' : '',
      isPlayer ? '<span class="tag green">FRIENDLY</span>' : '<span class="tag red">FOREIGN</span>',
    ].join('');

    const neighbors = p.neighbors
      .map((id) => state.provinces[id])
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((n) => `<li><button type="button" data-province="${n.id}">
          <i style="background:${state.nations[n.owner].color}"></i>${escapeHtml(n.name)}${n.isCity ? ' <em>■</em>' : ''}
        </button></li>`)
      .join('');

    el.panel.innerHTML = `
      <div class="panel-head">
        <div>
          <div class="eyebrow">PROVINCE · PRV-${pad(p.id, 3)} · GRID ${gridRef(state.map, p.center.x, p.center.y)}</div>
          <h2>${escapeHtml(p.name)}</h2>
        </div>
        <button type="button" class="icon-btn" data-action="close" aria-label="Close panel">✕</button>
      </div>
      <div class="tags">${tags}</div>
      <dl class="stats">
        <dt>OWNER</dt>
        <dd class="owner"><span class="flag-slot"></span>${escapeHtml(owner.name)}${isPlayer ? ' <em>(YOU)</em>' : ''}</dd>
        <dt>TERRAIN</dt>
        <dd><span class="terrain-chip t-${terrain.id}"></span>${terrain.label.toUpperCase()}</dd>
        <dt>CITY</dt>
        <dd>${p.isCapital ? 'YES — NATIONAL CAPITAL' : p.isCity ? 'YES' : 'NO'}</dd>
        <dt>NEIGHBORS</dt>
        <dd>${p.neighbors.length} LAND${p.seaNeighbors.length ? ` · ${p.seaNeighbors.length} SEA` : ''}</dd>
        <dt>AREA</dt>
        <dd>${fmtArea(p.area)}</dd>
        <dt>MODIFIERS</dt>
        <dd>DEF ×${terrain.defense.toFixed(2)} · MOVE ×${terrain.moveCost.toFixed(2)}</dd>
      </dl>
      <div class="section-title">ADJACENT PROVINCES</div>
      <ul class="neighbor-list">${neighbors}</ul>`;
    el.panel.querySelector('.flag-slot').replaceWith(flagCanvas(owner.flag, 24, 16));
  }

  // --- Status bar & per-frame ------------------------------------------------

  renderHoverStatus(id) {
    const p = this.state.getProvince(id);
    if (!p) { this.el.statusProvince.textContent = '—'; return; }
    const owner = this.state.getNation(p.owner);
    this.el.statusProvince.textContent = `${p.name.toUpperCase()} · ${owner.shortName.toUpperCase()}`;
  }

  /** Cursor moved over the map (world coordinates). */
  setCursor(w) {
    const map = this.state.map;
    if (!map) return;
    const inside = w.x >= 0 && w.y >= 0 && w.x <= map.width && w.y <= map.height;
    this.el.statusGrid.textContent = inside ? `${gridRef(map, w.x, w.y)}  ${pad(Math.round(w.x), 4)}:${pad(Math.round(w.y), 4)}` : 'OFF-GRID';
  }

  /**
   * Per-frame update (cheap: only touches the DOM when text changes).
   * @param {number} dt real seconds
   * @param {{ zoomRel:number, frameMs:number, drew:boolean }} info
   */
  update(dt, info) {
    // Clock.
    const t = new Date(this.state.clock.time);
    const day = Math.floor((this.state.clock.time - START_DATE) / 864e5) + 1;
    const clockText = `${t.getUTCDate()}|${t.getUTCHours()}|${t.getUTCMinutes()}`;
    if (clockText !== this.lastClockText) {
      this.lastClockText = clockText;
      this.el.clockDay.textContent = `DAY ${pad(day, 3)}`;
      this.el.clockDate.textContent = `${pad(t.getUTCDate())} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
      this.el.clockTime.textContent = `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}Z`;
    }

    // FPS / zoom readout, refreshed 4× per second.
    this.fpsFrames++;
    this.fpsTime += dt;
    this.statusTimer += dt;
    if (this.statusTimer >= 0.25) {
      const fps = Math.round(this.fpsFrames / this.fpsTime);
      this.el.statusPerf.textContent = `${fps} FPS · ${info.frameMs.toFixed(1)} MS`;
      this.el.statusZoom.textContent = `ZOOM ${info.zoomRel.toFixed(2)}×`;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      this.statusTimer = 0;
    }
  }
}
