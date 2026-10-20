import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TILE } from '../shared/geo.js';

// Distant tiles cost draw calls, not triangles: hundreds of 256 m tiles each
// draw their buildings, ground and roads in the view, the mirror and the
// shadow map. Past NEAR metres a 4x4 block of tiles is drawn as one merged
// mesh per material instead. The geometry is the same, so nothing pops.
const BLOCK = 4;
const NEAR = 700;
const KINDS = ['building', 'land', 'road', 'water'];
// Merges per streamer update, so a fast pull-back does not stall one frame.
const BUDGET = 6;

function blockOf(tx, tz) {
  const bx = Math.floor(tx / BLOCK);
  const bz = Math.floor(tz / BLOCK);
  return { bx, bz, key: `${bx}_${bz}` };
}

export function createClusters(scene) {
  const blocks = new Map();
  const half = (BLOCK * TILE) / 2;

  function showTile(group, on) {
    const parts = group.userData.parts;
    for (const kind of KINDS) if (parts[kind]) parts[kind].visible = on;
  }

  function dropMerged(block) {
    for (const mesh of Object.values(block.meshes)) {
      scene.remove(mesh);
      mesh.geometry.dispose();
    }
    block.meshes = {};
    block.merged = new Set();
  }

  function rebuild(block) {
    dropMerged(block);
    const tiles = [...block.tiles];
    for (const kind of KINDS) {
      const sources = tiles.map((g) => g.userData.parts[kind]).filter(Boolean);
      if (!sources.length) continue;
      const geo = mergeGeometries(sources.map((m) => m.geometry), false);
      if (!geo) continue;
      geo.computeBoundingSphere();
      const first = sources[0];
      const mesh = new THREE.Mesh(geo, first.material);
      mesh.castShadow = first.castShadow;
      mesh.receiveShadow = first.receiveShadow;
      mesh.layers.mask = first.layers.mask;
      mesh.matrixAutoUpdate = false;
      mesh.userData.cluster = block.key;
      block.meshes[kind] = mesh;
      scene.add(mesh);
    }
    block.merged = new Set(tiles);
    block.dirty = false;
  }

  function apply(block) {
    const merged = block.far;
    for (const mesh of Object.values(block.meshes)) mesh.visible = merged;
    for (const group of block.tiles) showTile(group, !(merged && block.merged.has(group)));
  }

  return {
    add(group, tx, tz) {
      const { bx, bz, key } = blockOf(tx, tz);
      let block = blocks.get(key);
      if (!block) {
        block = {
          key, cx: (bx * BLOCK) * TILE + half, cz: (bz * BLOCK) * TILE + half,
          tiles: new Set(), merged: new Set(), meshes: {}, far: false, dirty: false,
        };
        blocks.set(key, block);
      }
      block.tiles.add(group);
      block.dirty = true;
      group.userData.block = block;
      apply(block);
    },
    remove(group) {
      const block = group.userData.block;
      if (!block) return;
      block.tiles.delete(group);
      block.dirty = true;
      if (!block.tiles.size) {
        dropMerged(block);
        blocks.delete(block.key);
      }
    },
    update(eye) {
      let budget = BUDGET;
      for (const block of blocks.values()) {
        const dx = Math.max(0, Math.abs(eye.x - block.cx) - half);
        const dz = Math.max(0, Math.abs(eye.z - block.cz) - half);
        const far = Math.hypot(dx, dz, Math.max(0, eye.y)) > NEAR;
        let changed = far !== block.far;
        block.far = far;
        if (far && block.dirty && budget > 0) {
          rebuild(block);
          budget -= 1;
          changed = true;
        }
        if (changed) apply(block);
      }
    },
    get drawn() {
      let n = 0;
      for (const block of blocks.values()) if (block.far && block.merged.size) n += 1;
      return n;
    },
  };
}
