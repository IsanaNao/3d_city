import earcut from 'earcut';
import { BFLAG, KIND, ROOF } from './kinds.js';

function pairsOf(ring) {
  const src = ring.points ?? ring;
  if (Array.isArray(src) && (src.length === 0 || Array.isArray(src[0]))) return src;
  const out = [];
  for (let i = 0; i < src.length; i += 2) out.push([src[i], src[i + 1]]);
  return out;
}

function flagsOf(ring, n) {
  if (!ring.flags) return new Uint8Array(n);
  return ring.flags;
}

function createAcc() {
  return {
    pos: [], nrm: [], col: [], id: [], seed: [], base: [], top: [], kind: [], wall: [],
  };
}

// wall = (metres along the wall, wall length, glass). A negative length marks
// roofs and slabs so the facade shader leaves them without windows.
const ROOF_WALL = [0, -1];

function pushVert(acc, x, y, z, nx, ny, nz, color, a, wall = ROOF_WALL) {
  acc.pos.push(x, y, z);
  acc.nrm.push(nx, ny, nz);
  acc.col.push(color[0], color[1], color[2]);
  acc.id.push(a.id);
  acc.seed.push(a.seed);
  acc.base.push(a.base);
  acc.top.push(a.top);
  acc.kind.push(a.kind);
  acc.wall.push(wall[0], wall[1], a.glass || 0);
}

function addWall(acc, x0, z0, x1, z1, y0, y1, color, a, opts = {}) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.08 || y1 - y0 < 0.05) return;
  const nx = -dz / len;
  const nz = dx / len;
  const n0 = opts.n0 || [nx, nz];
  const n1 = opts.n1 || [nx, nz];
  const u0 = opts.u0 ?? 0;
  const u1 = opts.u1 ?? len;
  const span = opts.wallLen ?? len;
  const verts = [
    [x0, y0, z0, n0, u0], [x1, y0, z1, n1, u1], [x0, y1, z0, n0, u0],
    [x1, y0, z1, n1, u1], [x1, y1, z1, n1, u1], [x0, y1, z0, n0, u0],
  ];
  for (const p of verts) {
    pushVert(acc, p[0], p[1], p[2], p[3][0], 0, p[3][1], color, a, opts.roofLike ? ROOF_WALL : [p[4], span]);
  }
}

function ringCentroid(pts) {
  let area = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    const cross = x0 * z1 - x1 * z0;
    area += cross;
    cx += (x0 + x1) * cross;
    cz += (z0 + z1) * cross;
  }
  if (Math.abs(area) < 1e-6) {
    let sx = 0;
    let sz = 0;
    for (const [x, z] of pts) { sx += x; sz += z; }
    return [sx / pts.length, sz / pts.length];
  }
  return [cx / (3 * area), cz / (3 * area)];
}

function pushTri(acc, p0, p1, p2, color, a) {
  const ux = p1[0] - p0[0];
  const uy = p1[1] - p0[1];
  const uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0];
  const vy = p2[1] - p0[1];
  const vz = p2[2] - p0[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  let order = [p0, p1, p2];
  if (ny < 0) {
    order = [p0, p2, p1];
    nx = -nx; ny = -ny; nz = -nz;
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  for (const p of order) pushVert(acc, p[0], p[1], p[2], nx / len, ny / len, nz / len, color, a);
}

// Domes, pyramids and onion domes are lofted from the outline toward its
// centroid, so they follow the footprint instead of assuming a circle.
function addShapedRoof(acc, ring, y, height, shape, color, a) {
  const pts = pairsOf(ring);
  if (pts.length < 3) return;
  const [cx, cz] = ringCentroid(pts);
  let profile;
  if (shape === ROOF.PYRAMID) {
    profile = [[1, 0], [0, 1]];
  } else if (shape === ROOF.ONION) {
    profile = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const bulge = Math.sin(Math.PI * Math.min(1, t * 1.35)) * 0.32;
      profile.push([Math.max(0, (1 - t) ** 0.8 + bulge * (1 - t)), t]);
    }
    profile[profile.length - 1] = [0, 1];
  } else {
    profile = [];
    for (let k = 0; k <= 8; k++) {
      const th = (k / 8) * Math.PI * 0.5;
      profile.push([Math.cos(th), Math.sin(th)]);
    }
    profile[profile.length - 1] = [0, 1];
  }
  const roofColor = color.map((c) => c * 0.86);
  const at = (p, k) => [cx + (p[0] - cx) * profile[k][0], y + height * profile[k][1], cz + (p[1] - cz) * profile[k][0]];
  for (let k = 0; k < profile.length - 1; k++) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const a0 = at(p, k);
      const b0 = at(q, k);
      const a1 = at(p, k + 1);
      const b1 = at(q, k + 1);
      pushTri(acc, a0, b0, b1, roofColor, a);
      if (profile[k + 1][0] > 1e-4) pushTri(acc, a0, b1, a1, roofColor, a);
    }
  }
}

