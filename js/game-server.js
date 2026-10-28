/**
 * game-server.js — One tick of a persistent multiplayer game (step 11B).
 *
 * Runs wherever the game authority runs: the Supabase Edge Function
 * (supabase/functions/tick), the local tests, or (for the demo lobby) the
 * browser. It only talks to a `store` (below), so it doesn't care which.
 *
 * A tick:
 *   1. loads the game row; only running games tick
 *   2. builds the map (era data or the fictional seed) and the systems, and
 *      restores the saved state, or sets up a new game on the first tick
 *   3. works out who is human: seated players who aren't inactive for longer
 *      than the game's inactive_days. Everyone else is computer-run (a player
 *      who leaves or goes quiet has their nation handed to the AI)
 *   4. applies the queued orders in the order they were sent, each checked by
 *      js/commands.js exactly as in single-player, and marks each applied or
 *      rejected with the reason
 *   5. advances the clock by the real time since the last tick at the game's
 *      speed (at most MAX_HOURS per tick: a long gap catches up over several)
 *   6. checks the win conditions (an ended game is marked finished)
 *   7. saves the full state and one fog-of-war view per player
 *
 * store (async):
 *   game(id) → row of public.games          state(id) → { tick, state } | null
 *   players(id) → rows of game_players       pending(id) → pending game_commands, oldest first
 *   save(id, { state, views: [{ nation, state }], game: {…columns}, commands: [{ id, status, result }], aiPlayers: [user ids] })
 *   mapData(eraId) → era JSON (historical eras)
 */

import { GameState } from './state.js';
import { buildWorldMap } from './world.js';
import { generateMap } from './map.js';
import { getEra } from './eras.js';
import { Economy } from './economy.js';
import { Armies } from './armies.js';
import { Combat } from './combat.js';
import { Buildings } from './buildings.js';
import { Research } from './research.js';
import { AI } from './ai.js';
import { Diplomacy } from './diplomacy.js';
import { Victory } from './victory.js';
import { Sandbox } from './sandbox.js';
import { Integration } from './integration.js';
import { Commands } from './commands.js';
import { snapshot, restore, pack, unpack, encode, decode } from './save.js';
import { viewFor } from './fog.js';

/** Most game hours one tick simulates (keeps a tick well inside the Edge Function's 2 s CPU). */
export const MAX_HOURS = 36;
const DAY_MS = 864e5;

/** Base64 of bytes, and back (works in browsers, Deno and Node). */
export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64) { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }

/** The simulation, wired the way main.js wires it (no rendering). */
export function makeSim(map) {
  const state = new GameState();
  const economy = new Economy(state);
  const buildings = new Buildings(state, economy);
  const armies = new Armies(state, economy);
  armies.buildings = buildings;
  const combat = new Combat(state, armies);
  const research = new Research(state, economy);
  research.armies = armies; research.buildings = buildings;
  armies.research = research; buildings.research = research;
  const sim = { economy, buildings, armies, combat, research };
  sim.ai = new AI(state, sim);
  sim.diplomacy = new Diplomacy(state, sim);
  armies.diplomacy = sim.diplomacy;
  sim.victory = new Victory(state, sim);
  sim.sandbox = new Sandbox(state, sim);
  sim.integration = new Integration(state, sim);
  sim.commands = new Commands(state, sim);
  sim.ai.budgetMs = Infinity; // the server thinks for every computer nation in full
  if (map) state.loadMap(map);
  return { state, sim };
}

/** Build a game's map: era data, or the Fictional World from its seed. */
export async function buildMap(game, store) {
  const era = getEra(game.era);
  return era.fictional ? Object.assign(generateMap(game.map_seed), { era }) : buildWorldMap(await store.mapData(era.id), era);
}

const SYSTEMS = ['economy', 'research', 'buildings', 'armies', 'combat', 'integration', 'ai', 'victory'];

/** Advance the world `hours` game hours (whole hours, then the rest). */
export function advance({ state, sim }, hours) {
  let left = hours;
  while (left > 1e-9) {
    const h = Math.min(1, left);
    state.clock.time += h * 3600e3;
    for (const s of SYSTEMS) sim[s].update(state, h);
    left -= h;
  }
}

/**
 * Tick one game. → summary { status, hours, applied, rejected, humans, ms } or { skipped: reason }.
 * `now` is the real time (ms) to bring the game up to.
 */
