import * as THREE from "three";
import { QUALITY, type Quality } from "../core/settings";
import { clamp, mulberry32 } from "../core/util";
import { COLS, FACADE_H, GRID, ROOMS, ROWS, T } from "../world/map";
import type { Weather } from "../types";

/**
 * GPU weather. Rain streaks, ground ripples and dust motes all move in their
 * vertex shaders: the CPU only writes a handful of uniforms per frame. Each
 * effect lives in a box that follows the camera, with positions wrapped in
 * world space so nothing slides along with the player.
 *
 * Everything is lit per vertex by the torch and the renderer's point-light
 * pool (read from scene.userData, see renderer.ts), so rain glitters in the
 * beam and dust hangs in it, and both flash with lightning.
 */

const NUM_POOL = 8; // shader slots; the renderer's pool is never larger

// Rain falls at a whole number of metres per second and the fall clock wraps
// every RAIN_PERIOD seconds, so every drop is back where it started when the
// clock wraps and the loop is seamless at any precision.
const RAIN_BOX = new THREE.Vector3(40, 20, 40);
const RAIN_BELOW = 4; // box spans eye - 4 m .. eye + 16 m
const RAIN_PERIOD = 20; // RAIN_BOX.y / RAIN_PERIOD = 1 m/s per speed step
const RAIN_MIN_SPEED = 8;
const RAIN_SPEED_STEPS = 5; // 8..12 m/s
const WIND = new THREE.Vector2(1.4, 0.55);

const SPLASH_BOX = 16;
const SPLASH: Record<Quality, number> = { low: 140, medium: 260, high: 420, ultra: 600 };

const DUST_BOX = new THREE.Vector3(10, 5, 10);
const DUST_BELOW = 1.9;
const DUST: Record<Quality, number> = { low: 900, medium: 1600, high: 2600, ultra: 3600 };

const MAX_RAIN = Math.max(...Object.values(QUALITY).map((q) => q.rain));
const MAX_SPLASH = Math.max(...Object.values(SPLASH));
const MAX_DUST = Math.max(...Object.values(DUST));

/** The school's roofed rectangle (x0, z0, x1, z1) from the floor plan. */
function footprint(): THREE.Vector4 {
  let r0 = ROWS,
    r1 = -1,
    c0 = COLS,
    c1 = -1;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (!ROOMS[GRID[r][c]]?.indoor) continue;
      r0 = Math.min(r0, r);
      r1 = Math.max(r1, r);
      c0 = Math.min(c0, c);
      c1 = Math.max(c1, c);
    }
  if (r1 < 0) return new THREE.Vector4(1e6, 1e6, -1e6, -1e6);
  return new THREE.Vector4(c0 * T, r0 * T, (c1 + 1) * T, (r1 + 1) * T);
}

// ---------------------------------------------------------------- shaders

const commonVert = /* glsl */ `
#define NUM_POOL ${NUM_POOL}
uniform float uTime;
uniform vec3 uCam;
uniform float uViewH;
uniform float uFlash;
uniform vec3 uTorchPos;
uniform vec3 uTorchDir;
uniform vec2 uTorchCone;
uniform vec3 uTorchCol;
uniform vec4 uLightPos[NUM_POOL];
uniform vec3 uLightCol[NUM_POOL];
uniform vec4 uFoot;
uniform float uRoof;
#ifdef USE_FOG
uniform float fogDensity;
#endif

bool underRoof(vec3 p) {
  return p.y < uRoof && p.x > uFoot.x && p.x < uFoot.z && p.z > uFoot.y && p.z < uFoot.w;
}

float fogKeep(float depth) {
#ifdef USE_FOG
  float f = fogDensity * depth;
  return exp(-f * f);
#else
  return 1.0;
#endif
}

// Light reaching a particle at p seen along v (camera to particle).
// k scales scattering; drops glow most when a light is behind them.
vec3 particleLight(vec3 p, vec3 v, vec3 ambient, float k, float forward) {
  vec3 c = ambient * (1.0 + uFlash * 8.0);
  vec3 tl = p - uTorchPos;
  float td2 = dot(tl, tl);
  float cone = smoothstep(uTorchCone.x, uTorchCone.y, dot(tl * inversesqrt(max(td2, 1e-6)), uTorchDir));
  c += uTorchCol * (cone * k / max(td2, 0.3));
  for (int i = 0; i < NUM_POOL; i++) {
    vec4 L = uLightPos[i];
    vec3 d = L.xyz - p;
    float d2 = dot(d, d);
    float win = clamp(1.0 - d2 / (L.w * L.w), 0.0, 1.0);
    float back = max(dot(v, d * inversesqrt(max(d2, 1e-6))), 0.0);
    float phase = 0.55 + forward * pow(back, 6.0);
    c += uLightCol[i] * (win * win * k * phase / max(d2, 0.4));
  }
  return c;
}
`;

