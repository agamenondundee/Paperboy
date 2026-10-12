import * as THREE from "three";
import type { Assets } from "../types";
import type { Quality } from "../core/settings";
import type { Atlas } from "./levelAtlas";
import * as T from "./levelTextures";

/**
 * Every material the level uses, keyed by geometry bucket. Tile sizes are in
 * metres: geometry UVs are metres, so each texture repeats 1 / tile.
 */

export interface LevelMats {
  mats: Record<string, THREE.Material>;
  flags(key: string): { cast: boolean; receive: boolean; order?: number };
  locker: THREE.MeshStandardMaterial;
  balloon: THREE.MeshStandardMaterial;
  mirror: THREE.MeshStandardMaterial;
  flag: THREE.MeshStandardMaterial;
  doorGlass: THREE.MeshStandardMaterial;
  carLights: THREE.MeshBasicMaterial;
  flame: THREE.MeshBasicMaterial;
  /** Scroll rain on the glass and ripples on the car park; flash (0..1) is the current lightning. */
  update(dt: number, flash: number): void;
}

function rep(t: THREE.Texture, tileU: number, tileV = tileU) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tileU, 1 / tileV);
  t.needsUpdate = true;
  return t;
}

/** Clone a loaded asset texture so it can have its own repeat and colour space. */
function own(t: THREE.Texture | null, srgb: boolean, tileU: number, tileV = tileU) {
  if (!t) return null;
  const c = t.clone();
  c.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  c.anisotropy = Math.max(c.anisotropy, 8);
  return rep(c, tileU, tileV);
}

function surf(s: T.Surf, tileU: number, tileV = tileU) {
  rep(s.map, tileU, tileV);
  if (s.normal) rep(s.normal, tileU, tileV);
  if (s.rough) rep(s.rough, tileU, tileV);
  return s;
}

function std(p: THREE.MeshStandardMaterialParameters) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, ...p });
}

const BEAM_VS = /* glsl */ `
varying vec4 vCol;
varying vec2 vUv;
varying float vFacing;
varying float vDepth;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vCol = vec4(1.0);
  #if defined(USE_COLOR_ALPHA)
    vCol = color;
  #elif defined(USE_COLOR)
    vCol = vec4(color, 1.0);
  #endif
  #ifdef USE_INSTANCING_COLOR
    vCol.rgb *= instanceColor;
  #endif
  vec4 p = vec4(position, 1.0);
  vec3 nrm = normal;
  #ifdef USE_INSTANCING
    mat3 im = mat3(instanceMatrix);
    nrm = im * (nrm / vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2])));
    p = instanceMatrix * p;
  #endif
  vec4 mvPosition = modelViewMatrix * p;
  vec3 n = normalize(normalMatrix * nrm);
  vFacing = abs(dot(n, normalize(-mvPosition.xyz)));
  vDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const BEAM_FS = /* glsl */ `
uniform float uStrength;
varying vec4 vCol;
varying vec2 vUv;
varying float vFacing;
varying float vDepth;
#include <common>
#include <fog_pars_fragment>
void main() {
  float a;
  if (vUv.x > 1.5) {
    // Window-shaped pool of light on the floor, with mullion shadows.
    vec2 p = vec2(vUv.x - 2.0, vUv.y);
    float e = smoothstep(0.0, 0.12, p.x) * smoothstep(1.0, 0.88, p.x) * smoothstep(0.0, 0.12, p.y) * smoothstep(1.0, 0.88, p.y);
    float m = smoothstep(0.012, 0.04, abs(p.x - 0.5)) * smoothstep(0.012, 0.04, abs(p.y - 0.5));
    a = e * m;
  } else {
    // Shaft or cone: bright at the source, fading along its length and at grazing angles.
    float t = clamp(vUv.y, 0.0, 1.0);
    a = smoothstep(0.0, 0.06, t) * pow(1.0 - t, 1.6);
    a *= smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
    a *= pow(vFacing, 1.4);
    a *= smoothstep(0.4, 3.0, vDepth);
  }
  vec3 col = vCol.rgb * vCol.a * a * uStrength;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    col *= 1.0 - fogFactor;
  #endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Additive, fog-aware fake volumetric light (cones, shafts, floor pools). */
export function beamMaterial(vertexColors: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uStrength: { value: 1 } }]),
    vertexShader: BEAM_VS,
    fragmentShader: BEAM_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: true,
    vertexColors,
  });
}

