/**
 * mp-client.js — Playing a persistent multiplayer game in the browser (step 11B).
 *
 * The server (supabase/functions/tick, js/game-server.js) owns the game. This
 * browser:
 *   • loads its player's view (fogged state) and runs the simulation from it,
 *     without the computer players, so armies keep moving smoothly between
 *     ticks (prediction). The clock runs at the game's speed
 *   • listens for new ticks (Realtime, with a slow poll as a safety net) and
 *     replaces its state with the server's. Markers that moved glide to the
 *     corrected place instead of jumping (armies.smoothing)
 *   • sends every order to the server as a command record and asks for an
 *     on-demand tick, so orders land within seconds while players are online.
 *     Simple orders (move, stop, recruit, build, research) also apply at once
 *     here, so the map answers immediately; the rest wait for the server
 *   • shows each order as pending, applied or rejected (with the reason)
 *   • turns server-side changes into feed entries (land won or lost, wars,
 *     peace) and offers into the usual popups
 *
 * net: the lobby backend (js/lobby.js), with view / game / send / myCommands /
 * requestTick / subscribe / setStatus / touch.
 */

import { unpack, restore } from './save.js';
import { fromB64 } from './game-server.js';
import { esc } from './ui-kit.js';

/** Orders that also apply locally at once (the server re-checks them). */
const OPTIMISTIC = new Set(['army.move', 'army.stop', 'unit.recruit', 'unit.cancel', 'building.build', 'building.cancel', 'research.start', 'research.queue', 'research.dequeue', 'research.cancel']);
const POLL_MS = 30000, SEEN_MS = 120000;

export class MultiplayerClient {
  constructor({ state, sim, net, feed, notice, loadMapFor, onEnter, onLeave }) {
    Object.assign(this, { state, sim, net, feed, notice, loadMapFor, onEnter, onLeave });
    this.game = null;
    this.tick = -1;
    this.orders = [];       // { id, kind, label, status, result, at }
    this.seenOffers = new Set();
    this.el = document.getElementById('mp-bar');
    this.ordersEl = document.getElementById('mp-orders');
    this.el.addEventListener('click', (e) => this.onClick(e));
    // Orders go to the server while in a multiplayer game.
    sim.commands.transport = (cmd) => this.send(cmd);
  }

  get active() { return !!this.game; }

  /** Enter a game: load the view, start predicting, listen for ticks. */
  async enter(game, seat) {
    this.leave(true);
    this.game = game;
    this.nation = seat.nation_id;
    this.tick = -1;
    this.orders = [];
    this.seenOffers = new Set();
    document.body.classList.add('mp');
    this.state.multiplayer = { gameId: game.id };
    let v = await this.net.view(game.id, this.nation);
    if (!v && game.status === 'running') {
      // Not ticked yet (just started): ask for the first tick.
      await this.net.requestTick(game.id).catch(() => null);
      v = await this.net.view(game.id, this.nation);
    }
    if (!v) { this.leave(); throw new Error('The game hasn\'t started yet: its first tick sets up the world.'); }
    await this.loadMapFor(game);
    await this.apply(v, { first: true });
    this.unsubscribe = this.net.subscribe(game.id, (what) => this.onChange(what));
    this.poll = setInterval(() => this.refresh(), POLL_MS);
    this.seen = setInterval(() => this.net.touch(game.id).catch(() => {}), SEEN_MS);
    this.net.touch(game.id).catch(() => {});
    await this.refreshOrders();
    this.render();
    this.onEnter?.(this);
  }

  /** Back to the menu (the game goes on without us). */
  leave(silent = false) {
    if (!this.game) return;
    this.unsubscribe?.();
    clearInterval(this.poll);
    clearInterval(this.seen);
    clearTimeout(this.retry);
    this.retry = null;
    this.game = null;
    this.state.multiplayer = null;
    this.state.humans = new Set();
    this.sim.ai.enabled = true;
    document.body.classList.remove('mp');
    this.el.hidden = true;
    this.ordersEl.hidden = true;
    if (!silent) this.onLeave?.();
  }

  async onChange(what) {
    if (!this.game) return;
    if (what === 'commands') { await this.refreshOrders(); return; }
    await this.refresh();
  }

  /** Fetch the game row and, if the server ticked, the new view. */
  async refresh() {
    if (!this.game) return;
    const g = await this.net.game(this.game.id).catch(() => null);
    if (!g || !this.game) return;
    const statusChanged = g.status !== this.game.status;
    this.game = { ...this.game, ...g };
    if (statusChanged) this.onStatus();
    if ((g.tick ?? 0) > this.tick) {
      const v = await this.net.view(g.id, this.nation).catch(() => null);
      if (v && v.tick > this.tick) await this.apply(v);
      await this.refreshOrders();
    }
    this.render();
  }

