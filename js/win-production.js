/**
 * win-production.js — Production window (all cities at once) and the
 * Buildings window (cities × building types grid).
 *
 * Production: every city you own with its recruit queue and construction.
 * Bulk recruit: pick a unit and a quantity, tick cities (or "Select all" /
 * "All with Barracks"), see the total cost, confirm. Bulk build works the
 * same way for buildings. Cities that can't do it are greyed out with the
 * reason.
 *
 * Buildings: one row per city (plus oil fields), one column per building,
 * the level in each cell. Tap a cell to see the next level's cost and time
 * and upgrade it; tick rows to upgrade one building type in all of them.
 */

import { buildingSvg } from './icons.js';
import { esc, fmtHours, costHtml, ROLE_GLYPH, ROMAN, bar } from './ui-kit.js';
import { BUILDINGS, MAX_LEVEL, UNIT_REQUIREMENT } from './buildings.js';

/** Sum of several costs. */
function addCost(total, cost, n = 1) {
  for (const [k, v] of Object.entries(cost)) total[k] = (total[k] ?? 0) + v * n;
  return total;
}

/** Queue `qty` units of a type in each city; stops when resources run out. */
export function bulkRecruit(sim, pids, typeKey, qty) {
  let queued = 0, cities = 0, short = false;
  for (const pid of pids) {
    let here = 0;
    for (let i = 0; i < qty; i++) {
      const r = sim.commands.issue('unit.recruit', { province: pid, type: typeKey });
      if (r.error) { if (/resources/i.test(r.error)) short = true; break; }
      here++;
    }
    queued += here;
    if (here) cities++;
    if (short) break;
  }
  return { queued, cities, short };
}

/** Upgrade one building type in each city; stops when resources run out. */
export function bulkBuild(sim, pids, type) {
  let started = 0, short = false;
  for (const pid of pids) {
    const r = sim.commands.issue('building.build', { province: pid, type });
    if (r.error) { if (/resources/i.test(r.error)) { short = true; break; } continue; }
    started++;
  }
  return { started, short };
}

/** Shared bits for both windows. */
class CityWindowBase {
  constructor(state, sim, actions) {
    this.state = state;
    this.sim = sim;
    this.actions = actions;
    this.selected = new Set();
  }

  get set() { return this.sim.economy.set; }
  get me() { return this.state.playerNationId; }
  stock() { return this.sim.economy.get(this.me); }

  /** Cities (and oil fields) of the player, cities first, capital on top. */
  sites() {
    return this.sim.buildings.sites(this.me).sort((a, b) => (b.isCapital - a.isCapital) || (b.isCity - a.isCity) || (a.cityName ?? a.name).localeCompare(b.cityName ?? b.name));
  }

  /** Drop selections of cities no longer ours. */
  pruneSelection(sites) {
    const ids = new Set(sites.map((p) => p.id));
    for (const id of this.selected) if (!ids.has(id)) this.selected.delete(id);
  }

  cityName(p) { return p.cityName ?? p.name; }

  constructionCell(p) {
    const B = this.sim.buildings;
    const job = B.construction.get(p.id);
    if (!job) return '<span class="dim">—</span>';
    return `<span class="job"><span>${esc(B.name(job.type))} ${ROMAN[job.level]}</span>${bar(job.done / job.total, `data-c="${p.id}"`)}<small data-c-left="${p.id}">${fmtHours(job.total - job.done)}</small></span>`;
  }

  liveConstruction(body) {
    const B = this.sim.buildings;
    for (const el of body.querySelectorAll('[data-c]')) {
      const job = B.construction.get(Number(el.dataset.c));
      if (job) el.style.width = `${Math.min(100, (100 * job.done) / job.total).toFixed(0)}%`;
    }
    for (const el of body.querySelectorAll('[data-c-left]')) {
      const job = B.construction.get(Number(el.dataset.cLeft));
      if (job) el.textContent = fmtHours(job.total - job.done);
    }
  }

