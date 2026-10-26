/**
 * diplomacy.js — Relations between nations (step 7A).
 *
 * Between any two nations: War (combat.js), Peace, or treaties on top of
 * peace — Non-Aggression Pact, Right of Passage, Alliance. A truce follows
 * every white peace (combat.js).
 *
 *   declareWar(a, b)      the one way into a war (player, AI, sandbox). Attacking
 *                         during a pact or truce breaks it: a big opinion penalty
 *                         with the victim and a smaller one with everyone else.
 *                         The defender's allies join automatically.
 *   makePeace(a, b)       white peace; allies who joined because of this war follow.
 *   sign / cancel         treaties; accepts(n, from, type) is the AI's answer.
 *   askToJoin(asker, ally, target)   ask an ally into an offensive war.
 *   trade / gift          resource swaps and one-off gifts, judged by the
 *                         receiver's needs (scarcity) and opinion of you.
 *   opinion(of, toward)   −100…+100 with the reasons (shared enemy, broke a
 *                         treaty, took my provinces, border tension, alliance…).
 *
 * Opinion is computed on demand from the current situation plus decaying
 * memories (a gift fades over a year, a betrayal over three), and cached.
 */

export const TREATIES = {
  nap: { label: 'Non-Aggression Pact', short: 'Pact' },
  passage: { label: 'Right of Passage', short: 'Passage' },
  alliance: { label: 'Alliance', short: 'Alliance' },
};
export const RELATION_LABEL = { war: 'War', alliance: 'Alliance', passage: 'Right of Passage', nap: 'Non-Aggression Pact', truce: 'Truce', peace: 'Peace' };
export const RELATION_ORDER = { war: 0, truce: 1, peace: 2, nap: 3, passage: 4, alliance: 5 };

/**
 * Historical ties per era: nations in the same group start with a strong
 * liking for each other (so the Axis, the Allies, NATO… can form).
 */
const TIES = {
  ww1: [['United Kingdom of Great Britain and Ireland', 'French Republic', 'Russian Empire', 'Serbia', 'Belgium', 'Montenegro', 'Empire of Japan'],
    ['German Empire', 'Austro-Hungarian Empire', 'Ottoman Empire', 'Bulgaria']],
  ww2: [['German Reich', 'Kingdom of Italy', 'Empire of Japan', 'Hungary', 'Romania', 'Bulgaria'],
    ['United Kingdom', 'France', 'Poland', 'Canada', 'Australia', 'New Zealand', 'Union of South Africa'],
    ['United States', 'United Kingdom', 'Republic of China', 'Canada']],
  coldwar: [['United States', 'United Kingdom', 'France', 'Federal Republic of Germany', 'Italy', 'Canada', 'Netherlands', 'Belgium', 'Norway', 'Denmark', 'Portugal', 'Turkey', 'Greece', 'Iceland', 'Luxembourg'],
    ['Soviet Union', 'German Democratic Republic', 'Poland', 'Czechoslovakia', 'Hungary', 'Romania', 'Bulgaria', 'Albania', 'Mongolia', 'North Korea'],
    ['United States', 'Japan', 'South Korea', 'Republic of China (Taiwan)', 'Australia', 'New Zealand', 'Philippines', 'Thailand']],
  modern: [['United States of America', 'United Kingdom', 'France', 'Germany', 'Italy', 'Canada', 'Netherlands', 'Belgium', 'Norway', 'Denmark', 'Poland', 'Spain', 'Portugal', 'Turkey', 'Greece'],
    ['Russia', 'Belarus'], ['China', 'Pakistan'], ['United States of America', 'Japan', 'South Korea', 'Australia']],
  rome: [], medieval: [['Kingdom of France', 'Scotland'], ['Castilla', 'León', 'Aragón', 'Portugal', 'Navarre']], fictional: [],
};

/** Base worth of one unit of each resource (money = 1). */
const PRICE = { money: 1, food: 1, steel: 2, oil: 3, electronics: 4, manpower: 0.05 };
const DAY = 864e5;
const key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Floor of the stacking "Dangerous expansion" opinion penalty. */
const EXPANSION_CAP = -50;

