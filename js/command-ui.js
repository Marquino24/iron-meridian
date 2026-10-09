/**
 * command-ui.js — The military/economic side of the HUD:
 *   - Money and Manpower in the top bar, with a daily-income tooltip;
 *   - the army panel (units, strength, split/merge, stop);
 *   - extra province-panel sections: forces present, occupation progress,
 *     recruitment queue for your cities, and the foreign nation's relations
 *     with a Declare War button (with confirmation).
 *
 * Panels re-render only when their structure changes (a signature string);
 * progress and HP bars update in place a few times a second, so buttons
 * never get replaced under a finger mid-tap.
 */

import { fmtHours } from './render-units.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function fmtNum(v) {
  const n = Math.floor(v);
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return n.toLocaleString('en-US');
}

const ROLE_LABEL = { inf: 'Infantry', mob: 'Mobile', rng: 'Ranged', nav: 'Naval' };
const ROLE_GLYPH = { inf: '✕', mob: '⬭', rng: '●', nav: '⛴' };
const BEATS = { inf: 'mob', mob: 'rng', rng: 'inf' };

export class CommandUI {
  /**
   * @param {import('./state.js').GameState} state
   * @param {{ economy, armies, combat }} sim
   * @param {{ focusNode(node:number):void, openBattle(id:number):void, rerender():void, notice(text:string):void }} actions
   */
  constructor(state, sim, actions) {
    this.state = state;
    this.sim = sim;
    this.actions = actions;
    this.checked = new Set();     // unit objects ticked in the army panel
    this.confirmWar = -1;         // nation awaiting the war confirmation
    this.signature = '';
    this.timer = 0;
    this.lastRes = '';

    this.el = {
      money: $('#res-money'),
      moneyInc: $('#res-money-inc'),
      manpower: $('#res-manpower'),
      manpowerInc: $('#res-manpower-inc'),
      tip: $('#res-tip'),
      resources: $('#resources'),
    };
    this.bindResources();
    state.events.on('select:army', () => { this.checked.clear(); this.confirmWar = -1; });
    state.events.on('select', () => { this.confirmWar = -1; });
  }

  get roster() { return this.sim.armies.roster; }

  // --- Top bar ------------------------------------------------------------------

  bindResources() {
    const { resources, tip } = this.el;
    const show = () => { this.renderTip(); tip.hidden = false; };
    const hide = () => { tip.hidden = true; };
    resources.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') show(); });
    resources.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
    resources.addEventListener('click', () => (tip.hidden ? show() : hide()));
    document.addEventListener('pointerdown', (e) => { if (!resources.contains(e.target)) hide(); });
  }

  renderTip() {
    const id = this.state.playerNationId;
    if (id < 0) return;
    const inc = this.sim.economy.income(id);
    const cur = this.roster.currency;
    const row = (label, n, share) => `<tr><th>${label}</th><td>${n}</td><td>${fmtNum(n * share * inc.perShare.money * inc.factor)}</td><td>${fmtNum(n * share * inc.perShare.manpower * inc.factor)}</td></tr>`;
    this.el.tip.innerHTML = `
      <div class="eyebrow">DAILY INCOME</div>
      <table>
        <thead><tr><th></th><th>#</th><th>Money</th><th>Manpower</th></tr></thead>
        <tbody>
          ${row('Provinces', inc.land, 1)}
          ${row('Cities ×3', inc.cities, 3)}
          ${row('Capital ×5', inc.capitals, 5)}
        </tbody>
        <tfoot><tr><th>Per day</th><td></td><td>+${fmtNum(inc.money)}</td><td>+${fmtNum(inc.manpower)}</td></tr></tfoot>
      </table>
      ${inc.factor < 1 ? '<p class="warn">Capital lost: production −50% until you retake it.</p>' : ''}
      <p>Money is in ${esc(cur)}. Manpower comes from population, which follows the same shares (cities 3×, capitals 5×). Income arrives every hour.</p>`;
  }

  renderResources() {
    const id = this.state.playerNationId;
    if (id < 0) return;
    const s = this.sim.economy.get(id);
    const inc = this.sim.economy.income(id);
    const text = `${fmtNum(s.money)}|${fmtNum(s.manpower)}|${fmtNum(inc.money)}|${fmtNum(inc.manpower)}|${inc.factor}`;
    if (text === this.lastRes) return;
    this.lastRes = text;
    this.el.money.textContent = fmtNum(s.money);
    this.el.manpower.textContent = fmtNum(s.manpower);
    this.el.moneyInc.textContent = `+${fmtNum(inc.money)}/d`;
    this.el.manpowerInc.textContent = `+${fmtNum(inc.manpower)}/d`;
    this.el.resources.classList.toggle('penalty', inc.factor < 1);
    if (!this.el.tip.hidden) this.renderTip();
  }

