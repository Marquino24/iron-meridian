/**
 * ai.js — Computer nations: economy, research, army and war.
 *
 * Every nation except the player's gets a personality (Aggressive, Balanced,
 * Defensive, Expansionist) and "thinks" every so often:
 *   - economy: builds farms when food runs short, mines/factories for
 *     production, barracks in border cities, a port if coastal, forts on
 *     threatened borders;
 *   - research: keeps the shared queue filled, ordered by personality;
 *   - army: recruits a mix it can afford, keeps garrisons in the capital and
 *     border cities, gathers new units into field armies;
 *   - war: declares war on a neighbour when clearly stronger (or to take back
 *     lost provinces), picks targets by value, weakness and distance, attacks
 *     with whole armies, pulls back damaged ones, reinforces threatened
 *     cities, and offers a white peace when the war goes badly.
 *
 * Performance: thinking is staggered. Each nation has its next think time
 * (big powers every 12 game hours, small ones every 2–3 days); every frame
 * works through the nations that are due until a time budget (3 ms) runs
 * out, then continues next frame.
 */

import { hashSeed } from './map.js';
import { MAX_LEVEL } from './buildings.js';

export const PERSONALITIES = {
  aggressive: { label: 'Aggressive', warRatio: 1.4, warChance: 0.3, military: 0.65, maxWars: 2, branches: ['mil', 'eco', 'inf'], fort: 0.1, expand: 0.4 },
  balanced: { label: 'Balanced', warRatio: 1.8, warChance: 0.08, military: 0.5, maxWars: 1, branches: ['eco', 'mil', 'inf'], fort: 0.2, expand: 0.2 },
  defensive: { label: 'Defensive', warRatio: 2.8, warChance: 0.02, military: 0.45, maxWars: 1, branches: ['inf', 'eco', 'mil'], fort: 0.5, expand: 0 },
  // Only for the headless "player bot" (tools/sim-ai.mjs): plays like a determined human.
  conqueror: { label: 'Conqueror', warRatio: 1.1, warChance: 1.2, military: 0.75, maxWars: 3, branches: ['mil', 'eco', 'inf'], fort: 0.05, expand: 1 },
  expansionist: { label: 'Expansionist', warRatio: 1.5, warChance: 0.18, military: 0.55, maxWars: 2, branches: ['eco', 'inf', 'mil'], fort: 0.1, expand: 1 },
};

export const DIFFICULTY = {
  easy: { label: 'Easy', think: 1.6, warRatio: 1.35, chance: 0.5, prod: 0.9, attackRatio: 1.0, smart: false },
  normal: { label: 'Normal', think: 1, warRatio: 1, chance: 1, prod: 1, attackRatio: 1.2, smart: false },
  hard: { label: 'Hard', think: 0.75, warRatio: 0.9, chance: 1.2, prod: 1.15, attackRatio: 1.35, smart: true },
};

/** Era leanings; everyone else is drawn at random (seeded by name). */
const ERA_PERSONALITY = {
  rome: { 'Roman Empire': 'expansionist', 'Han Empire': 'expansionist', 'Parthian Empire': 'aggressive' },
  medieval: { 'Mongol Empire': 'aggressive', 'Almohad Caliphate': 'expansionist', 'Holy Roman Empire': 'balanced', 'Byzantine Empire': 'defensive' },
  ww1: { 'German Empire': 'aggressive', 'Austro-Hungarian Empire': 'aggressive', 'Russian Empire': 'expansionist', 'United States': 'defensive' },
  ww2: { 'German Reich': 'aggressive', 'Empire of Japan': 'aggressive', 'Kingdom of Italy': 'aggressive', 'Soviet Union': 'expansionist', 'United States': 'defensive', 'United Kingdom': 'defensive', France: 'defensive' },
  coldwar: { 'Soviet Union': 'expansionist', 'United States': 'balanced' },
};
/** How warlike each era is overall (the 20th-century world wars more, the nuclear age less). */
const ERA_WAR_RATE = { rome: 1, medieval: 1, ww1: 1.2, ww2: 1.2, coldwar: 0.6, modern: 0.4, fictional: 2 };
const RANDOM_MIX = [['aggressive', 0.15], ['balanced', 0.4], ['defensive', 0.35], ['expansionist', 0.1]];

const MIN_ATTACK_UNITS = 3;
/** Overseas landings: coastal provinces considered per enemy, and the extra strength they need. */
const LANDING_SITES = 6;
const LANDING_MARGIN = 1.3;
/** A neighbour this big (share of all provinces, and 1.25× us) can be a coalition's target. */
const COALITION_SHARE = 0.08;
const PEACE_COOLDOWN_H = 24 * 30;

