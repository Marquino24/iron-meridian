/**
 * tech.js — Era tech trees.
 *
 * Every era shares one 28-tech skeleton (same effects and requirements, so
 * balance carries across eras) with its own names. Three branches:
 * Military (10), Economy (9), Infrastructure (9), each in tiers 1–3.
 *
 * Effect kinds:
 *   { unit: role, level }         units of that role reach level 2 or 3
 *                                 (+15% / +30% attack, defense and HP)
 *   { building, maxLevel: 3 }     that building can be raised to level III
 *   { prod: key, pct }            +pct% daily production of a resource
 *   { move: pct }                 armies move pct% faster
 *   { defense: pct }              your armies defend pct% better
 *   { attack: role, pct }         that role attacks pct% harder
 *   { buildTime: pct }            constructions pct% faster
 *   { buildCost: pct }            constructions pct% cheaper
 *   { trainTime: pct }            recruitment pct% faster
 *   { slots: 1 }                  one more research slot
 * An effect may be { ancient, industrial, modern } to differ by era group.
 */

/** Skeleton: id, branch, tier, requirements, effects. Names come per era. */
export const SKELETON = [
  // Military
  { id: 'm1', branch: 'mil', tier: 1, req: [], fx: [{ unit: 'inf', level: 2 }] },
  { id: 'm2', branch: 'mil', tier: 1, req: [], fx: [{ building: 'barracks', maxLevel: 3 }] },
  { id: 'm3', branch: 'mil', tier: 1, req: [], fx: [{ unit: 'rng', level: 2 }] },
  { id: 'm4', branch: 'mil', tier: 2, req: ['m2'], fx: [{ unit: 'mob', level: 2 }] },
  { id: 'm5', branch: 'mil', tier: 2, req: ['m1'], fx: [{ unit: 'inf', level: 3 }] },
  { id: 'm6', branch: 'mil', tier: 2, req: ['m1'], fx: [{ building: 'fort', maxLevel: 3 }, { defense: 10 }] },
  { id: 'm7', branch: 'mil', tier: 2, req: ['i3'], fx: [{ unit: 'nav', level: 2 }] },
  { id: 'm8', branch: 'mil', tier: 3, req: ['m3', 'm5'], fx: [{ unit: 'rng', level: 3 }] },
  { id: 'm9', branch: 'mil', tier: 3, req: ['m4'], fx: [{ unit: 'mob', level: 3 }, { attack: 'mob', pct: 10 }] },
  { id: 'm10', branch: 'mil', tier: 3, req: ['m7'], fx: [{ unit: 'nav', level: 3 }] },
  // Economy
  { id: 'e1', branch: 'eco', tier: 1, req: [], fx: [{ building: 'farm', maxLevel: 3 }, { prod: 'food', pct: 10 }] },
  { id: 'e2', branch: 'eco', tier: 1, req: [], fx: [{ prod: 'money', pct: 10 }] },
  { id: 'e3', branch: 'eco', tier: 1, req: [], fx: [{ building: 'mine', maxLevel: 3 }, { prod: 'steel', pct: 10 }] },
  { id: 'e4', branch: 'eco', tier: 2, req: ['e2'], fx: [{ slots: 1 }] },
  { id: 'e5', branch: 'eco', tier: 2, req: ['e1'], fx: [{ prod: 'manpower', pct: 15 }] },
  {
    id: 'e6', branch: 'eco', tier: 2, req: ['e3'],
    fx: [{ ancient: { prod: 'money', pct: 15 }, industrial: { building: 'oilwell', maxLevel: 3 } }, { ancient: null, industrial: { prod: 'oil', pct: 15 } }],
  },
  { id: 'e7', branch: 'eco', tier: 3, req: ['e4'], fx: [{ prod: 'money', pct: 15 }] },
  { id: 'e8', branch: 'eco', tier: 3, req: ['e5'], fx: [{ prod: 'food', pct: 15 }, { prod: 'manpower', pct: 15 }] },
  { id: 'e9', branch: 'eco', tier: 3, req: ['e3', 'e6'], fx: [{ ancient: { prod: 'steel', pct: 15 }, industrial: { prod: 'steel', pct: 15 }, modern: { prod: 'electronics', pct: 25 } }] },
  // Infrastructure
  { id: 'i1', branch: 'inf', tier: 1, req: [], fx: [{ move: 10 }] },
  { id: 'i2', branch: 'inf', tier: 1, req: [], fx: [{ building: 'roads', maxLevel: 3 }] },
  { id: 'i3', branch: 'inf', tier: 1, req: [], fx: [{ building: 'port', maxLevel: 3 }] },
  { id: 'i4', branch: 'inf', tier: 2, req: ['i2'], fx: [{ buildTime: 20 }] },
  { id: 'i5', branch: 'inf', tier: 2, req: ['i1'], fx: [{ trainTime: 15 }] },
  { id: 'i6', branch: 'inf', tier: 2, req: ['i1'], fx: [{ move: 10 }] },
  { id: 'i7', branch: 'inf', tier: 2, req: ['i2'], fx: [{ defense: 10 }] },
  { id: 'i8', branch: 'inf', tier: 3, req: ['i4'], fx: [{ buildCost: 20 }] },
  { id: 'i9', branch: 'inf', tier: 3, req: ['i4', 'i6'], fx: [{ move: 15 }, { prod: 'all', pct: 10 }] },
];