export class Diplomacy {
  /**
   * @param {import('./state.js').GameState} state
   * @param {{ economy, armies, combat, ai }} sim
   */
  constructor(state, sim) {
    this.state = state;
    this.sim = sim;
    this.reset();
    state.events.on('map:loaded', () => this.reset());
    // Peace between two nations also ends the wars their allies joined over it.
    state.events.on('war', ({ a, b, peace }) => {
      this.version++;
      this.meet(a, b);
      if (peace) this.followPeace(a, b);
    });
  }

  reset() {
    this.ties = this.buildTies();
    this.treaties = new Map();   // key → Set of treaty types
    this.memory = new Map();     // `${of}>${toward}` → [{ kind, text, value, at, days }]
    this.links = [];             // { joiner, enemy, leader }: joiner fights enemy on leader's behalf
    this.metBy = new Map();      // nation → Set of nations it knows
    this.cache = new Map();
    this.version = 0;
  }

  /** Set of `a:b` keys for nations with historical ties in this era. */
  buildTies() {
    const out = new Set();
    const nations = this.state.nations ?? [];
    const byName = new Map(nations.map((n) => [n.name, n.id]));
    for (const group of TIES[this.state.map?.era?.id] ?? []) {
      const ids = group.map((nm) => byName.get(nm)).filter((x) => x != null);
      for (const a of ids) for (const b of ids) if (a < b) out.add(key(a, b));
    }
    return out;
  }

  // --- Relations ---------------------------------------------------------------------

  has(a, b, type) { return !!this.treaties.get(key(a, b))?.has(type); }
  treatiesOf(a, b) { return [...(this.treaties.get(key(a, b)) ?? [])]; }

  relation(a, b) {
    if (this.sim.combat.atWar(a, b)) return 'war';
    for (const t of ['alliance', 'passage', 'nap']) if (this.has(a, b, t)) return t;
    if (this.sim.combat.truceUntil(a, b) != null) return 'truce';
    return 'peace';
  }

  allies(n) {
    const out = [];
    for (const [k, set] of this.treaties) {
      if (!set.has('alliance')) continue;
      const [x, y] = k.split(':').map(Number);
      if (x === n) out.push(y); else if (y === n) out.push(x);
    }
    return out;
  }

  /** May armies of `nation` march through `owner`'s land? (alliance or right of passage) */
  hasAccess(nation, owner) { return this.has(nation, owner, 'alliance') || this.has(nation, owner, 'passage'); }

  /**
   * Alliance blocs: groups of nations linked by alliances (any chain).
   * Returns Map nation → bloc index (only nations in a bloc).
   */
  blocs() {
    if (this.blocCache?.v === this.version) return this.blocCache.map;
    const map = new Map();
    let next = 0;
    for (const n of this.state.nations) {
      if (map.has(n.id) || !this.allies(n.id).length) continue;
      const stack = [n.id];
      map.set(n.id, next);
      while (stack.length) for (const x of this.allies(stack.pop())) if (!map.has(x)) { map.set(x, next); stack.push(x); }
      next++;
    }
    this.blocCache = { v: this.version, map };
    return map;
  }

  /** Nations `n` knows: neighbours, majors, and anyone it traded, fought or signed with. */
  met(n) {
    let s = this.metBy.get(n);
    if (!s) {
      s = new Set(this.sim.ai?.neighborsOf(n) ?? []);
      for (const x of this.state.nations) if (x.major && x.id !== n) s.add(x.id);
      this.metBy.set(n, s);
    }
    return s;
  }

  meet(a, b) {
    if (a === b || a < 0 || b < 0) return;
    this.met(a).add(b);
    this.met(b).add(a);
  }

  // --- Treaties -----------------------------------------------------------------------

  sign(a, b, type, { silent = false } = {}) {
    if (a === b || !TREATIES[type] || this.sim.combat.atWar(a, b)) return false;
    const k = key(a, b);
    if (!this.treaties.has(k)) this.treaties.set(k, new Set());
    const set = this.treaties.get(k);
    if (set.has(type)) return false;
    set.add(type);
    // An alliance includes passage and non-aggression.
    if (type === 'alliance') { set.delete('nap'); set.delete('passage'); }
    this.meet(a, b);
    this.version++;
    const st = this.state, na = st.getNation(a), nb = st.getNation(b), me = st.playerNationId;
    st.events.emit('diplomacy', { a, b, type, signed: true });
    if (!silent) {
      const text = type === 'alliance' ? `${na.name} and ${nb.name} formed an alliance`
        : type === 'nap' ? `${na.name} and ${nb.name} signed a non-aggression pact`
          : `${na.name} granted ${nb.name} right of passage`;
      st.events.emit('feed', { kind: 'diplomacy', tone: 'good', text, nation: b, involvesPlayer: a === me || b === me });
    }
    return true;
  }

