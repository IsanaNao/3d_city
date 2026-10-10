import * as THREE from 'three';
import { cityUniforms } from './materials.js';

// Self-made stand-ins for towers an extruded footprint cannot describe.
// Oriental Pearl: three splayed columns, two pink spheres, a spire.
// Shanghai Tower: a rounded triangle that twists as it rises.
// SWFC: a tapering slab with the aperture near the top.
// Jin Mao: pagoda setbacks. Customs House: a clock tower, when OSM has one.

const steel = new THREE.MeshStandardMaterial({ color: 0xd5d9de, metalness: 0.72, roughness: 0.34 });
const dark = new THREE.MeshStandardMaterial({ color: 0x3a4148, metalness: 0.45, roughness: 0.5 });
const pearlMat = new THREE.MeshStandardMaterial({
  color: 0xf3b4c6, metalness: 0.28, roughness: 0.22,
  emissive: new THREE.Color(0xff4f86), emissiveIntensity: 0,
});
const pearlBand = new THREE.MeshStandardMaterial({
  color: 0xffe7c2, metalness: 0.1, roughness: 0.4,
  emissive: new THREE.Color(0xfff1cf), emissiveIntensity: 0,
});
const beaconMat = new THREE.MeshStandardMaterial({
  color: 0xff3030, emissive: new THREE.Color(0xff2020), emissiveIntensity: 0.4,
});
const clockMat = new THREE.MeshStandardMaterial({
  color: 0xf4efe4, emissive: new THREE.Color(0xffe2a8), emissiveIntensity: 0,
});

