// The Fictional World goes to war: nations differ in stature (great powers,
// regional powers, minor states) and temperament, so within a year of AI play
// someone declares war on every seed tried.
//   node tools/check-fictional.mjs
import { simulate } from './sim-ai.mjs';
import { getEra } from '../js/eras.js';
import { generateMap, STATURE } from '../js/map.js';

let failures = 0;
for (const seed of ['SIM-0001', 'ABCD-1234', 'KRAKEN-7', 'VOLT-42']) {
  const map = generateMap(seed);
  const kinds = Object.keys(STATURE).map((k) => `${map.nations.filter((n) => n.stature === k).length} ${k}`).join(', ');
  process.env.SEED = seed;
  const r = simulate(getEra('fictional'), { months: 12, quiet: true });
  const wars = r.events.wars.length;
  const ok = wars > 0 && new Set(map.nations.map((n) => n.stature)).size === 3;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${seed}: ${kinds}; ${wars} wars, ${r.events.conquered.length} nations conquered in a year`);
}
console.log(failures ? `${failures} failure(s)` : 'all fictional-world checks passed');
process.exit(failures ? 1 : 0);
