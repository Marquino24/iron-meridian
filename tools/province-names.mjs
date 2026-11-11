/**
 * province-names.mjs — Real names for the provinces of the historical eras (step 13).
 *
 * The era builder used to give every province that has no real city an
 * invented name ("Senven", "Isheim"). This module names them from real
 * sources instead, without touching ids, borders or anything else:
 *
 *   1. a historical place inside the province:
 *        rome     Pleiades places attested in the Roman period (Latin names):
 *                 settlements first, then peoples and regions
 *        medieval Natural Earth towns, only where towns of that name existed
 *                 around 1200 (Europe, North Africa, the Near East, South and
 *                 East Asia; obviously modern towns left out), medieval names
 *                 where they differ (Constantinople, Smyrna…)
 *        ww1, ww2, coldwar  Natural Earth towns that existed in that year, in
 *                 that year's spelling (RENAMES: Breslau, Stalingrad, Léopoldville…)
 *   2. otherwise the modern region (Natural Earth admin-1) the province lies
 *      in, when it's the only such province there ("Gers", "Meuse")
 *   3. otherwise a physical feature that lies mostly in the province (Natural
 *      Earth regions, rivers, lakes: "Taymyr Peninsula", "Vilyuy", "Lapland")
 *   4. otherwise the nearest unused town of the era within ~2° (~200 km)
 *   5. otherwise the admin-1 region with a compass suffix ("Krasnoyarsk Krai
 *      North") — never an invented name.
 *
 * City provinces keep their city's name. The Fictional World keeps its
 * generated names; the modern era is already named from admin-1 regions.
 * Sources and licenses: docs/NAMES.md.
 */

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { project, unproject } from '../js/projection.js';
import { pickProvince } from '../js/map.js';
import { RENAMES, FOUNDED } from './era-config.mjs';

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
export const NAME_SOURCES = {
  places: { file: 'ne_10m_populated_places_simple.geojson', url: `${NE}/ne_10m_populated_places_simple.geojson` },
  admin1: { file: 'ne_10m_admin_1_states_provinces.geojson', url: `${NE}/ne_10m_admin_1_states_provinces.geojson` },
  pleiades: { file: 'pleiades-places-latest.csv.gz', url: 'https://atlantides.org/downloads/pleiades/dumps/pleiades-places-latest.csv.gz' },
  regions: { file: 'ne_10m_geography_regions_polys.geojson', url: `${NE}/ne_10m_geography_regions_polys.geojson` },
  rivers: { file: 'ne_10m_rivers_lake_centerlines.geojson', url: `${NE}/ne_10m_rivers_lake_centerlines.geojson` },
  lakes: { file: 'ne_10m_lakes.geojson', url: `${NE}/ne_10m_lakes.geojson` },
  pleiadesNames: { file: 'pleiades-names-latest.csv.gz', url: 'https://atlantides.org/downloads/pleiades/dumps/pleiades-names-latest.csv.gz' },
};

const YEAR = { rome: 117, medieval: 1200, ww1: 1914, ww2: 1938, coldwar: 1960 };

export const norm = (s) => String(s).normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase();
/** Uniqueness key for a display name (keeps digits: "Region North 2" ≠ "Region North"). */
const nameKey = (s) => String(s).normalize('NFD').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

/** Medieval spellings for towns whose modern name is anachronistic in 1200. */
const MEDIEVAL_NAMES = {
  istanbul: 'Constantinople', izmir: 'Smyrna', edirne: 'Adrianople', bursa: 'Prusa', iznik: 'Nicaea', izmit: 'Nicomedia',
  trabzon: 'Trebizond', antakya: 'Antioch', sanliurfa: 'Edessa', kayseri: 'Caesarea', konya: 'Iconium',
  plovdiv: 'Philippopolis', thessaloniki: 'Thessalonica', durres: 'Dyrrachium', bratislava: 'Pressburg',
  ljubljana: 'Laibach', gdansk: 'Danzig', szczecin: 'Stettin', wroclaw: 'Breslau', poznan: 'Posen',
  kyiv: 'Kiev', tallinn: 'Reval', turku: 'Åbo', beijing: 'Zhongdu', nanjing: 'Jiankang', hangzhou: "Lin'an",
  akko: 'Acre', sur: 'Tyre', saida: 'Sidon', sevilla: 'Seville',
};

