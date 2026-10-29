/**
 * tutorial.js — The guided first game (step 12).
 *
 * A fixed scenario: Medieval (1200), you play León; Castilla next door is
 * weak (a garrison in Toledo and one border guard). Computer nations stay
 * passive for the whole tutorial, and Castilla accepts the peace you offer.
 *
 * A coach panel walks through eleven steps. Each step points at the exact
 * button or place on the map (a pulsing ring), says what to do in a sentence
 * or two, and moves on only when the player has really done it (the command
 * went through, the battle was won…). Read-only steps have a Next button.
 * The coach is placed wherever it doesn't cover its target.
 *
 * The scenario helpers at the top (findScenario, setupScenario) don't touch
 * the DOM, so tools/check-tutorial.mjs runs the same war headlessly.
 */

import { esc } from './ui-kit.js';
import { pickProvince } from './map.js';

export const SCENARIO = { era: 'medieval', nation: 'León', enemy: 'Castilla' };

/**
 * The places the tutorial uses: your capital, a border province of yours next
 * to it (the march), and a Castilian province beyond it (the battle).
 */
export function findScenario(state, sim) {
  const me = state.nations.find((n) => n.name === SCENARIO.nation)?.id;
  const foe = state.nations.find((n) => n.name === SCENARIO.enemy)?.id;
  if (me == null || foe == null) return null;
  const cap = state.getProvince(state.getNation(me).capitalId);
  const A = sim.armies;
  const army = [...A.list.values()].find((a) => a.nation === me && !a.garrison && a.kind === 'land' && a.node === cap.id)
    ?? [...A.list.values()].find((a) => a.nation === me && !a.garrison && a.kind === 'land');
  // The province to take: big, and far from Castilla's capital (on a phone its
  // garrison marker would cover a small province next to it).
  const fcap = state.getProvince(state.getNation(foe).capitalId);
  let target = null, ts = -1;
  for (const t of state.provinces) {
    if (t.owner !== foe || t.isCity || t.isCapital || !t.neighbors.some((q) => state.provinces[q].owner === me)) continue;
    const score = t.area * Math.hypot(t.center.x - fcap.center.x, t.center.y - fcap.center.y);
    if (score > ts) { ts = score; target = t; }
  }
  if (!target) return null;
  // The march: a border province of yours next to the target, else the capital's neighbour nearest it.
  const hours = (p) => (army ? A.findPath(army, p.id).hours ?? Infinity : 0);
  const near = (p) => Math.hypot(p.center.x - target.center.x, p.center.y - target.center.y);
  const mine = (ids) => ids.map((q) => state.provinces[q]).filter((p) => p.owner === me && p.id !== cap.id);
  const stage = mine(target.neighbors).sort((a, b) => hours(a) - hours(b))[0] ?? mine(cap.neighbors).sort((a, b) => near(a) - near(b))[0];
  if (!stage) return null;
  const best = { stage, target };
  return { me, foe, cap, army, stage: best.stage, target: best.target };
}

/**
 * Make the scenario: computer nations passive, a single Castilian border
 * guard to beat, enough resources for the build/recruit/research steps, and
 * Castilla agreeing to peace.
 */
export function setupScenario(state, sim) {
  const sc = findScenario(state, sim);
  if (!sc) return null;
  const A = sim.armies;
  sim.ai.enabled = false;
  sim.ai.forcePeace = sc.foe;
  for (const a of [...A.list.values()]) if (a.nation === sc.foe && !a.garrison && a.kind === 'land') A.list.delete(a.id);
  A.create(sc.foe, 'land', sc.target.id, A.makeUnits({ inf: 1 }), { name: 'Border Guard' });
  const stock = sim.economy.get(sc.me);
  for (const k of sim.economy.keys) stock[k] = Math.max(stock[k] ?? 0, 3000);
  state.events.emit('economy', sc.me);
  A.changed();
  return sc;
}

/** The tutorial's units finish at once (a real game takes days). */
export function finishRecruits(state, sim) {
  const me = state.playerNationId;
  for (let guard = 0; guard < 20; guard++) {
    let any = false;
    for (const [pid, q] of sim.armies.queues) if (state.provinces[pid].owner === me) { q[0].done = q[0].total; any = true; }
    if (!any) break;
    sim.sandbox.recruitPass(state, me);
  }
}

