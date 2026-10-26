// Save round trip, headless: play a war for a while, save, compress, load into a
// fresh game, and check that nothing was lost — then run both games on with the
// same dice and check they stay identical.
//   node tools/check-save.mjs [era=ww2] [days=90]
import { readFileSync } from 'node:fs';
import { GameState } from '../js/state.js';
import { buildWorldMap } from '../js/world.js';
import { generateMap } from '../js/map.js';
import { getEra } from '../js/eras.js';
import { Economy } from '../js/economy.js';
import { Armies } from '../js/armies.js';
import { Combat } from '../js/combat.js';
import { Buildings } from '../js/buildings.js';
import { Research } from '../js/research.js';
import { AI } from '../js/ai.js';
import { Diplomacy } from '../js/diplomacy.js';
import { Victory } from '../js/victory.js';
import { Sandbox } from '../js/sandbox.js';
import { snapshot, restore, pack, unpack, exportText, importBytes } from '../js/save.js';

const args = process.argv.slice(2);
const eraId = args.find((a) => /^[a-z]+\d*$/.test(a) && !/^\d+$/.test(a)) ?? 'ww2';
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? 90);
const era = getEra(eraId);
const PLAYER = { ww2: 'German Reich', ww1: 'German Empire', coldwar: 'Soviet Union', modern: 'China' }[eraId];

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

function makeGame() {
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
  sim.ai = new AI(state, sim);
  sim.diplomacy = new Diplomacy(state, sim);
  armies.diplomacy = sim.diplomacy;
  sim.victory = new Victory(state, sim);
  sim.sandbox = new Sandbox(state, sim);
  sim.ai.budgetMs = Infinity;
  const map = era.fictional ? Object.assign(generateMap('SAVE-TEST'), { era }) : buildWorldMap(JSON.parse(readFileSync(new URL(`../data/eras/${era.id}.json`, import.meta.url))), era);
  state.loadMap(map);
  return { state, sim };
}

function run(g, hours) {
  const { state, sim } = g;
  for (let h = 0; h < hours; h++) {
    state.clock.time += 3600e3;
    for (const s of ['economy', 'research', 'buildings', 'armies', 'combat', 'ai', 'victory']) sim[s].update(state, 1);
  }
}

