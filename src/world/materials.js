import * as THREE from 'three';

export const cityUniforms = {
  uNight: { value: 0 },
  uDay: { value: 1 },
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2) },
  uSky: { value: new THREE.Color('#d7e8f4') },
  uHorizon: { value: new THREE.Color('#d7e8f4') },
};

const FACADE = /* glsl */`
  vec3 wn = normalize(vWn);
  float hgt = max(vTop - vBase, 0.5);
  float hh = vWorld.y - vBase;
  float kind = vKind;
  if (wn.y > 0.62) {
    diffuseColor.rgb *= vec3(0.62, 0.60, 0.57);
  } else if (hh > 0.15 && hh < hgt - 0.12) {
    float floorH = 3.35;
    float pitch = 3.9;
    float winW = 0.48;
    float winH = 0.55;
    float glassMix = 0.22;
    vec3 litCol = vec3(1.0, 0.72, 0.36);
    if (kind < 0.5) { floorH = 3.4; pitch = 4.5; winW = 0.4; winH = 0.46; }
    else if (kind < 1.5) { floorH = 3.02; pitch = 3.15; winW = 0.52; winH = 0.6; litCol = vec3(1.0, 0.66, 0.32); }
    else if (kind < 2.5) { floorH = 3.9; pitch = 3.5; winW = 0.64; winH = 0.72; glassMix = 0.48; litCol = vec3(0.78, 0.88, 1.0); }
    else if (kind < 3.5) { floorH = 3.6; pitch = 4.15; winW = 0.56; winH = 0.6; litCol = vec3(1.0, 0.78, 0.42); }
    else if (kind < 4.5) { floorH = 5.2; pitch = 8.0; winW = 0.3; winH = 0.38; litCol = vec3(1.0, 0.84, 0.55); }
    else if (kind < 5.5) { floorH = 4.2; pitch = 2.2; winW = 0.84; winH = 0.88; glassMix = 0.75; litCol = vec3(0.7, 0.86, 1.0); }
    else { floorH = 3.8; pitch = 2.6; winW = 0.36; winH = 0.64; litCol = vec3(1.0, 0.6, 0.28); }

    bool shop = false;
    if (((kind > 2.5 && kind < 3.5) || (kind > 5.5 && hgt < 60.0)) && hh > 0.65 && hh < 4.2) shop = true;
    if (shop) {
      float stripe = step(0.8, fract(vWorld.x * 0.09 + vWorld.z * 0.07 + vSeed * 0.01));
      vec3 sign = mix(vec3(0.55, 0.1, 0.12), vec3(0.08, 0.2, 0.38), step(0.5, fract(vSeed * 0.013)));
      sign = mix(sign, vec3(0.95, 0.9, 0.78), 0.55 + stripe * 0.45);
      diffuseColor.rgb = sign;
      totalEmissiveRadiance += sign * uNight * 1.05;
    } else {
      float along = abs(wn.x) > abs(wn.z) ? vWorld.z : vWorld.x;
      along += vSeed * 0.37;
      float colId = floor(along / pitch);
      float fx = fract(along / pitch);
      float fy = fract(hh / floorH);
      float mx = (1.0 - winW) * 0.5;
      float my = (1.0 - winH) * 0.5;
      if (fx > mx && fx < 1.0 - mx && fy > my && fy < 1.0 - my) {
        float row = floor(hh / floorH);
        float rnd = hash12(vec2(colId + vSeed, row * 1.7));
        float flick = step(0.08, fract(rnd * 9.0 + uTime * 0.035));
        float lit = step(0.4, rnd) * flick * uNight;
        vec3 glass = mix(vec3(0.035, 0.05, 0.07), uSky, glassMix * 0.65);
        diffuseColor.rgb = mix(glass, litCol, lit);
        totalEmissiveRadiance += litCol * lit * 1.45;
      } else if (fy < 0.055) {
        diffuseColor.rgb *= 0.8;
      }
    }
    if (kind > 4.5 && kind < 5.5) {
      vec3 viewDir = normalize(-vViewPosition);
      float fres = pow(1.0 - max(dot(normalize(normal), viewDir), 0.0), 2.6);
      diffuseColor.rgb = mix(diffuseColor.rgb, uSky, fres * 0.62);
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
      varying float vSeed;
      varying float vBase;
      varying float vTop;
      varying float vKind;
      varying vec3 vWorld;
      varying vec3 vWn;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
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
  material.customProgramCacheKey = () => 'sh-facade-1';
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
