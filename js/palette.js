/**
 * palette.js — Colour helpers shared by the map and the HUD.
 *
 * vivid() turns the muted, atlas-style nation colours of the era data into
 * saturated game colours while keeping each nation's hue (so France stays
 * blue and the USSR red) and evening out lightness so no nation is murky.
 */

function toHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function toHex(h, s, l) {
  const f = (k) => {
    const t = (k + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(t - 3, 9 - t, 1))));
  };
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const cache = new Map();
/** Saturated version of a nation colour (same hue). */
export function vivid(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex ?? '')) return hex;
  if (!cache.has(hex)) {
    const [h, s, l] = toHsl(hex);
    // Greys stay grey-ish; everything else gets a strong, clean saturation.
    const s2 = s < 0.08 ? s : Math.min(0.78, 0.44 + s * 0.7);
    const l2 = Math.max(0.42, Math.min(0.58, 0.48 + (l - 0.5) * 0.6));
    cache.set(hex, toHex(h, s2, l2));
  }
  return cache.get(hex);
}

/** Lighter / darker variant of a hex colour (amount −1..1). */
export function shade(hex, amount) {
  const [h, s, l] = toHsl(hex);
  return toHex(h, s, Math.max(0, Math.min(1, l + amount)));
}
