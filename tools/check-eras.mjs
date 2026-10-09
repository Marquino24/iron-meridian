// Sanity checks for the prebuilt era maps (data/eras/*.json) after decoding
// with the runtime decoder: province counts, ownership, capitals, picking,
// adjacency symmetry and border segments.
import fs from 'node:fs';
import { buildWorldMap } from '../js/world.js';
import { ERAS } from '../js/eras.js';

let failed = 0;
for (const era of ERAS.filter((e) => !e.fictional)) {
  const data = JSON.parse(fs.readFileSync(new URL(`../data/eras/${era.id}.json`, import.meta.url)));
  const map = buildWorldMap(data, era);
  const P = map.provinces;
  const errs = [];
  if (P.length < 800 || P.length > 1200) errs.push(`province count ${P.length}`);
  const owned = new Map();
  for (const p of P) {
    if (!p.rings.length || p.rings.some((r) => r.length < 3)) errs.push(`bad rings ${p.id}`);
    if (p.owner >= 0) owned.set(p.owner, (owned.get(p.owner) ?? 0) + 1);
  }
  for (const n of map.nations) {
    if (!owned.get(n.id)) errs.push(`nation without land: ${n.name}`);
    if (P[n.capitalId]?.owner !== n.id) errs.push(`capital not owned: ${n.name}`);
  }
  if (map.nations.filter((n) => n.major).length < 6) errs.push('fewer than 6 major powers');
  let pickMiss = 0;
  for (const p of P) if (map.pickAt(p.center.x, p.center.y) !== p.id) pickMiss++;
  if (pickMiss > P.length * 0.01) errs.push(`picking misses ${pickMiss}`);
  let asym = 0;
  for (const p of P) for (const n of p.neighbors) if (!P[n].neighbors.includes(p.id)) asym++;
  const links = P.reduce((s, p) => s + p.neighbors.length, 0);
  if (asym > links * 0.05) errs.push(`asymmetric adjacency ${asym}/${links}`);
  const isolatedMainland = P.filter((p) => !p.neighbors.length && !p.coastal).length;
  if (isolatedMainland) errs.push(`${isolatedMainland} provinces with no neighbours and no coast`);
  const cities = P.filter((p) => p.isCity).length;
  console.log(`${era.id.padEnd(8)} ${P.length} provinces, ${map.nations.length} nations (${map.nations.filter((n) => n.major).length} major), ${cities} cities, ${map.seaZones.length} sea zones, ${map.borders.length} border segments, pick misses ${pickMiss}, asymmetric links ${asym}/${links}${errs.length ? '  FAIL: ' + errs.join('; ') : '  ok'}`);
  if (errs.length) failed++;
}
if (failed) process.exit(1);
