import * as THREE from 'three';
import { sampleGrid } from '../shared/terrain.js';

// Hard flood wall, raised stone promenade, railing and lamps along a bank line.
// The walk sits on the street grade. It does not follow the DEM slope into the river.

const wallMat = new THREE.MeshStandardMaterial({ color: 0xb4aea3, roughness: 0.86, metalness: 0.02, side: THREE.DoubleSide });
const deckMat = new THREE.MeshStandardMaterial({ color: 0xc4b8a4, roughness: 0.86, metalness: 0.02 });
deckMat.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vDeckW;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDeckW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vDeckW;
      float deckHash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      vec2 q = vDeckW.xz / vec2(1.55, 0.92);
      q.x += 0.5 * mod(floor(q.y), 2.0);
      vec2 f = fract(q);
      vec2 fw = max(fwidth(q), vec2(1e-4));
      float fine = 1.0 - smoothstep(0.4, 1.15, max(fw.x, fw.y));
      float edge = min(min(f.x, 1.0 - f.x) / fw.x, min(f.y, 1.0 - f.y) / fw.y);
      float joint = (1.0 - smoothstep(0.35, 1.2, edge)) * fine;
      vec3 stone = diffuseColor.rgb * (0.78 + 0.3 * deckHash(floor(q)));
      diffuseColor.rgb = mix(stone, stone * 0.48, joint);
    `);
};
deckMat.customProgramCacheKey = () => 'emb-deck-paver-1';
const railMat = new THREE.MeshStandardMaterial({ color: 0x8d9398, roughness: 0.42, metalness: 0.55 });
const poleMat = new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.45, metalness: 0.4 });
const lampMat = new THREE.MeshStandardMaterial({
  color: 0xffe1b0, emissive: new THREE.Color(0xffc37a), emissiveIntensity: 0,
});

function pushTri(pos, a, b, c) {
  pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

function addQuad(pos, a, b, c, d) {
  pushTri(pos, a, b, c);
  pushTri(pos, a, c, d);
}

// Keep the face that looks toward (tx, tz). The shore is walked either way,
// and a back face is invisible from the river.
function faceToward(pos, a, b, c, d, tx, tz) {
  const e1x = b.x - a.x;
  const e1y = b.y - a.y;
  const e1z = b.z - a.z;
  const e2x = d.x - a.x;
  const e2y = d.y - a.y;
  const e2z = d.z - a.z;
  const nx = e1y * e2z - e1z * e2y;
  const nz = e1x * e2y - e1y * e2x;
  if (nx * tx + nz * tz < 0) addQuad(pos, a, d, c, b);
  else addQuad(pos, a, b, c, d);
}

function edgesCross(a, b, c, d) {
  const den = (d.z - c.z) * (b.x - a.x) - (d.x - c.x) * (b.z - a.z);
  if (Math.abs(den) < 1e-6) return false;
  const t = ((d.x - c.x) * (a.z - c.z) - (d.z - c.z) * (a.x - c.x)) / den;
  const u = ((b.x - a.x) * (a.z - c.z) - (b.z - a.z) * (a.x - c.x)) / den;
  return t > 0.04 && t < 0.96 && u > 0.04 && u < 0.96;
}

function deckCrosses(a, b, c, d) {
  return edgesCross(a, b, c, d) || edgesCross(b, c, d, a);
}

function faceUp(pos, a, b, c, d) {
  const e1x = b.x - a.x;
  const e1z = b.z - a.z;
  const e2x = d.x - a.x;
  const e2z = d.z - a.z;
  const ny = e1z * e2x - e1x * e2z;
  if (ny < 0) addQuad(pos, a, d, c, b);
  else addQuad(pos, a, b, c, d);
}

// length runs along (dx, dz), depth across it, height up. Origin is the box center.
function addBox(pos, cx, cy, cz, length, height, depth, dx, dz) {
  const span = Math.hypot(dx, dz) || 1;
  const ax = dx / span;
  const az = dz / span;
  const px = -az;
  const pz = ax;
  const hx = ax * length * 0.5;
  const hz = az * length * 0.5;
  const wx = px * depth * 0.5;
  const wz = pz * depth * 0.5;
  const y0 = cy - height * 0.5;
  const y1 = cy + height * 0.5;
  const at = (x, y, z) => new THREE.Vector3(x, y, z);
  const b0 = at(cx - hx - wx, y0, cz - hz - wz);
  const b1 = at(cx + hx - wx, y0, cz + hz - wz);
  const b2 = at(cx + hx + wx, y0, cz + hz + wz);
  const b3 = at(cx - hx + wx, y0, cz - hz + wz);
  const t0 = at(cx - hx - wx, y1, cz - hz - wz);
  const t1 = at(cx + hx - wx, y1, cz + hz - wz);
  const t2 = at(cx + hx + wx, y1, cz + hz + wz);
  const t3 = at(cx - hx + wx, y1, cz - hz + wz);
  addQuad(pos, b0, b1, t1, t0);
  addQuad(pos, b1, b2, t2, t1);
  addQuad(pos, b2, b3, t3, t2);
  addQuad(pos, b3, b0, t0, t3);
  addQuad(pos, t0, t1, t2, t3);
}

function meshFrom(pos, mat) {
  if (pos.length < 9) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

function deckY(grid, waterLevel, x, z, ox, oz) {
  let y = (waterLevel || 0) + 8;
  for (const d of [14, 28, 48]) {
    const h = sampleGrid(grid, x + ox * d, z + oz * d);
    if (Number.isFinite(h) && h > y) y = h;
  }
  return y;
}

// OSM water rings jag back on themselves for a few metres. That jog, with the
// normal that belongs to it, opens a triangular hole in the wall and the deck.
// Pull a point that sits well off the chord of its neighbours back toward
// that chord. A 20 m jog is what folds the promenade into a triangular hole.
function relaxShore(pts) {
  let cur = dropSpikes(pts);
  for (let pass = 0; pass < 5; pass++) {
    if (cur.length < 3) break;
    const next = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++) {
      const a = cur[i - 1];
      const b = cur[i];
      const c = cur[i + 1];
      const acx = c.x - a.x;
      const acz = c.z - a.z;
      const L2 = acx * acx + acz * acz || 1;
      let t = ((b.x - a.x) * acx + (b.z - a.z) * acz) / L2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + acx * t;
      const pz = a.z + acz * t;
      const dev = Math.hypot(b.x - px, b.z - pz);
      const pull = dev > 8 ? 0.72 : dev > 3 ? 0.35 : 0;
      next.push({ ...b, x: b.x + (px - b.x) * pull, z: b.z + (pz - b.z) * pull });
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

function smoothNormals(verts) {
  const out = verts.map((v) => ({ ...v }));
  for (let pass = 0; pass < 2; pass++) {
    const prev = out.map((v) => ({ nx: v.nx, nz: v.nz }));
    for (let i = 1; i < out.length - 1; i++) {
      let nx = prev[i - 1].nx + prev[i].nx * 2 + prev[i + 1].nx;
      let nz = prev[i - 1].nz + prev[i].nz * 2 + prev[i + 1].nz;
      const len = Math.hypot(nx, nz) || 1;
      out[i].nx = nx / len;
      out[i].nz = nz / len;
      out[i].m = Math.min(out[i].m, 1.15);
    }
  }
  return out;
}

function dropSpikes(pts) {
  let cur = pts.slice();
  let changed = true;
  while (changed && cur.length > 3) {
    changed = false;
    const next = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++) {
      const a = next[next.length - 1];
      const b = cur[i];
      const c = cur[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const bcx = c.x - b.x;
      const bcz = c.z - b.z;
      const lab = Math.hypot(abx, abz) || 1;
      const lbc = Math.hypot(bcx, bcz) || 1;
      const cos = (abx * bcx + abz * bcz) / (lab * lbc);
      if (cos < 0.35 && Math.min(lab, lbc) < 48) {
        changed = true;
        continue;
      }
      next.push(b);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

// One inland side for the whole line. A single flipped sample must not swing
// the deck out into the river.
function lineSide(pts) {
  let score = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dz = pts[i].z - pts[i - 1].z;
    const len = Math.hypot(dx, dz) || 1;
    const lx = -dz / len;
    const lz = dx / len;
    const hx = ((pts[i - 1].ox || 0) + (pts[i].ox || 0)) * 0.5;
    const hz = ((pts[i - 1].oz || 0) + (pts[i].oz || 0)) * 0.5;
    score += lx * hx + lz * hz;
  }
  return score >= 0 ? 1 : -1;
}

// Shared corners. A sharp turn becomes two vertices at the same shore point
// so the deck can fill the wedge instead of leaving a triangular gap.
function weldShore(pts, side) {
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dz = pts[i].z - pts[i - 1].z;
    const len = Math.hypot(dx, dz) || 1;
    segs.push({ nx: side * -dz / len, nz: side * dx / len });
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const L = i > 0 ? segs[i - 1] : null;
    const R = i < pts.length - 1 ? segs[i] : null;
    if (!L || !R) {
      const s = L || R;
      out.push({ x: pts[i].x, z: pts[i].z, nx: s.nx, nz: s.nz, m: 1 });
      continue;
    }
    const dot = L.nx * R.nx + L.nz * R.nz;
    if (dot < 0.55) {
      out.push({ x: pts[i].x, z: pts[i].z, nx: L.nx, nz: L.nz, m: 1 });
      out.push({ x: pts[i].x, z: pts[i].z, nx: R.nx, nz: R.nz, m: 1 });
    } else {
      let mx = L.nx + R.nx;
      let mz = L.nz + R.nz;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml;
      mz /= ml;
      const along = Math.max(0.45, mx * L.nx + mz * L.nz);
      out.push({ x: pts[i].x, z: pts[i].z, nx: mx, nz: mz, m: Math.min(1.65, 1 / along) });
    }
  }
  return out;
}

// Sharp shoreline corners leave a triangular gap and a knife edge. Pull the
// corner back and fill it with a short curve so the wall stays one strip.
function roundBank(pts) {
  if (!pts || pts.length < 3) return pts || [];
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const d1x = b.x - a.x;
    const d1z = b.z - a.z;
    const d2x = c.x - b.x;
    const d2z = c.z - b.z;
    const l1 = Math.hypot(d1x, d1z) || 1;
    const l2 = Math.hypot(d2x, d2z) || 1;
    const dot = (d1x / l1) * (d2x / l2) + (d1z / l1) * (d2z / l2);
    if (dot > 0.9) { out.push(b); continue; }
    const pull = Math.min(10, l1 * 0.4, l2 * 0.4);
    const pA = { x: b.x - (d1x / l1) * pull, z: b.z - (d1z / l1) * pull, ox: b.ox, oz: b.oz };
    const pC = { x: b.x + (d2x / l2) * pull, z: b.z + (d2z / l2) * pull, ox: b.ox, oz: b.oz };
    out.push(pA);
    for (let k = 1; k <= 3; k++) {
      const t = k / 4;
      const u = 1 - t;
      out.push({
        x: u * u * pA.x + 2 * u * t * b.x + t * t * pC.x,
        z: u * u * pA.z + 2 * u * t * b.z + t * t * pC.z,
        ox: b.ox,
        oz: b.oz,
      });
    }
    out.push(pC);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function createEmbankments(lines, grid, waterLevel) {
  const group = new THREE.Group();
  group.name = 'embankments';
  const wall = [];
  const deck = [];
  const rail = [];
  const poles = [];
  const heads = [];
  const level = Number.isFinite(waterLevel) ? waterLevel : 0;
  let lampAcc = 0;
  for (const line of lines || []) {
    const cleaned = relaxShore(line.points || []);
    if (cleaned.length < 2) continue;
    const side = lineSide(cleaned);
    const pts = smoothNormals(weldShore(roundBank(cleaned), side));
    const width = line.width || 24;
    for (const v of pts) v.y = deckY(grid, level, v.x, v.z, v.nx, v.nz);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < pts.length - 1; i++) {
        const floor = Math.min(pts[i - 1].y, pts[i + 1].y);
        if (pts[i].y < floor - 0.35) pts[i].y = floor;
      }
    }
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const y0 = p0.y;
      const y1 = p1.y;
      const low = level - 0.6;
      const at = (p, dist, y) => new THREE.Vector3(
        p.x + p.nx * p.m * dist,
        y,
        p.z + p.nz * p.m * dist,
      );
      const inset = 0.85;
      if (len >= 0.35) {
        const a = new THREE.Vector3(p0.x, low, p0.z);
        const b = new THREE.Vector3(p1.x, low, p1.z);
        const c = new THREE.Vector3(p1.x, y1 + 0.2, p1.z);
        const d = new THREE.Vector3(p0.x, y0 + 0.2, p0.z);
        const nx = (p0.nx + p1.nx) / 2;
        const nz = (p0.nz + p1.nz) / 2;
        faceToward(wall, a, b, c, d, -nx, -nz);
        faceToward(wall, at(p0, inset, low), d.clone(), c.clone(), at(p1, inset, low), nx, nz);
        const parapet = 0.9;
        faceToward(
          wall,
          d.clone(),
          c.clone(),
          new THREE.Vector3(p1.x, y1 + parapet, p1.z),
          new THREE.Vector3(p0.x, y0 + parapet, p0.z),
          -nx,
          -nz,
        );
      }
      let deckW = width;
      let d0 = at(p0, 0.4, y0 + 0.28);
      let d1 = at(p1, 0.4, y1 + 0.28);
      let d2 = at(p1, deckW, y1 + 0.28);
      let d3 = at(p0, deckW, y0 + 0.28);
      // A tight bend with a wide promenade folds into a bowtie: a triangular
      // hole and a fin in the water. Narrow that one quad until it is convex.
      for (let guard = 0; guard < 6 && deckCrosses(d0, d1, d2, d3); guard++) {
        deckW *= 0.72;
        d2 = at(p1, deckW, y1 + 0.28);
        d3 = at(p0, deckW, y0 + 0.28);
      }
      if (!deckCrosses(d0, d1, d2, d3)) faceUp(deck, d0, d1, d2, d3);
      if (len < 0.35) continue;
      const nx = (p0.nx + p1.nx) / 2;
      const nz = (p0.nz + p1.nz) / 2;
      const railOut = 0.35;
      for (const lift of [0.62, 1.2]) {
        const railY0 = y0 + lift;
        const railY1 = y1 + lift;
        const thick = 0.16;
        addBox(
          rail,
          (p0.x + p1.x) / 2 - nx * railOut,
          (railY0 + railY1) / 2,
          (p0.z + p1.z) / 2 - nz * railOut,
          Math.hypot(p1.x - p0.x, p1.z - p0.z),
          thick,
          0.28,
          p1.x - p0.x,
          p1.z - p0.z,
        );
      }
      const posts = Math.max(1, Math.round(len / 6));
      for (let k = 0; k <= posts; k++) {
        const t = k / posts;
        const x = p0.x + (p1.x - p0.x) * t - nx * railOut;
        const z = p0.z + (p1.z - p0.z) * t - nz * railOut;
        const y = y0 + (y1 - y0) * t;
        addBox(rail, x, y + 0.7, z, 0.22, 1.15, 0.22, nx, nz);
      }
      lampAcc += len;
      if (lampAcc > 20) {
        lampAcc = 0;
        const x = (p0.x + p1.x) / 2 + nx * 3.2;
        const z = (p0.z + p1.z) / 2 + nz * 3.2;
        const y = (y0 + y1) / 2 + 0.28;
        addBox(poles, x, y + 4.05, z, 0.16, 8.1, 0.16, nx, nz);
        addBox(heads, x, y + 8.16, z, 0.62, 0.16, 0.34, p1.x - p0.x, p1.z - p0.z);
      }
    }
  }
  for (const [pos, mat] of [[wall, wallMat], [deck, deckMat], [rail, railMat], [poles, poleMat], [heads, lampMat]]) {
    const mesh = meshFrom(pos, mat);
    if (mesh) group.add(mesh);
  }
  return group;
}

export function syncEmbankmentNight(night) {
  lampMat.emissiveIntensity = night * 1.25;
  wallMat.emissive = wallMat.emissive || new THREE.Color(0xffe2c0);
  wallMat.emissiveIntensity = night * 0.08;
}

export function embankmentSegments(lines) {
  const out = [];
  for (const line of lines || []) {
    const pts = line.points || [];
    const width = line.width || 24;
    for (let i = 1; i < pts.length; i++) {
      out.push({
        ax: pts[i - 1].x, az: pts[i - 1].z, bx: pts[i].x, bz: pts[i].z, width,
      });
    }
  }
  return out;
}