  /** The big "Select all cities" toggle at the top of the window. */
  selectAllBig(sites) {
    const all = sites.length > 0 && sites.every((p) => this.selected.has(p.id));
    return `<button type="button" class="select-all-big${all ? ' on' : ''}" data-select="${all ? 'none' : 'every'}" ${sites.length ? '' : 'disabled'}>
      <span class="sab-box" aria-hidden="true">${all ? '✓' : ''}</span>
      <span><b>${all ? 'All cities selected' : 'Select all cities'}</b><small>${this.selected.size} of ${sites.length} selected${all ? ' · tap to clear' : ''}</small></span>
    </button>`;
  }

  /** Select-all / clear / preset buttons. */
  selectButtons(presets) {
    return `<div class="chips select-chips">
      <button type="button" data-select="all">Select all</button>
      ${presets.map(([k, l]) => `<button type="button" data-select="${k}">${esc(l)}</button>`).join('')}
      <button type="button" data-select="none">Clear</button>
    </div>`;
  }
}

// --- Production -------------------------------------------------------------------

export class ProductionWindow extends CityWindowBase {
  constructor(state, sim, actions) {
    super(state, sim, actions);
    this.id = 'production';
    this.title = 'Production';
    this.glyph = '⚙';
    this.key = 'p';
    this.tab = 'recruit';
    this.unit = null;
    this.qty = 1;
    this.building = 'barracks';
  }

  get roster() { return this.sim.armies.roster; }

  /** Defaults for the current era (the roster and building list change with the map). */
  ensure() {
    if (!this.unit || !this.roster.byKey[this.unit]) this.unit = this.roster.units[0].key;
    if (!this.sim.buildings.types.includes(this.building)) this.building = 'barracks';
  }

  signature() {
    this.ensure();
    const A = this.sim.armies, B = this.sim.buildings;
    const sites = this.sites();
    const afford = this.roster.units.map((t) => +this.sim.economy.canAfford(this.me, t.cost)).join('');
    return [this.tab, this.unit, this.qty, this.building, [...this.selected].join(','), afford,
      ...sites.map((p) => `${p.id}:${A.queue(p.id).map((q) => q.type).join('.')}:${B.construction.get(p.id)?.type ?? ''}:${Object.values(B.of(p.id)).join('')}`),
      this.costSig()].join('|');
  }

  subtitle() {
    const sites = this.sites();
    const q = sites.reduce((n, p) => n + this.sim.armies.queue(p.id).length, 0);
    const c = sites.filter((p) => this.sim.buildings.construction.has(p.id)).length;
    return `${sites.filter((p) => p.isCity).length} cities · ${q} units queued · ${c} constructions`;
  }

  /** Affordability of the current bulk order, so the footer turns red/green as stock changes. */
  costSig() {
    const { total } = this.order();
    const s = this.stock();
    return Object.entries(total).map(([k, v]) => +((s[k] ?? 0) >= v)).join('');
  }

  /** Eligibility of a site for the current action → { ok, reason }. */
  eligible(p) {
    if (this.tab === 'recruit') {
      const c = this.sim.armies.recruitCheck(p.id, this.unit, { ignoreCost: true });
      return c;
    }
    return this.sim.buildings.check(p.id, this.building, { ignoreCost: true });
  }

  /** The bulk order as it stands: eligible selected cities and total cost. */
  order() {
    const sites = this.sites().filter((p) => this.selected.has(p.id));
    const ok = sites.filter((p) => this.eligible(p).ok);
    const total = {};
    if (this.tab === 'recruit') addCost(total, this.roster.byKey[this.unit].cost, ok.length * this.qty);
    else for (const p of ok) addCost(total, this.sim.buildings.check(p.id, this.building, { ignoreCost: true }).cost);
    return { ok, total };
  }

