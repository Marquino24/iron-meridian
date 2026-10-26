/**
 * colonies.js — Major colonies that are part of their sovereign on the map
 * (step 7B). Their provinces (inside the box, held by the sovereign when the
 * era starts) fly the colony's own flag or ensign instead of the ruler's:
 * the province panel shows it, and so do the sovereign's garrisons there and
 * armies raised there. If the land changes hands, the new owner's flag shows.
 *
 * Boxes are [west, south, east, north] in degrees. The flags themselves are
 * tiles in the era's flag sheet (FLAG_INDEX[era].colonies, tools/build-flags.mjs).
 */

import { FLAG_INDEX } from './flag-index.js';
import { unproject } from './projection.js';

export const COLONIES = {
  ww1: [
    // British India still included Burma in 1914.
    { name: 'British India', sovereign: 'United Kingdom of Great Britain and Ireland', boxes: [[60, 5, 101, 37.5]] },
    { name: 'Belgian Congo', sovereign: 'Belgium', boxes: [[11, -14, 32, 6]] },
  ],
  ww2: [
    // Burma was split off in 1937: British India ends at Bengal.
    { name: 'British India', sovereign: 'United Kingdom', boxes: [[60, 5, 92.7, 37.5]] },
    { name: 'Belgian Congo', sovereign: 'Belgium', boxes: [[11, -14, 32, 6]] },
  ],
};

/**
 * Tag a world map's provinces with their colony: map.colonies[i] =
 * { id, name, sovereign (nation id), flag }, and p.colony = i (or absent).
 */
export function assignColonies(map, eraId) {
  map.colonies = [];
  const tiles = FLAG_INDEX[eraId]?.colonies ?? {};
  for (const def of COLONIES[eraId] ?? []) {
    const sov = map.nations.find((n) => n.name === def.sovereign);
    if (!sov || tiles[def.name] == null) continue;
    const id = map.colonies.length;
    const colony = { id, name: def.name, sovereign: sov.id, flag: { era: eraId, real: tiles[def.name] } };
    let count = 0;
    for (const p of map.provinces) {
      if (p.owner !== sov.id) continue;
      const g = unproject(p.center.x, p.center.y);
      if (def.boxes.some(([w, s, e, n]) => g.lon >= w && g.lon <= e && g.lat >= s && g.lat <= n)) { p.colony = id; count++; }
    }
    if (count) map.colonies.push(colony);
  }
}

/** The colony a province belongs to while its sovereign holds it, or null. */
export function colonyOf(map, p) {
  const c = p?.colony != null ? map?.colonies?.[p.colony] : null;
  return c && p.owner === c.sovereign ? c : null;
}

/** The flag a province flies: its colony's while the sovereign holds it, else its owner's. */
export function provinceFlag(map, p) {
  return colonyOf(map, p)?.flag ?? map?.nations[p?.owner]?.flag ?? null;
}