/** Towns founded after 1200 (or by then long gone) that sit inside the medieval town zones. */
const NOT_MEDIEVAL = new Set([
  // Founded (or first recorded as a town) after 1200.
  'lviv', 'vilnius', 'berlin', 'warsaw', 'stockholm', 'amsterdam', 'thehague', 'rotterdam', 'helsinki', 'bilbao', 'dresden',
  'kaunas', 'chisinau', 'iasi', 'bucharest', 'sarajevo', 'tirana',
  'stpetersburg', 'saintpetersburg', 'kaliningrad', 'murmansk', 'arkhangelsk', 'odessa', 'odesa', 'sevastopol', 'mykolayiv',
  'mykolaiv', 'kherson', 'dnipro', 'dnipropetrovsk', 'zaporizhzhia', 'zaporizhzhya', 'donetsk', 'luhansk', 'kramatorsk',
  'mariupol', 'kryvyirih', 'kropyvnytskyi', 'kirovohrad', 'melitopol', 'berdyansk', 'simferopol', 'yalta', 'kerch',
  'telaviv', 'telavivyafo', 'haifa', 'eilat', 'ashdod', 'portsaid', 'ismailia', 'gdynia', 'lehavre', 'lorient', 'rochefort',
  'brest', 'lapalmas', 'laspalmas', 'santacruzdetenerife', 'valletta', 'karlsruhe', 'mannheim', 'darmstadt', 'wilhelmshaven',
  'bremerhaven', 'cuxhaven', 'kiel', 'rostock', 'gavle', 'umea', 'lulea', 'kiruna', 'tromso', 'hammerfest', 'narvik',
  'bodo', 'oulu', 'rovaniemi', 'vaasa', 'tampere', 'kotka', 'lahti', 'kuopio', 'joensuu', 'petrozavodsk', 'severodvinsk',
  'taipei', 'kaohsiung', 'singapore', 'kualalumpur', 'georgetown', 'ipoh', 'kolkata', 'calcutta', 'chennai', 'madras',
  'newdelhi', 'karachi', 'dubai', 'abudhabi', 'doha', 'kuwait', 'manama', 'sharjah', 'hongkong', 'macau', 'shenzhen',
  'qingdao', 'dalian', 'harbin', 'changchun', 'shanghai', 'tianjin', 'yokohama', 'kobe', 'sapporo', 'hakodate', 'asahikawa',
  'kushiro', 'obihiro', 'muroran', 'vladivostok', 'nakhodka', 'mumbai', 'bombay', 'hyderabad', 'bangalore', 'bengaluru',
  'pune', 'nagpur', 'ahmedabad', 'jaipur', 'lucknow', 'kanpur', 'faisalabad', 'rawalpindi', 'islamabad', 'quetta', 'peshawar',
  'chandigarh', 'jamshedpur', 'dhanbad', 'ranchi', 'bhopal', 'indore', 'surat', 'vadodara', 'rajkot', 'jodhpur', 'bikaner',
  'colombo', 'yangon', 'rangoon', 'mandalay', 'bangkok', 'hochiminhcity', 'saigon', 'haiphong', 'phnompenh', 'vientiane',
  'manila', 'cebu', 'davao', 'zamboanga', 'jakarta', 'batavia', 'bandung', 'medan', 'makassar', 'balikpapan', 'jeddah',
  'riyadh', 'dammam', 'hofuf', 'tabuk', 'amman', 'zarqa', 'irbid', 'algiers', 'oran', 'annaba', 'constantine', 'casablanca',
  'rabat', 'tangier', 'agadir', 'khouribga', 'kenitra', 'safi', 'tunis', 'sfax', 'benghazi', 'misratah', 'nouakchott',
  'dakar', 'freetown', 'monrovia', 'abidjan', 'accra', 'lagos', 'lome', 'cotonou', 'portharcourt', 'douala', 'yaounde',
  'libreville', 'luanda', 'kinshasa', 'brazzaville', 'nairobi', 'daressalaam', 'dodoma', 'harare', 'lusaka', 'johannesburg',
  'capetown', 'durban', 'pretoria', 'khartoum', 'portsudan', 'djibouti', 'asmara', 'addisababa',
]);