export function makeMaterials(assets: Assets, quality: Quality, atlas: Atlas): LevelMats {
  const big = quality === "low" ? 512 : 1024;
  const mid = quality === "low" ? 256 : 512;

  const block = assets.gen.wall ? surf(T.genSurface(assets.gen.wall, mid, 2), 2.0) : surf(T.blockWall(big), 1.6);
  const plaster = surf(T.plaster(mid), 2.5);
  const panel = surf(T.panel(mid), 1.22);
  const tile = surf(T.glazedTile(mid), 1.2);
  const vinylS = T.vinyl(big);
  if (assets.gen.floor) {
    const g = assets.gen.floor;
    g.wrapS = g.wrapT = THREE.RepeatWrapping;
    g.colorSpace = THREE.SRGBColorSpace;
    vinylS.map = g;
  }
  const vinyl = surf(vinylS, 2.44);
  const carpet = surf(T.carpet(mid), 2.0);
  const concrete = surf(T.concrete(mid), 4.0);
  const terrazzo = surf(T.terrazzo(big), 3.6);
  const asphalt = surf(T.asphalt(big), 14);
  const grass = surf(T.grass(mid), 5);
  const ceiling = surf(T.ceilingTile(mid), 2.44);
  const deck = surf(T.steelDeck(quality === "low" ? 128 : 256), 1.2);
  const grating = surf(T.grating(256), 1.0);
  const curtain = surf(T.curtain(256), 1.2, 1.2);
  const fabric = surf(T.carpet(256), 0.8);
  const brickFb = !assets.tex.brick ? surf(T.brickFallback(big), 2.0) : null;
  const water = own(assets.tex.water, false, 3);

  const mats: Record<string, THREE.Material> = {};

  mats.block = std({ map: block.map, normalMap: block.normal ?? null, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.8 });
  mats.plaster = std({ map: plaster.map, normalMap: plaster.normal ?? null, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.9 });
  mats.panel = std({ map: panel.map, normalMap: panel.normal ?? null, roughness: 0.55 });
  mats.tile = std({ map: tile.map, normalMap: tile.normal ?? null, normalScale: new THREE.Vector2(0.7, 0.7), roughnessMap: tile.rough ?? null, roughness: 1 });
  mats.brick = brickFb
    ? std({ map: brickFb.map, normalMap: brickFb.normal ?? null, roughness: 0.9 })
    : std({
        map: own(assets.tex.brick, true, 2.0),
        bumpMap: own(assets.tex.brickBump, false, 2.0),
        bumpScale: 2,
        roughnessMap: own(assets.tex.brickRough, false, 2.0),
        roughness: 1,
      });

  mats.vinyl = std({ map: vinyl.map, roughnessMap: vinyl.rough ?? null, roughness: 1, normalMap: vinyl.normal ?? null, normalScale: new THREE.Vector2(0.4, 0.4) });
  const wood = own(assets.tex.wood, true, 2.0, 0.9);
  const woodR = own(assets.tex.woodRough, false, 2.0, 0.9);
  mats.woodFloor = wood ? std({ map: wood, roughnessMap: woodR, roughness: 0.62 }) : std({ map: panel.map, roughness: 0.4 });
  mats.carpet = std({ map: carpet.map, normalMap: carpet.normal ?? null, roughness: 1 });
  mats.concrete = std({ map: concrete.map, roughnessMap: concrete.rough ?? null, roughness: 1, normalMap: concrete.normal ?? null, normalScale: new THREE.Vector2(0.6, 0.6) });
  const checker = own(assets.tex.checker, true, 1.83);
  const checkerN = own(assets.tex.checkerNormal, false, 1.83);
  mats.checker = checker ? std({ map: checker, normalMap: checkerN, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.3 }) : std({ map: vinyl.map, roughness: 0.3 });
  mats.terrazzo = std({ map: terrazzo.map, roughnessMap: terrazzo.rough ?? null, roughness: 1 });
  mats.asphalt = std({ map: asphalt.map, roughnessMap: asphalt.rough ?? null, roughness: 1, normalMap: water, normalScale: new THREE.Vector2(0.14, 0.14) });
  mats.grass = std({ map: grass.map, roughness: 0.95 });
  mats.ceiling = std({ map: ceiling.map, normalMap: ceiling.normal ?? null, roughness: 0.95 });
  mats.deck = std({ map: deck.map, normalMap: deck.normal ?? null, roughness: 0.6, metalness: 0.4 });
  mats.grating = std({ map: grating.map, normalMap: grating.normal ?? null, roughness: 0.45, metalness: 0.7 });

  // Metals keep some diffuse response: indoors the environment is too dark for pure metals to read.
  mats.metal = std({ roughness: 0.5, metalness: 0.45 });
  mats.chrome = std({ roughness: 0.26, metalness: 0.62 });
  mats.paint = std({ roughness: 0.85 });
  mats.gloss = std({ roughness: 0.28 });
  const woodP = own(assets.tex.wood, true, 1.2, 0.6);
  const woodPR = own(assets.tex.woodRough, false, 1.2, 0.6);
  mats.wood = woodP ? std({ map: woodP, roughnessMap: woodPR, roughness: 0.75 }) : std({ map: panel.map, roughness: 0.6 });
  mats.cloth = std({ map: fabric.map, normalMap: fabric.normal ?? null, roughness: 1 });
  mats.curtain = std({ map: curtain.map, normalMap: curtain.normal ?? null, roughness: 0.9, side: THREE.DoubleSide });

  mats.atlas = std({ map: atlas.texture, alphaTest: 0.5, roughness: 0.75 });
  mats.glow = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5 });
  const moon = T.moonGlass(quality === "low" ? 128 : 256, quality === "low" ? 256 : 512);
  moon.wrapS = moon.wrapT = THREE.ClampToEdgeWrapping;
  mats.moon = new THREE.MeshBasicMaterial({ map: moon, vertexColors: true });
  const streaks = T.rainStreaks(128, 512);
  streaks.repeat.set(1, 0.7);
  mats.rainGlass = new THREE.MeshBasicMaterial({ map: streaks, vertexColors: true });
  mats.darkGlass = new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.05, metalness: 0.1 });
  const slats = T.blindSlats();
  slats.repeat.set(1, 10);
  mats.blinds = std({ map: slats, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 });
  mats.glass = std({ transparent: true, roughness: 0.04, metalness: 0, depthWrite: false, opacity: 1 });
  const link = T.chainLink(64);
  rep(link, 0.12);
  mats.fence = new THREE.MeshStandardMaterial({ color: 0x8e959b, metalness: 0.7, roughness: 0.45, alphaMap: link, transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, depthWrite: false });
  const splat = assets.tex.splat ? own(assets.tex.splat, true, 1) : T.splatFallback();
  if (splat) {
    splat.wrapS = splat.wrapT = THREE.ClampToEdgeWrapping;
    splat.repeat.set(1, 1);
  }
  const splatN = assets.tex.splatNormal ? own(assets.tex.splatNormal, false, 1) : null;
  if (splatN) {
    splatN.wrapS = splatN.wrapT = THREE.ClampToEdgeWrapping;
    splatN.repeat.set(1, 1);
  }
  mats.decal = std({
    map: splat,
    normalMap: splatN,
    normalScale: new THREE.Vector2(0.5, 0.5),
    transparent: true,
    depthWrite: false,
    roughness: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  mats.ao = new THREE.MeshBasicMaterial({
    color: 0x000000,
    alphaMap: T.aoTex(),
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const trees = T.treeLine(quality === "low" ? 1024 : 2048, 256);
  mats.treeline = new THREE.MeshBasicMaterial({ color: 0x06080a, alphaMap: trees, alphaTest: 0.5, side: THREE.DoubleSide });
  mats.beam = beamMaterial(true);
  (mats.beam as THREE.ShaderMaterial).uniforms.uStrength.value = 1;
  mats.paintDecal = std({ roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mats.atlasDecal = std({ map: atlas.texture, alphaTest: 0.5, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

  for (const [k, m] of Object.entries(mats)) m.name = `level.${k}`;

  const lockerS = T.lockerTex();
  const locker = new THREE.MeshStandardMaterial({ map: lockerS.map, normalMap: lockerS.normal ?? null, roughness: 0.5, metalness: 0.35, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
  locker.name = "level.locker";
  const balloon = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.15 });
  balloon.name = "level.balloon";
  const mirror = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.08, metalness: 1, flatShading: true });
  mirror.name = "level.mirrorBall";
  const flag = new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.85, side: THREE.DoubleSide });
  flag.name = "level.flag";
  const doorGlass = new THREE.MeshStandardMaterial({ color: 0x9fb2bb, transparent: true, opacity: 0.22, roughness: 0.04, depthWrite: false });
  doorGlass.name = "level.doorGlass";
  const carLights = new THREE.MeshBasicMaterial({ vertexColors: true });
  carLights.name = "level.carLights";
  const flame = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  flame.name = "level.flame";

  const flat = new Set(["vinyl", "woodFloor", "carpet", "concrete", "checker", "terrazzo", "asphalt", "grass", "ceiling", "deck", "grating"]);
  const unlit = new Set(["glow", "moon", "rainGlass", "treeline"]);
  const order: Record<string, number> = { ao: 1, paintDecal: 1, atlasDecal: 1, decal: 2, glass: 5, fence: 6, beam: 10 };
  const noCast = new Set(["atlas", "atlasDecal", "paintDecal", "blinds", "glass", "fence", "decal", "ao", "beam", "darkGlass"]);

  let lastFlash = 0;
  return {
    mats,
    flags(key) {
      const transparent = key === "ao" || key === "beam" || key === "decal" || key === "glass" || key === "fence";
      return {
        cast: !flat.has(key) && !unlit.has(key) && !noCast.has(key),
        receive: !unlit.has(key) && !transparent && key !== "darkGlass",
        order: order[key],
      };
    },
    locker,
    balloon,
    mirror,
    flag,
    doorGlass,
    carLights,
    flame,
    update(dt: number, flash: number) {
      // Lightning floods in through the windows and lights up the shafts.
      if (flash !== lastFlash) {
        lastFlash = flash;
        (mats.moon as THREE.MeshBasicMaterial).color.setRGB(1 + flash * 5, 1 + flash * 5.5, 1 + flash * 6.5);
        (mats.rainGlass as THREE.MeshBasicMaterial).color.setRGB(1 + flash * 3, 1 + flash * 3.4, 1 + flash * 4);
        (mats.beam as THREE.ShaderMaterial).uniforms.uStrength.value = 1 + flash * 5;
      }
      streaks.offset.y += dt * 0.045;
      if (streaks.offset.y > 1) streaks.offset.y -= 1;
      if (water) {
        water.offset.x = (water.offset.x + dt * 0.011) % 1;
        water.offset.y = (water.offset.y + dt * 0.017) % 1;
      }
    },
  };
}