/** Seeded Math.random, so two games can roll the same dice. */
function seedDice(seed) {
  let s = seed >>> 0;
  Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// --- Game A: start as the player, declare a war, play on. ---
const A = makeGame();
const me = A.state.nations.find((n) => n.name === PLAYER)?.id ?? A.state.nations.find((n) => n.major)?.id ?? 0;
A.state.setPlayerNation(me);
A.sim.buildings.start();
A.sim.economy.start();
A.sim.armies.spawnInitial(me);
A.sim.ai.start(me, 'normal');
A.state.setPhase('playing');
A.sim.victory.start({ mode: 'points', timeLimit: 0 });
// War with the weakest neighbour; send every field army at its capital; research something.
const target = [...A.sim.ai.neighborsOf(me)].sort((x, y) => A.sim.ai.powerOf(x) - A.sim.ai.powerOf(y))[0];
A.sim.diplomacy.declareWar(me, target);
const cap = A.state.getNation(target).capitalId;
for (const a of A.sim.armies.list.values()) if (a.nation === me && !a.garrison && a.kind === 'land') A.sim.armies.order(a.id, cap);
const tech = A.sim.research.tree.find((t) => A.sim.research.check(me, t.id).ok);
if (tech) A.sim.research.start(me, tech.id);
const ally = A.state.nations.find((n) => n.id !== me && n.id !== target && A.sim.diplomacy.accepts?.(n.id, me, 'nap'));
if (ally) A.sim.diplomacy.sign(me, ally.id, 'nap');

// Run until a battle is under way (or `days` pass).
let ran = 0;
while (ran < days * 24 && !(ran > 24 * 20 && A.sim.combat.active.size)) { run(A, 6); ran += 6; }
const s1 = snapshot(A);
const bytes = await pack(s1);
const rawSize = JSON.stringify(s1).length;
console.log(`     ${era.label} as ${A.state.getNation(me).name}, ${Math.round(ran / 24)} days in: ${A.sim.armies.list.size} armies, ${A.sim.combat.active.size} battles under way, ${A.sim.combat.wars.size} wars, ${A.sim.diplomacy.treaties.size} treaty pairs`);
console.log(`     save ${(rawSize / 1024).toFixed(0)} KB JSON → ${(bytes.length / 1024).toFixed(0)} KB gzip`);
check(A.sim.combat.active.size > 0, 'mid-war: battles under way at save time');
check(A.sim.combat.atWar(me, target), 'player at war at save time');

// --- Game B: fresh map, load the save. ---
const B = makeGame();
const loaded = await unpack(bytes);
restore(B, loaded);
B.state.setPhase('playing'); // the game screen does this on load
const s2 = snapshot(B);
/** First few paths where two plain objects differ (for failure messages). */
function diff(a, b, path = '', out = []) {
  if (out.length > 5) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], `${path}.${k}`, out);
  } else out.push(`${path}: ${JSON.stringify(a)?.slice(0, 80)} ≠ ${JSON.stringify(b)?.slice(0, 80)}`);
  return out;
}
const strip = (s) => JSON.stringify({ ...s, meta: { ...s.meta, savedAt: 0 } });
check(strip(s1) === strip(s2), 'loaded game saves back byte-for-byte identical');
if (strip(s1) !== strip(s2)) console.log(diff(s1, s2).join('\n'));
check(B.state.playerNationId === me && B.state.clock.time === A.state.clock.time, 'player and clock restored');
check(B.sim.armies.list.size === A.sim.armies.list.size, `armies restored (${B.sim.armies.list.size})`);
const moving = [...B.sim.armies.list.values()].filter((a) => a.seg || a.path.length).length;
check(moving === [...A.sim.armies.list.values()].filter((a) => a.seg || a.path.length).length, `marching orders restored (${moving} moving)`);
const bt = [...B.sim.combat.active.values()][0];
check(bt && bt.sides.every((s) => [...s.armies].every((a) => B.sim.armies.list.get(a.id) === a)), 'battles point at the restored army objects');
check(B.sim.combat.atWar(me, target) && B.sim.combat.warInfo.size === A.sim.combat.warInfo.size, 'wars and war info restored');
check(JSON.stringify([...B.sim.research.nations.get(me).active]) === JSON.stringify([...A.sim.research.nations.get(me).active]), 'research in progress restored');
check(!ally || B.sim.diplomacy.has(me, ally.id, 'nap'), 'treaties restored');
A.sim.diplomacy.cache.clear(); A.sim.ai.strengthAt = -Infinity; // opinions and power are cached; compare fresh values
const opA = A.sim.diplomacy.opinion(target, me).value, opB = B.sim.diplomacy.opinion(target, me).value;
check(opA === opB, `opinion restored (${opA} → ${opB})`);
check(B.sim.ai.brains.size === A.sim.ai.brains.size, `AI brains restored (${B.sim.ai.brains.size})`);
check(B.sim.victory.scoreOf(me).points === A.sim.victory.scoreOf(me).points, 'victory points restored');
const incA = A.sim.economy.income(me).perDay, incB = B.sim.economy.income(me).perDay;
check(Object.keys(incA).every((k) => Math.abs(incA[k] - incB[k]) < 1e-6 * Math.max(1, Math.abs(incA[k]))), 'income identical');

// File export/import round trip.
const text = await exportText(s1, 'data:image/png;base64,AAAA');
const back = await importBytes(new TextEncoder().encode(text));
check(strip(back.save) === strip(s1) && back.thumb === 'data:image/png;base64,AAAA', `export file round trip (${(text.length / 1024).toFixed(0)} KB file)`);

// --- Same dice from here: both games must play out identically. ---
restore(A, await unpack(bytes)); // A also drops its caches, as a load does
// Step both a few hours at a time with the same dice, so a mismatch shows where it starts.
let same = true, at = 0;
for (at = 0; at < 24 * 30 && same; at += 6) {
  const k = at + 1;
  seedDice(k); run(A, 6);
  seedDice(k); run(B, 6);
  const a = snapshot(A), b = snapshot(B);
  same = strip(a) === strip(b);
  if (!same) console.log(`     first difference after ${at + 6} hours:\n     ${diff(a.state, b.state).join('\n     ')}`);
}
check(same, 'original and loaded game stay identical 30 days on');
console.log(failures ? `${failures} failure(s)` : 'all save checks passed');
process.exit(failures ? 1 : 0);
