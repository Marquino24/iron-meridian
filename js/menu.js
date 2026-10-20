/**
 * menu.js — Screen flow after sign-in.
 *
 *   MAIN MENU → Single Player → ERA → NATION → game
 *             → Sandbox       → ERA → NATION → sandbox game (free tools)
 *             → Settings
 *
 * Exactly one screen is visible at a time; Back always goes one step up.
 * The map keeps running behind every screen (it pans slowly on the menu).
 */

import { QUALITIES, deviceClass } from './settings.js';

const SCREENS = { menu: '#main-menu', era: '#era-screen', nation: '#start-screen', settings: '#settings-screen' };
const PARENT = { era: 'menu', nation: 'era', settings: null, menu: null };

export class Screens {
  /**
   * @param {object} opts
   * @param {import('./settings.js').Settings} opts.settings
   * @param {{ resume(): void, signOut(): void, enterGame(): void }} opts.actions
   */
  constructor({ settings, actions }) {
    this.settings = settings;
    this.actions = actions;
    this.current = null;
    this.returnTo = 'menu';
    this.gameInProgress = false;
    this.mode = 'single';
    this.el = Object.fromEntries(Object.entries(SCREENS).map(([k, sel]) => [k, document.querySelector(sel)]));

    document.querySelector('#main-menu .menu-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-menu]');
      if (!b || b.disabled) return;
      const a = b.dataset.menu;
      if (a === 'single' || a === 'sandbox') this.setMode(a);
      if (a === 'single' || a === 'sandbox') this.show('era');
      if (a === 'settings') this.show('settings');
      if (a === 'resume') this.actions.resume();
      if (a === 'signout') this.actions.signOut();
    });
    for (const b of document.querySelectorAll('[data-back]')) b.addEventListener('click', () => this.back());
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.target instanceof HTMLInputElement) return;
      if (!document.getElementById('admin-panel').hidden) return;
      if (this.current && this.current !== 'menu' && this.current !== 'game') { e.preventDefault(); this.back(); }
    });
    this.bindSettings();
  }

  /** 'single' or 'sandbox': which kind of game the era → nation screens start. */
  setMode(mode) {
    this.mode = mode;
    document.body.dataset.mode = mode;
    for (const el of document.querySelectorAll('.mode-label')) el.textContent = mode === 'sandbox' ? 'SANDBOX' : 'SINGLE PLAYER';
  }

  /** Show a screen: 'menu' | 'era' | 'nation' | 'settings' | 'game' | null (launcher). */
  show(name) {
    if (name === 'settings' && this.current !== 'settings') this.returnTo = this.current ?? 'menu';
    this.current = name;
    for (const [k, el] of Object.entries(this.el)) el.hidden = k !== name;
    document.body.dataset.screen = name ?? 'launcher';
    const resume = document.querySelector('[data-menu="resume"]');
    resume.hidden = !this.gameInProgress;
    if (name === 'settings') this.renderSettings();
    // Move focus into the new screen for keyboard users.
    const first = name && this.el[name]?.querySelector('[data-menu="resume"]:not([hidden]), .menu-item.primary, .back-btn');
    first?.focus({ preventScroll: true });
  }

  back() {
    const parent = this.current === 'settings' ? this.returnTo : PARENT[this.current];
    if (parent) this.show(parent);
  }

  /** The map pans by itself on these screens. */
  get ambient() { return this.current === 'menu' || this.current === 'era' || this.current === 'settings'; }

  // --- Settings ----------------------------------------------------------------

  bindSettings() {
    const form = document.getElementById('settings-form');
    form.addEventListener('change', (e) => {
      const t = e.target;
      if (t.name === 'mapStyle') this.settings.set('mapStyle', t.value);
      if (t.name === 'quality') this.settings.set('quality', t.value);
      this.renderSettings();
    });
    form.addEventListener('input', (e) => {
      const t = e.target;
      if (t.name === 'uiScale') this.settings.set('uiScale', Number(t.value));
      if (t.name === 'volume') this.settings.set('volume', Number(t.value));
      this.renderSettings();
    });
    document.getElementById('settings-reset').addEventListener('click', () => {
      this.settings.reset();
      this.renderSettings();
    });
  }

  renderSettings() {
    const s = this.settings;
    document.getElementById(`set-style-${s.mapStyle}`).checked = true;
    for (const q of QUALITIES) document.getElementById(`set-q-${q}`).checked = s.quality === q;
    const device = { phone: 'phone', tablet: 'tablet', desktop: 'computer' }[deviceClass()];
    document.getElementById('quality-note').textContent = s.qualityIsAuto
      ? `Picked automatically for this ${device}, and lowered by itself if the map gets choppy. Low keeps phones and older tablets smooth.`
      : 'Low keeps phones and older tablets smooth.';
    const scale = document.getElementById('set-ui-scale');
    scale.value = s.values.uiScale;
    document.getElementById('ui-scale-out').textContent = `${s.values.uiScale}%`;
    const vol = document.getElementById('set-volume');
    vol.value = s.values.volume;
    document.getElementById('volume-out').textContent = `${s.values.volume}%`;
  }
}