function glassMaterial(hex) {
  const mat = new THREE.MeshStandardMaterial({ color: hex, metalness: 0.62, roughness: 0.16 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = cityUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLm = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying vec3 vLm;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fy = vLm.y / 4.15;
        float row = floor(fy);
        float pane = smoothstep(0.16, 0.26, fract(fy)) * (1.0 - smoothstep(0.78, 0.9, fract(fy)));
        float on = step(0.55, fract(sin(row * 17.13 + floor(vLm.x * 0.15) * 3.1) * 43758.5));
        totalEmissiveRadiance += vec3(1.0, 0.78, 0.48) * pane * on * uNight * 1.15;
      `);
  };
  mat.customProgramCacheKey = () => `lm-glass-${hex}`;
  return mat;
}

const glassBlue = glassMaterial(0x9eb4c6);
const glassSilver = glassMaterial(0xb7c3ce);
glassBlue.side = THREE.DoubleSide;
glassSilver.side = THREE.DoubleSide;

function add(group, geo, mat) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function sphere(r, y, mat) {
  const geo = new THREE.SphereGeometry(r, 28, 20);
  geo.translate(0, y, 0);
  return { geo, mat };
}

function pearl(h) {
  const g = new THREE.Group();
  const lowerY = h * 0.205;
  const upperY = h * 0.555;
  const angles = [0, 1, 2].map((k) => (k / 3) * Math.PI * 2 + 0.35);
  const spreadAt = (t) => 6.5 + 38 * (1 - t) ** 1.25;
  const column = (angle, t0, t1) => {
    const pts = [];
    const steps = Math.max(2, Math.round((t1 - t0) * 24));
    for (let i = 0; i <= steps; i++) {
      const t = t0 + (t1 - t0) * (i / steps);
      const spread = spreadAt(t);
      pts.push(new THREE.Vector3(Math.cos(angle) * spread, t * upperY, Math.sin(angle) * spread));
    }
    add(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps, 2.7, 8, false), steel);
  };
  for (const angle of angles) {
    column(angle, 0, 0.18);
    column(angle, 0.56, 0.9);
    const podT = 0.66;
    const spread = spreadAt(podT);
    add(g, new THREE.SphereGeometry(7.2, 16, 12).translate(Math.cos(angle) * spread, podT * upperY, Math.sin(angle) * spread), pearlMat);
  }
  for (const t of [0.12, 0.72, 0.84]) {
    const y = t * upperY;
    const spread = spreadAt(t);
    const ring = angles.map((angle) => new THREE.Vector3(Math.cos(angle) * spread, y, Math.sin(angle) * spread));
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      add(g, new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, 0.65, 5, false), steel);
    }
  }
  const lowerR = h * 0.054;
  const upperR = h * 0.046;
  add(g, sphere(lowerR, lowerY, pearlMat).geo, pearlMat);
  add(g, new THREE.TorusGeometry(lowerR + 0.6, 0.7, 8, 32).rotateX(Math.PI / 2).translate(0, lowerY, 0), pearlBand);
  add(g, sphere(upperR, upperY, pearlMat).geo, pearlMat);
  add(g, new THREE.TorusGeometry(upperR + 0.5, 0.55, 8, 28).rotateX(Math.PI / 2).translate(0, upperY + upperR * 0.35, 0), pearlBand);
  const capsuleY = upperY + upperR + h * 0.055;
  add(g, sphere(h * 0.016, capsuleY, pearlMat).geo, pearlMat);
  const mastH = h - (capsuleY + h * 0.02);
  const spire = new THREE.CylinderGeometry(0.28, 1.15, mastH, 8);
  spire.translate(0, capsuleY + h * 0.02 + mastH / 2, 0);
  add(g, spire, steel);
  add(g, new THREE.SphereGeometry(1.15, 10, 8).translate(0, h * 0.995, 0), beaconMat);
  add(g, new THREE.CylinderGeometry(14, 20, 5.5, 18).translate(0, 2.6, 0), dark);
  return g;
}

function ringPoints(segs, radius, twist, y, lobes) {
  const pts = [];
  for (let s = 0; s < segs; s++) {
    const a = (s / segs) * Math.PI * 2;
    const r = radius * (lobes ? 0.74 + 0.26 * Math.cos(3 * a) : 1);
    const ang = a + twist;
    pts.push(new THREE.Vector3(Math.cos(ang) * r, y, Math.sin(ang) * r));
  }
  return pts;
}

function shellBetween(group, a, b, mat, closed = true) {
  const geo = new THREE.BufferGeometry();
  const pos = [];
  const idx = [];
  const n = a.length;
  const quads = closed ? n : n - 1;
  for (let i = 0; i < quads; i++) {
    const i2 = (i + 1) % n;
    const base = pos.length / 3;
    for (const p of [a[i], a[i2], b[i2], b[i]]) pos.push(p.x, p.y, p.z);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  add(group, geo, mat);
}

function capRing(group, ring, mat) {
  const geo = new THREE.BufferGeometry();
  const pos = [0, ring[0].y, 0];
  for (const p of ring) pos.push(p.x, p.y, p.z);
  const idx = [];
  for (let i = 0; i < ring.length; i++) idx.push(0, i + 1, ((i + 1) % ring.length) + 1);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  add(group, geo, mat);
}

function shanghai(h) {
  const g = new THREE.Group();
  const segs = 42;
  const steps = 34;
  let prev = null;
  let prevIn = null;
  let top = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = (t ** 0.96) * h * 0.93;
    const twist = t * (120 * Math.PI / 180);
    const radius = 34 * (1 - 0.46 * t);
    const ring = ringPoints(segs, radius, twist, y, true);
    const inner = ringPoints(segs, radius * 0.82, twist, y, true);
    if (prev) shellBetween(g, prev, ring, glassBlue);
    if (prevIn) shellBetween(g, prevIn, inner, dark);
    prev = ring;
    prevIn = inner;
    top = ring;
  }
  if (prev) capRing(g, prev, dark);
  const crownY = h * 0.93;
  const crown = ringPoints(segs, 8, 120 * Math.PI / 180, crownY + h * 0.03, true);
  if (top) shellBetween(g, top, crown, glassSilver);
  const mast = new THREE.CylinderGeometry(0.45, 1.6, h * 0.045, 8);
  mast.translate(0, h * 0.98, 0);
  add(g, mast, steel);
  add(g, new THREE.SphereGeometry(0.7, 8, 6).translate(0, h, 0), beaconMat);
  return g;
}

function swfc(h) {
  const g = new THREE.Group();
  const steps = 28;
  const hole0 = 0.67;
  const hole1 = 0.91;
  const grids = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = t * h * 0.98;
    const w = 54 * (1 - 0.34 * t);
    const d = 40 * (1 - 0.28 * t);
    grids.push({ y, w, d, t });
  }
  const face = (i, side) => {
    const a = grids[i];
    const b = grids[i + 1];
    const open = a.t >= hole0 && b.t <= hole1;
    if (side === 'f' || side === 'b') {
      const z0 = side === 'f' ? a.d / 2 : -a.d / 2;
      const z1 = side === 'f' ? b.d / 2 : -b.d / 2;
      const u = (a.t - hole0) / (hole1 - hole0);
      const jamb = open ? 0.38 - 0.14 * u : 1;
      const xs = open ? [[-a.w / 2, -a.w * jamb], [a.w * jamb, a.w / 2]] : [[-a.w / 2, a.w / 2]];
      const xs1 = open ? [[-b.w / 2, -b.w * jamb], [b.w * jamb, b.w / 2]] : [[-b.w / 2, b.w / 2]];
      xs.forEach((span, k) => {
        const s1 = xs1[k];
        const quad = [
          new THREE.Vector3(span[0], a.y, z0), new THREE.Vector3(span[1], a.y, z0),
          new THREE.Vector3(s1[1], b.y, z1), new THREE.Vector3(s1[0], b.y, z1),
        ];
        if (side === 'b') quad.reverse();
        shellBetween(g, [quad[0], quad[1]], [quad[3], quad[2]], glassBlue, false);
      });
    } else {
      const x0 = side === 'r' ? a.w / 2 : -a.w / 2;
      const x1 = side === 'r' ? b.w / 2 : -b.w / 2;
      const ringA = [new THREE.Vector3(x0, a.y, -a.d / 2), new THREE.Vector3(x0, a.y, a.d / 2)];
      const ringB = [new THREE.Vector3(x1, b.y, -b.d / 2), new THREE.Vector3(x1, b.y, b.d / 2)];
      if (side === 'l') { ringA.reverse(); ringB.reverse(); }
      shellBetween(g, ringA, ringB, glassBlue, false);
    }
  };
  for (let i = 0; i < steps; i++) for (const side of ['f', 'b', 'l', 'r']) face(i, side);
  // A dark rim so the opening still reads when the sky shows through it.
  for (const zSign of [1, -1]) {
    const y0 = hole0 * h * 0.98;
    const y1 = hole1 * h * 0.98;
    const mid = (hole0 + hole1) / 2;
    const w = 54 * (1 - 0.34 * mid);
    const depth = 40 * (1 - 0.28 * hole0);
    const z = zSign * (depth / 2 + 0.6);
    const opening = w * 0.62;
    const thick = 3.4;
    for (const x of [-1, 1]) {
      const jambBox = new THREE.BoxGeometry(thick, y1 - y0 + thick, 2.2);
      jambBox.translate(x * (opening / 2 + thick / 2), (y0 + y1) / 2, z);
      add(g, jambBox, dark);
    }
    for (const y of [y0, y1]) {
      const bar = new THREE.BoxGeometry(opening, thick, 2.2);
      bar.translate(0, y, z);
      add(g, bar, dark);
    }
  }
  add(g, new THREE.CylinderGeometry(0.6, 2.2, h * 0.025, 8).translate(0, h * 0.99, 0), steel);
  return g;
}

function jinmao(h) {
  const g = new THREE.Group();
  const tiers = 13;
  const heights = [];
  let sum = 0;
  for (let i = 0; i < tiers; i++) {
    const tierH = 16 * 0.92 ** i;
    heights.push(tierH);
    sum += tierH;
  }
  const scale = (h * 0.86) / sum;
  let y = 0;
  let radius = 27;
  for (let i = 0; i < tiers; i++) {
    const tierH = heights[i] * scale;
    const next = radius * (0.9 - 0.035 * (i / tiers));
    const lower = ringPoints(8, radius, Math.PI / 8, y, false);
    const upper = ringPoints(8, radius * 0.985, Math.PI / 8, y + tierH * 0.7, false);
    const cap = ringPoints(8, next, Math.PI / 8, y + tierH, false);
    shellBetween(g, lower, upper, i % 2 ? glassSilver : steel);
    shellBetween(g, upper, cap, dark);
    if (i === 0) capRing(g, lower, dark);
    y += tierH;
    radius = next;
  }
  const spire = new THREE.CylinderGeometry(0.4, 3.2, h - y, 8);
  spire.translate(0, y + (h - y) / 2, 0);
  add(g, spire, steel);
  add(g, new THREE.SphereGeometry(0.7, 8, 6).translate(0, h, 0), beaconMat);
  return g;
}

function customs(h) {
  const g = new THREE.Group();
  const baseH = h * 0.55;
  add(g, new THREE.BoxGeometry(46, baseH, 22).translate(0, baseH / 2, 0), stoneMat());
  const tower = new THREE.BoxGeometry(11, h - baseH, 11);
  tower.translate(0, baseH + (h - baseH) / 2, 0);
  add(g, tower, stoneMat());
  const face = new THREE.CircleGeometry(2.1, 20);
  face.translate(0, h * 0.78, 5.55);
  add(g, face, clockMat);
  const roof = new THREE.ConeGeometry(8, 7, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, h + 2.5, 0);
  add(g, roof, dark);
  return g;
}

function stoneMat() {
  return new THREE.MeshStandardMaterial({ color: 0xe4d2b0, roughness: 0.78, metalness: 0.02 });
}

const BUILDERS = { pearl, shanghai, swfc, jinmao, customs };

export const landmarkNight = { pearlMat, pearlBand, beaconMat, clockMat };

export function createLandmarks(list) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  for (const item of list || []) {
    const build = BUILDERS[item.id];
    if (!build) continue;
    const model = build(item.h);
    model.position.set(item.x, item.y, item.z);
    // SWFC's footprint is nearly square, so the longest edge does not say which
    // face holds the aperture. The opening faces the river, southwest.
    model.rotation.y = item.id === 'swfc' ? -Math.PI / 4 : (item.yaw || 0);
    model.userData.landmark = item;
    group.add(model);
  }
  return group;
}

export function syncLandmarkNight(night) {
  pearlMat.emissiveIntensity = night * 2.4;
  pearlBand.emissiveIntensity = 0.15 + night * 1.6;
  beaconMat.emissiveIntensity = 0.35 + night * 2;
  clockMat.emissiveIntensity = night * 0.8;
}
