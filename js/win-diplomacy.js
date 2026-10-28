/**
 * win-diplomacy.js — Diplomacy window (D): every nation you've met.
 *
 * Rows: flag, name, relation, their opinion of you (hover for the reasons),
 * military power next to yours. Sort by opinion, power, relation or name.
 * Picking a nation opens its page: opinion reasons, treaties to propose or
 * cancel, asking an ally into a war, trade and gifts (with a preview of their
 * answer), war and peace.
 */

import { esc, fmtNum } from './ui-kit.js';
import { drawFlag } from './flags.js';
import { TREATIES, RELATION_LABEL, RELATION_ORDER } from './diplomacy.js';
import { RESOURCES } from './resources.js';

const FILTERS = [['all', 'All met'], ['allies', 'Allies'], ['war', 'At war'], ['neighbors', 'Neighbours']];
const SORTS = [['opinion', 'Opinion'], ['power', 'Power'], ['relation', 'Relation'], ['name', 'Name']];

export class DiplomacyWindow {
  constructor(state, sim, actions) {
    this.id = 'diplomacy';
    this.title = 'Diplomacy';
    this.key = 'd';
    this.state = state;
    this.sim = sim;
    this.actions = actions; // { notice, focusNation }
    this.filter = 'all';
    this.sort = 'opinion';
    this.dir = -1;
    this.sel = -1;
    this.confirmWar = false;
    this.trade = { give: 'money', giveAmt: 500, take: 'steel', takeAmt: 200 };
    this.joinTarget = -1;
    state.events.on('map:loaded', () => { this.sel = -1; });
  }

  get D() { return this.sim.diplomacy; }
  get me() { return this.state.playerNationId; }

  rows() {
    const st = this.state, D = this.D, ai = this.sim.ai, me = this.me;
    const alive = new Set(st.provinces.map((p) => p.owner));
    let ids = [...D.met(me)].filter((id) => id !== me && alive.has(id));
    const neighbors = ai.neighborsOf(me);
    if (this.filter === 'allies') ids = ids.filter((id) => D.has(me, id, 'alliance'));
    if (this.filter === 'war') ids = ids.filter((id) => this.sim.combat.atWar(me, id));
    if (this.filter === 'neighbors') ids = ids.filter((id) => neighbors.has(id));
    const rows = ids.map((id) => ({ id, n: st.getNation(id), rel: D.relation(me, id), op: D.opinion(id, me), power: ai.powerOf(id) }));
    const key = { opinion: (r) => r.op.value, power: (r) => r.power, relation: (r) => RELATION_ORDER[r.rel], name: (r) => r.n.name }[this.sort];
    rows.sort((a, b) => {
      const p = key(a), q = key(b);
      return (typeof p === 'string' ? p.localeCompare(q) : p - q) * this.dir || a.id - b.id;
    });
    return rows;
  }

  signature() {
    const D = this.D;
    const day = Math.floor(this.state.clock.time / 864e5);
    const stock = this.sel >= 0 ? JSON.stringify(this.sim.economy.get(this.me)) : '';
    return [this.filter, this.sort, this.dir, this.sel, this.me, D.version, day, this.sim.combat.wars.size, this.confirmWar, JSON.stringify(this.trade), this.joinTarget, stock].join('|');
  }

  subtitle() {
    const D = this.D, me = this.me;
    const met = D.met(me).size;
    return `${met} nations met · ${D.allies(me).length} allies · ${this.sim.combat.enemiesOf(me).length} wars`;
  }