  /** End a treaty openly (not a betrayal, but the other side remembers). */
  cancel(a, b, type, by = a) {
    const set = this.treaties.get(key(a, b));
    if (!set?.has(type)) return false;
    set.delete(type);
    this.version++;
    const other = by === a ? b : a;
    this.remember(other, by, 'cancelled', `Cancelled our ${TREATIES[type].label.toLowerCase()}`, type === 'alliance' ? -25 : -12, 365);
    // Guests leave when passage ends.
    if (type !== 'nap' && !this.hasAccess(a, b)) { this.sim.armies.withdraw(a, b); this.sim.armies.withdraw(b, a); }
    const st = this.state, me = st.playerNationId;
    st.events.emit('diplomacy', { a, b, type, signed: false });
    st.events.emit('feed', { kind: 'diplomacy', tone: 'bad', text: `${st.getNation(by).name} ended the ${TREATIES[type].label.toLowerCase()} with ${st.getNation(other).name}`, nation: other, involvesPlayer: a === me || b === me });
    return true;
  }

  /** Would AI nation `n` sign `type` with `from`? → { ok, reason } */
  accepts(n, from, type) {
    if (this.sim.combat.atWar(n, from)) return { ok: false, reason: 'You are at war.' };
    if (this.has(n, from, type) || (type !== 'alliance' && this.has(n, from, 'alliance'))) return { ok: false, reason: 'Already in force.' };
    const op = this.opinion(n, from).value;
    const ai = this.sim.ai;
    const ratio = (ai?.powerOf(from) ?? 1) / Math.max(1, ai?.powerOf(n) ?? 1);
    if (type === 'nap') {
      // Weaker nations like pacts with stronger ones.
      const need = ratio > 1.5 ? -30 : -5;
      return op >= need ? { ok: true } : { ok: false, reason: `They don't trust you (opinion ${op}, needs ${need}).` };
    }
    if (type === 'passage') return op >= 25 ? { ok: true } : { ok: false, reason: `Not friendly enough (opinion ${op}, needs 25).` };
    // Alliance: friendly, and a reason to stand together.
    const enemiesOfMine = new Set(this.sim.combat.enemiesOf(n));
    if (this.allies(from).some((x) => enemiesOfMine.has(x)) || this.sim.combat.enemiesOf(from).some((x) => this.allies(n).includes(x))) {
      return { ok: false, reason: 'You are tied to their enemies.' };
    }
    const shared = this.sharedEnemies(n, from).length > 0 || this.sharedThreat(n, from);
    const need = shared ? 30 : 60;
    if (op < need) return { ok: false, reason: `Not friendly enough (opinion ${op}, needs ${need}${shared ? '' : ' without a common enemy'}).` };
    return { ok: true };
  }

  sharedEnemies(a, b) {
    const eb = new Set(this.sim.combat.enemiesOf(b));
    return this.sim.combat.enemiesOf(a).filter((x) => eb.has(x));
  }

  /** Both border the same much stronger nation. */
  sharedThreat(a, b) { return this.threatOf(a, b) >= 0; }

  /** A nation bordering both a and b and stronger than either of them alone (or -1). */
  threatOf(a, b) {
    const ai = this.sim.ai;
    if (!ai) return -1;
    const na = ai.neighborsOf(a), nb = ai.neighborsOf(b);
    const p = Math.max(ai.powerOf(a), ai.powerOf(b));
    for (const x of na) if (nb.has(x) && x !== a && x !== b && ai.powerOf(x) > p * 1.2 && !this.has(x, a, 'alliance') && !this.has(x, b, 'alliance')) return x;
    return -1;
  }

  // --- War and peace ------------------------------------------------------------------------

