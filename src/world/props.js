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

function shadeCrown(geo, cy, topHex, underHex) {
  const pos = geo.getAttribute('position');
  const top = new THREE.Color(topHex);
  const under = new THREE.Color(underHex);
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(0.5 + (pos.getY(i) - cy) / 1.8, 0, 1);
    const c = under.clone().lerp(top, t * t);
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function crownLobe(x, y, z, sx, sy, sz, topHex, underHex) {
  const lobe = new THREE.IcosahedronGeometry(1, 1);
  lobe.scale(sx, sy, sz).translate(x, y, z);
  return shadeCrown(lobe, y, topHex, underHex);
}

let treeGeo = null;
export function treeGeometry() {
  if (treeGeo) return treeGeo;
  // Forked trunk and a clustered crown, lighter underneath, not one ball.
  const parts = [flatGeo(limb(0.3, 0.2, 2.5, 0x6a5344))];
  const forks = [
    [0.62, 2.15, 0.15, 2.8, -0.15],
    [-0.55, 2.05, -0.35, 2.4, 0.9],
    [0.1, 2.35, 0.7, 2.1, 2.2],
  ];
  for (const [x, y, z, length, yaw] of forks) {
    const geo = limb(0.11, 0.045, length, 0x5a4638);
    geo.rotateZ(x >= 0 ? -0.7 : 0.65);
    geo.rotateY(yaw);
    geo.translate(x * 0.15, y, z * 0.15);
    parts.push(flatGeo(geo));
  }
  const lobes = [
    [1.15, 5.15, 0.35, 1.35, 1.05, 1.2, 0x2d6230, 0x9ec56e],
    [-0.95, 4.85, -0.55, 1.25, 0.95, 1.15, 0x356838, 0xa4cc78],
    [0.15, 5.55, 0.95, 1.15, 0.9, 1.05, 0x3a7040, 0xb4d888],
    [-0.2, 4.45, 0.85, 1.05, 0.8, 1.0, 0x2a5c2e, 0x8fbb66],
    [0.85, 4.35, -0.7, 1.1, 0.85, 1.05, 0x3e7642, 0xb0d484],
    [-1.25, 5.35, 0.45, 0.95, 0.75, 0.9, 0x326434, 0x98c070],
    [0.35, 5.95, -0.15, 0.85, 0.65, 0.8, 0x4a8248, 0xc2e090],
    [-0.45, 3.95, -0.15, 0.9, 0.7, 0.85, 0x285828, 0x86b45e],
  ];
  for (const [x, y, z, sx, sy, sz, top, under] of lobes) {
    parts.push(flatGeo(crownLobe(x, y, z, sx, sy, sz, top, under)));
  }
  treeGeo = mergeGeometries(parts);
  treeGeo.userData.sharedGeo = true;
  return treeGeo;
}

let treeFarGeo = null;
export function treeGeometryFar() {
  if (treeFarGeo) return treeFarGeo;
  const parts = [flatGeo(limb(0.16, 0.24, 2.6, 0x6b5342))];
  const lobes = [
    [0.7, 4.6, 0.2, 1.3, 1.0, 1.2, 0x326434, 0xa4cc78],
    [-0.65, 4.35, -0.35, 1.15, 0.9, 1.05, 0x2d5e30, 0x96c06e],
    [0.1, 5.15, 0.45, 1.0, 0.75, 0.95, 0x3e7640, 0xb6d884],
  ];
  for (const [x, y, z, sx, sy, sz, top, under] of lobes) {
    const lobe = new THREE.IcosahedronGeometry(1, 0);
    lobe.scale(sx, sy, sz).translate(x, y, z);
    parts.push(flatGeo(shadeCrown(lobe, y, top, under)));
  }
  treeFarGeo = mergeGeometries(parts);
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

let cupolaMat = null;
function cupolaMaterial() {
  if (cupolaMat) return cupolaMat;
  cupolaMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.68,
    metalness: 0.12,
    vertexColors: true,
  });
  cupolaMat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = cityUniforms.uNight;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.92, 0.5, 0.18) * uNight;`);
  };
  cupolaMat.customProgramCacheKey = () => 'sh-cupola-2';
  return cupolaMat;
}

function cupolaParts(variant, scale, extra) {
  const geos = [];
  const stone = 0xd6c4ae;
  const shade = 0xb5a28c;
  const copper = 0x6d917c;
  const push = (geo, hex) => {
    colorize(geo, hex);
    geos.push(flatGeo(geo));
  };
  if (variant === 1) {
    const radius = scale * 0.42;
    const drumH = extra * 0.42;
    const drum = new THREE.CylinderGeometry(radius * 0.96, radius, drumH, 12);
    drum.translate(0, drumH / 2, 0);
    push(drum, stone);
    const dome = new THREE.SphereGeometry(radius * 0.98, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.translate(0, drumH * 0.92, 0);
    push(dome, copper);
    const finial = new THREE.CylinderGeometry(0.1, 0.16, extra * 0.2, 5);
    finial.translate(0, drumH + radius * 0.72, 0);
    push(finial, shade);
    return geos;
  }
  const width = scale;
  const depth = scale * 0.7;
  const wallH = extra * 0.58;
  const shaft = new THREE.BoxGeometry(width, wallH, depth);
  shaft.translate(0, wallH / 2, 0);
  push(shaft, stone);
  const lip = new THREE.BoxGeometry(width * 1.14, 0.42, depth * 1.14);
  lip.translate(0, wallH, 0);
  push(lip, shade);
  const roofH = extra * 0.5;
  const pyramid = new THREE.ConeGeometry(Math.hypot(width, depth) * 0.5, roofH, 4);
  pyramid.rotateY(Math.PI / 4);
  pyramid.translate(0, wallH + roofH / 2, 0);
  push(pyramid, shade);
  return geos;
}

export function cupolaMesh(props) {
  if (!props.length) return null;
  const geos = [];
  for (const prop of props) {
    const variant = prop.variant || 0;
    const scale = prop.scale || 8;
    const extra = prop.extra || 6;
    const groups = variant === 2
      ? [
          { parts: cupolaParts(0, scale * 0.62, extra * 0.85), offset: -scale * 0.95 },
          { parts: cupolaParts(0, scale * 0.62, extra * 0.85), offset: scale * 0.95 },
        ]
      : [{ parts: cupolaParts(variant, scale, extra), offset: 0 }];
    for (const group of groups) {
      for (const geo of group.parts) {
        geo.translate(group.offset, 0, 0);
        geo.rotateY(prop.rot || 0);
        geo.translate(prop.x, prop.y, prop.z);
        geos.push(geo);
      }
    }
  }
  const merged = mergeGeometries(geos);
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, cupolaMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
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
    const treeN = Math.abs(Math.round(prop.x * 0.13 + prop.z * 0.07));
    if (kind === PROP.TREE) {
      dummy.rotation.set(((treeN % 5) - 2) * 0.05, (prop.rot || 0) + (treeN % 7) * 0.4, ((treeN % 3) - 1) * 0.06);
      dummy.scale.set(s * (0.55 + (treeN % 7) * 0.13), 0.58 + (treeN % 6) * 0.14, s * (0.55 + (treeN % 5) * 0.15));
    }
    else dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (kind === PROP.TREE) {
      color.setHex([0xffffff, 0xe4efc0, 0xb7c96e, 0x8eae58, 0xd5e2a4][treeN % 5]);
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
