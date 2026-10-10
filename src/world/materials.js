import * as THREE from 'three';

export const cityUniforms = {
  uNight: { value: 0 },
  uDark: { value: 0 },
  uDay: { value: 1 },
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2) },
  uSunGlint: { value: new THREE.Color(0, 0, 0) },
  uSky: { value: new THREE.Color(0.17, 0.33, 0.62) },
  uHorizon: { value: new THREE.Color(0.68, 0.76, 0.85) },
  // Sky colours are display values; this brings them into scene radiance.
  uSkyGain: { value: 1 },
  uCloudCover: { value: 0 },
  uNightBlue: { value: 0.45 },
  uLampOn: { value: 0 },
  uLampMap: { value: null },
  uLampRect: { value: new THREE.Vector4(0, 0, 1, 0) },
  uMirror: { value: null },
  uMirrorMatrix: { value: new THREE.Matrix4() },
  uMirrorOn: { value: 0 },
};

const NOISE = /* glsl */`
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float box(float x, float a, float b, float w) {
  return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x);
}
vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
`;

// Street lamps and headlights are drawn from straight above into a light map
// (lamplight.js); every surface facing the sky takes its lamp light from it.
const LAMP_PARS = /* glsl */`
uniform float uLampOn;
uniform sampler2D uLampMap;
uniform vec4 uLampRect;
`;
const LAMP_READ = /* glsl */`
#include <lights_fragment_end>
if (uLampOn > 0.5) {
  vec2 lampUv = vec2(vWorld.x - uLampRect.x, uLampRect.y - vWorld.z) / (2.0 * uLampRect.z) + 0.5;
  vec2 lampEdge = smoothstep(vec2(0.0), vec2(0.04), lampUv) * (1.0 - smoothstep(vec2(0.96), vec2(1.0), lampUv));
  float lampUp = smoothstep(0.25, 0.7, normalize(vWn).y);
  reflectedLight.directDiffuse += texture2D(uLampMap, lampUv).rgb * lampEdge.x * lampEdge.y * lampUp * material.diffuseColor;
}
`;

const WORLD_VERT_PARS = 'varying vec3 vWorld;\nvarying vec3 vWn;';
const WORLD_VERT_SET = 'vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWn = normalize(mat3(modelMatrix) * objectNormal);';

// ---------------------------------------------------------------- facade
// Windows are laid out per wall: vWall.x is metres along the wall and vWall.y
// its length, so every wall holds a whole number of bays and corners never cut
// through a window. Edges are anti-aliased with screen derivatives; when a
// window shrinks to a pixel or two the grid fades to its average.
const FACADE_PARS = /* glsl */`
uniform float uNight;
uniform float uDark;
uniform float uTime;
uniform float uNightBlue;
uniform vec3 uSunDir;
uniform vec3 uSunGlint;
varying float vSeed;
varying float vBase;
varying float vTop;
varying float vKind;
varying vec3 vWall;
${WORLD_VERT_PARS}
float gRough, gMetal;
vec3 gEmissive = vec3(0.0);
vec3 gGlint = vec3(0.0);
${NOISE}
`;

