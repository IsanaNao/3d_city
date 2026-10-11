import * as THREE from 'three';
import { FACADE_LAYERS, GROUND_LAYERS, WALL_LAYERS } from '../shared/textures.js';
import { photoUniforms } from './textures.js';

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
  uWarm: { value: 0 },
  uCloudCover: { value: 0 },
  uHaze: { value: 0 },
  uShowScheme: { value: 0 },
  uShowNext: { value: 0 },
  uShowFade: { value: 0 },
  uShowPhase: { value: 0 },
  uNightBlue: { value: 0.35 },
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

// ---------------------------------------------------------------- photo textures
// Detail photos (textures.js) are divided by their mean colour, so they carry the
// pattern of tile, brick or stone while the surface keeps its own colour. Their
// normal maps go through a screen-space tangent frame, so no tangents are stored.
const glf = (n) => (Number.isInteger(n) ? `${n}.0` : String(+n.toFixed(6)));
const layerConsts = (prefix, layers) => layers.map((l, i) => `const float ${prefix}_${l.key.toUpperCase()} = ${glf(i)};`).join('\n');
const PHOTO_PARS = /* glsl */`
uniform float uPhotoOn;
vec2 gUv = vec2(0.0);
vec3 gNt = vec3(0.0, 0.0, 1.0);
float gNs = 0.0;
vec3 photoNormal(vec3 n, vec3 eye, vec2 uv, vec3 m) {
  vec3 q0 = dFdx(eye), q1 = dFdy(eye);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1perp = cross(q1, n), q0perp = cross(n, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float s = det == 0.0 ? 0.0 : inversesqrt(det);
  return normalize(T * (m.x * s) + B * (m.y * s) + n * m.z);
}
// the photos are stored top row first and sampled with v growing downwards
vec3 readNormal(sampler2DArray map, vec2 uv, float layer) {
  vec3 m = texture(map, vec3(uv, layer)).xyz * 2.0 - 1.0;
  return vec3(m.x, -m.y, m.z);
}
`;
const PHOTO_NORMAL = /* glsl */`
#include <normal_fragment_maps>
normal = photoNormal(normal, -vViewPosition, gUv, normalize(mix(vec3(0.0, 0.0, 1.0), gNt, gNs)));
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
uniform float uShowScheme;
uniform float uShowPhase;
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
uniform sampler2DArray uWallAlb;
uniform sampler2DArray uWallNor;
uniform sampler2DArray uFacade;
uniform vec3 uWallMean[${WALL_LAYERS.length}];
uniform vec2 uWallScale[${WALL_LAYERS.length}];
${layerConsts('W', WALL_LAYERS)}
${PHOTO_PARS}
${NOISE}
// Which photo a building wears: a detail layer for plain walls (and the parapet of
// photo-facade towers), and optionally a whole-facade photo with its own windows.
void pickPhoto(float kind, float height, float sf, bool glassy, out float layer, out float photo) {
  float p = fract(sf * 7.31), q = fract(sf * 13.7);
  photo = -1.0;
  if (kind > 5.5) layer = W_STONE;
  else if (glassy) { layer = W_CONCRETE; photo = p < 0.55 ? 0.0 : 1.0; }
  else if (kind > 1.5 && kind < 3.5) {
    layer = q < 0.5 ? W_CONCRETE : W_CLADDING;
    if (height > 60.0 && p < 0.55) photo = p < 0.28 ? 0.0 : 1.0;
    else if (height > 12.0 && p > 0.7) photo = 3.0;
  } else if (kind > 0.5 && kind < 1.5) {
    if (height < 13.0) layer = p < 0.45 ? W_BRICK_MIXED : p < 0.7 ? W_BRICK : W_PLASTER;
    else {
      layer = q < 0.6 ? W_TILE : W_MOSAIC;
      if (p < 0.16) photo = 2.0;
    }
  } else if (kind > 3.5 && kind < 4.5) layer = p < 0.6 ? W_METAL : W_CONCRETE;
  else if (kind > 4.5) layer = W_CONCRETE;
  else if (height > 30.0) layer = p < 0.5 ? W_TILE : W_CONCRETE;
  else layer = p < 0.45 ? W_PLASTER : p < 0.7 ? W_BRICK_MIXED : p < 0.85 ? W_MOSAIC : W_CONCRETE;
}
// Brick keeps the colour of the photographed brick; other layers take the building's.
float ownColour(float layer) {
  return layer == W_BRICK ? 0.85 : layer == W_BRICK_MIXED ? 0.75 : layer == W_STONE ? 0.25 : 0.0;
}
`;

