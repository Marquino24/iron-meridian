/**
 * diplomacy-ui.js — Big alerts and diplomatic popups.
 *   - An AI declaring war on you: a full alert that pauses the game.
 *   - An AI offering white peace: Accept / Decline.
 *   - AI proposals (step 7A): a treaty, a trade, or joining its war — Accept / Decline.
 *   - Your alliance calling you into a defensive war: an alert.
 * Alerts queue up if several arrive at once.
 */

import { esc } from './ui-kit.js';
import { drawFlag } from './flags.js';
import { PERSONALITIES } from './ai.js';
import { TRUCE_DAYS } from './combat.js';
import { TREATIES } from './diplomacy.js';
import { RESOURCES } from './resources.js';

export class DiplomacyUI {
  constructor(state, sim, actions) {
    this.state = state;
    this.sim = sim;
    this.actions = actions; // { focusNode, notice }
    this.el = document.getElementById('diplo-modal');
    this.queue = [];
    this.open = null;
    this.resumeSpeed = null;

    state.events.on('war:declared', ({ a, b }) => { if (b === state.playerNationId) this.push({ kind: 'war', from: a }); });
    // offerId: set by commands.js (created first), the id an answer refers to.
    state.events.on('peace:offer', ({ from, to, offerId }) => { if (to === state.playerNationId) this.push({ kind: 'peace', from, offerId }); });
    state.events.on('peace:demand', ({ from, to, provinces, score, offerId }) => { if (to === state.playerNationId) this.push({ kind: 'demand', from, provinces, score, offerId }); });
    state.events.on('diplomacy:proposal', (p) => { if (p.to === state.playerNationId) this.push({ kind: 'proposal', from: p.from, p }); });
    // Multiplayer: offers made on the server, with the server's ids (mp-client.js).
    state.events.on('mp:offer', (o) => {
      if (o.kind === 'proposal') this.push({ kind: 'proposal', from: o.from, p: { ...o.p, offerId: o.id } });
      else if (o.provinces) this.push({ kind: 'demand', from: o.from, provinces: o.provinces, offerId: o.id });
      else this.push({ kind: 'peace', from: o.from, offerId: o.id });
    });
    state.events.on('diplomacy:called', ({ leader, enemy }) => this.push({ kind: 'called', from: leader, enemy }));
    state.events.on('map:loaded', () => { this.queue = []; this.close(); });
    this.el.addEventListener('click', (e) => this.onClick(e));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); this.answer(false); }
    }, true);
  }

  push(item) {
    if (!this.state.getNation(item.from)) return;
    this.queue.push(item);
    if (!this.open) this.next();
  }

  next() {
    this.open = this.queue.shift() ?? null;
    if (!this.open) { this.close(); return; }
    // Pause while the player reads it.
    if (this.resumeSpeed === null) { this.resumeSpeed = this.state.clock.speed; this.state.setSpeed(0); }
    this.render();
  }

  close() {
    this.el.hidden = true;
    this.open = null;
    if (this.resumeSpeed !== null) { this.state.setSpeed(this.resumeSpeed || 1); this.resumeSpeed = null; }
  }

  render() {
    const { kind, from } = this.open;
    const st = this.state, ai = this.sim.ai;
    const n = st.getNation(from), me = st.playerNation;
    const pers = PERSONALITIES[ai.personalityOf(from)]?.label ?? '—';
    const theirs = Math.round(ai.powerOf(from)), ours = Math.round(ai.powerOf(st.playerNationId));
    const Dp = this.sim.diplomacy;
    const op = Dp ? Dp.opinion(from, st.playerNationId) : null;
    const opLine = op ? `<dt>Their opinion of you</dt><dd class="${op.value >= 0 ? 'pos' : 'neg'}">${op.value > 0 ? '+' : ''}${op.value}</dd>` : '';
    const bundle = (b) => Object.entries(b ?? {}).map(([k, v]) => `<span class="cost-chip"><i>${RESOURCES[k].icon}</i>${Math.round(v)} ${esc(this.sim.economy.set.labels[k])}</span>`).join(' ');
    if (kind === 'proposal' || kind === 'called') {
      const p = this.open.p;
      let title, text;
      if (kind === 'called') {
        const enemy = st.getNation(this.open.enemy);
        title = `${esc(n.name)} calls on the alliance`;
        text = `${esc(enemy.name)} attacked your ally. Under your alliance you are now at war with ${esc(enemy.shortName)}.`;
      } else if (p.kind === 'treaty') {
        title = `${esc(n.name)} proposes ${p.type === 'alliance' ? 'an alliance' : `a ${esc(TREATIES[p.type].label.toLowerCase())}`}`;
        text = p.type === 'alliance' ? 'Allies are called into each other\'s defensive wars and may ask each other to join offensive ones. Their armies may cross your land.'
          : p.type === 'nap' ? 'Neither side may attack the other. Breaking it later angers every nation.' : 'Their armies may cross your land in peace.';
      } else if (p.kind === 'trade') {
        title = `${esc(n.name)} offers a trade`;
        text = `<span class="trade-line"><b>You get</b> ${bundle(p.give)}</span><span class="trade-line"><b>You give</b> ${bundle(p.take)}</span>`;
      } else {
        const target = st.getNation(p.target);
        title = `${esc(n.name)} asks you to join its war`;
        text = `Your ally is fighting ${esc(target.name)} and wants you at its side. Declining will cost you their goodwill.`;
      }
      const buttons = kind === 'called'
        ? '<button type="button" class="btn primary" data-diplo="ok">Understood</button>'
        : `<button type="button" class="btn primary" data-diplo="accept">Accept</button><button type="button" class="btn ghost" data-diplo="decline">Decline</button>`;
      this.el.innerHTML = `<div class="report-card diplo-card proposal" role="alertdialog" aria-modal="true">
        <canvas class="diplo-flag" width="96" height="64"></canvas>
        <div class="alert-kicker ${kind === 'called' ? '' : 'peace'}">${kind === 'called' ? '⚔ CALL TO ARMS' : '✉ PROPOSAL'}</div>
        <h2>${title}</h2><p>${text}</p>
        <dl class="diplo-stats"><dt>Their army strength</dt><dd>${theirs}</dd><dt>Yours</dt><dd>${ours}</dd>${opLine}</dl>
        <div class="btn-row">${buttons}</div></div>`;
      drawFlag(this.el.querySelector('canvas').getContext('2d'), n.flag, 0, 0, 96, 64);
      this.el.hidden = false;
      this.el.querySelector('[data-diplo]')?.focus({ preventScroll: true });
      return;
    }
    const body = kind === 'war'
      ? `<div class="alert-kicker">⚔ WAR</div>
         <h2>${esc(n.name)} has declared war on you</h2>
         <p>Their armies may now cross into ${esc(me.name)}. Garrisons fight back on their own; field armies wait for your orders.</p>
         <dl class="diplo-stats"><dt>Their army strength</dt><dd>${theirs}</dd><dt>Yours</dt><dd>${ours}</dd><dt>Their temperament</dt><dd>${esc(pers)}</dd></dl>
         <div class="btn-row"><button type="button" class="btn primary" data-diplo="ok">To arms</button>
           <button type="button" class="btn ghost" data-diplo="show">Show their capital</button></div>`
      : kind === 'demand'
        ? `<div class="alert-kicker">☮ PEACE TERMS</div>
         <h2>${esc(n.name)} demands peace on its terms</h2>
         <p>They are winning (war score ${this.open.score > 0 ? '+' : ''}${this.open.score} for them) and offer peace if you give up ${this.open.provinces.length} province${this.open.provinces.length === 1 ? '' : 's'} they hold: <b>${this.open.provinces.map((id) => esc(st.provinces[id].cityName ?? st.provinces[id].name)).join(', ')}</b>. Everything else they took returns to you, and a ${TRUCE_DAYS}-day truce follows.</p>
         <dl class="diplo-stats"><dt>Their army strength</dt><dd>${theirs}</dd><dt>Yours</dt><dd>${ours}</dd></dl>
         <div class="btn-row"><button type="button" class="btn primary" data-diplo="accept">Accept terms</button>
           <button type="button" class="btn ghost" data-diplo="decline">Fight on</button></div>`
      : `<div class="alert-kicker peace">☮ PEACE OFFER</div>
         <h2>${esc(n.name)} offers a white peace</h2>
         <p>The war ends with no demands: provinces taken in it return to their pre-war owner, both armies withdraw home, and a ${TRUCE_DAYS}-day truce follows.</p>
         <dl class="diplo-stats"><dt>Their army strength</dt><dd>${theirs}</dd><dt>Yours</dt><dd>${ours}</dd></dl>
         <div class="btn-row"><button type="button" class="btn primary" data-diplo="accept">Accept peace</button>
           <button type="button" class="btn ghost" data-diplo="decline">Decline</button></div>`;
    this.el.innerHTML = `<div class="report-card diplo-card ${kind}" role="alertdialog" aria-modal="true">
      <canvas class="diplo-flag" width="96" height="64"></canvas>${body}</div>`;
    drawFlag(this.el.querySelector('canvas').getContext('2d'), n.flag, 0, 0, 96, 64);
    this.el.hidden = false;
    this.el.querySelector('[data-diplo]')?.focus({ preventScroll: true });
  }

  onClick(e) {
    const b = e.target.closest('[data-diplo]');
    if (!b || !this.open) return;
    const a = b.dataset.diplo;
    if (a === 'show') {
      const cap = this.state.getNation(this.open.from)?.capitalId;
      if (cap != null) this.actions.focusNode(cap);
      this.answer(false);
      return;
    }
    this.answer(a === 'accept');
  }

  answer(yes) {
    const item = this.open;
    if (!item) return;
    const C = this.sim.commands;
    if (item.kind === 'proposal') {
      const r = C.issue('proposal.answer', { id: item.p.offerId, yes });
      if (yes && !r.ok) this.actions.notice(r.error ?? 'That is no longer possible.');
    }
    if (item.kind === 'demand' || item.kind === 'peace') {
      const r = C.issue('peace.answer', { id: item.offerId, yes });
      if (yes && !r.ok) this.actions.notice(r.error ?? 'That is no longer possible.');
    }
    this.next();
  }
}