  // --- Army panel ----------------------------------------------------------------

  armyStatus(army) {
    const A = this.sim.armies, C = this.sim.combat;
    const b = C.battleOf(army);
    if (b) return { text: `In battle at ${b.place}`, tone: 'red' };
    if (army.retreating && army.seg) return { text: `Retreating to ${A.nodeName(army.seg.to)}`, tone: 'red' };
    if (army.seg || army.path.length) {
      const dest = army.dest ?? army.seg?.to;
      return { text: `Moving to ${A.nodeName(dest)} · ETA ${fmtHours(A.remainingHours(army))}`, tone: 'amber' };
    }
    const occ = C.occupations.get(army.node);
    if (occ && occ.nation === army.nation) return { text: `Occupying · ${Math.floor((100 * occ.done) / occ.total)}%`, tone: 'amber' };
    if (A.isSea(army.node) && army.kind === 'land') return { text: 'Embarked at sea', tone: 'cyan' };
    return { text: army.garrison ? 'Garrisoned' : 'Holding position', tone: '' };
  }

  armySignature(army) {
    const A = this.sim.armies;
    return ['army', army.id, army.units.length, army.node, !!army.seg, army.path.length, army.retreating,
      this.sim.combat.inBattle(army), A.mergeable(army.id).map((a) => a.id).join(','), this.state.playerNationId].join('|');
  }

  armyHtml(army) {
    const A = this.sim.armies, C = this.sim.combat, st = this.state;
    const nation = st.getNation(army.nation);
    const own = army.nation === st.playerNationId;
    const hostile = C.atWar(st.playerNationId, army.nation);
    const atSea = A.isSea(army.node);
    const tags = [
      army.kind === 'naval' ? '<span class="tag cyan">FLEET</span>' : '',
      army.garrison ? '<span class="tag">GARRISON</span>' : '',
      army.kind === 'land' && atSea ? '<span class="tag cyan">EMBARKED</span>' : '',
      C.inBattle(army) ? '<span class="tag red">⚔ IN BATTLE</span>' : '',
      own ? '<span class="tag green">YOURS</span>' : hostile ? '<span class="tag red">ENEMY</span>' : '<span class="tag">FOREIGN</span>',
    ].join('');
    const status = this.armyStatus(army);
    const str = A.strength(army);
    const speed = A.speedOf(army, atSea);

    const rows = army.units.map((u, i) => {
      const t = A.unitType(u);
      const pct = Math.max(0, u.hp / t.hp);
      return `<li class="unit-row">
        ${own ? `<label class="unit-check"><input type="checkbox" data-unit="${i}" ${this.checked.has(u) ? 'checked' : ''} aria-label="Select ${esc(t.name)}"></label>` : ''}
        <span class="unit-glyph r-${t.role}" title="${ROLE_LABEL[t.role]}">${ROLE_GLYPH[t.role]}</span>
        <span class="unit-name">${esc(t.name)}</span>
        <span class="hpbar"><i data-hpbar="${army.id}:${i}" style="width:${(pct * 100).toFixed(0)}%" class="${pct > 0.6 ? 'ok' : pct > 0.3 ? 'mid' : 'low'}"></i></span>
        <span class="hp-num" data-hpnum="${army.id}:${i}">${Math.ceil(Math.max(0, u.hp))}</span>
      </li>`;
    }).join('');

    const merge = own ? A.mergeable(army.id) : [];
    const canEdit = own && !army.seg && !C.inBattle(army);
    return `
      <div class="panel-head">
        <div>
          <div class="eyebrow">${army.kind === 'naval' ? 'FLEET' : 'ARMY'} · ${esc(nation.shortName.toUpperCase())}</div>
          <h2>${esc(army.name)}</h2>
        </div>
        <button type="button" class="icon-btn" data-cmd="close-army" aria-label="Close panel">✕</button>
      </div>
      <div class="tags">${tags}</div>
      <dl class="stats">
        <dt>STATUS</dt><dd class="status-${status.tone}" data-army-status>${esc(status.text)}</dd>
        <dt>LOCATION</dt><dd><button type="button" class="link-btn" data-cmd="goto" data-node="${army.seg ? army.seg.to : army.node}">${esc(A.nodeName(army.node))}</button></dd>
        <dt>STRENGTH</dt><dd><span class="hpbar wide"><i data-strength style="width:${(str * 100).toFixed(0)}%" class="${str > 0.6 ? 'ok' : str > 0.3 ? 'mid' : 'low'}"></i></span><span data-strength-num>${Math.round(str * 100)}%</span></dd>
        <dt>SPEED</dt><dd>${speed} km/h${atSea && army.kind === 'land' ? ' (transports)' : ''}</dd>
      </dl>
      <div class="section-title">UNITS · ${army.units.length}</div>
      <ul class="unit-list">${rows}</ul>
      ${own ? `
        <div class="btn-row">
          <button type="button" class="btn small" data-cmd="split" ${canEdit && this.checked.size && this.checked.size < army.units.length ? '' : 'disabled'}>Split selected</button>
          <button type="button" class="btn small" data-cmd="split-half" ${canEdit && army.units.length > 1 ? '' : 'disabled'}>Split in half</button>
          ${army.seg || army.path.length ? '<button type="button" class="btn small ghost" data-cmd="stop">Stop</button>' : ''}
        </div>
        ${merge.length ? `<div class="section-title">MERGE WITH</div><ul class="merge-list">${merge.map((m) => `<li><button type="button" class="btn small ghost" data-cmd="merge" data-army="${m.id}">${esc(m.name)} · ${m.units.length} units</button></li>`).join('')}</ul>` : ''}
        <p class="hint-line">${army.kind === 'naval' ? 'Click a sea zone or a coast to sail there.' : 'Click a province to march there. From a coast, armies can cross the sea (slow, and weak if caught).'} Esc to deselect.</p>` : ''}`;
  }

