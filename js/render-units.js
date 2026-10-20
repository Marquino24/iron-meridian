/**
 * render-units.js — Armies, routes, battles and occupation on the map.
 *
 * Called from Renderer.render():
 *   drawRoutes()  in world space, under the icons;
 *   drawForces()  in screen space, after the labels, so counters stay a
 *                 constant size and on top. It also records hit boxes for
 *                 clicking armies and battles (hitTest).
 */

import { fmtHours } from './ui-kit.js';
import { drawIcon, unitIcon } from './icons.js';
import { drawFlag, flagsVersion } from './flags.js';

/** Marker radius, gap between stacked markers, and how far markers float above their spot. */
const R = 14, GAP = 5;
const LIFT = 26;
/** Below this on-screen province size, nearby armies of one nation merge into one badge. */
const CLUSTER_PX = 34;
const CELL = 70;

/** Coarse occupancy grid so foreign markers don't pile on top of each other. */
class Occupancy {
  constructor() { this.cells = new Set(); }
  key(x, y) { return `${Math.floor(x / 30)}:${Math.floor(y / 26)}`; }
  free(x, y) { return !this.cells.has(this.key(x, y)); }
  take(x, y) { this.cells.add(this.key(x, y)); }
}

/** Route polyline for an army: where it is now, then each remaining node. */
function routePoints(A, army, path) {
  const pts = [A.armyPos(army)];
  if (army.seg && path === army.path) pts.push(A.pos[army.seg.to]);
  for (const n of path) pts.push(A.pos[n]);
  return pts;
}

/** Chevron arrows every `spacing` px along a polyline, sliding forward with `offset`. */
function chevrons(ctx, pts, px, color, spacing, offset, size) {
  const step = spacing * px, sz = size * px;
  let carry = ((offset * px) % step + step) % step;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    for (let d = carry; d < len; d += step) {
      const x = a.x + ux * d, y = a.y + uy * d;
      // Chevron: tip ahead, two wings behind.
      ctx.moveTo(x + ux * sz, y + uy * sz);
      ctx.lineTo(x - ux * sz * 0.6 - uy * sz * 0.85, y - uy * sz * 0.6 + ux * sz * 0.85);
      ctx.lineTo(x - ux * sz * 0.15, y - uy * sz * 0.15);
      ctx.lineTo(x - ux * sz * 0.6 + uy * sz * 0.85, y - uy * sz * 0.6 - ux * sz * 0.85);
      ctx.closePath();
    }
    carry = ((carry - len) % step + step) % step;
  }
  ctx.fill();
}

