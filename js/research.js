/**
 * research.js — Research per nation: slots, progress and the effects of
 * finished techs, which other systems query:
 *   unitLevel(nation, role)       → 1–3, for new recruits and refits
 *   maxBuildingLevel(nation, t)   → 2 until the tech for level III is done
 *   prodMult(nation, key)         → production multiplier (economy.js)
 *   moveMult / defenseMult / attackMult / buildTimeMult / buildCostMult / trainTimeMult
 *
 * One research slot to start; a tier I Economy tech adds a second and a
 * tier III one a third. A tech is paid up front, takes game time, and can be
 * cancelled for a refund. Up to 5 more techs can wait in a queue: the first
 * one whose requirements are done and that you can afford starts as soon as
 * a slot is free.
 */

import { techTree, legacyMap, LEGACY, LEGACY_COST, SIGNATURES } from './tech.js';
import { resourceSet } from './resources.js';

export const BASE_SLOTS = 1;
export const BASE_MAX_BUILDING = 2;
export const QUEUE_MAX = 5;

const fresh = () => ({ done: new Set(), active: [], queue: [], fx: null });

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
    this.era = era;
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
    const fx = { units: { inf: 1, mob: 1, rng: 1, nav: 1 }, buildings: {}, prod: {}, synth: [], move: 0, defense: 0, attack: {}, buildTime: 0, buildCost: 0, trainTime: 0, slots: BASE_SLOTS };
    for (const id of r.done) {
      for (const e of this.byId[id]?.effects ?? []) {
        if (e.unit) fx.units[e.unit] = Math.max(fx.units[e.unit], e.level);
        else if (e.building) fx.buildings[e.building] = Math.max(fx.buildings[e.building] ?? 0, e.maxLevel);
        else if (e.prod) fx.prod[e.prod] = (fx.prod[e.prod] ?? 0) + e.pct;
        else if (e.attack) fx.attack[e.attack] = (fx.attack[e.attack] ?? 0) + e.pct;
        else if (e.slots) fx.slots += e.slots;
        else if (e.synth) fx.synth.push(e);
        else if (['move', 'defense', 'buildTime', 'buildCost', 'trainTime'].some((k) => e[k])) { for (const k of ['move', 'defense', 'buildTime', 'buildCost', 'trainTime']) if (e[k]) fx[k] += e[k]; }
        // Other effect kinds (integration, era signatures): numbers add up, flags switch on.
        else for (const [k, v] of Object.entries(e)) {
          if (typeof v === 'number') fx[k] = (fx[k] ?? 0) + v;
          else if (v === true) fx[k] = true;
        }
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
  /** Integration speed of conquered land (integration.js). */
  integrationMult(nation) { return 1 + (this.effects(nation).integration ?? 0) / 100; }
  /** A numeric era effect (0 when the nation doesn't have it), e.g. fx(n, 'roadSpeed'). */
  fx(nation, key) { return nation >= 0 ? this.effects(nation)[key] ?? 0 : 0; }
  /** Free research slots. */
  idle(nation) { return Math.max(0, this.slots(nation) - this.of(nation).active.length); }
  queued(nation, id) { return this.of(nation).queue.includes(id); }

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

  /** Can this tech join the queue? Its requirements may still be researching or queued ahead of it. */
  canQueue(nation, id) {
    const r = this.of(nation);
    const t = this.byId[id];
    if (!t) return { ok: false, reason: 'Unknown tech' };
    const st = this.status(nation, id);
    if (st === 'done' || st === 'active') return { ok: false, reason: st === 'done' ? 'Researched' : 'In progress' };
    if (r.queue.includes(id)) return { ok: false, reason: 'Already queued' };
    if (r.queue.length >= QUEUE_MAX) return { ok: false, reason: `Queue full (${QUEUE_MAX})` };
    const coming = (q) => r.done.has(q) || r.active.some((a) => a.id === q) || r.queue.includes(q);
    const missing = t.req.filter((q) => !coming(q));
    if (missing.length) return { ok: false, reason: `Queue ${missing.map((q) => this.byId[q].name).join(' and ')} first` };
    return { ok: true };
  }

  enqueue(nation, id) {
    const c = this.canQueue(nation, id);
    if (!c.ok) return { error: c.reason };
    this.of(nation).queue.push(id);
    this.autoStart(nation);
    this.state.events.emit('research', { nation, id, queued: true });
    return { ok: true };
  }

  dequeue(nation, id) {
    const r = this.of(nation);
    // Dropping a tech also drops queued techs that needed it.
    const drop = new Set([id]);
    for (const q of r.queue) if (this.byId[q].req.some((x) => drop.has(x)) && !r.done.has(q)) drop.add(q);
    r.queue = r.queue.filter((q) => !drop.has(q) || r.done.has(q));
    this.state.events.emit('research', { nation, id, dequeued: true });
  }

  /** Why a queued tech hasn't started yet. */
  waitingReason(nation, id) {
    const r = this.of(nation);
    const t = this.byId[id];
    if (!t.req.every((q) => r.done.has(q))) return 'after its requirements';
    if (!this.idle(nation)) return 'when a slot frees up';
    if (!this.economy.canAfford(nation, t.cost)) return 'waiting for resources';
    return 'starting';
  }

  /** Start queued techs while slots are free (first startable in queue order). */
  autoStart(nation) {
    const r = this.of(nation);
    let started = false;
    for (let guard = 0; guard < QUEUE_MAX && this.idle(nation) > 0; guard++) {
      const id = r.queue.find((q) => this.check(nation, q).ok);
      if (!id) break;
      r.queue = r.queue.filter((q) => q !== id);
      if (this.start(nation, id).ok) started = true;
    }
    return started;
  }

  /**
   * Active bonuses with the techs they come from, for the Bonuses tab:
   * [{ key, label, value, sources: [names] }]
   */
  bonuses(nation) {
    const r = this.of(nation);
    const rows = new Map();
    const add = (key, label, value, src) => {
      if (!rows.has(key)) rows.set(key, { key, label, value: 0, sources: [] });
      const row = rows.get(key);
      row.value = typeof value === 'number' ? row.value + value : value;
      row.sources.push(src);
    };
    for (const id of r.done) {
      const t = this.byId[id];
      for (const e of t.effects) {
        if (e.unit) add(`unit:${e.unit}`, e.unit, Math.max(rows.get(`unit:${e.unit}`)?.value ?? 1, e.level), t.name);
        else if (e.building) add(`b:${e.building}`, e.building, 3, t.name);
        else if (e.prod) add(`prod:${e.prod}`, e.prod, e.pct, t.name);
        else if (e.synth) add(`synth:${e.to}`, e.synth, e.pct, t.name); // label = source resource
        else if (e.attack) add(`attack:${e.attack}`, e.attack, e.pct, t.name);
        else if (e.slots) add('slots', 'slots', e.slots, t.name);
        else if (['move', 'defense', 'buildTime', 'buildCost', 'trainTime'].some((k) => e[k])) { for (const k of ['move', 'defense', 'buildTime', 'buildCost', 'trainTime']) if (e[k]) add(k, k, e[k], t.name); }
        else for (const [k, v] of Object.entries(e)) add(k, k, v, t.name); // integration and era signatures
      }
    }
    return [...rows.values()];
  }

  /** Effect lines for a tech, with this era's unit, building and resource names. */
  describe(t) {
    return describeEffects(t.effects, {
      roster: this.armies?.roster,
      buildingName: (k) => this.buildings?.name(k) ?? k,
      label: (k) => this.economy.label(k),
    });
  }

  /**
   * Old saves (before step 10) name techs of the shared 28-tech skeleton
   * (m1…i9). Each finished one becomes the new tech with the same effect
   * (with that tech's requirements, so the tree stays whole); one with no
   * match is refunded at its old cost, as is research that was in progress.
   * Old queue entries are dropped. Returns what happened, per nation and in total.
   */
  migrate() {
    const map = legacyMap(this.era, this.tree);
    const tierOf = Object.fromEntries(LEGACY.map((t) => [t.id, t.tier]));
    const keys = new Set(this.economy.keys ?? Object.keys(LEGACY_COST[3]));
    const total = { nations: 0, mapped: 0, refunded: 0, dropped: 0, money: 0, of: {} };
    const mine = (nation) => (total.of[nation] ??= { mapped: 0, refunded: 0, dropped: 0, techs: 0 });
    const refund = (nation, oldId) => {
      mine(nation).refunded++;
      const cost = {};
      for (const [k, v] of Object.entries(LEGACY_COST[tierOf[oldId]] ?? {})) if (keys.has(k)) cost[k] = v;
      this.economy.spend(nation, cost, -1);
      total.refunded++;
      total.money += cost.money ?? 0;
    };
    for (const [nation, r] of this.nations) {
      const old = [...r.done].filter((id) => !this.byId[id]);
      const oldActive = r.active.filter((a) => !this.byId[a.id]);
      const oldQueue = r.queue.filter((id) => !this.byId[id]);
      if (!old.length && !oldActive.length && !oldQueue.length) continue;
      total.nations++;
      const done = new Set([...r.done].filter((id) => this.byId[id]));
      const give = (id) => { if (done.has(id)) return; done.add(id); for (const q of this.byId[id].req) give(q); };
      for (const id of old) {
        if (map[id]) { give(map[id]); total.mapped++; mine(nation).mapped++; } else if (id in tierOf) refund(nation, id);
      }
      for (const a of oldActive) if (a.id in tierOf) refund(nation, a.id);
      total.dropped += oldQueue.length;
      mine(nation).dropped += oldQueue.length;
      mine(nation).techs = done.size;
      r.done = done;
      r.active = r.active.filter((a) => this.byId[a.id]);
      r.queue = r.queue.filter((id) => this.byId[id]);
      r.fx = null;
    }
    return total;
  }

  /** Mark a tech done without paying (tests, scenarios). */
  grant(nation, id) {
    const r = this.of(nation);
    r.active = r.active.filter((a) => a.id !== id);
    r.queue = r.queue.filter((q) => q !== id);
    r.done.add(id);
    r.fx = null;
    this.state.events.emit('research', { nation, id, done: true });
  }

  update(state, hours) {
    if (!hours || state.phase !== 'playing') return;
    for (const [nation, r] of this.nations) {
      const speed = 1 + this.fx(nation, 'researchSpeed') / 100;
      for (const a of [...r.active]) {
        a.done += hours * speed;
        if (a.done < a.total) continue;
        this.grant(nation, a.id);
        if (nation === state.playerNationId) {
          const t = this.byId[a.id];
          state.events.emit('feed', { kind: 'research', tone: 'good', text: `Research complete: ${t.name} — ${this.describe(t).join('; ')}`, research: a.id, toast: `Research complete: ${t.name}` });
        }
      }
      if (r.queue.length && this.idle(nation) > 0) this.autoStart(nation);
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
    if (e.synth) return `Synthetic ${label(e.to).toLowerCase()}: +${e.pct}% of your ${label(e.synth).toLowerCase()} output`;
    if (e.integration) return `Conquered land integrates ${e.integration}% faster`;
    const [k, v] = Object.entries(e)[0] ?? [];
    if (SIGNATURES[k]) return `★ ${SIGNATURES[k](v)}`;
    return '';
  }).filter(Boolean);
}
