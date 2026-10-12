import * as THREE from "three";

/**
 * Ghost shading. Every part of a ghost (body, head, hair, dress, props) is a
 * MeshStandardMaterial patched with the same chunk: a fresnel rim in the
 * ghost's colour, a slow shimmer, legs fading out towards the floor and a
 * noise dissolve with a burning edge. Variation comes only from defines, so a
 * handful of programs cover every ghost and they all compile at warm-up.
 *
 * The uniforms in GhostUniforms are shared objects: each ghost owns one set
 * and every material on that ghost points at it, so one write drives the lot.
 */

export interface GhostUniforms {
  uTime: THREE.IUniform<number>;
  /** Rim and glow colour (linear). */
  uColor: THREE.IUniform<THREE.Color>;
  /** 0 solid .. 1 fully dissolved. */
  uDissolve: THREE.IUniform<number>;
  /** 0..1 UV beam flare. */
  uLit: THREE.IUniform<number>;
  /** 0..1 jump-scare flare. */
  uFlare: THREE.IUniform<number>;
  /** Ghost root in world space, so the noise travels with the ghost. */
  uOrigin: THREE.IUniform<THREE.Vector3>;
  /** Hair and hem drag in the model's own frame (metres at the tips). */
  uDrag: THREE.IUniform<THREE.Vector3>;
}

export function createGhostUniforms(colour: THREE.Color): GhostUniforms {
  return {
    uTime: { value: 0 },
    uColor: { value: colour.clone() },
    uDissolve: { value: 0 },
    uLit: { value: 0 },
    uFlare: { value: 0 },
    uOrigin: { value: new THREE.Vector3() },
    uDrag: { value: new THREE.Vector3() },
  };
}

export type GhostPart = "body" | "head" | "hair" | "skirt" | "solid";

export interface PartOpts {
  color: THREE.ColorRepresentation;
  opacity: number;
  /** Rim glow strength. */
  rim: number;
  roughness?: number;
  metalness?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  map?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  side?: THREE.Side;
  alphaTest?: number;
  /** Smoky, near-black body (the Hollow). */
  smoke?: boolean;
  /** Skin tint the scanned head is desaturated towards. */
  pale?: THREE.ColorRepresentation;
}

const NOISE = /* glsl */ `
float gHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float gNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(gHash(i), gHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(gHash(i + vec3(0.0, 1.0, 0.0)), gHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(gHash(i + vec3(0.0, 0.0, 1.0)), gHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(gHash(i + vec3(0.0, 1.0, 1.0)), gHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
`;

const VERT_PARS = /* glsl */ `
uniform float uTime;
uniform vec3 uDrag;
varying vec3 vGWorld;
varying vec3 vGObj;
#if defined(GHOST_HAIR) || defined(GHOST_SKIRT)
attribute float aSway;
varying float vGSway;
#endif
`;

const VERT_BEGIN = /* glsl */ `
#include <begin_vertex>
vGObj = position;
#if defined(GHOST_HAIR) || defined(GHOST_SKIRT)
vGSway = aSway;
#endif
#ifdef GHOST_HAIR
{
  float s = aSway * aSway;
  float ph = position.x * 23.0 + position.z * 17.0;
  transformed.x += (sin(uTime * 1.3 + ph) * 0.011 + sin(uTime * 2.9 + ph * 2.3) * 0.004 + uDrag.x) * s;
  transformed.z += (sin(uTime * 0.9 + ph * 1.7) * 0.013 + uDrag.z) * s;
  transformed.y += uDrag.y * s;
}
#endif
#ifdef GHOST_SKIRT
{
  float s = aSway * aSway;
  float a = atan(position.z, position.x);
  float k = 1.0 + (sin(a * 5.0 + uTime * 1.7) * 0.05 + sin(a * 3.0 - uTime * 1.1) * 0.04 + sin(a * 9.0 + uTime * 2.6) * 0.015) * s;
  transformed.xz *= k;
  transformed.xz += uDrag.xz * s;
  transformed.y += sin(a * 4.0 + uTime * 1.3) * 0.012 * s;
}
#endif
`;

const VERT_PROJECT = /* glsl */ `
#include <project_vertex>
vGWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform float uDissolve;
uniform float uLit;
uniform float uFlare;
uniform float uRim;
uniform vec3 uColor;
uniform vec3 uOrigin;
uniform vec3 uPale;
varying vec3 vGWorld;
varying vec3 vGObj;
#if defined(GHOST_HAIR) || defined(GHOST_SKIRT)
varying float vGSway;
#endif
${NOISE}
`;

// Dissolve first so discarded fragments cost as little as possible.
const FRAG_START = /* glsl */ `
#include <clipping_planes_fragment>
vec3 gRel = vGWorld - uOrigin;
float gN = gNoise(gRel * 6.0 + vec3(0.0, -uTime * 0.35, 0.0)) * 0.62 + gNoise(gRel * 17.0 + uTime * 0.2) * 0.38;
float gH = clamp(gRel.y * 0.5, 0.0, 1.0);
float gD = gN * 0.78 + gH * 0.22;
float gT = uDissolve * 1.12 - 0.06;
if (gD < gT) discard;
float gEdge = uDissolve > 0.002 ? 1.0 - smoothstep(0.0, 0.08, gD - gT) : 0.0;
float gSock = 0.0;
float gSm = 0.5;
#ifdef GHOST_SKIRT
  float gTat = gNoise(vGObj * vec3(26.0, 9.0, 26.0));
  if (gTat < smoothstep(-0.55, -1.0, vGObj.y) * 0.62) discard;
  diffuseColor.a *= smoothstep(0.0, 0.06, vGSway); // soft waistline
#endif
`;

