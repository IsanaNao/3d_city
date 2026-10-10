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