/** Names per era, in skeleton order (m1…m10, e1…e9, i1…i9). */
const NAMES = {
  rome: [
    'Iron Working', 'Horse Breeding', 'Composite Bows', 'Cataphracts', 'Professional Legions',
    'Castra Fortification', 'Corvus Boarding Bridge', 'Scorpio Bolt-Throwers', 'Alae Cavalry', 'Quinqueremes',
    'Crop Rotation', 'Coinage Reform', 'Deep Mining', 'Census and Scribes', 'Latin Rights',
    'Mediterranean Trade', 'Imperial Treasury', 'Coloniae Settlements', 'Metallurgy',
    'Marching Camps', 'Roman Concrete', 'Harbor Engineering', 'Aqueducts', 'Fabricae Workshops',
    'Cursus Publicus', 'Limes Frontier', 'Standardised Bricks', 'Imperial Road Network',
  ],
  medieval: [
    'Chainmail', 'Stirrups', 'Longbow Drill', 'Destriers', 'Plate Armour',
    'Concentric Castles', 'Stern Rudder', 'Trebuchets', 'Military Orders', 'Carracks',
    'Three-Field System', 'Banking Houses', 'Blast Furnace', 'Universities', 'Town Charters',
    'Hanseatic Trade', 'Letters of Credit', 'Heavy Plough', 'Water-Powered Forges',
    'Pack Trains', 'Stone Bridges', "Shipwrights' Guilds", 'Master Masons', 'Royal Armouries',
    'King\'s Highways', 'Watchtowers', 'Brick Kilns', 'Trade Fair Network',
  ],
  ww1: [
    'Bolt-Action Rifles', 'Cavalry Remounts', 'Indirect Fire', 'Armoured Cars', 'Stormtrooper Tactics',
    'Trench Systems', 'Fire Control', 'Creeping Barrage', 'Mechanised Cavalry', 'Super-Dreadnoughts',
    'Nitrogen Fertiliser', 'War Bonds', 'Bessemer Steel', 'Central Planning Office', 'Total Mobilisation',
    'Oil Refining', 'War Economy', 'Mechanised Agriculture', 'Open-Hearth Steel',
    'Motor Lorries', 'Standard-Gauge Railways', 'Dry Docks', 'Prefabrication', 'Shell Factories',
    'Light Railways', 'Barbed Wire', 'Assembly Lines', 'Electrification',
  ],
  ww2: [
    'Semi-Automatic Rifles', 'Armoured Divisions', 'Radio-Directed Fire', 'Sloped Armour', 'Combined Arms',
    'Fortified Lines', 'Radar', 'Rocket Artillery', 'Blitzkrieg Doctrine', 'Sonar and Depth Charges',
    'Hybrid Crops', 'War Finance', 'Mass Steel Production', 'Operational Research', 'Women in Industry',
    'Synthetic Fuel', 'Total War Economy', 'Rationing', 'Alloy Steels',
    'Motorised Supply', 'Motorways', 'Liberty Shipyards', 'Prefabricated Construction', 'Mass Production',
    'Fuel Logistics', 'Anti-Aircraft Defence', 'Standardised Parts', 'Strategic Logistics',
  ],
  coldwar: [
    'Assault Rifles', 'Mechanised Divisions', 'Self-Propelled Guns', 'Composite Armour', 'Airmobile Infantry',
    'Hardened Bunkers', 'Guided Missiles', 'Counter-Battery Radar', 'AirLand Battle', 'Gas-Turbine Ships',
    'Green Revolution', 'Bretton Woods', 'Basic Oxygen Steel', 'Mainframe Computers', 'Baby Boom',
    'Offshore Drilling', 'Military-Industrial Complex', 'Agro-Industry', 'Transistors',
    'Helicopter Transport', 'Interstate Highways', 'Container Ports', 'Precast Concrete', 'Automated Assembly',
    'Strategic Airlift', 'Early-Warning Radar', 'Modular Construction', 'Satellite Communications',
  ],
  modern: [
    'Body Armour', 'Network-Centric Brigades', 'GPS-Guided Rounds', 'Active Protection Systems', 'Special Forces',
    'Missile Defence', 'Aegis Combat System', 'Precision Rocket Fire', 'Multi-Domain Operations', 'Stealth Hulls',
    'Precision Agriculture', 'Global Finance', 'Recycled Steel', 'Supercomputing', 'Volunteer Force',
    'Fracking', 'Sovereign Wealth Fund', 'Vertical Farming', 'Semiconductor Fabs',
    'Logistics Software', 'Smart Highways', 'Automated Ports', '3D-Printed Construction', 'Robotic Assembly',
    'Rapid Deployment', 'Cyber Defence', 'Modular Building', '5G Networks',
  ],
};
NAMES.fictional = NAMES.modern;

