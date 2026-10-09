/**
 * settings.js — Player settings, saved per device (localStorage).
 *
 * Graphics quality defaults by device: Low on phones, Medium on tablets,
 * High elsewhere. A saved choice always wins.
 */

const KEY = 'im:settings';

export const STYLES = ['political', 'satellite', 'terrain'];
export const QUALITIES = ['low', 'medium', 'high'];

/** 'phone' | 'tablet' | 'desktop' from pointer type and screen size. */
export function deviceClass() {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const shortSide = Math.min(screen.width, screen.height);
  if (coarse && shortSide < 600) return 'phone';
  if (coarse) return 'tablet';
  return 'desktop';
}

export function autoQuality() {
  return { phone: 'low', tablet: 'medium', desktop: 'high' }[deviceClass()];
}

export const DEFAULTS = () => ({ mapStyle: 'political', quality: null, uiScale: 100, volume: 70 });

export class Settings {
  constructor() {
    this.values = DEFAULTS();
    this.listeners = new Set();
    try {
      Object.assign(this.values, JSON.parse(localStorage.getItem(KEY) || '{}'));
    } catch { /* storage unavailable: use defaults */ }
    if (!STYLES.includes(this.values.mapStyle)) this.values.mapStyle = 'political';
    if (!QUALITIES.includes(this.values.quality)) this.values.quality = null;
  }

  get mapStyle() { return this.values.mapStyle; }
  /** Effective quality: the saved choice, or the device default. */
  get quality() { return this.values.quality ?? autoQuality(); }
  get qualityIsAuto() { return this.values.quality == null; }
  get uiScale() { return this.values.uiScale / 100; }
  get volume() { return this.values.volume / 100; }

  set(key, value) {
    this.values[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch { /* ignore */ }
    for (const fn of this.listeners) fn(key, value);
  }

  reset() {
    const d = DEFAULTS();
    for (const k of Object.keys(d)) this.set(k, d[k]);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
