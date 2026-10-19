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
import { Research } from '../js/research.js';
import { techTree } from '../js/tech.js';
import { resourceSet } from '../js/resources.js';
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
  const research = new Research(state, economy);
  research.armies = armies;
  research.buildings = buildings;
  armies.research = research;
  buildings.research = research;
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
      research.update(state, dt);
      buildings.update(state, dt);
      armies.update(state, dt);
      combat.update(state, dt);
    }
  };
  return { state, economy, buildings, armies, combat, research, map, player, step, log };
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

// --- 3b. Research -----------------------------------------------------------------
{
  console.log('3b. Research');
  for (const era of ERAS) {
    const tree = techTree(era.id, resourceSet(era.id).keys);
    const ids = new Set(tree.map((t) => t.id));
    const tierOf = Object.fromEntries(tree.map((t) => [t.id, t.tier]));
    const bad = tree.filter((t) => !t.name || !t.effects.length || t.req.some((q) => !ids.has(q) || tierOf[q] >= t.tier));
    check(tree.length >= 25 && tree.length <= 35 && !bad.length, `${era.id}: ${tree.length} techs, requirements point to lower tiers${bad.length ? ` (bad: ${bad.map((t) => t.id)})` : ''}`);
    check(new Set(tree.map((t) => t.name)).size === tree.length, `${era.id}: unique names`);
    const slotTiers = tree.filter((t) => t.effects.some((e) => e.slots)).map((t) => `${t.branch}${t.tier}`).join();
    check(slotTiers === 'eco1,eco3', `${era.id}: research slots from Economy tier I and tier III (${slotTiers})`);
  }
  const g = setup('ww2', 'German Reich');
  const { research: R, armies, economy, state, player, buildings: B } = g;
  const berlin = state.getNation(player).capitalId;
  check(R.status(player, 'm1') === 'available' && R.status(player, 'm4') === 'locked', 'tier-1 available, tier-2 locked');
  check(/Requires Armoured Divisions/.test(R.check(player, 'm4').reason), `locked reason: ${R.check(player, 'm4').reason}`);
  const m0 = economy.get(player).money;
  check(R.start(player, 'm1').ok && Math.abs(m0 - economy.get(player).money - R.byId.m1.cost.money) < 1e-6, 'start research, cost paid');
  check(/slot busy/.test(R.start(player, 'm3').error ?? ''), 'one slot to start');
  const field = [...armies.list.values()].find((a) => a.nation === player && !a.garrison && a.kind === 'land' && a.node === berlin);
  // An army away from any barracks city (move one onto plain land if needed).
  let away = [...armies.list.values()].find((a) => a.nation === player && a.kind === 'land' && a.node !== berlin && !armies.refitSite(a));
  if (!away) {
    away = [...armies.list.values()].find((a) => a.nation === player && !a.garrison && a.kind === 'land' && a.node !== berlin);
    const plain = state.provincesOf(player).find((p) => !p.isCity);
    armies.setNode(away, plain.id);
  }
  const inf = field.units.find((u) => u.type === 'infantry');
  inf.hp = 50;
  g.step(R.byId.m1.hours + 2);
  check(R.status(player, 'm1') === 'done' && R.unitLevel(player, 'inf') === 2, `research completes after ${R.byId.m1.hours}h: infantry level 2`);
  const fe = g.log.find((e) => e.kind === 'research');
  check(!!fe && !!fe.toast, `feed + toast: "${fe?.text}"`);
  check(inf.lvl === 2 && armies.unitType(inf).hp === 115 && inf.hp > 57, `infantry resting in Berlin refits to level 2 and heals (HP 50 → ${inf.hp.toFixed(1)} of ${armies.unitType(inf).hp})`);
  const refitFeed = g.log.find((e) => e.kind === 'refit');
  check(!!refitFeed && /money/.test(refitFeed.text), `refit is paid: "${refitFeed?.text}"`);
  check(JSON.stringify(armies.refitCost({ type: 'infantry', lvl: 1 }, 2)) === JSON.stringify({ money: 16, steel: 2 }), `refit cost per infantry: ${JSON.stringify(armies.refitCost({ type: 'infantry', lvl: 1 }, 2))}`);
  const awayInf = away?.units.find((u) => u.type === 'infantry');
  if (awayInf) check((awayInf.lvl ?? 1) === 1 && armies.outdated(away).length > 0, 'army away from a barracks city keeps level 1 until it refits');
  check(armies.unitType(inf).attack > armies.roster.byKey.infantry.attack, `level 2 stats: attack ${armies.roster.byKey.infantry.attack} → ${armies.unitType(inf).attack}`);
  // Building level III needs research.
  B.setLevel(berlin, 'barracks', 2);
  check(/Needs Armoured Divisions/.test(B.check(berlin, 'barracks', { ignoreCost: true }).reason ?? ''), `Barracks III locked: ${B.check(berlin, 'barracks', { ignoreCost: true }).reason}`);
  R.grant(player, 'm2');
  check(B.check(berlin, 'barracks', { ignoreCost: true }).ok, 'Barracks III after research');
  // Production, slots, queue.
  const money = economy.income(player).perDay.money;
  R.grant(player, 'e4');
  check(Math.abs(economy.income(player).perDay.money / money - 1.1) < 0.001, `+10% money (${Math.round(money)} → ${Math.round(economy.income(player).perDay.money)})`);
  const oil = economy.income(player).perDay.oil;
  R.grant(player, 'e6');
  check(economy.income(player).perDay.oil > oil + 5, `Synthetic Fuel: oil ${Math.round(oil)} → ${Math.round(economy.income(player).perDay.oil)}/day from steel`);
  check(R.slots(player) === 1, 'one slot to start');
  R.grant(player, 'e2');
  check(R.slots(player) === 2, 'tier I Economy tech: 2nd research slot');
  check(R.start(player, 'm3').ok && R.start(player, 'e1').ok, 'two techs at once');
  check(R.enqueue(player, 'e5').ok, 'queue a tech whose requirement is researching');
  check(R.enqueue(player, 'e8').ok, 'queue a tech whose requirement is queued');
  check(!!R.enqueue(player, 'm10').error, `refuse an unreachable tech: ${R.canQueue(player, 'm10').reason ?? ''}`);
  for (const id of ['i1', 'i2', 'i3']) R.enqueue(player, id);
  check(R.of(player).queue.length === 5 && /full/.test(R.enqueue(player, 'm4').error ?? ''), `queue holds 5 (${R.of(player).queue} · active ${R.of(player).active.map((a) => a.id)} · m2: ${R.enqueue(player, 'm4').error})`);
  for (const k of economy.keys) economy.get(player)[k] += 1e5;
  g.step(R.byId.e1.hours + 2);
  check(R.status(player, 'e5') === 'active' && R.of(player).active.length === 2, `queued tech started by itself when a slot freed (${R.of(player).active.map((a) => a.id)})`);
  R.dequeue(player, 'e8');
  R.grant(player, 'e7');
  check(R.slots(player) === 3, 'tier III Economy tech: 3rd research slot');
  check(R.bonuses(player).some((b) => b.key === 'slots' && b.value === 2) && R.bonuses(player).some((b) => b.key === 'unit:inf'), 'bonuses summary lists slots and unit levels');
  const c0 = B.costOf('farm', 1, player).money;
  R.grant(player, 'i4'); R.grant(player, 'i8');
  check(B.costOf('farm', 1, player).money < c0, `construction 20% cheaper: farm ${c0} → ${B.costOf('farm', 1, player).money}`);
  const nb = state.getProvince(berlin).neighbors.find((n) => state.provinces[n].owner === player);
  const h0 = armies.hopHours(field, berlin, nb);
  R.grant(player, 'i1');
  check(armies.hopHours(field, berlin, nb) < h0 * 0.93, `+10% movement (${h0.toFixed(1)}h → ${armies.hopHours(field, berlin, nb).toFixed(1)}h)`);
  const t0 = armies.recruitCheck(berlin, 'infantry', { ignoreCost: true }).hours;
  R.grant(player, 'i5');
  check(armies.recruitCheck(berlin, 'infantry', { ignoreCost: true }).hours < t0, 'faster recruitment');
  const act = R.of(player).active[0]?.id;
  if (act) { R.cancel(player, act); check(R.status(player, act) === 'available', 'cancel research'); }
}

