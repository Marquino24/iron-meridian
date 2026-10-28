/**
 * mp-local-store.js — A game store for js/game-server.js kept in plain JSON
 * (step 11B): the local tests keep it in memory, the demo lobby in this
 * browser's localStorage. The real one is supabase/functions/tick/store.ts.
 *
 * db = { games: [], players: [], states: { id: { tick, state } }, views: { 'id:nation': { tick, state } }, commands: [] }
 */
export class LocalStore {
  /** @param {{ load(): object, save(db: object): void }} backing  @param {(eraId: string) => Promise<object>} mapData */
  constructor(backing, mapData) {
    this.backing = backing;
    this.mapData = mapData;
  }

  db() {
    const d = this.backing.load() ?? {};
    d.games ??= []; d.players ??= []; d.states ??= {}; d.views ??= {}; d.commands ??= [];
    return d;
  }

  async game(id) { return this.db().games.find((g) => g.id === id) ?? null; }
  async players(id) { return this.db().players.filter((p) => p.game_id === id); }
  async state(id) { return this.db().states[id] ?? null; }
  async pending(id) { return this.db().commands.filter((c) => c.game_id === id && c.status === 'pending').sort((a, b) => a.id - b.id); }

  async save(id, { state, tick, views, game, commands, aiPlayers }) {
    const d = this.db();
    d.states[id] = { tick, state };
    for (const v of views) d.views[`${id}:${v.nation}`] = { game_id: id, nation_id: v.nation, tick, state: v.state };
    Object.assign(d.games.find((g) => g.id === id), game);
    for (const r of commands) Object.assign(d.commands.find((c) => c.id === r.id), { status: r.status, result: r.result, tick });
    for (const u of aiPlayers) Object.assign(d.players.find((p) => p.game_id === id && p.user_id === u) ?? {}, { ai_controlled: true });
    this.backing.save(d);
  }

  // --- What clients do (the real ones go through Supabase and its row-level security) ---

  view(id, nation) { return this.db().views[`${id}:${nation}`] ?? null; }

  send(id, userId, nation, kind, payload) {
    const d = this.db();
    const c = { id: (d.commands.at(-1)?.id ?? 0) + 1, game_id: id, user_id: userId, nation_id: nation, kind, payload, status: 'pending', created_at: new Date().toISOString() };
    d.commands.push(c);
    this.backing.save(d);
    return c;
  }

  commandsOf(id, userId) { return this.db().commands.filter((c) => c.game_id === id && c.user_id === userId); }
}

/** A backing kept in memory (tests). */
export const memoryBacking = (init = {}) => {
  let d = structuredClone(init);
  return { load: () => d, save: (x) => { d = x; } };
};