export async function tickGame(store, gameId, { now = Date.now(), maxHours = MAX_HOURS } = {}) {
  const t0 = performance.now();
  const game = await store.game(gameId);
  if (!game) return { skipped: 'no such game' };
  if (game.status !== 'running') return { skipped: `game is ${game.status}` };

  const phase = {};
  let tp = performance.now();
  const lap = (k) => { const t = performance.now(); phase[k] = Math.round(t - tp); tp = t; };
  lap('readGame');
  const g = makeSim(await buildMap(game, store));
  lap('buildMap');
  const { state, sim } = g;
  const saved = await store.state(gameId);
  const players = await store.players(gameId);
  lap('readState');
  const inactiveMs = (game.inactive_days ?? 7) * DAY_MS;
  const quiet = players.filter((p) => !p.ai_controlled && now - Date.parse(p.last_seen) > inactiveMs);
  const humans = new Set(players.filter((p) => !p.ai_controlled && !quiet.includes(p)).map((p) => p.nation_id));
  state.humans = humans;

  if (saved) {
    restore(g, await unpack(fromB64(saved.state)));
    state.humans = humans;
  } else {
    // First tick: a new world. Every nation without a person is computer-run.
    state.playerNationId = -1;
    sim.buildings.start();
    sim.economy.start();
    sim.armies.spawnInitial(-1);
    sim.ai.start(-1, game.difficulty ?? 'normal');
    sim.victory.start({ mode: game.win_mode ?? 'points', timeLimit: game.time_limit ?? 0, dominationPct: 40 });
  }
  lap('restore');
  state.playerNationId = -1;
  state.setPhase('playing');
  // Hand nations between people and the computer: a new player takes over a
  // computer nation; a player who left or went quiet gives theirs back.
  for (const n of state.nations) {
    const alive = state.provinces.some((p) => p.owner === n.id);
    if (humans.has(n.id)) sim.ai.removeBrain(n.id);
    else if (alive && !sim.ai.brains.has(n.id)) sim.ai.addBrain(n.id);
  }

  // Orders, oldest first; each from a player still seated on that nation.
  const pending = await store.pending(gameId);
  lap('readOrders');
  const seat = new Map(players.map((p) => [p.user_id, p.nation_id]));
  const results = [];
  for (const c of pending) {
    let r;
    if (seat.get(c.user_id) !== c.nation_id) r = { ok: false, error: 'You no longer play this nation.' };
    else if (!humans.has(c.nation_id)) r = { ok: false, error: 'Your nation is computer-run (inactive).' };
    else r = sim.commands.apply({ kind: c.kind, nation: c.nation_id, payload: c.payload });
    results.push({ id: c.id, status: r.ok ? 'applied' : 'rejected', result: r.ok ? null : (r.error ?? 'Not possible.') });
  }

  // Time: the real time since the last tick, at the game's speed.
  const last = game.ticked_at ? Date.parse(game.ticked_at) : now;
  const hoursPerMs = 24 / (Number(game.minutes_per_day) * 60000);
  const owed = Math.max(0, (now - last) * hoursPerMs);
  const hours = Math.min(owed, maxHours);
  lap('orders');
  advance(g, hours);
  lap('simulate');
  // A capped tick only moves the tick clock as far as it simulated, so the next one catches up.
  const tickedAt = hours < owed ? new Date(last + hours / hoursPerMs) : new Date(now);

  // Win conditions (victory.update checks every quarter day).
  sim.victory.refresh();
  const over = sim.victory.over;
  const snap = snapshot(g);
  const data = decode(snap.state);
  const full = toB64(await pack(snap));
  const views = [];
  for (const n of humans) {
    const v = { ...snap, meta: { ...snap.meta, nation: n }, state: encode(viewFor(state.map, data, n)) };
    views.push({ nation: n, state: toB64(await pack(v)) });
  }
  lap('pack');
  const gameCols = { tick: (game.tick ?? 0) + 1, game_time: state.clock.time, ticked_at: tickedAt.toISOString() };
  if (over) Object.assign(gameCols, { status: 'finished', ended_at: new Date(now).toISOString(), winner: over.winner, end_reason: over.reason });
  await store.save(gameId, { state: full, tick: gameCols.tick, views, game: gameCols, commands: results, aiPlayers: quiet.map((p) => p.user_id) });
  lap('write');
  return {
    status: over ? 'finished' : 'running', tick: gameCols.tick, hours: Math.round(hours * 100) / 100, owed: Math.round(owed * 100) / 100,
    applied: results.filter((r) => r.status === 'applied').length, rejected: results.filter((r) => r.status === 'rejected').length,
    humans: [...humans], handedToAi: quiet.map((p) => p.nation_id), bytes: full.length, ms: Math.round(performance.now() - t0),
    // Time per phase (ms): reads and writes wait on the database (not CPU); the rest is computation.
    phase, computeMs: phase.buildMap + phase.restore + phase.orders + phase.simulate + phase.pack,
  };
}