export class AI {
  /**
   * @param {import('./state.js').GameState} state
   * @param {{ economy, buildings, armies, combat, research }} sim
   */
  constructor(state, sim) {
    this.state = state;
    this.sim = sim;
    this.difficulty = 'normal';
    this.budgetMs = 3;           // per frame; headless runs set Infinity
    this.enabled = true;
    this.disabled = new Set();   // nations whose AI is switched off (sandbox)
    this.reset();
    state.events.on('map:loaded', () => this.reset());
    state.events.on('province:owner', ({ from, to }) => { this.dirtyNeighbors.add(from); this.dirtyNeighbors.add(to); });
    // Difficulty for computer nations; fictional nations also differ in economic weight.
    sim.economy.bonus = (n) => (this.brains.has(n) ? DIFFICULTY[this.difficulty].prod : 1) * (this.state.nations[n]?.econ ?? 1);
  }

  reset() {
    this.brains = new Map();     // nation → brain
    this.neighbors = new Map();  // nation → Set of neighbouring nations
    this.dirtyNeighbors = new Set();
    this.strength = new Map();
    this.strengthAt = -Infinity;
    this.clockHours = 0;
    this.stats = { thinks: 0, ms: 0, frames: 0, maxFrameMs: 0, maxStepMs: 0 };
    this.current = null;         // the think in progress (a generator)
  }

  get D() { return DIFFICULTY[this.difficulty] ?? DIFFICULTY.normal; }

  /**
   * Adaptive time budget (browser): shrink while frames miss 60 fps, grow
   * back when there's headroom. Slow devices then think a little later
   * instead of dropping frames.
   */
  adaptBudget(dtReal) {
    if (!isFinite(this.budgetMs)) return;
    this.frameAvg = (this.frameAvg ?? 1 / 60) * 0.9 + dtReal * 0.1;
    if (this.frameAvg > 1 / 55) this.budgetMs = Math.max(0.5, this.budgetMs * 0.9);
    else if (this.frameAvg < 1 / 58) this.budgetMs = Math.min(3, this.budgetMs * 1.05);
  }

  /** Start: one brain per nation the player doesn't control. */
  start(playerId, difficulty = 'normal') {
    this.difficulty = DIFFICULTY[difficulty] ? difficulty : 'normal';
    this.brains.clear();
    const map = this.state.map;
    const eraTable = ERA_PERSONALITY[map.era?.id] ?? {};
    const sizes = map.nations.map(() => 0);
    for (const p of map.provinces) if (p.owner >= 0) sizes[p.owner]++;
    this.disabled.clear();
    for (const n of map.nations) {
      if (n.id === playerId || !sizes[n.id]) continue;
      this.addBrain(n.id, sizes[n.id]);
    }
    // Remember original owners (to retake lost land) and refresh research bonuses.
    for (const p of map.provinces) p.homeOf = p.owner;
    this.sim.economy.recount();
  }

  /** A brain for one nation (also used when the sandbox hands a nation back to the computer). */
  addBrain(id, size = null) {
    if (this.brains.has(id) || id === this.state.playerNationId) return;
    const n = this.state.getNation(id);
    size ??= this.state.provinces.filter((p) => p.owner === id).length;
    if (!n || !size) return;
    const personality = (ERA_PERSONALITY[this.state.map.era?.id] ?? {})[n.name] ?? n.personality ?? this.randomPersonality(n.name);
    const every = (n.major ? 12 : size >= 25 ? 24 : size >= 6 ? 48 : 72) * this.D.think;
    this.brains.set(id, {
      id, personality, every,
      next: this.clockHours + (hashSeed(n.name) % 100) / 100 * every, // stagger first thinks
      lastPeaceOffer: -Infinity, staging: -1, home: new Set(),
    });
  }

  removeBrain(id) {
    if (this.current && this.currentBrain === id) this.current = null;
    this.brains.delete(id);
  }

  /** Is the computer running this nation right now? */
  controls(id) { return this.enabled && this.brains.has(id) && !this.disabled.has(id); }

  randomPersonality(name) {
    let r = (hashSeed(`personality:${name}`) % 1000) / 1000;
    for (const [k, w] of RANDOM_MIX) { if ((r -= w) < 0) return k; }
    return 'balanced';
  }

  personalityOf(nation) { return this.brains.get(nation)?.personality ?? null; }

  // --- Scheduling -----------------------------------------------------------------

  update(state, hours) {
    if (!hours || state.phase !== 'playing' || !this.enabled || !this.brains.size) return;
    this.clockHours += hours;
    // Struggling device (budget at its floor): think only every third frame.
    if (this.budgetMs <= 0.5 && (this.skip = ((this.skip ?? 0) + 1) % 3) !== 0) return;
    const t0 = performance.now();
    // Due brains, most overdue first.
    const due = [];
    for (const b of this.brains.values()) if (b.next <= this.clockHours && !this.disabled.has(b.id)) due.push(b);
    if (!due.length && !this.current) return;
    due.sort((a, b) => a.next - b.next);
    this.refreshStrength();
    // Thinking is a generator that pauses between phases and orders, so one
    // frame never runs much past the budget; it resumes on the next frame.
    let i = 0;
    while (performance.now() - t0 < this.budgetMs) {
      if (!this.current) {
        const b = due[i++];
        if (!b) break;
        b.next = this.clockHours + b.every * (0.85 + Math.random() * 0.3);
        if (!this.state.provinces.some((p) => p.owner === b.id)) { this.brains.delete(b.id); continue; }
        this.current = this.think(b);
        this.currentBrain = b.id;
        this.stats.thinks++;
      }
      const ts = performance.now();
      const step = this.current.next();
      this.stats.maxStepMs = Math.max(this.stats.maxStepMs, performance.now() - ts);
      if (step.done) this.current = null;
    }
    const ms = performance.now() - t0;
    this.stats.ms += ms;
    this.stats.frames++;
    this.stats.maxFrameMs = Math.max(this.stats.maxFrameMs, ms);
  }

