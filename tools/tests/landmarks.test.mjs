import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { findLandmarks, hiddenByLandmark } from '../../src/shared/landmarks.js';
import { createBridges } from '../../src/world/bridges.js';
import { carriageWidth, deckLift, gradeYangpuApproaches, laneCount, sidewalkWidthFor } from '../pipeline/osm.mjs';
import { collectBridges } from '../pipeline/bridges.mjs';
import { createLandmarks } from '../../src/world/landmarks.js';

test('lane width follows OSM lanes and sidewalks skip bridges', () => {
  assert.equal(carriageWidth({ lanes: '6' }, 'primary'), 6 * 3.35 + 0.5);
  assert.equal(carriageWidth({ width: '12' }, 'residential'), 12);
  assert.equal(laneCount(14), 4);
  assert.equal(sidewalkWidthFor('primary', false), 4.4);
  assert.equal(sidewalkWidthFor('motorway', false), 0);
  assert.equal(sidewalkWidthFor('primary', true), 0);
  assert.ok(carriageWidth({ lanes: '4', name: '世纪大道' }, 'primary') > 16);
  assert.equal(sidewalkWidthFor('primary', false, '中山东一路'), 7.2);
  assert.equal(carriageWidth({ lanes: '3', name: '中山东一路' }, 'secondary'), 10 * 3.35 + 1.5);
  assert.equal(laneCount(10 * 3.35 + 1.5), 10);
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

test('swfc aperture is an inverted trapezoid under a flat roof', () => {
  const h = 492;
  const model = createLandmarks([{ id: 'swfc', x: 0, z: 0, y: 0, h, yaw: 0 }]).children[0];
  model.rotation.y = 0;
  model.updateMatrixWorld(true);
  const through = new THREE.Raycaster(new THREE.Vector3(0, 454, 80), new THREE.Vector3(0, 0, -1));
  assert.equal(through.intersectObject(model, true).length, 0, 'ray should pass through the aperture');
  const narrow = new THREE.Raycaster(new THREE.Vector3(16, 440, 80), new THREE.Vector3(0, 0, -1));
  assert.ok(narrow.intersectObject(model, true).length > 0, 'the bottom of the hole is the narrow end');
  const wide = new THREE.Raycaster(new THREE.Vector3(18, 468, 80), new THREE.Vector3(0, 0, -1));
  assert.equal(wide.intersectObject(model, true).length, 0, 'the top of the hole is the wide end');
  const bridge = new THREE.Raycaster(new THREE.Vector3(0, 484, 80), new THREE.Vector3(0, 0, -1));
  assert.ok(bridge.intersectObject(model, true).length > 0, 'the bridge above the hole is solid');
  const solid = new THREE.Raycaster(new THREE.Vector3(0, 200, 80), new THREE.Vector3(0, 0, -1));
  assert.ok(solid.intersectObject(model, true).length > 0, 'mid-height face should be solid');
  const top = vertexRadii(model, h * 0.985, h + 2);
  assert.ok(top.maxR > 20, 'the roof edge stays long');
  let deep = 0;
  let wideX = 0;
  let sill = 0;
  let roofY = [];
  model.traverse((obj) => {
    const pos = obj.geometry?.getAttribute?.('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const z = Math.abs(pos.getZ(i));
      const x = Math.abs(pos.getX(i));
      if (y > h * 0.995) {
        deep = Math.max(deep, z);
        wideX = Math.max(wideX, x);
        roofY.push(y);
      }
      if (y > h * 0.84 && y < h * 0.89) sill = Math.max(sill, z);
    }
  });
  assert.ok(deep > 6 && deep < 12, `roof edge depth ${deep}`);
  assert.ok(wideX > 22, `roof edge length ${wideX}`);
  assert.ok(sill > 10, `the aperture is cut through a mass only ${sill} m deep`);
  const roofLo = Math.min(...roofY);
  const roofHi = Math.max(...roofY);
  assert.ok(roofHi - roofLo < 2.2, `roof is not a flat edge (${roofHi - roofLo})`);
});

test('pearl stands on a stepped circular plinth with stairs', () => {
  const model = createLandmarks([{ id: 'pearl', x: 0, z: 0, y: 0, h: 468, yaw: 0 }]).children[0];
  let terraces = 0;
  let stairs = 0;
  model.traverse((obj) => {
    if (obj.userData?.part === 'plinth') terraces += 1;
    if (obj.userData?.part === 'stair') stairs += 1;
  });
  assert.equal(terraces, 12);
  assert.equal(stairs, 48);
  const plinth = partBox(model, 'plinth');
  assert.ok(plinth.max.y > 5 && plinth.max.y < 7);
  assert.ok(plinth.max.x > 70, 'the lowest terrace is a wide circle');
  const legs = partBox(model, 'leg');
  assert.ok(legs.min.y > 4, 'the tripod stands on the upper terrace');
});

test('white magnolia has an open observation crown', () => {
  const h = 319.5;
  const model = createLandmarks([{ id: 'magnolia', x: 0, z: 0, y: 0, h, yaw: 0 }]).children[0];
  const deck = partBox(model, 'deck');
  const shaft = partBox(model, 'shaft');
  const canopy = partBox(model, 'canopy');
  assert.ok(deck.max.x > shaft.max.x + 3, 'the deck cantilevers past the shaft');
  assert.ok(canopy.min.y > deck.max.y + 8, 'the viewing level is open under the roof');
  assert.ok(canopy.max.y > h * 0.98 && canopy.max.y <= h + 0.2);
  const marks = findLandmarks([{
    name: '金光中心 (写字楼)', area: 3000, topY: 324, baseY: 4,
    centroid: [1, 2], rings: [[[0, 0], [50, 0], [50, 40], [0, 40]]],
  }]);
  assert.equal(marks[0].id, 'magnolia');
  assert.ok(marks[0].h >= 319.5);
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

test('pearl spheres are a closed glass skin, with the panel grid only in the shader', () => {
  const model = createLandmarks([{ id: 'pearl', x: 0, z: 0, y: 0, h: 468, yaw: 0 }]).children[0];
  let panels = 0;
  let area = 0;
  model.traverse((obj) => {
    if (obj.userData?.part !== 'lower-sphere') return;
    const pos = obj.geometry.getAttribute('position');
    const lat = obj.geometry.getAttribute('aLat');
    const index = obj.geometry.getIndex();
    assert.ok(pos.count > 1500, `lower sphere has ${pos.count} vertices`);
    assert.equal(lat.count, pos.count);
    assert.equal(obj.material.transparent, false);
    assert.equal(obj.material.depthWrite, true);
    assert.equal(obj.material.opacity, 1);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(pos, index.getX(i));
      b.fromBufferAttribute(pos, index.getX(i + 1));
      c.fromBufferAttribute(pos, index.getX(i + 2));
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      area += ab.cross(ac).length() * 0.5;
    }
    const center = new THREE.Vector3(0, 93, 0);
    let minR = Infinity;
    let maxR = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = new THREE.Vector3().fromBufferAttribute(pos, i).distanceTo(center);
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
    assert.ok(Math.abs(minR - 25) < 0.05 && Math.abs(maxR - 25) < 0.05, `shell radius ${minR}..${maxR}`);
    panels += 1;
  });
  assert.equal(panels, 1);
  assert.ok(area > 4 * Math.PI * 25 * 25 * 0.92, `lower sphere area ${area} is open`);
  let rings = 0;
  model.traverse((obj) => {
    if (obj.geometry?.type === 'TorusGeometry') rings += 1;
  });
  assert.ok(rings >= 7, `observation rings ${rings}`);
});

test('bund historic row builds a clock tower, a dome and a copper roof', () => {
  const customs = createLandmarks([{ id: 'customs', x: 0, z: 0, y: 0, h: 79, yaw: 0 }]).children[0];
  const hsbc = createLandmarks([{ id: 'hsbc', x: 0, z: 0, y: 0, h: 52, yaw: 0 }]).children[0];
  const peace = createLandmarks([{ id: 'peace', x: 0, z: 0, y: 0, h: 77, yaw: 0 }]).children[0];
  const boc = createLandmarks([{ id: 'boc', x: 0, z: 0, y: 0, h: 68, yaw: 0 }]).children[0];
  for (const model of [customs, hsbc, peace, boc]) {
    const box = new THREE.Box3().setFromObject(model);
    assert.ok(box.max.y > 45, model.userData.landmark.id);
  }
  const dome = new THREE.Box3().setFromObject(hsbc);
  assert.ok(dome.max.y > 50, 'the HSBC dome rises above the block');
  const spanOf = (model, part) => {
    let mesh = null;
    model.traverse((obj) => {
      if (obj.userData?.part === part) mesh = obj;
    });
    assert.ok(mesh, part);
    const box = new THREE.Box3().setFromObject(mesh);
    return { box, span: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) };
  };
  const block = spanOf(customs, 'customs-block');
  const shaft = spanOf(customs, 'customs-shaft');
  const stage = spanOf(customs, 'customs-clock');
  const belfry = spanOf(customs, 'customs-belfry');
  const roof = spanOf(customs, 'customs-roof');
  const cornice = spanOf(customs, 'customs-cornice');
  assert.ok(shaft.span > block.span * 0.3 && shaft.span < block.span * 0.48, `tower is a large fraction of the facade (${shaft.span} / ${block.span})`);
  assert.ok(Math.abs(stage.span - shaft.span) < 1, 'the clock stage keeps the shaft width');
  assert.ok(belfry.span < shaft.span * 0.85 && roof.span < belfry.span * 0.75, 'the crown steps in');
  assert.ok(roof.box.min.y > stage.box.max.y && belfry.box.min.y + 0.05 >= stage.box.max.y, 'setbacks sit above the clock');
  assert.ok(cornice.box.max.y > 28 && cornice.box.max.y < 36, `customs cornice ${cornice.box.max.y} pairs with HSBC`);
  const whole = new THREE.Box3().setFromObject(customs);
  assert.ok(whole.max.y > 78, 'the flagpole reaches the passed height');
  let cones = 0;
  let faces = 0;
  let portico = 0;
  customs.traverse((obj) => {
    if (obj.geometry?.type === 'ConeGeometry') cones += 1;
    if (obj.userData?.part === 'customs-face') faces += 1;
    if (obj.userData?.part === 'customs-portico') portico += 1;
  });
  assert.equal(cones, 0, 'the customs crown is stepped, not a pyramid');
  assert.equal(faces, 4, 'four clock faces');
  assert.equal(portico, 4, 'four Doric columns');
  let face = null;
  customs.traverse((obj) => {
    if (obj.userData?.part === 'customs-face') face = obj;
  });
  const faceBox = new THREE.Box3().setFromObject(face);
  const dia = Math.max(faceBox.max.x - faceBox.min.x, faceBox.max.y - faceBox.min.y, faceBox.max.z - faceBox.min.z);
  assert.ok(dia > 4.4 && dia < 5.2, `clock diameter ${dia}`);
  const peaceRoof = spanOf(peace, 'peace-roof');
  assert.ok(peaceRoof.box.max.y - peaceRoof.box.min.y > 18, 'the Peace Hotel pyramid is a tall roof');
  const bocRoof = spanOf(boc, 'boc-roof');
  assert.ok(bocRoof.box.max.y > 55, 'the Bank of China hip rises over the setbacks');
  const marks = findLandmarks([
    {
      name: '上海海关', area: 900, topY: 30, baseY: 4,
      centroid: [0, 0], rings: [[[-20, -10], [20, -10], [20, 10], [-20, 10]]],
    },
    {
      name: '汇丰银行大楼', area: 4000, topY: 250, baseY: 4,
      centroid: [400, 0], rings: [[[380, -20], [420, -20], [420, 20], [380, 20]]],
    },
    {
      name: '和平饭店南楼', area: 500, topY: 40, baseY: 4,
      centroid: [80, 0], rings: [[[70, -10], [90, -10], [90, 10]]],
    },
  ]);
  assert.deepEqual(marks.map((m) => m.id), ['customs', 'peaceSouth']);
  const row = findLandmarks([
    { name: '华尔道夫酒店', area: 2000, topY: 30, baseY: 4, centroid: [0, 0], rings: [[[-20, -10], [20, -10], [20, 10], [-20, 10]]] },
    { name: '有利大楼', area: 1500, topY: 28, baseY: 4, centroid: [50, 0], rings: [[[40, -8], [60, -8], [60, 8], [40, 8]]] },
    { name: '外滩18号', area: 1200, topY: 26, baseY: 4, centroid: [100, 0], rings: [[[90, -8], [110, -8], [110, 8], [90, 8]]] },
    { name: '罗斯福/外滩27', area: 1400, topY: 32, baseY: 4, centroid: [150, 0], rings: [[[140, -8], [160, -8], [160, 8], [140, 8]]] },
    { name: '招商银行上海大厦', area: 8000, topY: 230, baseY: 4, centroid: [400, 0], rings: [[[380, -20], [420, -20], [420, 20], [380, 20]]] },
  ]);
  assert.deepEqual(row.map((m) => m.id).sort(), ['bund18', 'club', 'jardine', 'union']);
  const named = findLandmarks([
    { name: '中国太平洋保险公司', area: 1800, topY: 32, baseY: 4, centroid: [0, 0], rings: [[[-16, -10], [16, -10], [16, 10], [-16, 10]]] },
    { name: '上海外汇交易中心', area: 1400, topY: 26, baseY: 4, centroid: [40, 0], rings: [[[30, -8], [50, -8], [50, 8], [30, 8]]] },
    { name: '中国工商银行', area: 2200, topY: 28, baseY: 4, centroid: [80, 0], rings: [[[68, -12], [96, -12], [96, 12], [68, 12]]] },
    { name: '中国工商银行', area: 3000, topY: 120, baseY: 4, centroid: [400, 0], rings: [[[370, -20], [430, -20], [430, 20], [370, 20]]] },
  ]);
  assert.deepEqual(named.map((m) => m.id).sort(), ['asia', 'russo', 'yokohama']);
});

test('HSBC takes the development-bank frontage and Bund 14 steps in the centre', () => {
  const hsbc = createLandmarks([{ id: 'hsbc', x: 0, z: 0, y: 0, h: 52, yaw: 0 }]).children[0];
  const customs = createLandmarks([{ id: 'customs', x: 0, z: 0, y: 0, h: 90, yaw: 0 }]).children[0];
  const bocom = createLandmarks([{ id: 'bocom', x: 0, z: 0, y: 0, h: 38, yaw: 0 }]).children[0];
  hsbc.updateMatrixWorld(true);
  const partBox = (model, part) => {
    let mesh = null;
    model.traverse((obj) => {
      if (obj.userData?.part === part) mesh = obj;
    });
    assert.ok(mesh, part);
    return new THREE.Box3().setFromObject(mesh);
  };
  const block = partBox(hsbc, 'hsbc-block');
  const frontage = Math.max(block.max.x - block.min.x, block.max.z - block.min.z);
  assert.ok(frontage > 80, `HSBC frontage ${frontage}`);
  const dome = partBox(hsbc, 'hsbc-dome');
  const domeCx = (dome.max.x + dome.min.x) / 2;
  const blockCx = (block.max.x + block.min.x) / 2;
  assert.ok(domeCx > blockCx + 8, `dome sits on the river bay (${domeCx} vs ${blockCx})`);
  let columns = 0;
  hsbc.traverse((obj) => {
    if (obj.userData?.part === 'hsbc-column') columns += 1;
  });
  assert.equal(columns, 6, 'three pairs of Corinthian columns');
  const hCorn = partBox(hsbc, 'hsbc-cornice');
  const cCorn = partBox(customs, 'customs-cornice');
  assert.ok(Math.abs(hCorn.max.y - cCorn.max.y) < 0.25, `cornices ${hCorn.max.y} ${cCorn.max.y}`);
  const body = partBox(bocom, 'bocom-body');
  const tower = partBox(bocom, 'bocom-tower');
  assert.ok(tower.max.y > body.max.y + 4, 'Bund 14 centre rises above the fins');
  const bodySpan = Math.max(body.max.x - body.min.x, body.max.z - body.min.z);
  const towerSpan = Math.max(tower.max.x - tower.min.x, tower.max.z - tower.min.z);
  assert.ok(towerSpan < bodySpan * 0.55, `stepped centre ${towerSpan} / ${bodySpan}`);
  const marks = findLandmarks([
    {
      name: '上海浦东发展银行', area: 5169, topY: 31, baseY: 4,
      centroid: [10, 20], rings: [[[-30, -40], [40, -40], [40, 50], [-30, 50]]],
    },
    {
      name: '汇丰银行大楼', area: 4000, topY: 250, baseY: 4,
      centroid: [400, 0], rings: [[[380, -20], [420, -20], [420, 20], [380, 20]]],
    },
  ]);
  assert.deepEqual(marks.map((m) => m.id), ['hsbc']);
});

test('bund openings are framed glass and the HSBC dome keeps a finial', () => {
  const count = (id, h, part) => {
    const model = createLandmarks([{ id, x: 0, z: 0, y: 0, h, yaw: 0 }]).children[0];
    let n = 0;
    model.traverse((obj) => {
      if (obj.userData?.part === part) n += 1;
    });
    return { model, n };
  };
  const customs = count('customs', 90, 'bund-glass');
  const hsbc = count('hsbc', 52, 'bund-glass');
  const bocom = count('bocom', 38, 'bund-glass');
  assert.ok(customs.n > 16, `customs glass ${customs.n}`);
  assert.ok(hsbc.n > 20, `hsbc glass ${hsbc.n}`);
  assert.ok(bocom.n > 10, `bund 14 glass ${bocom.n}`);
  let arches = 0;
  let finial = 0;
  hsbc.model.traverse((obj) => {
    if (obj.geometry?.type === 'TorusGeometry') arches += 1;
    if (obj.userData?.part === 'hsbc-finial') finial += 1;
  });
  assert.ok(arches >= 3, `arched openings ${arches}`);
  assert.equal(finial, 1);
  let cones = 0;
  customs.model.traverse((obj) => {
    if (obj.geometry?.type === 'ConeGeometry') cones += 1;
  });
  assert.equal(cones, 0);
});

test('named crossings become a truss and two cable-stayed bridges', () => {
  assert.equal(deckLift({ name: '南浦大桥' }, [[0, 0], [10, 0]], true, 3), 34);
  assert.equal(deckLift({ name: '南浦大桥' }, [[0, 0], [10, 0]], true, 1), 12);
  const span = Array.from({ length: 20 }, (_, i) => [3700 + i * 40, -2200]);
  const inland = Array.from({ length: 20 }, (_, i) => [3000 + i * 40, 0]);
  assert.equal(deckLift({ name: '内环高架路' }, span, true, 1), 36);
  assert.ok(deckLift({ name: '内环高架路' }, inland, true, 1) < 20);
  assert.ok(deckLift({ name: '延安高架路' }, span, true, 2) < 20);

  const proj = { project: (lon, lat) => [lon * 100000, -lat * 100000] };
  const line = (id, name, lon0, lon1, lat) => ({
    type: 'way',
    id,
    tags: { highway: 'trunk', bridge: 'yes', name },
    geometry: [
      { lon: lon0, lat },
      { lon: (lon0 + lon1) / 2, lat: lat + 0.0004 },
      { lon: lon1, lat },
    ],
  });
  const found = collectBridges([
    line(1, '外白渡桥', 0, 0.001, 0),
    line(2, '南浦大桥', 0, 0.008, 0.01),
    line(3, '内环高架路', 0.039, 0.047, 0.022),
    line(4, '延安高架路', 0, 0.01, 0.03),
  ], proj, () => 2);
  assert.deepEqual(found.map((b) => b.id), ['waibaidu', 'nanpu', 'yangpu']);
  assert.equal(found[0].kind, 'truss');
  assert.equal(found[1].style, 'h');
  assert.equal(found[2].style, 'y');
  assert.equal(found[2].name, '杨浦大桥');
  const approaches = [
    { name: '内环高架路', bridge: true, lift: 36, points: [[3806, -2323], [4378, -1795]] },
    { name: '内环高架路', bridge: true, lift: 5.2, points: [[3821, -2321], [3246, -3155]] },
    { name: '延安高架路', bridge: true, lift: 8, points: [[3806, -2323], [3000, -2300]] },
  ];
  gradeYangpuApproaches(approaches);
  assert.equal(approaches[1].ramp, true);
  assert.equal(approaches[1].liftHigh, 36);
  assert.equal(approaches[1].highAtStart, true);
  assert.notEqual(approaches[2].ramp, true);

  const group = createBridges([
    { id: 'waibaidu', kind: 'truss', points: [[0, 6, 0], [40, 6, 0], [90, 6, 10]] },
    { id: 'nanpu', kind: 'cable', style: 'h', towerH: 40, mainSpan: 80, points: [[0, 12, 0], [200, 14, 20]] },
  ]);
  assert.equal(group.children.length, 2);
  assert.equal(group.children[0].userData.bridge, 'waibaidu');
  assert.ok(group.children[0].children.length > 8);
  assert.equal(group.children[1].userData.towers, 2);
  assert.ok(group.children[1].children.length > 8);
  const nanpu = group.children[1];
  let legs = 0;
  let beams = 0;
  const anchors = [];
  nanpu.traverse((obj) => {
    if (obj.userData?.part === 'h-leg') legs += 1;
    if (obj.userData?.part === 'h-beam') beams += 1;
    if (obj.userData?.part === 'cable' && obj.userData.anchor) anchors.push(obj.userData.anchor);
  });
  assert.equal(legs, 4, 'both towers have two legs');
  assert.equal(beams, 4, 'each H has a mid beam and a top beam');
  const clusters = [];
  for (const anchor of anchors) {
    if (!clusters.some((c) => c.distanceTo(anchor) < 4)) clusters.push(anchor);
  }
  assert.equal(clusters.length, 4, 'cable fans anchor on both legs of both towers');
  const legPos = [];
  nanpu.traverse((obj) => {
    if (obj.userData?.part === 'h-leg') legPos.push(obj.position.clone());
  });
  const towers = [];
  for (const p of legPos) {
    const hit = towers.find((group) => group[0].distanceTo(p) < 45);
    if (hit) hit.push(p);
    else towers.push([p]);
  }
  assert.equal(towers.length, 2);
  assert.ok(towers.every((group) => group.length === 2));
  const sep = (p, q) => new THREE.Vector3(q.x - p.x, 0, q.z - p.z).normalize();
  const s0 = sep(towers[0][0], towers[0][1]);
  const s1 = sep(towers[1][0], towers[1][1]);
  assert.ok(Math.abs(s0.dot(s1)) > 0.98, 'the two H frames are parallel');
});