// --- 3c. Research balance: a medium nation researching the whole tree ---------------
// "Medium" = the major nation with the median money income in that era. It spends
// half its income on other things (army, buildings) and keeps the research queue full.
{
  console.log('3c. Research balance (whole tree at 1×: 1 game hour = 1 real second)');
  // Medium nation per era (checked), plus a small one for reference (not checked).
  const runs = ERAS.filter((e) => !e.fictional).map((e) => [e, null]).concat([[getEra('ww2'), 'German Reich']]);
  for (const [era, fixed] of runs) {
    const g0 = setup(era.id, null);
    const majors = g0.map.nations.filter((n) => n.major && g0.state.provincesOf(n.id).length)
      .map((n) => ({ n, money: g0.economy.income(n.id).perDay.money })).sort((a, b) => a.money - b.money);
    const pick = fixed ? majors.find((m) => m.n.name === fixed) : majors[Math.floor(majors.length / 2)];
    const g = setup(era.id, pick.n.name);
    const { research: R, economy, player } = g;
    let hours = 0;
    while (hours < 40000 && R.of(player).done.size < R.tree.length) {
      for (const t of [...R.tree].sort((a, b) => a.tier - b.tier)) if (R.canQueue(player, t.id).ok) R.enqueue(player, t.id);
      R.autoStart(player);
      for (let h = 0; h < 24; h++) { economy.update(g.state, 1); R.update(g.state, 1); }
      const s = economy.get(player), inc = economy.income(player).perDay;
      for (const k of economy.keys) s[k] = Math.max(0, s[k] - inc[k] * 0.5);
      hours += 24;
    }
    const done = R.of(player).done.size === R.tree.length;
    console.log(`   ${era.id.padEnd(9)} ${pick.n.shortName.padEnd(16)} ${String(Math.round(pick.money)).padStart(5)} money/day → ${done ? `whole tree in ${(hours / 3600).toFixed(1)} real hours` : `unfinished after ${(hours / 3600).toFixed(1)} h (${R.of(player).done.size}/${R.tree.length})`} · tier I ${(R.byId.m1.hours / 60).toFixed(1)} min, II ${(R.byId.m4.hours / 60).toFixed(0)} min, III ${(R.byId.m8.hours / 60).toFixed(0)} min`);
    if (!fixed) check(done && hours / 3600 >= 1.5 && hours / 3600 <= 3.5, `${era.id}: whole tree in 1.5–3.5 real hours`);
  }
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