// Each facade photo dictates the window grid: storey height, bay width and opening.
const FACADE_GRID = FACADE_LAYERS.map((l, i) => `if (photo == ${glf(i)}) { floorH = ${glf(l.floor)}; pitch = ${glf(l.floor * l.aspect)}; r = vec4(${l.win.map(glf).join(', ')}); pgrid = vec4(${glf(l.grid[0])}, ${glf(l.grid[1])}, ${glf(l.offset[0])}, ${glf(l.offset[1])}); }`).join('\n      else ');

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

  float layer = -1.0, photo = -1.0, gGrime = 1.0;
  float bundCorn = 0.0, bundGraze = 0.0, bundTop = 0.0;
  if (uPhotoOn > 0.5) {
    pickPhoto(kind, height, sf, glassy, layer, photo);
    if (isRoof) { layer = W_ROOF; photo = -1.0; }
    int li = int(layer);
    gUv = (isRoof ? vec2(vWorld.x, -vWorld.z) : vec2(vWall.x, -v)) * uWallScale[li] + fract(sf * vec2(13.1, 7.7));
    vec3 tex = texture(uWallAlb, vec3(gUv, layer)).rgb;
    wall = mix(wall * tex / uWallMean[li], tex * (0.9 + 0.2 * vnoise(st * 0.11 + seed * 0.37)), ownColour(layer));
    gNt = readNormal(uWallNor, gUv, layer);
    gNs = 1.0;
  }

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
      gGrime = 1.0 - grime;
    }
    // Bund ashlar: rusticated base, a cornice each floor, warm floodlight from the promenade.
    if (kind > 5.5) {
      vec3 buff = vec3(0.58, 0.48, 0.38);
      float grain = 0.9 + 0.14 * vnoise(st * vec2(0.42, 0.9) + seed);
      wall = mix(wall, buff, 0.66) * grain;
      float course = smoothstep(0.78, 0.92, fract(v * 1.25));
      float podium = 1.0 - smoothstep(0.0, 6.0, v);
      wall *= mix(1.0, 0.7, podium * (0.5 + 0.5 * course));
      float corn = smoothstep(0.82, 0.94, fract(v / 4.4));
      wall *= 1.0 - corn * 0.5;
      wall += vec3(0.05, 0.04, 0.028) * corn * 0.35;
      bundGraze = pow(1.0 - smoothstep(0.0, max(height * 0.72, 8.0), v), 1.35);
      bundCorn = corn;
      bundTop = smoothstep(height - 2.4, height - 0.35, v);
    }
  }
  if (!isRoof && height > 85.0 && kind > 1.5 && kind < 4.5) {
    wall = mix(wall, vec3(0.42, 0.50, 0.58), 0.7);
    gRough = 0.28;
    gMetal = 0.62;
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
    vec4 pgrid = vec4(1.0, 1.0, 0.0, 0.0);
    if (photo > -0.5) {
      ${FACADE_GRID}
      if (photo < 1.5) office = 1.0;
    }

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
    if (height > 85.0 && kind > 1.5 && kind < 4.5) photo = -1.0;
    bool usePhoto = photo > -0.5 && !shop;
    vec4 ph = vec4(0.0);
    if (usePhoto) {
      // shift each building's photo by whole cells so neighbours differ
      vec2 puv = vec2((u + pgrid.z) / pgrid.x, -(fyAll + pgrid.w) / pgrid.y) + floor(fract(sf * vec2(5.3, 3.7)) * pgrid.xy) / pgrid.xy;
      ph = texture(uFacade, vec3(puv, photo));
    }
    float valid = 1.0;
    if (kind < 1.5 && !shop && !usePhoto) valid *= step(0.18, hash12(room + 41.0));
    float inWin = usePhoto ? smoothstep(0.25, 0.75, ph.a) : box(fx, r.x, r.y, wx) * box(fy, r.z, r.w, wy) * valid;
    gNs *= usePhoto ? 0.0 : 1.0 - inWin;

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
    frame *= usePhoto ? 0.0 : 1.0 - far;
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
    // Tall towers light whole floors. At distance every pixel of a floor agrees,
    // so the skyline reads as bands instead of a field of random dots.
    float tall = smoothstep(70.0, 110.0, height);
    float floorOn = step(0.48, hash12(vec2(floor(row) + mod(seed, 89.0) * 3.0, 4.0)));
    if (!shop) onRate = mix(onRate, mix(0.05, 0.92, floorOn), tall);
    onRate = clamp(onRate, 0.0, 0.95);
    float slot = floor(uTime / (90.0 + 240.0 * hash12(room + 37.0)) + hash12(room + 41.0) * 64.0);
    float fickle = step(0.6, hash12(room + 31.0));
    float onClose = step(1.0 - onRate, hash12(room + 23.0 + fickle * vec2(mod(slot, 61.0) * 7.13, mod(slot, 47.0) * 3.71)));
    float on = mix(onClose, floorOn, far);

    float tint = hash12(room + 61.0);
    vec3 warm = mix(vec3(1.0, 0.6, 0.3), vec3(1.0, 0.82, 0.6), hash12(room + 67.0));
    vec3 cool = mix(vec3(1.0, 0.95, 0.86), mix(vec3(0.78, 0.9, 1.0), vec3(0.42, 0.66, 1.0), uNightBlue), hash12(room + 71.0));
    float coolShare = mix(0.25, mix(0.12, 0.95, step(0.35, b2)), office) + 0.45 * uNightBlue;
    vec3 lamp = mix(warm, cool, step(1.0 - coolShare, mix(tint, 0.5 * b3 + 0.5 * tint, office)));
    lamp = mix(lamp, vec3(0.3, 0.55, 1.0), step(0.93 - 0.22 * uNightBlue, tint) * mix(1.0 - office, 1.0, uNightBlue));
    float glow = mix(0.3, 1.35, hash12(room + 1.3)) * mix(0.65, 1.25, b3);
    glow = mix(glow, mix(0.4, 1.0, floorOn), max(far, tall * 0.65));

    vec3 glassTint = glassy ? mix(vec3(0.2, 0.3, 0.38), vec3(0.3, 0.33, 0.34), fract(sf * 5.7)) : vec3(0.1, 0.11, 0.12);
    if (kind > 5.5) glassTint = vec3(0.045, 0.05, 0.055);
    vec3 frameCol = fract(sf * 3.3) < 0.5 ? vec3(0.16, 0.17, 0.18) : vec3(0.62, 0.63, 0.63);
    if (usePhoto) {
      // the photo's own colours, nudged towards the building's tint
      vec3 tintBy = diffuseColor.rgb / max(dot(diffuseColor.rgb, vec3(0.333)), 1e-3);
      vec3 pc = ph.rgb * mix(vec3(1.0), tintBy, 0.2) * (0.85 + 0.3 * fract(sf * 9.1));
      diffuseColor.rgb = pc * gGrime;
      glassTint = mix(pc, glassTint, 0.25);
    }
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
      room3 = mix(room3, vec3(0.3), far * (1.0 - tall));
      room3 = mix(room3, vec3(1.0, 0.78, 0.48), far);
      soft = mix(soft, vec3(1.0, 0.74, 0.42), far);
      float power = uNight * on * glow * 0.78 * 1.75;
      if (kind > 5.5) power *= 0.22;
      gEmissive += pane * (interior * daylight + room3 * soft * power);
      if (kind > 5.5) {
        float stone = 1.0 - pane;
        float wash = 0.62 + 0.4 * bundGraze;
        float edge = 1.55 * bundCorn + 1.05 * bundTop;
        float pilaster = smoothstep(0.9, 0.99, fract(vWall.x / 6.8));
        gEmissive += wall * vec3(1.05, 0.62, 0.26) * uNight * stone * wash;
        gEmissive += vec3(1.02, 0.56, 0.2) * uNight * stone * (edge + pilaster * 0.42);
      }
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
      if (height > 85.0 && kind > 1.5 && kind < 4.5) {
        gEmissive += (1.0 - uNight) * vec3(0.32, 0.46, 0.64) * (0.06 + 0.32 * graze);
      }
    }
    // A few towers carry a coloured crown. The rest stay warm window-light.
    {
      float pickA = fract(sf * 31.7), hu = fract(sf * 47.3);
      float crown = smoothstep(0.8, 0.96, v / height);
      float accent = tall * step(0.9, pickA) * uNight * crown;
      vec3 accentCol = hu < 0.28 ? vec3(0.25, 0.55, 1.0)
        : hu < 0.55 ? vec3(1.0, 0.72, 0.28)
        : hu < 0.75 ? vec3(0.2, 0.85, 0.45)
        : vec3(0.35, 0.85, 1.0);
      gEmissive = mix(gEmissive, gEmissive * accentCol * 1.25 + accentCol * pane * 0.4, accent);
    }
    // A minority of the tall frontage carries a thin show-tinted edge. The rest stay warm floor bands.
    if (tall > 0.55 && fract(sf * 19.7) > 0.8 && vWall.y > 0.0) {
      float edgeDist = min(vWall.x, max(vWall.y - vWall.x, 0.0));
      float side = 1.0 - smoothstep(0.15, 0.7, edgeDist);
      float crownLine = smoothstep(0.9, 0.95, v / height) * (1.0 - smoothstep(0.985, 0.998, v / height));
      float led = fract(sf * 2.7 + uShowScheme / 7.0 + uShowPhase * 0.2);
      vec3 line = mix(vec3(1.0, 0.82, 0.55), hue(led), 0.35);
      gEmissive += line * uNight * (side * 0.16 + crownLine * 0.4);
    }
    // the lintel shades the top of the opening
    if (!usePhoto) diffuseColor.rgb *= 1.0 - 0.35 * inWin * (1.0 - smoothstep(0.0, 0.18, wmax.y - pm.y)) * (1.0 - far);
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
  Object.assign(shader.uniforms, cityUniforms, photoUniforms);
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
    .replace('#include <normal_fragment_maps>', PHOTO_NORMAL)
    // the direct diffuse light is zero in shadow: it tells whether the sun reaches this pane
    .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular += gGlint * smoothstep(0.0, 0.002, dot(reflectedLight.directDiffuse, vec3(0.333)));');
}