const $ = (sel) => document.querySelector(sel);
const visible = (el) => !!el && el.getClientRects().length > 0 && !el.closest('[hidden]');
const first = (sel) => [...document.querySelectorAll(sel)].find(visible) ?? null;

export class Tutorial {
  /**
   * @param {object} o
   *   state, sim, camera, canvas, renderer, windows, screens, onboarding
   *   focusNode(node)       fly the camera to a province / sea zone
 *   zoomNode(node)        fly closer to it (its markers cover it)
   *   notice(text)
   *   actions: { startReal(), keepPlaying(), skipped() }
   */
  constructor(o) {
    Object.assign(this, o);
    this.active = false;
    this.step = -1;
    this.sc = null;
    this.lastFocus = null;
    this.build();
    this.steps = this.makeSteps();
    const ev = this.state.events;
    ev.on('command', ({ cmd, result }) => { if (result.ok && cmd.nation === this.state.playerNationId) this.fire('command', cmd); });
    for (const e of ['war', 'battle:end', 'province:owner', 'game:saved']) ev.on(e, (p) => this.fire(e, p));
    // A new map (another game, a loaded save) ends the tutorial.
    ev.on('map:loaded', () => { if (this.active) this.stop(); });
  }

  // --- DOM ------------------------------------------------------------------------------

  build() {
    this.ring = document.createElement('div');
    this.ring.className = 'coach-ring';
    this.ring.hidden = true;
    this.coach = document.createElement('aside');
    this.coach.className = 'coach';
    this.coach.setAttribute('role', 'dialog');
    this.coach.setAttribute('aria-label', 'Tutorial');
    this.coach.setAttribute('aria-live', 'polite');
    this.coach.hidden = true;
    document.body.append(this.ring, this.coach);
    this.coach.addEventListener('click', (e) => {
      const a = e.target.closest('[data-coach]')?.dataset.coach;
      if (a === 'next') this.advance();
      if (a === 'skip') this.skip();
    });
    this.done = document.getElementById('tutorial-done');
    this.done.addEventListener('click', (e) => {
      const a = e.target.closest('[data-done]')?.dataset.done;
      if (!a) return;
      this.done.hidden = true;
      if (a === 'real') this.actions.startReal();
      if (a === 'stay') this.actions.keepPlaying();
    });
  }

  render() {
    const s = this.steps[this.step];
    if (!s) return;
    const n = this.steps.length;
    this.coach.innerHTML = `
      <div class="coach-top">
        <span class="coach-count">STEP ${this.step + 1} OF ${n}</span>
        <span class="coach-dots" aria-hidden="true">${this.steps.map((_, i) => `<i class="${i < this.step ? 'on' : i === this.step ? 'now' : ''}"></i>`).join('')}</span>
        <button type="button" class="coach-skip" data-coach="skip">Skip tutorial</button>
      </div>
      <h3>${esc(s.title)}</h3>
      <p class="coach-text">${typeof s.text === 'function' ? s.text() : s.text}</p>
      <p class="coach-hint" hidden></p>
      ${s.next ? '<div class="coach-actions"><button type="button" class="btn small primary" data-coach="next">Next</button></div>' : ''}`;
    this.hintEl = this.coach.querySelector('.coach-hint');
    this.hintText = null;
  }

  // --- Flow -----------------------------------------------------------------------------

  /** Called once the tutorial game is on screen. */
  begin(sc) {
    this.sc = sc;
    this.active = true;
    this.step = -1;
    document.body.classList.add('tutorial');
    this.advance();
  }

  advance() {
    if (!this.active) return;
    this.steps[this.step]?.leave?.();
    this.step++;
    this.lastFocus = null;
    const s = this.steps[this.step];
    if (!s) { this.finish(); return; }
    this.render();
    s.enter?.();
    this.placeNow = true;
  }

  /** An event the current step may be waiting for. */
  fire(kind, payload) {
    if (!this.active) return;
    const s = this.steps[this.step];
    if (s?.on?.[kind]?.(payload)) this.advance();
  }

