// Command records (step 11A): every player order is a JSON record checked and
// applied by js/commands.js. Checks each kind does what the direct call did,
// that records survive JSON (they will travel to a server), and that orders
// for someone else's nation, malformed payloads and fake answers are refused.
//   node tools/check-commands.mjs
import { readFileSync } from 'node:fs';
import { GameState } from '../js/state.js';
import { buildWorldMap } from '../js/world.js';
import { getEra } from '../js/eras.js';
import { Economy } from '../js/economy.js';
import { Armies } from '../js/armies.js';
import { Combat } from '../js/combat.js';
import { Buildings } from '../js/buildings.js';
import { Research } from '../js/research.js';
import { AI } from '../js/ai.js';
import { Diplomacy } from '../js/diplomacy.js';
import { Integration } from '../js/integration.js';
import { Commands, KINDS } from '../js/commands.js';

let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };

const era = getEra('ww2');
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
sim.integration = new Integration(state, sim);
const commands = new Commands(state, sim);
sim.commands = commands;
state.loadMap(buildWorldMap(JSON.parse(readFileSync(new URL('../data/eras/ww2.json', import.meta.url))), era));
const me = state.nations.find((n) => n.name === 'German Reich').id;
const pl = state.nations.find((n) => n.name === 'Poland').id;
state.setPlayerNation(me);
buildings.start(); economy.start(); armies.spawnInitial(me); sim.ai.start(me, 'normal');
state.setPhase('playing');
for (const k of economy.keys) economy.get(me)[k] += 1e5;

// Records go through JSON on their way to a server: send every one that way here.
const send = (kind, payload, nation = me) => commands.apply(JSON.parse(JSON.stringify({ kind, nation, payload })));
const berlin = state.getNation(me).capitalId;
const field = [...armies.list.values()].find((a) => a.nation === me && !a.garrison && a.kind === 'land');
const theirs = [...armies.list.values()].find((a) => a.nation === pl);
const home = state.provinces.find((p) => p.owner === me && p.neighbors.includes(field.node)) ?? state.provinces.find((p) => p.owner === me && p.id !== field.node);

console.log(`${Object.keys(KINDS).length} command kinds: ${Object.keys(KINDS).join(', ')}`);
let r = send('army.move', { army: field.id, to: home.id });
check(r.ok && field.dest === home.id, `army.move: ${field.name} heads for ${home.name}`);
check(send('army.stop', { army: field.id }).ok && !field.path.length && field.dest === (field.seg ? field.seg.to : null), 'army.stop (halts at the next province)');
r = send('army.move', { army: theirs.id, to: home.id });
check(!r.ok && /Not your army/.test(r.error), `moving Poland's army refused: "${r.error}"`);
r = send('army.move', { army: theirs.id, to: home.id }, pl);
check(r.ok || !/Not your army/.test(r.error ?? ''), 'Poland may move its own army (as its player)');
check(!send('army.move', { army: field.id, to: 'Warsaw' }).ok, 'malformed payload refused');
check(/Unknown order/.test(send('army.teleport', { army: field.id }).error), 'unknown kind refused');
check(/No such nation/.test(commands.apply({ kind: 'army.stop', nation: 999, payload: { army: field.id } }).error), 'unknown nation refused');
// Split and merge an army that is standing still.
const idle = [...armies.list.values()].find((a) => a.nation === me && a.kind === 'land' && !a.seg && a.units.length >= 2);
const n0 = idle.units.length;
r = send('army.split', { army: idle.id, units: [0] });
check(r.ok && idle.units.length === n0 - 1 && armies.list.get(r.army)?.units.length === 1, `army.split: ${r.name} formed from ${idle.name}`);
check(send('army.merge', { into: idle.id, from: r.army }).ok && idle.units.length === n0, 'army.merge back');
const q0 = armies.queue(berlin).length;
r = send('unit.recruit', { province: berlin, type: armies.roster.byRole.inf.key });
check(r.ok && armies.queue(berlin).length === q0 + 1, 'unit.recruit in Berlin');
check(send('unit.cancel', { province: berlin, index: q0 }).ok && armies.queue(berlin).length === q0, 'unit.cancel');
const warsaw = state.getNation(pl).capitalId;
check(/Not your city/.test(send('unit.recruit', { province: warsaw, type: armies.roster.byRole.inf.key }).error), 'recruiting in Warsaw refused');
r = send('building.build', { province: berlin, type: 'farm' });
check(r.ok && buildings.construction.has(berlin), 'building.build');
check(send('building.cancel', { province: berlin }).ok && !buildings.construction.has(berlin), 'building.cancel');
const t1 = research.tree.find((t) => t.tier === 1);
check(send('research.start', { tech: t1.id }).ok && research.status(me, t1.id) === 'active', `research.start ${t1.name}`);
check(send('research.cancel', { tech: t1.id }).ok && research.status(me, t1.id) === 'available', 'research.cancel');
check(send('research.queue', { tech: t1.id }).ok, 'research.queue');
check(!send('research.start', { tech: 'nonsense' }).ok, 'unknown tech refused');
// Diplomacy.
r = send('treaty.propose', { nation: pl, type: 'alliance' });
check(!r.ok && r.refused && r.error, `treaty.propose answered: "${r.error}"`);
check(send('war.declare', { target: pl }).ok && combat.atWar(me, pl), 'war.declare on Poland');
check(!send('war.declare', { target: me }).ok, 'war on yourself refused');
// Offers: only what was really offered can be accepted.
check(/no longer open/.test(send('peace.answer', { id: 12345, yes: true }).error), 'accepting a peace that was never offered: refused');
const ev = { from: pl, to: me };
state.events.emit('peace:offer', ev);
check(ev.offerId > 0 && commands.open(me).length === 1, `Poland's peace offer recorded (#${ev.offerId})`);
check(/no longer open/.test(send('peace.answer', { id: ev.offerId, yes: true }, pl).error), 'Poland cannot accept its own offer to you');
check(send('peace.answer', { id: ev.offerId, yes: true }).ok && !combat.atWar(me, pl), 'you accept: peace');
check(!send('peace.answer', { id: ev.offerId, yes: true }).ok, 'an offer is answered only once');
const p = { from: pl, to: me, kind: 'treaty', type: 'nap' };
state.events.emit('diplomacy:proposal', p);
r = send('proposal.answer', { id: p.offerId, yes: false });
check(r.ok && !commands.open(me).length, 'proposal.answer: declined, offer closed');
// The log: what a server would report back.
check(commands.log.length > 20 && commands.log.every((e) => typeof e.ok === 'boolean'), `log keeps ${commands.log.length} records with results`);

console.log(failures ? `${failures} failure(s)` : 'all command checks passed');
process.exit(failures ? 1 : 0);