function edgeNormal(p, q) {
  const dx = q[0] - p[0];
  const dz = q[1] - p[1];
  const len = Math.hypot(dx, dz) || 1;
  return [-dz / len, dx / len];
}

// Curved facades (round towers, rounded corners) get averaged normals at
// vertices that turn less than ~25 degrees, so they shade as one surface.
function ringWalls(ring, bi, y0, y1) {
  const pts = pairsOf(ring);
  const flags = flagsOf(ring, pts.length);
  const n = pts.length;
  const normals = [];
  for (let i = 0; i < n; i++) normals.push(edgeNormal(pts[i], pts[(i + 1) % n]));
  const vertexNormal = (i, own) => {
    const prev = normals[(i - 1 + n) % n];
    const next = normals[i % n];
    const dot = prev[0] * next[0] + prev[1] * next[1];
    if (dot < 0.906) return own;
    const x = prev[0] + next[0];
    const z = prev[1] + next[1];
    const len = Math.hypot(x, z) || 1;
    return [x / len, z / len];
  };
  const walls = [];
  for (let i = 0; i < n; i++) {
    if (flags[i]) continue;
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.08) continue;
    const own = normals[i];
    walls.push({
      bi, a, b, len, y0, y1,
      nx: own[0], nz: own[1],
      n0: vertexNormal(i, own),
      n1: vertexNormal(i + 1, own),
    });
  }
  return walls;
}

const CELL = 16;

function wallCells(w) {
  const x0 = Math.floor(Math.min(w.a[0], w.b[0]) / CELL);
  const x1 = Math.floor(Math.max(w.a[0], w.b[0]) / CELL);
  const z0 = Math.floor(Math.min(w.a[1], w.b[1]) / CELL);
  const z1 = Math.floor(Math.max(w.a[1], w.b[1]) / CELL);
  const out = [];
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push(`${x},${z}`);
  return out;
}

// OSM models towers as many building:part volumes that share or nest edges.
// Coincident walls z-fight, which shows up as noise inside lit windows at
// night. For each wall, collect the spans another volume already covers.
function coverOf(w, other) {
  const dot = w.nx * other.nx + w.nz * other.nz;
  if (Math.abs(dot) < 0.998) return null;
  const dx = (w.b[0] - w.a[0]) / w.len;
  const dz = (w.b[1] - w.a[1]) / w.len;
  const off = (p) => Math.abs((p[0] - w.a[0]) * w.nx + (p[1] - w.a[1]) * w.nz);
  if (off(other.a) > 0.3 || off(other.b) > 0.3) return null;
  const ta = (other.a[0] - w.a[0]) * dx + (other.a[1] - w.a[1]) * dz;
  const tb = (other.b[0] - w.a[0]) * dx + (other.b[1] - w.a[1]) * dz;
  const t0 = Math.max(0, Math.min(ta, tb));
  const t1 = Math.min(w.len, Math.max(ta, tb));
  if (t1 - t0 < 0.05) return null;
  if (dot > 0) {
    const wins = other.y1 > w.y1 + 0.01 || (Math.abs(other.y1 - w.y1) <= 0.01 && other.bi < w.bi);
    if (!wins) return null;
  }
  return { t0, t1, y0: other.y0, y1: other.y1 };
}

