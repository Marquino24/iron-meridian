/**
 * peace-ui.js — The peace window (step 10): negotiate the end of a war you're in.
 *
 * Shows the war score (occupied land, battles, casualties), the provinces you
 * may ask for (taken in this war, along your old border, never their capital,
 * at most a quarter of their homeland), what each costs in war score, and the
 * chance the other side accepts (war score minus the demand, their exhaustion,
 * their opinion of you). Send a demand, or offer a white peace with nothing
 * selected. A refusal means a week before they'll talk again.
 */

import { esc } from './ui-kit.js';
import { drawFlag } from './flags.js';
import { Combat } from './combat.js';

export class PeaceUI {
  constructor(state, sim, { notice, focusNode }) {
    this.state = state;
    this.sim = sim;
    this.notice = notice;
    this.focusNode = focusNode;
    this.el = document.getElementById('peace-window');
    this.other = -1;
    this.picked = new Set();
    this.message = '';
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('change', (e) => {
      const c = e.target.closest('input[data-pid]');
      if (!c) return;
      if (c.checked) this.picked.add(Number(c.dataset.pid)); else this.picked.delete(Number(c.dataset.pid));
      this.message = '';
      this.render();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.el.hidden) { e.stopPropagation(); this.close(); } }, true);
    state.events.on('map:loaded', () => this.close());
    // The war ended some other way: close.
    state.events.on('war', ({ a, b, peace }) => { if (peace && !this.el.hidden && [a, b].includes(this.other) && [a, b].includes(state.playerNationId)) this.close(); });
  }

  open(other) {
    const me = this.state.playerNationId;
    if (!this.sim.combat.atWar(me, other)) { this.notice('You are not at war with them.'); return; }
    this.other = other;
    this.picked = new Set();
    this.message = '';
    this.el.hidden = false;
    this.render();
  }

  close() { this.el.hidden = true; this.other = -1; }

  render() {
    const st = this.state, C = this.sim.combat, ai = this.sim.ai, me = st.playerNationId, o = this.other;
    const n = st.getNation(o), mine = st.getNation(me);
    const ws = C.warScoreParts(me, o);
    const cands = C.termCandidates(me, o).map((id) => st.provinces[id]).sort((a, b) => Combat.provinceValue(b) - Combat.provinceValue(a) || a.name.localeCompare(b.name));
    for (const id of [...this.picked]) if (!cands.some((p) => p.id === id)) this.picked.delete(id);
    const pids = [...this.picked];
    const max = C.maxCession(o);
    const valid = pids.length ? C.validTerms(me, o, pids) : { ok: true };
    const cost = pids.length ? C.demandCost(o, pids) : 0;
    const chance = valid.ok ? ai.peaceChance(o, me, pids) : 0;
    const info = C.warInfo.get(me < o ? `${me}:${o}` : `${o}:${me}`);
    const days = Math.round((st.clock.time - (info?.start ?? st.clock.time)) / 864e5);
    const exh = Math.round(ai.exhaustion(o, me) * 100);
    const sign = (v) => (v > 0 ? `+${v}` : `${v}`);
    const pct = (v) => `${Math.round(v * 100)}%`;
    const rows = cands.map((p) => `<li><label class="peace-prov">
        <input type="checkbox" data-pid="${p.id}" ${this.picked.has(p.id) ? 'checked' : ''}>
        <span class="pp-name">${esc(p.cityName ?? p.name)}</span>
        <span class="pp-kind">${p.isCity ? 'city' : 'land'}</span>
        <span class="pp-cost">−${C.demandCost(o, [p.id])}</span>
      </label><button type="button" class="link-btn" data-show="${p.id}" aria-label="Show ${esc(p.name)} on the map">Show</button></li>`).join('');
    const tone = chance >= 0.65 ? 'good' : chance >= 0.35 ? 'mid' : 'bad';
    this.el.innerHTML = `<div class="peace-card" role="dialog" aria-modal="true" aria-label="Peace with ${esc(n.name)}">
      <header class="peace-head">
        <canvas class="pf" width="48" height="32"></canvas><span class="peace-vs">vs</span><canvas class="pf" width="48" height="32"></canvas>
        <div><div class="eyebrow">PEACE TALKS · DAY ${days} OF THE WAR</div><h2>Peace with ${esc(n.name)}</h2></div>
        <button type="button" class="icon-btn" data-peace="close" aria-label="Close">✕</button>
      </header>
      <section class="peace-score">
        <div class="ps-total ${ws.total >= 0 ? 'pos' : 'neg'}"><b>${sign(ws.total)}</b><small>war score</small></div>
        <div class="ps-bar" aria-hidden="true"><i style="left:${50 + Math.min(0, ws.total) / 2}%;width:${Math.abs(ws.total) / 2}%" class="${ws.total >= 0 ? 'pos' : 'neg'}"></i><span></span></div>
        <dl class="ps-parts">
          <dt>Occupied land</dt><dd>${sign(ws.occupation)} <small>you hold ${ws.held} of theirs, they hold ${ws.lostLand} of yours</small></dd>
          <dt>Battles</dt><dd>${sign(ws.battles)} <small>${ws.wins} won, ${ws.losses} lost</small></dd>
          <dt>Casualties</dt><dd>${sign(ws.casualties)} <small>${ws.killed} of theirs, ${ws.lost} of yours</small></dd>
          <dt>Their exhaustion</dt><dd>${exh}% <small>war weariness: time at war, losses, a losing score</small></dd>
        </dl>
      </section>
      <section class="peace-terms">
        <div class="section-title">PROVINCES TO KEEP <small>${pids.length} of at most ${max}</small></div>
        ${cands.length ? `<ul class="peace-list">${rows}</ul>` : '<p class="hint">You hold none of their land from this war. You can offer a white peace: everything taken goes back.</p>'}
        <p class="peace-rule">Only land taken in this war, joined to your old border, never their capital. Each costs war score; the rest goes back to them.</p>
      </section>
      <footer class="peace-foot">
        <div class="peace-chance ${valid.ok ? tone : 'bad'}"><b>${valid.ok ? pct(chance) : '—'}</b><small>${valid.ok ? `chance they accept${cost ? ` · demand costs ${cost} war score` : ''}` : esc(valid.reason)}</small></div>
        <p class="peace-msg" role="status">${esc(this.message)}</p>
        <div class="btn-row">
          <button type="button" class="btn primary" data-peace="send" ${valid.ok ? '' : 'disabled'}>${pids.length ? `Demand ${pids.length} province${pids.length === 1 ? '' : 's'}` : 'Offer white peace'}</button>
          <button type="button" class="btn ghost" data-peace="close">Not now</button>
        </div>
      </footer>
    </div>`;
    const [f1, f2] = this.el.querySelectorAll('canvas.pf');
    drawFlag(f1.getContext('2d'), mine.flag, 0, 0, 48, 32);
    drawFlag(f2.getContext('2d'), n.flag, 0, 0, 48, 32);
  }

  onClick(e) {
    if (e.target === this.el) { this.close(); return; }
    const show = e.target.closest('[data-show]');
    if (show) { this.focusNode?.(Number(show.dataset.show)); return; }
    const a = e.target.closest('[data-peace]')?.dataset.peace;
    if (a === 'close') this.close();
    if (a === 'send') this.send();
  }

  send() {
    const st = this.state, me = st.playerNationId, o = this.other;
    const name = st.getNation(o).shortName;
    const pids = [...this.picked];
    const r = this.sim.ai.proposePeace(o, me, pids);
    if (r.ok) {
      this.notice(pids.length ? `${name} accepts: you keep ${pids.length} province${pids.length === 1 ? '' : 's'}` : `${name} accepts a white peace`);
      this.close();
      return;
    }
    st.events.emit('feed', { kind: 'peace', tone: 'bad', text: `${st.getNation(o).name} refused your peace terms` });
    this.message = r.reason;
    this.render();
  }
}
