/**
 * save.js — Saved games (step 7B).
 *
 * The map itself is never saved: a real-world era rebuilds the same map from
 * its data, the fictional world from its seed. A save holds only what changes
 * while you play: province owners, the clock, and every simulation system's
 * own state (stocks, buildings, armies, battles, wars, research, the AI's
 * brains, treaties and opinions, win conditions and stats, the feed).
 *
 * Saves are JSON, gzip-compressed (CompressionStream), stored in IndexedDB:
 * slots 1–8 plus 'auto' (every in-game week). A save can also be exported as
 * a .json file (header plus the compressed game) and imported on another device.
 *
 * Encoding: Maps, Sets and ±Infinity survive the trip; armies inside battles
 * are stored by id (battles point at the same army objects as the army list).
 */

export const SAVE_VERSION = 1;
export const SLOTS = ['1', '2', '3', '4', '5', '6', '7', '8'];
export const AUTO_SLOT = 'auto';
const FORMAT = 'iron-meridian-save';
const DB_NAME = 'iron-meridian';
const STORE = 'saves';

// --- Encoding ----------------------------------------------------------------------------

/** Plain JSON-able copy: Map → {$m}, Set → {$s}, non-finite numbers → {$n}. */
export function encode(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : { $n: String(v) };
  if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
  if (v instanceof Map) return { $m: [...v].map(([k, x]) => [encode(k), encode(x)]) };
  if (v instanceof Set) return { $s: [...v].map(encode) };
  if (Array.isArray(v)) return v.map(encode);
  const o = {};
  for (const k of Object.keys(v)) { const x = encode(v[k]); if (x !== undefined) o[k] = x; }
  return o;
}

export function decode(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(decode);
  if (v.$m) return new Map(v.$m.map(([k, x]) => [decode(k), decode(x)]));
  if (v.$s) return new Set(v.$s.map(decode));
  if (v.$n) return Number(v.$n);
  const o = {};
  for (const k of Object.keys(v)) o[k] = decode(v[k]);
  return o;
}

const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

// --- Snapshot and restore ------------------------------------------------------------------

/**
 * Everything needed to resume this game. `ctx` = { state, sim, feed, settings }.
 * Returns { meta, state } (plain JSON).
 */
export function snapshot({ state, sim, feed }, extra = {}) {
  const st = state, { economy, buildings, armies, combat, research, ai, diplomacy, victory, sandbox } = sim;
  const me = st.playerNationId;
  const map = st.map;
  // Battles hold Sets of army objects: store the ids of those still in the field.
  const battles = [...combat.battles.values()].map((b) => ({ ...b, sides: b.sides.map((s) => ({ ...s, armies: [...s.armies].filter((a) => armies.list.get(a.id) === a).map((a) => a.id) })) }));
  const data = {
    clock: { ...st.clock },
    player: me,
    sandbox: st.sandbox,
    owners: map.provinces.map((p) => p.owner),
    homeOf: map.provinces.map((p) => p.homeOf ?? p.owner),
    economy: { stock: economy.stock },
    buildings: pick(buildings, ['levels', 'construction']),
    armies: { list: [...armies.list.values()], ...pick(armies, ['queues', 'nextId', 'counters', 'refitClock', 'started']) },
    combat: { battles, active: [...combat.active].map(([node, b]) => [node, b.id]), ...pick(combat, ['wars', 'warInfo', 'truces', 'history', 'occupations', 'nextId', 'levyHours']) },
    research: [...research.nations].map(([n, r]) => [n, { done: r.done, active: r.active, queue: r.queue }]),
    ai: pick(ai, ['difficulty', 'enabled', 'disabled', 'brains', 'clockHours']),
    diplomacy: pick(diplomacy, ['treaties', 'memory', 'links', 'metBy', 'lastAny', 'lastFrom']),
    victory: pick(victory, ['config', 'over', 'continued', 'started', 'lastCheck', 'stats']),
    sandboxTools: { instant: sandbox.instant },
    feed: feed ? { items: feed.items.slice(0, 80), nextId: feed.nextId } : null,
  };
  const nation = st.getNation(me);
  victory.refresh();
  const meta = {
    era: map.era.id,
    eraLabel: map.era.label,
    seed: map.era.fictional ? map.seed : null,
    nation: me,
    nationName: nation?.name ?? '?',
    date: st.clock.time,
    days: Math.round((st.clock.time - st.clock.start) / 864e5),
    difficulty: ai.difficulty,
    sandbox: st.sandbox,
    victory: victory.config.mode,
    points: victory.scoreOf(me).points,
    provinces: victory.scoreOf(me).provinces,
    savedAt: Date.now(),
    ...extra,
  };
  return { format: FORMAT, version: SAVE_VERSION, meta, state: encode(data) };
}