  // --- Shared knowledge ------------------------------------------------------------

  /** Military power of every nation (recomputed at most every 6 game hours). */
  refreshStrength() {
    if (this.clockHours - this.strengthAt < 6) return;
    this.strengthAt = this.clockHours;
    const A = this.sim.armies;
    const s = new Map();
    for (const a of A.list.values()) s.set(a.nation, (s.get(a.nation) ?? 0) + this.armyPower(a));
    this.strength = s;
  }

  armyPower(army) {
    const A = this.sim.armies;
    let p = 0;
    for (const u of army.units) {
      const t = A.unitType(u);
      p += ((t.attack + t.defense) / 2) * Math.max(0, u.hp) / t.hp * (t.hp / 100);
    }
    return army.kind === 'naval' ? p * 0.3 : p;
  }

  powerOf(nation) { return this.strength.get(nation) ?? 0; }

  /** Nations sharing a land border (and, for big powers, a sea zone) with this one. */
  neighborsOf(nation) {
    if (this.neighbors.has(nation) && !this.dirtyNeighbors.has(nation)) return this.neighbors.get(nation);
    const map = this.state.map;
    const set = new Set();
    const seas = new Set();
    const major = map.nations[nation]?.major;
    for (const p of map.provinces) {
      if (p.owner !== nation) continue;
      for (const nb of p.neighbors) { const o = map.provinces[nb].owner; if (o >= 0 && o !== nation) set.add(o); }
      if (major) for (const s of p.seaNeighbors) seas.add(s);
    }
    // In the Fictional World (few nations, often an ocean apart) powers also reach the next sea zones out.
    if (major && map.era?.fictional) for (const s of [...seas]) for (const t of map.seaZones[s].neighbors) seas.add(t);
    for (const s of seas) for (const pid of map.seaZones[s].coastalProvinces) { const o = map.provinces[pid].owner; if (o >= 0 && o !== nation) set.add(o); }
    this.neighbors.set(nation, set);
    this.dirtyNeighbors.delete(nation);
    return set;
  }

  // --- Thinking -------------------------------------------------------------------------

  /** One think, in small steps (a generator; see update()). */
  *think(b) {
    const P = PERSONALITIES[b.personality];
    const n = b.id;
    const C = this.sim.combat;
    const mine = this.state.provinces.filter((p) => p.owner === n);
    const ctx = { b, P, n, mine, cities: mine.filter((p) => p.isCity), enemies: C.enemiesOf(n), orders: [] };
    ctx.border = new Set(mine.filter((p) => p.neighbors.some((q) => { const o = this.state.provinces[q].owner; return o !== n && o >= 0; })).map((p) => p.id));
    yield;
    this.doResearch(ctx);
    this.doBuildings(ctx);
    yield;
    this.doRecruit(ctx);
    yield;
    this.doArmies(ctx);
    // Each order runs a path search: one per step.
    for (const [id, target] of ctx.orders) {
      yield;
      if (this.sim.armies.list.has(id)) this.sim.armies.order(id, target);
    }
    yield;
    this.doDiplomacy(ctx);
  }

  // Research: keep two techs queued, branches in personality order.
  doResearch({ n, P }) {
    const R = this.sim.research;
    const r = R.of(n);
    if (r.queue.length >= 2) return;
    const order = [...R.tree].sort((a, b) => a.tier - b.tier || P.branches.indexOf(a.branch) - P.branches.indexOf(b.branch));
    for (const t of order) {
      if (r.queue.length >= 2) break;
      if (R.canQueue(n, t.id).ok) R.enqueue(n, t.id);
    }
  }