function subtractRanges(y0, y1, ranges) {
  let bands = [[y0, y1]];
  for (const [c0, c1] of ranges) {
    const next = [];
    for (const [b0, b1] of bands) {
      if (c1 <= b0 + 0.02 || c0 >= b1 - 0.02) { next.push([b0, b1]); continue; }
      if (c0 > b0 + 0.02) next.push([b0, c0]);
      if (c1 < b1 - 0.02) next.push([c1, b1]);
    }
    bands = next;
    if (!bands.length) break;
  }
  return bands;
}

function towerMass(ring, base, top, kind, seed) {
  if (kind === KIND.HISTORIC || kind === KIND.INDUSTRIAL) return null;
  const height = top - base;
  if (height < 78) return null;
  const pts = pairsOf(ring);
  if (pts.length < 3 || pts.length > 28) return null;
  let cx = 0;
  let cz = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    cx += p[0];
    cz += p[1];
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[1]);
    maxZ = Math.max(maxZ, p[1]);
  }
  cx /= pts.length;
  cz /= pts.length;
  const w = maxX - minX;
  const d = maxZ - minZ;
  if (w < 18 || d < 18 || w > 120 || d > 120) return null;
  const inset = 0.055 + (seed % 5) * 0.008;
  return {
    cx,
    cz,
    podium: base + Math.min(18, height * 0.1),
    inset,
    taperAt: height > 140 ? base + height * 0.62 : null,
    taper: inset + 0.06,
  };
}

function insetCorner(p, mass, amount) {
  if (!mass || amount <= 0) return p;
  return [p[0] + (mass.cx - p[0]) * amount, p[1] + (mass.cz - p[1]) * amount];
}

function insetOf(mass, y) {
  if (!mass || y <= mass.podium + 0.2) return 0;
  if (mass.taperAt && y >= mass.taperAt) return mass.taper;
  return mass.inset;
}

function emitWall(acc, w, covers, color, attrs, mass) {
  const dx = w.b[0] - w.a[0];
  const dz = w.b[1] - w.a[1];
  const point = (t) => [w.a[0] + dx * (t / w.len), w.a[1] + dz * (t / w.len)];
  const normalAt = (t) => {
    const s = t / w.len;
    const x = w.n0[0] * (1 - s) + w.n1[0] * s;
    const z = w.n0[1] * (1 - s) + w.n1[1] * s;
    const len = Math.hypot(x, z) || 1;
    return [x / len, z / len];
  };
  const yCuts = [w.y0, w.y1];
  if (mass && mass.podium > w.y0 + 0.5 && mass.podium < w.y1 - 0.5) yCuts.push(mass.podium);
  if (mass && mass.taperAt && mass.taperAt > w.y0 + 0.5 && mass.taperAt < w.y1 - 0.5) yCuts.push(mass.taperAt);
  yCuts.sort((a, b) => a - b);
  const paint = (p, q, y0, y1, t0, t1) => {
    if (y1 - y0 < 0.2) return;
    const amount = insetOf(mass, (y0 + y1) * 0.5);
    const p0 = insetCorner(p, mass, amount);
    const q0 = insetCorner(q, mass, amount);
    addWall(acc, p0[0], p0[1], q0[0], q0[1], y0, y1, color, attrs, {
      n0: normalAt(t0), n1: normalAt(t1), u0: t0, u1: t1, wallLen: w.len,
    });
  };
  const ledge = (p, q, y, inner, outer) => {
    if (!mass || Math.abs(inner - outer) < 0.01) return;
    const a0 = insetCorner(p, mass, outer);
    const b0 = insetCorner(q, mass, outer);
    const a1 = insetCorner(p, mass, inner);
    const b1 = insetCorner(q, mass, inner);
    const slab = color.map((c) => Math.min(1, c * 0.82 + 0.08));
    pushTri(acc, [a0[0], y, a0[1]], [b0[0], y, b0[1]], [b1[0], y, b1[1]], slab, attrs);
    pushTri(acc, [a0[0], y, a0[1]], [b1[0], y, b1[1]], [a1[0], y, a1[1]], slab, attrs);
  };
  const spans = !covers.length
    ? [[point(0), point(w.len), w.y0, w.y1, 0, w.len]]
    : [];
  if (covers.length) {
    const cuts = new Set([0, w.len]);
    for (const c of covers) { cuts.add(c.t0); cuts.add(c.t1); }
    const ts = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < ts.length - 1; i++) {
      const t0 = ts[i];
      const t1 = ts[i + 1];
      if (t1 - t0 < 0.02) continue;
      const mid = (t0 + t1) / 2;
      const ranges = covers.filter((c) => c.t0 <= mid && c.t1 >= mid).map((c) => [c.y0, c.y1]);
      const p = point(t0);
      const q = point(t1);
      for (const [y0, y1] of subtractRanges(w.y0, w.y1, ranges)) spans.push([p, q, y0, y1, t0, t1]);
    }
  }
  for (const [p, q, y0, y1, t0, t1] of spans) {
    const bands = yCuts.filter((y) => y > y0 + 0.2 && y < y1 - 0.2);
    const stops = [y0, ...bands, y1];
    for (let i = 0; i < stops.length - 1; i++) {
      paint(p, q, stops[i], stops[i + 1], t0, t1);
      if (i > 0) ledge(p, q, stops[i], insetOf(mass, stops[i] + 0.3), insetOf(mass, stops[i] - 0.3));
    }
  }
}

