/**
 * command-ui.js — The military/economic side of the HUD:
 *   - the era's resources in the top bar, with a daily-income tooltip;
 *   - the army panel (units, strength, split/merge, stop);
 *   - extra province-panel sections: forces present, occupation progress,
 *     Recruit and Build tabs for your cities, and the foreign nation's relations
 *     with a Declare War button (with confirmation).
 *
 * Panels re-render only when their structure changes (a signature string);
 * progress and HP bars update in place a few times a second, so buttons
 * never get replaced under a finger mid-tap.
 */

import { esc, fmtNum, fmtHours, costHtml, ROLE_LABEL, ROLE_GLYPH, BEATS, ROMAN, bar } from './ui-kit.js';
import { RESOURCES } from './resources.js';
import { BUILDINGS, MAX_LEVEL } from './buildings.js';


const $ = (sel, root = document) => root.querySelector(sel);

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

    this.cityTab = 'recruit';      // city panel: 'recruit' | 'build'

    this.el = {
      chips: $('#res-chips'),
      tip: $('#res-tip'),
      resources: $('#resources'),
    };
    this.bindResources();
    state.events.on('map:loaded', () => this.buildChips());
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
    // Mouse: hover shows it. Touch and keyboard: click toggles.
    resources.addEventListener('click', (e) => { if (e.pointerType !== 'mouse') (tip.hidden ? show() : hide()); });
    document.addEventListener('pointerdown', (e) => { if (!resources.contains(e.target)) hide(); });
  }

  /** One chip per era resource. */
  buildChips() {
    const E = this.sim.economy;
    this.el.chips.innerHTML = E.keys.map((k) => `
      <button type="button" class="res" data-res="${k}" aria-describedby="res-tip">
        <span class="res-ico" style="color:${RESOURCES[k].color}">${RESOURCES[k].icon}</span>
        <span class="res-body"><span class="eyebrow">${esc(E.label(k).toUpperCase())}</span><b data-res-val="${k}">0</b></span>
        <small data-res-inc="${k}">+0</small>
      </button>`).join('');
    this.lastRes = '';
  }

  renderTip() {
    const id = this.state.playerNationId;
    if (id < 0) return;
    const E = this.sim.economy;
    const inc = E.income(id);
    const rows = E.keys.map((k) => `<tr>
      <th><i style="color:${RESOURCES[k].color}">${RESOURCES[k].icon}</i> ${esc(E.label(k))}</th>
      <td>${fmtNum(inc.base[k])}</td><td>${inc.built[k] ? `+${fmtNum(inc.built[k])}` : '—'}</td><td>${inc.roads[k] >= 1 ? `+${fmtNum(inc.roads[k])}` : '—'}</td><td>${inc.tech?.[k] >= 1 ? `+${fmtNum(inc.tech[k])}` : '—'}</td>
      <td class="tot">+${fmtNum(inc.perDay[k])}</td></tr>`).join('');
    this.el.tip.innerHTML = `
      <div class="eyebrow">DAILY INCOME</div>
      <table>
        <thead><tr><th></th><th title="Provinces">Land</th><th title="Buildings">Bldg</th><th title="${esc(this.sim.buildings.name('roads'))}">Roads</th><th title="Research">Tech</th><th>/day</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${inc.factor < 1 ? '<p class="warn">Capital lost: everything ×0.5 until you retake it.</p>' : ''}
      <p>${inc.land} provinces, ${inc.cities} cities, ${inc.capitals} capital. Each province yields money and manpower by size (city 3×, capital 5×), food by fertility, ${esc(E.label('steel').toLowerCase())} more in mountains${E.keys.includes('oil') ? ', oil only from deposits' : ''}${E.keys.includes('electronics') ? ', electronics from cities and factories' : ''}. Buildings add more. Income arrives every hour.</p>`;
  }

  renderResources() {
    const id = this.state.playerNationId;
    if (id < 0) return;
    const E = this.sim.economy;
    const s = E.get(id);
    const inc = E.income(id);
    const text = E.keys.map((k) => `${fmtNum(s[k])}/${fmtNum(inc.perDay[k])}`).join('|') + inc.factor;
    if (text === this.lastRes) return;
    if (!this.el.chips.children.length) this.buildChips();
    this.lastRes = text;
    for (const k of E.keys) {
      const v = this.el.chips.querySelector(`[data-res-val="${k}"]`);
      if (v) v.textContent = fmtNum(s[k]);
      const i = this.el.chips.querySelector(`[data-res-inc="${k}"]`);
      if (i) i.textContent = `+${fmtNum(inc.perDay[k])}`;
    }
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
      this.sim.combat.inBattle(army), A.mergeable(army.id).map((a) => a.id).join(','), this.state.playerNationId,
      army.units.map((u) => u.lvl ?? 1).join(''), A.outdated(army).length].join('|');
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
        <span class="unit-name">${esc(t.name)}${(u.lvl ?? 1) > 1 ? ` <em class="lvl">${ROMAN[u.lvl]}</em>` : ''}</span>
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
      ${own && A.outdated(army).length ? `<p class="hint-line refit-note">▲ ${A.outdated(army).length} unit${A.outdated(army).length > 1 ? 's' : ''} can be upgraded with your research: ${army.kind === 'naval' ? 'anchor next to a city with a Port' : `rest in a city with ${esc(this.sim.buildings.name('barracks'))}`}.</p>` : ''}
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
    const B = this.sim.buildings, E = this.sim.economy;
    const afford = this.roster.units.map((t) => (E.canAfford(me, t.cost) ? 1 : 0)).join('')
      + B.types.map((k) => (E.canAfford(me, B.check(p.id, k, { ignoreCost: true }).cost) ? 1 : 0)).join('');
    return ['prov', p.id, p.owner, this.cityTab, Object.values(B.of(p.id)).join(''), B.construction.get(p.id)?.type ?? '', A.queue(p.id).length, [...A.at(p.id)].map((a) => `${a.id}.${a.units.length}`).join(','),
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

    if (p.oil && this.sim.buildings.set.industrial) out.push('<p class="hint-line oil-note">⬮ Oil deposit: an oil well here produces oil.</p>');
    if (p.owner === me) {
      const site = p.isCity || (p.oil && this.sim.buildings.set.industrial);
      if (site) {
        const tab = p.isCity ? this.cityTab : 'build';
        out.push(`<div class="tabs panel-tabs" role="tablist">
          ${p.isCity ? `<button type="button" role="tab" data-cmd="city-tab" data-tab="recruit" aria-selected="${tab === 'recruit'}" class="${tab === 'recruit' ? 'on' : ''}">Recruit${A.queue(p.id).length ? ` · ${A.queue(p.id).length}` : ''}</button>` : ''}
          <button type="button" role="tab" data-cmd="city-tab" data-tab="build" aria-selected="${tab === 'build'}" class="${tab === 'build' ? 'on' : ''}">Build${this.sim.buildings.construction.has(p.id) ? ' · 1' : ''}</button>
        </div>`);
        out.push(tab === 'recruit' ? this.recruitHtml(p) : this.buildHtml(p));
      } else out.push('<p class="hint-line">Recruit and build in cities you own.</p>');
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
      const c = A.recruitCheck(p.id, t.key, { ignoreCost: true });
      const ok = c.ok;
      const lvl = A.levelFor(me, t.key);
      const ts = A.unitType({ type: t.key, lvl });
      const afford = E.canAfford(me, t.cost);
      return `<li class="recruit-row${ok ? '' : ' na'}">
        <div class="recruit-main">
          <span class="unit-glyph r-${t.role}">${ROLE_GLYPH[t.role]}</span>
          <span class="unit-name">${esc(t.name)}</span>
          <small>${t.role === 'nav' ? 'sea only' : `beats ${ROLE_LABEL[BEATS[t.role]].toLowerCase()}`}</small>
        </div>
        <div class="recruit-stats">${lvl > 1 ? `<em class="lvl">LV ${ROMAN[lvl]}</em> ` : ''}ATK ${ts.attack} · DEF ${ts.defense} · HP ${ts.hp} · ${t.speed} km/h</div>
        <div class="recruit-cost">
          ${costHtml(t.cost, E.get(me), E.set)}<span class="cost-chip">⏱ ${fmtHours(c.hours ?? t.build)}</span>
        </div>
        <div class="recruit-act">${ok ? '' : `<span class="why">${esc(c.reason)}</span>`}
          <button type="button" class="btn small" data-cmd="recruit" data-type="${t.key}" ${ok && afford ? '' : 'disabled'}>Recruit</button></div>
      </li>`;
    }).join('');
    const q = A.queue(p.id);
    const queue = q.map((item, i) => {
      const t = this.roster.byKey[item.type];
      return `<li class="queue-row">
        <span class="unit-glyph r-${t.role}">${ROLE_GLYPH[t.role]}</span>
        <span class="unit-name">${esc(t.name)}</span>
        <span class="progress"><i data-qbar="${p.id}:${i}" style="width:${((100 * item.done) / item.total).toFixed(0)}%"></i></span>
        <span class="q-left" data-qleft="${p.id}:${i}">${i === 0 ? fmtHours(item.total - item.done) : 'queued'}</span>
        <button type="button" class="icon-btn" data-cmd="cancel" data-index="${i}" aria-label="Cancel and refund">✕</button>
      </li>`;
    }).join('');
    return `<ul class="recruit-list">${rows}</ul>
      ${q.length ? `<div class="section-title">QUEUE · ${q.length}</div><ul class="queue-list">${queue}</ul>` : ''}`;
  }

  buildHtml(p) {
    const B = this.sim.buildings, E = this.sim.economy;
    const me = this.state.playerNationId;
    const job = B.construction.get(p.id);
    const rows = B.types.map((k) => {
      const lv = B.level(p.id, k);
      const c = B.check(p.id, k, { ignoreCost: true });
      const na = !c.ok && lv === 0 && /only|coastal|No oil|WWI/.test(c.reason);
      if (na) return '';
      const afford = E.canAfford(me, c.cost);
      return `<li class="recruit-row build-row">
        <div class="recruit-main">
          <span class="unit-glyph">${BUILDINGS[k].glyph}</span>
          <span class="unit-name">${esc(B.name(k))}</span>
          <span class="pips">${[1, 2, 3].map((i) => `<i class="${i <= lv ? 'on' : job?.type === k && i === job.level ? 'next' : ''}"></i>`).join('')}</span>
        </div>
        <div class="recruit-stats">${lv < MAX_LEVEL ? `Level ${ROMAN[lv + 1]}: ${esc(B.describe(k, lv + 1))}` : `Max level: ${esc(B.describe(k, lv))}`}</div>
        ${lv < MAX_LEVEL ? `<div class="recruit-cost">${costHtml(c.cost, E.get(me), E.set)}<span class="cost-chip">⏱ ${fmtHours(c.hours)}</span></div>` : ''}
        <div class="recruit-act">${c.ok ? '' : `<span class="why">${esc(c.reason)}</span>`}
          ${lv < MAX_LEVEL ? `<button type="button" class="btn small" data-cmd="build" data-type="${k}" ${c.ok && afford ? '' : 'disabled'}>${lv ? 'Upgrade' : 'Build'}</button>` : ''}</div>
      </li>`;
    }).join('');
    const current = job ? `<div class="section-title">UNDER CONSTRUCTION</div>
      <div class="queue-row build-job"><span class="unit-glyph">${BUILDINGS[job.type].glyph}</span>
        <span class="unit-name">${esc(B.name(job.type))} ${ROMAN[job.level]}</span>
        ${bar(job.done / job.total, `data-c="${p.id}"`)}<span class="q-left" data-c-left="${p.id}">${fmtHours(job.total - job.done)}</span>
        <button type="button" class="icon-btn" data-cmd="cancel-build" aria-label="Cancel and refund">✕</button></div>` : '';
    return `${current}<ul class="recruit-list">${rows}</ul>
      <p class="hint-line">One construction at a time per city. All cities at once: Production (P) and Buildings (B) windows.</p>`;
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
      case 'city-tab': this.cityTab = b.dataset.tab; break;
      case 'build': {
        const r = this.sim.buildings.build(st.selectedProvinceId, b.dataset.type);
        if (r.error) this.actions.notice(r.error);
        break;
      }
      case 'cancel-build': this.sim.buildings.cancel(st.selectedProvinceId); break;
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
      const sb = panel.querySelector('[data-strength]');
      if (sb) { sb.style.width = `${(str * 100).toFixed(0)}%`; sb.className = str > 0.6 ? 'ok' : str > 0.3 ? 'mid' : 'low'; }
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
        if (item) el.style.width = `${((100 * item.done) / item.total).toFixed(0)}%`;
      }
      const first = panel.querySelector('[data-qleft]');
      if (first && q[0]) first.textContent = fmtHours(q[0].total - q[0].done);
      const job = this.sim.buildings.construction.get(p.id);
      const cb = panel.querySelector('[data-c]');
      if (job && cb) {
        cb.style.width = `${((100 * job.done) / job.total).toFixed(0)}%`;
        panel.querySelector('[data-c-left]').textContent = fmtHours(job.total - job.done);
      }
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
