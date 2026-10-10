import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { findLandmarks, hiddenByLandmark } from '../../src/shared/landmarks.js';
import { carriageWidth, laneCount, sidewalkWidthFor } from '../pipeline/osm.mjs';
import { createLandmarks } from '../../src/world/landmarks.js';

test('lane width follows OSM lanes and sidewalks skip bridges', () => {
  assert.equal(carriageWidth({ lanes: '6' }, 'primary'), 6 * 3.35 + 0.5);
  assert.equal(carriageWidth({ width: '12' }, 'residential'), 12);
  assert.equal(laneCount(14), 4);
  assert.equal(sidewalkWidthFor('primary', false), 4.4);
  assert.equal(sidewalkWidthFor('motorway', false), 0);
  assert.equal(sidewalkWidthFor('primary', true), 0);
});

test('named towers become landmarks and their parts are not extruded', () => {
  const tower = {
    name: '上海中心大厦', area: 2000, topY: 632, baseY: 4,
    centroid: [10, 20], rings: [[[0, 0], [40, 0], [40, 20], [0, 20]]],
  };
  const cafe = {
    name: '东方明珠小吃', area: 40, topY: 8, baseY: 4,
    centroid: [0, 0], rings: [[[0, 0], [4, 0], [4, 4]]],
  };
  const marks = findLandmarks([tower, cafe]);
  assert.deepEqual(marks.map((m) => m.id), ['shanghai']);
  assert.ok(marks[0].h >= 632);
  assert.equal(hiddenByLandmark(tower, marks), true);
  assert.equal(hiddenByLandmark(cafe, marks), false);
});

test('unnamed parts inside a named footprint are not extruded', () => {
  const outline = {
    name: '东方明珠电视塔', area: 2400, topY: 472, baseY: 4,
    centroid: [0, 0], rings: [[[-30, -30], [30, -30], [30, 30], [-30, 30]]],
  };
  const part = {
    name: '', area: 70, topY: 280, baseY: 4,
    centroid: [4, -6], rings: [[[2, -8], [8, -8], [8, -2]]],
  };
  const neighbour = {
    name: '邻居大厦', area: 400, topY: 80, baseY: 4,
    centroid: [90, 0], rings: [[[80, -10], [100, -10], [100, 10]]],
  };
  const marks = findLandmarks([outline, part, neighbour]);
  assert.deepEqual(marks.map((m) => m.id), ['pearl']);
  assert.equal(hiddenByLandmark(outline, marks), true);
  assert.equal(hiddenByLandmark(part, marks), true);
  assert.equal(hiddenByLandmark(neighbour, marks), false);
});

function partBox(model, part) {
  const box = new THREE.Box3();
  const scratch = new THREE.Box3();
  model.traverse((obj) => {
    if (obj.userData?.part !== part || !obj.geometry) return;
    obj.geometry.computeBoundingBox();
    scratch.copy(obj.geometry.boundingBox);
    box.union(scratch);
  });
  return box;
}

function vertexRadii(model, y0, y1) {
  let maxR = 0;
  let minR = Infinity;
  model.traverse((obj) => {
    const pos = obj.geometry?.getAttribute?.('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < y0 || y > y1) continue;
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      if (r > maxR) maxR = r;
      if (r < minR) minR = r;
    }
  });
  return { maxR, minR };
}

test('pearl legs and columns meet the spheres with no gap', () => {
  const h = 468;
  const s = h / 468;
  const lowerC = 93 * s;
  const lowerR = 25 * s;
  const upperC = 272.5 * s;
  const upperR = 22.5 * s;
  const model = createLandmarks([{ id: 'pearl', x: 0, z: 0, y: 0, h, yaw: 0 }]).children[0];
  const legs = [];
  const shafts = [];
  model.traverse((obj) => {
    if (obj.userData?.part === 'leg') legs.push(obj);
    if (obj.userData?.part === 'shaft') shafts.push(obj);
  });
  assert.equal(legs.length, 3);
  assert.equal(shafts.length, 3);
  const legBox = partBox(model, 'leg');
  const shaftBox = partBox(model, 'shaft');
  assert.ok(legBox.max.y > lowerC - lowerR + 6, `legs stop at ${legBox.max.y}, short of the lower sphere`);
  assert.ok(shaftBox.min.y < lowerC + lowerR - 6, `columns start at ${shaftBox.min.y}, above the lower sphere`);
  assert.ok(shaftBox.max.y > upperC - upperR, `columns stop at ${shaftBox.max.y}, short of the upper sphere`);
  const angles = new Set(legs.map((leg) => leg.userData.angle.toFixed(3)));
  assert.equal(angles.size, 3);
});