function addRoof(acc, rings, y, color, a, facingUp) {
  const flat = [];
  const holes = [];
  const add = (ring) => {
    const pts = pairsOf(ring);
    if (pts.length < 3) return;
    if (flat.length) holes.push(flat.length / 2);
    for (const [x, z] of pts) flat.push(x, z);
  };
  add(rings[0]);
  for (let i = 1; i < rings.length; i++) add(rings[i]);
  if (flat.length < 6) return;
  const idx = earcut(flat, holes.length ? holes : null, 2);
  for (let i = 0; i < idx.length; i += 3) {
    const tri = [0, 1, 2].map((k) => {
      const vi = idx[i + k];
      return [flat[vi * 2], y, flat[vi * 2 + 1]];
    });
    const ax = tri[1][0] - tri[0][0];
    const az = tri[1][2] - tri[0][2];
    const bx = tri[2][0] - tri[0][0];
    const bz = tri[2][2] - tri[0][2];
    const ny = az * bx - ax * bz;
    const order = (facingUp ? ny < 0 : ny > 0) ? [0, 2, 1] : [0, 1, 2];
    const nny = facingUp ? 1 : -1;
    for (const k of order) {
      const p = tri[k];
      pushVert(acc, p[0], p[1], p[2], 0, nny, 0, color, a);
    }
  }
}

function addParapet(acc, ring, color, a) {
  const height = a.top - a.base;
  if (height < 6 || height > 140 || a.kind === KIND.LANDMARK) return;
  const pts = pairsOf(ring);
  const flags = flagsOf(ring, pts.length);
  if (pts.length > 48) return;
  const historic = a.kind === KIND.HISTORIC;
  const darker = color.map((c) => c * (historic ? 0.62 : 0.78));
  const lip = historic ? 1.55 : 0.75;
  const inset = historic ? 0.62 : 0.28;
  for (let i = 0; i < pts.length; i++) {
    if (flags[i]) continue;
    const a0 = pts[i];
    const b0 = pts[(i + 1) % pts.length];
    const dx = b0[0] - a0[0];
    const dz = b0[1] - a0[1];
    const len = Math.hypot(dx, dz);
    if (len < 2.5) continue;
    const nx = -dz / len;
    const nz = dx / len;
    addWall(
      acc,
      a0[0] - nx * inset, a0[1] - nz * inset,
      b0[0] - nx * inset, b0[1] - nz * inset,
      a.top, a.top + lip,
      darker, a,
    );
  }
}

function addBox(acc, cx, cz, hw, hd, y0, y1, color, a) {
  if (hw < 0.8 || hd < 0.8 || y1 - y0 < 0.4) return;
  const x0 = cx - hw;
  const x1 = cx + hw;
  const z0 = cz - hd;
  const z1 = cz + hd;
  addWall(acc, x0, z0, x1, z0, y0, y1, color, a);
  addWall(acc, x1, z0, x1, z1, y0, y1, color, a);
  addWall(acc, x1, z1, x0, z1, y0, y1, color, a);
  addWall(acc, x0, z1, x0, z0, y0, y1, color, a);
  const roof = color.map((c) => Math.min(1, c * 0.9));
  for (const v of [[x0, z0], [x1, z0], [x1, z1], [x0, z0], [x1, z1], [x0, z1]]) {
    pushVert(acc, v[0], y1, v[1], 0, 1, 0, roof, a);
  }
}

