/**
 * state.js — Single source of truth for the running game.
 *
 * Rendering and UI never mutate game data directly: they call methods here,
 * and listen to events emitted on `state.events`. Future systems (economy,
 * units, AI, research) should hang their data off GameState and mutate it
 * through methods that emit events, the same way setOwner() does.
 *
 * Events:
 *   'map:loaded'      (map)                — new world generated
 *   'phase'           (phase)              — 'setup' | 'playing'
 *   'player'          (nationId)
 *   'hover'           (provinceId)
 *   'select'          (provinceId)
 *   'focus:nation'    (nationId)           — nation highlighted on the start screen
 *   'province:owner'  ({ provinceId, from, to })
 *   'clock:speed'     (speed)
 *   'select:army'     (armyId)             — army chosen on the map (-1 = none)
 *
 * Emitted by the simulation systems (economy.js, armies.js, combat.js):
 *   'economy', 'armies', 'war' ({a, b}), 'battle:end' (battle),
 *   'feed' ({ kind, tone, text, battleId?, node? }) — the event feed
 */

/** Tiny pub/sub. `on` returns an unsubscribe function. */
export function createEmitter() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },
    emit(event, payload) {
      const set = listeners.get(event);
      if (set) for (const fn of set) fn(payload);
    },
  };
}

/** Placeholder campaign start: 14 March 2031, 06:00 UTC. */
export const START_DATE = Date.UTC(2031, 2, 14, 6, 0, 0);
/** Game hours that pass per real second at 1× speed. */
export const GAME_HOURS_PER_SECOND = 1;
/** Selectable speeds; 0 = paused. */
export const SPEEDS = [0, 1, 2, 4];

export class GameState {
  constructor() {
    this.events = createEmitter();
    this.map = null;
    this.phase = 'setup';
    this.playerNationId = -1;
    this.hoveredProvinceId = -1;
    this.selectedProvinceId = -1;
    this.focusedNationId = -1;
    this.selectedArmyId = -1;
    this.clock = { time: START_DATE, start: START_DATE, speed: 1 };
  }

  // --- Accessors -----------------------------------------------------------

  get provinces() { return this.map ? this.map.provinces : []; }
  get nations() { return this.map ? this.map.nations : []; }
  getProvince(id) { return id >= 0 ? this.provinces[id] ?? null : null; }
  getNation(id) { return id >= 0 ? this.nations[id] ?? null : null; }
  get era() { return this.map?.era ?? null; }
  get playerNation() { return this.getNation(this.playerNationId); }

  provincesOf(nationId) { return this.provinces.filter((p) => p.owner === nationId); }

  nationStats(nationId) {
    const own = this.provincesOf(nationId);
    return {
      provinces: own.length,
      cities: own.filter((p) => p.isCity).length,
      area: own.reduce((s, p) => s + p.area, 0),
    };
  }

  // --- Lifecycle -----------------------------------------------------------

  loadMap(map) {
    this.map = map;
    this.phase = 'setup';
    this.playerNationId = -1;
    this.hoveredProvinceId = -1;
    this.selectedProvinceId = -1;
    this.focusedNationId = -1;
    this.selectedArmyId = -1;
    // Real-world eras start on their own date; the fictional world on START_DATE.
    this.clock.start = this.clock.time = map.startDate ?? START_DATE;
    this.events.emit('map:loaded', map);
    this.events.emit('phase', this.phase);
  }

  setPhase(phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.events.emit('phase', phase);
  }

  setPlayerNation(nationId) {
    this.playerNationId = nationId;
    this.events.emit('player', nationId);
  }

  // --- Interaction ---------------------------------------------------------

  setHovered(id) {
    if (id === this.hoveredProvinceId) return;
    this.hoveredProvinceId = id;
    this.events.emit('hover', id);
  }

  setSelected(id) {
    if (id >= 0) this.setSelectedArmy(-1);
    if (id === this.selectedProvinceId) return;
    this.selectedProvinceId = id;
    this.events.emit('select', id);
  }

  /** Select an army (the side panel shows it instead of the province). */
  setSelectedArmy(id) {
    if (id === this.selectedArmyId) return;
    this.selectedArmyId = id;
    this.events.emit('select:army', id);
  }

  setFocusedNation(id) {
    if (id === this.focusedNationId) return;
    this.focusedNationId = id;
    this.events.emit('focus:nation', id);
  }

  // --- Mutations used by future systems -------------------------------------

  /** Transfer a province (conquest, treaties...). Renderer rebuilds borders. */
  setOwner(provinceId, nationId) {
    const p = this.getProvince(provinceId);
    if (!p || p.owner === nationId) return;
    const from = p.owner;
    p.owner = nationId;
    this.events.emit('province:owner', { provinceId, from, to: nationId });
  }

  // --- Clock ---------------------------------------------------------------

  setSpeed(speed) {
    this.clock.speed = speed;
    this.events.emit('clock:speed', speed);
  }

  /**
   * Advance the game clock by a real-time delta (seconds).
   * @returns {number} game hours elapsed — feed this to simulation systems.
   */
  tick(dtReal) {
    if (this.phase !== 'playing' || this.clock.speed === 0) return 0;
    const hours = dtReal * GAME_HOURS_PER_SECOND * this.clock.speed;
    this.clock.time += hours * 3600e3;
    return hours;
  }
}
