import * as THREE from 'three';
import { cityUniforms } from './materials.js';

const SIZE = 2048;
// Light reaches POOL_REACH lamp heights out from the foot of a lamp.
const POOL_REACH = 2.6;

// The lamp quads live in a scene of their own: drawing the light map does not
// walk the city, and drawing the city does not walk the lamps.
export const lampScene = new THREE.Scene();
lampScene.matrixWorldAutoUpdate = false;

function glowTexture() {
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  const edge = (1 + POOL_REACH ** 2) ** -1.5;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const d = Math.hypot(i + 0.5 - N / 2, j + 0.5 - N / 2) / (N / 2);
      const v = d >= 1 ? 0 : Math.max(0, ((1 + (POOL_REACH * d) ** 2) ** -1.5 - edge) / (1 - edge));
      data.set([v * 255, v * 255, v * 255, 255], (j * N + i) * 4);
    }
  }
  const t = new THREE.DataTexture(data, N, N);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// A fan opening from the lamps (middle of the near edge) to the full width of
// the quad, brightest near the car.
function beamTexture() {
  const W = 128;
  const H = 128;
  const data = new Uint8Array(W * H * 4);
  const s = THREE.MathUtils.smoothstep;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const u = ((i + 0.5) / W) * 2 - 1;
      const v = (j + 0.5) / H;
      const side = 1 - s(Math.abs(u) / Math.max(v, 0.03), 0.3, 0.98);
      const reach = 1 - s(Math.hypot(u * 0.55, v), 0.55, 0.99);
      const value = side * reach * s(v, 0, 0.06) * (0.1 + 0.9 * Math.exp(-v * 3.4));
      data.set([value * 255, value * 255, value * 255, 255], (j * W + i) * 4);
    }
  }
  const t = new THREE.DataTexture(data, W, H);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function lampMaterial(map, params = {}) {
  return new THREE.MeshBasicMaterial({
    map, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true, forceSinglePass: true,
    blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    ...params,
  });
}

export const poolMaterial = lampMaterial(glowTexture());
export const beamMaterial = lampMaterial(beamTexture(), { vertexColors: true });

let poolGeo = null;
// One pool of light per street lamp, for a tile; the caller adds it to lampScene.
export function lampPools(lamps, lampHeight = 8) {
  if (!lamps.length) return null;
  poolGeo ??= new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(poolGeo, poolMaterial, lamps.length);
  mesh.userData.sharedGeo = true;
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4();
  const size = 2 * POOL_REACH * lampHeight;
  lamps.forEach((lamp, i) => {
    m.makeScale(size, 1, size).setPosition(lamp.x, lamp.y + 0.3, lamp.z);
    mesh.setMatrixAt(i, m);
  });
  mesh.updateMatrixWorld(true);
  return mesh;
}

// Headlamp and tail-lamp light on the road, in a car's frame (+x forward).
export function beamGeometry(length) {
  const g = new THREE.BufferGeometry();
  const pos = [];
  const uv = [];
  const col = [];
  const y = 0.14;
  const quad = (half, xNear, xFar, rgb) => {
    pos.push(xNear, y, half, xNear, y, -half, xFar, y, -half, xNear, y, half, xFar, y, -half, xFar, y, half);
    uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    for (let i = 0; i < 6; i++) col.push(...rgb);
  };
  quad(7.5, length / 2 - 0.3, length / 2 + 24, [1, 0.95, 0.84]);
  quad(3.2, -length / 2 + 0.3, -length / 2 - 6, [0.34, 0.02, 0.012]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export class LampLight {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(SIZE, SIZE, {
      type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
    this.camera.up.set(0, 0, -1);
    this.half = 0;
    this.black = new THREE.Color(0, 0, 0);
    this.streetLights = 1;
    this.headlights = 1;
    cityUniforms.uLampMap.value = this.target.texture;
  }

  // focus: what the view looks at; eye: the camera position.
  update(focus, eye, night) {
    cityUniforms.uLampOn.value = night > 0.02 ? 1 : 0;
    if (night <= 0.02) return;
    const k = night * this.streetLights;
    poolMaterial.color.setRGB(1.9 * k, 1.5 * k, 0.95 * k);
    beamMaterial.color.setScalar(0.36 * this.headlights * night);
    const want = THREE.MathUtils.clamp(eye.distanceTo(focus) * 1.6, 350, 2400);
    const half = 350 * 1.35 ** Math.ceil(Math.log(want / 350) / Math.log(1.35));
    const cam = this.camera;
    if (half !== this.half) {
      this.half = half;
      cam.left = cam.bottom = -half;
      cam.right = cam.top = half;
      cam.updateProjectionMatrix();
    }
    const texel = (2 * half) / SIZE;
    const cx = Math.round(focus.x / texel) * texel;
    const cz = Math.round(focus.z / texel) * texel;
    cam.position.set(cx, focus.y + 2000, cz);
    cam.lookAt(cx, focus.y, cz);
    cam.updateMatrixWorld();
    cityUniforms.uLampRect.value.set(cx, cz, half, 0);

    const r = this.renderer;
    const shadows = r.shadowMap.autoUpdate;
    const previous = r.getRenderTarget();
    const clear = r.getClearColor(new THREE.Color());
    const alpha = r.getClearAlpha();
    r.shadowMap.autoUpdate = false;
    r.setClearColor(this.black, 0);
    r.setRenderTarget(this.target);
    r.clear();
    r.render(lampScene, cam);
    r.setRenderTarget(previous);
    r.setClearColor(clear, alpha);
    r.shadowMap.autoUpdate = shadows;
  }
}
