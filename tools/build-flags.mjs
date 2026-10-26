/**
 * build-flags.mjs — Real flags → one WebP sprite sheet per era (step 6C).
 *
 *   python3 tools/fetch-commons-flags.py      (Wikimedia Commons files + licences → .cache/)
 *   node tools/build-flags.mjs                (needs Chromium for rendering)
 *
 * Sources per nation come from tools/flag-sources.mjs (flag-icons, Commons,
 * or drawn in tools/flag-custom.mjs). Writes:
 *   assets/flags-<era>.webp   180×120 tiles, 16 per row
 *   js/flag-index.js          nation name → tile, per era
 *   docs/FLAGS.md             every flag's source and licence, and the counts
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { FLAG_SOURCES, COLONY_FLAGS } from './flag-sources.mjs';
import { CUSTOM_FLAGS } from './flag-custom.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ERAS = ['rome', 'medieval', 'ww1', 'ww2', 'coldwar', 'modern'];
const TILE_W = 180, TILE_H = 120, COLS = 16;
const FI_VERSION = '7.6.0';

// flag-icons (MIT): fetched with npm into the cache once.
const fiDir = join(root, '.cache', 'flags', 'flag-icons');
if (!existsSync(join(fiDir, 'package', 'flags', '4x3'))) {
  mkdirSync(fiDir, { recursive: true });
  execFileSync('npm', ['pack', `flag-icons@${FI_VERSION}`, '--pack-destination', fiDir], { stdio: 'inherit' });
  execFileSync('tar', ['-xzf', join(fiDir, `flag-icons-${FI_VERSION}.tgz`), '-C', fiDir]);
}
const fiCountries = JSON.parse(readFileSync(join(fiDir, 'package', 'country.json'), 'utf8'));
const fiByName = new Map(fiCountries.map((c) => [c.name.toLowerCase(), c.code]));
const fiName = new Map(fiCountries.map((c) => [c.code, c.name]));
const fiLicense = readFileSync(join(fiDir, 'package', 'LICENSE'), 'utf8').trim();

const wcDir = join(root, '.cache', 'flags', 'commons');
const wcMeta = existsSync(join(wcDir, 'meta.json')) ? JSON.parse(readFileSync(join(wcDir, 'meta.json'), 'utf8')) : {};

/** Source spec → { key, svg, aspect, stretch, credit } or null if unavailable. */
function load(spec) {
  const src = spec.replace(/^(col|ens):/, '');
  if (src.startsWith('fi:')) {
    const code = src.slice(3);
    const file = join(fiDir, 'package', 'flags', '4x3', `${code}.svg`);
    if (!existsSync(file)) return null;
    return { key: src, svg: readFileSync(file, 'utf8'), stretch: true, credit: { source: `flag-icons ${FI_VERSION}: ${code}.svg (${fiName.get(code) ?? code})`, license: 'MIT' } };
  }
  if (src.startsWith('wc:')) {
    const m = wcMeta[src.slice(3)];
    if (!m || !existsSync(join(wcDir, m.file))) return null;
    if (m.file.endsWith('.png')) {
      // Commons' own PNG rendering (used when the SVG original was refused).
      const buf = readFileSync(join(wcDir, m.file));
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
      return { key: src, png: `data:image/png;base64,${buf.toString('base64')}`, w, h, aspect: w / h, stretch: 'auto', credit: { source: `Wikimedia Commons: ${m.canonical} (PNG rendering)`, url: m.page, license: m.licenses.join(', ') || 'see page', licenseUrl: (m.licenseLinks ?? [])[0], author: m.author } };
    }
    if (!readFileSync(join(wcDir, m.file), 'utf8').slice(0, 4000).includes('<svg')) return null; // an error page, not the file
    return { key: src, svg: readFileSync(join(wcDir, m.file), 'utf8'), stretch: 'auto', credit: { source: `Wikimedia Commons: ${m.canonical}`, url: m.page, license: m.licenses.join(', ') || 'see page', licenseUrl: (m.licenseLinks ?? [])[0], author: m.author } };
  }
  if (src.startsWith('own:')) {
    const svg = CUSTOM_FLAGS[src.slice(4)];
    if (!svg) return null;
    return { key: src, svg, stretch: true, credit: { source: 'Drawn for Iron Meridian (tools/flag-custom.mjs)', license: 'same as the game' } };
  }
  return null;
}

