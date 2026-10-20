/**
 * flags.js — Real flags where they exist, heraldry where they don't (step 6C).
 *
 * A nation's flag object comes from the era data, plus (world.js):
 *   flag.era    era id, picks the sprite sheet assets/flags-<era>.webp
 *   flag.real   tile in that sheet, or null when no flag is known for the date
 * Sheets load on first use. Until then a real flag shows as a plain neutral
 * placeholder (never a made-up flag), and every flag drawn into an on-screen
 * canvas is redrawn as soon as its sheet arrives.
 *
 * Nations without a known flag get a generated coat of arms on a heater
 * shield over a dark field, so it can't be mistaken for a real flag.
 */

import { FLAG_INDEX } from './flag-index.js';
import { loadImagery } from './assets.js';

const sheets = new Map();   // era → HTMLImageElement (loaded)
const loading = new Set();
const pending = [];         // draws waiting for a sheet: [ctx, transform, flag, x, y, w, h]
const listeners = new Set();
let version = 0;

/** Bumps whenever a sheet finishes loading (sprite caches key on it). */
export const flagsVersion = () => version;
export function onFlagsLoaded(fn) { listeners.add(fn); }

function sheet(era) {
  if (sheets.has(era)) return sheets.get(era);
  if (!loading.has(era) && FLAG_INDEX[era]) {
    loading.add(era);
    loadImagery(`flags-${era}`).then((img) => {
      sheets.set(era, img);
      version++;
      // Redraw what was drawn while waiting (only canvases still on the page).
      for (const [ctx, m, flag, x, y, w, h] of pending.splice(0)) {
        if (!ctx.canvas.isConnected) continue;
        ctx.save();
        ctx.setTransform(m);
        drawFlag(ctx, flag, x, y, w, h);
        ctx.restore();
      }
      for (const fn of listeners) fn(era);
    }).catch((err) => console.warn(`[flags] ${era}: ${err.message}`));
  }
  return null;
}

/** Start loading an era's flags early (on map load). */
export function preloadFlags(era) { sheet(era); }

/** Draw a nation's flag into any 2D context, filling (x, y, w, h). */
export function drawFlag(ctx, flag, x, y, w, h) {
  if (flag?.real != null) {
    const img = sheet(flag.era);
    const ix = FLAG_INDEX[flag.era];
    ctx.save();
    ctx.fillStyle = '#2a2f3a';
    ctx.fillRect(x, y, w, h);
    if (img) {
      const sx = (flag.real % ix.cols) * ix.tileW, sy = Math.floor(flag.real / ix.cols) * ix.tileH;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, ix.tileW, ix.tileH, x, y, w, h);
    } else if (ctx.canvas?.isConnected) {
      pending.push([ctx, ctx.getTransform(), flag, x, y, w, h]);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    return;
  }
  drawHeraldry(ctx, flag, x, y, w, h);
}

// --- Generated heraldry --------------------------------------------------------------

/** The heraldic tinctures; a nation's generated colours snap to the nearest. */
const TINCTURES = { or: '#e3b23c', argent: '#eef0f2', gules: '#c4202b', azure: '#2554a8', vert: '#2f8a3e', sable: '#1d1e22', purpure: '#71307e' };
const METALS = new Set(['or', 'argent']);

function hexRgb(hex) {
  const n = parseInt((hex ?? '#888888').slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function nearest(hex, allowed = Object.keys(TINCTURES)) {
  const [r, g, b] = hexRgb(hex);
  let best = allowed[0], bd = Infinity;
  for (const k of allowed) {
    const [r2, g2, b2] = hexRgb(TINCTURES[k]);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

/**
 * A heater shield on a dark ground: field from the nation's first colour, an
 * ordinary (fess, pale, cross, bend…) from its pattern in a contrasting
 * tincture — a metal on a colour or a colour on a metal, as heralds require.
 */
function drawHeraldry(ctx, flag, x, y, w, h) {
  const colors = flag?.colors ?? ['#2554a8', '#e3b23c', '#c4202b'];
  const field = nearest(colors[0]);
  // Rule of tincture: a colour on a metal, or a metal on a colour.
  const other = Object.keys(TINCTURES).filter((k) => METALS.has(k) !== METALS.has(field));
  const charge = nearest(colors[1], other);
  const F = TINCTURES[field], C = TINCTURES[charge];

  ctx.save();
  // Dark ground with a faint diaper, so the shield reads as "arms", not a flag.
  const bg = ctx.createLinearGradient(x, y, x, y + h);
  bg.addColorStop(0, '#3a3226');
  bg.addColorStop(1, '#1e1a14');
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  // Heater shield.
  const sh = h * 0.86, sw = sh * 0.82;
  const sx = x + (w - sw) / 2, sy = y + (h - sh) / 2;
  const shield = new Path2D();
  shield.moveTo(sx, sy);
  shield.lineTo(sx + sw, sy);
  shield.lineTo(sx + sw, sy + sh * 0.45);
  shield.quadraticCurveTo(sx + sw, sy + sh * 0.85, sx + sw / 2, sy + sh);
  shield.quadraticCurveTo(sx, sy + sh * 0.85, sx, sy + sh * 0.45);
  shield.closePath();
  ctx.save();
  ctx.clip(shield);
  ctx.fillStyle = F;
  ctx.fillRect(sx, sy, sw, sh);
  ctx.fillStyle = C;
  const cx = sx + sw / 2, cy = sy + sh * 0.42;
  switch (flag?.pattern) {
    case 'h3': ctx.fillRect(sx, sy + sh * 0.33, sw, sh * 0.26); break;                           // fess
    case 'v3': ctx.fillRect(cx - sw * 0.16, sy, sw * 0.32, sh); break;                           // pale
    case 'h2': ctx.fillRect(sx, sy, sw, sh * 0.32); break;                                       // chief
    case 'v2': ctx.fillRect(cx, sy, sw / 2, sh); break;                                          // per pale
    case 'cross': ctx.fillRect(cx - sw * 0.11, sy, sw * 0.22, sh); ctx.fillRect(sx, cy - sh * 0.1, sw, sh * 0.2); break;
    case 'canton': ctx.beginPath(); ctx.arc(cx, cy + sh * 0.04, sw * 0.24, 0, Math.PI * 2); ctx.fill(); break; // roundel
    case 'diag': ctx.translate(cx, cy); ctx.rotate(Math.PI / 4); ctx.fillRect(-sw, -sw * 0.13, sw * 2, sw * 0.26); break; // bend
    default: { // chevron
      ctx.beginPath(); ctx.moveTo(sx, sy + sh * 0.75); ctx.lineTo(cx, sy + sh * 0.3); ctx.lineTo(sx + sw, sy + sh * 0.75);
      ctx.lineTo(sx + sw, sy + sh * 0.95); ctx.lineTo(cx, sy + sh * 0.5); ctx.lineTo(sx, sy + sh * 0.95); ctx.fill();
    }
  }
  ctx.restore();
  ctx.lineWidth = Math.max(1, h * 0.05);
  ctx.strokeStyle = '#c9a04a';
  ctx.stroke(shield);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}
