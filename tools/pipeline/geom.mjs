// Polygon and polyline geometry for the offline compiler.

export function signedAreaNorth(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    area += x1 * -z2 - x2 * -z1;
  }
  return area / 2;
}

export function polygonArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    area += x1 * z2 - x2 * z1;
  }
  return Math.abs(area) * 0.5;
}

export function ringBBox(ring) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}

export function centroid(ring) {
  let x = 0;
  let z = 0;
  let acc = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    const cross = x1 * z2 - x2 * z1;
    acc += cross;
    x += (x1 + x2) * cross;
    z += (z1 + z2) * cross;
  }
  if (Math.abs(acc) < 1e-6) {
    let sx = 0;
    let sz = 0;
    for (const p of ring) { sx += p[0]; sz += p[1]; }
    return [sx / ring.length, sz / ring.length];
  }
  return [x / (3 * acc), z / (3 * acc)];
}

export function pointInPoly(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const zi = ring[i][1];
    const xj = ring[j][0];
    const zj = ring[j][1];
    const hit = (zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

export function dedupe(points, minDist = 0.05) {
  const out = [];
  for (const p of points) {
    if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > minDist) out.push(p);
  }
  if (out.length >= 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= minDist) {
    out.pop();
  }
  return out;
}

export function cleanRing(points) {
  let ring = dedupe(points, 0.35);
  if (ring.length <= 4) return ring;
  const kept = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n];
    const b = ring[i];
    const c = ring[(i + 1) % n];
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const bcx = c[0] - b[0];
    const bcz = c[1] - b[1];
    const lab = Math.hypot(abx, abz) || 1;
    const lbc = Math.hypot(bcx, bcz) || 1;
    const sin = Math.abs(abx * bcz - abz * bcx) / (lab * lbc);
    if (sin > 0.03) kept.push(b);
  }
  return kept.length >= 3 ? kept : ring;
}

export function ensureWinding(ring, positive) {
  const area = signedAreaNorth(ring);
  if (area === 0) return ring.slice();
  if ((area > 0) !== positive) return ring.slice().reverse();
  return ring.slice();
}

function intersect(a, b, value, axis) {
  const other = axis === 0 ? 1 : 0;
  const denom = (b[axis] - a[axis]) || 1e-12;
  const t = (value - a[axis]) / denom;
  const p = [0, 0];
  p[axis] = value;
  p[other] = a[other] + (b[other] - a[other]) * t;
  return p;
}

export function clipPolygon(ring, rect) {
  const edges = [
    { inside: (p) => p[0] >= rect.minX - 1e-6, hit: (a, b) => intersect(a, b, rect.minX, 0) },
    { inside: (p) => p[0] <= rect.maxX + 1e-6, hit: (a, b) => intersect(a, b, rect.maxX, 0) },
    { inside: (p) => p[1] >= rect.minZ - 1e-6, hit: (a, b) => intersect(a, b, rect.minZ, 1) },
    { inside: (p) => p[1] <= rect.maxZ + 1e-6, hit: (a, b) => intersect(a, b, rect.maxZ, 1) },
  ];
  let output = ring;
  for (const edge of edges) {
    if (!output.length) break;
    const input = output;
    output = [];
    let prev = input[input.length - 1];
    let prevIn = edge.inside(prev);
    for (const cur of input) {
      const curIn = edge.inside(cur);
      if (curIn) {
        if (!prevIn) output.push(edge.hit(prev, cur));
        output.push(cur.slice());
      } else if (prevIn) output.push(edge.hit(prev, cur));
      prev = cur;
      prevIn = curIn;
    }
  }
  return dedupe(output, 0.02);
}

export function isBoundaryEdge(a, b, rect, eps = 0.05) {
  const on = (v, target) => Math.abs(v - target) <= eps;
  if (on(a[0], rect.minX) && on(b[0], rect.minX)) return true;
  if (on(a[0], rect.maxX) && on(b[0], rect.maxX)) return true;
  if (on(a[1], rect.minZ) && on(b[1], rect.minZ)) return true;
  if (on(a[1], rect.maxZ) && on(b[1], rect.maxZ)) return true;
  return false;
}

export function isSharedTileEdge(a, b, tileRect, areaRect) {
  if (!isBoundaryEdge(a, b, tileRect)) return false;
  if (areaRect && isBoundaryEdge(a, b, areaRect)) return false;
  return true;
}

