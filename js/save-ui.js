/**
 * save-ui.js — Saved games on screen (step 7B).
 *
 *   Main menu:  Continue (the newest save, autosave included) and Load Game;
 *               while a game is paused there, Save Game as well.
 *   Saves screen: the autosave and slots 1–8, each with a map thumbnail, the
 *               era, nation, in-game date and difficulty (Sandbox saves are
 *               marked), with Load / Save here / Export / Delete. Import reads
 *               an exported file into a free slot.
 *   Autosave:   every in-game week while you play.
 *
 * Exports are .json files (see save.js). In the claude.ai preview the page
 * asks the viewer through the `downloads` capability; elsewhere it uses an
 * ordinary download link.
 */

import { snapshot, writeSlot, listSlots, readSlot, deleteSlot, exportText, importBytes, fileName, SLOTS, AUTO_SLOT, isPersistent } from './save.js';
import { drawFlag } from './flags.js';
import { esc } from './ui-kit.js';
import { svgIcon } from './icons.js';

const WEEK = 7 * 864e5;
const DIFF = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

/** "16 Dec 1939" for an in-game time. */
export const gameDate = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * A small political map around the player's land (outlined in white) with
 * the player's flag in the corner, as a JPEG data URL.
 */
export function makeThumb(state, w = 256) {
  const map = state.map;
  if (!map || typeof document === 'undefined') return null;
  const h = Math.round(w / 2);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#163049';
  ctx.fillRect(0, 0, w, h);
  // Frame the player's territory (at least a third of the map wide), else the whole map.
  const me = state.playerNationId;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of map.provinces) if (p.owner === me) { x0 = Math.min(x0, p.bbox.x0); y0 = Math.min(y0, p.bbox.y0); x1 = Math.max(x1, p.bbox.x1); y1 = Math.max(y1, p.bbox.y1); }
  let vw = map.width, vh = map.height, cx = map.width / 2, cy = map.height / 2;
  // Empires spread over several continents: frame the capital's region instead.
  const cap = map.provinces[state.getNation(me)?.capitalId];
  if (isFinite(x0) && x1 - x0 > map.width / 2 && cap?.owner === me) { x0 = x1 = cap.center.x; y0 = y1 = cap.center.y; }
  if (isFinite(x0)) {
    vw = Math.min(map.width, Math.max((x1 - x0) * 1.6, (y1 - y0) * 1.6 * (w / h), map.width / 3));
    vh = vw * h / w;
    cx = Math.min(Math.max((x0 + x1) / 2, vw / 2), map.width - vw / 2);
    cy = Math.min(Math.max((y0 + y1) / 2, vh / 2), map.height - vh / 2);
  }
  const k = Math.min(w / vw, h / vh);
  ctx.setTransform(k, 0, 0, k, w / 2 - cx * k, h / 2 - cy * k);
  const mine = new Path2D();
  for (const p of map.provinces) {
    const path = new Path2D();
    for (const ring of p.rings ?? [p.polygon]) {
      ring.forEach((v, i) => (i ? path.lineTo(v.x, v.y) : path.moveTo(v.x, v.y)));
      path.closePath();
    }
    ctx.fillStyle = p.owner >= 0 ? state.getNation(p.owner)?.color ?? '#777' : '#8a8a78';
    ctx.fill(path);
    if (p.owner === me) mine.addPath(path);
  }
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.6 / k;
  ctx.lineJoin = 'round';
  ctx.stroke(mine);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const n = state.getNation(me);
  if (n?.flag) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(5, 5, 34, 24); drawFlag(ctx, n.flag, 7, 7, 30, 20); }
  try { return c.toDataURL('image/jpeg', 0.82); } catch { return null; }
}

