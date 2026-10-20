import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _rel = new THREE.Matrix4();
const _inv = new THREE.Matrix4();

function bucketKey(mesh) {
  const geo = mesh.geometry;
  const names = Object.keys(geo.attributes).sort().map((name) => {
    const a = geo.attributes[name];
    return `${name}:${a.itemSize}:${a.array.constructor.name}:${a.normalized ? 1 : 0}`;
  }).join(',');
  return [
    mesh.material.uuid, names, geo.index ? 1 : 0,
    mesh.castShadow ? 1 : 0, mesh.receiveShadow ? 1 : 0, mesh.layers.mask, mesh.renderOrder,
  ].join('|');
}

function mergeable(obj) {
  if (!obj.isMesh || obj.isInstancedMesh || obj.isSkinnedMesh || !obj.visible) return false;
  if (Array.isArray(obj.material)) return false;
  const geo = obj.geometry;
  if (!geo?.attributes?.position) return false;
  return !Object.keys(geo.morphAttributes || {}).length;
}

// The hand-built models are thousands of small meshes that share a few dozen
// materials; one draw per material keeps the same pixels at a fraction of the
// calls. Geometry is baked into the model's own frame, so shaders that read
// object-space `position` still see metres, and the merged parts frustum-cull.
export function mergeModel(model) {
  model.updateMatrixWorld(true);
  _inv.copy(model.matrixWorld).invert();
  const buckets = new Map();
  model.traverse((obj) => {
    if (obj === model || !mergeable(obj)) return;
    const key = bucketKey(obj);
    let list = buckets.get(key);
    if (!list) { list = []; buckets.set(key, list); }
    list.push(obj);
  });
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const geos = list.map((mesh) => {
      // applyMatrix4 moves position, normal and tangent; painted attributes stay as they are.
      const geo = mesh.geometry.clone();
      geo.groups.length = 0;
      geo.applyMatrix4(_rel.multiplyMatrices(_inv, mesh.matrixWorld));
      return geo;
    });
    const merged = mergeGeometries(geos, false);
    for (const geo of geos) geo.dispose();
    if (!merged) continue;
    const first = list[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.layers.mask = first.layers.mask;
    mesh.renderOrder = first.renderOrder;
    mesh.userData.merged = list.length;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    for (const part of list) part.parent?.remove(part);
    model.add(mesh);
  }
  // Groups left empty by the merge only cost a traversal.
  const empty = [];
  model.traverse((obj) => {
    if (obj !== model && obj.type === 'Group' && !obj.children.length) empty.push(obj);
  });
  for (const obj of empty) obj.parent?.remove(obj);
  return model;
}

export function mergeChildren(root) {
  for (const model of [...root.children]) mergeModel(model);
  return root;
}