// OSM often splits a tower into short parts. Crown the part whose roof is
// locally the highest, sized from the full height so the setback reads from
// the Bund.
function addTowerCrown(acc, ring, color, a, item, prepared) {
  // Kind LANDMARK here is an ordinary named tower that was not replaced by a
  // hand-built model. Historic Bund fronts keep their own cornice.
  if (a.kind === KIND.HISTORIC || a.kind === KIND.INDUSTRIAL) return;
  const pts = pairsOf(ring);
  if (pts.length < 3 || pts.length > 28) return;
  if (a.top - a.base < 12) return;
  let cx = 0;
  let cz = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    cx += p[0];
    cz += p[1];
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[1]);
    maxZ = Math.max(maxZ, p[1]);
  }
  cx /= pts.length;
  cz /= pts.length;
  const w = maxX - minX;
  const d = maxZ - minZ;
  if (w < 16 || d < 16 || w > 110 || d > 110) return;
  for (const other of prepared || []) {
    if (other === item) continue;
    if ((other.building?.topY ?? 0) < a.top + 4) continue;
    const op = pairsOf(other.rings?.[0] || []);
    if (op.length < 3) continue;
    let ox = 0;
    let oz = 0;
    for (const p of op) { ox += p[0]; oz += p[1]; }
    ox /= op.length;
    oz /= op.length;
    if (Math.hypot(ox - cx, oz - cz) < 24) return;
  }
  const towerH = a.top - Math.min(a.base, 15);
  if (towerH < 64) return;
  const seed = a.seed || 1;
  const style = seed % 3;
  const hw = w * 0.34;
  const hd = d * 0.34;
  const crownH = Math.min(26, Math.max(12, towerH * 0.1));
  const glass = [0.58, 0.72, 0.82];
  const frame = [0.8, 0.84, 0.88];
  const slope = color.map((c) => Math.min(1, c * 0.55 + 0.22));
  if (style === 0) {
    addBox(acc, cx, cz, hw * 0.7, hd * 0.7, a.top, a.top + crownH, glass, a);
    addBox(acc, cx, cz, hw * 0.82, Math.max(1.1, hd * 0.16), a.top + crownH * 0.9, a.top + crownH + 1.4, frame, a);
    addBox(acc, cx, cz, Math.max(1.1, hw * 0.16), hd * 0.82, a.top + crownH * 0.9, a.top + crownH + 1.4, frame, a);
  } else if (style === 1) {
    const y0 = a.top;
    const y1 = a.top + crownH * 0.9;
    const x0 = cx - hw;
    const x1 = cx + hw;
    const z0 = cz - hd;
    const z1 = cz + hd;
    const inset = Math.min(hw, hd) * 0.28;
    addSlope(acc, [x0, y0, z0], [x1, y0, z0], [x1 - inset, y1, cz], [x0 + inset, y1, cz], slope, a);
    addSlope(acc, [x1, y0, z1], [x0, y0, z1], [x0 + inset, y1, cz], [x1 - inset, y1, cz], slope, a);
    addSlope(acc, [x0, y0, z1], [x0, y0, z0], [x0 + inset, y1, cz], [x0 + inset, y1, cz], slope, a);
    addSlope(acc, [x1, y0, z0], [x1, y0, z1], [x1 - inset, y1, cz], [x1 - inset, y1, cz], slope, a);
  } else {
    addBox(acc, cx, cz, hw * 0.5, hd * 0.5, a.top, a.top + crownH * 0.62, glass, a);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      addBox(acc, cx + sx * hw * 0.72, cz + sz * hd * 0.72, 1.35, 1.35, a.top, a.top + crownH, frame, a);
    }
    addBox(acc, cx, cz, hw * 0.8, 1.15, a.top + crownH - 1.5, a.top + crownH, frame, a);
    addBox(acc, cx, cz, 1.15, hd * 0.8, a.top + crownH - 1.5, a.top + crownH, frame, a);
  }
}

