import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { beamGeometry, beamMaterial, lampScene } from './lamplight.js';

function paint(geo, hex) {
  const color = new THREE.Color(hex);
  const arr = new Float32Array(geo.getAttribute('position').count * 3);
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] = color.r; arr[i + 1] = color.g; arr[i + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function carGeometry() {
  const body = paint(new THREE.BoxGeometry(4.2, 0.62, 1.72).translate(0, 0.55, 0), 0xffffff);
  const roof = paint(new THREE.BoxGeometry(2.05, 0.5, 1.5).translate(-0.25, 1.05, 0), 0x2a2e33);
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.18, 8);
  wheelGeo.rotateX(Math.PI / 2);
  const wheels = [];
  for (const [x, z] of [[1.25, 0.78], [1.25, -0.78], [-1.25, 0.78], [-1.25, -0.78]]) {
    const w = paint(wheelGeo.clone().translate(x, 0.32, z), 0x1a1c1f);
    wheels.push(w);
  }
  return mergeGeometries([body, roof, ...wheels]);
}

const PAINTS = [0xf4f4f2, 0x23272c, 0x8e969e, 0xb4232a, 0x1d4f8c, 0xd6a31c, 0x1e6b4c, 0xe7e2d8];

export function createCarFleet(count) {
  const geo = carGeometry();
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.45 });
  const body = new THREE.InstancedMesh(geo, bodyMat, count);
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const glassGeo = new THREE.BoxGeometry(1.7, 0.38, 1.35).translate(-0.15, 1.08, 0);
  const glass = new THREE.InstancedMesh(glassGeo, new THREE.MeshStandardMaterial({
    color: 0x0c1218, roughness: 0.08, metalness: 0.9,
  }), count);
  glass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const lampGeo = new THREE.BoxGeometry(0.12, 0.12, 0.22);
  const left = lampGeo.clone().translate(2.08, 0.58, 0.55);
  const right = lampGeo.clone().translate(2.08, 0.58, -0.55);
  const lampsGeo = mergeGeometries([left, right]);
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff6df,
    emissive: new THREE.Color('#ffe1a8'),
    emissiveIntensity: 0,
  });
  const lamps = new THREE.InstancedMesh(lampsGeo, lampMat, count);
  lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    color.setHex(i % 7 === 0 ? 0xd6a31c : PAINTS[i % PAINTS.length]);
    body.setColorAt(i, color);
  }
  body.instanceColor.needsUpdate = true;
  const beams = new THREE.InstancedMesh(beamGeometry(4.2), beamMaterial, count);
  beams.instanceMatrix = body.instanceMatrix;
  beams.frustumCulled = false;
  beams.updateMatrixWorld(true);
  lampScene.add(beams);
  body.castShadow = false;
  body.frustumCulled = false;
  glass.frustumCulled = false;
  lamps.frustumCulled = false;
  return { body, glass, lamps, lampMat, beams, dummy: new THREE.Object3D(), count };
}

const CLOTHES = [0x243044, 0x8c3a3a, 0x2f4a38, 0xc4b8a4, 0x1d3d6e, 0x6b5344, 0xd8d4cc, 0x3d3a44];

const PANTS = [0x1c1e22, 0x243044, 0x3a322c, 0x2c3340, 0x4a4036, 0x1a2744];

