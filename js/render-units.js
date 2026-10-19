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

const ICON_W = 30, ICON_H = 20, GAP = 4;
/** Counters float this far above their spot (like a map pin) so city icons and names stay readable. */
const LIFT = 22;

/** Coarse occupancy grid so foreign counters don't pile on top of each other. */
class Occupancy {
  constructor() { this.cells = new Set(); }
  key(x, y) { return `${Math.floor(x / 26)}:${Math.floor(y / 18)}`; }
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

function strokeRoute(ctx, pts, px, color, width, dash) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(5,8,10,0.75)';
  ctx.lineWidth = (width + 3) * px;
  ctx.stroke();
  ctx.setLineDash(dash.map((d) => d * px));
  ctx.strokeStyle = color;
  ctx.lineWidth = width * px;
  ctx.stroke();
  ctx.setLineDash([]);
  // Destination marker.
  const end = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(end.x, end.y, 6 * px, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(5,8,10,0.8)';
  ctx.lineWidth = 4.5 * px;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * px;
  ctx.stroke();
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

/** World space: routes of the player's moving armies, the selected one bold, plus the hover preview. */
export function drawRoutes(r, ctx, px) {
  const sim = r.sim;
  if (!sim) return;
  drawWarLines(r, ctx, px);
  const A = sim.armies, st = r.state;
  const sel = A.list.get(st.selectedArmyId);
  for (const army of A.list.values()) {
    if (army.nation !== st.playerNationId || army === sel || (!army.seg && !army.path.length)) continue;
    strokeRoute(ctx, routePoints(A, army, army.path), px, 'rgba(255,214,140,0.55)', 1.6, [5, 5]);
  }
  const pv = A.preview;
  if (sel && pv && pv.armyId === sel.id && pv.path && pv.node !== sel.dest) {
    const pts = [A.armyPos(sel), ...(pv.reverse ? [A.pos[sel.seg.from]] : sel.seg ? [A.pos[sel.seg.to]] : []), ...pv.path.map((n) => A.pos[n])];
    strokeRoute(ctx, pts, px, 'rgba(111,211,224,0.9)', 2, [7, 5]);
  }
  if (sel && (sel.seg || sel.path.length)) {
    strokeRoute(ctx, routePoints(A, sel, sel.path), px, sel.retreating ? '#ff8a7a' : '#ffc766', 3, [9, 6]);
  }
}

/** Screen space: counters, battle markers, occupation rings, ETA tags. */
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
  const time = performance.now() / 1000;

  const visible = (a) => {
    if (a.id === st.selectedArmyId) return true;
    if (a.nation === player) return a.garrison && !C.inBattle(a) ? provincePx >= 10 : true;
    if (C.inBattle(a)) return true;
    return provincePx >= (C.atWar(player, a.nation) ? 10 : 24);
  };

  // Occupation rings (under the counters).
  for (const [pid, o] of C.occupations) {
    const s = cam.worldToScreen(A.pos[pid].x, A.pos[pid].y);
    if (!onScreen(s)) continue;
    s.y -= LIFT;
    const t = Math.min(1, o.done / o.total);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 22, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(5,8,10,0.45)';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(5,8,10,0.85)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s.x, s.y, 22, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
    ctx.strokeStyle = o.nation === player ? '#ffc766' : '#ff6b5b';
    ctx.lineWidth = 3.5;
    ctx.stroke();
  }

  // Stationary armies stack side by side at their node; moving ones sit on their route.
  const stacks = new Map();
  const moving = [];
  for (const a of A.list.values()) {
    if (!visible(a)) continue;
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
    const step = ICON_W + GAP;
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

  // Pin stems from each spot up to its counters.
  ctx.lineCap = 'round';
  for (const s of pins) {
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x, s.y - LIFT + ICON_H / 2);
    ctx.strokeStyle = 'rgba(5,8,10,0.85)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(244,239,224,0.9)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s.x, s.y, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0e10';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s.x, s.y, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f4efe0';
    ctx.fill();
  }

  const sel = st.selectedArmyId;
  for (const [a, x, y] of drawn) {
    drawCounter(r, A, a, x, y, {
      selected: a.id === sel,
      own: a.nation === player,
      hostile: C.atWar(player, a.nation),
    });
    r.hits.push({ kind: 'army', id: a.id, x0: x - ICON_W / 2 - 4, y0: y - ICON_H / 2 - 8, x1: x + ICON_W / 2 + 8, y1: y + ICON_H / 2 + 4 });
  }

  // Battles: crossed swords over the fight.
  for (const b of C.active.values()) {
    const p = A.pos[b.node];
    const s = cam.worldToScreen(p.x, p.y);
    if (!onScreen(s)) continue;
    const y = s.y - LIFT - ICON_H / 2 - 18;
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    drawSwords(ctx, s.x, y, pulse);
    r.hits.push({ kind: 'battle', id: b.id, x0: s.x - 16, y0: y - 16, x1: s.x + 16, y1: y + 16 });
  }

  // ETA tag at the end of the selected army's route (and the hover preview).
  const army = A.list.get(sel);
  if (army && army.nation === player) {
    const pv = A.preview;
    if (pv && pv.armyId === army.id && pv.node !== army.dest) {
      if (pv.error) tagAt(r, A.pos[pv.node], pv.peace != null ? 'AT PEACE' : 'NO ROUTE', '#ff8a7a');
      else if (pv.path) tagAt(r, A.pos[pv.node], `ETA ${fmtHours(pv.hours)}`, '#6fd3e0');
    }
    if (army.dest != null && (army.seg || army.path.length)) {
      tagAt(r, A.pos[army.dest], `ETA ${fmtHours(A.remainingHours(army))}`, '#ffc766');
    }
  }
}

function tagAt(r, p, text, color) {
  const { ctx, camera: cam } = r;
  const s = cam.worldToScreen(p.x, p.y);
  ctx.font = '600 12px "Share Tech Mono", ui-monospace, monospace';
  const w = ctx.measureText(text).width + 12;
  const x = s.x - w / 2, y = s.y + 12;
  ctx.fillStyle = 'rgba(5,8,10,0.88)';
  ctx.fillRect(x, y, w, 18);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 17);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, s.x, y + 9.5);
}

