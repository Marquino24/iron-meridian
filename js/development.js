/**
 * development.js — How productive each province is, so the economy follows
 * real-world weight instead of land area.
 *
 * Provinces were cut roughly in proportion to land area, so counting them
 * made colonial empires and Siberia huge and compact industrial powers small
 * (WWII Germany earned a fifth of France). Every province now carries:
 *   devEco — multiplies money, steel and electronics
 *   devPop — multiplies food and manpower
 * computed once per map:
 *   1. Core vs periphery: provinces within 1,500 km of the capital, or
 *      connected to it by land within 4,500 km, are the core; the rest
 *      (overseas colonies, far frontiers) produce 0.35× (economy) and 0.6×
 *      (population).
 *   2. Polar land (beyond 58° latitude: Siberia, northern Canada,
 *      Greenland, Alaska) produces 0.35× / 0.4×.
 *   3. Other nations' output grows with the square root of their size
 *      instead of linearly, so big empty countries don't outproduce real
 *      economies (calibrated so a median-sized nation is unchanged).
 *   4. Major powers are scaled to real figures (GDP and population of the
 *      era, Maddison-style estimates): each gets the same income per unit of
 *      GDP, calibrated so the majors' average stays where it was.
 * The values belong to the province, so a conquered industrial region keeps
 * its worth for its new owner.
 */

import { unproject } from './projection.js';

const PERIPHERY_ECO = 0.35;
const PERIPHERY_POP = 0.6;
const CORE_KM = 1500;
const LAND_CORE_KM = 4500;
const POLAR_LAT = 58;
const POLAR_ECO = 0.35;
const POLAR_POP = 0.4;

/**
 * Real weight per era: [gdp, population]. GDP in billions of 1990 dollars
 * for the 20th century (modern: tens of billions, PPP), relative indices for
 * antiquity and 1200; population in millions. Homeland figures — colonies
 * are covered by the periphery rule.
 */
export const WEIGHTS = {
  rome: {
    'Roman Empire': [100, 60], 'Han Empire': [90, 58], 'Parthian Empire': [15, 10], 'Kushan Empire': [15, 12],
    'Saka Kingdom': [8, 6], 'Satavahana Empire': [25, 25], Goguryeo: [3, 3], Axum: [4, 4],
  },
  medieval: {
    'Song Empire': [110, 70], 'Mongol Empire': [20, 10], 'Holy Roman Empire': [24, 14], 'Byzantine Empire': [18, 10],
    'Almohad Caliphate': [16, 10], 'Kingdom of France': [20, 12], 'Angevin Empire': [14, 7], 'Khwarazmian dynasty': [16, 10],
  },
  ww1: {
    'United States': [517, 97], 'German Empire': [237, 65], 'Russian Empire': [232, 156], 'United Kingdom of Great Britain and Ireland': [225, 46],
    'French Republic': [145, 39], 'Austro-Hungarian Empire': [100, 51], 'Kingdom of Italy': [96, 37], 'Ottoman Empire': [25, 22],
  },
  ww2: {
    'United States': [800, 130], 'German Reich': [375, 79], 'Soviet Union': [359, 170], 'Republic of China': [290, 400],
    'United Kingdom': [285, 48], France: [186, 42], 'Empire of Japan': [176, 72], 'Kingdom of Italy': [141, 43],
  },
  coldwar: {
    'United States': [2046, 180], 'Soviet Union': [892, 214], 'Federal Republic of Germany': [558, 55], 'United Kingdom': [452, 52],
    "People's Republic of China": [450, 667], Japan: [375, 94], France: [347, 46], India: [326, 450],
  },
  modern: {
    China: [2400, 1410], 'United States of America': [2100, 332], India: [900, 1380], Japan: [530, 125],
    Germany: [450, 83], Russia: [430, 144], 'United Kingdom': [320, 67], France: [320, 68],
  },
};

const share = (p) => (p.isCapital ? 5 : p.isCity ? 3 : 1);

function km(a, b) {
  const R = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * R) / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(((b.lon - a.lon) * R) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const geomean = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);

/** Set p.devEco / p.devPop / p.core on every province of a map. */
export function assignDevelopment(map) {
  for (const p of map.provinces) { p.devEco = 1; p.devPop = 1; p.core = true; }
  if (map.kind !== 'world') return { scaled: [] };
  const ll = map.provinces.map((p) => unproject(p.center.x, p.center.y));

  // 1. Core and periphery per nation.
  for (const n of map.nations) {
    const cap = map.provinces[n.capitalId];
    if (!cap || cap.owner !== n.id) continue;
    const c = ll[cap.id];
    const landCore = new Set([cap.id]);
    const stack = [cap.id];
    while (stack.length) {
      const id = stack.pop();
      for (const nb of map.provinces[id].neighbors) {
        const q = map.provinces[nb];
        if (q.owner !== n.id || landCore.has(nb) || km(c, ll[nb]) > LAND_CORE_KM) continue;
        landCore.add(nb);
        stack.push(nb);
      }
    }
    for (const p of map.provinces) {
      if (p.owner !== n.id) continue;
      p.core = landCore.has(p.id) || km(c, ll[p.id]) <= CORE_KM;
      if (!p.core) { p.devEco = PERIPHERY_ECO; p.devPop = PERIPHERY_POP; }
    }
  }
  for (const p of map.provinces) {
    if (Math.abs(ll[p.id].lat) > POLAR_LAT) { p.devEco *= POLAR_ECO; p.devPop *= POLAR_POP; }
  }

  // 3. Size dampening for everyone without real figures.
  const weightsAll = WEIGHTS[map.era?.id] ?? {};
  const sizes = map.nations.map(() => 0);
  for (const p of map.provinces) if (p.owner >= 0) sizes[p.owner] += share(p) * p.devEco;
  const minorSizes = map.nations.filter((n) => !weightsAll[n.name] && sizes[n.id] > 0).map((n) => sizes[n.id]).sort((a, b) => a - b);
  if (minorSizes.length) {
    const c = Math.sqrt(minorSizes[Math.floor(minorSizes.length / 2)]);
    for (const p of map.provinces) {
      const n = map.nations[p.owner];
      if (!n || weightsAll[n.name] || !sizes[n.id]) continue;
      const f = Math.min(1.5, c / Math.sqrt(sizes[n.id]));
      p.devEco *= f;
      p.devPop *= Math.sqrt(f);
    }
  }

  // 4. Scale the major powers to their real weight.
  const weights = WEIGHTS[map.era?.id] ?? {};
  const rows = [];
  for (const n of map.nations) {
    const w = weights[n.name];
    if (!w) continue;
    let eco = 0, pop = 0;
    for (const p of map.provinces) if (p.owner === n.id) { eco += share(p) * p.devEco; pop += share(p) * p.devPop; }
    if (eco > 0) rows.push({ n, gdp: w[0], people: w[1], eco, pop });
  }
  if (!rows.length) return { scaled: [] };
  const kEco = geomean(rows.map((r) => r.eco / r.gdp));
  const kPop = geomean(rows.map((r) => r.pop / r.people));
  for (const r of rows) {
    const fe = Math.min(10, Math.max(0.25, (kEco * r.gdp) / r.eco));
    const fp = Math.min(10, Math.max(0.2, (kPop * r.people) / r.pop));
    for (const p of map.provinces) if (p.owner === r.n.id) { p.devEco *= fe; p.devPop *= fp; }
    r.fe = fe; r.fp = fp;
  }
  return { scaled: rows };
}
