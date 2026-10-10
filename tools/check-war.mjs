// Headless checks of the step 3 simulation (economy, armies, war, combat).
//
//   node tools/check-war.mjs            → assertions + timings
//   node tools/check-war.mjs --verbose  → also prints each capture/battle
//
// Scenarios:
//   1. WWII: the German Reich conquers Czechoslovakia with its starting field
//      armies (a simple "attack the nearest enemy province" commander).
//   2. WWII: Italy lands in Albania across the Adriatic (embark/disembark).
//   3. Peace rules, recruitment timing and costs, split/merge, capital loss.
//   4. Every era and the fictional map spawn armies and can path.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameState } from '../js/state.js';
import { buildWorldMap } from '../js/world.js';
import { generateMap } from '../js/map.js';
import { ERAS, getEra } from '../js/eras.js';
import { Economy } from '../js/economy.js';
import { Armies } from '../js/armies.js';
import { Combat } from '../js/combat.js';
import { Buildings } from '../js/buildings.js';
import { ROSTERS } from '../js/units.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.error(`  ✗ ${msg}`); } else if (verbose) console.log(`  ✓ ${msg}`); };

function setup(eraId, playerName) {
  const state = new GameState();
  const economy = new Economy(state);
  const buildings = new Buildings(state, economy);
  const armies = new Armies(state, economy);
  armies.buildings = buildings;
  const combat = new Combat(state, armies);
  const era = getEra(eraId);
  const map = era.fictional ? Object.assign(generateMap('TEST-1234'), { era }) : buildWorldMap(JSON.parse(readFileSync(join(root, 'data/eras', `${eraId}.json`), 'utf8')), era);
  state.loadMap(map);
  const player = playerName == null ? map.nations.find((n) => n.major).id : map.nations.findIndex((n) => n.name === playerName);
  state.setPlayerNation(player);
  buildings.start();
  economy.start();
  armies.spawnInitial(player);
  state.setPhase('playing');
  const log = [];
  state.events.on('feed', (e) => { log.push(e); if (verbose) console.log(`    [${fmtT(state)}] ${e.text}`); });
  const step = (hours, dt = 0.25) => {
    for (let t = 0; t < hours; t += dt) {
      state.clock.time += dt * 3600e3;
      economy.update(state, dt);
      buildings.update(state, dt);
      armies.update(state, dt);
      combat.update(state, dt);
    }
  };
  return { state, economy, buildings, armies, combat, map, player, step, log };
}
const fmtT = (state) => `${((state.clock.time - state.clock.start) / 36e5).toFixed(1)}h`;

/** Every idle field army heads for the nearest enemy province it can reach. */
function commander(g, enemy) {
  const { armies, state, player } = g;
  for (const a of armies.list.values()) {
    if (a.nation !== player || a.garrison || a.kind !== 'land' || a.seg || a.path.length || g.combat.inBattle(a)) continue;
    if (g.combat.holds(a)) continue;
    let best = null;
    for (const p of state.provinces) {
      if (p.owner !== enemy) continue;
      const r = armies.findPath(a, p.id);
      if (r.error) continue;
      if (!best || r.hours < best.hours) best = { id: p.id, hours: r.hours };
    }
    if (best) armies.order(a.id, best.id);
  }
}

function conquer(g, enemyName, limitHours = 24 * 60) {
  const enemy = g.map.nations.findIndex((n) => n.name === enemyName);
  g.combat.declareWar(g.player, enemy);
  const start = g.state.clock.time;
  const startProvs = g.state.provincesOf(enemy).length;
  const ownForces = () => [...g.armies.list.values()].filter((a) => a.nation === g.player && a.kind === 'land').reduce((n, a) => n + a.units.length, 0);
  const before = ownForces();
  while (g.state.provincesOf(enemy).length && (g.state.clock.time - start) / 36e5 < limitHours) {
    commander(g, enemy);
    g.step(1);
  }
  const hours = (g.state.clock.time - start) / 36e5;
  const battles = [...g.combat.battles.values()];
  return { enemy, startProvs, hours, done: !g.state.provincesOf(enemy).length, battles, lost: before - ownForces() };
}

