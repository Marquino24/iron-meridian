// The game tick (step 11B): advances one persistent multiplayer game.
//
// Called two ways:
//   • by the schedule (pg_cron + pg_net, docs/supabase-multiplayer-cron.sql),
//     with the header x-tick-secret: <TICK_SECRET> and body { "game": "<id>" }
//   • by a player who just sent an order (on-demand tick), with their own
//     sign-in token: Authorization: Bearer <user JWT>, body { "game": "<id>" }.
//     Only players seated in that game may ask, at most once per
//     tick_cooldown_seconds per game (claim_tick in the SQL).
// Either way claim_tick() leases the game, so two ticks never overlap.
//
// Secrets (supabase secrets set …; never in the repo): TICK_SECRET. Supabase
// provides SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to every function.
// The game code is copied in by `node tools/build-functions.mjs` (game/, gitignored).
// Deploy with verify_jwt off (the function checks callers itself):
//   supabase functions deploy tick --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { tickGame } from './game/js/game-server.js';
import { SupabaseStore } from './store.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Constant-time string comparison (the schedule's shared secret). */
function same(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405);
  const { game } = await req.json().catch(() => ({}));
  if (typeof game !== 'string' || !UUID.test(game)) return reply({ error: 'body must be { "game": "<id>" }' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const scheduled = same(req.headers.get('x-tick-secret') ?? '', Deno.env.get('TICK_SECRET') ?? '');
  if (!scheduled) {
    // A player asking for an on-demand tick: must be signed in and seated in the game.
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: who } = await admin.auth.getUser(jwt);
    if (!who?.user) return reply({ error: 'sign in first' }, 401);
    const { data: seat } = await admin.from('game_players').select('nation_id').eq('game_id', game).eq('user_id', who.user.id).maybeSingle();
    if (!seat) return reply({ error: 'you are not in this game' }, 403);
  }
  const { data: claimed, error } = await admin.rpc('claim_tick', { g: game, on_demand: !scheduled });
  if (error) return reply({ error: error.message }, 500);
  if (!claimed) return reply({ skipped: scheduled ? 'already ticking, or not running' : 'ticked moments ago: your order applies on the next tick' }, 200);

  const t0 = performance.now();
  try {
    const store = new SupabaseStore(admin);
    const r = await tickGame(store, game);
    return reply({ ...r, cpuMs: Math.round(performance.now() - t0), by: scheduled ? 'schedule' : 'player' });
  } catch (e) {
    console.error('tick failed', game, e);
    return reply({ error: `tick failed: ${(e as Error).message}` }, 500);
  } finally {
    await admin.rpc('finish_tick', { g: game, ms: Math.round(performance.now() - t0) });
  }
});
