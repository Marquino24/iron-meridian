/**
 * camera.js — 2D camera (pan/zoom with smoothing, inertia, fly-to) and the
 * input controller that drives it from mouse, touch (pinch) and keyboard.
 *
 * Coordinates: the camera stores the world point at the center of the
 * viewport (x, y) and a zoom factor (screen CSS px per world unit).
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.zoomAnchor = null;      // screen point kept fixed while smooth-zooming
    this.viewW = 1;
    this.viewH = 1;
    this.worldW = 1;
    this.worldH = 1;
    this.fitZoom = 1;            // zoom at which the whole map fits
    this.refZoom = 1;            // aspect-independent "overview" zoom; UI zoom levels are relative to it
    this.minZoom = 0.5;
    this.maxZoom = 8;
    this.maxZoomRel = 6;         // max zoom as a multiple of refZoom (per map)
    this.maxZoomAbs = 0;         // …but always enough to show a typical province this large (main.js)
    this.velX = 0;               // inertia, screen px / s
    this.velY = 0;
    this.flight = null;          // active flyTo animation
  }

  setViewport(w, h) {
    this.viewW = w;
    this.viewH = h;
    this.updateLimits();
  }

  setWorld(w, h, maxZoomRel = 6, maxZoomAbs = 0) {
    this.worldW = w;
    this.worldH = h;
    this.maxZoomRel = maxZoomRel;
    this.maxZoomAbs = maxZoomAbs;
    this.updateLimits();
  }

  updateLimits() {
    this.fitZoom = Math.min(this.viewW / this.worldW, this.viewH / this.worldH);
    // On a portrait phone fitZoom is tiny (the wide map fits by width), so zoom
    // levels for labels/fly-to use the geometric-mean scale instead.
    this.refZoom = Math.max(this.fitZoom, Math.sqrt((this.viewW * this.viewH) / (this.worldW * this.worldH)));
    this.minZoom = this.fitZoom * 0.6;
    // Small screens: refZoom shrinks with the screen but markers and fingers don't,
    // so a typical province can always be zoomed to a comfortable tapping size.
    this.maxZoom = Math.max(this.refZoom * this.maxZoomRel, this.maxZoomAbs);
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
    this.targetZoom = clamp(this.targetZoom, this.minZoom, this.maxZoom);
    this.clampPosition();
  }

  clampZoom(z) { return clamp(z, this.minZoom, this.maxZoom); }

  /** Show the whole map. */
  fit() {
    this.x = this.worldW / 2;
    this.y = this.worldH / 2;
    this.zoom = this.targetZoom = this.fitZoom;
    this.stop();
  }

  stop() {
    this.flight = null;
    this.velX = this.velY = 0;
    this.targetZoom = this.zoom;
  }

  /** Keep the view center on the map so it can never be lost off-screen. */
  clampPosition() {
    this.x = clamp(this.x, 0, this.worldW);
    this.y = clamp(this.y, 0, this.worldH);
  }

  screenToWorld(sx, sy) {
    return { x: this.x + (sx - this.viewW / 2) / this.zoom, y: this.y + (sy - this.viewH / 2) / this.zoom };
  }

  worldToScreen(wx, wy) {
    return { x: (wx - this.x) * this.zoom + this.viewW / 2, y: (wy - this.y) * this.zoom + this.viewH / 2 };
  }

  /** Pan by a screen-space delta (drag). */
  panBy(dx, dy) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clampPosition();
  }

  /** Smooth zoom by a factor, keeping the screen point (sx, sy) fixed. */
  zoomAt(factor, sx, sy) {
    this.flight = null;
    this.targetZoom = clamp(this.targetZoom * factor, this.minZoom, this.maxZoom);
    this.zoomAnchor = { sx, sy };
  }

  /** Immediate zoom (pinch), keeping (sx, sy) fixed. */
  setZoomAt(zoom, sx, sy) {
    const w = this.screenToWorld(sx, sy);
    this.zoom = this.targetZoom = clamp(zoom, this.minZoom, this.maxZoom);
    this.x = w.x - (sx - this.viewW / 2) / this.zoom;
    this.y = w.y - (sy - this.viewH / 2) / this.zoom;
    this.clampPosition();
  }

  /** Animate to a world point and zoom. */
  flyTo(x, y, zoom = this.zoom, duration = 0.9) {
    this.velX = this.velY = 0;
    this.flight = {
      from: { x: this.x, y: this.y, z: this.zoom },
      to: { x, y, z: clamp(zoom, this.minZoom, this.maxZoom) },
      t: 0,
      duration,
    };
  }

  setInertia(vx, vy) {
    this.velX = vx;
    this.velY = vy;
  }

  /** Advance animations. Returns true if the view changed (needs redraw). */
  update(dt) {
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.duration);
      const e = easeInOutCubic(f.t);
      this.x = f.from.x + (f.to.x - f.from.x) * e;
      this.y = f.from.y + (f.to.y - f.from.y) * e;
      // Interpolate zoom in log space so it feels uniform.
      this.zoom = this.targetZoom = Math.exp(Math.log(f.from.z) + (Math.log(f.to.z) - Math.log(f.from.z)) * e);
      this.clampPosition();
      if (f.t >= 1) this.flight = null;
      return true;
    }

    let changed = false;
    if (this.zoom !== this.targetZoom) {
      const a = this.zoomAnchor ?? { sx: this.viewW / 2, sy: this.viewH / 2 };
      const close = Math.abs(this.targetZoom - this.zoom) < this.zoom * 1e-3;
      const z = close ? this.targetZoom : this.zoom + (this.targetZoom - this.zoom) * (1 - Math.exp(-dt * 16));
      const w = this.screenToWorld(a.sx, a.sy);
      this.zoom = z;
      this.x = w.x - (a.sx - this.viewW / 2) / z;
      this.y = w.y - (a.sy - this.viewH / 2) / z;
      this.clampPosition();
      changed = true;
    }

    if (this.velX || this.velY) {
      this.panBy(this.velX * dt, this.velY * dt);
      const decay = Math.exp(-dt * 5);
      this.velX *= decay;
      this.velY *= decay;
      if (Math.hypot(this.velX, this.velY) < 8) this.velX = this.velY = 0;
      changed = true;
    }
    return changed;
  }
}