  /** Replace the predicted world with the server's view, smoothly. */
  async apply(v, { first = false } = {}) {
    const st = this.state, A = this.sim.armies;
    const save = await unpack(fromB64(v.state));
    // Where every marker is drawn now, and what we knew before (feed diff).
    const before = first ? null : {
      drawn: new Map([...A.list.values()].map((a) => [a.id, A.armyPos(a)])),
      owners: st.provinces.map((p) => p.owner),
      wars: new Set(this.sim.combat.wars),
    };
    restore({ state: st, sim: this.sim, feed: null }, save);
    st.playerNationId = this.nation;
    st.humans = new Set();
    st.setPlayerNation(this.nation);
    this.sim.ai.enabled = false; // prediction: the server plays the computer nations
    st.setPhase(this.game.status === 'running' ? 'playing' : 'paused');
    st.setSpeed(this.game.status === 'running' ? this.speed : 0);
    this.tick = v.tick;
    if (before) {
      A.smoothing ??= new Map();
      for (const a of A.list.values()) {
        const was = before.drawn.get(a.id), now = A.armyPos(a);
        if (!was) continue;
        const dx = was.x - now.x, dy = was.y - now.y;
        if (dx * dx + dy * dy > 1e-6) A.smoothing.set(a.id, { dx, dy, t0: performance.now(), ms: 900 });
      }
      this.diffFeed(before);
    }
    this.offers();
    A.changed();
    st.events.emit('mp:tick', { tick: v.tick });
  }

  /** Game hours per real second at this game's speed (clock.speed is a multiple of 1 h/s). */
  get speed() { return 24 / (Number(this.game.minutes_per_day) * 60); }

  diffFeed(before) {
    const st = this.state, me = this.nation;
    let won = 0, lost = 0;
    st.provinces.forEach((p, i) => {
      const was = before.owners[i];
      if (was === p.owner) return;
      if (p.owner === me) won++;
      else if (was === me) lost++;
    });
    if (won) this.state.events.emit('feed', { kind: 'capture', tone: 'good', text: `Server tick: you took ${won} province${won === 1 ? '' : 's'}` });
    if (lost) this.state.events.emit('feed', { kind: 'capture', tone: 'bad', text: `Server tick: you lost ${lost} province${lost === 1 ? '' : 's'}` });
    for (const k of this.sim.combat.wars) {
      if (before.wars.has(k)) continue;
      const [a, b] = k.split(':').map(Number);
      if (a !== me && b !== me) continue;
      const other = st.getNation(a === me ? b : a);
      this.state.events.emit('feed', { kind: 'war', tone: 'war', text: `War with ${other?.name ?? '?'}` });
      if (other) st.events.emit('war:declared', { a: a === me ? b : a, b: me, mp: true });
    }
    for (const k of before.wars) {
      if (this.sim.combat.wars.has(k)) continue;
      const [a, b] = k.split(':').map(Number);
      if (a === me || b === me) this.state.events.emit('feed', { kind: 'peace', tone: 'good', text: `Peace with ${st.getNation(a === me ? b : a)?.name ?? '?'}` });
    }
  }

  /** New offers made to this player (kept by the server) → the usual popups. */
  offers() {
    for (const o of this.sim.commands.open(this.nation)) {
      if (this.seenOffers.has(o.id)) continue;
      this.seenOffers.add(o.id);
      this.state.events.emit('mp:offer', o);
    }
  }

  /**
   * Send an order (commands.issue → here while in a game). Simple orders also
   * apply at once locally; the rest wait for the server. → a result for the UI.
   */
  send(cmd) {
    const label = describe(cmd, this.state, this.sim);
    const entry = { id: null, kind: cmd.kind, label, status: 'sending', result: null, at: Date.now() };
    this.orders.unshift(entry);
    this.orders = this.orders.slice(0, 8);
    let local = { ok: true, pending: true };
    if (OPTIMISTIC.has(cmd.kind)) {
      local = this.sim.commands.applyLocal(cmd);
      if (!local.ok) { entry.status = 'rejected'; entry.result = local.error; this.render(); return local; }
    }
    this.net.send(this.game.id, this.nation, cmd.kind, cmd.payload).then((row) => {
      entry.id = row.id;
      entry.status = 'pending';
      this.render();
      return this.askTick();
    }).catch((err) => {
      entry.status = 'rejected';
      entry.result = err.message;
      this.notice?.(err.message);
      this.render();
    });
    this.render();
    return OPTIMISTIC.has(cmd.kind) ? local : { ok: true, pending: true, error: undefined };
  }

  /**
   * Ask for an on-demand tick. If the game ticked moments ago (cooldown), ask
   * again once the cooldown has passed, so the order still lands quickly.
   */
  async askTick() {
    if (!this.game) return;
    const r = await this.net.requestTick(this.game.id).catch(() => null);
    if (r?.skipped && !this.retry) {
      this.retry = setTimeout(() => { this.retry = null; this.askTick(); }, this.net.tickCooldownMs ?? 21000);
    }
    await this.refresh();
  }

