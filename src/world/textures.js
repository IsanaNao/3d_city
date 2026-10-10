import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { FACADE_LAYERS, GROUND_LAYERS, WALL_LAYERS, textureFiles } from '../shared/textures.js';

// CC0 photo textures (see src/shared/textures.js). Until they load, or when they were
// never fetched, the shaders keep their procedural surfaces: uPhotoOn stays 0.
function placeholder() {
  const tex = new THREE.DataArrayTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, 1);
  tex.needsUpdate = true;
  return tex;
}

const vec3s = (n) => Array.from({ length: n }, () => new THREE.Vector3(1, 1, 1));
const vec2s = (n) => Array.from({ length: n }, () => new THREE.Vector2(0.5, 0.5));

export const photoUniforms = {
  uPhotoOn: { value: 0 },
  uWallAlb: { value: placeholder() },
  uWallNor: { value: placeholder() },
  uGroundAlb: { value: placeholder() },
  uGroundNor: { value: placeholder() },
  uFacade: { value: placeholder() },
  uWallMean: { value: vec3s(WALL_LAYERS.length) },
  uWallScale: { value: vec2s(WALL_LAYERS.length) },
  uGroundMean: { value: vec3s(GROUND_LAYERS.length) },
  uGroundScale: { value: vec2s(GROUND_LAYERS.length) },
  uFacadeMean: { value: vec3s(FACADE_LAYERS.length) },
};

function fill(list, layers, meanU, scaleU) {
  if (!list || list.length !== layers.length || list.some((l, i) => l.key !== layers[i].key)) {
    throw new Error('texture manifest does not match the catalog; rerun npm run textures');
  }
  list.forEach((l, i) => {
    meanU.value[i].fromArray(l.mean);
    if (scaleU) scaleU.value[i].set(1 / l.metres[0], 1 / l.metres[1]);
  });
}

export async function loadPhotoTextures(renderer, base) {
  const dir = `${base}textures/`;
  const res = await fetch(`${dir}${textureFiles.manifest}`);
  if (!res.ok) return false;
  const manifest = await res.json().catch(() => null);
  if (!manifest) return false;
  fill(manifest.wall, WALL_LAYERS, photoUniforms.uWallMean, photoUniforms.uWallScale);
  fill(manifest.ground, GROUND_LAYERS, photoUniforms.uGroundMean, photoUniforms.uGroundScale);
  fill(manifest.facade, FACADE_LAYERS, photoUniforms.uFacadeMean, null);

  const loader = new KTX2Loader().setTranscoderPath(`${dir}basis/`).detectSupport(renderer);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = async (file) => {
    const tex = await loader.loadAsync(`${dir}${file}`);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = anisotropy;
    tex.needsUpdate = true;
    return tex;
  };
  const [wallAlb, wallNor, groundAlb, groundNor, facade] = await Promise.all([
    load(textureFiles.wallAlbedo), load(textureFiles.wallNormal),
    load(textureFiles.groundAlbedo), load(textureFiles.groundNormal), load(textureFiles.facade),
  ]);
  loader.dispose();
  photoUniforms.uWallAlb.value = wallAlb;
  photoUniforms.uWallNor.value = wallNor;
  photoUniforms.uGroundAlb.value = groundAlb;
  photoUniforms.uGroundNor.value = groundNor;
  photoUniforms.uFacade.value = facade;
  for (const tex of [wallAlb, wallNor, groundAlb, groundNor, facade]) renderer.initTexture(tex);
  photoUniforms.uPhotoOn.value = 1;
  return true;
}
