// Province names (step 13): no invented names left in the historical eras,
// names unique and non-empty, and the era files differ from the ones before
// step 13 only in names — so saved games still load. A save made on the old
// map is restored onto the new one to prove it.
//   node tools/check-names.mjs [base-commit]   (default: the last commit before step 13)
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildWorldMap } from '../js/world.js';
import { getEra } from '../js/eras.js';
import { createRng, createNameGenerator } from '../js/map.js';
import { makeSim } from '../js/game-server.js';
import { snapshot, restore, pack, unpack } from '../js/save.js';

const BASE = process.argv[2] ?? 'd90e6ea';
const ERAS = ['rome', 'medieval', 'ww1', 'ww2', 'coldwar'];
// Real places that happen to match a name the old generator could invent.
const REAL = new Set(['Arar', 'Corum', 'Sennar', 'Kara', 'Arta', 'Tula', 'Kola', 'Lima', 'Nara', 'Orel', 'Ufa', 'Ilan', 'Ural', 'Dora', 'Elva', 'Tana', 'Mora', 'Lida', 'Kalmar', 'Tanta', 'Galena', 'Vera', 'Harar', 'Saransk', 'Helena', 'Harstad']);

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };
const strip = (d) => JSON.stringify({ ...d, provinces: d.provinces.map(({ n, ...rest }) => rest) });

for (const id of ERAS) {
  const now = JSON.parse(readFileSync(new URL(`../data/eras/${id}.json`, import.meta.url), 'utf8'));
  const gen = createNameGenerator(createRng(`names:${id}`));
  const invented = new Set();
  for (let i = 0; i < 6000; i++) invented.add(gen());
  const left = now.provinces.filter((p) => invented.has(p.n) && !REAL.has(p.n)).map((p) => p.n);
  check(!left.length, `${id}: no invented names${left.length ? ` (${left.slice(0, 5).join(', ')})` : ''}`);
  const names = now.provinces.map((p) => p.n);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  check(names.every((n) => typeof n === 'string' && n.trim()) && !dupes.length, `${id}: ${names.length} names, all non-empty and unique${dupes.length ? ` (dupes: ${dupes.slice(0, 5).join(', ')})` : ''}`);

  let old = null;
  try { old = JSON.parse(execFileSync('git', ['show', `${BASE}:data/eras/${id}.json`], { maxBuffer: 1 << 28 }).toString()); } catch { /* no git history here */ }
  if (!old) { console.log(`skip ${id}: no git history to compare with`); continue; }
  check(strip(old) === strip(now), `${id}: only names changed (ids, borders, cities, nations identical)`);
  // A save made on the old map loads on the new one.
  const a = makeSim(buildWorldMap(old, getEra(id)));
  const me = a.state.provinces.find((p) => p.owner >= 0).owner;
  a.state.setPlayerNation(me); a.sim.buildings.start(); a.sim.economy.start(); a.sim.armies.spawnInitial(me); a.sim.ai.start(me, 'normal');
  a.state.setPhase('playing');
  for (let h = 0; h < 72; h++) { a.state.clock.time += 36e5; for (const s of ['economy', 'research', 'buildings', 'armies', 'combat', 'integration', 'ai', 'victory']) a.sim[s].update(a.state, 1); }
  const saved = await unpack(await pack(snapshot(a)));
  const b = makeSim(buildWorldMap(now, getEra(id)));
  let ok = true;
  try { restore(b, saved); } catch (e) { ok = false; console.log(`     ${e.message}`); }
  check(ok && b.state.provinces.every((p, i) => p.owner === a.state.provinces[i].owner) && b.sim.armies.list.size === a.sim.armies.list.size, `${id}: a save from before step 13 loads (${b.sim.armies.list.size} armies)`);
}
console.log(failures ? `${failures} failure(s)` : 'all name checks passed');
process.exit(failures ? 1 : 0);