const FACADE_MAIN = /* glsl */`
{
  vec3 gN = normalize(vWn);
  vec3 gT = abs(gN.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), gN));
  vec3 gB = cross(gN, gT);
  float height = max(vTop - vBase, 0.5);
  float v = vWorld.y - vBase;
  float kind = floor(vKind + 0.5);
  // Interpolated per-building constants drift by a few ulps; hash only integers.
  float seed = floor(vSeed + 0.5);
  float sf = seed / 997.0;
  bool isRoof = vWall.y < 0.0;
  bool glassy = vWall.z > 0.5 || kind > 4.5 && kind < 5.5;
  vec3 wall = pow(diffuseColor.rgb, vec3(2.2));
  vec2 st = isRoof ? vWorld.xz : vec2(vWall.x, vWorld.y);
  wall *= 0.9 + 0.2 * vnoise(st * 0.11 + seed * 0.37);
  wall *= 0.95 + 0.1 * vnoise(st * vec2(1.7, 3.1) + seed);
  gRough = 0.86; gMetal = 0.0;

  if (isRoof) {
    if (gN.y > 0.62) {
      // concrete roofs: lighter and greyer than the walls, with patched membranes
      float patchy = vnoise(vWorld.xz * 0.18 + seed);
      wall = mix(wall, vec3(dot(wall, vec3(0.3, 0.59, 0.11))) * vec3(1.0, 0.99, 0.97), 0.55) * (0.5 + 0.18 * patchy);
      gRough = 0.92;
    }
  } else {
    if (!glassy) {
      // rain streaks, a dirty base, run-off under the roofline
      float streak = vnoise(vec2(st.x * 2.2, st.y * 0.13 + seed * 0.4));
      float grime = smoothstep(0.55, 0.95, streak) * 0.1
        + (1.0 - smoothstep(0.0, 1.6, v)) * 0.12
        + smoothstep(height - 2.5, height, v) * streak * 0.14;
      wall *= 1.0 - grime;
    }
    // Bund stonework is floodlit from below at night.
    if (kind > 5.5) gEmissive += wall * vec3(1.0, 0.66, 0.32) * uNight * (0.16 + 0.34 * (1.0 - smoothstep(0.0, height, v)));
  }
  diffuseColor.rgb = wall;

  if (!isRoof && v > 0.0 && v < height - 0.6) {
    float floorH = 3.35, pitch = 3.9;
    vec4 r = vec4(0.14, 0.86, 0.3, 0.82);
    float office = 0.0;
    if (kind < 0.5) { floorH = 3.4; pitch = 4.2; r = vec4(0.22, 0.78, 0.32, 0.8); }
    else if (kind < 1.5) { floorH = 3.0; pitch = 3.3; r = vec4(0.16, 0.84, 0.3, 0.8); }
    else if (kind < 2.5) { floorH = 3.9; pitch = 3.0; r = vec4(0.08, 0.92, 0.28, 0.86); office = 1.0; }
    else if (kind < 3.5) { floorH = 3.8; pitch = 3.6; r = vec4(0.12, 0.88, 0.3, 0.82); office = 1.0; }
    else if (kind < 4.5) { floorH = 5.2; pitch = 6.5; r = vec4(0.3, 0.7, 0.55, 0.8); }
    else if (kind < 5.5) { office = 1.0; }
    else { floorH = 4.4; pitch = 3.4; r = vec4(0.3, 0.7, 0.24, 0.84); office = 1.0; }
    if (glassy) { floorH = 3.9; pitch = 1.5; r = vec4(0.0, 1.0, 0.24, 1.0); office = 1.0; }

    float cols = max(1.0, floor(vWall.y / pitch + 0.5));
    float cellW = max(vWall.y, 0.5) / cols;
    float u = vWall.x / cellW;
    float fyAll = v / floorH, row = floor(fyAll), col = floor(u);
    vec2 room = vec2(col + mod(seed, 61.0) * 17.0, row + mod(seed, 53.0) * 13.0);
    float fx = fract(u), fy = fract(fyAll);
    float wx = max(fwidth(u), 1e-4), wy = max(fwidth(fyAll), 1e-4);
    float far = smoothstep(0.2, 0.6, max(wx, wy));

    bool shop = row < 0.5 && (kind > 2.5 && kind < 3.5 || kind > 5.5 && height < 40.0 || kind < 0.5 && height < 24.0);
    if (shop) r = vec4(0.05, 0.95, 0.03, 0.8);
    float valid = 1.0;
    if (kind < 1.5 && !shop) valid *= step(0.18, hash12(room + 41.0));
    float inWin = box(fx, r.x, r.y, wx) * box(fy, r.z, r.w, wy) * valid;

    // frame and mullions, in metres from the window edge
    vec2 wmin = vec2(r.x * cellW, r.z * floorH), wmax = vec2(r.y * cellW, r.w * floorH);
    vec2 pm = vec2(fx * cellW, fy * floorH);
    float edge = min(min(pm.x - wmin.x, wmax.x - pm.x), min(pm.y - wmin.y, wmax.y - pm.y));
    float fw = glassy ? 0.045 : 0.065, ew = max(fwidth(edge), 1e-4);
    float frame = 1.0 - smoothstep(fw - ew, fw + ew, edge);
    float panes = max(1.0, floor((wmax.x - wmin.x) / 1.25 + 0.5));
    float mx = fract((pm.x - wmin.x) / max(wmax.x - wmin.x, 0.01) * panes);
    float mw = 0.03 * panes / max(wmax.x - wmin.x, 0.01);
    frame = max(frame, panes > 1.5 ? 1.0 - box(mx, mw, 1.0 - mw, max(fwidth(mx), 1e-4)) : 0.0);
    frame *= 1.0 - far;
    float pane = inWin * (1.0 - frame);

    // interior mapping: the view ray meets a room box behind the glass
    vec3 V = normalize(vWorld - cameraPosition);
    vec3 rd = vec3(dot(V, gT) / cellW, dot(V, gB) / floorH, dot(V, gN) / 4.5) + vec3(1e-5, 1e-5, 0.0);
    vec3 ro = vec3(fx, fy, 0.0);
    vec2 tA = (step(0.0, rd.xy) - ro.xy) / rd.xy;
    float tz = -1.0 / min(rd.z, -1e-4);
    float tHit = min(min(tA.x, tA.y), tz);
    vec3 hp = ro + rd * tHit;
    float rh = hash12(room);
    vec3 interior = mix(vec3(0.74, 0.69, 0.6), vec3(0.6, 0.63, 0.68), rh);
    float shade = 0.62;
    if (tHit == tz) shade = 0.5 + 0.28 * step(0.42, hp.y);
    else if (tHit == tA.y) shade = rd.y > 0.0 ? 1.0 : 0.38;
    interior *= shade * mix(1.0, 0.5, clamp(-hp.z, 0.0, 1.0));
    float blind = step(0.5, hash12(room + 7.7)) * hash12(room + 3.1);
    float wyLocal = (fy - r.z) / (r.w - r.z);
    if (!shop && wyLocal > 1.0 - blind * 0.85) interior = mix(vec3(0.8, 0.78, 0.72), vec3(0.68, 0.7, 0.74), rh) * 0.75;
    interior = mix(interior, vec3(0.42, 0.42, 0.4), far);

    // lit rooms: shops and offices more often than homes; no two buildings alike
    float onRate = shop ? 0.75 : office > 0.5 ? 0.32 : 0.24;
    float b1 = fract(sf * 11.7), b2 = fract(sf * 17.3), b3 = fract(sf * 23.9);
    onRate *= mix(0.35, 1.9, b1);
    if (!shop && office > 0.5 && b2 > 0.4) onRate = mix(0.05, 0.9, step(0.5, hash12(vec2(row * 3.0 + mod(seed, 37.0), mod(seed, 53.0)))));
    // a tower at night is mostly dark glass, with a few storeys lit as bands
    float tall = smoothstep(70.0, 110.0, height);
    if (!shop) onRate = mix(onRate, 0.03 + 0.8 * step(0.88, hash12(vec2(row * 5.0 + mod(seed, 41.0), mod(seed, 59.0)))), tall);
    onRate = clamp(onRate, 0.0, 0.95);
    float slot = floor(uTime / (90.0 + 240.0 * hash12(room + 37.0)) + hash12(room + 41.0) * 64.0);
    float fickle = step(0.6, hash12(room + 31.0));
    float on = step(1.0 - onRate, hash12(room + 23.0 + fickle * vec2(mod(slot, 61.0) * 7.13, mod(slot, 47.0) * 3.71)));

    float tint = hash12(room + 61.0);
    vec3 warm = mix(vec3(1.0, 0.6, 0.3), vec3(1.0, 0.82, 0.6), hash12(room + 67.0));
    vec3 cool = mix(vec3(1.0, 0.95, 0.86), mix(vec3(0.78, 0.9, 1.0), vec3(0.42, 0.66, 1.0), uNightBlue), hash12(room + 71.0));
    float coolShare = mix(0.25, mix(0.12, 0.95, step(0.35, b2)), office) + 0.45 * uNightBlue;
    vec3 lamp = mix(warm, cool, step(1.0 - coolShare, mix(tint, 0.5 * b3 + 0.5 * tint, office)));
    lamp = mix(lamp, vec3(0.3, 0.55, 1.0), step(0.93 - 0.22 * uNightBlue, tint) * mix(1.0 - office, 1.0, uNightBlue));
    float glow = mix(0.3, 1.35, hash12(room + 1.3)) * mix(0.65, 1.25, b3);

    vec3 glassTint = glassy ? mix(vec3(0.2, 0.3, 0.38), vec3(0.3, 0.33, 0.34), fract(sf * 5.7)) : vec3(0.1, 0.11, 0.12);
    vec3 frameCol = fract(sf * 3.3) < 0.5 ? vec3(0.16, 0.17, 0.18) : vec3(0.62, 0.63, 0.63);
    diffuseColor.rgb = mix(diffuseColor.rgb, frameCol, inWin * frame);
    diffuseColor.rgb = mix(diffuseColor.rgb, glassTint, pane);
    gRough = mix(gRough, 0.45, inWin * frame);
    gRough = mix(gRough, 0.06, pane);
    gMetal = mix(gMetal, 0.92, pane);
    float daylight = (1.0 - uNight) * (shop ? 0.3 : glassy ? 0.06 : 0.12);
    // A lit room is not an even panel: the light comes from a lamp somewhere
    // inside, many windows have a curtain drawn, and some light spills out.
    {
      vec2 inPane = vec2((fx - r.x) / (r.y - r.x), (fy - r.z) / (r.w - r.z));
      vec2 lampAt = vec2(0.25 + 0.5 * hash12(room + 12.1), 0.55 + 0.35 * hash12(room + 14.9));
      float fall = 0.32 + 0.95 * exp(-3.2 * dot(inPane - lampAt, inPane - lampAt));
      float curtain = step(0.52, hash12(room + 16.3)) * (shop ? 0.0 : 1.0);
      vec3 cloth = mix(vec3(0.95, 0.82, 0.62), vec3(0.85, 0.86, 0.84), hash12(room + 18.7)) * 0.42;
      vec3 soft = mix(vec3(1.0, 0.8, 0.58), lamp, 0.45);
      vec3 room3 = mix(interior * fall, cloth * (0.75 + 0.35 * fall), curtain);
      room3 = mix(room3, vec3(0.3), far);
      float power = uNight * on * glow * 0.78 * 1.75;
      gEmissive += pane * (interior * daylight + room3 * soft * power);
      float spill = (1.0 - far) * valid * power * 0.16;
      gEmissive += soft * spill * (inWin * frame * 0.6 + (1.0 - inWin) * exp(min(edge, 0.0) * 4.5) * step(-0.9, edge));
    }
    // the sun in the glass: a hot core and a wandering glare, plus the sheen of the sky at a glancing angle
    {
      vec2 wob = vec2(vnoise(st * 0.8 + seed * 0.09) - 0.5, vnoise(st * 0.8 + 31.0 + seed * 0.09) - 0.5) * 0.035;
      vec3 paneN = normalize(gT * wob.x + gB * wob.y + gN);
      float s = max(dot(reflect(V, paneN), uSunDir), 0.0);
      gGlint = pane * uSunGlint * (pow(s, 1400.0) * 14.0 + pow(s, 90.0) * 0.35 + pow(s, 7.0) * 0.1) * step(0.0, dot(gN, uSunDir));
      float graze = pow(1.0 - max(dot(-V, gN), 0.0), 3.0);
      gGlint += pane * 2.0 * uSunGlint * 0.035 * max(dot(paneN, uSunDir), 0.0) * (0.6 + 0.8 * hash12(room + 15.7));
      gEmissive += pane * 2.0 * (1.0 - uNight) * vec3(0.45, 0.6, 0.82) * (0.015 + 0.22 * graze) * (0.7 + 0.6 * hash12(room + 19.3));
    }
    // some towers are lit in one colour throughout: blue, gold, a few cyan or violet
    {
      float pickA = fract(sf * 31.7), hu = fract(sf * 47.3);
      float accent = tall * step(0.7 - 0.45 * uNightBlue, pickA) * uNight;
      vec3 accentCol = hu < 0.42 ? vec3(0.12, 0.38, 1.0) : hu < 0.76 ? vec3(1.0, 0.72, 0.16) : hu < 0.89 ? vec3(0.1, 0.85, 1.0) : vec3(0.75, 0.3, 1.0);
      gEmissive = mix(gEmissive, accentCol * dot(gEmissive, vec3(0.9)), accent * 0.8);
    }
    // the lintel shades the top of the opening
    diffuseColor.rgb *= 1.0 - 0.35 * inWin * (1.0 - smoothstep(0.0, 0.18, wmax.y - pm.y)) * (1.0 - far);
    if (shop) {
      float sign = box(fy, 0.84, 0.985, wy) * box(fx, 0.03, 0.97, wx) * step(0.25, hash12(room + 57.0));
      vec3 sc = mix(hue(hash12(room + 71.0)), vec3(0.95), 0.35 * step(0.6, hash12(room + 83.0)));
      diffuseColor.rgb = mix(diffuseColor.rgb, sc * 0.75, sign);
      gEmissive += sign * sc * uNight * 1.6;
      gRough = mix(gRough, 0.4, sign);
    }
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
      ${WORLD_VERT_PARS}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vWall = aWall;
      vSeed = aSeed;
      vBase = aBase;
      vTop = aTop;
      vKind = aKind;
      ${WORLD_VERT_SET}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FACADE_PARS}`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${FACADE_MAIN}`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = gMetal;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmissive;')
    // the direct diffuse light is zero in shadow: it tells whether the sun reaches this pane
    .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular += gGlint * smoothstep(0.0, 0.002, dot(reflectedLight.directDiffuse, vec3(0.333)));');
}

export function createBuildingMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  material.onBeforeCompile = patchFacade;
  material.customProgramCacheKey = () => 'sh-facade-3';
  return material;
}

// ---------------------------------------------------------------- ground
// Land cover and terrain: vertex colours are sRGB; texture comes from noise.
export function createGroundMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cityUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WORLD_VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WORLD_VERT_SET}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WORLD_VERT_PARS}\n${LAMP_PARS}\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 c = pow(diffuseColor.rgb, vec3(2.2));
          float blotch = vnoise(vWorld.xz * 0.045);
          float grain = vnoise(vWorld.xz * 0.9);
          float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
          // grass and trees: the yellower, greyer green of real turf
          float green = smoothstep(0.03, 0.12, c.g - max(c.r, c.b));
          float turf = dot(c, vec3(0.3, 0.59, 0.11));
          c = mix(c, mix(vec3(turf), c, 0.62) * vec3(1.12, 1.0, 0.8), green);
          c *= (0.93 + 0.14 * blotch) * (0.95 + 0.1 * grain);
          diffuseColor.rgb = c;
        }`)
      .replace('#include <lights_fragment_end>', LAMP_READ);
  };
  material.customProgramCacheKey = () => 'sh-ground-1';
  return material;
}