const rainVert = /* glsl */ `
${commonVert}
uniform float uFallT;
uniform vec3 uWindOff;
uniform vec3 uWindVel;
uniform vec3 uBox;
uniform float uBelow;
uniform float uOpacity;
attribute vec4 aDrop;
varying vec3 vCol;
varying vec2 vQuad;

void main() {
  float speed = floor(${RAIN_MIN_SPEED.toFixed(1)} + aDrop.w * ${RAIN_SPEED_STEPS.toFixed(1)}) * ${(RAIN_BOX.y / RAIN_PERIOD).toFixed(4)};
  vec3 vel = vec3(uWindVel.x, -speed, uWindVel.z);
  vec3 boxMin = vec3(uCam.x - uBox.x * 0.5, uCam.y - uBelow, uCam.z - uBox.z * 0.5);
  vec3 p = vec3(aDrop.x * uBox.x + uWindOff.x, aDrop.y * uBox.y - uFallT * speed, aDrop.z * uBox.z + uWindOff.z);
  p = boxMin + mod(p - boxMin, uBox);

  float fade = uOpacity;
  fade *= 1.0 - smoothstep(uBox.x * 0.36, uBox.x * 0.49, length(p.xz - uCam.xz));
  fade *= 1.0 - smoothstep(uBox.y - uBelow - 4.0, uBox.y - uBelow, p.y - uCam.y);
  if (underRoof(p)) fade = 0.0;
  if (fade < 0.002) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // clipped
    vCol = vec3(0.0);
    vQuad = vec2(0.0);
    return;
  }

  // Velocity-stretched streak: head at y = 0, tail up-wind.
  vec3 dir = normalize(vel);
  float len = 0.08 + speed * 0.042;
  vec3 q = p - dir * (len * position.y);
  vec3 toQ = q - cameraPosition;
  float dist = max(length(toQ), 1e-3);
  vec3 view = toQ / dist;
  vec3 side = cross(dir, view);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  // Never thinner than about a pixel: thin far drops get fainter instead of shimmering.
  float pixel = dist * 2.0 / (projectionMatrix[1][1] * uViewH);
  float width = max(0.006, pixel * 1.25);
  fade *= 0.006 / width;
  fade *= smoothstep(0.3, 1.4, dist);

  vec4 mv = viewMatrix * vec4(q + side * (position.x * width), 1.0);
  gl_Position = projectionMatrix * mv;
  fade *= fogKeep(-mv.z);

  vCol = particleLight(p, view, vec3(0.018, 0.022, 0.028), 0.05, 1.8) * fade;
  vQuad = vec2(position.x * 2.0, position.y);
}
`;

const rainFrag = /* glsl */ `
varying vec3 vCol;
varying vec2 vQuad;
void main() {
  float across = 1.0 - vQuad.x * vQuad.x;
  float along = smoothstep(0.0, 0.1, vQuad.y) * (1.0 - smoothstep(0.35, 1.0, vQuad.y));
  gl_FragColor = vec4(vCol * (across * along), 1.0);
}
`;