  /**
   * Declare war (everyone goes through here). Breaking a pact, alliance, passage
   * or truce is allowed but remembered by everyone. The defender's allies join.
   */
  declareWar(a, b, { ally = null } = {}) {
    const C = this.sim.combat, st = this.state;
    if (a === b || a < 0 || b < 0 || C.atWar(a, b)) return false;
    const broken = this.treatiesOf(a, b);
    const truce = C.truceUntil(a, b) != null;
    if (broken.length || truce) {
      const what = broken.length ? TREATIES[broken.includes('alliance') ? 'alliance' : broken[0]].label.toLowerCase() : 'truce';
      this.treaties.delete(key(a, b));
      C.truces.delete(key(a, b));
      st.events.emit('diplomacy', { a, b, broken: true });
      this.remember(b, a, 'betrayal', `Broke our ${what}`, -60, 3 * 365);
      for (const n of st.nations) if (n.id !== a && n.id !== b) this.remember(n.id, a, 'betrayal', `Broke a ${what} with ${st.getNation(b).shortName}`, -25, 2 * 365);
      st.events.emit('feed', { kind: 'diplomacy', tone: 'war', text: `${st.getNation(a).name} broke its ${what} with ${st.getNation(b).name}`, nation: a, involvesPlayer: a === st.playerNationId || b === st.playerNationId });
    }
    if (!C.declareWar(a, b)) return false;
    this.remember(b, a, 'attacked', 'Declared war on us', -30, 2 * 365);
    this.version++;
    if (ally != null) this.links.push({ joiner: a, enemy: b, leader: ally });
    // Defensive alliances: everyone allied to the defender (but not to the attacker) joins.
    if (ally == null) {
      for (const c of this.allies(b)) {
        if (c === a || C.atWar(c, a) || this.has(c, a, 'alliance')) continue;
        this.joinWar(c, a, b, 'defend');
      }
    }
    return true;
  }

  /** `joiner` enters `leader`'s war against `enemy`. */
  /**
   * A province changed hands in a war: its neighbours and the victim's allies
   * take note ("Dangerous expansion"; stacks, fades over two years). This is
   * what turns the region against a runaway conqueror (the AI's coalitions).
   */
  onCapture(conqueror, victim, p) {
    if (p.homeOf === conqueror || conqueror < 0) return; // taking back your own land is fine
    const ai = this.sim.ai;
    const witnesses = new Set([...(ai?.neighborsOf(conqueror) ?? []), ...this.allies(victim)]);
    witnesses.delete(conqueror);
    const weight = p.isCapital ? 8 : p.isCity ? 4 : 2.5;
    for (const o of witnesses) this.remember(o, conqueror, 'expansion', 'Dangerous expansion: conquering its neighbours', -weight, 2 * 365);
  }

  joinWar(joiner, enemy, leader, why) {
    const st = this.state, me = st.playerNationId;
    // The alliance obliges: no betrayal penalty for honouring it.
    this.treaties.get(key(joiner, enemy))?.clear();
    this.sim.combat.truces.delete(key(joiner, enemy));
    if (!this.declareWar(joiner, enemy, { ally: leader })) return false;
    this.remember(leader, joiner, 'joined', why === 'defend' ? 'Came to our defence' : why === 'coalition' ? 'Stood with us against a conqueror' : 'Joined our war', 25, 2 * 365);
    st.events.emit('feed', {
      kind: 'diplomacy', tone: 'war', nation: joiner, involvesPlayer: joiner === me || enemy === me || leader === me,
      text: why === 'coalition'
        ? `${st.getNation(joiner).name} joins the coalition against ${st.getNation(enemy).name}`
        : `${st.getNation(joiner).name} joins the war against ${st.getNation(enemy).name} as ${st.getNation(leader).shortName}'s ally`,
    });
    if (joiner === me) st.events.emit('diplomacy:called', { leader, enemy, why });
    return true;
  }

  /** Ask an ally to join an offensive war. AI answers by opinion and odds; returns { ok, reason }. */
  askToJoin(asker, ally, target) {
    const C = this.sim.combat, ai = this.sim.ai;
    if (!this.has(asker, ally, 'alliance')) return { ok: false, reason: 'Only allies can be asked.' };
    if (!C.atWar(asker, target)) return { ok: false, reason: 'You are not at war with them.' };
    if (C.atWar(ally, target)) return { ok: false, reason: 'Already fighting them.' };
    if (ally === this.state.playerNationId) return { ok: false, reason: 'Ask the player.' };
    const r = this.acceptsJoin(ally, asker, target);
    if (r.ok) this.joinWar(ally, target, asker, 'join');
    else this.remember(asker, ally, 'refused', 'Refused to join our war', -8, 180);
    return r;
  }