function planAngle(model, y0, y1) {
  let xx = 0;
  let zz = 0;
  let xz = 0;
  model.traverse((obj) => {
    const pos = obj.geometry?.getAttribute?.('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < y0 || y > y1) continue;
      const x = pos.getX(i);
      const z = pos.getZ(i);
      xx += x * x;
      zz += z * z;
      xz += x * z;
    }
  });
  return 0.5 * Math.atan2(2 * xz, xx - zz);
}

test('jin mao steps inward and shanghai tapers and twists', () => {
  const jin = createLandmarks([{ id: 'jinmao', x: 0, z: 0, y: 0, h: 421, yaw: 0 }]).children[0];
  const base = vertexRadii(jin, 0, 50);
  const crown = vertexRadii(jin, 300, 340);
  assert.ok(base.maxR > crown.maxR * 1.7, `jin mao base ${base.maxR} vs crown ${crown.maxR}`);
  const mid = vertexRadii(jin, 140, 175);
  assert.ok(base.maxR > mid.maxR * 1.15, `jin mao setback missing, base ${base.maxR} mid ${mid.maxR}`);
  const shanghai = createLandmarks([{ id: 'shanghai', x: 0, z: 0, y: 0, h: 632, yaw: 0 }]).children[0];
  const low = vertexRadii(shanghai, 8, 40);
  const high = vertexRadii(shanghai, 560, 610);
  assert.ok(high.maxR < low.maxR * 0.6, `shanghai top ${high.maxR} vs base ${low.maxR}`);
  assert.ok(low.maxR > low.minR * 1.4, `shanghai plan should read as a rounded triangle (${low.maxR} / ${low.minR})`);
  assert.ok(low.maxR < low.minR * 2.1, `shanghai plan is too sharp (${low.maxR} / ${low.minR})`);
  const a0 = planAngle(shanghai, 40, 80);
  const a1 = planAngle(shanghai, 340, 390);
  let delta = Math.abs(a1 - a0);
  delta = Math.min(delta, Math.PI - delta);
  assert.ok(delta > 0.45 && delta < 1.3, `shanghai twist ${delta} rad between the lower and middle shaft`);
});

test('swfc aperture is a large hole under a sharp top edge', () => {
  const h = 492;
  const model = createLandmarks([{ id: 'swfc', x: 0, z: 0, y: 0, h, yaw: 0 }]).children[0];
  model.rotation.y = 0;
  model.updateMatrixWorld(true);
  const through = new THREE.Raycaster(new THREE.Vector3(0, 445, 80), new THREE.Vector3(0, 0, -1));
  assert.equal(through.intersectObject(model, true).length, 0, 'ray should pass through the aperture');
  const wide = new THREE.Raycaster(new THREE.Vector3(18, 430, 80), new THREE.Vector3(0, 0, -1));
  assert.equal(wide.intersectObject(model, true).length, 0, 'the bottom of the hole is the wide end of the trapezoid');
  const narrow = new THREE.Raycaster(new THREE.Vector3(18, 458, 80), new THREE.Vector3(0, 0, -1));
  assert.ok(narrow.intersectObject(model, true).length > 0, 'the top of the hole is narrower');
  const solid = new THREE.Raycaster(new THREE.Vector3(0, 200, 80), new THREE.Vector3(0, 0, -1));
  assert.ok(solid.intersectObject(model, true).length > 0, 'mid-height face should be solid');
  const top = vertexRadii(model, h * 0.97, h);
  assert.ok(top.maxR > 8, 'the ridge stays wide');
  let deep = 0;
  model.traverse((obj) => {
    const pos = obj.geometry?.getAttribute?.('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < h * 0.97) continue;
      deep = Math.max(deep, Math.abs(pos.getZ(i)));
    }
  });
  assert.ok(deep < 6, `top edge is still ${deep} m deep`);
});

test('parametric towers stand their full height', () => {
  const group = createLandmarks([
    { id: 'pearl', x: 0, z: 0, y: 0, h: 468, yaw: 0 },
    { id: 'shanghai', x: 0, z: 0, y: 0, h: 632, yaw: 0 },
    { id: 'swfc', x: 0, z: 0, y: 0, h: 492, yaw: 0.4 },
    { id: 'jinmao', x: 0, z: 0, y: 0, h: 421, yaw: 0.2 },
  ]);
  assert.equal(group.children.length, 4);
  const box = new THREE.Box3();
  for (const model of group.children) {
    box.setFromObject(model);
    const height = box.max.y - box.min.y;
    assert.ok(height > model.userData.landmark.h * 0.9, model.userData.landmark.id);
  }
});
