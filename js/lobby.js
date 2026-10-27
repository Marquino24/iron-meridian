/**
 * lobby.js — Multiplayer lobby data (step 11A): create, list, join and leave
 * persistent games. Two backends with the same methods:
 *   SupabaseLobby  the real tables (docs/supabase-multiplayer.sql), through the
 *                  signed-in user's client: row-level security decides
 *   DemoLobby      this browser only (the claude.ai preview and localhost),
 *                  with a couple of sample games, so the flow can be tried
 * Nothing here runs a game yet: the game authority comes in a later step.
 */

/** Speeds offered when creating a game: real minutes per game day. */
export const SPEEDS = [
  { minutes: 2, label: 'Fast · 1 game day per 2 min' },
  { minutes: 4, label: 'Standard · 1 day per 4 min' },
  { minutes: 10, label: 'Relaxed · 1 day per 10 min' },
  { minutes: 30, label: 'Slow · 1 day per 30 min' },
];

const notSetUp = (e) => /PGRST20[25]|schema cache|does not exist/i.test(`${e?.code ?? ''} ${e?.message ?? ''}`);
function check({ data, error }) {
  if (error) {
    throw new Error(notSetUp(error)
      ? 'The multiplayer tables aren\'t set up yet. (Owner: run docs/supabase-multiplayer.sql in the Supabase SQL editor.)'
      : error.message);
  }
  return data;
}

export class SupabaseLobby {
  constructor(auth) { this.auth = auth; }
  get db() { return this.auth.client; }
  get me() { return this.auth.user?.id; }

  /** Open and running games: [{ id, name, era, map_seed, minutes_per_day, max_players, players, status, created_at, mine }]. */
  async list() { return check(await this.db.rpc('open_games')) ?? []; }

  async create({ name, era, mapSeed, minutesPerDay, maxPlayers }) {
    return check(await this.db.from('games')
      .insert({ name, era, map_seed: era === 'fictional' ? mapSeed : null, minutes_per_day: minutesPerDay, max_players: maxPlayers })
      .select().single());
  }

  /** Nation ids already taken in a game. */
  async taken(gameId) { return check(await this.db.rpc('taken_nations', { g: gameId })) ?? []; }

  /** My seat in a game, or null. */
  async seat(gameId) {
    return check(await this.db.from('game_players').select('*').eq('game_id', gameId).eq('user_id', this.me).maybeSingle());
  }

  async join(gameId, nationId) { check(await this.db.from('game_players').insert({ game_id: gameId, user_id: this.me, nation_id: nationId })); }
  async leave(gameId) { check(await this.db.from('game_players').delete().eq('game_id', gameId).eq('user_id', this.me)); }
}

export class DemoLobby {
  constructor() {
    this.demo = true;
    this.key = 'im:demo-lobby';
  }

  load() {
    try {
      const v = JSON.parse(localStorage.getItem(this.key));
      if (v?.games) return v;
    } catch { /* ignore */ }
    const t = Date.now();
    return {
      games: [
        { id: 'demo-g1', name: '[Sample] Europe 1939', era: 'ww2', map_seed: null, minutes_per_day: 4, max_players: 12, status: 'open', created_at: new Date(t - 36e5 * 3).toISOString(), seats: { 'demo-x1': 13, 'demo-x2': 4 } },
        { id: 'demo-g2', name: '[Sample] Fictional league', era: 'fictional', map_seed: 'LOBBY-7', minutes_per_day: 10, max_players: 6, status: 'open', created_at: new Date(t - 36e5).toISOString(), seats: {} },
      ],
    };
  }

  save(v) { try { localStorage.setItem(this.key, JSON.stringify(v)); } catch { /* ignore */ } }

  async list() {
    return this.load().games.filter((g) => g.status !== 'finished').map((g) => ({
      ...g, players: Object.keys(g.seats).length, mine: 'demo-owner' in g.seats,
    }));
  }

  async create({ name, era, mapSeed, minutesPerDay, maxPlayers }) {
    const v = this.load();
    const g = { id: `demo-${Date.now().toString(36)}`, name: name.trim(), era, map_seed: era === 'fictional' ? mapSeed : null, minutes_per_day: minutesPerDay, max_players: maxPlayers, status: 'open', created_at: new Date().toISOString(), seats: {} };
    v.games.unshift(g);
    this.save(v);
    return g;
  }

  async taken(gameId) { return Object.values(this.game(gameId).seats).sort((a, b) => a - b); }
  async seat(gameId) { const n = this.game(gameId).seats['demo-owner']; return n == null ? null : { game_id: gameId, nation_id: n }; }

  async join(gameId, nationId) {
    const v = this.load();
    const g = v.games.find((x) => x.id === gameId);
    if (Object.values(g.seats).includes(nationId)) throw new Error('That nation is taken.');
    if (Object.keys(g.seats).length >= g.max_players) throw new Error('This game is full');
    g.seats['demo-owner'] = nationId;
    this.save(v);
  }

  async leave(gameId) {
    const v = this.load();
    delete v.games.find((x) => x.id === gameId).seats['demo-owner'];
    this.save(v);
  }

  game(id) { return this.load().games.find((x) => x.id === id); }
}
