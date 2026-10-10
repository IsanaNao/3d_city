import * as THREE from 'three';
import { cityUniforms } from './materials.js';

const SCALE = 0.5;
// Metres below the water level still drawn: the embankments stand a little into it.
const CLIP = 0.3;
// Water meshes live on this layer only, so the mirror camera never sees them.
export const WATER_LAYER = 1;

const _rot = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _plane = new THREE.Plane();
const _clip = new THREE.Plane();
const _v4 = new THREE.Vector4();
const _q = new THREE.Vector4();

export class WaterMirror {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.set(0);
    this.blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    this.blank.needsUpdate = true;
    cityUniforms.uMirror.value = this.blank;
    this.size = new THREE.Vector2();
    this.clear = new THREE.Color(0, 0, 0);
    this.enabled = true;
  }

  // y: the water level, or null when no water is in view.
  update(scene, camera, y) {
    if (!this.enabled || y == null) { cityUniforms.uMirrorOn.value = 0; return; }
    const r = this.renderer;
    r.getDrawingBufferSize(this.size).multiplyScalar(SCALE).floor();
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y);

    const cam = this.camera;
    const plane = _plane.set(_up, -y);
    _pos.setFromMatrixPosition(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot.extractRotation(camera.matrixWorld)).add(_pos);
    cam.position.set(_pos.x, 2 * y - _pos.y, _pos.z);
    cam.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_up);
    cam.lookAt(_look.x, 2 * y - _look.y, _look.z);
    cam.near = camera.near;
    cam.far = camera.far;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);
    cam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    // an oblique near plane: nothing below the water is drawn (Lengyel's method)
    _clip.copy(plane);
    _clip.constant += CLIP;
    _clip.applyMatrix4(cam.matrixWorldInverse);
    const p = cam.projectionMatrix.elements;
    const c = _v4.set(_clip.normal.x, _clip.normal.y, _clip.normal.z, _clip.constant);
    _q.x = (Math.sign(c.x) + p[8]) / p[0];
    _q.y = (Math.sign(c.y) + p[9]) / p[5];
    _q.z = -1;
    _q.w = (1 + p[10]) / p[14];
    c.multiplyScalar(2 / c.dot(_q));
    p[2] = c.x; p[6] = c.y; p[10] = c.z + 1; p[14] = c.w;

    cityUniforms.uMirrorMatrix.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const state = { target: r.getRenderTarget(), shadows: r.shadowMap.autoUpdate, clear: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha() };
    cityUniforms.uMirror.value = this.blank;
    cityUniforms.uMirrorOn.value = 0;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.target);
    r.setClearColor(this.clear, 0);
    r.clear();
    r.render(scene, cam);
    r.setRenderTarget(state.target);
    r.setClearColor(state.clear, state.alpha);
    r.shadowMap.autoUpdate = state.shadows;
    cityUniforms.uMirror.value = this.target.texture;
    cityUniforms.uMirrorOn.value = 1;
  }
}
