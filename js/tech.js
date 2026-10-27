/**
 * tech.js — Era tech trees (step 10: every era has its own).
 *
 * Three branches in every era (Military, Economy, Infrastructure), but each
 * era has its own techs, its own shape (which branch runs to a tier IV
 * capstone, which is wide, which is shallow) and 3–5 signature techs whose
 * effects exist only in that era: Roman roads and the testudo, medieval
 * castles and siege engines, trenches and gas, radar and blitzkrieg,
 * deterrence and air assault, drones and cyber warfare.
 *
 * Common effect kinds:
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
 *   { synth: from, to, pct }      pct% of one resource's output also yields
 *                                 another (synthetic fuel from steel)
 *   { integration: pct }          conquered land integrates pct% faster
 * Signature effects (one era each, see SIGNATURES for what they do):
 *   testudo, roadSpeed, heal, noRevolt · fortStrength, levies, siege, zeal ·
 *   entrench, gas, recon, railMob · radar, carriers, blitz ·
 *   airmobile, interdict, deterrence · drones, precision, cyber, researchSpeed
 *
 * Cost and time grow by tier; the whole tree adds up to the same research
 * time in every era (TOTAL_HOURS), so a medium nation finishes it in about
 * 2½ real hours at 1× with its research slots busy.
 */

/** What each signature effect does (shown in the research window and TECH.md). */
export const SIGNATURES = {
  testudo: (v) => `Testudo: infantry take ${v}% less damage from ranged units`,
  roadSpeed: (v) => `Armies move ${v}% faster through provinces with Roads`,
  heal: (v) => `Armies recover strength ${v}% faster on your land`,
  noRevolt: () => 'Conquered provinces never revolt',
  fortStrength: (v) => `Your fortifications give ${v}% more defense`,
  levies: (v) => `Homeland levies rise ${v}% sooner and bring one more unit`,
  siege: (v) => `Cities and capitals fall to your sieges ${v}% faster`,
  zeal: (v) => `War exhaustion ${v}% lower`,
  entrench: (v) => `Entrenchment: armies defending your own land +${v}% defense`,
  gas: (v) => `Enemy terrain and fortification bonus cut by ${v}% when you attack`,
  recon: (v) => `+${v}% attack in the first day of every battle`,
  railMob: (v) => `Armies move ${v}% faster through your own provinces`,
  radar: (v) => `Enemy landings on your coast attack ${v}% weaker`,
  carriers: (v) => `Carrier escort: your armies at sea lose ${v}% less defense`,
  blitz: (v) => `Blitzkrieg: ${v}% faster through and occupying enemy land`,
  airmobile: (v) => `Air assault: rough terrain slows your armies ${v}% less`,
  interdict: (v) => `Air interdiction: enemy armies move ${v}% slower in your land`,
  deterrence: (v) => `Deterrent: other nations need ${v}% more strength to attack you`,
  drones: (v) => `Drones: enemies occupying your homeland take ${v}% longer`,
  precision: (v) => `Precision strikes: conquered land starts ${v}% more integrated`,
  cyber: (v) => `Cyber warfare: nations at war with you earn ${v}% less money`,
  researchSpeed: (v) => `Research ${v}% faster`,
};

// --- Effect shorthands ---------------------------------------------------------
const U = (unit, level) => ({ unit, level });
const B = (building) => ({ building, maxLevel: 3 });
const P = (prod, pct) => ({ prod, pct });
const MV = (move) => ({ move });
const DF = (defense) => ({ defense });
const AT = (attack, pct) => ({ attack, pct });
const BT = (buildTime) => ({ buildTime });
const BC = (buildCost) => ({ buildCost });
const TT = (trainTime) => ({ trainTime });
const SL = { slots: 1 };
const IN = (integration) => ({ integration });
const SY = { synth: 'steel', to: 'oil', pct: 15 };
const S = (key, v = true) => ({ [key]: v });

/**
 * A tech: [id, branch, tier, requirements, effects, name, ai]. `ai` tags what a
 * computer nation sees in it (attack, defend, grow, hold) beyond its branch.
 */
const T = (id, branch, tier, req, fx, name, ai) => ({ id, branch, tier, req, fx, name, ai });

/**
 * The trees. Shapes differ: Rome's Economy and Infrastructure end in tier IV
 * capstones, the Middle Ages run Military to tier IV with a shallow economy,
 * the Great War has a wide Military branch and a lean Infrastructure one,
 * WWII peaks in Blitzkrieg, the Cold War in the Deterrent (Economy) and the
 * modern era in Cyber Warfare (Infrastructure).
 */
