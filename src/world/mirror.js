import * as THREE from 'three';
import { cityUniforms } from './materials.js';

// Idle resolution. main.js lowers `scale` while the camera is moving; a lasting
// half-size target turned the towers into blocks.
const SCALE = 1;
// Drop the river bed. A world clip, not an oblique near plane: Lengyel's
// projection threw the skyline out of the mirror when the camera looked
// along the water.
const CLIP = 0.35;
// Water meshes live on this layer only, so the mirror camera never sees them.
export const WATER_LAYER = 1;
// Ground, roads and street furniture: drawn in the view, left out of the
// mirror, where they would sit below the water line or be a pixel wide.
export const DETAIL_LAYER = 3;
// Night keeps the view's horizontal field and opens the vertical one so the
// mirrored camera holds each tower from the waterline to its crown.
const NIGHT_Y_FOV = 118;

const _rot = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _waterClip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _clipList = [_waterClip];
const _bias = new THREE.Matrix4().set(
  0.5, 0.0, 0.0, 0.5,
  0.0, 0.5, 0.0, 0.5,
  0.0, 0.0, 0.5, 0.5,
  0.0, 0.0, 0.0, 1.0,
);
const _projView = new THREE.Matrix4();

export class WaterMirror {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.set(0);
    this.blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    this.blank.needsUpdate = true;
    cityUniforms.uMirror.value = this.blank;
    this.size = new THREE.Vector2();
    this.clear = new THREE.Color(0, 0, 0);
    this.enabled = true;
    this.scale = SCALE;
  }

  // y: the water level, or null when no water is in view.
  update(scene, camera, y) {
    if (!this.enabled || y == null) { cityUniforms.uMirrorOn.value = 0; return; }
    const r = this.renderer;
    r.getDrawingBufferSize(this.size).multiplyScalar(this.scale).floor();
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y);

    const cam = this.camera;
    _pos.setFromMatrixPosition(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot.extractRotation(camera.matrixWorld)).add(_pos);
    cam.position.set(_pos.x, 2 * y - _pos.y, _pos.z);
    cam.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_up);
    cam.lookAt(_look.x, 2 * y - _look.y, _look.z);
    cam.near = camera.near;
    cam.far = camera.far;
    cam.aspect = camera.aspect;
    cam.fov = camera.fov;
    cam.updateProjectionMatrix();
    const night = cityUniforms.uDark.value > 0.5;
    if (night) {
      cam.projectionMatrix.elements[5] = 1 / Math.tan(THREE.MathUtils.degToRad(NIGHT_Y_FOV) * 0.5);
    }
    cam.updateMatrixWorld();

    // Bias is folded in before anything else, matching Reflector. The clip
    // plane does not touch this matrix, so the sample has no oblique seam.
    _projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    cityUniforms.uMirrorMatrix.value.multiplyMatrices(_bias, _projView);

    const state = {
      target: r.getRenderTarget(),
      shadows: r.shadowMap.autoUpdate,
      clear: r.getClearColor(new THREE.Color()),
      alpha: r.getClearAlpha(),
      planes: r.clippingPlanes,
    };
    cityUniforms.uMirror.value = this.blank;
    cityUniforms.uMirrorOn.value = 0;
    _waterClip.normal.set(0, 1, 0);
    _waterClip.constant = -(y - CLIP);
    r.clippingPlanes = _clipList;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.target);
    r.setClearColor(this.clear, 0);
    r.clear();
    r.render(scene, cam);
    r.setRenderTarget(state.target);
    r.setClearColor(state.clear, state.alpha);
    r.shadowMap.autoUpdate = state.shadows;
    r.clippingPlanes = state.planes;
    cityUniforms.uMirror.value = this.target.texture;
    cityUniforms.uMirrorOn.value = 1;
  }
}