/** Intrinsic aspect ratio of an SVG (width/height attributes, else the viewBox). */
function aspectOf(svg) {
  const head = svg.slice(0, 2000);
  const vb = head.match(/viewBox\s*=\s*["']\s*([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)/i);
  const w = head.match(/<svg[^>]*\swidth\s*=\s*["']([\d.]+)(px)?["']/i), h = head.match(/<svg[^>]*\sheight\s*=\s*["']([\d.]+)(px)?["']/i);
  if (w && h) return { aspect: Number(w[1]) / Number(h[1]), w: Number(w[1]), h: Number(h[1]) };
  if (vb) return { aspect: Number(vb[3]) / Number(vb[4]), w: Number(vb[3]), h: Number(vb[4]) };
  return { aspect: 1.5, w: 300, h: 200 };
}

/** Make sure the SVG renders at a known pixel size inside an <img>. */
function sized(svg, w, h, ow, oh) {
  return svg.replace(/<svg\b([^>]*)>/i, (all, attrs) => {
    let a = attrs.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, '');
    // No viewBox: the drawing's own coordinates are its width × height.
    if (!/viewBox/i.test(a)) a += ` viewBox="0 0 ${ow} ${oh}" preserveAspectRatio="none"`;
    return `<svg${a} width="${w}" height="${h}">`;
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

const index = {};
const credits = new Map(); // key → credit + eras/nations
const counts = {};
for (const era of ERAS) {
  const data = JSON.parse(readFileSync(join(root, 'data', 'eras', `${era}.json`), 'utf8'));
  const table = FLAG_SOURCES[era] ?? {};
  const tiles = [];          // unique sources in order
  const tileOf = new Map();  // key → tile index
  const nations = {};
  const c = { own: 0, col: 0, ens: 0, generated: 0, missing: [] };
  const tileFor = (got) => {
    if (!tileOf.has(got.key)) {
      const { aspect, w, h } = got.png ? got : aspectOf(got.svg);
      tileOf.set(got.key, tiles.length);
      tiles.push({ ...got, aspect, w, h });
    }
    return tileOf.get(got.key);
  };
  for (const n of data.nations) {
    let specs = table[n.name] ?? (era === 'modern' && fiByName.has(n.name.toLowerCase()) ? `fi:${fiByName.get(n.name.toLowerCase())}` : null);
    specs = specs == null ? [] : Array.isArray(specs) ? specs : [specs];
    let got = null, spec = null;
    for (const s of specs) { got = load(s); if (got) { spec = s; break; } }
    if (!got) {
      c.generated++;
      if (specs.length) c.missing.push(`${n.name} (${specs.join(' / ')} unavailable)`);
      continue;
    }
    const colonial = spec.startsWith('col:'), ensign = spec.startsWith('ens:');
    const tile = tileFor(got);
    nations[n.name] = colonial ? [tile, 1] : ensign ? [tile, 2] : tile;
    colonial ? c.col++ : ensign ? c.ens++ : c.own++;
    const cr = credits.get(got.key) ?? { ...got.credit, used: [] };
    cr.used.push(`${era}: ${n.name}${colonial ? ' (sovereign’s flag)' : ensign ? ' (colonial flag)' : ''}`);
    credits.set(got.key, cr);
  }
  // Colonies inside their sovereign on the map: their own colonial flags.
  const colonies = {};
  for (const [name, spec] of Object.entries(COLONY_FLAGS[era] ?? {})) {
    const got = load(spec);
    if (!got) { c.missing.push(`${name} (colonial flag ${spec} unavailable)`); continue; }
    colonies[name] = tileFor(got);
    c.ens++;
    const cr = credits.get(got.key) ?? { ...got.credit, used: [] };
    cr.used.push(`${era}: ${name} (colonial flag)`);
    credits.set(got.key, cr);
  }
  counts[era] = { total: data.nations.length, ...c };
  if (!tiles.length) continue;

  // Render the tiles into one sheet in the browser and encode WebP there.
  const rows = Math.ceil(tiles.length / COLS);
  const payload = tiles.map((t) => {
    // Fill the 3:2 tile: stretch flags whose shape is near 3:2 (or 4:3 flag-icons
    // redraws); flags far from it (Nepal, Switzerland, Vatican…) keep their shape.
    const fill = t.stretch === true ? (t.aspect > 1.2) : (t.aspect >= 1.3 && t.aspect <= 2.05);
    const scale = 4;
    const src = t.png ?? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized(t.svg, Math.round(t.aspect * 120 * scale), 120 * scale, t.w, t.h))}`;
    return { src, fill, aspect: t.aspect };
  });
  const webp = await page.evaluate(async ({ payload, TILE_W, TILE_H, COLS, rows }) => {
    const canvas = document.createElement('canvas');
    canvas.width = TILE_W * COLS;
    canvas.height = TILE_H * rows;
    const g = canvas.getContext('2d');
    g.imageSmoothingQuality = 'high';
    const failed = [];
    for (let i = 0; i < payload.length; i++) {
      const p = payload[i];
      const img = new Image();
      img.src = p.src;
      try { await img.decode(); } catch { failed.push(i); continue; }
      const x = (i % COLS) * TILE_W, y = Math.floor(i / COLS) * TILE_H;
      if (p.fill) g.drawImage(img, x, y, TILE_W, TILE_H);
      else {
        // Keep the shape, centred; the game frames it on a neutral field.
        const s = Math.min(TILE_W / (TILE_H * p.aspect), 1);
        const w = TILE_H * p.aspect * s, h = TILE_H * s;
        g.drawImage(img, x + (TILE_W - w) / 2, y + (TILE_H - h) / 2, w, h);
      }
    }
    return { url: canvas.toDataURL('image/webp', 0.86), failed };
  }, { payload, TILE_W, TILE_H, COLS, rows });
  if (webp.failed.length) console.warn(`${era}: ${webp.failed.length} flags failed to render: ${webp.failed.map((i) => tiles[i].key).join(', ')}`);
  writeFileSync(join(root, 'assets', `flags-${era}.webp`), Buffer.from(webp.url.split(',')[1], 'base64'));
  index[era] = { cols: COLS, tileW: TILE_W, tileH: TILE_H, nations, colonies };
}
await browser.close();

// --- js/flag-index.js -------------------------------------------------------------
writeFileSync(join(root, 'js', 'flag-index.js'), `/**
 * flag-index.js — GENERATED by tools/build-flags.mjs; do not edit.
 *
 * Per era: nation name → tile in assets/flags-<era>.webp (a number), or
 * [tile, 1] when the nation flies its sovereign's flag (colonies), [tile, 2]
 * when it flies its own colonial flag. \`colonies\`: colonies that are part of
 * their sovereign on the map → tile of their colonial flag (js/colonies.js).
 * Nations not listed have no known flag for that date and get a heraldic shield.
 */

export const FLAG_INDEX = ${JSON.stringify(index)};
`);

// --- docs/FLAGS.md -------------------------------------------------------------------
const lines = ['# Flags', '', 'Generated by `tools/build-flags.mjs`. Every real flag in the game, where it comes from, and its licence.', ''];
lines.push('## Per era', '', '| Era | Nations | Own real flag or banner | Sovereign’s flag (colony) | Colonial flag (colony) | Generated heraldry |', '|---|---|---|---|---|---|');
for (const era of ERAS) { const c = counts[era]; lines.push(`| ${era} | ${c.total} | ${c.own} | ${c.col} | ${c.ens} | ${c.generated} |`); }
lines.push('', 'Nations with no known flag or banner for that date get a generated heraldic shield, drawn so it does not pass for a real flag.', '');
lines.push('WWII: the German Reich flies the black-white-red tricolour (its 1933–35 national flag), not the swastika flag, which is illegal to display in Germany and avoided by commercial WWII games.', '');
const missing = ERAS.flatMap((e) => counts[e].missing.map((m) => `- ${e}: ${m}`));
if (missing.length) lines.push('### Wanted but not available (generated instead)', '', ...missing, '');
lines.push('## Sources', '');
lines.push('- **flag-icons** by Panayiotis Lipiridis, https://github.com/lipis/flag-icons — MIT licence (below).');
lines.push('- **Wikimedia Commons** files, each with the licence stated on its page (listed below). Most are in the public domain; the few under CC BY-SA or similar keep that licence in the rendered sprite sheets (the tile is an adaptation), with the author and link given below.');
lines.push('- **Drawn for this game**: Roman vexillum, Han banner, simple medieval banners of arms, and three colonial flags: British India\'s Star of India ensign (badge simplified: rays, garter and star, without the motto), the Belgian Congo\'s blue flag with a gold star, French Indochina\'s yellow flag with the tricolour canton (tools/flag-custom.mjs).', '');
lines.push('Colonial flags (step 7B): major colonies fly their own colonial flag where one existed: separate colony nations listed above, and colonies that are part of their sovereign on the map (British India and the Belgian Congo in 1914 and 1938), whose provinces, garrisons and locally raised armies show it. Minor colonies keep the ruler\'s flag.', '');
lines.push('| Flag | Licence | Author | Used for |', '|---|---|---|---|');
for (const cr of [...credits.values()].sort((a, b) => a.source.localeCompare(b.source))) {
  const name = cr.url ? `[${cr.source}](${cr.url})` : cr.source;
  const lic = cr.licenseUrl ? `[${cr.license}](${cr.licenseUrl})` : cr.license;
  lines.push(`| ${name} | ${lic} | ${(cr.author ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ')} | ${cr.used.join('; ')} |`);
}
lines.push('', '## flag-icons licence', '', '```', fiLicense, '```', '');
mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs', 'FLAGS.md'), lines.join('\n'));

for (const era of ERAS) {
  const c = counts[era];
  console.log(`${era.padEnd(9)} ${String(c.total).padStart(3)} nations: ${c.own} own flag, ${c.col} sovereign's flag, ${c.ens} colonial flag, ${c.generated} generated${c.missing.length ? ` (${c.missing.length} wanted but unavailable)` : ''}`);
}