export function finalizeRing(points, tileRect, areaRect, wantPositive = true) {
  let ring = dedupe(points, 0.04);
  if (ring.length < 3) return null;
  ring = ensureWinding(ring, wantPositive);
  const flags = new Uint8Array(ring.length);
  if (tileRect) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      flags[i] = isSharedTileEdge(a, b, tileRect, areaRect) ? 1 : 0;
    }
  }
  return { points: ring, flags };
}

export function clipSegment(a, b, rect) {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const p = [-dx, dx, -dz, dz];
  const q = [a[0] - rect.minX, rect.maxX - a[0], a[1] - rect.minZ, rect.maxZ - a[1]];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  if (t1 - t0 < 1e-5) return null;
  return [
    [a[0] + dx * t0, a[1] + dz * t0],
    [a[0] + dx * t1, a[1] + dz * t1],
  ];
}

export function clipPolyline(points, rect) {
  const parts = [];
  let cur = [];
  for (let i = 0; i < points.length - 1; i++) {
    const seg = clipSegment(points[i], points[i + 1], rect);
    if (!seg) {
      if (cur.length >= 2) parts.push(cur);
      cur = [];
      continue;
    }
    if (!cur.length) cur.push(seg[0]);
    else if (Math.hypot(cur[cur.length - 1][0] - seg[0][0], cur[cur.length - 1][1] - seg[0][1]) > 0.05) {
      if (cur.length >= 2) parts.push(cur);
      cur = [seg[0]];
    }
    cur.push(seg[1]);
  }
  if (cur.length >= 2) parts.push(cur);
  return parts;
}

export function resamplePolyline(points, step) {
  if (points.length < 2) return points.map((p) => p.slice());
  const out = [points[0].slice()];
  let acc = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (seg < 1e-4) continue;
    let travelled = 0;
    while (acc + (seg - travelled) >= step) {
      const need = step - acc;
      travelled += need;
      const t = travelled / seg;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      acc = 0;
    }
    acc += seg - travelled;
  }
  const end = points[points.length - 1];
  const last = out[out.length - 1];
  if (Math.hypot(end[0] - last[0], end[1] - last[1]) > 0.3) out.push(end.slice());
  return out;
}

export function offsetSides(points, half) {
  const dirs = [];
  for (let i = 0; i < points.length - 1; i++) {
    let dx = points[i + 1][0] - points[i][0];
    let dz = points[i + 1][1] - points[i][1];
    const len = Math.hypot(dx, dz) || 1;
    dirs.push([dx / len, dz / len]);
  }
  const left = [];
  const right = [];
  const rightOf = (d) => [-d[1], d[0]];
  const closed = points.length > 3
    && Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < 0.5;
  const miter = (d0, d1) => {
    const r1 = rightOf(d0);
    const r2 = rightOf(d1);
    let rx = r1[0] + r2[0];
    let rz = r1[1] + r2[1];
    const m = Math.hypot(rx, rz) || 1;
    rx /= m;
    rz /= m;
    const dot = r1[0] * rx + r1[1] * rz;
    const scale = Math.min(2.4, 1 / Math.max(0.4, dot));
    return [rx * scale, rz * scale];
  };
  for (let i = 0; i < points.length; i++) {
    let rx;
    let rz;
    if (closed && (i === 0 || i === points.length - 1)) [rx, rz] = miter(dirs.at(-1), dirs[0]);
    else if (i === 0) [rx, rz] = rightOf(dirs[0]);
    else if (i === points.length - 1) [rx, rz] = rightOf(dirs.at(-1));
    else [rx, rz] = miter(dirs[i - 1], dirs[i]);
    right.push([points[i][0] + rx * half, points[i][1] + rz * half]);
    left.push([points[i][0] - rx * half, points[i][1] - rz * half]);
  }
  return { left, right };
}

export function offsetPolyline(points, dist) {
  return offsetSides(points, dist).right;
}

export function bufferOpen(points, half) {
  if (points.length < 2) return null;
  const { left, right } = offsetSides(points, half);
  return [...left, ...right.reverse()];
}

export function coordKey(x, z) {
  return `${Math.round(x * 2) / 2},${Math.round(z * 2) / 2}`;
}

export function polylineLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return length;
}
