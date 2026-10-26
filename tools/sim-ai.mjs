// Headless AI simulation: every nation computer-controlled, no player.
//   node tools/sim-ai.mjs [months=6] [difficulty=normal] [era ...]
// Reports growth/shrinkage, wars, peace deals, the largest share of the map
// any nation reached, and the AI's thinking cost.
import { readFileSync } from 'node:fs';
import { GameState } from '../js/state.js';
import { buildWorldMap } from '../js/world.js';
import { generateMap } from '../js/map.js';
import { ERAS, getEra } from '../js/eras.js';
import { Economy } from '../js/economy.js';
import { Armies } from '../js/armies.js';
import { Combat } from '../js/combat.js';
import { Buildings } from '../js/buildings.js';
import { Research } from '../js/research.js';
import { AI } from '../js/ai.js';
import { Diplomacy } from '../js/diplomacy.js';
import { Victory } from '../js/victory.js';

const args = process.argv.slice(2);
const months = Number(args.find((a) => /^\d+$/.test(a)) ?? 6);
const difficulty = args.find((a) => ['easy', 'normal', 'hard'].includes(a)) ?? 'normal';
const eras = args.filter((a) => ERAS.some((e) => e.id === a));
const list = eras.length ? eras.map(getEra) : ERAS;

export function simulate(era, { months = 6, difficulty = 'normal', quiet = false, untilVictory = false, bot = null } = {}) {
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
  const ai = new AI(state, sim);
  sim.ai = ai;
  const diplomacy = new Diplomacy(state, sim);
  sim.diplomacy = diplomacy;
  armies.diplomacy = diplomacy;
  const victory = new Victory(state, sim);
  sim.victory = victory;
  ai.budgetMs = Infinity;
  const map = era.fictional ? Object.assign(generateMap(process.env.SEED ?? 'SIM-0001'), { era }) : buildWorldMap(JSON.parse(readFileSync(new URL(`../data/eras/${era.id}.json`, import.meta.url))), era);
  state.loadMap(map);
  state.playerNationId = -1;
  buildings.start();
  economy.start();
  armies.spawnInitial(-1);
  ai.start(-1, difficulty);
  state.setPhase('playing');
  victory.start({ mode: 'points', timeLimit: 0 });
  // A "player bot": one nation played aggressively, thinking often, with Hard production.
  let botId = -1;
  if (bot) {
    botId = map.nations.find((n) => n.name === bot || n.shortName === bot)?.id ?? -1;
    const b = ai.brains.get(botId);
    if (b) { b.personality = 'conqueror'; b.every = 8; }
    const base = economy.bonus;
    economy.bonus = (n) => (n === botId ? 1.3 : base(n));
  }
  const vp = { target: victory.target, total: victory.totalPoints, reached: null, leaders: [] };
  const start = map.nations.map((n) => state.provincesOf(n.id).length);
  const events = { wars: [], newWars: [], peace: [], conquered: [], diplomacy: [] };
  state.events.on('feed', (e) => {
    if (e.kind === 'war') events.wars.push(e.text);
    if (e.kind === 'peace') events.peace.push(e.text);
    if (e.kind === 'annexed') events.conquered.push(e.text);
    if (e.kind === 'diplomacy') events.diplomacy.push(e.text);
  });
  // New conflicts (a nation choosing to attack), apart from allies and coalitions joining one.
  state.events.on('war:declared', ({ a, b }) => events.newWars.push(`${state.getNation(a).name} → ${state.getNation(b).name}`));
  const hours = months * 730;
  let maxShare = 0, maxShareNation = '';
  const t0 = performance.now();
  for (let h = 0; h < hours; h++) {
    state.clock.time += 3600e3;
    economy.update(state, 1); research.update(state, 1); buildings.update(state, 1);
    armies.update(state, 1); combat.update(state, 1); ai.update(state, 1);
    if (h % 24 === 0) {
      victory.refresh();
      const lead = victory.scores[0];
      if (h % (24 * 90) === 0) vp.leaders.push(`${Math.round(h / 24)}d ${map.nations[lead.id].shortName} ${lead.points}${botId >= 0 ? ` (bot ${victory.scoreOf(botId).points})` : ''}`);
      if (!vp.reached && lead.points >= vp.target) { vp.reached = { days: h / 24, nation: map.nations[lead.id].shortName, points: lead.points }; if (untilVictory) break; }
    }
    if (h % 240 === 0) {
      const counts = map.nations.map((n) => 0);
      for (const p of map.provinces) if (p.owner >= 0) counts[p.owner]++;
      counts.forEach((c, i) => { const s = c / map.provinces.length; if (s > maxShare) { maxShare = s; maxShareNation = map.nations[i].shortName; } });
    }
  }
  const ms = performance.now() - t0;
  const end = map.nations.map((n) => state.provincesOf(n.id).length);
  const delta = map.nations.map((n, i) => ({ n, start: start[i], end: end[i], d: end[i] - start[i] })).filter((r) => r.start || r.end);
  return { state, ai, events, delta, maxShare, maxShareNation, ms, hours, vp, units: [...armies.list.values()].reduce((s, a) => s + a.units.length, 0) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const era of list) {
    const r = simulate(era, { months, difficulty });
    const grew = r.delta.filter((x) => x.d > 0).sort((a, b) => b.d - a.d);
    const shrank = r.delta.filter((x) => x.d < 0).sort((a, b) => a.d - b.d);
    console.log(`\n== ${era.label}: ${months} months, ${difficulty} (${(r.ms / 1000).toFixed(1)} s headless; AI ${r.ai.stats.thinks} thinks, ${(r.ai.stats.ms / r.ai.stats.thinks).toFixed(2)} ms each, slowest step ${r.ai.stats.maxStepMs.toFixed(1)} ms)`);
    console.log(`   wars declared: ${r.events.wars.length} · peace deals: ${r.events.peace.length} · nations conquered: ${r.events.conquered.length} · at war now: ${r.state.map.nations.filter((n) => r.ai.sim.combat.enemiesOf(n.id).length).length} nations · units on map: ${r.units}`);
    console.log(`   grew:   ${grew.slice(0, 8).map((x) => `${x.n.shortName} ${x.start}→${x.end}`).join(', ') || '—'}`);
    console.log(`   shrank: ${shrank.slice(0, 8).map((x) => `${x.n.shortName} ${x.start}→${x.end}`).join(', ') || '—'}`);
    console.log(`   largest share of the map at any time: ${(r.maxShare * 100).toFixed(1)}% (${r.maxShareNation})`);
    console.log(`   first wars: ${r.events.wars.slice(0, 6).join('; ')}`);
    const D = r.ai.sim.diplomacy;
    const kinds = (re) => r.events.diplomacy.filter((t) => re.test(t)).length;
    console.log(`   diplomacy: ${kinds(/formed an alliance/)} alliances, ${kinds(/non-aggression/)} pacts, ${kinds(/joins the war/)} allies called in, ${kinds(/broke/)} treaties broken, ${kinds(/ended the/)} cancelled; blocs now: ${new Set(D.blocs().values()).size}`);
    console.log(`   e.g. ${r.events.diplomacy.slice(0, 5).join('; ')}`);
    // How neighbours feel about each other (sample).
    const ops = [];
    for (const n of r.state.map.nations) for (const o of r.ai.neighborsOf(n.id)) ops.push(D.opinion(n.id, o).value);
    ops.sort((a, b) => a - b);
    if (ops.length) console.log(`   neighbour opinions: min ${ops[0]}, median ${ops[ops.length >> 1]}, 90th pct ${ops[Math.floor(ops.length * 0.9)]}, max ${ops[ops.length - 1]}`);
    if (r.events.conquered.length) console.log(`   conquered: ${r.events.conquered.slice(0, 6).join('; ')}`);
  }
}