  finish() {
    this.close();
    this.onboarding.markDone();
    this.done.hidden = false;
    this.done.querySelector('[data-done="real"]')?.focus({ preventScroll: true });
  }

  skip() {
    this.close();
    this.onboarding.markOffered();
    this.actions.skipped?.();
  }

  /** Stop without a word (another game started). */
  stop() { this.close(); }

  close() {
    this.active = false;
    this.coach.hidden = true;
    this.ring.hidden = true;
    document.body.classList.remove('tutorial');
    if (this.sim.ai.forcePeace === this.sc?.foe) this.sim.ai.forcePeace = null;
    this.sim.ai.enabled = true;
  }

  // --- Targets, placement -----------------------------------------------------------------

  /** Screen rect of the current target: { rect, round } or null. */
  targetRect(t) {
    if (!t) return null;
    if (t.el) {
      if (!visible(t.el)) return null;
      const r = t.el.getBoundingClientRect();
      return { rect: { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }, round: false };
    }
    const c = this.canvas.getBoundingClientRect();
    const box = (h, x0 = h.x0, y0 = h.y0, x1 = h.x1, y1 = h.y1) => ({ rect: { x0: c.left + x0, y0: c.top + y0, x1: c.left + x1, y1: c.top + y1 }, round: true, world: true });
    const A = this.sim.armies;
    if (t.army != null) {
      // The marker as drawn (merged badges included), else where the army stands.
      const h = (this.renderer.hits ?? []).find((x) => (x.kind === 'army' && x.id === t.army) || (x.kind === 'cluster' && x.ids.includes(t.army)));
      if (h) return box(h);
      const a = A.list.get(t.army);
      if (!a) return null;
      const s = this.camera.worldToScreen(A.armyPos(a).x, A.armyPos(a).y);
      return box(null, s.x - 24, s.y - 24, s.x + 24, s.y + 24);
    }
    const s = this.tapPoint(t.node);
    return s ? box(null, s.x - 28, s.y - 28, s.x + 28, s.y + 28) : null;
  }

