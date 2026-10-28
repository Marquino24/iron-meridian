/**
 * lobby.js — Multiplayer data (steps 11A–11B): the lobby (create, list, join,
 * leave, start, pause) and, once in a game, its view, orders and ticks.
 * Two backends with the same methods:
 *   SupabaseLobby  the real tables (docs/supabase-multiplayer*.sql) through the
 *                  signed-in user's client (row-level security decides) and the
 *                  tick Edge Function (supabase/functions/tick)
 *   DemoLobby      this browser only (the claude.ai preview and localhost): the
 *                  game server (js/game-server.js) runs right here, its tables
 *                  in localStorage, so the whole flow can be tried
 */

import { tickGame } from './game-server.js';
import { LocalStore } from './mp-local-store.js';
import { loadEraData } from './eras.js';

/** Speeds offered when creating a game: real minutes per game day. */
export const SPEEDS = [
  { minutes: 2, label: 'Fast · 1 game day per 2 min' },
  { minutes: 4, label: 'Standard · 1 day per 4 min' },
  { minutes: 10, label: 'Relaxed · 1 day per 10 min' },
  { minutes: 30, label: 'Slow · 1 day per 30 min' },
];
/** Days without signing in before a player's nation is handed to the computer. */
export const INACTIVE_DAYS = [1, 3, 7, 14];

const notSetUp = (e) => /PGRST20[25]|schema cache|does not exist/i.test(`${e?.code ?? ''} ${e?.message ?? ''}`);
function check({ data, error }) {
  if (error) {
    throw new Error(notSetUp(error)
      ? 'The multiplayer tables aren\'t set up yet. (Owner: run docs/supabase-multiplayer.sql and docs/supabase-multiplayer-11b.sql in the Supabase SQL editor.)'
      : error.message);
  }
  return data;
}

export class SupabaseLobby {
  constructor(auth) {
    this.auth = auth;
    this.tickCooldownMs = 21000; // tick_cooldown_seconds (20) in docs/supabase-multiplayer-11b.sql, plus a second
  }
  get db() { return this.auth.client; }
  get me() { return this.auth.user?.id; }

  /** Games to show: open, running and paused ones, and finished games I played. */
  async list() { return check(await this.db.rpc('open_games')) ?? []; }

  async create({ name, era, mapSeed, minutesPerDay, maxPlayers, inactiveDays = 7 }) {
    return check(await this.db.from('games')
      .insert({ name, era, map_seed: era === 'fictional' ? mapSeed : null, minutes_per_day: minutesPerDay, max_players: maxPlayers, inactive_days: inactiveDays })
      .select().single());
  }

  async taken(gameId) { return check(await this.db.rpc('taken_nations', { g: gameId })) ?? []; }
  async seat(gameId) { return check(await this.db.from('game_players').select('*').eq('game_id', gameId).eq('user_id', this.me).maybeSingle()); }
  async join(gameId, nationId) { check(await this.db.from('game_players').insert({ game_id: gameId, user_id: this.me, nation_id: nationId })); }
  async leave(gameId) { check(await this.db.from('game_players').delete().eq('game_id', gameId).eq('user_id', this.me)); }

  /** Start (open → running), pause, resume, end: creator or owner. */
  async setStatus(gameId, status) {
    check(await this.db.from('games').update({ status }).eq('id', gameId));
    const g = await this.game(gameId);
    if (g?.status !== status) throw new Error('Only the game\'s creator can do that.');
    return g;
  }

  // --- In a game ---

