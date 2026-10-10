/**
 * units.js — Unit rosters per era and the rock-paper-scissors matchups.
 *
 * Every era has the same four roles, so balance carries across eras:
 *   inf — line infantry: tough, cheap, beats mobile units (pikes, AT guns)
 *   mob — mobile/shock (cavalry, tanks): fast and hard-hitting, beats ranged
 *   rng — ranged/fire support (archers, artillery): beats infantry, fragile
 *   nav — ships: move only through sea zones
 *
 * Stats: attack and defense feed the damage formula in combat.js; hp is per
 * unit; speed is km/h of effective march (stops, roads and supply included);
 * cost is paid up front; build is in game hours.
 */

export const ROLES = ['inf', 'mob', 'rng', 'nav'];

/** Damage multiplier: MATCHUP[attackerRole][targetRole]. */
export const MATCHUP = {
  inf: { inf: 1, mob: 1.5, rng: 0.67, nav: 0.5 },
  mob: { inf: 0.67, mob: 1, rng: 1.5, nav: 0.5 },
  rng: { inf: 1.5, mob: 0.67, rng: 1, nav: 0.5 },
  nav: { inf: 1, mob: 1, rng: 1, nav: 1 },
};

/** cost: { money, food, steel, oil, electronics, manpower } — only the era's resources. */
const u = (key, role, name, attack, defense, hp, speed, cost, build) =>
  ({ key, role, name, attack, defense, hp, speed, cost, build });

/**
 * Era rosters. `transport` is the speed (km/h) of land armies embarked at sea.
 * Numbers are tuned so a 1-on-1 between equals lasts roughly half a day and
 * speeds grow with the era (a WWII infantry hop between provinces takes about
 * a day; a modern one about half that).
 *
 * Costs (step 4): infantry is mostly money, food and men; mobile units eat
 * iron/steel and, from WWI, oil; ranged units need steel; ships need steel,
 * oil and (Cold War on) electronics. Modern high-tech units lean on electronics.
 */
export const ROSTERS = {
  rome: {
    transport: 5,
    units: [
      u('legion', 'inf', 'Legion', 10, 14, 100, 4, { money: 60, food: 40, steel: 20, manpower: 800 }, 48),
      u('archers', 'rng', 'Archers', 14, 6, 70, 4, { money: 60, food: 30, steel: 10, manpower: 500 }, 36),
      u('cavalry', 'mob', 'Cavalry', 14, 8, 80, 8, { money: 90, food: 60, steel: 15, manpower: 600 }, 60),
      u('trireme', 'nav', 'Trireme', 12, 10, 120, 8, { money: 120, food: 30, steel: 30, manpower: 400 }, 72),
    ],
  },
  medieval: {
    transport: 6,
    units: [
      u('menatarms', 'inf', 'Men-at-arms', 11, 14, 100, 4, { money: 70, food: 40, steel: 25, manpower: 800 }, 48),
      u('longbow', 'rng', 'Longbowmen', 15, 6, 70, 4, { money: 70, food: 30, steel: 10, manpower: 500 }, 48),
      u('knights', 'mob', 'Knights', 16, 10, 90, 7, { money: 140, food: 50, steel: 40, manpower: 400 }, 72),
      u('cog', 'nav', 'Cog', 10, 12, 130, 9, { money: 130, food: 30, steel: 25, manpower: 300 }, 72),
    ],
  },
  ww1: {
    transport: 15,
    units: [
      u('infantry', 'inf', 'Infantry', 12, 16, 100, 4.5, { money: 80, food: 40, steel: 10, manpower: 1000 }, 36),
      u('artillery', 'rng', 'Artillery', 18, 6, 80, 3, { money: 120, food: 20, steel: 40, manpower: 600 }, 60),
      u('cavalry', 'mob', 'Cavalry', 13, 8, 80, 8, { money: 90, food: 60, steel: 5, manpower: 600 }, 48),
      u('dreadnought', 'nav', 'Dreadnought', 30, 30, 300, 20, { money: 500, food: 20, steel: 200, oil: 60, manpower: 1200 }, 240),
    ],
  },
  ww2: {
    transport: 18,
    units: [
      u('infantry', 'inf', 'Infantry', 12, 15, 100, 5, { money: 80, food: 40, steel: 10, manpower: 1000 }, 24),
      u('artillery', 'rng', 'Artillery', 18, 6, 80, 6, { money: 120, food: 20, steel: 40, oil: 5, manpower: 600 }, 48),
      u('tank', 'mob', 'Tank', 20, 14, 120, 12, { money: 180, food: 10, steel: 60, oil: 30, manpower: 500 }, 72),
      u('destroyer', 'nav', 'Destroyer', 20, 16, 200, 35, { money: 320, food: 20, steel: 120, oil: 40, manpower: 800 }, 120),
    ],
  },
  coldwar: {
    transport: 22,
    units: [
      u('mechinf', 'inf', 'Mech Infantry', 14, 16, 110, 14, { money: 120, food: 40, steel: 20, oil: 10, electronics: 5, manpower: 900 }, 36),
      u('artillery', 'rng', 'Artillery', 20, 7, 90, 12, { money: 150, food: 20, steel: 40, oil: 10, electronics: 10, manpower: 500 }, 48),
      u('mbt', 'mob', 'Main Battle Tank', 24, 18, 140, 16, { money: 240, food: 10, steel: 70, oil: 30, electronics: 15, manpower: 500 }, 84),
      u('frigate', 'nav', 'Frigate', 22, 18, 220, 40, { money: 350, food: 20, steel: 120, oil: 40, electronics: 40, manpower: 600 }, 120),
    ],
  },
  modern: {
    transport: 25,
    units: [
      u('infantry', 'inf', 'Infantry', 14, 17, 110, 16, { money: 140, food: 40, steel: 15, oil: 10, electronics: 10, manpower: 800 }, 36),
      u('rocket', 'rng', 'Rocket Artillery', 26, 7, 90, 16, { money: 220, food: 10, steel: 40, oil: 10, electronics: 40, manpower: 400 }, 60),
      u('mbt', 'mob', 'MBT', 26, 20, 150, 18, { money: 280, food: 10, steel: 80, oil: 30, electronics: 25, manpower: 400 }, 96),
      u('destroyer', 'nav', 'Destroyer', 30, 22, 260, 45, { money: 500, food: 20, steel: 140, oil: 40, electronics: 70, manpower: 600 }, 168),
    ],
  },
};
ROSTERS.fictional = ROSTERS.modern;

for (const r of Object.values(ROSTERS)) {
  r.byKey = Object.fromEntries(r.units.map((t) => [t.key, t]));
  r.byRole = Object.fromEntries(r.units.map((t) => [t.role, t]));
}

/** The roster for an era id (Fictional World uses Modern). */
export const rosterFor = (eraId) => ROSTERS[eraId] ?? ROSTERS.modern;

/** A fresh unit of a type at full strength. */
export const makeUnit = (type) => ({ type: type.key, hp: type.hp });
