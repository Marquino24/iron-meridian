/**
 * win-research.js — Research window: the era's tech tree and active bonuses.
 *
 * Top: research slots (progress, time left) and the queue (up to 5; the
 * next one starts by itself when a slot frees up).
 * Tree tab: three bands (Military, Economy, Infrastructure) × one column per
 * tier (three or four, depending on the era), signature techs starred, with lines from each requirement to the techs it opens. A tech is
 * locked, available, researching (progress bar + time left) or done. Tap one
 * for its cost, time, requirements and exact effects; research it now, queue
 * it, or cancel it.
 * Bonuses tab: everything your research currently adds, with its sources.
 */

import { esc, fmtHours, costHtml, bar, ROMAN } from './ui-kit.js';
import { BRANCHES, SIGNATURES } from './tech.js';
import { QUEUE_MAX } from './research.js';

const COL_W = 196, CARD_W = 172, CARD_H = 58, ROW_H = 68, BAND_HEAD = 26, BAND_GAP = 14, PAD = 10;
/** Card labels for the era signatures (the full text is in the detail panel). */
const SIGNATURE_SHORT = {
  testudo: 'testudo', roadSpeed: 'faster on roads', heal: 'faster healing', noRevolt: 'no revolts',
  fortStrength: 'stronger forts', levies: 'feudal levies', siege: 'faster sieges', zeal: 'less exhaustion',
  entrench: 'entrenchment', gas: 'gas attacks', recon: 'first-day strike', railMob: 'rail movement',
  radar: 'coastal radar', carriers: 'carrier escort', blitz: 'blitzkrieg', airmobile: 'air assault',
  interdict: 'interdiction', deterrence: 'deterrence', drones: 'drone defense', precision: 'precision',
  cyber: 'cyber attacks', researchSpeed: 'faster research',
};
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
    this.tab = 'tree';
  }

  get R() { return this.sim.research; }
  get me() { return this.state.playerNationId; }

  /** Compact effect label for a card. */
  short(e) {
    const roster = this.sim.armies.roster;
    const B = this.sim.buildings;
    const lbl = (k) => this.sim.economy.label(k).toLowerCase();
    if (e.unit) return `${roster.byRole[e.unit]?.name ?? e.unit} Lv ${ROMAN[e.level]}`;
    if (e.building) return `${B.name(e.building)} III`;
    if (e.prod) return e.prod === 'all' ? `+${e.pct}% all output` : `+${e.pct}% ${lbl(e.prod)}`;
    if (e.synth) return `+synthetic ${lbl(e.to)}`;
    if (e.move) return `+${e.move}% speed`;
    if (e.defense) return `+${e.defense}% defense`;
    if (e.attack) return `+${e.pct}% attack`;
    if (e.buildTime) return `build −${e.buildTime}% time`;
    if (e.buildCost) return `build −${e.buildCost}% cost`;
    if (e.trainTime) return `train −${e.trainTime}% time`;
    if (e.slots) return '+1 research slot';
    if (e.integration) return `integration +${e.integration}%`;
    const k = Object.keys(e)[0];
    if (SIGNATURES[k]) return `★ ${SIGNATURE_SHORT[k] ?? k}`;
    return '';
  }

  /** Card positions and band extents. */
  layout() {
    const pos = {};
    let y = 0;
    const bands = [];
    for (const b of BRANCHES) {
      const techs = this.R.tree.filter((t) => t.branch === b.id);
      const rows = Math.max(...this.tiers().map((tier) => techs.filter((t) => t.tier === tier).length));
      bands.push({ ...b, top: y, height: BAND_HEAD + rows * ROW_H });
      for (const tier of this.tiers()) {
        techs.filter((t) => t.tier === tier).forEach((t, i) => {
          pos[t.id] = { x: PAD + (tier - 1) * COL_W, y: y + BAND_HEAD + i * ROW_H };
        });
      }
      y += BAND_HEAD + rows * ROW_H + BAND_GAP;
    }
    return { pos, bands, width: PAD * 2 + (this.tiers().length - 1) * COL_W + CARD_W, height: y - BAND_GAP + PAD };
  }

  /** The era's tiers, 1 to 3 or 4. */
  tiers() { const n = Math.max(...this.R.tree.map((t) => t.tier)); return Array.from({ length: n }, (_, i) => i + 1); }

  signature() {
    const R = this.R, me = this.me;
    const r = R.of(me);
    const sel = this.selected && R.byId[this.selected];
    return [this.tab, this.selected, R.slots(me), r.active.map((a) => a.id).join(','), r.queue.join(','),
      r.queue.map((q) => R.waitingReason(me, q)).join(','),
      R.tree.map((t) => R.status(me, t.id)[0]).join(''), sel ? +this.sim.economy.canAfford(me, sel.cost) : ''].join('|');
  }

  subtitle() {
    const R = this.R, me = this.me;
    return `${R.of(me).done.size} of ${R.tree.length} researched · slots ${R.of(me).active.length}/${R.slots(me)} · queue ${R.of(me).queue.length}/${QUEUE_MAX}`;
  }

  render(body) {
    body.innerHTML = `
      ${this.slotsHtml()}
      <div class="tabs" role="tablist">
        <button type="button" role="tab" data-rtab="tree" aria-selected="${this.tab === 'tree'}" class="${this.tab === 'tree' ? 'on' : ''}">Tech tree</button>
        <button type="button" role="tab" data-rtab="bonuses" aria-selected="${this.tab === 'bonuses'}" class="${this.tab === 'bonuses' ? 'on' : ''}">Bonuses</button>
      </div>
      ${this.tab === 'tree' ? this.treeHtml() + this.detailHtml() : this.bonusesHtml()}`;
  }

  slotsHtml() {
    const R = this.R, me = this.me;
    const r = R.of(me);
    const slots = R.slots(me);
    const slotTechs = R.tree.filter((t) => t.effects.some((e) => e.slots)).map((t) => t.name);
    const cells = Array.from({ length: Math.max(slots, 3) }, (_, i) => {
      const a = r.active[i];
      if (i >= slots) return `<div class="slot locked"><span>Slot ${i + 1}</span><small>Unlocked by ${esc(slotTechs[i - 1] ?? 'research')}</small></div>`;
      if (!a) return `<div class="slot free"><span>Slot ${i + 1} · idle</span><small>${r.queue.length ? 'Queue waiting' : 'Pick an available tech'}</small></div>`;
      const t = R.byId[a.id];
      return `<button type="button" class="slot busy" data-tech="${t.id}"><span>${esc(t.name)}</span>${bar(a.done / a.total, `data-r="${t.id}"`)}<small data-r-left="${t.id}">${fmtHours(a.total - a.done)} left</small></button>`;
    }).join('');
    const queue = r.queue.map((id, i) => `<li class="q-item"><button type="button" class="q-name" data-tech="${id}"><b>${i + 1}</b> ${esc(R.byId[id].name)}<small>${esc(R.waitingReason(me, id))}</small></button>
      <button type="button" class="icon-btn" data-dequeue="${id}" aria-label="Remove ${esc(R.byId[id].name)} from the queue">✕</button></li>`).join('');
    return `<div class="slots">${cells}</div>
      <div class="r-queue"><span class="q-title">Queue ${r.queue.length}/${QUEUE_MAX}</span>
        ${r.queue.length ? `<ol>${queue}</ol>` : '<span class="q-empty">Empty — tap a tech and “Add to queue”; it starts by itself when a slot frees up.</span>'}</div>`;
  }

  treeHtml() {
    const R = this.R, me = this.me;
    const { pos, bands, width, height } = this.layout();
    const r = R.of(me);
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
      const qi = r.queue.indexOf(t.id);
      return `<button type="button" class="tech st-${st} ${t.signature ? 'sig' : ''} ${this.selected === t.id ? 'sel' : ''} ${qi >= 0 ? 'queued' : ''}" data-tech="${t.id}"
          style="left:${p.x}px;top:${p.y}px;width:${CARD_W}px;height:${CARD_H}px" aria-label="${esc(t.name)}${t.signature ? ' (era signature)' : ''}: ${STATUS_LABEL[st]}${qi >= 0 ? `, queued ${qi + 1}` : ''}">
        <span class="tech-name">${esc(t.name)}</span>
        <span class="tech-fx">${act ? `<span data-r-left="${t.id}">${fmtHours(act.total - act.done)} left</span>` : esc(t.effects.map((e) => this.short(e)).join(' · '))}</span>
        <span class="tech-ico" aria-hidden="true">${qi >= 0 ? `Q${qi + 1}` : STATUS_ICON[st]}</span>
        ${act ? bar(act.done / act.total, `data-r="${t.id}"`) : ''}
      </button>`;
    }).join('');
    return `<div class="tree-wrap">
        <div class="tree" style="width:${width}px;height:${height}px">
          ${bands.map((b) => `<div class="band band-${b.id}" style="top:${b.top}px;height:${b.height}px"><span>${esc(b.label)}</span></div>`).join('')}
          ${this.tiers().map((tier) => `<div class="tier-label" style="left:${PAD + (tier - 1) * COL_W}px;width:${CARD_W}px">Tier ${ROMAN[tier]}</div>`).join('')}
          <svg class="tree-lines" width="${width}" height="${height}" aria-hidden="true">${lines.join('')}</svg>
          ${cards}
        </div>
      </div>`;
  }

  detailHtml() {
    const R = this.R, me = this.me;
    const t = this.selected && R.byId[this.selected];
    if (!t) return '<div class="tech-detail empty-detail"><p class="hint-line">Tap a tech for its cost, time, requirements and effects. Green lines lead to what you can research next.</p></div>';
    const st = R.status(me, t.id);
    const c = R.check(me, t.id, { ignoreCost: true });
    const can = c.ok && this.sim.economy.canAfford(me, t.cost);
    const q = R.canQueue(me, t.id);
    const queued = R.queued(me, t.id);
    const act = R.of(me).active.find((a) => a.id === t.id);
    const branch = BRANCHES.find((b) => b.id === t.branch).label;
    const done = R.of(me).done;
    let buttons = '';
    if (act) buttons = `${bar(act.done / act.total, `data-r="${t.id}"`)}<small data-r-left="${t.id}">${fmtHours(act.total - act.done)} left</small><button type="button" class="btn small ghost" data-cancel="${t.id}">Cancel (refund)</button>`;
    else if (queued) buttons = `<span class="why">Queued: ${esc(R.waitingReason(me, t.id))}</span><button type="button" class="btn small ghost" data-dequeue="${t.id}">Remove from queue</button>`;
    else if (st !== 'done') {
      if (st === 'available' && c.ok) buttons += `<button type="button" class="btn small primary" data-start="${t.id}" ${can ? '' : 'disabled'}>${can ? 'Research now' : 'Not enough resources'}</button>`;
      else buttons += `<span class="why">${esc(c.reason)}</span>`;
      if (q.ok) buttons += `<button type="button" class="btn small ghost" data-enqueue="${t.id}">Add to queue</button>`;
    }
    return `<div class="tech-detail">
      <div class="td-head">
        <div><div class="eyebrow">${esc(branch.toUpperCase())} · TIER ${ROMAN[t.tier]}${t.signature ? ' · ★ ERA SIGNATURE' : ''}</div><h3>${esc(t.name)}</h3></div>
        <span class="td-status st-${st}">${STATUS_LABEL[st]}</span>
      </div>
      <ul class="td-fx">${R.describe(t).map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
      <div class="td-req">${t.req.length ? `Requires ${t.req.map((x) => `<button type="button" class="req ${done.has(x) ? 'met' : ''}" data-tech="${x}">${done.has(x) ? '✓' : '✗'} ${esc(R.byId[x].name)}</button>`).join(' ')}` : 'No requirements'}</div>
      <div class="td-act">
        ${st === 'done' ? '' : `<span class="td-cost">${costHtml(t.cost, this.sim.economy.get(me), this.sim.economy.set)}<span class="cost-chip">⏱ ${fmtHours(t.hours)}</span></span>`}
        ${buttons}
      </div>
    </div>`;
  }

  bonusesHtml() {
    const R = this.R, me = this.me;
    const A = this.sim.armies, B = this.sim.buildings, E = this.sim.economy;
    const rows = R.bonuses(me);
    const by = (prefix) => rows.filter((r) => r.key.startsWith(prefix));
    const src = (r) => `<small>${r.sources.map(esc).join(', ')}</small>`;
    const line = (label, value, r) => `<li><span>${label}</span><b>${value}</b>${r ? src(r) : ''}</li>`;

    const units = A.roster.units.map((t) => {
      const lvl = R.unitLevel(me, t.role);
      const s = A.unitType({ type: t.key, lvl });
      const r = rows.find((x) => x.key === `unit:${t.role}`);
      return line(`${esc(t.name)}`, `Level ${ROMAN[lvl]} · ATK ${s.attack} · DEF ${s.defense} · HP ${s.hp}`, r);
    }).join('');
    const prod = E.keys.map((k) => {
      const r = rows.find((x) => x.key === `prod:${k}`);
      const all = rows.find((x) => x.key === 'prod:all');
      const synth = rows.find((x) => x.key === `synth:${k}`);
      const pct = (r?.value ?? 0) + (all?.value ?? 0);
      if (!pct && !synth) return '';
      const sources = [...(r?.sources ?? []), ...(all?.sources ?? []), ...(synth?.sources ?? [])];
      const extra = synth ? ` + synthetic (${synth.value}% of ${esc(E.label(synth.label).toLowerCase())} output)` : '';
      return line(esc(E.label(k)), `+${pct}%${extra}`, { sources });
    }).join('');
    const pick = (k) => rows.find((x) => x.key === k);
    const misc = [
      ['slots', 'Research slots', (v) => `${R.slots(me)} (base 1 + ${v})`],
      ['move', 'Movement speed', (v) => `+${v}%`],
      ['defense', 'Defense', (v) => `+${v}%`],
      ['trainTime', 'Recruitment time', (v) => `−${v}%`],
      ['buildTime', 'Construction time', (v) => `−${v}%`],
      ['buildCost', 'Construction cost', (v) => `−${v}%`],
    ].map(([k, label, fmt]) => { const r = pick(k); return r ? line(label, fmt(r.value), r) : ''; }).join('')
      + by('attack:').map((r) => line(`${esc(A.roster.byRole[r.label]?.name ?? r.label)} attack`, `+${r.value}%`, r)).join('');
    const integ = pick('integration');
    const sigs = rows.filter((r) => SIGNATURES[r.key]).map((r) => line(`★ ${esc(r.sources.join(', '))}`, '', null).replace('<b></b>', `<small>${esc(SIGNATURES[r.key](r.value))}</small>`)).join('')
      + (integ ? line('Integration of conquered land', `+${integ.value}%`, integ) : '');
    const bld = B.types.map((k) => {
      const r = pick(`b:${k}`);
      return `<li><span>${esc(B.name(k))}</span><b class="${r ? '' : 'dim'}">${r ? 'Level III unlocked' : 'Up to level II'}</b>${r ? src(r) : `<small>needs ${esc(R.unlockerOf(k)?.name ?? '—')}</small>`}</li>`;
    }).join('');

    return `<div class="bonuses">
      <section><h4>Units</h4><ul>${units}</ul>
        <p class="hint-line">New recruits come at these levels. Existing units upgrade in a city with ${esc(B.name('barracks'))} (ships next to a ${esc(B.name('port'))}) for 20% of their price per level.</p></section>
      <section><h4>Production</h4><ul>${prod || '<li class="dim">No production bonuses yet.</li>'}</ul></section>
      <section><h4>Armies and logistics</h4><ul>${misc || `<li><span>Research slots</span><b>${R.slots(me)}</b></li>`}</ul></section>
      <section><h4>Era doctrines</h4><ul>${sigs || `<li class="dim">None yet: the starred techs are this era's own.</li>`}</ul></section>
      <section><h4>Buildings</h4><ul>${bld}</ul></section>
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
    const R = this.R, me = this.me;
    if (d.rtab) { this.tab = d.rtab; return true; }
    if (d.tech) { this.selected = d.tech; this.tab = 'tree'; return true; }
    if (d.start) {
      const r = this.sim.commands.issue('research.start', { tech: d.start });
      this.actions.notice(r.error ?? `Researching ${R.byId[d.start].name}`);
      return true;
    }
    if (d.enqueue) {
      const r = this.sim.commands.issue('research.queue', { tech: d.enqueue });
      this.actions.notice(r.error ?? (R.status(me, d.enqueue) === 'active' ? `Researching ${R.byId[d.enqueue].name}` : `Queued ${R.byId[d.enqueue].name}`));
      return true;
    }
    if (d.dequeue) { this.sim.commands.issue('research.dequeue', { tech: d.dequeue }); return true; }
    if (d.cancel) { this.sim.commands.issue('research.cancel', { tech: d.cancel }); return true; }
    return false;
  }
}
