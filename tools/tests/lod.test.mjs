import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createLandmarks } from '../../src/world/landmarks.js';
import { mergeChildren } from '../../src/world/merge.js';
import { buildTerrainChunks, repaintTerrain, updateTerrainLod } from '../../src/world/terrainlod.js';
import { createClusters } from '../../src/world/clusters.js';
import { TILE } from '../../src/shared/geo.js';

function meshCount(root) {
  let n = 0;
  root.traverse((obj) => { if (obj.isMesh) n += 1; });
  return n;
}

test('merged landmarks keep their extent in far fewer meshes', () => {
  const list = [
    { id: 'pearl', x: 0, z: 0, y: 0, h: 468, yaw: 0 },
    { id: 'customs', x: 300, z: 40, y: 2, h: 79, yaw: 0 },
    { id: 'swfc', x: -400, z: 120, y: 0, h: 492, yaw: 0 },
  ];
  const before = createLandmarks(list);
  before.updateMatrixWorld(true);
  const boxBefore = new THREE.Box3().setFromObject(before);
  const parts = meshCount(before);
  const after = mergeChildren(createLandmarks(list));
  after.updateMatrixWorld(true);
  const boxAfter = new THREE.Box3().setFromObject(after);
  assert.ok(meshCount(after) * 4 < parts, `${meshCount(after)} merged meshes from ${parts}`);
  for (const key of ['min', 'max']) {
    for (const axis of ['x', 'y', 'z']) {
      assert.ok(Math.abs(boxBefore[key][axis] - boxAfter[key][axis]) < 0.01, `${key}.${axis} moved`);
    }
  }
});

function flatSheet(cols, rows, step) {
  const pos = new Float32Array(cols * rows * 3);
  const col = new Float32Array(cols * rows * 3).fill(0.5);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      pos[i * 3] = c * step;
      pos[i * 3 + 1] = 0.02 * c;
      pos[i * 3 + 2] = r * step;
    }
  }
  return { pos, col, cols, rows, step, keepCell: () => true };
}

test('terrain chunks cover the grid and coarsen with distance', () => {
  const sheet = flatSheet(300, 200, 8);
  const group = buildTerrainChunks(sheet, new THREE.MeshBasicMaterial());
  const chunks = group.userData.chunks;
  assert.equal(chunks.length, 3 * 2);
  // Finest level, without the skirts, draws every grid cell once.
  let cells = 0;
  for (const mesh of chunks) {
    const box = mesh.geometry.boundingBox;
    const w = Math.round((box.max.x - box.min.x) / 8);
    const h = Math.round((box.max.z - box.min.z) / 8);
    cells += w * h;
  }
  assert.equal(cells, 299 * 199);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 50, 0);
  updateTerrainLod(group, camera);
  const near = chunks[0].geometry.index.count;
  camera.position.set(-20000, 50, -20000);
  updateTerrainLod(group, camera);
  assert.ok(chunks[0].geometry.index.count < near / 8, 'a distant chunk keeps its full index');
  sheet.col.fill(0.25);
  repaintTerrain(group, sheet.col);
  assert.equal(chunks[3].geometry.getAttribute('color').array[5], 0.25);
});

function fakeTile(scene, tx, tz) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial();
  const geo = new THREE.BoxGeometry(10, 10, 10).toNonIndexed().translate((tx + 0.5) * TILE, 5, (tz + 0.5) * TILE);
  const building = new THREE.Mesh(geo, mat);
  group.add(building);
  group.userData.parts = { building, land: null, road: null, water: null };
  scene.add(group);
  return group;
}

test('a distant block of tiles draws as one merged mesh and splits again up close', () => {
  const scene = new THREE.Scene();
  const clusters = createClusters(scene);
  const tiles = [];
  for (let tx = 0; tx < 4; tx++) {
    for (let tz = 0; tz < 4; tz++) {
      const g = fakeTile(scene, tx, tz);
      clusters.add(g, tx, tz);
      tiles.push(g);
    }
  }
  const merged = () => scene.children.filter((o) => o.isMesh && o.userData.cluster);
  clusters.update(new THREE.Vector3(5000, 300, 5000));
  assert.equal(merged().length, 1);
  assert.ok(merged()[0].visible);
  assert.ok(tiles.every((g) => !g.userData.parts.building.visible));
  assert.equal(merged()[0].geometry.getAttribute('position').count, 16 * 36);
  clusters.update(new THREE.Vector3(500, 30, 500));
  assert.ok(!merged()[0].visible);
  assert.ok(tiles.every((g) => g.userData.parts.building.visible));
  for (const g of tiles) clusters.remove(g);
  assert.equal(merged().length, 0);
});
