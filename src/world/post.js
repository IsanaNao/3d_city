import * as THREE from 'three';
import {
  BloomEffect, EffectComposer, EffectPass, Effect, EffectAttribute, RenderPass,
  SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

// Height fog on the finished frame: density falls off exponentially with
// height, integrated along each view ray; the sky takes what a ray to the
// horizon would.
class FogEffect extends Effect {
  constructor(camera) {
    super('Fog', /* glsl */`
      uniform mat4 uInverseProjection;
      uniform mat4 uCamWorld;
      uniform vec3 uColor;
      uniform float uDensity;
      uniform float uHeight;
      uniform float uGround;
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        vec4 p = uInverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        vec3 view = p.xyz / p.w;
        vec3 dir = normalize(mat3(uCamWorld) * view);
        float dist = depth >= 1.0 ? 60000.0 : length(view);
        float eye = (uCamWorld[3].y - uGround) / uHeight;
        float k = dir.y * dist / uHeight;
        float through = uDensity * exp(-max(eye, 0.0)) * dist * (abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0);
        outputColor = vec4(mix(inputColor.rgb, uColor, 1.0 - exp(-through)), inputColor.a);
      }`, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uInverseProjection', new THREE.Uniform(camera.projectionMatrixInverse)],
        ['uCamWorld', new THREE.Uniform(camera.matrixWorld)],
        ['uColor', new THREE.Uniform(new THREE.Color(0.7, 0.72, 0.75))],
        ['uDensity', new THREE.Uniform(0.00012)],
        ['uHeight', new THREE.Uniform(320)],
        ['uGround', new THREE.Uniform(0)],
      ]),
    });
  }
}

class Balance extends Effect {
  constructor() {
    super('Balance', 'uniform vec3 gain; void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) { outputColor = vec4(inputColor.rgb * gain, inputColor.a); }',
      { uniforms: new Map([['gain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))], ['exposure', new THREE.Uniform(1)]]) });
  }
}

// Photo-editor style finishing, as in the tokyo viewer: lifted highlights and
// shadows, a touch of magenta tint correction, vignette.
class Picture extends Effect {
  constructor() {
    super('Picture', /* glsl */`
      uniform float highlights, shadows, tint, vignette, saturation;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = max(inputColor.rgb, 0.0);
        c *= vec3(1.0, 1.0 - 0.1 * tint, 1.0) * (1.0 + 0.05 * tint);
        vec3 g = pow(c, vec3(1.0 / 2.2));
        float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
        g += 0.3 * shadows * (1.0 - smoothstep(0.0, 0.5, l)) * (1.0 - l) * g / max(l, 0.05) * 0.5 + 0.3 * highlights * smoothstep(0.5, 1.0, l) * l;
        l = dot(g, vec3(0.2126, 0.7152, 0.0722));
        g = mix(vec3(l), g, saturation);
        g *= 1.0 - vignette * smoothstep(0.35, 1.0, length(uv - 0.5) * 1.3);
        outputColor = vec4(pow(max(g, 0.0), vec3(2.2)), inputColor.a);
      }`, {
      uniforms: new Map([
        ['highlights', new THREE.Uniform(0.15)], ['shadows', new THREE.Uniform(0.03)], ['tint', new THREE.Uniform(-0.25)],
        ['vignette', new THREE.Uniform(0.18)], ['saturation', new THREE.Uniform(1.06)],
      ]),
    });
  }
}

class Dither extends Effect {
  constructor() {
    super('Dither', /* glsl */`
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        outputColor = vec4(inputColor.rgb + (n - 0.5) / 255.0, inputColor.a);
      }`);
  }
}

export function createPost(renderer, scene, camera, { ao = true } = {}) {
  renderer.toneMapping = THREE.NoToneMapping;
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));
  let aoPass = null;
  if (ao) {
    aoPass = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
    Object.assign(aoPass.configuration, {
      aoRadius: 7, distanceFalloff: 1, intensity: 2.6, halfRes: true, gammaCorrection: false,
      aoSamples: 8, denoiseSamples: 4,
    });
    aoPass.configuration.color = new THREE.Color(0.02, 0.02, 0.03);
    composer.addPass(aoPass);
  }
  const fog = new FogEffect(camera);
  composer.addPass(new EffectPass(camera, fog));
  const balance = new Balance();
  const bloom = new BloomEffect({ intensity: 0.5, luminanceThreshold: 0.9, luminanceSmoothing: 0.2, mipmapBlur: true });
  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
  const picture = new Picture();
  composer.addPass(new EffectPass(camera, balance, bloom, toneMapping, picture, new Dither()));
  composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM })));

  return {
    composer,
    ao: aoPass,
    setSize(w, h) { composer.setSize(w, h); },
    setInteractive(on) { if (aoPass) aoPass.enabled = !on; },
    // env: the Environment for this frame; ground: the height fog sits on.
    apply(env, ground) {
      balance.uniforms.get('gain').value.copy(env.balance).multiplyScalar(env.exposure);
      bloom.intensity = env.bloom;
      const u = fog.uniforms;
      u.get('uColor').value.copy(env.fogColor).multiplyScalar(1 / env.exposure);
      u.get('uGround').value = ground;
    },
    render(dt) { composer.render(dt); },
  };
}