  acceptsJoin(n, asker, target) {
    if (this.has(n, target, 'alliance')) return { ok: false, reason: `They are allied to ${this.state.getNation(target).shortName} too.` };
    const ai = this.sim.ai;
    const op = this.opinion(n, asker).value, opT = this.opinion(n, target).value;
    const need = 30 + (this.has(n, target, 'nap') ? 25 : 0) + Math.max(0, opT) / 2;
    const odds = ((ai?.powerOf(n) ?? 0) + (ai?.powerOf(asker) ?? 0)) / Math.max(1, ai?.powerOf(target) ?? 1);
    if (odds < 0.8) return { ok: false, reason: 'They think you would lose.' };
    if (op < need) return { ok: false, reason: `Not keen enough (opinion ${op}, needs ${Math.round(need)}).` };
    return { ok: true };
  }

  /**
   * White peace between a and b (status quo ante). Nations that joined this
   * war as allies make peace with the other side too.
   */
  makePeace(a, b, opts) {
    return this.sim.combat.makePeace(a, b, opts);
  }

  followPeace(a, b) {
    const pairs = [];
    for (const l of this.links) {
      if ((l.leader === a && l.enemy === b) || (l.leader === b && l.enemy === a)) pairs.push([l.joiner, l.enemy]);
      else if ((l.joiner === a && l.enemy === b) || (l.joiner === b && l.enemy === a)) l.done = true;
    }
    this.links = this.links.filter((l) => !l.done && !pairs.some(([j, e]) => l.joiner === j && l.enemy === e));
    for (const [j, e] of pairs) if (this.sim.combat.atWar(j, e)) this.sim.combat.makePeace(j, e);
  }

  // --- Trade -----------------------------------------------------------------------------------

  /** What one unit of `res` is worth to nation `n`: base price × scarcity (few days of stock → dear). */
  unitValue(n, res) {
    const E = this.sim.economy;
    const stock = E.get(n)[res] ?? 0;
    const perDay = Math.max(1, Math.abs(E.income(n)?.perDay?.[res] ?? 1));
    const days = stock / perDay;
    return (PRICE[res] ?? 1) * clamp(2 - days / 60, 0.5, 2);
  }

  bundleValue(n, bundle) { return Object.entries(bundle ?? {}).reduce((t, [k, v]) => t + this.unitValue(n, k) * v, 0); }

  /**
   * Would `to` accept: it receives `give` from `from` and pays `take`?
   * → { ok, reason, gain }
   */
  judgeTrade(to, from, give, take, { valueCheck = true } = {}) {
    const E = this.sim.economy;
    for (const [k, v] of Object.entries(take ?? {})) if ((E.get(to)[k] ?? 0) < v) return { ok: false, reason: `They don't have ${Math.round(v)} ${E.set.labels[k].toLowerCase()}.` };
    for (const [k, v] of Object.entries(give ?? {})) if ((E.get(from)[k] ?? 0) < v) return { ok: false, reason: `You don't have ${Math.round(v)} ${E.set.labels[k].toLowerCase()}.` };
    if (this.sim.combat.atWar(to, from)) return { ok: false, reason: 'No trade with an enemy.' };
    if (!valueCheck) return { ok: true, gain: 0 };
    const got = this.bundleValue(to, give), paid = this.bundleValue(to, take);
    const op = this.opinion(to, from).value;
    // Friends accept a slightly worse deal; rivals want a premium.
    const gain = got - paid * (1 - op / 250);
    if (!paid) return { ok: true, gain };
    return gain >= 0 ? { ok: true, gain } : { ok: false, gain, reason: `Not worth it to them${op < 0 ? ` (opinion ${op})` : ''}. Offer more or ask for less.` };
  }

  /** Execute a swap: `from` pays `give` to `to` and receives `take`. */
  trade(from, to, give, take, { judged = true } = {}) {
    // judged: the receiver (an AI) weighs the deal; false when the player accepted it.
    const r = this.judgeTrade(to, from, give, take, { valueCheck: judged });
    if (!r.ok) return r;
    this.move(from, to, give);
    this.move(to, from, take);
    this.meet(from, to);
    this.remember(to, from, 'trade', 'Traded with us', 6, 180);
    this.state.events.emit('economy', from);
    const st = this.state;
    st.events.emit('feed', { kind: 'diplomacy', tone: 'good', text: `Trade: ${st.getNation(from).shortName} ↔ ${st.getNation(to).shortName} (${this.describe(give)} for ${this.describe(take)})`, nation: to, involvesPlayer: from === st.playerNationId || to === st.playerNationId });
    return r;
  }

