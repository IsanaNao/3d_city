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

function member(group, a, b, radius, mat, sides = 6, part = '') {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 0.4) return null;
  const geo = new THREE.CylinderGeometry(radius, radius, len, sides);
  geo.translate(0, len / 2, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.multiplyScalar(1 / len));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  if (part) mesh.userData.part = part;
  mesh.userData.anchor = a.clone();
  group.add(mesh);
  return mesh;
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

// Riveted steel painted dark grey, as the Garden Bridge is.
const trussSteel = new THREE.MeshStandardMaterial({
  color: 0x5c6266, metalness: 0.42, roughness: 0.58,
  emissive: new THREE.Color(0xffd8a0), emissiveIntensity: 0,
});
const pierStone = new THREE.MeshStandardMaterial({ color: 0x8f8a80, metalness: 0.02, roughness: 0.86 });

// Waibaidu (Garden) Bridge, 1907: two spans of camelback through-truss, about
// 52 m each, meeting on a pier in the creek. Each truss has a polygonal top
// chord, highest at mid-span, inclined end posts, verticals at every panel
// point and Pratt diagonals falling toward the middle. Overhead struts and
// cross-bracing tie the two trusses. Members are rectangular, not tubes.
function trussBridge(item) {
  const g = new THREE.Group();
  const path = item.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  let length = 0;
  for (let i = 1; i < path.length; i++) length += path[i].distanceTo(path[i - 1]);
  const spans = length > 70 ? 2 : 1;
  const panels = 8;
  const half = 7.6;
  const pts = resample(item.points, length / (spans * panels));
  while (pts.length < spans * panels + 1) pts.push(pts[pts.length - 1].clone());
  const heightAt = (k) => {
    // Panel index within its span: low at the end posts, highest mid-span.
    const s = k / panels;
    return 5.2 + 5.6 * Math.sin(Math.PI * s) ** 0.8;
  };
  const up = new THREE.Vector3(0, 1, 0);
  for (let sp = 0; sp < spans; sp++) {
    const i0 = sp * panels;
    for (const sign of [-1, 1]) {
      const bottom = [];
      const top = [];
      for (let k = 0; k <= panels; k++) {
        const i = Math.min(pts.length - 1, i0 + k);
        const { side } = frameAt(pts, i);
        const base = pts[i].clone().add(side.clone().multiplyScalar(half * sign));
        base.y += 0.4;
        bottom.push(base);
        top.push(base.clone().add(new THREE.Vector3(0, heightAt(k), 0)));
      }
      const { side } = frameAt(pts, i0 + panels / 2);
      for (let k = 0; k < panels; k++) {
        boxMember(g, bottom[k], bottom[k + 1], up, 0.55, 0.9, trussSteel, 'truss-chord');
      }
      // Inclined end posts carry the top chord down to the bearings.
      boxMember(g, bottom[0], top[1], side, 0.75, 0.75, trussSteel, 'truss-post');
      boxMember(g, bottom[panels], top[panels - 1], side, 0.75, 0.75, trussSteel, 'truss-post');
      for (let k = 1; k < panels - 1; k++) boxMember(g, top[k], top[k + 1], side, 0.75, 0.8, trussSteel, 'truss-chord');
      for (let k = 1; k < panels; k++) boxMember(g, bottom[k], top[k], side, 0.32, 0.5, trussSteel, 'truss-vertical');
      for (let k = 1; k < panels - 1; k++) {
        // Pratt: diagonals fall toward mid-span.
        if (k < panels / 2) boxMember(g, top[k], bottom[k + 1], side, 0.26, 0.42, trussSteel, 'truss-diagonal');
        else boxMember(g, top[k + 1], bottom[k], side, 0.26, 0.42, trussSteel, 'truss-diagonal');
      }
    }
    // Overhead struts at the panel points and X-bracing between them.
    for (let k = 1; k < panels; k++) {
      const i = Math.min(pts.length - 1, i0 + k);
      const { side, dir } = frameAt(pts, i);
      const y = pts[i].y + 0.4 + heightAt(k);
      const l = pts[i].clone().add(side.clone().multiplyScalar(-half));
      const r = pts[i].clone().add(side.clone().multiplyScalar(half));
      l.y = y;
      r.y = y;
      boxMember(g, l, r, dir, 0.35, 0.5, trussSteel, 'truss-strut');
    }
    for (let k = 1; k < panels - 1; k++) {
      const a = Math.min(pts.length - 1, i0 + k);
      const b = Math.min(pts.length - 1, i0 + k + 1);
      const fa = frameAt(pts, a);
      const fb = frameAt(pts, b);
      const ya = pts[a].y + 0.4 + heightAt(k);
      const yb = pts[b].y + 0.4 + heightAt(k + 1);
      const p0 = pts[a].clone().add(fa.side.clone().multiplyScalar(-half)).setY(ya);
      const p1 = pts[b].clone().add(fb.side.clone().multiplyScalar(half)).setY(yb);
      boxMember(g, p0, p1, up, 0.16, 0.22, trussSteel, 'truss-brace');
      const q0 = pts[a].clone().add(fa.side.clone().multiplyScalar(half)).setY(ya);
      const q1 = pts[b].clone().add(fb.side.clone().multiplyScalar(-half)).setY(yb);
      boxMember(g, q0, q1, up, 0.16, 0.22, trussSteel, 'truss-brace');
    }
  }
  // The pier between the spans, down into the creek.
  if (spans === 2) {
    const mid = pts[Math.min(pts.length - 1, panels)];
    const { dir } = frameAt(pts, panels);
    const pierH = Math.max(3, mid.y - 0.5);
    const geo = new THREE.BoxGeometry(3.2, pierH, half * 2 + 3.6);
    geo.translate(0, -pierH / 2, 0);
    const pier = new THREE.Mesh(geo, pierStone);
    pier.position.copy(mid);
    orientBox(pier, dir, new THREE.Vector3(0, 1, 0));
    pier.castShadow = true;
    pier.receiveShadow = true;
    pier.userData.part = 'pier';
    g.add(pier);
  }
  return g;
}

