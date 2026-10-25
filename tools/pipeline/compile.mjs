import fs from 'node:fs';
import path from 'node:path';
import { TILE, boundsFromBbox, makeProjection, tileKey, tileRect } from '../../src/shared/geo.js';
import { KIND, LAND, PROP, ROAD } from '../../src/shared/kinds.js';
import { findLandmarks, hiddenByLandmark } from '../../src/shared/landmarks.js';
import { collectBridges } from './bridges.mjs';
import { mulberry32 } from '../../src/shared/rng.js';
import { decodeTerrain, encodeTerrain, sampleGrid } from '../../src/shared/terrain.js';
import { encodeTile } from '../../src/shared/tileformat.js';
import { resolveArea } from './config.mjs';
import { buildRoadGraph } from './graph.mjs';
import {
  centroid, clipPolygon, clipPolyline, ensureWinding, finalizeRing, offsetSides,
  pointInPoly, polygonArea, polylineLength, resamplePolyline, ringBBox,
} from './geom.mjs';
import { liftAlong, parseCity } from './osm.mjs';

function tilesOverlapping(bbox, tile = TILE) {
  if (!Number.isFinite(bbox.minX)) return [];
  const tx0 = Math.floor(bbox.minX / tile);
  const tx1 = Math.floor((Math.max(bbox.minX, bbox.maxX) - 1e-4) / tile);
  const tz0 = Math.floor(bbox.minZ / tile);
  const tz1 = Math.floor((Math.max(bbox.minZ, bbox.maxZ) - 1e-4) / tile);
  const out = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let tz = tz0; tz <= tz1; tz++) out.push([tx, tz]);
  }
  return out;
}

function intersectRect(a, b) {
  return {
    minX: Math.max(a.minX, b.minX),
    maxX: Math.min(a.maxX, b.maxX),
    minZ: Math.max(a.minZ, b.minZ),
    maxZ: Math.min(a.maxZ, b.maxZ),
  };
}

function createBuckets() {
  const map = new Map();
  const get = (tx, tz) => {
    const key = tileKey(tx, tz);
    if (!map.has(key)) {
      map.set(key, {
        tx, tz, buildings: [], land: [], props: [],
        roads: { verts: [], indices: [] },
      });
    }
    return map.get(key);
  };
  return { map, get };
}

function ny(a, b, c) {
  return (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
}

function addTri(mesh, a, b, c) {
  if (ny(a, b, c) < 0) [b, c] = [c, b];
  const base = mesh.verts.length / 7;
  for (const v of [a, b, c]) {
    mesh.verts.push(v.x, v.y, v.z, v.across, v.along, v.cls, v.flags);
  }
  mesh.indices.push(base, base + 1, base + 2);
}

function roadAttrs(p, a, b, y0, y1, half, along0, segLen, cls, flags) {
  const abx = b[0] - a[0];
  const abz = b[1] - a[1];
  const len2 = abx * abx + abz * abz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / len2));
  const cx = a[0] + abx * t;
  const cz = a[1] + abz * t;
  const rlen = Math.hypot(abx, abz) || 1;
  const rx = -abz / rlen;
  const rz = abx / rlen;
  return {
    x: p[0],
    y: y0 + (y1 - y0) * t,
    z: p[1],
    across: ((p[0] - cx) * rx + (p[1] - cz) * rz) / (half || 1),
    along: along0 + segLen * t,
    cls,
    flags,
  };
}

function appendStrip(buckets, points, ys, half, cls, flags, areaRect) {
  if (!points || points.length < 2 || half < 0.2) return;
  const { left, right } = offsetSides(points, half);
  let along = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const segLen = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]) || 0.01;
    const quad = [left[i], right[i], right[i + 1], left[i + 1]];
    for (const [tx, tz] of tilesOverlapping(ringBBox(quad))) {
      const rect = intersectRect(tileRect(tx, tz), areaRect);
      if (rect.maxX <= rect.minX || rect.maxZ <= rect.minZ) continue;
      const clipped = clipPolygon(quad, rect);
      if (clipped.length < 3) continue;
      const mesh = buckets.get(tx, tz).roads;
      const attrs = clipped.map((p) => roadAttrs(p, points[i], points[i + 1], ys[i], ys[i + 1], half, along, segLen, cls, flags));
      for (let k = 1; k < attrs.length - 1; k++) addTri(mesh, attrs[0], attrs[k], attrs[k + 1]);
    }
    along += segLen;
  }
}

function appendSkirt(buckets, points, ys, half, drop, areaRect, cls = ROAD.MOTORWAY, flags = 1) {
  const { left, right } = offsetSides(points, half);
  const sides = [left, right];
  for (const side of sides) {
    let along = 0;
    for (let i = 0; i < side.length - 1; i++) {
      const segLen = Math.hypot(side[i + 1][0] - side[i][0], side[i + 1][1] - side[i][1]) || 0.01;
      const y0 = ys[Math.min(i, ys.length - 1)];
      const y1 = ys[Math.min(i + 1, ys.length - 1)];
      const quad3 = [
        { x: side[i][0], y: y0, z: side[i][1], across: 1, along, cls, flags },
        { x: side[i + 1][0], y: y1, z: side[i + 1][1], across: 1, along: along + segLen, cls, flags },
        { x: side[i + 1][0], y: y1 - drop, z: side[i + 1][1], across: 1, along: along + segLen, cls, flags },
        { x: side[i][0], y: y0 - drop, z: side[i][1], across: 1, along, cls, flags },
      ];
      const flat = quad3.map((p) => [p.x, p.z]);
      for (const [tx, tz] of tilesOverlapping(ringBBox(flat))) {
        const rect = intersectRect(tileRect(tx, tz), areaRect);
        const clipped = clipPolygon(flat, rect);
        if (clipped.length < 3) continue;
        const mesh = buckets.get(tx, tz).roads;
        const attrs = clipped.map((p) => {
          const abx = side[i + 1][0] - side[i][0];
          const abz = side[i + 1][1] - side[i][1];
          const len2 = abx * abx + abz * abz || 1;
          const t = Math.max(0, Math.min(1, ((p[0] - side[i][0]) * abx + (p[1] - side[i][1]) * abz) / len2));
          return {
            x: p[0], y: y0 + (y1 - y0) * t - drop * 0.5, z: p[1],
            across: 1, along: along + segLen * t, cls: ROAD.MOTORWAY, flags: 1,
          };
        });
        // The clip loses the vertical extent. Emit an unclipped vertical quad when the
        // segment sits fully inside one tile; otherwise skip the skirt rather than flatten it.
        const midX = (side[i][0] + side[i + 1][0]) / 2;
        const midZ = (side[i][1] + side[i + 1][1]) / 2;
        if (midX < rect.minX || midX > rect.maxX || midZ < rect.minZ || midZ > rect.maxZ) continue;
        if (clipped.length < 3) continue;
        addTri(mesh, quad3[0], quad3[1], quad3[2]);
        addTri(mesh, quad3[0], quad3[2], quad3[3]);
        void attrs;
      }
      along += segLen;
    }
  }
}

