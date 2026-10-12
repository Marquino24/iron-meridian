/**
 * win-research.js — Research window: the era's tech tree.
 *
 * Three bands (Military, Economy, Infrastructure) × three tier columns.
 * Lines run from each requirement to the techs it opens. A tech is locked,
 * available, researching (with a progress bar) or done. Tap one for its
 * effects, requirements, cost and time, then start or cancel it. The header
 * shows the research slots in use.
 */

import { esc, fmtHours, costHtml, bar, ROMAN } from './ui-kit.js';
import { BRANCHES } from './tech.js';

const COL_W = 196, CARD_W = 172, CARD_H = 56, ROW_H = 66, BAND_HEAD = 26, BAND_GAP = 14, PAD = 10;
const STATUS_LABEL = { done: 'Researched', active: 'Researching', available: 'Available', locked: 'Locked' };
const STATUS_ICON = { done: '✓', active: '◔', available: '◇', locked: '🔒' };

export class ResearchWindow {
  constructor(state, sim, actions) {
    this.id = 'research';
    this.title = 'Research';
    this.glyph = '⚗';
    this.key = 'r';
    this.state = state;
    this.sim = sim;
    this.actions = actions;
    this.selected = null;
  }

  get R() { return this.sim.research; }
  get me() { return this.state.playerNationId; }

  /** Compact effect label for a card. */
  short(e) {
    const roster = this.sim.armies.roster;
    const B = this.sim.buildings;
    if (e.unit) return `${roster.byRole[e.unit]?.name ?? e.unit} Lv ${ROMAN[e.level]}`;
    if (e.building) return `${B.name(e.building)} III`;
    if (e.prod) return e.prod === 'all' ? `+${e.pct}% all output` : `+${e.pct}% ${this.sim.economy.label(e.prod).toLowerCase()}`;
    if (e.move) return `+${e.move}% speed`;
    if (e.defense) return `+${e.defense}% defense`;
    if (e.attack) return `+${e.pct}% attack`;
    if (e.buildTime) return `Build −${e.buildTime}% time`;
    if (e.buildCost) return `Build −${e.buildCost}% cost`;
    if (e.trainTime) return `Train −${e.trainTime}% time`;
    if (e.slots) return '+1 research slot';
    return '';
  }

  /** Card positions: { id → { x, y } } and the tree size. */
  layout() {
    const pos = {};
    let y = 0;
    const bands = [];
    for (const b of BRANCHES) {
      const techs = this.R.tree.filter((t) => t.branch === b.id);
      const rows = Math.max(...[1, 2, 3].map((tier) => techs.filter((t) => t.tier === tier).length));
      bands.push({ ...b, top: y, height: BAND_HEAD + rows * ROW_H });
      for (const tier of [1, 2, 3]) {
        techs.filter((t) => t.tier === tier).forEach((t, i) => {
          pos[t.id] = { x: PAD + (tier - 1) * COL_W, y: y + BAND_HEAD + i * ROW_H };
        });
      }
      y += BAND_HEAD + rows * ROW_H + BAND_GAP;
    }
    return { pos, bands, width: PAD * 2 + 2 * COL_W + CARD_W, height: y - BAND_GAP + PAD };
  }

  signature() {
    const R = this.R, me = this.me;
    const sel = this.selected && R.byId[this.selected];
    return [this.selected, R.slots(me), R.of(me).active.map((a) => a.id).join(','),
      R.tree.map((t) => R.status(me, t.id)[0]).join(''), sel ? +this.sim.economy.canAfford(me, sel.cost) : ''].join('|');
  }

  subtitle() {
    const R = this.R, me = this.me;
    const done = R.of(me).done.size;
    return `${done} of ${R.tree.length} researched · slots ${R.of(me).active.length}/${R.slots(me)}`;
  }

