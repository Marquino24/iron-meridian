/**
 * fog.js — Fog of war for multiplayer (step 11B), applied on the server.
 *
 * The game server keeps the whole world. Each player is sent a view of it cut
 * down to what their nation can see:
 *   • their own and their allies' armies, recruitment, construction, research
 *     and stocks, in full
 *   • other armies only where they can see: in or next to land they or their
 *     allies hold, the sea zones off those coasts, and around their armies.
 *     Their orders (routes) are hidden, only where they are and where they're
 *     heading on their current hop
 *   • battles they can see, open offers made to them, nobody else's
 * Borders, buildings and the map itself are public. viewFor() works on the
 * decoded save data (js/save.js) and returns a new object; the original is
 * left untouched.
 */

/** Nodes (province ids, and sea zones as P + index) a set of nations can see. */
export function visibleNodes(map, data, friends) {
  const P = map.provinces.length;
  const vis = new Set();
  const seeAround = (node) => {
    vis.add(node);
    if (node < P) {
      const p = map.provinces[node];
      for (const q of p.neighbors) vis.add(q);
      for (const s of p.seaNeighbors ?? []) vis.add(P + s);
    } else {
      const z = map.seaZones[node - P];
      for (const s of z?.neighbors ?? []) vis.add(P + s);
      for (const q of z?.coastalProvinces ?? []) vis.add(q);
    }
  };
  data.owners.forEach((o, pid) => { if (friends.has(o)) seeAround(pid); });
  for (const a of data.armies.list) if (friends.has(a.nation)) { seeAround(a.node); if (a.seg) seeAround(a.seg.to); }
  return vis;
}

/** Nations whose armies a nation sees in full: itself and its allies. */
export function friendsOf(data, nation) {
  const friends = new Set([nation]);
  const t = data.diplomacy?.treaties;
  const entries = t instanceof Map ? [...t.entries()] : Object.entries(t ?? {});
  for (const [key, list] of entries) {
    const types = Array.isArray(list) ? list : list instanceof Set ? [...list] : Object.keys(list ?? {});
    if (!types.includes('alliance')) continue;
    const [a, b] = String(key).split(':').map(Number);
    if (a === nation) friends.add(b);
    if (b === nation) friends.add(a);
  }
  return friends;
}

const zeroed = (stock) => Object.fromEntries(Object.keys(stock ?? {}).map((k) => [k, 0]));

/**
 * The view of decoded save data for one nation. → new data object.
 * @param {object} map   the game map (adjacency)
 * @param {object} data  decoded snapshot data
 * @param {number} nation
 */
export function viewFor(map, data, nation) {
  const friends = friendsOf(data, nation);
  const vis = visibleNodes(map, data, friends);
  const seen = (a) => friends.has(a.nation) || vis.has(a.node) || (a.seg && (vis.has(a.seg.from) || vis.has(a.seg.to)));
  const armies = data.armies.list.filter(seen).map((a) => (friends.has(a.nation) ? a : { ...a, path: [], dest: a.seg ? a.seg.to : null }));
  const kept = new Set(armies.map((a) => a.id));
  const battles = data.combat.battles.filter((b) => vis.has(b.node) || b.sides.some((s) => friends.has(s.nation)))
    .map((b) => ({ ...b, sides: b.sides.map((s) => ({ ...s, armies: s.armies.filter((id) => kept.has(id)) })) }));
  const battleIds = new Set(battles.map((b) => b.id));
  const own = (pid) => friends.has(data.owners[pid]);
  const filterMap = (m, keep) => new Map([...(m ?? new Map())].filter(([k]) => keep(Number(k))));
  return {
    ...data,
    player: nation,
    economy: { ...data.economy, stock: data.economy.stock.map((s, n) => (friends.has(n) ? s : zeroed(s))) },
    buildings: { ...data.buildings, construction: filterMap(data.buildings.construction, own) },
    armies: { ...data.armies, list: armies, queues: filterMap(data.armies.queues, own) },
    combat: {
      ...data.combat,
      battles,
      active: data.combat.active.filter(([, id]) => battleIds.has(id)),
      history: (data.combat.history ?? []).filter((id) => battleIds.has(id)),
      occupations: filterMap(data.combat.occupations, (pid) => vis.has(pid)),
    },
    research: data.research.map(([n, r]) => [n, friends.has(n) ? r : { done: r.done, active: [], queue: [] }]),
    // The computer nations' plans stay on the server.
    ai: { ...data.ai, brains: new Map(), enabled: false },
    offers: data.offers ? { pending: data.offers.pending.filter(([n]) => n === nation), next: data.offers.next } : null,
    feed: null,
  };
}