  render(body) {
    this.ensure();
    const A = this.sim.armies, B = this.sim.buildings;
    const sites = this.sites();
    this.pruneSelection(sites);
    const stock = this.stock();
    const t = this.roster.byKey[this.unit];
    const { ok, total } = this.order();
    const affordable = this.sim.economy.canAfford(this.me, total);

    const picker = this.tab === 'recruit'
      ? `<div class="pick-row">${this.roster.units.map((u) => `<button type="button" class="pick ${u.key === this.unit ? 'on' : ''}" data-unit="${u.key}">
            <span class="unit-glyph r-${u.role}">${ROLE_GLYPH[u.role]}</span><b>${esc(u.name)}</b>
            <span class="pick-cost">${costHtml(u.cost, stock, this.set)}</span><small>${fmtHours(u.build)} · needs ${esc(B.name(UNIT_REQUIREMENT[u.role][0]))} ${ROMAN[UNIT_REQUIREMENT[u.role][1]]}</small></button>`).join('')}</div>
         <div class="qty-row"><span>Quantity per city</span>
           <button type="button" class="icon-btn" data-qty="-1" aria-label="Fewer">−</button><b>${this.qty}</b><button type="button" class="icon-btn" data-qty="1" aria-label="More">+</button></div>
         ${this.selectButtons([['barracks', t.role === 'nav' ? `All with ${B.name('port')}` : `All with ${B.name('barracks')}`]])}`
      : `<div class="pick-row">${B.types.map((k) => `<button type="button" class="pick ${k === this.building ? 'on' : ''}" data-building="${k}">
            <span class="unit-glyph">${buildingSvg(k)}</span><b>${esc(B.name(k))}</b><small>${esc(B.describe(k, 1))}</small></button>`).join('')}</div>
         ${this.selectButtons([])}`;

    const rows = sites.map((p) => {
      const el = this.eligible(p);
      const q = A.queue(p.id);
      const head = q[0];
      const ht = head && this.roster.byKey[head.type];
      const lv = B.of(p.id);
      return `<tr class="${el.ok ? '' : 'na'} ${this.selected.has(p.id) ? 'sel' : ''}">
        <td class="c-check"><label class="hit"><input type="checkbox" data-pick="${p.id}" ${this.selected.has(p.id) ? 'checked' : ''} ${el.ok ? '' : 'disabled'} aria-label="Select ${esc(this.cityName(p))}"></label></td>
        <td class="c-name"><button type="button" class="link-btn" data-city="${p.id}">${p.isCapital ? '★ ' : ''}${esc(this.cityName(p))}</button>${p.isCity ? '' : ' <em>oil field</em>'}
          <small class="lv">${p.isCity ? `${esc(B.name('barracks'))} ${ROMAN[lv.barracks]}${p.seaNeighbors.length ? ` · ${esc(B.name('port'))} ${ROMAN[lv.port]}` : ''}` : ''}</small></td>
        <td class="c-queue${head ? '' : ' none'}">${head ? `<span class="job"><span><span class="unit-glyph r-${ht.role}">${ROLE_GLYPH[ht.role]}</span>${esc(ht.name)}${q.length > 1 ? ` <em>+${q.length - 1}</em>` : ''}</span>${bar(head.done / head.total, `data-q="${p.id}"`)}<small data-q-left="${p.id}">${fmtHours(head.total - head.done)}</small></span>` : '<span class="dim">—</span>'}</td>
        <td class="c-build${this.sim.buildings.construction.has(p.id) ? '' : ' none'}">${this.constructionCell(p)}</td>
        <td class="c-why">${el.ok ? '' : esc(el.reason)}</td>
      </tr>`;
    }).join('');

    const count = this.tab === 'recruit' ? ok.length * this.qty : ok.length;
    const what = this.tab === 'recruit' ? `${count} × ${esc(t.name)}` : `${count} × ${esc(B.name(this.building))}`;
    body.innerHTML = `
      ${this.selectAllBig(sites)}
      <div class="tabs" role="tablist">
        <button type="button" role="tab" data-tab="recruit" aria-selected="${this.tab === 'recruit'}" class="${this.tab === 'recruit' ? 'on' : ''}">Bulk recruit</button>
        <button type="button" role="tab" data-tab="build" aria-selected="${this.tab === 'build'}" class="${this.tab === 'build' ? 'on' : ''}">Bulk build</button>
      </div>
      <div class="bulk">${picker}</div>
      ${sites.length ? `<table class="win-table prod-table">
        <thead><tr><th></th><th>City</th><th>Recruiting</th><th>Construction</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>` : '<p class="empty">You have no cities.</p>'}
      <div class="win-foot">
        <div class="foot-sum"><b>${ok.length}</b> ${ok.length === 1 ? 'city' : 'cities'} · ${what}
          <span class="foot-cost">${count ? costHtml(total, stock, this.set) : ''}</span></div>
        <button type="button" class="btn primary" data-confirm ${count && affordable ? '' : 'disabled'}>${this.tab === 'recruit' ? `Recruit ${count}` : `Build ${count}`}</button>
      </div>`;
  }

