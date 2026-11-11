// Real province names for the historical eras (step 13), written into the
// shipped era files without rebuilding them: only each province's display
// name (`n`) changes; ids, borders, cities and everything else stay as they
// are, so saved games keep loading. See tools/province-names.mjs, docs/NAMES.md.
//   node tools/name-provinces.mjs [rome medieval ww1 ww2 coldwar]   → data/eras/<id>.json
//   node tools/name-provinces.mjs --report                         → audit only, writes nothing
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorldMap } from '../js/world.js';
import { getEra } from '../js/eras.js';
import { createRng, createNameGenerator } from '../js/map.js';
import { loadSources, nameProvinces } from './province-names.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const report = args.includes('--report');
const eras = args.filter((a) => !a.startsWith('--'));
const ids = eras.length ? eras : ['rome', 'medieval', 'ww1', 'ww2', 'coldwar'];

/** Names the era builder invented (its generator's sequence for that era). */
export function generatedNames(eraId, n = 6000) {
  const gen = createNameGenerator(createRng(`names:${eraId}`));
  const set = new Set();
  for (let i = 0; i < n; i++) set.add(gen());
  return set;
}

const sources = report ? null : loadSources(path.join(ROOT, 'data/raw'));
for (const id of ids) {
  const file = path.join(ROOT, 'data/eras', `${id}.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const invented = generatedNames(id);
  const before = data.provinces.filter((p) => invented.has(p.n)).length;
  if (report) { console.log(`${id.padEnd(9)} ${data.provinces.length} provinces, ${before} invented names`); continue; }
  const map = buildWorldMap(data, getEra(id));
  // A capital the builder found no real city for got an invented name too.
  for (const p of map.provinces) p.generatedCity = p.isCity && invented.has(p.name);
  const { names, stats } = nameProvinces(id, map, sources);
  for (const [pid, name] of names) data.provinces[pid].n = name;
  const after = data.provinces.filter((p) => invented.has(p.n)).length;
  fs.writeFileSync(file, JSON.stringify(data));
  console.log(`${id.padEnd(9)} ${data.provinces.length} provinces: ${stats.kept} city names kept, ${stats.historical} named from a ${id === 'rome' ? 'Pleiades place' : 'town'}, ${stats.region} from a modern region, ${stats.feature} from a river/lake/range/region, ${stats.nearTown ?? 0} from a town nearby, ${stats.regionSuffix} from a modern region with a compass suffix; invented names ${before} → ${after}`);
}