const TREES = {
  rome: [
    T('ro_iron', 'mil', 1, [], [U('inf', 2)], 'Iron Working'),
    T('ro_horse', 'mil', 1, [], [B('barracks')], 'Horse Breeding'),
    T('ro_bows', 'mil', 1, [], [U('rng', 2)], 'Composite Bows'),
    T('ro_testudo', 'mil', 2, ['ro_iron'], [S('testudo', 30), DF(5)], 'Testudo Formation', 'defend'),
    T('ro_legions', 'mil', 2, ['ro_iron'], [U('inf', 3)], 'Professional Legions'),
    T('ro_cataphracts', 'mil', 2, ['ro_horse'], [U('mob', 2)], 'Cataphracts'),
    T('ro_corvus', 'mil', 2, ['ro_harbor'], [U('nav', 2)], 'Corvus Boarding Bridge'),
    T('ro_scorpio', 'mil', 3, ['ro_bows', 'ro_legions'], [U('rng', 3)], 'Scorpio Bolt-Throwers'),
    T('ro_alae', 'mil', 3, ['ro_cataphracts'], [U('mob', 3), AT('mob', 10)], 'Alae Cavalry'),
    T('ro_quinqueremes', 'mil', 3, ['ro_corvus'], [U('nav', 3)], 'Quinqueremes'),

    T('ro_rotation', 'eco', 1, [], [B('farm'), P('food', 10)], 'Crop Rotation'),
    T('ro_census', 'eco', 1, [], [SL], 'Census and Scribes'),
    T('ro_mining', 'eco', 1, [], [B('mine'), P('steel', 10)], 'Deep Mining'),
    T('ro_coinage', 'eco', 2, ['ro_census'], [P('money', 10)], 'Coinage Reform'),
    T('ro_latin', 'eco', 2, ['ro_rotation'], [P('manpower', 15), IN(25)], 'Latin Rights', 'hold'),
    T('ro_trade', 'eco', 2, ['ro_mining'], [P('money', 15)], 'Mediterranean Trade'),
    T('ro_bureaucracy', 'eco', 3, ['ro_coinage'], [SL, P('money', 15)], 'Imperial Bureaucracy'),
    T('ro_coloniae', 'eco', 3, ['ro_latin'], [P('food', 15), P('manpower', 15)], 'Coloniae Settlements'),
    T('ro_metallurgy', 'eco', 3, ['ro_trade'], [P('steel', 15)], 'Metallurgy'),
    T('ro_pax', 'eco', 4, ['ro_bureaucracy', 'ro_coloniae'], [IN(50), S('noRevolt')], 'Pax Romana', 'hold'),

    T('ro_camps', 'inf', 1, [], [MV(10)], 'Marching Camps'),
    T('ro_concrete', 'inf', 1, [], [B('roads')], 'Roman Concrete'),
    T('ro_harbor', 'inf', 1, [], [B('port')], 'Harbor Engineering'),
    T('ro_aqueducts', 'inf', 2, ['ro_concrete'], [BT(20)], 'Aqueducts'),
    T('ro_fabricae', 'inf', 2, ['ro_camps'], [TT(15)], 'Fabricae Workshops'),
    T('ro_viae', 'inf', 2, ['ro_concrete'], [S('roadSpeed', 40)], 'Viae Militares', 'attack'),
    T('ro_limes', 'inf', 2, ['ro_concrete'], [B('fort'), DF(10)], 'Limes Frontier', 'defend'),
    T('ro_valetudinaria', 'inf', 3, ['ro_fabricae'], [S('heal', 100)], 'Valetudinaria', 'defend'),
    T('ro_bricks', 'inf', 3, ['ro_aqueducts'], [BC(20)], 'Standardised Bricks'),
    T('ro_cursus', 'inf', 3, ['ro_viae'], [MV(10)], 'Cursus Publicus'),
    T('ro_network', 'inf', 4, ['ro_bricks', 'ro_cursus'], [MV(15), P('all', 10)], 'Imperial Road Network'),
  ],

  medieval: [
    T('md_mail', 'mil', 1, [], [U('inf', 2)], 'Chainmail'),
    T('md_stirrups', 'mil', 1, [], [B('barracks')], 'Stirrups'),
    T('md_crossbows', 'mil', 1, [], [U('rng', 2)], 'Crossbows'),
    T('md_destriers', 'mil', 2, ['md_stirrups'], [U('mob', 2)], 'Destriers'),
    T('md_plate', 'mil', 2, ['md_mail'], [U('inf', 3)], 'Plate Armour'),
    T('md_levy', 'mil', 2, ['md_mail'], [S('levies', 50), TT(10)], 'Feudal Levy', 'defend'),
    T('md_rudder', 'mil', 2, ['md_shipwrights'], [U('nav', 2)], 'Stern Rudder'),
    T('md_siege', 'mil', 3, ['md_crossbows', 'md_plate'], [U('rng', 3), S('siege', 40)], 'Siege Engines', 'attack'),
    T('md_orders', 'mil', 3, ['md_destriers'], [U('mob', 3), AT('mob', 10)], 'Military Orders'),
    T('md_carracks', 'mil', 3, ['md_rudder'], [U('nav', 3)], 'Carracks'),
    T('md_zeal', 'mil', 4, ['md_siege', 'md_orders'], [S('zeal', 40), AT('inf', 10)], 'Crusading Zeal', 'attack'),

    T('md_fields', 'eco', 1, [], [B('farm'), P('food', 10)], 'Three-Field System'),
    T('md_scriptoria', 'eco', 1, [], [SL], 'Monastic Scriptoria'),
    T('md_furnace', 'eco', 1, [], [B('mine'), P('steel', 10)], 'Blast Furnace'),
    T('md_banking', 'eco', 2, ['md_scriptoria'], [P('money', 10)], 'Banking Houses'),
    T('md_charters', 'eco', 2, ['md_fields'], [P('manpower', 15)], 'Town Charters'),
    T('md_hansa', 'eco', 2, ['md_furnace'], [P('money', 15)], 'Hanseatic Trade'),
    T('md_universities', 'eco', 3, ['md_banking'], [SL, P('money', 15)], 'Universities'),
    T('md_plough', 'eco', 3, ['md_charters'], [P('food', 15), P('manpower', 15)], 'Heavy Plough'),
    T('md_forges', 'eco', 3, ['md_hansa'], [P('steel', 15)], 'Water-Powered Forges'),

    T('md_packs', 'inf', 1, [], [MV(10)], 'Pack Trains'),
    T('md_bridges', 'inf', 1, [], [B('roads')], 'Stone Bridges'),
    T('md_shipwrights', 'inf', 1, [], [B('port')], "Shipwrights' Guilds"),
    T('md_masons', 'inf', 2, ['md_bridges'], [BT(20)], 'Master Masons'),
    T('md_castles', 'inf', 2, ['md_bridges'], [B('fort'), DF(10)], 'Castles', 'defend'),
    T('md_highways', 'inf', 2, ['md_packs'], [MV(10)], "King's Highways"),
    T('md_fealty', 'inf', 2, ['md_packs'], [IN(30)], 'Oaths of Fealty', 'hold'),
    T('md_concentric', 'inf', 3, ['md_castles'], [S('fortStrength', 50)], 'Concentric Castles', 'defend'),
    T('md_kilns', 'inf', 3, ['md_masons'], [BC(20)], 'Brick Kilns'),
    T('md_fairs', 'inf', 3, ['md_highways'], [MV(15), P('all', 10)], 'Trade Fair Network'),
  ],

  ww1: [
    T('w1_mg', 'mil', 1, [], [U('inf', 2)], 'Machine Guns'),
    T('w1_remounts', 'mil', 1, [], [B('barracks')], 'Cavalry Remounts'),
    T('w1_indirect', 'mil', 1, [], [U('rng', 2)], 'Indirect Fire'),
    T('w1_trenches', 'mil', 2, ['w1_mg'], [S('entrench', 25), B('fort')], 'Trench Systems', 'defend'),
    T('w1_storm', 'mil', 2, ['w1_mg'], [U('inf', 3)], 'Stormtrooper Tactics'),
    T('w1_armoured', 'mil', 2, ['w1_remounts'], [U('mob', 2)], 'Armoured Cars'),
    T('w1_recon', 'mil', 2, ['w1_indirect'], [S('recon', 25)], 'Aerial Reconnaissance', 'attack'),
    T('w1_firecontrol', 'mil', 2, ['w1_docks'], [U('nav', 2)], 'Fire Control'),
    T('w1_gas', 'mil', 3, ['w1_indirect', 'w1_trenches'], [S('gas', 40)], 'Chemical Warfare', 'attack'),
    T('w1_barrage', 'mil', 3, ['w1_indirect', 'w1_storm'], [U('rng', 3)], 'Creeping Barrage'),
    T('w1_landships', 'mil', 3, ['w1_armoured'], [U('mob', 3), AT('mob', 10)], 'Landships'),
    T('w1_dreadnoughts', 'mil', 3, ['w1_firecontrol'], [U('nav', 3)], 'Super-Dreadnoughts'),

    T('w1_nitrogen', 'eco', 1, [], [B('farm'), P('food', 10)], 'Nitrogen Fertiliser'),
    T('w1_staff', 'eco', 1, [], [SL], 'General Staff Office'),
    T('w1_bessemer', 'eco', 1, [], [B('mine'), P('steel', 10)], 'Bessemer Steel'),
    T('w1_bonds', 'eco', 2, ['w1_staff'], [P('money', 10)], 'War Bonds'),
    T('w1_mobilisation', 'eco', 2, ['w1_nitrogen'], [P('manpower', 15)], 'Total Mobilisation'),
    T('w1_refining', 'eco', 2, ['w1_bessemer'], [B('oilwell'), SY], 'Oil Refining'),
    T('w1_labs', 'eco', 3, ['w1_bonds'], [SL, P('money', 15)], 'Research Laboratories'),
    T('w1_occupation', 'eco', 3, ['w1_mobilisation'], [IN(40), P('food', 15)], 'Occupation Authorities', 'hold'),
    T('w1_openhearth', 'eco', 3, ['w1_refining'], [P('steel', 15)], 'Open-Hearth Steel'),

    T('w1_lorries', 'inf', 1, [], [MV(10)], 'Motor Lorries'),
    T('w1_railways', 'inf', 1, [], [B('roads')], 'Railways'),
    T('w1_docks', 'inf', 1, [], [B('port')], 'Dry Docks'),
    T('w1_prefab', 'inf', 2, ['w1_railways'], [BT(20)], 'Prefabrication'),
    T('w1_shells', 'inf', 2, ['w1_lorries'], [TT(15)], 'Shell Factories'),
    T('w1_strategic', 'inf', 2, ['w1_railways'], [S('railMob', 30)], 'Strategic Railways', 'defend'),
    T('w1_assembly', 'inf', 3, ['w1_prefab'], [BC(20)], 'Assembly Lines'),
    T('w1_electric', 'inf', 3, ['w1_prefab', 'w1_strategic'], [MV(10), P('all', 10)], 'Electrification'),
  ],

  ww2: [
    T('w2_rifles', 'mil', 1, [], [U('inf', 2)], 'Semi-Automatic Rifles'),
    T('w2_armour', 'mil', 1, [], [B('barracks')], 'Armoured Divisions'),
    T('w2_radio', 'mil', 1, [], [U('rng', 2)], 'Radio-Directed Fire'),
    T('w2_sloped', 'mil', 2, ['w2_armour'], [U('mob', 2)], 'Sloped Armour'),
    T('w2_combined', 'mil', 2, ['w2_rifles'], [U('inf', 3)], 'Combined Arms'),
    T('w2_lines', 'mil', 2, ['w2_rifles'], [B('fort'), DF(10)], 'Fortified Lines', 'defend'),
    T('w2_sonar', 'mil', 2, ['w2_shipyards'], [U('nav', 2)], 'Sonar and Depth Charges'),
    T('w2_rockets', 'mil', 3, ['w2_radio', 'w2_combined'], [U('rng', 3)], 'Rocket Artillery'),
    T('w2_heavy', 'mil', 3, ['w2_sloped'], [U('mob', 3), AT('mob', 10)], 'Heavy Tanks'),
    T('w2_carriers', 'mil', 3, ['w2_sonar'], [U('nav', 3), S('carriers', 50)], 'Fleet Carriers', 'attack'),
    T('w2_blitz', 'mil', 4, ['w2_combined', 'w2_heavy'], [S('blitz', 35)], 'Blitzkrieg Doctrine', 'attack'),

    T('w2_crops', 'eco', 1, [], [B('farm'), P('food', 10)], 'Hybrid Crops'),
    T('w2_opresearch', 'eco', 1, [], [SL], 'Operational Research'),
    T('w2_steel', 'eco', 1, [], [B('mine'), P('steel', 10)], 'Mass Steel Production'),
    T('w2_finance', 'eco', 2, ['w2_opresearch'], [P('money', 10)], 'War Finance'),
    T('w2_women', 'eco', 2, ['w2_crops'], [P('manpower', 15)], 'Women in Industry'),
    T('w2_synfuel', 'eco', 2, ['w2_steel'], [B('oilwell'), SY], 'Synthetic Fuel'),
    T('w2_radar', 'eco', 2, ['w2_opresearch'], [S('radar', 50), DF(5)], 'Radar', 'defend'),
    T('w2_bigscience', 'eco', 3, ['w2_finance'], [SL, P('money', 15)], 'Big Science'),
    T('w2_rationing', 'eco', 3, ['w2_women'], [P('food', 15), P('manpower', 15)], 'Rationing'),
    T('w2_alloys', 'eco', 3, ['w2_synfuel'], [P('steel', 15)], 'Alloy Steels'),

    T('w2_motorised', 'inf', 1, [], [MV(10)], 'Motorised Supply'),
    T('w2_motorways', 'inf', 1, [], [B('roads')], 'Motorways'),
    T('w2_shipyards', 'inf', 1, [], [B('port')], 'Liberty Shipyards'),
    T('w2_prefab', 'inf', 2, ['w2_motorways'], [BT(20)], 'Prefabricated Construction'),
    T('w2_massprod', 'inf', 2, ['w2_motorised'], [TT(15)], 'Mass Production'),
    T('w2_fuel', 'inf', 2, ['w2_motorised'], [MV(10)], 'Fuel Logistics'),
    T('w2_milgov', 'inf', 2, ['w2_motorways'], [IN(30)], 'Military Government', 'hold'),
    T('w2_parts', 'inf', 3, ['w2_prefab'], [BC(20)], 'Standardised Parts'),
    T('w2_logistics', 'inf', 3, ['w2_prefab', 'w2_fuel'], [MV(15), P('all', 10)], 'Strategic Logistics'),
  ],

  coldwar: [
    T('cw_rifles', 'mil', 1, [], [U('inf', 2)], 'Assault Rifles'),
    T('cw_mech', 'mil', 1, [], [B('barracks')], 'Mechanised Divisions'),
    T('cw_spg', 'mil', 1, [], [U('rng', 2)], 'Self-Propelled Guns'),
    T('cw_composite', 'mil', 2, ['cw_mech'], [U('mob', 2)], 'Composite Armour'),
    T('cw_airmobile', 'mil', 2, ['cw_rifles'], [U('inf', 3), S('airmobile', 50)], 'Airmobile Infantry', 'attack'),
    T('cw_bunkers', 'mil', 2, ['cw_rifles'], [B('fort'), DF(10)], 'Hardened Bunkers', 'defend'),
    T('cw_missiles', 'mil', 2, ['cw_ports'], [U('nav', 2)], 'Guided Missiles'),
    T('cw_counter', 'mil', 3, ['cw_spg', 'cw_airmobile'], [U('rng', 3)], 'Counter-Battery Radar'),
    T('cw_airland', 'mil', 3, ['cw_composite'], [U('mob', 3), AT('mob', 10)], 'AirLand Battle'),
    T('cw_subs', 'mil', 3, ['cw_missiles'], [U('nav', 3)], 'Nuclear Submarines'),
    T('cw_interdict', 'mil', 3, ['cw_spg'], [S('interdict', 40)], 'Air Interdiction', 'defend'),

    T('cw_green', 'eco', 1, [], [B('farm'), P('food', 10)], 'Green Revolution'),
    T('cw_mainframes', 'eco', 1, [], [SL], 'Mainframe Computers'),
    T('cw_oxygen', 'eco', 1, [], [B('mine'), P('steel', 10)], 'Basic Oxygen Steel'),
    T('cw_bretton', 'eco', 2, ['cw_mainframes'], [P('money', 10)], 'Bretton Woods'),
    T('cw_boom', 'eco', 2, ['cw_green'], [P('manpower', 15)], 'Baby Boom'),
    T('cw_offshore', 'eco', 2, ['cw_oxygen'], [B('oilwell'), SY], 'Offshore Drilling'),
    T('cw_mic', 'eco', 3, ['cw_bretton'], [SL, P('money', 15)], 'Military-Industrial Complex'),
    T('cw_agro', 'eco', 3, ['cw_boom'], [P('food', 15), P('manpower', 15)], 'Agro-Industry'),
    T('cw_transistors', 'eco', 3, ['cw_offshore'], [P('electronics', 25)], 'Transistors'),
    T('cw_deterrent', 'eco', 4, ['cw_mic', 'cw_transistors'], [S('deterrence', 60)], 'Nuclear Deterrent', 'defend'),

    T('cw_helis', 'inf', 1, [], [MV(10)], 'Helicopter Transport'),
    T('cw_interstate', 'inf', 1, [], [B('roads')], 'Interstate Highways'),
    T('cw_ports', 'inf', 1, [], [B('port')], 'Container Ports'),
    T('cw_precast', 'inf', 2, ['cw_interstate'], [BT(20)], 'Precast Concrete'),
    T('cw_automated', 'inf', 2, ['cw_helis'], [TT(15)], 'Automated Assembly'),
    T('cw_jets', 'inf', 2, ['cw_helis'], [MV(10)], 'Jet Engines'),
    T('cw_hearts', 'inf', 2, ['cw_interstate'], [IN(30)], 'Hearts and Minds', 'hold'),
    T('cw_modular', 'inf', 3, ['cw_precast'], [BC(20)], 'Modular Construction'),
    T('cw_satellites', 'inf', 3, ['cw_precast', 'cw_jets'], [MV(15), P('all', 10)], 'Satellites'),
  ],

  modern: [
    T('mo_armour', 'mil', 1, [], [U('inf', 2)], 'Body Armour'),
    T('mo_network', 'mil', 1, [], [B('barracks')], 'Network-Centric Brigades'),
    T('mo_loitering', 'mil', 1, [], [U('rng', 2)], 'Loitering Munitions'),
    T('mo_aps', 'mil', 2, ['mo_network'], [U('mob', 2)], 'Active Protection Systems'),
    T('mo_sof', 'mil', 2, ['mo_armour'], [U('inf', 3)], 'Special Forces'),
    T('mo_missiledef', 'mil', 2, ['mo_armour'], [B('fort'), DF(10)], 'Missile Defence', 'defend'),
    T('mo_aegis', 'mil', 2, ['mo_ports'], [U('nav', 2)], 'Aegis Combat System'),
    T('mo_precision', 'mil', 3, ['mo_loitering', 'mo_sof'], [U('rng', 3), S('precision', 15)], 'Precision Strikes', 'hold'),
    T('mo_mdo', 'mil', 3, ['mo_aps'], [U('mob', 3), AT('mob', 10)], 'Multi-Domain Operations'),
    T('mo_stealth', 'mil', 3, ['mo_aegis'], [U('nav', 3)], 'Stealth Hulls'),
    T('mo_drones', 'mil', 3, ['mo_loitering'], [S('drones', 50)], 'Drone Swarms', 'defend'),

    T('mo_agri', 'eco', 1, [], [B('farm'), P('food', 10)], 'Precision Agriculture'),
    T('mo_super', 'eco', 1, [], [SL], 'Supercomputing'),
    T('mo_recycled', 'eco', 1, [], [B('mine'), P('steel', 10)], 'Recycled Steel'),
    T('mo_finance', 'eco', 2, ['mo_super'], [P('money', 10)], 'Global Finance'),
    T('mo_volunteer', 'eco', 2, ['mo_agri'], [P('manpower', 15)], 'Volunteer Force'),
    T('mo_fracking', 'eco', 2, ['mo_recycled'], [B('oilwell'), SY], 'Fracking'),
    T('mo_ai', 'eco', 3, ['mo_finance'], [SL, S('researchSpeed', 20)], 'AI Research', 'grow'),
    T('mo_vertical', 'eco', 3, ['mo_volunteer'], [P('food', 15), P('manpower', 15)], 'Vertical Farming'),
    T('mo_fabs', 'eco', 3, ['mo_fracking'], [P('electronics', 25)], 'Semiconductor Fabs'),

    T('mo_logistics', 'inf', 1, [], [MV(10)], 'Logistics Software'),
    T('mo_highways', 'inf', 1, [], [B('roads')], 'Smart Highways'),
    T('mo_ports', 'inf', 1, [], [B('port')], 'Automated Ports'),
    T('mo_printed', 'inf', 2, ['mo_highways'], [BT(20)], '3D-Printed Construction'),
    T('mo_robotic', 'inf', 2, ['mo_logistics'], [TT(15)], 'Robotic Assembly'),
    T('mo_rapid', 'inf', 2, ['mo_logistics'], [MV(10)], 'Rapid Deployment'),
    T('mo_stabilisation', 'inf', 2, ['mo_highways'], [IN(30)], 'Stabilisation Operations', 'hold'),
    T('mo_modular', 'inf', 3, ['mo_printed'], [BC(20)], 'Modular Building'),
    T('mo_5g', 'inf', 3, ['mo_printed', 'mo_rapid'], [MV(15), P('all', 10)], '5G Networks'),
    T('mo_cyber', 'inf', 4, ['mo_5g'], [S('cyber', 20), P('money', 15)], 'Cyber Warfare', 'attack'),
  ],

  // The Fictional World borrows one signature from each age: Roman roads,
  // siege engines, trenches, blitzkrieg and the deterrent. Every branch reaches tier IV.
  fictional: [
    T('fx_drill', 'mil', 1, [], [U('inf', 2)], 'Line Drill'),
    T('fx_stables', 'mil', 1, [], [B('barracks')], 'War Stables'),
    T('fx_gunnery', 'mil', 1, [], [U('rng', 2)], 'Gunnery Schools'),
    T('fx_cavalry', 'mil', 2, ['fx_stables'], [U('mob', 2)], 'Mounted Columns'),
    T('fx_veterans', 'mil', 2, ['fx_drill'], [U('inf', 3)], 'Veteran Cadres'),
    T('fx_bastions', 'mil', 2, ['fx_drill'], [B('fort'), S('entrench', 20)], 'Bastion Lines', 'defend'),
    T('fx_hulls', 'mil', 2, ['fx_harbors'], [U('nav', 2)], 'Ironclad Hulls'),
    T('fx_siege', 'mil', 3, ['fx_gunnery', 'fx_veterans'], [U('rng', 3), S('siege', 35)], 'Siege Doctrine', 'attack'),
    T('fx_armour', 'mil', 3, ['fx_cavalry'], [U('mob', 3), AT('mob', 10)], 'Armoured Spearheads'),
    T('fx_battlefleet', 'mil', 3, ['fx_hulls'], [U('nav', 3)], 'Battle Fleet'),
    T('fx_blitz', 'mil', 4, ['fx_siege', 'fx_armour'], [S('blitz', 30)], 'Lightning War', 'attack'),

    T('fx_granaries', 'eco', 1, [], [B('farm'), P('food', 10)], 'Granaries'),
    T('fx_academy', 'eco', 1, [], [SL], 'Royal Academy'),
    T('fx_foundries', 'eco', 1, [], [B('mine'), P('steel', 10)], 'Foundries'),
    T('fx_treasury', 'eco', 2, ['fx_academy'], [P('money', 10)], 'Treasury Reform'),
    T('fx_guilds', 'eco', 2, ['fx_granaries'], [P('manpower', 15)], 'Labour Guilds'),
    T('fx_oil', 'eco', 2, ['fx_foundries'], [B('oilwell'), SY], 'Oil Prospecting'),
    T('fx_institutes', 'eco', 3, ['fx_treasury'], [SL, P('money', 15)], 'Grand Institutes'),
    T('fx_harvests', 'eco', 3, ['fx_guilds'], [P('food', 15), P('manpower', 15), IN(30)], 'Settler Harvests', 'hold'),
    T('fx_circuits', 'eco', 3, ['fx_oil'], [P('electronics', 25)], 'Circuit Works'),
    T('fx_deterrent', 'eco', 4, ['fx_institutes', 'fx_circuits'], [S('deterrence', 50)], 'Doomsday Deterrent', 'defend'),

    T('fx_wagons', 'inf', 1, [], [MV(10)], 'Supply Wagons'),
    T('fx_roads', 'inf', 1, [], [B('roads')], 'Paved Roads'),
    T('fx_harbors', 'inf', 1, [], [B('port')], 'Deepwater Harbors'),
    T('fx_cranes', 'inf', 2, ['fx_roads'], [BT(20)], 'Steam Cranes'),
    T('fx_depots', 'inf', 2, ['fx_wagons'], [TT(15)], 'Recruiting Depots'),
    T('fx_arteries', 'inf', 2, ['fx_roads'], [S('roadSpeed', 35)], 'Arterial Roads', 'attack'),
    T('fx_standard', 'inf', 3, ['fx_cranes'], [BC(20)], 'Standard Gauges'),
    T('fx_relays', 'inf', 3, ['fx_arteries', 'fx_depots'], [MV(10), DF(5)], 'Signal Relays'),
    T('fx_grid', 'inf', 4, ['fx_standard', 'fx_relays'], [MV(15), P('all', 10)], 'Continental Grid'),
  ],
};