  live(body) {
    const A = this.sim.armies;
    for (const el of body.querySelectorAll('[data-q]')) {
      const head = A.queue(Number(el.dataset.q))[0];
      if (head) el.style.width = `${Math.min(100, (100 * head.done) / head.total).toFixed(0)}%`;
    }
    for (const el of body.querySelectorAll('[data-q-left]')) {
      const head = A.queue(Number(el.dataset.qLeft))[0];
      if (head) el.textContent = fmtHours(head.total - head.done);
    }
    this.liveConstruction(body);
  }

  onClick(e) {
    const b = e.target.closest('button');
    if (!b) return false;
    const d = b.dataset;
    if (d.tab) { this.tab = d.tab; return true; }
    if (d.unit) { this.unit = d.unit; return true; }
    if (d.building) { this.building = d.building; return true; }
    if (d.qty) { this.qty = Math.max(1, Math.min(10, this.qty + Number(d.qty))); return true; }
    if (d.city) { this.actions.openCity(Number(d.city)); return false; }
    if (d.select) {
      // Presets replace the selection; cities that can't do the current action are skipped.
      this.selected.clear();
      if (d.select === 'none') return true;
      // The big button takes every city; the order then counts the ones that can.
      if (d.select === 'every') { for (const p of this.sites()) this.selected.add(p.id); return true; }
      const [bk] = UNIT_REQUIREMENT[this.roster.byKey[this.unit].role];
      for (const p of this.sites()) {
        if (!this.eligible(p).ok) continue;
        if (d.select === 'barracks' && this.sim.buildings.level(p.id, bk) < 1) continue;
        this.selected.add(p.id);
      }
      return true;
    }
    if ('confirm' in d) {
      const { ok } = this.order();
      const pids = ok.map((p) => p.id);
      if (this.tab === 'recruit') {
        const r = bulkRecruit(this.sim, pids, this.unit, this.qty);
        this.actions.notice(`Queued ${r.queued} ${this.roster.byKey[this.unit].name} in ${r.cities} ${r.cities === 1 ? 'city' : 'cities'}${r.short ? ' (ran out of resources)' : ''}`);
      } else {
        const r = bulkBuild(this.sim, pids, this.building);
        this.actions.notice(`Started ${r.started} × ${this.sim.buildings.name(this.building)}${r.short ? ' (ran out of resources)' : ''}`);
      }
      this.selected.clear();
      return true;
    }
    return false;
  }

  onChange(e) {
    const box = e.target.closest('[data-pick]');
    if (!box) return false;
    const id = Number(box.dataset.pick);
    if (box.checked) this.selected.add(id); else this.selected.delete(id);
    return true;
  }
}

// --- Buildings ---------------------------------------------------------------------

export class BuildingsWindow extends CityWindowBase {
  constructor(state, sim, actions) {
    super(state, sim, actions);
    this.id = 'buildings';
    this.title = 'Buildings';
    this.glyph = '▦';
    this.key = 'b';
    this.cell = null;        // { pid, type } tapped
    this.bulkType = 'farm';
  }