function addSlope(acc, p0, p1, p2, p3, color, a) {
  const q = [p0, p1, p2, p3];
  const ax = p1[0] - p0[0];
  const ay = p1[1] - p0[1];
  const az = p1[2] - p0[2];
  const bx = p2[0] - p0[0];
  const by = p2[1] - p0[1];
  const bz = p2[2] - p0[2];
  let nx = ay * bz - az * by;
  let ny = az * bx - ax * bz;
  let nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  const order = ny >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  for (const i of order) pushVert(acc, q[i][0], q[i][1], q[i][2], nx, ny, nz, color, a);
}

function addBalconies(acc, ring, color, a) {
  if (a.kind !== KIND.RESIDENTIAL) return;
  const height = a.top - a.base;
  if (height < 9 || height > 80) return;
  const pts = pairsOf(ring);
  const flags = flagsOf(ring, pts.length);
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < pts.length; i++) {
    if (flags[i]) continue;
    const a0 = pts[i];
    const b0 = pts[(i + 1) % pts.length];
    const len = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
    if (len > bestLen) { bestLen = len; best = i; }
  }
  if (best < 0 || bestLen < 8) return;
  const a0 = pts[best];
  const b0 = pts[(best + 1) % pts.length];
  const dx = (b0[0] - a0[0]) / bestLen;
  const dz = (b0[1] - a0[1]) / bestLen;
  const nx = -dz;
  const nz = dx;
  const mx = (a0[0] + b0[0]) / 2;
  const mz = (a0[1] + b0[1]) / 2;
  const half = bestLen * 0.32;
  const p = [mx - dx * half, mz - dz * half];
  const q = [mx + dx * half, mz + dz * half];
  const floors = Math.floor(height / 3.05);
  let made = 0;
  const slab = color.map((c) => Math.min(1, c * 1.05));
  for (let f = 2; f < floors && made < 7; f += 2) {
    const y = a.base + f * 3.05;
    const depth = 0.85;
    const ox = nx * depth;
    const oz = nz * depth;
    const c0 = [p[0], y, p[1]];
    const c1 = [q[0], y, q[1]];
    const c2 = [q[0] + ox, y, q[1] + oz];
    const c3 = [p[0] + ox, y, p[1] + oz];
    for (const v of [c0, c1, c2, c0, c2, c3]) pushVert(acc, v[0], v[1], v[2], 0, 1, 0, slab, a);
    addWall(acc, c3[0], c3[2], c2[0], c2[2], y - 0.12, y, slab, a, { roofLike: true });
    made += 1;
  }
}

function unpack(color) {
  return [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255];
}

function seedOf(building, index) {
  let h = (index + 1) * 131;
  const name = building.name || '';
  for (let i = 0; i < name.length; i++) h = (h * 33 + name.charCodeAt(i)) >>> 0;
  return h % 997;
}

function hasCutEdge(ring) {
  return Boolean(ring.flags && Array.prototype.some.call(ring.flags, (f) => f));
}