const ROAD = /* glsl */`
  float cls = vCls;
  float across = vRoad.x;
  float along = vRoad.y;
  float grain = vnoise(vWorld.xz * 1.3) * 0.6 + vnoise(vWorld.xz * 0.21) * 0.4;
  vec3 col = vec3(0.075, 0.077, 0.08) * (0.85 + 0.3 * grain);
  if (cls < 0.5) col *= 0.9;
  if (vFlags > 0.5 && vFlags < 1.5) col *= 0.6;
  float rough = 0.86 - 0.1 * grain;
  if (cls > 7.5 && cls < 8.5) {
    // pavement: pale concrete slabs in running bond, fading out when smaller than a pixel
    vec2 q = vec2(along, across * 2.0) / vec2(0.6, 0.3);
    q.x += 0.5 * mod(floor(q.y), 2.0);
    vec2 f = fract(q), w = fwidth(q);
    float fine = 1.0 - smoothstep(0.3, 0.9, max(w.x, w.y));
    vec2 e = min(f, 1.0 - f) / max(w, vec2(1e-4));
    float joint = (1.0 - smoothstep(0.5, 1.5, min(e.x, e.y))) * fine;
    col = vec3(0.3, 0.295, 0.28) * (0.92 + 0.16 * hash12(floor(q))) * (0.9 + 0.2 * grain);
    col = mix(col, col * 0.55, joint);
    rough = 0.88;
  } else if (cls > 6.5 && cls < 7.5) {
    float stripe = step(0.48, fract(along * 0.62));
    col = mix(col, vec3(0.62, 0.62, 0.6), stripe);
  } else if (cls > 8.5 && cls < 9.5) {
    col = vec3(0.07, 0.07, 0.075);
    float sleeper = step(0.62, fract(along * 0.85));
    col = mix(col, vec3(0.2, 0.15, 0.1), sleeper * 0.85);
    float rail = 1.0 - smoothstep(0.015, 0.045, abs(abs(across) - 0.62));
    col = mix(col, vec3(0.5, 0.51, 0.53), rail);
    rough = mix(rough, 0.3, rail);
    if (vFlags > 1.5) totalEmissiveRadiance += vec3(0.25, 0.55, 0.85) * uNight * 0.45;
  } else if (vFlags < 0.5) {
    float edgeLine = 1.0 - smoothstep(0.0, 0.035, abs(abs(across) - 0.9));
    float dash = step(0.45, fract(along / 9.0));
    float center = (1.0 - smoothstep(0.0, 0.03, abs(across))) * dash;
    if (cls > 4.5) center *= 0.25;
    col = mix(col, vec3(0.62, 0.62, 0.58) * (0.85 + 0.2 * grain), clamp(edgeLine + center, 0.0, 1.0) * 0.9);
  }
  diffuseColor.rgb = col;
  roughnessFactor = rough;
`;