/** Total research time of every era's tree, in game hours (2.4–2.6 real hours with the slots busy). */
export const TOTAL_HOURS = 17370;
/** Relative time and cost per tier before scaling to TOTAL_HOURS. */
const TIER_WEIGHT = { 1: 150, 2: 540, 3: 1260, 4: 1900 };
/** Cost per tier at weight 1 (filtered to the era's resources, scaled with time). */
const TIER_COST = {
  1: { money: 400, food: 120, steel: 80 },
  2: { money: 1500, food: 400, steel: 300, oil: 40, electronics: 60 },
  3: { money: 4000, food: 1000, steel: 800, oil: 120, electronics: 200 },
  4: { money: 6000, food: 1500, steel: 1200, oil: 180, electronics: 300 },
};
/** Total money of the old 28-tech tree; each era's tree costs about the same. */
const TOTAL_MONEY = 52100;

export const BRANCHES = [
  { id: 'mil', label: 'Military' },
  { id: 'eco', label: 'Economy' },
  { id: 'inf', label: 'Infrastructure' },
];

/** What a computer nation sees in a tech: its own tag, else one from its effects. */
function aiTag(t) {
  if (t.ai) return t.ai;
  if (t.fx.some((e) => e.slots)) return 'grow';
  if (t.fx.some((e) => e.unit || e.attack)) return 'attack';
  if (t.fx.some((e) => e.defense || (e.building === 'fort'))) return 'defend';
  if (t.fx.some((e) => e.integration)) return 'hold';
  return 'grow';
}

