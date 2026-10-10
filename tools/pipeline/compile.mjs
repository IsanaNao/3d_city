import fs from 'node:fs';
import path from 'node:path';
import { TILE, boundsFromBbox, makeProjection, tileKey, tileRect } from '../../src/shared/geo.js';
import { LAND, PROP, ROAD } from '../../src/shared/kinds.js';
import { mulberry32 } from '../../src/shared/rng.js';
import { decodeTerrain, encodeTerrain, sampleGrid } from '../../src/shared/terrain.js';
import { encodeTile } from '../../src/shared/tileformat.js';
import { resolveArea } from './config.mjs';
import { buildRoadGraph } from './graph.mjs';
import {
  centroid, clipPolygon, clipPolyline, ensureWinding, finalizeRing, offsetSides,
  pointInPoly, polygonArea, polylineLength, resamplePolyline, ringBBox,
} from './geom.mjs';
import { parseCity } from './osm.mjs';

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

function appendSkirt(buckets, points, ys, half, drop, areaRect) {
  const { left, right } = offsetSides(points, half);
  const sides = [left, right];
  for (const side of sides) {
    let along = 0;
    for (let i = 0; i < side.length - 1; i++) {
      const segLen = Math.hypot(side[i + 1][0] - side[i][0], side[i + 1][1] - side[i][1]) || 0.01;
      const y0 = ys[Math.min(i, ys.length - 1)];
      const y1 = ys[Math.min(i + 1, ys.length - 1)];
      const quad3 = [
        { x: side[i][0], y: y0, z: side[i][1], across: 1, along, cls: ROAD.MOTORWAY, flags: 1 },
        { x: side[i + 1][0], y: y1, z: side[i + 1][1], across: 1, along: along + segLen, cls: ROAD.MOTORWAY, flags: 1 },
        { x: side[i + 1][0], y: y1 - drop, z: side[i + 1][1], across: 1, along: along + segLen, cls: ROAD.MOTORWAY, flags: 1 },
        { x: side[i][0], y: y0 - drop, z: side[i][1], across: 1, along, cls: ROAD.MOTORWAY, flags: 1 },
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

function carveWater(grid, waters) {
  const polys = waters.map((w) => w.rings[0]).filter((r) => r && r.length >= 3);
  if (!polys.length) return null;
  const inside = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const x = grid.originX + c * grid.step;
      const z = grid.originZ + r * grid.step;
      if (polys.some((poly) => pointInPoly(x, z, poly))) inside.push(r * grid.cols + c);
    }
  }
  if (inside.length < 3) return null;
  const waterVals = inside.map((i) => grid.heights[i]).sort((a, b) => a - b);
  const waterMedian = waterVals[waterVals.length >> 1];
  const all = Array.from(grid.heights).sort((a, b) => a - b);
  const landMedian = all[all.length >> 1];
  if (landMedian - waterMedian < 0.8) {
    const bed = waterMedian - 2.1;
    for (const i of inside) grid.heights[i] = bed;
    return waterMedian - 0.25;
  }
  return waterMedian + 0.15;
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

function placeProps(buildings, roads, land, sampleHeight) {
  const props = [];
  let trees = 0;
  let lamps = 0;
  const waters = land.filter((f) => f.kind === LAND.WATER).map((f) => f.rings[0]);
  const blocked = (x, z) => waters.some((ring) => pointInPoly(x, z, ring));

  for (const road of roads) {
    if (!road.drive || road.cls === ROAD.LINK && road.bridge) continue;
    const step = road.cls === ROAD.RESIDENTIAL || road.cls === ROAD.SERVICE ? 26 : 34;
    let dist = step * 0.5;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) continue;
      const dx = (b[0] - a[0]) / len;
      const dz = (b[1] - a[1]) / len;
      const rx = -dz;
      const rz = dx;
      while (dist < len) {
        const x = a[0] + dx * dist;
        const z = a[1] + dz * dist;
        const y = sampleHeight(x, z) + (road.lift || 0);
        const side = road.width * 0.5 + 1.1;
        if (!road.bridge && road.cls !== ROAD.MOTORWAY && trees < 2800) {
          for (const s of [-1, 1]) {
            const tx = x + rx * side * s;
            const tz = z + rz * side * s;
            if (!blocked(tx, tz)) {
              props.push({ kind: PROP.TREE, variant: (trees + i) % 3, x: tx, y, z: tz, rot: (i * 0.7) % 6.28, scale: 0.85 + (i % 5) * 0.08, extra: 1 });
              trees += 1;
            }
          }
        }
        if (!road.bridge && road.cls !== ROAD.SERVICE && lamps < 1600) {
          for (const s of [-1, 1]) {
            props.push({
              kind: PROP.LAMP, variant: 0,
              x: x + rx * (side - 0.4) * s, y, z: z + rz * (side - 0.4) * s,
              rot: 0, scale: 1, extra: 8,
            });
            lamps += 1;
          }
        }
        if (road.bridge && road.lift > 3) {
          props.push({ kind: PROP.PIER, variant: 0, x, y: sampleHeight(x, z), z, rot: Math.atan2(dx, dz), scale: 1.6, extra: road.lift });
        }
        dist += step;
      }
      dist -= len;
    }
  }

  for (const feature of land) {
    if (feature.kind !== LAND.PARK && feature.kind !== LAND.WOOD) continue;
    const ring = feature.rings[0];
    const area = polygonArea(ring);
    if (area < 80 || area > 250000) continue;
    const box = ringBBox(ring);
    const spacing = area > 80000 ? 18 : 14;
    const rng = mulberry32(Math.round(box.minX * 10 + box.minZ));
    for (let x = box.minX; x <= box.maxX && trees < 2800; x += spacing) {
      for (let z = box.minZ; z <= box.maxZ && trees < 2800; z += spacing) {
        const jx = x + (rng() - 0.5) * spacing * 0.8;
        const jz = z + (rng() - 0.5) * spacing * 0.8;
        if (!pointInPoly(jx, jz, ring) || blocked(jx, jz)) continue;
        props.push({
          kind: PROP.TREE, variant: Math.floor(rng() * 3), x: jx, y: sampleHeight(jx, jz), z: jz,
          rot: rng() * 6.28, scale: 0.75 + rng() * 0.7, extra: 1,
        });
        trees += 1;
      }
    }
  }

  for (const building of buildings) {
    const height = building.topY - building.baseY;
    const outer = building.rings[0];
    const rng = mulberry32(building.id * 97 + 3);
    if (height > 14 && building.area > 50 && !building.roofShape) {
      const c = building.centroid || centroid(outer);
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
  const sampleHeight = (x, z) => sampleGrid(settled, x, z);
  const parsed = parseCity(elements, proj, sampleHeight);

  const draped = [];
  for (const road of parsed.roads) {
    for (const part of clipPolyline(road.points, areaRect)) {
      const points = resamplePolyline(part, 16);
      if (points.length < 2 || polylineLength(points) < 4) continue;
      const y = points.map(([x, z]) => sampleHeight(x, z) + 0.22 + (road.lift || 0));
      draped.push({ ...road, points, y });
    }
  }

  const graph = buildRoadGraph(draped, parsed.signals);
  const railPieces = [];
  for (const rail of parsed.rails) {
    for (const part of clipPolyline(rail.points, areaRect)) {
      const points = resamplePolyline(part, 18);
      if (polylineLength(points) < 30) continue;
      const y = points.map(([x, z]) => {
        const ground = sampleHeight(x, z);
        if (rail.bridge) return ground + 7;
        if (rail.tunnel) return ground + 0.5;
        return ground + 0.35;
      });
      railPieces.push({ ...rail, points, y });
    }
  }
  const rails = stitchLines(railPieces);

  const carved = {
    ...settled,
    heights: Float32Array.from(settled.heights),
  };
  const waterLevel = carveWater(carved, parsed.land.filter((f) => f.kind === LAND.WATER));
  const props = placeProps(parsed.buildings, draped, parsed.land, sampleHeight);

  const buckets = createBuckets();
  for (const building of parsed.buildings) {
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
  for (const road of draped) {
    if (road.ribbon) {
      appendStrip(buckets, road.points, road.y.map((y) => y - 0.08), road.width / 2, ROAD.SIDEWALK, 0, areaRect);
      continue;
    }
    if (road.sidewalk) {
      const half = road.width / 2 + 1.8;
      appendStrip(buckets, road.points, road.y.map((y) => y - 0.1), half, ROAD.SIDEWALK, 0, areaRect);
    }
    appendStrip(buckets, road.points, road.y, road.width / 2, road.cls, 0, areaRect);
    if (road.bridge) {
      appendStrip(buckets, road.points, road.y.map((y) => y - 1.15), road.width / 2, road.cls, 1, areaRect);
      appendSkirt(buckets, road.points, road.y, road.width / 2, 1.15, areaRect);
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
      buildings: parsed.buildings.length,
      roads: graph.edges.length,
      rails: rails.length,
      tiles: tiles.size,
    },
    view: area.view || { position: presets[0].position, target: presets[0].target },
    presets,
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
  return { manifest, tiles, terrain: carved, roads: { nodes: graph.nodes, edges: graph.edges }, rails: railJson };
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