function clipRings(rings, rect, areaRect) {
  if (!rings.length) return null;
  const outer = clipPolygon(rings[0], rect);
  const fin = finalizeRing(outer, rect, areaRect, true);
  if (!fin || polygonArea(fin.points) < 4) return null;
  const out = [fin];
  for (let i = 1; i < rings.length; i++) {
    const hole = finalizeRing(clipPolygon(rings[i], rect), rect, areaRect, false);
    if (hole && polygonArea(hole.points) > 1) out.push(hole);
  }
  return out;
}

// SRTM draws the Huangpu as a ramp hundreds of metres wide. The water mesh only
// shows where that ramp is already below the water line, so the channel looks
// like a grey beach. Flatten every wet cell to one bed and lift the smeared
// bank back up to the street, leaving a flood wall instead of a slope.
export function carveWater(grid, waters) {
  const boxed = [];
  for (const w of waters) {
    const ring = w.rings?.[0];
    if (!ring || ring.length < 3) continue;
    const box = ringBBox(ring);
    boxed.push({ ring, ...box });
  }
  if (!boxed.length) return null;
  const { cols, rows, originX, originZ, step } = grid;
  const n = cols * rows;
  const inside = new Uint8Array(n);
  const insideIdx = [];
  for (let r = 0; r < rows; r++) {
    const z = originZ + r * step;
    for (let c = 0; c < cols; c++) {
      const x = originX + c * step;
      let hit = false;
      for (const b of boxed) {
        if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
        if (pointInPoly(x, z, b.ring)) { hit = true; break; }
      }
      if (!hit) continue;
      const i = r * cols + c;
      inside[i] = 1;
      insideIdx.push(i);
    }
  }
  if (insideIdx.length < 3) return null;

  const wet = insideIdx.map((i) => grid.heights[i]).filter((h) => Number.isFinite(h)).sort((a, b) => a - b);
  if (wet.length < 3) return null;
  const low = wet[Math.floor(wet.length * 0.2)];
  const bed = low - 1.5;

  const REACH = 12;
  const dist = new Int16Array(n);
  dist.fill(-1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (const i of insideIdx) {
    dist[i] = 0;
    queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++];
    const d = dist[i];
    if (d >= REACH) continue;
    const c = i % cols;
    const r = (i - c) / cols;
    if (c > 0 && dist[i - 1] < 0) { dist[i - 1] = d + 1; queue[tail++] = i - 1; }
    if (c + 1 < cols && dist[i + 1] < 0) { dist[i + 1] = d + 1; queue[tail++] = i + 1; }
    if (r > 0 && dist[i - cols] < 0) { dist[i - cols] = d + 1; queue[tail++] = i - cols; }
    if (r + 1 < rows && dist[i + cols] < 0) { dist[i + cols] = d + 1; queue[tail++] = i + cols; }
  }

  const ringH = [];
  for (let i = 0; i < n; i++) {
    if (dist[i] <= 0 || dist[i] > 8) continue;
    const h = grid.heights[i];
    if (Number.isFinite(h)) ringH.push(h);
  }
  ringH.sort((a, b) => a - b);
  const p80 = ringH.length ? ringH[Math.min(ringH.length - 1, Math.floor(ringH.length * 0.82))] : 11;
  const bank = Math.max(8, Math.min(16, p80));

  for (const i of insideIdx) grid.heights[i] = bed;
  for (let i = 0; i < n; i++) {
    if (dist[i] <= 0 || dist[i] > REACH) continue;
    if (grid.heights[i] < Math.min(bank - 2.2, 8.5)) grid.heights[i] = bank;
  }
  return { waterLevel: bed + 1.75, bank };
}

// Bund west bank and the Lujiazui shore get a hard wall. Other edges stay as they are.
// The east bank bends west toward the Suzhou Creek mouth, so the x window reaches past -980.
function frontageKind(mx, mz, ox) {
  if (ox < -0.22 && mz > -1100 && mz < 1000 && mx < -500) return 'bund';
  if (ox > 0.18 && mz > -1550 && mz < 1150 && mx > -1200 && mx < 700) return 'lujiazui';
  return null;
}

// A one-vertex jog out and back reads as a notch in the wall. Drop that point.
function despike(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const bcx = c.x - b.x;
    const bcz = c.z - b.z;
    const lab = Math.hypot(abx, abz) || 1;
    const lbc = Math.hypot(bcx, bcz) || 1;
    const dot = abx * bcx + abz * bcz;
    if (dot < -0.2 * lab * lbc && Math.min(lab, lbc) < 45) continue;
    out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function stitchBank(segments) {
  const pool = segments.map((seg) => ({ ...seg, used: false }));
  const lines = [];
  // A dropped corner step leaves a gap of about one sample. Bridge that, not a dock mouth.
  const near = (p, q) => Math.hypot(p.x - q.x, p.z - q.z) < 36;
  for (const seed of pool) {
    if (seed.used) continue;
    seed.used = true;
    const line = [
      { x: seed.a[0], z: seed.a[1], ox: seed.ox, oz: seed.oz },
      { x: seed.b[0], z: seed.b[1], ox: seed.ox, oz: seed.oz },
    ];
    let grew = true;
    while (grew) {
      grew = false;
      const head = line[0];
      const tail = line[line.length - 1];
      for (const seg of pool) {
        if (seg.used || seg.id !== seed.id) continue;
        const a = { x: seg.a[0], z: seg.a[1], ox: seg.ox, oz: seg.oz };
        const b = { x: seg.b[0], z: seg.b[1], ox: seg.ox, oz: seg.oz };
        if (near(a, tail)) { line.push(b); seg.used = true; grew = true; }
        else if (near(b, tail)) { line.push(a); seg.used = true; grew = true; }
        else if (near(b, head)) { line.unshift(a); seg.used = true; grew = true; }
        else if (near(a, head)) { line.unshift(b); seg.used = true; grew = true; }
      }
    }
    const slim = [line[0]];
    for (let i = 1; i < line.length; i++) {
      const prev = slim[slim.length - 1];
      if (Math.hypot(line[i].x - prev.x, line[i].z - prev.z) >= 10 || i === line.length - 1) slim.push(line[i]);
    }
    const shore = despike(slim);
    if (shore.length >= 2) {
      let length = 0;
      for (let i = 1; i < shore.length; i++) length += Math.hypot(shore[i].x - shore[i - 1].x, shore[i].z - shore[i - 1].z);
      if (length >= 40) lines.push({ id: seed.id, width: seed.id === 'bund' ? 46 : 22, points: shore });
    }
  }
  return lines;
}

// Water polygons extend past the downloaded area. Keep the wall on the map.
function trimEmbankments(lines, rect) {
  const pad = 40;
  const inside = (p) => p.x >= rect.minX - pad && p.x <= rect.maxX + pad
    && p.z >= rect.minZ - pad && p.z <= rect.maxZ + pad;
  const out = [];
  for (const line of lines) {
    let run = [];
    const flush = () => {
      if (run.length < 2) { run = []; return; }
      let length = 0;
      for (let i = 1; i < run.length; i++) length += Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z);
      if (length >= 40) out.push({ ...line, points: run });
      run = [];
    };
    for (const p of line.points) {
      if (inside(p)) run.push(p);
      else flush();
    }
    flush();
  }
  return out;
}

