/**
 * buildings.js — City buildings (levels 1–3) and their construction.
 *
 *   Farm            + food (grain)
 *   Mine / Factory  + iron/steel; a Factory also yields money (and electronics
 *                   from the Cold War on)
 *   Oil Well        + oil; WWI and later, only on oil-deposit provinces (the
 *                   one building allowed outside cities)
 *   Barracks        needed to recruit land units: L1 infantry, L2 ranged,
 *                   L3 mobile; each level also trains faster
 *   Port            coastal cities only; needed to build ships, faster per level
 *   Fortifications  +25% defense per level for armies defending the province
 *   Roads           +10% production per level and faster movement through it
 *
 * Cost and time grow with the level (×1, ×2, ×3.5 cost; ×1, ×1.5, ×2 time).
 * Level III of each building needs a tech (research.js); some techs also
 * make construction faster or cheaper.
 * One construction per city at a time; it's paid up front and refunded if
 * cancelled. A captured city keeps its buildings but loses the construction.
 */

import { resourceSet } from './resources.js';

export const MAX_LEVEL = 3;
export const BUILDING_TYPES = ['farm', 'mine', 'oilwell', 'barracks', 'port', 'fort', 'roads'];

const LEVEL_COST = [1, 2, 3.5];
const LEVEL_TIME = [1, 1.5, 2];

export const BUILDINGS = {
  farm: { cost: { money: 100, steel: 10 }, hours: 48, glyph: '❦', effect: 'food' },
  mine: { cost: { money: 150, steel: 30 }, hours: 72, glyph: '⚒', effect: 'industry' },
  oilwell: { cost: { money: 200, steel: 50 }, hours: 96, glyph: '⬮', effect: 'oil' },
  barracks: { cost: { money: 120, steel: 20 }, hours: 48, glyph: '⚔', effect: 'recruit' },
  port: { cost: { money: 160, steel: 40 }, hours: 72, glyph: '⚓', effect: 'ships' },
  fort: { cost: { money: 140, steel: 40 }, hours: 72, glyph: '▙', effect: 'defense' },
  roads: { cost: { money: 120, steel: 20 }, hours: 48, glyph: '≡', effect: 'roads' },
};

/** Era-flavoured names. */
const NAMES = {
  rome: { farm: 'Latifundium', mine: 'Iron Mine', barracks: 'Castra', port: 'Harbor', fort: 'Walls', roads: 'Roman Roads' },
  medieval: { farm: 'Manor Farm', mine: 'Iron Mine', barracks: 'Barracks', port: 'Harbor', fort: 'Castle Walls', roads: 'Roads' },
  ww1: { farm: 'Farms', mine: 'Factory', oilwell: 'Oil Well', barracks: 'Barracks', port: 'Port', fort: 'Fortifications', roads: 'Railways' },
  coldwar: { farm: 'Agriculture', mine: 'Factory', oilwell: 'Oil Field', barracks: 'Military Base', port: 'Naval Base', fort: 'Fortifications', roads: 'Infrastructure' },
};
NAMES.ww2 = NAMES.ww1;
NAMES.modern = NAMES.coldwar;
NAMES.fictional = NAMES.coldwar;
export const buildingName = (eraId, type) => (NAMES[eraId] ?? NAMES.modern)[type] ?? type;

/** Building and level needed per unit role. */
export const UNIT_REQUIREMENT = { inf: ['barracks', 1], rng: ['barracks', 2], mob: ['barracks', 3], nav: ['port', 1] };
/** Build-time multiplier by Barracks/Port level. */
export const TRAIN_FACTOR = [1, 1, 0.85, 0.7];
export const FORT_BONUS = 0.25;
export const ROADS_MOVE = [1, 0.85, 0.7, 0.55];
export const ROADS_PROD = [1, 1.1, 1.2, 1.3];

const FARM = [0, 20, 40, 70];
const MINE = [0, 10, 20, 35];
const FACTORY_MONEY = [0, 20, 40, 70];
const FACTORY_ELEC = [0, 4, 8, 14];
const OIL = [0, 15, 30, 50];

const empty = () => ({ farm: 0, mine: 0, oilwell: 0, barracks: 0, port: 0, fort: 0, roads: 0 });