/** NATO-style counter in the nation's colour with a unit-count badge. */
function drawCounter(r, A, army, x, y, { selected, own, hostile }) {
  const ctx = r.ctx;
  const nation = r.state.map.nations[army.nation];
  const x0 = Math.round(x - ICON_W / 2), y0 = Math.round(y - ICON_H / 2);
  if (selected) {
    ctx.fillStyle = 'rgba(255,199,102,0.35)';
    ctx.fillRect(x0 - 5, y0 - 5, ICON_W + 10, ICON_H + 10);
  }
  ctx.fillStyle = selected ? '#ffc766' : hostile ? '#ff5a48' : own ? '#f4efe0' : '#0a0e10';
  ctx.fillRect(x0 - 2, y0 - 2, ICON_W + 4, ICON_H + 4);
  ctx.fillStyle = '#0a0e10';
  ctx.fillRect(x0 - 1, y0 - 1, ICON_W + 2, ICON_H + 2);
  ctx.fillStyle = nation.color;
  ctx.fillRect(x0, y0, ICON_W, ICON_H);
  // Symbol frame.
  const fx = x0 + 4, fy = y0 + 4, fw = ICON_W - 8, fh = ICON_H - 8;
  ctx.fillStyle = 'rgba(244,239,224,0.92)';
  ctx.fillRect(fx, fy, fw, fh);
  ctx.strokeStyle = '#11161a';
  ctx.fillStyle = '#11161a';
  ctx.lineWidth = 1.4;
  const role = army.kind === 'naval' ? 'nav' : A.mainRole(army);
  ctx.beginPath();
  if (role === 'inf') {
    ctx.moveTo(fx, fy); ctx.lineTo(fx + fw, fy + fh);
    ctx.moveTo(fx + fw, fy); ctx.lineTo(fx, fy + fh);
    ctx.stroke();
  } else if (role === 'mob') {
    ctx.ellipse(fx + fw / 2, fy + fh / 2, fw * 0.36, fh * 0.32, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (role === 'rng') {
    ctx.arc(fx + fw / 2, fy + fh / 2, 2.4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Hull.
    ctx.moveTo(fx + 2, fy + fh * 0.45);
    ctx.lineTo(fx + fw - 2, fy + fh * 0.45);
    ctx.lineTo(fx + fw - 5, fy + fh - 1);
    ctx.lineTo(fx + 5, fy + fh - 1);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(fx + fw / 2 - 1, fy + 1, 2, fh * 0.45);
  }
  if (army.retreating) {
    ctx.fillStyle = 'rgba(255,90,72,0.35)';
    ctx.fillRect(x0, y0, ICON_W, ICON_H);
  }
  // Strength bar along the bottom.
  const str = A.strength(army);
  ctx.fillStyle = '#0a0e10';
  ctx.fillRect(x0, y0 + ICON_H - 2, ICON_W, 3);
  ctx.fillStyle = str > 0.6 ? '#7fdc8f' : str > 0.3 ? '#ffc766' : '#ff6b5b';
  ctx.fillRect(x0, y0 + ICON_H - 2, ICON_W * str, 3);
  // Unit-count badge.
  const n = army.units.length;
  const bx = x0 + ICON_W + 1, by = y0 - 1;
  ctx.beginPath();
  ctx.arc(bx, by, n > 9 ? 8 : 7, 0, Math.PI * 2);
  ctx.fillStyle = '#0a0e10';
  ctx.fill();
  ctx.strokeStyle = nation.color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#f4efe0';
  ctx.font = '700 10px "Rajdhani", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), bx, by + 0.5);
}

function drawSwords(ctx, x, y, pulse) {
  ctx.beginPath();
  ctx.arc(x, y, 13 + pulse * 2, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(160,24,16,${0.75 + pulse * 0.2})`;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#ffd1c8';
  ctx.stroke();
  ctx.lineCap = 'round';
  for (const d of [1, -1]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((d * Math.PI) / 4);
    ctx.strokeStyle = '#f4efe0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(0, 6);          // blade
    ctx.moveTo(-3.5, 4); ctx.lineTo(3.5, 4);       // guard
    ctx.stroke();
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(0, 5); ctx.lineTo(0, 8.5);          // grip
    ctx.stroke();
    ctx.restore();
  }
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
