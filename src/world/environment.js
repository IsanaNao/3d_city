import * as THREE from 'three';
import { cityUniforms, createSkyMaterial } from './materials.js';

const SHADOW_SIZE = 4096;
const SUN = 3.4;
const EXPOSURE = { target: 1.25, least: 0.5, most: 1.55 };
const BLOOM = { day: 0.36, night: 1.2 };
const DAYLIGHT = new THREE.Vector3(0.9, 1, 1.12);
const MOON = { strength: 0.32, color: new THREE.Color(0x9fb4e0) };
const GLOW = { strength: 0.5, sky: new THREE.Color(0xe6eaf4), ground: new THREE.Color(0x8a8172) };
const MOON_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(50), THREE.MathUtils.degToRad(205));
// Optical depth of one air mass, per channel: Rayleigh plus a little aerosol.
const TAU = [0.115, 0.205, 0.43];

const SKY = {
  zenith: new THREE.Color().setRGB(0.17, 0.33, 0.62),
  horizon: new THREE.Color().setRGB(0.68, 0.76, 0.85),
  setZenith: new THREE.Color().setRGB(0.09, 0.12, 0.26),
  setHorizon: new THREE.Color().setRGB(1.05, 0.5, 0.24),
  nightZenith: new THREE.Color().setRGB(0.004, 0.006, 0.016),
  nightHorizon: new THREE.Color().setRGB(0.05, 0.04, 0.045),
};
export const FOG = {
  day: new THREE.Color(0.66, 0.73, 0.84),
  warm: new THREE.Color(1.0, 0.6, 0.38),
  night: new THREE.Color(0.035, 0.04, 0.055),
};

const step = THREE.MathUtils.smoothstep;
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

function airMass(deg) {
  return 1 / (Math.sin(Math.max(deg, -1) * Math.PI / 180) + 0.50572 * Math.pow(Math.max(deg + 6.07995, 0.01), -1.6364));
}

