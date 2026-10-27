/**
 * integration.js — Conquered land settling in (step 10).
 *
 * A province taken from another nation starts at 45% integration: it gives its
 * new owner 45% of its output (economy.js heldYield). Every day it integrates a
 * little more and reaches 100% in about 105 days (3½ months). Roads and
 * Fortifications in the province speed it up, and so do integration techs.
 * Taking back your own land restores it at once.
 *
 * Unrest: a province under 60% integration with none of its owner's troops in
 * it is restless. The owner is warned in the event feed; if it stays restless
 * a week after the warning, it may revolt (a small daily chance) and go back
 * to the nation it was taken from, or break away if that nation is gone.
 * Revolts are rare: a garrison or one army passing through prevents them.
 */

import { CONQUERED_YIELD } from './economy.js';

/** Integration gained per day, before bonuses: 45% → 100% in about 105 days. */
export const INTEGRATION_PER_DAY = (1 - CONQUERED_YIELD) / 105;
/** Below this, an ungarrisoned province is restless. */
export const UNREST_BELOW = 0.6;
/** Daily revolt chance of a restless province, a week after its warning. */
const REVOLT_PER_DAY = 0.006;
const WARN_EVERY_DAYS = 20;
const DAY = 864e5;

export class Integration {
  constructor(state, sim) {
    this.state = state;
    this.sim = sim;
    this.reset();
    state.events.on('map:loaded', () => this.reset());
    state.events.on('province:owner', ({ provinceId, to }) => this.onOwner(provinceId, to));
  }

  reset() {
    this.hours = 0;
    this.warned = new Map(); // provinceId → game time of the last unrest warning
    this.stats = { revolts: 0, warnings: 0 };
  }

  /** A province changed hands: conquered land starts low, your own land comes back whole. */
  onOwner(pid, to) {
    const p = this.state.provinces[pid];
    if (!p) return;
    if (p.homeOf == null || p.homeOf < 0 || p.homeOf === to || to < 0) delete p.integ;
    else p.integ = Math.min(1, CONQUERED_YIELD + (this.sim.research?.fx(to, 'precision') ?? 0) / 100); // precision strikes (modern) wreck less
    this.warned.delete(pid);
    this.sim.economy?.refreshProvince(pid);
  }

  /** Integration of a province for its owner, 0.45–1 (1 for its own land). */
  level(p) { return p.homeOf != null && p.homeOf >= 0 && p.homeOf !== p.owner && p.owner >= 0 ? p.integ ?? CONQUERED_YIELD : 1; }

  /** Daily integration of a conquered province: base, ×1.25 per Roads level, ×1.2 per Fortifications level, techs. */
  rate(p) {
    const B = this.sim.buildings, R = this.sim.research;
    const roads = B?.level(p.id, 'roads') ?? 0, fort = B?.level(p.id, 'fort') ?? 0;
    return INTEGRATION_PER_DAY * (1 + 0.25 * roads + 0.2 * fort) * (R?.integrationMult(p.owner) ?? 1);
  }

  /** Days until a province is fully integrated (0 when it is). */
  daysLeft(p) { const l = this.level(p); return l >= 1 ? 0 : Math.ceil((1 - l) / this.rate(p)); }

  /** Restless: low integration and none of the owner's troops in it (and revolts possible for this owner). */
  restless(p) {
    if (this.level(p) >= UNREST_BELOW || p.owner < 0) return false;
    if (this.sim.research?.effects(p.owner).noRevolt) return false;
    for (const a of this.sim.armies.at(p.id)) if (a.nation === p.owner && a.units.length) return false;
    return true;
  }

  update(state, hours) {
    if (!hours || state.phase !== 'playing') return;
    this.hours += hours;
    while (this.hours >= 24) { this.hours -= 24; this.day(); }
  }

  day() {
    const st = this.state, E = this.sim.economy, me = st.playerNationId;
    let changed = false;
    this.fresh = [];
    for (const p of st.provinces) {
      if (p.owner < 0 || p.homeOf == null || p.homeOf < 0 || p.homeOf === p.owner) continue;
      const before = this.level(p);
      if (before < 1) {
        p.integ = Math.min(1, before + this.rate(p));
        E?.refreshProvince(p.id);
        if (Math.floor(before * 10) !== Math.floor(p.integ * 10)) changed = true;
      }
      if (this.restless(p)) this.unrest(p, p.owner === me);
      else this.warned.delete(p.id);
    }
    if (changed) st.events.emit('integration', null);
    this.report(this.fresh);
    this.fresh = [];
  }

  /** The player's new unrest warnings, as one feed item however many provinces are restless. */
  report(w) {
    const st = this.state;
    if (w.length) {
      const [p] = w, name = p.cityName ?? p.name;
      st.events.emit('feed', {
        kind: 'unrest', tone: 'bad', node: p.id,
        text: w.length === 1
          ? `Unrest in ${name} (${Math.round(this.level(p) * 100)}% integrated): station troops there or it may revolt`
          : `Unrest in ${name} and ${w.length - 1} other province${w.length === 2 ? '' : 's'} (newly taken): station troops there or they may revolt`,
      });
    }
  }

  unrest(p, mine) {
    const st = this.state, now = st.clock.time;
    const warnedAt = this.warned.get(p.id);
    if (warnedAt == null || now - warnedAt > WARN_EVERY_DAYS * DAY) {
      // A fresh warning; a revolt can only follow a week after it.
      this.warned.set(p.id, now);
      this.stats.warnings++;
      if (mine) (this.fresh ??= []).push(p);
      return;
    }
    if (now - warnedAt < 7 * DAY || Math.random() > REVOLT_PER_DAY) return;
    this.revolt(p);
  }

  /** The province rises up and goes back to the nation it was taken from (or breaks away if that nation is gone). */
  revolt(p) {
    const st = this.state, from = p.owner;
    const home = p.homeOf;
    const homeAlive = home >= 0 && st.provinces.some((q) => q.owner === home);
    this.sim.combat?.occupations.delete(p.id);
    st.setOwner(p.id, homeAlive ? home : -1);
    this.stats.revolts++;
    const loser = st.getNation(from), back = homeAlive ? st.getNation(home) : null;
    st.events.emit('feed', {
      kind: 'revolt', tone: 'bad', node: p.id, nation: from, involvesPlayer: from === st.playerNationId || home === st.playerNationId,
      text: `Revolt in ${p.cityName ?? p.name}: it ${back ? `rejoins ${back.shortName}` : 'breaks away'} from ${loser?.shortName ?? '?'}`,
    });
  }
}
