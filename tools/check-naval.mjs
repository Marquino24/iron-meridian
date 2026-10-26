// AI naval invasions, headless: put computer nations at war with enemies they
// can only reach by sea, run the world on, and count landings (a land army
// stepping ashore from a sea zone onto enemy soil).
//   node tools/check-naval.mjs [months=6]
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

const months = Number(process.argv[2] ?? 6);
// [era, attacker, defender]: enemies with no land border between them.
const CASES = [
  ['ww2', 'German Reich', 'United Kingdom'],
  ['ww2', 'Empire of Japan', 'United States'],
  ['ww2', 'Empire of Japan', 'Australia'],
  ['modern', 'United States of America', 'Cuba'],
];
let failures = 0;

for (const [eraId, atk, def] of CASES) {
  const era = getEra(eraId);
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
  sim.diplomacy = new Diplomacy(state, sim);
  armies.diplomacy = sim.diplomacy;
  ai.budgetMs = Infinity;
  state.loadMap(buildWorldMap(JSON.parse(readFileSync(new URL(`../data/eras/${era.id}.json`, import.meta.url))), era));
  state.playerNationId = -1;
  buildings.start(); economy.start(); armies.spawnInitial(-1); ai.start(-1, 'normal');
  state.setPhase('playing');
  const id = (name) => state.nations.find((n) => n.name === name).id;
  const A = id(atk), D = id(def);
  const landBorder = state.provinces.some((p) => p.owner === A && p.neighbors.some((q) => state.provinces[q].owner === D));
  // The attacker is the stronger side here, and fights only this war.
  economy.bonus = ((base) => (n) => (n === A ? 1.6 : base(n)))(economy.bonus);
  for (const a of armies.list.values()) if (a.nation === A) for (const u of [...a.units]) a.units.push({ ...u });
  sim.diplomacy.declareWar(A, D);
  const landings = [];
  const arrive = armies.arrive.bind(armies);
  armies.arrive = (army) => {
    const from = army.seg.from, to = army.seg.to;
    if (army.nation === A && army.kind === 'land' && armies.isSea(from) && !armies.isSea(to)) {
      const p = state.provinces[to];
      if (p.owner === D || p.homeOf === D) landings.push({ day: Math.round((state.clock.time - state.clock.start) / 864e5), place: p.name });
    }
    arrive(army);
  };
  const before = state.provinces.filter((p) => p.owner === D).length;
  for (let h = 0; h < months * 730; h++) {
    state.clock.time += 3600e3;
    for (const s of [economy, research, buildings, armies, combat, ai]) s.update(state, 1);
    // Keep the attacker's war going (the defender may sue for peace).
    if (h % 24 === 0 && !combat.atWar(A, D) && combat.truceUntil(A, D) == null) sim.diplomacy.declareWar(A, D);
  }
  const taken = state.provinces.filter((p) => p.homeOf === D && p.owner === A).length;
  const ok = landings.length > 0;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${era.label}: ${atk} → ${def}${landBorder ? ' (they also share a land border)' : ''}: ${landings.length} landings${landings.length ? ` (first on day ${landings[0].day} at ${landings[0].place})` : ''}, ${taken} of ${before} provinces taken, ${ai.stats.landings ?? 0} landing orders`);
}
console.log(failures ? `${failures} failure(s)` : 'all naval checks passed');
process.exit(failures ? 1 : 0);
