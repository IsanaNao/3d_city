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

let treeGeo = null;
export function treeGeometry() {
  if (treeGeo) return treeGeo;
  // a plane tree: a bare trunk and a broad round crown in two lumps
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 2.6, 5);
  trunk.translate(0, 1.3, 0);
  colorize(trunk, 0x5a4636);
  const crown = new THREE.IcosahedronGeometry(1.75, 1);
  crown.scale(1, 0.82, 1).translate(0, 3.7, 0);
  colorize(crown, 0x3f6b33);
  const cap = new THREE.IcosahedronGeometry(1.15, 1);
  cap.translate(0.45, 4.6, -0.3);
  colorize(cap, 0x4d7c3c);
  treeGeo = mergeGeometries([trunk.toNonIndexed(), crown, cap]);
  treeGeo.userData.sharedGeo = true;
  return treeGeo;
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
    else if (prop.kind === PROP.PIER) geo = boxAt(prop.scale, Math.max(0.5, prop.extra), prop.scale, 0);
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