// Patched before any material compiles: the sky's environment map only gives
// reflections; the even light of the sky comes from the hemisphere lights.
export function installSkyLight() {
  THREE.ShaderChunk.envmap_physical_pars_fragment = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
    'return PI * envMapColor.rgb * envMapIntensity;', 'return vec3( 0.0 );');
}

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.night = 0;
    this.dark = 0;
    this.daylight = 1;
    this.warmth = 0;
    this.elevation = 40;
    this.exposure = 1;
    this.bloom = BLOOM.day;
    this.balance = new THREE.Vector3(1, 1, 1);
    this.sunDir = new THREE.Vector3(0.3, 0.8, 0.5).normalize();
    this.sunColor = new THREE.Color();
    this.fogColor = new THREE.Color();

    this.sun = new THREE.DirectionalLight(0xffffff, SUN);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 4000;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.5;
    this.sun.shadow.radius = 5;
    this.shadowExtent = 0;
    this.sky = new THREE.HemisphereLight(0x000000, 0x000000, 1);
    this.bounce = new THREE.HemisphereLight(0x000000, 0x000000, 1);
    this.glow = new THREE.HemisphereLight(GLOW.sky, GLOW.ground, 0);
    scene.add(this.sun, this.sun.target, this.sky, this.bounce, this.glow);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), createSkyMaterial({ sunDisc: 0, ground: true }));
    this.envScene.add(envSky);
    this.bakedSun = new THREE.Vector3();
    this.baked = -1;
    this.bakedAt = 0;
  }

  // sun: unit vector towards the sun in world space.
  setSun(sun) {
    const deg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(sun.y, -1, 1)));
    this.elevation = deg;
    this.night = 1 - step(deg, 0, 9);
    this.dark = 1 - step(deg, -13, 5);
    this.daylight = step(deg, -5, 9);
    this.warmth = 1 - step(deg, 3, 24);
    const moonlight = 1 - step(deg, -14, -5.5);
    const sunUp = deg > -5.5;

    const m = airMass(deg);
    this.sunColor.setRGB(Math.exp(-TAU[0] * m), Math.exp(-TAU[1] * m), Math.exp(-TAU[2] * m)).multiplyScalar(step(deg, -4, 1));
    if (sunUp) {
      this.sunDir.copy(sun).setY(Math.max(sun.y, 0.06)).normalize();
      this.sun.color.copy(this.sunColor);
      this.sun.intensity = SUN;
    } else {
      this.sunDir.copy(MOON_DIR);
      this.sun.color.copy(MOON.color);
      this.sun.intensity = MOON.strength * moonlight;
    }

    // The sky's light: blue from above, its strength following the sun down through twilight.
    const skyK = 0.95 * step(deg, -10, 22) + 0.05 * step(deg, -14, -2);
    const zen = SKY.zenith.clone().lerp(SKY.setZenith, this.warmth * 0.7);
    const hor = SKY.horizon.clone().lerp(SKY.setHorizon, this.warmth * (1 - this.dark * 0.6));
    this.sky.color.copy(zen).lerp(hor, 0.35).multiplyScalar(skyK * 1.15);
    this.sky.groundColor.copy(hor).multiplyScalar(skyK * 0.4);
    // Sunlight sent on by the city: most of it reaches what faces down and sideways.
    const sent = sunUp ? 0.3 * SUN * Math.max(sun.y, 0) * 2.5 : 0;
    this.bounce.groundColor.copy(this.sunColor).multiplyScalar(0.8 * sent * 0.3);
    this.bounce.color.copy(this.sunColor).multiplyScalar(0.2 * sent * 0.3);
    this.glow.intensity = GLOW.strength * this.dark;

    const zenith = SKY.zenith.clone().lerp(SKY.setZenith, this.warmth).lerp(SKY.nightZenith, this.dark);
    const horizon = SKY.horizon.clone().lerp(SKY.setHorizon, this.warmth * (1 - this.dark * 0.5)).lerp(SKY.nightHorizon, this.dark);
    cityUniforms.uSky.value.copy(zenith);
    cityUniforms.uHorizon.value.copy(horizon);
    cityUniforms.uSunDir.value.copy(sun);
    cityUniforms.uSunGlint.value.copy(this.sunColor).multiplyScalar(SUN * 0.9 * (sunUp ? 1 : 0));
    cityUniforms.uNight.value = this.night;
    cityUniforms.uDark.value = this.dark;
    cityUniforms.uDay.value = this.daylight;

    this.fogColor.copy(FOG.day).lerp(FOG.warm, this.warmth * this.daylight * (1 - this.dark)).lerp(FOG.night, this.dark);

    const light = 0.3 * lum(this.sun.color) * this.sun.intensity * Math.max(this.sunDir.y, 0.05)
      + 1.8 * lum(this.sky.color) + 1.3 * this.dark ** 3;
    this.exposure = THREE.MathUtils.clamp(EXPOSURE.target / Math.max(light, 1e-3), EXPOSURE.least, EXPOSURE.most);
    this.bloom = BLOOM.day + (BLOOM.night - BLOOM.day) * this.dark;
    this.balance.set(1, 1, 1).lerp(DAYLIGHT, this.daylight);

    const now = performance.now();
    if (now - this.bakedAt > 200 && (this.baked < 0 || sun.angleTo(this.bakedSun) > 0.006 || Math.abs(this.dark - this.baked) > 0.04)) {
      this.bakedAt = now;
      this.baked = this.dark;
      this.bakedSun.copy(sun);
      const old = this.scene.environment;
      this.scene.environment = this.pmrem.fromScene(this.envScene, 0, 0.1, 10).texture;
      old?.dispose();
    }
  }

  // The shadow frustum follows the focus in coarse steps, snapped to texels so shadows do not shimmer.
  follow(focus, camera) {
    const want = THREE.MathUtils.clamp(camera.position.distanceTo(focus) * 1.1, 220, 1800);
    const extent = 220 * 1.3 ** Math.ceil(Math.log(want / 220) / Math.log(1.3));
    const c = this.sun.shadow.camera;
    if (extent !== this.shadowExtent) {
      this.shadowExtent = extent;
      c.left = c.bottom = -extent;
      c.right = c.top = extent;
      c.updateProjectionMatrix();
      this.sun.shadow.normalBias = 0.25 + extent / 900;
    }
    const texel = (2 * extent) / SHADOW_SIZE;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 2000);
  }
}
