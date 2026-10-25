import * as THREE from 'three';
import { cityUniforms } from './materials.js';

// Parametric stand-ins. The road deck itself stays the OSM carriageway;
// these add the truss, the towers and the cable fans.

const concrete = new THREE.MeshStandardMaterial({
  color: 0xc5c8c2, metalness: 0.08, roughness: 0.72,
  emissive: new THREE.Color(0xffe0b0), emissiveIntensity: 0,
});

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

// Tower flood colours follow the 2018 lighting scheme: Nanpu's pylons are lit
// white, Yangpu's red, and both carry strings of white lamps on the stays.
const towerMats = {
  h: new THREE.MeshStandardMaterial({
    color: 0xc5c8c2, metalness: 0.08, roughness: 0.72,
    emissive: new THREE.Color(0xf2f4ff), emissiveIntensity: 0,
  }),
  y: new THREE.MeshStandardMaterial({
    color: 0xc5c8c2, metalness: 0.08, roughness: 0.72,
    emissive: new THREE.Color(0xff3a26), emissiveIntensity: 0,
  }),
};
const beaconMat = new THREE.MeshStandardMaterial({
  color: 0xffffff, emissive: new THREE.Color(0xfff4e0), emissiveIntensity: 0,
});
// Flat crossed ribbons instead of round tubes: a stay is a hairline at any
// distance, and two quads per cable keep 200+ stays to a single draw call.
// Matte and close to the sky's value: a fan of 128 sub-pixel lines with
// metallic highlights beats into moire, a soft grey reads as a light veil.
const stayMat = new THREE.MeshStandardMaterial({
  color: 0xb9c0c6, metalness: 0.0, roughness: 0.85, side: THREE.DoubleSide,
  transparent: true, opacity: 0.75, depthWrite: false,
});
stayMat.onBeforeCompile = (shader) => {
  shader.uniforms.uNight = cityUniforms.uNight;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aAlong;\nvarying float vAlong;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlong = aAlong;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vAlong;')
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      // One lamp every 4 m along the stay. When lamps shrink below a pixel the
      // string averages to a steady line instead of shimmering.
      float cell = vAlong / 4.0;
      float fw = fwidth(cell);
      float lamp = 1.0 - smoothstep(0.08, 0.08 + max(fw, 0.04), abs(fract(cell) - 0.5));
      float far = smoothstep(0.25, 0.8, fw);
      float glow = mix(0.2 + 1.6 * lamp, 0.32, far);
      totalEmissiveRadiance += vec3(1.0, 0.97, 0.9) * glow * uNight * 0.9;
      // Unlit stays at night are dark cable, not lit grey.
      diffuseColor.rgb *= 1.0 - 0.8 * uNight;
    `);
};
stayMat.customProgramCacheKey = () => 'bridge-stay-2';

function stayRibbons(stays, width) {
  const pos = [];
  const along = [];
  const idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const [a, b] of stays) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 1) continue;
    dir.normalize();
    const side = new THREE.Vector3().crossVectors(dir, up);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const lift = new THREE.Vector3().crossVectors(side, dir).normalize();
    for (const off of [side, lift]) {
      const o = off.clone().multiplyScalar(width / 2);
      const base = pos.length / 3;
      for (const [p, t] of [[a.clone().sub(o), 0], [a.clone().add(o), 0], [b.clone().add(o), len], [b.clone().sub(o), len]]) {
        pos.push(p.x, p.y, p.z);
        along.push(t);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// Heights are measured from the river (y = 0): the published 150 m and 208 m
// are pylon heights above water, not above the deck.
function towerPair(group, base, dir, height, spread, style) {
  const mat = towerMats[style] || concrete;
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  const along = new THREE.Vector3(dir.x, 0, dir.z).normalize();
  const foot = base.clone().setY(0);
  const deckY = base.y;
  const topY = height;
  const beacon = (p) => {
    const geo = new THREE.BoxGeometry(2.4, 2.4, 2.4);
    geo.translate(p.x, p.y + 1.2, p.z);
    const m = new THREE.Mesh(geo, beaconMat);
    m.userData.part = 'tower-top';
    group.add(m);
  };
  if (style === 'y') {
    // Yangpu: an inverted Y. Two raked legs straddle the deck from the water
    // and join about 60% up; the stays anchor along the single top shaft.
    const joinY = topY * 0.6;
    const legFoot = (sgn) => foot.clone().add(side.clone().multiplyScalar(sgn * spread * 1.25));
    const join = foot.clone().setY(joinY);
    boxMember(group, legFoot(1), join, side, 5.6, 7.2, mat, 'y-leg');
    boxMember(group, legFoot(-1), join, side, 5.6, 7.2, mat, 'y-leg');
    // The lower crossbeam carries the deck.
    const t = (deckY - 3) / joinY;
    boxMember(group, legFoot(1).lerp(join, t), legFoot(-1).lerp(join, t), along, 4, 6.4, mat, 'y-beam');
    boxMember(group, join.clone().setY(joinY - 6), foot.clone().setY(topY), side, 6.4, 8, mat, 'y-shaft');
    beacon(foot.clone().setY(topY));
    const anchorAt = (k) => foot.clone().setY(joinY + 8 + (topY - joinY - 14) * k);
    return { left: anchorAt, right: anchorAt, side, along };
  }
  // Nanpu: an H. Two legs from the water, one crossbeam under the deck and one
  // near the top. The frame is yawed off the pure cross-section so a side
  // view still shows both legs instead of stacking them into one pole.
  const left = foot.clone().add(side.clone().multiplyScalar(spread));
  const right = foot.clone().add(side.clone().multiplyScalar(-spread));
  boxMember(group, left, left.clone().setY(topY), side, 4.4, 6.6, mat, 'h-leg');
  boxMember(group, right, right.clone().setY(topY), side, 4.4, 6.6, mat, 'h-leg');
  const beamAt = (y, tall, deep) => {
    boxMember(group, left.clone().setY(y), right.clone().setY(y), along, deep, tall, mat, 'h-beam');
  };
  beamAt(deckY - 4, 3.6, 6.0);
  beamAt(topY - 6, 3.6, 6.0);
  beacon(left.clone().setY(topY));
  beacon(right.clone().setY(topY));
  const upper = deckY + (topY - deckY) * 0.45;
  return {
    left: (k) => left.clone().setY(upper + (topY - 9 - upper) * k),
    right: (k) => right.clone().setY(upper + (topY - 9 - upper) * k),
    side,
    along,
  };
}

// Published stay counts: Nanpu has 22 stays per fan, Yangpu 32, two planes
// each, fanning both into the main span and back over the side span.
const STAYS_PER_FAN = { h: 22, y: 32 };

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
  // One span direction for both towers, so the two frames stay parallel.
  let face = dirOf(a0 + main * 0.5);
  if (style === 'h') {
    const yaw = -0.7;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    face = new THREE.Vector3(face.x * c - face.z * s, 0, face.x * s + face.z * c).normalize();
  }
  const spread = style === 'y' ? 16 : 20;
  const n = STAYS_PER_FAN[style] || 22;
  const stays = [];
  const towerDists = [a0, a0 + main];
  towerDists.forEach((td, ti) => {
    const tower = towerPair(g, at(td), face, height, spread, style);
    const inward = ti === 0 ? 1 : -1;
    const reachMain = main / 2 - 8;
    // The side spans are shorter than half the main span; the OSM way may be
    // shorter still, so the back fan is clamped to the deck that exists.
    const reachBack = Math.min(main * 0.4, ti === 0 ? td : total - td) - 4;
    for (const [dirSign, reach] of [[inward, reachMain], [-inward, reachBack]]) {
      if (reach < 20) continue;
      for (let k = 0; k < n; k++) {
        const t = (k + 1) / n;
        const deck = at(td + dirSign * (14 + (reach - 14) * t));
        // Semi-fan: the longest stay anchors highest on the pylon.
        if (style === 'h') {
          stays.push([tower.left(t), deck.clone().add(tower.side.clone().multiplyScalar(spread - 6))]);
          stays.push([tower.right(t), deck.clone().add(tower.side.clone().multiplyScalar(-(spread - 6)))]);
        } else {
          // Yangpu's two planes start together at the shaft and spread to the deck edges.
          stays.push([tower.left(t), deck.clone().add(tower.side.clone().multiplyScalar(13))]);
          stays.push([tower.right(t), deck.clone().add(tower.side.clone().multiplyScalar(-13))]);
        }
      }
    }
  });
  const ribbons = new THREE.Mesh(stayRibbons(stays, 0.32), stayMat);
  ribbons.frustumCulled = false;
  ribbons.userData.part = 'stays';
  ribbons.userData.count = stays.length;
  g.add(ribbons);
  g.userData.towers = 2;
  g.userData.stays = stays.length;
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
  towerMats.h.emissiveIntensity = night * 0.42;
  towerMats.y.emissiveIntensity = night * 0.5;
  beaconMat.emissiveIntensity = 0.3 + night * 2.2;
  // The truss is outlined in warm light at night.
  trussSteel.emissiveIntensity = night * 0.28;
  void cityUniforms;
}
