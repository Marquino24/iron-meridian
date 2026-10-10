/**
 * feed.js — Event feed (bottom left) and the battle report popup.
 *
 * Systems emit 'feed' events ({ kind, tone, text, battleId?, node? }); only
 * those that concern the player are emitted in the first place. Entries with
 * a battle open its report; others with a place fly the camera there.
 */

import { drawFlag } from './render.js';
import { fmtHours } from './ui-kit.js';

const MAX_ITEMS = 6;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (t) => { const d = new Date(t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:00`; };
const ICON = { war: '⚔', good: '▲', bad: '▼', info: '•' };

export class Feed {
  /**
   * @param {import('./state.js').GameState} state
   * @param {{ armies, combat }} sim
   * @param {{ focusNode(node:number):void }} actions
   */
  constructor(state, sim, actions) {
    this.state = state;
    this.sim = sim;
    this.actions = actions;
    this.items = [];
    this.nextId = 1;
    this.list = document.getElementById('feed-list');
    this.report = document.getElementById('battle-report');
    this.openBattleId = -1;
    this.reportTimer = 0;

    state.events.on('feed', (e) => this.push(e));
    state.events.on('map:loaded', () => { this.items = []; this.render(); this.close(); });
    this.list.addEventListener('click', (e) => {
      const li = e.target.closest('[data-feed]');
      if (!li) return;
      const item = this.items.find((x) => x.id === Number(li.dataset.feed));
      if (!item) return;
      if (item.battleId != null && this.sim.combat.battles.has(item.battleId)) this.open(item.battleId);
      else if (item.node != null) this.actions.focusNode(item.node);
    });
    this.report.addEventListener('click', (e) => {
      if (e.target === this.report || e.target.closest('[data-close-report]')) this.close();
      const go = e.target.closest('[data-report-goto]');
      if (go) { this.actions.focusNode(Number(go.dataset.reportGoto)); this.close(); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.report.hidden) { e.preventDefault(); e.stopPropagation(); this.close(); } }, true);
  }

  push(e) {
    this.items.unshift({ ...e, id: this.nextId++, time: this.state.clock.time });
    if (this.items.length > 40) this.items.length = 40;
    this.render();
  }

  render() {
    this.list.innerHTML = this.items.slice(0, MAX_ITEMS).map((it, i) => `
      <li class="feed-item tone-${it.tone ?? 'info'}${it.battleId != null || it.node != null ? ' link' : ''}" data-feed="${it.id}" style="--age:${i}">
        <span class="feed-icon">${ICON[it.tone] ?? '•'}</span>
        <span class="feed-text">${esc(it.text)}</span>
        <span class="feed-time">${fmtTime(it.time)}</span>
      </li>`).join('');
  }

  // --- Battle report ---------------------------------------------------------------

  open(battleId) {
    this.openBattleId = battleId;
    this.report.hidden = false;
    this.renderReport();
    this.report.querySelector('[data-close-report]')?.focus({ preventScroll: true });
  }

  close() {
    this.openBattleId = -1;
    this.report.hidden = true;
  }

  /** Refresh a live report twice a second. */
  update(dt) {
    if (this.openBattleId < 0) return;
    this.reportTimer += dt;
    if (this.reportTimer < 0.5) return;
    this.reportTimer = 0;
    const b = this.sim.combat.battles.get(this.openBattleId);
    if (b && !b.renderedDone) this.renderReport();
  }

  renderReport() {
    const st = this.state;
    const A = this.sim.armies;
    const b = this.sim.combat.battles.get(this.openBattleId);
    if (!b) { this.close(); return; }
    b.renderedDone = b.done;
    const me = st.playerNationId;
    const mine = b.sides.findIndex((s) => s.nation === me);
    const outcome = !b.done ? ['ONGOING', 'amber']
      : b.winner < 0 ? ['MUTUAL DESTRUCTION', 'amber']
        : mine < 0 ? [`${st.getNation(b.sides[b.winner].nation).shortName.toUpperCase()} WON`, '']
          : b.winner === mine ? ['VICTORY', 'green'] : ['DEFEAT', 'red'];
    const types = A.roster.units.filter((t) => b.sides.some((s) => s.initial[t.key]));
    const total = (o) => Object.values(o).reduce((x, y) => x + y, 0);
    const alive = (s) => [...s.armies].reduce((n, a) => n + a.units.length, 0);
    const side = (s, i) => {
      const n = st.getNation(s.nation);
      return `<div class="report-side" style="--nation:${n.color}">
        <canvas class="flag" width="48" height="32" data-flag="${i}"></canvas>
        <div><div class="eyebrow">${i === 0 ? 'ATTACKER' : 'DEFENDER'}${s.nation === me ? ' · YOU' : ''}</div><b>${esc(n.name)}</b></div>
      </div>`;
    };
    const terrain = b.sea ? 'Open sea' : `${b.terrain[0].toUpperCase()}${b.terrain.slice(1)}`;
    this.report.innerHTML = `
      <div class="report-card" role="dialog" aria-modal="true" aria-label="Battle report">
        <div class="panel-head">
          <div>
            <div class="eyebrow">BATTLE REPORT · ${fmtTime(b.start)}${b.done ? ` – ${fmtTime(b.end)}` : ''}</div>
            <h2>Battle of ${esc(b.place)}</h2>
          </div>
          <button type="button" class="icon-btn" data-close-report aria-label="Close report">✕</button>
        </div>
        <div class="report-outcome ${outcome[1]}">${outcome[0]}</div>
        <div class="report-meta">${terrain} · ${fmtHours(b.hours)} of fighting${b.sides.some((s) => s.retreated) ? ` · retreats: ${b.sides.map((s) => s.retreated).join(' / ')}` : ''}</div>
        <div class="report-sides">${side(b.sides[0], 0)}<span class="vs">VS</span>${side(b.sides[1], 1)}</div>
        <table class="report-table">
          <thead><tr><th>Unit</th><th>Fielded</th><th>Lost</th><th class="sep">Fielded</th><th>Lost</th></tr></thead>
          <tbody>${types.map((t) => `<tr><th>${esc(t.name)}</th>
            <td>${b.sides[0].initial[t.key] ?? 0}</td><td class="lost">${b.sides[0].lost[t.key] ?? 0}</td>
            <td class="sep">${b.sides[1].initial[t.key] ?? 0}</td><td class="lost">${b.sides[1].lost[t.key] ?? 0}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th>Total</th><td>${total(b.sides[0].initial)}</td><td class="lost">${total(b.sides[0].lost)}</td>
            <td class="sep">${total(b.sides[1].initial)}</td><td class="lost">${total(b.sides[1].lost)}</td></tr></tfoot>
        </table>
        ${b.done ? '' : `<p class="report-live">Still fighting: ${alive(b.sides[0])} vs ${alive(b.sides[1])} units on the field.</p>`}
        <div class="btn-row"><button type="button" class="btn small ghost" data-report-goto="${b.node}">Show on map</button>
        <button type="button" class="btn small" data-close-report>Close</button></div>
      </div>`;
    for (const c of this.report.querySelectorAll('[data-flag]')) {
      const s = b.sides[Number(c.dataset.flag)];
      drawFlag(c.getContext('2d'), st.getNation(s.nation).flag, 0, 0, 48, 32);
    }
  }
}