  // --- Province panel extras -----------------------------------------------------

  provinceSignature(p) {
    const A = this.sim.armies, C = this.sim.combat, st = this.state;
    const me = st.playerNationId;
    const afford = this.roster.units.map((t) => (this.sim.economy.canAfford(me, t.cost) ? 1 : 0)).join('');
    return ['prov', p.id, p.owner, A.queue(p.id).length, [...A.at(p.id)].map((a) => `${a.id}.${a.units.length}`).join(','),
      C.atWar(me, p.owner), C.occupations.has(p.id), C.active.has(p.id), afford, this.confirmWar, me].join('|');
  }

  provinceHtml(p) {
    const A = this.sim.armies, C = this.sim.combat, st = this.state;
    const me = st.playerNationId;
    const out = [];

    const occ = C.occupations.get(p.id);
    if (occ) {
      const who = st.getNation(occ.nation);
      out.push(`<div class="occupation"><span>OCCUPATION · ${esc(who.shortName.toUpperCase())}</span>
        <span class="progress"><i data-occ style="width:${((100 * occ.done) / occ.total).toFixed(0)}%"></i></span>
        <span data-occ-left>${fmtHours(occ.total - occ.done)} left</span></div>`);
    }
    const battle = C.active.get(p.id);
    if (battle) out.push(`<button type="button" class="battle-link" data-cmd="battle" data-battle="${battle.id}">⚔ Battle in progress — view report</button>`);

    // Forces present.
    const here = [...A.at(p.id)].filter((a) => a.units.length);
    const passing = [...A.list.values()].filter((a) => a.seg && a.seg.to === p.id);
    if (here.length || passing.length) {
      const item = (a, moving) => {
        const n = st.getNation(a.nation);
        return `<li><button type="button" data-cmd="select-army" data-army="${a.id}">
          <i style="background:${n.color}"></i>${esc(a.name)}${moving ? ' <small>arriving</small>' : ''}
          <small>${a.nation === me ? 'YOURS' : esc(n.shortName)} · ${a.units.length}</small></button></li>`;
      };
      out.push(`<div class="section-title">FORCES HERE</div><ul class="neighbor-list forces">${here.map((a) => item(a, false)).join('')}${passing.map((a) => item(a, true)).join('')}</ul>`);
    }

    if (p.owner === me) {
      if (p.isCity) out.push(this.recruitHtml(p));
      else out.push('<p class="hint-line">Recruit units in cities you own.</p>');
    } else if (p.owner >= 0) {
      out.push(this.nationHtml(st.getNation(p.owner)));
    } else {
      out.push('<p class="hint-line">Unclaimed land: any army can march in and claim it.</p>');
    }
    return out.join('');
  }

