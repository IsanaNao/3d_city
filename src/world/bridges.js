import * as THREE from 'three';
import { cityUniforms } from './materials.js';

// Parametric stand-ins. The road deck itself stays the OSM carriageway;
// these add the truss, the towers and the cable fans.

const steel = new THREE.MeshStandardMaterial({ color: 0xb7c0c6, metalness: 0.62, roughness: 0.38 });
const concrete = new THREE.MeshStandardMaterial({
  color: 0xc5c8c2, metalness: 0.08, roughness: 0.72,
  emissive: new THREE.Color(0xffe0b0), emissiveIntensity: 0,
});
const cableMat = new THREE.MeshStandardMaterial({
  color: 0xd5dbe0, metalness: 0.7, roughness: 0.32,
  emissive: new THREE.Color(0xfff2d0), emissiveIntensity: 0,
});

function member(group, a, b, radius, mat, sides = 6) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 0.4) return;
  const geo = new THREE.CylinderGeometry(radius, radius, len, sides);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  geo.translate(0, len / 2, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.multiplyScalar(1 / len));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  group.add(mesh);
}

function resample(points, step) {
  const src = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  if (src.length < 2) return src;
  const out = [src[0].clone()];
  let acc = 0;
  for (let i = 1; i < src.length; i++) {
    const seg = src[i].distanceTo(src[i - 1]);
    if (seg < 1e-3) continue;
    let travelled = 0;
    while (acc + (seg - travelled) >= step) {
      const need = step - acc;
      travelled += need;
      out.push(src[i - 1].clone().lerp(src[i], travelled / seg));
      acc = 0;
    }
    acc += seg - travelled;
  }
  if (out[out.length - 1].distanceTo(src[src.length - 1]) > 1) out.push(src[src.length - 1].clone());
  return out;
}

function frameAt(pts, i) {
  const a = pts[Math.max(0, i - 1)];
  const b = pts[Math.min(pts.length - 1, i + 1)];
  const dir = b.clone().sub(a);
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
  dir.normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  return { dir, side };
}

function trussBridge(item) {
  const g = new THREE.Group();
  const pts = resample(item.points, 9);
  const half = 7.2;
  const rise = 12;
  for (const sign of [-1, 1]) {
    const bottom = [];
    const top = [];
    for (let i = 0; i < pts.length; i++) {
      const { side } = frameAt(pts, i);
      const t = pts.length === 1 ? 0.5 : i / (pts.length - 1);
      const arch = 1.4 + rise * 4 * t * (1 - t);
      const base = pts[i].clone().add(side.clone().multiplyScalar(half * sign));
      bottom.push(base.clone());
      top.push(base.clone().add(new THREE.Vector3(0, arch, 0)));
    }
    for (let i = 1; i < bottom.length; i++) {
      member(g, bottom[i - 1], bottom[i], 0.38, steel);
      member(g, top[i - 1], top[i], 0.42, steel);
      member(g, bottom[i], top[i], 0.28, steel);
      member(g, bottom[i - 1], top[i], 0.22, steel);
    }
  }
  // Portal frames at the ends and the crown, so the two trusses read as one bridge.
  for (const i of [0, Math.floor(pts.length / 2), pts.length - 1]) {
    const { side } = frameAt(pts, i);
    const t = i / (pts.length - 1);
    const arch = 1.4 + rise * 4 * t * (1 - t);
    const left = pts[i].clone().add(side.clone().multiplyScalar(-half));
    const right = pts[i].clone().add(side.clone().multiplyScalar(half));
    member(g, left.clone().setY(left.y + arch), right.clone().setY(right.y + arch), 0.35, steel);
  }
  return g;
}

function towerPair(group, base, dir, height, spread, style) {
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const left = base.clone().add(side.clone().multiplyScalar(spread));
  const right = base.clone().add(side.clone().multiplyScalar(-spread));
  if (style === 'y') {
    const top = base.clone();
    top.y += height;
    member(group, left, top, 2.6, concrete, 10);
    member(group, right, top, 2.6, concrete, 10);
    const beam = 0.42;
    const a = left.clone().lerp(top, beam);
    const b = right.clone().lerp(top, beam);
    member(group, a, b, 1.7, concrete, 8);
    return top;
  }
  const topL = left.clone();
  topL.y += height;
  const topR = right.clone();
  topR.y += height;
  member(group, left, topL, 2.4, concrete, 10);
  member(group, right, topR, 2.4, concrete, 10);
  member(group, topL, topR, 1.8, concrete, 8);
  const midL = left.clone().lerp(topL, 0.58);
  const midR = right.clone().lerp(topR, 0.58);
  member(group, midL, midR, 1.5, concrete, 8);
  return topL.clone().add(topR).multiplyScalar(0.5);
}

function cableBridge(item) {
  const g = new THREE.Group();
  const pts = resample(item.points, 14);
  if (pts.length < 2) return g;
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = acc[acc.length - 1];
  const main = Math.min(item.mainSpan || total * 0.6, total * 0.78);
  const a0 = (total - main) / 2;
  const at = (dist) => {
    const d = Math.max(0, Math.min(total, dist));
    let i = 1;
    while (i < acc.length - 1 && acc[i] < d) i += 1;
    const span = acc[i] - acc[i - 1] || 1;
    const t = (d - acc[i - 1]) / span;
    return pts[i - 1].clone().lerp(pts[i], t);
  };
  const dirOf = (dist) => {
    const p = at(dist - 8);
    const q = at(dist + 8);
    const dir = q.sub(p);
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
    return dir.normalize();
  };
  const height = item.towerH || 150;
  const style = item.style || 'h';
  const anchors = [];
  for (const dist of [a0, a0 + main]) {
    const base = at(dist);
    anchors.push(towerPair(g, base, dirOf(dist), height, 14, style));
  }
  const fanFrom = Math.max(0, a0 - main * 0.22);
  const fanTo = Math.min(total, a0 + main + main * 0.22);
  for (let d = fanFrom; d <= fanTo; d += 28) {
    const deck = at(d);
    const anchor = d < a0 + main / 2 ? anchors[0] : anchors[1];
    member(g, anchor, deck, 0.38, cableMat, 4);
  }
  g.userData.towers = 2;
  return g;
}

const BUILDERS = { truss: trussBridge, cable: cableBridge };

export function createBridges(list) {
  const group = new THREE.Group();
  group.name = 'bridges';
  for (const item of list || []) {
    const build = BUILDERS[item.kind];
    if (!build || !item.points || item.points.length < 2) continue;
    const model = build(item);
    model.userData.bridge = item.id;
    group.add(model);
  }
  return group;
}

export function syncBridgeNight(night) {
  concrete.emissiveIntensity = night * 0.35;
  cableMat.emissiveIntensity = night * 0.55;
  void cityUniforms;
}