export function createPersonFleet(count) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
  const shirt = mergeGeometries([
    paint(new THREE.BoxGeometry(0.36, 0.48, 0.2).translate(0, 1.02, 0), 0xffffff),
    paint(new THREE.BoxGeometry(0.1, 0.4, 0.1).translate(-0.24, 0.98, 0), 0xffffff),
    paint(new THREE.BoxGeometry(0.1, 0.4, 0.1).translate(0.24, 0.98, 0), 0xffffff),
  ]);
  const mesh = new THREE.InstancedMesh(shirt, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  const legsGeo = mergeGeometries([
    paint(new THREE.BoxGeometry(0.12, 0.56, 0.14).translate(-0.09, 0.28, 0), 0xffffff),
    paint(new THREE.BoxGeometry(0.12, 0.56, 0.14).translate(0.09, 0.28, 0), 0xffffff),
  ]);
  const legs = new THREE.InstancedMesh(legsGeo, mat.clone(), count);
  legs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  legs.frustumCulled = false;
  const headGeo = new THREE.SphereGeometry(0.13, 8, 6).translate(0, 1.4, 0);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({
    color: 0xd2b49a, roughness: 0.65,
  }), count);
  heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  heads.frustumCulled = false;
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    color.setHex(CLOTHES[i % CLOTHES.length]);
    mesh.setColorAt(i, color);
    color.setHex(PANTS[(i * 3) % PANTS.length]);
    legs.setColorAt(i, color);
  }
  mesh.instanceColor.needsUpdate = true;
  legs.instanceColor.needsUpdate = true;
  return { mesh, legs, heads, dummy: new THREE.Object3D(), count };
}

export function createBoatFleet(count) {
  const hull = paint(new THREE.BoxGeometry(16, 1.15, 4.2).translate(0, 0.7, 0), 0xf4f1ea);
  const stripe = paint(new THREE.BoxGeometry(16.05, 0.28, 4.25).translate(0, 1.15, 0), 0x1a3a6b);
  const cabin = paint(new THREE.BoxGeometry(5.2, 1.5, 3.1).translate(-1.2, 1.9, 0), 0xe7e2d6);
  const geo = mergeGeometries([hull, stripe, cabin]);
  const body = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.42, metalness: 0.2,
  }), count);
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  body.frustumCulled = false;
  const glass = new THREE.InstancedMesh(
    new THREE.BoxGeometry(3.4, 0.7, 2.7).translate(-1.2, 2.15, 0),
    new THREE.MeshStandardMaterial({ color: 0x9bb4c4, roughness: 0.08, metalness: 0.6 }),
    count,
  );
  glass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  glass.frustumCulled = false;
  const lampGeo = new THREE.BoxGeometry(0.35, 0.22, 0.35);
  const lampsGeo = mergeGeometries([
    lampGeo.clone().translate(7.4, 1.35, 1.5),
    lampGeo.clone().translate(7.4, 1.35, -1.5),
    lampGeo.clone().translate(-7.2, 2.5, 0),
  ]);
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff2cc,
    emissive: new THREE.Color('#ffd27a'),
    emissiveIntensity: 0,
  });
  const lamps = new THREE.InstancedMesh(lampsGeo, lampMat, count);
  lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  lamps.frustumCulled = false;
  const color = new THREE.Color();
  const paints = [0xf7f4ee, 0xf7f4ee, 0xd8dee6, 0xc4553a];
  for (let i = 0; i < count; i++) {
    color.setHex(paints[i % paints.length]);
    body.setColorAt(i, color);
  }
  body.instanceColor.needsUpdate = true;
  return { body, glass, lamps, lampMat, dummy: new THREE.Object3D(), count };
}

export function setVehicleMatrix(mesh, index, dummy, x, y, z, dx, dz) {
  dummy.position.set(x, y, z);
  dummy.rotation.set(0, Math.atan2(-dz, dx), 0);
  dummy.scale.set(1, 1, 1);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

export function createTrainMesh(count) {
  const body = new THREE.BoxGeometry(15.5, 3.1, 2.7).translate(0, 2.15, 0);
  const band = new THREE.BoxGeometry(15.6, 0.45, 2.75).translate(0, 2.7, 0);
  paint(body, 0xffffff);
  paint(band, 0x1a1a1a);
  const geo = mergeGeometries([body, band]);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3 }), count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  const windows = new THREE.InstancedMesh(
    new THREE.BoxGeometry(12.5, 0.7, 2.76).translate(0, 2.55, 0),
    new THREE.MeshStandardMaterial({
      color: 0x2a3440,
      roughness: 0.15,
      metalness: 0.6,
      emissive: new THREE.Color('#f4e2b8'),
      emissiveIntensity: 0,
    }),
    count,
  );
  windows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  windows.frustumCulled = false;
  return { mesh, windows };
}
