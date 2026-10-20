/**
 * sandbox-ui.js — The Sandbox toolbar (step 6B): a column of tools on the
 * left (a strip above the command bar on phones) and one options panel.
 *
 *   Paint      pick a nation, tap or drag over provinces
 *   Armies     pick a nation, unit type and amount, tap a province (ships: the sea)
 *   Resources  give or take any amount, any nation
 *   Diplomacy  war or peace between any two nations
 *   AI         computer players on/off, per nation or all
 *   Instant    instant build / recruit / research (the nation you play)
 *   Play as    switch to any nation
 *
 * Map input goes through main.js: onMapClick() for taps, wantsDrag() +
 * paintAt() for brush strokes. Every nation picker has a "pick on map" button.
 */

import { esc, fmtNum } from './ui-kit.js';
import { svgIcon, roleIcon } from './icons.js';
import { RESOURCES } from './resources.js';

const TOOLS = [
  { id: 'paint', icon: 'brush', label: 'Paint', title: 'Paint provinces' },
  { id: 'army', icon: 'army', label: 'Armies', title: 'Spawn armies' },
  { id: 'res', icon: 'money', label: 'Resources', title: 'Give or take resources' },
  { id: 'diplo', icon: 'swords', label: 'Diplomacy', title: 'War and peace' },
  { id: 'ai', icon: 'robot', label: 'AI', title: 'Computer players' },
  { id: 'instant', icon: 'bolt', label: 'Instant', title: 'Instant build, recruit, research' },
  { id: 'play', icon: 'star', label: 'Play as', title: 'Play as another nation' },
];