function orientBox(mesh, xAxis, yAxis) {
  const x = xAxis.clone().normalize();
  const y = yAxis.clone().normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const yOrtho = new THREE.Vector3().crossVectors(z, x).normalize();
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, yOrtho, z));
}

// Rectangular concrete member. Local X follows `across`, local Y follows a→b.
function boxMember(group, a, b, across, thickness, depth, mat, part) {
  const along = b.clone().sub(a);
  const len = along.length();
  if (len < 0.4) return null;
  const geo = new THREE.BoxGeometry(thickness, len, depth);
  geo.translate(0, len / 2, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(a);
  orientBox(mesh, across, along);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.userData.part = part;
  mesh.userData.anchor = b.clone();
  group.add(mesh);
  return mesh;
}

function towerPair(group, base, dir, height, spread, style) {
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
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
    return { left: top, right: top, side };
  }
  // Both Nanpu towers are the same H: two legs across the deck and two crossbeams.
  // The frame is yawed off the pure cross-section so a side view still shows both
  // legs instead of stacking them into one pole.
  const legH = height;
  const along = new THREE.Vector3(dir.x, 0, dir.z).normalize();
  boxMember(group, left, left.clone().setY(base.y + legH), side, 4.4, 6.6, concrete, 'h-leg');
  boxMember(group, right, right.clone().setY(base.y + legH), side, 4.4, 6.6, concrete, 'h-leg');
  const beamAt = (t, tall, deep) => {
    const a = left.clone().setY(base.y + legH * t);
    const b = right.clone().setY(base.y + legH * t);
    boxMember(group, a, b, along, deep, tall, concrete, 'h-beam');
  };
  beamAt(0.56, 3.2, 5.4);
  beamAt(0.96, 3.6, 6.0);
  const anchorY = base.y + legH * 0.9;
  return {
    left: left.clone().setY(anchorY),
    right: right.clone().setY(anchorY),
    side,
  };
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
  // One span direction for both towers, so the two H frames stay parallel.
  let face = dirOf(a0 + main * 0.5);
  if (style === 'h') {
    const yaw = -0.7;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    face = new THREE.Vector3(face.x * c - face.z * s, 0, face.x * s + face.z * c).normalize();
  }
  const anchors = [];
  for (const dist of [a0, a0 + main]) {
    anchors.push(towerPair(g, at(dist), face, height, 20, style));
  }
  const fanFrom = Math.max(0, a0 - main * 0.22);
  const fanTo = Math.min(total, a0 + main + main * 0.22);
  for (let d = fanFrom; d <= fanTo; d += 26) {
    const deck = at(d);
    const tower = d < a0 + main / 2 ? anchors[0] : anchors[1];
    if (style === 'h') {
      const side = tower.side;
      member(g, tower.left, deck.clone().add(side.clone().multiplyScalar(8)), 0.34, cableMat, 4, 'cable');
      member(g, tower.right, deck.clone().add(side.clone().multiplyScalar(-8)), 0.34, cableMat, 4, 'cable');
    } else {
      member(g, tower.left, deck, 0.38, cableMat, 4, 'cable');
    }
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
  // The truss is outlined in warm light at night.
  trussSteel.emissiveIntensity = night * 0.28;
  void cityUniforms;
}