// Vertical flood wall and a raised walk along the Bund and the Lujiazui shore.
// Riverside greens (滨江公园, 陆家嘴绿地) are tagged as parks down to the water,
// but the real edge there is still the flood wall. The lawn stays behind the walk.
export function collectEmbankments(land) {
  const segments = [];
  const waters = land.filter((f) => f.kind === LAND.WATER && f.rings?.[0] && polygonArea(f.rings[0]) > 80000);
  for (const water of waters) {
    const ring = water.rings[0];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 4) continue;
      const steps = Math.max(1, Math.ceil(len / 28));
      for (let s = 0; s < steps; s++) {
        const p0 = [a[0] + dx * (s / steps), a[1] + dz * (s / steps)];
        const p1 = [a[0] + dx * ((s + 1) / steps), a[1] + dz * ((s + 1) / steps)];
        const mx = (p0[0] + p1[0]) / 2;
        const mz = (p0[1] + p1[1]) / 2;
        const slen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
        let ox = -(p1[1] - p0[1]) / slen;
        let oz = (p1[0] - p0[0]) / slen;
        if (pointInPoly(mx + ox * 5, mz + oz * 5, ring)) { ox = -ox; oz = -oz; }
        if (pointInPoly(mx + ox * 5, mz + oz * 5, ring)) continue;
        const id = frontageKind(mx, mz, ox);
        if (!id) continue;
        segments.push({ id, a: p0, b: p1, ox, oz });
      }
    }
  }
  return stitchBank(segments);
}

// A paved strip along the outside of a wide channel, so the bank meets the
// water. The Bund and Lujiazui frontages are walls instead, built separately.
export function bankQuays(land) {
  const waters = land.filter((f) => f.kind === LAND.WATER && f.rings?.[0] && polygonArea(f.rings[0]) > 80000);
  const quays = [];
  for (const water of waters) {
    const ring = water.rings[0];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 3) continue;
      const steps = Math.max(1, Math.ceil(len / 36));
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps;
        const t1 = (s + 1) / steps;
        const p0 = [a[0] + dx * t0, a[1] + dz * t0];
        const p1 = [a[0] + dx * t1, a[1] + dz * t1];
        const mx = (p0[0] + p1[0]) / 2;
        const mz = (p0[1] + p1[1]) / 2;
        const slen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
        let ox = -(p1[1] - p0[1]) / slen;
        let oz = (p1[0] - p0[0]) / slen;
        if (pointInPoly(mx + ox * 5, mz + oz * 5, ring)) { ox = -ox; oz = -oz; }
        if (pointInPoly(mx + ox * 5, mz + oz * 5, ring)) continue;
        if (frontageKind(mx, mz, ox)) continue;
        const bund = ox < -0.35 && mz > -1200 && mz < 1100;
        const depth = bund ? 48 : 16;
        const near = 1.2;
        const q0 = [p0[0] + ox * near, p0[1] + oz * near];
        const q1 = [p1[0] + ox * near, p1[1] + oz * near];
        const q2 = [p1[0] + ox * (near + depth), p1[1] + oz * (near + depth)];
        const q3 = [p0[0] + ox * (near + depth), p0[1] + oz * (near + depth)];
        const farX = mx + ox * (near + depth);
        const farZ = mz + oz * (near + depth);
        if (pointInPoly(farX, farZ, ring)) continue;
        quays.push({ kind: LAND.PLAZA, rings: [ensureWinding([q0, q1, q2, q3], true)] });
      }
    }
  }
  land.push(...quays);
  return quays.length;
}

function eastEdge(building) {
  let edge = -Infinity;
  for (const p of building.rings[0]) if (p[0] > edge) edge = p[0];
  return edge;
}

function westEdge(building) {
  let edge = Infinity;
  for (const p of building.rings[0]) if (p[0] < edge) edge = p[0];
  return edge;
}

function bundBuff(id) {
  const factor = 0.92 + ((Math.abs(id) * 13) % 11) / 100;
  const channel = (value) => Math.max(0, Math.min(255, Math.round(value * factor)));
  return ((channel(0xd2) << 16) | (channel(0xbe) << 8) | channel(0xa0)) >>> 0;
}

// The facade steps west as it goes north. A straight guide keeps an inland
// block from joining just because it is the easternmost thing on its block.
function bundGuide(z) {
  return -1168 + (z + 500) * 0.155;
}

function riverYaw(ring) {
  let best = 0;
  let yaw = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len > best) {
      best = len;
      yaw = Math.atan2(-dz, dx);
    }
  }
  return { yaw, len: best };
}

export function markBundRow(buildings) {
  const pool = [];
  for (const building of buildings) {
    const c = building.centroid;
    if (!c || building.kind === KIND.LANDMARK) continue;
    const height = building.topY - building.baseY;
    if (height < 15 || height > 55) continue;
    if (c[1] < -540 || c[1] > 430) continue;
    if (c[0] < -1320 || c[0] > -1000) continue;
    if (building.area < 280 || building.area > 8000) continue;
    const depth = eastEdge(building) - westEdge(building);
    if (depth < 16 || depth > 90) continue;
    const edge = eastEdge(building);
    const guide = bundGuide(building.centroid[1]);
    if (edge < guide - 88 || edge > guide + 26) continue;
    pool.push(building);
  }
  const frontAt = (z) => {
    let face = null;
    for (const building of pool) {
      if (Math.abs(building.centroid[1] - z) >= 55) continue;
      const edge = eastEdge(building);
      if (face == null || edge > face) face = edge;
    }
    return face;
  };
  const front = [];
  for (const building of pool) {
    const face = frontAt(building.centroid[1]);
    if (face == null) continue;
    const edge = eastEdge(building);
    if (edge < face - 30) continue;
    building.kind = KIND.HISTORIC;
    building.color = bundBuff(building.id);
    front.push(building);
  }
  front.sort((a, b) => a.centroid[1] - b.centroid[1]);
  front.forEach((building, index) => {
    const name = building.name || '';
    if (/轮船招商局|盘谷/.test(name)) building.cupola = 1;
    else if (/友邦|外滩六号|外滩6号/.test(name)) building.cupola = 0;
    else if (/农业银行/.test(name)) building.cupola = 0;
    else if (/清算所/.test(name)) building.cupola = 2;
    else if (/浦东发展|公共服务/.test(name)) building.cupola = -1;
    else building.cupola = index % 4 === 3 ? -1 : index % 4;
  });
  return front;
}

