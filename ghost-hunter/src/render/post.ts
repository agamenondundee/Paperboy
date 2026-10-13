import * as THREE from "three";
import {
  BlendFunction,
  BloomEffect,
  EdgeDetectionMode,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
} from "postprocessing";
import { QUALITY, type Quality } from "../core/settings";
import { clamp } from "../core/util";

/**
 * HDR post chain:
 *   world RenderPass -> viewmodel RenderPass (depth cleared, colour kept)
 *   -> bloom + exposure + ACES (or exposure + ACES when bloom is off)
 *   -> SMAA (optional) -> one fullscreen "horror" grade pass to the screen.
 *
 * Toggling quality only flips pass.enabled, so nothing recompiles mid-game.
 */

export interface FxInputs {
  fear: number;
  lowNerve: number;
  hurt: number;
  uv: number;
  escape: number;
}

export interface PostChain {
  composer: EffectComposer;
  setFx(fx: FxInputs): void;
  /** Linear exposure applied before tone mapping (eye adaptation, lightning). */
  setExposure(v: number): void;
  setQuality(q: Quality): void;
  /** CSS size of the canvas; buffers follow the renderer's pixel ratio. */
  setSize(width: number, height: number): void;
  render(dt: number, time: number): void;
}

// ------------------------------------------------------------- exposure

const exposureFrag = /* glsl */ `
uniform float exposure;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(inputColor.rgb * exposure, inputColor.a);
}
`;

class ExposureEffect extends Effect {
  constructor() {
    super("ExposureEffect", exposureFrag, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([["exposure", new THREE.Uniform(1)]]),
    });
  }
  set value(v: number) {
    this.uniforms.get("exposure")!.value = v;
  }
}

// ---------------------------------------------------------- horror grade

// Runs after tone mapping on linear 0..1 colour; the pass encodes to sRGB.
// Uniform and function names are prefixed by postprocessing, so none of them
// may share a name with a local variable or with "uv".
const gradeFrag = /* glsl */ `
uniform float fear;
uniform float lowNerve;
uniform float hurt;
uniform float uvTint;
uniform float escape;
uniform float fxTime;
uniform float grain;

float fxHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 st = uv;
  float t = fxTime;

  // Glitch tearing: brief bursts of horizontally displaced bands at high fear.
  float g = smoothstep(0.62, 1.0, fear);
  float burst = 0.0;
  if (g > 0.0) {
    float slot = floor(t * 15.0);
    burst = step(1.0 - 0.2 * g, fxHash(vec2(slot, 7.13)));
    float rows = 14.0 + 34.0 * fxHash(vec2(slot, 2.71));
    float band = floor(st.y * rows);
    float r = fxHash(vec2(band, slot + 0.5));
    st.x += (r - 0.5) * 0.085 * g * burst * step(0.74, r);
    // fine line jitter during a burst
    st.x += (fxHash(vec2(floor(st.y * resolution.y * 0.35), slot)) - 0.5) * 0.0045 * g * burst;
  }

  // Chromatic aberration, radial and stronger towards the edges.
  vec2 c = st - 0.5;
  float r2 = dot(c, c);
  float caAmt = (0.0018 + 0.016 * fear + 0.007 * hurt + 0.012 * burst) * (0.3 + r2 * 2.8);
  vec2 ca = c * caAmt;
  vec3 col;
  col.r = texture2D(inputBuffer, st + ca).r;
  col.g = texture2D(inputBuffer, st).g;
  col.b = texture2D(inputBuffer, st - ca).b;

  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));

  // Low nerve drains the colour (and cools what is left).
  col = mix(col, vec3(luma) * vec3(0.93, 0.98, 1.07), clamp(lowNerve, 0.0, 1.0) * 0.82);

  // UV beam: violet cast that lifts the blues.
  vec3 violet = col * vec3(0.8, 0.62, 1.38) + vec3(0.006, 0.0, 0.016);
  col = mix(col, violet, uvTint * 0.5);

  // Escape: red emergency grade with a slow throb.
  float throb = 0.86 + 0.14 * sin(t * 3.6);
  vec3 alarm = vec3(luma * 1.6 + 0.004, luma * 0.13, luma * 0.11) * throb;
  col = mix(col, alarm, escape * 0.82);

  // Vignette, mostly circular whatever the aspect ratio.
  float ar = resolution.x / max(resolution.y, 1.0);
  float d = length(c * vec2(mix(1.0, ar, 0.55), 1.0));
  float edge = smoothstep(0.22, 0.86, d);
  float vig = 0.42 + 0.24 * fear + 0.22 * lowNerve + 0.18 * hurt;
  col *= 1.0 - clamp(vig, 0.0, 0.92) * edge;

  // Hurt: red pulse that floods in from the edges, darkening as it reddens.
  float beat = 0.82 + 0.18 * sin(t * 9.0);
  float hurtAmt = clamp(hurt, 0.0, 1.0) * beat * (0.3 + 0.7 * edge);
  vec3 blood = col * vec3(1.1, 0.22, 0.2) + vec3(0.075, 0.0, 0.003) * edge;
  col = mix(col, blood, hurtAmt * 0.8);

  // UV glow at the rim.
  col += vec3(0.018, 0.0, 0.045) * uvTint * edge;

  // A faint unsteady exposure when terrified.
  col *= 1.0 - 0.07 * g * fxHash(vec2(floor(t * 24.0), 4.2));

  // Film grain in a perceptual space so it reads evenly in the shadows,
  // and doubles as dither against banding in dark gradients.
  vec2 px = uv * resolution;
  float seed = fract(t * 0.6180339) * 431.0;
  float n = fxHash(px + seed) + fxHash(px.yx * 1.37 + seed * 1.91) - 1.0;
  vec3 p = sqrt(max(col, 0.0));
  float amt = grain * (1.0 + 0.9 * fear + 0.5 * lowNerve) * (1.0 - 0.45 * dot(p, vec3(0.3333)));
  p += n * amt;
  col = p * p;

  outputColor = vec4(max(col, 0.0), inputColor.a);
}
`;