export class SandboxUI {
  /**
   * @param {import('./state.js').GameState} state
   * @param {object} sim  includes sim.sandbox
   * @param {{ notice(text): void, pickProvince(x, y): number, focusNation(id): void }} actions
   */
  constructor(state, sim, actions) {
    this.state = state;
    this.sim = sim;
    this.sb = sim.sandbox;
    this.actions = actions;
    this.tool = null;
    this.picking = null;       // picker key waiting for a map tap
    this.pick = { paint: -1, army: -1, res: -1, diA: -1, diB: -1, ai: -1, play: -1 };
    this.unit = null;
    this.count = 5;
    this.amount = 1000;
    this.painted = 0;
    this.sig = '';

    this.el = document.createElement('div');
    this.el.id = 'sandbox-bar';
    this.el.className = 'sandbox-bar';
    this.el.hidden = true;
    this.el.innerHTML = `
      <nav class="sb-tools" aria-label="Sandbox tools">
        <div class="sb-badge">SANDBOX</div>
        ${TOOLS.map((t) => `<button type="button" data-tool="${t.id}" title="${esc(t.title)}" aria-pressed="false">${svgIcon(t.icon)}<span>${esc(t.label)}</span></button>`).join('')}
      </nav>
      <section class="sb-panel" hidden aria-live="polite">
        <header><span class="sb-ico"></span><h2></h2><button type="button" class="icon-btn sb-min" data-min aria-label="Fold the panel" aria-expanded="true">▾</button><button type="button" class="icon-btn" data-close aria-label="Close tool">✕</button></header>
        <div class="sb-body"></div>
      </section>`;
    document.getElementById('hud').appendChild(this.el);
    this.panel = this.el.querySelector('.sb-panel');
    this.body = this.el.querySelector('.sb-body');
    this.tag = document.getElementById('sandbox-tag');

    this.el.querySelector('.sb-tools').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tool]');
      if (b) this.setTool(this.tool === b.dataset.tool ? null : b.dataset.tool);
    });
    this.panel.querySelector('[data-close]').addEventListener('click', () => this.setTool(null));
    this.panel.querySelector('[data-min]').addEventListener('click', () => this.fold(!this.panel.classList.contains('min')));
    this.body.addEventListener('click', (e) => this.onClick(e));
    this.body.addEventListener('change', (e) => this.onChange(e));
    this.body.addEventListener('input', (e) => this.onInput(e));

    const ev = state.events;
    const sync = () => this.syncVisibility();
    ev.on('mode', sync);
    ev.on('phase', sync);
    ev.on('map:loaded', () => { this.tool = null; this.pick = Object.fromEntries(Object.keys(this.pick).map((k) => [k, -1])); this.unit = null; sync(); });
    ev.on('player', () => { this.defaults(); this.refresh(true); });
    for (const e of ['war', 'economy', 'sandbox', 'province:owner']) ev.on(e, () => this.refresh());
  }

  get active() { return this.state.sandbox && this.state.phase === 'playing'; }

  syncVisibility() {
    const on = this.active;
    this.el.hidden = !on;
    this.tag.hidden = !(this.state.sandbox && this.state.phase === 'playing');
    document.body.classList.toggle('sandbox', !!this.state.sandbox);
    if (!on) this.setTool(null);
    else this.defaults();
  }

  /** Pickers start on the nation you play (B on a neighbour). */
  defaults() {
    const me = this.state.playerNationId;
    for (const k of Object.keys(this.pick)) if (this.pick[k] < 0 || !this.state.getNation(this.pick[k])) this.pick[k] = me;
    if (this.pick.diB === this.pick.diA) this.pick.diB = this.state.nations.find((n) => n.id !== me && this.state.provinces.some((p) => p.owner === n.id))?.id ?? -1;
    this.unit ??= this.sim.armies.roster?.units[0]?.key ?? null;
  }

  /** Fold the panel to its header so the map is free to tap (phones). */
  fold(on) {
    this.panel.classList.toggle('min', on);
    const b = this.panel.querySelector('[data-min]');
    b.textContent = on ? '▴' : '▾';
    b.setAttribute('aria-expanded', String(!on));
    b.setAttribute('aria-label', on ? 'Unfold the panel' : 'Fold the panel');
  }

  setTool(id) {
    this.tool = id;
    this.picking = null;
    this.fold(false);
    for (const b of this.el.querySelectorAll('[data-tool]')) {
      const on = b.dataset.tool === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    this.panel.hidden = !id;
    document.body.classList.toggle('sb-brush', id === 'paint');
    document.body.classList.toggle('sb-spawn', id === 'army');
    if (id) {
      const t = TOOLS.find((x) => x.id === id);
      this.panel.querySelector('h2').textContent = t.title;
      this.panel.querySelector('.sb-ico').innerHTML = svgIcon(t.icon);
      this.panel.dataset.tool = id;
      this.refresh(true);
    }
  }

  // --- Map input -------------------------------------------------------------------

  /** A one-finger drag paints (instead of panning) while the brush is out. */
  wantsDrag() { return this.active && this.tool === 'paint' && !this.picking; }

  /** Brush stroke over a world point. */
  paintAt(w) {
    const id = this.actions.pickProvince(w.x, w.y);
    if (id >= 0 && this.sb.paint(id, this.pick.paint)) {
      this.painted++;
      this.refresh();
    }
  }

  /** A tap on the map; returns true when a sandbox tool used it. */
  onMapClick(w, id) {
    if (!this.active || !this.tool) return false;
    if (this.picking) {
      const owner = this.state.getProvince(id)?.owner ?? -1;
      if (owner < 0) { this.actions.notice('Nobody owns that. Tap a nation’s land.'); return true; }
      this.pick[this.picking] = owner;
      this.picking = null;
      if (this.foldedForPick) { this.foldedForPick = false; this.fold(false); }
      this.refresh(true);
      return true;
    }
    if (this.tool === 'paint') return true; // the stroke already painted it
    if (this.tool === 'army') {
      const A = this.sim.armies;
      const t = A.roster.byKey[this.unit];
      const node = t?.role === 'nav' ? A.targetAt({ kind: 'naval' }, id, w.x, w.y) : id >= 0 ? id : A.pickSea(w.x, w.y);
      const r = this.sb.spawn(node, this.pick.army, this.unit, this.count);
      if (r.error) this.actions.notice(r.error);
      else this.actions.notice(`${this.count} × ${t.name} for ${this.state.getNation(this.pick.army).shortName} at ${A.nodeName(node)}`);
      return true;
    }
    return false;
  }

  // --- Panels -------------------------------------------------------------------------

  /** Re-render the open panel when what it shows changed (cheap signature check). */
  refresh(force = false) {
    if (!this.tool || this.panel.hidden) return;
    const sig = this.signature();
    if (!force && sig === this.sig) return;
    this.sig = sig;
    // Don't re-render under someone typing a number.
    const focus = document.activeElement;
    if (!force && focus && this.body.contains(focus) && focus.matches('input')) return;
    this.body.innerHTML = this[`render_${this.tool}`]();
  }

  signature() {
    const s = this.state, me = s.playerNationId;
    const parts = [this.tool, me, JSON.stringify(this.pick), this.picking, this.unit, this.count, this.amount, this.painted];
    if (this.tool === 'res') parts.push(JSON.stringify(this.sim.economy.get(this.pick.res)));
    if (this.tool === 'diplo') parts.push([...this.sim.combat.wars].join(','));
    if (this.tool === 'ai') parts.push(this.sim.ai.enabled, [...this.sim.ai.disabled].join(','));
    if (this.tool === 'instant') parts.push(JSON.stringify(this.sb.instant));
    return parts.join('|');
  }

  /** Nation dropdown with colour swatch and a "pick on map" button. */
  picker(key, label) {
    const s = this.state;
    const id = this.pick[key];
    const n = s.getNation(id);
    const living = new Set(s.provinces.map((p) => p.owner));
    const nations = [...s.nations].sort((a, b) => a.name.localeCompare(b.name));
    const opt = (x) => `<option value="${x.id}" ${x.id === id ? 'selected' : ''}>${esc(x.name)}${x.id === s.playerNationId ? ' (you)' : ''}${living.has(x.id) ? '' : ' — no land'}</option>`;
    return `<label class="sb-field"><span>${esc(label)}</span>
      <span class="sb-nation"><i class="swatch" style="background:${n?.color ?? '#777'}"></i>
        <select data-nation="${key}">${nations.map(opt).join('')}</select>
        <button type="button" class="icon-btn sb-pick ${this.picking === key ? 'on' : ''}" data-pick="${key}" title="Pick a nation by tapping the map" aria-label="Pick on map">${svgIcon('pick')}</button>
      </span></label>${this.picking === key ? '<p class="sb-hint pick">Tap a nation on the map…</p>' : ''}`;
  }

  render_paint() {
    const n = this.state.getNation(this.pick.paint);
    return `${this.picker('paint', 'Give land to')}
      <p class="sb-hint">Tap or drag over provinces to paint them <b style="color:${n?.color}">${esc(n?.shortName ?? '')}</b>. Pinch with two fingers (or scroll) to move around while the brush is out.</p>
      <div class="sb-stat">${svgIcon('brush')}<span>${this.painted} province${this.painted === 1 ? '' : 's'} painted this session</span></div>`;
  }

  render_army() {
    const A = this.sim.armies;
    const units = A.roster.units;
    return `${this.picker('army', 'Nation')}
      <div class="sb-field"><span>Unit type</span><div class="sb-units">${units.map((u) => `<button type="button" class="pick ${u.key === this.unit ? 'on' : ''}" data-unit="${u.key}"><span class="unit-glyph r-${u.role}">${roleIcon(u.role)}</span><b>${esc(u.name)}</b></button>`).join('')}</div></div>
      <div class="sb-field"><span>How many units</span><div class="sb-stepper">
        <button type="button" class="icon-btn" data-count="-1" aria-label="Fewer">−</button><input type="number" min="1" max="50" value="${this.count}" data-key="count" aria-label="Units"><button type="button" class="icon-btn" data-count="1" aria-label="More">+</button>
        ${[1, 5, 10, 20].map((v) => `<button type="button" class="chip ${v === this.count ? 'on' : ''}" data-setcount="${v}">${v}</button>`).join('')}</div></div>
      <p class="sb-hint">Now tap a province${A.roster.byKey[this.unit]?.role === 'nav' ? ' on the coast or the sea' : ''} to place the army. It fights at once if enemies are there.</p>`;
  }

  render_res() {
    const E = this.sim.economy;
    const stock = E.get(this.pick.res);
    return `${this.picker('res', 'Nation')}
      <div class="sb-field"><span>Amount</span><div class="sb-stepper">
        <input type="number" min="1" step="100" value="${this.amount}" data-key="amount" aria-label="Amount">
        ${[100, 1000, 10000, 100000].map((v) => `<button type="button" class="chip ${v === this.amount ? 'on' : ''}" data-setamount="${v}">${fmtNum(v)}</button>`).join('')}</div></div>
      <table class="sb-res">${E.keys.map((k) => `<tr>
        <td><i class="res-i">${RESOURCES[k].icon}</i>${esc(E.set.labels[k])}</td><td class="num">${fmtNum(Math.floor(stock[k] ?? 0))}</td>
        <td><button type="button" class="btn small ghost" data-res="${k}" data-sign="-1">−${fmtNum(this.amount)}</button></td>
        <td><button type="button" class="btn small" data-res="${k}" data-sign="1">+${fmtNum(this.amount)}</button></td></tr>`).join('')}</table>
      <div class="sb-row"><button type="button" class="btn small" data-res="all" data-sign="1">+${fmtNum(this.amount)} of everything</button><button type="button" class="btn small danger" data-res="zero">Empty all</button></div>`;
  }

  render_diplo() {
    const C = this.sim.combat, s = this.state;
    const a = this.pick.diA, b = this.pick.diB;
    const war = C.atWar(a, b);
    const truce = C.truceUntil(a, b);
    const status = a === b ? 'Pick two different nations.' : war ? '<b class="war">At war</b>' : `<b class="peace">At peace</b>${truce != null ? ' (truce — the sandbox ignores it)' : ''}`;
    const wars = [...C.wars].map((k) => k.split(':').map(Number)).filter(([x, y]) => s.getNation(x) && s.getNation(y));
    return `${this.picker('diA', 'Nation A')}${this.picker('diB', 'Nation B')}
      <div class="sb-status">${status}</div>
      <div class="sb-row"><button type="button" class="btn small danger" data-war="1" ${war || a === b ? 'disabled' : ''}>Declare war</button><button type="button" class="btn small" data-war="0" ${!war ? 'disabled' : ''}>Make peace</button></div>
      <p class="sb-hint">Sandbox peace keeps today's borders and leaves no truce.</p>
      <div class="sb-field"><span>Wars now (${wars.length})</span><ul class="sb-list">${wars.length ? wars.slice(0, 40).map(([x, y]) => `<li><i class="swatch" style="background:${s.getNation(x).color}"></i>${esc(s.getNation(x).shortName)} <em>vs</em> <i class="swatch" style="background:${s.getNation(y).color}"></i>${esc(s.getNation(y).shortName)}<button type="button" class="btn small ghost" data-peace="${x}:${y}">Peace</button></li>`).join('') : '<li class="dim">No wars.</li>'}</ul></div>`;
  }

  render_ai() {
    const ai = this.sim.ai, s = this.state;
    const n = this.pick.ai;
    const off = [...ai.disabled].filter((id) => s.getNation(id));
    const you = n === s.playerNationId;
    return `<label class="sb-switch"><input type="checkbox" data-allai ${ai.enabled ? 'checked' : ''}><span></span><b>All computer players</b></label>
      ${this.picker('ai', 'Nation')}
      ${you ? '<p class="sb-hint">That’s you: the computer never plays your nation. Use “Play as” to switch.</p>'
        : `<label class="sb-switch"><input type="checkbox" data-ai="${n}" ${!ai.disabled.has(n) ? 'checked' : ''} ${ai.enabled ? '' : 'disabled'}><span></span><b>AI for ${esc(s.getNation(n)?.shortName ?? '')}</b></label>`}
      <div class="sb-field"><span>AI switched off (${off.length})</span><ul class="sb-list">${off.length ? off.map((id) => `<li><i class="swatch" style="background:${s.getNation(id).color}"></i>${esc(s.getNation(id).name)}<button type="button" class="btn small ghost" data-aion="${id}">Turn on</button></li>`).join('') : '<li class="dim">None.</li>'}</ul></div>`;
  }

  render_instant() {
    const i = this.sb.instant;
    const row = (k, label, help) => `<label class="sb-switch"><input type="checkbox" data-instant="${k}" ${i[k] ? 'checked' : ''}><span></span><b>${label}</b><small>${help}</small></label>`;
    return `<p class="sb-hint">For the nation you play (${esc(this.state.playerNation?.shortName ?? '')}). Costs are still paid.</p>
      ${row('build', 'Instant build', 'Buildings finish as soon as you order them.')}
      ${row('recruit', 'Instant recruit', 'Units are ready the moment you queue them.')}
      ${row('research', 'Instant research', 'Techs finish as soon as they start.')}`;
  }

  render_play() {
    const s = this.state;
    const n = s.getNation(this.pick.play);
    const same = this.pick.play === s.playerNationId;
    return `<div class="sb-status">Playing as <b style="color:${s.playerNation?.color}">${esc(s.playerNation?.name ?? '')}</b></div>
      ${this.picker('play', 'Switch to')}
      <button type="button" class="btn primary wide" data-playas ${same || !n ? 'disabled' : ''}>${same ? 'Already playing them' : `Play as ${esc(n?.shortName ?? '')}`}</button>
      <p class="sb-hint">The computer takes over the nation you leave (if AI is on).</p>`;
  }

  // --- Events -------------------------------------------------------------------------

  onClick(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const d = b.dataset;
    if (d.pick) {
      this.picking = this.picking === d.pick ? null : d.pick;
      // Phones: fold the panel so the map can be tapped; it unfolds after the pick.
      if (this.picking && window.innerWidth <= 760) { this.foldedForPick = true; this.fold(true); this.actions.notice('Tap a nation on the map'); }
      this.refresh(true);
      return;
    }
    if (d.unit) { this.unit = d.unit; this.refresh(true); return; }
    if (d.count) { this.count = Math.max(1, Math.min(50, this.count + Number(d.count))); this.refresh(true); return; }
    if (d.setcount) { this.count = Number(d.setcount); this.refresh(true); return; }
    if (d.setamount) { this.amount = Number(d.setamount); this.refresh(true); return; }
    if (d.res) {
      const keys = d.res === 'all' || d.res === 'zero' ? this.sim.economy.keys : [d.res];
      for (const k of keys) this.sb.addResource(this.pick.res, k, d.res === 'zero' ? -Infinity : this.amount * Number(d.sign));
      this.refresh(true);
      return;
    }
    if (d.war) {
      const ok = this.sb.setWar(this.pick.diA, this.pick.diB, d.war === '1');
      if (!ok) this.actions.notice('Nothing changed.');
      this.refresh(true);
      return;
    }
    if (d.peace) { const [x, y] = d.peace.split(':').map(Number); this.sb.setWar(x, y, false); this.refresh(true); return; }
    if (d.aion) { this.sb.setAI(Number(d.aion), true); this.refresh(true); return; }
    if ('playas' in d) {
      if (this.sb.playAs(this.pick.play)) {
        this.actions.notice(`Now playing as ${this.state.playerNation.name}`);
        this.actions.focusNation(this.state.playerNationId);
      }
      this.refresh(true);
    }
  }

  onChange(e) {
    const t = e.target;
    if (t.dataset.nation) { this.pick[t.dataset.nation] = Number(t.value); this.refresh(true); return; }
    if ('allai' in t.dataset) { this.sb.setAllAI(t.checked); this.refresh(true); return; }
    if (t.dataset.ai) { this.sb.setAI(Number(t.dataset.ai), t.checked); this.refresh(true); return; }
    if (t.dataset.instant) { this.sb.instant[t.dataset.instant] = t.checked; this.refresh(true); return; }
    if (t.dataset.key) { this.onInput(e); this.refresh(true); }
  }

  /** Typing a number: keep the value, re-render once it's committed (change). */
  onInput(e) {
    const t = e.target;
    const v = Math.floor(Number(t.value));
    if (!Number.isFinite(v) || v < 1) return;
    if (t.dataset.key === 'count') this.count = Math.min(50, v);
    if (t.dataset.key === 'amount') this.amount = Math.min(1e9, v);
  }
}
