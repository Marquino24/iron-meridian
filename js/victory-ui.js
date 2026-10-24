/**
 * victory-ui.js — Win-condition picker (nation screen), the score widget in
 * the top bar (your points against the top three; tap for the leaderboard),
 * and the end screen: victory or defeat, a chart of your provinces over time,
 * stats, and Main Menu / Keep Playing.
 */

import { esc, fmtNum } from './ui-kit.js';
import { drawFlag } from './flags.js';
import { svgIcon } from './icons.js';
import { VICTORY_MODES, POINTS_SHARE, CAPITAL_POINTS } from './victory.js';

const DAY = 864e5;

export class VictoryUI {
  /**
   * @param {{ settings, toMenu(): void, focusNation(id): void }} actions
   */
  constructor(state, sim, actions) {
    this.state = state;
    this.sim = sim;
    this.victory = sim.victory;
    this.actions = actions;
    this.settings = actions.settings;
    this.widget = document.getElementById('score-widget');
    this.board = document.getElementById('leaderboard');
    this.endEl = document.getElementById('end-screen');
    this.timer = 0;
    this.sig = '';

    // Setup choices.
    document.getElementById('victory-mode').addEventListener('click', (e) => {
      const b = e.target.closest('[data-victory]');
      if (b) { this.settings.set('victory', b.dataset.victory); this.renderSetup(); }
    });
    document.getElementById('time-limit').addEventListener('change', (e) => { this.settings.set('timeLimit', Number(e.target.value)); this.renderSetup(); });
    state.events.on('map:loaded', () => this.renderSetup());
    this.renderSetup();

    this.widget.addEventListener('click', () => this.openBoard());
    this.board.addEventListener('click', (e) => {
      if (e.target === this.board || e.target.closest('[data-close-board]')) this.board.hidden = true;
      const row = e.target.closest('[data-nation]');
      if (row) { this.board.hidden = true; actions.focusNation(Number(row.dataset.nation)); }
    });
    this.endEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-end]');
      if (!b) return;
      this.endEl.hidden = true;
      if (b.dataset.end === 'menu') actions.toMenu();
      else { this.victory.keepPlaying(); this.state.setSpeed(this.resume || 1); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.board.hidden) { e.stopPropagation(); this.board.hidden = true; } }, true);
    state.events.on('game:end', (o) => this.showEnd(o));
    state.events.on('phase', () => this.renderWidget(true));
    state.events.on('map:loaded', () => { this.endEl.hidden = true; this.board.hidden = true; });
  }

  /** Current choice from the settings (the sandbox defaults to Off). */
  config() {
    const mode = this.settings.values.victory ?? 'points';
    return { mode: VICTORY_MODES[mode] ? mode : 'points', timeLimit: Number(this.settings.values.timeLimit ?? 0) };
  }

  renderSetup() {
    const { mode, timeLimit } = this.config();
    for (const b of document.querySelectorAll('#victory-mode [data-victory]')) {
      const on = b.dataset.victory === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    }
    document.getElementById('time-limit').value = String(timeLimit);
    const map = this.state.map;
    let note = '';
    if (map) {
      let total = 0;
      for (const p of map.provinces) if (p.isCity) total += p.isCapital ? CAPITAL_POINTS : 1;
      const target = Math.max(10, Math.ceil(total * POINTS_SHARE));
      note = mode === 'points' ? `First to <b>${target}</b> points wins (city 1, capital ${CAPITAL_POINTS}; ${total} on this map).`
        : mode === 'domination' ? `Control <b>40%</b> of the world: ${Math.ceil(map.provinces.length * 0.4)} of ${map.provinces.length} provinces.`
          : 'No win condition: play as long as you like.';
      if (timeLimit && mode !== 'none') note += ` After ${timeLimit} years the leader in points wins.`;
      note += ' You lose if you hold no city at all.';
    }
    document.getElementById('victory-note').innerHTML = note;
  }

  // --- Score widget and leaderboard ------------------------------------------------------

  update(dt) {
    this.victory.tick(dt);
    this.timer += dt;
    if (this.timer < 0.5) return;
    this.timer = 0;
    this.renderWidget();
    if (!this.board.hidden) this.renderBoard();
  }

  renderWidget(force = false) {
    const V = this.victory, st = this.state;
    const show = st.phase === 'playing' && V.started;
    this.widget.hidden = !show;
    if (!show) return;
    const me = st.playerNationId;
    const top = V.scores.slice(0, 3);
    const mine = V.scoreOf(me);
    const goal = V.config.mode === 'points' ? `/${V.target}` : V.config.mode === 'domination' ? ` · ${Math.round((100 * mine.provinces) / st.provinces.length)}%/${V.config.dominationPct}%` : '';
    const sig = [me, mine.points, goal, ...top.map((r) => `${r.id}:${r.points}`)].join('|');
    if (!force && sig === this.sig) return;
    this.sig = sig;
    this.widget.innerHTML = `${svgIcon('trophy')}<span class="sw-me"><b>${mine.points}</b><small>${goal}</small></span>
      <span class="sw-top">${top.map((r, i) => `<span class="sw-rival ${r.id === me ? 'me' : ''}" title="${esc(st.getNation(r.id).name)}"><i>${i + 1}</i><canvas data-flag="${r.id}"></canvas><b>${r.points}</b></span>`).join('')}</span>`;
    for (const c of this.widget.querySelectorAll('canvas[data-flag]')) paint(c, st.getNation(Number(c.dataset.flag)).flag, 18, 12);
  }

  openBoard() {
    this.renderBoard();
    this.board.hidden = false;
  }

  renderBoard() {
    const V = this.victory, st = this.state, me = st.playerNationId;
    V.refresh();
    const left = V.timeLeft();
    const goal = V.config.mode === 'points' ? `First to <b>${V.target}</b> points wins.`
      : V.config.mode === 'domination' ? `First to <b>${V.dominationTarget}</b> provinces (${V.config.dominationPct}%) wins.` : 'No win condition.';
    this.board.innerHTML = `<div class="report-card board-card" role="dialog" aria-modal="true" aria-label="Leaderboard">
      <header><h2>${svgIcon('trophy')} Leaderboard</h2><button type="button" class="icon-btn" data-close-board aria-label="Close">✕</button></header>
      <p class="board-goal">${goal}${left != null ? ` Time left: <b>${fmtSpan(left)}</b>.` : ''}</p>
      <div class="board-wrap"><table class="win-table board-table"><thead><tr><th>#</th><th class="c-name">Nation</th><th>Points</th><th>Cities</th><th>Capitals</th><th>Provinces</th></tr></thead>
      <tbody>${V.scores.map((r, i) => `<tr data-nation="${r.id}" class="${r.id === me ? 'me' : ''}"><td>${i + 1}</td><td class="c-name"><canvas data-flag="${r.id}"></canvas>${esc(st.getNation(r.id).name)}</td>
        <td class="num"><b>${r.points}</b></td><td class="num">${r.cities}</td><td class="num">${r.capitals}</td><td class="num">${r.provinces}</td></tr>`).join('')}</tbody></table></div></div>`;
    for (const c of this.board.querySelectorAll('canvas[data-flag]')) paint(c, st.getNation(Number(c.dataset.flag)).flag, 24, 16);
  }

  // --- End screen --------------------------------------------------------------------

  showEnd(o) {
    const st = this.state, V = this.victory, me = st.playerNationId;
    this.resume = st.clock.speed;
    st.setSpeed(0);
    this.board.hidden = true;
    const s = V.stats;
    const win = o.result === 'victory';
    const days = Math.round((st.clock.time - s.start) / DAY);
    const conquered = s.conquered.map((id) => st.getNation(id)?.shortName).filter(Boolean);
    const mine = V.scoreOf(me);
    this.endEl.innerHTML = `<div class="report-card end-card ${win ? 'win' : 'lose'}" role="alertdialog" aria-modal="true">
      <div class="end-banner">${svgIcon(win ? 'trophy' : 'swords')}<h1>${win ? 'VICTORY' : 'DEFEAT'}</h1></div>
      <canvas class="end-flag" data-flag="${win ? me : (o.winner >= 0 ? o.winner : me)}"></canvas>
      <p class="end-reason">${esc(o.reason)}</p>
      <div class="end-chart">${chart(s.series, st)}</div>
      <dl class="end-stats">
        <div><dt>Provinces</dt><dd>${mine.provinces}</dd></div>
        <div><dt>Victory points</dt><dd>${mine.points}</dd></div>
        <div><dt>Battles won</dt><dd class="pos">${s.battlesWon}</dd></div>
        <div><dt>Battles lost</dt><dd class="neg">${s.battlesLost}</dd></div>
        <div><dt>Units built</dt><dd>${s.unitsBuilt}</dd></div>
        <div><dt>Nations conquered</dt><dd title="${esc(conquered.join(', '))}">${conquered.length}</dd></div>
        <div><dt>Game time</dt><dd>${days >= 365 ? `${(days / 365).toFixed(1)} years` : `${days} days`}</dd></div>
        <div><dt>Time played</dt><dd>${fmtPlayed(s.played)}</dd></div>
      </dl>
      ${conquered.length ? `<p class="end-conquered">Conquered: ${esc(conquered.slice(0, 12).join(', '))}${conquered.length > 12 ? '…' : ''}</p>` : ''}
      <div class="btn-row"><button type="button" class="btn ghost" data-end="menu">Main Menu</button><button type="button" class="btn primary" data-end="keep">Keep Playing</button></div>
    </div>`;
    paint(this.endEl.querySelector('canvas[data-flag]'), st.getNation(Number(this.endEl.querySelector('canvas[data-flag]').dataset.flag)).flag, 72, 48);
    this.endEl.hidden = false;
  }
}

