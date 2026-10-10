/**
 * win-army.js — Army window: every army and fleet you own.
 *
 * Totals per unit type on top, then filterable, sortable rows with location,
 * units by type, total HP and status. Clicking a row flies the camera there
 * and selects the army.
 */

import { esc, fmtNum, ROLE_GLYPH, isNarrow } from './ui-kit.js';

const FILTERS = [
  ['all', 'All'], ['field', 'Field'], ['garrison', 'Garrisons'], ['naval', 'Fleets'],
  ['idle', 'Idle'], ['moving', 'Moving'], ['battle', 'In battle'], ['embarked', 'Embarked'],
];
const SORTS = [['name', 'Name'], ['location', 'Location'], ['units', 'Units'], ['hp', 'Strength'], ['status', 'Status']];
const STATUS_ORDER = { battle: 0, retreating: 1, moving: 2, occupying: 3, embarked: 4, idle: 5 };
const STATUS_LABEL = { battle: 'In battle', retreating: 'Retreating', moving: 'Moving', occupying: 'Occupying', embarked: 'Embarked', idle: 'Idle' };

export class ArmyWindow {
  constructor(state, sim, actions) {
    this.id = 'army';
    this.title = 'Army';
    this.glyph = '⚑';
    this.key = 'a';
    this.state = state;
    this.sim = sim;
    this.actions = actions;
    this.filter = 'all';
    this.sort = 'status';
    this.dir = 1;
  }

  status(a) {
    const A = this.sim.armies, C = this.sim.combat;
    if (C.inBattle(a)) return 'battle';
    if (a.retreating && a.seg) return 'retreating';
    if (a.seg || a.path.length) return 'moving';
    if (a.kind === 'land' && A.isSea(a.node)) return 'embarked';
    const occ = C.occupations.get(a.node);
    if (occ && occ.nation === a.nation) return 'occupying';
    return 'idle';
  }

  mine() {
    const me = this.state.playerNationId;
    return [...this.sim.armies.list.values()].filter((a) => a.nation === me && a.units.length);
  }

  rows() {
    const A = this.sim.armies;
    let list = this.mine().map((a) => ({ a, status: this.status(a), loc: A.nodeName(a.seg ? a.seg.from : a.node), hp: A.strength(a) }));
    const f = this.filter;
    list = list.filter(({ a, status }) => f === 'all'
      || (f === 'field' && !a.garrison && a.kind === 'land') || (f === 'garrison' && a.garrison)
      || (f === 'naval' && a.kind === 'naval') || (f === 'battle' && status === 'battle')
      || (f === 'moving' && (status === 'moving' || status === 'retreating'))
      || (f === 'idle' && status === 'idle') || (f === 'embarked' && status === 'embarked'));
    const key = {
      name: (r) => r.a.name, location: (r) => r.loc, units: (r) => r.a.units.length, hp: (r) => r.hp, status: (r) => STATUS_ORDER[r.status],
    }[this.sort];
    list.sort((x, y) => {
      const p = key(x), q = key(y);
      const c = typeof p === 'string' ? p.localeCompare(q) : p - q;
      return (c || x.a.id - y.a.id) * this.dir;
    });
    return list;
  }

  signature() {
    return [this.filter, this.sort, this.dir, ...this.mine().map((a) => `${a.id}.${a.units.length}.${this.status(a)}.${a.node}.${a.name}`)].join('|');
  }

  subtitle() {
    const all = this.mine();
    return `${all.length} armies · ${all.reduce((n, a) => n + a.units.length, 0)} units`;
  }

