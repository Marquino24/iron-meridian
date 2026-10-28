// Multiplayer game server (step 11B), headless: two human players on one WWII
// map, the computer running every other nation, ticks with orders from both and
// ticks with nobody online, fog of war, an inactive player handed to the AI,
// catch-up after a long gap, and a game ending by its win condition.
//   node tools/check-mp-server.mjs
import { readFileSync } from 'node:fs';
import { tickGame, MAX_HOURS, fromB64 } from '../js/game-server.js';
import { LocalStore, memoryBacking } from '../js/mp-local-store.js';
import { unpack, decode } from '../js/save.js';

let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };
const mapData = async (era) => JSON.parse(readFileSync(new URL(`../data/eras/${era}.json`, import.meta.url)));
const eraJson = await mapData('ww2');
const nation = (name) => eraJson.nations.findIndex((n) => n.name === name);
const DE = nation('German Reich'), FR = nation('France');
const MIN = 60000;
let now = Date.UTC(2026, 9, 1, 12);
const iso = (t) => new Date(t).toISOString();

const store = new LocalStore(memoryBacking({
  games: [{ id: 'g1', name: 'Test', era: 'ww2', minutes_per_day: 4, max_players: 10, status: 'running', inactive_days: 7, tick: 0, ticked_at: null }],
  players: [
    { game_id: 'g1', user_id: 'alice', nation_id: DE, last_seen: iso(now), ai_controlled: false },
    { game_id: 'g1', user_id: 'bob', nation_id: FR, last_seen: iso(now), ai_controlled: false },
  ],
}), mapData);
const view = async (n) => decode((await unpack(fromB64(store.view('g1', n).state))).state);
const full = async () => decode((await unpack(fromB64((await store.state('g1')).state))).state);

// 1. First tick: a new world; the two nations are human, the rest computer-run.
let r = await tickGame(store, 'g1', { now });
let d = await full();
check(r.status === 'running' && r.tick === 1 && r.humans.sort().join() === [DE, FR].sort().join(), `first tick: world created (${r.ms} ms), humans ${r.humans}`);
const brains = new Map(d.ai.brains);
check(!brains.has(DE) && !brains.has(FR) && brains.size > 50, `${brains.size} computer nations, none for the two players`);
check(store.view('g1', DE) && store.view('g1', FR) && !store.view('g1', 0), 'one view per player, none for computer nations');

// 2. Orders from both players, then a tick 5 minutes later (30 game hours at 4 min per game day).
const deField = d.armies.list.find((a) => a.nation === DE && !a.garrison && a.kind === 'land');
const map = (await import('../js/game-server.js')).makeSim;
void map;
const berlin = eraJson.nations[DE].capital;
const paris = d.owners.findIndex((o, pid) => o === FR && pid === eraJson.nations[FR].capital);
const target = d.owners.findIndex((o) => o === DE) === deField.node ? d.owners.findIndex((o, pid) => o === DE && pid !== deField.node) : d.owners.findIndex((o) => o === DE);
const c1 = store.send('g1', 'alice', DE, 'army.move', { army: deField.id, to: target });
const c2 = store.send('g1', 'bob', FR, 'unit.recruit', { province: paris, type: 'infantry' });
const c3 = store.send('g1', 'bob', FR, 'army.move', { army: deField.id, to: target });
const c4 = store.send('g1', 'mallory', DE, 'army.stop', { army: deField.id });
now += 5 * MIN;
r = await tickGame(store, 'g1', { now });
const cmd = (c) => store.db().commands.find((x) => x.id === c.id);
check(Math.abs(r.hours - 30) < 0.01, `5 real minutes = ${r.hours} game hours`);
check(cmd(c1).status === 'applied' && cmd(c2).status === 'applied', 'alice\'s move and bob\'s recruit applied');
check(cmd(c3).status === 'rejected' && /Not your army/.test(cmd(c3).result), `bob ordering alice's army rejected: "${cmd(c3).result}"`);
check(cmd(c4).status === 'rejected' && /no longer play/.test(cmd(c4).result), `an order from someone not seated rejected: "${cmd(c4).result}"`);
d = await full();
const moved = d.armies.list.find((a) => a.id === deField.id);
check(moved.node !== deField.node || moved.seg, `German army on its way (node ${deField.node} → ${moved.seg ? `${moved.seg.from}→${moved.seg.to}` : moved.node})`);
check(new Map(d.armies.queues).get(paris)?.length >= 1 || d.armies.list.some((a) => a.nation === FR && a.node === paris), 'French infantry recruited in Paris');

