/**
 * map.js — Procedural world generation for Iron Meridian.
 *
 * Pure data: no DOM, no canvas. Can be imported in Node for tests/tools.
 *
 * Pipeline (all driven by one seeded RNG, so a seed always yields the same world):
 *   1. Jittered sites → Voronoi cells (half-plane clipping) → Lloyd relaxation
 *   2. Elevation (continent "blobs" + fractal noise − edge falloff) and moisture
 *   3. Land selection: highest cells become land, tiny islands are sunk
 *   4. Terrain: mountains / forest / plains (urban is assigned to cities later)
 *   5. Nations: capitals placed per landmass (k-means), territories grown with
 *      a multi-source Dijkstra so every nation is one connected blob
 *   6. Cities, names, border segments and a picking index
 *
 * Geometry on the returned map (polygons, neighbors, borders) is immutable.
 * Mutable game data (e.g. province.owner) must only be changed via GameState
 * so the renderer/UI get notified.
 */

// ---------------------------------------------------------------------------
// Config & static tables
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  width: 2400,            // world units (1 unit ≈ 2 km, see AREA_KM2_PER_UNIT)
  height: 1500,
  cellCount: 640,         // total Voronoi cells, land + sea
  lloydIterations: 2,     // relaxation passes → more even cell shapes
  targetLand: 175,        // desired number of land provinces
  minLand: 150,
  maxLand: 200,
  minLandmass: 14,        // smaller islands are sunk so nations stay connected
  nationCount: 6,
  cityRatio: 0.15,        // share of provinces that are cities
  gridSize: 100,          // world units per tactical grid square
};

export const AREA_KM2_PER_UNIT = 4;

/**
 * Terrain definitions. moveCost is already used for territory generation;
 * defense is a placeholder for the combat step.
 */
export const TERRAIN = {
  plains:    { id: 'plains',    label: 'Plains',    moveCost: 1.0,  defense: 1.0 },
  forest:    { id: 'forest',    label: 'Forest',    moveCost: 1.35, defense: 1.25 },
  mountains: { id: 'mountains', label: 'Mountains', moveCost: 2.4,  defense: 1.6 },
  urban:     { id: 'urban',     label: 'Urban',     moveCost: 1.0,  defense: 1.4 },
};

const NATION_COLORS = ['#4f7cac', '#b5523b', '#6f9442', '#c79b3b', '#8061ad', '#3c9c94'];
const FLAG_TINTS = ['#ece6d6', '#16191c', '#c9a63c', '#8e2323', '#1f3f6b', '#2e5b34'];
const FLAG_PATTERNS = ['h3', 'v3', 'h2', 'v2', 'cross', 'canton', 'diag'];
const NATION_FORMS = [
  'Republic of {}', '{} Federation', 'Kingdom of {}', '{} Union', 'Free State of {}',
  '{} Commonwealth', '{} Dominion', 'Confederation of {}', 'Grand Duchy of {}', '{} Directorate',
];

const SYL_START = [
  'ka', 've', 'dor', 'mar', 'tor', 'sen', 'ar', 'bel', 'cor', 'dra', 'el', 'fen', 'gal', 'har',
  'is', 'kal', 'lor', 'mir', 'nor', 'os', 'pra', 'ral', 'sar', 'tal', 'ul', 'var', 'zen', 'bre',
  'gra', 'sto', 'vin', 'kel', 'rus', 'ash', 'bran', 'cae', 'dun', 'eth', 'fal', 'gor', 'hel',
  'jor', 'kra', 'lan', 'mor', 'nev', 'pel', 'quin', 'ros', 'sil', 'tev', 'vos', 'wen', 'yar',
  'tre', 'zar', 'mal', 'ber', 'tas', 'ves', 'ard', 'lin', 'hal', 'kos', 'dal', 'mer',
];
const SYL_MID = ['a', 'e', 'i', 'o', 'an', 'el', 'or', 'is', 'ar', 'en', 'ul', 'ir', 'av', 'et', 'on'];
const SYL_END = [
  'ia', 'or', 'heim', 'grad', 'mark', 'burg', 'ova', 'ena', 'ar', 'ion', 'is', 'an', 'ath', 'ek',
  'os', 'um', 'ven', 'dal', 'ford', 'mere', 'moor', 'vale', 'sk', 'ant', 'ora', 'ess', 'ov',
  'ine', 'gard', 'holm', 'stad', 'ra', 'ta', 'nar', 'dor', 'via', 'eth',
];

