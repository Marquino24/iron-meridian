// Sanity checks for map generation across many seeds: land count, connected
// nations, symmetric adjacency, city ratio, picking, unique names, determinism.
import { generateMap, pickProvince } from '../js/map.js';
let bad = 0; const times=[]; const lands=[];
for (let s = 0; s < 200; s++) {
  const seed = 'T' + s;
  const t = performance.now(); const m = generateMap(seed); times.push(performance.now()-t);
  const P = m.provinces; lands.push(P.length);
  const errs = [];
  if (P.length < 150 || P.length > 200) errs.push('land ' + P.length);
  if (m.nations.length !== 6) errs.push('nations');
  for (const p of P) { if (p.owner < 0) errs.push('unowned'); for (const n of p.neighbors) if (!P[n].neighbors.includes(p.id)) errs.push('asym'); }
  for (const n of m.nations) {
    const own = P.filter(p => p.owner === n.id);
    if (P[n.capitalId].owner !== n.id || !P[n.capitalId].isCity) errs.push('cap');
    const seen = new Set([n.capitalId]); const st=[n.capitalId];
    while (st.length) { const c = st.pop(); for (const nb of P[c].neighbors) if (P[nb].owner===n.id && !seen.has(nb)) { seen.add(nb); st.push(nb);} }
    if (seen.size !== own.length) errs.push('disconnected ' + n.id);
    if (own.length < 8) errs.push('tiny nation ' + own.length);
  }
  const cities = P.filter(p=>p.isCity).length; if (Math.abs(cities/P.length - 0.15) > 0.03) errs.push('cities '+cities);
  for (const p of P.slice(0,20)) if (pickProvince(m, p.site.x, p.site.y) !== p.id) errs.push('pick');
  if (new Set(P.map(p=>p.name)).size !== P.length) errs.push('dupe names');
  if (errs.length) { bad++; console.log(seed, [...new Set(errs)].join(', ')); }
}
const a = JSON.stringify(generateMap('ABC').provinces.map(p=>[p.name,p.owner])), b = JSON.stringify(generateMap('ABC').provinces.map(p=>[p.name,p.owner]));
console.log('deterministic', a===b, 'bad', bad, 'land min/max', Math.min(...lands), Math.max(...lands), 'avg ms', (times.reduce((x,y)=>x+y)/times.length).toFixed(1));
const m = generateMap('ABC'); console.log(m.nations.map(n=>n.name+' '+m.provinces.filter(p=>p.owner===n.id).length).join(' | ')); console.log(m.provinces.slice(0,12).map(p=>p.name).join(', '));
if (bad) process.exit(1);
