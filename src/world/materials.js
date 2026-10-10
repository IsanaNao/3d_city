import * as THREE from 'three';

export const cityUniforms = {
  uNight: { value: 0 },
  uDay: { value: 1 },
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2) },
  uSky: { value: new THREE.Color('#d7e8f4') },
  uHorizon: { value: new THREE.Color('#d7e8f4') },
};

// Windows are laid out per wall: vWall.x is metres along the wall and vWall.y
// its length, so every wall holds a whole number of columns and corners are
// never cut through a window. Edges are anti-aliased with screen derivatives,
// and when a window shrinks below a couple of pixels the grid fades to its
// average brightness instead of aliasing into speckle.
const FACADE = /* glsl */`
  vec3 wn = normalize(vWn);
  float hgt = max(vTop - vBase, 0.5);
  float hh = vWorld.y - vBase;
  float kind = floor(vKind + 0.5);
  // Interpolated per-building constants drift by a few ulps across a
  // triangle; the hash would turn that drift into per-pixel noise.
  float seed = floor(vSeed + 0.5);
  bool isRoof = vWall.y < 0.0;
  if (isRoof) {
    if (wn.y > 0.62) diffuseColor.rgb *= vec3(0.62, 0.60, 0.57);
  } else if (hh > 0.15 && hh < hgt - 0.12) {
    float floorH = 3.35;
    float pitch = 3.9;
    float winW = 0.5;
    float winH = 0.56;
    float glassMix = 0.22;
    float curtain = 0.0;
    vec3 warm = vec3(1.0, 0.68, 0.36);
    vec3 cool = vec3(1.0, 0.86, 0.66);
    if (kind < 0.5) { floorH = 3.4; pitch = 4.2; winW = 0.42; winH = 0.48; }
    else if (kind < 1.5) { floorH = 3.02; pitch = 3.2; winW = 0.5; winH = 0.58; warm = vec3(1.0, 0.62, 0.3); }
    else if (kind < 2.5) { floorH = 3.9; pitch = 3.0; winW = 0.7; winH = 0.68; glassMix = 0.48; cool = vec3(0.82, 0.9, 1.0); }
    else if (kind < 3.5) { floorH = 3.6; pitch = 3.8; winW = 0.58; winH = 0.6; }
    else if (kind < 4.5) { floorH = 5.2; pitch = 6.5; winW = 0.32; winH = 0.36; }
    else if (kind < 5.5) { floorH = 4.2; pitch = 1.8; winW = 0.9; winH = 0.84; glassMix = 0.75; curtain = 1.0; cool = vec3(0.8, 0.9, 1.0); }
    else { floorH = 3.9; pitch = 2.9; winW = 0.38; winH = 0.62; warm = vec3(1.0, 0.6, 0.28); }
    if (vWall.z > 0.5) { floorH = 3.9; pitch = 1.6; winW = 0.92; winH = 0.84; glassMix = 0.72; curtain = 1.0; }

    bool shop = ((kind > 2.5 && kind < 3.5) || (kind > 5.5 && hgt < 60.0)) && hh > 0.65 && hh < 4.2;
    float cols = max(1.0, floor(vWall.y / pitch + 0.5));
    float cellW = max(vWall.y, 0.5) / cols;
    vec2 cell = vec2(vWall.x / cellW, hh / floorH);
    vec2 fw = max(fwidth(cell), vec2(1e-4));
    vec2 id = floor(cell);
    vec2 f = fract(cell);
    float lod = smoothstep(0.22, 0.55, max(fw.x, fw.y));

    if (shop) {
      float u = vWall.x * 0.11 + seed * 0.01;
      float stripe = smoothstep(0.78, 0.8, fract(u)) * (1.0 - smoothstep(0.98, 1.0, fract(u)));
      stripe = mix(stripe, 0.2, smoothstep(0.3, 0.8, fwidth(u)));
      vec3 sign = mix(vec3(0.55, 0.1, 0.12), vec3(0.08, 0.2, 0.38), step(0.5, fract(seed * 0.013)));
      sign = mix(sign, vec3(0.95, 0.9, 0.78), 0.55 + stripe * 0.45);
      diffuseColor.rgb = sign;
      totalEmissiveRadiance += sign * uNight * 0.85;
    } else {
      vec2 halfSize = vec2(winW, winH) * 0.5;
      vec2 inside = clamp((halfSize - abs(f - 0.5)) / fw + 0.5, 0.0, 1.0);
      float mask = inside.x * inside.y;
      float coverage = winW * winH;
      mask = mix(mask, coverage, lod);

      float rnd = hash12(id + vec2(seed * 7.13, seed * 3.71));
      float tone = hash12(id.yx * 1.31 + seed);
      float floorMood = hash12(vec2(floor(id.y / 2.0) + seed * 0.37, seed * 1.91));
      float share = uNight * (curtain > 0.5 ? 0.36 : 0.44) * (0.35 + 1.3 * floorMood);
      float on = step(rnd, share) * step(0.06, fract(rnd * 13.0 + uTime * 0.02));
      on = mix(on, share, lod);
      vec3 litCol = mix(warm, cool, step(0.62, tone));
      litCol *= 0.7 + 0.45 * fract(rnd * 31.7);
      float ceiling = mix(0.82 + 0.3 * smoothstep(0.2, 0.5 + halfSize.y, f.y), 1.0, lod);

      vec3 viewDir = normalize(-vViewPosition);
      float fres = pow(1.0 - max(dot(normalize(normal), viewDir), 0.0), 3.0);
      vec3 glassDay = mix(vec3(0.05, 0.07, 0.09), uSky, glassMix * 0.6 + fres * 0.35);
      vec3 glassNight = vec3(0.025, 0.03, 0.04);
      vec3 pane = mix(glassDay, glassNight, uNight);

      float slab = 1.0 - clamp((abs(f.y - 0.04) - 0.04) / fw.y + 0.5, 0.0, 1.0);
      slab = mix(slab, 0.08, lod);
      vec3 wall = diffuseColor.rgb * (1.0 - 0.22 * slab);
      if (curtain > 0.5) {
        wall = mix(diffuseColor.rgb * 0.55, pane, 0.55);
        wall = mix(wall, wall * 0.6, slab);
      }

      vec3 lit = litCol * on;
      diffuseColor.rgb = mix(wall, mix(pane, lit * 0.35, on), mask);
      totalEmissiveRadiance += lit * mask * ceiling * 1.05;
    }
  }
`;

