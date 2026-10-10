import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PROP } from '../shared/kinds.js';
import { cityUniforms } from './materials.js';

function colorize(geo, hex) {
  const color = new THREE.Color(hex);
  const arr = new Float32Array(geo.getAttribute('position').count * 3);
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] = color.r;
    arr[i + 1] = color.g;
    arr[i + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function flatGeo(geo) {
  return geo.index ? geo.toNonIndexed() : geo;
}

function limb(r0, r1, length, hex) {
  const geo = new THREE.CylinderGeometry(r1, r0, length, 5);
  geo.translate(0, length / 2, 0);
  colorize(geo, hex);
  return geo;
}

let treeGeo = null;
export function treeGeometry() {
  if (treeGeo) return treeGeo;
  // A pollarded Shanghai plane: clear trunk, a few limbs, a high wide crown.
  const trunk = new THREE.CylinderGeometry(0.13, 0.26, 4.6, 6);
  trunk.translate(0, 2.3, 0);
  colorize(trunk, 0x6b5342);
  const parts = [flatGeo(trunk)];
  const branches = [
    [0.9, 0.35, 4.15, 2.4, 0.11, 0.05],
    [-0.7, -0.85, 4.25, 2.15, 0.1, 0.045],
    [0.15, 1.05, 4.2, 2.05, 0.09, 0.04],
  ];
  for (const [x, z, y0, length, r0, r1] of branches) {
    const geo = limb(r0, r1, length, 0x5c493c);
    const yaw = Math.atan2(x, z);
    const pitch = Math.atan2(Math.hypot(x, z), length * 0.55);
    geo.rotateX(pitch);
    geo.rotateY(yaw);
    geo.translate(0, y0, 0);
    parts.push(flatGeo(geo));
  }
  const lobes = [
    [0, 7.15, 0, 2.55, 1.35, 2.4, 0x3d6934],
    [1.55, 6.85, 0.4, 1.7, 1.05, 1.55, 0x4a783c],
    [-1.35, 6.7, -0.85, 1.6, 1.0, 1.55, 0x345e2e],
    [0.2, 7.85, -0.25, 1.35, 0.85, 1.25, 0x547f42],
    [-0.55, 6.45, 1.35, 1.5, 0.95, 1.4, 0x386332],
    [1.1, 7.35, -1.15, 1.25, 0.8, 1.15, 0x46743a],
  ];
  for (const [x, y, z, sx, sy, sz, hex] of lobes) {
    const lobe = new THREE.IcosahedronGeometry(1, 1);
    lobe.scale(sx, sy, sz).translate(x, y, z);
    colorize(lobe, hex);
    parts.push(flatGeo(lobe));
  }
  treeGeo = mergeGeometries(parts);
  treeGeo.userData.sharedGeo = true;
  return treeGeo;
}

let treeFarGeo = null;
export function treeGeometryFar() {
  if (treeFarGeo) return treeFarGeo;
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 4.4, 4);
  trunk.translate(0, 2.2, 0);
  colorize(trunk, 0x6b5342);
  const crown = new THREE.IcosahedronGeometry(1, 0);
  crown.scale(2.7, 1.7, 2.6).translate(0, 6.9, 0);
  colorize(crown, 0x3f6b36);
  treeFarGeo = mergeGeometries([flatGeo(trunk), flatGeo(crown)]);
  treeFarGeo.userData.sharedGeo = true;
  return treeFarGeo;
}

let lightGeo = null;
export function signalGeometry() {
  if (lightGeo) return lightGeo;
  const pole = new THREE.CylinderGeometry(0.08, 0.1, 5.4, 6);
  pole.translate(0, 2.7, 0);
  colorize(pole, 0x2c3136);
  const arm = new THREE.BoxGeometry(2.4, 0.12, 0.12);
  arm.translate(1.1, 5.2, 0);
  colorize(arm, 0x2c3136);
  const red = new THREE.SphereGeometry(0.16, 8, 6);
  red.translate(2.05, 5.05, 0.08);
  colorize(red, 0xc43838);
  const amber = new THREE.SphereGeometry(0.16, 8, 6);
  amber.translate(1.55, 5.05, 0.08);
  colorize(amber, 0xd8a03a);
  const green = new THREE.SphereGeometry(0.16, 8, 6);
  green.translate(1.05, 5.05, 0.08);
  colorize(green, 0x3a9a4a);
  const parts = [pole, arm, red, amber, green].map((geo) => flatGeo(geo));
  lightGeo = mergeGeometries(parts);
  if (!lightGeo) return null;
  lightGeo.userData.sharedGeo = true;
  return lightGeo;
}

