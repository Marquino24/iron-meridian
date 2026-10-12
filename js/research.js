/**
 * research.js — Research per nation: slots, progress and the effects of
 * finished techs, which other systems query:
 *   unitLevel(nation, role)       → 1–3, for new recruits and refits
 *   maxBuildingLevel(nation, t)   → 2 until the tech for level III is done
 *   prodMult(nation, key)         → production multiplier (economy.js)
 *   moveMult / defenseMult / attackMult / buildTimeMult / buildCostMult / trainTimeMult
 *
 * One research slot to start; an Economy tech adds a second. A tech is paid
 * up front, takes game time, and can be cancelled for a refund.
 */

import { techTree } from './tech.js';
import { resourceSet } from './resources.js';

export const BASE_SLOTS = 1;
export const BASE_MAX_BUILDING = 2;

const fresh = () => ({ done: new Set(), active: [], fx: null });

export class Research {
  /**
   * @param {import('./state.js').GameState} state
   * @param {import('./economy.js').Economy} economy
   */
  constructor(state, economy) {
    this.state = state;
    this.economy = economy;
    economy.research = this;
    this.armies = null;     // set by main.js (unit names in descriptions)
    this.buildings = null;
    this.reset();
    state.events.on('map:loaded', () => this.reset());
  }

  reset() {
    const era = this.state.map?.era?.id ?? 'modern';
    this.tree = techTree(era, resourceSet(era).keys);
    this.byId = Object.fromEntries(this.tree.map((t) => [t.id, t]));
    this.nations = new Map(); // nation → { done, active: [{ id, done, total }], fx }
  }

  of(nation) {
    if (!this.nations.has(nation)) this.nations.set(nation, fresh());
    return this.nations.get(nation);
  }

  /** Summed effects of a nation's finished techs (cached until the next one finishes). */
  effects(nation) {
    const r = this.of(nation);
    if (r.fx) return r.fx;
    const fx = { units: { inf: 1, mob: 1, rng: 1, nav: 1 }, buildings: {}, prod: {}, move: 0, defense: 0, attack: {}, buildTime: 0, buildCost: 0, trainTime: 0, slots: BASE_SLOTS };
    for (const id of r.done) {
      for (const e of this.byId[id]?.effects ?? []) {
        if (e.unit) fx.units[e.unit] = Math.max(fx.units[e.unit], e.level);
        else if (e.building) fx.buildings[e.building] = Math.max(fx.buildings[e.building] ?? 0, e.maxLevel);
        else if (e.prod) fx.prod[e.prod] = (fx.prod[e.prod] ?? 0) + e.pct;
        else if (e.attack) fx.attack[e.attack] = (fx.attack[e.attack] ?? 0) + e.pct;
        else if (e.slots) fx.slots += e.slots;
        else for (const k of ['move', 'defense', 'buildTime', 'buildCost', 'trainTime']) if (e[k]) fx[k] += e[k];
      }
    }
    r.fx = fx;
    return fx;
  }

  unitLevel(nation, role) { return this.effects(nation).units[role] ?? 1; }
  maxBuildingLevel(nation, type) { return this.effects(nation).buildings[type] ?? BASE_MAX_BUILDING; }
  prodMult(nation, key) { const p = this.effects(nation).prod; return 1 + ((p[key] ?? 0) + (p.all ?? 0)) / 100; }
  moveMult(nation) { return 1 + this.effects(nation).move / 100; }
  defenseMult(nation) { return 1 + this.effects(nation).defense / 100; }
  attackMult(nation, role) { return 1 + (this.effects(nation).attack[role] ?? 0) / 100; }
  buildTimeMult(nation) { return 1 - this.effects(nation).buildTime / 100; }
  buildCostMult(nation) { return 1 - this.effects(nation).buildCost / 100; }
  trainTimeMult(nation) { return 1 - this.effects(nation).trainTime / 100; }
  slots(nation) { return this.effects(nation).slots; }

  /** The tech that unlocks level III of a building, if any. */
  unlockerOf(type) { return this.tree.find((t) => t.effects.some((e) => e.building === type)); }

