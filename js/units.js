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

const u = (key, role, name, attack, defense, hp, speed, money, manpower, build) =>
  ({ key, role, name, attack, defense, hp, speed, cost: { money, manpower }, build });

/**
 * Era rosters. `transport` is the speed (km/h) of land armies embarked at sea.
 * Numbers are tuned so a 1-on-1 between equals lasts roughly half a day and
 * speeds grow with the era (a WWII infantry hop between provinces takes about
 * a day; a modern one about half that).
 */
export const ROSTERS = {
  rome: {
    transport: 5,
    currency: 'denarii',
    units: [
      u('legion', 'inf', 'Legion', 10, 14, 100, 4, 80, 800, 48),
      u('cavalry', 'mob', 'Cavalry', 14, 8, 80, 8, 120, 600, 60),
      u('archers', 'rng', 'Archers', 14, 6, 70, 4, 90, 500, 36),
      u('trireme', 'nav', 'Trireme', 12, 10, 120, 8, 150, 400, 72),
    ],
  },
  medieval: {
    transport: 6,
    currency: 'marks',
    units: [
      u('menatarms', 'inf', 'Men-at-arms', 11, 14, 100, 4, 90, 800, 48),
      u('knights', 'mob', 'Knights', 16, 10, 90, 7, 160, 400, 72),
      u('longbow', 'rng', 'Longbowmen', 15, 6, 70, 4, 100, 500, 48),
      u('cog', 'nav', 'Cog', 10, 12, 130, 9, 160, 300, 72),
    ],
  },
  ww1: {
    transport: 15,
    currency: 'funds',
    units: [
      u('infantry', 'inf', 'Infantry', 12, 16, 100, 4.5, 100, 1000, 36),
      u('cavalry', 'mob', 'Cavalry', 13, 8, 80, 8, 110, 600, 48),
      u('artillery', 'rng', 'Artillery', 18, 6, 80, 3, 150, 600, 60),
      u('dreadnought', 'nav', 'Dreadnought', 30, 30, 300, 20, 600, 1200, 240),
    ],
  },
  ww2: {
    transport: 18,
    currency: 'funds',
    units: [
      u('infantry', 'inf', 'Infantry', 12, 15, 100, 5, 100, 1000, 24),
      u('tank', 'mob', 'Tank', 20, 14, 120, 12, 250, 500, 72),
      u('artillery', 'rng', 'Artillery', 18, 6, 80, 6, 160, 600, 48),
      u('destroyer', 'nav', 'Destroyer', 20, 16, 200, 35, 400, 800, 120),
    ],
  },
  coldwar: {
    transport: 22,
    currency: 'funds',
    units: [
      u('mechinf', 'inf', 'Mech Infantry', 14, 16, 110, 14, 150, 900, 36),
      u('mbt', 'mob', 'Main Battle Tank', 24, 18, 140, 16, 320, 500, 84),
      u('artillery', 'rng', 'Artillery', 20, 7, 90, 12, 200, 500, 48),
      u('frigate', 'nav', 'Frigate', 22, 18, 220, 40, 450, 600, 120),
    ],
  },
  modern: {
    transport: 25,
    currency: 'funds',
    units: [
      u('infantry', 'inf', 'Infantry', 14, 17, 110, 16, 180, 800, 36),
      u('mbt', 'mob', 'MBT', 26, 20, 150, 18, 380, 400, 96),
      u('rocket', 'rng', 'Rocket Artillery', 26, 7, 90, 16, 300, 400, 60),
      u('destroyer', 'nav', 'Destroyer', 30, 22, 260, 45, 700, 600, 168),
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
