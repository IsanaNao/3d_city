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
  mesh.frustumCulled = false;
  geo.computeBoundingSphere();
  group.add(mesh);
  return mesh;
}

function tag(mesh, part, angle) {
  mesh.userData.part = part;
  if (angle != null) mesh.userData.angle = angle;
  return mesh;
}

function sphere(r, y, mat) {
  const geo = new THREE.SphereGeometry(r, 28, 20);
  geo.translate(0, y, 0);
  return { geo, mat };
}

const concrete = new THREE.MeshStandardMaterial({ color: 0xc3ccd4, metalness: 0.35, roughness: 0.48 });

// Published figures for the 468 m tower, scaled if a different height is passed in.
// Lower sphere Ø50 m at 93 m, upper Ø45 m at 272.5 m, space capsule Ø16 m at 342 m.
// Three 9 m columns link the large spheres; three splayed legs carry them from the ground.
function pearlMeasures(h) {
  const s = h / 468;
  return {
    s,
    lowerC: 93 * s,
    lowerR: 25 * s,
    upperC: 272.5 * s,
    upperR: 22.5 * s,
    capsuleC: 342 * s,
    capsuleR: 8 * s,
    legR: 5.6 * s,
    shaftR: 4.5 * s,
    foot: 40 * s,
    plinth: 5.45 * s,
  };
}

function along(angle, radius, y) {
  return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
}

function tube(group, points, radius, mat, part, angle) {
  const curve = points.length === 2
    ? new THREE.LineCurve3(points[0], points[1])
    : new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, Math.max(2, (points.length - 1) * 6), radius, 12, false);
  return tag(add(group, geo, mat), part, angle);
}

function pearl(h) {
  const g = new THREE.Group();
  const m = pearlMeasures(h);
  // One leg toward the usual southeast view, so the tripod reads in the close camera.
  const angles = [0, 1, 2].map((k) => (k / 3) * Math.PI * 2 + 0.85);
  const bury = (point, toward, radius) => point.clone().lerp(toward, radius / point.distanceTo(toward));

  for (const angle of angles) {
    const foot = along(angle, m.foot, m.plinth);
    const socket = along(angle, 15 * m.s, m.lowerC - 6 * m.s);
    const knee = foot.clone().lerp(socket, 0.45);
    knee.add(along(angle, 7 * m.s, 0));
    const legEnd = bury(socket, along(angle, 12 * m.s, m.lowerC), m.legR);
    tube(g, [foot, knee, legEnd], m.legR, concrete, 'leg', angle);

    const pod = foot.clone().lerp(legEnd, 0.42);
    tag(add(g, new THREE.SphereGeometry(6.2 * m.s, 16, 12).translate(pod.x, pod.y, pod.z), pearlMat), 'pod', angle);

    const emerge = along(angle, 15 * m.s, m.lowerC + 8 * m.s);
    const arrive = along(angle, 10 * m.s, m.upperC);
    const shaftEnd = bury(arrive, along(angle, 8 * m.s, m.upperC + m.upperR), m.shaftR);
    tube(g, [emerge, shaftEnd], m.shaftR, concrete, 'shaft', angle);
  }

  // Five 12 m spheres and the rings that tie the three columns together.
  const beads = [0.28, 0.28, 0.28, 0.62, 0.62];
  beads.forEach((t, i) => {
    const angle = angles[i % 3] + (i >= 3 ? 0.22 : 0);
    const y = m.lowerC + m.lowerR + (m.upperC - m.upperR - (m.lowerC + m.lowerR)) * t;
    const radial = (15 - 5 * t) * m.s;
    tag(add(g, new THREE.SphereGeometry(6 * m.s, 16, 12).translate(Math.cos(angle) * radial, y, Math.sin(angle) * radial), pearlMat), 'bead', angle);
  });
  for (const t of [0.22, 0.42, 0.62, 0.82]) {
    const y = m.lowerC + m.lowerR + (m.upperC - m.upperR - (m.lowerC + m.lowerR)) * t;
    const radial = (16 - 6 * t) * m.s;
    const ring = angles.map((angle) => along(angle, radial, y));
    for (let i = 0; i < ring.length; i++) tube(g, [ring[i], ring[(i + 1) % ring.length]], 1.15 * m.s, concrete, 'brace');
  }
  for (const t of [0.28, 0.62]) {
    const y = 4 + (m.lowerC - m.lowerR) * t;
    const radial = m.foot * (1 - t * 0.72);
    const ring = angles.map((angle) => along(angle, radial, y));
    for (let i = 0; i < ring.length; i++) tube(g, [ring[i], ring[(i + 1) % ring.length]], 1.3 * m.s, concrete, 'brace');
  }

  tag(add(g, sphere(m.lowerR, m.lowerC, pearlMat).geo, pearlMat), 'lower-sphere');
  add(g, new THREE.TorusGeometry(m.lowerR + 0.8, 0.9 * m.s, 8, 36).rotateX(Math.PI / 2).translate(0, m.lowerC, 0), pearlBand);
  tag(add(g, sphere(m.upperR, m.upperC, pearlMat).geo, pearlMat), 'upper-sphere');
  add(g, new THREE.TorusGeometry(m.upperR + 0.7, 0.75 * m.s, 8, 32).rotateX(Math.PI / 2).translate(0, m.upperC + m.upperR * 0.25, 0), pearlBand);

  tube(g, [along(0, 0, m.upperC + m.upperR * 0.35), along(0, 0, m.capsuleC + m.capsuleR * 0.4)], 2.4 * m.s, concrete, 'mast');
  tag(add(g, sphere(m.capsuleR, m.capsuleC, pearlMat).geo, pearlMat), 'capsule');
  const antennaH = h - (m.capsuleC + m.capsuleR);
  const antenna = new THREE.CylinderGeometry(0.22 * m.s, 1.15 * m.s, antennaH, 8);
  antenna.translate(0, m.capsuleC + m.capsuleR + antennaH / 2, 0);
  tag(add(g, antenna, steel), 'antenna');
  add(g, new THREE.SphereGeometry(1.1 * m.s, 10, 8).translate(0, h * 0.998, 0), beaconMat);
  pearlPlinth(g, m, angles);
  return g;
}