const splashVert = /* glsl */ `
${commonVert}
uniform float uOpacity;
uniform float uBoxS;
attribute vec4 aSplash;
varying vec3 vCol;
varying vec2 vLocal;
varying float vRing;
varying float vLife;

float hash11(float n) {
  return fract(sin(n) * 43758.5453);
}

void main() {
  float period = 0.5 + aSplash.w * 0.5;
  float tt = uTime / period + aSplash.z;
  float cycle = floor(tt);
  float life = fract(tt);
  // A fresh spot each cycle, fixed in the world while it plays.
  vec2 jitter = vec2(hash11(cycle * 12.9898 + aSplash.x * 78.233), hash11(cycle * 39.3468 + aSplash.y * 11.135));
  vec2 xz = fract(aSplash.xy + jitter) * uBoxS;
  vec2 boxMin = uCam.xz - vec2(uBoxS * 0.5);
  vec2 w = boxMin + mod(xz - boxMin, vec2(uBoxS));
  vec3 p = vec3(w.x, 0.012, w.y);

  float fade = uOpacity * (1.0 - smoothstep(uBoxS * 0.33, uBoxS * 0.47, length(w - uCam.xz)));
  if (underRoof(p)) fade = 0.0;
  if (fade < 0.002) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    vCol = vec3(0.0);
    vLocal = vec2(0.0);
    vRing = 0.0;
    vLife = 1.0;
    return;
  }

  float size = 0.1 + 0.08 * aSplash.w;
  vec2 local = position.xy * (size * 2.4);
  vec4 mv = viewMatrix * vec4(p.x + local.x, p.y, p.z + local.y, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 toP = p - cameraPosition;
  fade *= fogKeep(-mv.z);
  vCol = particleLight(p, normalize(toP), vec3(0.03, 0.035, 0.045), 0.04, 0.6) * fade;
  vLocal = local;
  vRing = size * (0.15 + 0.85 * sqrt(life));
  vLife = life;
}
`;

const splashFrag = /* glsl */ `
varying vec3 vCol;
varying vec2 vLocal;
varying float vRing;
varying float vLife;
void main() {
  float d = length(vLocal);
  float w = 0.008 + 0.018 * vLife;
  float x = (d - vRing) / w;
  float ring = exp(-x * x) * (1.0 - vLife) * (1.0 - vLife);
  float spark = exp(-d * d / 0.0006) * (1.0 - smoothstep(0.0, 0.18, vLife));
  gl_FragColor = vec4(vCol * (ring * 0.7 + spark * 1.6), 1.0);
}
`;

const dustVert = /* glsl */ `
${commonVert}
uniform vec3 uDustOff;
uniform vec3 uBox;
uniform float uBelow;
uniform float uOpacity;
attribute float aRand;
varying vec3 vCol;

void main() {
  float t = uTime;
  vec3 wob = vec3(
    sin(t * (0.21 + aRand * 0.3) + aRand * 31.0),
    sin(t * (0.17 + position.x * 0.2) + position.y * 17.0) * 0.6,
    cos(t * (0.19 + position.z * 0.25) + position.z * 23.0)
  ) * 0.22;
  vec3 boxMin = vec3(uCam.x - uBox.x * 0.5, uCam.y - uBelow, uCam.z - uBox.z * 0.5);
  vec3 p = position * uBox + uDustOff + wob;
  p = boxMin + mod(p - boxMin, uBox);

  float fade = uOpacity;
  fade *= 1.0 - smoothstep(uBox.x * 0.34, uBox.x * 0.48, length(p.xz - uCam.xz));
  if (!underRoof(p)) fade = 0.0;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  fade *= smoothstep(0.25, 0.7, dist);
  if (fade < 0.002) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    vCol = vec3(0.0);
    return;
  }

  float sizePx = (0.01 + 0.012 * aRand) * projectionMatrix[1][1] * uViewH * 0.5 / max(dist, 0.01);
  float sz = clamp(sizePx, 1.5, 22.0);
  // Clamped up to a visible size: keep the light it gives the same.
  fade *= min(1.0, (sizePx * sizePx) / (sz * sz));
  // Motes turn as they drift and catch the light now and then.
  fade *= 0.45 + 0.55 * pow(0.5 + 0.5 * sin(t * (0.7 + aRand * 1.6) + aRand * 57.0), 3.0);
  fade *= fogKeep(dist);

  gl_PointSize = sz;
  gl_Position = projectionMatrix * mv;
  vCol = particleLight(p, normalize(p - cameraPosition), vec3(0.004, 0.0038, 0.0035), 0.05, 1.2) * fade;
}
`;