  async refreshOrders() {
    if (!this.game) return;
    const rows = await this.net.myCommands(this.game.id).catch(() => []);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const o of this.orders) {
      const r = o.id != null ? byId.get(o.id) : null;
      if (!r || r.status === o.status) continue;
      o.status = r.status;
      o.result = r.result;
      if (r.status === 'rejected') this.notice?.(`Order rejected: ${o.label}: ${r.result}`);
    }
    this.render();
  }

  onStatus() {
    const s = this.game.status;
    this.state.setPhase(s === 'running' ? 'playing' : 'paused');
    this.state.setSpeed(s === 'running' ? this.speed : 0);
    if (s === 'paused') this.notice?.('The game is paused.');
    if (s === 'running') this.notice?.('The game is running.');
    if (s === 'finished') {
      const w = this.state.getNation(this.game.winner);
      this.notice?.(`The game has ended${w ? `: ${w.name} wins` : ''}. ${this.game.end_reason ?? ''}`);
    }
  }

  render() {
    if (!this.game) return;
    const g = this.game;
    const creator = g.created_by_me;
    const next = g.status === 'running' && g.ticked_at ? Math.max(0, Math.round((Date.parse(g.ticked_at) + 5 * 60000 - Date.now()) / 60000)) : null;
    this.el.hidden = false;
    this.el.innerHTML = `<span class="mp-name">${esc(g.name)}</span>
      <span class="mp-status st-${esc(g.status)}">${esc(g.status.toUpperCase())}</span>
      <span class="mp-tick">tick ${this.tick}${next != null ? ` · next ≤ ${next} min` : ''}</span>
      ${creator && g.status === 'running' ? '<button type="button" class="btn ghost small" data-mp="pause">Pause</button>' : ''}
      ${creator && g.status === 'paused' ? '<button type="button" class="btn ghost small" data-mp="resume">Resume</button>' : ''}
      <button type="button" class="btn ghost small" data-mp="menu">Menu</button>`;
    const rows = this.orders.slice(0, 5).map((o) => `<li class="mpo st-${o.status}" title="${esc(o.result ?? '')}">
      <span class="mpo-dot" aria-hidden="true"></span><span class="mpo-label">${esc(o.label)}</span>
      <span class="mpo-status">${o.status === 'rejected' ? `rejected: ${esc(o.result ?? '')}` : o.status}</span></li>`).join('');
    this.ordersEl.hidden = !this.orders.length;
    this.ordersEl.innerHTML = `<div class="mpo-title">ORDERS</div><ul>${rows}</ul>`;
  }

  async onClick(e) {
    const b = e.target.closest('[data-mp]');
    if (!b) return;
    const a = b.dataset.mp;
    if (a === 'menu') { this.leave(); return; }
    try {
      if (a === 'pause' || a === 'resume') {
        await this.net.setStatus(this.game.id, a === 'pause' ? 'paused' : 'running');
        await this.refresh();
      }
    } catch (err) { this.notice?.(err.message); }
  }
}

/** A short label for an order in the orders list. */
export function describe(cmd, state, sim) {
  const p = cmd.payload ?? {};
  const army = (id) => sim.armies.list.get(id)?.name ?? `army ${id}`;
  const place = (id) => state.getProvince(id)?.name ?? sim.armies.nodeName?.(id) ?? `#${id}`;
  const nation = (id) => state.getNation(id)?.shortName ?? `nation ${id}`;
  switch (cmd.kind) {
    case 'army.move': return `${army(p.army)} → ${place(p.to)}`;
    case 'army.stop': return `Halt ${army(p.army)}`;
    case 'army.split': case 'army.split-half': return `Split ${army(p.army)}`;
    case 'army.merge': return `Merge into ${army(p.into)}`;
    case 'unit.recruit': return `Recruit ${sim.armies.roster?.byKey?.[p.type]?.name ?? p.type} in ${place(p.province)}`;
    case 'unit.cancel': return `Cancel recruit in ${place(p.province)}`;
    case 'building.build': return `Build ${sim.buildings.name?.(p.type) ?? p.type} in ${place(p.province)}`;
    case 'building.cancel': return `Cancel building in ${place(p.province)}`;
    case 'research.start': case 'research.queue': return `Research ${sim.research.byId?.[p.tech]?.name ?? p.tech}`;
    case 'research.dequeue': case 'research.cancel': return `Drop ${sim.research.byId?.[p.tech]?.name ?? p.tech}`;
    case 'war.declare': return `Declare war on ${nation(p.target)}`;
    case 'peace.propose': return `Peace terms to ${nation(p.nation)}`;
    case 'peace.answer': case 'proposal.answer': return `Answer offer (${p.yes ? 'yes' : 'no'})`;
    default: return cmd.kind;
  }
}