  // Buildings: at most two new constructions per think, keeping a reserve.
  doBuildings({ n, P, cities, border, enemies }) {
    const B = this.sim.buildings, E = this.sim.economy;
    const stock = E.get(n), inc = E.income(n).perDay;
    const free = cities.filter((p) => !B.construction.has(p.id));
    if (!free.length) return;
    const wants = [];
    const days = (k) => (inc[k] > 0 ? stock[k] / inc[k] : 99);
    const foodShort = days('food') < 6;
    for (const p of free) {
      const lv = B.of(p.id);
      const atBorder = border.has(p.id);
      if (atBorder && lv.barracks < (P.military > 0.55 ? 2 : 1)) wants.push([p.id, 'barracks', 5]);
      if (p.isCapital && lv.barracks < MAX_LEVEL) wants.push([p.id, 'barracks', 3]);
      if (foodShort && lv.farm < MAX_LEVEL) wants.push([p.id, 'farm', 6]);
      if (lv.mine < MAX_LEVEL) wants.push([p.id, 'mine', 2 + (p.isCapital ? 1 : 0)]);
      if (lv.farm < 2) wants.push([p.id, 'farm', 1.5]);
      if (p.seaNeighbors.length && !lv.port && !cities.some((c) => B.level(c.id, 'port') > 0)) wants.push([p.id, 'port', 4]);
      if (atBorder && (enemies.length || P.fort >= 0.5) && lv.fort < MAX_LEVEL) wants.push([p.id, 'fort', 2 + P.fort * 4]);
      if (p.isCapital && lv.roads < 2) wants.push([p.id, 'roads', 1]);
    }
    if (this.sim.economy.set.industrial) {
      for (const p of this.state.provinces) if (p.owner === n && p.oil && !B.construction.has(p.id) && B.level(p.id, 'oilwell') < MAX_LEVEL) wants.push([p.id, 'oilwell', days('oil') < 10 ? 5 : 1.5]);
    }
    wants.sort((a, b) => b[2] - a[2] + (Math.random() - 0.5) * 0.5);
    let started = 0;
    const used = new Set();
    for (const [pid, type] of wants) {
      if (started >= 2 || used.has(pid)) continue;
      const c = B.check(pid, type, { ignoreCost: true });
      if (!c.ok) continue;
      // Keep a reserve: spend on buildings only from the non-military share.
      if ((stock.money ?? 0) * (1 - P.military) < (c.cost.money ?? 0) * 1.5) continue;
      if (B.build(pid, type).ok) { started++; used.add(pid); }
    }
  }

  // Recruiting: aim for an army in proportion to the economy, more at war.
  doRecruit({ n, P, cities, border, enemies }) {
    const A = this.sim.armies, E = this.sim.economy;
    const inc = E.income(n).perDay;
    let units = 0, queued = 0;
    for (const a of A.list.values()) if (a.nation === n) units += a.units.length;
    for (const p of cities) queued += A.queue(p.id).length;
    const desired = Math.max(3, Math.round((inc.money / 60) * (0.5 + P.military) * (enemies.length ? 1.5 : 1)));
    if (units + queued >= desired) return;
    const sites = cities.filter((p) => A.queue(p.id).length < 2).sort((a, b) => (border.has(b.id) - border.has(a.id)) || (b.isCapital - a.isCapital));
    if (!sites.length) return;
    const roster = A.roster.units;
    // Mix: half infantry, a quarter each ranged and mobile (where barracks allow); a few ships for coastal powers.
    const mix = ['inf', 'inf', 'rng', 'mob', 'inf', 'rng', 'mob', 'inf'];
    let made = 0;
    const want = Math.min(4, desired - units - queued);
    for (let i = 0; made < want && i < 16; i++) {
      const role = mix[(units + queued + made + i) % mix.length];
      const t = roster.find((x) => x.role === role);
      const site = sites.find((p) => A.recruitCheck(p.id, t.key, { ignoreCost: true }).ok)
        ?? (role !== 'inf' ? null : sites[0]);
      if (!site) continue;
      // Spend only the military share of the treasury.
      const stock = E.get(n);
      if ((stock.money ?? 0) * P.military < (t.cost.money ?? 0)) break;
      if (A.recruit(site.id, t.key).ok) made++;
    }
    // A small navy for coastal powers.
    if (this.state.getNation(n).major && Math.random() < 0.15) {
      const ship = roster.find((x) => x.role === 'nav');
      const port = cities.find((p) => A.recruitCheck(p.id, ship.key).ok);
      if (port) A.recruit(port.id, ship.key);
    }
  }