  render(body) {
    const A = this.sim.armies;
    const roster = A.roster.units;
    const all = this.mine();
    const totals = Object.fromEntries(roster.map((t) => [t.key, 0]));
    let hp = 0, max = 0;
    for (const a of all) for (const u of a.units) { totals[u.type]++; hp += Math.max(0, u.hp); max += A.unitType(u).hp; }
    const rows = this.rows();
    const th = (k, label) => `<th><button type="button" data-sort="${k}" class="${this.sort === k ? 'on' : ''}">${label}${this.sort === k ? (this.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;

    body.innerHTML = `
      <div class="win-totals">
        ${roster.map((t) => `<div class="total"><span class="unit-glyph r-${t.role}">${ROLE_GLYPH[t.role]}</span><span>${esc(t.name)}</span><b>${totals[t.key]}</b></div>`).join('')}
        <div class="total"><span class="unit-glyph">♥</span><span>Total HP</span><b>${fmtNum(hp)}<small>/${fmtNum(max)}</small></b></div>
      </div>
      <div class="win-controls">
        <div class="chips" role="group" aria-label="Filter">${FILTERS.map(([k, l]) => `<button type="button" data-filter="${k}" class="${this.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <label class="sort-select">Sort <select data-sort-select>${SORTS.map(([k, l]) => `<option value="${k}" ${this.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      ${rows.length ? `<table class="win-table army-table">
        <thead><tr>${th('name', 'Army')}${th('location', 'Location')}${th('units', 'Units')}${th('hp', 'HP')}${th('status', 'Status')}</tr></thead>
        <tbody>${rows.map(({ a, status, loc }) => {
          const comp = A.composition(a);
          const str = A.strength(a);
          const n = this.state.getNation(a.nation);
          let hpNow = 0, hpMax = 0;
          for (const u of a.units) { hpNow += Math.max(0, u.hp); hpMax += A.unitType(u).hp; }
          return `<tr data-army="${a.id}" tabindex="0" class="${a.id === this.state.selectedArmyId ? 'sel' : ''}">
            <td class="c-name"><i class="dot" style="background:${n.color}"></i>${esc(a.name)}${a.garrison ? ' <em>garrison</em>' : ''}${a.kind === 'naval' ? ' <em>fleet</em>' : ''}</td>
            <td class="c-loc">${esc(loc)}</td>
            <td class="c-comp">${roster.filter((t) => comp[t.key]).map((t) => `<span class="comp"><span class="unit-glyph r-${t.role}">${ROLE_GLYPH[t.role]}</span>${comp[t.key]}</span>`).join('')}</td>
            <td class="c-hp"><span class="hpbar"><i data-army-hp="${a.id}" class="${str > 0.6 ? 'ok' : str > 0.3 ? 'mid' : 'low'}" style="width:${(str * 100).toFixed(0)}%"></i></span><small data-army-hpnum="${a.id}">${fmtNum(hpNow)}/${fmtNum(hpMax)}</small></td>
            <td class="c-status"><span class="st st-${status}">${STATUS_LABEL[status]}</span></td>
          </tr>`;
        }).join('')}</tbody></table>` : '<p class="empty">No armies match this filter.</p>'}`;
  }

  live(body) {
    const A = this.sim.armies;
    for (const el of body.querySelectorAll('[data-army-hp]')) {
      const a = A.list.get(Number(el.dataset.armyHp));
      if (!a) continue;
      const s = A.strength(a);
      el.style.width = `${(s * 100).toFixed(0)}%`;
      el.className = s > 0.6 ? 'ok' : s > 0.3 ? 'mid' : 'low';
      let now = 0, max = 0;
      for (const u of a.units) { now += Math.max(0, u.hp); max += A.unitType(u).hp; }
      body.querySelector(`[data-army-hpnum="${a.id}"]`).textContent = `${fmtNum(now)}/${fmtNum(max)}`;
    }
  }

  onClick(e) {
    const f = e.target.closest('[data-filter]');
    if (f) { this.filter = f.dataset.filter; return true; }
    const s = e.target.closest('[data-sort]');
    if (s) {
      if (this.sort === s.dataset.sort) this.dir = -this.dir; else { this.sort = s.dataset.sort; this.dir = 1; }
      return true;
    }
    const row = e.target.closest('[data-army]');
    if (row) {
      this.actions.selectArmy(Number(row.dataset.army));
      if (isNarrow()) this.actions.closeWindow(this.id);
      return true;
    }
    return false;
  }

  onChange(e) {
    if (e.target.matches('[data-sort-select]')) { this.sort = e.target.value; this.dir = 1; return true; }
    return false;
  }
}
