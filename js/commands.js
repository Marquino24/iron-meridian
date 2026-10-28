/**
 * commands.js — Player orders as small command records (step 11A).
 *
 * Every action a player takes (move an army, recruit, build, research,
 * diplomacy, peace) is a plain JSON record:
 *   { kind: 'army.move', nation: 4, payload: { army: 12, to: 803 } }
 * The UI never changes the game directly: it calls commands.issue(kind,
 * payload), which stamps the player's nation and passes the record to
 * apply(). apply() checks the record (the nation owns that army or city, the
 * payload has the right shape) and runs it on the simulation, returning what
 * the system returned ({ ok } / { error } and any extra result).
 *
 * Single-player applies records at once, in the browser. Multiplayer will send
 * the same records to the game authority (the game_commands table), which
 * calls the same apply() — so orders are checked the same way wherever the
 * simulation runs, and a client can't order another nation's armies.
 *
 * Pending offers made TO a nation (treaty, trade and join proposals, peace
 * offers and demands) are remembered here, so "accept" can only accept
 * something that was really offered.
 */

const int = (v) => Number.isInteger(v);
const str = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
const amounts = (o) => o && typeof o === 'object' && !Array.isArray(o) && Object.entries(o).length <= 6
  && Object.entries(o).every(([k, v]) => str(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0);
const intList = (v, max = 64) => Array.isArray(v) && v.length <= max && v.every(int);
const fail = (error) => ({ ok: false, error });
const done = (r = {}) => ({ ok: true, ...r });

/** Command kinds: payload check and handler. ctx = { state, sim, nation, commands }. */
export const KINDS = {
  // --- Armies -------------------------------------------------------------------------
  'army.move': {
    valid: (p) => int(p.army) && int(p.to),
    run: ({ sim, nation }, p) => {
      if (!ownArmy(sim, nation, p.army)) return fail('Not your army.');
      const r = sim.armies.order(p.army, p.to);
      return r.error ? { ok: false, ...r } : done(r);
    },
  },
  'army.stop': {
    valid: (p) => int(p.army),
    run: ({ sim, nation }, p) => (ownArmy(sim, nation, p.army) ? (sim.armies.stop(p.army), done()) : fail('Not your army.')),
  },
  'army.split': {
    valid: (p) => int(p.army) && intList(p.units, 200),
    run: ({ sim, nation }, p) => {
      if (!ownArmy(sim, nation, p.army)) return fail('Not your army.');
      const other = sim.armies.split(p.army, p.units);
      return other ? done({ army: other.id, name: other.name, units: other.units.length }) : fail('Cannot split this army now.');
    },
  },
  'army.split-half': {
    valid: (p) => int(p.army),
    run: ({ sim, nation }, p) => {
      if (!ownArmy(sim, nation, p.army)) return fail('Not your army.');
      const other = sim.armies.splitHalf(p.army);
      return other ? done({ army: other.id, name: other.name, units: other.units.length }) : fail('Cannot split this army now.');
    },
  },
  'army.merge': {
    valid: (p) => int(p.into) && int(p.from),
    run: ({ sim, nation }, p) => {
      if (!ownArmy(sim, nation, p.into) || !ownArmy(sim, nation, p.from)) return fail('Not your army.');
      return sim.armies.merge(p.into, p.from) ? done() : fail('These armies cannot merge now.');
    },
  },
  // --- Cities ---------------------------------------------------------------------------
  'unit.recruit': {
    valid: (p) => int(p.province) && str(p.type),
    run: ({ state, sim, nation }, p) => {
      if (state.provinces[p.province]?.owner !== nation) return fail('Not your city.');
      const r = sim.armies.recruit(p.province, p.type);
      return r.error ? { ok: false, ...r } : done(r);
    },
  },
  'unit.cancel': {
    valid: (p) => int(p.province) && int(p.index),
    run: ({ state, sim, nation }, p) => {
      if (state.provinces[p.province]?.owner !== nation) return fail('Not your city.');
      sim.armies.cancel(p.province, p.index);
      return done();
    },
  },
  'building.build': {
    valid: (p) => int(p.province) && str(p.type),
    run: ({ state, sim, nation }, p) => {
      if (state.provinces[p.province]?.owner !== nation) return fail('Not your city.');
      const r = sim.buildings.build(p.province, p.type);
      return r.error ? { ok: false, ...r } : done(r);
    },
  },
  'building.cancel': {
    valid: (p) => int(p.province),
    run: ({ state, sim, nation }, p) => {
      if (state.provinces[p.province]?.owner !== nation) return fail('Not your city.');
      sim.buildings.cancel(p.province);
      return done();
    },
  },
  // --- Research ---------------------------------------------------------------------------
  'research.start': { valid: (p) => str(p.tech), run: ({ sim, nation }, p) => result(sim.research.start(nation, p.tech)) },
  'research.queue': { valid: (p) => str(p.tech), run: ({ sim, nation }, p) => result(sim.research.enqueue(nation, p.tech)) },
  'research.dequeue': { valid: (p) => str(p.tech), run: ({ sim, nation }, p) => (sim.research.dequeue(nation, p.tech), done()) },
  'research.cancel': { valid: (p) => str(p.tech), run: ({ sim, nation }, p) => (sim.research.cancel(nation, p.tech), done()) },
  // --- Diplomacy ---------------------------------------------------------------------------
  'war.declare': {
    valid: (p) => int(p.target),
    run: ({ state, sim, nation }, p) => {
      if (p.target === nation || !state.getNation(p.target)) return fail('No such nation.');
      return (sim.diplomacy ?? sim.combat).declareWar(nation, p.target) ? done() : fail('You cannot declare war on them now.');
    },
  },
  'treaty.propose': {
    valid: (p) => int(p.nation) && str(p.type),
    run: ({ sim, nation }, p) => {
      const D = sim.diplomacy;
      const r = D.accepts(p.nation, nation, p.type);
      if (!r.ok) { D.remember(p.nation, nation, 'pestered', 'Keeps making proposals', -2, 60); return { ok: false, error: r.reason, refused: true }; }
      D.sign(nation, p.nation, p.type);
      return done();
    },
  },
  'treaty.cancel': {
    valid: (p) => int(p.nation) && str(p.type),
    run: ({ sim, nation }, p) => (sim.diplomacy.cancel(nation, p.nation, p.type), done()),
  },
  'war.ask-join': {
    valid: (p) => int(p.nation) && int(p.target),
    run: ({ sim, nation }, p) => result(sim.diplomacy.askToJoin(nation, p.nation, p.target)),
  },
  'trade.offer': {
    valid: (p) => int(p.nation) && amounts(p.give) && amounts(p.take),
    run: ({ sim, nation }, p) => result(sim.diplomacy.trade(nation, p.nation, p.give, p.take)),
  },
  'trade.gift': {
    valid: (p) => int(p.nation) && amounts(p.give),
    run: ({ sim, nation }, p) => result(sim.diplomacy.gift(nation, p.nation, p.give)),
  },
  // Answer a proposal (treaty, trade, join) a computer nation made to you.
  'proposal.answer': {
    valid: (p) => int(p.id) && typeof p.yes === 'boolean',
    run: ({ sim, nation, commands }, p) => {
      const offer = commands.take(nation, p.id, 'proposal');
      if (!offer) return fail('That offer is no longer open.');
      return result(sim.diplomacy.answer(offer.p, p.yes));
    },
  },
  // --- Peace ---------------------------------------------------------------------------------
  // Your terms to a computer nation (the peace window): provinces you keep, none = white peace.
  'peace.propose': {
    valid: (p) => int(p.nation) && intList(p.provinces ?? [], 64),
    run: ({ sim, nation }, p) => result(sim.ai.proposePeace(p.nation, nation, p.provinces ?? [])),
  },
  // Answer a peace offer or a land demand made to you.
  'peace.answer': {
    valid: (p) => int(p.id) && typeof p.yes === 'boolean',
    run: ({ state, sim, nation, commands }, p) => {
      const offer = commands.take(nation, p.id, 'peace');
      if (!offer) return fail('That offer is no longer open.');
      const name = state.getNation(offer.from).shortName;
      if (!p.yes) {
        state.events.emit('feed', { kind: 'peace', tone: 'war', text: offer.provinces ? `You rejected ${name}'s peace terms` : `You declined ${name}'s peace offer` });
        return done();
      }
      if (!sim.combat.atWar(offer.from, nation)) return fail('That war is already over.');
      const ok = offer.provinces ? sim.combat.makePeace(offer.from, nation, { cede: offer.from, keep: offer.provinces }) : sim.combat.makePeace(offer.from, nation);
      return ok ? done() : fail('That is no longer possible.');
    },
  },
};

function ownArmy(sim, nation, id) { return sim.armies.list.get(id)?.nation === nation; }
/** Systems answer { ok } / { error } / { ok: false, reason }: one shape. */
function result(r) {
  if (!r) return fail('Not possible.');
  if (r.error) return { ...r, ok: false };
  if (r.ok === false) return { ...r, error: r.error ?? r.reason ?? 'Not possible.' };
  return { ...r, ok: true };
}

export class Commands {
  constructor(state, sim) {
    this.state = state;
    this.sim = sim;
    this.log = [];        // the last records applied (newest last), for tests and the authority's report
    this.reset();
    state.events.on('map:loaded', () => this.reset());
    // Offers to a nation, kept until answered (or the war ends). The event's
    // payload gets the offer's id (offerId), which the answer refers to; so
    // this must be created before the popups that listen to the same events.
    state.events.on('diplomacy:proposal', (p) => { p.offerId = this.offer(p.to, { kind: 'proposal', from: p.from, p: { ...p } }); });
    state.events.on('peace:offer', (e) => { e.offerId = this.offer(e.to, { kind: 'peace', from: e.from }); });
    state.events.on('peace:demand', (e) => { e.offerId = this.offer(e.to, { kind: 'peace', from: e.from, provinces: [...e.provinces] }); });
    state.events.on('war', ({ a, b, peace }) => { if (peace) this.dropPeace(a, b); });
  }

  reset() {
    this.pending = new Map(); // nation → Map(id → offer)
    this.nextOffer = 1;
    this.log = [];
  }

  offer(to, item) {
    if (to == null || to < 0) return null;
    if (!this.pending.has(to)) this.pending.set(to, new Map());
    const id = this.nextOffer++;
    this.pending.get(to).set(id, { id, ...item });
    return id;
  }

  /** Offers open to a nation (newest last). */
  open(nation) { return [...(this.pending.get(nation)?.values() ?? [])]; }

  /** Remove and return an open offer of that kind, or null. */
  take(nation, id, kind) {
    const m = this.pending.get(nation);
    const o = m?.get(id);
    if (!o || o.kind !== kind) return null;
    m.delete(id);
    return o;
  }

  dropPeace(a, b) {
    for (const [n, m] of [[a, b], [b, a]]) for (const [id, o] of this.pending.get(n) ?? []) if (o.kind === 'peace' && o.from === m) this.pending.get(n).delete(id);
  }

  /** The player's order: stamped with their nation and applied (single-player) or sent (multiplayer, later). */
  issue(kind, payload = {}) {
    const cmd = { kind, nation: this.state.playerNationId, payload };
    // Multiplayer (mp-client.js): the order goes to the game server; the result
    // may be { ok: true, pending: true } until the server has applied it.
    if (this.state.multiplayer && this.transport) return this.transport(cmd);
    return this.apply(cmd);
  }

  /** Apply a record here only (multiplayer prediction of an order also sent to the server). */
  applyLocal(cmd) { return this.apply(cmd); }

  /**
   * Check and run one command record. The same function serves single-player
   * and the multiplayer authority. → { ok, error?, ... }
   */
  apply(cmd) {
    const k = KINDS[cmd?.kind];
    const st = this.state;
    let out;
    if (!k) out = fail('Unknown order.');
    else if (!int(cmd.nation) || !st.getNation(cmd.nation) || !st.provinces.some((p) => p.owner === cmd.nation)) out = fail('No such nation.');
    else if (!cmd.payload || typeof cmd.payload !== 'object' || !k.valid(cmd.payload)) out = fail('Malformed order.');
    else {
      try { out = k.run({ state: st, sim: this.sim, nation: cmd.nation, commands: this }, cmd.payload); } catch (e) { out = fail(`Order failed: ${e.message}`); }
    }
    this.log.push({ kind: cmd?.kind, nation: cmd?.nation, payload: cmd?.payload, at: st.clock?.time, ok: out.ok, error: out.error });
    if (this.log.length > 200) this.log.shift();
    st.events.emit('command', { cmd, result: out });
    return out;
  }
}