function paint(c, flag, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = w * dpr; c.height = h * dpr; c.style.width = `${w}px`; c.style.height = `${h}px`;
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawFlag(g, flag, 0, 0, w, h);
}

/** Provinces over time as an inline SVG line chart. */
function chart(series, st) {
  if (series.length < 2) return '<p class="dim">Not enough history for a chart yet.</p>';
  const W = 520, H = 150, P = 28;
  const t0 = series[0].t, t1 = series[series.length - 1].t;
  const max = Math.max(1, ...series.map((s) => s.provinces));
  const x = (t) => P + ((t - t0) / Math.max(1, t1 - t0)) * (W - P - 8);
  const y = (v) => H - 20 - (v / max) * (H - 34);
  const pts = series.map((s) => `${x(s.t).toFixed(1)},${y(s.provinces).toFixed(1)}`).join(' ');
  const area = `${x(t0)},${y(0)} ${pts} ${x(t1)},${y(0)}`;
  const fmt = (t) => new Date(t).toISOString().slice(0, 7);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Provinces over time">
    <line x1="${P}" y1="${y(0)}" x2="${W - 8}" y2="${y(0)}" class="axis"/>
    <line x1="${P}" y1="${y(max)}" x2="${W - 8}" y2="${y(max)}" class="grid"/>
    <text x="${P - 4}" y="${y(max) + 4}" text-anchor="end">${max}</text><text x="${P - 4}" y="${y(0) + 4}" text-anchor="end">0</text>
    <polygon points="${area}" class="fill"/><polyline points="${pts}" class="line"/>
    <text x="${P}" y="${H - 4}">${fmt(t0)}</text><text x="${W - 8}" y="${H - 4}" text-anchor="end">${fmt(t1)}</text>
    <text x="${W / 2}" y="12" text-anchor="middle" class="title">Your provinces over time</text></svg>`;
}

function fmtPlayed(sec) {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

function fmtSpan(ms) {
  const d = Math.floor(ms / DAY);
  return d >= 365 ? `${Math.floor(d / 365)} y ${d % 365} d` : `${d} days`;
}