export function createRoadMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.86, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cityUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aRoad;
        attribute float aCls;
        attribute float aFlags;
        varying vec2 vRoad;
        varying float vCls;
        varying float vFlags;
        ${WORLD_VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRoad = aRoad;
        vCls = aCls;
        vFlags = aFlags;
        ${WORLD_VERT_SET}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight;
        varying vec2 vRoad;
        varying float vCls;
        varying float vFlags;
        ${WORLD_VERT_PARS}
        ${LAMP_PARS}
        ${NOISE}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        ${ROAD}`)
      .replace('#include <lights_fragment_end>', LAMP_READ);
  };
  material.customProgramCacheKey = () => 'sh-road-2';
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  return material;
}

// ---------------------------------------------------------------- water
// Calm river water: what is seen of it is mostly what it mirrors, by Fresnel's
// share. The mirror picture (mirror.js) holds the city drawn upside down.
export function createWaterMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    uniforms: cityUniforms,
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uDark;
      uniform float uSkyGain;
      uniform vec3 uSky;
      uniform vec3 uHorizon;
      uniform vec3 uSunDir;
      uniform vec3 uSunGlint;
      uniform sampler2D uMirror;
      uniform mat4 uMirrorMatrix;
      uniform float uMirrorOn;
      varying vec3 vWorld;
      ${NOISE}
      float ripple(vec2 p, float t) {
        p += 3.2 * vec2(vnoise(p * 0.11 + t * 0.03), vnoise(p * 0.11 + 9.0 - t * 0.03));
        float h = 0.3 * sin(dot(p, vec2(0.92, 0.39)) * 1.1 + t * 1.1);
        h += 0.28 * sin(dot(p, vec2(-0.45, 0.89)) * 1.6 - t * 1.4 + 1.3);
        h += 0.22 * sin(dot(p, vec2(0.2, -0.98)) * 2.7 + t * 1.9 + 4.0);
        h += 0.9 * (vnoise(p * 0.8 + vec2(t * 0.25, -t * 0.18)) - 0.5);
        return h;
      }
      void main() {
        float t = uTime, e = 0.12;
        float dist = distance(cameraPosition, vWorld);
        float amp = 0.06 * clamp(220.0 / dist - 0.1, 0.0, 1.0);
        vec2 slope = vec2(ripple(vWorld.xz + vec2(e, 0.0), t) - ripple(vWorld.xz - vec2(e, 0.0), t),
                          ripple(vWorld.xz + vec2(0.0, e), t) - ripple(vWorld.xz - vec2(0.0, e), t)) * (amp / (2.0 * e));
        // long swells that survive into the distance and break up the mirror a little
        slope += vec2(sin(vWorld.x * 0.05 + t * 0.4), cos(vWorld.z * 0.043 - t * 0.33)) * 0.008;
        vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
        vec3 wv = normalize(vWorld - cameraPosition);
        vec3 wr = reflect(wv, n);
        float fresnel = 0.05 + 0.95 * pow(1.0 - max(dot(-wv, n), 0.0), 4.0);
        // the Huangpu is silty: a dull olive brown seen straight down
        vec3 body = vec3(0.035, 0.04, 0.03) * (0.04 + 0.96 * (1.0 - uDark));
        vec3 seen = mix(uHorizon, uSky, pow(clamp(abs(wr.y), 0.0, 1.0), 0.5)) * uSkyGain * 0.9;
        float thing = 0.0;
        if (uMirrorOn > 0.5) {
          vec4 mc = uMirrorMatrix * vec4(vWorld, 1.0);
          float near = clamp(70.0 / dist, 0.12, 1.6);
          vec2 muv = mc.xy / mc.w * 0.5 + 0.5 + n.xz * vec2(0.5, 0.9) * near;
          vec4 m = vec4(0.0);
          for (int i = -1; i <= 1; i++) m += texture2D(uMirror, clamp(muv + vec2(0.0, float(i) * 0.004 * near), 0.001, 0.999));
          m /= 3.0;
          thing = smoothstep(0.0, 0.3, m.a);
          seen = mix(seen, m.rgb * vec3(0.86, 0.9, 0.9), thing);
        }
        vec3 col = mix(body, seen, max(fresnel, 0.42 * thing));
        float s = max(dot(wr, uSunDir), 0.0);
        col += uSunGlint * (pow(s, 600.0) * 6.0 + pow(s, 60.0) * 0.12);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// ---------------------------------------------------------------- sky
// Horizon to zenith gradient, the sun, optional procedural clouds, and a night
// sky with stars and the city's glow at the horizon. The same shader (without
// the sun's disc, with a ground below the horizon) is baked into the
// environment map that glass reflects.
export function createSkyMaterial({ sunDisc = 1, ground = false } = {}) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { ...cityUniforms, uSunDisc: { value: sunDisc }, uGround: { value: ground ? 1 : 0 } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
        gl_Position.z = gl_Position.w * 0.9999995;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uSky;
      uniform vec3 uHorizon;
      uniform vec3 uSunDir;
      uniform float uDark;
      uniform float uDay;
      uniform float uTime;
      uniform float uSunDisc;
      uniform float uGround;
      uniform float uSkyGain;
      uniform float uCloudCover;
      varying vec3 vDir;
      ${NOISE}
      float fbm(vec2 p) {
        float s = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
        return s;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        vec3 col = mix(uHorizon, uSky, pow(h, 0.5));
        float sunUp = smoothstep(-0.08, 0.02, uSunDir.y);
        col += mix(vec3(1.0, 0.82, 0.6), uHorizon, 0.4) * (pow(sd, 12.0) * 0.18 + pow(sd, 4.0) * 0.12 * (1.0 - uDay)) * sunUp;
        col += vec3(1.0, 0.82, 0.6) * pow(sd, 180.0) * 0.5 * sunUp;
        col += vec3(1.0, 0.95, 0.85) * smoothstep(0.9994, 0.9998, sd) * 30.0 * uSunDisc * sunUp * (1.0 - uDark);
        if (d.y > 0.0 && uCloudCover > 0.0) {
          vec2 p = d.xz / (d.y + 0.12) * 0.9 + vec2(uTime * 0.006, uTime * 0.002);
          float c = fbm(p);
          float cover = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.22, c);
          float lit = fbm(p + uSunDir.xz * 0.12);
          vec3 cloud = mix(vec3(0.95, 0.96, 0.98), vec3(0.55, 0.6, 0.68), smoothstep(0.35, 0.85, lit * cover + c * 0.4));
          cloud = cloud * mix(1.0, 0.06, uDark) + vec3(1.0, 0.7, 0.45) * pow(sd, 6.0) * 0.25 * (1.0 - uDay);
          col = mix(col, cloud, cover * smoothstep(0.0, 0.16, d.y) * 0.92);
        }
        vec2 sp = d.xz / (abs(d.y) + 0.35) * 220.0;
        float star = step(0.9975, hash12(floor(sp))) * smoothstep(0.1, 0.5, d.y);
        col += vec3(0.8, 0.85, 1.0) * star * 0.5 * uDark * uSunDisc;
        vec3 below = uGround > 0.5 ? vec3(0.3, 0.28, 0.25) * mix(1.0, 0.06, uDark) * (0.2 + 0.8 * uDay) : uHorizon;
        col = mix(col, below, 1.0 - smoothstep(-0.06, 0.0, d.y));
        gl_FragColor = vec4(col * uSkyGain, 1.0);
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
