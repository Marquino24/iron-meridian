/**
 * ui.js — DOM HUD: start screen (era + nation picker), top bar, province
 * panel, status bar.
 *
 * The UI reads from GameState and reacts to its events. It never touches the
 * camera or map loading directly; anything with side effects goes through the
 * `actions` object supplied by main.js.
 *
 * actions: {
 *   selectEra(id), newMap(seed), previewNation(id), deploy(id),
 *   focusProvince(id), returnToMenu()
 * }
 */

import { TERRAIN, AREA_KM2_PER_UNIT, gridRef } from './map.js';
import { drawFlag } from './render.js';
import { ERAS } from './eras.js';

const $ = (sel, root = document) => root.querySelector(sel);
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n, w = 2) => String(n).padStart(w, '0');
/** Province/nation area: true km² on real maps, the fictional scale otherwise. */
const fmtKm2 = (km2) => `${km2 >= 1000 ? Math.round(km2 / 100) * 100 : Math.max(1, Math.round(km2))} km²`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const fmtArea = (units, km2) => fmtKm2(km2 ?? units * AREA_KM2_PER_UNIT);
const fmtYear = (y) => (y < 1000 ? `AD ${y}` : String(y));

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

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
    this.filter = 'major';
    this.lastClockText = '';
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.statusTimer = 0;
    this.nationStats = [];
    this.command = null; // CommandUI (armies, recruiting, war), attached by main.js

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
      eraGrid: $('#era-grid'),
      seedRow: $('#seed-row'),
      seedInput: $('#seed-input'),
      seedLoad: $('#btn-load-seed'),
      newMap: $('#btn-new-map'),
      mapStats: $('#map-stats'),
      filterTabs: $('#nation-filter'),
      search: $('#nation-search'),
      nationList: $('#nation-list'),
      deploy: $('#btn-deploy'),
      source: $('#data-source'),
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
    for (const e of ['select', 'select:army', 'province:owner', 'war']) ev.on(e, () => this.renderProvincePanel());
    ev.on('hover', (id) => this.renderHoverStatus(id));
    ev.on('clock:speed', () => this.renderSpeed());
  }

  // --- Start screen --------------------------------------------------------

  bindStartScreen() {
    const { eraGrid, seedInput, seedLoad, newMap, deploy, nationList, search, filterTabs } = this.el;
    eraGrid.innerHTML = ERAS.map((e) => `
      <button type="button" class="era-card" data-era="${e.id}" role="listitem">
        <span class="era-year">${escapeHtml(e.year)}</span>
        <span class="era-name">${escapeHtml(e.label)}</span>
        <span class="era-blurb">${escapeHtml(e.blurb ?? '')}</span>
      </button>`).join('');
    eraGrid.addEventListener('click', (e) => {
      const b = e.target.closest('[data-era]');
      if (b) this.actions.selectEra(b.dataset.era);
    });

    newMap.addEventListener('click', () => this.actions.newMap(null));
    seedLoad.addEventListener('click', () => this.loadTypedSeed());
    seedInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.loadTypedSeed(); });

    filterTabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      this.filter = b.dataset.filter;
      this.renderNationList();
    });
    search.addEventListener('input', () => {
      if (search.value.trim() && this.filter === 'major') this.filter = 'all';
      this.renderNationList();
    });

    deploy.addEventListener('click', () => {
      if (this.pendingNation >= 0) this.actions.deploy(this.pendingNation);
    });
    nationList.addEventListener('click', (e) => {
      const row = e.target.closest('[data-nation]');
      if (row) this.choosePendingNation(Number(row.dataset.nation));
    });
    nationList.addEventListener('pointerover', (e) => {
      const row = e.target.closest('[data-nation]');
      if (row && e.pointerType === 'mouse') this.state.setFocusedNation(Number(row.dataset.nation));
    });
    nationList.addEventListener('pointerleave', () => this.state.setFocusedNation(this.pendingNation));
  }

  loadTypedSeed() {
    const seed = this.el.seedInput.value.trim();
    if (seed) this.actions.newMap(seed);
  }

  /** Shown while an era's data is fetched and decoded. */
  setLoading(eraId) {
    for (const b of this.el.eraGrid.children) {
      b.classList.toggle('loading', b.dataset.era === eraId);
    }
    this.el.mapStats.innerHTML = '<div class="loading-line">LOADING THEATRE DATA…</div>';
  }

  onMapLoaded() {
    const { state, el } = this;
    const map = state.map;
    const era = map.era;
    this.pendingNation = -1;
    this.filter = 'major';
    el.search.value = '';

    for (const b of el.eraGrid.children) {
      b.classList.toggle('selected', b.dataset.era === era.id);
      b.classList.remove('loading');
    }
    document.getElementById('nation-screen-title').textContent = era.fictional ? 'Choose a nation' : `${era.label}, ${era.year === 'Present' ? 'today' : era.year}`;
    el.seedRow.hidden = !era.fictional;
    el.seedInput.value = map.seed;
    el.statusSeed.textContent = era.fictional ? map.seed : `${era.label.toUpperCase()} ${era.year}`;

    // Per-nation stats once per map (the list re-renders on every keystroke).
    const counts = map.nations.map(() => ({ provinces: 0, cities: 0 }));
    for (const p of map.provinces) {
      if (p.owner < 0) continue;
      counts[p.owner].provinces++;
      if (p.isCity) counts[p.owner].cities++;
    }
    this.nationStats = counts;

    el.mapStats.innerHTML = [
      ['PROVINCES', map.provinces.length],
      ['NATIONS', map.nations.length],
      ['CITIES', map.provinces.filter((p) => p.isCity).length],
      ['SEA ZONES', map.seaZones.length],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');

    el.source.innerHTML = map.source
      ? `Borders: <a href="${escapeHtml(map.source.url)}" target="_blank" rel="noopener">${escapeHtml(map.source.name)}</a>, ${escapeHtml(map.source.license)} · data year ${fmtYear(map.dataYear)} · Imagery: NASA Blue Marble, Natural Earth`
      : 'Procedurally generated world';

    this.renderNationList();
    this.renderDeployButton();
    this.renderProvincePanel();
  }

  renderNationList() {
    const { state, el } = this;
    const map = state.map;
    if (!map) return;
    for (const b of el.filterTabs.children) b.classList.toggle('active', b.dataset.filter === this.filter);

    const q = el.search.value.trim().toLowerCase();
    let list = map.nations.filter((n) => this.nationStats[n.id]?.provinces > 0);
    if (q) list = list.filter((n) => n.name.toLowerCase().includes(q) || n.shortName.toLowerCase().includes(q));
    else if (this.filter === 'major') list = list.filter((n) => n.major);
    list.sort((a, b) => Number(b.major) - Number(a.major) || this.nationStats[b.id].provinces - this.nationStats[a.id].provinces);

    el.nationList.innerHTML = '';
    if (!list.length) {
      el.nationList.innerHTML = `<div class="empty">No nation matches “${escapeHtml(q)}”.</div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    for (const n of list) {
      const s = this.nationStats[n.id];
      const capital = map.provinces[n.capitalId];
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'nation-row';
      row.dataset.nation = n.id;
      row.style.setProperty('--nation', n.color);
      row.classList.toggle('selected', n.id === this.pendingNation);
      row.setAttribute('aria-selected', String(n.id === this.pendingNation));
      row.innerHTML = `
        <span class="flag-slot"></span>
        <span class="nation-main">
          <span class="nation-name">${escapeHtml(n.name)}${n.major ? ' <em>MAJOR</em>' : ''}</span>
          <span class="nation-capital">${capital?.isCapital ? `★ ${escapeHtml(capital.name.toUpperCase())}` : '&nbsp;'}</span>
        </span>
        <span class="nation-stats"><b>${s.provinces}</b> PROV<br><b>${s.cities}</b> CITIES</span>`;
      row.querySelector('.flag-slot').replaceWith(flagCanvas(n.flag, 30, 20));
      frag.appendChild(row);
    }
    el.nationList.appendChild(frag);
  }

  /** Called from the list or by clicking territory on the map. */
  choosePendingNation(id) {
    const n = this.state.getNation(id);
    if (!n) return;
    this.pendingNation = id;
    this.state.setFocusedNation(id);
    // Make sure the chosen nation is visible in the list (it may be filtered out).
    if (!n.major && this.filter === 'major') this.filter = 'all';
    this.renderNationList();
    // Scroll only the list (scrollIntoView would also scroll the page and hide the top bar).
    const list = this.el.nationList;
    const row = list.querySelector(`[data-nation="${id}"]`);
    if (row) {
      const top = row.offsetTop - list.offsetTop;
      if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top - 8;
    }
    this.renderDeployButton();
    this.actions.previewNation(id);
  }

  renderDeployButton() {
    const n = this.state.getNation(this.pendingNation);
    this.el.deploy.disabled = !n;
    const verb = document.body.dataset.mode === 'sandbox' ? 'START SANDBOX' : 'ASSUME COMMAND';
    this.el.deploy.textContent = n ? `${verb} — ${n.shortName.toUpperCase()}` : 'SELECT A NATION';
  }

  onPhase(phase) {
    const playing = phase === 'playing';
    this.el.hud.classList.toggle('setup', !playing);
    this.renderProvincePanel();
    if (playing) this.renderPlayer();
  }

  // --- Top bar -------------------------------------------------------------

  bindTopBar() {
    const group = this.el.speedGroup;
    this.renderSpeedButtons();
    this.state.events.on('mode', () => { this.renderSpeedButtons(); this.renderSpeed(); });
    group.addEventListener('click', (e) => {
      const b = e.target.closest('[data-speed]');
      if (b) this.state.setSpeed(Number(b.dataset.speed));
    });
    this.el.menuBtn.addEventListener('click', () => this.actions.returnToMenu());
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'Escape') {
        if (this.state.selectedArmyId >= 0) this.state.setSelectedArmy(-1);
        else this.state.setSelected(-1);
      }
      if (e.key === ' ' && this.state.phase === 'playing') {
        e.preventDefault();
        this.state.setSpeed(this.state.clock.speed === 0 ? 1 : 0);
      }
    });
    this.renderSpeed();
  }

  renderSpeedButtons() {
    this.el.speedGroup.innerHTML = this.state.speeds.map((s) => `<button type="button" data-speed="${s}" title="${s ? `${s}× speed` : 'Pause (Space)'}">${s ? `${s}×` : '❚❚'}</button>`).join('');
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
    this.el.panel.addEventListener('change', (e) => this.command?.handleChange(e));
    this.el.panel.addEventListener('click', (e) => {
      if (this.command?.handleClick(e)) return;
      if (e.target.closest('[data-action="close"]')) this.state.setSelected(-1);
      const nb = e.target.closest('[data-province]');
      if (nb) this.actions.focusProvince(Number(nb.dataset.province));
    });
  }

  renderProvincePanel() {
    const { state, el } = this;
    const p = state.getProvince(state.selectedProvinceId);
    const army = this.command?.sim.armies.list.get(state.selectedArmyId);
    const open = (!!p || !!army) && state.phase === 'playing';
    el.panel.classList.toggle('open', open);
    el.panel.classList.toggle('army-mode', !!army);
    el.panel.setAttribute('aria-hidden', String(!open));
    if (!open) { this.command?.markRendered(); this.panelKey = ''; return; }
    // A different province or army starts at the top; live refreshes keep the scroll position.
    const key = army ? `a${army.id}` : `p${p.id}`;
    if (key !== this.panelKey) { this.panelKey = key; el.panel.scrollTop = 0; }
    if (army) {
      el.panel.innerHTML = this.command.armyHtml(army);
      this.command.markRendered();
      return;
    }

    const map = state.map;
    const owner = state.getNation(p.owner);
    const terrain = TERRAIN[p.terrain];
    const isPlayer = owner && owner.id === state.playerNationId;
    const tags = [
      p.isCapital ? '<span class="tag gold">★ CAPITAL</span>' : '',
      p.isCity && !p.isCapital ? '<span class="tag">■ CITY</span>' : '',
      p.coastal ? '<span class="tag cyan">COASTAL</span>' : '',
      !owner ? '<span class="tag">UNCLAIMED</span>' : isPlayer ? '<span class="tag green">FRIENDLY</span>' : '<span class="tag red">FOREIGN</span>',
    ].join('');

    const ownerColor = (q) => (q.owner >= 0 ? state.nations[q.owner].color : '#4d5048');
    const neighbors = p.neighbors
      .map((id) => state.provinces[id])
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((n) => `<li><button type="button" data-province="${n.id}">
          <i style="background:${ownerColor(n)}"></i>${escapeHtml(n.name)}${n.isCity ? ' <em>■</em>' : ''}
          ${n.owner !== p.owner ? `<small>${escapeHtml(n.owner >= 0 ? state.nations[n.owner].shortName : 'Unclaimed')}</small>` : ''}
        </button></li>`)
      .join('');

    const ownerHtml = owner
      ? `<span class="flag-slot"></span>${escapeHtml(owner.name)}${isPlayer ? ' <em>(YOU)</em>' : ''}`
      : `UNCLAIMED${p.region ? ` — ${escapeHtml(p.region)}` : ''}`;
    const coordLabel = map.kind === 'world' ? 'COORDINATES' : 'GRID';

    el.panel.innerHTML = `
      <div class="panel-head">
        <div>
          <div class="eyebrow">PROVINCE · PRV-${pad(p.id, 4)}</div>
          <h2>${escapeHtml(p.name)}</h2>
        </div>
        <button type="button" class="icon-btn" data-action="close" aria-label="Close panel">✕</button>
      </div>
      <div class="tags">${tags}</div>
      <dl class="stats">
        <dt>OWNER</dt>
        <dd class="owner">${ownerHtml}</dd>
        <dt>TERRAIN</dt>
        <dd><span class="terrain-chip t-${terrain.id}"></span>${terrain.label.toUpperCase()}</dd>
        <dt>CITY</dt>
        <dd>${p.isCity ? `${p.cityName && p.cityName !== p.name ? escapeHtml(p.cityName) : 'YES'}${p.isCapital ? ' — NATIONAL CAPITAL' : ''}` : 'NO'}</dd>
        <dt>NEIGHBORS</dt>
        <dd>${p.neighbors.length} LAND${p.seaNeighbors.length ? ` · ${p.seaNeighbors.length} SEA` : ''}</dd>
        <dt>AREA</dt>
        <dd>${fmtArea(p.area, p.areaKm2)}</dd>
        <dt>${coordLabel}</dt>
        <dd>${gridRef(map, p.center.x, p.center.y)}</dd>
        <dt>MODIFIERS</dt>
        <dd>DEF ×${terrain.defense.toFixed(2)} · MOVE ×${terrain.moveCost.toFixed(2)}</dd>
      </dl>
      ${this.command ? this.command.provinceHtml(p) : ''}
      <div class="section-title">ADJACENT PROVINCES</div>
      <ul class="neighbor-list">${neighbors || '<li class="empty">None — island province</li>'}</ul>`;
    if (owner) el.panel.querySelector('.flag-slot').replaceWith(flagCanvas(owner.flag, 24, 16));
    this.command?.markRendered();
  }

  // --- Status bar & per-frame ------------------------------------------------

  renderHoverStatus(id) {
    const p = this.state.getProvince(id);
    if (!p) { this.el.statusProvince.textContent = '—'; return; }
    const owner = this.state.getNation(p.owner);
    this.el.statusProvince.textContent = `${p.name.toUpperCase()} · ${owner ? owner.shortName.toUpperCase() : (p.region ?? 'UNCLAIMED').toUpperCase()}`;
  }

  /** Cursor moved over the map (world coordinates). */
  setCursor(w) {
    const map = this.state.map;
    if (!map) return;
    const inside = w.x >= 0 && w.y >= 0 && w.x <= map.width && w.y <= map.height;
    this.el.statusGrid.textContent = !inside ? 'OFF-GRID'
      : map.kind === 'world' ? gridRef(map, w.x, w.y)
        : `${gridRef(map, w.x, w.y)}  ${pad(Math.round(w.x), 4)}:${pad(Math.round(w.y), 4)}`;
  }

  /**
   * Per-frame update (cheap: only touches the DOM when text changes).
   * @param {number} dt real seconds
   * @param {{ zoomRel:number, frameMs:number }} info
   */
  update(dt, info) {
    const { clock } = this.state;
    const t = new Date(clock.time);
    const day = Math.floor((clock.time - clock.start) / 864e5) + 1;
    const clockText = `${t.getUTCFullYear()}|${t.getUTCDate()}|${t.getUTCHours()}|${t.getUTCMinutes()}`;
    if (clockText !== this.lastClockText) {
      this.lastClockText = clockText;
      this.el.clockDay.textContent = `DAY ${pad(day, 3)}`;
      this.el.clockDate.textContent = `${pad(t.getUTCDate())} ${MONTHS[t.getUTCMonth()]} ${fmtYear(t.getUTCFullYear())}`;
      this.el.clockTime.textContent = `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}Z`;
    }

    if (this.state.phase === 'playing' && this.command?.update(dt, this.el.panel)) this.renderProvincePanel();

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
