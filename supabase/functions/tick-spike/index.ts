// Spike (step 11A): one server tick of a persistent game on Supabase's own
// hardware. Builds the map, restores a saved mid-game state, advances N game
// hours with every nation computer-run, saves it again, and returns the time
// of each phase. Build the game copy first: node tools/spike/build-edge.mjs
//
//   curl -X POST "$SUPABASE_URL/functions/v1/tick-spike" \
//     -H "Authorization: Bearer $SUPABASE_SECRET_OR_SERVICE_KEY" \
//     -d '{"era":"modern","hours":24,"busy":true}'
//
// Not used by the game. Delete it after measuring (supabase functions delete tick-spike).
import { GameState } from './game/js/state.js';
import { buildWorldMap } from './game/js/world.js';
import { getEra } from './game/js/eras.js';
import { Economy } from './game/js/economy.js';
import { Armies } from './game/js/armies.js';
import { Combat } from './game/js/combat.js';
import { Buildings } from './game/js/buildings.js';
import { Research } from './game/js/research.js';
import { AI } from './game/js/ai.js';
import { Diplomacy } from './game/js/diplomacy.js';
import { Victory } from './game/js/victory.js';
import { Sandbox } from './game/js/sandbox.js';
import { Integration } from './game/js/integration.js';
import * as save from './game/js/save.js';

const now = () => performance.now();

Deno.serve(async (req) => {
  const { era = 'ww2', hours = 24, busy = false } = await req.json().catch(() => ({}));
  if (!['ww2', 'modern'].includes(era) || !(hours > 0 && hours <= 168)) return new Response('bad request', { status: 400 });
  const t0 = now();
  const mapJson = JSON.parse(await Deno.readTextFile(new URL(`./game/data/${era}.json`, import.meta.url)));
  const bytes = await Deno.readFile(new URL(`./game/data/state-${era}${busy ? '-busy' : ''}.bin`, import.meta.url));
  const t1 = now();
  const state = new GameState();
  const economy = new Economy(state);
  const buildings = new Buildings(state, economy);
  const armies = new Armies(state, economy);
  armies.buildings = buildings;
  const combat = new Combat(state, armies);
  const research = new Research(state, economy);
  research.armies = armies; research.buildings = buildings;
  armies.research = research; buildings.research = research;
  // deno-lint-ignore no-explicit-any
  const sim: any = { economy, buildings, armies, combat, research };
  sim.ai = new AI(state, sim);
  sim.diplomacy = new Diplomacy(state, sim);
  armies.diplomacy = sim.diplomacy;
  sim.victory = new Victory(state, sim);
  sim.sandbox = new Sandbox(state, sim);
  sim.integration = new Integration(state, sim);
  sim.ai.budgetMs = Infinity;
  state.loadMap(buildWorldMap(mapJson, getEra(era)));
  const t2 = now();
  save.restore({ state, sim }, await save.unpack(bytes));
  state.setPhase('playing');
  const t3 = now();
  for (let h = 0; h < hours; h++) {
    state.clock.time += 3600e3;
    for (const s of ['economy', 'research', 'buildings', 'armies', 'combat', 'integration', 'ai', 'victory']) sim[s].update(state, 1);
  }
  const t4 = now();
  const out = await save.pack(save.snapshot({ state, sim }));
  const t5 = now();
  const ms = (a: number, b: number) => Math.round(b - a);
  return Response.json({
    era, hours, busy,
    ms: { read: ms(t0, t1), buildMap: ms(t1, t2), restore: ms(t2, t3), sim: ms(t3, t4), save: ms(t4, t5), total: ms(t0, t5) },
    stateKB: Math.round(out.length / 1024),
    memoryMB: Math.round(Deno.memoryUsage().rss / 1048576),
    heapMB: Math.round(Deno.memoryUsage().heapUsed / 1048576),
  });
});