  async game(gameId) {
    const g = check(await this.db.from('games').select('*').eq('id', gameId).maybeSingle());
    return g && { ...g, created_by_me: g.created_by === this.me };
  }
  /** My nation's view (fog of war; row-level security returns only mine). */
  async view(gameId) { return check(await this.db.from('game_views').select('tick, state, nation_id').eq('game_id', gameId).maybeSingle()); }
  async send(gameId, nation, kind, payload) {
    return check(await this.db.from('game_commands').insert({ game_id: gameId, nation_id: nation, kind, payload }).select('id').single());
  }
  async myCommands(gameId) {
    return check(await this.db.from('game_commands').select('id, kind, status, result').eq('game_id', gameId).eq('user_id', this.me).order('id', { ascending: false }).limit(30));
  }
  /** Ask for an on-demand tick (rate-limited per game by the server). */
  async requestTick(gameId) {
    const { data, error } = await this.db.functions.invoke('tick', { body: { game: gameId } });
    if (error) throw new Error(error.message);
    return data;
  }
  /** Realtime: new ticks and my orders' results. → unsubscribe */
  subscribe(gameId, cb) {
    const ch = this.db.channel(`mp-${gameId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, () => cb('game'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_commands', filter: `game_id=eq.${gameId}` }, () => cb('commands'))
      .subscribe();
    return () => this.db.removeChannel(ch);
  }
  async touch(gameId) { check(await this.db.from('game_players').update({ last_seen: new Date().toISOString() }).eq('game_id', gameId).eq('user_id', this.me)); }
}

/**
 * Demo: everything in this browser. The schedule is a timer that ticks a
 * running game every minute while it's open (the real one ticks every few
 * minutes whether anyone is online or not).
 */
export class DemoLobby {
  constructor({ user = 'demo-owner', key = 'im:demo-mp', tickEveryMs = 60000 } = {}) {
    this.demo = true;
    this.me = user;
    this.key = key;
    this.tickEveryMs = tickEveryMs;
    this.tickCooldownMs = 5500;
    this.lastOnDemand = new Map();
    this.store = new LocalStore({ load: () => this.load(), save: (d) => this.save(d) }, (era) => loadEraData(era));
  }

  load() {
    try {
      const v = JSON.parse(localStorage.getItem(this.key));
      if (v?.games) return v;
    } catch { /* ignore */ }
    const t = Date.now();
    return {
      games: [
        { id: 'demo-g1', name: '[Sample] Europe 1939', era: 'ww2', map_seed: null, minutes_per_day: 4, max_players: 12, inactive_days: 7, status: 'open', created_by: 'demo-x1', created_at: new Date(t - 36e5 * 3).toISOString(), tick: 0 },
        { id: 'demo-g2', name: '[Sample] Fictional league', era: 'fictional', map_seed: 'LOBBY-7', minutes_per_day: 2, max_players: 6, inactive_days: 7, status: 'open', created_by: 'demo-x2', created_at: new Date(t - 36e5).toISOString(), tick: 0 },
      ],
      players: [
        { game_id: 'demo-g1', user_id: 'demo-x1', nation_id: 13, last_seen: new Date(t).toISOString(), ai_controlled: false },
        { game_id: 'demo-g1', user_id: 'demo-x2', nation_id: 4, last_seen: new Date(t).toISOString(), ai_controlled: false },
      ],
    };
  }

  save(v) {
    try { localStorage.setItem(this.key, JSON.stringify(v)); } catch (e) { throw new Error(`The demo can't store this game in the browser (${e.name}).`); }
  }

  db() { return this.store.db(); }
  game0(id) { return this.db().games.find((x) => x.id === id); }

  async list() {
    const d = this.db();
    return d.games.filter((g) => g.status !== 'finished' || d.players.some((p) => p.game_id === g.id && p.user_id === this.me)).map((g) => ({
      ...g, players: d.players.filter((p) => p.game_id === g.id).length,
      mine: d.players.some((p) => p.game_id === g.id && p.user_id === this.me), created_by_me: g.created_by === this.me,
    }));
  }

  async create({ name, era, mapSeed, minutesPerDay, maxPlayers, inactiveDays = 7 }) {
    const d = this.db();
    if (d.games.filter((g) => g.created_by === this.me && g.status !== 'finished').length >= 2) throw new Error('You already run 2 active games (limit 2). Finish one first.');
    const g = { id: `demo-${Date.now().toString(36)}`, name: name.trim(), era, map_seed: era === 'fictional' ? mapSeed : null, minutes_per_day: minutesPerDay, max_players: maxPlayers, inactive_days: inactiveDays, status: 'open', created_by: this.me, created_at: new Date().toISOString(), tick: 0 };
    d.games.unshift(g);
    this.save(d);
    return { ...g, created_by_me: true };
  }

  async taken(gameId) { return this.db().players.filter((p) => p.game_id === gameId).map((p) => p.nation_id).sort((a, b) => a - b); }
  async seat(gameId) { return this.db().players.find((p) => p.game_id === gameId && p.user_id === this.me) ?? null; }

  async join(gameId, nationId) {
    const d = this.db();
    const g = d.games.find((x) => x.id === gameId);
    const seats = d.players.filter((p) => p.game_id === gameId);
    if (!['open', 'running'].includes(g.status)) throw new Error('This game is not taking players');
    if (seats.some((p) => p.nation_id === nationId)) throw new Error('That nation is taken.');
    if (seats.length >= g.max_players) throw new Error('This game is full');
    d.players.push({ game_id: gameId, user_id: this.me, nation_id: nationId, last_seen: new Date().toISOString(), ai_controlled: false });
    if (g.status === 'open' && seats.length + 1 >= g.max_players) Object.assign(g, { status: 'running', started_at: new Date().toISOString(), ticked_at: null });
    this.save(d);
  }

  async leave(gameId) {
    const d = this.db();
    d.players = d.players.filter((p) => !(p.game_id === gameId && p.user_id === this.me));
    this.save(d);
  }

  async setStatus(gameId, status) {
    const d = this.db();
    const g = d.games.find((x) => x.id === gameId);
    if (g.created_by !== this.me) throw new Error('Only the game\'s creator can do that.');
    if (g.status === 'finished') throw new Error('This game has ended');
    if (status === 'running' && g.status === 'open') Object.assign(g, { started_at: new Date().toISOString(), ticked_at: null });
    if (status === 'running' && g.status === 'paused') g.ticked_at = new Date().toISOString();
    g.status = status;
    this.save(d);
    return this.game(gameId);
  }

  async game(gameId) { const g = this.game0(gameId); return g && { ...g, created_by_me: g.created_by === this.me }; }
  async view(gameId) {
    const seat = await this.seat(gameId);
    return seat ? this.store.view(gameId, seat.nation_id) : null;
  }
  async send(gameId, nation, kind, payload) {
    const recent = this.db().commands.filter((c) => c.user_id === this.me && Date.now() - Date.parse(c.created_at) < 60000).length;
    if (recent >= 20) throw new Error('Too many orders: at most 20 a minute. Wait a moment.');
    return this.store.send(gameId, this.me, nation, kind, payload);
  }
  async myCommands(gameId) { return this.store.commandsOf(gameId, this.me).slice(-30).reverse(); }

  /** The demo's "Edge Function": tick right here (5 s between on-demand ticks). */
  async requestTick(gameId, { onDemand = true } = {}) {
    const last = this.lastOnDemand.get(gameId) ?? 0;
    if (onDemand && Date.now() - last < 5000) return { skipped: 'ticked moments ago' };
    this.lastOnDemand.set(gameId, Date.now());
    return tickGame(this.store, gameId);
  }

  subscribe(gameId, cb) {
    const timer = setInterval(async () => {
      const g = this.game0(gameId);
      if (g?.status !== 'running') return;
      if (g.ticked_at && Date.now() - Date.parse(g.ticked_at) < this.tickEveryMs) return;
      await this.requestTick(gameId, { onDemand: false });
      cb('game');
    }, 5000);
    return () => clearInterval(timer);
  }

  async touch(gameId) {
    const d = this.db();
    const p = d.players.find((x) => x.game_id === gameId && x.user_id === this.me);
    if (p) { p.last_seen = new Date().toISOString(); this.save(d); }
  }
}