export function createBuildingMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  material.onBeforeCompile = patchFacade;
  material.customProgramCacheKey = () => 'sh-facade-14';
  return material;
}

// ---------------------------------------------------------------- ground
// Land cover and terrain: vertex colours are sRGB; texture comes from noise.
const GROUND_PARS = /* glsl */`
uniform sampler2DArray uGroundAlb;
uniform sampler2DArray uGroundNor;
uniform vec3 uGroundMean[${GROUND_LAYERS.length}];
uniform vec2 uGroundScale[${GROUND_LAYERS.length}];
${layerConsts('G', GROUND_LAYERS)}
${PHOTO_PARS}
`;

export function createGroundMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cityUniforms, photoUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WORLD_VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WORLD_VERT_SET}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WORLD_VERT_PARS}\n${LAMP_PARS}\n${NOISE}\n${GROUND_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 c = pow(diffuseColor.rgb, vec3(2.2));
          float blotch = vnoise(vWorld.xz * 0.045);
          float grain = vnoise(vWorld.xz * 0.9);
          float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
          // grass and trees: the yellower, greyer green of real turf
          float green = smoothstep(0.03, 0.12, c.g - max(c.r, c.b));
          float turf = dot(c, vec3(0.3, 0.59, 0.11));
          c = mix(c, mix(vec3(turf), c, 0.6) * vec3(1.22, 1.12, 0.72) * 1.3, green);
          c *= (0.93 + 0.14 * blotch) * (0.95 + 0.1 * grain);
          if (uPhotoOn > 0.5) {
            vec2 uv = vec2(vWorld.x, -vWorld.z);
            int gi = int(G_GRASS), pi = int(G_PAVEMENT);
            vec2 uvG = uv * uGroundScale[gi], uvP = uv * uGroundScale[pi];
            vec3 grassTex = texture(uGroundAlb, vec3(uvG, G_GRASS)).rgb / uGroundMean[gi];
            vec3 paveTex = texture(uGroundAlb, vec3(uvP, G_PAVEMENT)).rgb / uGroundMean[pi];
            c *= mix(paveTex, grassTex, green);
            gUv = green > 0.5 ? uvG : uvP;
            gNt = readNormal(uGroundNor, gUv, green > 0.5 ? G_GRASS : G_PAVEMENT);
            gNs = 0.8;
          }
          // Quay and promenade: stone slabs, so the bank is not one flat grey.
          if (green < 0.25) {
            vec2 q = vWorld.xz / vec2(1.25, 0.8);
            q.x += 0.5 * mod(floor(q.y), 2.0);
            vec2 f = fract(q);
            vec2 fw = max(fwidth(q), vec2(1e-4));
            float fine = 1.0 - smoothstep(0.45, 1.25, max(fw.x, fw.y));
            float edge = min(min(f.x, 1.0 - f.x) / fw.x, min(f.y, 1.0 - f.y) / fw.y);
            float joint = (1.0 - smoothstep(0.4, 1.3, edge)) * fine;
            c *= 0.78 + 0.32 * hash12(floor(q) + 3.1);
            c = mix(c, c * 0.52, joint);
          }
          diffuseColor.rgb = c;
        }`)
      .replace('#include <normal_fragment_maps>', PHOTO_NORMAL)
      .replace('#include <lights_fragment_end>', LAMP_READ);
  };
  material.customProgramCacheKey = () => 'sh-ground-3';
  return material;
}

const ROAD = /* glsl */`
  float cls = vCls;
  float across = vRoad.x;
  float along = vRoad.y;
  float grain = vnoise(vWorld.xz * 1.3) * 0.6 + vnoise(vWorld.xz * 0.21) * 0.4;
  vec3 col = vec3(0.075, 0.077, 0.08) * (0.85 + 0.3 * grain);
  if (cls < 0.5) col *= 0.9;
  float rough = 0.86 - 0.1 * grain;
  bool under = vFlags > 0.5 && vFlags < 1.5;
  bool tunnel = vFlags > 1.5 && vFlags < 2.5;
  bool curb = vFlags > 2.5 && vFlags < 3.5;
  float lanes = vFlags > 9.5 ? clamp(floor(vFlags + 0.5) - 10.0, 1.0, 8.0) : 2.0;
  vec2 ruv = vec2(vWorld.x, -vWorld.z);
  if (curb) {
    col = vec3(0.42, 0.41, 0.39);
    rough = 0.72;
    gNs = 0.0;
  } else if (under) {
    col *= 0.45;
    gNs = 0.0;
  }
  if (uPhotoOn > 0.5 && cls < 7.5 && !curb && !under) {
    int ai = int(G_ASPHALT);
    gUv = ruv * uGroundScale[ai];
    vec3 det = texture(uGroundAlb, vec3(gUv, G_ASPHALT)).rgb / uGroundMean[ai];
    col *= det;
    gNt = readNormal(uGroundNor, gUv, G_ASPHALT);
    gNs = 0.7;
  }
  if (cls > 7.5 && cls < 8.5 && !curb && uPhotoOn > 0.5) {
    int pi = int(G_PAVERS);
    gUv = ruv * uGroundScale[pi];
    vec3 det = texture(uGroundAlb, vec3(gUv, G_PAVERS)).rgb / uGroundMean[pi];
    col = vec3(0.3, 0.295, 0.28) * det * (0.92 + 0.16 * grain);
    gNt = readNormal(uGroundNor, gUv, G_PAVERS);
    gNs = 1.0;
    rough = 0.88;
  } else if (cls > 7.5 && cls < 8.5 && !curb) {
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
    float stripe = step(0.38, fract(along * 1.35));
    col = mix(vec3(0.09, 0.09, 0.095), vec3(0.72, 0.72, 0.68), stripe);
    rough = 0.7;
    gNs = 0.0;
  } else if (cls > 8.5 && cls < 9.5) {
    col = vec3(0.07, 0.07, 0.075);
    float sleeper = step(0.62, fract(along * 0.85));
    col = mix(col, vec3(0.2, 0.15, 0.1), sleeper * 0.85);
    float rail = 1.0 - smoothstep(0.015, 0.045, abs(abs(across) - 0.62));
    col = mix(col, vec3(0.5, 0.51, 0.53), rail);
    rough = mix(rough, 0.3, rail);
    if (tunnel) totalEmissiveRadiance += vec3(0.25, 0.55, 0.85) * uNight * 0.45;
  } else if (!under && !curb && cls < 6.5) {
    float edgeLine = 1.0 - smoothstep(0.0, 0.018, abs(abs(across) - 0.94));
    float paint = edgeLine;
    vec3 paintCol = vec3(0.75, 0.75, 0.7);
    for (int i = 1; i < 8; i++) {
      if (float(i) >= lanes) break;
      float boundary = float(i) / lanes * 2.0 - 1.0;
      bool center = abs(float(i) - lanes * 0.5) < 0.51 && mod(lanes, 2.0) < 0.1;
      float line = 1.0 - smoothstep(0.0, center ? 0.01 : 0.012, abs(across - boundary));
      if (center) line = max(
        1.0 - smoothstep(0.0, 0.008, abs(across - (boundary - 0.02))),
        1.0 - smoothstep(0.0, 0.008, abs(across - (boundary + 0.02)))
      );
      float dash = center || cls < 1.5 ? 1.0 : step(0.42, fract(along / 7.5));
      if (cls > 3.5 && !center) dash *= 0.0;
      if (center && cls > 3.5) dash = step(0.48, fract(along / 6.0));
      paint = max(paint, line * dash);
      if (center && cls < 2.5) paintCol = mix(paintCol, vec3(0.72, 0.62, 0.18), line * dash);
    }
    col = mix(col, paintCol * (0.9 + 0.15 * grain), clamp(paint, 0.0, 1.0) * 0.92);
    gNs *= 1.0 - 0.55 * clamp(paint, 0.0, 1.0);
  }
  diffuseColor.rgb = col;
  roughnessFactor = rough;
