/**
 * combat.js — Wars, battles, retreats, occupation and capture.
 *
 * - War: a set of nation pairs. You can only enter a nation's land while at
 *   war with it (armies.js asks atWar()). Unclaimed land needs no war.
 * - Battle: starts when an army arrives where hostile armies stand. Every
 *   game hour each unit hits a random enemy unit:
 *       damage = 8 × attack × matchup ÷ (defense × terrain) × (0.75–1.25)
 *   where terrain (forest 1.25, mountains 1.6, urban 1.4, times +25% per
 *   Fortifications level) only shields the side that was there first, matchup is the rock-paper-scissors table in
 *   units.js, and worn-down units hit softer. Unit levels and research
 *   (defense and attack bonuses) scale attack and defense. Land armies caught at sea
 *   fight at a quarter of their attack and half their defense.
 *   An army below 20% strength retreats to a safe neighbouring node (if
 *   there is none it fights on). The battle ends when one side is gone.
 * - Occupation: an army standing in enemy or unclaimed land with no enemy
 *   army there captures it after a few hours (longer for cities/capitals).
 *   Taking a capital halves that nation's production (economy.js).
 */

import { TERRAIN } from './map.js';
import { MATCHUP } from './units.js';

export const DAMAGE_BASE = 8;
export const RETREAT_BELOW = 0.2;
export const OCCUPY_HOURS = { land: 6, city: 12, capital: 24 };
const HISTORY = 60;
export const TRUCE_DAYS = 90;

const warKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export class Combat {
  constructor(state, armies) {
    this.state = state;
    this.armies = armies;
    armies.combat = this;
    this.reset();
    state.events.on('map:loaded', () => this.reset());
  }

  reset() {
    this.wars = new Set();
    this.warInfo = new Map();     // warKey → { a, b, start, captured: [{ pid, from, to }], unitsLost: { [nation]: n } }
    this.truces = new Map();      // warKey → game time until which neither may declare war
    this.battles = new Map();     // id → battle (active and finished)
    this.active = new Map();      // node → battle
    this.history = [];            // finished battle ids, newest first
    this.occupations = new Map(); // provinceId → { nation, done, total }
    this.nextId = 1;
  }

  // --- War -------------------------------------------------------------------

  atWar(a, b) { return a !== b && a >= 0 && b >= 0 && this.wars.has(warKey(a, b)); }

  /** Game time (ms) a truce between two nations lasts until, or null. (Times before 1970 are negative.) */
  truceUntil(a, b) { const t = this.truces.get(warKey(a, b)); return t != null && t > this.state.clock.time ? t : null; }

  declareWar(a, b) {
    if (a === b || a < 0 || b < 0 || this.atWar(a, b) || this.truceUntil(a, b) != null) return false;
    this.wars.add(warKey(a, b));
    this.warInfo.set(warKey(a, b), { a, b, start: this.state.clock.time, captured: [], unitsLost: { [a]: 0, [b]: 0 } });
    const na = this.state.getNation(a), nb = this.state.getNation(b);
    this.state.events.emit('war', { a, b });
    const me = this.state.playerNationId;
    this.state.events.emit('feed', { kind: 'war', tone: 'war', text: `${na.name} declared war on ${nb.name}`, nation: b, involvesPlayer: a === me || b === me });
    // Armies already standing together (e.g. a fleet sharing a sea zone) fight at once.
    for (const army of this.armies.list.values()) if (!army.seg && (army.nation === a || army.nation === b)) this.checkContact(army);
    return true;
  }

  /**
   * White peace: the war ends, provinces taken in it go back to their
   * pre-war owner, armies on the other side's land withdraw home, and a
   * 90-day truce follows. The sandbox passes { revert: false, truce: false }.
   */
  makePeace(a, b, { revert = true, truce = true } = {}) {
    const k = warKey(a, b);
    if (!this.wars.has(k)) return false;
    const info = this.warInfo.get(k);
    this.wars.delete(k);
    this.warInfo.delete(k);
    if (truce) this.truces.set(k, this.state.clock.time + TRUCE_DAYS * 864e5);
    // Battles between the two stop.
    for (const bt of [...this.active.values()]) {
      const ns = bt.sides.map((s) => s.nation);
      if (ns.includes(a) && ns.includes(b)) {
        bt.done = true; bt.winner = -1; bt.end = this.state.clock.time;
        this.active.delete(bt.node);
        this.history.unshift(bt.id);
      }
    }
    for (const [pid, o] of [...this.occupations]) if (o.nation === a || o.nation === b) this.occupations.delete(pid);
    // Status quo ante (the sandbox can end a war keeping today's borders).
    if (revert) for (const c of [...(info?.captured ?? [])].reverse()) {
      const p = this.state.getProvince(c.pid);
      if (p && p.owner === c.to) this.state.setOwner(c.pid, c.from);
    }
    this.armies.withdraw(a, b);
    this.armies.withdraw(b, a);
    const na = this.state.getNation(a), nb = this.state.getNation(b);
    const me = this.state.playerNationId;
    this.state.events.emit('war', { a, b, peace: true });
    this.state.events.emit('feed', { kind: 'peace', tone: 'good', text: `${na.name} and ${nb.name} made peace`, nation: b, involvesPlayer: a === me || b === me });
    this.armies.changed();
    return true;
  }

  enemiesOf(nation) {
    const out = [];
    for (const k of this.wars) {
      const [x, y] = k.split(':').map(Number);
      if (x === nation) out.push(y); else if (y === nation) out.push(x);
    }
    return out;
  }

  /** Land this nation's armies capture by standing on it. */
  capturable(nation, province) {
    return province.owner !== nation && (province.owner < 0 || this.atWar(nation, province.owner));
  }

  // --- Battle membership -------------------------------------------------------

  battleOf(army) { const b = this.active.get(army.node); return b && b.sides.some((s) => s.armies.has(army)) ? b : null; }
  inBattle(army) { return !!this.battleOf(army); }

  hostilesAt(node, nation) {
    return [...this.armies.at(node)].filter((o) => !o.seg && o.units.length && this.atWar(o.nation, nation));
  }

  /** Should this army wait here instead of continuing its route? */
  holds(army) {
    if (this.inBattle(army)) return true;
    if (army.kind !== 'land' || this.armies.isSea(army.node)) return false;
    return this.capturable(army.nation, this.armies.province(army.node));
  }

  detach(army) {
    const b = this.battleOf(army);
    if (!b) return;
    for (const s of b.sides) s.armies.delete(army);
    this.checkEnd(b);
  }

  onArrive(army) { this.checkContact(army); }

  checkContact(army) {
    const enemies = this.hostilesAt(army.node, army.nation);
    if (!enemies.length) return;
    let b = this.active.get(army.node);
    if (b) {
      const side = b.sides.find((s) => s.nation === army.nation)
        ?? b.sides.find((s, i) => this.atWar(army.nation, b.sides[1 - i].nation) && !this.atWar(army.nation, s.nation));
      if (side) { this.join(side, army); this.armies.changed(); }
      return;
    }
    // New battle: the arriving army attacks, everyone hostile already there defends.
    const defNation = enemies[0].nation;
    const node = army.node;
    const sea = this.armies.isSea(node);
    const p = this.armies.province(node);
    b = {
      id: this.nextId++,
      node,
      sea,
      place: this.armies.nodeName(node),
      terrain: sea ? null : p.terrain,
      start: this.state.clock.time,
      end: null,
      hours: 0,
      acc: 0,
      done: false,
      winner: -1,
      sides: [
        { nation: army.nation, armies: new Set(), initial: {}, lost: {}, retreated: 0 },
        { nation: defNation, armies: new Set(), initial: {}, lost: {}, retreated: 0 },
      ],
    };
    this.battles.set(b.id, b);
    this.active.set(node, b);
    this.join(b.sides[0], army);
    for (const e of enemies) if (e.nation === defNation) this.join(b.sides[1], e);
    const player = this.state.playerNationId;
    if (b.sides.some((s) => s.nation === player)) {
      const foe = this.state.getNation(b.sides.find((s) => s.nation !== player).nation);
      this.state.events.emit('feed', { kind: 'battle', tone: 'war', text: `Battle of ${b.place} begins against ${foe.shortName}`, battleId: b.id, node });
    }
    this.armies.changed();
  }

  join(side, army) {
    if (side.armies.has(army)) return;
    side.armies.add(army);
    for (const u of army.units) side.initial[u.type] = (side.initial[u.type] ?? 0) + 1;
  }

  // --- Simulation --------------------------------------------------------------

  update(state, hours) {
    if (!hours || state.phase !== 'playing') return;
    for (const b of [...this.active.values()]) {
      b.acc += hours;
      b.hours += hours;
      while (b.acc >= 1 && !b.done) {
        b.acc -= 1;
        this.round(b);
      }
    }
    this.updateOccupation(hours);
  }

  /** One hour of fighting. */
  round(b) {
    const A = this.armies;
    const units = b.sides.map((s) => {
      const list = [];
      for (const army of s.armies) for (const u of army.units) if (u.hp > 0) list.push({ army, u, t: A.unitType(u) });
      return list;
    });
    if (!units[0].length || !units[1].length) { this.checkEnd(b); return; }
    // Fortifications add to the terrain bonus of whoever holds the ground.
    const terrainDef = b.sea ? 1 : TERRAIN[b.terrain].defense * (A.buildings?.fortBonus(b.node) ?? 1);
    const hits = [];
    for (let i = 0; i < 2; i++) {
      const foes = units[1 - i];
      for (const { army, u, t } of units[i]) {
        const target = foes[Math.floor(Math.random() * foes.length)];
        const embarked = army.kind === 'land' && b.sea;
        const targetEmbarked = target.army.kind === 'land' && b.sea;
        const R = A.research;
        const attack = t.attack * (embarked ? 0.25 : 1) * (0.5 + 0.5 * u.hp / t.hp) * (R ? R.attackMult(army.nation, t.role) : 1);
        const defense = target.t.defense * (i === 0 ? terrainDef : 1) * (targetEmbarked ? 0.5 : 1) * (R ? R.defenseMult(target.army.nation) : 1);
        const dmg = DAMAGE_BASE * attack * MATCHUP[t.role][target.t.role] / defense * (0.75 + Math.random() * 0.5);
        hits.push([target.u, dmg]);
      }
    }
    for (const [u, dmg] of hits) u.hp -= dmg;

    // Casualties.
    b.sides.forEach((s) => {
      for (const army of [...s.armies]) {
        const dead = army.units.filter((u) => u.hp <= 0);
        if (!dead.length) continue;
        for (const u of dead) s.lost[u.type] = (s.lost[u.type] ?? 0) + 1;
        const info = this.warInfo.get(warKey(b.sides[0].nation, b.sides[1].nation));
        if (info) info.unitsLost[s.nation] = (info.unitsLost[s.nation] ?? 0) + dead.length;
        army.units = army.units.filter((u) => u.hp > 0);
        if (!army.units.length) { s.armies.delete(army); A.remove(army); }
      }
    });

    // Retreats.
    b.sides.forEach((s, i) => {
      for (const army of [...s.armies]) {
        if (A.strength(army) >= RETREAT_BELOW) continue;
        const to = this.retreatTarget(army, i === 0);
        if (to < 0) continue;
        s.armies.delete(army);
        s.retreated++;
        A.forceMove(army, to);
        if (army.nation === this.state.playerNationId) {
          this.state.events.emit('feed', { kind: 'retreat', tone: 'bad', text: `${army.name} retreats from ${b.place}`, battleId: b.id, node: b.node });
        }
      }
    });
    this.checkEnd(b);
    A.changed();
  }

  /** A safe neighbouring node to fall back to, or -1. */
  retreatTarget(army, attacker) {
    const A = this.armies;
    const safe = (n) => n !== army.node && A.canEnter(army.nation, n, army.kind) && !this.hostilesAt(n, army.nation).length;
    const opts = A.neighbors(army.node, army.kind).filter(safe);
    if (attacker && opts.includes(army.prev)) return army.prev;
    const own = opts.find((n) => !A.isSea(n) && A.province(n).owner === army.nation);
    if (own != null) return own;
    // Land armies prefer land; at sea, any free sea zone.
    return opts.find((n) => !A.isSea(n)) ?? opts[0] ?? -1;
  }

  checkEnd(b) {
    if (b.done) return;
    const alive = b.sides.map((s) => [...s.armies].some((a) => a.units.length));
    if (alive[0] && alive[1]) return;
    b.done = true;
    b.winner = alive[0] ? 0 : alive[1] ? 1 : -1;
    b.end = this.state.clock.time;
    this.active.delete(b.node);
    this.history.unshift(b.id);
    if (this.history.length > HISTORY) this.battles.delete(this.history.pop());
    const player = this.state.playerNationId;
    const mine = b.sides.findIndex((s) => s.nation === player);
    if (mine >= 0) {
      const won = b.winner === mine;
      const lost = (s) => Object.values(s.lost).reduce((x, y) => x + y, 0);
      this.state.events.emit('feed', {
        kind: 'battle-end', tone: won ? 'good' : 'bad', battleId: b.id, node: b.node,
        text: `${won ? 'Victory' : b.winner < 0 ? 'Stalemate' : 'Defeat'} at ${b.place} · lost ${lost(b.sides[mine])}, killed ${lost(b.sides[1 - mine])}`,
      });
    }
    this.state.events.emit('battle:end', b);
    // Winners standing in the enemy's land will now start occupying it (updateOccupation).
    this.armies.changed();
  }

  // --- Occupation ---------------------------------------------------------------

  occupyHours(p) { return p.isCapital ? OCCUPY_HOURS.capital : p.isCity ? OCCUPY_HOURS.city : OCCUPY_HOURS.land; }

  updateOccupation(hours) {
    const A = this.armies;
    const seen = new Set();
    for (const army of A.list.values()) {
      if (army.seg || army.kind !== 'land' || A.isSea(army.node) || seen.has(army.node)) continue;
      const p = A.province(army.node);
      if (!this.capturable(army.nation, p)) continue;
      if (this.active.has(army.node) || this.hostilesAt(army.node, army.nation).length) continue;
      seen.add(army.node);
      let occ = this.occupations.get(p.id);
      if (!occ || occ.nation !== army.nation) {
        occ = { nation: army.nation, done: 0, total: this.occupyHours(p) };
        this.occupations.set(p.id, occ);
      }
      occ.done += hours;
      if (occ.done >= occ.total) this.capture(p, army.nation);
    }
    // Progress is lost once nobody is holding the province.
    for (const id of this.occupations.keys()) if (!seen.has(id)) this.occupations.delete(id);
  }

  capture(p, nation) {
    const st = this.state;
    const from = p.owner;
    this.occupations.delete(p.id);
    st.setOwner(p.id, nation);
    if (from >= 0) this.warInfo.get(warKey(from, nation))?.captured.push({ pid: p.id, from, to: nation });
    const player = st.playerNationId;
    const winner = st.getNation(nation), loser = st.getNation(from);
    if (nation === player || from === player) {
      st.events.emit('feed', {
        kind: 'capture', tone: nation === player ? 'good' : 'bad', node: p.id,
        text: nation === player ? `Captured ${p.name}${loser ? ` from ${loser.shortName}` : ''}` : `${winner.shortName} captured ${p.name}`,
      });
    }
    if (loser && loser.capitalId === p.id) {
      st.events.emit('feed', { kind: 'capital', tone: nation === player ? 'good' : 'bad', node: p.id, text: `${loser.name} has lost its capital: production −50%` });
    }
    if (winner && winner.capitalId === p.id) {
      st.events.emit('feed', { kind: 'capital', tone: 'good', node: p.id, text: `${winner.name} retook its capital` });
    }
    // A nation with no land left is gone, along with whatever it had in the field.
    if (loser && !st.provinces.some((q) => q.owner === from)) {
      for (const a of [...this.armies.list.values()]) if (a.nation === from) this.armies.remove(a);
      for (const k of [...this.wars]) if (k.split(':').map(Number).includes(from)) { this.wars.delete(k); this.warInfo.delete(k); }
      st.events.emit('feed', { kind: 'annexed', tone: nation === player ? 'good' : 'bad', node: p.id, by: nation, loser: from, text: `${loser.name} has been conquered` });
      st.events.emit('war', { a: from, b: nation });
    }
  }
}