  // Armies: garrisons, gathering, defence, attack.
  doArmies(ctx) {
    const { n, P, cities, border, enemies, b } = ctx;
    const A = this.sim.armies, C = this.sim.combat, D = this.D;
    const prov = (id) => this.state.provinces[id];
    const mine = [...A.list.values()].filter((a) => a.nation === n && a.kind === 'land' && a.units.length);
    const idle = (a) => !a.seg && !a.path.length && !C.inBattle(a) && !C.holds(a);
    const order = (a, target) => {
      if (ctx.orders.length >= 4 || ctx.orders.some(([id]) => id === a.id)) return false;
      ctx.orders.push([a.id, target]);
      return true;
    };
    const orders = { get length() { return ctx.orders.length; } };

    // 1. New units: top up the local garrison, the rest become field units.
    for (const a of mine) {
      if (!a.fresh || a.seg) continue;
      const p = prov(a.node);
      if (!p) { a.fresh = false; continue; } // at sea (e.g. it sailed before its first think)
      const garrison = mine.find((g) => g.garrison && g.node === a.node && g !== a);
      const need = p.isCapital ? 3 + (enemies.length ? 2 : 0) : border.has(p.id) ? (enemies.length ? 2 : 1) : 1;
      if (garrison && garrison.units.length < need) { A.merge(garrison.id, a.id); continue; }
      if (!garrison && p.isCity) { a.garrison = true; a.fresh = false; a.name = `${p.cityName ?? p.name} Garrison`; continue; }
      a.fresh = false;
    }
    const field = mine.filter((a) => !a.garrison && A.list.has(a.id));

    // 2. Damaged armies fall back to the nearest own city to heal.
    for (const a of field) {
      if (!idle(a) && !(a.seg && !a.retreating)) continue;
      if (A.strength(a) >= 0.45 || C.inBattle(a)) continue;
      const p = prov(a.node);
      if (p?.isCity && p.owner === n) continue;
      const home = this.nearest(a, cities.map((c) => c.id));
      if (home >= 0) order(a, home);
    }

    // 3. Merge field armies standing together.
    const byNode = new Map();
    for (const a of field) if (idle(a) && A.list.has(a.id)) { if (!byNode.has(a.node)) byNode.set(a.node, []); byNode.get(a.node).push(a); }
    for (const list of byNode.values()) for (let i = 1; i < list.length; i++) A.merge(list[0].id, list[i].id);
    const ready = field.filter((a) => A.list.has(a.id) && idle(a) && A.strength(a) >= 0.6);

    // 4. Threatened cities get help.
    const threats = [];
    for (const c of cities) {
      let enemyNear = 0;
      for (const nb of [c.id, ...c.neighbors]) for (const o of A.at(nb)) if (C.atWar(o.nation, n)) enemyNear += this.armyPower(o);
      if (!enemyNear) continue;
      let ownHere = 0;
      for (const o of A.at(c.id)) if (o.nation === n) ownHere += this.armyPower(o);
      if (ownHere < enemyNear) threats.push({ c, gap: enemyNear - ownHere });
    }
    threats.sort((x, y) => (y.c.isCapital - x.c.isCapital) || y.gap - x.gap);
    for (const t of threats.slice(0, 2)) {
      const helper = this.nearestArmy(ready, t.c.id);
      if (helper && order(helper, t.c.id)) ready.splice(ready.indexOf(helper), 1);
      else {
        const inf = A.roster.byRole.inf;
        if (A.recruitCheck(t.c.id, inf.key).ok) A.recruit(t.c.id, inf.key);
      }
    }

    // 5. Attack: whole armies only, against the best-scoring enemy (or unclaimed) province.
    if (enemies.length || P.expand > 0) {
      const targets = this.targets(ctx);
      for (const a of ready) {
        if (!targets.length || orders.length >= 4) break;
        if (a.units.length < MIN_ATTACK_UNITS) continue;
        const power = this.armyPower(a);
        let best = null, bs = -Infinity;
        for (const t of targets) {
          if (power < t.defense * D.attackRatio * (t.landing ? LANDING_MARGIN : 1)) continue;
          if (t.landing && a.units.length < MIN_ATTACK_UNITS + 1) continue;
          const d = Math.hypot(A.pos[t.id].x - A.pos[a.node].x, A.pos[t.id].y - A.pos[a.node].y);
          const s = t.value * (D.smart ? 2 / (1 + t.defense / power) : 1) - d / 40 + (D.smart ? 0 : Math.random() * 1.5);
          if (s > bs) { bs = s; best = t; }
        }
        if (best && order(a, best.id)) {
          targets.splice(targets.indexOf(best), 1);
          if (best.landing) { this.stats.landings = (this.stats.landings ?? 0) + 1; this.escort(ctx, best.id); }
        }
      }
      // Armies too small to attack walk to the strongest one to combine.
      const lead = ready.filter((a) => A.list.has(a.id)).sort((x, y) => y.units.length - x.units.length)[0];
      for (const a of ready) if (a !== lead && lead && A.list.has(a.id) && idle(a) && a.units.length < MIN_ATTACK_UNITS) order(a, lead.node);
    } else {
      // 6. At peace: gather field armies at a staging city facing the likeliest target.
      const stage = this.stagingCity(ctx);
      if (stage >= 0) for (const a of ready) if (a.node !== stage && Math.random() < 0.5) order(a, stage);
    }
    b.lastOrders = ctx.orders.length;
  }

  /** Candidate target provinces: enemy land next to ours, lost provinces first. */
  targets({ n, P, enemies, border, mine }) {
    const A = this.sim.armies, C = this.sim.combat;
    const prov = this.state.provinces;
    const out = [];
    const seen = new Set();
    const consider = (q) => {
      if (seen.has(q.id)) return;
      seen.add(q.id);
      const enemy = q.owner >= 0 && C.atWar(n, q.owner);
      const unclaimed = q.owner < 0 && P.expand > 0;
      if (!enemy && !unclaimed) return;
      let defense = 0;
      for (const o of A.at(q.id)) if (o.nation === q.owner || C.atWar(o.nation, n)) defense += this.armyPower(o);
      defense *= (1 + 0.25 * this.sim.buildings.level(q.id, 'fort'));
      const value = (q.isCapital ? 6 : q.isCity ? 3 : 1) * (q.homeOf === n ? 2 : 1) * (unclaimed ? 0.6 : 1);
      out.push({ id: q.id, value, defense });
    };
    for (const id of border) for (const nb of prov[id].neighbors) consider(prov[nb]);
    // Our own lost provinces anywhere, if held by an enemy.
    if (enemies.length) for (const q of prov) if (q.homeOf === n && q.owner !== n && q.owner >= 0 && C.atWar(n, q.owner)) consider(q);
    // Enemies out of reach by land (islands, other continents): plan landings on their coasts.
    const coasts = mine.filter((p) => p.seaNeighbors.length);
    if (coasts.length) {
      for (const e of enemies) {
        if (out.some((t) => prov[t.id].owner === e)) continue;
        const shores = [];
        for (const q of prov) {
          if (q.owner !== e || !q.seaNeighbors.length) continue;
          let d = Infinity;
          for (const c of coasts) d = Math.min(d, Math.hypot(c.center.x - q.center.x, c.center.y - q.center.y));
          shores.push([q, d]);
        }
        shores.sort((x, y) => x[1] - y[1]);
        for (const [q] of shores.slice(0, LANDING_SITES)) {
          const before = out.length;
          consider(q);
          if (out.length > before) out[out.length - 1].landing = true;
        }
      }
    }
    return out;
  }

