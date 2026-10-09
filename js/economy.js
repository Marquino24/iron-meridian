/**
 * economy.js — Money and Manpower for every nation.
 *
 * Each province yields money every day: 1 share for ordinary land, 3 for a
 * city, 5 for a capital. Population follows the same shares (there's no real
 * population data per province), and population yields manpower. A nation
 * whose capital is held by someone else produces at half rate.
 *
 * Income accrues continuously (per game hour) so the top bar ticks smoothly;
 * the tooltip shows it per day.
 */

export const MONEY_PER_SHARE = 10;      // per day
export const MANPOWER_PER_SHARE = 120;  // per day
export const CAPITAL_LOST_FACTOR = 0.5;
const SHARE = { land: 1, city: 3, capital: 5 };

const shareOf = (p) => (p.isCapital ? SHARE.capital : p.isCity ? SHARE.city : SHARE.land);

export class Economy {
  constructor(state) {
    this.state = state;
    this.stock = [];   // per nation: { money, manpower }
    this.tally = [];   // per nation: { land, cities, capitals, shares }
    state.events.on('map:loaded', () => this.reset());
    state.events.on('province:owner', () => this.recount());
  }

  reset() {
    this.stock = this.state.nations.map(() => ({ money: 0, manpower: 0 }));
    this.recount();
  }

  /** Called once the player has picked a nation: everyone starts with ~10 days of income. */
  start() {
    this.recount();
    for (const n of this.state.nations) {
      const inc = this.income(n.id);
      this.stock[n.id] = { money: Math.round(inc.money * 10 + 200), manpower: Math.round(inc.manpower * 10 + 1000) };
    }
    this.state.events.emit('economy', null);
  }

  recount() {
    const tally = this.state.nations.map(() => ({ land: 0, cities: 0, capitals: 0, shares: 0 }));
    for (const p of this.state.provinces) {
      if (p.owner < 0) continue;
      const t = tally[p.owner];
      if (p.isCapital) t.capitals++; else if (p.isCity) t.cities++; else t.land++;
      t.shares += shareOf(p);
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
    const t = this.tally[nationId] ?? { land: 0, cities: 0, capitals: 0, shares: 0 };
    const factor = this.capitalLost(nationId) ? CAPITAL_LOST_FACTOR : 1;
    return {
      ...t,
      factor,
      money: t.shares * MONEY_PER_SHARE * factor,
      manpower: t.shares * MANPOWER_PER_SHARE * factor,
      perShare: { money: MONEY_PER_SHARE, manpower: MANPOWER_PER_SHARE },
    };
  }

  get(nationId) { return this.stock[nationId] ?? { money: 0, manpower: 0 }; }

  canAfford(nationId, cost) {
    const s = this.get(nationId);
    return s.money >= cost.money && s.manpower >= cost.manpower;
  }

  /** Deduct a cost (or refund with sign = -1). Returns false if it can't be paid. */
  spend(nationId, cost, sign = 1) {
    const s = this.stock[nationId];
    if (!s || (sign > 0 && !this.canAfford(nationId, cost))) return false;
    s.money -= cost.money * sign;
    s.manpower -= cost.manpower * sign;
    this.state.events.emit('economy', nationId);
    return true;
  }

  update(state, hours) {
    if (!hours || state.phase !== 'playing') return;
    const k = hours / 24;
    for (const n of state.nations) {
      const s = this.stock[n.id];
      if (!s) continue;
      const t = this.tally[n.id];
      if (!t || !t.shares) continue;
      const factor = this.capitalLost(n.id) ? CAPITAL_LOST_FACTOR : 1;
      s.money += t.shares * MONEY_PER_SHARE * factor * k;
      s.manpower += t.shares * MANPOWER_PER_SHARE * factor * k;
    }
  }
}