function patchFacade(shader) {
  Object.assign(shader.uniforms, cityUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute float aSeed;
      attribute float aBase;
      attribute float aTop;
      attribute float aKind;
      attribute vec3 aWall;
      varying float vSeed;
      varying float vBase;
      varying float vTop;
      varying float vKind;
      varying vec3 vWall;
      varying vec3 vWorld;
      varying vec3 vWn;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vWall = aWall;
      vSeed = aSeed;
      vBase = aBase;
      vTop = aTop;
      vKind = aKind;
      vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vWn = normalize(mat3(modelMatrix) * normal);`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uNight;
      uniform float uDay;
      uniform float uTime;
      uniform vec3 uSky;
      varying float vSeed;
      varying float vBase;
      varying float vTop;
      varying float vKind;
      varying vec3 vWall;
      varying vec3 vWorld;
      varying vec3 vWn;
      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      ${FACADE}`);
}

export function createBuildingMaterial() {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = patchFacade;
  material.customProgramCacheKey = () => 'sh-facade-2';
  return material;
}

const ROAD = /* glsl */`
  float cls = vCls;
  float across = vRoad.x;
  float along = vRoad.y;
  vec3 col = vec3(0.23, 0.235, 0.245);
  if (cls < 0.5) col = vec3(0.18, 0.185, 0.2);
  if (vFlags > 0.5 && vFlags < 1.5) col *= 0.42;
  if (cls > 7.5 && cls < 8.5) {
    col = vec3(0.62, 0.6, 0.56);
  } else if (cls > 6.5 && cls < 7.5) {
    float stripe = step(0.48, fract(along * 0.62));
    col = mix(vec3(0.22, 0.225, 0.24), vec3(0.86, 0.86, 0.82), stripe);
    totalEmissiveRadiance += col * uNight * 0.18;
  } else if (cls > 8.5 && cls < 9.5) {
    col = vec3(0.15, 0.15, 0.16);
    float sleeper = step(0.62, fract(along * 0.85));
    col = mix(col, vec3(0.42, 0.3, 0.2), sleeper * 0.85);
    float rail = 1.0 - smoothstep(0.015, 0.045, abs(abs(across) - 0.62));
    col = mix(col, vec3(0.72, 0.73, 0.75), rail);
    if (vFlags > 1.5) totalEmissiveRadiance += vec3(0.25, 0.55, 0.85) * uNight * 0.45;
  } else if (vFlags < 0.5) {
    float edgeLine = 1.0 - smoothstep(0.0, 0.035, abs(abs(across) - 0.9));
    float dash = step(0.45, fract(along / 9.0));
    float center = (1.0 - smoothstep(0.0, 0.03, abs(across))) * dash;
    if (cls > 4.5) center *= 0.25;
    col = mix(col, vec3(0.9, 0.9, 0.86), clamp(edgeLine + center, 0.0, 1.0));
  }
  diffuseColor.rgb = col;
`;