const plinthMat = new THREE.MeshStandardMaterial({ color: 0xd8d3c9, roughness: 0.86, metalness: 0.03 });
const treadMat = new THREE.MeshStandardMaterial({ color: 0xc4bfb4, roughness: 0.92, metalness: 0.02 });

// The tower stands on a circular stepped podium. Stairs occupy the three
// gaps between the legs; the terraces are the arcs the legs stand on.
function pearlPlinth(g, m, angles) {
  const s = m.s;
  const gap = 0.5;
  const terraces = [
    { r: 78, y0: 0.04, y1: 1.15 },
    { r: 64, y0: 1.1, y1: 2.45 },
    { r: 52, y0: 2.4, y1: 3.9 },
    { r: 43, y0: 3.85, y1: 5.45 },
  ];
  for (const terrace of terraces) {
    for (let k = 0; k < 3; k++) {
      const gapCenter = angles[k] + Math.PI / 3;
      const a0 = gapCenter + gap / 2;
      const a1 = gapCenter + (Math.PI * 2) / 3 - gap / 2;
      const segs = Math.max(8, Math.round(((a1 - a0) / (Math.PI * 2)) * 36));
      const geo = new THREE.CylinderGeometry(terrace.r * s, terrace.r * s, (terrace.y1 - terrace.y0) * s, segs, 1, false, a0, a1 - a0);
      geo.translate(0, ((terrace.y0 + terrace.y1) / 2) * s, 0);
      tag(add(g, geo, plinthMat), 'plinth');
    }
  }
  for (let k = 0; k < 3; k++) {
    const angle = angles[k] + Math.PI / 3;
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const radius = (80 - t * 38) * s;
      const y = (0.18 + t * 5.15) * s;
      const geo = new THREE.BoxGeometry(2.3 * s, 0.3 * s, 7.4 * s);
      geo.rotateY(-angle);
      geo.translate(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      tag(add(g, geo, treadMat), 'stair', angle);
    }
  }
}