export class Buildings {
  /**
   * @param {import('./state.js').GameState} state
   * @param {import('./economy.js').Economy} economy
   */
  constructor(state, economy) {
    this.state = state;
    this.economy = economy;
    economy.buildings = this;
    this.research = null; // set by main.js (level III unlocks, cost/time bonuses)
    this.reset();
    state.events.on('map:loaded', () => this.reset());
    state.events.on('province:owner', ({ provinceId }) => {
      if (this.construction.delete(provinceId)) this.changed(provinceId, false);
    });
  }

  reset() {
    this.levels = new Map();        // provinceId → { farm, mine, … }
    this.construction = new Map();  // provinceId → { type, level, done, total }
    this.eraId = this.state.map?.era?.id ?? 'modern';
    this.set = resourceSet(this.eraId);
  }

  /** A building level changed (pid) or many did (no pid). Starting/cancelling doesn't change yields. */
  changed(pid, yields = true) {
    if (yields) { if (pid >= 0) this.economy.refreshProvince(pid); else this.economy.invalidate(); }
    this.state.events.emit('buildings', pid ?? null);
  }

  name(type) { return buildingName(this.eraId, type); }

  /** Building types that exist in this era (no oil wells before WWI). */
  get types() { return BUILDING_TYPES.filter((t) => t !== 'oilwell' || this.set.industrial); }

  of(pid) { return this.levels.get(pid) ?? empty(); }
  level(pid, type) { return this.levels.get(pid)?.[type] ?? 0; }

  /** Provinces of a nation that can hold buildings: cities, plus oil fields in industrial eras. */
  sites(nation) {
    return this.state.provinces.filter((p) => p.owner === nation && (p.isCity || (p.oil && this.set.industrial)));
  }

  /** Resource cost of a level, limited to this era's resources. */
  costOf(type, level, nation = -1) {
    const m = nation >= 0 ? this.research?.buildCostMult(nation) ?? 1 : 1;
    const c = {};
    for (const [k, v] of Object.entries(BUILDINGS[type].cost)) if (this.set.keys.includes(k)) c[k] = Math.round(v * LEVEL_COST[level - 1] * m);
    return c;
  }
  hoursOf(type, level, nation = -1) {
    const m = nation >= 0 ? this.research?.buildTimeMult(nation) ?? 1 : 1;
    return Math.round(BUILDINGS[type].hours * LEVEL_TIME[level - 1] * m);
  }

  /** Can this province build the next level of `type`? → { ok, reason?, level, cost, hours } */
  check(pid, type, opts = {}) {
    const p = this.state.getProvince(pid);
    const level = this.level(pid, type) + 1;
    const owner = p?.owner ?? -1;
    const out = { ok: false, level, cost: level <= MAX_LEVEL ? this.costOf(type, level, owner) : {}, hours: level <= MAX_LEVEL ? this.hoursOf(type, level, owner) : 0 };
    if (!p || p.owner < 0) return { ...out, reason: 'Not yours' };
    if (type === 'oilwell') {
      if (!this.set.industrial) return { ...out, reason: 'From WWI on' };
      if (!p.oil) return { ...out, reason: 'No oil here' };
    } else if (!p.isCity) return { ...out, reason: 'Cities only' };
    if (type === 'port' && !p.seaNeighbors.length) return { ...out, reason: 'Not coastal' };
    if (level > MAX_LEVEL) return { ...out, reason: 'Max level' };
    if (this.research && level > this.research.maxBuildingLevel(owner, type)) {
      return { ...out, reason: `Needs ${this.research.unlockerOf(type)?.name ?? 'research'}`, needsTech: this.research.unlockerOf(type)?.id };
    }
    const busy = this.construction.get(pid);
    if (busy) return { ...out, reason: `Building ${this.name(busy.type)}` };
    if (!opts.ignoreCost && !this.economy.canAfford(p.owner, out.cost)) return { ...out, reason: 'Not enough resources' };
    return { ...out, ok: true };
  }

  build(pid, type) {
    const c = this.check(pid, type);
    if (!c.ok) return { error: c.reason };
    const p = this.state.getProvince(pid);
    if (!this.economy.spend(p.owner, c.cost)) return { error: 'Not enough resources' };
    this.construction.set(pid, { type, level: c.level, done: 0, total: c.hours, cost: c.cost });
    this.changed(pid, false);
    return { ok: true };
  }

  cancel(pid) {
    const job = this.construction.get(pid);
    const p = this.state.getProvince(pid);
    if (!job || !p) return;
    this.construction.delete(pid);
    this.economy.spend(p.owner, job.cost ?? this.costOf(job.type, job.level), -1);
    this.changed(pid, false);
  }

