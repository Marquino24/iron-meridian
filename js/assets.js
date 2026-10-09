/**
 * assets.js — Map imagery (satellite, terrain), loaded only when a style
 * needs it. The single-file build embeds each image as a data URI in
 * <script type="text/plain" id="asset-<name>">; the multi-file project loads
 * assets/<name>.webp.
 */

const cache = new Map();

export function loadImagery(name) {
  if (cache.has(name)) return cache.get(name);
  const embedded = document.getElementById(`asset-${name}`);
  const src = embedded ? embedded.textContent.trim() : `assets/${name}.webp`;
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${name} imagery`));
    img.src = src;
  });
  cache.set(name, p);
  return p;
}
