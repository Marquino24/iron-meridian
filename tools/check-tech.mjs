// Era tech trees (step 10): every tree is whole and different, every era
// signature effect does what it says, computer nations research by
// personality, and research from old saves moves onto the new trees.
//   node tools/check-tech.mjs
import { readFileSync } from 'node:fs';
import { GameState } from '../js/state.js';
import { buildWorldMap } from '../js/world.js';
import { getEra, ERAS } from '../js/eras.js';
import { Economy } from '../js/economy.js';
import { Armies } from '../js/armies.js';
import { Combat } from '../js/combat.js';
import { Buildings } from '../js/buildings.js';
import { Research } from '../js/research.js';
import { AI, PERSONALITIES } from '../js/ai.js';
import { Diplomacy } from '../js/diplomacy.js';
import { Integration } from '../js/integration.js';
import { techTree, legacyMap, SIGNATURES, TOTAL_HOURS, BRANCHES } from '../js/tech.js';
import { resourceSet } from '../js/resources.js';

let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };
const random = Math.random;

function setup(eraId) {
  const era = getEra(eraId);
  const state = new GameState();
  const economy = new Economy(state);
  const buildings = new Buildings(state, economy);
  const armies = new Armies(state, economy);
  armies.buildings = buildings;
  const combat = new Combat(state, armies);
  const research = new Research(state, economy);
  research.armies = armies; research.buildings = buildings;
  armies.research = research; buildings.research = research;
  const sim = { economy, buildings, armies, combat, research };
  const ai = new AI(state, sim);
  sim.ai = ai;
  sim.diplomacy = new Diplomacy(state, sim);
  armies.diplomacy = sim.diplomacy;
  sim.integration = new Integration(state, sim);
  state.loadMap(buildWorldMap(JSON.parse(readFileSync(new URL(`../data/eras/${era.id}.json`, import.meta.url))), era));
  state.playerNationId = -1;
  buildings.start(); economy.start(); armies.spawnInitial(-1); ai.start(-1, 'normal');
  state.setPhase('playing');
  return { state, sim, ...sim };
}

// --- 1. The trees -------------------------------------------------------------------
console.log('1. Trees');
const shapes = new Set();
const sigByEra = {};
for (const era of ERAS) {
  const keys = resourceSet(era.id).keys;
  const tree = techTree(era.id, keys);
  const by = Object.fromEntries(tree.map((t) => [t.id, t]));
  const hours = tree.reduce((h, t) => h + t.hours, 0);
  const sigs = tree.filter((t) => t.signature);
  sigByEra[era.id] = new Set(sigs.flatMap((t) => t.effects.flatMap((e) => Object.keys(e).filter((k) => k in SIGNATURES))));
  const shape = BRANCHES.map((b) => { const ts = tree.filter((t) => t.branch === b.id); return `${b.id}${ts.length}/${Math.max(...ts.map((t) => t.tier))}`; }).join(' ');
  shapes.add(shape);
  const core = ['inf', 'mob', 'rng', 'nav'].every((r) => [2, 3].every((l) => tree.some((t) => t.effects.some((e) => e.unit === r && e.level === l))))
    && ['barracks', 'fort', 'farm', 'mine', 'port', 'roads', ...(keys.includes('oil') ? ['oilwell'] : [])].every((b) => tree.some((t) => t.effects.some((e) => e.building === b)));
  const reqOk = tree.every((t) => t.req.every((q) => by[q] && by[q].tier < t.tier));
  const integ = tree.some((t) => t.effects.some((e) => e.integration));
  check(sigs.length >= 3 && sigs.length <= 5 && core && reqOk && integ && Math.abs(hours - TOTAL_HOURS) <= 10,
    `${era.id.padEnd(9)} ${tree.length} techs · ${shape} · ${hours} h · signatures: ${sigs.map((t) => t.name).join(', ')}`);
}
check(shapes.size >= 6, `${shapes.size} different tree shapes across ${ERAS.length} eras`);
const historical = ERAS.filter((e) => !e.fictional).map((e) => e.id);
const shared = historical.flatMap((a) => historical.filter((b) => a < b).flatMap((b) => [...sigByEra[a]].filter((k) => sigByEra[b].has(k)).map((k) => `${k} (${a}/${b})`)));
check(!shared.length, `signature effects unique to their era${shared.length ? `: shared ${shared.join(', ')}` : ''}`);

