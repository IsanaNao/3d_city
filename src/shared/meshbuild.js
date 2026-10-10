import earcut from 'earcut';
import { BFLAG, KIND } from './kinds.js';

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
    pos: [], nrm: [], col: [], id: [], seed: [], base: [], top: [], kind: [],
  };
}

function pushVert(acc, x, y, z, nx, ny, nz, color, a) {
  acc.pos.push(x, y, z);
  acc.nrm.push(nx, ny, nz);
  acc.col.push(color[0], color[1], color[2]);
  acc.id.push(a.id);
  acc.seed.push(a.seed);
  acc.base.push(a.base);
  acc.top.push(a.top);
  acc.kind.push(a.kind);
}

function addWall(acc, x0, z0, x1, z1, y0, y1, color, a) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.08 || y1 - y0 < 0.05) return;
  const nx = -dz / len;
  const nz = dx / len;
  const verts = [
    [x0, y0, z0], [x1, y0, z1], [x0, y1, z0],
    [x1, y0, z1], [x1, y1, z1], [x0, y1, z0],
  ];
  for (const p of verts) pushVert(acc, p[0], p[1], p[2], nx, 0, nz, color, a);
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
  const darker = color.map((c) => c * 0.78);
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
    const inset = 0.28;
    addWall(
      acc,
      a0[0] - nx * inset, a0[1] - nz * inset,
      b0[0] - nx * inset, b0[1] - nz * inset,
      a.top, a.top + 0.75,
      darker, a,
    );
  }
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
    addWall(acc, c3[0], c3[2], c2[0], c2[2], y - 0.12, y, slab, a);
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

export function buildBuildingGeometry(buildings) {
  const acc = createAcc();
  buildings.forEach((building, index) => {
    const color = unpack(building.color >>> 0);
    const attrs = {
      id: index,
      seed: seedOf(building, index),
      base: building.baseY,
      top: building.topY,
      kind: building.kind,
    };
    const rings = building.rings || [];
    if (!rings.length) return;
    for (const ring of rings) {
      const pts = pairsOf(ring);
      const flags = flagsOf(ring, pts.length);
      for (let i = 0; i < pts.length; i++) {
        if (flags[i]) continue;
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        addWall(acc, a[0], a[1], b[0], b[1], building.baseY, building.topY, color, attrs);
      }
    }
    addRoof(acc, rings, building.topY, color, attrs, true);
    if (building.flags & BFLAG.FLOATING) addRoof(acc, rings, building.baseY, color, attrs, false);
    addParapet(acc, rings[0], color, attrs);
    addBalconies(acc, rings[0], color, attrs);
  });
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
  };
}
