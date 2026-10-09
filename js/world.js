/**
 * world.js — Decode a prebuilt era (data/eras/<id>.json) into the runtime map
 * structure shared with the procedural generator, so the renderer, state and
 * UI work the same for both.
 *
 * Era data format (see tools/build-eras.mjs):
 *   provinces[i] = { o: owner (-1 unclaimed), n: name, t: terrain initial,
 *                    s: [x, y] seed (quantized), a: area, c: 1 city / 2 capital,
 *                    g: region name (unclaimed only),
 *                    r: rings (delta-encoded quantized coords),
 *                    e: per ring, per edge: neighbour province id (≥0) or -1-seaId }
 *   seas[i] = { p: polygon, c: [x, y], nb: neighbour sea ids, cp: coastal provinces }
 */

import { graticule, formatLatLon, unproject } from './projection.js';

/**
 * km² per world unit² at a latitude. Miller: 1 unit ≈ 10.008 km × cos(lat)
 * east-west and 10.008 km × cos(0.8·lat) north-south.
 */
const km2PerUnit = (lat) => 100.16 * Math.cos((lat * Math.PI) / 180) * Math.cos((0.8 * lat * Math.PI) / 180);

const TERRAIN_CODES = { p: 'plains', f: 'forest', m: 'mountains', u: 'urban' };

function decodeRing(arr, q) {
  const pts = new Array(arr.length / 2);
  let x = 0, y = 0;
  for (let i = 0, k = 0; i < arr.length; i += 2, k++) {
    x += arr[i];
    y += arr[i + 1];
    pts[k] = { x: x * q, y: y * q };
  }
  return pts;
}

function bboxOfRings(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

function pointInRings(x, y, rings) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/** Uniform grid over province bounding boxes → exact point-in-polygon picking. */
function buildPicker(provinces, width, height, cell = 40) {
  const cols = Math.ceil(width / cell) + 1;
  const buckets = new Map();
  for (const p of provinces) {
    const { x0, y0, x1, y1 } = p.bbox;
    for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) {
      for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) {
        const k = gy * cols + gx;
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(p.id);
      }
    }
  }
  return (x, y) => {
    const list = buckets.get(Math.floor(y / cell) * cols + Math.floor(x / cell));
    if (!list) return -1;
    for (const id of list) {
      const p = provinces[id];
      if (x < p.bbox.x0 || x > p.bbox.x1 || y < p.bbox.y0 || y > p.bbox.y1) continue;
      if (pointInRings(x, y, p.rings)) return id;
    }
    return -1;
  };
}

/**
 * @param {object} data parsed era JSON
 * @param {object} era  entry from eras.js
 */
export function buildWorldMap(data, era) {
  const q = data.q;
  const seaCount = data.seas.length;

  const provinces = data.provinces.map((p, id) => {
    const rings = p.r.map((r) => decodeRing(r, q));
    const neighbors = new Set(), seaNeighbors = new Set();
    for (const ring of p.e) for (const n of ring) {
      if (n >= 0) neighbors.add(n);
      else if (-1 - n < seaCount) seaNeighbors.add(-1 - n);
    }
    return {
      id,
      name: p.n,
      center: { x: p.s[0] * q, y: p.s[1] * q },
      rings,
      edges: p.e,
      bbox: bboxOfRings(rings),
      area: p.a,
      areaKm2: p.a * km2PerUnit(unproject(p.s[0] * q, p.s[1] * q).lat),
      neighbors: [...neighbors],
      seaNeighbors: [...seaNeighbors],
      coastal: seaNeighbors.size > 0,
      terrain: TERRAIN_CODES[p.t] ?? 'plains',
      isCity: !!p.c,
      isCapital: p.c === 2,
      // Modern provinces are real regions: the city keeps its own name and position.
      cityName: p.c ? (p.cn ?? p.n) : null,
      cityPos: p.cp ? { x: p.cp[0] * q, y: p.cp[1] * q } : null,
      owner: p.o,
      region: p.g ?? null,
    };
  });

  // Make adjacency symmetric (simplified borders occasionally see a neighbour from one side only).
  const neighborSets = provinces.map((p) => new Set(p.neighbors));
  provinces.forEach((p) => p.neighbors.forEach((n) => neighborSets[n].add(p.id)));
  provinces.forEach((p, i) => { p.neighbors = [...neighborSets[i]]; });

  // Border segments: each shared edge once (from the lower id), coasts always.
  const borders = [];
  for (const p of provinces) {
    p.rings.forEach((ring, k) => {
      const edges = p.edges[k];
      for (let i = 0; i < ring.length; i++) {
        const n = edges[i];
        const a = ring[i], b = ring[(i + 1) % ring.length];
        if (n >= 0) {
          if (n > p.id || !data.provinces[n].e.some((ring) => ring.includes(p.id))) borders.push({ kind: 'land', a: p.id, b: n, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        } else {
          const sea = -1 - n;
          borders.push({ kind: 'coast', a: p.id, sea: sea < seaCount ? sea : -1, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        }
      }
    });
    delete p.edges;
  }

  const seaZones = data.seas.map((s, id) => ({
    id,
    center: { x: s.c[0] * q, y: s.c[1] * q },
    polygon: decodeRing(s.p, q),
    neighbors: s.nb,
    coastalProvinces: s.cp,
  }));

  const nations = data.nations.map((n, id) => ({
    id,
    name: n.name,
    shortName: n.short,
    color: n.color,
    flag: n.flag,
    capitalId: n.capital,
    major: !!n.major,
  }));

  const sizes = provinces.map((p) => Math.sqrt(p.area)).sort((a, b) => a - b);

  return {
    kind: 'world',
    era,
    seed: era.id,
    source: data.source,
    dataYear: data.dataYear,
    width: data.width,
    height: data.height,
    provinces,
    nations,
    seaZones,
    borders,
    graticule: graticule(15),
    provinceScale: sizes[Math.floor(sizes.length / 2)],
    pickAt: buildPicker(provinces, data.width, data.height),
    formatCoord: formatLatLon,
    startDate: era.start ?? Date.now(),
  };
}