  /** A one-off gift: worth more opinion the bigger it is next to their income. */
  gift(from, to, give) {
    const E = this.sim.economy;
    for (const [k, v] of Object.entries(give)) if ((E.get(from)[k] ?? 0) < v) return { ok: false, reason: `You don't have ${Math.round(v)} ${E.set.labels[k].toLowerCase()}.` };
    const value = this.bundleValue(to, give);
    const daily = Math.max(50, this.bundleValue(to, E.income(to).perDay));
    const boost = Math.round(clamp((value / daily) * 4, value > 0 ? 3 : 0, 30));
    this.move(from, to, give);
    this.meet(from, to);
    this.remember(to, from, 'gift', 'Sent us gifts', boost, 365);
    this.state.events.emit('economy', from);
    return { ok: true, boost };
  }

  move(from, to, bundle) {
    const E = this.sim.economy;
    for (const [k, v] of Object.entries(bundle ?? {})) {
      E.get(from)[k] = Math.max(0, (E.get(from)[k] ?? 0) - v);
      E.get(to)[k] = (E.get(to)[k] ?? 0) + v;
    }
  }

  describe(bundle) {
    const L = this.sim.economy.set.labels;
    const parts = Object.entries(bundle ?? {}).filter(([, v]) => v > 0).map(([k, v]) => `${Math.round(v)} ${L[k].toLowerCase()}`);
    return parts.join(' + ') || 'nothing';
  }

  // --- Opinion ----------------------------------------------------------------------------------

  remember(of, toward, kindName, text, value, days) {
    if (of === toward || of < 0 || toward < 0) return;
    const k = `${of}>${toward}`;
    const list = this.memory.get(k) ?? [];
    // One live memory per kind: a new one replaces (and can stack up for gifts).
    const old = list.find((m) => m.kind === kindName);
    const now = this.state.clock.time;
    if (old && kindName === 'gift') { old.value = clamp(this.memoryNow(old, now) + value, -100, 40); old.at = now; old.text = text; }
    else if (old && kindName === 'expansion') { old.value = clamp(this.memoryNow(old, now) + value, EXPANSION_CAP, 0); old.at = now; old.text = text; }
    else if (old) Object.assign(old, { value: Math.sign(value) === Math.sign(old.value) && Math.abs(old.value) > Math.abs(value) ? old.value : value, at: now, days, text });
    else list.push({ kind: kindName, text, value, at: now, days });
    this.memory.set(k, list);
    this.version++;
  }

  memoryNow(m, now) {
    const t = (now - m.at) / DAY / m.days;
    return t >= 1 ? 0 : m.value * (1 - t);
  }

  /** Opinion of `of` toward `toward`: { value, reasons: [{ text, value }] } (cached a day). */
  opinion(of, toward) {
    const now = this.state.clock.time;
    const k = `${of}>${toward}`;
    const hit = this.cache.get(k);
    if (hit && hit.v === this.version && now - hit.at < DAY) return hit;
    const reasons = [];
    const add = (text, value) => { if (Math.round(value)) reasons.push({ text, value: Math.round(value) }); };
    const C = this.sim.combat, st = this.state, ai = this.sim.ai;
    if (of !== toward && of >= 0 && toward >= 0) {
      if (C.atWar(of, toward)) add('At war with us', -50);
      else if (C.truceUntil(of, toward) != null) add('Recent war', -15);
      if (this.has(of, toward, 'alliance')) add('Our ally', 35);
      if (this.ties.has(key(of, toward))) add('Historical ties', 35);
      if (this.has(of, toward, 'nap')) add('Non-aggression pact', 10);
      if (this.has(of, toward, 'passage')) add('Right of passage', 5);
      const shared = this.sharedEnemies(of, toward);
      if (shared.length) add(`Shared enemy: ${shared.slice(0, 2).map((x) => st.getNation(x).shortName).join(', ')}`, Math.min(25, 15 * shared.length));
      const threat = this.threatOf(of, toward);
      if (threat >= 0) add(`Common threat: ${st.getNation(threat).shortName}`, 15);
      const enemies = new Set(C.enemiesOf(of));
      const hostileAllies = this.allies(toward).filter((x) => enemies.has(x));
      if (hostileAllies.length) add(`Allied with our enemy ${st.getNation(hostileAllies[0]).shortName}`, -20);
      let taken = 0;
      for (const p of st.provinces) if (p.homeOf === of && p.owner === toward) taken++;
      if (taken) add(`Took ${taken} of our province${taken === 1 ? '' : 's'}`, -Math.min(40, 4 * taken));
      if (ai?.neighborsOf(of)?.has(toward)) {
        const ratio = ai.powerOf(toward) / Math.max(1, ai.powerOf(of));
        if (ratio > 1.5) add('Border tension: a much stronger neighbour', -Math.min(20, 6 * ratio));
        else if (ratio > 1.1) add('Border tension', -5);
      }
      const pers = ai?.personalityOf(of);
      if (pers === 'aggressive') add('Aggressive temperament', -5);
      else if (pers === 'defensive' && C.enemiesOf(toward).length === 0) add('Peaceful neighbour', 5);
      for (const m of this.memory.get(k) ?? []) add(m.text, this.memoryNow(m, now));
    }
    reasons.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const value = clamp(reasons.reduce((t, r) => t + r.value, 0), -100, 100);
    const out = { value, reasons, v: this.version, at: now };
    this.cache.set(k, out);
    return out;
  }