// ---------------------------------------------------------------------------
// Seeded RNG
// ---------------------------------------------------------------------------

/** Hash any string into a 32-bit unsigned seed. */
export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Mulberry32-based RNG with a few helpers. Deterministic for a given seed. */
export function createRng(seed) {
  let a = hashSeed(String(seed));
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
  };
}

/** Human-friendly random seed like "K7QX-M2PA". Uses Math.random on purpose. */
export function randomSeed() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) s += '-';
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

// ---------------------------------------------------------------------------
// Value noise
// ---------------------------------------------------------------------------

function createNoise(rng) {
  const p = rng.shuffle(Array.from({ length: 256 }, (_, i) => i));
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) vals[i] = rng.next();

  const lattice = (ix, iy) => vals[perm[(perm[ix & 255] + iy) & 255]];
  const smooth = (t) => t * t * (3 - 2 * t);

  function noise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const u = smooth(x - ix), v = smooth(y - iy);
    const a = lattice(ix, iy), b = lattice(ix + 1, iy);
    const c = lattice(ix, iy + 1), d = lattice(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** Fractal Brownian motion, roughly in [0, 1]. */
  function fbm(x, y, octaves = 4) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq + o * 17.3, y * freq - o * 9.1);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  }

  return { noise, fbm };
}

// ---------------------------------------------------------------------------
// Geometry: Voronoi via half-plane clipping
// ---------------------------------------------------------------------------

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/**
 * Clip a convex polygon to the half-plane of points closer to `s` than to `o`.
 * Each vertex carries `t`: the id of the neighbor cell across the edge that
 * starts at that vertex (-1 = map boundary). This gives adjacency for free.
 */
function clipPolygon(poly, s, o, tag) {
  const dx = o.x - s.x, dy = o.y - s.y;
  const mx = (s.x + o.x) / 2, my = (s.y + o.y) / 2;
  const n = poly.length;
  const f = new Array(n);
  let anyOut = false;
  for (let k = 0; k < n; k++) {
    f[k] = (poly[k].x - mx) * dx + (poly[k].y - my) * dy;
    if (f[k] > 1e-9) anyOut = true;
  }
  if (!anyOut) return poly;

  const out = [];
  for (let k = 0; k < n; k++) {
    const a = poly[k], b = poly[(k + 1) % n];
    const fa = f[k], fb = f[(k + 1) % n];
    const ina = fa <= 1e-9, inb = fb <= 1e-9;
    if (ina) out.push(a);
    if (ina !== inb) {
      const s2 = fa / (fa - fb);
      // Leaving the half-plane: the new edge runs along the bisector (tag).
      // Entering: the edge continues along a's original edge (a.t).
      out.push({ x: a.x + (b.x - a.x) * s2, y: a.y + (b.y - a.y) * s2, t: ina ? tag : a.t });
    }
  }
  return out;
}

function computeVoronoi(sites, W, H) {
  const n = sites.length;
  const polys = new Array(n);
  const d2 = new Float64Array(n);
  const order = new Uint32Array(n);

  for (let i = 0; i < n; i++) {
    const s = sites[i];
    for (let j = 0; j < n; j++) { d2[j] = dist2(s, sites[j]); order[j] = j; }
    order.sort((a, b) => d2[a] - d2[b]);

    let poly = [
      { x: 0, y: 0, t: -1 }, { x: W, y: 0, t: -1 },
      { x: W, y: H, t: -1 }, { x: 0, y: H, t: -1 },
    ];
    let r2 = maxRadius2(poly, s);
    for (let k = 1; k < n; k++) {
      const j = order[k];
      // Sites farther than twice the cell radius can no longer cut the cell.
      if (d2[j] > 4 * r2) break;
      poly = clipPolygon(poly, s, sites[j], j);
      r2 = maxRadius2(poly, s);
    }
    polys[i] = poly;
  }
  return polys;
}

