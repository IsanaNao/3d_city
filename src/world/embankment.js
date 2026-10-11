import * as THREE from 'three';
import { sampleGrid } from '../shared/terrain.js';

// Hard flood wall, raised stone promenade, railing and lamps along a bank line.
// The walk sits on the street grade. It does not follow the DEM slope into the river.

const wallMat = new THREE.MeshStandardMaterial({ color: 0xb4aea3, roughness: 0.86, metalness: 0.02 });
const deckMat = new THREE.MeshStandardMaterial({ color: 0xc8bba6, roughness: 0.78, metalness: 0.02 });
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
    const pts = line.points || [];
    const width = line.width || 24;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      if (len < 1) continue;
      const ox = ((p0.ox || 0) + (p1.ox || 0)) / 2 || p1.ox || p0.ox || 0;
      const oz = ((p0.oz || 0) + (p1.oz || 0)) / 2 || p1.oz || p0.oz || 0;
      const nlen = Math.hypot(ox, oz) || 1;
      const nx = ox / nlen;
      const nz = oz / nlen;
      const y0 = deckY(grid, level, p0.x, p0.z, nx, nz);
      const y1 = deckY(grid, level, p1.x, p1.z, nx, nz);
      const low = level - 0.6;
      const a = new THREE.Vector3(p0.x, low, p0.z);
      const b = new THREE.Vector3(p1.x, low, p1.z);
      const c = new THREE.Vector3(p1.x, y1 + 0.2, p1.z);
      const d = new THREE.Vector3(p0.x, y0 + 0.2, p0.z);
      addQuad(wall, a, b, c, d);
      const inset = 0.85;
      addQuad(
        wall,
        new THREE.Vector3(p0.x + nx * inset, low, p0.z + nz * inset),
        d.clone(),
        c.clone(),
        new THREE.Vector3(p1.x + nx * inset, low, p1.z + nz * inset),
      );
      const d0 = new THREE.Vector3(p0.x + nx * 0.4, y0 + 0.28, p0.z + nz * 0.4);
      const d1 = new THREE.Vector3(p1.x + nx * 0.4, y1 + 0.28, p1.z + nz * 0.4);
      const d2 = new THREE.Vector3(p1.x + nx * width, y1 + 0.28, p1.z + nz * width);
      const d3 = new THREE.Vector3(p0.x + nx * width, y0 + 0.28, p0.z + nz * width);
      addQuad(deck, d0, d1, d2, d3);
      // Solid parapet, then a dark rail and posts, on the water side of the walk.
      const parapet = 0.9;
      addQuad(
        wall,
        d.clone(),
        c.clone(),
        new THREE.Vector3(p1.x, y1 + parapet, p1.z),
        new THREE.Vector3(p0.x, y0 + parapet, p0.z),
      );
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
        addBox(poles, x, y + 4.2, z, 0.7, 8.4, 0.7, nx, nz);
        addBox(heads, x, y + 8.55, z, 3.1, 0.7, 1.35, p1.x - p0.x, p1.z - p0.z);
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
  lampMat.emissiveIntensity = night * 2.4;
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