/** Offer a file to the viewer: claude.ai's downloads capability, else a plain download link. */
async function offerFile(name, text) {
  const use = typeof window !== 'undefined' && window.claude?.use;
  if (use) {
    const dl = await window.claude.use('downloads').catch(() => null);
    if (dl) {
      try { await dl.save({ filename: name, data: text }); return 'saved'; } catch (e) {
        if (e?.code === 'declined') return 'declined';
        if (e?.code !== 'unavailable' && e?.code !== 'not_granted') throw new Error(e?.message ?? 'The download failed.');
      }
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'saved';
}

export class SaveUI {
  /**
   * @param {{ feed, screens, loadGame(save): Promise<void>, notice(text): void }} opts
   */
  constructor(state, sim, { feed, screens, loadGame, notice }) {
    this.state = state;
    this.sim = sim;
    this.feed = feed;
    this.screens = screens;
    this.loadGame = loadGame;
    this.notice = notice;
    this.mode = 'load';
    this.slots = [];
    this.confirm = null;      // `${act}:${slot}` waiting for a second click
    this.busy = false;
    this.nextAuto = Infinity; // game time of the next autosave
    this.highlight = null;
    this.el = {
      list: document.getElementById('saves-list'),
      title: document.getElementById('saves-title'),
      eyebrow: document.getElementById('saves-eyebrow'),
      note: document.getElementById('saves-note'),
      file: document.getElementById('save-file'),
    };
    document.getElementById('save-import').addEventListener('click', () => this.el.file.click());
    this.el.file.addEventListener('change', () => { const f = this.el.file.files[0]; this.el.file.value = ''; if (f) this.importFile(f); });
    this.el.list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b && !b.disabled) this.act(b.dataset.act, b.dataset.slot);
    });
    // Ctrl/Cmd+S saves to the autosave slot while you play.
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && this.state.phase === 'playing') { e.preventDefault(); this.quickSave(); }
    });
    this.refreshMenu();
  }

  // --- Main menu -----------------------------------------------------------------------------

  /** Continue / Save / Load items on the main menu (called whenever it shows). */
  async refreshMenu() {
    try { this.slots = await listSlots(); } catch { this.slots = []; }
    const inGame = this.screens.gameInProgress;
    const latest = this.slots[0];
    const cont = document.querySelector('[data-menu="continue"]');
    cont.hidden = inGame || !latest;
    if (latest) document.getElementById('continue-detail').textContent = `${latest.meta.nationName} · ${gameDate(latest.meta.date)} · ${latest.meta.eraLabel}${latest.slot === AUTO_SLOT ? ' (autosave)' : ''}`;
    document.querySelector('[data-menu="save"]').hidden = !inGame;
    document.getElementById('load-detail').textContent = this.slots.length ? `${this.slots.length} saved game${this.slots.length === 1 ? '' : 's'}, or a file` : 'From a file';
    if (!this.screens.el.saves.hidden) this.render();
  }

  async continueLatest() {
    await this.refreshMenu();
    if (this.slots[0]) await this.load(this.slots[0].slot);
  }

  // --- Saves screen --------------------------------------------------------------------------

  open(mode) {
    this.mode = mode;
    this.confirm = null;
    this.el.title.textContent = mode === 'save' ? 'Save game' : 'Load game';
    this.el.eyebrow.textContent = mode === 'save' ? 'SAVE · PAUSED' : 'SAVED GAMES';
    this.screens.show('saves');
    this.render();
    this.refreshMenu();
  }

  render() {
    const save = this.mode === 'save';
    const bySlot = new Map(this.slots.map((s) => [s.slot, s]));
    const rows = [AUTO_SLOT, ...SLOTS].map((slot) => {
      const s = bySlot.get(slot);
      const auto = slot === AUTO_SLOT;
      const label = auto ? 'Autosave' : `Slot ${slot}`;
      if (!s) {
        if (auto && save) return '';
        return `<div class="save-card empty" role="listitem"><div class="save-thumb blank">${label}</div>
          <div class="save-info"><div class="save-name">${label}</div><div class="save-sub">${auto ? 'Every in-game week while you play' : 'Empty'}</div></div>
          <div class="save-acts">${save ? `<button type="button" class="btn small primary" data-act="save" data-slot="${slot}">${svgIcon('save')}Save here</button>` : ''}</div></div>`;
      }
      const m = s.meta;
      const ask = (act) => this.confirm === `${act}:${slot}`;
      return `<div class="save-card ${this.highlight === slot ? 'fresh' : ''}" role="listitem" data-slot="${slot}">
        ${s.thumb ? `<img class="save-thumb" src="${s.thumb}" alt="Map of ${esc(m.nationName)}'s world">` : `<div class="save-thumb blank">${esc(m.eraLabel)}</div>`}
        <div class="save-info">
          <div class="save-name">${esc(m.nationName)}${m.sandbox ? '<span class="save-tag sandbox">Sandbox</span>' : ''}${auto ? '<span class="save-tag">Autosave</span>' : ''}</div>
          <div class="save-sub"><b>${gameDate(m.date)}</b> · ${esc(m.eraLabel)} · ${DIFF[m.difficulty] ?? m.difficulty}</div>
          <div class="save-sub dim">${label} · day ${m.days} · ${m.provinces} provinces${m.victory !== 'none' ? ` · ${m.points} pts` : ''} · saved ${ago(m.savedAt)}</div>
        </div>
        <div class="save-acts">
          ${save ? (auto ? '' : `<button type="button" class="btn small ${ask('save') ? 'danger' : ''}" data-act="save" data-slot="${slot}">${svgIcon('save')}${ask('save') ? 'Overwrite?' : 'Save here'}</button>`)
            : `<button type="button" class="btn small primary" data-act="load" data-slot="${slot}">Load</button>`}
          <button type="button" class="btn small ghost" data-act="export" data-slot="${slot}" title="Export as a file">${svgIcon('download')}<span>Export</span></button>
          <button type="button" class="btn small ghost ${ask('delete') ? 'danger' : ''}" data-act="delete" data-slot="${slot}" title="Delete">${svgIcon('trash')}<span>${ask('delete') ? 'Delete?' : ''}</span></button>
        </div></div>`;
    });
    const exportNow = save ? `<div class="save-card current"><div class="save-info"><div class="save-name">This game</div><div class="save-sub">Export straight to a file to move it to another device.</div></div>
      <div class="save-acts"><button type="button" class="btn small ghost" data-act="export-current">${svgIcon('download')}<span>Export</span></button></div></div>` : '';
    this.el.list.innerHTML = exportNow + rows.join('');
    this.el.note.textContent = isPersistent() ? '' : 'This browser blocks storage here: saves last until the page closes. Export to keep them.';
    this.el.note.hidden = isPersistent();
  }

  async act(act, slot) {
    if (this.busy) return;
    // Overwriting and deleting ask for a second click.
    const needs = (act === 'save' && this.slots.some((s) => s.slot === slot)) || act === 'delete';
    if (needs && this.confirm !== `${act}:${slot}`) { this.confirm = `${act}:${slot}`; this.render(); return; }
    this.confirm = null;
    this.busy = true;
    try {
      if (act === 'save') await this.saveTo(slot);
      if (act === 'load') await this.load(slot);
      if (act === 'delete') { await deleteSlot(slot); this.notice(`Deleted ${slot === AUTO_SLOT ? 'the autosave' : `slot ${slot}`}.`); }
      if (act === 'export') await this.exportSlot(slot);
      if (act === 'export-current') await this.exportCurrent();
    } catch (e) {
      console.error(e);
      this.notice(e.message || 'Something went wrong.');
    } finally {
      this.busy = false;
    }
    await this.refreshMenu();
    this.render();
  }

  // --- Saving --------------------------------------------------------------------------------

  current() { return snapshot({ state: this.state, sim: this.sim, feed: this.feed }); }

  async saveTo(slot, { quiet = false } = {}) {
    const save = this.current();
    const size = await writeSlot(slot, save, makeThumb(this.state));
    this.highlight = slot;
    if (!quiet) this.notice(`Game saved to ${slot === AUTO_SLOT ? 'the autosave' : `slot ${slot}`} (${Math.max(1, Math.round(size / 1024))} KB).`);
    return size;
  }

  async quickSave() {
    if (this.busy) return;
    this.busy = true;
    try { await this.saveTo(AUTO_SLOT); } catch (e) { this.notice(e.message); } finally { this.busy = false; }
  }

  /** A game started or loaded: the first autosave comes a week from now. */
  arm() { this.nextAuto = this.state.clock.time + WEEK; }

  update() {
    const st = this.state;
    if (st.phase !== 'playing' || !this.screens.gameInProgress || st.clock.time < this.nextAuto || this.busy) return;
    this.nextAuto = st.clock.time + WEEK;
    this.busy = true;
    this.saveTo(AUTO_SLOT, { quiet: true })
      .catch((e) => console.warn('[autosave]', e))
      .finally(() => { this.busy = false; });
  }

  // --- Loading -------------------------------------------------------------------------------

  async load(slot) {
    const { save } = await readSlot(slot);
    await this.loadGame(save);
  }

  // --- Files -----------------------------------------------------------------------------------

  async exportSlot(slot) {
    const { save, thumb } = await readSlot(slot);
    await this.offer(save, thumb);
  }

  async exportCurrent() { await this.offer(this.current(), makeThumb(this.state)); }

  async offer(save, thumb) {
    const name = fileName(save.meta);
    const r = await offerFile(name, await exportText(save, thumb));
    this.notice(r === 'declined' ? 'Export cancelled.' : `Exported ${name}`);
  }

  /** Read a file into the first free slot (or the oldest one when all are taken). */
  async importFile(file) {
    if (this.busy) return;
    this.busy = true;
    try {
      const { save, thumb } = await importBytes(new Uint8Array(await file.arrayBuffer()));
      const used = new Map(this.slots.map((s) => [s.slot, s]));
      const slot = SLOTS.find((s) => !used.has(s)) ?? [...SLOTS].sort((a, b) => used.get(a).meta.savedAt - used.get(b).meta.savedAt)[0];
      await writeSlot(slot, { ...save, meta: { ...save.meta, savedAt: Date.now() } }, thumb);
      this.highlight = slot;
      this.notice(`Imported ${save.meta.nationName}, ${gameDate(save.meta.date)} into slot ${slot}.`);
    } catch (e) {
      console.warn('[import]', e);
      this.notice(e.message || 'Could not read that file.');
    } finally {
      this.busy = false;
    }
    if (this.mode === 'save') this.mode = 'load';
    this.open(this.mode);
  }
}