function maxRadius2(poly, s) {
  let m = 0;
  for (const v of poly) m = Math.max(m, dist2(v, s));
  return m;
}

export function polygonCentroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k], q = poly[(k + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a *= 0.5;
  return { x: cx / (6 * a), y: cy / (6 * a), area: Math.abs(a) };
}

function jitteredSites(rng, W, H, count) {
  const cols = Math.round(Math.sqrt((count * W) / H));
  const rows = Math.round(count / cols);
  const cw = W / cols, ch = H / rows;
  const sites = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      sites.push({ x: (c + 0.5 + rng.range(-0.4, 0.4)) * cw, y: (r + 0.5 + rng.range(-0.4, 0.4)) * ch });
    }
  }
  return sites;
}

/** Turn raw polygons into cells with symmetric adjacency and shared edges. */
function buildCells(sites, polys) {
  const cells = sites.map((site, i) => {
    const c = polygonCentroid(polys[i]);
    return {
      id: i,
      site,
      polygon: polys[i].map((v) => ({ x: v.x, y: v.y })),
      center: { x: c.x, y: c.y },
      area: c.area,
      neighbors: [],
    };
  });

  const edgeMap = new Map();
  polys.forEach((poly, i) => {
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      const j = a.t;
      if (j < 0) continue;
      // Ignore near-degenerate contacts (cells meeting at ~a point).
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.75) continue;
      const lo = Math.min(i, j), hi = Math.max(i, j);
      const key = lo * 65536 + hi;
      if (!edgeMap.has(key)) edgeMap.set(key, { i: lo, j: hi, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  });
  const edges = [...edgeMap.values()];
  for (const e of edges) {
    cells[e.i].neighbors.push(e.j);
    cells[e.j].neighbors.push(e.i);
  }
  return { cells, edges };
}

// ---------------------------------------------------------------------------
// Elevation & land
// ---------------------------------------------------------------------------

/** Elliptical "continent seeds", spread apart with best-candidate sampling. */
function placeBlobs(rng, W, H) {
  const count = rng.int(2, 4);
  const blobs = [];
  for (let i = 0; i < count; i++) {
    let best = null, bestScore = -1;
    for (let t = 0; t < 30; t++) {
      const b = {
        x: rng.range(W * 0.2, W * 0.8),
        y: rng.range(H * 0.25, H * 0.75),
        rx: rng.range(W * 0.13, W * 0.22),
        ry: rng.range(H * 0.16, H * 0.3),
      };
      const score = blobs.length ? Math.min(...blobs.map((o) => Math.hypot(o.x - b.x, o.y - b.y))) : 1;
      if (score > bestScore) { bestScore = score; best = b; }
    }
    blobs.push(best);
  }
  return blobs;
}

function elevationAt(x, y, W, H, blobs, noise) {
  let e = 0;
  for (const b of blobs) {
    const dx = (x - b.x) / b.rx, dy = (y - b.y) / b.ry;
    e = Math.max(e, 1 - Math.sqrt(dx * dx + dy * dy));
  }
  e += (noise.fbm(x / 420, y / 420, 4) - 0.5) * 0.9;
  // Push the map edges into the ocean.
  const edge = Math.min(1, Math.min(x, W - x) / (W * 0.1), Math.min(y, H - y) / (H * 0.12));
  return e - (1 - edge) * 1.2;
}

function landComponents(cells) {
  const seen = new Uint8Array(cells.length);
  const comps = [];
  for (const c of cells) {
    if (!c.land || seen[c.id]) continue;
    const comp = [];
    const stack = [c];
    seen[c.id] = 1;
    while (stack.length) {
      const cur = stack.pop();
      comp.push(cur);
      for (const nb of cur.neighbors) {
        if (cells[nb].land && !seen[nb]) { seen[nb] = 1; stack.push(cells[nb]); }
      }
    }
    comps.push(comp);
  }
  return comps.sort((a, b) => b.length - a.length);
}

/**
 * Raise the highest cells as land, iterating until the usable land (after
 * sinking tiny islands) lands in [minLand, maxLand]. Returns landmasses.
 */
function selectLand(cells, cfg) {
  const ranked = cells.slice().sort((a, b) => b.elevation - a.elevation);
  let target = cfg.targetLand;
  let keep = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    for (let k = 0; k < ranked.length; k++) ranked[k].land = k < target;
    keep = landComponents(cells)
      .filter((c) => c.length >= cfg.minLandmass)
      .slice(0, cfg.nationCount);
    const total = keep.reduce((s, c) => s + c.length, 0);
    if (total >= cfg.minLand && total <= cfg.maxLand) break;
    target = Math.round(Math.max(30, Math.min(cells.length * 0.6, target + (cfg.targetLand - total))));
  }
  const keepSet = new Set(keep.flat());
  for (const c of cells) c.land = keepSet.has(c);
  return keep;
}

