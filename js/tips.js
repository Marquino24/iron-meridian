/**
 * tips.js — First-open tips (step 12): a short note at the top of the Army,
 * Production, Buildings, Research, Diplomacy and Peace windows the first time
 * each opens. "Got it" dismisses it for good (remembered per user, see
 * onboarding.js); Settings → "Show tips again" brings them back.
 * Tips stay quiet during the tutorial, which has its own coach.
 */

import { esc } from './ui-kit.js';

export const TIPS = {
  army: 'Every army and fleet you own. Tap a row to select that army, then tap the map to send it somewhere.',
  production: 'Recruit in many cities at once: pick a unit, tick the cities, then press Recruit. For one city, tap it on the map instead.',
  buildings: 'Your cities and their buildings. Tap a cell to see what a building does and upgrade it.',
  research: 'Pick a tech, then press Research now. When a research slot is free, a number shows on the Research button.',
  diplomacy: 'Every nation you have met, and what they think of you. Pick one to propose treaties, trade or declare war.',
  peace: 'Tick the provinces you want to keep. Each costs war score; the chance below shows how likely they are to accept.',
};

export class Tips {
  constructor(onboarding) {
    this.onboarding = onboarding;
    this.quiet = false; // true during the tutorial
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tip-ok]');
      if (!b) return;
      this.onboarding.markTip(b.dataset.tipOk);
      b.closest('.first-tip')?.remove();
    });
  }

  /** Should this tip show now? */
  wants(id) { return !this.quiet && !!TIPS[id] && !this.onboarding.tipSeen(id); }

  /** The tip's markup, or '' once it's been dismissed. */
  html(id) {
    if (!this.wants(id)) return '';
    return `<div class="first-tip" role="note" data-tip="${id}"><span class="ft-badge" aria-hidden="true">TIP</span><p>${esc(TIPS[id])}</p><button type="button" class="btn small" data-tip-ok="${id}">Got it</button></div>`;
  }

  /** Put the tip into `parent` before `before` (once). */
  insert(id, parent, before = null) {
    if (parent.querySelector(`.first-tip[data-tip="${id}"]`)) return;
    const html = this.html(id);
    if (!html) return;
    const t = document.createElement('template');
    t.innerHTML = html;
    parent.insertBefore(t.content.firstChild, before);
  }
}