/** Is this a signature effect (one of the era's own)? */
export const isSignature = (e) => Object.keys(e).some((k) => k in SIGNATURES);

/**
 * The tech tree for an era: [{ id, name, branch, tier, req, effects, cost, hours, ai, signature }].
 * @param {string} eraId
 * @param {string[]} resourceKeys the era's resources
 */
export function techTree(eraId, resourceKeys) {
  const src = TREES[eraId] ?? TREES.modern;
  const weight = src.reduce((t, s) => t + TIER_WEIGHT[s.tier], 0);
  const hourScale = TOTAL_HOURS / weight;
  const money = src.reduce((t, s) => t + TIER_COST[s.tier].money, 0);
  const costScale = TOTAL_MONEY / money;
  return src.map((s) => {
    const effects = s.fx.filter((e) => (!e.prod || e.prod === 'all' || resourceKeys.includes(e.prod)) && (!e.synth || resourceKeys.includes(e.to)));
    const cost = {};
    for (const [k, v] of Object.entries(TIER_COST[s.tier])) if (resourceKeys.includes(k)) cost[k] = Math.round((v * costScale) / 10) * 10;
    return {
      id: s.id, name: s.name, branch: s.branch, tier: s.tier, req: s.req, effects, cost,
      hours: Math.round(TIER_WEIGHT[s.tier] * hourScale), ai: aiTag(s), signature: effects.some(isSignature),
    };
  });
}