  signature() {
    const B = this.sim.buildings;
    if (!B.types.includes(this.bulkType)) this.bulkType = B.types[0];
    const sites = this.sites();
    const s = this.stock();
    const c = this.cell ? B.check(this.cell.pid, this.cell.type, { ignoreCost: true }) : null;
    const canCell = c ? +this.sim.economy.canAfford(this.me, c.cost) : '';
    const bulk = this.bulkOrder();
    return [this.cell?.pid, this.cell?.type, this.bulkType, [...this.selected].join(','), canCell, +this.sim.economy.canAfford(this.me, bulk.total), Object.keys(s).length,
      ...sites.map((p) => `${p.id}:${Object.values(B.of(p.id)).join('')}:${B.construction.get(p.id)?.type ?? ''}`)].join('|');
  }

  subtitle() {
    const B = this.sim.buildings;
    const sites = this.sites();
    const lv = sites.reduce((n, p) => n + Object.values(B.of(p.id)).reduce((x, y) => x + y, 0), 0);
    return `${sites.length} sites · ${lv} building levels`;
  }

  bulkOrder() {
    const B = this.sim.buildings;
    const ok = this.sites().filter((p) => this.selected.has(p.id) && B.check(p.id, this.bulkType, { ignoreCost: true }).ok);
    const total = {};
    for (const p of ok) addCost(total, B.check(p.id, this.bulkType, { ignoreCost: true }).cost);
    return { ok, total };
  }

