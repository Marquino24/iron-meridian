/**
 * render.js — Canvas renderer for the strategic map.
 *
 * Performance strategy (60 fps pan/zoom with 1000+ provinces):
 *   - Geometry is converted once into Path2D objects: one per province, one
 *     per nation, and border/coast segments bucketed into spatial chunks.
 *   - Level of detail by on-screen province size (`provincePx`):
 *       zoomed out → one fill per nation, no province borders, no terrain
 *       zoomed in  → per-province fills, culled to the viewport, terrain
 *                    symbols and province borders fade in.
 *   - Border chunks outside the viewport are skipped.
 *   - Labels/icons appear only when their province or nation is big enough
 *     on screen, and labels never overlap (greedy placement).
 *   - Frames are drawn only when something changed (`requestRender()`).
 *
 * Cache layers:
 *   buildGeometry()    — depends only on map geometry (once per map)
 *   rebuildOwnership() — depends on province owners (on conquest etc.)
 */

const COLORS = {
  void: '#040709',
  ocean: '#0a1820',
  shallow: '#0d2129',
  grid: 'rgba(90,165,185,0.07)',
  gridMajor: 'rgba(90,165,185,0.15)',
  coastGlow: 'rgba(110,190,210,0.10)',
  coast: 'rgba(165,215,225,0.55)',
  provinceBorder: 'rgba(6,10,12,0.42)',
  nationBorderDark: 'rgba(4,6,8,0.92)',
  nationBorderLight: 'rgba(235,228,205,0.5)',
  playerOutline: 'rgba(255,214,120,0.85)',
  dimOthers: 'rgba(3,6,8,0.6)',
  hoverFill: 'rgba(255,255,255,0.12)',
  hoverStroke: 'rgba(255,255,255,0.7)',
  selectFill: 'rgba(255,200,80,0.16)',
  selectGlow: 'rgba(255,190,60,0.30)',
  select: '#ffd25a',
  label: '#ece6d2',
  labelDim: 'rgba(214,208,190,0.7)',
  labelHalo: 'rgba(4,7,9,0.88)',
  unclaimed: '#4d5048',
};

const FONT_UI = '"Rajdhani", "Segoe UI", system-ui, sans-serif';

/** On-screen province size (px) at which per-province detail switches on. */
const DETAIL_PX = 26;

/** How each terrain shifts the nation color: mix toward tint, then scale brightness. */
const TERRAIN_SHADE = {
  plains: { tint: null, amount: 0, k: 1.0 },
  forest: { tint: [30, 58, 36], amount: 0.3, k: 0.9 },
  mountains: { tint: [120, 110, 98], amount: 0.34, k: 0.88 },
  urban: { tint: [210, 205, 190], amount: 0.14, k: 1.04 },
};

// --- Small helpers -----------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (c) => `rgb(${c.map((v) => clamp(Math.round(v), 0, 255)).join(',')})`;

/** Deterministic 0..1 hash for per-province shade jitter. */
function hash01(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function traceRings(path, rings) {
  for (const poly of rings) {
    if (poly.length < 3) continue;
    path.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) path.lineTo(poly[i].x, poly[i].y);
    path.closePath();
  }
}

const baseColor = (nation) => (nation ? mix(hexToRgb(nation.color), [20, 26, 30], 0.15) : hexToRgb(COLORS.unclaimed));

function provinceFill(province, nation) {
  const shade = TERRAIN_SHADE[province.terrain];
  let c = baseColor(nation);
  if (shade.tint) c = mix(c, shade.tint, shade.amount);
  const jitter = 0.95 + hash01(province.id) * 0.1;
  return rgb(c.map((v) => v * shade.k * jitter));
}

const intersects = (b, v) => b.x1 >= v.x0 && b.x0 <= v.x1 && b.y1 >= v.y0 && b.y0 <= v.y1;

/**
 * Line segments bucketed into a spatial grid so only on-screen chunks are
 * stroked. Each chunk tracks the real extent of its segments.
 */