function roundedRectShape(w, d, rad) {
  const shape = new THREE.Shape();
  const hw = w / 2;
  const hd = d / 2;
  const r = Math.min(rad, hw - 0.1, hd - 0.1);
  shape.moveTo(-hw + r, -hd);
  shape.lineTo(hw - r, -hd);
  shape.absarc(hw - r, -hd + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(hw, hd - r);
  shape.absarc(hw - r, hd - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-hw + r, hd);
  shape.absarc(-hw + r, hd - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-hw, -hd + r);
  shape.absarc(-hw + r, -hd + r, r, Math.PI, Math.PI * 1.5, false);
  return shape;
}

function extrudeUp(shape, depth) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// White Magnolia Plaza: a glass shaft with the horizontal light shelves SOM
// designed, and the open observation deck that replaced the helipad.
function magnolia(h) {
  const g = new THREE.Group();
  const s = h / 319.5;
  const shaftH = 302 * s;
  const shaft = extrudeUp(roundedRectShape(48 * s, 40 * s, 14 * s), shaftH);
  tag(add(g, shaft, glassBlue), 'shaft');
  for (let y = 16 * s; y < shaftH - 4 * s; y += 24 * s) {
    const shelf = extrudeUp(roundedRectShape(50.6 * s, 42.6 * s, 15 * s), 0.7 * s);
    shelf.translate(0, y, 0);
    tag(add(g, shelf, steel), 'shelf');
  }
  const deck = extrudeUp(roundedRectShape(62 * s, 52 * s, 18 * s), 1.6 * s);
  deck.translate(0, shaftH, 0);
  tag(add(g, deck, concrete), 'deck');
  const railOuter = roundedRectShape(61 * s, 51 * s, 17.5 * s);
  const railInner = roundedRectShape(58.6 * s, 48.6 * s, 16.2 * s);
  railOuter.holes.push(railInner);
  const rail = extrudeUp(railOuter, 1.25 * s);
  rail.translate(0, shaftH + 1.6 * s, 0);
  tag(add(g, rail, glassBlue), 'rail');
  const core = extrudeUp(roundedRectShape(16 * s, 14 * s, 3 * s), 14 * s);
  core.translate(0, shaftH + 1.6 * s, 0);
  tag(add(g, core, glassSilver), 'core');
  const canopy = extrudeUp(roundedRectShape(56 * s, 46 * s, 16 * s), 0.8 * s);
  canopy.translate(0, shaftH + 15.6 * s, 0);
  tag(add(g, canopy, steel), 'canopy');
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

const slotMat = new THREE.MeshStandardMaterial({ color: 0x4e5964, metalness: 0.28, roughness: 0.62 });
slotMat.side = THREE.DoubleSide;
const ribMat = new THREE.MeshStandardMaterial({ color: 0xe7eef3, metalness: 0.48, roughness: 0.3 });
ribMat.side = THREE.DoubleSide;

// Gensler: equilateral triangle with tangential corner arcs, one notched vertex,
// 120° linear twist, wide lower third, about 55% narrower at the crown.
function shanghaiRing(segs, radius, twist, y) {
  const pts = [];
  for (let s = 0; s < segs; s++) {
    const a = (s / segs) * Math.PI * 2;
    let k = 0.76 + 0.24 * Math.cos(3 * a);
    const raw = a > Math.PI ? a - Math.PI * 2 : a;
    const notch = Math.exp(-((raw / 0.22) ** 2));
    k *= 1 - 0.32 * notch;
    const ang = a + twist;
    pts.push(new THREE.Vector3(Math.cos(ang) * radius * k, y, Math.sin(ang) * radius * k));
  }
  return pts;
}

function quadsMesh(group, quads, mat) {
  if (!quads.length) return;
  const geo = new THREE.BufferGeometry();
  const pos = [];
  const idx = [];
  for (let i = 0; i < quads.length; i += 4) {
    const base = pos.length / 3;
    for (let k = 0; k < 4; k++) pos.push(quads[i + k].x, quads[i + k].y, quads[i + k].z);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  add(group, geo, mat);
}

function shanghai(h) {
  const g = new THREE.Group();
  const segs = 72;
  const steps = 70;
  const yScale = 0.985;
  let prev = null;
  const glass = [];
  const slot = [];
  const rib = [];
  const kindOf = (i) => {
    const a = ((i + 0.5) / segs) * Math.PI * 2;
    const raw = a > Math.PI ? a - Math.PI * 2 : a;
    if (Math.abs(raw) < 0.24) return slot;
    for (const v of [(2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
      let d = Math.abs(a - v);
      d = Math.min(d, Math.PI * 2 - d);
      if (d < 0.09) return rib;
    }
    return glass;
  };
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = Math.min(t, 0.9) / 0.9;
    const body = 1 - 0.55 * (u ** 1.35);
    const dome = t <= 0.9 ? 1 : Math.cos(((t - 0.9) / 0.1) * Math.PI / 2);
    const y = t * h * yScale;
    const twist = t * (120 * Math.PI / 180);
    const ring = shanghaiRing(segs, 34 * body * (0.58 + 0.42 * dome), twist, y);
    if (prev) {
      for (let s = 0; s < segs; s++) {
        const s2 = (s + 1) % segs;
        kindOf(s).push(prev[s], prev[s2], ring[s2], ring[s]);
      }
    }
    prev = ring;
  }
  quadsMesh(g, glass, glassBlue);
  quadsMesh(g, slot, slotMat);
  quadsMesh(g, rib, ribMat);
  if (prev) capRing(g, prev, glassBlue);
  add(g, new THREE.SphereGeometry(1.15, 10, 8).translate(0, h * 0.992, 0), beaconMat);
  return g;
}

// KPF: 58 m square prism. Two arcs, starting about a third of the way up, bevel
// opposite corners until the plan is a narrow rectangle — a single sharp edge.
// The aperture is the trapezoid that replaced the 46 m circle, about 50 m wide
// at the 94th-floor deck (423 m) and narrowing toward the 100th (474 m).
function swfcSection(t) {
  const u = Math.max(0, (t - 0.30) / 0.70);
  const arc = u ** 0.72;
  const w = 58 * (1 - 0.16 * (arc ** 1.05));
  const d = Math.max(1.2, 58 * (1 - 0.979 * (arc ** 0.52)));
  const chamfer = Math.min(w * 0.07, d * 0.42) * Math.min(1, arc * 1.5);
  return { w, d, chamfer };
}

function swfcRing(t, y) {
  const { w, d, chamfer } = swfcSection(t);
  const hw = w / 2;
  const hd = d / 2;
  const c = Math.min(chamfer, hw * 0.18, hd * 0.8);
  return [
    [-hw + c, hd], [hw - c, hd], [hw, hd - c], [hw, -hd + c],
    [hw - c, -hd], [-hw + c, -hd], [-hw, -hd + c], [-hw, hd - c],
  ].map(([x, z]) => new THREE.Vector3(x, y, z));
}

function swfc(h) {
  const g = new THREE.Group();
  const hole0 = 418 / 492;
  const hole1 = 470 / 492;
  const yOf = (t) => t * h * 0.992;
  const openHalf = (t) => {
    const u = Math.min(1, Math.max(0, (t - hole0) / (hole1 - hole0)));
    return 22.5 * (1 - 0.5 * u);
  };
  const ts = [0, hole0, hole1, 1];
  for (let i = 1; i < 42; i++) ts.push(i / 42);
  for (let i = 1; i < 10; i++) ts.push(hole0 + (hole1 - hole0) * i / 10);
  ts.sort((a, b) => a - b);
  const samples = [];
  for (const t of ts) {
    if (!samples.length || t - samples[samples.length - 1] > 1e-4) samples.push(t);
  }
  const glass = [];
  const frame = [];
  const push = (list, a, b, c, d) => list.push(a, b, c, d);
  const wall = (list, a0, a1, b0, b1) => push(list, a0, a1, b1, b0);
  for (let i = 0; i < samples.length - 1; i++) {
    const t0 = samples[i];
    const t1 = samples[i + 1];
    const ringA = swfcRing(t0, yOf(t0));
    const ringB = swfcRing(t1, yOf(t1));
    for (const edge of [1, 2, 3, 5, 6, 7]) {
      const e2 = (edge + 1) % 8;
      wall(glass, ringA[edge], ringA[e2], ringB[edge], ringB[e2]);
    }
    const open = t0 >= hole0 - 1e-6 && t1 <= hole1 + 1e-6;
    for (const face of [0, 4]) {
      const a0 = ringA[face];
      const a1 = ringA[(face + 1) % 8];
      const b0 = ringB[face];
      const b1 = ringB[(face + 1) % 8];
      if (!open) {
        wall(glass, a0, a1, b0, b1);
        continue;
      }
      const jamb = (p0, p1, q0, q1, x0, x1, u0, u1) => {
        const at = (p, q, x) => new THREE.Vector3(x, p.y, p.z + (q.z - p.z) * 0);
        wall(glass, at(p0, p1, x0), at(p0, p1, x1), at(q0, q1, u0), at(q0, q1, u1));
      };
      const loA = Math.min(a0.x, a1.x);
      const hiA = Math.max(a0.x, a1.x);
      const loB = Math.min(b0.x, b1.x);
      const hiB = Math.max(b0.x, b1.x);
      const inLoA = Math.max(loA, -openHalf(t0));
      const inHiA = Math.min(hiA, openHalf(t0));
      const inLoB = Math.max(loB, -openHalf(t1));
      const inHiB = Math.min(hiB, openHalf(t1));
      if (inLoA >= inHiA - 0.2) {
        wall(glass, a0, a1, b0, b1);
        continue;
      }
      if (inLoA - loA > 0.15) jamb(a0, a1, b0, b1, loA, inLoA, loB, inLoB);
      if (hiA - inHiA > 0.15) jamb(a0, a1, b0, b1, inHiA, hiA, inHiB, hiB);
    }
  }
  const sillY = yOf(hole0);
  const headY = yOf(hole1);
  const sill = swfcSection(hole0);
  const head = swfcSection(hole1);
  const hz = (sec) => sec.d / 2;
  const rim = (y, half, hd) => {
    const p = (x, z) => new THREE.Vector3(x, y, z);
    push(frame, p(-half, hd), p(half, hd), p(half, -hd), p(-half, -hd));
  };
  rim(sillY, openHalf(hole0), hz(sill));
  rim(headY, openHalf(hole1), hz(head));
  for (let i = 0; i < 10; i++) {
    const t0 = hole0 + (hole1 - hole0) * i / 10;
    const t1 = hole0 + (hole1 - hole0) * (i + 1) / 10;
    const d0 = swfcSection(t0).d / 2;
    const d1 = swfcSection(t1).d / 2;
    const y0 = yOf(t0);
    const y1 = yOf(t1);
    for (const sign of [-1, 1]) {
      const x0 = sign * openHalf(t0);
      const x1 = sign * openHalf(t1);
      const p = (x, y, z) => new THREE.Vector3(x, y, z);
      wall(frame, p(x0, y0, d0), p(x0, y0, -d0), p(x1, y1, d1), p(x1, y1, -d1));
    }
  }
  quadsMesh(g, glass, glassBlue);
  const frameMat = steel.clone();
  frameMat.side = THREE.DoubleSide;
  quadsMesh(g, frame, frameMat);
  const crown = swfcRing(1, yOf(1));
  const cap = new THREE.BufferGeometry();
  const capPos = [0, crown[0].y, 0];
  for (const p of crown) capPos.push(p.x, p.y, p.z);
  const capIdx = [];
  for (let i = 0; i < crown.length; i++) capIdx.push(0, i + 1, ((i + 1) % crown.length) + 1);
  cap.setAttribute('position', new THREE.Float32BufferAttribute(capPos, 3));
  cap.setIndex(capIdx);
  cap.computeVertexNormals();
  add(g, cap, frameMat);
  return g;
}

let jinGrid = null;
function jinmaoMaterial() {
  if (jinGrid) return jinGrid;
  jinGrid = new THREE.MeshStandardMaterial({ color: 0xd7dee6, metalness: 0.62, roughness: 0.28 });
  jinGrid.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = cityUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGrid;\nvarying vec3 vLm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrid = uv;\nvLm = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying vec2 vGrid;\nvarying vec3 vLm;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fu = fract(vGrid.x * 9.0);
        float fv = fract(vLm.y / 4.2);
        float edge = min(min(fu, 1.0 - fu), min(fv, 1.0 - fv));
        float frame = 1.0 - smoothstep(0.07, 0.16, edge);
        vec3 metal = vec3(0.78, 0.81, 0.84);
        vec3 glass = vec3(0.38, 0.50, 0.60);
        diffuseColor.rgb = mix(glass, metal, frame);
        float pane = 1.0 - frame;
        float row = floor(vLm.y / 4.2);
        float col = floor(vGrid.x * 9.0);
        float on = step(0.62, fract(sin(row * 12.1 + col * 7.7) * 43758.5));
        totalEmissiveRadiance += vec3(1.0, 0.84, 0.58) * pane * on * uNight * 0.85;
      `);
  };
  jinGrid.customProgramCacheKey = () => 'lm-jin-grid';
  return jinGrid;
}

function shellGrid(group, a, b, mat) {
  const geo = new THREE.BufferGeometry();
  const pos = [];
  const uv = [];
  const idx = [];
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    const base = pos.length / 3;
    for (const p of [a[i], a[i2], b[i2], b[i]]) pos.push(p.x, p.y, p.z);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  add(group, geo, mat);
}

function jinmao(h) {
  const g = new THREE.Group();
  const s = h / 420.5;
  // SOM: 88 floors in 16 segments. Each office segment drops by 1/8 of the
  // 16-story base (2 floors) until the 8-story hotel; the crown then steps
  // down to level 88. Roof 385.5 m, spire 35 m, on the 420.5 m tower.
  const floor = (385.5 * s) / 88;
  const segments = [16, 14, 12, 10, 8, 6, 4, 5, 4, 3, 2, 2, 1, 1];
  let y = 0;
  let radius = 32 * s;
  const grid = jinmaoMaterial();
  const twist = Math.PI / 8;
  segments.forEach((stories, i) => {
    const tierH = stories * floor;
    const next = radius * (i < 7 ? 0.88 : 0.78);
    const lower = ringPoints(8, radius, twist, y, false);
    const neck = ringPoints(8, radius, twist, y + tierH * 0.84, false);
    const lip = ringPoints(8, radius * 1.045, twist, y + tierH * 0.92, false);
    const shelf = ringPoints(8, next, twist, y + tierH, false);
    shellGrid(g, lower, neck, grid);
    shellBetween(g, neck, lip, steel);
    shellBetween(g, lip, shelf, steel);
    if (i === 0) capRing(g, lower, dark);
    y += tierH;
    radius = next;
  });
  const spireH = Math.max(8 * s, h - y);
  const spire = new THREE.CylinderGeometry(0.28 * s, Math.max(radius * 0.92, 0.7), spireH, 8);
  spire.rotateY(-twist);
  spire.translate(0, y + spireH / 2, 0);
  add(g, spire, steel);
  add(g, new THREE.SphereGeometry(0.55 * s, 8, 6).translate(0, h, 0), beaconMat);
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

const BUILDERS = { pearl, shanghai, swfc, jinmao, customs, magnolia };

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