const GROUP = { rome: 'ancient', medieval: 'ancient', ww1: 'industrial', ww2: 'industrial', coldwar: 'modern', modern: 'modern', fictional: 'modern' };

/** Base research cost and time per tier (filtered to the era's resources). */
const TIER_COST = {
  1: { money: 300, food: 100, steel: 60 },
  2: { money: 700, food: 150, steel: 150, oil: 40, electronics: 40 },
  3: { money: 1500, food: 300, steel: 300, oil: 100, electronics: 120 },
};
const TIER_HOURS = { 1: 72, 2: 120, 3: 192 };

export const BRANCHES = [
  { id: 'mil', label: 'Military' },
  { id: 'eco', label: 'Economy' },
  { id: 'inf', label: 'Infrastructure' },
];

/**
 * The tech tree for an era: [{ id, name, branch, tier, req, effects, cost, hours }].
 * @param {string} eraId
 * @param {string[]} resourceKeys the era's resources
 */
export function techTree(eraId, resourceKeys) {
  const names = NAMES[eraId] ?? NAMES.modern;
  const group = GROUP[eraId] ?? 'modern';
  return SKELETON.map((s, i) => {
    const effects = s.fx.map((e) => {
      if (!('ancient' in e || 'industrial' in e || 'modern' in e)) return e;
      return group in e ? e[group] : group === 'modern' ? e.industrial : null;
    }).filter(Boolean)
      .filter((e) => !e.prod || e.prod === 'all' || resourceKeys.includes(e.prod));
    const cost = {};
    for (const [k, v] of Object.entries(TIER_COST[s.tier])) if (resourceKeys.includes(k)) cost[k] = v;
    return { id: s.id, name: names[i], branch: s.branch, tier: s.tier, req: s.req, effects, cost, hours: TIER_HOURS[s.tier] };
  });
}
