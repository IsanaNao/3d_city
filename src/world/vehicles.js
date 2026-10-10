import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
  const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const body = new THREE.InstancedMesh(geo, bodyMat, count);
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const glassGeo = new THREE.BoxGeometry(1.7, 0.38, 1.35).translate(-0.15, 1.08, 0);
  const glass = new THREE.InstancedMesh(glassGeo, new THREE.MeshLambertMaterial({
    color: 0x1c3344, transparent: true, opacity: 0.85,
  }), count);
  glass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const lampGeo = new THREE.BoxGeometry(0.12, 0.12, 0.22);
  const left = lampGeo.clone().translate(2.08, 0.58, 0.55);
  const right = lampGeo.clone().translate(2.08, 0.58, -0.55);
  const lampsGeo = mergeGeometries([left, right]);
  const lampMat = new THREE.MeshLambertMaterial({
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
  body.castShadow = false;
  body.frustumCulled = false;
  glass.frustumCulled = false;
  lamps.frustumCulled = false;
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
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  const windows = new THREE.InstancedMesh(
    new THREE.BoxGeometry(12.5, 0.7, 2.76).translate(0, 2.55, 0),
    new THREE.MeshLambertMaterial({
      color: 0xd7e7f4,
      emissive: new THREE.Color('#f4e2b8'),
      emissiveIntensity: 0,
    }),
    count,
  );
  windows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  windows.frustumCulled = false;
  return { mesh, windows };
}
