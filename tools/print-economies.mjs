// Prints the 5 largest economies per era (money per day at the start).
//   node tools/print-economies.mjs
import { readFileSync } from 'node:fs';
import { GameState } from '../js/state.js';
import { buildWorldMap } from '../js/world.js';
import { ERAS } from '../js/eras.js';
import { Economy } from '../js/economy.js';
import { Buildings } from '../js/buildings.js';

for (const era of ERAS.filter((e) => !e.fictional)) {
  const state = new GameState();
  const economy = new Economy(state);
  const buildings = new Buildings(state, economy);
  state.loadMap(buildWorldMap(JSON.parse(readFileSync(new URL(`../data/eras/${era.id}.json`, import.meta.url))), era));
  buildings.start();
  economy.recount();
  const rows = state.nations.map((n) => ({ n, inc: economy.income(n.id).perDay })).filter((r) => r.inc.money > 0).sort((a, b) => b.inc.money - a.inc.money);
  console.log(`${era.label}: ` + rows.slice(0, 5).map((r) => `${r.n.shortName} ${Math.round(r.inc.money)}`).join(', ')
    + ` · median nation ${Math.round(rows[Math.floor(rows.length / 2)].inc.money)}`);
}