  render(body) {
    const B = this.sim.buildings;
    const types = B.types;
    if (!types.includes(this.bulkType)) this.bulkType = types[0];
    const sites = this.sites();
    this.pruneSelection(sites);
    const stock = this.stock();

    const cellHtml = (p, type) => {
      const lv = B.level(p.id, type);
      const job = B.construction.get(p.id);
      const c = B.check(p.id, type, { ignoreCost: true });
      const na = !c.ok && lv === 0 && /only|coastal|No oil|WWI/.test(c.reason);
      const sel = this.cell && this.cell.pid === p.id && this.cell.type === type;
      const building = job && job.type === type;
      return `<td class="b-cell ${na ? 'na' : ''} ${sel ? 'sel' : ''} ${building ? 'busy' : ''}">
        ${na ? '<span class="dim">—</span>' : `<button type="button" data-cell="${p.id}:${type}" aria-label="${esc(B.name(type))} in ${esc(this.cityName(p))}: level ${lv}">
          <span class="pips">${[1, 2, 3].map((i) => `<i class="${i <= lv ? 'on' : building && i === job.level ? 'next' : ''}"></i>`).join('')}</span>
          ${building ? bar(job.done / job.total, `data-c="${p.id}"`) : ''}</button>`}
      </td>`;
    };

    let detail = '<p class="hint-line">Tap a cell to see the next level\'s cost and time.</p>';
    if (this.cell) {
      const p = this.state.getProvince(this.cell.pid);
      const type = this.cell.type;
      if (p && p.owner === this.me) {
        const c = B.check(p.id, type, { ignoreCost: true });
        const lv = B.level(p.id, type);
        const job = B.construction.get(p.id);
        const can = c.ok && this.sim.economy.canAfford(this.me, c.cost);
        detail = `<div class="cell-detail">
          <div><b>${esc(B.name(type))} ${lv === 0 ? '(new) → I' : lv < MAX_LEVEL ? `${ROMAN[lv]} → ${ROMAN[lv + 1]}` : `${ROMAN[lv]} (max)`}</b> in ${esc(this.cityName(p))}
            <small>${lv < MAX_LEVEL ? esc(B.describe(type, lv + 1)) : esc(B.describe(type, lv))}</small></div>
          ${lv < MAX_LEVEL ? `<div class="detail-cost">${costHtml(c.cost, stock, this.set)}<span class="cost-chip">⏱ ${fmtHours(c.hours)}</span></div>` : ''}
          ${job && job.type === type ? `<button type="button" class="btn small ghost" data-cancel="${p.id}">Cancel (refund)</button>` : ''}
          ${c.ok ? `<button type="button" class="btn small primary" data-upgrade ${can ? '' : 'disabled'}>${can ? 'Upgrade' : 'Not enough resources'}</button>` : `<span class="why">${esc(c.reason)}</span>`}
        </div>`;
      }
    }

    const bulk = this.bulkOrder();
    const bulkCan = bulk.ok.length && this.sim.economy.canAfford(this.me, bulk.total);
    body.innerHTML = `
      ${this.selectAllBig(sites)}
      ${sites.length ? `<div class="grid-wrap"><table class="win-table b-grid">
        <thead><tr><th class="c-check"></th><th class="c-name">City</th>${types.map((k) => `<th><button type="button" data-col="${k}" class="${k === this.bulkType ? 'on' : ''}" title="${esc(B.name(k))}: ${esc(B.describe(k, 1))}"><span class="b-glyph">${buildingSvg(k)}</span><span class="b-name">${esc(B.name(k))}</span></button></th>`).join('')}</tr></thead>
        <tbody>${sites.map((p) => `<tr class="${this.selected.has(p.id) ? 'sel' : ''}">
          <td class="c-check"><label class="hit"><input type="checkbox" data-pick="${p.id}" ${this.selected.has(p.id) ? 'checked' : ''} aria-label="Select ${esc(this.cityName(p))}"></label></td>
          <td class="c-name"><button type="button" class="link-btn" data-city="${p.id}">${p.isCapital ? '★ ' : ''}${esc(this.cityName(p))}</button>${p.isCity ? '' : ' <em>oil</em>'}</td>
          ${types.map((k) => cellHtml(p, k)).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="empty">You have no cities.</p>'}
      ${detail}
      <div class="win-foot">
        <div class="foot-sum">
          <label>Upgrade <select data-bulk-type>${types.map((k) => `<option value="${k}" ${k === this.bulkType ? 'selected' : ''}>${esc(B.name(k))}</option>`).join('')}</select></label>
          in <b>${bulk.ok.length}</b> of ${this.selected.size} selected
          <span class="foot-cost">${bulk.ok.length ? costHtml(bulk.total, stock, this.set) : ''}</span>
          <span class="chips select-chips"><button type="button" data-select="all">Select all</button><button type="button" data-select="none">Clear</button></span>
        </div>
        <button type="button" class="btn primary" data-bulk ${bulkCan ? '' : 'disabled'}>Upgrade ${bulk.ok.length}</button>
      </div>`;
  }

  live(body) { this.liveConstruction(body); }

  onClick(e) {
    const b = e.target.closest('button');
    if (!b) return false;
    const d = b.dataset;
    const B = this.sim.buildings;
    if (d.cell) { const [pid, type] = d.cell.split(':'); this.cell = { pid: Number(pid), type }; return true; }
    if (d.col) { this.bulkType = d.col; return true; }
    if (d.city) { this.actions.openCity(Number(d.city)); return false; }
    if ('upgrade' in d && this.cell) {
      const r = this.sim.commands.issue('building.build', { province: this.cell.pid, type: this.cell.type });
      if (r.error) this.actions.notice(r.error);
      return true;
    }
    if (d.cancel) { this.sim.commands.issue('building.cancel', { province: Number(d.cancel) }); return true; }
    if (d.select) {
      if (d.select === 'none') this.selected.clear(); else for (const p of this.sites()) this.selected.add(p.id);
      return true;
    }
    if ('bulk' in d) {
      const r = bulkBuild(this.sim, this.bulkOrder().ok.map((p) => p.id), this.bulkType);
      this.actions.notice(`Started ${r.started} × ${B.name(this.bulkType)}${r.short ? ' (ran out of resources)' : ''}`);
      this.selected.clear();
      return true;
    }
    return false;
  }

  onChange(e) {
    if (e.target.matches('[data-bulk-type]')) { this.bulkType = e.target.value; return true; }
    const box = e.target.closest('[data-pick]');
    if (!box) return false;
    const id = Number(box.dataset.pick);
    if (box.checked) this.selected.add(id); else this.selected.delete(id);
    return true;
  }
}