function assignTerrain(rng, landCells) {
  const byElev = landCells.slice().sort((a, b) => b.elevation + b.roughness * 0.04 - (a.elevation + a.roughness * 0.04));
  const mountainCount = Math.round(landCells.length * 0.14);
  byElev.forEach((c, i) => { c.terrain = i < mountainCount ? 'mountains' : null; });

  const rest = landCells.filter((c) => !c.terrain).sort((a, b) => b.moisture - a.moisture);
  const forestCount = Math.round(rest.length * 0.32);
  rest.forEach((c, i) => { c.terrain = i < forestCount ? 'forest' : 'plains'; });
}

// ---------------------------------------------------------------------------
// Nations, territories, cities
// ---------------------------------------------------------------------------

/** Split nationCount across landmasses proportionally to size (≥1 each). */
function allocateNations(landmasses, n) {
  const total = landmasses.reduce((s, l) => s + l.length, 0);
  const alloc = landmasses.map((l) => Math.max(1, Math.floor((n * l.length) / total)));
  let sum = alloc.reduce((a, b) => a + b, 0);
  while (sum > n) {
    // Take from the landmass with the most nations per cell.
    let best = -1, bestRatio = -1;
    alloc.forEach((a, i) => {
      if (a > 1 && a / landmasses[i].length > bestRatio) { bestRatio = a / landmasses[i].length; best = i; }
    });
    alloc[best]--; sum--;
  }
  while (sum < n) {
    let best = 0, bestRatio = -1;
    alloc.forEach((a, i) => {
      const r = landmasses[i].length / (a + 1);
      if (r > bestRatio) { bestRatio = r; best = i; }
    });
    alloc[best]++; sum++;
  }
  return alloc;
}

/** Pick k well-spread, central capitals on a landmass (farthest-point + k-means). */
function placeCapitals(rng, members, k) {
  const flat = members.filter((p) => p.terrain !== 'mountains');
  const pool = flat.length >= k ? flat : members;
  const seeds = [rng.pick(pool)];
  while (seeds.length < k) {
    let best = null, bd = -1;
    for (const p of pool) {
      if (seeds.includes(p)) continue;
      const d = Math.min(...seeds.map((s) => dist2(s.center, p.center)));
      if (d > bd) { bd = d; best = p; }
    }
    seeds.push(best);
  }
  for (let iter = 0; iter < 6; iter++) {
    const groups = seeds.map(() => []);
    for (const p of members) {
      let bi = 0, bd = Infinity;
      seeds.forEach((s, i) => { const d = dist2(s.center, p.center); if (d < bd) { bd = d; bi = i; } });
      groups[bi].push(p);
    }
    groups.forEach((g, i) => {
      if (!g.length) return;
      const mean = { x: 0, y: 0 };
      for (const p of g) { mean.x += p.center.x / g.length; mean.y += p.center.y / g.length; }
      let best = seeds[i], bd = Infinity;
      for (const p of g) {
        if (!pool.includes(p) || (seeds.includes(p) && p !== seeds[i])) continue;
        const d = dist2(p.center, mean);
        if (d < bd) { bd = d; best = p; }
      }
      seeds[i] = best;
    });
  }
  return seeds;
}