  // --- Proposals to the player ------------------------------------------------------------

  /**
   * An AI proposes something to the player (shown as a popup by diplomacy-ui):
   *   { kind: 'treaty', type } | { kind: 'trade', give, take } | { kind: 'join', target }
   * At most one every 10 days overall and one per nation every 60 days.
   */
  propose(from, to, payload) {
    if (to !== this.state.playerNationId || this.state.sandbox && !this.sim.ai.controls(from)) return false;
    const now = this.state.clock.time;
    this.lastFrom ??= new Map();
    if (now - (this.lastAny ?? -Infinity) < 10 * DAY || now - (this.lastFrom.get(from) ?? -Infinity) < 60 * DAY) return false;
    this.lastAny = now;
    this.lastFrom.set(from, now);
    this.meet(from, to);
    this.state.events.emit('diplomacy:proposal', { from, to, ...payload });
    return true;
  }

  /** The player's answer to a proposal. */
  answer(p, yes) {
    const me = p.to, st = this.state;
    if (!yes) {
      this.remember(p.from, me, 'declined', p.kind === 'join' ? 'Refused to join our war' : 'Turned down our proposal', p.kind === 'join' ? -15 : -5, 180);
      return { ok: true };
    }
    if (p.kind === 'treaty') return this.sign(p.from, me, p.type) ? { ok: true } : { ok: false, reason: 'No longer possible.' };
    if (p.kind === 'join') {
      if (this.sim.combat.atWar(me, p.target)) return { ok: true };
      return this.joinWar(me, p.target, p.from, 'join') ? { ok: true } : { ok: false, reason: 'No longer possible.' };
    }
    if (p.kind === 'trade') return this.trade(p.from, me, p.give, p.take, { judged: false });
    return { ok: false };
  }

  /**
   * A swap `n` would like with `partner`: give some of its most plentiful
   * resource for some of what it is shortest of (and the partner has).
   */
  tradeIdea(n, partner) {
    const E = this.sim.economy;
    const keys = E.keys.filter((k) => k !== 'manpower');
    const scored = keys.map((k) => ({ k, v: this.unitValue(n, k) / (PRICE[k] ?? 1) })).sort((a, b) => b.v - a.v);
    const want = scored[0], spare = scored[scored.length - 1];
    if (!want || want.k === spare.k || want.v < 1.4 || spare.v > 0.8) return null;
    const have = E.get(n)[spare.k] ?? 0, theirs = E.get(partner)[want.k] ?? 0;
    const takeAmt = Math.round(Math.min(theirs * 0.2, 500) / 50) * 50;
    if (takeAmt < 50) return null;
    // Pay a little over the base price, so the deal tempts a neutral partner.
    const giveAmt = Math.round(Math.min(have * 0.5, (takeAmt * (PRICE[want.k] ?? 1) * 1.25) / (PRICE[spare.k] ?? 1)) / 50) * 50;
    if (giveAmt < 50) return null;
    return { give: { [spare.k]: giveAmt }, take: { [want.k]: takeAmt } };
  }

  update() { /* opinions are computed on demand; AI diplomacy runs in ai.js */ }
}