`;

export function createRoadMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.86, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cityUniforms, photoUniforms);
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
        ${NOISE}
        ${GROUND_PARS}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        ${ROAD}`)
      .replace('#include <normal_fragment_maps>', PHOTO_NORMAL)
      .replace('#include <lights_fragment_end>', LAMP_READ);
  };
  material.customProgramCacheKey = () => 'sh-road-4';
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
      uniform float uHaze;
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
        float amp = mix(0.06, 0.2, uDark) * clamp(180.0 / dist - 0.05, 0.2, 1.0);
        vec2 slope = vec2(ripple(vWorld.xz + vec2(e, 0.0), t) - ripple(vWorld.xz - vec2(e, 0.0), t),
                          ripple(vWorld.xz + vec2(0.0, e), t) - ripple(vWorld.xz - vec2(0.0, e), t)) * (amp / (2.0 * e));
        // long swells that survive into the distance and break up the mirror a little
        slope += vec2(sin(vWorld.x * 0.05 + t * 0.4), cos(vWorld.z * 0.043 - t * 0.33)) * mix(0.008, 0.02, uDark);
        vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
        vec3 wv = normalize(vWorld - cameraPosition);
        vec3 wr = reflect(wv, n);
        float fresnel = 0.05 + 0.95 * pow(1.0 - max(dot(-wv, n), 0.0), 4.0);
        // the Huangpu is silty: a dull olive brown seen straight down
        vec3 body = vec3(0.06, 0.11, 0.13) * (0.28 + 0.72 * (1.0 - uDark));
        body = mix(body, uHorizon * 0.42, uHaze * 0.28);
        vec3 seen = mix(uHorizon, uSky, pow(clamp(abs(wr.y), 0.0, 1.0), 0.5)) * uSkyGain * 0.9;
        float thing = 0.0;
        float reach = smoothstep(40.0, 340.0, dist);
        if (uMirrorOn > 0.5) {
          vec4 mc = uMirrorMatrix * vec4(vWorld, 1.0);
          float near = clamp(70.0 / dist, 0.12, 1.8);
          vec2 muv = mc.xy / mc.w * 0.5 + 0.5 + n.xz * vec2(0.35, 0.7) * near;
          float swell = 0.5 + 0.5 * sin(vWorld.x * 0.031 + vWorld.z * 0.027 + t * 0.4);
          float stretch = mix(0.004, 0.09, uDark) * near * (1.0 + 0.55 * uDark * swell);
          vec2 wave = vec2(
            vnoise(vWorld.xz * 0.16 + t * 0.17) - 0.5,
            vnoise(vWorld.xz * 0.13 - t * 0.13) - 0.5
          );
          muv += wave * mix(0.0, 0.028, uDark) * near;
          vec4 m = vec4(0.0);
          float wsum = 0.0;
          for (int i = 0; i < 9; i++) {
            float o = (float(i) - 4.0) / 4.0;
            float w = exp(-abs(o) * mix(5.0, 2.6, uDark));
            vec2 uv = clamp(muv + vec2(o * stretch * 0.08, o * stretch), 0.001, 0.999);
            m += texture2D(uMirror, uv) * w;
            wsum += w;
          }
          m /= max(wsum, 1e-4);
          thing = smoothstep(0.0, 0.2, m.a);
          vec3 lights = min(max(m.rgb - vec3(0.12), 0.0), vec3(0.36, 0.22, 0.1));
          // Night: only the bright lamps, in broken vertical lanes. The lanes
          // are strongest on the far water and die out toward the camera.
          float across = vWorld.x * 0.23 + vnoise(vec2(vWorld.x * 0.06, vWorld.z * 0.014)) * 2.1;
          float band = smoothstep(0.22, 0.58, fract(across));
          float chip = smoothstep(0.18, 0.62, vnoise(vec2(vWorld.x * 0.31, vWorld.z * 0.07 + t * 0.18)));
          float streak = band * chip;
          vec3 nightRefl = lights * vec3(1.1, 0.64, 0.26) * streak * mix(0.08, 1.0, reach);
          vec3 refl = mix(m.rgb, nightRefl, uDark);
          seen = mix(seen, refl, thing);
        }
        float dayCover = max(fresnel, mix(0.42, 0.8, uHaze * 0.2) * thing);
        float nightCover = thing * mix(0.06, 0.7, reach);
        vec3 col = mix(body, seen, mix(dayCover, nightCover, uDark));
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
      uniform float uWarm;
      uniform float uHaze;
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
        vec3 col = mix(uHorizon, uSky, pow(h, mix(0.5, 0.2, uWarm)));
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
        col += vec3(0.8, 0.85, 1.0) * star * 0.12 * uDark * uSunDisc;
        vec3 moonDir = normalize(vec3(0.78, 0.28, 0.18));
        float moon = smoothstep(0.9986, 0.9995, max(dot(d, moonDir), 0.0));
        col += vec3(0.9, 0.92, 0.98) * moon * (0.15 + 1.1 * uDark);
        vec3 below = uGround > 0.5 ? vec3(0.3, 0.28, 0.25) * mix(1.0, 0.06, uDark) * (0.2 + 0.8 * uDay) : uHorizon;
        vec3 hazeZen = vec3(0.68, 0.74, 0.82);
        vec3 hazeHor = vec3(0.96, 0.84, 0.76);
        vec3 hazy = mix(hazeHor, hazeZen, pow(clamp(d.y, 0.0, 1.0), 0.38));
        hazy = mix(hazy, hazeHor, exp(-max(d.y, 0.0) * 2.8) * 0.62);
        col = mix(col, hazy, uHaze * smoothstep(-0.02, 0.1, d.y));
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