class ChunkedPath {
  constructor(width, height, n = 10) {
    this.cw = width / n;
    this.ch = height / n;
    this.n = n;
    this.chunks = new Map();
  }
  add(x1, y1, x2, y2) {
    const gx = clamp(Math.floor((x1 + x2) / 2 / this.cw), 0, this.n - 1);
    const gy = clamp(Math.floor((y1 + y2) / 2 / this.ch), 0, this.n - 1);
    const key = gy * this.n + gx;
    let c = this.chunks.get(key);
    if (!c) {
      c = { path: new Path2D(), x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      this.chunks.set(key, c);
    }
    c.path.moveTo(x1, y1);
    c.path.lineTo(x2, y2);
    c.x0 = Math.min(c.x0, x1, x2); c.y0 = Math.min(c.y0, y1, y2);
    c.x1 = Math.max(c.x1, x1, x2); c.y1 = Math.max(c.y1, y1, y2);
  }
  stroke(ctx, view) {
    for (const c of this.chunks.values()) if (intersects(c, view)) ctx.stroke(c.path);
  }
}

/** Greedy non-overlapping label placement for one frame. */
class LabelSpace {
  constructor() { this.rects = []; }
  claim(x, y, w, h) {
    const r = { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
    // Strict overlap: boxes that merely touch are fine.
    for (const o of this.rects) if (r.x1 > o.x0 && r.x0 < o.x1 && r.y1 > o.y0 && r.y0 < o.y1) return false;
    this.rects.push(r);
    return true;
  }
}

/** Terrain symbol tiles, drawn at 2× (64px); scaled per map in buildGeometry(). */
function createTerrainPatterns(ctx) {
  const S = 32, R = 2;
  const make = (draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = S * R;
    const g = c.getContext('2d');
    g.scale(R, R);
    draw(g);
    const pattern = ctx.createPattern(c, 'repeat');
    return pattern;
  };
  const tree = (g, x, y) => {
    g.beginPath();
    g.moveTo(x, y - 5); g.lineTo(x + 3.6, y + 2); g.lineTo(x - 3.6, y + 2);
    g.closePath(); g.fill();
    g.fillRect(x - 0.6, y + 2, 1.2, 2);
  };
  return {
    forest: make((g) => {
      g.fillStyle = 'rgba(6,18,8,0.55)';
      tree(g, 8, 10); tree(g, 24, 24); tree(g, 13, 27);
    }),
    mountains: make((g) => {
      g.strokeStyle = 'rgba(18,14,10,0.6)';
      g.lineWidth = 1.5;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(3, 15); g.lineTo(9, 7); g.lineTo(15, 15);
      g.moveTo(17, 29); g.lineTo(23, 21); g.lineTo(29, 29);
      g.stroke();
      g.strokeStyle = 'rgba(255,250,235,0.25)';
      g.beginPath();
      g.moveTo(9, 7.5); g.lineTo(11.5, 10.8);
      g.moveTo(23, 21.5); g.lineTo(25.5, 24.8);
      g.stroke();
    }),
    urban: make((g) => {
      g.fillStyle = 'rgba(10,12,14,0.42)';
      for (const [x, y, w, h] of [[3, 3, 5, 5], [10, 3, 4, 6], [3, 10, 6, 4], [19, 18, 5, 5], [26, 18, 3, 6], [19, 25, 7, 4]]) {
        g.fillRect(x, y, w, h);
      }
    }),
  };
}

/** Draw a nation flag into any 2D context. Shared with the UI. */
export function drawFlag(ctx, flag, x, y, w, h) {
  const [c0, c1, c2] = flag.colors;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = c0;
  ctx.fillRect(x, y, w, h);
  switch (flag.pattern) {
    case 'h3':
      ctx.fillStyle = c1; ctx.fillRect(x, y + h / 3, w, h / 3);
      ctx.fillStyle = c2; ctx.fillRect(x, y + (2 * h) / 3, w, h / 3 + 1);
      break;
    case 'v3':
      ctx.fillStyle = c1; ctx.fillRect(x + w / 3, y, w / 3, h);
      ctx.fillStyle = c2; ctx.fillRect(x + (2 * w) / 3, y, w / 3 + 1, h);
      break;
    case 'h2':
      ctx.fillStyle = c1; ctx.fillRect(x, y + h / 2, w, h / 2 + 1);
      ctx.fillStyle = c2; ctx.fillRect(x, y + h / 2 - h * 0.06, w, h * 0.12);
      break;
    case 'v2':
      ctx.fillStyle = c1; ctx.fillRect(x + w * 0.38, y, w * 0.62 + 1, h);
      break;
    case 'cross':
      ctx.fillStyle = c1;
      ctx.fillRect(x + w * 0.28, y, w * 0.2, h); ctx.fillRect(x, y + h * 0.38, w, h * 0.24);
      ctx.fillStyle = c2;
      ctx.fillRect(x + w * 0.335, y, w * 0.09, h); ctx.fillRect(x, y + h * 0.455, w, h * 0.09);
      break;
    case 'canton':
      ctx.fillStyle = c1; ctx.fillRect(x, y + h / 2, w, h / 2 + 1);
      ctx.fillStyle = c2; ctx.fillRect(x, y, w * 0.42, h * 0.56);
      ctx.fillStyle = c0;
      ctx.beginPath();
      ctx.arc(x + w * 0.21, y + h * 0.28, h * 0.12, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'diag':
      ctx.fillStyle = c1;
      ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = c2; ctx.lineWidth = h * 0.16;
      ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y); ctx.stroke();
      break;
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

// --- Renderer ------------------------------------------------------------------

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./camera.js').Camera} camera
   * @param {import('./state.js').GameState} state
   */
  constructor(canvas, camera, state) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.camera = camera;
    this.state = state;
    this.dpr = 1;
    this.dirty = true;
    this.cache = null;
    this.patterns = createTerrainPatterns(this.ctx);
    this.hasLetterSpacing = 'letterSpacing' in this.ctx;
    this.lastFrameMs = 0;

    const redraw = () => this.requestRender();
    const relayer = () => this.invalidateLayer();
    state.events.on('map:loaded', () => this.buildGeometry());
    state.events.on('province:owner', () => this.rebuildOwnership());
    for (const evt of ['hover', 'select']) state.events.on(evt, redraw);
    for (const evt of ['focus:nation', 'player', 'phase']) state.events.on(evt, relayer);
    document.fonts?.ready.then(redraw);
  }

  requestRender() { this.dirty = true; }

  /** Match the backing store to CSS size × devicePixelRatio. */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.camera.setViewport(rect.width, rect.height);
    this.invalidateLayer();
  }

