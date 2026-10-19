/**
 * build-eras.mjs — Turn real border datasets into playable era maps.
 *
 *   node tools/build-eras.mjs            build every era → data/eras/<id>.json
 *   node tools/build-eras.mjs ww2 modern build selected eras
 *
 * Pipeline per era:
 *   1. Download the raw GeoJSON (cached in data/raw/, git-ignored).
 *   2. Tag every feature with its sovereign group (colonies → ruling power),
 *      or mark it unclaimed when it names a people/culture rather than a state.
 *   3. mapshaper: clean → dissolve by group → simplify → clip to 58°S..84°N.
 *   4. Project (Miller) into world units.
 *   5. Seed provinces per country: real cities are fixed seeds, the rest are
 *      spread by best-candidate sampling; bigger countries get more seeds.
 *   6. Voronoi per country (d3-delaunay), each cell clipped to the country's
 *      real shape (polygon-clipping). Every bit of land lands in a province.
 *   7. For every province edge, find what lies across it: another province
 *      or a sea zone (sea zones = Voronoi cells of ocean sample points).
 *   8. Terrain from real mountain ranges / climate bands, names, colours,
 *      flags → compact JSON (quantized, delta-encoded rings).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';
import { Delaunay } from 'd3-delaunay';
import polygonClipping from 'polygon-clipping';
import { project, WORLD_WIDTH, WORLD_HEIGHT, LAT_MIN, LAT_MAX, unproject } from '../js/projection.js';
import { createRng, createNameGenerator, hashSeed } from '../js/map.js';
import { ERAS, SOURCES, NE_PLACES, NON_STATE_RE, FOUNDED, RENAMES } from './era-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data/raw');
const OUT = path.join(ROOT, 'data/eras');

const CFG = {
  targetProvinces: 3600,  // land provinces worldwide, historical eras (cities included)
  targetModern: 2300,     // modern era: admin-1 regions, merged or split toward this
  admin1Simplify: '5%',
  sizeExponent: 0.68,     // n ∝ area^k: sub-linear so mid-size countries still get detail
  simplify: '12%',
  quantum: 0.2,           // coordinate precision in world units (~2 km)
  seaSpacing: 95,         // sea-zone sample spacing in world units
  cityMergeDist: 7,       // cities closer than this collapse into the more important one
  extraCities: { ww1: 90, ww2: 100, coldwar: 110, modern: 90 },
};

const PALETTE = [
  '#7c8fb0', '#b0846a', '#8aa86b', '#a77bab', '#5fa3a0', '#c9a35a', '#9a6f5a', '#6f8f7f', '#b56f6f', '#7a7fc4',
  '#a4a45c', '#c58bb0', '#5f8fc4', '#8c6fae', '#bf8f4f', '#6faf8f', '#a85f7f', '#8fa0b8', '#c47a5a', '#7fa05a',
];
const FLAG_TINTS = ['#ece6d6', '#16191c', '#c9a63c', '#8e2323', '#1f3f6b', '#2e5b34'];
const FLAG_PATTERNS = ['h3', 'v3', 'h2', 'v2', 'cross', 'canton', 'diag'];

const norm = (s) => String(s).normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase();

// ---------------------------------------------------------------------------
// Data download
// ---------------------------------------------------------------------------

function ensureRaw(file, url) {
  const p = path.join(RAW, file);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(RAW, { recursive: true });
    console.log(`  downloading ${url}`);
    // curl honours the environment's proxy settings; Node's fetch does not.
    execFileSync('curl', ['-sSfL', '--retry', '3', url, '-o', p]);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ---------------------------------------------------------------------------
// Geometry helpers (world units, rings as [[x,y], ...] without closing point)
// ---------------------------------------------------------------------------

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return a / 2;
}
const polyArea = (poly) => Math.abs(ringArea(poly[0])) - poly.slice(1).reduce((s, h) => s + Math.abs(ringArea(h)), 0);

function pointInRing(x, y, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Even-odd over every ring: works for multipolygons with holes. */
function pointInRings(x, y, rings) {
  let inside = false;
  for (const r of rings) if (pointInRing(x, y, r)) inside = !inside;
  return inside;
}

