/**
 * render.js — Canvas renderer for the strategic map.
 *
 * Performance strategy (60 fps pan/zoom):
 *   - All geometry is converted once into Path2D objects (per province, per
 *     terrain, border classes). A frame is just a handful of fills/strokes
 *     under a single world transform.
 *   - Line widths are divided by zoom so borders stay crisp at any scale.
 *   - Frames are drawn only when something changed (`requestRender()`),
 *     so an idle map costs ~nothing.
 *
 * Cache layers:
 *   buildGeometry()   — depends only on map geometry (once per map)
 *   rebuildOwnership()— depends on province owners (on conquest etc.)
 *
 * Later steps can add layers (units, fronts, supply lines) by extending
 * render() between the province layer and the screen-space overlay.
 */

const COLORS = {
  void: '#040709',
  ocean: '#0a1820',
  shallow: '#0d2129',
  grid: 'rgba(90,165,185,0.07)',
  gridMajor: 'rgba(90,165,185,0.15)',
  coastGlow: 'rgba(110,190,210,0.10)',
  coast: 'rgba(165,215,225,0.55)',
  provinceBorder: 'rgba(6,10,12,0.4)',
  nationBorderDark: 'rgba(4,6,8,0.92)',
  nationBorderLight: 'rgba(235,228,205,0.5)',
  playerOutline: 'rgba(255,214,120,0.8)',
  dimOthers: 'rgba(3,6,8,0.6)',
  hoverFill: 'rgba(255,255,255,0.10)',
  hoverStroke: 'rgba(255,255,255,0.65)',
  selectFill: 'rgba(255,200,80,0.14)',
  selectGlow: 'rgba(255,190,60,0.30)',
  select: '#ffd25a',
  label: '#ece6d2',
  labelHalo: 'rgba(4,7,9,0.88)',
};

const FONT_UI = '"Rajdhani", "Segoe UI", system-ui, sans-serif';
const TERRAIN_TILE = 30; // world units per terrain pattern tile

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

function tracePolygon(path, poly) {
  path.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) path.lineTo(poly[i].x, poly[i].y);
  path.closePath();
}

function provinceFill(province, nation) {
  const base = mix(hexToRgb(nation.color), [20, 26, 30], 0.15);
  const shade = TERRAIN_SHADE[province.terrain];
  let c = shade.tint ? mix(base, shade.tint, shade.amount) : base;
  const jitter = 0.95 + hash01(province.id) * 0.1;
  c = c.map((v) => v * shade.k * jitter);
  return rgb(c);
}