/**
 * Translates DOM input into camera moves and game callbacks.
 * handlers: { onHover(sx, sy), onLeave(), onClick(sx, sy) }
 */
export class InputController {
  constructor(canvas, camera, handlers) {
    this.canvas = canvas;
    this.camera = camera;
    this.handlers = handlers;
    this.pointers = new Map();   // pointerId → { x, y }
    this.drag = null;            // { moved, pinched, vx, vy, lastT }
    this.pinch = null;           // { dist, mx, my }
    this.box = null;             // box selection { x0, y0, x1, y1 } (Shift+drag, or two-finger long-press)
    this.boxHold = null;         // pending two-finger long-press { timer, moved }
    this.keys = new Set();
    this.rect = canvas.getBoundingClientRect();

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e, true));
    canvas.addEventListener('pointerleave', () => { if (!this.pointers.size) handlers.onLeave?.(); });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Call on resize so pointer coordinates stay correct. */
  updateRect() { this.rect = this.canvas.getBoundingClientRect(); }

  local(e) { return { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top }; }

  onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Safari can refuse capture (e.g. a finger already lifted): carry on without it.
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.camera.stop();
    // Sandbox brush: one finger / the mouse paints instead of panning.
    if (this.pointers.size === 1 && this.handlers.captureDrag?.(p.x, p.y)) {
      this.paint = { id: e.pointerId, x: p.x, y: p.y };
      this.handlers.onPaint(p.x, p.y);
      return;
    }
    if (this.paint && this.pointers.size === 2) this.paint = null; // second finger: pinch instead
    // Desktop: Shift+drag draws a selection box instead of panning.
    if (e.pointerType === 'mouse' && e.shiftKey && this.handlers.onBox && this.pointers.size === 1) {
      this.box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, mouse: true };
      this.handlers.onBoxChange?.(this.box);
      return;
    }
    if (this.pointers.size === 1) {
      this.drag = { moved: 0, pinched: false, vx: 0, vy: 0, lastT: performance.now() };
    } else if (this.pointers.size === 2) {
      this.pinch = this.pinchMetrics();
      if (this.drag) this.drag.pinched = true;
      // Phone/tablet: hold two fingers still to start a selection box between them.
      if (this.handlers.onBox && e.pointerType === 'touch') {
        clearTimeout(this.boxHold?.timer);
        this.boxHold = { moved: 0, timer: setTimeout(() => this.startTouchBox(), 450) };
      }
    }
    this.canvas.classList.add('dragging');
  }

  startTouchBox() {
    const hold = this.boxHold;
    this.boxHold = null;
    if (!hold || hold.moved > 14 || this.pointers.size !== 2) return;
    const [a, b] = [...this.pointers.values()];
    this.box = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    this.pinch = null;
    navigator.vibrate?.(15);
    this.handlers.onBoxChange?.(this.box);
  }

  onPointerMove(e) {
    const p = this.local(e);
    const prev = this.pointers.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === 'mouse') this.handlers.onHover?.(p.x, p.y);
      return;
    }
    if (this.paint && this.paint.id === e.pointerId) {
      this.pointers.set(e.pointerId, p);
      // Fill in fast strokes: a sample every ~6 px along the segment.
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - this.paint.x, p.y - this.paint.y) / 6));
      for (let i = 1; i <= steps; i++) this.handlers.onPaint(this.paint.x + ((p.x - this.paint.x) * i) / steps, this.paint.y + ((p.y - this.paint.y) * i) / steps);
      this.paint.x = p.x; this.paint.y = p.y;
      return;
    }
    if (this.box) {
      this.pointers.set(e.pointerId, p);
      if (this.box.mouse) { this.box.x1 = p.x; this.box.y1 = p.y; }
      else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        Object.assign(this.box, { x0: a.x, y0: a.y, x1: b.x, y1: b.y });
      }
      this.handlers.onBoxChange?.(this.box);
      return;
    }
    if (this.boxHold) this.boxHold.moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);

    if (this.pointers.size === 1 && this.drag) {
      const dx = p.x - prev.x, dy = p.y - prev.y;
      this.camera.panBy(dx, dy);
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      const now = performance.now();
      const dt = Math.max(1, now - this.drag.lastT) / 1000;
      // Smoothed velocity estimate for release inertia.
      this.drag.vx = this.drag.vx * 0.3 + (dx / dt) * 0.7;
      this.drag.vy = this.drag.vy * 0.3 + (dy / dt) * 0.7;
      this.drag.lastT = now;
      this.pointers.set(e.pointerId, p);
      this.handlers.onPan?.();
    } else if (this.pointers.size === 2 && this.pinch) {
      this.pointers.set(e.pointerId, p);
      const m = this.pinchMetrics();
      this.camera.setZoomAt(this.camera.zoom * (m.dist / this.pinch.dist), m.mx, m.my);
      this.camera.panBy(m.mx - this.pinch.mx, m.my - this.pinch.my);
      this.pinch = m;
      this.handlers.onPan?.();
    }
  }

  onPointerUp(e, cancelled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    if (this.boxHold) { clearTimeout(this.boxHold.timer); this.boxHold = null; }
    if (this.paint) {
      this.paint = null;
      if (!this.pointers.size) { this.drag = null; this.pinch = null; this.canvas.classList.remove('dragging'); }
      return;
    }
    if (this.box) {
      // Lifting the mouse (or either finger) applies the box.
      const box = this.box;
      this.box = null;
      if (!cancelled) this.handlers.onBox(box);
      this.handlers.onBoxChange?.(null);
      if (this.drag) this.drag.pinched = true; // the other finger's release is not a tap
      if (!this.pointers.size) { this.drag = null; this.pinch = null; this.canvas.classList.remove('dragging'); }
      return;
    }

    if (this.pointers.size === 1) {
      // Pinch ended with one finger still down: continue as a plain drag.
      this.pinch = null;
    } else if (this.pointers.size === 0) {
      const d = this.drag;
      if (d && !cancelled) {
        if (!d.pinched && d.moved < 6) {
          this.handlers.onClick?.(p.x, p.y);
        } else if (performance.now() - d.lastT < 80) {
          this.camera.setInertia(d.vx, d.vy);
        }
      }
      this.drag = null;
      this.pinch = null;
      this.canvas.classList.remove('dragging');
      if (e.pointerType === 'mouse') this.handlers.onHover?.(p.x, p.y);
    }
  }

  pinchMetrics() {
    const [a, b] = [...this.pointers.values()];
    return { dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  onWheel(e) {
    e.preventDefault();
    const p = this.local(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    // ctrlKey + wheel is how desktop trackpads report pinch gestures.
    const sensitivity = e.ctrlKey ? 0.01 : 0.0015;
    this.camera.zoomAt(Math.exp(-e.deltaY * unit * sensitivity), p.x, p.y);
  }

  onKey(e, down) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', '+', '=', '-', '_'].includes(k)) {
      if (down) this.keys.add(k); else this.keys.delete(k);
      if (k.startsWith('arrow')) e.preventDefault();
    }
  }

  /** Continuous keyboard pan/zoom. Returns true if the camera moved. */
  update(dt) {
    if (!this.keys.size) return false;
    const speed = 700 * dt;
    let dx = 0, dy = 0;
    if (this.keys.has('arrowleft')) dx += speed;
    if (this.keys.has('arrowright')) dx -= speed;
    if (this.keys.has('arrowup')) dy += speed;
    if (this.keys.has('arrowdown')) dy -= speed;
    if (dx || dy) { this.camera.flight = null; this.camera.panBy(dx, dy); }
    const cx = this.camera.viewW / 2, cy = this.camera.viewH / 2;
    if (this.keys.has('+') || this.keys.has('=')) this.camera.zoomAt(Math.exp(dt * 2.2), cx, cy);
    if (this.keys.has('-') || this.keys.has('_')) this.camera.zoomAt(Math.exp(-dt * 2.2), cx, cy);
    return true;
  }
}