/** A route as a soft band with arrows running along it, ending in a target ring. */
function strokeRoute(ctx, pts, px, color, width, t, arrows = true) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = 'rgba(8,12,24,0.55)';
  ctx.lineWidth = (width + 4) * px;
  ctx.stroke();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = color;
  ctx.lineWidth = width * px;
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (arrows) chevrons(ctx, pts, px, color, 16 + width * 2, t * 26, 3 + width * 0.9);
  // Destination marker.
  const end = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(end.x, end.y, 6.5 * px, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(8,12,24,0.8)';
  ctx.lineWidth = 4.5 * px;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2 * px;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(end.x, end.y, 2.2 * px, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Wars as dashed lines between the two capitals, when zoomed out (they fade
 * in below ~50 px per province). Red for other nations' wars, orange for yours.
 */
function drawWarLines(r, ctx, px) {
  const C = r.sim.combat;
  if (!r.showWarLines || !C.wars.size || r.state.phase !== 'playing') return;
  const provincePx = r.state.map.provinceScale * r.camera.zoom;
  const alpha = Math.max(0, Math.min(1, (55 - provincePx) / 20));
  if (alpha <= 0) return;
  const map = r.state.map, me = r.state.playerNationId;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const k of C.wars) {
    const [a, b] = k.split(':').map(Number);
    const pa = map.provinces[map.nations[a]?.capitalId]?.center, pb = map.provinces[map.nations[b]?.capitalId]?.center;
    if (!pa || !pb) continue;
    const mine = a === me || b === me;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(5,8,10,0.6)';
    ctx.lineWidth = 4.5 * px;
    ctx.stroke();
    ctx.setLineDash([8 * px, 6 * px]);
    ctx.strokeStyle = mine ? '#ff9a3d' : '#ff4a3a';
    ctx.lineWidth = 2.2 * px;
    ctx.stroke();
    for (const p of [pa, pb]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5 * px, 0, Math.PI * 2);
      ctx.fillStyle = mine ? '#ff9a3d' : '#ff4a3a';
      ctx.fill();
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
}

/** World space: routes of the player's moving armies (arrow trails), the selected one bold, plus the hover preview. */
export function drawRoutes(r, ctx, px) {
  const sim = r.sim;
  if (!sim) return;
  drawWarLines(r, ctx, px);
  const A = sim.armies, C = sim.combat, st = r.state;
  const t = r.animFps() ? performance.now() / 1000 : 0;
  const sel = A.list.get(st.selectedArmyId);
  const group = st.armyGroup;
  const provincePx = st.map.provinceScale * r.camera.zoom;
  for (const army of A.list.values()) {
    if (army === sel || (!army.seg && !army.path.length)) continue;
    if (army.nation === st.playerNationId) {
      const picked = group?.has(army.id);
      strokeRoute(ctx, routePoints(A, army, army.path), px, picked ? '#ffd54a' : 'rgba(255,226,150,0.85)', picked ? 2.6 : 1.8, t);
    } else if (army.seg && provincePx >= 10 && C.atWar(st.playerNationId, army.nation)) {
      // Enemy columns: a short red arrow to where they're heading next.
      strokeRoute(ctx, [A.armyPos(army), A.pos[army.seg.to]], px, '#ff5a4a', 1.8, t);
    }
  }
  const pv = A.preview;
  if (sel && pv && pv.armyId === sel.id && pv.path && pv.node !== sel.dest) {
    const pts = [A.armyPos(sel), ...(pv.reverse ? [A.pos[sel.seg.from]] : sel.seg ? [A.pos[sel.seg.to]] : []), ...pv.path.map((n) => A.pos[n])];
    strokeRoute(ctx, pts, px, '#5ee6ff', 2, t);
  }
  if (sel && (sel.seg || sel.path.length)) {
    strokeRoute(ctx, routePoints(A, sel, sel.path), px, sel.retreating ? '#ff8a7a' : '#ffd54a', 3.2, t);
  }
}

/** Screen space: army markers (or merged badges when zoomed out), battles, occupation rings, ETA tags, box selection. */
export function drawForces(r) {
  const sim = r.sim;
  r.hits = [];
  if (!sim || r.state.phase !== 'playing') return;
  const { ctx, camera: cam, state: st } = r;
  const A = sim.armies, C = sim.combat;
  const player = st.playerNationId;
  const provincePx = st.map.provinceScale * cam.zoom;
  const W = cam.viewW, H = cam.viewH, M = 60;
  const onScreen = (s) => s.x > -M && s.y > -M && s.x < W + M && s.y < H + M;
  const occ = new Occupancy();
  const anim = r.animFps() > 0;
  const time = anim ? performance.now() / 1000 : 0;
  const eraId = st.era?.id;
  const group = st.armyGroup;

  const visible = (a) => {
    if (a.id === st.selectedArmyId || group?.has(a.id)) return true;
    if (a.nation === player) return a.garrison && !C.inBattle(a) ? provincePx >= 10 : true;
    if (C.inBattle(a)) return true;
    // Other nations' garrisons only once you're zoomed in close (they'd bury the map otherwise).
    if (C.atWar(player, a.nation)) return provincePx >= (a.garrison ? 24 : 10);
    return provincePx >= (a.garrison ? 60 : 24);
  };

  // Occupation rings (under the markers).
  for (const [pid, o] of C.occupations) {
    const s = cam.worldToScreen(A.pos[pid].x, A.pos[pid].y);
    if (!onScreen(s)) continue;
    s.y -= LIFT;
    const t = Math.min(1, o.done / o.total);
    ctx.beginPath();
    ctx.arc(s.x, s.y, R + 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,12,24,0.4)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(8,12,24,0.8)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s.x, s.y, R + 9, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
    ctx.strokeStyle = o.nation === player ? '#ffd54a' : '#ff5a4a';
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  // Zoomed out: merge each nation's armies per screen cell into one badge.
  const clustering = provincePx < CLUSTER_PX;
  const clusters = new Map();

  // Stationary armies stack side by side at their node; moving ones sit on their route.
  const stacks = new Map();
  const moving = [];
  for (const a of A.list.values()) {
    if (!visible(a)) continue;
    if (clustering && !C.inBattle(a) && a.id !== st.selectedArmyId) {
      const p = A.armyPos(a);
      const s = cam.worldToScreen(p.x, p.y);
      if (!onScreen(s)) continue;
      const key = `${a.nation}:${Math.floor(s.x / CELL)}:${Math.floor(s.y / CELL)}`;
      let c = clusters.get(key);
      if (!c) clusters.set(key, (c = { nation: a.nation, armies: [], x: 0, y: 0, wx: 0, wy: 0 }));
      c.armies.push(a);
      c.x += s.x; c.y += s.y; c.wx += p.x; c.wy += p.y;
      continue;
    }
    if (a.seg) moving.push(a);
    else {
      if (!stacks.has(a.node)) stacks.set(a.node, []);
      stacks.get(a.node).push(a);
    }
  }
  // A cell holding a single army just draws that army.
  for (const [key, c] of clusters) {
    if (c.armies.length > 1) continue;
    clusters.delete(key);
    const a = c.armies[0];
    if (a.seg) moving.push(a);
    else {
      if (!stacks.has(a.node)) stacks.set(a.node, []);
      stacks.get(a.node).push(a);
    }
  }

  const drawn = [];
  const pins = [];
  const place = (a, x, y, force) => {
    if (!force && !occ.free(x, y)) return;
    occ.take(x, y);
    drawn.push([a, x, y]);
  };
  // Player first so it wins any overlap.
  const order = [...stacks.entries()].sort((p, q) => Number(q[1].some((a) => a.nation === player)) - Number(p[1].some((a) => a.nation === player)));
  for (const [node, list] of order) {
    const s = cam.worldToScreen(A.pos[node].x, A.pos[node].y);
    if (!onScreen(s)) continue;
    list.sort((a, b) => (a.nation === player) - (b.nation === player) || a.id - b.id);
    const n = list.length;
    const step = R * 2 + GAP;
    pins.push(s);
    list.forEach((a, i) => place(a, s.x + (i - (n - 1) / 2) * step, s.y - LIFT, a.nation === player || C.inBattle(a)));
  }
  for (const a of moving) {
    const p = A.armyPos(a);
    const s = cam.worldToScreen(p.x, p.y);
    if (!onScreen(s)) continue;
    pins.push(s);
    place(a, s.x, s.y - LIFT, a.nation === player);
  }

  // Pin stems from each spot up to its markers.
  ctx.lineCap = 'round';
  for (const s of pins) {
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x, s.y - LIFT + R);
    ctx.strokeStyle = 'rgba(8,12,24,0.8)';
    ctx.lineWidth = 3.4;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + 0.5, 4, 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,12,24,0.55)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s.x, s.y, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  // Merged badges.
  for (const c of clusters.values()) {
    const n = c.armies.length;
    const x = c.x / n, y = c.y / n - 8;
    const units = c.armies.reduce((t, a) => t + a.units.length, 0);
    const str = c.armies.reduce((t, a) => t + A.strength(a), 0) / n;
    const roles = {};
    for (const a of c.armies) { const role = a.kind === 'naval' ? 'nav' : A.mainRole(a); roles[role] = (roles[role] ?? 0) + a.units.length; }
    const role = Object.entries(roles).sort((p, q) => q[1] - p[1])[0][0];
    const picked = c.armies.some((a) => group?.has(a.id));
    drawMarker(r, x, y, R + 3, {
      icon: unitIcon(eraId, role), nation: st.map.nations[c.nation], own: c.nation === player,
      hostile: C.atWar(player, c.nation), selected: picked, count: units, strength: str, stack: n,
    });
    r.hits.push({ kind: 'cluster', ids: c.armies.map((a) => a.id), nation: c.nation, wx: c.wx / n, wy: c.wy / n, x0: x - R - 6, y0: y - R - 6, x1: x + R + 10, y1: y + R + 10 });
  }

  const sel = st.selectedArmyId;
  for (const [a, x, y] of drawn) {
    const role = a.kind === 'naval' ? 'nav' : A.mainRole(a);
    drawMarker(r, x, y, R, {
      icon: unitIcon(eraId, role), nation: st.map.nations[a.nation], own: a.nation === player,
      hostile: C.atWar(player, a.nation), selected: a.id === sel || !!group?.has(a.id),
      count: a.units.length, strength: A.strength(a), retreating: a.retreating,
    });
    r.hits.push({ kind: 'army', id: a.id, x0: x - R - 3, y0: y - R - 6, x1: x + R + 8, y1: y + R + 5 });
  }

  // Battles: an animated clash over the fight.
  for (const b of C.active.values()) {
    const p = A.pos[b.node];
    const s = cam.worldToScreen(p.x, p.y);
    if (!onScreen(s)) continue;
    const y = s.y - LIFT - R - 20;
    drawClash(ctx, s.x, y, s.x, s.y - LIFT, time, anim, b.id);
    r.hits.push({ kind: 'battle', id: b.id, x0: s.x - 18, y0: y - 18, x1: s.x + 18, y1: y + 18 });
  }

  // ETA tag at the end of the selected army's route (and the hover preview).
  const army = A.list.get(sel);
  if (army && army.nation === player) {
    const pv = A.preview;
    if (pv && pv.armyId === army.id && pv.node !== army.dest) {
      if (pv.error) tagAt(r, A.pos[pv.node], pv.peace != null ? 'AT PEACE' : 'NO ROUTE', '#ff8a7a');
      else if (pv.path) tagAt(r, A.pos[pv.node], `ETA ${fmtHours(pv.hours)}`, '#5ee6ff');
    }
    if (army.dest != null && (army.seg || army.path.length)) {
      tagAt(r, A.pos[army.dest], `ETA ${fmtHours(A.remainingHours(army))}`, '#ffd54a');
    }
  }

  // Box selection in progress.
  const box = r.selectBox;
  if (box) {
    const x = Math.min(box.x0, box.x1), y = Math.min(box.y0, box.y1);
    const w = Math.abs(box.x1 - box.x0), h = Math.abs(box.y1 - box.y0);
    ctx.fillStyle = 'rgba(255,213,74,0.12)';
    ctx.fillRect(x, y, w, h);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#ffd54a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([]);
  }
}

function tagAt(r, p, text, color) {
  const { ctx, camera: cam } = r;
  const s = cam.worldToScreen(p.x, p.y);
  ctx.font = '700 12px "Rajdhani", system-ui, sans-serif';
  const w = ctx.measureText(text).width + 16;
  const x = s.x - w / 2, y = s.y + 12;
  ctx.beginPath();
  ctx.roundRect(x, y, w, 20, 10);
  ctx.fillStyle = 'rgba(12,18,34,0.9)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, s.x, y + 10.5);
}

/**
 * Army marker: a round badge with the main unit type's icon inside a
 * nation-coloured ring, a unit-count pill and a small HP bar. The body is a
 * cached sprite; the count and bar are drawn live.
 */
function drawMarker(r, x, y, rad, o) {
  const ctx = r.ctx;
  const color = o.nation?.color ?? '#888';
  const state = o.selected ? 'sel' : o.hostile ? 'host' : o.own ? 'own' : 'other';
  const pad = 7;
  const S = (rad + pad) * 2;
  const sprite = r.fx.sprite(`mk|${o.icon}|${o.nation?.id}|${state}|${rad}|${!!o.stack}|${flagsVersion()}`, S, S, (g) => {
    const m = S / 2;
    if (state === 'sel' || state === 'host' || state === 'own') {
      const glow = state === 'sel' ? '255,213,74' : state === 'host' ? '255,70,50' : '255,255,255';
      const grd = g.createRadialGradient(m, m, rad * 0.8, m, m, rad + pad);
      grd.addColorStop(0, `rgba(${glow},${state === 'own' ? 0.35 : 0.75})`);
      grd.addColorStop(1, `rgba(${glow},0)`);
      g.fillStyle = grd;
      g.fillRect(0, 0, S, S);
    }
    if (o.stack) {
      // Merged badge: a second disc peeking out behind.
      g.beginPath();
      g.arc(m + 4, m - 4, rad, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      g.strokeStyle = 'rgba(8,12,24,0.8)';
      g.lineWidth = 1.5;
      g.stroke();
    }
    g.beginPath();
    g.arc(m, m + 1.2, rad + 0.5, 0, Math.PI * 2);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fill();
    // Ring in the nation's colour.
    g.beginPath();
    g.arc(m, m, rad, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.lineWidth = 1.2;
    g.strokeStyle = state === 'sel' ? '#ffd54a' : state === 'host' ? '#ff4a3a' : 'rgba(8,12,24,0.9)';
    if (state === 'sel' || state === 'host') g.lineWidth = 2;
    g.stroke();
    // Glossy dark face.
    const face = g.createLinearGradient(0, m - rad, 0, m + rad);
    face.addColorStop(0, '#3a4866');
    face.addColorStop(1, '#141b2c');
    g.beginPath();
    g.arc(m, m, rad - 3.2, 0, Math.PI * 2);
    g.fillStyle = face;
    g.fill();
    g.beginPath();
    g.ellipse(m, m - rad * 0.42, rad * 0.62, rad * 0.32, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fill();
    drawIcon(g, o.icon, m, m, rad * 1.36, '#ffffff');
    // The nation's flag, small, on the upper left of the ring.
    if (o.nation) {
      const fw = rad * 0.95, fh = fw * 2 / 3;
      drawFlag(g, o.nation.flag, m - rad - 1, m - rad - 1, fw, fh);
    }
  });
  ctx.drawImage(sprite, x - S / 2, y - S / 2, S, S);
  if (o.retreating) {
    ctx.beginPath();
    ctx.arc(x, y, rad - 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,70,50,0.35)';
    ctx.fill();
  }
  // HP bar under the marker.
  const bw = rad * 1.9, bx = x - bw / 2, by = y + rad + 2;
  ctx.beginPath();
  ctx.roundRect(bx - 1, by - 1, bw + 2, 5, 2.5);
  ctx.fillStyle = 'rgba(8,12,24,0.85)';
  ctx.fill();
  const str = Math.max(0, Math.min(1, o.strength));
  if (str > 0) {
    ctx.beginPath();
    ctx.roundRect(bx, by, bw * str, 3, 1.5);
    ctx.fillStyle = str > 0.6 ? '#4be37a' : str > 0.3 ? '#ffc53d' : '#ff4f3d';
    ctx.fill();
  }
  // Unit-count pill, top right.
  const text = o.count > 999 ? `${Math.round(o.count / 100) / 10}k` : String(o.count);
  ctx.font = '700 10.5px "Rajdhani", system-ui, sans-serif';
  const tw = Math.max(14, ctx.measureText(text).width + 8);
  const px0 = x + rad * 0.55, py0 = y - rad - 2;
  ctx.beginPath();
  ctx.roundRect(px0, py0, tw, 14, 7);
  ctx.fillStyle = o.own ? '#ffd54a' : o.hostile ? '#ff4a3a' : '#f4f6fb';
  ctx.fill();
  ctx.strokeStyle = 'rgba(8,12,24,0.9)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = o.hostile ? '#ffffff' : '#141b2c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, px0 + tw / 2, py0 + 7.5);
}

/** Small deterministic hash → 0..1 (for spark directions). */
function rnd(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * Battle: crossed swords in a pulsing red badge, with sparks and small
 * explosions bursting over the armies below (static on Low quality).
 */
function drawClash(ctx, x, y, gx, gy, t, anim, seed) {
  if (anim) {
    // Explosions: puffs over the armies, each flashing, growing and fading on its own cycle.
    for (let i = 0; i < 3; i++) {
      const cyc = t * 0.8 + i / 3;
      const k = cyc % 1, id = Math.floor(cyc) * 7 + i + seed * 31;
      const ex = gx + (rnd(id) - 0.5) * 44, ey = gy - 4 + (rnd(id + 1) - 0.5) * 18;
      const rad = 7 + k * 22;
      const a = 1 - k;
      const grd = ctx.createRadialGradient(ex, ey, 0, ex, ey, rad);
      grd.addColorStop(0, `rgba(255,252,220,${a})`);
      grd.addColorStop(0.3, `rgba(255,190,60,${a * 0.95})`);
      grd.addColorStop(0.65, `rgba(230,80,20,${a * 0.6})`);
      grd.addColorStop(1, 'rgba(60,30,20,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(ex, ey, rad, 0, Math.PI * 2);
      ctx.fill();
      if (k < 0.5) {
        ctx.beginPath();
        ctx.arc(ex, ey, rad * 1.25, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,230,160,${(0.5 - k) * 1.2})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    // Sparks flying out of the clash.
    ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const cyc = t * 1.6 + i / 14;
      const k = cyc % 1, id = Math.floor(cyc) * 13 + i + seed * 17;
      const ang = rnd(id) * Math.PI * 2, dist = 15 + k * (18 + rnd(id + 3) * 16);
      const sx = x + Math.cos(ang) * dist, sy = y + Math.sin(ang) * dist + k * k * 10;
      ctx.strokeStyle = `rgba(255,${210 + Math.round(rnd(id + 5) * 45)},110,${1 - k * 0.9})`;
      ctx.lineWidth = 2.6 - k * 1.4;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - Math.cos(ang) * 7, sy - Math.sin(ang) * 7);
      ctx.stroke();
    }
  }
  const pulse = anim ? 0.5 + 0.5 * Math.sin(t * 6) : 0.5;
  const glow = ctx.createRadialGradient(x, y, 8, x, y, 24 + pulse * 4);
  glow.addColorStop(0, 'rgba(255,80,40,0.7)');
  glow.addColorStop(1, 'rgba(255,80,40,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, 28, 0, Math.PI * 2);
  ctx.fill();
  const body = ctx.createLinearGradient(0, y - 15, 0, y + 15);
  body.addColorStop(0, '#ff6a4d');
  body.addColorStop(1, '#a3140a');
  ctx.beginPath();
  ctx.arc(x, y, 14 + pulse * 1.5, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffe1a6';
  ctx.stroke();
  drawIcon(ctx, 'swords', x, y, 19, '#ffffff');
}

/** Topmost army or battle under a screen point. */
export function hitTest(r, sx, sy) {
  const hits = r.hits ?? [];
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (sx >= h.x0 && sx <= h.x1 && sy >= h.y0 && sy <= h.y1) return h;
  }
  return null;
}
