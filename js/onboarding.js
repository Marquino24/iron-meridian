/**
 * onboarding.js — What this player has already seen (step 12): whether the
 * tutorial was offered or finished, and which first-open tips were dismissed.
 *
 * Remembered per signed-in user on this device (localStorage
 * `im:onboard:<user id>`), so a second account on the same browser still gets
 * the tutorial offer and the tips.
 */

const PREFIX = 'im:onboard:';

export class Onboarding {
  constructor() {
    this.user = 'guest';
    this.data = {};
    this.load();
  }

  /** Switch to the signed-in user's record. */
  setUser(id) {
    this.user = id || 'guest';
    this.load();
  }

  load() {
    try { this.data = JSON.parse(localStorage.getItem(PREFIX + this.user) || '{}') ?? {}; } catch { this.data = {}; }
    this.data.tips ??= {};
  }

  save() {
    try { localStorage.setItem(PREFIX + this.user, JSON.stringify(this.data)); } catch { /* storage unavailable: this session only */ }
  }

  /** The tutorial was offered (taken or skipped): don't offer it again by itself. */
  get offered() { return !!this.data.offered; }
  get tutorialDone() { return !!this.data.done; }
  markOffered() { this.data.offered = true; this.save(); }
  markDone() { this.data.offered = this.data.done = true; this.save(); }

  tipSeen(id) { return !!this.data.tips[id]; }
  markTip(id) { this.data.tips[id] = true; this.save(); }

  /** Settings → "Show tips again". */
  resetTips() { this.data.tips = {}; this.save(); }
}
