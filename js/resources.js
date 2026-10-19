/**
 * resources.js — Era resource sets, what each province yields, and oil deposits.
 *
 * Resource keys are shared by every era so costs and code stay simple; only
 * the labels change (the Romans call money "Gold", food "Grain", steel "Iron"):
 *   Roman / Medieval:            gold, grain, iron, manpower
 *   WWI / WWII:                  money, food, steel, oil, manpower
 *   Cold War / Modern / Fictional: money, food, steel, oil, electronics, manpower
 *
 * Base daily yield of a province (buildings add to it, see buildings.js):
 *   money        10 × share          (share: land 1, city 3, capital 5)
 *   manpower     120 × share         (population follows the same shares)
 *   food         8 × terrain fertility (plains 1.5, forest 1, mountains 0.5, urban 0.6)
 *   steel        2 × share, +4 in mountains (ore)
 *   oil          8 on an oil deposit (industrial eras)
 *   electronics  3 × (share − 1): cities only (Cold War and later)
 * Money, steel and electronics are multiplied by the province's devEco,
 * food and manpower by devPop (development.js).
 */

import { project } from './projection.js';
import { hashSeed } from './map.js';

export const RESOURCES = {
  money: { key: 'money', icon: '◉', color: '#ffb547' },
  food: { key: 'food', icon: '❦', color: '#9fd36a' },
  steel: { key: 'steel', icon: '▣', color: '#b8c4cc' },
  oil: { key: 'oil', icon: '⬮', color: '#c58cff' },
  electronics: { key: 'electronics', icon: '⌁', color: '#6fd3e0' },
  manpower: { key: 'manpower', icon: '♟', color: '#e8e2cc' },
};

const ANCIENT = { keys: ['money', 'food', 'steel', 'manpower'], labels: { money: 'Gold', food: 'Grain', steel: 'Iron', manpower: 'Manpower' }, industrial: false };
const INDUSTRIAL = { keys: ['money', 'food', 'steel', 'oil', 'manpower'], labels: { money: 'Money', food: 'Food', steel: 'Steel', oil: 'Oil', manpower: 'Manpower' }, industrial: true };
const MODERN = { keys: ['money', 'food', 'steel', 'oil', 'electronics', 'manpower'], labels: { ...INDUSTRIAL.labels, electronics: 'Electronics' }, industrial: true };

const SETS = { rome: ANCIENT, medieval: ANCIENT, ww1: INDUSTRIAL, ww2: INDUSTRIAL, coldwar: MODERN, modern: MODERN, fictional: MODERN };

/** { keys, labels, industrial } for an era id. */
export const resourceSet = (eraId) => SETS[eraId] ?? MODERN;

export const shareOf = (p) => (p.isCapital ? 5 : p.isCity ? 3 : 1);
const FERTILITY = { plains: 1.5, forest: 1, mountains: 0.5, urban: 0.6 };

/** Base daily yield of a province before buildings and multipliers. */
export function baseYield(p, set) {
  const share = shareOf(p);
  // Development (development.js): real-world weight of the province's region.
  const eco = p.devEco ?? 1, pop = p.devPop ?? 1;
  const y = {
    money: 10 * share * eco,
    manpower: 120 * share * pop,
    food: 8 * (FERTILITY[p.terrain] ?? 1) * pop,
    steel: (2 * share + (p.terrain === 'mountains' ? 4 : 0)) * eco,
  };
  if (set.keys.includes('oil')) y.oil = p.oil ? 8 : 0;
  if (set.keys.includes('electronics')) y.electronics = 3 * (share - 1) * eco;
  return y;
}

/** Starting stockpile on top of ten days of income. */
export const START_BONUS = { money: 200, food: 200, steel: 200, oil: 300, electronics: 100, manpower: 1000 };

/**
 * Real oil regions (lon, lat). Ancient eras keep the deposits too (they show
 * on the map data) but oil wells only exist from WWI on.
 */
const OIL_FIELDS = [
  [49.9, 40.4], [45.7, 43.3], [40.1, 44.6],                       // Baku, Grozny, Maykop
  [26.0, 44.9], [23.4, 49.3],                                    // Ploiești, Borysław (Galicia)
  [49.0, 31.0], [44.4, 35.5], [47.9, 29.3], [50.1, 26.3], [49.3, 25.4], [51.2, 25.3], [54.4, 24.0], [47.8, 30.5], // Persian Gulf
  [-94.8, 32.4], [-102.5, 31.8], [-95.3, 29.8], [-97.5, 35.5], [-119.0, 35.4], [-148.5, 70.3], [-113.5, 53.5], // N. America
  [-97.9, 22.3], [-71.6, 10.6], [-61.4, 10.4],                   // Tampico, Maracaibo, Trinidad
  [104.7, -3.0], [116.8, -1.2], [114.7, 4.8], [94.9, 20.5],      // Sumatra, Borneo, Brunei, Burma
  [18.5, 29.5], [6.1, 31.7], [6.5, 4.8], [13.0, -8.0], [32.5, 29.0], // Libya, Algeria, Niger delta, Angola, Suez
  [53.4, 46.2], [76.7, 61.1], [52.3, 54.9], [125.0, 46.6],       // Tengiz, W. Siberia, Volga-Urals, Daqing
];

/** Mark `p.oil = true` on deposit provinces. Deterministic per map. */
export function assignDeposits(map) {
  for (const p of map.provinces) p.oil = false;
  if (map.kind === 'world') {
    for (const [lon, lat] of OIL_FIELDS) {
      const { x, y } = project(lon, lat);
      let id = map.pickAt(x, y);
      if (id < 0) {
        // Offshore or just outside a coast: nearest province centre.
        let bd = Infinity;
        for (const p of map.provinces) {
          const d = Math.hypot(p.center.x - x, p.center.y - y);
          if (d < bd) { bd = d; id = p.id; }
        }
        if (bd > 40) continue;
      }
      map.provinces[id].oil = true;
    }
  } else {
    const seed = hashSeed(String(map.seed));
    for (const p of map.provinces) {
      if (p.terrain !== 'urban' && ((hashSeed(`${seed}:${p.id}`) % 100) < 6)) p.oil = true;
    }
  }
}
