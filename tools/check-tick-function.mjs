// The tick Edge Function (supabase/functions/tick/index.ts + store.ts) under
// Deno, with supabase-js replaced by tools/fake-supabase-js.mjs: who may call
// it, the lease and the on-demand cooldown, and a real tick of a WWII game
// through the Supabase store (state, views, order results, games row).
//   node tools/build-functions.mjs
//   deno run -A --import-map=tools/tick-test-import-map.json tools/check-tick-function.mjs
import { fromB64 } from '../js/game-server.js';

let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };
const GAME = '11111111-1111-4111-8111-111111111111';
const era = JSON.parse(await Deno.readTextFile(new URL('../data/eras/ww2.json', import.meta.url)));
const DE = era.nations.findIndex((n) => n.name === 'German Reich');
const FR = era.nations.findIndex((n) => n.name === 'France');

let leaseUntil = 0, lastOnDemand = 0;
globalThis.__FAKE_DB__ = {
  log: [],
  users: { 'jwt-alice': 'alice', 'jwt-bob': 'bob', 'jwt-eve': 'eve' },
  tables: {
    games: [{ id: GAME, name: 'Test', era: 'ww2', minutes_per_day: 4, max_players: 10, status: 'running', inactive_days: 7, tick: 0, ticked_at: null }],
    game_players: [
      { game_id: GAME, user_id: 'alice', nation_id: DE, last_seen: new Date().toISOString(), ai_controlled: false },
      { game_id: GAME, user_id: 'bob', nation_id: FR, last_seen: new Date().toISOString(), ai_controlled: false },
    ],
    game_commands: [],
  },
  // claim_tick / finish_tick as in docs/supabase-multiplayer-11b.sql (20 s cooldown for on-demand ticks).
  rpc: {
    claim_tick: ({ on_demand }) => {
      const now = Date.now();
      if (leaseUntil > now || (on_demand && now - lastOnDemand < 20000)) return { data: false, error: null };
      leaseUntil = now + 90000;
      if (on_demand) lastOnDemand = now;
      return { data: true, error: null };
    },
    finish_tick: () => { leaseUntil = 0; return { data: null, error: null }; },
  },
};
Deno.env.set('SUPABASE_URL', 'http://fake');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-key');
Deno.env.set('TICK_SECRET', 'test-secret-123');
await import('../supabase/functions/tick/index.ts'); // Deno.serve on :8000
await new Promise((r) => setTimeout(r, 300));
const call = (body, headers = {}) => fetch('http://localhost:8000/', { method: 'POST', body: JSON.stringify(body), headers }).then(async (r) => ({ status: r.status, body: await r.json() }));

// Who may call.
check((await call({ game: 'nope' }, { 'x-tick-secret': 'test-secret-123' })).status === 400, 'a malformed game id is refused');
check((await call({ game: GAME }, { 'x-tick-secret': 'wrong' })).status === 401, 'a wrong schedule secret (and no sign-in) is refused');
check((await call({ game: GAME }, { authorization: 'Bearer jwt-eve' })).status === 403, 'a signed-in user who is not in the game is refused');

// The schedule's tick: a new world.
let r = await call({ game: GAME }, { 'x-tick-secret': 'test-secret-123' });
const db = globalThis.__FAKE_DB__.tables;
check(r.status === 200 && r.body.tick === 1 && r.body.by === 'schedule', `scheduled tick: world created in ${r.body.cpuMs} ms`);
check(db.game_states.length === 1 && db.game_views.length === 2 && db.games[0].tick === 1 && db.games[0].ticked_at, 'saved: full state, two views, the games row');
check(leaseUntil === 0, 'lease released after the tick');

// Orders from both players, then alice asks for an on-demand tick.
const { unpack, decode } = await import('../js/save.js');
const state = decode((await unpack(fromB64(db.game_states[0].state))).state);
const field = state.armies.list.find((a) => a.nation === DE && !a.garrison && a.kind === 'land');
const to = state.owners.findIndex((o, pid) => o === DE && pid !== field.node);
db.game_commands.push(
  { id: 1, game_id: GAME, user_id: 'alice', nation_id: DE, kind: 'army.move', payload: { army: field.id, to }, status: 'pending' },
  { id: 2, game_id: GAME, user_id: 'bob', nation_id: FR, kind: 'army.move', payload: { army: field.id, to }, status: 'pending' },
);
db.games[0].ticked_at = new Date(Date.now() - 60000).toISOString(); // a minute of real time to simulate
r = await call({ game: GAME }, { authorization: 'Bearer jwt-alice' });
check(r.status === 200 && r.body.by === 'player' && r.body.applied === 1 && r.body.rejected === 1, `on-demand tick by a player: ${r.body.applied} order applied, ${r.body.rejected} rejected, ${r.body.hours} game hours, ${r.body.cpuMs} ms`);
check(db.game_commands[0].status === 'applied' && db.game_commands[1].status === 'rejected' && /Not your army/.test(db.game_commands[1].result), `results stored: ${db.game_commands.map((c) => `${c.status}${c.result ? ` (${c.result})` : ''}`).join(', ')}`);
r = await call({ game: GAME }, { authorization: 'Bearer jwt-bob' });
check(r.status === 200 && /next tick/.test(r.body.skipped ?? ''), `a second on-demand tick within 20 s: "${r.body.skipped}"`);

// A tick over 30 game hours (5 real minutes at 4 min per game day): the real CPU question, here on this machine.
const times = [];
for (let i = 0; i < 6; i++) {
  db.games[0].ticked_at = new Date(Date.now() - 5 * 60000).toISOString();
  r = await call({ game: GAME }, { 'x-tick-secret': 'test-secret-123' });
  times.push(r.body.cpuMs);
}
times.sort((a, b) => a - b);
check(r.body.hours === 30, `scheduled ticks of 30 game hours: median ${times[3]} ms, max ${times[5]} ms (Deno, this machine; Supabase's numbers come from the deployed function)`);

console.log(failures ? `${failures} failure(s)` : 'all tick function checks passed');
Deno.exit(failures ? 1 : 0);
