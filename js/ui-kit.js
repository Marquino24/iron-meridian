/**
 * ui-kit.js — Small helpers shared by the HUD panels and command windows.
 */

import { RESOURCES } from './resources.js';

/** Game hours as "14h" or "2d 3h". */
export const fmtHours = (h) => {
  if (!isFinite(h)) return '—';
  const r = Math.max(0, Math.round(h));
  if (r < 24) return `${r}h`;
  const d = Math.floor(r / 24), hh = r % 24;
  return hh ? `${d}d ${hh}h` : `${d}d`;
};

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function fmtNum(v) {
  const n = Math.floor(v);
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return n.toLocaleString('en-US');
}

export const ROMAN = ['0', 'I', 'II', 'III'];
export const ROLE_LABEL = { inf: 'Infantry', mob: 'Mobile', rng: 'Ranged', nav: 'Naval' };
export const ROLE_GLYPH = { inf: '✕', mob: '⬭', rng: '●', nav: '⛴' };
export const BEATS = { inf: 'mob', mob: 'rng', rng: 'inf' };

/**
 * Cost as icon + amount chips, in the era's resource order. Amounts the
 * stock can't cover are marked `.short`.
 * @param {object} cost
 * @param {object|null} stock
 * @param {{ keys:string[], labels:object }} set
 */
export function costHtml(cost, stock, set) {
  return set.keys.filter((k) => cost[k]).map((k) => {
    const r = RESOURCES[k];
    const short = stock && (stock[k] ?? 0) < cost[k];
    return `<span class="cost-chip${short ? ' short' : ''}" title="${esc(set.labels[k])}"><i style="color:${r.color}">${r.icon}</i>${fmtNum(cost[k])}</span>`;
  }).join('');
}

/** Progress bar markup; `live` is a data attribute name/value for in-place updates. */
export const bar = (frac, live = '') => `<span class="progress"><i ${live} style="width:${(Math.max(0, Math.min(1, frac)) * 100).toFixed(0)}%"></i></span>`;

export const isNarrow = () => window.innerWidth <= 760;