  // --- Caches ----------------------------------------------------------------

  buildGeometry() {
    const map = this.state.map;
    const provincePaths = map.provinces.map((p) => {
      const path = new Path2D();
      traceRings(path, p.rings);
      return path;
    });

    const shallowPath = new Path2D();
    for (const s of map.seaZones) if (s.coastalProvinces.length) traceRings(shallowPath, [s.polygon]);

    const coast = new ChunkedPath(map.width, map.height);
    for (const b of map.borders) if (b.kind === 'coast') coast.add(b.x1, b.y1, b.x2, b.y2);

    // Terrain symbols scale with the map's typical province size.
    const tile = clamp(map.provinceScale * 0.42, 14, 40);
    for (const pat of Object.values(this.patterns)) pat.setTransform?.(new DOMMatrix().scale(tile / 64));

    const cities = map.provinces.filter((p) => p.isCity).sort((a, b) => Number(b.isCapital) - Number(a.isCapital) || b.area - a.area);
    this.cache = { provincePaths, shallowPath, coast, cities };
    this.rebuildOwnership();
  }

  rebuildOwnership() {
    const map = this.state.map;
    const { provinces, nations, borders } = map;
    const c = this.cache;
    c.fills = provinces.map((p) => provinceFill(p, nations[p.owner]));
    c.nationFills = nations.map((n) => rgb(baseColor(n)));

    c.provinceBorders = new ChunkedPath(map.width, map.height);
    c.nationBorders = new ChunkedPath(map.width, map.height);
    c.nationOutlines = nations.map(() => new Path2D());
    c.nationAreas = nations.map(() => new Path2D());
    c.unclaimedArea = new Path2D();
    for (const p of provinces) traceRings(p.owner >= 0 ? c.nationAreas[p.owner] : c.unclaimedArea, p.rings);

    for (const b of borders) {
      const oa = provinces[b.a].owner;
      if (b.kind === 'coast') {
        if (oa >= 0) { c.nationOutlines[oa].moveTo(b.x1, b.y1); c.nationOutlines[oa].lineTo(b.x2, b.y2); }
        continue;
      }
      const ob = provinces[b.b].owner;
      if (oa === ob) { c.provinceBorders.add(b.x1, b.y1, b.x2, b.y2); continue; }
      c.nationBorders.add(b.x1, b.y1, b.x2, b.y2);
      for (const o of [oa, ob]) if (o >= 0) { c.nationOutlines[o].moveTo(b.x1, b.y1); c.nationOutlines[o].lineTo(b.x2, b.y2); }
    }

    // Labels: nations, plus named unclaimed regions (peoples/cultures in early eras).
    const groupLabel = (members) => {
      let area = 0, cx = 0, cy = 0;
      for (const p of members) {
        const w = Math.max(p.area, 1); // tiny islands can round to zero area
        area += w; cx += p.center.x * w; cy += p.center.y * w;
      }
      cx /= area; cy /= area;
      const candidates = members.filter((p) => !p.isCity);
      let best = members[0], bd = Infinity;
      for (const p of candidates.length ? candidates : members) {
        const d = (p.center.x - cx) ** 2 + (p.center.y - cy) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      return { x: best.center.x, y: best.center.y, area };
    };
    const byOwner = nations.map(() => []);
    const byRegion = new Map();
    for (const p of provinces) {
      if (p.owner >= 0) byOwner[p.owner].push(p);
      else if (p.region) { if (!byRegion.has(p.region)) byRegion.set(p.region, []); byRegion.get(p.region).push(p); }
    }
    // Nation labels sit on the homeland: the provinces connected to the capital
    // (so "FRANCE" is in France, not in the Sahara).
    const homeland = (n, members) => {
      const cap = provinces[n.capitalId];
      if (!cap || cap.owner !== n.id) return members;
      const seen = new Set([cap.id]);
      const stack = [cap.id];
      while (stack.length) {
        for (const nb of provinces[stack.pop()].neighbors) {
          if (!seen.has(nb) && provinces[nb].owner === n.id) { seen.add(nb); stack.push(nb); }
        }
      }
      return members.filter((p) => seen.has(p.id));
    };
    c.nationLabels = nations.map((n, i) => (byOwner[i].length ? { ...groupLabel(homeland(n, byOwner[i])), text: n.shortName.toUpperCase(), nation: n } : null));
    c.regionLabels = [...byRegion].map(([name, members]) => ({ ...groupLabel(members), text: name }));
    c.labelOrder = c.nationLabels.filter(Boolean).sort((a, b) => b.area - a.area);
    this.invalidateLayer();
  }

  /** World position for a nation's label / camera focus. */
  nationAnchor(nationId) {
    return this.cache?.nationLabels[nationId] ?? null;
  }

  /** Visible world rectangle (with a margin). */
  viewRect(margin = 0) {
    const cam = this.camera;
    const tl = cam.screenToWorld(-margin, -margin), br = cam.screenToWorld(cam.viewW + margin, cam.viewH + margin);
    return { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
  }

  // --- Frame -----------------------------------------------------------------

  /** Static layer must be redrawn (ownership, focus, player, map, size changed). */
  invalidateLayer() {
    this.layerValid = false;
    this.requestRender();
  }

  /**
   * Draws a frame if anything changed. Returns true if it drew.
   *
   * The static map (ocean, land, terrain, borders) lives in an off-screen
   * layer covering the view plus a margin. Panning just blits it at an
   * offset; while zooming it is blitted scaled, then redrawn crisply once the
   * zoom settles. Hover, selection, icons and labels are drawn live on top.
   */
  render() {
    if (!this.dirty || !this.cache) return false;
    this.dirty = false;
    const t0 = performance.now();

    const { ctx, camera: cam, dpr, cache, state } = this;
    const z = cam.zoom;
    const px = 1 / z;

    const use = this.layerUsable();
    if (!use) this.rebuildLayer();
    else if (use === 'scaled') this.dirty = true; // redraw crisply once the camera stops
    this.prevCam = { x: cam.x, y: cam.y, zoom: z };

    // Blit the static layer.
    const L = this.layerFrame;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (use === 'scaled') {
      ctx.fillStyle = COLORS.void;
      ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    }
    // Copy only the visible part of the layer (much cheaper than the whole bitmap).
    const v = this.viewRect(1);
    const lx0 = L.x - L.w / 2 / L.zoom, ly0 = L.y - L.h / 2 / L.zoom;
    const ix0 = Math.max(v.x0, lx0), iy0 = Math.max(v.y0, ly0);
    const ix1 = Math.min(v.x1, lx0 + L.w / L.zoom), iy1 = Math.min(v.y1, ly0 + L.h / L.zoom);
    if (ix1 > ix0 && iy1 > iy0) {
      const s = L.zoom * L.dpr;
      const d = cam.worldToScreen(ix0, iy0);
      ctx.imageSmoothingEnabled = use === 'scaled';
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(this.layer, (ix0 - lx0) * s, (iy0 - ly0) * s, (ix1 - ix0) * s, (iy1 - iy0) * s, d.x, d.y, (ix1 - ix0) * z, (iy1 - iy0) * z);
      ctx.imageSmoothingEnabled = true;
    }

    // Dynamic world-space layer.
    const ox = cam.viewW / 2 - cam.x * z, oy = cam.viewH / 2 - cam.y * z;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const paths = cache.provincePaths;
    // Hover & selection.
    const hov = state.hoveredProvinceId, sel = state.selectedProvinceId;
    if (hov >= 0 && hov !== sel) {
      ctx.fillStyle = COLORS.hoverFill;
      ctx.fill(paths[hov], 'evenodd');
      ctx.strokeStyle = COLORS.hoverStroke;
      ctx.lineWidth = 1.5 * px;
      ctx.stroke(paths[hov]);
    }
    if (sel >= 0) {
      ctx.fillStyle = COLORS.selectFill;
      ctx.fill(paths[sel], 'evenodd');
      ctx.strokeStyle = COLORS.selectGlow;
      ctx.lineWidth = 7 * px;
      ctx.stroke(paths[sel]);
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 2.2 * px;
      ctx.stroke(paths[sel]);
    }

    // Screen-space overlay: icons and labels stay a constant pixel size.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawOverlay(state.map.provinceScale * z);

    this.lastFrameMs = performance.now() - t0;
    return true;
  }

  /**
   * 'exact'  — same zoom and the view is fully inside the layer (pure pan);
   * 'scaled' — the camera is moving (drag, pinch, zoom animation): reuse the
   *            layer stretched/shifted and redraw crisply once it stops;
   * null     — redraw the layer now.
   */
  layerUsable() {
    const L = this.layerFrame;
    if (!this.layerValid || !L) return null;
    const cam = this.camera;
    const ratio = cam.zoom / L.zoom;
    const v = this.viewRect(0);
    const hw = L.w / 2 / L.zoom, hh = L.h / 2 / L.zoom;
    const ix = Math.max(0, Math.min(v.x1, L.x + hw) - Math.max(v.x0, L.x - hw));
    const iy = Math.max(0, Math.min(v.y1, L.y + hh) - Math.max(v.y0, L.y - hh));
    const coverage = (ix * iy) / ((v.x1 - v.x0) * (v.y1 - v.y0));
    if (Math.abs(ratio - 1) < 1e-9 && coverage > 0.9999) return 'exact';
    // "Moving" includes short pauses mid-gesture: only redraw after 150 ms of stillness.
    const p = this.prevCam;
    const now = performance.now();
    if (!p || p.x !== cam.x || p.y !== cam.y || p.zoom !== cam.zoom) this.lastMoveAt = now;
    const moving = now - (this.lastMoveAt ?? 0) < 150;
    return moving && ratio > 0.33 && ratio < 3 && coverage > 0.55 ? 'scaled' : null;
  }

  rebuildLayer() {
    const cam = this.camera;
    const PAD = 0.3;
    const w = Math.ceil(cam.viewW * (1 + 2 * PAD)), h = Math.ceil(cam.viewH * (1 + 2 * PAD));
    // iOS caps canvas area at ~16.7 MP; keep well under it.
    const ldpr = Math.min(this.dpr, Math.sqrt(14e6 / (w * h)));
    if (!this.layer) {
      this.layer = document.createElement('canvas');
      this.layerCtx = this.layer.getContext('2d', { alpha: false });
    }
    const pw = Math.round(w * ldpr), ph = Math.round(h * ldpr);
    if (this.layer.width !== pw || this.layer.height !== ph) {
      this.layer.width = pw;
      this.layer.height = ph;
    }
    this.layerFrame = { x: cam.x, y: cam.y, zoom: cam.zoom, w, h, dpr: ldpr };
    this.drawStatic(this.layerCtx, this.layerFrame);
    this.layerValid = true;
    this.layerBuilds = (this.layerBuilds ?? 0) + 1;
  }

  /** Everything that doesn't change while the camera pans. */
  drawStatic(ctx, F) {
    const { cache, state } = this;
    const map = state.map;
    const z = F.zoom;
    const px = 1 / z;
    const view = { x0: F.x - F.w / 2 / z, y0: F.y - F.h / 2 / z, x1: F.x + F.w / 2 / z, y1: F.y + F.h / 2 / z };
    const provincePx = map.provinceScale * z;
    const detail = provincePx >= DETAIL_PX;

    ctx.setTransform(F.dpr, 0, 0, F.dpr, 0, 0);
    ctx.fillStyle = COLORS.void;
    ctx.fillRect(0, 0, F.w, F.h);
    const ox = F.w / 2 - F.x * z, oy = F.h / 2 - F.y * z;
    ctx.setTransform(F.dpr * z, 0, 0, F.dpr * z, F.dpr * ox, F.dpr * oy);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Ocean, grid/graticule, shallow water, coastal glow.
    ctx.fillStyle = COLORS.ocean;
    ctx.fillRect(0, 0, map.width, map.height);
    this.drawGrid(ctx, px, view);
    ctx.fillStyle = COLORS.shallow;
    ctx.fill(cache.shallowPath, 'evenodd');
    ctx.strokeStyle = COLORS.coastGlow;
    ctx.lineWidth = 12 * px;
    cache.coast.stroke(ctx, view);

    // Land.
    const paths = cache.provincePaths;
    if (detail) {
      for (let i = 0; i < paths.length; i++) {
        if (!intersects(map.provinces[i].bbox, view)) continue;
        ctx.fillStyle = cache.fills[i];
        ctx.fill(paths[i], 'evenodd');
      }
      const terrainAlpha = clamp((provincePx - 34) / 30, 0, 1) * 0.55;
      if (terrainAlpha > 0) {
        ctx.globalAlpha = terrainAlpha;
        for (let i = 0; i < paths.length; i++) {
          const p = map.provinces[i];
          const pat = this.patterns[p.terrain];
          if (!pat || !intersects(p.bbox, view)) continue;
          ctx.fillStyle = pat;
          ctx.fill(paths[i], 'evenodd');
        }
        ctx.globalAlpha = 1;
      }
    } else {
      cache.nationAreas.forEach((path, i) => { ctx.fillStyle = cache.nationFills[i]; ctx.fill(path, 'evenodd'); });
      ctx.fillStyle = COLORS.unclaimed;
      ctx.fill(cache.unclaimedArea, 'evenodd');
    }

    // Start screen: dim every nation except the one being previewed.
    const focus = state.phase === 'setup' ? state.focusedNationId : -1;
    if (focus >= 0) {
      ctx.fillStyle = COLORS.dimOthers;
      cache.nationAreas.forEach((path, i) => { if (i !== focus) ctx.fill(path, 'evenodd'); });
      ctx.fill(cache.unclaimedArea, 'evenodd');
    }

    // Borders: province (thin, fades in) → nation (thick, two-tone) → coastline.
    const provBorderAlpha = clamp((provincePx - DETAIL_PX) / 20, 0, 1);
    if (provBorderAlpha > 0) {
      ctx.globalAlpha = provBorderAlpha;
      ctx.strokeStyle = COLORS.provinceBorder;
      ctx.lineWidth = 0.8 * px;
      cache.provinceBorders.stroke(ctx, view);
      ctx.globalAlpha = 1;
    }
    const thick = clamp(provincePx / 12, 1.6, 3.4);
    ctx.strokeStyle = COLORS.nationBorderDark;
    ctx.lineWidth = thick * px;
    cache.nationBorders.stroke(ctx, view);
    if (detail) {
      ctx.strokeStyle = COLORS.nationBorderLight;
      ctx.lineWidth = 1 * px;
      ctx.setLineDash([5 * px, 3 * px]);
      cache.nationBorders.stroke(ctx, view);
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = COLORS.coast;
    ctx.lineWidth = 1.1 * px;
    cache.coast.stroke(ctx, view);

    // Highlight outline: player's nation in game, previewed nation in setup.
    const outlined = state.phase === 'playing' ? state.playerNationId : focus;
    if (outlined >= 0) {
      ctx.strokeStyle = COLORS.playerOutline;
      ctx.lineWidth = 1.8 * px;
      ctx.stroke(cache.nationOutlines[outlined]);
    }
  }

  /** Lat/lon graticule on real maps, tactical grid on generated ones. */
  drawGrid(ctx, px, view) {
    const map = this.state.map;
    ctx.lineWidth = px;
    if (map.graticule) {
      if (!this.cache.graticule) {
        const path = new Path2D();
        for (const [a, b] of map.graticule) { path.moveTo(a.x, a.y); path.lineTo(b.x, b.y); }
        this.cache.graticule = path;
      }
      ctx.strokeStyle = COLORS.gridMajor;
      ctx.stroke(this.cache.graticule);
      return;
    }
    const step = map.gridSize;
    const x0 = Math.max(0, view.x0), x1 = Math.min(map.width, view.x1);
    const y0 = Math.max(0, view.y0), y1 = Math.min(map.height, view.y1);
    const minor = new Path2D(), major = new Path2D();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      const path = x % (step * 5) === 0 ? major : minor;
      path.moveTo(x, y0); path.lineTo(x, y1);
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const path = y % (step * 5) === 0 ? major : minor;
      path.moveTo(x0, y); path.lineTo(x1, y);
    }
    ctx.strokeStyle = COLORS.grid;
    ctx.stroke(minor);
    ctx.strokeStyle = COLORS.gridMajor;
    ctx.stroke(major);
  }

  drawOverlay(provincePx) {
    const { ctx, camera: cam, cache, state } = this;
    const map = state.map;
    const W = cam.viewW, H = cam.viewH, M = 40;
    const onScreen = (s) => s.x > -M && s.y > -M && s.x < W + M && s.y < H + M;
    const space = new LabelSpace();
    const z = cam.zoom;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    // 1. City icons (claim their space first so labels avoid them).
    const iconScale = clamp(0.8 + (provincePx - 30) / 200, 0.8, 1.3);
    const shownCities = [];
    for (const p of cache.cities) {
      const ps = Math.sqrt(p.area) * z; // this province's size on screen
      const nation = map.nations[p.owner];
      const major = p.isCapital && nation?.major;
      const visible = major || (p.isCapital ? ps >= 12 : ps >= 18);
      if (!visible) continue;
      const s = cam.worldToScreen(p.center.x, p.center.y);
      if (!onScreen(s)) continue;
      const r = p.isCapital ? 6 * iconScale : 3.6 * iconScale;
      // Major powers' capitals always show; everything else yields to what's already placed.
      if (!space.claim(s.x, s.y, r * 2 + 2, r * 2 + 2) && !major) continue;
      if (p.isCapital) this.drawCapitalIcon(s.x, s.y, r);
      else this.drawCityIcon(s.x, s.y, r);
      shownCities.push({ p, s, ps, r });
    }

    // 2. Nation names, largest first, only where they fit; fade out when zoomed far in.
    const nationAlpha = clamp((120 - provincePx) / 50, 0, 1);
    if (nationAlpha > 0) {
      ctx.globalAlpha = nationAlpha * 0.88;
      for (const a of cache.labelOrder) {
        const s = cam.worldToScreen(a.x, a.y);
        if (!onScreen(s)) continue;
        const extent = Math.sqrt(a.area) * z;
        const size = clamp(extent * 0.14, 9, 28);
        ctx.font = `700 ${size.toFixed(1)}px ${FONT_UI}`;
        const spacing = size * 0.22;
        if (this.hasLetterSpacing) ctx.letterSpacing = `${spacing.toFixed(1)}px`;
        const w = ctx.measureText(a.text).width;
        if (w > extent * 1.7 && !(a.nation.major && extent > 18)) continue;
        // Try the anchor, then just above/below it (city icons often sit on the anchor).
        const dy = [0, -1.15, 1.15, -2.3, 2.3].map((k) => k * size).find((d) => space.claim(s.x, s.y + d, w + 4, size + 2));
        if (dy === undefined) continue;
        this.haloText(a.text, s.x, s.y + dy, 3.5);
      }
      // Unclaimed regions (peoples, cultures) in italics.
      for (const a of cache.regionLabels) {
        const extent = Math.sqrt(a.area) * z;
        if (extent < 60) continue;
        const s = cam.worldToScreen(a.x, a.y);
        if (!onScreen(s)) continue;
        const size = clamp(extent * 0.07, 9, 15);
        ctx.font = `italic 500 ${size.toFixed(1)}px ${FONT_UI}`;
        if (this.hasLetterSpacing) ctx.letterSpacing = '0.5px';
        const w = ctx.measureText(a.text).width;
        if (w > extent * 1.6 || !space.claim(s.x, s.y, w + 4, size + 2)) continue;
        this.haloText(a.text, s.x, s.y, 3, COLORS.labelDim);
      }
      if (this.hasLetterSpacing) ctx.letterSpacing = '0px';
      ctx.globalAlpha = 1;
    }

    // 3. City names when their province is big enough on screen.
    ctx.font = `600 ${Math.round(12 * iconScale)}px ${FONT_UI}`;
    for (const { p, s, ps, r } of shownCities) {
      if (ps < (p.isCapital ? 34 : 48)) continue;
      const y = s.y + r + 9;
      const w = ctx.measureText(p.name).width;
      if (!space.claim(s.x, y, w + 4, 14)) continue;
      this.haloText(p.name, s.x, y, 3);
    }

    // 4. Province names when zoomed far in.
    if (provincePx > 95) {
      ctx.font = `500 11px ${FONT_UI}`;
      ctx.globalAlpha = clamp((provincePx - 95) / 40, 0, 1) * 0.8;
      const view = this.viewRect(0);
      for (const p of map.provinces) {
        if (p.isCity || Math.sqrt(p.area) * z < 110 || !intersects(p.bbox, view)) continue;
        const s = cam.worldToScreen(p.center.x, p.center.y);
        const text = p.name.toUpperCase();
        if (!space.claim(s.x, s.y, ctx.measureText(text).width + 4, 13)) continue;
        this.haloText(text, s.x, s.y, 3);
      }
      ctx.globalAlpha = 1;
    }
  }

  haloText(text, x, y, halo, color = COLORS.label) {
    const ctx = this.ctx;
    ctx.strokeStyle = COLORS.labelHalo;
    ctx.lineWidth = halo;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /** NATO-style square city marker. */
  drawCityIcon(x, y, r) {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a0e10';
    ctx.fillRect(x - r - 1.5, y - r - 1.5, 2 * r + 3, 2 * r + 3);
    ctx.fillStyle = '#e8e2cc';
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    ctx.fillStyle = '#0a0e10';
    ctx.fillRect(x - r * 0.35, y - r * 0.35, r * 0.7, r * 0.7);
  }

  /** Capital: gold star in a dark ring. */
  drawCapitalIcon(x, y, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, r + 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,10,12,0.9)';
    ctx.fill();
    ctx.strokeStyle = '#ffd25a';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.45;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = '#ffd25a';
    ctx.fill();
  }
}