  /** Send the nearest idle fleet to cover a landing at province `target`. */
  escort({ n, orders }, target) {
    const A = this.sim.armies, C = this.sim.combat;
    const sea = this.state.provinces[target].seaNeighbors[0];
    if (sea == null || orders.length >= 4) return;
    const node = A.P + sea;
    const fleets = [...A.list.values()].filter((a) => a.nation === n && a.kind === 'naval' && a.units.length && !a.seg && !a.path.length && !C.inBattle(a) && a.node !== node);
    const f = this.nearestArmy(fleets, node);
    if (f) orders.push([f.id, node]);
  }

  stagingCity({ n, cities, border }) {
    const target = this.likelyTarget(n);
    const prov = this.state.provinces;
    // A rival across the sea: gather at the port nearest to it.
    const byLand = target >= 0 && [...border].some((id) => prov[id].neighbors.some((q) => prov[q].owner === target));
    let cands = cities.filter((c) => border.has(c.id));
    if (target >= 0 && !byLand) cands = cities.filter((c) => c.seaNeighbors.length);
    if (!cands.length) return this.state.getNation(n).capitalId;
    if (target < 0) return cands[0].id;
    const tc = this.state.provinces[this.state.getNation(target).capitalId]?.center;
    if (!tc) return cands[0].id;
    return cands.reduce((best, c) => (Math.hypot(c.center.x - tc.x, c.center.y - tc.y) < Math.hypot(best.center.x - tc.x, best.center.y - tc.y) ? c : best)).id;
  }

  /** Neighbour we'd most like to fight (weakest relative to us, holding our land first). */
  likelyTarget(n) {
    const C = this.sim.combat;
    let best = -1, bs = -Infinity;
    const mine = this.powerOf(n);
    for (const o of this.neighborsOf(n)) {
      if (C.truceUntil(n, o) != null) continue;
      const ratio = mine / Math.max(1, this.powerOf(o));
      const lost = this.state.provinces.some((p) => p.homeOf === n && p.owner === o);
      const s = ratio * (lost ? 1.5 : 1);
      if (s > bs) { bs = s; best = o; }
    }
    return best;
  }