  /** 'done' | 'active' | 'available' | 'locked' */
  status(nation, id) {
    const r = this.of(nation);
    if (r.done.has(id)) return 'done';
    if (r.active.some((a) => a.id === id)) return 'active';
    return this.byId[id].req.every((q) => r.done.has(q)) ? 'available' : 'locked';
  }

  /** Can this nation start this tech now? → { ok, reason? } */
  check(nation, id, opts = {}) {
    const t = this.byId[id];
    const r = this.of(nation);
    if (!t) return { ok: false, reason: 'Unknown tech' };
    const s = this.status(nation, id);
    if (s === 'done') return { ok: false, reason: 'Researched' };
    if (s === 'active') return { ok: false, reason: 'In progress' };
    if (s === 'locked') {
      const missing = t.req.filter((q) => !r.done.has(q)).map((q) => this.byId[q].name);
      return { ok: false, reason: `Requires ${missing.join(' and ')}` };
    }
    if (r.active.length >= this.slots(nation)) return { ok: false, reason: this.slots(nation) > 1 ? 'Both slots busy' : 'Research slot busy' };
    if (!opts.ignoreCost && !this.economy.canAfford(nation, t.cost)) return { ok: false, reason: 'Not enough resources' };
    return { ok: true };
  }

  start(nation, id) {
    const c = this.check(nation, id);
    if (!c.ok) return { error: c.reason };
    const t = this.byId[id];
    if (!this.economy.spend(nation, t.cost)) return { error: 'Not enough resources' };
    this.of(nation).active.push({ id, done: 0, total: t.hours });
    this.state.events.emit('research', { nation, id, started: true });
    return { ok: true };
  }

  cancel(nation, id) {
    const r = this.of(nation);
    const i = r.active.findIndex((a) => a.id === id);
    if (i < 0) return;
    r.active.splice(i, 1);
    this.economy.spend(nation, this.byId[id].cost, -1);
    this.state.events.emit('research', { nation, id, cancelled: true });
  }

  /** Effect lines for a tech, with this era's unit, building and resource names. */
  describe(t) {
    return describeEffects(t.effects, {
      roster: this.armies?.roster,
      buildingName: (k) => this.buildings?.name(k) ?? k,
      label: (k) => this.economy.label(k),
    });
  }

  /** Mark a tech done without paying (tests, scenarios). */
  grant(nation, id) {
    const r = this.of(nation);
    r.active = r.active.filter((a) => a.id !== id);
    r.done.add(id);
    r.fx = null;
    this.state.events.emit('research', { nation, id, done: true });
  }

  update(state, hours) {
    if (!hours || state.phase !== 'playing') return;
    for (const [nation, r] of this.nations) {
      for (const a of [...r.active]) {
        a.done += hours;
        if (a.done < a.total) continue;
        this.grant(nation, a.id);
        if (nation === state.playerNationId) {
          const t = this.byId[a.id];
          state.events.emit('feed', { kind: 'research', tone: 'good', text: `Research complete: ${t.name} — ${this.describe(t).join('; ')}`, research: a.id });
        }
      }
    }
  }
}

/** Human-readable effect lines. */
export function describeEffects(effects, ctx = {}) {
  const roster = ctx.roster;
  const buildingName = ctx.buildingName ?? ((t) => t);
  const label = ctx.label ?? ((k) => k);
  return effects.map((e) => {
    if (e.unit) {
      const name = roster?.byRole?.[e.unit]?.name ?? e.unit;
      return `${name} level ${e.level} (+${e.level === 2 ? 15 : 30}% attack, defense, HP)`;
    }
    if (e.building) return `${buildingName(e.building)} level III unlocked`;
    if (e.prod) return e.prod === 'all' ? `+${e.pct}% all production` : `+${e.pct}% ${label(e.prod).toLowerCase()}`;
    if (e.move) return `+${e.move}% movement speed`;
    if (e.defense) return `+${e.defense}% defense`;
    if (e.attack) return `+${e.pct}% ${(roster?.byRole?.[e.attack]?.name ?? e.attack)} attack`;
    if (e.buildTime) return `Construction ${e.buildTime}% faster`;
    if (e.buildCost) return `Construction ${e.buildCost}% cheaper`;
    if (e.trainTime) return `Recruitment ${e.trainTime}% faster`;
    if (e.slots) return `+${e.slots} research slot`;
    return '';
  }).filter(Boolean);
}