class GradeEffect extends Effect {
  constructor() {
    super("HorrorGradeEffect", gradeFrag, {
      // Samples the input at offset coordinates, so it gets its own pass.
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ["fear", new THREE.Uniform(0)],
        ["lowNerve", new THREE.Uniform(0)],
        ["hurt", new THREE.Uniform(0)],
        ["uvTint", new THREE.Uniform(0)],
        ["escape", new THREE.Uniform(0)],
        ["fxTime", new THREE.Uniform(0)],
        ["grain", new THREE.Uniform(0.032)],
      ]),
    });
  }
  set(name: string, v: number) {
    this.uniforms.get(name)!.value = v;
  }
}

// ------------------------------------------------------------------ chain

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  vmScene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  quality: Quality
): PostChain {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });

  const worldPass = new RenderPass(scene, camera);

  // Hands drawn over the world: keep its colour, start from fresh depth.
  const vmPass = new RenderPass(vmScene, camera);
  vmPass.clearPass.color = false;
  vmPass.clearPass.depth = true;
  vmPass.clearPass.stencil = false;
  vmPass.ignoreBackground = true;

  const bloom = new BloomEffect({
    blendFunction: BlendFunction.ADD, // HDR safe, unlike SCREEN
    mipmapBlur: true,
    luminanceThreshold: 0.85,
    luminanceSmoothing: 0.22,
    intensity: 0.9,
    radius: 0.7,
    levels: 7,
  });
  const exposureA = new ExposureEffect();
  const toneA = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const bloomPass = new EffectPass(camera, bloom, exposureA, toneA);

  // Same grade without bloom, for low quality. Only one of the two runs.
  const exposureB = new ExposureEffect();
  const toneB = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const tonePass = new EffectPass(camera, exposureB, toneB);

  const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH, edgeDetectionMode: EdgeDetectionMode.COLOR });
  // Edges are found on linear colour here, so a lower threshold keeps dark edges.
  smaa.edgeDetectionMaterial.edgeDetectionThreshold = 0.04;
  const smaaPass = new EffectPass(camera, smaa);

  const grade = new GradeEffect();
  const gradePass = new EffectPass(camera, grade);

  composer.addPass(worldPass);
  composer.addPass(vmPass);
  composer.addPass(bloomPass);
  composer.addPass(tonePass);
  composer.addPass(smaaPass);
  composer.addPass(gradePass);

  function setQuality(q: Quality) {
    const Q = QUALITY[q];
    bloomPass.enabled = Q.bloom;
    tonePass.enabled = !Q.bloom;
    smaaPass.enabled = Q.smaa;
    grade.set("grain", q === "low" ? 0.026 : 0.032);
  }
  setQuality(quality);

  return {
    composer,
    setFx(fx) {
      grade.set("fear", clamp(fx.fear, 0, 1));
      grade.set("lowNerve", clamp(fx.lowNerve, 0, 1));
      grade.set("hurt", clamp(fx.hurt, 0, 1));
      grade.set("uvTint", clamp(fx.uv, 0, 1));
      grade.set("escape", clamp(fx.escape, 0, 1));
    },
    setExposure(v) {
      exposureA.value = v;
      exposureB.value = v;
    },
    setQuality,
    setSize(width, height) {
      composer.setSize(width, height);
    },
    render(dt, time) {
      // Wrapped so the grain hash keeps its precision in long sessions.
      grade.set("fxTime", time % 1000);
      composer.render(dt);
    },
  };
}