/**
 * Put a snapshot back onto a freshly loaded map of the same era (and seed).
 * The caller loads the map first, then calls this, then shows the game.
 */
export function restore({ state, sim, feed }, save) {
  if (save?.format !== FORMAT) throw new Error('Not an Iron Meridian save.');
  if (save.version > SAVE_VERSION) throw new Error('This save comes from a newer version of the game.');
  const d = decode(save.state);
  const st = state, { economy, buildings, armies, combat, research, ai, diplomacy, victory, sandbox } = sim;
  const map = st.map;
  if (map.era.id !== save.meta.era || d.owners.length !== map.provinces.length) throw new Error('The save does not match this map.');

  st.setSandbox(d.sandbox);
  st.setPlayerNation(d.player);
  map.provinces.forEach((p, i) => { p.owner = d.owners[i]; p.homeOf = d.homeOf[i]; });

  // Buildings first: income depends on them.
  buildings.levels = d.buildings.levels;
  buildings.construction = d.buildings.construction;
  economy.stock = d.economy.stock;

  // Armies: rebuild the per-node index.
  armies.list = new Map();
  armies.byNode = new Map();
  for (const a of d.armies.list) {
    armies.list.set(a.id, a);
    if (!armies.byNode.has(a.node)) armies.byNode.set(a.node, new Set());
    armies.byNode.get(a.node).add(a);
  }
  Object.assign(armies, pick(d.armies, ['queues', 'nextId', 'counters', 'refitClock', 'started']));
  armies.statCache = new Map();
  armies.preview = null;

  // Battles: army ids back to the same objects as the army list.
  const byId = (id) => armies.list.get(id);
  combat.battles = new Map(d.combat.battles.map((b) => [b.id, { ...b, sides: b.sides.map((s) => ({ ...s, armies: new Set(s.armies.map(byId).filter(Boolean)) })) }]));
  combat.active = new Map(d.combat.active.map(([node, id]) => [node, combat.battles.get(id)]).filter(([, b]) => b));
  Object.assign(combat, pick(d.combat, ['wars', 'warInfo', 'truces', 'history', 'occupations', 'nextId', 'levyHours']));
  combat.levyHours ??= 0; // saves from before step 9

  research.nations = new Map(d.research.map(([n, r]) => [n, { ...r, fx: null }]));

  ai.reset();
  Object.assign(ai, d.ai);
  ai.current = null;
  ai.refreshStrength(); // power of every nation, read by opinions and the AI

  diplomacy.reset();
  Object.assign(diplomacy, d.diplomacy);
  diplomacy.version++;

  Object.assign(victory, d.victory);
  victory.refresh();
  sandbox.instant = d.sandboxTools.instant;
  if (feed && d.feed) { feed.items = d.feed.items; feed.nextId = d.feed.nextId; feed.render(); }

  st.clock.time = d.clock.time;
  st.clock.start = d.clock.start;

  // Caches that depend on all of the above.
  economy.totalsCache?.clear();
  economy.recount();
  buildings.changed?.();
  armies.changed();
  return d.clock.speed;
}

