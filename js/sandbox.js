/**
 * sandbox.js — The rules-free tools of a Sandbox game (step 6B).
 *
 * Every tool works on any nation, not just the one you play:
 *   paint(pid, nation)            give a province to a nation
 *   spawn(node, nation, type, n)  a new army of n units at a province or sea zone
 *   addResource(nation, key, n)   give (n > 0) or take (n < 0) resources
 *   setWar(a, b, war)             war, or peace keeping today's borders (no truce)
 *   setAI(nation, on) / setAllAI  computer control per nation, or all at once
 *   instant.{build,recruit,research}  your queues finish at once
 *   playAs(nation)                switch the nation you control (the computer takes the old one)
 *
 * The sandbox only exists while state.sandbox is true; update() is a system
 * like the others and does nothing in a normal game.
 */

export class Sandbox {
  /**
   * @param {import('./state.js').GameState} state
   * @param {{ economy, buildings, armies, combat, research, ai }} sim
   */
  constructor(state, sim) {
    this.state = state;
    this.sim = sim;
    this.instant = { build: false, recruit: false, research: false };
    state.events.on('mode', (on) => { if (!on) this.instant = { build: false, recruit: false, research: false }; });
  }

  get on() { return this.state.sandbox; }

  // --- Map ----------------------------------------------------------------------

  /** Give a province to a nation. Returns true if it changed hands. */
  paint(pid, nation) {
    const p = this.state.getProvince(pid);
    if (!this.on || !p || nation < 0 || p.owner === nation) return false;
    const from = p.owner;
    // Whatever was happening there (a siege, a build) belongs to the old owner.
    this.sim.combat.occupations.delete(pid);
    this.sim.buildings.construction.delete(pid);
    this.sim.armies.queues.delete(pid);
    this.state.setOwner(pid, nation);
    // A nation that had no land gets a computer player (unless it's you).
    if (from !== nation) this.sim.ai.addBrain(nation);
    return true;
  }

  /**
   * A new army of `count` units of `typeKey` for `nation` at `node` (a
   * province, or a sea zone node for ships). Returns { army } or { error }.
   */
  spawn(node, nation, typeKey, count) {
    const A = this.sim.armies;
    const t = A.roster.byKey[typeKey];
    if (!this.on || !t || nation < 0) return { error: 'Pick a nation and a unit type.' };
    const naval = t.role === 'nav';
    if (node < 0) return { error: 'Tap a province or a sea zone.' };
    if (naval !== A.isSea(node)) return { error: naval ? 'Ships go in a sea zone (tap the water).' : 'Land units go in a province, not at sea.' };
    const n = Math.max(1, Math.min(50, Math.round(count)));
    const units = A.makeUnits({ [t.role]: n }, nation);
    const army = A.create(nation, naval ? 'naval' : 'land', node, units);
    A.changed();
    // Next to an enemy? The fight starts right away.
    this.sim.combat.checkContact(army);
    return { army };
  }

  // --- Economy -------------------------------------------------------------------

  /** Give or take resources (never below zero). */
  addResource(nation, key, amount) {
    const E = this.sim.economy;
    if (!this.on || nation < 0 || !E.keys.includes(key)) return 0;
    const s = E.get(nation);
    s[key] = Math.max(0, (s[key] ?? 0) + amount);
    this.state.events.emit('economy', nation);
    return s[key];
  }

  // --- Diplomacy -----------------------------------------------------------------

  /** War, or a peace that keeps the current borders and leaves no truce. */
  setWar(a, b, war) {
    const C = this.sim.combat;
    if (!this.on || a < 0 || b < 0 || a === b) return false;
    if (war) {
      C.truces.delete(a < b ? `${a}:${b}` : `${b}:${a}`);
      return C.declareWar(a, b);
    }
    return C.makePeace(a, b, { revert: false, truce: false });
  }

  // --- Computer players ------------------------------------------------------------

  setAI(nation, on) {
    const ai = this.sim.ai;
    if (on) ai.disabled.delete(nation); else ai.disabled.add(nation);
    this.state.events.emit('sandbox', { ai: nation });
  }

  setAllAI(on) {
    this.sim.ai.enabled = on;
    if (on) this.sim.ai.disabled.clear();
    this.state.events.emit('sandbox', { ai: 'all' });
  }

  aiOn(nation) {
    const ai = this.sim.ai;
    return ai.enabled && !ai.disabled.has(nation);
  }

  // --- Play as -----------------------------------------------------------------------

  /** Take control of another nation; the computer runs the one you leave. */
  playAs(nation) {
    const st = this.state, ai = this.sim.ai;
    const old = st.playerNationId;
    if (!this.on || nation === old || !st.getNation(nation)) return false;
    ai.removeBrain(nation);
    st.setSelectedArmy(-1);
    st.setPlayerNation(nation);
    if (old >= 0) ai.addBrain(old);
    this.sim.economy.recount();
    this.state.events.emit('feed', { kind: 'sandbox', tone: 'good', text: `Sandbox: now playing as ${st.getNation(nation).name}`, nation });
    return true;
  }

  // --- Instant modes ------------------------------------------------------------------

  /**
   * Instant build / recruit / research for the nation you play: anything in
   * its queues is marked finished, and the systems complete it this frame
   * (also while the clock is paused).
   */
  update(state) {
    if (!this.on || state.phase !== 'playing') return;
    const me = state.playerNationId;
    const { buildings: B, armies: A, research: R } = this.sim;
    const tick = 1e-6;
    if (this.instant.build) {
      let any = false;
      for (const [pid, job] of B.construction) if (state.provinces[pid].owner === me) { job.done = job.total; any = true; }
      if (any) B.update(state, tick);
    }
    if (this.instant.recruit) {
      // A city builds one unit at a time: finish every unit in its line now.
      for (let guard = 0; guard < 50; guard++) {
        let any = false;
        for (const [pid, q] of A.queues) if (state.provinces[pid].owner === me) { q[0].done = q[0].total; any = true; }
        if (!any) break;
        this.recruitPass(state, me);
      }
    }
    if (this.instant.research) {
      for (let guard = 0; guard < 20; guard++) {
        const r = R.of(me);
        if (!r.active.length) break;
        for (const a of r.active) a.done = a.total;
        R.update(state, tick);
      }
    }
  }

  /** Finish the head unit of each of your city queues (armies.update minus movement). */
  recruitPass(state, me) {
    const A = this.sim.armies;
    for (const [pid, q] of [...A.queues]) {
      if (state.provinces[pid].owner !== me) continue;
      const item = q[0];
      if (item.done < item.total) continue;
      q.shift();
      if (!q.length) A.queues.delete(pid);
      A.finishUnit(pid, item.type);
    }
  }
}