  render(body) {
    const rows = this.rows();
    const myPower = Math.max(1, this.sim.ai.powerOf(this.me));
    const opCell = (op) => {
      const v = op.value;
      const tip = op.reasons.map((r) => `${r.value > 0 ? '+' : ''}${r.value}  ${r.text}`).join('\n') || 'No strong feelings';
      return `<span class="op ${v >= 25 ? 'good' : v <= -25 ? 'bad' : 'mid'}" title="${esc(tip)}"><span class="op-bar"><i style="left:${v < 0 ? 50 + v / 2 : 50}%;width:${Math.abs(v) / 2}%"></i></span><b>${v > 0 ? '+' : ''}${v}</b></span>`;
    };
    body.innerHTML = `
      <div class="win-controls">
        <div class="chips">${FILTERS.map(([k, l]) => `<button type="button" data-filter="${k}" class="${k === this.filter ? 'on' : ''}">${l}</button>`).join('')}</div>
        <label class="sort-select">Sort <select data-sort>${SORTS.map(([k, l]) => `<option value="${k}" ${k === this.sort ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="dip-layout ${this.sel >= 0 ? 'has-detail' : ''}">
        <div class="grid-wrap"><table class="win-table dip-table">
          <thead><tr><th class="c-name">Nation</th><th>Relation</th><th>Opinion of you</th><th>Power</th></tr></thead>
          <tbody>${rows.map((r) => `<tr data-nation="${r.id}" class="${r.id === this.sel ? 'sel' : ''}">
            <td class="c-name"><canvas class="flag" data-flag="${r.id}" width="30" height="20"></canvas>${esc(r.n.name)}</td>
            <td><span class="rel rel-${r.rel}">${RELATION_LABEL[r.rel]}</span></td>
            <td>${opCell(r.op)}</td>
            <td class="num">${(r.power / myPower).toFixed(r.power / myPower < 10 ? 1 : 0)}×</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nobody here yet.</td></tr>'}</tbody>
        </table></div>
        ${this.sel >= 0 ? this.detail() : '<p class="hint-line">Pick a nation to see why it feels the way it does, and to propose treaties, trade or war.</p>'}
      </div>`;
    for (const c of body.querySelectorAll('canvas[data-flag]')) {
      const n = this.state.getNation(Number(c.dataset.flag));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = 30 * dpr; c.height = 20 * dpr; c.style.width = '30px'; c.style.height = '20px';
      const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawFlag(g, n.flag, 0, 0, 30, 20);
    }
  }

  detail() {
    const st = this.state, D = this.D, C = this.sim.combat, ai = this.sim.ai, E = this.sim.economy, me = this.me;
    const id = this.sel, n = st.getNation(id);
    if (!n) return '';
    const rel = D.relation(me, id);
    const op = D.opinion(id, me);
    const war = rel === 'war';
    const treatyBtn = (type) => {
      if (D.has(me, id, type)) return `<button type="button" class="btn small ghost" data-cancel="${type}">Cancel ${esc(TREATIES[type].short.toLowerCase())}</button>`;
      if (type !== 'alliance' && D.has(me, id, 'alliance')) return '';
      const r = war ? { ok: false, reason: 'At war.' } : D.accepts(id, me, type);
      return `<button type="button" class="btn small ${r.ok ? '' : 'ghost'}" data-propose="${type}" ${war ? 'disabled' : ''} title="${esc(r.ok ? 'They are likely to accept.' : r.reason)}">Propose ${esc(TREATIES[type].short.toLowerCase())}<small>${r.ok ? 'likely yes' : 'likely no'}</small></button>`;
    };
    const myWars = C.enemiesOf(me).filter((e) => e !== id && !C.atWar(id, e));
    if (!myWars.includes(this.joinTarget)) this.joinTarget = myWars[0] ?? -1;
    const keys = E.keys;
    const opt = (sel) => keys.map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(E.set.labels[k])}</option>`).join('');
    const t = this.trade;
    const give = { [t.give]: t.giveAmt }, take = t.takeAmt > 0 ? { [t.take]: t.takeAmt } : {};
    const verdict = war ? { ok: false, reason: 'No trade with an enemy.' } : D.judgeTrade(id, me, give, take);
    const truce = C.truceUntil(me, id);
    const breaking = D.treatiesOf(me, id).length || truce != null;
    return `<aside class="dip-detail">
      <header><canvas class="flag big" data-flag="${id}" width="48" height="32"></canvas><div><h3>${esc(n.name)}</h3>
        <span class="rel rel-${rel}">${RELATION_LABEL[rel]}</span>${ai.personalityOf(id) ? ` <em>${esc(ai.personalityOf(id))}</em>` : ''}</div>
        <button type="button" class="link-btn" data-show="${id}">Show</button></header>
      <div class="dip-op"><b class="${op.value >= 0 ? 'pos' : 'neg'}">${op.value > 0 ? '+' : ''}${op.value}</b> opinion of you
        <ul>${op.reasons.slice(0, 7).map((r) => `<li><span class="${r.value > 0 ? 'pos' : 'neg'}">${r.value > 0 ? '+' : ''}${r.value}</span>${esc(r.text)}</li>`).join('') || '<li class="dim">No strong feelings either way.</li>'}</ul></div>
      <div class="section-title">Treaties</div>
      <div class="btn-row wrap">${['nap', 'passage', 'alliance'].map(treatyBtn).join('')}</div>
      ${D.has(me, id, 'alliance') && myWars.length ? `<div class="dip-join"><span>Ask to join your war against</span>
        <select data-join>${myWars.map((e) => `<option value="${e}" ${e === this.joinTarget ? 'selected' : ''}>${esc(st.getNation(e).shortName)}</option>`).join('')}</select>
        <button type="button" class="btn small" data-ask>Ask</button></div>` : ''}
      <div class="section-title">Trade and gifts</div>
      <div class="dip-trade">
        <label>You give <input type="number" min="0" step="50" value="${t.giveAmt}" data-trade="giveAmt"><select data-trade="give">${opt(t.give)}</select></label>
        <label>You get <input type="number" min="0" step="50" value="${t.takeAmt}" data-trade="takeAmt"><select data-trade="take">${opt(t.take)}</select></label>
        <p class="dip-verdict ${verdict.ok ? 'pos' : 'neg'}">${verdict.ok ? (t.takeAmt > 0 ? 'They would accept.' : 'A gift: they will like you more.') : esc(verdict.reason)}</p>
        <div class="btn-row"><button type="button" class="btn small" data-offer ${t.takeAmt > 0 && !war ? '' : 'disabled'}>Offer trade</button>
          <button type="button" class="btn small ghost" data-gift ${war ? 'disabled' : ''}>Send as a gift</button></div>
      </div>
      <div class="section-title">War and peace</div>
      <div class="btn-row wrap">${war
        ? '<button type="button" class="btn small" data-peace>Negotiate peace</button>'
        : this.confirmWar
          ? `<p class="hint-line warn">${breaking ? `This breaks your ${truce != null && !D.treatiesOf(me, id).length ? 'truce' : 'treaty'}: every nation will think less of you.` : 'Their allies will join the war.'}</p>
             <button type="button" class="btn small danger" data-war="confirm">Declare war</button><button type="button" class="btn small ghost" data-war="cancel">Cancel</button>`
          : '<button type="button" class="btn small danger" data-war="ask">Declare war…</button>'}</div>
    </aside>`;
  }

  live(body) {
    const c = body.querySelector('.dip-detail canvas[data-flag]');
    if (c && !c.dataset.done) {
      c.dataset.done = '1';
      drawFlag(c.getContext('2d'), this.state.getNation(Number(c.dataset.flag)).flag, 0, 0, 48, 32);
    }
  }

  onClick(e) {
    const st = this.state, D = this.D, me = this.me, notice = this.actions.notice;
    const b = e.target.closest('button, tr[data-nation]');
    if (!b) return false;
    const d = b.dataset;
    if (b.matches('tr[data-nation]')) { this.sel = Number(d.nation) === this.sel ? -1 : Number(d.nation); this.confirmWar = false; return true; }
    if (d.filter) { this.filter = d.filter; return true; }
    const id = this.sel, n = st.getNation(id);
    if (d.show) { this.actions.focusNation(Number(d.show)); return false; }
    const issue = (kind, payload) => this.sim.commands.issue(kind, payload);
    if (d.propose) {
      const r = issue('treaty.propose', { nation: id, type: d.propose });
      notice(r.pending ? `Proposal sent to ${n.shortName}: the answer comes with the next server tick` : r.ok ? `${n.shortName} accepts the ${TREATIES[d.propose].label.toLowerCase()}` : `${n.shortName} declines: ${r.error}`);
      return true;
    }
    if (d.cancel) { issue('treaty.cancel', { nation: id, type: d.cancel }); notice(`You ended the ${TREATIES[d.cancel].label.toLowerCase()} with ${n.shortName}`); return true; }
    if ('ask' in d) {
      const r = issue('war.ask-join', { nation: id, target: this.joinTarget });
      notice(r.pending ? `Request sent to ${n.shortName}` : r.ok ? `${n.shortName} joins your war against ${st.getNation(this.joinTarget).shortName}` : `${n.shortName} declines: ${r.error}`);
      return true;
    }
    if ('offer' in d || 'gift' in d) {
      const t = this.trade;
      const give = { [t.give]: t.giveAmt };
      const r = 'gift' in d ? issue('trade.gift', { nation: id, give }) : issue('trade.offer', { nation: id, give, take: { [t.take]: t.takeAmt } });
      notice(r.pending ? `Sent to ${n.shortName}: settled on the next server tick` : r.ok ? ('gift' in d ? `${n.shortName} thanks you for the gift (+${r.boost} opinion)` : `${n.shortName} accepts the trade`) : `${n.shortName}: ${r.error}`);
      return true;
    }
    if ('peace' in d) { this.actions.openPeace?.(id); return true; }
    if (d.war === 'ask') { this.confirmWar = true; return true; }
    if (d.war === 'cancel') { this.confirmWar = false; return true; }
    if (d.war === 'confirm') { issue('war.declare', { target: id }); this.confirmWar = false; notice(`You declared war on ${n.name}`); return true; }
    return false;
  }

  onChange(e) {
    const t = e.target;
    if (t.dataset.sort != null && t.matches('select[data-sort]')) {
      const k = t.value;
      this.dir = k === this.sort ? -this.dir : (k === 'name' || k === 'relation' ? 1 : -1);
      this.sort = k;
      return true;
    }
    if (t.matches('select[data-join]')) { this.joinTarget = Number(t.value); return true; }
    if (t.dataset.trade) {
      const f = t.dataset.trade;
      this.trade[f] = f.endsWith('Amt') ? Math.max(0, Math.round(Number(t.value) || 0)) : t.value;
      return true;
    }
    return false;
  }
}