const FRAG_MAP = /* glsl */ `
#include <map_fragment>
#ifdef GHOST_HEAD
{
  float gl = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(diffuseColor.rgb, uPale * (0.25 + gl * 1.25), 0.85);
  // Sunken sockets, in the scanned head's own units.
  vec3 e1 = (vGObj - vec3(-0.72, 1.72, 1.85)) / vec3(0.52, 0.4, 0.7);
  vec3 e2 = (vGObj - vec3(0.52, 1.72, 1.85)) / vec3(0.52, 0.4, 0.7);
  gSock = max(1.0 - smoothstep(0.35, 1.0, length(e1)), 1.0 - smoothstep(0.35, 1.0, length(e2)));
  diffuseColor.rgb *= 1.0 - 0.98 * gSock;
  diffuseColor.a *= smoothstep(-1.5, -0.8, vGObj.y);
}
#endif
#ifdef GHOST_SMOKE
  gSm = gNoise(gRel * vec3(5.0, 3.0, 5.0) + vec3(0.0, -uTime * 0.7, 0.0));
  diffuseColor.a *= 0.45 + 0.75 * gSm;
#endif
`;

const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
float gFres = 1.0 - abs(dot(normal, normalize(vViewPosition)));
float gRimK = pow(gFres, 2.4) * (1.0 - gSock);
float gShim = 0.7 + 0.3 * sin(uTime * 1.9 + gRel.y * 8.0 + gN * 6.2831);
float gBoost = 1.0 + uLit * 4.0 + uFlare * 3.0;
totalEmissiveRadiance += uColor * (gRimK * uRim * gShim * gBoost + (uLit * 0.18 + uFlare * 0.12) * uRim + gEdge * 7.0);
#ifdef GHOST_SMOKE
  totalEmissiveRadiance += uColor * pow(gSm, 5.0) * 0.35;
#endif
`;

const FRAG_ALPHA = /* glsl */ `
float gFloor = smoothstep(0.03, 0.8, vGWorld.y);
diffuseColor.a = diffuseColor.a * gFloor * (0.8 + 0.2 * gShim) + gRimK * 0.35 * gFloor;
diffuseColor.a = clamp(max(diffuseColor.a, gSock * gFloor), 0.0, 1.0);
diffuseColor.a = max(diffuseColor.a, gEdge);
#include <opaque_fragment>
`;

export function ghostMaterial(u: GhostUniforms, part: GhostPart, o: PartOpts): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: o.color,
    roughness: o.roughness ?? 0.55,
    metalness: o.metalness ?? 0,
    transparent: true,
    opacity: o.opacity,
    depthWrite: true,
    side: o.side ?? THREE.FrontSide,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    map: o.map ?? null,
    normalMap: o.normalMap ?? null,
    alphaTest: o.alphaTest ?? 0,
  });
  m.envMapIntensity = 0.45;
  if (o.normalMap) m.normalScale.set(0.75, 0.75);
  const defines: Record<string, string> = {};
  if (part === "head") defines.GHOST_HEAD = "";
  if (part === "hair") defines.GHOST_HAIR = "";
  if (part === "skirt") defines.GHOST_SKIRT = "";
  if (o.smoke) defines.GHOST_SMOKE = "";
  m.defines = defines;
  const rim = { value: o.rim };
  const pale = { value: new THREE.Color(o.pale ?? 0xd8d4cc) };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = u.uTime;
    shader.uniforms.uColor = u.uColor;
    shader.uniforms.uDissolve = u.uDissolve;
    shader.uniforms.uLit = u.uLit;
    shader.uniforms.uFlare = u.uFlare;
    shader.uniforms.uOrigin = u.uOrigin;
    shader.uniforms.uDrag = u.uDrag;
    shader.uniforms.uRim = rim;
    shader.uniforms.uPale = pale;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_PARS)
      .replace("#include <begin_vertex>", VERT_BEGIN)
      .replace("#include <project_vertex>", VERT_PROJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG_PARS)
      .replace("#include <clipping_planes_fragment>", FRAG_START)
      .replace("#include <map_fragment>", FRAG_MAP)
      .replace("#include <emissivemap_fragment>", FRAG_EMISSIVE)
      .replace("#include <opaque_fragment>", FRAG_ALPHA);
  };
  // Identical source for every ghost material; defines split the variants.
  m.customProgramCacheKey = () => "ghost-std-1";
  return m;
}

/** Unlit glowing bits (pupils). Brightness above 1 feeds the bloom. */
export function glowMaterial(u: GhostUniforms, colour: THREE.Color, intensity: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color: colour.clone().multiplyScalar(intensity),
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uDissolve = u.uDissolve;
    shader.uniforms.uLit = u.uLit;
    shader.uniforms.uFlare = u.uFlare;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uDissolve;\nuniform float uLit;\nuniform float uFlare;")
      .replace(
        "#include <opaque_fragment>",
        "diffuseColor.a *= 1.0 - smoothstep(0.25, 0.7, uDissolve);\noutgoingLight *= 1.0 + uLit * 1.5 + uFlare * 2.5;\n#include <opaque_fragment>"
      );
  };
  m.customProgramCacheKey = () => "ghost-glow-1";
  return m;
}