const dustFrag = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol * (exp(-r2 * 3.0) * (1.0 - r2)), 1.0);
}
`;

// ---------------------------------------------------------------- factory

export function createWeather(scene: THREE.Scene, quality: Quality): Weather {
  const rng = mulberry32(0x5eed);

  const shared = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uViewH: { value: 900 },
    uFlash: { value: 0 },
    uTorchPos: { value: new THREE.Vector3() },
    uTorchDir: { value: new THREE.Vector3(0, 0, -1) },
    uTorchCone: { value: new THREE.Vector2(0.85, 0.95) },
    uTorchCol: { value: new THREE.Vector3() },
    uLightPos: { value: Array.from({ length: NUM_POOL }, () => new THREE.Vector4(0, -1000, 0, 1)) },
    uLightCol: { value: Array.from({ length: NUM_POOL }, () => new THREE.Vector3()) },
    uFoot: { value: footprint() },
    uRoof: { value: FACADE_H + 0.4 },
  };

  const material = (vertexShader: string, fragmentShader: string, own: Record<string, THREE.IUniform>) =>
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shared, ...own },
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

  // ------------------------------------------------------------------ rain
  const rainGeo = new THREE.InstancedBufferGeometry();
  rainGeo.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
  rainGeo.setIndex([0, 1, 2, 2, 1, 3]);
  const drops = new Float32Array(MAX_RAIN * 4);
  for (let i = 0; i < drops.length; i++) drops[i] = rng();
  rainGeo.setAttribute("aDrop", new THREE.InstancedBufferAttribute(drops, 4));
  const rainU = {
    uFallT: { value: 0 },
    uWindOff: { value: new THREE.Vector3() },
    uWindVel: { value: new THREE.Vector3(WIND.x, 0, WIND.y) },
    uBox: { value: RAIN_BOX.clone() },
    uBelow: { value: RAIN_BELOW },
    uOpacity: { value: 1 },
  };
  const rain = new THREE.Mesh(rainGeo, material(rainVert, rainFrag, rainU));
  rain.name = "rain";

  // --------------------------------------------------------------- ripples
  const splashGeo = new THREE.InstancedBufferGeometry();
  splashGeo.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3));
  splashGeo.setIndex([0, 2, 1, 1, 2, 3]);
  const spl = new Float32Array(MAX_SPLASH * 4);
  for (let i = 0; i < spl.length; i++) spl[i] = rng();
  splashGeo.setAttribute("aSplash", new THREE.InstancedBufferAttribute(spl, 4));
  const splashU = { uOpacity: { value: 1 }, uBoxS: { value: SPLASH_BOX } };
  const splash = new THREE.Mesh(splashGeo, material(splashVert, splashFrag, splashU));
  splash.name = "rainRipples";

  // ------------------------------------------------------------------ dust
  const dustGeo = new THREE.BufferGeometry();
  const seeds = new Float32Array(MAX_DUST * 3);
  const rands = new Float32Array(MAX_DUST);
  for (let i = 0; i < MAX_DUST; i++) {
    seeds[i * 3] = rng();
    seeds[i * 3 + 1] = rng();
    seeds[i * 3 + 2] = rng();
    rands[i] = rng();
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(seeds, 3));
  dustGeo.setAttribute("aRand", new THREE.BufferAttribute(rands, 1));
  const dustU = {
    uDustOff: { value: new THREE.Vector3() },
    uBox: { value: DUST_BOX.clone() },
    uBelow: { value: DUST_BELOW },
    uOpacity: { value: 0 },
  };
  const dust = new THREE.Points(dustGeo, material(dustVert, dustFrag, dustU));
  dust.name = "dust";

  // Positions are computed in the shaders; the containers just sit on the
  // camera so transparent sorting draws them last.
  for (const o of [rain, splash, dust]) {
    o.frustumCulled = false;
    o.castShadow = false;
    o.receiveShadow = false;
    o.onBeforeRender = (renderer, _s, camera) => syncLights(renderer, camera);
    scene.add(o);
  }

  // -------------------------------------------------------- light hand-off
  const v2 = new THREE.Vector2();
  const tmp = new THREE.Vector3();
  let syncedFrame = -1;
  let torch: THREE.SpotLight | null = null;

  function syncLights(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    // Runs during the world render, after matrices are updated, once per frame.
    const frame = renderer.info.render.frame;
    if (frame === syncedFrame) return;
    syncedFrame = frame;
    renderer.getDrawingBufferSize(v2);
    shared.uViewH.value = Math.max(1, v2.y);

    const ud = scene.userData;
    shared.uFlash.value = typeof ud.flash === "number" ? ud.flash : 0;

    if (!torch) torch = (ud.torch as THREE.SpotLight | undefined) ?? (camera.getObjectByName("torch") as THREE.SpotLight | undefined) ?? null;
    const tc = shared.uTorchCol.value;
    if (torch && torch.visible && torch.intensity > 0) {
      const tp = shared.uTorchPos.value.setFromMatrixPosition(torch.matrixWorld);
      shared.uTorchDir.value.setFromMatrixPosition(torch.target.matrixWorld).sub(tp).normalize();
      shared.uTorchCone.value.set(Math.cos(torch.angle), Math.cos(torch.angle * (1 - torch.penumbra)));
      tc.set(torch.color.r, torch.color.g, torch.color.b).multiplyScalar(torch.intensity);
    } else tc.set(0, 0, 0);

    const pool = ud.lightPool as THREE.PointLight[] | undefined;
    const lp = shared.uLightPos.value;
    const lc = shared.uLightCol.value;
    for (let i = 0; i < NUM_POOL; i++) {
      const L = pool && i < pool.length ? pool[i] : null;
      if (L && L.visible && L.intensity > 0) {
        tmp.setFromMatrixPosition(L.matrixWorld);
        lp[i].set(tmp.x, tmp.y, tmp.z, L.distance > 0 ? L.distance : 30);
        lc[i].set(L.color.r, L.color.g, L.color.b).multiplyScalar(L.intensity);
      } else {
        lp[i].set(0, -1000, 0, 1);
        lc[i].set(0, 0, 0);
      }
    }
  }

  // ------------------------------------------------------------- per frame
  let rainCount = 0;
  let splashCount = 0;
  let dustCount = 0;
  function setQuality(q: Quality) {
    rainCount = Math.min(MAX_RAIN, QUALITY[q].rain);
    splashCount = SPLASH[q];
    dustCount = DUST[q];
  }
  setQuality(quality);

  const wrap = (v: number, m: number) => ((v % m) + m) % m;
  let lastTime = -1;

  function update(time: number, cam: THREE.Vector3, indoor: number) {
    const dt = lastTime < 0 ? 0 : clamp(time - lastTime, 0, 0.1);
    lastTime = time;
    const k = clamp(indoor, 0, 1);

    shared.uTime.value = time % 3600;
    shared.uCam.value.copy(cam);

    // Gusting wind, integrated here so the streaks stay continuous.
    const gust = 1 + 0.35 * Math.sin(time * 0.31) + 0.2 * Math.sin(time * 1.13 + 1.7);
    const wv = rainU.uWindVel.value.set(WIND.x * gust, 0, WIND.y * gust);
    const wo = rainU.uWindOff.value;
    wo.x = wrap(wo.x + wv.x * dt, RAIN_BOX.x);
    wo.z = wrap(wo.z + wv.z * dt, RAIN_BOX.z);
    rainU.uFallT.value = wrap(time, RAIN_PERIOD);

    const out = 1 - k;
    rainU.uOpacity.value = out;
    splashU.uOpacity.value = out;
    rainGeo.instanceCount = out > 0.003 ? rainCount : 0;
    splashGeo.instanceCount = out > 0.003 ? splashCount : 0;

    const dOff = dustU.uDustOff.value;
    dOff.x = wrap(dOff.x + (0.035 + 0.02 * Math.sin(time * 0.13)) * dt, DUST_BOX.x);
    dOff.y = wrap(dOff.y - 0.012 * dt, DUST_BOX.y);
    dOff.z = wrap(dOff.z + (0.022 + 0.015 * Math.cos(time * 0.11)) * dt, DUST_BOX.z);
    dustU.uOpacity.value = k;
    dustGeo.setDrawRange(0, k > 0.003 ? dustCount : 0);

    rain.position.copy(cam);
    splash.position.copy(cam);
    dust.position.copy(cam);
  }

  // Start with everything drawable so the first compile sees all three programs.
  rainGeo.instanceCount = rainCount;
  splashGeo.instanceCount = splashCount;
  dustGeo.setDrawRange(0, dustCount);

  return { update, setQuality };
}
