/**
 * windows.js — Command bar and the floating command windows.
 *
 * Desktop: windows float over the map, can be dragged by their title bar,
 * brought to the front with a click, and closed. Phones: each window is a
 * full-screen sheet between the top bar and the command bar, one at a time.
 * Shortcuts: A = Army, P = Production, B = Buildings, Esc closes the top one.
 * The game keeps running underneath.
 *
 * A window is an object with:
 *   id, title, glyph, key        — identity and shortcut
 *   render(body)                 — full redraw of the body
 *   signature()                  — string; a change triggers render()
 *   live(body)                   — cheap in-place updates (progress, HP)
 *   onClick(e), onChange(e)      — delegated events inside the body
 */

import { svgIcon } from './icons.js';
import { isNarrow, esc } from './ui-kit.js';

export class WindowManager {
  /**
   * @param {import('./state.js').GameState} state
   * @param {object[]} windows
   */
  constructor(state, windows) {
    this.state = state;
    this.windows = new Map(windows.map((w) => [w.id, w]));
    this.open = [];          // ids, bottom → top
    this.z = 30;
    this.timer = 0;
    this.layer = document.getElementById('windows');
    this.bar = document.getElementById('command-bar');
    this.renderBar();

    this.bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-win]');
      if (b) this.toggle(b.dataset.win);
    });
    document.addEventListener('keydown', (e) => this.onKey(e), true);
    state.events.on('phase', (phase) => { if (phase !== 'playing') this.closeAll(); });
    state.events.on('map:loaded', () => this.closeAll());
    window.addEventListener('resize', () => {
      if (isNarrow() && this.open.length > 1) this.open.slice(0, -1).forEach((id) => this.close(id));
      for (const id of this.open) this.clamp(this.windows.get(id).el);
    });
  }

  renderBar() {
    this.bar.innerHTML = [...this.windows.values()].map((w) => `
      <button type="button" data-win="${w.id}" aria-pressed="false" title="${esc(w.title)} (${w.key.toUpperCase()})">
        <span class="cb-ico" aria-hidden="true">${svgIcon(w.id)}</span><span class="cb-label">${esc(w.title)}</span><kbd>${w.key.toUpperCase()}</kbd>
      </button>`).join('');
  }

  /** Small badge on a command-bar button ('' hides it). */
  setBadge(id, text, title = '') {
    const b = this.bar.querySelector(`[data-win="${id}"]`);
    if (!b) return;
    let el = b.querySelector('.cb-badge');
    if (!text) { el?.remove(); return; }
    if (!el) { el = document.createElement('span'); el.className = 'cb-badge'; b.appendChild(el); }
    if (el.textContent !== text) el.textContent = text;
    el.title = title;
  }

  isOpen(id) { return this.open.includes(id); }

  toggle(id) { if (this.isOpen(id) && this.top() === id) this.close(id); else this.show(id); }

  top() { return this.open[this.open.length - 1]; }

  show(id) {
    const w = this.windows.get(id);
    if (!w || this.state.phase !== 'playing') return;
    if (isNarrow()) for (const other of [...this.open]) if (other !== id) this.close(other);
    if (!w.el) this.create(w);
    if (!this.isOpen(id)) {
      this.open.push(id);
      w.el.hidden = false;
      this.place(w);
      w.sig = null;
    } else {
      this.open = this.open.filter((x) => x !== id).concat(id);
    }
    w.el.style.zIndex = String(++this.z);
    this.refresh(w, true);
    this.syncBar();
    w.el.querySelector('.win-close').focus({ preventScroll: true });
  }

  close(id) {
    const w = this.windows.get(id);
    if (!w?.el || !this.isOpen(id)) return;
    w.el.hidden = true;
    this.open = this.open.filter((x) => x !== id);
    this.syncBar();
  }

  closeAll() { for (const id of [...this.open]) this.close(id); }

  syncBar() {
    for (const b of this.bar.querySelectorAll('[data-win]')) {
      const on = this.isOpen(b.dataset.win);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    document.body.classList.toggle('window-open', this.open.length > 0);
  }

  create(w) {
    const el = document.createElement('section');
    el.className = `win win-${w.id}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', w.title);
    el.innerHTML = `
      <header class="win-head">
        <span class="win-glyph" aria-hidden="true">${svgIcon(w.id)}</span>
        <h2>${esc(w.title)}</h2>
        <span class="win-sub"></span>
        <button type="button" class="icon-btn win-close" aria-label="Close ${esc(w.title)}">✕</button>
      </header>
      <div class="win-body"></div>`;
    el.hidden = true;
    this.layer.appendChild(el);
    w.el = el;
    w.body = el.querySelector('.win-body');
    w.sub = el.querySelector('.win-sub');
    el.querySelector('.win-close').addEventListener('click', () => this.close(w.id));
    el.addEventListener('pointerdown', () => {
      if (this.top() !== w.id) {
        this.open = this.open.filter((x) => x !== w.id).concat(w.id);
        el.style.zIndex = String(++this.z);
      }
    });
    w.body.addEventListener('click', (e) => { if (w.onClick?.(e)) this.refresh(w, true); });
    w.body.addEventListener('change', (e) => { if (w.onChange?.(e)) this.refresh(w, true); });
    w.body.addEventListener('input', (e) => { if (w.onInput?.(e)) this.refresh(w, true); });
    this.makeDraggable(w, el.querySelector('.win-head'));
  }

  /** First position: cascaded from the top left of the map, inside the viewport. */
  place(w) {
    const el = w.el;
    if (isNarrow()) { el.style.left = el.style.top = ''; return; }
    if (!w.placed) {
      const i = [...this.windows.keys()].indexOf(w.id);
      el.style.left = `${24 + i * 36}px`;
      el.style.top = `${76 + i * 30}px`;
      w.placed = true;
    }
    requestAnimationFrame(() => this.clamp(el));
  }

  clamp(el) {
    if (isNarrow() || el.hidden) return;
    const r = el.getBoundingClientRect();
    const scale = r.width / el.offsetWidth || 1; // UI scale (CSS zoom)
    const maxX = window.innerWidth / scale - el.offsetWidth - 8;
    const maxY = window.innerHeight / scale - 80;
    el.style.left = `${Math.max(8, Math.min(parseFloat(el.style.left) || 0, maxX))}px`;
    el.style.top = `${Math.max(60, Math.min(parseFloat(el.style.top) || 0, maxY))}px`;
  }

  makeDraggable(w, handle) {
    let start = null;
    handle.addEventListener('pointerdown', (e) => {
      if (isNarrow() || e.target.closest('button')) return;
      const el = w.el;
      const scale = el.getBoundingClientRect().width / el.offsetWidth || 1;
      start = { x: e.clientX, y: e.clientY, left: parseFloat(el.style.left) || 0, top: parseFloat(el.style.top) || 0, scale };
      handle.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
    });
    handle.addEventListener('pointermove', (e) => {
      if (!start) return;
      w.el.style.left = `${start.left + (e.clientX - start.x) / start.scale}px`;
      w.el.style.top = `${start.top + (e.clientY - start.y) / start.scale}px`;
    });
    const end = () => {
      if (!start) return;
      start = null;
      w.el.classList.remove('dragging');
      this.clamp(w.el);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  onKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) {
      if (e.key !== 'Escape' || !this.open.length) return;
    }
    if (e.key === 'Escape' && this.open.length) {
      e.preventDefault();
      e.stopPropagation();
      this.close(this.top());
      return;
    }
    if (this.state.phase !== 'playing' || !document.getElementById('admin-panel').hidden) return;
    const w = [...this.windows.values()].find((x) => x.key === e.key.toLowerCase());
    if (w) { e.preventDefault(); this.toggle(w.id); }
  }

  /** Redraw if the window's structure changed, else update live numbers. */
  refresh(w, force = false) {
    const sig = w.signature();
    if (force || sig !== w.sig) {
      const scroll = w.body.scrollTop;
      w.render(w.body);
      w.body.scrollTop = scroll;
      w.sig = sig;
      if (w.subtitle) w.sub.textContent = w.subtitle();
    } else w.live?.(w.body);
  }

  update(dt) {
    if (!this.open.length) return;
    this.timer += dt;
    if (this.timer < 0.25) return;
    this.timer = 0;
    for (const id of this.open) this.refresh(this.windows.get(id));
  }
}