// --- 1. Germany vs Czechoslovakia ---------------------------------------------------
{
  console.log('1. WWII: German Reich vs Czechoslovakia');
  const g = setup('ww2', 'German Reich');
  const fields = [...g.armies.list.values()].filter((a) => a.nation === g.player && !a.garrison && a.kind === 'land');
  console.log(`   German field armies: ${fields.length} (${fields.map((a) => a.units.length).join(', ')} units); Czech armies: ${[...g.armies.list.values()].filter((a) => g.map.nations[a.nation].name === 'Czechoslovakia').map((a) => `${a.name} ${a.units.length}`).join(', ')}`);
  // Peace: no entry.
  const prague = g.map.nations.find((n) => n.name === 'Czechoslovakia').capitalId;
  check(!!g.armies.findPath(fields[0], prague).error, 'cannot path into Czechoslovakia at peace');
  const r = conquer(g, 'Czechoslovakia');
  check(r.done, `Czechoslovakia conquered (${r.startProvs} provinces)`);
  console.log(`   conquered ${r.startProvs} provinces in ${r.hours.toFixed(0)} game hours = ${(r.hours / 24).toFixed(1)} days`
    + ` = ${(r.hours / 60).toFixed(1)} real minutes at 1× (${(r.hours / 240).toFixed(1)} at 4×); ${r.battles.length} battles, German units lost: ${r.lost}`);
  for (const b of r.battles) {
    const tot = (o) => Object.values(o).reduce((x, y) => x + y, 0);
    console.log(`     Battle of ${b.place}: ${b.hours.toFixed(0)}h, ${b.terrain}, winner ${b.winner === 0 ? 'attacker' : 'defender'}, fielded ${tot(b.sides[0].initial)} v ${tot(b.sides[1].initial)}, lost ${tot(b.sides[0].lost)} v ${tot(b.sides[1].lost)}`);
  }
  check(g.log.some((e) => e.kind === 'annexed'), 'annexation reported in the feed');
  check(g.economy.capitalLost(r.enemy) === true || !g.state.provincesOf(r.enemy).length, 'capital lost flagged');
  check(!g.combat.atWar(g.player, r.enemy), 'war ends when the nation is gone');
}

// --- 2. Italy lands in Albania -------------------------------------------------------
{
  console.log('2. WWII: Kingdom of Italy vs Albania (by sea)');
  const g = setup('ww2', 'Kingdom of Italy');
  const albania = g.map.nations.findIndex((n) => n.name === 'Albania');
  g.combat.declareWar(g.player, albania);
  const army = [...g.armies.list.values()].find((a) => a.nation === g.player && !a.garrison && a.kind === 'land');
  const tirana = g.map.nations[albania].capitalId;
  const route = g.armies.findPath(army, tirana);
  check(!route.error, `route to Tirana: ${route.error ?? 'ok'}`);
  const seaHops = route.path?.filter((n) => g.armies.isSea(n)).length ?? 0;
  console.log(`   route: ${route.path?.length} hops, ${seaHops} at sea, ETA ${route.hours?.toFixed(0)}h`);
  check(seaHops > 0, 'route crosses the sea');
  const r = conquer(g, 'Albania');
  check(r.done, 'Albania conquered');
  console.log(`   conquered ${r.startProvs} provinces in ${r.hours.toFixed(0)}h (${(r.hours / 24).toFixed(1)} days)`);
}