// --- 2. Signature effects --------------------------------------------------------------
console.log('2. Signature effects (WWII map, Germany vs Poland)');
const g = setup('ww2');
const { state, armies: A, combat: C, research: R, economy: E, buildings: Bd, ai, integration: I } = g;
const id = (name) => state.nations.find((n) => n.name === name).id;
const DE = id('German Reich'), PL = id('Poland');
let k = 0;
const give = (n, fx) => { const tid = `test${k++}`; R.byId[tid] = { id: tid, name: tid, tier: 1, req: [], effects: [fx] }; R.grant(n, tid); E.totalsCache.clear(); };
const clear = (...ns) => { for (const n of ns) R.nations.delete(n); E.totalsCache.clear(); };
g.sim.diplomacy.declareWar(DE, PL);

// Movement.
const de = (p) => p.owner === DE;
const pair = (f) => { for (const p of state.provinces) for (const q of p.neighbors) if (f(p, state.provinces[q])) return [p.id, q]; return null; };
const army = A.create(DE, 'land', state.getNation(DE).capitalId, A.makeUnits({ inf: 2 }));
const hop = (a, b) => A.hopHours(army, a, b);
{
  const [a, b] = pair((p, q) => de(p) && de(q) && p.terrain === q.terrain && A.distKm(p.id, q.id) > 50);
  Bd.setLevel(b, 'roads', 1);
  const h0 = hop(a, b); give(DE, { roadSpeed: 40 }); const h1 = hop(a, b); clear(DE);
  check(Math.abs(h0 / h1 - 1.4) < 0.01, `Viae Militares (roadSpeed 40): ${h0.toFixed(1)} h → ${h1.toFixed(1)} h on a road`);
  Bd.setLevel(b, 'roads', 0);
  const r0 = hop(a, b); give(DE, { railMob: 30 }); const r1 = hop(a, b); clear(DE);
  check(Math.abs(r0 / r1 - 1.3) < 0.01, `Strategic Railways (railMob 30): ${r0.toFixed(1)} h → ${r1.toFixed(1)} h at home`);
}
{
  const rough = pair((p, q) => de(p) && de(q) && ['mountains', 'forest', 'hills', 'marsh', 'jungle'].includes(q.terrain));
  const a0 = hop(...rough); give(DE, { airmobile: 50 }); const a1 = hop(...rough); clear(DE);
  check(a1 < a0 * 0.95, `Air assault (airmobile 50): ${state.provinces[rough[1]].terrain} hop ${a0.toFixed(1)} h → ${a1.toFixed(1)} h`);
}
{
  const into = pair((p, q) => de(p) && q.owner === PL);
  const b0 = hop(...into); give(DE, { blitz: 35 }); const b1 = hop(...into); clear(DE);
  check(Math.abs(b0 / b1 - 1.35) < 0.01, `Blitzkrieg (blitz 35) into Poland: ${b0.toFixed(1)} h → ${b1.toFixed(1)} h`);
  give(PL, { interdict: 40 }); const i1 = hop(...into); clear(PL);
  check(Math.abs(i1 / b0 - 1.4) < 0.01, `Air interdiction (interdict 40) by Poland: ${b0.toFixed(1)} h → ${i1.toFixed(1)} h`);
}
// Healing.
{
  const p = state.provinces.find((x) => de(x) && !x.isCity);
  A.setNode(army, p.id);
  const heal = () => { for (const u of army.units) u.hp = A.unitType(u).hp / 2; A.heal(10); return army.units[0].hp - A.unitType(army.units[0]).hp / 2; };
  const h0 = heal(); give(DE, { heal: 100 }); const h1 = heal(); clear(DE);
  check(Math.abs(h1 / h0 - 2) < 0.01, `Valetudinaria (heal 100): ${h0.toFixed(1)} → ${h1.toFixed(1)} HP in 10 h`);
}
// Occupation.
{
  const land = state.provinces.find((p) => p.owner === PL && !p.isCity);
  const city = state.provinces.find((p) => p.owner === PL && p.isCity && !p.isCapital) ?? { ...land, isCity: true };
  const o0 = C.occupyMult(DE, city);
  give(DE, { siege: 40 }); const o1 = C.occupyMult(DE, city), o2 = C.occupyMult(DE, land); clear(DE);
  check(Math.abs(o1 - 0.6) < 1e-9 && o2 === 1 && o0 === 1, `Siege Engines (siege 40): city ×${o1}, open land ×${o2}`);
  give(DE, { blitz: 35 }); const o3 = C.occupyMult(DE, land); clear(DE);
  give(PL, { drones: 50 }); const o4 = C.occupyMult(DE, land); clear(PL);
  check(Math.abs(o3 - 1 / 1.35) < 1e-9 && Math.abs(o4 - 1.5) < 1e-9, `Blitzkrieg occupation ×${o3.toFixed(2)}, Polish drones ×${o4}`);
}
// Levies.
{
  const home = state.provinces.filter((p) => p.homeOf === PL);
  const take = home.filter((p) => !p.isCapital).slice(0, Math.ceil(home.length * 0.12));
  for (const p of take) state.setOwner(p.id, DE);
  const units = () => [...A.list.values()].filter((a) => a.nation === PL).reduce((t, a) => t + a.units.length, 0);
  let u0 = units(); C.raiseLevies(); const plain = units() - u0;
  give(PL, { levies: 50 }); u0 = units(); C.raiseLevies(); const feudal = units() - u0; clear(PL);
  check(plain === 0 && feudal === 2, `Feudal Levy (levies 50) at ${Math.round(100 * take.length / home.length)}% lost: ${plain} units without, ${feudal} with`);
  for (const p of take) state.setOwner(p.id, PL);
}
// Integration: precision strikes, Pax Romana.
{
  const p = state.provinces.find((x) => x.owner === PL && !x.isCapital && x.neighbors.some((q) => de(state.provinces[q])));
  state.setOwner(p.id, DE); const i0 = p.integ;
  state.setOwner(p.id, PL); give(DE, { precision: 15 }); state.setOwner(p.id, DE); const i1 = p.integ; clear(DE);
  check(Math.abs(i0 - 0.45) < 1e-9 && Math.abs(i1 - 0.6) < 1e-9, `Precision strikes (precision 15): conquered land starts at ${Math.round(i1 * 100)}% (not ${Math.round(i0 * 100)}%)`);
  p.integ = 0.5;
  const r0 = I.restless(p); give(DE, { noRevolt: true }); const r1 = I.restless(p); clear(DE);
  const s0 = I.rate(p); give(DE, { integration: 50 }); const s1 = I.rate(p); clear(DE);
  check(r0 && !r1 && Math.abs(s1 / s0 - 1.5) < 1e-9, 'Pax Romana: no revolts, integration +50%');
  state.setOwner(p.id, PL);
}
// Economy and war: cyber warfare, zeal, deterrence, research speed.
{
  const m0 = E.income(PL).perDay.money; give(DE, { cyber: 20 }); const m1 = E.income(PL).perDay.money; clear(DE);
  check(Math.abs(m1 / m0 - 0.8) < 0.01, `Cyber warfare (cyber 20): Polish money ${Math.round(m0)} → ${Math.round(m1)}/day`);
  state.clock.time += 200 * 864e5;
  const x0 = ai.exhaustion(DE, PL); give(DE, { zeal: 40 }); const x1 = ai.exhaustion(DE, PL); clear(DE);
  check(Math.abs(x1 / x0 - 0.6) < 0.01, `Crusading Zeal (zeal 40): exhaustion ${x0.toFixed(2)} → ${x1.toFixed(2)}`);
  // Deterrence, in a world at peace (the war above drew in Poland's allies).
  {
    const h = setup('ww2'), ai2 = h.ai, C2 = h.combat;
    ai2.refreshStrength();
    const b = ai2.brains.get(DE), P = PERSONALITIES[b.personality];
    const nbs = [...ai2.neighborsOf(DE)];
    const give2 = (n, fx) => { const tid = `test${k++}`; h.research.byId[tid] = { id: tid, name: tid, tier: 1, req: [], effects: [fx] }; h.research.grant(n, tid); };
    // Whom Germany would attack with overwhelming power; then just enough power to take on that one.
    const target = ai2.warTarget(DE, P, b, 1e9);
    const power = target < 0 ? 0 : 1.2 * (ai2.powerOf(target) + 0.5 * C2.enemiesOf(target).length) * P.warRatio * ai2.D.warRatio;
    const t0 = ai2.warTarget(DE, P, b, power);
    for (const o of nbs) give2(o, { deterrence: 60 });
    const t1 = ai2.warTarget(DE, P, b, power);
    check(t0 >= 0 && t1 < 0, `Deterrent (deterrence 60): Germany would attack ${t0 >= 0 ? h.state.getNation(t0).shortName : 'nobody'} without it, ${t1 >= 0 ? h.state.getNation(t1).shortName : 'nobody'} with it`);
    give2(DE, { deterrence: 60 });
    const t2 = ai2.warTarget(DE, P, b, power);
    check(t2 >= 0, `…but a nation with its own deterrent isn't deterred (Germany would attack ${t2 >= 0 ? h.state.getNation(t2).shortName : 'nobody'})`);
  }
  const t = R.tree.find((x) => x.tier === 1);
  const run = () => { const r = R.of(DE); r.active = [{ id: t.id, done: 0, total: t.hours }]; R.update(state, 10); const d = r.active[0]?.done; r.active = []; return d; };
  const d0 = run(); give(DE, { researchSpeed: 20 }); const d1 = run(); clear(DE);
  check(Math.abs(d1 / d0 - 1.2) < 1e-9, `AI Research (researchSpeed 20): ${d0} → ${d1} hours of progress in 10 h`);
}
// Battles: one round with fixed dice, damage done to each side.
{
  const p = state.provinces.find((x) => x.owner === PL && x.terrain === 'plains' && !x.isCity) ?? state.provinces.find((x) => x.owner === PL && !x.isCity);
  const sea = A.P + state.map.seaZones.findIndex(Boolean);
  const fight = ({ node = p.id, atk = { inf: 3 }, def = { inf: 3 }, hours = 0, landing = false } = {}) => {
    const a = A.create(DE, 'land', node, A.makeUnits(atk));
    const d = A.create(PL, 'land', node, A.makeUnits(def));
    if (landing) a.prev = sea;
    const hp = (x) => x.units.reduce((t, u) => t + u.hp, 0);
    const ha = hp(a), hd = hp(d);
    const b = { id: -1, node, sea: A.isSea(node), place: 'test', terrain: A.isSea(node) ? null : p.terrain, hours, acc: 0, done: false, sides: [{ nation: DE, armies: new Set([a]), lost: {}, retreated: 0 }, { nation: PL, armies: new Set([d]), lost: {}, retreated: 0 }] };
    Math.random = () => 0.5;
    C.round(b);
    Math.random = random;
    const out = { toDef: hd - hp(d), toAtk: ha - hp(a) };
    A.remove(a); A.remove(d);
    return out;
  };
  const pct = (a, b) => `${a.toFixed(1)} → ${b.toFixed(1)}`;
  Bd.setLevel(p.id, 'fort', 2);
  let f0 = fight().toDef; give(PL, { fortStrength: 50 }); let f1 = fight().toDef; clear(PL);
  check(f1 < f0 * 0.97, `Concentric Castles (fortStrength 50) behind a level II fort: damage to defender ${pct(f0, f1)}`);
  give(DE, { gas: 40 }); const f2 = fight().toDef; clear(DE);
  check(f2 > f0 * 1.03, `Chemical Warfare (gas 40) against it: damage to defender ${pct(f0, f2)}`);
  Bd.setLevel(p.id, 'fort', 0);
  f0 = fight().toDef; give(PL, { entrench: 25 }); f1 = fight().toDef; clear(PL);
  check(Math.abs(f0 / f1 - 1.25) < 0.01, `Trench Systems (entrench 25) on Polish ground: damage to defender ${pct(f0, f1)}`);
  give(DE, { entrench: 25 }); const f3 = fight().toDef; clear(DE);
  check(Math.abs(f3 - f0) < 1e-9, '…and no bonus to the attacker on foreign ground');
  give(DE, { recon: 25 }); const r0 = fight().toDef, r1 = fight({ hours: 30 }).toDef; clear(DE);
  check(Math.abs(r0 / f0 - 1.25) < 0.01 && Math.abs(r1 - f0) < 1e-9, `Aerial Reconnaissance (recon 25): first-day damage ${pct(f0, r0)}, later ${r1.toFixed(1)}`);
  const l0 = fight({ landing: true }).toDef; give(PL, { radar: 50 }); const l1 = fight({ landing: true }).toDef; clear(PL);
  check(Math.abs(l1 / l0 - 0.5) < 0.01, `Radar (radar 50): a landing hits ${pct(l0, l1)}`);
  const c0 = fight({ node: sea }).toDef; give(PL, { carriers: 50 }); const c1 = fight({ node: sea }).toDef; clear(PL);
  check(Math.abs(c0 / c1 - 1.5) < 0.01, `Fleet Carriers (carriers 50): Polish troops at sea take ${pct(c0, c1)}`);
  const t0 = fight({ atk: { rng: 3 } }).toDef; give(PL, { testudo: 30 }); const t1 = fight({ atk: { rng: 3 } }).toDef; clear(PL);
  check(Math.abs(t1 / t0 - 0.7) < 0.01, `Testudo (testudo 30): archers/artillery hit infantry ${pct(t0, t1)}`);
}

