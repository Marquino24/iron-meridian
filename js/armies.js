/**
 * armies.js — Armies and fleets: spawning, movement graph, pathfinding,
 * marching, split/merge and recruitment queues.
 *
 * Movement graph: every land province and every sea zone is a node.
 *   node <  P  → province id
 *   node >= P  → sea zone (node - P)
 * Land armies walk between neighbouring provinces and can embark from a
 * coastal province into an adjacent sea zone (slow, and weak if attacked),
 * then land on any coast of a sea zone. Fleets only use sea zones.
 *
 * Hop time = distance (km) × terrain move cost ÷ speed of the slowest unit.
 *
 * Combat (combat.js) decides what happens on arrival: a battle if hostile
 * armies are there, an occupation if the province is enemy or unclaimed
 * land. An army keeps its remaining route and continues once that's done.
 */

import { MinHeap, TERRAIN } from './map.js';
import { unproject } from './projection.js';
import { rosterFor, makeUnit, levelStats } from './units.js';
import { colonyOf } from './colonies.js';
import { UNIT_REQUIREMENT, TRAIN_FACTOR } from './buildings.js';

/** Hours to board or leave transports. */
export const EMBARK_HOURS = 6;
/** Fictional maps: km per world unit (AREA_KM2_PER_UNIT = 4). */
const KM_PER_UNIT_FICTIONAL = 2;
const MAX_CITY_GARRISONS = 12;
/** Refitting a unit to a researched level costs this share of its price per level. */
export const REFIT_SHARE = 0.2;