/** Minimal binary heap keyed by priority. */
export class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(value, priority) {
    const a = this.items;
    a.push({ value, priority });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].priority <= a[i].priority) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].priority < a[m].priority) m = l;
        if (r < a.length && a[r].priority < a[m].priority) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Multi-source Dijkstra from all capitals. A province joins whichever capital
 * reaches it cheapest; because each province inherits its owner from its
 * path predecessor, every territory is guaranteed to be connected.
 * Mountains are expensive, so ranges tend to become natural borders.
 */
function growTerritories(provinces, capitals) {
  const cost = new Float64Array(provinces.length).fill(Infinity);
  const heap = new MinHeap();
  capitals.forEach((cap, nationId) => {
    cost[cap.id] = 0;
    cap.owner = nationId;
    heap.push(cap.id, 0);
  });
  while (heap.size) {
    const { value: id, priority: d } = heap.pop();
    if (d > cost[id]) continue;
    const p = provinces[id];
    for (const nbId of p.neighbors) {
      const nb = provinces[nbId];
      const step = Math.sqrt(dist2(p.center, nb.center)) * TERRAIN[nb.terrain].moveCost * nb.roughness;
      if (d + step < cost[nbId]) {
        cost[nbId] = d + step;
        nb.owner = p.owner;
        heap.push(nbId, d + step);
      }
    }
  }
}