// 3. Fog of war: each player sees their own armies in full, others only nearby.
const vDE = await view(DE), vFR = await view(FR);
const far = d.armies.list.filter((a) => a.nation !== DE && a.nation !== FR).length;
check(vDE.armies.list.filter((a) => a.nation === DE).length === d.armies.list.filter((a) => a.nation === DE).length, 'German view: every German army');
check(vDE.armies.list.length < d.armies.list.length * 0.5, `German view: ${vDE.armies.list.length} of ${d.armies.list.length} armies (${far} foreign in the world)`);
check(Object.values(vDE.economy.stock[FR]).every((x) => x === 0) && Object.values(vFR.economy.stock[FR]).some((x) => x > 0), 'French stocks hidden from Germany, shown to France');
check(new Map(vDE.ai.brains).size === 0 && !vDE.ai.enabled, 'computer nations\' plans not sent to players');
const foreignSeen = vDE.armies.list.filter((a) => a.nation !== DE);
check(foreignSeen.every((a) => !a.path.length), `foreign armies' routes hidden (${foreignSeen.length} foreign armies seen near German land)`);

// 4. Nobody online for 2 hours: ticks every 5 minutes, no orders. The world goes on.
const t2 = d.clock.time;
const wars0 = new Map(d.combat.warInfo).size;
const ms = [];
for (let i = 0; i < 24; i++) { now += 5 * MIN; r = await tickGame(store, 'g1', { now }); ms.push(r.ms); }
d = await full();
const days = (d.clock.time - t2) / 864e5;
check(Math.abs(days - 30) < 0.1, `2 hours with nobody online: ${days.toFixed(1)} game days passed`);
const brains2 = new Map(d.ai.brains);
check(!brains2.has(DE) && !brains2.has(FR), 'the players\' nations stay theirs while they are away (7 days before the AI takes over)');
const wars = [...new Map(d.combat.warInfo).keys()].length;
console.log(`     computer nations at war: ${wars} wars (were ${wars0}); tick time median ${ms.sort((a, b) => a - b)[12]} ms, max ${ms.at(-1)} ms (Node, this machine)`);

// 5. Bob goes quiet for 8 days: France is handed to the AI; his orders are refused.
store.db().players.find((p) => p.user_id === 'bob').last_seen = iso(now - 8 * 864e5);
const c5 = store.send('g1', 'bob', FR, 'army.stop', { army: 1 });
now += 5 * MIN;
r = await tickGame(store, 'g1', { now });
d = await full();
check(r.handedToAi.includes(FR) && new Map(d.ai.brains).has(FR) && store.db().players.find((p) => p.user_id === 'bob').ai_controlled, 'inactive bob: France handed to the AI');
check(cmd(c5).status === 'rejected' && /computer-run/.test(cmd(c5).result), `his order rejected: "${cmd(c5).result}"`);
check(!store.view('g1', FR) || store.view('g1', FR).tick < r.tick, 'no new view for an AI-run nation');

// 6. A long gap (an hour of real time = 360 game hours): caught up in steps of at most MAX_HOURS.
now += 60 * MIN;
r = await tickGame(store, 'g1', { now });
check(r.hours === MAX_HOURS && r.owed > 300, `after an hour's gap: ${r.hours} h simulated of ${r.owed} owed`);
const r2 = await tickGame(store, 'g1', { now });
check(r2.hours === MAX_HOURS && r2.owed < r.owed, `next tick catches up further (${r2.owed} h left)`);

// 7. A paused game doesn't tick; a game ends by its win condition.
store.db().games[0].status = 'paused';
check((await tickGame(store, 'g1', { now: now + 10 * MIN })).skipped === 'game is paused', 'paused game skipped');
const fic = new LocalStore(memoryBacking({
  games: [{ id: 'g2', name: 'Short', era: 'fictional', map_seed: 'MP-TEST', minutes_per_day: 1, max_players: 6, status: 'running', inactive_days: 7, tick: 0, ticked_at: null, time_limit: 0.01 }],
  players: [{ game_id: 'g2', user_id: 'alice', nation_id: 0, last_seen: iso(now), ai_controlled: false }],
}), mapData);
let t = now;
for (let i = 0; i < 6 && (await fic.game('g2')).status === 'running'; i++) { await tickGame(fic, 'g2', { now: t }); t += 5 * MIN; }
const g2 = await fic.game('g2');
check(g2.status === 'finished' && g2.winner >= 0 && /Time is up|victory points|controls/.test(g2.end_reason), `game ended by its win condition: "${g2.end_reason}"`);
check(!!fic.view('g2', 0), 'an ended game stays readable (last view kept)');

console.log(failures ? `${failures} failure(s)` : 'all multiplayer server checks passed');
process.exit(failures ? 1 : 0);
