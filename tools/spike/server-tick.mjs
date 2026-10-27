// Spike (step 11A): what would one server tick of a persistent game cost?
// A server tick = load the saved game, advance the simulation N game hours,
// save it again. This measures the CPU time of each phase, cold (fresh
// process: module load and map build included, as a cold Edge Function) and
// warm (map already built in the same worker), on the full-size maps.
// Runs under Node and Deno (Supabase Edge Functions run on Deno):
//   node tools/spike/server-tick.mjs prepare [era=ww2] [days=90]   → writes the test state
//   node tools/spike/server-tick.mjs tick [era=ww2] [hours=1,6,24]
//   deno run -A tools/spike/server-tick.mjs tick [era] [hours]
import process from 'node:process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; }; // ms
const T0 = cpu();
const W0 = performance.now();
const [mode = 'tick', eraId = 'ww2', arg = ''] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const runtime = globalThis.Deno ? `Deno ${Deno.version.deno}` : `Node ${process.versions.node}`;
const root = new URL('../../', import.meta.url);
const statePath = new URL(`tools/spike/.state-${eraId}.bin`, root);

// --- Cold start: the game modules. ---
const mods = await Promise.all(['state', 'world', 'eras', 'economy', 'armies', 'combat', 'buildings', 'research', 'ai', 'diplomacy', 'victory', 'sandbox', 'integration', 'save']
  .map((m) => import(new URL(`js/${m}.js`, root))));
const [{ GameState }, { buildWorldMap }, { getEra }, { Economy }, { Armies }, { Combat }, { Buildings }, { Research }, { AI }, { Diplomacy }, { Victory }, { Sandbox }, { Integration }, save] = mods;
const T1 = cpu();

function makeGame(mapJson) {
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
  sim.ai = new AI(state, sim);
  sim.diplomacy = new Diplomacy(state, sim);
  armies.diplomacy = sim.diplomacy;
  sim.victory = new Victory(state, sim);
  sim.sandbox = new Sandbox(state, sim);
  sim.integration = new Integration(state, sim);
  sim.ai.budgetMs = Infinity; // a server thinks for every nation in full
  state.loadMap(buildWorldMap(mapJson, era));
  return { state, sim };
}
function advance({ state, sim }, hours) {
  for (let h = 0; h < hours; h++) {
    state.clock.time += 3600e3;
    for (const s of ['economy', 'research', 'buildings', 'armies', 'combat', 'integration', 'ai', 'victory']) sim[s].update(state, 1);
  }
}

if (mode === 'prepare') {
  // A mid-game state: every nation computer-played for `days` game days.
  const days = Number(arg || 90);
  const g = makeGame(JSON.parse(readFileSync(new URL(`data/eras/${eraId}.json`, root), 'utf8')));
  const { state, sim } = g;
  state.setPlayerNation(-1);
  sim.buildings.start(); sim.economy.start(); sim.armies.spawnInitial(-1); sim.ai.start(-1, 'normal');
  state.setPhase('playing');
  sim.victory.start({ mode: 'points', timeLimit: 0 });
  advance(g, days * 24);
  const snap = save.snapshot(g);
  const bytes = await save.pack(snap);
  mkdirSync(new URL('tools/spike/', root), { recursive: true });
  writeFileSync(statePath, bytes);
  console.log(`${eraId}: ${days} days played · ${state.provinces.length} provinces · ${state.nations.length} nations · ${sim.armies.list.size} armies · ${sim.combat.wars.size} wars · state ${(JSON.stringify(snap).length / 1024).toFixed(0)} KB JSON, ${(bytes.length / 1024).toFixed(0)} KB gzip`);
  process.exit(0);
}

// --- One tick, cold then warm. ---
const hoursList = (arg || '1,6,24').split(',').map(Number);
const bytes = readFileSync(statePath);
const ms = (a, b) => `${(b - a).toFixed(0)}`.padStart(6);
const rss = () => (process.memoryUsage().rss / 1048576).toFixed(0);

const T2 = cpu();
const mapJson = JSON.parse(readFileSync(new URL(`data/eras/${eraId}.json`, root), 'utf8'));
const T3 = cpu();
const rows = [];
// Each tick: build the game on the map data (fresh objects, as a stateless
// function would), restore the save, advance, save. Each length twice: the
// first run of a length warms the JIT for it.
for (const hours of hoursList) for (let rep = 0; rep < 2; rep++) {
  const a = cpu();
  const game = makeGame(mapJson);
  const b = cpu();
  save.restore(game, await save.unpack(bytes));
  game.state.setPhase('playing');
  const c = cpu();
  advance(game, hours);
  const d = cpu();
  const out = await save.pack(save.snapshot(game));
  const e = cpu();
  rows.push({ hours, rep, setup: b - a, restore: c - b, sim: d - c, save: e - d, total: e - a, size: out.length, rss: Number(rss()) });
}
console.log(`${runtime} · ${eraId} · state ${(bytes.length / 1024).toFixed(0)} KB gzip`);
console.log(`cold start: modules ${(T1 - T0).toFixed(0)} ms CPU, read + parse map JSON ${(T3 - T2).toFixed(0)} ms CPU`);
console.log(' game h rep  setup restore    sim   save  total (ms CPU)   rss MB');
for (const r of rows) console.log(`${String(r.hours).padStart(7)} ${r.rep ? 'warm' : 'cold'} ${ms(0, r.setup)} ${ms(0, r.restore)} ${ms(0, r.sim)} ${ms(0, r.save)} ${ms(0, r.total)}            ${r.rss}`);
const cold = (T1 - T0) + (T3 - T2);
const per = rows.filter((r) => r.hours === Math.max(...hoursList)).at(-1);
console.log(`JSON ${JSON.stringify({ runtime, era: eraId, coldStart: Math.round(cold), rows, perHourSim: per.sim / per.hours })}`);