  recruitHtml(p) {
    const A = this.sim.armies, E = this.sim.economy, st = this.state;
    const me = st.playerNationId;
    const rows = this.roster.units.map((t) => {
      const ok = A.canRecruit(p.id, t.key);
      const afford = E.canAfford(me, t.cost);
      return `<li class="recruit-row${ok ? '' : ' na'}">
        <div class="recruit-main">
          <span class="unit-glyph r-${t.role}">${ROLE_GLYPH[t.role]}</span>
          <span class="unit-name">${esc(t.name)}</span>
          <small>${t.role === 'nav' ? 'sea only' : `beats ${ROLE_LABEL[BEATS[t.role]].toLowerCase()}`}</small>
        </div>
        <div class="recruit-stats">ATK ${t.attack} · DEF ${t.defense} · HP ${t.hp} · ${t.speed} km/h</div>
        <div class="recruit-cost">
          <span class="${E.get(me).money >= t.cost.money ? '' : 'short'}">◉ ${fmtNum(t.cost.money)}</span>
          <span class="${E.get(me).manpower >= t.cost.manpower ? '' : 'short'}">♟ ${fmtNum(t.cost.manpower)}</span>
          <span>⏱ ${fmtHours(t.build)}</span>
          <button type="button" class="btn small" data-cmd="recruit" data-type="${t.key}" ${ok && afford ? '' : 'disabled'}>${ok ? 'Recruit' : 'No port'}</button>
        </div>
      </li>`;
    }).join('');
    const q = A.queue(p.id);
    const queue = q.map((item, i) => {
      const t = this.roster.byKey[item.type];
      return `<li class="queue-row">
        <span class="unit-glyph r-${t.role}">${ROLE_GLYPH[t.role]}</span>
        <span class="unit-name">${esc(t.name)}</span>
        <span class="progress"><i data-qbar="${p.id}:${i}" style="width:${((100 * item.done) / t.build).toFixed(0)}%"></i></span>
        <span class="q-left" data-qleft="${p.id}:${i}">${i === 0 ? fmtHours(t.build - item.done) : 'queued'}</span>
        <button type="button" class="icon-btn" data-cmd="cancel" data-index="${i}" aria-label="Cancel and refund">✕</button>
      </li>`;
    }).join('');
    return `<div class="section-title">RECRUIT</div>
      <ul class="recruit-list">${rows}</ul>
      ${q.length ? `<div class="section-title">QUEUE · ${q.length}</div><ul class="queue-list">${queue}</ul>` : ''}`;
  }

  nationHtml(n) {
    const st = this.state, C = this.sim.combat;
    const me = st.playerNationId;
    const war = C.atWar(me, n.id);
    const stats = st.nationStats(n.id);
    const capLost = this.sim.economy.capitalLost(n.id);
    let action;
    if (war) action = '<div class="war-state">⚔ AT WAR — your armies may enter its land</div>';
    else if (this.confirmWar === n.id) {
      action = `<div class="confirm">
        <p>Declare war on <b>${esc(n.name)}</b>? Your armies can then enter its land, and its garrisons will fight back.</p>
        <div class="btn-row"><button type="button" class="btn small danger" data-cmd="war-confirm" data-nation="${n.id}">Declare war</button>
        <button type="button" class="btn small ghost" data-cmd="war-cancel">Cancel</button></div></div>`;
    } else action = `<button type="button" class="btn danger wide" data-cmd="war" data-nation="${n.id}">Declare war</button>`;
    return `<div class="section-title">NATION</div>
      <div class="nation-card" style="--nation:${n.color}">
        <div class="nation-card-name">${esc(n.name)}</div>
        <div class="nation-card-stats">${stats.provinces} provinces · ${stats.cities} cities${capLost ? ' · <span class="short">capital lost</span>' : ''}</div>
        <div class="nation-card-rel">${war ? '<span class="tag red">AT WAR</span>' : '<span class="tag">AT PEACE</span>'}</div>
      </div>
      ${action}`;
  }

  // --- Clicks ---------------------------------------------------------------------

  /** Handle a click inside the panel. Returns true if it was ours. */
  handleClick(e) {
    const b = e.target.closest('[data-cmd]');
    if (!b || b.disabled) return false;
    const st = this.state, A = this.sim.armies, C = this.sim.combat;
    const cmd = b.dataset.cmd;
    const armyId = st.selectedArmyId;
    switch (cmd) {
      case 'close-army': st.setSelectedArmy(-1); break;
      case 'select-army': st.setSelected(-1); st.setSelectedArmy(Number(b.dataset.army)); break;
      case 'goto': this.actions.focusNode(Number(b.dataset.node)); break;
      case 'battle': this.actions.openBattle(Number(b.dataset.battle)); break;
      case 'stop': A.stop(armyId); break;
      case 'split': {
        const army = A.list.get(armyId);
        const idx = army.units.map((u, i) => (this.checked.has(u) ? i : -1)).filter((i) => i >= 0);
        const other = A.split(armyId, idx);
        this.checked.clear();
        if (other) this.actions.notice(`${other.name} formed with ${other.units.length} units`);
        break;
      }
      case 'split-half': {
        const other = A.splitHalf(armyId);
        this.checked.clear();
        if (other) this.actions.notice(`${other.name} formed with ${other.units.length} units`);
        break;
      }
      case 'merge': A.merge(armyId, Number(b.dataset.army)); break;
      case 'recruit': {
        const r = A.recruit(st.selectedProvinceId, b.dataset.type);
        if (r.error) this.actions.notice(r.error);
        break;
      }
      case 'cancel': A.cancel(st.selectedProvinceId, Number(b.dataset.index)); break;
      case 'war': this.confirmWar = Number(b.dataset.nation); break;
      case 'war-cancel': this.confirmWar = -1; break;
      case 'war-confirm': C.declareWar(st.playerNationId, Number(b.dataset.nation)); this.confirmWar = -1; break;
      default: return false;
    }
    this.actions.rerender();
    return true;
  }