  // War and peace.
  doDiplomacy({ n, P, enemies, b, mine }) {
    const C = this.sim.combat, D = this.D;
    const me = this.powerOf(n);
    // Peace when it goes badly.
    for (const e of enemies) {
      const info = C.warInfo.get(n < e ? `${n}:${e}` : `${e}:${n}`);
      if (!info) continue;
      const lost = info.captured.filter((c) => c.from === n && this.state.provinces[c.pid].owner === e).length;
      const won = info.captured.filter((c) => c.from === e && this.state.provinces[c.pid].owner === n).length;
      const ratio = me / Math.max(1, this.powerOf(e));
      const days = (this.state.clock.time - info.start) / 864e5;
      const startSize = mine.length + lost;
      const losing = (lost >= Math.max(2, startSize * 0.15) && ratio < 1) || (ratio < 0.5 && days > 20);
      const stalemate = days > 150 && won <= lost;
      const tired = this.exhaustion(n, e) >= 1;
      if (!(losing || stalemate || tired)) continue;
      if (this.clockHours - b.lastPeaceOffer < PEACE_COOLDOWN_H) continue;
      b.lastPeaceOffer = this.clockHours;
      if (e === this.state.playerNationId) {
        this.state.events.emit('peace:offer', { from: n, to: e });
      } else if (this.acceptsPeace(e, n)) {
        // Between computer nations, the side clearly ahead keeps part of its gains.
        const lead = won - lost;
        C.makePeace(n, e, { cede: lead >= 2 ? n : lead <= -2 ? e : -1 });
      }
    }
    this.doTreaties({ n, P, b });
    this.doCoalition({ n, P });
    // New wars.
    if (enemies.length >= P.maxWars) return;
    // warChance is per month; minor nations start wars far less often.
    const major = this.state.getNation(n).major;
    // Restraint: a nation its neighbours already fear starts fewer new wars.
    const restraint = this.fearedBy(n) >= 2 ? 0.4 : 1;
    const perHour = (P.warChance * D.chance * (major ? 1 : 0.3) * restraint * (ERA_WAR_RATE[this.state.map.era?.id] ?? 1)) / 730;
    if (Math.random() > perHour * b.every) return;
    const Dp = this.sim.diplomacy;
    let best = -1, bs = 0;
    for (const o of this.neighborsOf(n)) {
      if (C.atWar(n, o)) continue;
      const op = Dp?.opinion(n, o).value ?? 0;
      // Friends are safe; pacts and truces hold, except for a furious aggressor (rarely).
      if (op >= 25 || Dp?.has(n, o, 'alliance')) continue;
      const bound = C.truceUntil(n, o) != null || Dp?.has(n, o, 'nap') || Dp?.has(n, o, 'passage');
      if (bound && !(b.personality === 'aggressive' && op < -60 && Math.random() < 0.15)) continue;
      const theirs = this.powerOf(o) + 0.5 * C.enemiesOf(o).length; // allies don't exist yet
      const ratio = me / Math.max(1, theirs);
      const lost = this.state.provinces.some((p) => p.homeOf === n && p.owner === o);
      const need = P.warRatio * D.warRatio * (lost ? 0.8 : 1);
      if (ratio < need) continue;
      // Value: their cities and capital near us; prefer smaller wars.
      const score = ratio * (lost ? 1.6 : 1) * (this.state.getNation(o).major ? 1.2 : 1) * (1 + Math.max(0, -op) / 50);
      if (score > bs) { bs = score; best = o; }
    }
    if (best >= 0 && (Dp ? Dp.declareWar(n, best) : C.declareWar(n, best))) {
      this.state.events.emit('war:declared', { a: n, b: best, ai: true });
      // Call the allies: AI allies decide at once, the player gets asked.
      for (const ally of Dp?.allies(n) ?? []) {
        if (C.atWar(ally, best)) continue;
        if (ally === this.state.playerNationId) Dp.propose(n, ally, { kind: 'join', target: best });
        else Dp.askToJoin(n, ally, best);
      }
    }
  }

  /**
   * Treaties: alliances with friends who share an enemy or a threat, pacts with
   * strong neighbours, trade offers to the player when short of something.
   * AI–AI deals are signed at once (and reported in the feed); deals with the
   * player become proposals (popups).
   */
  doTreaties({ n, b }) {
    const Dp = this.sim.diplomacy;
    if (!Dp || Math.random() > 0.35) return;
    const C = this.sim.combat, me = this.state.playerNationId;
    const pool = [...new Set([...this.neighborsOf(n), ...Dp.met(n)])].filter((o) => o !== n && !C.atWar(n, o) && this.state.provinces.some((p) => p.owner === o));
    if (!pool.length) return;
    // Court the nations it likes best (a random one of its top three).
    const ranked = pool.map((x) => [x, Dp.opinion(n, x).value]).sort((p, q) => q[1] - p[1]);
    const [o, op] = ranked[Math.floor(Math.random() * Math.min(3, ranked.length))];
    const ally = Dp.allies(n).length < 3 && op >= 30 && (Dp.sharedEnemies(n, o).length || Dp.sharedThreat(n, o));
    const ratio = this.powerOf(o) / Math.max(1, this.powerOf(n));
    let type = null;
    if (ally && !Dp.has(n, o, 'alliance')) type = 'alliance';
    else if (!Dp.has(n, o, 'nap') && !Dp.has(n, o, 'alliance') && this.neighborsOf(n).has(o) && ratio > 1.5 && op >= -5) type = 'nap';
    if (type) {
      if (o === me) Dp.propose(n, o, { kind: 'treaty', type });
      else if (Dp.accepts(o, n, type).ok) Dp.sign(n, o, type);
      return;
    }
    // Ask the player for help in a war, or offer a trade.
    if (Dp.has(n, me, 'alliance')) {
      const target = C.enemiesOf(n).find((e) => !C.atWar(me, e) && !Dp.has(me, e, 'alliance'));
      if (target != null) { Dp.propose(n, me, { kind: 'join', target }); return; }
    }
    if (Dp.met(n).has(me) && Dp.opinion(n, me).value >= 0) {
      const offer = Dp.tradeIdea(n, me);
      if (offer) Dp.propose(n, me, { kind: 'trade', ...offer });
    }
    // Ditch an ally it has come to dislike.
    for (const a of Dp.allies(n)) if (Dp.opinion(n, a).value < -10 && Math.random() < 0.3) { Dp.cancel(n, a, 'alliance'); break; }
  }

  /** Would AI nation `n` accept a white peace from `other`? */
  /**
   * War exhaustion of nation n in its war with `other`: a year of war is 1,
   * and losing the army you had is 1.5 more. At 1 a nation wants peace; at
   * 0.8 it accepts one even while winning. Quick victories cost little, long
   * grinding wars end.
   */
  exhaustion(n, other) {
    const C = this.sim.combat;
    const info = C.warInfo.get(n < other ? `${n}:${other}` : `${other}:${n}`);
    if (!info) return 0;
    const days = (this.state.clock.time - info.start) / 864e5;
    const lost = info.unitsLost?.[n] ?? 0;
    let units = 0;
    for (const a of this.sim.armies.list.values()) if (a.nation === n) units += a.units.length;
    return days / 365 + 1.5 * lost / Math.max(1, lost + units);
  }

