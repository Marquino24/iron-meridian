/**
 * diplomacy-ui.js — Big alerts and peace popups.
 *   - An AI declaring war on you: a full alert that pauses the game.
 *   - An AI offering white peace: Accept / Decline.
 * Alerts queue up if several arrive at once.
 */

import { esc } from './ui-kit.js';
import { drawFlag } from './flags.js';
import { PERSONALITIES } from './ai.js';
import { TRUCE_DAYS } from './combat.js';

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
    state.events.on('peace:offer', ({ from, to }) => { if (to === state.playerNationId) this.push({ kind: 'peace', from }); });
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
    const body = kind === 'war'
      ? `<div class="alert-kicker">⚔ WAR</div>
         <h2>${esc(n.name)} has declared war on you</h2>
         <p>Their armies may now cross into ${esc(me.name)}. Garrisons fight back on their own; field armies wait for your orders.</p>
         <dl class="diplo-stats"><dt>Their army strength</dt><dd>${theirs}</dd><dt>Yours</dt><dd>${ours}</dd><dt>Their temperament</dt><dd>${esc(pers)}</dd></dl>
         <div class="btn-row"><button type="button" class="btn primary" data-diplo="ok">To arms</button>
           <button type="button" class="btn ghost" data-diplo="show">Show their capital</button></div>`
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
    if (item.kind === 'peace') {
      if (yes) this.sim.combat.makePeace(item.from, this.state.playerNationId);
      else this.state.events.emit('feed', { kind: 'peace', tone: 'war', text: `You declined ${this.state.getNation(item.from).shortName}'s peace offer` });
    }
    this.next();
  }
}