/** Spread cities out: capitals first, one more per nation, then greedy fill. */
function placeCities(rng, provinces, nations, cfg) {
  const target = Math.max(nations.length * 2, Math.round(provinces.length * cfg.cityRatio));
  const minD = new Float64Array(provinces.length).fill(Infinity);
  const noise = provinces.map(() => rng.range(0.85, 1.15));
  const addCity = (p) => {
    p.isCity = true;
    for (const q of provinces) minD[q.id] = Math.min(minD[q.id], dist2(p.center, q.center));
  };
  const score = (p) => {
    if (p.isCity) return -1;
    return Math.sqrt(minD[p.id]) * (p.coastal ? 1.15 : 1) * (p.terrain === 'mountains' ? 0.4 : 1) * noise[p.id];
  };
  const best = (list) => list.reduce((b, p) => (score(p) > score(b) ? p : b), list[0]);

  for (const n of nations) addCity(provinces[n.capitalId]);
  for (const n of nations) {
    const own = provinces.filter((p) => p.owner === n.id && !p.isCity);
    if (own.length) addCity(best(own));
  }
  let count = provinces.filter((p) => p.isCity).length;
  while (count < target) { addCity(best(provinces)); count++; }
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Unique pronounceable place names, deterministic for a given rng. */
export function createNameGenerator(rng) {
  const used = new Set();
  return function generate() {
    for (let tries = 0; tries < 60; tries++) {
      let s = rng.pick(SYL_START);
      if (rng.chance(0.4)) s += rng.pick(SYL_MID);
      s += rng.pick(SYL_END);
      s = s.replace(/([aeiou])\1+/g, '$1').replace(/(.)\1\1/g, '$1$1');
      if (s.length < 4 || s.length > 10) continue;
      s = capitalize(s);
      if (!used.has(s)) { used.add(s); return s; }
    }
    // Practically unreachable; keeps names unique regardless.
    const s = `${capitalize(rng.pick(SYL_START))}${used.size}`;
    used.add(s);
    return s;
  };
}

function decorateProvinceName(rng, base, p) {
  if (rng.chance(0.5)) return base;
  if (p.coastal && rng.chance(0.3)) return rng.pick([`${base} Coast`, `${base} Bay`, `Cape ${base}`]);
  switch (p.terrain) {
    case 'mountains': return rng.pick([`${base} Heights`, `Mount ${base}`, `${base} Range`, `${base} Pass`]);
    case 'forest': return rng.pick([`${base} Woods`, `${base} Forest`, `${base} Weald`]);
    default: return rng.pick([`${base} Plains`, `${base} Fields`, `Upper ${base}`, `Lower ${base}`, `${base} Valley`]);
  }
}

function decorateCityName(rng, base, p) {
  const r = rng.next();
  if (p.coastal && r < 0.18) return `Port ${base}`;
  if (r > 0.92) return `Fort ${base}`;
  if (r > 0.87) return `New ${base}`;
  return base;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a complete world from a seed.
 * @param {string|number} seed
 * @param {Partial<typeof DEFAULT_CONFIG>} overrides
 */
export function generateMap(seed, overrides = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...overrides };
  const rng = createRng(seed);
  const W = cfg.width, H = cfg.height;

  // 1. Voronoi cells with Lloyd relaxation. The final polygons belong to the
  //    final sites, so "nearest site" picking is exact.
  let sites = jitteredSites(rng, W, H, cfg.cellCount);
  let polys = computeVoronoi(sites, W, H);
  for (let i = 0; i < cfg.lloydIterations; i++) {
    sites = polys.map((p) => { const c = polygonCentroid(p); return { x: c.x, y: c.y }; });
    polys = computeVoronoi(sites, W, H);
  }
  const { cells, edges } = buildCells(sites, polys);

  // 2. Elevation & moisture fields sampled at cell centers.
  const elevNoise = createNoise(rng);
  const moistNoise = createNoise(rng);
  const blobs = placeBlobs(rng, W, H);
  for (const c of cells) {
    c.elevation = elevationAt(c.center.x, c.center.y, W, H, blobs, elevNoise);
    c.moisture = moistNoise.fbm(c.center.x / 300, c.center.y / 300, 3);
    c.roughness = rng.range(0.75, 1.35);
  }

  // 3. Land / sea.
  const landmasses = selectLand(cells, cfg);
  landmasses.forEach((comp, i) => comp.forEach((c) => { c.landmass = i; }));
  const landCells = cells.filter((c) => c.land);
  const seaCells = cells.filter((c) => !c.land);

  // 4. Terrain.
  assignTerrain(rng, landCells);

  // 5. Build province and sea-zone records with their own id spaces.
  const provinceOfCell = new Int32Array(cells.length).fill(-1);
  const seaOfCell = new Int32Array(cells.length).fill(-1);
  landCells.forEach((c, i) => { provinceOfCell[c.id] = i; });
  seaCells.forEach((c, i) => { seaOfCell[c.id] = i; });

  const provinces = landCells.map((c, i) => ({
    id: i,
    name: '',
    center: c.center,          // centroid: labels, icons, unit anchors
    site: c.site,              // Voronoi generator
    rings: [c.polygon],         // list of rings (real-world provinces can have several)
    area: c.area,
    neighbors: c.neighbors.filter((n) => provinceOfCell[n] >= 0).map((n) => provinceOfCell[n]),
    seaNeighbors: c.neighbors.filter((n) => seaOfCell[n] >= 0).map((n) => seaOfCell[n]),
    coastal: false,
    terrain: c.terrain,
    elevation: c.elevation,
    landmass: c.landmass,
    roughness: c.roughness,
    isCity: false,
    isCapital: false,
    owner: -1,                 // nation id — mutate only through GameState.setOwner
  }));
  for (const p of provinces) p.coastal = p.seaNeighbors.length > 0;

  const seaZones = seaCells.map((c, i) => ({
    id: i,
    center: c.center,
    polygon: c.polygon,
    neighbors: c.neighbors.filter((n) => seaOfCell[n] >= 0).map((n) => seaOfCell[n]),
    coastalProvinces: c.neighbors.filter((n) => provinceOfCell[n] >= 0).map((n) => provinceOfCell[n]),
  }));

  // 6. Nations: capitals per landmass, then grow connected territories.
  const alloc = allocateNations(landmasses, cfg.nationCount);
  const capitals = [];
  landmasses.forEach((comp, i) => {
    const members = comp.map((c) => provinces[provinceOfCell[c.id]]);
    capitals.push(...placeCapitals(rng, members, alloc[i]));
  });
  growTerritories(provinces, capitals);

  const nameGen = createNameGenerator(rng);
  const colors = rng.shuffle(NATION_COLORS.slice());
  const forms = rng.shuffle(NATION_FORMS.slice());
  const nations = capitals.map((cap, id) => {
    const root = nameGen();
    const tints = rng.shuffle(FLAG_TINTS.slice());
    cap.isCapital = true;
    return {
      id,
      name: forms[id % forms.length].replace('{}', root),
      shortName: root,
      color: colors[id % colors.length],
      flag: { pattern: rng.pick(FLAG_PATTERNS), colors: [colors[id % colors.length], tints[0], tints[1]] },
      capitalId: cap.id,
      major: true,
    };
  });

  // 7. Cities (capitals are always urban; other cities often are).
  placeCities(rng, provinces, nations, cfg);
  for (const p of provinces) {
    if (p.isCapital || (p.isCity && rng.chance(0.55))) p.terrain = 'urban';
  }

  // 8. Names.
  for (const p of provinces) {
    const base = nameGen();
    p.name = p.isCapital ? base : p.isCity ? decorateCityName(rng, base, p) : decorateProvinceName(rng, base, p);
  }

  // 9. Border segments (land↔land and land↔sea) for rendering.
  const borders = [];
  for (const e of edges) {
    const pi = provinceOfCell[e.i], pj = provinceOfCell[e.j];
    if (pi >= 0 && pj >= 0) {
      borders.push({ kind: 'land', a: pi, b: pj, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 });
    } else if (pi >= 0 || pj >= 0) {
      const prov = pi >= 0 ? pi : pj;
      const sea = pi >= 0 ? seaOfCell[e.j] : seaOfCell[e.i];
      borders.push({ kind: 'coast', a: prov, sea, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 });
    }
  }

  // 10. Picking index: every cell's generator → province id (or -1 for sea).
  const pick = {
    xs: Float32Array.from(cells, (c) => c.site.x),
    ys: Float32Array.from(cells, (c) => c.site.y),
    province: provinceOfCell,
  };

  // Province-local scratch fields not needed after generation.
  for (const p of provinces) {
    delete p.roughness;
    const xs = p.rings[0].map((v) => v.x), ys = p.rings[0].map((v) => v.y);
    p.bbox = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    p.region = null;
  }
  const sizes = provinces.map((p) => Math.sqrt(p.area)).sort((a, b) => a - b);

  return {
    kind: 'generated',
    seed: String(seed),
    width: W,
    height: H,
    gridSize: cfg.gridSize,
    provinces,
    seaZones,
    nations,
    borders,
    pick,
    provinceScale: sizes[Math.floor(sizes.length / 2)],
  };
}

/** Province under world point (x, y), or -1 for sea / off-map. */
export function pickProvince(map, x, y) {
  if (!map || x < 0 || y < 0 || x > map.width || y > map.height) return -1;
  if (map.pickAt) return map.pickAt(x, y); // real-world maps: exact point-in-polygon
  const { xs, ys, province } = map.pick;
  let best = -1, bd = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - x, dy = ys[i] - y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best >= 0 ? province[best] : -1;
}

/** Tactical grid reference for a world point, e.g. "K-07". */
export function gridRef(map, x, y) {
  if (map.formatCoord) return map.formatCoord(x, y);
  const g = map.gridSize;
  const col = String.fromCharCode(65 + Math.max(0, Math.min(25, Math.floor(x / g))));
  const row = String(Math.max(0, Math.floor(y / g)) + 1).padStart(2, '0');
  return `${col}-${row}`;
}