  /**
   * A spot to tap inside a province that isn't covered by an army or battle
   * marker (a tap there would pick the marker instead), near its middle.
   */
  tapPoint(node) {
    const p = this.state.getProvince(node);
    const cam = this.camera;
    if (!p) { const w = this.sim.armies.pos?.[node]; return w ? cam.worldToScreen(w.x, w.y) : null; }
    const hits = this.renderer.hits ?? [];
    const free = (s) => !hits.some((h) => s.x > h.x0 - 12 && s.x < h.x1 + 12 && s.y > h.y0 - 12 && s.y < h.y1 + 12);
    // Markers are laid out anew on every redraw: recompute when they are.
    const key = `${node}|${cam.x.toFixed(1)}|${cam.y.toFixed(1)}|${cam.zoom.toFixed(4)}`;
    if (this.tapCache?.key === key && this.tapCache.hits === hits) return this.tapCache.s;
    const c = this.canvas.getBoundingClientRect();
    // The spot and a finger's width around it must be bare map (not under a bar or button).
    const bare = (x, y) => { const el = document.elementFromPoint(x, y); return el === this.canvas || !!el?.closest('.coach'); };
    // Phones also snap a tap onto a button close by (touch adjustment): keep well clear of them.
    const buttons = [...document.querySelectorAll('#hud button, #hud [role="button"]')].filter((b) => !b.closest('.coach') && visible(b)).map((b) => b.getBoundingClientRect());
    const clear = (x, y) => !buttons.some((r) => x > r.left - 30 && x < r.right + 30 && y > r.top - 30 && y < r.bottom + 30);
    const onMap = (s) => clear(c.left + s.x, c.top + s.y) && [[0, 0], [-22, 0], [22, 0], [0, -22], [0, 22]].every(([dx, dy]) => bare(c.left + s.x + dx, c.top + s.y + dy));
    // Keep the spot chosen before while it still works (a target that jumps around is hard to hit).
    const kept = this.tapWorld?.node === node ? cam.worldToScreen(this.tapWorld.x, this.tapWorld.y) : null;
    if (kept && free(kept) && onMap(kept)) { this.tapCache = { key, hits, s: kept }; return kept; }
    const { x0, y0, x1, y1 } = p.bbox;
    const spots = [];
    const N = 18;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const wx = x0 + ((x1 - x0) * i) / N, wy = y0 + ((y1 - y0) * j) / N;
      if (pickProvince(this.state.map, wx, wy) !== node) continue;
      const s = cam.worldToScreen(wx, wy);
      if (free(s)) spots.push({ s, wx, wy, d: Math.hypot(wx - p.center.x, wy - p.center.y) });
    }
    spots.sort((a, b) => a.d - b.d);
    // Nearest the middle that the map itself would receive (not under a panel or bar).
    const spot = spots.find((x) => onMap(x.s));
    if (spot) this.tapWorld = { node, x: spot.wx, y: spot.wy };
    let best = spot?.s ?? null;
    // Covered by markers, or under the HUD: zoom in / re-centre (at most once a second).
    if (!best && performance.now() - (this.zoomedAt ?? 0) > 1000) {
      this.zoomedAt = performance.now();
      if (spots.length) this.focusNode(node); else this.zoomNode?.(node);
    }
    best ??= cam.worldToScreen(p.center.x, p.center.y);
    this.tapCache = { key, hits, s: best };
    return best;
  }

  /** A popup in the way (a battle report, a message from another nation): close it first. */
  blocker() {
    const report = $('#battle-report');
    if (visible(report)) return { el: first('#battle-report .btn-row [data-close-report]') ?? first('#battle-report [data-close-report]'), hint: 'Close the report.' };
    const diplo = $('#diplo-modal');
    if (visible(diplo)) return { el: first('#diplo-modal [data-diplo="ok"], #diplo-modal [data-diplo="decline"]'), hint: 'Close this message.' };
    return null;
  }

  /** What a tap at page point (x, y) would hit: { province, marker } (tests, debugging). */
  probe(x, y) {
    const c = this.canvas.getBoundingClientRect();
    const sx = x - c.left, sy = y - c.top;
    const w = this.camera.screenToWorld(sx, sy);
    const h = (this.renderer.hits ?? []).findLast?.((q) => sx >= q.x0 && sx <= q.x1 && sy >= q.y0 && sy <= q.y1);
    return { province: pickProvince(this.state.map, w.x, w.y), marker: h ? { kind: h.kind, id: h.id ?? null } : null };
  }

  /** Where the tutorial is (tests, debugging). */
  snapshot() {
    const s = this.steps[this.step];
    const t = this.active ? this.blocker() ?? s?.target?.() ?? null : null;
    const rect = (el) => { if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }; };
    return {
      active: this.active, index: this.step, id: s?.id ?? null, count: this.steps.length, next: !!s?.next,
      hint: t?.hint ?? '', wait: !!t?.wait, map: !!t && (t.node != null || t.army != null), army: t?.army != null,
      // The ring's box as placed (its pulse animation scales it).
      ring: this.ring.hidden ? null : (({ left, top, width, height }) => ({ x0: parseFloat(left), y0: parseFloat(top), x1: parseFloat(left) + parseFloat(width), y1: parseFloat(top) + parseFloat(height) }))(this.ring.style),
      coach: rect(this.coach),
    };
  }

  /** Per frame: follow the target, keep the coach off it. */
  update() {
    if (!this.active) return;
    const s = this.steps[this.step];
    const screen = this.screens.current;
    const show = screen === 'game' || (s?.menus && (screen === 'menu' || screen === 'saves'));
    this.coach.hidden = !show;
    if (!show) { this.ring.hidden = true; return; }
    const t = this.blocker() ?? s.target?.() ?? null;
    if (this.hintEl) {
      const hint = t?.hint ?? '';
      if (hint !== this.hintText) { this.hintText = hint; this.hintEl.textContent = hint; this.hintEl.hidden = !hint; this.placeNow = true; }
    }
    // Map targets: bring them into view once (and again if they scroll away).
    const key = t && (t.node != null ? `n${t.node}` : t.army != null ? `a${t.army}` : null);
    if (key && key !== this.lastFocus) {
      this.lastFocus = key;
      const node = t.node ?? this.sim.armies.list.get(t.army)?.node;
      if (node != null) this.focusNode(node);
    }
    // Buttons in a scrolling panel or window (phones): scroll each new one into view.
    if (t?.el && t.el !== this.lastEl) {
      this.lastEl = t.el;
      t.el.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    }
    const tr = this.targetRect(t);
    if (!tr) this.ring.hidden = true;
    else {
      const { x0, y0, x1, y1 } = tr.rect;
      const pad = tr.round ? 0 : 4;
      this.ring.hidden = false;
      this.ring.classList.toggle('round', tr.round);
      Object.assign(this.ring.style, { left: `${x0 - pad}px`, top: `${y0 - pad}px`, width: `${x1 - x0 + 2 * pad}px`, height: `${y1 - y0 + 2 * pad}px` });
    }
    this.place(tr?.rect ?? null);
  }

  /**
   * Put the coach where it doesn't overlap the target: phones try the top and
   * bottom bands, then slide down the screen; wider screens try bottom centre,
   * top centre, then the sides.
   */
  place(target) {
    const el = this.coach;
    const W = window.innerWidth, H = window.innerHeight;
    const narrow = W <= 760;
    const w = el.offsetWidth, h = el.offsetHeight;
    const box = (sel) => { const e = $(sel); return visible(e) ? e.getBoundingClientRect() : null; };
    const inGame = this.screens.current === 'game';
    const top = Math.max(8, inGame ? Math.max(box('#topbar')?.bottom ?? 0, box('#resources')?.bottom ?? 0) + 6 : 8);
    const bottom = H - Math.max(8, inGame ? H - Math.min(box('#command-bar')?.top ?? H, box('#statusbar')?.top ?? H) + 6 : 8);
    const cx = Math.round((W - w) / 2);
    const cands = narrow
      ? [[cx, top], [cx, bottom - h]]
      : [[cx, bottom - h], [cx, top], [16, Math.round((H - h) / 2)], [W - w - 16, Math.round((H - h) / 2)], [16, top], [W - w - 16, top], [16, bottom - h], [W - w - 16, bottom - h]];
    for (let y = top; y + h <= bottom; y += 24) cands.push([cx, y]);
    const hit = (x, y) => target && x < target.x1 + 10 && x + w > target.x0 - 10 && y < target.y1 + 10 && y + h > target.y0 - 10;
    let pick = cands.find(([x, y]) => !hit(x, y));
    if (!pick) {
      // Nothing is free (a very tall target): the side with the most room.
      pick = target && target.y0 > H - target.y1 ? [cx, Math.max(8, target.y0 - h - 10)] : [cx, Math.min(H - h - 8, (target?.y1 ?? 0) + 10)];
    }
    const [x, y] = pick.map(Math.round);
    if (this.placeNow || this.px !== x || this.py !== y) {
      this.px = x; this.py = y; this.placeNow = false;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
  }

  // --- The steps ----------------------------------------------------------------------------

  makeSteps() {
    const st = this.state, sim = this.sim, A = sim.armies;
    const sc = () => this.sc;
    const me = () => st.playerNationId;
    const name = (p) => esc(p.cityName ?? p.name);
    const panel = (sel) => first(`#province-panel ${sel}`);
    const isCmd = (kind) => (cmd) => cmd.kind === kind;
    const myArmyHere = (node) => [...A.list.values()].some((a) => a.nation === me() && a.kind === 'land' && (a.node === node || a.dest === node));
    const fieldArmy = () => {
      const s = sc();
      if (A.list.get(s.army?.id)) return A.list.get(s.army.id);
      return [...A.list.values()].filter((a) => a.nation === me() && a.kind === 'land' && !a.garrison).sort((a, b) => b.units.length - a.units.length)[0];
    };
    const selectArmy = (hint) => {
      const sel = A.list.get(st.selectedArmyId);
      if (sel && sel.nation === me() && sel.kind === 'land') return null;
      const a = fieldArmy();
      return a ? { army: a.id, hint } : null;
    };
    const foeProvince = () => {
      const s = sc();
      const near = s.target.neighbors.map((q) => st.provinces[q]).find((p) => p.owner === s.foe);
      return near ?? st.provinces.find((p) => p.owner === s.foe);
    };

    return [
      {
        id: 'resources', next: true,
        title: 'Your resources',
        text: 'You lead León in 1200. The top bar shows your resources; the small number under each is what you earn per day. Buildings, troops and research cost them.',
        enter: () => { st.setSelected(-1); },
        target: () => ({ el: $('#resources') }),
      },
      {
        id: 'build',
        title: 'Build something',
        text: 'Buildings make a city richer or stronger. Open your capital and build one.',
        enter: () => st.setSelectedArmy(-1),
        target: () => {
          const cap = sc().cap;
          if (st.selectedProvinceId !== cap.id) return { node: cap.id, hint: `Tap ${cap.cityName ?? cap.name}, your capital.` };
          const tab = panel('[data-cmd="city-tab"][data-tab="build"]');
          if (tab && tab.getAttribute('aria-selected') !== 'true') return { el: tab, hint: 'Open the Build tab.' };
          const b = panel('[data-cmd="build"]:not([disabled])');
          return b ? { el: b, hint: 'Pick any building and press Build.' } : null;
        },
        on: { command: isCmd('building.build') },
      },
      {
        id: 'recruit',
        title: 'Recruit troops',
        text: 'Cities also train soldiers. Recruit one unit. In a real game it takes a few days; here it is ready at once.',
        target: () => {
          const cap = sc().cap;
          if (st.selectedProvinceId !== cap.id) return { node: cap.id, hint: `Tap ${cap.cityName ?? cap.name} again.` };
          const tab = panel('[data-cmd="city-tab"][data-tab="recruit"]');
          if (tab && tab.getAttribute('aria-selected') !== 'true') return { el: tab, hint: 'Open the Recruit tab.' };
          const b = panel('[data-cmd="recruit"]:not([disabled])');
          return b ? { el: b, hint: 'Press Recruit on any unit.' } : null;
        },
        on: { command: (cmd) => { if (cmd.kind !== 'unit.recruit') return false; finishRecruits(st, sim); return true; } },
      },
      {
        id: 'move',
        title: 'Move an army',
        text: () => `Tap an army to select it, then tap where it should go. March your 1st Army to <b>${name(sc().stage)}</b>, on the border with Castilla.`,
        enter: () => { st.setSelected(-1); st.setSpeed(Math.max(st.clock.speed, 1)); },
        target: () => selectArmy('Tap your 1st Army (the marker with your flag).') ?? { node: sc().stage.id, hint: `Now tap ${sc().stage.name}.` },
        on: { command: isCmd('army.move') },
      },
      {
        id: 'war',
        title: 'Declare war',
        text: 'Castilla is weak: one garrison and a border guard. Armies can only enter enemy land at war.',
        enter: () => st.setSelectedArmy(-1),
        target: () => {
          const t = sc().target;
          if (st.selectedArmyId >= 0) return { el: first('#province-panel [data-cmd="close-army"]'), hint: 'Close the army panel first.' };
          if (st.selectedProvinceId !== t.id) return { node: t.id, hint: `Tap ${t.name}, across the border.` };
          const confirm = panel('[data-cmd="war-confirm"]');
          if (confirm) return { el: confirm, hint: 'Confirm: Declare war.' };
          const b = panel('[data-cmd="war"]');
          return b ? { el: b, hint: 'Press Declare war.' } : null;
        },
        on: { war: ({ a, b, peace }) => !peace && [a, b].includes(me()) && [a, b].includes(sc().foe) },
      },
      {
        id: 'battle',
        title: 'Win a battle',
        text: () => `Send your army into <b>${name(sc().target)}</b>. When armies meet they fight; the bigger, stronger side wins. Time now runs at 4×.`,
        enter: () => { st.setSelected(-1); st.setSpeed(4); },
        target: () => {
          const t = sc().target;
          if (sim.combat.active.has(t.id)) return { node: t.id, hint: 'Battle! Watch it play out.', wait: true };
          if (myArmyHere(t.id)) return { node: t.id, hint: 'Your army is on the way.', wait: true };
          return selectArmy('Tap your army.') ?? { node: t.id, hint: `Now tap ${t.name}.` };
        },
        on: { 'battle:end': (b) => { const s = b.sides?.[b.winner]; return s?.nation === me() && b.sides.some((x) => x.nation === sc().foe); } },
      },
      {
        id: 'capture',
        title: 'Take the province',
        text: 'You won! Stay in the province until the bar fills: then it is yours.',
        enter: () => { if (sc().target.owner === me()) queueMicrotask(() => this.advance()); },
        target: () => ({ node: sc().target.id, hint: 'Hold on while the bar fills…', wait: true }),
        on: {
          // Whichever province they took (not the capital: that one can't be kept at peace).
          'province:owner': ({ provinceId, from, to }) => {
            const p = st.getProvince(provinceId);
            if (to !== me() || from !== sc().foe || p.isCapital) return false;
            sc().target = p;
            return true;
          },
        },
      },
      {
        id: 'integration', next: true,
        title: 'Integration',
        text: 'New land starts half integrated: it pays less and may grow restless. It reaches 100% over a few months; troops nearby keep it calm.',
        enter: () => { st.setSelectedArmy(-1); st.setSelected(sc().target.id); },
        target: () => {
          const t = sc().target;
          if (st.selectedProvinceId !== t.id) return { node: t.id, hint: `Tap ${t.name}.` };
          return { el: panel('.integ') };
        },
      },
      {
        id: 'peace',
        title: 'Make peace',
        text: () => `End the war and keep <b>${name(sc().target)}</b>. Each province you ask for costs war score. (Here Castilla agrees.)`,
        enter: () => { st.setSelected(-1); },
        target: () => {
          const t = sc().target;
          const win = $('#peace-window');
          if (visible(win)) {
            const box = win.querySelector(`input[data-pid="${t.id}"]`);
            if (box && !box.checked) return { el: box.closest('label') ?? box, hint: `Tick ${t.name}.` };
            const send = win.querySelector('[data-peace="send"]');
            return send ? { el: send, hint: 'Send your demand.' } : null;
          }
          if (st.selectedArmyId >= 0) return { el: first('#province-panel [data-cmd="close-army"]'), hint: 'Close the army panel first.' };
          const p = foeProvince();
          if (st.getProvince(st.selectedProvinceId)?.owner !== sc().foe) return { node: p.id, hint: `Tap ${p.name}, a Castilian province.` };
          const b = panel('[data-cmd="offer-peace"]');
          return b ? { el: b, hint: 'Press Negotiate peace.' } : null;
        },
        on: { war: ({ a, b, peace }) => peace && [a, b].includes(me()) && [a, b].includes(sc().foe) },
      },
      {
        id: 'research',
        title: 'Research',
        text: 'Technology makes your nation stronger over time. Open Research and start a tech.',
        enter: () => { st.setSelected(-1); st.setSelectedArmy(-1); },
        target: () => {
          const win = first('.win-research');
          if (!win) return { el: first('#command-bar [data-win="research"]'), hint: 'Open Research (R).' };
          const start = first('.win-research [data-start]:not([disabled])');
          if (start) return { el: start, hint: 'Press Research now.' };
          const tech = first('.win-research .tech.st-available');
          return tech ? { el: tech, hint: 'Pick a tech that is ready to research.' } : null;
        },
        on: { command: isCmd('research.start') },
      },
      {
        id: 'save', menus: true,
        title: 'Save your game',
        text: 'Last step: save. The game also saves itself every week of game time.',
        enter: () => { this.windows.closeAll(); },
        target: () => {
          const scr = this.screens.current;
          if (scr === 'game') return { el: $('#btn-menu'), hint: 'Press MENU.' };
          if (scr === 'menu') return { el: first('[data-menu="save"]'), hint: 'Choose Save Game.' };
          if (scr === 'saves') return { el: first('#saves-list [data-act="save"]'), hint: 'Press Save here on a slot.' };
          return null;
        },
        on: { 'game:saved': (e) => !e?.auto },
      },
    ];
  }
}
