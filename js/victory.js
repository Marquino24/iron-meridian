/**
 * victory.js — Win conditions and game statistics (step 7A).
 *
 * Chosen at game setup:
 *   points       Victory Points (default): every city is worth 1, every capital 3
 *                (anyone's — taking a capital is worth it). First nation to the
 *                target wins; the target is a share of all points on the map,
 *                so it scales with the era.
 *   domination   control a share of the world's provinces (default 40%).
 *   none         no victory (sandbox default).
 *   timeLimit    optional, in years: when it runs out, the leader in points wins.
 * Defeat: you hold no city at all (your capital and every other one lost),
 * or another nation reaches the goal first.
 *
 * Also keeps the stats for the end screen: your provinces over time, battles
 * won and lost, units built, nations conquered, game time and time played.
 */

export const VICTORY_MODES = { points: 'Victory Points', domination: 'Domination', none: 'No victory' };
export const TIME_LIMITS = [0, 5, 10, 20, 50];
/** Share of all the points on the map needed for a Victory Points win. */
export const POINTS_SHARE = 0.1;
export const CAPITAL_POINTS = 3;

const DAY = 864e5;
const YEAR = 365.25 * DAY;

export class Victory {
  constructor(state, sim) {
    this.state = state;
    this.sim = sim;
    this.config = { mode: 'points', timeLimit: 0, dominationPct: 40 };
    this.reset();
    state.events.on('map:loaded', () => this.reset());
    state.events.on('battle:end', (b) => {
      const mine = b.sides.findIndex((s) => s.nation === this.state.playerNationId);
      if (mine < 0 || b.winner < 0) return;
      if (b.winner === mine) this.stats.battlesWon++; else this.stats.battlesLost++;
    });
    state.events.on('feed', (e) => {
      if (e.kind === 'unit' && e.nation === this.state.playerNationId) this.stats.unitsBuilt++;
      if (e.kind === 'annexed' && e.by === this.state.playerNationId) this.stats.conquered.push(e.loser);
    });
  }

  reset() {
    this.over = null;          // { result, reason, winner } once decided
    this.continued = false;    // "Keep playing" after the end
    this.started = false;
    this.lastCheck = -Infinity;
    this.stats = { battlesWon: 0, battlesLost: 0, unitsBuilt: 0, conquered: [], series: [], played: 0, start: 0 };
    this.scores = [];
  }

  /** At deploy: the chosen conditions, and the stats start now. */
  start(config) {
    this.reset();
    Object.assign(this.config, config);
    this.started = true;
    this.stats.start = this.state.clock.time;
    this.refresh();
    this.sample();
  }

  get active() { return this.started && this.config.mode !== 'none' && !this.over && !this.continued; }

  /** Total points on the map and the target. */
  get totalPoints() {
    let t = 0;
    for (const p of this.state.provinces) if (p.isCity) t += p.isCapital ? CAPITAL_POINTS : 1;
    return t;
  }
  get target() { return Math.max(10, Math.ceil(this.totalPoints * POINTS_SHARE)); }
  get dominationTarget() { return Math.ceil(this.state.provinces.length * this.config.dominationPct / 100); }

  /** Points, provinces and cities of every living nation, best first (cached per check). */
  refresh() {
    const st = this.state;
    const rows = new Map();
    for (const p of st.provinces) {
      if (p.owner < 0) continue;
      let r = rows.get(p.owner);
      if (!r) rows.set(p.owner, (r = { id: p.owner, points: 0, provinces: 0, cities: 0, capitals: 0 }));
      r.provinces++;
      if (p.isCity) { r.cities++; r.points += p.isCapital ? CAPITAL_POINTS : 1; if (p.isCapital) r.capitals++; }
    }
    this.scores = [...rows.values()].sort((a, b) => b.points - a.points || b.provinces - a.provinces);
    return this.scores;
  }

  scoreOf(n) { return this.scores.find((r) => r.id === n) ?? { id: n, points: 0, provinces: 0, cities: 0, capitals: 0 }; }

  /** Real seconds played (main loop). */
  tick(dtReal) { if (this.started && this.state.phase === 'playing') this.stats.played += dtReal; }

  sample() {
    const me = this.state.playerNationId;
    this.stats.series.push({ t: this.state.clock.time, provinces: this.scoreOf(me).provinces, points: this.scoreOf(me).points });
    if (this.stats.series.length > 600) this.stats.series = this.stats.series.filter((_, i) => i % 2 === 0);
  }

  update(state) {
    if (!this.started || state.phase !== 'playing') return;
    if (state.clock.time - this.lastCheck < DAY / 4) return;
    this.lastCheck = state.clock.time;
    this.refresh();
    if (!this.stats.series.length || state.clock.time - this.stats.series[this.stats.series.length - 1].t >= DAY) this.sample();
    if (!this.active) return;
    const me = state.playerNationId;
    const mine = this.scoreOf(me);
    // Defeat: no city left.
    if (mine.cities === 0) { this.finish('defeat', 'You have lost your capital and every city.', -1); return; }
    const leader = this.scores[0];
    if (this.config.mode === 'points' && leader && leader.points >= this.target) {
      this.finish(leader.id === me ? 'victory' : 'defeat', `${state.getNation(leader.id).name} reached ${this.target} victory points.`, leader.id);
      return;
    }
    if (this.config.mode === 'domination') {
      const top = [...this.scores].sort((a, b) => b.provinces - a.provinces)[0];
      if (top && top.provinces >= this.dominationTarget) {
        this.finish(top.id === me ? 'victory' : 'defeat', `${state.getNation(top.id).name} controls ${this.config.dominationPct}% of the world.`, top.id);
        return;
      }
    }
    if (this.config.timeLimit > 0 && state.clock.time - this.stats.start >= this.config.timeLimit * YEAR) {
      this.finish(leader?.id === me ? 'victory' : 'defeat', `Time is up after ${this.config.timeLimit} years: ${state.getNation(leader.id).name} leads with ${leader.points} points.`, leader?.id ?? -1);
    }
  }

  /** Years and days left of the time limit, or null. */
  timeLeft() {
    if (!this.config.timeLimit) return null;
    return Math.max(0, this.stats.start + this.config.timeLimit * YEAR - this.state.clock.time);
  }

  finish(result, reason, winner) {
    this.over = { result, reason, winner, at: this.state.clock.time };
    this.sample();
    this.state.events.emit('game:end', this.over);
  }

  /** Keep playing after the end: no more checks. */
  keepPlaying() { this.continued = true; }
}
