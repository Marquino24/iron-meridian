/**
 * render-fx.js — Map effects around the cached static layer: the ocean (baked
 * into the layer) with moving wave crests, drifting clouds, and the city and
 * capital badges (pre-rendered sprites, so a full screen of cities costs one
 * drawImage each).
 *
 * Every texture is generated in code. Effects follow the graphics quality:
 * Low draws them once, frozen (no crests); Medium animates at ~12 fps; High at ~30 fps.
 */

import { drawIcon } from './icons.js';
import { pickProvince } from './map.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function seeded(seed) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

/** 256 px tile of soft wave crests, transparent between them. */
function waveTile() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rand = seeded(424242);
  g.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const x = rand() * S, y = rand() * S, w = 10 + rand() * 22;
    g.strokeStyle = `rgba(190,235,255,${0.1 + rand() * 0.14})`;
    g.lineWidth = 1 + rand() * 0.8;
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        g.beginPath();
        g.moveTo(x + dx - w / 2, y + dy);
        g.quadraticCurveTo(x + dx, y + dy - 3.5, x + dx + w / 2, y + dy);
        g.stroke();
      }
    }
  }
  return c;
}

/** 512 px tile of soft clouds (white with transparent gaps). */
function cloudTile() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rand = seeded(9001);
  for (let k = 0; k < 9; k++) {
    // A cloud bank: a cluster of overlapping soft puffs.
    const cx = rand() * S, cy = rand() * S, spread = 40 + rand() * 70;
    for (let i = 0; i < 16; i++) {
      const x = cx + (rand() - 0.5) * spread * 2, y = cy + (rand() - 0.5) * spread * 0.9;
      const r = 14 + rand() * 34;
      for (const dx of [-S, 0, S]) {
        for (const dy of [-S, 0, S]) {
          const grd = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
          grd.addColorStop(0, 'rgba(255,255,255,0.55)');
          grd.addColorStop(0.55, 'rgba(255,255,255,0.28)');
          grd.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = grd;
          g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
        }
      }
    }
  }
  return c;
}

export class MapFx {
  constructor(renderer) {
    this.r = renderer;
    this.sprites = new Map();
  }

  /** Effect clock: frozen on Low so nothing moves (and nothing forces redraws). */
  time(animFps) {
    return animFps ? performance.now() / 1000 : 0;
  }

