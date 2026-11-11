// Colonies inside their sovereign on the map fly their own colonial flag
// (js/colonies.js, step 7B / 13): check that well-known places land in the
// right colony, that neighbors don't, and that each colony has its flag tile.
//   node tools/check-colonies.mjs
import { readFileSync } from 'node:fs';
import { buildWorldMap } from '../js/world.js';
import { getEra } from '../js/eras.js';
import { pickProvince } from '../js/map.js';
import { project } from '../js/projection.js';
import { FLAG_INDEX } from '../js/flag-index.js';

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };
// [era, place, lat, lon, colony expected (null: none)]
const CASES = [
  ['ww1', 'Delhi', 28.61, 77.21, 'British India'], ['ww1', 'Rangoon', 16.8, 96.15, 'British India'], ['ww1', 'Ibadan', 7.38, 3.93, 'Nigeria'],
  ['ww1', 'Kano', 12.0, 8.52, 'Nigeria'], ['ww1', 'Accra', 5.6, -0.19, 'Gold Coast'], ['ww1', 'Kumasi', 6.69, -1.62, 'Gold Coast'],
  ['ww1', 'Nairobi', -1.29, 36.82, null], ['ww1', 'Léopoldville', -4.32, 15.31, 'Belgian Congo'],
  ['ww2', 'Delhi', 28.61, 77.21, 'British India'], ['ww2', 'Imphal', 24.82, 93.94, 'British India'], ['ww2', 'Rangoon', 16.8, 96.15, 'Burma'],
  ['ww2', 'Mandalay', 21.97, 96.08, 'Burma'], ['ww2', 'Kuala Lumpur', 3.14, 101.69, 'Malaya'], ['ww2', 'Ibadan', 7.38, 3.93, 'Nigeria'],
  ['ww2', 'Accra', 5.6, -0.19, 'Gold Coast'], ['ww2', 'Bo', 7.96, -11.74, 'Sierra Leone'], ['ww2', 'Nairobi', -1.29, 36.82, 'Kenya'],
  ['ww2', 'Mombasa', -4.05, 39.67, 'Kenya'], ['ww2', 'Kampala', 0.35, 32.58, 'Uganda'], ['ww2', 'Gulu', 2.78, 32.3, 'Uganda'], ['ww2', 'Dodoma', -6.17, 35.74, 'Tanganyika'], ['ww2', 'Nakuru', -0.3, 36.07, 'Kenya'], ['ww2', 'Dar es Salaam', -6.79, 39.21, 'Tanganyika'],
  ['ww2', 'Salisbury', -17.83, 31.05, 'Southern Rhodesia'], ['ww2', 'Bulawayo', -20.15, 28.58, 'Southern Rhodesia'],
  ['ww2', 'Lusaka', -15.42, 28.28, null], ['ww2', 'Léopoldville', -4.32, 15.31, 'Belgian Congo'],
];
const maps = {};
for (const [era, place, lat, lon, want] of CASES) {
  maps[era] ??= buildWorldMap(JSON.parse(readFileSync(new URL(`../data/eras/${era}.json`, import.meta.url), 'utf8')), getEra(era));
  const map = maps[era];
  const { x, y } = project(lon, lat);
  const p = map.provinces[pickProvince(map, x, y)];
  const got = p?.colony != null ? map.colonies[p.colony].name : null;
  check(got === want, `${era}: ${place} (${p?.name ?? 'sea'}) → ${got ?? 'no colony'}${got === want ? '' : `, expected ${want ?? 'none'}`}`);
}
for (const [era, map] of Object.entries(maps)) {
  check(map.colonies.every((c) => FLAG_INDEX[era].colonies[c.name] != null), `${era}: every colony has its flag tile (${map.colonies.map((c) => c.name).join(', ')})`);
}
console.log(failures ? `${failures} failure(s)` : 'all colony checks passed');
process.exit(failures ? 1 : 0);