function bboxOf(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Drop closing points and degenerate rings from a polygon-clipping result. */
function openMultiPolygon(mp) {
  const out = [];
  for (const poly of mp) {
    const rings = poly
      .map((r) => {
        const o = r.slice();
        if (o.length > 1 && o[0][0] === o[o.length - 1][0] && o[0][1] === o[o.length - 1][1]) o.pop();
        return o;
      })
      .filter((r) => r.length >= 3);
    if (rings.length && Math.abs(ringArea(rings[0])) > 1e-6) out.push(rings);
  }
  return out;
}
const closeRing = (r) => [...r, r[0]];

/** Uniform grid of bounding boxes for fast point lookups. */
class GridIndex {
  constructor(cell = 40) {
    this.cell = cell;
    this.cols = Math.ceil(WORLD_WIDTH / cell) + 1;
    this.buckets = new Map();
  }
  insert(id, [x0, y0, x1, y1]) {
    const c = this.cell;
    for (let gx = Math.floor(x0 / c); gx <= Math.floor(x1 / c); gx++) {
      for (let gy = Math.floor(y0 / c); gy <= Math.floor(y1 / c); gy++) {
        const k = gy * this.cols + gx;
        if (!this.buckets.has(k)) this.buckets.set(k, []);
        this.buckets.get(k).push(id);
      }
    }
  }
  query(x, y) {
    return this.buckets.get(Math.floor(y / this.cell) * this.cols + Math.floor(x / this.cell)) ?? [];
  }
}

// ---------------------------------------------------------------------------
// Terrain from real geography
// ---------------------------------------------------------------------------

/** Major mountain ranges as [lon, lat] polylines with a half-width in degrees. */
const RANGES = [
  [[[5.5, 44.2], [7, 45.8], [10, 46.5], [13, 47.2], [15.5, 47.5]], 1.0],          // Alps
  [[[-1.5, 43], [2.5, 42.6]], 0.6],                                                 // Pyrenees
  [[[18, 49.3], [22, 49], [25, 47.8], [26.5, 45.8], [23, 45.4]], 0.9],             // Carpathians
  [[[15, 45], [19, 42.5], [21, 41.5]], 0.9],                                        // Dinaric
  [[[38, 44], [44, 42.7], [49, 41]], 1.0],                                          // Caucasus
  [[[44, 37], [48, 33], [52, 30], [57, 27.5]], 1.4],                                // Zagros
  [[[49, 36.8], [54, 36.3]], 0.8],                                                  // Alborz
  [[[66, 34.5], [71, 36], [74, 38.5]], 1.6],                                        // Hindu Kush / Pamir
  [[[73, 35], [78, 32], [84, 28.7], [88, 27.8], [92, 28], [96, 28.5]], 1.6],       // Himalaya
  [[[78, 34], [87, 33], [95, 33]], 3.0],                                            // Tibetan plateau
  [[[70, 41.5], [78, 42], [86, 43]], 1.6],                                          // Tian Shan
  [[[86, 50], [90, 49]], 1.6],                                                      // Altai
  [[[97, 48], [102, 47]], 1.5],                                                     // Khangai
  [[[98, 26], [100, 31]], 2.0],                                                     // Hengduan
  [[[30, 37], [36, 37.3], [40, 38.3]], 0.9],                                        // Taurus
  [[[-9, 30.5], [-5, 32], [0, 33], [5, 35], [9, 36]], 1.0],                        // Atlas
  [[[38, 8], [38.5, 12]], 2.2],                                                     // Ethiopian Highlands
  [[[42, 18], [44, 14]], 1.0],                                                      // Asir / Yemen
  [[[59, 50], [59.5, 56], [60, 62], [63, 67]], 1.0],                                // Urals
  [[[6, 59], [9, 62], [14, 66], [19, 69]], 1.4],                                    // Scandinavian
  [[[-108, 32], [-106, 38], [-110, 44], [-115, 49], [-121, 54], [-130, 58], [-140, 61]], 2.5], // Rockies
  [[[-118.5, 36], [-121, 40], [-121.5, 46]], 1.0],                                  // Sierra Nevada / Cascades
  [[[-155, 62], [-145, 62.5]], 1.5], [[[-160, 68], [-145, 68.5]], 1.5],             // Alaska / Brooks
  [[[-106, 26], [-103, 22], [-98, 18]], 1.5],                                       // Sierra Madre
  [[[-84, 34.5], [-80, 37.5], [-77, 40], [-73, 43.5]], 1.0],                        // Appalachians
  [[[-75, 10], [-77, 3], [-78.5, -2], [-76, -10], [-71, -15], [-68, -20], [-69, -25], [-70, -33], [-71, -40], [-72, -47], [-73, -52]], 2.0], // Andes
  [[[28, -31], [30, -28]], 1.0],                                                    // Drakensberg
  [[[146, -37.5], [149, -33], [151, -29], [147, -21], [145, -17]], 1.2],            // Great Dividing
  [[[167, -46], [171, -43.5], [173, -41.5]], 0.9],                                  // Southern Alps
  [[[137, 35.5], [138.5, 36.5]], 0.8],                                              // Japanese Alps
  [[[128, 65], [135, 67]], 2.0], [[[135, 60], [150, 63], [160, 64]], 2.5],          // Verkhoyansk / Kolyma
  [[[138, -4.3], [145, -6]], 1.2],                                                  // New Guinea Highlands
  [[[95.5, 4.5], [101, -1], [104, -4.5]], 0.8],                                     // Barisan
];
const FOREST_BOXES = [
  [-79, -15, -45, 5], [9, -6, 30, 5], [95, -10, 150, 20], [-12, 4, 10, 8], [-92, 7, -77, 18], // tropical
];

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function terrainAt(lon, lat, rand) {
  for (const [line, w] of RANGES) {
    for (let i = 0; i < line.length - 1; i++) if (distToSegment(lon, lat, line[i], line[i + 1]) < w) return 'mountains';
  }
  for (const [x0, y0, x1, y1] of FOREST_BOXES) if (lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1) return rand < 0.8 ? 'forest' : 'plains';
  const boreal = lat >= 50 && lat <= 66 && ((lon > -10 && lon < 180) || (lon > -170 && lon < -55));
  if (boreal) return rand < 0.72 ? 'forest' : 'plains';
  if (lat >= 38 && lat < 50) return rand < 0.35 ? 'forest' : 'plains';
  return 'plains';
}

// ---------------------------------------------------------------------------
// Step 2: group features by sovereign
// ---------------------------------------------------------------------------

function tagFeatures(era, src) {
  const groups = new Map(); // key → { key, unclaimed, members: [{name, lon, lat, area}] }
  for (const f of src.features) {
    const p = f.properties;
    let key, name;
    if (era.source === 'ne') {
      key = p.SOVEREIGNT;
      name = p.ADMIN;
    } else {
      name = p.NAME;
      if (!name) key = '~Unknown';
      else if (NON_STATE_RE.test(name)) key = `~${name.trim()}`;
      else {
        const subj = typeof p.SUBJECTO === 'string' && !/^\d+$/.test(p.SUBJECTO) ? p.SUBJECTO : name;
        key = era.aliases[subj] ?? era.aliases[name] ?? subj;
      }
    }
    if (key === 'Antarctica') continue;
    f.properties = { G: key };
    if (!groups.has(key)) groups.set(key, { key, unclaimed: key.startsWith('~'), members: [] });
    const c = roughCentroid(f.geometry);
    if (c) groups.get(key).members.push({ name, ...c });
  }
  return groups;
}

/** Area-weighted lon/lat centroid of a GeoJSON geometry's outer rings. */
function roughCentroid(g) {
  if (!g) return null;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let A = 0, X = 0, Y = 0;
  for (const poly of polys) {
    const r = poly[0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const cr = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      a += cr; cx += (r[j][0] + r[i][0]) * cr; cy += (r[j][1] + r[i][1]) * cr;
    }
    if (Math.abs(a) < 1e-9) continue;
    A += Math.abs(a / 2); X += (cx / (3 * a)) * Math.abs(a / 2); Y += (cy / (3 * a)) * Math.abs(a / 2);
  }
  return A ? { lon: X / A, lat: Y / A, area: A } : null;
}

/** The member feature that represents the home country (for display name + capital fallback). */
function metropole(group) {
  const exact = group.members.find((m) => m.name === group.key);
  if (exact) return exact;
  const containing = group.members.filter((m) => m.name && m.name.includes(group.key)).sort((a, b) => b.area - a.area)[0];
  return containing ?? group.members.slice().sort((a, b) => b.area - a.area)[0];
}

function displayName(era, group) {
  if (era.names?.[group.key]) return era.names[group.key];
  if (era.source === 'ne') return group.key;
  // Prefer a more formal member name that contains the key ("Kingdom of Italy" for "Italy").
  const formal = group.members.map((m) => m.name).filter((n) => n && n !== group.key && n.includes(group.key) && !n.includes('('));
  return formal.sort((a, b) => b.length - a.length)[0] ?? group.key;
}

function shortName(era, group, name) {
  if (era.shortNames?.[group.key]) return era.shortNames[group.key];
  // A curated long name ("French Republic") keeps the dataset's short key ("France") for map labels.
  if (era.names?.[group.key] && era.source === 'hb') return group.key;
  return name
    .replace(/^(The )?(Kingdom|Empire|Republic|Principality|Grand Duchy|Duchy|Sultanate|Emirate|Free State|Dominion|Commonwealth|Union|Federation) of (the )?/i, '')
    .replace(/,.*$/, '');
}

// ---------------------------------------------------------------------------
// Steps 3–4: mapshaper + projection
// ---------------------------------------------------------------------------

async function simplifyAndProject(src) {
  const cmd = `-i in.json -clean -dissolve2 G -simplify ${CFG.simplify} keep-shapes -clip bbox=-180,${LAT_MIN},180,${LAT_MAX} -clean -o out.json precision=0.0001`;
  const out = await mapshaper.applyCommands(cmd, { 'in.json': src });
  const gj = JSON.parse(out['out.json']);
  const shapes = new Map();
  for (const f of gj.features) {
    if (!f.geometry) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const projected = polys.map((poly) => poly.map((ring) => ring.map(([lon, lat]) => {
      const p = project(lon, lat);
      return [p.x, p.y];
    })));
    // Re-run through polygon-clipping (union with itself) to normalise orientation and drop slivers.
    const clean = openMultiPolygon(polygonClipping.union(projected));
    if (clean.length) shapes.set(f.properties.G, clean);
  }
  return shapes;
}

// ---------------------------------------------------------------------------
// Cities and capitals
// ---------------------------------------------------------------------------

/**
 * Modern era: Natural Earth admin-1 regions (states, provinces) with real
 * names. Countries that the dataset splits very finely (UK local
 * authorities, Slovenian municipalities…) are grouped by the dataset's own
 * `region` field when that is closer to the country's province budget.
 * Returns nation shapes (dissolved from the same simplified regions, so
 * borders line up exactly) and the region units.
 */
async function loadAdmin1(era, admin0) {
  const src = ensureRaw(era.admin1.file, era.admin1.url);
  const sovOf = new Map();
  for (const f of admin0.features) sovOf.set(f.properties.ADM0_A3, f.properties.SOVEREIGNT);
  const sovBySov3 = new Map();
  for (const f of admin0.features) sovBySov3.set(f.properties.SOV_A3, f.properties.SOVEREIGNT);

  // Projected area of every raw unit → per-country province budget.
  const projArea = (g) => {
    if (!g) return 0;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    let a = 0;
    for (const poly of polys) poly.forEach((ring, i) => {
      const r = ring.map(([lon, lat]) => { const p = project(lon, Math.max(LAT_MIN, Math.min(LAT_MAX, lat))); return [p.x, p.y]; });
      a += (i === 0 ? 1 : -1) * Math.abs(ringArea(r));
    });
    return Math.max(0, a);
  };
  const units = [];
  for (const f of src.features) {
    const p = f.properties;
    const sov = sovOf.get(p.adm0_a3) ?? sovBySov3.get(p.sov_a3) ?? p.admin;
    if (!sov || sov === 'Antarctica') continue;
    const name = (p.name_en || p.name || p.gn_name || p.admin || '').trim();
    units.push({ f, sov, name, region: (p.region || '').trim(), area: projArea(f.geometry) });
  }
  const bySov = new Map();
  for (const u of units) { if (!bySov.has(u.sov)) bySov.set(u.sov, []); bySov.get(u.sov).push(u); }
  const countryArea = new Map([...bySov].map(([k, us]) => [k, us.reduce((s, u) => s + u.area, 0)]));
  const budget = budgetFor(countryArea, CFG.targetModern);

  let regionGrouped = 0;
  for (const [sov, us] of bySov) {
    const n = budget.get(sov);
    const regions = new Set(us.map((u) => u.region).filter(Boolean));
    const useRegion = us.length > n * 1.5 && regions.size >= 2 && us.every((u) => u.region)
      && Math.abs(Math.log(regions.size / n)) < Math.abs(Math.log(us.length / n));
    if (useRegion) regionGrouped++;
    us.forEach((u, i) => {
      u.key = useRegion ? `${sov}|${u.region}` : `${sov}|${u.f.properties.ne_id ?? i}|${u.name}`;
      u.label = useRegion ? u.region : u.name;
    });
  }
  const tagged = {
    type: 'FeatureCollection',
    features: units.map((u) => ({ type: 'Feature', geometry: u.f.geometry, properties: { U: u.key, G: u.sov, N: u.label } })),
  };
  const cmd = `-i in.json name=units -clean -dissolve2 U copy-fields=G,N -simplify ${CFG.admin1Simplify} keep-shapes -clip bbox=-180,${LAT_MIN},180,${LAT_MAX} -clean `
    + `-dissolve2 G target=units + name=nations -o target=units,nations format=geojson precision=0.0001`;
  const out = await mapshaper.applyCommands(cmd, { 'in.json': tagged });
  const projectMp = (g) => {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const projected = polys.map((poly) => poly.map((ring) => ring.map(([lon, lat]) => { const p = project(lon, lat); return [p.x, p.y]; })));
    return openMultiPolygon(polygonClipping.union(projected));
  };
  const nations = new Map();
  for (const f of JSON.parse(out['nations.json']).features) {
    if (!f.geometry) continue;
    const mp = projectMp(f.geometry);
    if (mp.length) nations.set(f.properties.G, mp);
  }
  const regionUnits = [];
  for (const f of JSON.parse(out['units.json']).features) {
    if (!f.geometry) continue;
    const mp = projectMp(f.geometry);
    if (!mp.length) continue;
    regionUnits.push({ sov: f.properties.G, name: f.properties.N, mp, rings: mp.flat(), area: mp.reduce((s, poly) => s + polyArea(poly), 0) });
  }
  console.log(`     admin-1: ${units.length} source regions → ${regionUnits.length} units (${regionGrouped} countries grouped by region)`);
  return { shapes: nations, units: regionUnits, budget };
}

/** Province budget per country: n ∝ area^k, scaled so the total is near `target`. */
function budgetFor(areas, target, weightOf = () => 1) {
  const w = (a, k) => Math.pow(Math.max(a, 1), CFG.sizeExponent) * k;
  let lo = 0, hi = 50;
  const count = (m) => [...areas].reduce((s, [key, a]) => s + Math.max(1, Math.round(m * w(a, weightOf(key)))), 0);
  for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; if (count(mid) > target) hi = mid; else lo = mid; }
  return new Map([...areas].map(([key, a]) => [key, Math.max(1, Math.round(lo * w(a, weightOf(key))))]));
}