// --- Old saves ---------------------------------------------------------------------

/**
 * The tree before step 10: one 28-tech skeleton for every era (ids m1–m10,
 * e1–e9, i1–i9). Kept so old saves can be moved onto the new trees.
 */
export const LEGACY = [
  { id: 'm1', tier: 1, fx: [U('inf', 2)] }, { id: 'm2', tier: 1, fx: [B('barracks')] }, { id: 'm3', tier: 1, fx: [U('rng', 2)] },
  { id: 'm4', tier: 2, fx: [U('mob', 2)] }, { id: 'm5', tier: 2, fx: [U('inf', 3)] }, { id: 'm6', tier: 2, fx: [B('fort')] },
  { id: 'm7', tier: 2, fx: [U('nav', 2)] }, { id: 'm8', tier: 3, fx: [U('rng', 3)] }, { id: 'm9', tier: 3, fx: [U('mob', 3)] },
  { id: 'm10', tier: 3, fx: [U('nav', 3)] },
  { id: 'e1', tier: 1, fx: [B('farm')] }, { id: 'e2', tier: 1, fx: [SL] }, { id: 'e3', tier: 1, fx: [B('mine')] },
  { id: 'e4', tier: 2, fx: [P('money', 10)] }, { id: 'e5', tier: 2, fx: [P('manpower', 15)] },
  { id: 'e6', tier: 2, fx: [B('oilwell')], ancient: [P('money', 15)] }, { id: 'e7', tier: 3, fx: [SL] },
  { id: 'e8', tier: 3, fx: [P('food', 15)] }, { id: 'e9', tier: 3, fx: [P('steel', 15)], modern: [P('electronics', 25)] },
  { id: 'i1', tier: 1, fx: [MV(10)] }, { id: 'i2', tier: 1, fx: [B('roads')] }, { id: 'i3', tier: 1, fx: [B('port')] },
  { id: 'i4', tier: 2, fx: [BT(20)] }, { id: 'i5', tier: 2, fx: [TT(15)] }, { id: 'i6', tier: 2, fx: [MV(10)] },
  { id: 'i7', tier: 2, fx: [DF(10)] }, { id: 'i8', tier: 3, fx: [BC(20)] }, { id: 'i9', tier: 3, fx: [P('all', 10)] },
];
const GROUP = { rome: 'ancient', medieval: 'ancient', coldwar: 'modern', modern: 'modern', fictional: 'modern' };
/** Legacy research cost per tier (for refunds). */
export const LEGACY_COST = { 1: { money: 400, food: 120, steel: 80 }, 2: { money: 1500, food: 400, steel: 300, oil: 40, electronics: 60 }, 3: { money: 4000, food: 1000, steel: 800, oil: 120, electronics: 200 } };

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Where each old tech id goes in an era's new tree: the new tech with the same
 * main effect (the second "+1 research slot" goes to the second slot tech; an
 * effect that now sits in a tech already given counts as given), or null when
 * nothing matches (refunded). → { m1: 'ro_iron', …, i7: null, … }
 */
export function legacyMap(eraId, tree) {
  const out = {}, used = new Set();
  const group = GROUP[eraId];
  for (const old of LEGACY) {
    const fx = (group && old[group]) || old.fx;
    const main = fx[0];
    const near = (a, b) => Math.abs(a.tier - old.tier) - Math.abs(b.tier - old.tier) || a.tier - b.tier;
    const matches = tree.filter((t) => t.effects.some((e) => same(e, main)));
    // A tech not taken yet first; else one already given for another old tech (it holds this effect too).
    const pick = matches.filter((t) => !used.has(t.id)).sort(near)[0] ?? matches.sort(near)[0];
    out[old.id] = pick?.id ?? null;
    if (pick) used.add(pick.id);
  }
  return out;
}