  setLevel(pid, type, level) {
    if (!this.levels.has(pid)) this.levels.set(pid, empty());
    this.levels.get(pid)[type] = level;
  }

  /**
   * Starting buildings for every nation: the capital has Barracks 2, a
   * Mine/Factory, a Farm and (if coastal) a Port; one city in three has
   * Barracks 1, and coastal ones of those a Port.
   */
  start() {
    const map = this.state.map;
    const counter = new Map();
    for (const p of map.provinces) {
      if (p.owner < 0 || !p.isCity) continue;
      if (p.isCapital && map.nations[p.owner]?.capitalId === p.id) {
        this.setLevel(p.id, 'barracks', 2);
        this.setLevel(p.id, 'mine', 1);
        this.setLevel(p.id, 'farm', 1);
        if (p.seaNeighbors.length) this.setLevel(p.id, 'port', 1);
        continue;
      }
      const n = (counter.get(p.owner) ?? 0) + 1;
      counter.set(p.owner, n);
      if (n % 3 === 1) {
        this.setLevel(p.id, 'barracks', 1);
        if (p.seaNeighbors.length) this.setLevel(p.id, 'port', 1);
      }
    }
    this.changed();
  }

  // --- Effects -----------------------------------------------------------------

  /** Daily yield added by buildings in a province (before the roads multiplier). */
  extraYield(p) {
    const b = this.levels.get(p.id);
    const y = {};
    if (!b) return y;
    if (b.farm) y.food = FARM[b.farm];
    if (b.mine) {
      y.steel = MINE[b.mine];
      if (this.set.industrial) y.money = FACTORY_MONEY[b.mine];
      if (this.set.keys.includes('electronics')) y.electronics = FACTORY_ELEC[b.mine];
    }
    if (b.oilwell && this.set.industrial) y.oil = OIL[b.oilwell];
    return y;
  }

  roadsProd(pid) { return ROADS_PROD[this.level(pid, 'roads')]; }
  roadsMove(pid) { return ROADS_MOVE[this.level(pid, 'roads')]; }
  fortBonus(pid) { return 1 + FORT_BONUS * this.level(pid, 'fort'); }

  /** Short description of what the next level does. */
  describe(type, level) {
    const L = Math.min(level, MAX_LEVEL);
    const lbl = this.set.labels;
    switch (type) {
      case 'farm': return `+${FARM[L]} ${lbl.food.toLowerCase()}/day`;
      case 'mine': return [`+${MINE[L]} ${lbl.steel.toLowerCase()}`, this.set.industrial && `+${FACTORY_MONEY[L]} money`, lbl.electronics && `+${FACTORY_ELEC[L]} electronics`].filter(Boolean).join(', ') + '/day';
      case 'oilwell': return `+${OIL[L]} oil/day`;
      case 'barracks': return [`recruits ${['', 'infantry', '+ ranged', '+ mobile'][L]}`, L > 1 && `${Math.round((1 - TRAIN_FACTOR[L]) * 100)}% faster`].filter(Boolean).join(', ');
      case 'port': return ['builds ships', L > 1 && `${Math.round((1 - TRAIN_FACTOR[L]) * 100)}% faster`].filter(Boolean).join(', ');
      case 'fort': return `+${Math.round(FORT_BONUS * L * 100)}% defense`;
      case 'roads': return `+${Math.round((ROADS_PROD[L] - 1) * 100)}% output, ${Math.round((1 - ROADS_MOVE[L]) * 100)}% faster moves`;
      default: return '';
    }
  }

  // --- Simulation ----------------------------------------------------------------

  update(state, hours) {
    if (!hours || state.phase !== 'playing') return;
    for (const [pid, job] of this.construction) {
      job.done += hours;
      if (job.done < job.total) continue;
      this.construction.delete(pid);
      this.setLevel(pid, job.type, job.level);
      this.economy.refreshProvince(pid);
      const p = state.getProvince(pid);
      if (p.owner === state.playerNationId) state.events.emit('feed', {
        kind: 'building', tone: 'good', node: pid,
        text: `${this.name(job.type)} ${['', 'I', 'II', 'III'][job.level]} completed in ${p.cityName ?? p.name}`,
      });
      this.changed(pid, false); // yields already refreshed above
    }
  }
}