/** "North", "South-East"… for the part of a split region relative to its centre. */
const COMPASS = ['East', 'North-East', 'North', 'North-West', 'West', 'South-West', 'South', 'South-East'];
function compassName(dx, dy, spread) {
  if (Math.hypot(dx, dy) < spread * 0.35) return 'Central';
  const a = Math.atan2(-dy, dx); // screen y grows downward
  return COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

function loadPlaces() {
  const gj = ensureRaw(NE_PLACES.file, NE_PLACES.url);
  return gj.features.map((f) => {
    const p = f.properties;
    return {
      key: norm(p.nameascii || p.name),
      name: p.name.replace(/\s+/g, ' ').replace('Shenyeng', 'Shenyang').replace('Washington, D.C.', 'Washington'),
      lat: p.latitude, lon: p.longitude, pop: p.pop_max,
      cap: /Admin-0 capital$/.test(p.featurecla),
    };
  });
}

function eraCityName(era, place) {
  const r = RENAMES[place.key];
  if (r && r[era.id]) return r[era.id];
  if (r && era.id === 'modern' && r.modern) return r.modern;
  return place.name;
}

// ---------------------------------------------------------------------------
// Main build for one era
// ---------------------------------------------------------------------------

async function buildEra(era, places) {
  const t0 = Date.now();
  const rng = createRng(`iron-meridian:${era.id}`);
  const src = ensureRaw(era.file, era.url);
  // Admin-1 needs admin-0's original properties, so it runs before tagging.
  const admin1 = era.admin1 ? await loadAdmin1(era, src) : null;
  const groups = tagFeatures(era, src);
  const shapes = admin1 ? admin1.shapes : await simplifyAndProject(src);

  // --- Countries (nations + unclaimed regions) with geometry -----------------
  const countries = [];
  for (const [key, mp] of shapes) {
    const g = groups.get(key);
    if (!g) continue;
    const rings = mp.flat();
    countries.push({
      key, group: g, unclaimed: g.unclaimed, mp, rings,
      area: mp.reduce((s, poly) => s + polyArea(poly), 0),
      bbox: bboxOf(rings),
      cities: [],
    });
  }
  const countryIndex = new GridIndex(60);
  countries.forEach((c, i) => countryIndex.insert(i, c.bbox));
  const countryAt = (x, y) => {
    for (const i of countryIndex.query(x, y)) if (pointInRings(x, y, countries[i].rings)) return i;
    return -1;
  };
  /** Snap a point that fell into the sea (simplified coast) onto nearby land. */
  const snapToLand = (x, y, preferred = -1) => {
    const hit = countryAt(x, y);
    if (hit >= 0) return { x, y, country: hit };
    for (const r of [1.5, 3, 5, 8, 12]) {
      let best = null;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        const c = countryAt(px, py);
        if (c >= 0 && (!best || c === preferred)) best = { x: px, y: py, country: c };
      }
      if (best) return best;
    }
    return null;
  };

  /** Nearest point of a specific country within `maxR` units (for capitals near a border). */
  const nearestInCountry = (x, y, ci, maxR = 30) => {
    if (countryAt(x, y) === ci) return { x, y, country: ci };
    for (let r = 1; r <= maxR; r += r < 6 ? 1 : 2) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (countryAt(px, py) === ci) return { x: px, y: py, country: ci };
      }
    }
    return null;
  };

  // --- Capitals ---------------------------------------------------------------
  const stats = { capitalsCurated: 0, capitalsFromNE: 0, capitalsGenerated: 0, unplaced: [] };
  const nationCountries = countries.filter((c) => !c.unclaimed);
  const eraYear = era.dataYear;
  const neCapitals = places.filter((p) => p.cap && (FOUNDED[p.key] ?? 0) <= eraYear);

  for (const c of nationCountries) {
    const ci = countries.indexOf(c);
    let cap = null;
    const cur = era.capitals?.[c.key];
    if (cur) {
      const pt = project(cur[2], cur[1]);
      const s = nearestInCountry(pt.x, pt.y, ci);
      if (s) { cap = { name: cur[0], x: s.x, y: s.y }; stats.capitalsCurated++; }
      else stats.unplaced.push(`${c.key} capital ${cur[0]}`);
    }
    if (!cap && era.id !== 'rome' && era.id !== 'medieval') {
      // Natural Earth national capitals inside this territory, nearest the home country.
      const home = metropole(c.group);
      const hp = project(home.lon, home.lat);
      let best = null, bd = Infinity;
      for (const p of neCapitals) {
        const pt = project(p.lon, p.lat);
        if (pt.x < c.bbox[0] - 15 || pt.x > c.bbox[2] + 15 || pt.y < c.bbox[1] - 15 || pt.y > c.bbox[3] + 15) continue;
        const s = snapToLand(pt.x, pt.y, ci);
        if (!s || s.country !== ci) continue;
        const d = Math.hypot(s.x - hp.x, s.y - hp.y);
        if (d < bd) { bd = d; best = { name: eraCityName(era, p), x: s.x, y: s.y }; }
      }
      if (best) { cap = best; stats.capitalsFromNE++; }
    }
    c.capital = cap; // null → generated later
    if (cap) c.cities.push({ ...cap, capital: true, priority: 0 });
  }

  // --- Other major cities -------------------------------------------------------
  const cityPoints = [];
  if (era.cities) {
    era.cities.forEach(([name, lat, lon], i) => cityPoints.push({ name, ...xy(lon, lat), priority: 1 + i }));
  } else {
    const n = CFG.extraCities[era.id] ?? 80;
    const sorted = places.filter((p) => (FOUNDED[p.key] ?? 0) <= eraYear).sort((a, b) => b.pop - a.pop);
    for (const p of sorted.slice(0, n * 2)) cityPoints.push({ name: eraCityName(era, p), ...xy(p.lon, p.lat), priority: 1 + cityPoints.length });
  }
  const allCities = () => countries.flatMap((c) => c.cities);
  let added = 0;
  const limit = era.cities ? Infinity : (CFG.extraCities[era.id] ?? 80);
  for (const cp of cityPoints) {
    if (added >= limit) break;
    const s = snapToLand(cp.x, cp.y);
    if (!s) continue;
    if (allCities().some((o) => Math.hypot(o.x - s.x, o.y - s.y) < CFG.cityMergeDist)) continue;
    countries[s.country].cities.push({ name: cp.name, x: s.x, y: s.y, capital: false, priority: cp.priority });
    added++;
  }

  // Big countries get at least a few of their own largest cities, even when
  // they are missing from the global top list (e.g. the USSR in 1938).
  if (!era.cities) {
    const ranked = places.filter((p) => (FOUNDED[p.key] ?? 0) <= eraYear).sort((a, b) => b.pop - a.pop);
    for (const [ci, c] of countries.entries()) {
      if (c.unclaimed) continue;
      const want = Math.min(8, Math.floor(Math.pow(c.area, 0.5) / 55));
      for (const p of ranked) {
        if (c.cities.length >= want) break;
        const pt = project(p.lon, p.lat);
        if (pt.x < c.bbox[0] || pt.x > c.bbox[2] || pt.y < c.bbox[1] || pt.y > c.bbox[3]) continue;
        const s = snapToLand(pt.x, pt.y, ci);
        if (!s || s.country !== ci) continue;
        if (allCities().some((o) => Math.hypot(o.x - s.x, o.y - s.y) < CFG.cityMergeDist * 1.5)) continue;
        c.cities.push({ name: eraCityName(era, p), x: s.x, y: s.y, capital: false, priority: 500 });
      }
    }
  }

  // Curated key cities of the major powers (era-config majorCities): their real
  // industrial centres, which the population-ranked pick above misses.
  if (era.majorCities) {
    stats.curatedCities = 0;
    for (const [ci, c] of countries.entries()) {
      for (const [name, lat, lon] of era.majorCities[c.key] ?? []) {
        const pt = project(lon, lat);
        const s = snapToLand(pt.x, pt.y, ci);
        if (!s || s.country !== ci) continue;
        if (c.cities.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < CFG.cityMergeDist)) continue;
        c.cities.push({ name, x: s.x, y: s.y, capital: false, priority: 2 });
        stats.curatedCities++;
      }
    }
  }

  // --- Province counts per country ------------------------------------------------
  // Unclaimed land (peoples/cultures) gets fewer, larger provinces so states get the detail.
  const weight = (c) => Math.pow(Math.max(c.area, 1), CFG.sizeExponent) * (c.unclaimed ? 0.3 : 1);
  const countFor = (c, k) => Math.max(1, c.cities.length, Math.round(k * weight(c)));
  let lo = 0, hi = 10;
  for (let it = 0; it < 50; it++) {
    const mid = (lo + hi) / 2;
    const total = countries.reduce((s, c) => s + countFor(c, mid), 0);
    if (total > CFG.targetProvinces) hi = mid; else lo = mid;
  }
  for (const c of countries) c.nProvinces = countFor(c, lo);
  if (admin1) for (const c of countries) c.nProvinces = admin1.budget.get(c.key) ?? 1;

  // --- Seeds and clipped Voronoi cells ----------------------------------------------
  const provinces = [];
  if (admin1) buildAdmin1Provinces(rng, countries, admin1.units, provinces, stats);
  for (const [ci, c] of countries.entries()) {
    if (admin1) break;
    const seeds = c.cities.map((city) => ({ x: city.x, y: city.y, city }));
    const cellArea = c.area / c.nProvinces;
    // Pieces (islands) big enough to deserve their own province.
    const pieces = c.mp.map((poly) => ({ poly, area: polyArea(poly), bbox: bboxOf(poly) })).sort((a, b) => b.area - a.area);
    const significant = pieces.filter((p, i) => i === 0 || p.area >= Math.max(30, cellArea * 0.45));
    const remaining = Math.max(0, c.nProvinces - seeds.length);
    // Distribute generated seeds across pieces by area; each significant piece without a city gets ≥1.
    const quota = new Map();
    for (const p of significant) {
      const hasCity = seeds.some((s) => pointInRings(s.x, s.y, p.poly));
      if (!hasCity) quota.set(p, 1);
    }
    let used = [...quota.values()].reduce((a, b) => a + b, 0);
    const sigArea = significant.reduce((s, p) => s + p.area, 0);
    let left = Math.max(0, remaining - used);
    for (const p of significant) {
      const extra = Math.floor((left * p.area) / sigArea);
      quota.set(p, (quota.get(p) ?? 0) + extra);
    }
    used = [...quota.values()].reduce((a, b) => a + b, 0);
    for (let i = 0; used < Math.max(remaining, quota.size) && i < significant.length * 4; i++) {
      const p = significant[i % significant.length];
      quota.set(p, (quota.get(p) ?? 0) + 1);
      used++;
    }
    for (const [piece, q] of quota) {
      for (let k = 0; k < q; k++) {
        const pt = bestCandidate(rng, piece, seeds, 12);
        if (pt) seeds.push(pt);
      }
    }
    if (!seeds.length) {
      const pt = bestCandidate(rng, pieces[0], seeds, 1);
      if (pt) seeds.push(pt);
    }
    if (!seeds.length) continue;

    let cells;
    if (seeds.length === 1) {
      cells = [c.mp];
    } else {
      const [x0, y0, x1, y1] = c.bbox;
      const vor = Delaunay.from(seeds.map((s) => [s.x, s.y])).voronoi([x0 - 1, y0 - 1, x1 + 1, y1 + 1]);
      const clipGeom = c.mp.map((poly) => poly.map(closeRing));
      cells = seeds.map((_, i) => {
        const cell = vor.cellPolygon(i);
        if (!cell) return [];
        return openMultiPolygon(polygonClipping.intersection([cell], clipGeom));
      });
    }
    seeds.forEach((s, i) => {
      const mp = cells[i];
      if (!mp || !mp.length) {
        if (s.city) stats.unplaced.push(`city ${s.city.name}`);
        return;
      }
      provinces.push({
        country: ci, seed: s, city: s.city ?? null, mp,
        rings: mp.flat(), area: mp.reduce((a, poly) => a + polyArea(poly), 0),
      });
    });
  }

  // Generated capitals for nations without a real one: the province nearest the territory's centre.
  for (const [ci, c] of countries.entries()) {
    if (c.unclaimed || c.capital) continue;
    const own = provinces.filter((p) => p.country === ci);
    if (!own.length) continue;
    const big = c.mp.slice().sort((a, b) => polyArea(b) - polyArea(a))[0];
    const [bx0, by0, bx1, by1] = bboxOf(big);
    const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
    const p = own.slice().sort((a, b) => Math.hypot(a.seed.x - cx, a.seed.y - cy) - Math.hypot(b.seed.x - cx, b.seed.y - cy))[0];
    p.city = { name: null, capital: true, generated: true };
    stats.capitalsGenerated++;
  }

  // --- Province lookup index ------------------------------------------------------------
  provinces.forEach((p, i) => { p.id = i; p.bbox = bboxOf(p.rings); });
  const pindex = new GridIndex(30);
  provinces.forEach((p) => pindex.insert(p.id, p.bbox));
  const provinceAt = (x, y, exclude = -1) => {
    for (const i of pindex.query(x, y)) if (i !== exclude && pointInRings(x, y, provinces[i].rings)) return i;
    return -1;
  };

  // --- Sea zones ----------------------------------------------------------------------------
  const seaSites = [], allSites = [];
  const sp = CFG.seaSpacing;
  for (let y = sp / 2; y < WORLD_HEIGHT; y += sp) {
    for (let x = sp / 2; x < WORLD_WIDTH; x += sp) {
      const px = x + rng.range(-0.35, 0.35) * sp, py = y + rng.range(-0.35, 0.35) * sp;
      const sea = provinceAt(px, py) < 0;
      allSites.push({ x: px, y: py, sea });
      if (sea) seaSites.push(allSites.length - 1);
    }
  }
  const allDel = Delaunay.from(allSites.map((s) => [s.x, s.y]));
  const allVor = allDel.voronoi([0, 0, WORLD_WIDTH, WORLD_HEIGHT]);
  const seaIdOfSite = new Int32Array(allSites.length).fill(-1);
  seaSites.forEach((si, i) => { seaIdOfSite[si] = i; });
  const seaDel = Delaunay.from(seaSites.map((si) => [allSites[si].x, allSites[si].y]));
  const seas = seaSites.map((si, i) => ({
    id: i,
    site: allSites[si],
    polygon: (allVor.cellPolygon(si) ?? []).slice(0, -1),
    neighbors: [...allDel.neighbors(si)].filter((n) => allSites[n].sea).map((n) => seaIdOfSite[n]),
    coastal: new Set(),
  }));

  // --- Edge adjacency -----------------------------------------------------------------------------
  const LAKE = seas.length; // sea id meaning "coast with no sea zone" (lake / inland gap)
  for (const p of provinces) {
    p.edges = p.rings.map((ring) => ring.map((a, k) => {
      const b = ring[(k + 1) % ring.length];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      for (const eps of [0.3, 1.2, 2.5]) {
        for (const sgn of [1, -1]) {
          const qx = mx + nx * eps * sgn, qy = my + ny * eps * sgn;
          if (pointInRings(qx, qy, p.rings)) continue; // this side is our own land
          const other = provinceAt(qx, qy, p.id);
          if (other >= 0) return other;
        }
      }
      // Sea: the nearest ocean sample on the outer side.
      const qx = mx + nx * 1.2, qy = my + ny * 1.2;
      const ox = pointInRings(qx, qy, p.rings) ? mx - nx * 1.2 : qx;
      const oy = pointInRings(qx, qy, p.rings) ? my - ny * 1.2 : qy;
      const s = seaDel.find(ox, oy);
      const site = allSites[seaSites[s]];
      if (Math.hypot(site.x - ox, site.y - oy) > sp * 1.6) return -1 - LAKE;
      seas[s].coastal.add(p.id);
      return -1 - s;
    }));
  }

  // --- Terrain, names ---------------------------------------------------------------------------------
  const names = createNameGenerator(createRng(`names:${era.id}`));
  for (const p of provinces) {
    const { lon, lat } = unproject(p.seed.x, p.seed.y);
    const r = (hashSeed(`${era.id}:${p.id}`) % 1000) / 1000;
    p.terrain = p.city && !p.city.generated && (p.city.capital || r < 0.6) ? 'urban' : terrainAt(lon, lat, r);
    p.name = p.regionName ?? p.city?.name ?? names();
  }

  // --- Nations: order by size, colours (neighbours differ), flags ------------------------------------
  const nationOrder = countries
    .map((c, ci) => ({ c, ci }))
    .filter(({ c, ci }) => !c.unclaimed && provinces.some((p) => p.country === ci))
    .sort((a, b) => b.c.area - a.c.area);
  const nationOfCountry = new Map(nationOrder.map(({ ci }, i) => [ci, i]));
  const adjacency = nationOrder.map(() => new Set());
  for (const p of provinces) {
    const a = nationOfCountry.get(p.country);
    if (a === undefined) continue;
    for (const ring of p.edges) for (const n of ring) {
      const b = n >= 0 ? nationOfCountry.get(provinces[n].country) : undefined;
      if (b !== undefined && b !== a) { adjacency[a].add(b); adjacency[b].add(a); }
    }
  }
  const colors = [];
  const usage = new Map();
  nationOrder.forEach(({ c }, i) => {
    const fixed = era.colors?.[c.key];
    if (fixed) { colors[i] = fixed; return; }
  });
  nationOrder.forEach(({ c }, i) => {
    if (colors[i]) return;
    const taken = new Set([...adjacency[i]].map((j) => colors[j]).filter(Boolean));
    const options = PALETTE.filter((col) => !taken.has(col));
    const pool = options.length ? options : PALETTE;
    const minUse = Math.min(...pool.map((col) => usage.get(col) ?? 0));
    const least = pool.filter((col) => (usage.get(col) ?? 0) === minUse);
    colors[i] = least[Math.floor(rng.next() * least.length)];
    usage.set(colors[i], (usage.get(colors[i]) ?? 0) + 1);
  });
  const majors = new Set(era.majors);
  const nations = nationOrder.map(({ c }, i) => {
    const name = displayName(era, c.group);
    const tints = rng.shuffle(FLAG_TINTS.slice());
    return {
      name,
      short: shortName(era, c.group, name),
      color: colors[i],
      flag: { pattern: rng.pick(FLAG_PATTERNS), colors: [colors[i], tints[0], tints[1]] },
      major: majors.has(c.key) ? 1 : 0,
      key: c.key,
    };
  });
  const missingMajors = era.majors.filter((k) => !nations.some((n) => n.key === k));

  // --- Encode -------------------------------------------------------------------------------------------
  const Q = CFG.quantum;
  const encRing = (ring) => {
    const out = [];
    let px = 0, py = 0;
    for (const [x, y] of ring) {
      const qx = Math.round(x / Q), qy = Math.round(y / Q);
      out.push(qx - px, qy - py);
      px = qx; py = qy;
    }
    return out;
  };
  /** A point safely inside the (quantized) province, near its seed. */
  const interiorPoint = (p) => {
    const qr = p.rings.map((r) => r.map(([x, y]) => [Math.round(x / Q) * Q, Math.round(y / Q) * Q]));
    const inside = (x, y) => pointInRings(Math.round(x / Q) * Q, Math.round(y / Q) * Q, qr);
    if (inside(p.seed.x, p.seed.y)) return p.seed;
    let best = null, bd = Infinity;
    const [x0, y0, x1, y1] = p.bbox;
    const step = Math.max((x1 - x0) / 24, (y1 - y0) / 24, Q);
    for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) {
      if (!inside(x, y)) continue;
      // Prefer points near the seed but not hugging an edge.
      const edgeOk = inside(x + step / 3, y) && inside(x - step / 3, y) && inside(x, y + step / 3) && inside(x, y - step / 3);
      const d = Math.hypot(x - p.seed.x, y - p.seed.y) * (edgeOk ? 1 : 3);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    return best ?? p.seed;
  };
  const provOut = provinces.map((p) => {
    const owner = nationOfCountry.get(p.country) ?? -1;
    p.seed = interiorPoint(p);
    const o = {
      o: owner,
      n: p.name,
      t: p.terrain[0],
      s: [Math.round(p.seed.x / Q), Math.round(p.seed.y / Q)],
      a: Math.round(p.area * 10) / 10,
      r: p.rings.map(encRing),
      e: p.edges,
    };
    if (p.city) {
      o.c = p.city.capital ? 2 : 1;
      if (p.city.name && p.city.name !== p.name) o.cn = p.city.name;
      if (p.city.x !== undefined && (Math.abs(p.city.x - p.seed.x) > Q || Math.abs(p.city.y - p.seed.y) > Q)) o.cp = [Math.round(p.city.x / Q), Math.round(p.city.y / Q)];
    }
    if (owner < 0 && countries[p.country].key !== '~Unknown') o.g = countries[p.country].key.slice(1);
    return o;
  });
  nations.forEach((n, i) => {
    const cap = provinces.find((p) => nationOfCountry.get(p.country) === i && p.city?.capital);
    n.capital = cap ? cap.id : provinces.findIndex((p) => nationOfCountry.get(p.country) === i);
    delete n.key;
  });
  const seaOut = seas.map((s) => ({
    p: encRing(s.polygon),
    c: [Math.round(s.site.x / Q), Math.round(s.site.y / Q)],
    nb: s.neighbors,
    cp: [...s.coastal],
  }));

  const data = {
    v: 1, era: era.id, dataYear: era.dataYear,
    source: SOURCES[era.source],
    width: WORLD_WIDTH, height: WORLD_HEIGHT, q: Q,
    nations, provinces: provOut, seas: seaOut,
  };
  fs.mkdirSync(OUT, { recursive: true });
  const json = JSON.stringify(data);
  fs.writeFileSync(path.join(OUT, `${era.id}.json`), json);

  const land = provinces.length;
  const claimed = provOut.filter((p) => p.o >= 0).length;
  console.log(
    `  ${era.id}: ${land} provinces (${claimed} owned, ${land - claimed} unclaimed), ${nations.length} nations, ` +
    `${provOut.filter((p) => p.c).length} cities, ${seas.length} sea zones, ${(json.length / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
  console.log(`     capitals: ${stats.capitalsCurated} curated, ${stats.capitalsFromNE} Natural Earth, ${stats.capitalsGenerated} generated`);
  if (stats.splitRegions !== undefined) console.log(`     regions split: ${stats.splitRegions}, tiny regions merged: ${stats.tinyMerged}, cities sharing a region (not shown): ${stats.citiesDropped}`);
  if (stats.unplaced.length) console.log(`     not placed: ${stats.unplaced.join('; ')}`);
  if (missingMajors.length) console.log(`     WARNING missing majors: ${missingMajors.join(', ')}`);
  return { id: era.id, provinces: land, nations: nations.length, kb: json.length / 1024 };
}

/** Point well inside a (multi)polygon: grid search maximising distance to the outline. */
function interiorCenter(mp) {
  const big = mp.slice().sort((a, b) => polyArea(b) - polyArea(a))[0];
  const [x0, y0, x1, y1] = bboxOf(big);
  let best = null, bd = -1;
  const n = 14;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = x0 + ((i + 0.5) / n) * (x1 - x0), y = y0 + ((j + 0.5) / n) * (y1 - y0);
    if (!pointInRings(x, y, big)) continue;
    let d = Infinity;
    for (const r of big) for (let k = 0; k < r.length; k++) d = Math.min(d, distToSegment(x, y, r[k], r[(k + 1) % r.length]));
    if (d > bd) { bd = d; best = { x, y }; }
  }
  return best ?? { x: big[0][0][0], y: big[0][0][1] };
}

/**
 * Modern era: one province per admin-1 region, except regions much larger
 * than their country's typical province, which are split into seeded parts
 * ("Krasnoyarsk North"). Each region keeps its most important city.
 */
function buildAdmin1Provinces(rng, countries, units, provinces, stats) {
  const byKey = new Map(countries.map((c, i) => [c.key, i]));
  // Regions smaller than the map's coordinate precision (San Marino's
  // municipalities, tiny parishes) merge into the nearest region of the same
  // country. A micro-nation that is a single region stays as it is.
  const TINY = 0.8;
  const centerOf = (u) => { const [x0, y0, x1, y1] = bboxOf(u.rings); return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }; };
  let merged = 0;
  for (const u of units.filter((x) => x.area < TINY).sort((a, b) => a.area - b.area)) {
    if (u.mergedInto) continue;
    const c = centerOf(u);
    const others = units.filter((o) => o !== u && o.sov === u.sov && !o.mergedInto);
    if (!others.length) continue;
    const target = others.sort((a, b) => Math.hypot(centerOf(a).x - c.x, centerOf(a).y - c.y) - Math.hypot(centerOf(b).x - c.x, centerOf(b).y - c.y))[0];
    target.mp = openMultiPolygon(polygonClipping.union(target.mp.map((poly) => poly.map(closeRing)), u.mp.map((poly) => poly.map(closeRing))));
    target.rings = target.mp.flat();
    target.area += u.area;
    u.mergedInto = target;
    merged++;
  }
  units = units.filter((u) => !u.mergedInto);
  stats.tinyMerged = merged;
  stats.splitRegions = 0;
  stats.citiesDropped = 0;
  for (const u of units) {
    const ci = byKey.get(u.sov);
    if (ci === undefined) continue;
    const c = countries[ci];
    const cell = c.area / Math.max(1, c.nProvinces);
    const k = u.area > cell * 2.4 ? Math.min(40, Math.round(u.area / cell)) : 1;
    const inUnit = c.cities.filter((city) => pointInRings(city.x, city.y, u.rings)).sort((a, b) => a.priority - b.priority);

    if (k === 1) {
      if (inUnit.length > 1) stats.citiesDropped += inUnit.length - 1;
      provinces.push({ country: ci, seed: interiorCenter(u.mp), city: inUnit[0] ?? null, mp: u.mp, rings: u.rings, area: u.area, regionName: u.name });
      continue;
    }

    // Split: cities first (so each keeps its own part), then well-spread extra seeds.
    stats.splitRegions++;
    const seeds = inUnit.slice(0, k).map((city) => ({ x: city.x, y: city.y, city }));
    const pieces = u.mp.map((poly) => ({ poly, area: polyArea(poly), bbox: bboxOf(poly) })).sort((a, b) => b.area - a.area);
    const total = pieces.reduce((s2, p) => s2 + p.area, 0);
    for (const piece of pieces) {
      const want = Math.round(((k - inUnit.slice(0, k).length) * piece.area) / total);
      for (let i = 0; i < want; i++) { const pt = bestCandidate(rng, piece, seeds, 12); if (pt) seeds.push(pt); }
    }
    if (seeds.length < 2) {
      provinces.push({ country: ci, seed: interiorCenter(u.mp), city: inUnit[0] ?? null, mp: u.mp, rings: u.rings, area: u.area, regionName: u.name });
      continue;
    }
    const [x0, y0, x1, y1] = bboxOf(u.rings);
    const vor = Delaunay.from(seeds.map((p) => [p.x, p.y])).voronoi([x0 - 1, y0 - 1, x1 + 1, y1 + 1]);
    const clipGeom = u.mp.map((poly) => poly.map(closeRing));
    const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    const spread = Math.max(x1 - x0, y1 - y0) / 2;
    const parts = [];
    seeds.forEach((sd, i) => {
      const cellPoly = vor.cellPolygon(i);
      if (!cellPoly) return;
      const mp = openMultiPolygon(polygonClipping.intersection([cellPoly], clipGeom));
      if (!mp.length) return;
      parts.push({ sd, mp, dir: compassName(sd.x - center.x, sd.y - center.y, spread) });
    });
    // Unique names within the region: "Krasnoyarsk North", "Krasnoyarsk North 2"…
    const used = new Map();
    for (const part of parts) {
      const n = (used.get(part.dir) ?? 0) + 1;
      used.set(part.dir, n);
      const name = `${u.name} ${part.dir}${n > 1 ? ` ${n}` : ''}`;
      const seed = part.sd.city ? { x: part.sd.x, y: part.sd.y } : interiorCenter(part.mp);
      provinces.push({ country: ci, seed, city: part.sd.city ?? null, mp: part.mp, rings: part.mp.flat(), area: part.mp.reduce((a, poly) => a + polyArea(poly), 0), regionName: name });
    }
  }
}

function xy(lon, lat) {
  const p = project(lon, lat);
  return { x: p.x, y: p.y };
}

/** Best-candidate sample inside a polygon piece, far from existing seeds. */
function bestCandidate(rng, piece, seeds, candidates) {
  const [x0, y0, x1, y1] = piece.bbox;
  let best = null, bestD = -1;
  let found = 0;
  for (let tries = 0; tries < candidates * 60 && found < candidates; tries++) {
    const x = rng.range(x0, x1), y = rng.range(y0, y1);
    if (!pointInRings(x, y, piece.poly)) continue;
    found++;
    let d = Infinity;
    for (const s of seeds) d = Math.min(d, (s.x - x) ** 2 + (s.y - y) ** 2);
    if (d > bestD) { bestD = d; best = { x, y }; }
  }
  return best;
}

// ---------------------------------------------------------------------------

const wanted = process.argv.slice(2);
const places = loadPlaces();
const results = [];
for (const era of ERAS) {
  if (wanted.length && !wanted.includes(era.id)) continue;
  console.log(`[${era.id}] ${SOURCES[era.source].name}, data year ${era.dataYear}`);
  results.push(await buildEra(era, places));
}
console.log(results.map((r) => `${r.id}: ${r.provinces} prov / ${r.nations} nations / ${r.kb.toFixed(0)} KB`).join('\n'));