  render(body) {
    const R = this.R, me = this.me;
    const { pos, bands, width, height } = this.layout();
    const r = R.of(me);

    // Lines from each requirement to the tech.
    const lines = [];
    for (const t of R.tree) {
      for (const q of t.req) {
        const a = pos[q], b = pos[t.id];
        const x1 = a.x + CARD_W, y1 = a.y + CARD_H / 2, x2 = b.x, y2 = b.y + CARD_H / 2;
        const mx = (x1 + x2) / 2;
        const st = r.done.has(q) ? (R.status(me, t.id) === 'locked' ? 'part' : 'open') : 'locked';
        lines.push(`<path class="ln ln-${st}" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}"/>`);
      }
    }

    const cards = R.tree.map((t) => {
      const st = R.status(me, t.id);
      const p = pos[t.id];
      const act = r.active.find((a) => a.id === t.id);
      return `<button type="button" class="tech st-${st} ${this.selected === t.id ? 'sel' : ''}" data-tech="${t.id}"
          style="left:${p.x}px;top:${p.y}px;width:${CARD_W}px;height:${CARD_H}px" aria-label="${esc(t.name)}: ${STATUS_LABEL[st]}">
        <span class="tech-name">${esc(t.name)}</span>
        <span class="tech-fx">${esc(t.effects.map((e) => this.short(e)).join(' · '))}</span>
        <span class="tech-ico" aria-hidden="true">${STATUS_ICON[st]}</span>
        ${act ? bar(act.done / act.total, `data-r="${t.id}"`) : ''}
      </button>`;
    }).join('');

    const slots = R.slots(me);
    const slotHtml = Array.from({ length: Math.max(slots, 2) }, (_, i) => {
      const a = r.active[i];
      if (i >= slots) return `<div class="slot locked"><span>Slot 2</span><small>Unlocked by ${esc(R.tree.find((t) => t.effects.some((e) => e.slots))?.name ?? 'research')}</small></div>`;
      if (!a) return `<div class="slot free"><span>Slot ${i + 1}</span><small>Free — pick an available tech</small></div>`;
      const t = R.byId[a.id];
      return `<div class="slot busy"><span>${esc(t.name)}</span>${bar(a.done / a.total, `data-r="${t.id}"`)}<small data-r-left="${t.id}">${fmtHours(a.total - a.done)} left</small></div>`;
    }).join('');

    body.innerHTML = `
      <div class="slots">${slotHtml}</div>
      <div class="tree-wrap">
        <div class="tree" style="width:${width}px;height:${height}px">
          ${bands.map((b) => `<div class="band band-${b.id}" style="top:${b.top}px;height:${b.height}px"><span>${esc(b.label)}</span></div>`).join('')}
          ${[1, 2, 3].map((tier) => `<div class="tier-label" style="left:${PAD + (tier - 1) * COL_W}px;width:${CARD_W}px">Tier ${ROMAN[tier]}</div>`).join('')}
          <svg class="tree-lines" width="${width}" height="${height}" aria-hidden="true">${lines.join('')}</svg>
          ${cards}
        </div>
      </div>
      ${this.detailHtml()}`;
  }

  detailHtml() {
    const R = this.R, me = this.me;
    const t = this.selected && R.byId[this.selected];
    if (!t) return '<div class="tech-detail empty-detail"><p class="hint-line">Tap a tech for its effects, cost and time. Green lines lead to what you can research next.</p></div>';
    const st = R.status(me, t.id);
    const c = R.check(me, t.id, { ignoreCost: true });
    const can = c.ok && this.sim.economy.canAfford(me, t.cost);
    const act = R.of(me).active.find((a) => a.id === t.id);
    const branch = BRANCHES.find((b) => b.id === t.branch).label;
    return `<div class="tech-detail">
      <div class="td-head">
        <div><div class="eyebrow">${esc(branch.toUpperCase())} · TIER ${ROMAN[t.tier]}</div><h3>${esc(t.name)}</h3></div>
        <span class="td-status st-${st}">${STATUS_LABEL[st]}</span>
      </div>
      <ul class="td-fx">${R.describe(t).map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
      ${t.req.length ? `<div class="td-req">Requires ${t.req.map((q) => `<button type="button" class="req ${R.of(me).done.has(q) ? 'met' : ''}" data-tech="${q}">${R.of(me).done.has(q) ? '✓' : '✗'} ${esc(R.byId[q].name)}</button>`).join(' ')}</div>` : ''}
      <div class="td-act">
        ${st === 'done' ? '' : `<span class="td-cost">${costHtml(t.cost, this.sim.economy.get(me), this.sim.economy.set)}<span class="cost-chip">⏱ ${fmtHours(t.hours)}</span></span>`}
        ${act ? `${bar(act.done / act.total, `data-r="${t.id}"`)}<small data-r-left="${t.id}">${fmtHours(act.total - act.done)} left</small><button type="button" class="btn small ghost" data-cancel="${t.id}">Cancel (refund)</button>` : ''}
        ${st === 'available' ? (c.ok ? `<button type="button" class="btn small primary" data-start="${t.id}" ${can ? '' : 'disabled'}>${can ? 'Research' : 'Not enough resources'}</button>` : `<span class="why">${esc(c.reason)}</span>`) : ''}
        ${st === 'locked' ? `<span class="why">${esc(c.reason)}</span>` : ''}
      </div>
    </div>`;
  }

  live(body) {
    const r = this.R.of(this.me);
    for (const el of body.querySelectorAll('[data-r]')) {
      const a = r.active.find((x) => x.id === el.dataset.r);
      if (a) el.style.width = `${Math.min(100, (100 * a.done) / a.total).toFixed(0)}%`;
    }
    for (const el of body.querySelectorAll('[data-r-left]')) {
      const a = r.active.find((x) => x.id === el.dataset.rLeft);
      if (a) el.textContent = `${fmtHours(a.total - a.done)} left`;
    }
  }

  onClick(e) {
    const b = e.target.closest('button');
    if (!b) return false;
    const d = b.dataset;
    if (d.tech) { this.selected = d.tech; return true; }
    if (d.start) {
      const r = this.R.start(this.me, d.start);
      if (r.error) this.actions.notice(r.error); else this.actions.notice(`Researching ${this.R.byId[d.start].name}`);
      return true;
    }
    if (d.cancel) { this.R.cancel(this.me, d.cancel); return true; }
    return false;
  }
}