let lampGeos = null;
export function lampGeometries() {
  if (lampGeos) return lampGeos;
  const pole = new THREE.CylinderGeometry(0.07, 0.09, 8, 5);
  pole.translate(0, 4, 0);
  const head = new THREE.BoxGeometry(0.55, 0.18, 0.28);
  head.translate(0, 8.05, 0);
  lampGeos = { pole, head };
  return lampGeos;
}

function boxAt(w, h, d, y) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, y + h / 2, 0);
  return geo;
}

let propMaterial = null;
export function staticPropMesh(props) {
  const geos = [];
  for (const prop of props) {
    let geo = null;
    if (prop.kind === PROP.AC) geo = boxAt(prop.scale * 1.5, prop.extra, prop.scale, 0);
    else if (prop.kind === PROP.TANK) geo = new THREE.CylinderGeometry(prop.scale * 0.55, prop.scale * 0.55, prop.extra, 8).translate(0, prop.extra / 2, 0);
    else if (prop.kind === PROP.PENTHOUSE) geo = boxAt(prop.scale, prop.extra, prop.scale * 0.72, 0);
    else if (prop.kind === PROP.PIER) {
      const h = Math.max(1.2, prop.extra || 4);
      geo = new THREE.CylinderGeometry(0.45, 0.7, h, 6).translate(0, h / 2, 0);
    }
    if (!geo) continue;
    geo.rotateY(prop.rot || 0);
    geo.translate(prop.x, prop.y, prop.z);
    geos.push(geo);
  }
  if (!geos.length) return null;
  const merged = mergeGeometries(geos);
  propMaterial ??= new THREE.MeshStandardMaterial({ color: 0x9c978f, roughness: 0.8, metalness: 0.1 });
  const mesh = new THREE.Mesh(merged, propMaterial);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function instanceProps(kind, props, geometry, material) {
  if (!props.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, props.length);
  mesh.userData.sharedGeo = true;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  props.forEach((prop, i) => {
    dummy.position.set(prop.x, prop.y, prop.z);
    dummy.rotation.set(0, prop.rot || 0, 0);
    const s = prop.scale || 1;
    if (kind === PROP.TREE) dummy.scale.set(s, 0.85 + (prop.variant || 0) * 0.12, s);
    else dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (kind === PROP.TREE) {
      color.setHex(prop.variant === 1 ? 0xc8d2a4 : prop.variant === 2 ? 0xb7c48a : 0xffffff);
      mesh.setColorAt(i, color);
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = kind === PROP.TREE;
  mesh.receiveShadow = true;
  return mesh;
}

let sharedSignMaterial = null;
export function signMaterial(atlas) {
  if (sharedSignMaterial) return sharedSignMaterial;
  sharedSignMaterial = new THREE.MeshLambertMaterial({
    map: atlas,
    emissive: new THREE.Color('#fff1d2'),
    emissiveMap: atlas,
    emissiveIntensity: 0.25,
    side: THREE.DoubleSide,
  });
  sharedSignMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = cityUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aSign;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_MAP
          vMapUv = uv * vec2(0.125, 1.0) + vec2(aSign * 0.125, 0.0);
        #endif
        #ifdef USE_EMISSIVEMAP
          vEmissiveMapUv = uv * vec2(0.125, 1.0) + vec2(aSign * 0.125, 0.0);
        #endif`);
  };
  sharedSignMaterial.customProgramCacheKey = () => 'sh-sign-1';
  return sharedSignMaterial;
}

export function signMesh(props, atlas) {
  if (!props.length || !atlas) return null;
  const geo = new THREE.PlaneGeometry(1, 1);
  const material = signMaterial(atlas);
  const signs = new Float32Array(props.length);
  props.forEach((prop, i) => { signs[i] = prop.variant % 8; });
  geo.setAttribute('aSign', new THREE.InstancedBufferAttribute(signs, 1));
  const mesh = new THREE.InstancedMesh(geo, material, props.length);
  const dummy = new THREE.Object3D();
  props.forEach((prop, i) => {
    dummy.position.set(prop.x, prop.y, prop.z);
    dummy.rotation.set(0, prop.rot || 0, 0);
    dummy.scale.set(prop.scale || 4, prop.extra || 1.4, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

export function lampHeadMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xfff1cc,
    emissive: new THREE.Color('#ffd28a'),
    emissiveIntensity: 0,
  });
}
