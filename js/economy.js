/**
 * economy.js — Era resources for every nation (see resources.js for the sets).
 *
 * Daily income = Σ over owned provinces of (base yield + building yield)
 * × roads multiplier, then × 0.5 if the nation's capital is held by someone
 * else. Income accrues every game hour so the top bar ticks smoothly; the
 * tooltip shows it per day with where it comes from.
 */

import { resourceSet, baseYield, START_BONUS, assignDeposits } from './resources.js';

export const CAPITAL_LOST_FACTOR = 0.5;

const zero = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));

export class Economy {
  constructor(state) {
    this.state = state;
    this.buildings = null; // set by Buildings (building yields and roads)
    this.research = null;  // set by Research (production bonuses)
    this.set = resourceSet('modern');
    this.stock = [];
    this.tally = [];
    state.events.on('map:loaded', () => this.reset());
    state.events.on('province:owner', () => this.recount());
    state.events.on('research', (e) => { if (e.done) this.recount(); });
  }

  get keys() { return this.set.keys; }
  label(key) { return this.set.labels[key] ?? key; }

  reset() {
    const map = this.state.map;
    if (map && !map.depositsAssigned) { assignDeposits(map); map.depositsAssigned = true; }
    this.set = resourceSet(this.state.map?.era?.id);
    this.stock = this.state.nations.map(() => zero(this.keys));
    this.recount();
  }

  /** Called once the player has picked a nation: everyone starts with ~10 days of income. */
  start() {
    this.recount();
    for (const n of this.state.nations) {
      const inc = this.income(n.id);
      const s = {};
      for (const k of this.keys) s[k] = Math.round(inc.perDay[k] * 10 + (START_BONUS[k] ?? 0));
      this.stock[n.id] = s;
    }
    this.state.events.emit('economy', null);
  }

  /** Daily yield of one province: { base, built, roads } per resource. */
  provinceYield(p) {
    const base = baseYield(p, this.set);
    const built = this.buildings?.extraYield(p) ?? {};
    const mult = this.buildings?.roadsProd(p.id) ?? 1;
    const total = {};
    for (const k of this.keys) total[k] = ((base[k] ?? 0) + (built[k] ?? 0)) * mult;
    return { base, built, mult, total };
  }

  recount() {
    const keys = this.keys;
    const tally = this.state.nations.map(() => ({ land: 0, cities: 0, capitals: 0, base: zero(keys), built: zero(keys), roads: zero(keys), total: zero(keys) }));
    for (const p of this.state.provinces) {
      if (p.owner < 0) continue;
      const t = tally[p.owner];
      if (!t) continue;
      if (p.isCapital) t.capitals++; else if (p.isCity) t.cities++; else t.land++;
      const y = this.provinceYield(p);
      for (const k of keys) {
        const b = y.base[k] ?? 0, e = y.built[k] ?? 0;
        t.base[k] += b;
        t.built[k] += e;
        t.roads[k] += (b + e) * (y.mult - 1);
        t.total[k] += y.total[k];
      }
    }
    // Research bonuses multiply each nation's whole output.
    if (this.research) {
      tally.forEach((t, n) => {
        t.tech = zero(keys);
        for (const k of keys) {
          const m = this.research.prodMult(n, k);
          if (m === 1) continue;
          t.tech[k] = t.total[k] * (m - 1);
          t.total[k] *= m;
        }
      });
    }
    this.tally = tally;
  }

  capitalLost(nationId) {
    const n = this.state.getNation(nationId);
    const cap = n && this.state.getProvince(n.capitalId);
    return !!cap && cap.owner !== nationId;
  }

  /** Daily income with its breakdown (for the top-bar tooltip). */
  income(nationId) {
    const t = this.tally[nationId] ?? { land: 0, cities: 0, capitals: 0, base: zero(this.keys), built: zero(this.keys), roads: zero(this.keys), total: zero(this.keys) };
    const factor = this.capitalLost(nationId) ? CAPITAL_LOST_FACTOR : 1;
    const perDay = {};
    for (const k of this.keys) perDay[k] = t.total[k] * factor;
    return { ...t, factor, perDay };
  }

  get(nationId) { return this.stock[nationId] ?? zero(this.keys); }

  canAfford(nationId, cost) {
    const s = this.get(nationId);
    for (const [k, v] of Object.entries(cost)) if ((s[k] ?? 0) < v) return false;
    return true;
  }

  /** Deduct a cost (or refund with sign = -1). Returns false if it can't be paid. */
  spend(nationId, cost, sign = 1) {
    const s = this.stock[nationId];
    if (!s || (sign > 0 && !this.canAfford(nationId, cost))) return false;
    for (const [k, v] of Object.entries(cost)) s[k] = (s[k] ?? 0) - v * sign;
    this.state.events.emit('economy', nationId);
    return true;
  }

  /** Multiply a cost by n. */
  static times(cost, n) {
    const out = {};
    for (const [k, v] of Object.entries(cost)) out[k] = v * n;
    return out;
  }

  update(state, hours) {
    if (!hours || state.phase !== 'playing') return;
    const d = hours / 24;
    for (const n of state.nations) {
      const s = this.stock[n.id];
      const t = this.tally[n.id];
      if (!s || !t || !(t.land + t.cities + t.capitals)) continue;
      const k = d * (this.capitalLost(n.id) ? CAPITAL_LOST_FACTOR : 1);
      for (const key of this.keys) s[key] += t.total[key] * k;
    }
  }
}