  /**
   * Sea sample points for the moving wave crests, on a world grid (built once
   * per map). Each cell holds one jittered point if it falls on open sea.
   */
  crestGrid(map) {
    if (this.crests?.map === map) return this.crests;
    const step = Math.max(map.width, map.height) / 240;
    const cols = Math.ceil(map.width / step), rows = Math.ceil(map.height / step);
    const xs = new Float32Array(cols * rows), ys = new Float32Array(cols * rows), seed = new Float32Array(cols * rows);
    const rand = seeded(77);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const x = (c + 0.2 + rand() * 0.6) * step, y = (r + 0.2 + rand() * 0.6) * step;
        seed[i] = rand();
        xs[i] = pickProvince(map, x, y) < 0 ? x : NaN;
        ys[i] = y;
      }
    }
    this.crests = { map, step, cols, rows, xs, ys, seed };
    return this.crests;
  }

  /**
   * Screen space, over the cached layer: short wave crests that drift and
   * fade in and out on the open sea. Only the cells in view are visited, and
   * sparser ones when zoomed out, so a frame costs a few hundred tiny strokes.
   */
  drawCrests(ctx, animFps) {
    const r = this.r, cam = r.camera, map = r.state.map;
    const G = this.crestGrid(map);
    const t = this.time(animFps);
    const z = cam.zoom;
    const cellPx = G.step * z;
    const stride = Math.max(1, Math.ceil(34 / cellPx));
    const v = r.viewRect(20);
    const c0 = Math.max(0, Math.floor(v.x0 / G.step)), c1 = Math.min(G.cols - 1, Math.floor(v.x1 / G.step));
    const r0 = Math.max(0, Math.floor(v.y0 / G.step)), r1 = Math.min(G.rows - 1, Math.floor(v.y1 / G.step));
    const len = clamp(cellPx * stride * 0.32, 5, 16);
    const paths = [new Path2D(), new Path2D(), new Path2D()];
    const ox = cam.viewW / 2 - cam.x * z, oy = cam.viewH / 2 - cam.y * z;
    for (let row = r0 - (r0 % stride); row <= r1; row += stride) {
      for (let col = c0 - (c0 % stride); col <= c1; col += stride) {
        const i = row * G.cols + col;
        const wx = G.xs[i];
        if (Number.isNaN(wx)) continue;
        const ph = (t * 0.3 + G.seed[i]) % 1;
        const a = Math.sin(ph * Math.PI);
        if (a < 0.25) continue;
        const x = wx * z + ox + (ph - 0.5) * 8, y = G.ys[i] * z + oy;
        const w = len * (0.7 + G.seed[i] * 0.6);
        const p = paths[a > 0.8 ? 2 : a > 0.55 ? 1 : 0];
        p.moveTo(x - w / 2, y);
        p.quadraticCurveTo(x, y - w * 0.22, x + w / 2, y);
      }
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.4;
    ['rgba(200,240,255,0.14)', 'rgba(200,240,255,0.26)', 'rgba(215,245,255,0.4)'].forEach((c, k) => { ctx.strokeStyle = c; ctx.stroke(paths[k]); });
  }

  /**
   * World space, into the cached map layer: the ocean. One fill: a gradient on
   * Low; an opaque tile of water with still wave crests on Medium and High
   * (a single 1:1 pattern pass costs about as much as a plain fill).
   */
  bakeOcean(ctx, map, colors, effects, zoom) {
    if (!effects) {
      if (!this.bakedGrad || this.bakedH !== map.height) {
        this.bakedH = map.height;
        this.bakedGrad = ctx.createLinearGradient(0, 0, 0, map.height);
        this.bakedGrad.addColorStop(0, colors.ocean);
        this.bakedGrad.addColorStop(1, colors.oceanDeep);
      }
      ctx.fillStyle = this.bakedGrad;
      ctx.fillRect(0, 0, map.width, map.height);
      return;
    }
    // The tile is pre-scaled to layer pixels so the fill maps 1:1 (no resampling).
    const cam = this.r.camera;
    const dpr = ctx.getTransform().a / zoom;
    const k = clamp(Math.sqrt(zoom / cam.refZoom) * 0.8, 0.5, 2.2);
    const size = Math.max(64, Math.round(256 * k * dpr));
    if (!this.bakedWaves || this.bakedSize !== size) {
      const tile = document.createElement('canvas');
      tile.width = tile.height = size;
      const g = tile.getContext('2d');
      g.fillStyle = colors.ocean;
      g.fillRect(0, 0, size, size);
      g.drawImage(waveTile(), 0, 0, size, size);
      this.bakedWaves = ctx.createPattern(tile, 'repeat');
      this.bakedSize = size;
    }
    this.bakedWaves.setTransform(new DOMMatrix().scale(1 / (zoom * dpr)));
    ctx.fillStyle = this.bakedWaves;
    ctx.fillRect(0, 0, map.width, map.height);
  }

  /** Screen space: world-anchored clouds that thin out as you zoom in. */
  drawClouds(ctx, animFps, effects, strength = 1) {
    const cam = this.r.camera;
    const provincePx = this.r.state.map.provinceScale * cam.zoom;
    const alpha = clamp((110 - provincePx) / 70, 0, 1) * 0.6 * strength;
    if (alpha <= 0.02) return;
    const t = this.time(animFps);
    const dpr = this.r.dpr;
    // Scale in steps so the tile can be pre-rendered at device size: the fill is
    // then a 1:1 copy (no resampling), and shadows are baked into the same tile.
    const k = clamp(Math.pow(cam.zoom / cam.refZoom, 0.6) * 0.75, 0.45, 3);
    const kq = Math.exp(Math.round(Math.log(k) * 6) / 6);
    const pat = this.cloudPattern(ctx, Math.round(512 * kq * dpr), effects);
    // Slight parallax: clouds sit above the ground, so they slide a little faster.
    const ox = cam.viewW / 2 - cam.x * cam.zoom * 1.06 + t * 9, oy = cam.viewH / 2 - cam.y * cam.zoom * 1.06 + t * 2;
    pat.setTransform(new DOMMatrix().translate(Math.round(ox * dpr) / dpr, Math.round(oy * dpr) / dpr).scale(1 / dpr));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    ctx.restore();
  }

  /**
   * World space, into the cached map layer (Low and Medium): the same clouds,
   * still. Costs nothing per frame; they only change when the layer is redrawn.
   */
  bakeClouds(ctx, F, effects, strength = 1) {
    const cam = this.r.camera;
    const provincePx = this.r.state.map.provinceScale * F.zoom;
    const alpha = clamp((110 - provincePx) / 70, 0, 1) * 0.6 * strength;
    if (alpha <= 0.02) return;
    const k = clamp(Math.pow(F.zoom / cam.refZoom, 0.6) * 0.75, 0.45, 3);
    const kq = Math.exp(Math.round(Math.log(k) * 6) / 6);
    const pat = this.cloudPattern(ctx, Math.round(512 * kq * F.dpr), effects);
    pat.setTransform(new DOMMatrix().scale(1 / (F.zoom * F.dpr)));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pat;
    const map = this.r.state.map;
    ctx.fillRect(0, 0, map.width, map.height);
    ctx.restore();
  }

  /** Cloud tile at `size` device px, with ground shadows when effects are on (cached). */
  cloudPattern(ctx, size, shadows) {
    const key = `${size}|${shadows}`;
    this.cloudPats ??= new Map();
    if (!this.cloudPats.has(key)) {
      if (this.cloudPats.size > 12) this.cloudPats.clear();
      this.cloudBase ??= cloudTile();
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      if (shadows) {
        const sh = document.createElement('canvas');
        sh.width = sh.height = size;
        const sg = sh.getContext('2d');
        sg.drawImage(this.cloudBase, 0, 0, size, size);
        sg.globalCompositeOperation = 'source-in';
        sg.fillStyle = 'rgb(0,12,30)';
        sg.fillRect(0, 0, size, size);
        g.globalAlpha = 0.4;
        const dx = Math.round(size * 0.025), dy = Math.round(size * 0.035);
        for (const ax of [-size, 0]) for (const ay of [-size, 0]) g.drawImage(sh, dx + ax, dy + ay);
        g.globalAlpha = 1;
      }
      g.drawImage(this.cloudBase, 0, 0, size, size);
      this.cloudPats.set(key, ctx.createPattern(c, 'repeat'));
    }
    return this.cloudPats.get(key);
  }

  /** Cached sprite drawn by `paint(g, w, h)` at device resolution. */
  sprite(key, w, h, paint) {
    const dpr = this.r.dpr;
    const k = `${key}|${dpr}`;
    let c = this.sprites.get(k);
    if (!c) {
      if (this.sprites.size > 600) this.sprites.clear();
      c = document.createElement('canvas');
      c.width = Math.ceil(w * dpr);
      c.height = Math.ceil(h * dpr);
      const g = c.getContext('2d');
      g.scale(dpr, dpr);
      paint(g, w, h);
      this.sprites.set(k, c);
    }
    return c;
  }

  /** Capital: a nation-coloured round badge with a gold ring and a white castle. */
  drawCapital(ctx, x, y, r, color, glow) {
    r = Math.round(r * 2) / 2;
    const pad = glow ? 7 : 3;
    const S = (r + pad) * 2;
    const c = this.sprite(`cap|${r}|${color}|${glow}`, S, S, (g) => {
      const m = S / 2;
      if (glow) {
        const grd = g.createRadialGradient(m, m, r * 0.6, m, m, r + pad);
        grd.addColorStop(0, 'rgba(255,214,80,0.6)');
        grd.addColorStop(1, 'rgba(255,214,80,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, S, S);
      }
      g.beginPath();
      g.arc(m, m + 1, r + 1.5, 0, Math.PI * 2);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fill();
      const body = g.createLinearGradient(0, m - r, 0, m + r);
      body.addColorStop(0, '#fff3b0');
      body.addColorStop(0.5, '#f2b729');
      body.addColorStop(1, '#a8680a');
      g.beginPath();
      g.arc(m, m, r + 1.5, 0, Math.PI * 2);
      g.fillStyle = body;
      g.fill();
      g.beginPath();
      g.arc(m, m, r - 0.8, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      g.beginPath();
      g.arc(m, m - r * 0.35, r * 0.7, Math.PI, 0);
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fill();
      drawIcon(g, 'castle', m, m, r * 1.45, '#ffffff');
    });
    ctx.drawImage(c, x - S / 2, y - S / 2, S, S);
  }

  /** City: a light rounded badge with a building, framed in the owner's colour. */
  drawCity(ctx, x, y, r, color, big) {
    r = Math.round(r * 2) / 2;
    const S = (r + 3) * 2;
    const c = this.sprite(`city|${r}|${color}|${big}`, S, S, (g) => {
      const m = S / 2;
      const rr = r * 0.45;
      const rect = (pad) => {
        g.beginPath();
        g.roundRect(m - r - pad, m - r - pad, (r + pad) * 2, (r + pad) * 2, rr + pad);
      };
      g.save();
      g.translate(0, 1);
      rect(1.2);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fill();
      g.restore();
      rect(1.2);
      g.fillStyle = color;
      g.fill();
      const body = g.createLinearGradient(0, m - r, 0, m + r);
      body.addColorStop(0, '#ffffff');
      body.addColorStop(1, '#d9dee8');
      rect(-0.6);
      g.fillStyle = body;
      g.fill();
      drawIcon(g, big ? 'tower' : 'house', m, m + 0.3, r * 1.55, '#34405c');
    });
    ctx.drawImage(c, x - S / 2, y - S / 2, S, S);
  }
}
