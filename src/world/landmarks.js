import * as THREE from 'three';
import { cityUniforms } from './materials.js';
import { photoUniforms } from './textures.js';
import { WALL_LAYERS } from '../shared/textures.js';
import { CROWN_RGB, SCHEME_RGB, pearlShow } from '../shared/show.js';

// Self-made stand-ins for towers an extruded footprint cannot describe.
// Oriental Pearl: three splayed columns, two pink spheres, a spire.
// Shanghai Tower: a rounded triangle that twists as it rises.
// SWFC: a tapering slab with the aperture near the top.
// Jin Mao: pagoda setbacks. Customs House: the 1927 granite block and stepped clock tower.

const steel = new THREE.MeshStandardMaterial({ color: 0xd5d9de, metalness: 0.72, roughness: 0.34 });
const dark = new THREE.MeshStandardMaterial({ color: 0x3a4148, metalness: 0.45, roughness: 0.5 });
// Rose-silver glass. The shell is closed; mullions and the night cells are paint.
// Sky reflection is added here because the shared env-map term is disabled.
const pearlMat = new THREE.MeshStandardMaterial({
  color: 0xc42a48, metalness: 0.46, roughness: 0.22,
  emissive: new THREE.Color(0x000000), emissiveIntensity: 0,
  transparent: false, opacity: 1, depthWrite: true, side: THREE.FrontSide,
});
pearlMat.onBeforeCompile = (shader) => {
  shader.uniforms.uNight = cityUniforms.uNight;
  shader.uniforms.uSky = cityUniforms.uSky;
  shader.uniforms.uHorizon = cityUniforms.uHorizon;
  shader.uniforms.uSkyGain = cityUniforms.uSkyGain;
  shader.uniforms.uSunDir = cityUniforms.uSunDir;
  shader.uniforms.uSunGlint = cityUniforms.uSunGlint;
  shader.uniforms.uShowScheme = cityUniforms.uShowScheme;
  shader.uniforms.uShowNext = cityUniforms.uShowNext;
  shader.uniforms.uShowFade = cityUniforms.uShowFade;
  shader.uniforms.uShowPhase = cityUniforms.uShowPhase;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aLat;\nattribute vec2 aGrid;\nvarying vec2 vPane;\nvarying float vLat;\nvarying vec2 vGrid;\nvarying vec3 vPearlN;\nvarying vec3 vPearlW;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vPane = uv;
      vLat = aLat;
      vGrid = aGrid;
      vPearlN = normalize(mat3(modelMatrix) * objectNormal);
      vPearlW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uNight;
      uniform float uSkyGain;
      uniform vec3 uSky;
      uniform vec3 uHorizon;
      uniform vec3 uSunDir;
      uniform vec3 uSunGlint;
      uniform float uShowScheme;
      uniform float uShowNext;
      uniform float uShowFade;
      uniform float uShowPhase;
      vec3 pearlHue(float h) {
        return clamp(abs(fract(h + vec3(0.0, 0.6666667, 0.3333333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
      }
      vec3 schemeColor(float id, float lat, float lon) {
        float i = mod(id, 7.0);
        if (i < 0.5) return vec3(1.0, 0.05, 0.10);
        if (i < 1.5) return vec3(1.0, 0.06, 0.52);
        if (i < 2.5) return vec3(0.15, 0.45, 1.0);
        if (i < 3.5) return vec3(0.55, 0.16, 1.0);
        if (i < 4.5) return vec3(1.0, 0.72, 0.22);
        if (i < 5.5) return vec3(0.15, 0.95, 0.35);
        return pearlHue(fract(lat * 1.7 + lon * 0.35 + uShowPhase));
      }
      vec3 showColor(float lat, float lon) {
        return mix(schemeColor(uShowScheme, lat, lon), schemeColor(uShowNext, lat, lon), uShowFade);
      }
      varying vec2 vPane;
      varying float vLat;
      varying vec2 vGrid;
      varying vec3 vPearlN;
      varying vec3 vPearlW;`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      vec2 pane = fract(vPane * max(vGrid, vec2(1.0)));
      float edge = min(min(pane.x, 1.0 - pane.x), min(pane.y, 1.0 - pane.y));
      float glass = smoothstep(0.0025, 0.009, edge);
      float panelId = dot(floor(vPane * max(vGrid, vec2(1.0))), vec2(1.0, 17.0));
      float hash = fract(sin(panelId * 12.9898) * 43758.5453);
      float vary = 0.88 + 0.2 * hash;
      float bottom = smoothstep(0.28, 0.92, vLat);
      vec3 rose = vec3(0.74, 0.08, 0.16) * vary * mix(1.15, 0.48, bottom);
      diffuseColor.rgb = mix(vec3(0.28, 0.22, 0.24), rose, glass);
      roughnessFactor = mix(0.52, 0.28 + 0.14 * hash, glass);
      metalnessFactor = mix(0.16, 0.4, glass);
      vec3 show = showColor(vLat, pane.x);
      diffuseColor.rgb = mix(diffuseColor.rgb, show * 0.28, uNight);
      float belt = max(
        smoothstep(0.46, 0.485, vLat) * (1.0 - smoothstep(0.515, 0.54, vLat)),
        max(
          smoothstep(0.30, 0.325, vLat) * (1.0 - smoothstep(0.345, 0.37, vLat)),
          smoothstep(0.63, 0.655, vLat) * (1.0 - smoothstep(0.675, 0.70, vLat))
        )
      );
      float sweep = smoothstep(0.46, 0.04, abs(fract(vLat * 2.4 + pane.x * 0.2 - uShowPhase) - 0.5));
      vec3 glow = show * mix(0.62, 1.15, vary) * mix(1.05, 0.78, bottom);
      glow = mix(glow, min(show * 1.45, vec3(1.2)), max(belt, sweep * 0.6));
      totalEmissiveRadiance += glow * mix(0.3, 1.0, glass) * uNight;
      vec2 micro = fract(pane * vec2(3.0, 3.0));
      vec2 cell = abs(micro - 0.5);
      float dotCore = smoothstep(0.11, 0.015, max(cell.x, cell.y));
      float pulse = 0.65 + 0.35 * sin(uShowPhase * 12.566 + panelId * 0.05);
      totalEmissiveRadiance += min(show + vec3(0.4), vec3(1.35)) * glass * dotCore * pulse * uNight * 0.85;
      vec3 N = normalize(vPearlN);
      vec3 V = normalize(cameraPosition - vPearlW);
      vec3 R = reflect(-V, N);
      float up = clamp(R.y, -1.0, 1.0);
      vec3 skyRef = mix(uHorizon, uSky, pow(clamp(up, 0.0, 1.0), 0.55)) * uSkyGain * 0.55;
      vec3 cityRef = mix(vec3(0.42, 0.36, 0.30), vec3(0.12, 0.11, 0.12), pow(clamp(-up, 0.0, 1.0), 0.65));
      float cityWin = step(0.86, fract(sin(dot(R.xz, vec2(27.1, 49.7))) * 913.1));
      cityRef += vec3(0.7, 0.55, 0.32) * cityWin * 0.35 * clamp(-up, 0.0, 1.0);
      vec3 envRef = mix(cityRef, skyRef, smoothstep(-0.2, 0.28, up));
      float fres = pow(1.0 - max(dot(V, N), 0.0), 2.1);
      float day = 1.0 - uNight;
      totalEmissiveRadiance += envRef * glass * day * (0.16 + 0.14 * hash) * (0.4 + 0.28 * fres);
    `)
    .replace('#include <opaque_fragment>', `reflectedLight.directSpecular *= 0.18;
      reflectedLight.indirectSpecular *= 0.32;
      #include <opaque_fragment>`);
};
pearlMat.customProgramCacheKey = () => 'lm-pearl-rose-9';
const pearlBand = new THREE.MeshStandardMaterial({
  color: 0xf4f1ea, metalness: 0.35, roughness: 0.32,
  emissive: new THREE.Color(0xffe2b0), emissiveIntensity: 0,
});
const columnMat = new THREE.MeshStandardMaterial({
  color: 0xe4e7ea, metalness: 0.18, roughness: 0.52,
  emissive: new THREE.Color(0xff8a28), emissiveIntensity: 0,
});
columnMat.onBeforeCompile = (shader) => {
  shader.uniforms.uNight = cityUniforms.uNight;
  shader.uniforms.uShowScheme = cityUniforms.uShowScheme;
  shader.uniforms.uShowNext = cityUniforms.uShowNext;
  shader.uniforms.uShowFade = cityUniforms.uShowFade;
  shader.uniforms.uShowPhase = cityUniforms.uShowPhase;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vColUv;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvColUv = uv;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uNight;
      uniform float uShowScheme;
      uniform float uShowNext;
      uniform float uShowFade;
      uniform float uShowPhase;
      varying vec2 vColUv;
      vec3 pearlHue(float h) {
        return clamp(abs(fract(h + vec3(0.0, 0.6666667, 0.3333333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
      }
      vec3 schemeColor(float id, float lat, float lon) {
        float i = mod(id, 7.0);
        if (i < 0.5) return vec3(1.0, 0.05, 0.10);
        if (i < 1.5) return vec3(1.0, 0.06, 0.52);
        if (i < 2.5) return vec3(0.15, 0.45, 1.0);
        if (i < 3.5) return vec3(0.55, 0.16, 1.0);
        if (i < 4.5) return vec3(1.0, 0.72, 0.22);
        if (i < 5.5) return vec3(0.15, 0.95, 0.35);
        return pearlHue(fract(lat * 1.7 + lon * 0.35 + uShowPhase));
      }
      vec3 showColor(float lat, float lon) {
        return mix(schemeColor(uShowScheme, lat, lon), schemeColor(uShowNext, lat, lon), uShowFade);
      }`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float band = smoothstep(0.62, 0.82, fract(vColUv.y * 11.0));
      vec3 show = showColor(vColUv.y, vColUv.x);
      vec3 warm = mix(vec3(1.0, 0.78, 0.42), show, 0.82);
      warm = mix(warm, min(show * 1.25, vec3(1.2)), band);
      totalEmissiveRadiance += warm * uNight * (0.9 + band * 0.65);
    `);
};
columnMat.customProgramCacheKey = () => 'lm-pearl-column-5';
const legMat = new THREE.MeshStandardMaterial({
  color: 0xe0ddd6, metalness: 0.16, roughness: 0.58,
  emissive: new THREE.Color(0xff1c18), emissiveIntensity: 0,
});
const shanghaiCrownMat = new THREE.MeshStandardMaterial({
  color: 0x9eb4c6, metalness: 0.62, roughness: 0.16,
  emissive: new THREE.Color(0x3aa0ff), emissiveIntensity: 0,
});
const swfcEdgeMat = new THREE.MeshStandardMaterial({
  color: 0xc5ced6, metalness: 0.72, roughness: 0.32,
  emissive: new THREE.Color(0xd8e4ee), emissiveIntensity: 0,
  side: THREE.DoubleSide,
});
swfcEdgeMat.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vEdgeL;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdgeL = position;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vEdgeL;')
    .replace('#include <color_fragment>', `#include <color_fragment>
      vec2 ep = abs(vEdgeL.y) > max(abs(vEdgeL.x), abs(vEdgeL.z))
        ? vEdgeL.xz : vec2(abs(vEdgeL.x) > abs(vEdgeL.z) ? vEdgeL.z : vEdgeL.x, vEdgeL.y);
      vec2 cell = ep / vec2(1.7, 2.4);
      vec2 f = fract(cell);
      vec2 fw = max(fwidth(cell), vec2(1e-3));
      float seam = 1.0 - smoothstep(0.04, 0.1, min(min(f.x, 1.0 - f.x) / fw.x, min(f.y, 1.0 - f.y) / fw.y));
      float grain = fract(sin(dot(floor(cell), vec2(12.7, 3.1))) * 43758.5);
      vec3 silver = vec3(0.62, 0.66, 0.7) * (0.86 + 0.2 * grain);
      diffuseColor.rgb = mix(silver, silver * 0.45, clamp(seam, 0.0, 1.0));
    `);
};
swfcEdgeMat.customProgramCacheKey = () => 'lm-swfc-edge-2';
const beaconMat = new THREE.MeshStandardMaterial({
  color: 0xff3030, emissive: new THREE.Color(0xff2020), emissiveIntensity: 0.4,
});
const clockMat = new THREE.MeshStandardMaterial({
  color: 0xf4efe4, emissive: new THREE.Color(0xffe2a8), emissiveIntensity: 0,
});

function glassMaterial(hex) {
  const mat = new THREE.MeshStandardMaterial({ color: hex, metalness: 0.62, roughness: 0.16 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = cityUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLm = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying vec3 vLm;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fy = vLm.y / 4.15;
        float row = floor(fy);
        float pane = smoothstep(0.16, 0.26, fract(fy)) * (1.0 - smoothstep(0.78, 0.9, fract(fy)));
        float on = step(0.55, fract(sin(row * 17.13 + floor(vLm.x * 0.15) * 3.1) * 43758.5));
        totalEmissiveRadiance += vec3(1.0, 0.78, 0.48) * pane * on * uNight * 1.15;
      `);
  };
  mat.customProgramCacheKey = () => `lm-glass-${hex}`;
  return mat;
}

const glassBlue = glassMaterial(0x9eb4c6);
const glassSilver = glassMaterial(0xb7c3ce);
glassBlue.side = THREE.DoubleSide;
glassSilver.side = THREE.DoubleSide;
const swfcGlass = new THREE.MeshStandardMaterial({
  color: 0x8ea4b8, metalness: 0.78, roughness: 0.16, side: THREE.DoubleSide,
});
swfcGlass.onBeforeCompile = (shader) => {
  shader.uniforms.uNight = cityUniforms.uNight;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vSwfcL;\nvarying vec3 vSwfcN;\nvarying vec3 vSwfcW;\nvarying vec3 vSwfcNw;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vSwfcL = position;
      vSwfcN = normal;
      vSwfcW = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vSwfcNw = normalize(mat3(modelMatrix) * normal);`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uNight;
      varying vec3 vSwfcL;
      varying vec3 vSwfcN;
      varying vec3 vSwfcW;
      varying vec3 vSwfcNw;`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      float along = abs(vSwfcN.z) > abs(vSwfcN.x) ? vSwfcL.x : vSwfcL.z;
      if (abs(vSwfcN.y) > 0.65) along = vSwfcL.x;
      vec2 cell = vec2(along / 3.2, vSwfcL.y / 4.2);
      vec2 f = fract(cell);
      vec2 fw = max(fwidth(cell), vec2(0.002));
      float gap = min(min(f.x, 1.0 - f.x) / fw.x, min(f.y, 1.0 - f.y) / fw.y);
      float mullion = 1.0 - smoothstep(0.55, 1.6, gap);
      vec3 pane = vec3(0.2, 0.3, 0.4);
      vec3 bar = vec3(0.72, 0.76, 0.8);
      vec3 V = normalize(cameraPosition - vSwfcW);
      float fres = pow(1.0 - max(dot(normalize(vSwfcNw), V), 0.0), 2.4);
      vec3 sky = mix(vec3(0.45, 0.55, 0.66), vec3(0.78, 0.84, 0.9), fres);
      pane = mix(pane, sky, 0.28 + 0.45 * fres);
      diffuseColor.rgb = mix(pane, bar, mullion * 0.82);
    `)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float alongE = abs(vSwfcN.z) > abs(vSwfcN.x) ? vSwfcL.x : vSwfcL.z;
      float colE = floor(alongE / 3.2);
      float rowE = floor(vSwfcL.y / 4.2);
      float paneE = smoothstep(0.08, 0.16, min(min(fract(alongE / 3.2), 1.0 - fract(alongE / 3.2)), min(fract(vSwfcL.y / 4.2), 1.0 - fract(vSwfcL.y / 4.2))));
      float onE = step(0.58, fract(sin(rowE * 12.9 + colE * 7.1) * 43758.5));
      totalEmissiveRadiance += vec3(1.0, 0.78, 0.46) * paneE * onE * uNight * 0.42;
    `);
};
swfcGlass.customProgramCacheKey = () => 'lm-swfc-glass-3';

function add(group, geo, mat) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  geo.computeBoundingSphere();
  group.add(mesh);
  return mesh;
}

function tag(mesh, part, angle) {
  mesh.userData.part = part;
  if (angle != null) mesh.userData.angle = angle;
  return mesh;
}

// A closed glass shell. latN and lonN only divide the painted mullion grid.
function paneledSphere(group, radius, centerY, latN, lonN, mat, part) {
  const geo = new THREE.SphereGeometry(radius, lonN * 2, latN * 2);
  geo.translate(0, centerY, 0);
  const uv = geo.getAttribute('uv');
  const lat = new Float32Array(uv.count);
  const grid = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i++) {
    lat[i] = 1 - uv.getY(i);
    grid[i * 2] = lonN;
    grid[i * 2 + 1] = latN;
  }
  geo.setAttribute('aLat', new THREE.Float32BufferAttribute(lat, 1));
  geo.setAttribute('aGrid', new THREE.Float32BufferAttribute(grid, 2));
  return tag(add(group, geo, mat), part);
}

function sphereRing(group, radius, centerY, dy, tube) {
  const ringR = Math.sqrt(Math.max(0.4, radius * radius - dy * dy));
  const geo = new THREE.TorusGeometry(ringR + tube * 0.25, tube, 6, 42);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, centerY + dy, 0);
  add(group, geo, pearlBand);
}

const concrete = new THREE.MeshStandardMaterial({ color: 0xc3ccd4, metalness: 0.35, roughness: 0.48 });

// Published figures for the 468 m tower, scaled if a different height is passed in.
// Lower sphere Ø50 m at 93 m, upper Ø45 m at 272.5 m, space capsule Ø16 m at 342 m.
// Three 9 m columns link the large spheres; three splayed legs carry them from the ground.
function pearlMeasures(h) {
  const s = h / 468;
  return {
    s,
    lowerC: 93 * s,
    lowerR: 25 * s,
    upperC: 272.5 * s,
    upperR: 22.5 * s,
    capsuleC: 342 * s,
    capsuleR: 8 * s,
    legR: 5.6 * s,
    shaftR: 4.5 * s,
    foot: 40 * s,
    plinth: 5.45 * s,
  };
}

function along(angle, radius, y) {
  return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
}

function tube(group, points, radius, mat, part, angle) {
  const curve = points.length === 2
    ? new THREE.LineCurve3(points[0], points[1])
    : new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, Math.max(2, (points.length - 1) * 6), radius, 12, false);
  return tag(add(group, geo, mat), part, angle);
}

const beamMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  uniforms: {
    uNight: cityUniforms.uNight,
    uColor: { value: new THREE.Color(1, 0.15, 0.25) },
  },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = uv;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `,
  fragmentShader: `
    uniform float uNight;
    uniform vec3 uColor;
    varying vec2 vUv;
    varying vec3 vWorld;
    void main() {
      float along = vUv.y;
      float across = abs(fract(vUv.x) - 0.5) * 2.0;
      float core = exp(-across * across * 7.0);
      float fade = smoothstep(0.0, 0.04, along) * (1.0 - smoothstep(0.15, 0.92, along));
      float dist = distance(cameraPosition, vWorld);
      float far = smoothstep(80.0, 1400.0, dist);
      float a = core * fade * uNight * mix(0.16, 0.045, far);
      if (a < 0.008) discard;
      gl_FragColor = vec4(uColor, a);
    }
  `,
});

function pearl(h) {
  const g = new THREE.Group();
  const m = pearlMeasures(h);
  // One leg toward the usual southeast view, so the tripod reads in the close camera.
  const angles = [0, 1, 2].map((k) => (k / 3) * Math.PI * 2 + 0.85);
  const bury = (point, toward, radius) => point.clone().lerp(toward, radius / point.distanceTo(toward));

  for (const angle of angles) {
    const foot = along(angle, m.foot, m.plinth);
    const socket = along(angle, 15 * m.s, m.lowerC - 6 * m.s);
    const knee = foot.clone().lerp(socket, 0.45);
    knee.add(along(angle, 7 * m.s, 0));
    const legEnd = bury(socket, along(angle, 12 * m.s, m.lowerC), m.legR);
    tube(g, [foot, knee, legEnd], m.legR, legMat, 'leg', angle);

    const pod = foot.clone().lerp(legEnd, 0.42);
    const podMesh = paneledSphere(g, 6.2 * m.s, 0, 12, 20, pearlMat, 'pod');
    podMesh.position.set(pod.x, pod.y, pod.z);

    const emerge = along(angle, 15 * m.s, m.lowerC + 8 * m.s);
    const arrive = along(angle, 10 * m.s, m.upperC);
    const shaftEnd = bury(arrive, along(angle, 8 * m.s, m.upperC + m.upperR), m.shaftR);
    tube(g, [emerge, shaftEnd], m.shaftR, columnMat, 'shaft', angle);
  }

  // Five 12 m spheres and the rings that tie the three columns together.
  const beads = [0.28, 0.28, 0.28, 0.62, 0.62];
  beads.forEach((t, i) => {
    const angle = angles[i % 3] + (i >= 3 ? 0.22 : 0);
    const y = m.lowerC + m.lowerR + (m.upperC - m.upperR - (m.lowerC + m.lowerR)) * t;
    const radial = (15 - 5 * t) * m.s;
    const bead = paneledSphere(g, 6 * m.s, 0, 10, 16, pearlMat, 'bead');
    bead.position.set(Math.cos(angle) * radial, y, Math.sin(angle) * radial);
    bead.userData.angle = angle;
  });
  for (const t of [0.22, 0.42, 0.62, 0.82]) {
    const y = m.lowerC + m.lowerR + (m.upperC - m.upperR - (m.lowerC + m.lowerR)) * t;
    const radial = (16 - 6 * t) * m.s;
    const ring = angles.map((angle) => along(angle, radial, y));
    for (let i = 0; i < ring.length; i++) tube(g, [ring[i], ring[(i + 1) % ring.length]], 1.15 * m.s, columnMat, 'brace');
  }
  for (const t of [0.28, 0.62]) {
    const y = 4 + (m.lowerC - m.lowerR) * t;
    const radial = m.foot * (1 - t * 0.72);
    const ring = angles.map((angle) => along(angle, radial, y));
    for (let i = 0; i < ring.length; i++) tube(g, [ring[i], ring[(i + 1) % ring.length]], 1.3 * m.s, columnMat, 'brace');
  }

  paneledSphere(g, m.lowerR, m.lowerC, 42, 84, pearlMat, 'lower-sphere');
  sphereRing(g, m.lowerR, m.lowerC, 0, 0.95 * m.s);
  sphereRing(g, m.lowerR, m.lowerC, m.lowerR * 0.42, 0.32 * m.s);
  sphereRing(g, m.lowerR, m.lowerC, -m.lowerR * 0.42, 0.32 * m.s);
  paneledSphere(g, m.upperR, m.upperC, 36, 72, pearlMat, 'upper-sphere');
  sphereRing(g, m.upperR, m.upperC, 0, 0.82 * m.s);
  sphereRing(g, m.upperR, m.upperC, m.upperR * 0.4, 0.28 * m.s);
  sphereRing(g, m.upperR, m.upperC, -m.upperR * 0.4, 0.28 * m.s);

  tube(g, [along(0, 0, m.upperC + m.upperR * 0.35), along(0, 0, m.capsuleC + m.capsuleR * 0.4)], 2.4 * m.s, columnMat, 'mast');
  paneledSphere(g, m.capsuleR, m.capsuleC, 14, 24, pearlMat, 'capsule');
  sphereRing(g, m.capsuleR, m.capsuleC, 0, 0.55 * m.s);
  const antennaH = h - (m.capsuleC + m.capsuleR);
  const antenna = new THREE.CylinderGeometry(0.22 * m.s, 1.15 * m.s, antennaH, 8);
  antenna.translate(0, m.capsuleC + m.capsuleR + antennaH / 2, 0);
  tag(add(g, antenna, columnMat), 'antenna');
  add(g, new THREE.SphereGeometry(1.1 * m.s, 10, 8).translate(0, h * 0.998, 0), beaconMat);
  pearlPlinth(g, m, angles);
  return g;
}

const plinthMat = new THREE.MeshStandardMaterial({ color: 0xd8d3c9, roughness: 0.86, metalness: 0.03 });
const treadMat = new THREE.MeshStandardMaterial({ color: 0xc4bfb4, roughness: 0.92, metalness: 0.02 });

// The tower stands on a circular stepped podium. Stairs occupy the three
// gaps between the legs; the terraces are the arcs the legs stand on.
function pearlPlinth(g, m, angles) {
  const s = m.s;
  const gap = 0.5;
  const terraces = [
    { r: 78, y0: 0.04, y1: 1.15 },
    { r: 64, y0: 1.1, y1: 2.45 },
    { r: 52, y0: 2.4, y1: 3.9 },
    { r: 43, y0: 3.85, y1: 5.45 },
  ];
  for (const terrace of terraces) {
    for (let k = 0; k < 3; k++) {
      const gapCenter = angles[k] + Math.PI / 3;
      const a0 = gapCenter + gap / 2;
      const a1 = gapCenter + (Math.PI * 2) / 3 - gap / 2;
      const segs = Math.max(8, Math.round(((a1 - a0) / (Math.PI * 2)) * 36));
      const geo = new THREE.CylinderGeometry(terrace.r * s, terrace.r * s, (terrace.y1 - terrace.y0) * s, segs, 1, false, a0, a1 - a0);
      geo.translate(0, ((terrace.y0 + terrace.y1) / 2) * s, 0);
      tag(add(g, geo, plinthMat), 'plinth');
    }
  }
  for (let k = 0; k < 3; k++) {
    const angle = angles[k] + Math.PI / 3;
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const radius = (80 - t * 38) * s;
      const y = (0.18 + t * 5.15) * s;
      const geo = new THREE.BoxGeometry(2.3 * s, 0.3 * s, 7.4 * s);
      geo.rotateY(-angle);
      geo.translate(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      tag(add(g, geo, treadMat), 'stair', angle);
    }
  }
}

function roundedRectShape(w, d, rad) {
  const shape = new THREE.Shape();
  const hw = w / 2;
  const hd = d / 2;
  const r = Math.min(rad, hw - 0.1, hd - 0.1);
  shape.moveTo(-hw + r, -hd);
  shape.lineTo(hw - r, -hd);
  shape.absarc(hw - r, -hd + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(hw, hd - r);
  shape.absarc(hw - r, hd - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-hw + r, hd);
  shape.absarc(-hw + r, hd - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-hw, -hd + r);
  shape.absarc(-hw + r, -hd + r, r, Math.PI, Math.PI * 1.5, false);
  return shape;
}

function extrudeUp(shape, depth) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// White Magnolia Plaza: a glass shaft with the horizontal light shelves SOM
// designed, and the open observation deck that replaced the helipad.
function magnolia(h) {
  const g = new THREE.Group();
  const s = h / 319.5;
  const shaftH = 302 * s;
  const shaft = extrudeUp(roundedRectShape(48 * s, 40 * s, 14 * s), shaftH);
  tag(add(g, shaft, glassBlue), 'shaft');
  for (let y = 16 * s; y < shaftH - 4 * s; y += 24 * s) {
    const shelf = extrudeUp(roundedRectShape(50.6 * s, 42.6 * s, 15 * s), 0.7 * s);
    shelf.translate(0, y, 0);
    tag(add(g, shelf, steel), 'shelf');
  }
  const deck = extrudeUp(roundedRectShape(62 * s, 52 * s, 18 * s), 1.6 * s);
  deck.translate(0, shaftH, 0);
  tag(add(g, deck, concrete), 'deck');
  const railOuter = roundedRectShape(61 * s, 51 * s, 17.5 * s);
  const railInner = roundedRectShape(58.6 * s, 48.6 * s, 16.2 * s);
  railOuter.holes.push(railInner);
  const rail = extrudeUp(railOuter, 1.25 * s);
  rail.translate(0, shaftH + 1.6 * s, 0);
  tag(add(g, rail, glassBlue), 'rail');
  const core = extrudeUp(roundedRectShape(16 * s, 14 * s, 3 * s), 14 * s);
  core.translate(0, shaftH + 1.6 * s, 0);
  tag(add(g, core, glassSilver), 'core');
  const canopy = extrudeUp(roundedRectShape(56 * s, 46 * s, 16 * s), 0.8 * s);
  canopy.translate(0, shaftH + 15.6 * s, 0);
  tag(add(g, canopy, steel), 'canopy');
  return g;
}

function ringPoints(segs, radius, twist, y, lobes) {
  const pts = [];
  for (let s = 0; s < segs; s++) {
    const a = (s / segs) * Math.PI * 2;
    const r = radius * (lobes ? 0.74 + 0.26 * Math.cos(3 * a) : 1);
    const ang = a + twist;
    pts.push(new THREE.Vector3(Math.cos(ang) * r, y, Math.sin(ang) * r));
  }
  return pts;
}

function shellBetween(group, a, b, mat, closed = true) {
  const geo = new THREE.BufferGeometry();
  const pos = [];
  const idx = [];
  const n = a.length;
  const quads = closed ? n : n - 1;
  for (let i = 0; i < quads; i++) {
    const i2 = (i + 1) % n;
    const base = pos.length / 3;
    for (const p of [a[i], a[i2], b[i2], b[i]]) pos.push(p.x, p.y, p.z);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  add(group, geo, mat);
}

function capRing(group, ring, mat) {
  const geo = new THREE.BufferGeometry();
  const pos = [0, ring[0].y, 0];
  for (const p of ring) pos.push(p.x, p.y, p.z);
  const idx = [];
  for (let i = 0; i < ring.length; i++) idx.push(0, i + 1, ((i + 1) % ring.length) + 1);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  add(group, geo, mat);
}

const slotMat = new THREE.MeshStandardMaterial({ color: 0x4e5964, metalness: 0.28, roughness: 0.62 });
slotMat.side = THREE.DoubleSide;
const ribMat = new THREE.MeshStandardMaterial({ color: 0xe7eef3, metalness: 0.48, roughness: 0.3 });
ribMat.side = THREE.DoubleSide;

// Gensler: equilateral triangle with tangential corner arcs, one notched vertex,
// 120° linear twist, wide lower third, about 55% narrower at the crown.
function shanghaiRing(segs, radius, twist, y) {
  const pts = [];
  for (let s = 0; s < segs; s++) {
    const a = (s / segs) * Math.PI * 2;
    let k = 0.76 + 0.24 * Math.cos(3 * a);
    const raw = a > Math.PI ? a - Math.PI * 2 : a;
    const notch = Math.exp(-((raw / 0.22) ** 2));
    k *= 1 - 0.32 * notch;
    const ang = a + twist;
    pts.push(new THREE.Vector3(Math.cos(ang) * radius * k, y, Math.sin(ang) * radius * k));
  }
  return pts;
}

function quadsMesh(group, quads, mat) {
  if (!quads.length) return;
  const geo = new THREE.BufferGeometry();
  const pos = [];
  const idx = [];
  for (let i = 0; i < quads.length; i += 4) {
    const base = pos.length / 3;
    for (let k = 0; k < 4; k++) pos.push(quads[i + k].x, quads[i + k].y, quads[i + k].z);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  add(group, geo, mat);
}

function shanghai(h) {
  const g = new THREE.Group();
  const segs = 72;
  const steps = 70;
  const yScale = 0.985;
  let prev = null;
  const glass = [];
  const crown = [];
  const slot = [];
  const rib = [];
  const kindOf = (i) => {
    const a = ((i + 0.5) / segs) * Math.PI * 2;
    const raw = a > Math.PI ? a - Math.PI * 2 : a;
    if (Math.abs(raw) < 0.24) return slot;
    for (const v of [(2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
      let d = Math.abs(a - v);
      d = Math.min(d, Math.PI * 2 - d);
      if (d < 0.09) return rib;
    }
    return glass;
  };
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = Math.min(t, 0.9) / 0.9;
    const body = 1 - 0.55 * (u ** 1.35);
    const dome = t <= 0.9 ? 1 : Math.cos(((t - 0.9) / 0.1) * Math.PI / 2);
    const y = t * h * yScale;
    const twist = t * (120 * Math.PI / 180);
    const ring = shanghaiRing(segs, 34 * body * (0.58 + 0.42 * dome), twist, y);
    if (prev) {
      const dest = t > 0.9 ? crown : null;
      for (let s = 0; s < segs; s++) {
        const s2 = (s + 1) % segs;
        const bucket = dest || kindOf(s);
        bucket.push(prev[s], prev[s2], ring[s2], ring[s]);
      }
    }
    prev = ring;
  }
  quadsMesh(g, glass, glassBlue);
  quadsMesh(g, crown, shanghaiCrownMat);
  quadsMesh(g, slot, slotMat);
  quadsMesh(g, rib, ribMat);
  if (prev) capRing(g, prev, shanghaiCrownMat);
  add(g, new THREE.SphereGeometry(1.15, 10, 8).translate(0, h * 0.992, 0), beaconMat);
  return g;
}

// KPF: a square shaft. Two opposite faces sweep inward from about a third of
// the way up and finish on one long, flat roof edge with sharp corners.
// The aperture is cut through those broad faces. It is an inverted trapezoid:
// a horizontal sill, straight sides, and a wider horizontal head.
function swfcSection(t) {
  const w = 58 * (1 - 0.055 * Math.max(0, t - 0.12));
  const arc0 = 0.3;
  const roofD = 17.2;
  let d = 58;
  if (t > arc0) {
    const u = (t - arc0) / (1 - arc0);
    d = 58 + (roofD - 58) * (u ** 1.08);
  }
  // The crown is a true rectangle. A chamfer here reads as a bottle cap.
  const chamfer = t > 0.76 ? 0 : Math.min(1.35, w * 0.03) * Math.min(1, Math.max(0, (t - 0.2) * 2.4));
  return { w, d, chamfer };
}

function swfcRing(t, y) {
  const { w, d, chamfer } = swfcSection(t);
  const hw = w / 2;
  const hd = d / 2;
  const c = Math.min(chamfer, hw * 0.18, hd * 0.8);
  return [
    [-hw + c, hd], [hw - c, hd], [hw, hd - c], [hw, -hd + c],
    [hw - c, -hd], [-hw + c, -hd], [-hw, -hd + c], [-hw, hd - c],
  ].map(([x, z]) => new THREE.Vector3(x, y, z));
}

function swfc(h) {
  const g = new THREE.Group();
  const yOf = (t) => t * h * 0.992;
  // Sill and head are horizontal. The glass bridge above them is about a
  // third of the opening, with a thin silver soffit, not a second tower.
  const hole0 = 432 / (h * 0.992);
  const hole1 = 476 / (h * 0.992);
  const openHalf = (t) => {
    const u = Math.min(1, Math.max(0, (t - hole0) / (hole1 - hole0)));
    return 13.5 + (21.5 - 13.5) * u;
  };
  const ts = [0, hole0, hole1, 1];
  for (let i = 1; i < 42; i++) ts.push(i / 42);
  for (let i = 1; i < 10; i++) ts.push(hole0 + (hole1 - hole0) * i / 10);
  ts.sort((a, b) => a - b);
  const samples = [];
  for (const t of ts) {
    if (!samples.length || t - samples[samples.length - 1] > 1e-4) samples.push(t);
  }
  const glass = [];
  const frame = [];
  const push = (list, a, b, c, d) => list.push(a, b, c, d);
  const wall = (list, a0, a1, b0, b1) => push(list, a0, a1, b1, b0);
  for (let i = 0; i < samples.length - 1; i++) {
    const t0 = samples[i];
    const t1 = samples[i + 1];
    const ringA = swfcRing(t0, yOf(t0));
    const ringB = swfcRing(t1, yOf(t1));
    for (const edge of [1, 2, 3, 5, 6, 7]) {
      const e2 = (edge + 1) % 8;
      wall(glass, ringA[edge], ringA[e2], ringB[edge], ringB[e2]);
    }
    const open = t0 >= hole0 - 1e-6 && t1 <= hole1 + 1e-6;
    for (const face of [0, 4]) {
      const a0 = ringA[face];
      const a1 = ringA[(face + 1) % 8];
      const b0 = ringB[face];
      const b1 = ringB[(face + 1) % 8];
      if (!open) {
        wall(glass, a0, a1, b0, b1);
        continue;
      }
      const jamb = (p0, p1, q0, q1, x0, x1, u0, u1) => {
        const at = (p, q, x) => new THREE.Vector3(x, p.y, p.z + (q.z - p.z) * 0);
        wall(frame, at(p0, p1, x0), at(p0, p1, x1), at(q0, q1, u0), at(q0, q1, u1));
      };
      const loA = Math.min(a0.x, a1.x);
      const hiA = Math.max(a0.x, a1.x);
      const loB = Math.min(b0.x, b1.x);
      const hiB = Math.max(b0.x, b1.x);
      const inLoA = Math.max(loA, -openHalf(t0));
      const inHiA = Math.min(hiA, openHalf(t0));
      const inLoB = Math.max(loB, -openHalf(t1));
      const inHiB = Math.min(hiB, openHalf(t1));
      if (inLoA >= inHiA - 0.2) {
        wall(glass, a0, a1, b0, b1);
        continue;
      }
      if (inLoA - loA > 0.15) jamb(a0, a1, b0, b1, loA, inLoA, loB, inLoB);
      if (hiA - inHiA > 0.15) jamb(a0, a1, b0, b1, inHiA, hiA, inHiB, hiB);
    }
  }
  const sillY = yOf(hole0);
  const headY = yOf(hole1);
  const sill = swfcSection(hole0);
  const head = swfcSection(hole1);
  const hz = (sec) => sec.d / 2;
  const rim = (y, half, hd) => {
    const p = (x, z) => new THREE.Vector3(x, y, z);
    push(frame, p(-half, hd), p(half, hd), p(half, -hd), p(-half, -hd));
  };
  rim(sillY, openHalf(hole0), hz(sill));
  rim(headY, openHalf(hole1), hz(head));
  for (let i = 0; i < 10; i++) {
    const t0 = hole0 + (hole1 - hole0) * i / 10;
    const t1 = hole0 + (hole1 - hole0) * (i + 1) / 10;
    const d0 = swfcSection(t0).d / 2;
    const d1 = swfcSection(t1).d / 2;
    const y0 = yOf(t0);
    const y1 = yOf(t1);
    for (const sign of [-1, 1]) {
      const x0 = sign * openHalf(t0);
      const x1 = sign * openHalf(t1);
      const p = (x, y, z) => new THREE.Vector3(x, y, z);
      wall(frame, p(x0, y0, d0), p(x0, y0, -d0), p(x1, y1, d1), p(x1, y1, -d1));
    }
  }
  quadsMesh(g, glass, swfcGlass);
  quadsMesh(g, frame, swfcEdgeMat);
  // A thin slab, flush with the opening, so the sill is one horizontal line.
  const sillBar = new THREE.BoxGeometry(openHalf(hole0) * 2, 2.2, sill.d * 0.96);
  sillBar.translate(0, sillY - 1.1, 0);
  tag(add(g, sillBar, swfcEdgeMat), 'swfc-sill');
  const soffitH = 1.5;
  const soffit = new THREE.BoxGeometry(openHalf(hole1) * 2, soffitH, Math.max(14, head.d * 0.94));
  soffit.translate(0, headY + soffitH / 2, 0);
  tag(add(g, soffit, swfcEdgeMat), 'swfc-lintel');
  const crown = swfcSection(1);
  const roof = new THREE.BoxGeometry(crown.w, 1.5, crown.d);
  roof.translate(0, yOf(1) + 0.75, 0);
  add(g, roof, swfcEdgeMat);
  return g;
}

let jinGrid = null;
function jinmaoMaterial() {
  if (jinGrid) return jinGrid;
  jinGrid = new THREE.MeshStandardMaterial({ color: 0xd7dee6, metalness: 0.62, roughness: 0.28 });
  jinGrid.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = cityUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGrid;\nvarying vec3 vLm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrid = uv;\nvLm = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying vec2 vGrid;\nvarying vec3 vLm;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fu = fract(vGrid.x * 9.0);
        float fv = fract(vLm.y / 4.2);
        float edge = min(min(fu, 1.0 - fu), min(fv, 1.0 - fv));
        float frame = 1.0 - smoothstep(0.07, 0.16, edge);
        vec3 metal = vec3(0.78, 0.81, 0.84);
        vec3 glass = vec3(0.38, 0.50, 0.60);
        diffuseColor.rgb = mix(glass, metal, frame);
        float pane = 1.0 - frame;
        float row = floor(vLm.y / 4.2);
        float col = floor(vGrid.x * 9.0);
        float on = step(0.62, fract(sin(row * 12.1 + col * 7.7) * 43758.5));
        totalEmissiveRadiance += vec3(1.0, 0.78, 0.42) * uNight * 0.16;
        totalEmissiveRadiance += vec3(1.0, 0.84, 0.58) * pane * on * uNight * 0.85;
        float crown = smoothstep(250.0, 360.0, vLm.y);
        totalEmissiveRadiance += vec3(1.0, 0.68, 0.16) * crown * uNight * (1.1 + frame * 1.6);
      `);
  };
  jinGrid.customProgramCacheKey = () => 'lm-jin-grid';
  return jinGrid;
}

function shellGrid(group, a, b, mat) {
  const geo = new THREE.BufferGeometry();
  const pos = [];
  const uv = [];
  const idx = [];
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    const base = pos.length / 3;
    for (const p of [a[i], a[i2], b[i2], b[i]]) pos.push(p.x, p.y, p.z);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  add(group, geo, mat);
}

function jinmao(h) {
  const g = new THREE.Group();
  const s = h / 420.5;
  // SOM: 88 floors in 16 segments. Each office segment drops by 1/8 of the
  // 16-story base (2 floors) until the 8-story hotel; the crown then steps
  // down to level 88. Roof 385.5 m, spire 35 m, on the 420.5 m tower.
  const floor = (385.5 * s) / 88;
  const segments = [16, 14, 12, 10, 8, 6, 4, 5, 4, 3, 2, 2, 1, 1];
  let y = 0;
  let radius = 32 * s;
  const grid = jinmaoMaterial();
  const twist = Math.PI / 8;
  segments.forEach((stories, i) => {
    const tierH = stories * floor;
    const next = radius * (i < 7 ? 0.88 : 0.78);
    const lower = ringPoints(8, radius, twist, y, false);
    const neck = ringPoints(8, radius, twist, y + tierH * 0.84, false);
    const lip = ringPoints(8, radius * 1.045, twist, y + tierH * 0.92, false);
    const shelf = ringPoints(8, next, twist, y + tierH, false);
    shellGrid(g, lower, neck, grid);
    shellBetween(g, neck, lip, steel);
    shellBetween(g, lip, shelf, steel);
    if (i === 0) capRing(g, lower, dark);
    y += tierH;
    radius = next;
  });
  const spireH = Math.max(8 * s, h - y);
  const spire = new THREE.CylinderGeometry(0.28 * s, Math.max(radius * 0.92, 0.7), spireH, 8);
  spire.rotateY(-twist);
  spire.translate(0, y + spireH / 2, 0);
  add(g, spire, steel);
  add(g, new THREE.SphereGeometry(0.55 * s, 8, 6).translate(0, h, 0), beaconMat);
  return g;
}

const STONE_I = WALL_LAYERS.findIndex((l) => l.key === 'stone');
// Sandstone Blocks 08 (Poly Haven, CC0), divided by its mean so the warm buff
// tint stays ours. UVs are metres. Shared by every Bund stone material.
const STONE_SHADE = /* glsl */`
uniform float uNight;
uniform float uPhotoOn;
uniform sampler2DArray uWallAlb;
uniform sampler2DArray uWallNor;
uniform vec3 uWallMean[${WALL_LAYERS.length}];
uniform vec2 uWallScale[${WALL_LAYERS.length}];
varying vec3 vCpos;
varying vec3 vCnorm;
const int STONE_I = ${STONE_I};
vec3 stoneTbn(vec3 n, vec3 eye, vec2 uv, vec3 m) {
  vec3 q0 = dFdx(eye), q1 = dFdy(eye);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1p = cross(q1, n), q0p = cross(n, q0);
  vec3 T = q1p * st0.x + q0p * st1.x;
  vec3 B = q1p * st0.y + q0p * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float s = det == 0.0 ? 0.0 : inversesqrt(det);
  return normalize(T * (m.x * s) + B * (m.y * s) + n * m.z);
}
`;
const STONE_VERT = /* glsl */`#include <begin_vertex>
#ifdef USE_INSTANCING
  vCpos = (instanceMatrix * vec4(position, 1.0)).xyz;
  vCnorm = normalize(mat3(instanceMatrix) * normal);
#else
  vCpos = position;
  vCnorm = normal;
#endif`;
function shadeBundStone(mat, key) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = cityUniforms.uNight;
    shader.uniforms.uPhotoOn = photoUniforms.uPhotoOn;
    shader.uniforms.uWallAlb = photoUniforms.uWallAlb;
    shader.uniforms.uWallNor = photoUniforms.uWallNor;
    shader.uniforms.uWallMean = photoUniforms.uWallMean;
    shader.uniforms.uWallScale = photoUniforms.uWallScale;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCpos;\nvarying vec3 vCnorm;')
      .replace('#include <begin_vertex>', STONE_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${STONE_SHADE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 sn = normalize(vCnorm);
        vec2 suv = abs(sn.y) > 0.65 ? vCpos.xz : (abs(sn.x) > abs(sn.z) ? vec2(vCpos.z, vCpos.y) : vec2(vCpos.x, vCpos.y));
        vec3 stoneCol = diffuseColor.rgb;
        if (uPhotoOn > 0.5) {
          vec2 mapUv = suv * uWallScale[STONE_I];
          vec3 tex = texture(uWallAlb, vec3(mapUv, float(STONE_I))).rgb / max(uWallMean[STONE_I], vec3(0.02));
          float luma = dot(tex, vec3(0.3, 0.59, 0.11));
          tex = mix(vec3(luma), tex, 0.62);
          stoneCol = tex * vec3(0.9, 0.84, 0.72);
        }
        float vary = fract(sin(dot(floor(suv / vec2(1.2, 0.48)), vec2(19.1, 7.7))) * 43758.5);
        stoneCol *= 0.91 + 0.14 * vary;
        float base = 1.0 - smoothstep(6.4, 9.0, vCpos.y);
        float course = smoothstep(0.72, 0.94, fract(vCpos.y / 0.46));
        float vj = smoothstep(0.88, 0.98, fract(suv.x / 1.2));
        stoneCol *= mix(1.0, 0.58, base * max(course, vj * 0.8));
        float soffit = smoothstep(0.08, 0.72, -sn.y);
        stoneCol *= mix(1.0, 0.4, soffit);
        stoneCol *= 1.0 - (1.0 - smoothstep(0.0, 0.65, vCpos.y)) * 0.16;
        diffuseColor.rgb = stoneCol;
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (uPhotoOn > 0.5) {
          vec2 mapUv = (abs(normalize(vCnorm).y) > 0.65 ? vCpos.xz : (abs(vCnorm.x) > abs(vCnorm.z) ? vec2(vCpos.z, vCpos.y) : vec2(vCpos.x, vCpos.y))) * uWallScale[STONE_I];
          vec3 tm = texture(uWallNor, vec3(mapUv, float(STONE_I))).xyz * 2.0 - 1.0;
          tm.y = -tm.y;
          normal = stoneTbn(normal, -vViewPosition, mapUv, normalize(mix(vec3(0.0, 0.0, 1.0), tm, 0.85)));
        }
      `)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float sup = smoothstep(0.4, 0.92, normalize(vCnorm).y);
        float sGraze = pow(clamp(vCpos.y / 72.0, 0.0, 1.0), 1.35);
        totalEmissiveRadiance += vec3(1.0, 0.64, 0.3) * uNight * (0.045 + 0.14 * sGraze + 0.8 * sup);
      `);
  };
  mat.customProgramCacheKey = () => key;
}
const bundStone = new THREE.MeshStandardMaterial({
  color: 0xe4d2b4, roughness: 0.78, metalness: 0.03,
  emissive: new THREE.Color(0xffb15a), emissiveIntensity: 0,
});
shadeBundStone(bundStone, 'lm-bund-stone-6');
const bundPlain = new THREE.MeshStandardMaterial({
  color: 0xeadcc4, roughness: 0.64, metalness: 0.04,
  emissive: new THREE.Color(0xffb15a), emissiveIntensity: 0,
});
shadeBundStone(bundPlain, 'lm-bund-plain-6');
const customsWall = new THREE.MeshStandardMaterial({
  color: 0xe6d4b6, roughness: 0.76, metalness: 0.03,
  emissive: new THREE.Color(0xffb15a), emissiveIntensity: 0,
});
shadeBundStone(customsWall, 'lm-customs-wall-2');
const recessMat = new THREE.MeshStandardMaterial({ color: 0x12181e, roughness: 0.72, metalness: 0.06 });
const jointMat = new THREE.MeshStandardMaterial({ color: 0x6e6558, roughness: 0.84, metalness: 0.02 });
const mullionMat = new THREE.MeshStandardMaterial({ color: 0x2a3136, roughness: 0.4, metalness: 0.4 });
const bundGlass = new THREE.MeshStandardMaterial({
  color: 0xc5d2dc, roughness: 0.14, metalness: 0.46,
  emissive: new THREE.Color(0xffc07a), emissiveIntensity: 0,
});
bundGlass.onBeforeCompile = (shader) => {
  shader.uniforms.uNight = cityUniforms.uNight;
  shader.uniforms.uHorizon = cityUniforms.uHorizon;
  shader.uniforms.uSky = cityUniforms.uSky;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vGpos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGpos = position;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uNight;
      uniform vec3 uHorizon;
      uniform vec3 uSky;
      varying vec3 vGpos;`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb, uHorizon * 0.72 + uSky * 0.28, 0.34 * (1.0 - uNight));
    `)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float gid = floor(vGpos.x * 0.28) + floor(vGpos.y * 0.32) * 19.0 + floor(vGpos.z * 0.28) * 7.0;
      float gh = fract(sin(gid * 17.13) * 43758.5);
      float tier = step(0.38, gh) + step(0.74, gh);
      totalEmissiveRadiance += vec3(1.0, 0.68, 0.34) * tier * uNight * 0.5;
    `);
};
bundGlass.customProgramCacheKey = () => 'lm-bund-glass-1';
const marbleBase = new THREE.MeshStandardMaterial({ color: 0x2c3136, roughness: 0.38, metalness: 0.22 });
const soffitMat = new THREE.MeshStandardMaterial({ color: 0x6f685c, roughness: 0.9, metalness: 0.02 });
const flagMat = new THREE.MeshStandardMaterial({
  color: 0xc4372f, roughness: 0.62, metalness: 0.04, side: THREE.DoubleSide,
});
const copperRoof = new THREE.MeshStandardMaterial({
  color: 0x2f8f62, roughness: 0.42, metalness: 0.38,
  emissive: new THREE.Color(0x146b40), emissiveIntensity: 0,
});
const glazeRoof = new THREE.MeshStandardMaterial({
  color: 0x1c6e68, roughness: 0.36, metalness: 0.34,
  emissive: new THREE.Color(0x145e58), emissiveIntensity: 0,
});

function putBox(g, w, hgt, d, x, y, z, mat) {
  const geo = new THREE.BoxGeometry(w, hgt, d);
  geo.translate(x, y + hgt / 2, z);
  return add(g, geo, mat);
}

// Framed opening. (x, y, z) is the bottom centre of the hole on the wall face.
// ax 'z' runs the width along X; ax 'x' runs it along Z. sign is the exterior direction.
function putWindow(g, w, h, x, y, z, opt = {}) {
  const ax = opt.ax || 'z';
  const sign = opt.sign ?? 1;
  const reveal = opt.reveal ?? 0.34;
  const arch = !!opt.arch && ax === 'z';
  const ped = !!opt.pediment && !arch;
  const frame = Math.min(0.16, Math.max(0.07, w * 0.07));
  const face = ax === 'z' ? z : x;
  const glassAt = face + sign * 0.045;
  const midAt = face + sign * (reveal * 0.5);
  const ft = Math.max(reveal, 0.12);
  const gw = Math.max(0.2, w - frame * 2.2);
  const bodyH = arch ? Math.max(0.35, h - w * 0.46) : h * 0.8;
  const gy = y + (arch ? frame * 0.4 : (h - bodyH) * 0.45);
  if (arch) {
    const shape = new THREE.Shape();
    const hw = gw * 0.5;
    shape.moveTo(-hw, 0);
    shape.lineTo(-hw, bodyH);
    shape.absarc(0, bodyH, hw, Math.PI, 0, false);
    shape.lineTo(hw, 0);
    shape.lineTo(-hw, 0);
    const geo = new THREE.ShapeGeometry(shape);
    geo.translate(x, gy, glassAt);
    const glass = add(g, geo, bundGlass);
    glass.userData.part = 'bund-glass';
    const torus = new THREE.TorusGeometry(hw + frame * 0.15, frame * 0.55, 6, 16, Math.PI);
    torus.translate(x, gy + bodyH, midAt);
    add(g, torus, bundPlain);
    putBox(g, frame, bodyH, ft, x - w / 2 + frame / 2, y, midAt, bundPlain);
    putBox(g, frame, bodyH, ft, x + w / 2 - frame / 2, y, midAt, bundPlain);
    putBox(g, w, frame, ft, x, y, midAt, bundPlain);
    putBox(g, 0.055, bodyH * 0.85, 0.05, x, y + frame, glassAt + sign * 0.03, mullionMat);
  } else if (ax === 'z') {
    const glass = putBox(g, gw, bodyH, 0.045, x, gy, glassAt, bundGlass);
    glass.userData.part = 'bund-glass';
    putBox(g, frame, h, ft, x - w / 2 + frame / 2, y, midAt, bundPlain);
    putBox(g, frame, h, ft, x + w / 2 - frame / 2, y, midAt, bundPlain);
    putBox(g, w, frame, ft, x, y, midAt, bundPlain);
    putBox(g, w, frame, ft, x, y + h - frame, midAt, bundPlain);
    putBox(g, 0.05, bodyH * 0.92, 0.04, x - gw * 0.22, gy, glassAt + sign * 0.03, mullionMat);
    putBox(g, 0.05, bodyH * 0.92, 0.04, x + gw * 0.22, gy, glassAt + sign * 0.03, mullionMat);
    putBox(g, gw * 0.7, 0.045, 0.04, x, gy + bodyH * 0.55, glassAt + sign * 0.03, mullionMat);
    putBox(g, 0.05, bodyH, ft * 0.85, x - w / 2 + frame + 0.03, y + frame, midAt, jointMat);
    putBox(g, 0.05, bodyH, ft * 0.85, x + w / 2 - frame - 0.03, y + frame, midAt, jointMat);
  } else {
    const glass = putBox(g, 0.045, bodyH, gw, glassAt, gy, z, bundGlass);
    glass.userData.part = 'bund-glass';
    putBox(g, ft, h, frame, midAt, y, z - w / 2 + frame / 2, bundPlain);
    putBox(g, ft, h, frame, midAt, y, z + w / 2 - frame / 2, bundPlain);
    putBox(g, ft, frame, w, midAt, y, z, bundPlain);
    putBox(g, ft, frame, w, midAt, y + h - frame, z, bundPlain);
    putBox(g, 0.04, bodyH * 0.92, 0.05, glassAt + sign * 0.03, gy, z - gw * 0.22, mullionMat);
    putBox(g, 0.04, bodyH * 0.92, 0.05, glassAt + sign * 0.03, gy, z + gw * 0.22, mullionMat);
    putBox(g, 0.04, 0.045, gw * 0.7, glassAt + sign * 0.03, gy + bodyH * 0.55, z, mullionMat);
  }
  if (ped && ax === 'z') {
    const tri = new THREE.Shape();
    tri.moveTo(-w * 0.62, 0);
    tri.lineTo(w * 0.62, 0);
    tri.lineTo(0, Math.min(0.85, w * 0.32));
    const geo = new THREE.ExtrudeGeometry(tri, { depth: 0.22, bevelEnabled: false });
    geo.translate(x, y + h + 0.02, midAt - 0.05);
    add(g, geo, bundPlain);
  }
}

function putFlutes(g, x, y, z, r, h) {
  const n = 12;
  const geo = new THREE.BoxGeometry(r * 0.12, h * 0.97, r * 0.15);
  const mesh = new THREE.InstancedMesh(geo, jointMat, n);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    dummy.position.set(x + Math.sin(a) * r * 0.92, y + h / 2, z + Math.cos(a) * r * 0.92);
    dummy.lookAt(x, y + h / 2, z);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  g.add(mesh);
}

function putCorniceRun(g, width, y, z, s = 1) {
  putBox(g, width, 0.14 * s, 0.42 * s, 0, y - 0.12 * s, z, bundPlain);
  const pitch = 0.48 * s;
  const n = Math.max(8, Math.floor(width / pitch));
  const geo = new THREE.BoxGeometry(0.2 * s, 0.28 * s, 0.26 * s);
  const mesh = new THREE.InstancedMesh(geo, bundPlain, n);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const span = width * 0.97;
  for (let i = 0; i < n; i++) {
    dummy.position.set(-span / 2 + (i + 0.5) * (span / n), y + 0.1 * s, z + 0.04 * s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  g.add(mesh);
  putBox(g, width + 0.3 * s, 0.18 * s, 0.62 * s, 0, y + 0.32 * s, z + 0.06 * s, bundPlain);
}

// Four round faces. `half` is the tower half-width; `oz` shifts the tower toward the river.
function placeClocks(g, y, half, r, oz = 0) {
  const spots = [
    { x: 0, z: oz + half, ry: 0, nx: 0, nz: 1 },
    { x: 0, z: oz - half, ry: Math.PI, nx: 0, nz: -1 },
    { x: half, z: oz, ry: Math.PI / 2, nx: 1, nz: 0 },
    { x: -half, z: oz, ry: -Math.PI / 2, nx: -1, nz: 0 },
  ];
  for (const s of spots) {
    const nudge = 0.2;
    const face = new THREE.CircleGeometry(r, 40);
    face.rotateY(s.ry);
    face.translate(s.x + s.nx * nudge, y, s.z + s.nz * nudge);
    const faceMesh = add(g, face, clockMat);
    faceMesh.userData.part = 'customs-face';
    const rim = new THREE.RingGeometry(r * 0.84, r * 0.98, 40);
    rim.rotateY(s.ry);
    rim.translate(s.x + s.nx * (nudge + 0.02), y, s.z + s.nz * (nudge + 0.02));
    add(g, rim, dark);
    const bezel = new THREE.TorusGeometry(r * 1.16, Math.max(0.12, r * 0.075), 8, 36);
    bezel.rotateY(s.ry);
    bezel.translate(s.x + s.nx * 0.08, y, s.z + s.nz * 0.08);
    add(g, bezel, bundPlain);
    const frame = r * 1.38;
    const bar = Math.max(0.16, r * 0.055);
    for (const vertical of [false, true]) {
      for (const side of [-1, 1]) {
        const w = vertical ? bar : frame * 2;
        const hgt = vertical ? frame * 2 : bar;
        const box = new THREE.BoxGeometry(w, hgt, bar);
        box.translate(vertical ? side * frame : 0, vertical ? 0 : side * frame, nudge * 0.45);
        box.rotateY(s.ry);
        box.translate(s.x, y, s.z);
        add(g, box, bundPlain);
      }
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const tick = new THREE.BoxGeometry(0.12, r * 0.18, 0.04);
      tick.translate(Math.sin(a) * r * 0.76, Math.cos(a) * r * 0.76, nudge + 0.04);
      tick.rotateZ(-a);
      tick.rotateY(s.ry);
      tick.translate(s.x, y, s.z);
      add(g, tick, dark);
    }
    for (const ang of [-0.55, 2.05]) {
      const len = ang < 0 ? 0.42 : 0.68;
      const hand = new THREE.BoxGeometry(0.08, r * len, 0.045);
      hand.translate(0, r * len * 0.42, nudge + 0.06);
      hand.rotateZ(ang);
      hand.rotateY(s.ry);
      hand.translate(s.x, y, s.z);
      add(g, hand, dark);
    }
  }
}

// Palmer & Turner, finished 19 Dec 1927. Survey used when h = 90 (flagpole tip);
// the same ratios scale for any passed height. Masonry is the published
// 79.2 m (main block 120 ft / 36.2 m, clock tower 140 ft / 43 m) and the
// flagpole makes up the rest to 90 m.
// East block depth about 30 m. Frontage 46 m, five equal bays, narrower than
// the HSBC front (90 m). Both cornices top out at 33.9 m when each model is
// built at its design height (customs 90 m, HSBC 52 m).
// Tower plan 16.8 m, 0.37 of the frontage, set just behind the river parapet.
// Clock diameter 5.4 m on every face. Above the clock the plan steps in
// (0.74, 0.52, 0.36) — a square Art Deco crown, not a pyramid.
// Four Greek Doric columns, no bases, spacing 4.5 m, centred under the tower.
function customs(h) {
  const g = new THREE.Group();
  const s = h / 90;
  const W = 46 * s;
  const D = 30 * s;
  const TW = 16.8 * s;
  const podiumH = 11 * s;
  const beltH = 1.15 * s;
  const orderH = 19.2 * s;
  const corniceH = 2.55 * s;
  const parapetH = 2.3 * s;
  const block = podiumH + beltH + orderH + corniceH + parapetH;
  const orderY = podiumH + beltH;
  const corniceY = orderY + orderH;
  const wallFront = (D - 1.5 * s) / 2;
  const wallSide = (W - 1.5 * s) / 2;

  const podium = putBox(g, W, podiumH, D, 0, 0, 0, customsWall);
  podium.userData.part = 'customs-block';
  putBox(g, W - 1.5 * s, orderH, D - 1.5 * s, 0, orderY, 0, customsWall);
  putBox(g, W + 0.55 * s, beltH, D + 0.45 * s, 0, podiumH, 0, bundPlain);
  const cornice = putBox(g, W + 2.3 * s, corniceH, D + 2.1 * s, 0, corniceY, 0, bundPlain);
  cornice.userData.part = 'customs-cornice';
  putCorniceRun(g, W + 1.4 * s, corniceY, (D + 1.6 * s) / 2, s);
  putBox(g, W + 0.2 * s, 0.7 * s, D + 0.15 * s, 0, corniceY - 0.55 * s, 0, soffitMat);
  putBox(g, W + 0.35 * s, parapetH, D + 0.3 * s, 0, corniceY + corniceH, 0, customsWall);

  const bayCenters = [-2, -1, 0, 1, 2].map((i) => i * (W * 0.184));
  const pierXs = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((i) => i * (W * 0.184));
  for (const x of pierXs) {
    putBox(g, 1.35 * s, orderH, 0.85 * s, x, orderY, wallFront + 0.15 * s, bundPlain);
  }
  for (const x of bayCenters) {
    for (let row = 0; row < 4; row++) {
      const rowH = orderH / 4;
      const winH = rowH * 0.62;
      const y = orderY + row * rowH + rowH * 0.2;
      putWindow(g, 3.15 * s, winH, x, y, wallFront, { reveal: 0.42 * s, pediment: row === 2 });
    }
    if (Math.abs(x) > 4 * s) {
      putWindow(g, 2.2 * s, 2.5 * s, x, podiumH * 0.28, D / 2, { reveal: 0.36 * s });
    }
  }
  const sideZs = [-1.5, -0.5, 0.5, 1.5].map((i) => i * (D * 0.2));
  for (const sign of [-1, 1]) {
    for (let i = 0; i <= sideZs.length; i++) {
      const z = -D * 0.4 + i * (D * 0.2);
      putBox(g, 0.8 * s, orderH, 1.15 * s, sign * (wallSide + 0.12 * s), orderY, z, bundPlain);
    }
    for (const z of sideZs) {
      for (let row = 0; row < 4; row++) {
        const rowH = orderH / 4;
        const y = orderY + row * rowH + rowH * 0.2;
        putWindow(g, 2.15 * s, rowH * 0.58, sign * wallSide, y, z, { ax: 'x', sign, reveal: 0.36 * s });
      }
    }
  }

  // Greek Doric portico: four columns, square abaci, entablature, under the tower.
  const colH = 8.7 * s;
  const colR = 0.78 * s;
  const colY = 0.9 * s;
  const colZ = D / 2 + 1.65 * s;
  const colXs = [-1.5, -0.5, 0.5, 1.5].map((i) => i * 4.5 * s);
  for (const x of colXs) {
    const cap = colR * 0.82;
    const shaftH = colH - cap;
    const shaft = new THREE.CylinderGeometry(colR * 0.9, colR, shaftH, 18);
    shaft.translate(x, colY + shaftH / 2, colZ);
    const shaftMesh = add(g, shaft, bundPlain);
    shaftMesh.userData.part = 'customs-portico';
    putFlutes(g, x, colY, colZ, colR, shaftH);
    const neck = new THREE.TorusGeometry(colR * 0.98, colR * 0.07, 6, 14);
    neck.rotateX(Math.PI / 2);
    neck.translate(x, colY + shaftH - colR * 0.05, colZ);
    add(g, neck, bundPlain);
    const ech = new THREE.CylinderGeometry(colR * 1.2, colR * 0.92, colR * 0.46, 16);
    ech.translate(x, colY + shaftH + colR * 0.23, colZ);
    add(g, ech, bundPlain);
    putBox(g, colR * 2.4, colR * 0.36, colR * 2.4, x, colY + shaftH + colR * 0.46, colZ, bundPlain);
  }
  const entY = colY + colH;
  const entW = colXs[3] - colXs[0] + 3.4 * s;
  putBox(g, entW, 0.7 * s, 2.5 * s, 0, entY, colZ, bundPlain);
  putBox(g, entW + 0.8 * s, 0.55 * s, 3.1 * s, 0, entY + 0.7 * s, colZ, bundPlain);
  putBox(g, entW + 1.5 * s, 0.38 * s, 3.6 * s, 0, entY + 1.25 * s, colZ, customsWall);
  for (let i = 0; i < 3; i++) {
    const x = (colXs[i] + colXs[i + 1]) / 2;
    putWindow(g, 1.35 * s, 5.2 * s, x - 0.55 * s, 1.25 * s, D / 2, { reveal: 0.4 * s });
    putWindow(g, 1.35 * s, 5.2 * s, x + 0.55 * s, 1.25 * s, D / 2, { reveal: 0.4 * s });
  }
  for (let step = 0; step < 3; step++) {
    const grow = (3 - step) * 0.7 * s;
    putBox(g, entW + grow, 0.28 * s, 2.2 * s + grow, 0, step * 0.28 * s, colZ - 0.15 * s, customsWall);
  }
  for (const x of [-1, 1]) {
    putBox(g, 2.2 * s, 3.4 * s, 1.6 * s, x * (entW / 2 + 0.4 * s), 0.4 * s, colZ - 0.2 * s, customsWall);
  }

  // Square tower on the river side of the roof. Stages step in above the clock.
  const tz = wallFront - 0.35 * s - TW / 2;
  const stages = [
    { hgt: 20 * s, w: TW, part: 'customs-shaft' },
    { hgt: 11 * s, w: TW, part: 'customs-clock' },
    { hgt: 6.4 * s, w: TW * 0.74, part: 'customs-belfry' },
    { hgt: 3.6 * s, w: TW * 0.52, part: 'customs-attic' },
    { hgt: 2 * s, w: TW * 0.36, part: 'customs-roof' },
  ];
  let yT = block;
  const placed = {};
  for (const stage of stages) {
    const mesh = putBox(g, stage.w, stage.hgt, stage.w, 0, yT, tz, customsWall);
    mesh.userData.part = stage.part;
    placed[stage.part] = { y: yT, h: stage.hgt, w: stage.w };
    if (stage.part === 'customs-clock' || stage.part === 'customs-belfry' || stage.part === 'customs-shaft') {
      putBox(g, stage.w + 0.9 * s, 0.7 * s, stage.w + 0.9 * s, 0, yT + stage.hgt - 0.7 * s, tz, bundPlain);
    }
    yT += stage.hgt;
  }
  const shaft = placed['customs-shaft'];
  const pierInset = TW / 2 - 0.85 * s;
  for (const face of [
    { x: 0, z: tz + TW / 2 + 0.12 * s, ax: 'x' },
    { x: 0, z: tz - TW / 2 - 0.12 * s, ax: 'x' },
    { x: TW / 2 + 0.12 * s, z: tz, ax: 'z' },
    { x: -TW / 2 - 0.12 * s, z: tz, ax: 'z' },
  ]) {
    for (const side of [-1, 1]) {
      const px = face.ax === 'x' ? side * pierInset : face.x;
      const pz = face.ax === 'z' ? side * pierInset : face.z;
      const pw = face.ax === 'x' ? 1.45 * s : 1.15 * s;
      const pd = face.ax === 'x' ? 1.15 * s : 1.45 * s;
      putBox(g, pw, shaft.h * 0.92, pd, px, shaft.y + shaft.h * 0.04, pz, bundPlain);
    }
    const depthAx = face.ax === 'x' ? 'z' : 'x';
    const sign = depthAx === 'z' ? Math.sign(face.z - tz) || 1 : Math.sign(face.x) || 1;
    for (const slot of [-1, 0, 1]) {
      for (const band of [0.22, 0.55]) {
        const wx = depthAx === 'z' ? slot * 2.7 * s : face.x;
        const wz = depthAx === 'x' ? slot * 2.7 * s : face.z;
        putWindow(g, 1.15 * s, 4.3 * s, wx, shaft.y + shaft.h * band, wz, {
          ax: depthAx, sign, reveal: 0.72 * s,
        });
      }
    }
  }
  const clock = placed['customs-clock'];
  placeClocks(g, clock.y + clock.h * 0.46, TW / 2, 2.7 * s, tz);
  const belfry = placed['customs-belfry'];
  for (const face of [
    { x: 0, z: tz + belfry.w / 2 + 0.05 * s, ax: 'x' },
    { x: 0, z: tz - belfry.w / 2 - 0.05 * s, ax: 'x' },
    { x: belfry.w / 2 + 0.05 * s, z: tz, ax: 'z' },
    { x: -belfry.w / 2 - 0.05 * s, z: tz, ax: 'z' },
  ]) {
    const depthAx = face.ax === 'x' ? 'z' : 'x';
    const sign = depthAx === 'z' ? Math.sign(face.z - tz) || 1 : Math.sign(face.x) || 1;
    for (const slot of [-1, 0, 1]) {
      const wx = depthAx === 'z' ? slot * 1.7 * s : face.x;
      const wz = depthAx === 'x' ? slot * 1.7 * s : face.z;
      putWindow(g, 0.85 * s, belfry.h * 0.5, wx, belfry.y + belfry.h * 0.24, wz, {
        ax: depthAx, sign, reveal: 0.4 * s,
      });
    }
  }

  // Corner urns on the stepped crown. They have to be large enough to break
  // the skyline from the river, the way the stone finials do in photographs.
  const urnAt = (x, y, z) => {
    putBox(g, 1.25 * s, 0.48 * s, 1.25 * s, x, y, z, bundPlain);
    const bowl = new THREE.SphereGeometry(0.72 * s, 12, 8);
    bowl.scale(1, 1.15, 1);
    bowl.translate(x, y + 1.25 * s, z);
    add(g, bowl, bundPlain);
    const neck = new THREE.CylinderGeometry(0.1 * s, 0.2 * s, 0.85 * s, 8);
    neck.translate(x, y + 2.25 * s, z);
    add(g, neck, bundPlain);
  };
  for (const stage of [placed['customs-clock'], placed['customs-belfry'], placed['customs-attic']]) {
    const o = stage.w / 2 - 0.15 * s;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) urnAt(sx * o, stage.y + stage.h, tz + sz * o);
    }
  }

  // Roof pavilions at the four corners, lower than the shaft.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * (W / 2 - 2.6 * s);
      const pz = sz * (D / 2 - 2.3 * s);
      putBox(g, 4.8 * s, 5.4 * s, 4.2 * s, px, block - 0.4 * s, pz, customsWall);
      putBox(g, 5.5 * s, 0.55 * s, 4.9 * s, px, block + 4.6 * s, pz, bundPlain);
    }
  }

  const poleH = Math.max(1.2 * s, h - yT);
  const pole = new THREE.CylinderGeometry(0.07 * s, 0.1 * s, poleH, 8);
  pole.translate(0, yT + poleH / 2, tz);
  add(g, pole, dark);
  const flag = new THREE.PlaneGeometry(2.3 * s, 1.45 * s);
  flag.translate(1.25 * s, yT + poleH * 0.82, tz);
  add(g, flag, flagMat);
  return g;
}

// 1923 HSBC, Bund 12 (now 上海浦东发展银行). Palmer & Turner.
// The river front is about 90 m, the widest on the Bund. Five storeys plus an
// attic; the wing cornice sits on the customs parapet line (33.9 m at h = 52,
// matching customs at 90 m). A central bay projects, with three pairs of giant
// Corinthian columns, a pediment, and the ribbed dome on a drum over that bay
// — shifted east of the footprint centroid so it reads from the river.
function hsbc(h) {
  const g = new THREE.Group();
  const s = h / 52;
  const W = 90;
  const D = 34;
  const front = 30;
  const zc = front - D / 2;
  // Ground, three floors inside the giant order, a fifth floor, then the
  // cornice. The cornice top is 33.9 m at h = 52, the customs cornice at h = 90.
  const baseH = 7.6 * s;
  const orderH = 21.2 * s;
  const fifthH = 3.5 * s;
  const corniceH = 1.6 * s;
  const corniceY = baseH + orderH + fifthH;
  const parapetTop = 36.2 * s;

  const block = putBox(g, W, baseH + orderH + fifthH, D, 0, 0, zc, customsWall);
  block.userData.part = 'hsbc-block';
  const cornice = putBox(g, W + 2.4, corniceH, D + 2.2, 0, corniceY, zc + 0.4, bundPlain);
  cornice.userData.part = 'hsbc-cornice';
  putCorniceRun(g, W * 0.98, corniceY, front + 0.15, s);
  putBox(g, W + 0.4, Math.max(0.8 * s, parapetTop - (corniceY + corniceH)), D + 0.4, 0, corniceY + corniceH, zc, customsWall);

  const bayW = 32;
  const bayD = 16;
  const bayFront = front + 3.2;
  const bayZ = bayFront - bayD / 2;
  putBox(g, bayW, baseH + orderH + fifthH, bayD, 0, 0, bayZ, customsWall);
  putBox(g, bayW + 1.6, corniceH, bayD + 1.4, 0, corniceY, bayZ + 0.3, bundPlain);

  // Channelled rustication on the ground floor, broken around doors and windows.
  const course = (x0, x1, z) => {
    if (x1 - x0 < 0.7) return;
    for (let i = 0; i < 4; i++) {
      putBox(g, x1 - x0, 0.22 * s, 0.4, (x0 + x1) / 2, 0.5 * s + i * 1.65 * s, z, bundPlain);
    }
  };
  const wingStops = [-44, -37.4, -34.6, -29.9, -27.1, -22.4, -19.6, -16.5];
  for (let i = 0; i < wingStops.length; i += 2) {
    course(wingStops[i], wingStops[i + 1], front + 0.28);
    course(-wingStops[i + 1], -wingStops[i], front + 0.28);
  }
  for (const [a, b] of [[-15.2, -10.2], [-6.2, -2.0], [2.0, 6.2], [10.2, 15.2]]) {
    course(a, b, bayFront + 0.22);
  }

  const wingBays = [-36, -28.5, -21, 21, 28.5, 36];
  for (const x of wingBays) {
    putBox(g, 1.15, orderH, 1.05, x, baseH, front + 0.15, bundPlain);
    for (let row = 0; row < 3; row++) {
      const rowH = orderH / 3;
      putWindow(g, 2.7, rowH * 0.62, x, baseH + row * rowH + rowH * 0.2, front, { reveal: 0.4, pediment: row === 0 });
    }
    putWindow(g, 2.15, 2.4 * s, x, baseH * 0.22, front, { reveal: 0.32 });
    putWindow(g, 2.2, fifthH * 0.62, x, baseH + orderH + fifthH * 0.18, front, { reveal: 0.28 });
    putWindow(g, 1.9, 1.35 * s, x, corniceY + corniceH + 0.25 * s, front, { reveal: 0.22 });
  }
  for (let side = 0; side < 4; side++) {
    const zz = zc - D * 0.32 + side * (D * 0.2);
    putWindow(g, 2.2, 3.4 * s, W / 2, baseH + 1.2 * s, zz, { ax: 'x', sign: 1, reveal: 0.3 });
    putWindow(g, 2.2, 3.4 * s, -W / 2, baseH + 1.2 * s, zz, { ax: 'x', sign: -1, reveal: 0.3 });
  }
  for (const x of [-10.5, -3.5, 3.5, 10.5]) {
    for (let row = 0; row < 3; row++) {
      const rowH = orderH / 3;
      putWindow(g, 2.15, rowH * 0.58, x, baseH + row * rowH + rowH * 0.2, bayFront, { reveal: 0.4, arch: row === 0 });
    }
    putWindow(g, 1.9, fifthH * 0.55, x, baseH + orderH + fifthH * 0.22, bayFront, { reveal: 0.28 });
  }
  for (const x of [-8.2, 0, 8.2]) {
    putWindow(g, 3.2, 5.4 * s, x, 0.7 * s, bayFront, { reveal: 0.45, arch: true });
  }

  // Three pairs of Corinthian columns, second to fourth storey.
  const colH = orderH - 0.8 * s;
  const colR = 0.72;
  const colY = baseH + 0.25 * s;
  const colZ = bayFront + 1.35;
  for (const cx of [-7.4, 0, 7.4]) {
    for (const side of [-0.72, 0.72]) {
      const x = cx + side;
      const cap = 1.7 * s;
      const shaftH = colH - cap;
      const shaft = new THREE.CylinderGeometry(colR * 0.92, colR, shaftH, 16);
      shaft.translate(x, colY + shaftH / 2, colZ);
      const mesh = add(g, shaft, bundPlain);
      mesh.userData.part = 'hsbc-column';
      putFlutes(g, x, colY, colZ, colR, shaftH);
      const bell = new THREE.CylinderGeometry(colR * 1.7, colR * 0.95, 1.15 * s, 12);
      bell.translate(x, colY + shaftH + 0.5 * s, colZ);
      add(g, bell, bundPlain);
      putBox(g, 2.15, 0.38 * s, 2.15, x, colY + shaftH + 1.05 * s, colZ, bundPlain);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          add(g, new THREE.SphereGeometry(0.22, 8, 6).translate(x + sx * 0.82, colY + shaftH + 0.85 * s, colZ + sz * 0.82), bundPlain);
        }
      }
    }
  }
  const entY = colY + colH;
  putBox(g, bayW + 1.2, 1.15 * s, 3.2, 0, entY, colZ, bundPlain);
  putBox(g, bayW + 2.4, 0.7 * s, 4.1, 0, entY + 1.15 * s, colZ, bundPlain);
  const pedY = entY + 1.85 * s;
  const ped = new THREE.Shape();
  ped.moveTo(-16.2, 0);
  ped.lineTo(16.2, 0);
  ped.lineTo(0, 5.6 * s);
  const pedGeo = new THREE.ExtrudeGeometry(ped, { depth: 2.4, bevelEnabled: false });
  pedGeo.translate(0, pedY, colZ - 0.4);
  add(g, pedGeo, bundPlain);

  // Drum and ribbed dome sit on the central bay, in front of the roof.
  const drumR = 8.6;
  const drumH = 6.8 * s;
  const drumY = parapetTop + 0.4 * s;
  // Centred on the projecting bay, just behind the column line, so the drum
  // reads as rising out of the portico rather than sitting inland of the roof.
  const domeZ = bayZ + 0.4;
  add(g, new THREE.CylinderGeometry(drumR * 0.94, drumR, drumH, 24).translate(0, drumY + drumH / 2, domeZ), bundPlain);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const colH = drumH * 0.82;
    add(g, new THREE.BoxGeometry(0.42, colH, 0.55).translate(Math.sin(a) * (drumR + 0.18), drumY + 0.45 * s + colH / 2, Math.cos(a) * (drumR + 0.18) + domeZ), bundPlain);
  }
  const ringH = 0.7 * s;
  const ringY = drumY + drumH;
  add(g, new THREE.CylinderGeometry(drumR * 1.08, drumR * 0.98, ringH, 28).translate(0, ringY + ringH / 2, domeZ), bundPlain);
  const domeR = drumR * 0.96;
  const domeY = ringY + ringH;
  const dome = new THREE.SphereGeometry(domeR, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(0, domeY, domeZ);
  const domeMesh = add(g, dome, bundPlain);
  domeMesh.userData.part = 'hsbc-dome';
  const ribUp = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    for (let k = 0; k < 4; k++) {
      const u0 = 0.06 + (k / 4) * 0.78;
      const u1 = 0.06 + ((k + 1) / 4) * 0.78;
      const at = (u) => new THREE.Vector3(Math.cos(u) * Math.sin(a), Math.sin(u), Math.cos(u) * Math.cos(a)).multiplyScalar(domeR * 1.015);
      const p0 = at(u0);
      const p1 = at(u1);
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const dir = p1.clone().sub(p0);
      const len = dir.length();
      const rib = new THREE.BoxGeometry(0.28, len, 0.2);
      rib.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(ribUp, dir.normalize()));
      rib.translate(mid.x, domeY + mid.y, domeZ + mid.z);
      add(g, rib, bundPlain);
    }
  }
  const lanY = domeY + domeR * 0.96;
  const lanR = 1.55;
  add(g, new THREE.CylinderGeometry(lanR * 1.15, lanR * 1.35, 0.4 * s, 14).translate(0, lanY, domeZ), bundPlain);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    putBox(g, 0.16, 1.85 * s, 0.18, Math.sin(a) * lanR, lanY + 0.15 * s, Math.cos(a) * lanR + domeZ, bundPlain);
  }
  const lantern = add(g, new THREE.CylinderGeometry(lanR * 0.82, lanR * 0.82, 1.55 * s, 12).translate(0, lanY + 0.95 * s, domeZ), bundGlass);
  lantern.userData.part = 'bund-glass';
  add(g, new THREE.CylinderGeometry(lanR * 1.3, lanR * 0.95, 0.42 * s, 14).translate(0, lanY + 1.9 * s, domeZ), bundPlain);
  add(g, new THREE.SphereGeometry(0.48, 10, 8).translate(0, lanY + 2.4 * s, domeZ), bundPlain);
  const finial = new THREE.ConeGeometry(0.14, 1.05 * s, 8);
  finial.translate(0, lanY + 3.15 * s, domeZ);
  const finialMesh = add(g, finial, bundPlain);
  finialMesh.userData.part = 'hsbc-finial';
  return g;
}

// 1929 Sassoon House: a narrow stone tower under a steep green copper pyramid.
function peace(h) {
  const g = new THREE.Group();
  const roofH = Math.max(19, h * 0.28);
  const wall = h - roofH;
  putBox(g, 28, 7, 22, 0, 0, 0, bundStone);
  putBox(g, 24, Math.max(4, wall - 13), 18, 0, 7, 0, bundStone);
  putBox(g, 22, 6, 16, 0, wall - 6, 0, bundStone);
  for (let i = -3; i <= 3; i++) {
    putBox(g, 0.7, wall - 8, 0.85, i * 3.3, 6.2, 9.4, bundPlain);
    putBox(g, 0.7, wall - 8, 0.85, i * 3.3, 6.2, -9.4, bundPlain);
  }
  const peaceRows = Math.max(4, Math.floor((wall - 16) / 3.6));
  for (let row = 0; row < peaceRows; row++) {
    for (let i = -2; i <= 2; i++) {
      putWindow(g, 1.7, 2.15, i * 3.3, 8.2 + row * 3.55, 9.05, { reveal: 0.32, pediment: row === 1 && i === 0 });
    }
  }
  putCorniceRun(g, 26, wall - 0.4, 12.2, 1);
  putBox(g, 30, 1.4, 24, 0, wall - 0.2, 0, bundStone);
  const roof = new THREE.CylinderGeometry(0.45, 13.2, roofH, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, wall + roofH / 2, 0);
  const mesh = add(g, roof, copperRoof);
  mesh.userData.part = 'peace-roof';
  return g;
}

// 1937 Bank of China: Art Deco setbacks and a blue-green Chinese hip roof.
function boc(h) {
  const g = new THREE.Group();
  const roofH = Math.max(13, h * 0.22);
  const body = h - roofH;
  putBox(g, 32, body * 0.48, 26, 0, 0, 0, bundStone);
  putBox(g, 26, body * 0.28, 21, 0, body * 0.48, 0, bundStone);
  putBox(g, 20, body * 0.24, 16, 0, body * 0.76, 0, bundStone);
  const bocRows = Math.max(5, Math.floor(body / 4.4));
  for (let row = 0; row < bocRows; row++) {
    for (let i = -2; i <= 2; i++) {
      putWindow(g, 1.7, 2.3, i * 4.2, 2.4 + row * (body * 0.78 / bocRows), 13.05, { reveal: 0.3 });
    }
  }
  putCorniceRun(g, 30, body - 0.5, 13.4, 1);
  putBox(g, 28, 1.15, 22, 0, body - 0.3, 0, glazeRoof);
  const hip = new THREE.CylinderGeometry(3.6, 11, roofH * 0.62, 4);
  hip.rotateY(Math.PI / 4);
  hip.translate(0, body + roofH * 0.28, 0);
  add(g, hip, glazeRoof);
  const cap = new THREE.CylinderGeometry(0.55, 3.8, roofH * 0.4, 4);
  cap.rotateY(Math.PI / 4);
  cap.translate(0, body + roofH * 0.78, 0);
  const capMesh = add(g, cap, glazeRoof);
  capMesh.userData.part = 'boc-roof';
  return g;
}

// A stone frontage: podium, shaft, cornice, and the one feature that
// distinguishes the building from the next one along the Bund.
function bundFront(g, spec) {
  const floorH = spec.floorH || 4.15;
  const h = spec.floors * floorH;
  const { w, d } = spec;
  putBox(g, w, h * 0.16, d, 0, 0, 0, bundStone);
  putBox(g, w * 0.96, h * 0.84, d * 0.92, 0, h * 0.16, 0, spec.body || bundStone);
  putBox(g, w * 1.05, 1.35, d * 1.04, 0, h - 1.15, 0, bundPlain);
  putCorniceRun(g, w * 0.96, h - 1.2, d * 0.5, 1);
  const rows = Math.max(3, (spec.floors || 5) - 1);
  const bays = Math.max(3, Math.round(w / 4.4));
  const y0 = h * 0.2;
  const rowH = (h * 0.62) / rows;
  for (let row = 0; row < rows; row++) {
    for (let b = 0; b < bays; b++) {
      const x = -w * 0.38 + (w * 0.76 * (b + 0.5)) / bays;
      putWindow(g, Math.min(2.3, (w * 0.7) / bays), rowH * 0.62, x, y0 + row * rowH, d * 0.47, {
        reveal: 0.3,
        pediment: row === 1 && b === Math.floor((bays - 1) / 2),
      });
    }
  }
  const cols = spec.cols || 0;
  if (cols > 0) {
    const y0c = h * (spec.colFrom || 0.2);
    const colH = h * ((spec.colTo || 0.78) - (spec.colFrom || 0.2));
    const xs = cols === 2
      ? [-2.4, 2.4]
      : Array.from({ length: cols }, (_, i) => -w * 0.36 + (w * 0.72 * i) / Math.max(1, cols - 1));
    for (const x of xs) {
      const r = 0.52;
      add(g, new THREE.CylinderGeometry(r * 0.9, r, colH * 0.86, 12).translate(x, y0c + colH * 0.43, d * 0.52), bundPlain);
      putFlutes(g, x, y0c, d * 0.52, r, colH * 0.86);
      const bell = new THREE.CylinderGeometry(r * 1.45, r * 0.95, r * 1.1, 10);
      bell.translate(x, y0c + colH * 0.86 + r * 0.4, d * 0.52);
      add(g, bell, bundPlain);
      putBox(g, r * 2.5, r * 0.36, r * 2.5, x, y0c + colH * 0.86 + r * 0.95, d * 0.52, bundPlain);
    }
  }
  if (spec.fins) {
    for (let i = 0; i < spec.fins; i++) {
      const x = -w * 0.4 + (w * 0.8 * i) / (spec.fins - 1);
      putBox(g, 0.42, h * 0.76, 0.7, x, h * 0.14, d * 0.48, bundPlain);
    }
  }
  if (spec.raise) putBox(g, w * 0.38, spec.raise, d * 0.62, 0, h, 0, bundStone);
  if (spec.pavilions) {
    const spots = spec.pavilions === 1 ? [0] : [-w * 0.32, w * 0.32];
    for (const x of spots) {
      putBox(g, w * 0.14, 5.2, d * 0.26, x, h, 0, bundStone);
      const cap = new THREE.ConeGeometry(w * 0.1, 3.4, 4);
      cap.rotateY(Math.PI / 4);
      cap.translate(x, h + 6.4, 0);
      add(g, cap, bundPlain);
    }
  }
  if (spec.dome) {
    const r = spec.dome;
    add(g, new THREE.CylinderGeometry(r * 0.7, r, 2.8, 16).translate(0, h + 1.4, 0), bundPlain);
    add(g, new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, h + 2.8, 0), bundPlain);
  }
  return g;
}

// Shanghai Club, now the Waldorf: a long baroque front and two roof pavilions.
function club(h) {
  const g = new THREE.Group();
  const s = h / 34;
  return bundFront(g, { w: 36 * s, d: 22 * s, floors: 6, floorH: 4.7 * s, cols: 6, pavilions: 2 });
}

// Union Building, Bund 4: a renaissance granite block with an ionic portal.
function union(h) {
  const g = new THREE.Group();
  const s = h / 32;
  return bundFront(g, { w: 32 * s, d: 22 * s, floors: 7, floorH: 4.15 * s, cols: 4 });
}

// Nissin Building, Bund 5: horizontal courses and a heavy cornice.
function nisshin(h) {
  const g = new THREE.Group();
  const s = h / 32;
  return bundFront(g, { w: 30 * s, d: 22 * s, floors: 7, floorH: 4.2 * s });
}

// Chartered Bank, Bund 18: two giant columns in the centre of the front.
function bund18(h) {
  const g = new THREE.Group();
  const s = h / 30;
  return bundFront(g, { w: 28 * s, d: 22 * s, floors: 6, floorH: 4.4 * s, cols: 2, colFrom: 0.18, colTo: 0.82 });
}

// Peace Hotel south building: a lower renaissance block with roof pavilions.
function peaceSouth(h) {
  const g = new THREE.Group();
  const s = h / 32;
  return bundFront(g, { w: 30 * s, d: 20 * s, floors: 6, floorH: 4.5 * s, cols: 5, pavilions: 2 });
}

// 1948 Bank of Communications, Bund 14, now the trade-union building.
// C. H. Gonda: a pale art-deco slab, black marble base, dense vertical fins,
// and a raised central section that steps back. The river face is shifted
// onto the east edge of the footprint, just north of the customs house.
function bocom(h) {
  const g = new THREE.Group();
  const s = h / 38;
  const W = 36;
  const D = 42;
  const front = 26;
  const zc = front - D / 2;
  const baseH = 4.6 * s;
  const shaftH = 25.2 * s;
  const bodyTop = baseH + shaftH;
  const body = putBox(g, W, bodyTop, D, 0, 0, zc, customsWall);
  body.userData.part = 'bocom-body';
  putBox(g, W + 0.3, baseH, D + 0.25, 0, 0, zc, marbleBase);
  putBox(g, W + 1.3, 0.7 * s, D + 1.1, 0, bodyTop - 0.2 * s, zc, bundPlain);

  const fins = 13;
  for (let i = 0; i < fins; i++) {
    const x = -W * 0.46 + (W * 0.92 * i) / (fins - 1);
    const tall = Math.abs(i - (fins - 1) / 2) < 2.2;
    putBox(g, 0.42, shaftH + (tall ? 3.2 * s : 0), 0.95, x, baseH, front - 0.15, bundPlain);
    if (i < fins - 1) {
      const wx = -W * 0.46 + (W * 0.92 * (i + 0.5)) / (fins - 1);
      for (let row = 0; row < 5; row++) {
        const rowH = shaftH / 5;
        putWindow(g, 1.25, rowH * 0.55, wx, baseH + row * rowH + rowH * 0.2, front, { reveal: 0.28 });
      }
    }
  }
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const z = zc - D * 0.36 + i * (D * 0.1);
      putBox(g, 0.7, shaftH * 0.92, 0.38, sign * (W / 2 + 0.15), baseH, z, bundPlain);
    }
  }
  putWindow(g, 5.4, 4.2 * s, 0, 0.35 * s, front, { reveal: 0.4, arch: true });
  putCorniceRun(g, W * 0.94, bodyTop - 0.15 * s, front, s);

  const towerW = 13.5;
  const tower = putBox(g, towerW, 5.4 * s, 14, 0, bodyTop, front - 8, customsWall);
  tower.userData.part = 'bocom-tower';
  putBox(g, towerW + 0.8, 0.45 * s, 14.6, 0, bodyTop + 5.1 * s, front - 8, bundPlain);
  for (let i = -2; i <= 2; i++) {
    putBox(g, 0.36, 5.2 * s, 0.7, i * 2.3, bodyTop, front - 1.3, bundPlain);
  }
  putBox(g, 8.2, 2.4 * s, 9, 0, bodyTop + 5.4 * s, front - 8, customsWall);
  putBox(g, 8.8, 0.4 * s, 9.6, 0, bodyTop + 7.5 * s, front - 8, bundPlain);
  return g;
}

// Taiwan Bank, now the merchants' bank on this block: a temple front of four columns.
function merchants(h) {
  const g = new THREE.Group();
  const s = h / 28;
  return bundFront(g, { w: 24 * s, d: 20 * s, floors: 6, floorH: 4.2 * s, cols: 4 });
}

// Jardine Matheson, Bund 27: a corinthian centre and a dome on the roof screen.
function jardine(h) {
  const g = new THREE.Group();
  const s = h / 38;
  return bundFront(g, { w: 34 * s, d: 24 * s, floors: 7, floorH: 4.5 * s, cols: 4, dome: 5.2 * s });
}

// Banque de l'Indochine, Bund 29: a French front with a giant ionic order.
function indochine(h) {
  const g = new THREE.Group();
  const s = h / 30;
  return bundFront(g, { w: 22 * s, d: 24 * s, floors: 6, floorH: 4.4 * s, cols: 4 });
}

// Bund 1, the former Asia Building: a stone block with a corner dome.
function asia(h) {
  const g = new THREE.Group();
  const s = h / 32;
  bundFront(g, { w: 36 * s, d: 22 * s, floors: 6, floorH: 4.5 * s, cols: 5 });
  const x = 13 * s;
  add(g, new THREE.CylinderGeometry(3.1 * s, 3.5 * s, 3.6 * s, 12).translate(x, h + 1.8 * s, 5 * s), bundPlain);
  add(g, new THREE.SphereGeometry(3.3 * s, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, h + 3.6 * s, 5 * s), bundPlain);
  return g;
}

// Russo-Chinese Bank, now the foreign-exchange centre: a short block and a cupola.
function russo(h) {
  const g = new THREE.Group();
  const s = h / 26;
  return bundFront(g, { w: 32 * s, d: 22 * s, floors: 5, floorH: 4.3 * s, cols: 4, dome: 4.2 * s });
}

// Yokohama Specie Bank, the low ICBC block just north of the Bank of China.
function yokohama(h) {
  const g = new THREE.Group();
  const s = h / 32;
  return bundFront(g, { w: 34 * s, d: 22 * s, floors: 6, floorH: 4.4 * s, cols: 6 });
}

const BUILDERS = {
  pearl, shanghai, swfc, jinmao, customs, magnolia, hsbc, peace, boc,
  club, union, nisshin, bund18, peaceSouth, bocom, merchants, jardine, indochine,
  asia, russo, yokohama,
};

export const landmarkNight = { pearlMat, pearlBand, beaconMat, clockMat };

export function createLandmarks(list) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  for (const item of list || []) {
    const build = BUILDERS[item.id];
    if (!build) continue;
    const model = build(item.h);
    model.position.set(item.x, item.y, item.z);
    // SWFC's footprint is nearly square, so the longest edge does not say which
    // face holds the aperture. The opening faces the river, southwest.
    const faceRiver = /^(customs|hsbc|peace|boc|club|union|nisshin|bund18|peaceSouth|bocom|merchants|jardine|indochine|asia|russo|yokohama)$/.test(item.id);
    model.rotation.y = item.id === 'swfc' ? -Math.PI / 4 : faceRiver ? Math.PI / 2 : (item.yaw || 0);
    model.userData.landmark = item;
    group.add(model);
  }
  return group;
}

export function syncPearlShow(hour, pin) {
  const show = pearlShow(hour, pin);
  cityUniforms.uShowScheme.value = show.scheme;
  cityUniforms.uShowNext.value = show.next;
  cityUniforms.uShowFade.value = show.fade;
  cityUniforms.uShowPhase.value = show.pattern;
  const rgb = SCHEME_RGB[show.scheme];
  const nxt = SCHEME_RGB[show.next];
  const mix = (i) => rgb[i] * (1 - show.fade) + nxt[i] * show.fade;
  beamMat.uniforms.uColor.value.setRGB(mix(0), mix(1), mix(2));
  legMat.emissive.setRGB(mix(0) * 0.8, mix(1) * 0.8, mix(2) * 0.8);
  pearlBand.emissive.setRGB(mix(0), mix(1), mix(2));
  beaconMat.emissive.setRGB(mix(0), mix(1), mix(2));
  const crown = CROWN_RGB[show.scheme];
  shanghaiCrownMat.emissive.setRGB(crown[0], crown[1], crown[2]);
  swfcEdgeMat.emissive.setRGB(0.72 + rgb[0] * 0.22, 0.88, 1);
}

export function syncLandmarkNight(night) {
  pearlMat.emissiveIntensity = 0;
  pearlBand.emissiveIntensity = 0.02 + night * 1.35;
  columnMat.emissiveIntensity = night * 1.15;
  legMat.emissiveIntensity = night * 1.7;
  shanghaiCrownMat.emissiveIntensity = night * 2.8;
  swfcEdgeMat.emissiveIntensity = night * 0.22;
  bundStone.emissiveIntensity = 0;
  bundPlain.emissiveIntensity = 0;
  customsWall.emissiveIntensity = 0;
  copperRoof.emissiveIntensity = night * 0.22;
  glazeRoof.emissiveIntensity = night * 0.18;
  beaconMat.emissiveIntensity = 0.35 + night * 2;
  clockMat.emissiveIntensity = night * 0.62;
}
