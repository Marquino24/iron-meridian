// Headless check of the tutorial scenario (step 12): the same setup as the
// game (tutorial.js setupScenario), then the war the coach walks you through:
// march, declare war, beat the border guard, take the province, make peace
// keeping it. Fails if the map data changes so the scenario no longer works.
//   node tools/check-tutorial.mjs
import { readFileSync } from 'node:fs';
import { makeSim } from '../js/game-server.js';
import { buildWorldMap } from '../js/world.js';
import { getEra } from '../js/eras.js';
import { SCENARIO, setupScenario, finishRecruits } from '../js/tutorial.js';

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };
const data = JSON.parse(readFileSync(new URL(`../data/eras/${SCENARIO.era}.json`, import.meta.url), 'utf8'));
const { state, sim } = makeSim(buildWorldMap(data, getEra(SCENARIO.era)));
const me = state.nations.find((n) => n.name === SCENARIO.nation).id;
state.setPlayerNation(me);
sim.buildings.start(); sim.economy.start(); sim.armies.spawnInitial(me); sim.ai.start(me, 'easy');
state.setPhase('playing');
const sc = setupScenario(state, sim);
check(!!sc, `scenario: ${SCENARIO.nation} vs ${SCENARIO.enemy}, march to ${sc?.stage.name}, take ${sc?.target.name}`);
if (!sc) process.exit(1);
check(!sim.ai.enabled, 'computer nations passive');
const cmd = (kind, payload) => sim.commands.issue(kind, payload);
const systems = [sim.economy, sim.research, sim.buildings, sim.armies, sim.combat, sim.integration, sim.ai, sim.sandbox, sim.victory];
const run = (max, until) => { for (let h = 0; h < max; h++) { state.clock.time += 36e5; for (const s of systems) s.update(state, 1); if (until()) return h + 1; } return Infinity; };

check(cmd('building.build', { province: sc.cap.id, type: sim.buildings.types[0] }).ok, 'build in the capital');
const armiesBefore = sim.armies.list.size;
check(cmd('unit.recruit', { province: sc.cap.id, type: sim.armies.roster.units[0].key }).ok, 'recruit in the capital');
finishRecruits(state, sim);
check(sim.armies.list.size === armiesBefore + 1 || [...sim.armies.list.values()].some((a) => a.fresh), 'the recruit is ready at once');
const a = sc.army;
check(cmd('army.move', { army: a.id, to: sc.stage.id }).ok, 'march to the border');
check(cmd('war.declare', { target: sc.foe }).ok && sim.combat.enemiesOf(me).length === 1, 'war on Castilla only (no allies drawn in)');
check(cmd('army.move', { army: a.id, to: sc.target.id }).ok, 'attack');
let won = null;
state.events.on('battle:end', (b) => { won ??= b; });
const hb = run(400, () => won);
check(won && won.sides[won.winner].nation === me, `battle won after ${hb} game hours`);
const hc = run(400, () => sc.target.owner === me);
check(sc.target.owner === me, `${sc.target.name} taken ${hc} hours later`);
check(cmd('peace.propose', { nation: sc.foe, provinces: [sc.target.id] }).ok && !sim.combat.atWar(me, sc.foe) && sc.target.owner === me, 'peace keeping it');
const tech = sim.research.tree.find((t) => sim.research.status(me, t.id) === 'available');
check(!!tech && cmd('research.start', { tech: tech.id }).ok, `research ${tech?.name}`);
console.log(failures ? `${failures} failure(s)` : 'tutorial scenario OK');
process.exit(failures ? 1 : 0);