  handleChange(e) {
    const box = e.target.closest('[data-unit]');
    if (!box) return;
    const army = this.sim.armies.list.get(this.state.selectedArmyId);
    const u = army?.units[Number(box.dataset.unit)];
    if (!u) return;
    if (box.checked) this.checked.add(u); else this.checked.delete(u);
    const split = document.querySelector('#province-panel [data-cmd="split"]');
    const canEdit = !army.seg && !this.sim.combat.inBattle(army);
    if (split) split.disabled = !(canEdit && this.checked.size && this.checked.size < army.units.length);
  }

  // --- Per-frame -------------------------------------------------------------------

  /** Live numbers. Returns true when the open panel needs a structural re-render. */
  update(dt, panel) {
    this.timer += dt;
    if (this.timer < 0.2) return false;
    this.timer = 0;
    this.renderResources();
    const st = this.state, A = this.sim.armies, C = this.sim.combat;
    const army = A.list.get(st.selectedArmyId);
    const p = st.getProvince(st.selectedProvinceId);
    const sig = army ? this.armySignature(army) : p ? this.provinceSignature(p) : '';
    if (sig !== this.signature) return true;

    if (army) {
      for (const el of panel.querySelectorAll('[data-hpbar]')) {
        const u = army.units[Number(el.dataset.hpbar.split(':')[1])];
        if (!u) continue;
        const pct = Math.max(0, u.hp / A.unitType(u).hp);
        el.style.width = `${(pct * 100).toFixed(0)}%`;
        el.className = pct > 0.6 ? 'ok' : pct > 0.3 ? 'mid' : 'low';
      }
      for (const el of panel.querySelectorAll('[data-hpnum]')) {
        const u = army.units[Number(el.dataset.hpnum.split(':')[1])];
        if (u) el.textContent = Math.ceil(Math.max(0, u.hp));
      }
      const str = A.strength(army);
      const bar = panel.querySelector('[data-strength]');
      if (bar) { bar.style.width = `${(str * 100).toFixed(0)}%`; bar.className = str > 0.6 ? 'ok' : str > 0.3 ? 'mid' : 'low'; }
      const num = panel.querySelector('[data-strength-num]');
      if (num) num.textContent = `${Math.round(str * 100)}%`;
      const status = panel.querySelector('[data-army-status]');
      if (status) {
        const s = this.armyStatus(army);
        status.textContent = s.text;
        status.className = `status-${s.tone}`;
      }
    } else if (p) {
      const q = A.queue(p.id);
      for (const el of panel.querySelectorAll('[data-qbar]')) {
        const item = q[Number(el.dataset.qbar.split(':')[1])];
        if (item) el.style.width = `${((100 * item.done) / this.roster.byKey[item.type].build).toFixed(0)}%`;
      }
      const first = panel.querySelector('[data-qleft]');
      if (first && q[0]) first.textContent = fmtHours(this.roster.byKey[q[0].type].build - q[0].done);
      const occ = C.occupations.get(p.id);
      const occBar = panel.querySelector('[data-occ]');
      if (occ && occBar) {
        occBar.style.width = `${((100 * occ.done) / occ.total).toFixed(0)}%`;
        panel.querySelector('[data-occ-left]').textContent = `${fmtHours(occ.total - occ.done)} left`;
      }
    }
    return false;
  }

  /** Remember what the panel shows now (called after each full render). */
  markRendered() {
    const st = this.state;
    const army = this.sim.armies.list.get(st.selectedArmyId);
    const p = st.getProvince(st.selectedProvinceId);
    this.signature = army ? this.armySignature(army) : p ? this.provinceSignature(p) : '';
  }
}