export function buildBuildingGeometry(buildings) {
  const acc = createAcc();
  const prepared = buildings.map((building, index) => {
    const rings = building.rings || [];
    const shaped = building.roofShape && building.roofHeight > 0 && rings.length === 1 && !hasCutEdge(rings[0]);
    const wallTop = shaped ? Math.max(building.baseY + 1, building.topY - building.roofHeight) : building.topY;
    const walls = [];
    for (const ring of rings) walls.push(...ringWalls(ring, index, building.baseY, wallTop));
    return { building, index, rings, shaped, wallTop, walls };
  });

  const grid = new Map();
  for (const item of prepared) {
    for (const w of item.walls) {
      for (const key of wallCells(w)) {
        let list = grid.get(key);
        if (!list) grid.set(key, list = []);
        list.push(w);
      }
    }
  }

  for (const item of prepared) {
    const { building, index, rings, shaped, wallTop } = item;
    if (!rings.length) continue;
    const color = unpack(building.color >>> 0);
    const attrs = {
      id: index,
      seed: seedOf(building, index),
      base: building.baseY,
      top: wallTop,
      kind: building.kind,
      glass: building.flags & BFLAG.GLASS ? 1 : 0,
    };
    const mass = towerMass(rings[0], building.baseY, wallTop, attrs.kind, attrs.seed);
    for (const w of item.walls) {
      const seen = new Set();
      const covers = [];
      for (const key of wallCells(w)) {
        for (const other of grid.get(key) || []) {
          if (other.bi === w.bi || seen.has(other)) continue;
          seen.add(other);
          const cover = coverOf(w, other);
          if (cover) covers.push(cover);
        }
      }
      emitWall(acc, w, covers, color, attrs, mass);
    }
    if (shaped) {
      addShapedRoof(acc, rings[0], wallTop, building.topY - wallTop, building.roofShape, color, attrs);
    } else if (mass) {
      const cap = mass.taperAt ? mass.taper : mass.inset;
      const pts = pairsOf(rings[0]).map((p) => insetCorner(p, mass, cap));
      addRoof(acc, [{ points: pts }], wallTop, color, attrs, true);
      addTowerCrown(acc, rings[0], color, attrs, item, prepared);
    } else {
      addRoof(acc, rings, building.topY, color, attrs, true);
      addParapet(acc, rings[0], color, attrs);
      addTowerCrown(acc, rings[0], color, attrs, item, prepared);
    }
    if (building.flags & BFLAG.FLOATING) addRoof(acc, rings, building.baseY, color, attrs, false);
    addBalconies(acc, rings[0], color, attrs);
  }
  return typed(acc);
}

const LAND_COLOR = {
  0: [0.42, 0.56, 0.36],
  1: [0.28, 0.42, 0.27],
  2: [0.1, 0.32, 0.4],
  3: [0.72, 0.7, 0.64],
  4: [0.55, 0.62, 0.38],
  5: [0.68, 0.64, 0.56],
};

export function buildLandGeometry(features, yAt) {
  const pos = [];
  const nrm = [];
  const col = [];
  for (const feature of features) {
    const base = LAND_COLOR[feature.kind] || LAND_COLOR[3];
    const rings = (feature.rings || []).map(pairsOf).filter((r) => r.length >= 3);
    if (!rings.length) continue;
    const flat = [];
    const holes = [];
    const add = (ring) => {
      if (flat.length) holes.push(flat.length / 2);
      for (const [x, z] of ring) flat.push(x, z);
    };
    add(rings[0]);
    for (let i = 1; i < rings.length; i++) add(rings[i]);
    const idx = earcut(flat, holes.length ? holes : null, 2);
    for (let i = 0; i < idx.length; i += 3) {
      const tri = [0, 1, 2].map((k) => {
        const vi = idx[i + k];
        const x = flat[vi * 2];
        const z = flat[vi * 2 + 1];
        return [x, yAt(x, z, feature.kind), z];
      });
      const ax = tri[1][0] - tri[0][0];
      const ay = tri[1][1] - tri[0][1];
      const az = tri[1][2] - tri[0][2];
      const bx = tri[2][0] - tri[0][0];
      const by = tri[2][1] - tri[0][1];
      const bz = tri[2][2] - tri[0][2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const order = ny < 0 ? [0, 2, 1] : [0, 1, 2];
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      for (const k of order) {
        const p = tri[k];
        const shade = 0.94 + 0.06 * Math.sin(p[0] * 0.09) * Math.cos(p[2] * 0.08);
        pos.push(p[0], p[1], p[2]);
        nrm.push(nx, ny, nz);
        col.push(base[0] * shade, base[1] * shade, base[2] * shade);
      }
    }
  }
  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nrm),
    color: new Float32Array(col),
  };
}

function typed(acc) {
  return {
    position: new Float32Array(acc.pos),
    normal: new Float32Array(acc.nrm),
    color: new Float32Array(acc.col),
    id: new Float32Array(acc.id),
    seed: new Float32Array(acc.seed),
    base: new Float32Array(acc.base),
    top: new Float32Array(acc.top),
    kind: new Float32Array(acc.kind),
    wall: new Float32Array(acc.wall),
  };
}