// --- Compression -----------------------------------------------------------------------------

const hasStreams = typeof CompressionStream === 'function';

async function streamBytes(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** JSON → gzip bytes (plain UTF-8 where the browser can't compress). */
export async function pack(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  return hasStreams ? streamBytes(raw, new CompressionStream('gzip')) : raw;
}

/** gzip (or plain JSON) bytes → object. */
export async function unpack(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const gz = u8[0] === 0x1f && u8[1] === 0x8b;
  if (gz && !hasStreams) throw new Error('This browser cannot read compressed saves.');
  const raw = gz ? await streamBytes(u8, new DecompressionStream('gzip')) : u8;
  return JSON.parse(new TextDecoder().decode(raw));
}

// --- IndexedDB -------------------------------------------------------------------------------

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Saving is not available in this browser.')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'slot' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the save database.'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

/** Where IndexedDB is blocked (some embeds, private windows): saves last for this page load only. */
const memory = new Map();
let persistent = true;
/** False once IndexedDB turned out to be unavailable (saves then last for this page load). */
export const isPersistent = () => persistent;
const memoryStore = {
  put(rec) { memory.set(rec.slot, rec); return { result: rec.slot }; },
  getAll() { return { result: [...memory.values()] }; },
  get(slot) { return { result: memory.get(slot) }; },
  delete(slot) { memory.delete(slot); return { result: undefined }; },
};

async function tx(mode, fn) {
  let d;
  try { d = await db(); } catch { persistent = false; return fn(memoryStore)?.result; }
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error ?? new Error('Save database error.'));
    t.onabort = () => reject(t.error ?? new Error('Save aborted (storage full?).'));
  });
}

/** Store a save in a slot: { slot, meta, thumb, bytes, size }. */
export async function writeSlot(slot, save, thumb = null) {
  const bytes = await pack(save);
  await tx('readwrite', (s) => s.put({ slot, meta: save.meta, thumb, bytes, size: bytes.length }));
  return bytes.length;
}

/** Every stored slot's header (meta, thumbnail, size), newest first. */
export async function listSlots() {
  const all = await tx('readonly', (s) => s.getAll());
  return (all ?? []).map(({ slot, meta, thumb, size }) => ({ slot, meta, thumb, size })).sort((a, b) => b.meta.savedAt - a.meta.savedAt);
}

export async function readSlot(slot) {
  const rec = await tx('readonly', (s) => s.get(slot));
  if (!rec) throw new Error('That slot is empty.');
  return { save: await unpack(rec.bytes), thumb: rec.thumb };
}

export async function deleteSlot(slot) { await tx('readwrite', (s) => s.delete(slot)); }

// --- Files -------------------------------------------------------------------------------------

const toBase64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * Text of an exported save file: readable JSON with the header, and the game
 * itself gzip-compressed as base64 (claude.ai only hands out .json and other
 * common file types, so the file is JSON wherever it goes).
 */
export async function exportText(save, thumb) {
  const gz = await pack(save);
  return JSON.stringify({ format: `${FORMAT}-file`, version: SAVE_VERSION, meta: save.meta, thumb, gz: toBase64(gz) });
}

/** Read an exported file (or a bare compressed/plain save). Returns { save, thumb }. */
export async function importBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let obj = await unpack(u8);
  let thumb = null;
  if (obj?.format === `${FORMAT}-file`) { thumb = obj.thumb ?? null; obj = await unpack(fromBase64(obj.gz)); }
  if (obj?.format !== FORMAT) throw new Error('Not an Iron Meridian save file.');
  return { save: obj, thumb };
}

/** File name for an export, e.g. iron-meridian_ww2_german-reich_1940-03-12.json */
export function fileName(meta) {
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  const date = new Date(meta.date).toISOString().slice(0, 10);
  return `iron-meridian_${meta.era}_${slug(meta.nationName)}_${date}${meta.sandbox ? '_sandbox' : ''}.json`;
}