function stitchLines(items) {
  const groups = new Map();
  for (const item of items) {
    const key = `${item.ref || item.name || item.id}|${item.tunnel ? 1 : 0}|${item.bridge ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      points: item.points.map((p) => p.slice()),
      y: item.y.slice(),
      ref: item.ref, name: item.name, tunnel: item.tunnel, bridge: item.bridge,
    });
  }
  const lines = [];
  const near = (a, ia, b, ib) => Math.hypot(a.points[ia][0] - b.points[ib][0], a.points[ia][1] - b.points[ib][1]) < 1.2;
  for (const group of groups.values()) {
    const pool = group;
    while (pool.length) {
      let cur = pool.pop();
      let moved = true;
      while (moved) {
        moved = false;
        for (let i = 0; i < pool.length; i++) {
          const other = pool[i];
          const n = cur.points.length - 1;
          const m = other.points.length - 1;
          if (near(cur, n, other, 0)) {
            cur.points.push(...other.points.slice(1));
            cur.y.push(...other.y.slice(1));
          } else if (near(cur, n, other, m)) {
            cur.points.push(...other.points.slice(0, -1).reverse());
            cur.y.push(...other.y.slice(0, -1).reverse());
          } else if (near(cur, 0, other, m)) {
            cur.points = other.points.concat(cur.points.slice(1));
            cur.y = other.y.concat(cur.y.slice(1));
          } else if (near(cur, 0, other, 0)) {
            cur.points = other.points.slice().reverse().concat(cur.points.slice(1));
            cur.y = other.y.slice().reverse().concat(cur.y.slice(1));
          } else continue;
          pool.splice(i, 1);
          moved = true;
          break;
        }
      }
      if (polylineLength(cur.points) > 40) lines.push(cur);
    }
  }
  return lines;
}

function junctionPoints(roads) {
  const count = new Map();
  const at = new Map();
  for (const road of roads) {
    if (!road.drive) continue;
    for (const end of [road.points[0], road.points.at(-1)]) {
      const key = `${Math.round(end[0] / 3)}|${Math.round(end[1] / 3)}`;
      count.set(key, (count.get(key) || 0) + 1);
      at.set(key, end);
    }
  }
  return [...count.entries()].filter(([, n]) => n >= 2).map(([key]) => at.get(key));
}

function placeProps(buildings, roads, land, sampleHeight, signals = []) {
  const props = [];
  let trees = 0;
  let lamps = 0;
  const waters = land.filter((f) => f.kind === LAND.WATER).map((f) => f.rings[0]);
  const blocked = (x, z) => waters.some((ring) => pointInPoly(x, z, ring));
  const junctions = junctionPoints(roads);
  const nearJunction = (x, z, rad) => junctions.some((j) => (j[0] - x) ** 2 + (j[1] - z) ** 2 < rad * rad);
  const shells = [];
  for (const building of buildings) {
    const ring = building.rings?.[0];
    if (!ring || ring.length < 3 || !Array.isArray(ring[0])) continue;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of ring) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minZ) minZ = p[1];
      if (p[1] > maxZ) maxZ = p[1];
    }
    shells.push({ ring, minX, maxX, minZ, maxZ });
  }
  const insideBuilding = (px, pz) => {
    for (const shell of shells) {
      if (px < shell.minX || px > shell.maxX || pz < shell.minZ || pz > shell.maxZ) continue;
      if (pointInPoly(px, pz, shell.ring)) return true;
    }
    return false;
  };

  const treeRoads = [
    ...roads.filter((road) => /中山东/.test(road.name || '')),
    ...roads.filter((road) => !/中山东/.test(road.name || '')),
  ];
  for (const road of treeRoads) {
    if (!road.drive) continue;
    const treeStep = /中山东/.test(road.name || '') ? 10
      : road.cls === ROAD.RESIDENTIAL || road.cls === ROAD.SERVICE ? 8 : 12;
    let walked = 0;
    let nextTree = treeStep * 0.45;
    let nextLamp = 8;
    let nextPier = 12;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) continue;
      const dx = (b[0] - a[0]) / len;
      const dz = (b[1] - a[1]) / len;
      const rx = -dz;
      const rz = dx;
      const at = (dist) => {
        const t = dist - walked;
        return [a[0] + dx * t, a[1] + dz * t];
      };
      if (!road.bridge && road.cls !== ROAD.MOTORWAY) {
        const bundBoulevard = /中山东/.test(road.name || '');
        while (nextTree < walked + len && trees < 5200) {
          const [x, z] = at(nextTree);
          const y = road.y ? road.y[i - 1] : sampleHeight(x, z) + (road.lift || 0);
          const side = bundBoulevard
            ? road.width * 0.5 + 1.5
            : road.width * 0.5 + Math.max(road.sidewalk || 2.8, 2.2) - 0.7;
          if (!nearJunction(x, z, bundBoulevard ? 3.5 : 9)) {
            // Plane trees stand on the building side of the Bund boulevard, west of the curb.
            const sides = bundBoulevard ? [rx >= 0 ? -1 : 1] : [-1, 1];
            for (const s of sides) {
              let tx = x + rx * side * s;
              let tz = z + rz * side * s;
              if (bundBoulevard) {
                for (let n = 0; n < 5 && insideBuilding(tx, tz); n++) {
                  tx -= rx * s * 1.3;
                  tz -= rz * s * 1.3;
                }
                if (insideBuilding(tx, tz)) continue;
              }
              if (!blocked(tx, tz)) {
                props.push({
                  kind: PROP.TREE, variant: trees % 3, x: tx, y, z: tz,
                  rot: (trees * 0.7) % 6.28,
                  scale: bundBoulevard ? 1.55 + (trees % 4) * 0.1 : 0.82 + (trees % 5) * 0.07,
                  extra: 1,
                });
                trees += 1;
              }
            }
          }
          nextTree += treeStep;
        }
        while (nextLamp < walked + len && lamps < 2200 && road.cls !== ROAD.SERVICE) {
          const [x, z] = at(nextLamp);
          const y = road.y ? road.y[i - 1] : sampleHeight(x, z);
          const side = road.width * 0.5 + Math.max(road.sidewalk || 0, 0.6) - 0.35;
          if (!nearJunction(x, z, 7)) {
            for (const s of [-1, 1]) {
              props.push({
                kind: PROP.LAMP, variant: 0,
                x: x + rx * side * s, y, z: z + rz * side * s,
                rot: Math.atan2(dx, dz), scale: 1, extra: 8,
              });
              lamps += 1;
            }
          }
          nextLamp += 30;
        }
      }
      if (road.bridge && road.drive) {
        while (nextPier < walked + len) {
          const t = (nextPier - walked) / len;
          const [x, z] = at(nextPier);
          const deck = road.y[i - 1] + (road.y[i] - road.y[i - 1]) * t;
          const ground = sampleHeight(x, z);
          const clearance = deck - ground;
          // No piers in the river: the long crossings span it (Nanpu and
          // Yangpu are cable-stayed, Waibaidu's one pier is modelled).
          if (clearance > 2.4 && !blocked(x, z)) {
            props.push({
              kind: PROP.PIER, variant: 0, x, y: ground, z,
              rot: Math.atan2(dx, dz), scale: 0.85, extra: clearance,
            });
          }
          nextPier += 22;
        }
      }
      walked += len;
    }
  }

  for (const road of roads) {
    if (!road.ribbon || !road.bridge || !road.y) continue;
    let walked = 0;
    let nextPier = road.ring ? 6 : 10;
    const spacing = road.ring ? 20 : 26;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) continue;
      while (nextPier < walked + len) {
        const t = (nextPier - walked) / len;
        const x = a[0] + (b[0] - a[0]) * t;
        const z = a[1] + (b[1] - a[1]) * t;
        const deck = road.y[i - 1] + (road.y[i] - road.y[i - 1]) * t;
        const ground = sampleHeight(x, z);
        const clearance = deck - ground;
        if (clearance > 2.2 && !blocked(x, z)) {
          props.push({
            kind: PROP.PIER, variant: 0, x, y: ground, z,
            rot: Math.atan2(b[0] - a[0], b[1] - a[1]),
            scale: road.ring ? 0.7 : 0.55,
            extra: clearance,
          });
        }
        nextPier += spacing;
      }
      walked += len;
    }
  }

  for (const signal of signals) {
    let rot = 0;
    let best = 36 * 36;
    for (const road of roads) {
      if (!road.drive) continue;
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1];
        const b = road.points[i];
        const mx = (a[0] + b[0]) / 2;
        const mz = (a[1] + b[1]) / 2;
        const d = (mx - signal.x) ** 2 + (mz - signal.z) ** 2;
        if (d < best) {
          best = d;
          rot = Math.atan2(b[0] - a[0], b[1] - a[1]);
        }
      }
    }
    const rx = -Math.cos(rot);
    const rz = Math.sin(rot);
    props.push({
      kind: PROP.LIGHT, variant: 0,
      x: signal.x + rx * 7, y: sampleHeight(signal.x, signal.z), z: signal.z + rz * 7,
      rot, scale: 1, extra: 0,
    });
  }

  for (const feature of land) {
    if (feature.kind !== LAND.PARK && feature.kind !== LAND.WOOD) continue;
    const ring = feature.rings[0];
    const area = polygonArea(ring);
    if (area < 80 || area > 250000) continue;
    const box = ringBBox(ring);
    const spacing = area > 80000 ? 18 : 14;
    const rng = mulberry32(Math.round(box.minX * 10 + box.minZ));
    for (let x = box.minX; x <= box.maxX && trees < 5600; x += spacing) {
      for (let z = box.minZ; z <= box.maxZ && trees < 5600; z += spacing) {
        const jx = x + (rng() - 0.5) * spacing * 0.8;
        const jz = z + (rng() - 0.5) * spacing * 0.8;
        if (!pointInPoly(jx, jz, ring) || blocked(jx, jz)) continue;
        props.push({
          kind: PROP.TREE, variant: Math.floor(rng() * 3), x: jx, y: sampleHeight(jx, jz), z: jz,
          rot: rng() * 6.28, scale: 1.05 + rng() * 0.7, extra: 1,
        });
        trees += 1;
      }
    }
  }

  for (const building of buildings) {
    const height = building.topY - building.baseY;
    const outer = building.rings[0];
    const rng = mulberry32(building.id * 97 + 3);
    const c = building.centroid || centroid(outer);
    if (building.kind === KIND.HISTORIC && building.cupola >= 0 && !building.roofShape) {
      const { yaw, len } = riverYaw(outer);
      let variant = building.cupola;
      if (variant === 2 && len < 28) variant = 0;
      const span = Math.min(12, Math.max(6.2, len * 0.2));
      props.push({
        kind: PROP.CUPOLA,
        variant,
        x: c[0],
        y: building.topY,
        z: c[1],
        rot: yaw,
        scale: span,
        extra: variant === 1 ? span * 1.05 : span * 0.78,
      });
    }
    if (building.kind !== KIND.HISTORIC && height > 14 && building.area > 50 && !building.roofShape) {
      if (height > 220) {
        props.push({ kind: PROP.PENTHOUSE, variant: 1, x: c[0], y: building.topY, z: c[1], rot: 0, scale: 7, extra: 14 });
      } else {
        props.push({
          kind: PROP.PENTHOUSE, variant: 0, x: c[0], y: building.topY, z: c[1],
          rot: rng() * Math.PI, scale: 2.4 + rng() * 2.4, extra: 2 + rng() * 1.4,
        });
      }
      const n = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const ang = rng() * Math.PI * 2;
        const rad = 1.5 + rng() * 4;
        props.push({
          kind: rng() > 0.5 ? PROP.AC : PROP.TANK,
          variant: 0,
          x: c[0] + Math.cos(ang) * rad,
          y: building.topY,
          z: c[1] + Math.sin(ang) * rad,
          rot: rng() * 6.28,
          scale: 0.7 + rng() * 0.6,
          extra: 0.6 + rng() * 0.5,
        });
      }
    }
    if ((building.kind === 3 || building.kind === 6) && height > 6 && height < 80) {
      let best = 0;
      let bestLen = 0;
      for (let i = 0; i < outer.length; i++) {
        const a = outer[i];
        const b = outer[(i + 1) % outer.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len > bestLen) { bestLen = len; best = i; }
      }
      if (bestLen > 8) {
        const a = outer[best];
        const b = outer[(best + 1) % outer.length];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        props.push({
          kind: PROP.SIGN,
          variant: building.id % 8,
          x: (a[0] + b[0]) / 2 + nx * 0.35,
          y: building.baseY + 3.15,
          z: (a[1] + b[1]) / 2 + nz * 0.35,
          rot: Math.atan2(nx, nz),
          scale: Math.min(8, bestLen * 0.62),
          extra: 1.45,
        });
      }
    }
  }
  return props;
}

// SRTM and Terrarium treat towers as terrain. On Shanghai's flat delta that
// lifts whole blocks onto mounds, so untrusted cells (building footprints and
// heights far from the lower quartile) are filled from neighbouring ground.
export function settleGround(grid, rings) {
  const { cols, rows, originX, originZ, step } = grid;
  const heights = Float32Array.from(grid.heights);
  const finite = [];
  for (let i = 0; i < heights.length; i++) {
    if (Number.isFinite(heights[i])) finite.push(heights[i]);
  }
  finite.sort((a, b) => a - b);
  if (!finite.length) return { ...grid, heights };
  const q25 = finite[Math.floor((finite.length - 1) * 0.25)];
  const low = q25 - 8;
  const high = q25 + 8;
  const boxed = rings
    .filter((ring) => ring && ring.length >= 3)
    .map((ring) => ({ ring, box: ringBBox(ring) }));
  const known = new Uint8Array(heights.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const h = heights[i];
      if (!Number.isFinite(h) || h < low || h > high) continue;
      const x = originX + c * step;
      const z = originZ + r * step;
      const onBuilding = boxed.some(({ ring, box }) => x >= box.minX && x <= box.maxX
        && z >= box.minZ && z <= box.maxZ && pointInPoly(x, z, ring));
      if (!onBuilding) known[i] = 1;
    }
  }
  let trustCount = 0;
  for (let i = 0; i < known.length; i++) trustCount += known[i];
  if (trustCount < heights.length * 0.12) return { ...grid, heights };

  const out = Float32Array.from(heights);
  const limit = Math.max(cols, rows);
  for (let pass = 0; pass < limit; pass++) {
    let filled = 0;
    const next = out.slice();
    const nextKnown = known.slice();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (known[i]) continue;
        let sum = 0;
        let count = 0;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const cc = c + dc;
          const rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
          const j = rr * cols + cc;
          if (!known[j]) continue;
          sum += out[j];
          count += 1;
        }
        if (!count) continue;
        next[i] = sum / count;
        nextKnown[i] = 1;
        filled += 1;
      }
    }
    out.set(next);
    known.set(nextKnown);
    if (!filled) break;
  }
  return { ...grid, heights: out };
}

function cameraPresets(buildings, bounds) {
  let focus = null;
  for (const building of buildings) {
    const h = building.topY - building.baseY;
    if (!focus || h > focus.h) focus = { x: building.centroid[0], z: building.centroid[1], h };
  }
  if (!focus) {
    focus = {
      x: (bounds.minX + bounds.maxX) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2,
      h: 48,
    };
  }
  const span = Math.max(bounds.maxX - bounds.minX, 480);
  return [
    {
      id: 'overview',
      name: '俯瞰',
      position: [focus.x - span * 0.04, Math.max(460, span * 0.4), focus.z + span * 0.26],
      target: [focus.x, Math.min(70, focus.h * 0.1), focus.z - span * 0.04],
    },
    {
      id: 'bund',
      name: '外滩',
      position: [focus.x - 460, 130, focus.z + 150],
      target: [focus.x, Math.min(120, focus.h * 0.18), focus.z],
    },
    {
      id: 'lujiazui',
      name: '陆家嘴',
      position: [focus.x + 220, 165, focus.z + 260],
      target: [focus.x, Math.min(150, focus.h * 0.22), focus.z],
    },
  ];
}

export function refineGrid(grid, step) {
  if (!step || step >= grid.step) return grid;
  const width = (grid.cols - 1) * grid.step;
  const depth = (grid.rows - 1) * grid.step;
  const cols = Math.floor(width / step) + 1;
  const rows = Math.floor(depth / step) + 1;
  const heights = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      heights[r * cols + c] = sampleGrid(grid, grid.originX + c * step, grid.originZ + r * step);
    }
  }
  return { ...grid, step, cols, rows, heights };
}

export function compileDataset({ area, elements, grid: rawGrid, demSource = '' }) {
  const grid = refineGrid(rawGrid, area.terrainStep);
  const proj = makeProjection(area.origin[0], area.origin[1]);
  const bounds = boundsFromBbox(proj, area.bbox);
  const areaRect = { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ };
  const rough = parseCity(elements, proj, (x, z) => sampleGrid(grid, x, z));
  const settled = settleGround(grid, rough.buildings.map((building) => building.rings[0]));
  const carved = {
    ...settled,
    heights: Float32Array.from(settled.heights),
  };
  const hydro = carveWater(carved, rough.land.filter((f) => f.kind === LAND.WATER));
  const waterLevel = hydro ? hydro.waterLevel : null;
  const sampleHeight = (x, z) => sampleGrid(carved, x, z);
  // Bridge decks are lifted off the ground. Sampling the carved bed would sag
  // every span into the channel, so a point in the bed keeps the bank grade.
  const sampleDeck = (x, z) => {
    const y = sampleHeight(x, z);
    if (hydro && y < hydro.waterLevel + 0.4) return hydro.bank;
    return y;
  };
  const parsed = parseCity(elements, proj, sampleHeight);
  bankQuays(parsed.land);
  const embankments = trimEmbankments(collectEmbankments(parsed.land), areaRect);
  markBundRow(parsed.buildings);
  const tagged = parsed.buildings.filter((b) => b.realColour).length;
  const roofs = parsed.buildings.filter((b) => b.roofColor != null).length;
  console.log(`OSM colour or material on ${tagged} of ${parsed.buildings.length} buildings, roof:colour on ${roofs}`);

  const draped = [];
  for (const road of parsed.roads) {
    for (const part of clipPolyline(road.points, areaRect)) {
      const points = resamplePolyline(part, 16);
      if (points.length < 2 || polylineLength(points) < 4) continue;
      const lifts = liftAlong(road, points);
      const sampled = points.map(([x, z], i) => sampleDeck(x, z) + 0.22 + lifts[i]);
      const y = road.bridge || road.ribbon ? sampled : relaxStreetGrade(points, sampled);
      draped.push({ ...road, points, y });
    }
  }
  flattenTerrainUnderRoads(carved, draped);

  const graph = buildRoadGraph(draped, parsed.signals);
  const railPieces = [];
  for (const rail of parsed.rails) {
    for (const part of clipPolyline(rail.points, areaRect)) {
      const points = resamplePolyline(part, 18);
      if (polylineLength(points) < 30) continue;
      const y = points.map(([x, z]) => {
        const ground = sampleDeck(x, z);
        if (rail.bridge) return ground + 7;
        if (rail.tunnel) return ground + 0.5;
        return ground + 0.35;
      });
      railPieces.push({ ...rail, points, y });
    }
  }
  const rails = stitchLines(railPieces);

  const landmarks = findLandmarks(parsed.footprints || parsed.buildings);
  // Fallback only. The Bund 12 frontage is named 上海浦东发展银行 and is picked
  // up by findLandmarks; this site is used when that name is missing.
  if (!landmarks.some((lm) => lm.id === 'hsbc')) {
    const [x, z] = proj.project(121.48495, 31.23835);
    if (x >= areaRect.minX && x <= areaRect.maxX && z >= areaRect.minZ && z <= areaRect.maxZ) {
      landmarks.push({
        id: 'hsbc',
        name: '汇丰银行大楼',
        x, z,
        y: sampleDeck(x, z),
        h: 52,
        yaw: Math.PI / 2,
        radius: 46,
      });
    }
  }
  const keptBuildings = parsed.buildings.filter((building) => !hiddenByLandmark(building, landmarks));
  const bridges = collectBridges(elements, proj, sampleDeck);
  const props = placeProps(keptBuildings, draped, parsed.land, sampleHeight, parsed.signals);

  const buckets = createBuckets();
  for (const building of keptBuildings) {
    const clipped = clipPolygon(building.rings[0], areaRect);
    if (clipped.length < 3) continue;
    const rings = [ensureWinding(clipped, true), ...building.rings.slice(1)];
    for (const [tx, tz] of tilesOverlapping(ringBBox(rings[0]))) {
      const rect = tileRect(tx, tz);
      const piece = clipRings(rings, rect, areaRect);
      if (!piece) continue;
      buckets.get(tx, tz).buildings.push({ ...building, rings: piece });
    }
  }
  for (const feature of parsed.land) {
    const outer = clipPolygon(feature.rings[0], areaRect);
    if (outer.length < 3 || polygonArea(outer) < 8) continue;
    for (const [tx, tz] of tilesOverlapping(ringBBox(outer))) {
      const rect = tileRect(tx, tz);
      const clipped = clipPolygon(outer, rect);
      if (clipped.length < 3 || polygonArea(clipped) < 4) continue;
      const rings = [ensureWinding(clipped, true)];
      for (const hole of feature.rings.slice(1)) {
        const h = ensureWinding(clipPolygon(hole, rect), false);
        if (h.length >= 3 && polygonArea(h) > 2) rings.push(h);
      }
      buckets.get(tx, tz).land.push({ kind: feature.kind, rings });
    }
  }
  const junctions = junctionPoints(draped);
  const awayFromJunction = (points, ys) => {
    const near = (p) => junctions.some((j) => (j[0] - p[0]) ** 2 + (j[1] - p[1]) ** 2 < 12 * 12);
    const parts = [];
    let cp = [];
    let cy = [];
    for (let i = 0; i < points.length; i++) {
      if (near(points[i])) {
        if (cp.length >= 2) parts.push({ points: cp, y: cy });
        cp = [];
        cy = [];
      } else {
        cp.push(points[i]);
        cy.push(ys[i]);
      }
    }
    if (cp.length >= 2) parts.push({ points: cp, y: cy });
    return parts;
  };
  for (const road of draped) {
    if (road.ribbon) {
      const deck = road.y.map((y) => y + 0.08);
      appendStrip(buckets, road.points, deck, road.width / 2, ROAD.SIDEWALK, road.bridge ? 10 + (road.lanes || 1) : 0, areaRect);
      if (road.bridge) {
        appendSkirt(buckets, road.points, deck, road.width / 2, -0.9, areaRect, ROAD.SIDEWALK, 3);
        appendSkirt(buckets, road.points, road.y, road.width / 2, 0.85, areaRect);
      }
      continue;
    }
    const lanes = road.lanes || 2;
    appendStrip(buckets, road.points, road.y, road.width / 2, road.cls, 10 + lanes, areaRect);
    if (/中山东/.test(road.name || '') && !road.bridge) addBoulevardCrossings(buckets, road, areaRect);
    if (road.sidewalk) {
      const sw = road.sidewalk;
      const offset = road.width / 2 + sw / 2;
      const raised = road.y.map((y) => y + 0.16);
      const { left, right } = offsetSides(road.points, offset);
      for (const center of [left, right]) {
        for (const part of awayFromJunction(center, raised)) {
          appendStrip(buckets, part.points, part.y, sw / 2, ROAD.SIDEWALK, 0, areaRect);
        }
      }
      appendSkirt(buckets, road.points, road.y, road.width / 2, -0.16, areaRect, ROAD.SIDEWALK, 3);
    }
    if (road.bridge) {
      appendStrip(buckets, road.points, road.y.map((y) => y - 1.05), road.width / 2, road.cls, 1, areaRect);
      appendSkirt(buckets, road.points, road.y, road.width / 2, 1.05, areaRect);
      appendSkirt(buckets, road.points, road.y, road.width / 2, -0.9, areaRect, ROAD.SIDEWALK, 3);
    }
  }
  for (const mark of graph.crosswalks) {
    appendStrip(buckets, mark.points, mark.y, mark.width / 2, ROAD.CROSSWALK, 0, areaRect);
  }
  for (const line of rails) {
    appendStrip(buckets, line.points, line.y, 1.7, ROAD.RAIL, line.tunnel ? 2 : 0, areaRect);
  }
  for (const prop of props) {
    if (prop.x < areaRect.minX || prop.x > areaRect.maxX || prop.z < areaRect.minZ || prop.z > areaRect.maxZ) continue;
    const [tx, tz] = [Math.floor(prop.x / TILE), Math.floor(prop.z / TILE)];
    buckets.get(tx, tz).props.push(prop);
  }

  const tiles = new Map();
  for (const [key, bucket] of buckets.map) {
    const empty = !bucket.buildings.length && !bucket.land.length && !bucket.props.length && bucket.roads.indices.length === 0;
    if (empty) continue;
    tiles.set(key, {
      tx: bucket.tx,
      tz: bucket.tz,
      buildings: bucket.buildings,
      land: bucket.land,
      roads: bucket.roads,
      props: bucket.props,
    });
  }

  const presets = cameraPresets(parsed.buildings, bounds);
  const manifest = {
    id: area.id,
    name: area.name,
    description: area.description || '',
    tileSize: TILE,
    origin: { lon: area.origin[0], lat: area.origin[1] },
    bbox: area.bbox,
    bounds,
    waterLevel,
    terrain: {
      file: 'terrain.bin',
      originX: carved.originX,
      originZ: carved.originZ,
      step: carved.step,
      cols: carved.cols,
      rows: carved.rows,
    },
    tiles: [...tiles.keys()].sort((a, b) => {
      const [ax, az] = a.split('_').map(Number);
      const [bx, bz] = b.split('_').map(Number);
      return az - bz || ax - bx;
    }),
    files: { roads: 'roads.json', rails: 'rails.json' },
    counts: {
      buildings: keptBuildings.length,
      landmarks: landmarks.length,
      roads: graph.edges.length,
      rails: rails.length,
      tiles: tiles.size,
    },
    view: area.view || { position: presets[0].position, target: presets[0].target },
    presets,
    // The outline lets a model that is more than a tower (the Peace Hotel's
    // wing, the Bank of China's block) fill the footprint it replaces.
    landmarks: landmarks.map(({ id, name, x, z, y, h, yaw, ring }) => ({
      id, name, x, z, y, h, yaw,
      ring: ring?.map(([px, pz]) => [Math.round(px * 10) / 10, Math.round(pz * 10) / 10]),
    })),
    bridges: bridges.map(({ id, name, kind, style, towerH, mainSpan, points }) => ({
      id, name, kind, style, towerH, mainSpan, points,
    })),
    embankments,
    riverCenter: riverCenterline(parsed.land),
    generatedAt: new Date().toISOString(),
    attribution: {
      osm: '© OpenStreetMap contributors (ODbL)',
      dem: demSource,
      code: 'Original implementation of the approach used by jeantimex/tokyo (MIT)',
    },
  };

  const railJson = {
    lines: rails.map((line) => ({
      ref: line.ref || '',
      name: line.name || '',
      tunnel: Boolean(line.tunnel),
      bridge: Boolean(line.bridge),
      points: line.points.flatMap((p, i) => [p[0], line.y[i], p[1]]),
    })),
  };
  return {
    manifest, tiles, terrain: carved,
    roads: { nodes: graph.nodes, edges: graph.edges, walks: sidewalkWalks(draped) },
    rails: railJson,
  };
}

// Street roads in this delta stay nearly level. A DEM spike or a viaduct
// sample must not hump the carriageway; bridges and ribbons keep their deck.
function relaxStreetGrade(points, y) {
  if (y.length < 3) return y.slice();
  const sorted = [...y].sort((a, b) => a - b);
  const mid = sorted[sorted.length >> 1];
  const near = [];
  for (let i = 0; i < y.length; i++) if (Math.abs(y[i] - mid) < 2.2) near.push(i);
  const a = near.length ? near[0] : 0;
  const b = near.length ? near[near.length - 1] : y.length - 1;
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  const span = Math.max(1, cum[b] - cum[a]);
  const grade = Math.max(-0.015, Math.min(0.015, (y[b] - y[a]) / span));
  return y.map((_, i) => y[a] + grade * (cum[i] - cum[a]));
}

function flattenTerrainUnderRoads(grid, roads) {
  const { cols, rows, originX, originZ, step } = grid;
  const original = Float32Array.from(grid.heights);
  const best = new Float32Array(grid.heights.length);
  const weight = new Float32Array(grid.heights.length);
  for (const road of roads) {
    if (road.bridge || road.ribbon || !road.y) continue;
    const half = road.width * 0.5 + Math.max(road.sidewalk || 0, 0) + 1.5;
    const apron = 20;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(len / Math.max(4, step * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a[0] + (b[0] - a[0]) * t;
        const z = a[1] + (b[1] - a[1]) * t;
        const y = (road.y[i - 1] + (road.y[i] - road.y[i - 1]) * t) - 0.22;
        const reach = half + apron;
        const c0 = Math.max(0, Math.floor((x - reach - originX) / step));
        const c1 = Math.min(cols - 1, Math.ceil((x + reach - originX) / step));
        const r0 = Math.max(0, Math.floor((z - reach - originZ) / step));
        const r1 = Math.min(rows - 1, Math.ceil((z + reach - originZ) / step));
        for (let r = r0; r <= r1; r++) {
          const gz = originZ + r * step;
          for (let c = c0; c <= c1; c++) {
            const dx = originX + c * step - x;
            const dz = gz - z;
            const dist = Math.hypot(dx, dz);
            if (dist > reach) continue;
            const influence = dist <= half ? 1 : 1 - (dist - half) / apron;
            const idx = r * cols + c;
            if (influence > weight[idx]) {
              weight[idx] = influence;
              best[idx] = y;
            }
          }
        }
      }
    }
  }
  for (let i = 0; i < grid.heights.length; i++) {
    if (weight[i] > 0) grid.heights[i] = original[i] * (1 - weight[i]) + best[i] * weight[i];
  }
}

function addBoulevardCrossings(buckets, road, areaRect) {
  let walked = 0;
  let next = 48;
  for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1];
    const b = road.points[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) { walked += len; continue; }
    while (next < walked + len) {
      const t = (next - walked) / len;
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[1] + (b[1] - a[1]) * t;
      const y = road.y[i - 1] + (road.y[i] - road.y[i - 1]) * t + 0.05;
      const dx = (b[0] - a[0]) / len;
      const dz = (b[1] - a[1]) / len;
      const depth = 5;
      appendStrip(buckets, [
        [x - dx * depth * 0.5, z - dz * depth * 0.5],
        [x + dx * depth * 0.5, z + dz * depth * 0.5],
      ], [y, y], road.width / 2, ROAD.CROSSWALK, 0, areaRect);
      next += 120;
    }
    walked += len;
  }
}

function riverCenterline(land) {
  const waters = [];
  for (const feature of land) {
    if (feature.kind !== LAND.WATER || !feature.rings?.[0]) continue;
    const area = polygonArea(feature.rings[0]);
    if (area < 12000) continue;
    waters.push({ ring: feature.rings[0], area });
  }
  if (!waters.length) return [];
  const probes = [[-720, 40], [-640, -180], [-560, 280], [-820, -480], [-480, 520]];
  let best = null;
  for (const water of waters) {
    if (!probes.some(([x, z]) => pointInPoly(x, z, water.ring))) continue;
    if (!best || water.area > best.area) best = water;
  }
  if (!best) best = waters.sort((a, b) => b.area - a.area)[0];
  const box = ringBBox(best.ring);
  best = best.ring;
  const samples = [];
  for (let z = box.minZ; z <= box.maxZ; z += 48) {
    let run = null;
    let widest = null;
    const consider = (span) => {
      if (!widest || span[1] - span[0] > widest[1] - widest[0]) widest = span;
    };
    for (let x = box.minX; x <= box.maxX; x += 14) {
      const inside = pointInPoly(x, z, best);
      if (inside && run == null) run = x;
      if (!inside && run != null) {
        consider([run, x]);
        run = null;
      }
    }
    if (run != null) consider([run, box.maxX]);
    if (!widest) continue;
    const width = widest[1] - widest[0];
    if (width < 140 || width > 1800) continue;
    samples.push([(widest[0] + widest[1]) * 0.5, z]);
  }
  if (samples.length < 6) return [];
  return samples.map((p, i) => {
    const a = samples[Math.max(0, i - 1)];
    const c = samples[Math.min(samples.length - 1, i + 1)];
    return [Math.round((a[0] + p[0] + c[0]) / 3), Math.round(p[1])];
  });
}

function sidewalkWalks(roads) {
  const walks = [];
  for (const road of roads) {
    if (!road.drive || road.bridge || !road.sidewalk || road.sidewalk < 1.5) continue;
    if (!road.points || road.points.length < 2 || !road.y) continue;
    const offset = road.width / 2 + road.sidewalk / 2;
    const { left, right } = offsetSides(road.points, offset);
    for (const center of [left, right]) {
      if (!center || center.length < 2) continue;
      const flat = [];
      for (let i = 0; i < center.length; i++) {
        const y = road.y[Math.min(i, road.y.length - 1)] + 0.16;
        flat.push(center[i][0], y, center[i][1]);
      }
      walks.push({ cls: road.cls, sidewalk: road.sidewalk, points: flat });
    }
  }
  return walks;
}

export function writeCity(result, area) {
  fs.mkdirSync(area.outDir, { recursive: true });
  fs.writeFileSync(path.join(area.outDir, 'manifest.json'), JSON.stringify(result.manifest, null, 2));
  fs.writeFileSync(path.join(area.outDir, 'terrain.bin'), encodeTerrain(result.terrain));
  fs.writeFileSync(path.join(area.outDir, 'roads.json'), JSON.stringify(result.roads));
  fs.writeFileSync(path.join(area.outDir, 'rails.json'), JSON.stringify(result.rails));
  for (const [key, tile] of result.tiles) {
    fs.writeFileSync(path.join(area.outDir, `t_${key}.bin`), encodeTile(tile));
  }
  const indexPath = path.join(area.tilesRoot, 'index.json');
  let index = { areas: [] };
  if (fs.existsSync(indexPath)) {
    try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch { index = { areas: [] }; }
  }
  index.areas = (index.areas || []).filter((item) => item.id !== area.id);
  index.areas.push({ id: area.id, name: area.name, description: area.description || '' });
  fs.mkdirSync(area.tilesRoot, { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

async function main() {
  const area = resolveArea();
  const osmPath = path.join(area.rawDir, 'osm.json');
  const demPath = path.join(area.rawDir, 'dem.bin');
  const metaPath = path.join(area.rawDir, 'dem.json');
  if (!fs.existsSync(osmPath) || !fs.existsSync(demPath)) {
    throw new Error(`missing raw data in ${area.rawDir}. Run npm run fetch -- --area=${area.id} first.`);
  }
  console.log(`compile ${area.id}`);
  const osm = JSON.parse(fs.readFileSync(osmPath, 'utf8'));
  const grid = decodeTerrain(fs.readFileSync(demPath));
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : { source: '' };
  const result = compileDataset({ area, elements: osm.elements, grid, demSource: meta.source || '' });
  if (result.manifest.counts.buildings < 1) throw new Error('compiler produced no buildings');
  writeCity(result, area);
  const { counts } = result.manifest;
  console.log(`buildings ${counts.buildings}, road edges ${counts.roads}, rail lines ${counts.rails}, tiles ${counts.tiles}`);
  console.log(`water level ${result.manifest.waterLevel ?? 'none'}`);
  console.log(`wrote ${area.outDir}`);
}

if (process.argv[1]?.endsWith('compile.mjs')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