/** Terrain symbol tiles, drawn at 2× and scaled so they stay crisp. */
function createTerrainPatterns(ctx) {
  const S = 32, R = 2;
  const make = (draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = S * R;
    const g = c.getContext('2d');
    g.scale(R, R);
    draw(g);
    const pattern = ctx.createPattern(c, 'repeat');
    pattern.setTransform?.(new DOMMatrix().scale(TERRAIN_TILE / (S * R)));
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
    state.events.on('map:loaded', () => this.buildGeometry());
    state.events.on('province:owner', () => this.rebuildOwnership());
    for (const evt of ['hover', 'select', 'focus:nation', 'player', 'phase']) state.events.on(evt, redraw);
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
    this.requestRender();
  }

  // --- Caches ----------------------------------------------------------------

  buildGeometry() {
    const map = this.state.map;
    const provincePaths = map.provinces.map((p) => {
      const path = new Path2D();
      tracePolygon(path, p.polygon);
      return path;
    });

    const terrainPaths = { forest: new Path2D(), mountains: new Path2D(), urban: new Path2D() };
    for (const p of map.provinces) {
      if (terrainPaths[p.terrain]) tracePolygon(terrainPaths[p.terrain], p.polygon);
    }

    const shallowPath = new Path2D();
    for (const s of map.seaZones) if (s.coastalProvinces.length) tracePolygon(shallowPath, s.polygon);

    const coastPath = new Path2D();
    for (const b of map.borders) {
      if (b.kind !== 'coast') continue;
      coastPath.moveTo(b.x1, b.y1);
      coastPath.lineTo(b.x2, b.y2);
    }

    const cities = map.provinces.filter((p) => p.isCity);
    this.cache = { provincePaths, terrainPaths, shallowPath, coastPath, cities };
    this.rebuildOwnership();
  }

  rebuildOwnership() {
    const { provinces, nations, borders } = this.state.map;
    const c = this.cache;
    c.fills = provinces.map((p) => provinceFill(p, nations[p.owner]));

    c.provinceBorderPath = new Path2D();
    c.nationBorderPath = new Path2D();
    c.nationOutlines = nations.map(() => new Path2D());
    c.nationAreas = nations.map(() => new Path2D());
    for (const p of provinces) tracePolygon(c.nationAreas[p.owner], p.polygon);

    for (const b of borders) {
      const oa = provinces[b.a].owner;
      if (b.kind === 'coast') {
        c.nationOutlines[oa].moveTo(b.x1, b.y1);
        c.nationOutlines[oa].lineTo(b.x2, b.y2);
        continue;
      }
      const ob = provinces[b.b].owner;
      const target = oa === ob ? c.provinceBorderPath : c.nationBorderPath;
      target.moveTo(b.x1, b.y1);
      target.lineTo(b.x2, b.y2);
      if (oa !== ob) {
        for (const o of [oa, ob]) { c.nationOutlines[o].moveTo(b.x1, b.y1); c.nationOutlines[o].lineTo(b.x2, b.y2); }
      }
    }

    // Nation label anchor: the non-city member province closest to the
    // area-weighted centroid (so the label never sits on a city icon).
    c.nationLabels = nations.map((n) => {
      const own = provinces.filter((p) => p.owner === n.id);
      let area = 0, cx = 0, cy = 0;
      for (const p of own) { area += p.area; cx += p.center.x * p.area; cy += p.center.y * p.area; }
      cx /= area; cy /= area;
      const candidates = own.filter((p) => !p.isCity);
      let best = null, bd = Infinity;
      for (const p of candidates.length ? candidates : own) {
        const d = (p.center.x - cx) ** 2 + (p.center.y - cy) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      return { x: best.center.x, y: best.center.y, area };
    });
    this.requestRender();
  }

  /** World position for a nation's label / camera focus. */
  nationAnchor(nationId) {
    return this.cache?.nationLabels[nationId] ?? null;
  }

  // --- Frame -----------------------------------------------------------------

  /** Draws a frame if anything changed. Returns true if it drew. */
  render() {
    if (!this.dirty || !this.cache) return false;
    this.dirty = false;
    const t0 = performance.now();

    const { ctx, camera: cam, dpr, cache, state } = this;
    const map = state.map;
    const z = cam.zoom;
    const px = 1 / z; // one CSS pixel in world units

    // Background outside the world.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.void;
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);

    // World transform.
    const ox = cam.viewW / 2 - cam.x * z, oy = cam.viewH / 2 - cam.y * z;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Ocean, tactical grid, shallow water, coastal glow.
    ctx.fillStyle = COLORS.ocean;
    ctx.fillRect(0, 0, map.width, map.height);
    this.drawGrid(px);
    ctx.fillStyle = COLORS.shallow;
    ctx.fill(cache.shallowPath);
    ctx.strokeStyle = COLORS.coastGlow;
    ctx.lineWidth = 12 * px;
    ctx.stroke(cache.coastPath);

    // Provinces.
    const paths = cache.provincePaths;
    for (let i = 0; i < paths.length; i++) {
      ctx.fillStyle = cache.fills[i];
      ctx.fill(paths[i]);
    }

    // Terrain symbols.
    ctx.globalAlpha = 0.55;
    for (const t of ['forest', 'mountains', 'urban']) {
      ctx.fillStyle = this.patterns[t];
      ctx.fill(cache.terrainPaths[t]);
    }
    ctx.globalAlpha = 1;

    // Start screen: dim every nation except the one being previewed.
    const focus = state.phase === 'setup' ? state.focusedNationId : -1;
    if (focus >= 0) {
      ctx.fillStyle = COLORS.dimOthers;
      cache.nationAreas.forEach((path, i) => { if (i !== focus) ctx.fill(path); });
    }

    // Borders: province (thin) → nation (thick, two-tone) → coastline.
    ctx.strokeStyle = COLORS.provinceBorder;
    ctx.lineWidth = 0.8 * px;
    ctx.stroke(cache.provinceBorderPath);

    ctx.strokeStyle = COLORS.nationBorderDark;
    ctx.lineWidth = 3.4 * px;
    ctx.stroke(cache.nationBorderPath);
    ctx.strokeStyle = COLORS.nationBorderLight;
    ctx.lineWidth = 1 * px;
    ctx.setLineDash([5 * px, 3 * px]);
    ctx.stroke(cache.nationBorderPath);
    ctx.setLineDash([]);

    ctx.strokeStyle = COLORS.coast;
    ctx.lineWidth = 1.3 * px;
    ctx.stroke(cache.coastPath);

    // Highlight outline: player's nation in game, previewed nation in setup.
    const outlined = state.phase === 'playing' ? state.playerNationId : focus;
    if (outlined >= 0) {
      ctx.strokeStyle = COLORS.playerOutline;
      ctx.lineWidth = 1.8 * px;
      ctx.stroke(cache.nationOutlines[outlined]);
    }

    // Hover & selection.
    const hov = state.hoveredProvinceId, sel = state.selectedProvinceId;
    if (hov >= 0 && hov !== sel) {
      ctx.fillStyle = COLORS.hoverFill;
      ctx.fill(paths[hov]);
      ctx.strokeStyle = COLORS.hoverStroke;
      ctx.lineWidth = 1.5 * px;
      ctx.stroke(paths[hov]);
    }
    if (sel >= 0) {
      ctx.fillStyle = COLORS.selectFill;
      ctx.fill(paths[sel]);
      ctx.strokeStyle = COLORS.selectGlow;
      ctx.lineWidth = 7 * px;
      ctx.stroke(paths[sel]);
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 2.2 * px;
      ctx.stroke(paths[sel]);
    }

    // Screen-space overlay: icons and labels stay a constant pixel size.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawOverlay();

    this.lastFrameMs = performance.now() - t0;
    return true;
  }

  /** Grid lines over the visible part of the ocean. */
  drawGrid(px) {
    const { ctx, camera: cam } = this;
    const map = this.state.map;
    const step = map.gridSize;
    const tl = cam.screenToWorld(0, 0), br = cam.screenToWorld(cam.viewW, cam.viewH);
    const x0 = Math.max(0, tl.x), x1 = Math.min(map.width, br.x);
    const y0 = Math.max(0, tl.y), y1 = Math.min(map.height, br.y);
    const minor = new Path2D(), major = new Path2D();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      const path = x % (step * 5) === 0 ? major : minor;
      path.moveTo(x, y0); path.lineTo(x, y1);
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const path = y % (step * 5) === 0 ? major : minor;
      path.moveTo(x0, y); path.lineTo(x1, y);
    }
    ctx.lineWidth = px;
    ctx.strokeStyle = COLORS.grid;
    ctx.stroke(minor);
    ctx.strokeStyle = COLORS.gridMajor;
    ctx.stroke(major);
  }

  drawOverlay() {
    const { ctx, camera: cam, cache, state } = this;
    const map = state.map;
    const zr = cam.zoom / cam.refZoom; // 1 ≈ overview
    const W = cam.viewW, H = cam.viewH, M = 60;
    const onScreen = (s) => s.x > -M && s.y > -M && s.x < W + M && s.y < H + M;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    // Nation names fade out as you zoom in.
    const nationAlpha = clamp((2.2 - zr) / 0.8, 0, 1);
    if (nationAlpha > 0) {
      for (const n of map.nations) {
        const a = cache.nationLabels[n.id];
        const s = cam.worldToScreen(a.x, a.y);
        if (!onScreen(s)) continue;
        const size = clamp(Math.sqrt(a.area) * cam.zoom * 0.075, 11, 30);
        const text = n.shortName.toUpperCase();
        ctx.font = `700 ${size.toFixed(1)}px ${FONT_UI}`;
        if (this.hasLetterSpacing) ctx.letterSpacing = `${(size * 0.3).toFixed(1)}px`;
        // If the label would cover the capital star, drop it just below the icon.
        const cap = map.provinces[n.capitalId].center;
        const cs = cam.worldToScreen(cap.x, cap.y);
        if (Math.abs(cs.x - s.x) < ctx.measureText(text).width / 2 + 10 && Math.abs(cs.y - s.y) < size / 2 + 12) {
          s.y = cs.y + 14 + size / 2;
        }
        ctx.globalAlpha = nationAlpha * 0.85;
        this.haloText(text, s.x, s.y, 4);
      }
      if (this.hasLetterSpacing) ctx.letterSpacing = '0px';
      ctx.globalAlpha = 1;
    }

    // City icons.
    const iconScale = clamp(0.85 + (zr - 1) * 0.12, 0.85, 1.35);
    const cityLabelAlpha = clamp((zr - 1.5) / 0.5, 0, 1);
    ctx.font = `600 ${Math.round(12 * iconScale)}px ${FONT_UI}`;
    for (const p of cache.cities) {
      const s = cam.worldToScreen(p.center.x, p.center.y);
      if (!onScreen(s)) continue;
      if (p.isCapital) this.drawCapitalIcon(s.x, s.y, 6.5 * iconScale);
      else this.drawCityIcon(s.x, s.y, 4 * iconScale);
      if (cityLabelAlpha > 0) {
        ctx.globalAlpha = cityLabelAlpha;
        this.haloText(p.name, s.x, s.y + 13 * iconScale, 3);
        ctx.globalAlpha = 1;
      }
    }

    // Province names when zoomed far in.
    const provAlpha = clamp((zr - 2.8) / 0.6, 0, 1);
    if (provAlpha > 0) {
      ctx.font = `500 11px ${FONT_UI}`;
      ctx.globalAlpha = provAlpha * 0.8;
      for (const p of map.provinces) {
        if (p.isCity) continue;
        const s = cam.worldToScreen(p.center.x, p.center.y);
        if (onScreen(s)) this.haloText(p.name.toUpperCase(), s.x, s.y, 3);
      }
      ctx.globalAlpha = 1;
    }
  }

  haloText(text, x, y, halo) {
    const ctx = this.ctx;
    ctx.strokeStyle = COLORS.labelHalo;
    ctx.lineWidth = halo;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = COLORS.label;
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