/** Where Natural Earth towns stand in for medieval towns: long-settled parts of Afro-Eurasia (lon/lat boxes). */
const MEDIEVAL_TOWN_ZONES = [
  [-11, 35, 45, 62],    // Europe (Russia only west of the Volga)
  [-18, 10, 63, 45],    // North Africa, the Near and Middle East
  [60, 5, 98, 37],      // South Asia
  [98, 18, 135, 45],    // East Asia
  [125, 30, 142, 42],   // Japan
];
const inZone = (lon, lat) => MEDIEVAL_TOWN_ZONES.some(([x0, y0, x1, y1]) => lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1);

const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];

// ---------------------------------------------------------------------------

/** Download a source into `rawDir` once (curl follows the session's proxy settings). */
export function fetchSource(rawDir, src) {
  const p = path.join(rawDir, src.file);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(rawDir, { recursive: true });
    console.log(`  downloading ${src.url}`);
    execFileSync('curl', ['-sSfL', '--retry', '3', src.url, '-o', p]);
  }
  return p;
}

/** All the sources, parsed. */
export function loadSources(rawDir) {
  const places = JSON.parse(fs.readFileSync(fetchSource(rawDir, NAME_SOURCES.places), 'utf8')).features.map((f) => {
    const p = f.properties;
    return { key: norm(p.nameascii || p.name), name: p.name.replace(/\s+/g, ' '), country: p.adm0name ?? '', lon: p.longitude, lat: p.latitude, pop: p.pop_max ?? 0, rank: p.scalerank ?? 10 };
  });
  const admin1 = JSON.parse(fs.readFileSync(fetchSource(rawDir, NAME_SOURCES.admin1), 'utf8')).features.map((f) => {
    const p = f.properties;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of polys) for (const [x, y] of poly[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const name = (p.name_en || p.name || p.gn_name || '').replace(/\s+/g, ' ').trim();
    return { name, admin: p.admin, polys, bbox: [x0, y0, x1, y1] };
  }).filter((a) => a.name);
  const gz = (src) => zlib.gunzipSync(fs.readFileSync(fetchSource(rawDir, src))).toString('utf8');
  const pleiades = parsePleiades(gz(NAME_SOURCES.pleiades), gz(NAME_SOURCES.pleiadesNames));
  return { places, admin1, pleiades, features: loadFeatures(rawDir) };
}

/** Physical features as sample points: { name, samples: [[lon, lat]…], rank }. */
function loadFeatures(rawDir) {
  const read = (src) => JSON.parse(fs.readFileSync(fetchSource(rawDir, src), 'utf8')).features;
  const label = (p) => (p.NAME_EN || p.name_en || p.NAME || p.name || '').split('/')[0].replace(/\s+/g, ' ').trim();
  const area = (polys) => {
    const pts = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of polys) for (const [x, y] of poly[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const N = 14;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = x0 + ((i + 0.5) * (x1 - x0)) / N, y = y0 + ((j + 0.5) * (y1 - y0)) / N;
      if (polys.some((poly) => inRing(poly[0], x, y))) pts.push([x, y]);
    }
    return pts.length ? pts : polys.map((poly) => poly[0][0]);
  };
  const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
  const out = [];
  for (const f of read(NAME_SOURCES.regions)) {
    const cls = f.properties.FEATURECLA;
    if (/Continent|Dragons|Coast/.test(cls)) continue;
    const name = label(f.properties);
    if (name) out.push({ name, samples: area(polysOf(f.geometry)), rank: 3 });
  }
  for (const f of read(NAME_SOURCES.rivers)) {
    const name = label(f.properties);
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    if (name) out.push({ name, samples: lines.flat().filter((_, i) => i % 2 === 0), rank: 2 });
  }
  for (const f of read(NAME_SOURCES.lakes)) {
    const name = label(f.properties);
    if (name) out.push({ name: /lake|lac|lago|ozero|reservoir|sea|nuur|köl|kul/i.test(name) ? name : `Lake ${name}`, samples: area(polysOf(f.geometry)), rank: 1 });
  }
  // The same river comes in several pieces: one entry per name.
  const merged = new Map();
  for (const f of out) { const k = nameKey(f.name); if (merged.has(k)) merged.get(k).samples.push(...f.samples); else merged.set(k, f); }
  return [...merged.values()];
}

/**
 * Pleiades places with a name attested in the Roman period in an ancient
 * language (Latin first, then unlabeled ancient names, then Greek). Place
 * titles alone won't do: unnamed sites carry modern labels ("Les Castels").
 */
function parsePleiades(placesCsv, namesCsv) {
  const table = (csv) => { const rows = parseCsv(csv); const head = rows.shift(); const c = Object.fromEntries(head.map((h, i) => [h, i])); return { rows, c }; };
  const P = table(placesCsv), N = table(namesCsv);
  const places = new Map();
  for (const r of P.rows) {
    const lat = Number(r[P.c.reprLat]), lon = Number(r[P.c.reprLong]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (!lat && !lon)) continue;
    places.set(r[P.c.path], { lat, lon, types: r[P.c.featureTypes] ?? '' });
  }
  const LANG = { la: 3, '': 2, grc: 1, 'grc-Latn': 1 };
  const best = new Map();
  for (const r of N.rows) {
    if (!/(^|,)roman(,|$)/.test(r[N.c.timePeriodsKeys] ?? '')) continue;
    const lang = r[N.c.nameLanguage] ?? '';
    if (!(lang in LANG)) continue;
    const name = (r[N.c.title] ?? '').split(/[/,]/)[0].trim();
    if (!/^[A-Z][^.?()\d]*$/.test(name) || name.length > 24) continue;
    const pid = r[N.c.pid];
    const b = best.get(pid) ?? { names: 0 };
    b.names++;
    if (!b.name || LANG[lang] > b.lang) Object.assign(b, { name, lang: LANG[lang] });
    best.set(pid, b);
  }
  const out = [];
  for (const [pid, b] of best) {
    const pl = places.get(pid);
    if (!pl) continue;
    const kind = /settlement|urban|fort|station|port|colonia/.test(pl.types) ? 'town' : /people|region|province|ethnic/.test(pl.types) ? 'region' : null;
    if (!kind) continue;
    out.push({ key: norm(b.name), name: b.name, lon: pl.lon, lat: pl.lat, kind, weight: b.names });
  }
  return out;
}

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, newlines in quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function adminAt(admin1, lon, lat) {
  for (const a of admin1) {
    const [x0, y0, x1, y1] = a.bbox;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    for (const poly of a.polys) if (inRing(poly[0], lon, lat) && !poly.slice(1).some((h) => inRing(h, lon, lat))) return a;
  }
  return null;
}

/** A town's name in a given era, or null when it didn't exist (or isn't a medieval town). */
function townName(eraId, t) {
  if (eraId === 'medieval') {
    if (!inZone(t.lon, t.lat) || NOT_MEDIEVAL.has(t.key)) return null;
    return MEDIEVAL_NAMES[t.key] ?? t.name;
  }
  if (FOUNDED[t.key] && FOUNDED[t.key] > YEAR[eraId]) return null;
  return RENAMES[t.key]?.[eraId] ?? t.name;
}

/**
 * New names for an era's provinces. `map` is the built map (js/world.js),
 * `data` the era JSON. Returns { names: Map(id → name), stats }.
 */
export function nameProvinces(eraId, map, sources) {
  const provs = map.provinces;
  const used = new Set();
  // City provinces keep their city's name — except a few the builder gave the same name
  // twice (a city on a border: Constantinople in Bulgaria, two Niameys): the province
  // that really holds the town keeps it, the others are named like the rest.
  const dupe = new Set();
  const keptCity = new Map(); // renamed duplicate → the province that kept the name
  const byName = new Map();
  for (const p of provs) if (p.isCity && !p.generatedCity) { const k = nameKey(p.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(p); }
  for (const [k, ps] of byName) {
    if (ps.length < 2) continue;
    const town = sources.places.find((t) => nameKey(t.name) === k || nameKey(townName(eraId, t) ?? '') === k);
    const at = town ? pickProvince(map, project(town.lon, town.lat).x, project(town.lon, town.lat).y) : -1;
    const ofCountry = town ? ps.filter((p) => { const n = map.nations[p.owner]; return n && (n.name.includes(town.country) || town.country.includes(n.shortName ?? n.name)); }) : [];
    const keep = (ofCountry.length === 1 ? ofCountry[0] : null) ?? ps.find((p) => p.id === at) ?? ps.find((p) => p.isCapital) ?? ps[0];
    for (const p of ps) if (p !== keep) { dupe.add(p.id); keptCity.set(p.id, keep); }
  }
  const isCity = (p) => p.isCity && !p.generatedCity && !dupe.has(p.id);
  for (const p of provs) if (isCity(p)) { used.add(nameKey(p.name)); if (p.cityName) used.add(nameKey(p.cityName)); }
  const todo = provs.filter((p) => !isCity(p));
  const todoSet = new Set(todo.map((p) => p.id));

  // Candidate historical names per province, best first.
  const cands = new Map();
  const add = (x, y, c) => {
    const id = pickProvince(map, x, y);
    if (id < 0 || !todoSet.has(id)) return;
    if (!cands.has(id)) cands.set(id, []);
    cands.get(id).push(c);
  };
  if (eraId === 'rome') {
    for (const pl of sources.pleiades) {
      const { x, y } = project(pl.lon, pl.lat);
      add(x, y, { name: pl.name, score: (pl.kind === 'town' ? 100 : 0) + pl.weight, src: 'pleiades' });
    }
  } else {
    for (const t of sources.places) {
      const name = townName(eraId, t);
      if (!name) continue;
      const { x, y } = project(t.lon, t.lat);
      add(x, y, { name, score: Math.log10(t.pop + 10) - t.rank / 10, src: 'town' });
    }
  }
  for (const list of cands.values()) list.sort((a, b) => b.score - a.score);

  const names = new Map();
  const stats = { historical: 0, region: 0, feature: 0, regionSuffix: 0, kept: provs.length - todo.length };
  const fallback = [];
  for (const p of todo) {
    const pick = (cands.get(p.id) ?? []).find((c) => !used.has(nameKey(c.name)));
    if (pick) { names.set(p.id, pick.name); used.add(nameKey(pick.name)); stats.historical++; } else fallback.push(p);
  }
  // A duplicate city with no town of its own: named from the real city ("Constantinople West").
  const dirOf = (p, cx, cy, spread) => {
    const dx = p.center.x - cx, dy = p.center.y - cy;
    return Math.hypot(dx, dy) < spread * 0.35 ? 'Central' : COMPASS[((Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];
  };
  for (const p of [...fallback]) {
    const keep = keptCity.get(p.id);
    if (!keep) continue;
    const name = `${keep.name} ${dirOf(p, keep.center.x, keep.center.y, 0)}`;
    if (used.has(nameKey(name))) continue;
    names.set(p.id, name); used.add(nameKey(name)); stats.region++;
    fallback.splice(fallback.indexOf(p), 1);
  }
  // Fallback: the modern region the province lies in.
  const regionOf = new Map();
  const byRegion = new Map();
  for (const p of fallback) {
    const { lon, lat } = unproject(p.center.x, p.center.y);
    let a = adminAt(sources.admin1, lon, lat);
    // A seed on a coast or a small island can miss every polygon: nearest region by bbox centre.
    if (!a) {
      let bd = Infinity;
      for (const r of sources.admin1) {
        const d = Math.hypot((r.bbox[0] + r.bbox[2]) / 2 - lon, (r.bbox[1] + r.bbox[3]) / 2 - lat);
        if (d < bd) { bd = d; a = r; }
      }
    }
    // In that era's spelling when a town of the same name was called otherwise (Istanbul → Constantinople).
    const k = norm(a.name);
    const region = (eraId === 'medieval' ? MEDIEVAL_NAMES[k] : RENAMES[k]?.[eraId]) ?? a.name;
    regionOf.set(p.id, region);
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region).push(p);
  }
  const rest = [];
  for (const [region, ps] of byRegion) {
    if (ps.length === 1 && !used.has(nameKey(region))) { names.set(ps[0].id, region); used.add(nameKey(region)); stats.region++; } else rest.push(...ps);
  }
  // Physical features: each goes to the province holding most of it (one province per name).
  const restSet = new Set(rest.map((p) => p.id));
  const pairs = [];
  for (const f of sources.features ?? []) {
    const count = new Map();
    for (const [lon, lat] of f.samples) {
      const { x, y } = project(lon, lat);
      const id = pickProvince(map, x, y);
      if (restSet.has(id)) count.set(id, (count.get(id) ?? 0) + 1);
    }
    for (const [id, n] of count) if (n >= 2 || f.samples.length < 4) pairs.push({ id, name: f.name, score: f.rank * 1000 + (n / f.samples.length) * 100 + Math.min(n, 50) });
  }
  pairs.sort((a, b) => b.score - a.score);
  for (const pr of pairs) {
    if (names.has(pr.id) || used.has(nameKey(pr.name))) continue;
    names.set(pr.id, pr.name); used.add(nameKey(pr.name)); stats.feature++;
  }
  // Then the nearest real town of the era within ~2° that no province uses yet.
  const towns = eraId === 'rome'
    ? sources.pleiades.filter((t) => t.kind === 'town').map((t) => ({ name: t.name, lon: t.lon, lat: t.lat }))
    : sources.places.map((t) => ({ name: townName(eraId, t), lon: t.lon, lat: t.lat })).filter((t) => t.name);
  for (const p of rest) {
    if (names.has(p.id)) continue;
    const { lon, lat } = unproject(p.center.x, p.center.y);
    let best = null, bd = 2;
    for (const t of towns) {
      const d = Math.hypot((t.lon - lon) * Math.cos((lat * Math.PI) / 180), t.lat - lat);
      if (d < bd && !used.has(nameKey(t.name))) { bd = d; best = t; }
    }
    if (best) { names.set(p.id, best.name); used.add(nameKey(best.name)); stats.nearTown = (stats.nearTown ?? 0) + 1; }
  }
  // Last: the region with a compass suffix ("Region North"; numbered if still taken).
  const left = new Map();
  for (const p of rest) if (!names.has(p.id)) { const r = regionOf.get(p.id); if (!left.has(r)) left.set(r, []); left.get(r).push(p); }
  // "Krasnoyarsk Krai North 2" reads better as "Krasnoyarsk North 2".
  const short = (r) => r.replace(/ (Krai|Oblast|Republic|Autonomous Okrug|Autonomous Region|National Park|Province)$/, '');
  for (const [full, ps] of left) {
    const region = short(full);
    const cx = ps.reduce((t, p) => t + p.center.x, 0) / ps.length, cy = ps.reduce((t, p) => t + p.center.y, 0) / ps.length;
    const spread = Math.max(...ps.map((p) => Math.hypot(p.center.x - cx, p.center.y - cy)), 1);
    for (const p of ps) {
      const dx = p.center.x - cx, dy = p.center.y - cy;
      const dir = ps.length === 1 ? null : Math.hypot(dx, dy) < spread * 0.35 ? 'Central' : COMPASS[((Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];
      let name = dir ? `${region} ${dir}` : region;
      for (let n = 2; used.has(nameKey(name)); n++) name = `${region} ${dir ?? ''} ${n}`.replace(/\s+/g, ' ');
      names.set(p.id, name);
      used.add(nameKey(name));
      stats.regionSuffix++;
    }
  }
  return { names, stats };
}