  /**
   * Coalitions: a nation that fears a bigger neighbour (opinion -20 or
   * worse, mostly from "Dangerous expansion") joins a war that neighbour is
   * already fighting, on the victim's side, when together they stand a chance.
   */
  doCoalition({ n, P }) {
    const Dp = this.sim.diplomacy, C = this.sim.combat;
    if (!Dp || C.enemiesOf(n).length >= P.maxWars + 1 || Math.random() > 0.5) return;
    const sizes = this.sizes();
    const total = this.state.provinces.length;
    for (const m of this.neighborsOf(n)) {
      if (C.atWar(n, m) || Dp.has(n, m, 'alliance') || Dp.has(n, m, 'nap') || C.truceUntil(n, m) != null) continue;
      if ((sizes.get(m) ?? 0) < Math.max(COALITION_SHARE * total, 1.25 * (sizes.get(n) ?? 0))) continue;
      const victims = C.enemiesOf(m).filter((v) => v !== n && !Dp.has(n, v, 'nap') && !C.atWar(n, v));
      // Feared, or about to swallow a neighbour whole (a victim down to half its homeland).
      const dying = victims.some((v) => this.homeLost(v) >= 0.5);
      if (Dp.opinion(n, m).value > (dying ? 0 : -20)) continue;
      if (!victims.length) continue;
      const odds = (this.powerOf(n) + victims.reduce((t, v) => t + this.powerOf(v), 0)) / Math.max(1, this.powerOf(m));
      if (odds < 0.7) continue;
      const victim = victims.sort((a, b) => (sizes.get(b) ?? 0) - (sizes.get(a) ?? 0))[0];
      if (Dp.joinWar(n, m, victim, 'coalition')) { this.stats.coalitions = (this.stats.coalitions ?? 0) + 1; return; }
    }
  }

  /** Share of nation n's home provinces held by others. */
  homeLost(n) {
    let home = 0, lost = 0;
    for (const p of this.state.provinces) if (p.homeOf === n) { home++; if (p.owner !== n) lost++; }
    return home ? lost / home : 0;
  }

  /** How many neighbours fear nation n (their opinion of it is -20 or worse). */
  fearedBy(n) {
    const Dp = this.sim.diplomacy;
    if (!Dp) return 0;
    let k = 0;
    for (const o of this.neighborsOf(n)) if (Dp.opinion(o, n).value <= -20) k++;
    return k;
  }

  /** Provinces per nation (recounted with the strength table, every 6 game hours). */
  sizes() {
    if (this.sizeAt === this.strengthAt && this.sizeCache) return this.sizeCache;
    const s = new Map();
    for (const p of this.state.provinces) if (p.owner >= 0) s.set(p.owner, (s.get(p.owner) ?? 0) + 1);
    this.sizeAt = this.strengthAt;
    this.sizeCache = s;
    return s;
  }

  acceptsPeace(n, other) {
    const C = this.sim.combat;
    const info = C.warInfo.get(n < other ? `${n}:${other}` : `${other}:${n}`);
    if (!info) return true;
    if (this.exhaustion(n, other) >= 0.8) return true; // tired of it, even when winning
    // The region turning against it: settle before a coalition forms.
    if (this.fearedBy(n) >= 2 && (this.state.clock.time - info.start) / 864e5 > 45) return true;
    // Holding as much as a peace would let it keep: take the terms.
    const keepable = Math.max(2, Math.floor(this.state.provinces.filter((p) => p.homeOf === other).length / 4));
    if (other !== this.state.playerNationId && info.captured.filter((c) => c.from === other && c.to === n && this.state.provinces[c.pid].owner === n).length >= keepable) return true;
    const won = info.captured.filter((c) => c.from === other && this.state.provinces[c.pid].owner === n).length;
    const lost = info.captured.filter((c) => c.from === n && this.state.provinces[c.pid].owner === other).length;
    const ratio = this.powerOf(n) / Math.max(1, this.powerOf(other));
    const days = (this.state.clock.time - info.start) / 864e5;
    if (this.difficulty === 'easy' && won < 3) return true;
    if (won >= 2 && ratio >= 1.2) return false; // winning: keep going
    if (ratio >= 2 && days < 60) return false;
    return lost >= won || ratio < 1.5 || days > 180;
  }

  // --- Helpers --------------------------------------------------------------------------

  nearest(army, nodes) {
    const A = this.sim.armies;
    const p = A.pos[army.node];
    let best = -1, bd = Infinity;
    for (const id of nodes) {
      const q = A.pos[id];
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  nearestArmy(armies, node) {
    const A = this.sim.armies;
    const q = A.pos[node];
    let best = null, bd = Infinity;
    for (const a of armies) {
      if (!A.list.has(a.id)) continue;
      const p = A.pos[a.node];
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
}