const ordinal = (n) => {
  const t = n % 100;
  return `${n}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

export class Armies {
  /**
   * @param {import('./state.js').GameState} state
   * @param {import('./economy.js').Economy} economy
   */
  constructor(state, economy) {
    this.state = state;
    this.economy = economy;
    this.combat = null;    // set once Combat exists (main.js)
    this.buildings = null; // set by main.js (recruit requirements, roads)
    this.research = null;  // set by main.js (unit levels, speed and training bonuses)
    this.reset();
    state.events.on('map:loaded', () => this.reset());
    state.events.on('province:owner', ({ provinceId }) => this.clearQueue(provinceId));
  }

  reset() {
    const map = this.state.map;
    this.list = new Map();       // id → army
    this.byNode = new Map();     // node → Set<army>
    this.queues = new Map();     // provinceId → [{ type, done }]
    this.nextId = 1;
    this.counters = new Map();   // `${nation}:${kind}` → last ordinal
    this.statCache = new Map();  // `${type}:${level}` → stats
    this.refitClock = 0;
    this.preview = null;         // { armyId, node, path, hours } for the hover route
    this.version = 0;            // bumps on any structural change (UI refresh)
    this.started = false;        // starting forces spawned (a game is under way on this map)
    if (!map) return;
    this.P = map.provinces.length;
    this.roster = rosterFor(map.era?.id);
    // Node positions and latitudes for distances.
    const n = this.P + map.seaZones.length;
    this.pos = new Array(n);
    this.lat = new Float64Array(n);
    this.lon = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = i < this.P ? map.provinces[i].center : map.seaZones[i - this.P].center;
      this.pos[i] = c;
      if (map.kind === 'world') {
        const g = unproject(c.x, c.y);
        this.lat[i] = g.lat;
        this.lon[i] = g.lon;
      }
    }
    // Sea-zone bounding boxes for picking.
    this.seaBoxes = map.seaZones.map((s) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of s.polygon) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      return { x0, y0, x1, y1 };
    });
  }

  changed() {
    this.version++;
    this.state.events.emit('armies', null);
  }

  // --- Graph -----------------------------------------------------------------

  isSea(node) { return node >= this.P; }
  sea(node) { return this.state.map.seaZones[node - this.P]; }
  province(node) { return node < this.P ? this.state.map.provinces[node] : null; }

  nodeName(node) {
    if (node < this.P) return this.state.map.provinces[node].name;
    const s = this.sea(node);
    const coast = s.coastalProvinces.length ? this.state.map.provinces[s.coastalProvinces[0]] : null;
    return coast ? `Sea off ${coast.name}` : `Sea zone ${s.id + 1}`;
  }

  /** Great-circle km between two nodes (straight-line on the fictional map). */
  distKm(a, b) {
    if (this.state.map.kind !== 'world') {
      const p = this.pos[a], q = this.pos[b];
      return Math.hypot(p.x - q.x, p.y - q.y) * KM_PER_UNIT_FICTIONAL;
    }
    const R = Math.PI / 180;
    const la1 = this.lat[a] * R, la2 = this.lat[b] * R;
    const dla = la2 - la1, dlo = (this.lon[b] - this.lon[a]) * R;
    const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** Nodes reachable in one hop for an army of this kind. */
  neighbors(node, kind) {
    const P = this.P;
    if (node < P) {
      if (kind === 'naval') return [];
      const p = this.state.map.provinces[node];
      return p.neighbors.concat(p.seaNeighbors.map((s) => P + s));
    }
    const s = this.sea(node);
    const out = s.neighbors.map((n) => P + n);
    return kind === 'naval' ? out : out.concat(s.coastalProvinces);
  }

  /** Can this nation's army of this kind stand in this node? */
  canEnter(nation, node, kind) {
    if (this.isSea(node)) return true;
    if (kind === 'naval') return false;
    const owner = this.state.map.provinces[node].owner;
    return owner === nation || owner < 0 || !!this.combat?.atWar(nation, owner) || !!this.diplomacy?.hasAccess(nation, owner);
  }

  /** A unit's stats at its level (cached per type and level). */
  unitType(u) {
    const lvl = u.lvl ?? 1;
    if (lvl <= 1) return this.roster.byKey[u.type];
    const k = `${u.type}:${lvl}`;
    if (!this.statCache.has(k)) this.statCache.set(k, levelStats(this.roster.byKey[u.type], lvl));
    return this.statCache.get(k);
  }

  /** The level a nation's new units of this type get from research. */
  levelFor(nation, typeKey) { return this.research?.unitLevel(nation, this.roster.byKey[typeKey].role) ?? 1; }

  /** Speed (km/h) of the slowest unit; land armies at sea use transports. Research adds to both. */
  speedOf(army, atSea) {
    const m = this.research?.moveMult(army.nation) ?? 1;
    if (army.kind === 'land' && atSea) return Math.round(this.roster.transport * m * 10) / 10;
    let s = Infinity;
    for (const u of army.units) s = Math.min(s, this.unitType(u).speed);
    return isFinite(s) ? Math.round(s * m * 10) / 10 : 1;
  }

  /** Game hours for one hop. */
  hopHours(army, a, b) {
    const km = this.distKm(a, b);
    const seaA = this.isSea(a), seaB = this.isSea(b);
    if (army.kind === 'naval' || (seaA && seaB)) return km / this.speedOf(army, true);
    if (seaA !== seaB) return km / this.speedOf(army, true) + EMBARK_HOURS;
    const pa = this.state.map.provinces[a], pb = this.state.map.provinces[b];
    const road = (id) => this.buildings?.roadsMove(id) ?? 1;
    const R = this.research, n = army.nation, fx = (k, who = n) => R?.fx(who, k) ?? 0;
    // Air assault (Cold War): rough terrain slows less.
    const air = fx('airmobile') / 100;
    const terr = (p) => { const c = TERRAIN[p.terrain].moveCost; return c > 1 ? 1 + (c - 1) * (1 - air) : c; };
    const cost = (terr(pa) * road(a) + terr(pb) * road(b)) / 2;
    let h = (km * cost) / this.speedOf(army, false);
    // Era signatures: Roman roads, strategic railways, blitzkrieg, air interdiction.
    if (fx('roadSpeed') && (this.buildings?.level(a, 'roads') || this.buildings?.level(b, 'roads'))) h /= 1 + fx('roadSpeed') / 100;
    if (fx('railMob') && pa.owner === n && pb.owner === n) h /= 1 + fx('railMob') / 100;
    const hostile = pb.owner >= 0 && pb.owner !== n && this.combat?.atWar(n, pb.owner);
    if (hostile && fx('blitz')) h /= 1 + fx('blitz') / 100;
    if (hostile && fx('interdict', pb.owner)) h *= 1 + fx('interdict', pb.owner) / 100;
    return h;
  }

  /**
   * Fastest route for an army to `target`. Handles an army mid-hop: it can
   * carry on to the next node or turn back.
   * @returns {{ path:number[], hours:number, reverse:boolean } | { error:string }}
   */
  findPath(army, target) {
    const st = this.state;
    if (target == null || target < 0) return { error: 'No destination.' };
    if (!this.canEnter(army.nation, target, army.kind)) {
      if (army.kind === 'naval') return { error: 'Ships can only move through sea zones.' };
      const owner = st.getNation(this.province(target).owner);
      return { error: `You're at peace with ${owner.name}: declare war first.`, peace: owner.id };
    }
    const sources = [];
    if (army.seg) {
      const s = army.seg;
      sources.push([s.to, s.hours - s.done, false], [s.from, s.done, true]);
    } else sources.push([army.node, 0, false]);

    // A*: straight-line km at the best possible speed (roads III, research,
    // transports) never overestimates, so the route is still the fastest.
    const best = Math.max(this.speedOf(army, false) / 0.55, this.speedOf(army, true));
    const h = (n) => this.distKm(n, target) / best;
    const dist = new Map(), prev = new Map(), viaReverse = new Map(), closed = new Set();
    const heap = new MinHeap();
    for (const [n, d, rev] of sources) {
      if (!dist.has(n) || d < dist.get(n)) { dist.set(n, d); viaReverse.set(n, rev); heap.push(n, d + h(n)); }
    }
    let found = false;
    while (heap.size) {
      const { value: n } = heap.pop();
      if (closed.has(n)) continue;
      closed.add(n);
      if (n === target) { found = true; break; }
      const d = dist.get(n);
      for (const m of this.neighbors(n, army.kind)) {
        if (closed.has(m) || !this.canEnter(army.nation, m, army.kind)) continue;
        const nd = d + this.hopHours(army, n, m);
        if (nd < (dist.get(m) ?? Infinity)) {
          dist.set(m, nd);
          prev.set(m, n);
          heap.push(m, nd + h(m));
        }
      }
    }
    if (!found) {
      return { error: army.kind === 'naval' ? 'No sea route there.' : 'No route there: the way is blocked by neutral territory.' };
    }
    const path = [];
    let n = target;
    while (prev.has(n)) { path.push(n); n = prev.get(n); }
    path.reverse();
    // `n` is now the source node the route starts from.
    return { path, hours: dist.get(target), reverse: viaReverse.get(n) && !!army.seg, start: n };
  }

  /** Hours left on an army's current route (ignores stops for battles and captures). */
  remainingHours(army) {
    let h = 0;
    let at = army.node;
    if (army.seg) { h += army.seg.hours - army.seg.done; at = army.seg.to; }
    for (const n of army.path) { h += this.hopHours(army, at, n); at = n; }
    return h;
  }

  /** Node position (an army mid-hop is drawn between its two nodes). */
  armyPos(army) {
    let p;
    if (!army.seg) p = this.pos[army.node];
    else {
      const a = this.pos[army.seg.from], b = this.pos[army.seg.to];
      const t = Math.min(1, army.seg.done / army.seg.hours);
      p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    // Multiplayer: after the server corrects a prediction, the marker glides
    // from where it was drawn to where it is (smoothing set by mp-client.js).
    const s = this.smoothing?.get(army.id);
    if (!s) return p;
    const k = 1 - Math.min(1, (performance.now() - s.t0) / s.ms);
    if (k <= 0) { this.smoothing.delete(army.id); return p; }
    const e = k * k; // ease out
    return { x: p.x + s.dx * e, y: p.y + s.dy * e };
  }

  // --- Orders ----------------------------------------------------------------

  /** Order an army to a node. Returns { ok } or { error }. */
  order(armyId, target) {
    const army = this.list.get(armyId);
    if (!army) return { error: 'No such army.' };
    if (target === army.node && !army.seg) { this.stop(armyId); return { ok: true, hours: 0 }; }
    const r = this.findPath(army, target);
    if (r.error) return r;
    this.combat?.detach(army);
    if (army.seg && r.reverse) {
      const s = army.seg;
      army.seg = { from: s.to, to: s.from, hours: s.hours, done: s.hours - s.done };
      this.setNode(army, s.to);
    }
    army.path = r.path;
    army.dest = target;
    army.retreating = false;
    army.fresh = false;
    if (!army.seg) this.startHop(army);
    this.changed();
    return { ok: true, hours: r.hours };
  }

  /** Stop after the current hop. */
  stop(armyId) {
    const army = this.list.get(armyId);
    if (!army) return;
    army.path = [];
    army.dest = army.seg ? army.seg.to : null;
    this.changed();
  }

  /** Forced move (retreats): one hop, no route. */
  forceMove(army, node) {
    army.path = [];
    army.dest = node;
    army.retreating = true;
    army.seg = { from: army.node, to: node, hours: Math.max(1, this.hopHours(army, army.node, node)), done: 0 };
    this.changed();
  }

  startHop(army) {
    const next = army.path.shift();
    if (next == null) { army.dest = null; return; }
    if (!this.canEnter(army.nation, next, army.kind)) { army.path = []; army.dest = null; return; }
    army.seg = { from: army.node, to: next, hours: Math.max(0.5, this.hopHours(army, army.node, next)), done: 0 };
  }

  setNode(army, node) {
    this.byNode.get(army.node)?.delete(army);
    army.node = node;
    if (!this.byNode.has(node)) this.byNode.set(node, new Set());
    this.byNode.get(node).add(army);
  }

  /** Armies standing at a node (not those passing through mid-hop toward it). */
  at(node) { return this.byNode.get(node) ?? new Set(); }

  /** Split the given units (indices into army.units) into a new army at the same place. */
  split(armyId, indices) {
    const army = this.list.get(armyId);
    if (!army || army.seg || this.combat?.inBattle(army)) return null;
    const set = new Set(indices);
    if (!set.size || set.size >= army.units.length) return null;
    const moved = army.units.filter((_, i) => set.has(i));
    army.units = army.units.filter((_, i) => !set.has(i));
    const other = this.create(army.nation, army.kind, army.node, moved, { name: this.nextName(army.nation, army.kind) });
    this.changed();
    return other;
  }

  /** Split roughly in half, keeping a mix of unit types on both sides. */
  splitHalf(armyId) {
    const army = this.list.get(armyId);
    if (!army || army.units.length < 2) return null;
    const order = army.units.map((u, i) => [u, i]).sort((a, b) => (a[0].type < b[0].type ? -1 : a[0].type > b[0].type ? 1 : b[0].hp - a[0].hp));
    return this.split(armyId, order.filter((_, k) => k % 2 === 1).map(([, i]) => i));
  }

  /** Other armies that `armyId` can merge with right now. */
  mergeable(armyId) {
    const army = this.list.get(armyId);
    if (!army || army.seg || this.combat?.inBattle(army)) return [];
    return [...this.at(army.node)].filter((o) => o !== army && o.nation === army.nation && o.kind === army.kind && !o.seg && !this.combat?.inBattle(o));
  }

  merge(intoId, fromId) {
    const a = this.list.get(intoId), b = this.list.get(fromId);
    if (!a || !b || !this.mergeable(intoId).includes(b)) return false;
    a.units.push(...b.units);
    a.garrison = a.garrison && b.garrison;
    this.remove(b);
    return true;
  }

  // --- Creation --------------------------------------------------------------

  nextName(nation, kind) {
    const k = `${nation}:${kind}`;
    const n = (this.counters.get(k) ?? 0) + 1;
    this.counters.set(k, n);
    return `${ordinal(n)} ${kind === 'naval' ? 'Fleet' : 'Army'}`;
  }

  create(nation, kind, node, units, opts = {}) {
    const army = {
      id: this.nextId++,
      nation,
      kind,
      name: opts.name ?? this.nextName(nation, kind),
      node,
      prev: node,
      units,
      path: [],
      seg: null,
      dest: null,
      garrison: !!opts.garrison,
      fresh: !!opts.fresh,
      retreating: false,
    };
    // Raised or garrisoned in a major colony of its own: flies the colonial flag.
    const colony = node < this.P ? colonyOf(this.state.map, this.state.map.provinces[node]) : null;
    if (colony && colony.sovereign === nation) army.colony = colony.id;
    this.list.set(army.id, army);
    if (!this.byNode.has(node)) this.byNode.set(node, new Set());
    this.byNode.get(node).add(army);
    return army;
  }

  remove(army) {
    this.list.delete(army.id);
    this.byNode.get(army.node)?.delete(army);
    this.combat?.detach(army);
    if (this.state.selectedArmyId === army.id) this.state.setSelectedArmy(-1);
    this.changed();
  }

  /** Units of the era roster by role, e.g. { inf: 3, rng: 1 }. */
  makeUnits(mix, nation = -1) {
    const out = [];
    for (const [role, n] of Object.entries(mix)) {
      const t = this.roster.byRole[role];
      const lvl = nation >= 0 ? this.levelFor(nation, t.key) : 1;
      for (let i = 0; i < n; i++) out.push(makeUnit(t, lvl));
    }
    return out;
  }

  /**
   * Starting forces. Every nation: a garrison in its capital (bigger nations,
   * bigger garrison) and in its main cities; coastal major powers get a home
   * fleet. The player also gets 1–3 field armies near its borders.
   */
  spawnInitial(playerId) {
    this.started = true;
    const st = this.state;
    const map = st.map;
    const owned = map.nations.map(() => []);
    for (const p of map.provinces) if (p.owner >= 0) owned[p.owner].push(p);

    for (const n of map.nations) {
      const provs = owned[n.id];
      const size = provs.length;
      if (!size) continue;
      const cap = map.provinces[n.capitalId];
      const capOk = cap && cap.owner === n.id;
      const big = size > 40;
      if (capOk) {
        const inf = Math.round(Math.min(6, 2 + Math.floor(Math.sqrt(size) / 2)) * (n.might ?? 1));
        this.create(n.id, 'land', cap.id, this.makeUnits({ inf, rng: size > 10 ? 1 : 0, mob: size > 25 ? 1 : 0 }),
          { name: `${cap.cityName ?? cap.name} Garrison`, garrison: true });
      }
      const cities = provs.filter((p) => p.isCity && !p.isCapital).slice(0, MAX_CITY_GARRISONS);
      for (const c of cities) {
        this.create(n.id, 'land', c.id, this.makeUnits({ inf: 1, rng: big ? 1 : 0 }), { name: `${c.cityName ?? c.name} Garrison`, garrison: true });
      }
      const port = capOk && cap.seaNeighbors.length ? cap : provs.find((p) => p.isCity && p.seaNeighbors.length);
      // Players (every person, in multiplayer) get a fleet and field armies like the player.
      const human = n.id === playerId || st.isHuman(n.id);
      if (port && (n.major || human) && size > 3) {
        this.create(n.id, 'naval', this.P + port.seaNeighbors[0], this.makeUnits({ nav: human || big ? 2 : 1 }));
      }
    }

    // Field armies: the player always gets 1–3; AI nations with 10+ provinces
    // get the same (they now play), smaller ones rely on their garrisons.
    for (const n of map.nations) {
      const provs = owned[n.id];
      if (n.id !== playerId && !st.isHuman(n.id) && provs.length < 10) continue;
      if (!provs.length || map.provinces[n.capitalId]?.owner !== n.id) continue;
      this.spawnField(n.id, provs);
    }
    this.changed();
  }

  /** 1–3 field armies at the capital, then at border provinces far from each other. */
  spawnField(nation, provs) {
    const map = this.state.map;
    const size = provs.length;
    const n = map.nations[nation];
    // Fictional great powers field more, minor states less (`might`, set by the map).
    const might = n.might ?? 1;
    const count = (size < 10 ? 1 : size < 60 ? 2 : 3) + (might > 1.5 ? 1 : 0);
    const extra = size > 100 ? 1 : 0;
    const cap = map.provinces[n.capitalId];
    const border = provs.filter((p) => p.neighbors.some((q) => map.provinces[q].owner !== nation && map.provinces[q].owner >= 0));
    const picks = [cap];
    while (picks.length < count && border.length) {
      let best = null, bd = -1;
      for (const p of border) {
        const d = Math.min(...picks.map((q) => Math.hypot(p.center.x - q.center.x, p.center.y - q.center.y)));
        // Prefer cities a little (roads, depots).
        const score = d * (p.isCity ? 1.3 : 1);
        if (score > bd && !picks.includes(p)) { bd = score; best = p; }
      }
      if (!best) break;
      picks.push(best);
    }
    for (const p of picks) this.create(nation, 'land', p.id, this.makeUnits({ inf: Math.max(1, Math.round((3 + extra) * might)), mob: Math.max(1, Math.round((2 + extra) * might)), rng: 1 }));
  }

  // --- Recruitment -----------------------------------------------------------

  queue(provinceId) { return this.queues.get(provinceId) ?? []; }

  /** Can this province recruit this unit type for its owner? */
  /**
   * Can this city train this unit? Land units need Barracks (L1 infantry,
   * L2 ranged, L3 mobile); ships need a Port. → { ok, reason?, hours }
   */
  recruitCheck(provinceId, typeKey, opts = {}) {
    const p = this.state.getProvince(provinceId);
    const t = this.roster.byKey[typeKey];
    if (!p || !t || p.owner < 0) return { ok: false, reason: 'Not yours' };
    if (!p.isCity) return { ok: false, reason: 'Cities only' };
    const [building, need] = UNIT_REQUIREMENT[t.role];
    const B = this.buildings;
    const have = B ? B.level(provinceId, building) : need;
    const hours = Math.round(t.build * TRAIN_FACTOR[have] * (this.research?.trainTimeMult(p.owner) ?? 1));
    if (t.role === 'nav' && !p.seaNeighbors.length) return { ok: false, reason: 'Not coastal', hours };
    if (have < need) return { ok: false, reason: `Needs ${B.name(building)} ${['', 'I', 'II', 'III'][need]}`, hours };
    if (!opts.ignoreCost && !this.economy.canAfford(p.owner, t.cost)) return { ok: false, reason: 'Not enough resources', hours };
    return { ok: true, hours };
  }

  canRecruit(provinceId, typeKey) { return this.recruitCheck(provinceId, typeKey, { ignoreCost: true }).ok; }

  recruit(provinceId, typeKey) {
    const p = this.state.getProvince(provinceId);
    const t = this.roster.byKey[typeKey];
    const c = this.recruitCheck(provinceId, typeKey, { ignoreCost: true });
    if (!c.ok) return { error: c.reason };
    if (!this.economy.spend(p.owner, t.cost)) return { error: 'Not enough resources.' };
    if (!this.queues.has(provinceId)) this.queues.set(provinceId, []);
    this.queues.get(provinceId).push({ type: typeKey, done: 0, total: c.hours });
    this.changed();
    return { ok: true };
  }

  /** Cancel a queued unit and refund it. */
  cancel(provinceId, index) {
    const q = this.queues.get(provinceId);
    const p = this.state.getProvince(provinceId);
    if (!q || !q[index] || !p) return;
    const [item] = q.splice(index, 1);
    this.economy.spend(p.owner, this.roster.byKey[item.type].cost, -1);
    if (!q.length) this.queues.delete(provinceId);
    this.changed();
  }

  /** A captured city loses whatever it was building. */
  clearQueue(provinceId) {
    if (this.queues.delete(provinceId)) this.changed();
  }

  finishUnit(provinceId, typeKey, { levy = false } = {}) {
    const p = this.state.getProvince(provinceId);
    const t = this.roster.byKey[typeKey];
    const naval = t.role === 'nav';
    const node = naval ? this.P + p.seaNeighbors[0] : provinceId;
    // Units finished in a row at the same place gather into one new army.
    const host = [...this.at(node)].find((a) => a.fresh && a.nation === p.owner && a.kind === (naval ? 'naval' : 'land') && !a.seg && !this.combat?.inBattle(a));
    const unit = makeUnit(t, this.levelFor(p.owner, typeKey));
    if (host) host.units.push(unit);
    else this.create(p.owner, naval ? 'naval' : 'land', node, [unit], { fresh: true });
    if (p.owner === this.state.playerNationId) this.state.events.emit('feed', {
      kind: 'unit', tone: 'good',
      text: levy ? `Levies raised in ${p.cityName ?? p.name}: ${t.name}` : `${t.name} ready in ${p.cityName ?? p.name}`, node, nation: p.owner,
    });
    this.changed();
  }

  // --- Simulation ------------------------------------------------------------

  update(state, hours) {
    if (!hours || state.phase !== 'playing') return;

    // Recruitment: one unit at a time per city.
    for (const [pid, q] of this.queues) {
      const item = q[0];
      item.done += hours;
      if (item.done >= item.total) {
        q.shift();
        if (!q.length) this.queues.delete(pid);
        this.finishUnit(pid, item.type);
      }
    }

    // Refits: once per game hour, armies resting in a city with Barracks
    // (fleets: next to a city with a Port) take on researched unit levels.
    this.refitClock += hours;
    if (this.refitClock >= 1) { this.heal(this.refitClock); this.refitClock = 0; this.refit(); }

    // Movement.
    for (const army of [...this.list.values()]) {
      let budget = hours;
      for (let guard = 0; guard < 8 && budget > 0; guard++) {
        if (!army.seg) {
          if (!army.path.length || this.combat?.holds(army)) break;
          this.startHop(army);
          if (!army.seg) break;
        }
        const s = army.seg;
        const step = Math.min(budget, s.hours - s.done);
        s.done += step;
        budget -= step;
        if (s.done >= s.hours - 1e-9) this.arrive(army);
        else break;
      }
    }
  }

  /** After peace: armies of `nation` standing in (or heading into) `other`'s land go back to the nearest own province. */
  withdraw(nation, other) {
    const owned = (id) => !this.isSea(id) && this.province(id).owner === nation;
    for (const army of this.list.values()) {
      if (army.nation !== nation || army.kind !== 'land') continue;
      if (army.seg && !this.isSea(army.seg.to) && this.province(army.seg.to).owner === other) { army.seg = null; army.path = []; army.dest = null; }
      if (this.isSea(army.node) || this.province(army.node).owner !== other) continue;
      // Breadth-first over land to the closest own province.
      const seen = new Set([army.node]);
      let frontier = [army.node], home = -1;
      while (frontier.length && home < 0) {
        const next = [];
        for (const id of frontier) for (const nb of this.state.map.provinces[id].neighbors) {
          if (seen.has(nb)) continue;
          seen.add(nb);
          if (owned(nb)) { home = nb; break; }
          next.push(nb);
        }
        frontier = next;
      }
      if (home < 0) home = this.state.getNation(nation)?.capitalId ?? -1;
      if (home < 0 || !owned(home)) continue;
      army.seg = null; army.path = []; army.dest = null; army.retreating = false;
      this.setNode(army, home);
    }
  }

  /**
   * Healing: armies resting on their own land (not moving, not fighting)
   * recover 3% of full strength per hour in a city, 1% elsewhere.
   */
  heal(hours) {
    for (const army of this.list.values()) {
      if (army.seg || army.kind !== 'land' || this.isSea(army.node) || this.combat?.inBattle(army)) continue;
      const p = this.province(army.node);
      if (p.owner !== army.nation) continue;
      const rate = (p.isCity ? 0.03 : 0.01) * hours * (1 + (this.research?.fx(army.nation, 'heal') ?? 0) / 100);
      for (const u of army.units) {
        const max = this.unitType(u).hp;
        if (u.hp < max) u.hp = Math.min(max, u.hp + max * rate);
      }
    }
  }

  /** Where an army can refit right now, or null. */
  refitSite(army) {
    if (army.seg || this.combat?.inBattle(army) || !this.buildings) return null;
    const B = this.buildings;
    if (army.kind === 'land') {
      const p = this.province(army.node);
      return p && p.isCity && p.owner === army.nation && B.level(p.id, 'barracks') >= 1 ? p : null;
    }
    if (!this.isSea(army.node)) return null;
    const coast = this.sea(army.node).coastalProvinces.map((id) => this.state.map.provinces[id]);
    return coast.find((p) => p.isCity && p.owner === army.nation && B.level(p.id, 'port') >= 1) ?? null;
  }

  /** Units below their nation's researched level that a refit would upgrade. */
  outdated(army) {
    if (!this.research) return [];
    return army.units.filter((u) => (u.lvl ?? 1) < this.levelFor(army.nation, u.type));
  }

  /** Cost to bring one unit up to a level: 20% of its price (not men or food) per level gained. */
  refitCost(u, toLvl) {
    const steps = toLvl - (u.lvl ?? 1);
    const c = {};
    if (steps <= 0) return c;
    for (const [k, v] of Object.entries(this.roster.byKey[u.type].cost)) {
      if (k !== 'manpower' && k !== 'food') c[k] = Math.ceil(v * REFIT_SHARE * steps);
    }
    return c;
  }

  /** Total refit cost of an army's outdated units. */
  refitCostOf(army) {
    const total = {};
    for (const u of this.outdated(army)) {
      for (const [k, v] of Object.entries(this.refitCost(u, this.levelFor(army.nation, u.type)))) total[k] = (total[k] ?? 0) + v;
    }
    return total;
  }

  refit() {
    if (!this.research) return;
    for (const army of this.list.values()) {
      const old = this.outdated(army);
      if (!old.length) continue;
      const site = this.refitSite(army);
      if (!site) continue;
      let done = 0;
      const paid = {};
      for (const u of old) {
        const lvl = this.levelFor(army.nation, u.type);
        const cost = this.refitCost(u, lvl);
        if (!this.economy.spend(army.nation, cost)) break; // the rest wait for resources
        for (const [k, v] of Object.entries(cost)) paid[k] = (paid[k] ?? 0) + v;
        const before = this.unitType(u).hp;
        u.lvl = lvl;
        u.hp *= this.unitType(u).hp / before; // keep the same share of health
        done++;
      }
      if (!done) continue;
      if (army.nation === this.state.playerNationId) {
        const price = Object.entries(paid).map(([k, v]) => `${Math.round(v)} ${this.economy.label(k).toLowerCase()}`).join(', ');
        this.state.events.emit('feed', { kind: 'refit', tone: 'good', node: army.node, text: `${army.name} upgraded ${done} unit${done > 1 ? 's' : ''} in ${site.cityName ?? site.name} (${price})` });
      }
      this.changed();
    }
  }

  arrive(army) {
    const to = army.seg.to;
    army.prev = army.seg.from;
    army.seg = null;
    this.setNode(army, to);
    const wasRetreat = army.retreating;
    army.retreating = false;
    if (!army.path.length) army.dest = null;
    this.combat?.onArrive(army, wasRetreat);
    this.changed();
  }

  // --- Picking ---------------------------------------------------------------

  /** Sea zone node under a world point, or -1. */
  pickSea(x, y) {
    const seas = this.state.map.seaZones;
    for (let i = 0; i < seas.length; i++) {
      const b = this.seaBoxes[i];
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      const poly = seas[i].polygon;
      let inside = false;
      for (let a = 0, c = poly.length - 1; a < poly.length; c = a++) {
        const p = poly[a], q = poly[c];
        if ((p.y > y) !== (q.y > y) && x < ((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x) inside = !inside;
      }
      if (inside) return this.P + i;
    }
    return -1;
  }

  /** Movement target for a click: a province, or the sea under it. Fleets clicking a coast go to its sea zone. */
  targetAt(army, provinceId, x, y) {
    if (provinceId >= 0) {
      if (army.kind !== 'naval') return provinceId;
      const p = this.state.map.provinces[provinceId];
      if (!p.seaNeighbors.length) return -1;
      let best = -1, bd = Infinity;
      for (const s of p.seaNeighbors) {
        const c = this.pos[this.P + s];
        const d = Math.hypot(c.x - x, c.y - y);
        if (d < bd) { bd = d; best = this.P + s; }
      }
      return best;
    }
    return this.pickSea(x, y);
  }

  /** Route preview while hovering with an army selected (cached per target). */
  setPreview(armyId, node) {
    const army = this.list.get(armyId);
    if (!army || node < 0 || army.nation !== this.state.playerNationId) { this.preview = null; return; }
    if (this.preview && this.preview.armyId === armyId && this.preview.node === node && this.preview.version === this.version) return;
    const r = this.findPath(army, node);
    this.preview = { armyId, node, version: this.version, ...r };
  }

  // --- Queries for UI --------------------------------------------------------

  strength(army) {
    let hp = 0, max = 0;
    for (const u of army.units) { hp += Math.max(0, u.hp); max += this.unitType(u).hp; }
    return max ? hp / max : 0;
  }

  /** { roleKey: count } in roster order. */
  composition(army) {
    const c = {};
    for (const t of this.roster.units) c[t.key] = 0;
    for (const u of army.units) c[u.type]++;
    return c;
  }

  /** Dominant role, for the map symbol. */
  mainRole(army) {
    const n = {};
    for (const u of army.units) { const r = this.unitType(u).role; n[r] = (n[r] ?? 0) + 1; }
    return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'inf';
  }
}
