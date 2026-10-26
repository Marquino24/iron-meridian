/**
 * economy.js — Era resources for every nation (see resources.js for the sets).
 *
 * Daily income = Σ over owned provinces of (base yield + building yield)
 * × roads multiplier, then × 0.5 if the nation's capital is held by someone
 * else. Income accrues every game hour so the top bar ticks smoothly; the
 * tooltip shows it per day with where it comes from.
 */

import { resourceSet, baseYield, START_BONUS, assignDeposits } from './resources.js';
import { assignDevelopment } from './development.js';

export const CAPITAL_LOST_FACTOR = 0.5;

const zero = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));

/** Share of its output a newly conquered province gives its new owner (unrest, a hostile population). */
export const CONQUERED_YIELD = 0.45;

/**
 * Output factor of province `p` for `nation`: its own land 1; land taken from
 * another nation gives its integration (CONQUERED_YIELD rising to 1, integration.js).
 */
export const heldYield = (p, nation) => (p.homeOf != null && p.homeOf >= 0 && p.homeOf !== nation ? (p.integ ?? CONQUERED_YIELD) : 1);

export class Economy {
  constructor(state) {
    this.state = state;
    this.buildings = null; // set by Buildings (building yields and roads)
    this.research = null;  // set by Research (production bonuses)
    this.bonus = null;     // (nation) → multiplier, set by the AI (difficulty)
    this.set = resourceSet('modern');
    this.stock = [];
    this.tally = [];
    state.events.on('map:loaded', () => this.reset());
    // Recounting walks every province, so changes only mark it stale; it
    // recounts once, the next time income is read.
    this.dirty = true;
    state.events.on('province:owner', (e) => this.onOwner(e));
    // Multiplied totals per nation, cached until something changes them.
    this.totalsCache = new Map();
    state.events.on('research', (e) => { if (e.done) this.totalsCache.delete(e.nation); });
  }

  get keys() { return this.set.keys; }
  label(key) { return this.set.labels[key] ?? key; }

  reset() {
    const map = this.state.map;
    if (map && !map.depositsAssigned) { assignDeposits(map); assignDevelopment(map); map.depositsAssigned = true; }
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

  invalidate() { this.dirty = true; this.totalsCache?.clear(); }

  /**
   * Full recount: every province's yield, cached, summed per nation. Later
   * changes are incremental (owner changes move a province's cached yield,
   * a finished building refreshes one province); research and difficulty
   * multipliers are applied when income is read.
   */
  recount() {
    this.dirty = false;
    this.totalsCache.clear();
    const keys = this.keys;
    this.pyield = [];
    this.pheld = [];
    this.tally = this.state.nations.map(() => ({ land: 0, cities: 0, capitals: 0, base: zero(keys), built: zero(keys), roads: zero(keys), raw: zero(keys) }));
    for (const p of this.state.provinces) {
      const y = this.provinceYield(p);
      this.pyield[p.id] = y;
      if (p.owner >= 0) this.addYield(p, y, p.owner, 1);
    }
  }

  addYield(p, y, nation, sign) {
    const t = this.tally[nation];
    if (!t) return;
    if (p.isCapital) t.capitals += sign; else if (p.isCity) t.cities += sign; else t.land += sign;
    // Overextension: conquered land yields its integration share. The factor used is
    // remembered, so the same amount comes off again when it changes (refreshProvince).
    const h = sign > 0 ? heldYield(p, nation) : this.pheld[p.id] ?? heldYield(p, nation);
    if (sign > 0) this.pheld[p.id] = h;
    const f = sign * h;
    for (const k of this.keys) {
      const b = y.base[k] ?? 0, e = y.built[k] ?? 0;
      t.base[k] += b * f;
      t.built[k] += e * f;
      t.roads[k] += (b + e) * (y.mult - 1) * f;
      t.raw[k] += y.total[k] * f;
    }
  }

  onOwner({ provinceId, from, to }) {
    if (this.dirty || !this.pyield) return;
    const p = this.state.getProvince(provinceId), y = this.pyield[provinceId];
    if (!p || !y) { this.dirty = true; return; }
    if (from >= 0) this.addYield(p, y, from, -1);
    if (to >= 0) this.addYield(p, y, to, 1);
    this.totalsCache.delete(from);
    this.totalsCache.delete(to);
  }

  /** A building finished: recompute one province. */
  refreshProvince(pid) {
    if (this.dirty || !this.pyield) return;
    const p = this.state.getProvince(pid);
    if (!p) return;
    if (p.owner >= 0) this.addYield(p, this.pyield[pid], p.owner, -1);
    this.pyield[pid] = this.provinceYield(p);
    if (p.owner >= 0) this.addYield(p, this.pyield[pid], p.owner, 1);
    this.totalsCache.delete(p.owner);
  }

  /** Daily totals for a nation with multipliers applied: { total, tech }. */
  totals(nationId) {
    const hit = this.totalsCache.get(nationId);
    if (hit) return hit;
    const out = this.computeTotals(nationId);
    this.totalsCache.set(nationId, out);
    return out;
  }

  computeTotals(nationId) {
    const keys = this.keys;
    const t = this.tally[nationId];
    const total = zero(keys), tech = zero(keys);
    if (!t) return { total, tech };
    const f = this.bonus ? this.bonus(nationId) : 1;
    for (const k of keys) total[k] = t.raw[k] * f;
    if (this.research) {
      for (const k of keys) {
        const m = this.research.prodMult(nationId, k);
        if (m === 1) continue;
        tech[k] = total[k] * (m - 1);
        total[k] *= m;
      }
      // Synthetic production (e.g. fuel from steel).
      for (const e of this.research.effects(nationId).synth) {
        if (!keys.includes(e.to) || !keys.includes(e.synth)) continue;
        const extra = total[e.synth] * e.pct / 100;
        tech[e.to] += extra;
        total[e.to] += extra;
      }
    }
    return { total, tech };
  }

  capitalLost(nationId) {
    const n = this.state.getNation(nationId);
    const cap = n && this.state.getProvince(n.capitalId);
    return !!cap && cap.owner !== nationId;
  }

  /** Daily income with its breakdown (for the top-bar tooltip). */
  income(nationId) {
    if (this.dirty) this.recount();
    const t = this.tally[nationId] ?? { land: 0, cities: 0, capitals: 0, base: zero(this.keys), built: zero(this.keys), roads: zero(this.keys), raw: zero(this.keys) };
    const factor = this.capitalLost(nationId) ? CAPITAL_LOST_FACTOR : 1;
    const { total, tech } = this.totals(nationId);
    const perDay = {};
    for (const k of this.keys) perDay[k] = total[k] * factor;
    return { ...t, total, tech, factor, perDay };
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
    if (this.dirty) this.recount();
    const d = hours / 24;
    for (const n of state.nations) {
      const s = this.stock[n.id];
      const t = this.tally[n.id];
      if (!s || !t || !(t.land + t.cities + t.capitals)) continue;
      const k = d * (this.capitalLost(n.id) ? CAPITAL_LOST_FACTOR : 1);
      const { total } = this.totals(n.id);
      for (const key of this.keys) s[key] += total[key] * k;
    }
  }
}