// --- 3. Rules -----------------------------------------------------------------------
{
  console.log('3. Economy, recruitment, split/merge, capital loss');
  const g = setup('ww2', 'German Reich');
  const { economy, armies, state, player } = g;
  const inc = economy.income(player);
  const fmt = (o) => economy.keys.map((k) => `${k} ${Math.round(o[k])}`).join(', ');
  console.log(`   Germany: ${inc.land} provinces + ${inc.cities} cities + ${inc.capitals} capital\n     per day: ${fmt(inc.perDay)}\n     start:   ${fmt(economy.get(player))}`);
  check(economy.keys.join() === 'money,food,steel,oil,manpower', 'WWII resource set');
  const berlin = state.getNation(player).capitalId;
  const money0 = economy.get(player).money;
  check(armies.recruit(berlin, 'infantry').ok, 'recruit infantry in Berlin');
  check(Math.abs(money0 - economy.get(player).money - ROSTERS.ww2.byKey.infantry.cost.money) < 1e-6, 'cost paid up front');
  const before = [...armies.at(berlin)].reduce((n, a) => n + a.units.length, 0);
  const hrs = armies.recruitCheck(berlin, 'infantry', { ignoreCost: true }).hours;
  check(hrs === Math.round(24 * 0.85), `Barracks II trains 15% faster (${hrs}h instead of 24h)`);
  g.step(hrs - 0.5);
  check([...armies.at(berlin)].reduce((n, a) => n + a.units.length, 0) === before, `not ready before ${hrs}h`);
  g.step(1);
  check([...armies.at(berlin)].reduce((n, a) => n + a.units.length, 0) === before + 1, `infantry ready after ${hrs}h`);
  const notCity = state.provincesOf(player).find((p) => !p.isCity);
  check(!armies.canRecruit(notCity.id, 'infantry'), 'no recruiting outside cities');
  const inland = state.provincesOf(player).find((p) => p.isCity && !p.seaNeighbors.length);
  if (inland) check(!armies.canRecruit(inland.id, 'destroyer'), 'no ships from an inland city');
  // Split / merge.
  const field = [...armies.list.values()].find((a) => a.nation === player && !a.garrison && a.kind === 'land');
  const n0 = field.units.length;
  const half = armies.splitHalf(field.id);
  check(half && half.units.length + field.units.length === n0, 'split in half keeps every unit');
  check(armies.merge(field.id, half.id) && field.units.length === n0 && !armies.list.has(half.id), 'merge back');
  // Capital loss halves income.
  const france = state.nations.findIndex((n) => n.name === 'France');
  const fi = economy.income(france).perDay.money;
  state.setOwner(state.getNation(france).capitalId, player);
  check(Math.abs(economy.income(france).factor - 0.5) < 1e-9 && economy.income(france).perDay.money < fi, 'capital lost → production −50%');
  // Buildings: barracks gate units, construction takes time, yields and roads apply.
  const B = g.buildings;
  check(B.level(berlin, 'barracks') === 2, 'Berlin starts with Barracks II');
  check(!armies.recruitCheck(berlin, 'tank', { ignoreCost: true }).ok && /Barracks III/.test(armies.recruitCheck(berlin, 'tank', { ignoreCost: true }).reason), 'tanks need Barracks III');
  check(armies.recruitCheck(berlin, 'artillery', { ignoreCost: true }).ok, 'artillery with Barracks II');
  const steel0 = economy.income(player).perDay.steel;
  check(B.build(berlin, 'mine').ok, 'start Factory II in Berlin');
  check(!!B.build(berlin, 'farm').error, 'one construction per city');
  g.step(B.hoursOf('mine', 2) + 1);
  check(B.level(berlin, 'mine') === 2 && economy.income(player).perDay.steel > steel0, `Factory II done, steel/day ${Math.round(steel0)} → ${Math.round(economy.income(player).perDay.steel)}`);
  check(!!B.check(berlin, 'oilwell').reason, `no oil well in Berlin: ${B.check(berlin, 'oilwell').reason}`);
  const noCoast = state.provincesOf(player).find((p) => p.isCity && !p.seaNeighbors.length);
  if (noCoast) check(B.check(noCoast.id, 'port').reason === 'Not coastal', 'no port inland');
  const field2 = [...armies.list.values()].find((a) => a.nation === player && !a.garrison && a.kind === 'land');
  const nb = state.getProvince(berlin).neighbors.find((n) => state.provinces[n].owner === player);
  const h0 = armies.hopHours(field2, berlin, nb);
  B.setLevel(berlin, 'roads', 3); B.setLevel(nb, 'roads', 3);
  check(armies.hopHours(field2, berlin, nb) < h0 * 0.6, `roads speed up movement (${h0.toFixed(1)}h → ${armies.hopHours(field2, berlin, nb).toFixed(1)}h)`);
  check(B.fortBonus(berlin) === 1 && (B.setLevel(berlin, 'fort', 2), B.fortBonus(berlin) === 1.5), 'fortifications II = +50% defense');
  // A fleet can't go on land; a land army can't enter neutral land.
  const fleet = [...armies.list.values()].find((a) => a.nation === player && a.kind === 'naval');
  if (fleet) check(!!armies.findPath(fleet, berlin).error, 'fleet cannot sail onto land');
}

// --- 4. Every era -------------------------------------------------------------------
{
  console.log('4. Every era: spawn + pathing');
  for (const era of ERAS) {
    const t0 = performance.now();
    const g = setup(era.id, null);
    const all = [...g.armies.list.values()];
    const mine = all.filter((a) => a.nation === g.player);
    const field = mine.find((a) => !a.garrison && a.kind === 'land');
    // Path to the farthest own province (stress the search).
    let far = field.node, fd = 0;
    for (const p of g.state.provincesOf(g.player)) {
      const d = Math.hypot(p.center.x - g.armies.pos[field.node].x, p.center.y - g.armies.pos[field.node].y);
      if (d > fd) { fd = d; far = p.id; }
    }
    const t1 = performance.now();
    const r = g.armies.findPath(field, far);
    const t2 = performance.now();
    check(all.length > 0 && mine.length > 0, `${era.id}: armies spawned`);
    console.log(`   ${era.id.padEnd(9)} ${g.map.nations[g.player].shortName.padEnd(14)} armies ${String(all.length).padStart(4)} (player ${mine.length}) · spawn ${(t1 - t0).toFixed(0)}ms · path to farthest own province ${r.error ? r.error : `${r.path.length} hops ${r.hours.toFixed(0)}h`} in ${(t2 - t1).toFixed(1)}ms`);
    const oil = g.map.provinces.filter((p) => p.oil).length;
    const sites = g.buildings.sites(g.player).length;
    const inc = g.economy.income(g.player).perDay;
    console.log(`             resources ${g.economy.keys.join('/')} · oil deposits ${oil} · player sites ${sites} · per day ${g.economy.keys.map((k) => Math.round(inc[k])).join('/')}`);
    check(era.id === 'rome' || era.id === 'medieval' || oil > 0, `${era.id}: oil deposits exist`);
  }
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall war checks passed');