// --- 3. Computer research by personality ------------------------------------------------------
console.log('3. AI research order by personality (rank of each signature among the techs researched)');
for (const eraId of ['medieval', 'ww2']) {
  const h = setup(eraId);
  const n = h.state.nations.findIndex((x) => x.major);
  const b = h.ai.brains.get(n);
  const ranks = {};
  for (const pers of ['aggressive', 'defensive', 'expansionist']) {
    h.research.nations.delete(n);
    b.personality = pers;
    const order = [];
    for (let i = 0; i < 40 && order.length < h.research.tree.length; i++) {
      h.ai.doResearch({ n, P: PERSONALITIES[pers], b });
      const r = h.research.of(n);
      const ids = [...r.active.map((a) => a.id), ...r.queue];
      if (!ids.length) break;
      for (const t of ids) { h.research.grant(n, t); order.push(t); }
    }
    const sig = h.research.tree.filter((t) => t.signature);
    ranks[pers] = Object.fromEntries(sig.map((t) => [t.ai, Math.min(ranks[pers]?.[t.ai] ?? 99, order.indexOf(t.id) + 1)]));
    console.log(`     ${eraId.padEnd(8)} ${pers.padEnd(12)} ${sig.map((t) => `${t.name} #${order.indexOf(t.id) + 1}`).join(', ')}`);
  }
  check(ranks.aggressive.attack < ranks.defensive.attack && ranks.defensive.defend < ranks.aggressive.defend,
    `${eraId}: aggressive nations reach attack signatures sooner, defensive ones defend signatures sooner`);
  if (ranks.expansionist.hold) check(ranks.expansionist.hold <= ranks.defensive.hold, `${eraId}: expansionists reach integration signatures no later than defensive nations`);
}

// --- 4. Old saves: research moves onto the new trees ---------------------------------------
console.log('4. Migration of pre-step-10 research');
for (const eraId of ['ww2', 'ww1', 'rome']) {
  const h = setup(eraId);
  const n = h.state.nations.findIndex((x) => x.major);
  const R2 = h.research, map = legacyMap(eraId, R2.tree);
  const old = ['m1', 'm2', 'm4', 'm6', 'e2', 'e4', 'e7', 'i1', 'i2', 'i7', 'i9'];
  R2.nations.set(n, { done: new Set(old), active: [{ id: 'm5', done: 100, total: 540 }], queue: ['m8', 'e5'], fx: null });
  const m0 = h.economy.get(n).money;
  const res = R2.migrate();
  const r = R2.of(n);
  const mapped = old.filter((o) => map[o]);
  const whole = [...r.done].every((t) => R2.byId[t] && R2.byId[t].req.every((q) => r.done.has(q)));
  const refunds = old.filter((o) => !map[o]).length + 1; // + the tech that was in progress
  check(mapped.every((o) => r.done.has(map[o])) && whole && !r.active.length && !r.queue.length && res.refunded === refunds && h.economy.get(n).money > m0,
    `${eraId}: ${res.mapped} of ${old.length} old techs carried over (${r.done.size} researched with prerequisites), ${res.refunded} refunded (+${Math.round(h.economy.get(n).money - m0)} money), ${res.dropped} queued dropped`);
}

console.log(failures ? `${failures} failure(s)` : 'all tech checks passed');
process.exit(failures ? 1 : 0);