export function createRoadMaterial() {
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cityUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aRoad;
        attribute float aCls;
        attribute float aFlags;
        varying vec2 vRoad;
        varying float vCls;
        varying float vFlags;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRoad = aRoad;
        vCls = aCls;
        vFlags = aFlags;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight;
        varying vec2 vRoad;
        varying float vCls;
        varying float vFlags;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${ROAD}`);
  };
  material.customProgramCacheKey = () => 'sh-road-1';
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  return material;
}

export function createWaterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    uniforms: cityUniforms,
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uNight;
      uniform vec3 uSky;
      uniform vec3 uSunDir;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec3 n = normalize(vNormal);
        float w1 = sin(vWorld.x * 0.07 + uTime * 0.55) * cos(vWorld.z * 0.05 - uTime * 0.35);
        float w2 = sin(vWorld.x * 0.19 - uTime * 0.28 + vWorld.z * 0.15);
        n = normalize(n + vec3(w1, 0.0, w2) * 0.09);
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 2.5);
        vec3 deep = mix(vec3(0.05, 0.22, 0.3), vec3(0.02, 0.05, 0.08), uNight);
        vec3 col = mix(deep, uSky, fres * 0.72);
        vec3 h = normalize(normalize(uSunDir) + viewDir);
        float spec = pow(max(dot(n, h), 0.0), 90.0) * (1.0 - uNight * 0.65);
        col += spec * vec3(1.0, 0.95, 0.85);
        gl_FragColor = vec4(col, 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: cityUniforms,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uSky;
      uniform vec3 uHorizon;
      uniform vec3 uSunDir;
      uniform float uDay;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y * 0.85 + 0.08, 0.0, 1.0);
        vec3 col = mix(uHorizon, uSky, smoothstep(0.0, 0.75, h));
        float sun = pow(max(dot(dir, normalize(uSunDir)), 0.0), mix(40.0, 900.0, uDay));
        col += vec3(1.0, 0.9, 0.7) * sun * (0.4 + uDay);
        if (dir.y < 0.0) col = mix(col, uHorizon * 0.75, clamp(-dir.y * 3.0, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

export function makeCircleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const SIGN_NAMES = ['江边面馆', '浦江茶室', '石库门', '外滩书店', '晨光旅馆', '南市菜场', '明珠咖啡', '老城厢'];
const SIGN_COLORS = ['#8d2e2b', '#1d4e89', '#8a5a22', '#1f6a4e', '#6d2d4d', '#a15c28', '#243044', '#7a1e2d'];

export function makeSignAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.font = '700 22px "WenQuanYi Micro Hei", "Droid Sans Fallback", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < 8; i++) {
    const x = i * 128;
    g.fillStyle = SIGN_COLORS[i];
    g.fillRect(x, 0, 128, 128);
    g.fillStyle = '#fff6e4';
    g.fillRect(x + 8, 16, 112, 96);
    g.fillStyle = SIGN_COLORS[i];
    const name = SIGN_NAMES[i];
    if (name.length <= 4) {
      g.fillText(name.slice(0, 2), x + 64, 48);
      g.fillText(name.slice(2), x + 64, 82);
    } else {
      g.font = '700 18px "WenQuanYi Micro Hei", "Droid Sans Fallback", sans-serif';
      g.fillText(name, x + 64, 64);
      g.font = '700 22px "WenQuanYi Micro Hei", "Droid Sans Fallback", sans-serif';
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}
