import * as THREE from "three";
import type { GhostUniforms } from "./ghostMaterial";

/**
 * A filmed apparition: a looping video of the spirit shot against pure black,
 * drawn on a camera-facing card. Black becomes transparent, so only the
 * figure remains, and it shares the ghost's uniforms so the dissolve, the UV
 * flare and the jump-scare flare behave exactly like the 3D body it replaces.
 */

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uVideo;
uniform float uTime;
uniform float uDissolve;
uniform float uLit;
uniform float uFlare;
uniform vec3 uColor;
uniform vec3 uOrigin;
uniform float uFade;
varying vec2 vUv;
varying vec3 vWorld;

float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

void main() {
  // A slight heat-haze wobble so the footage never looks like a flat card.
  vec2 uv = vUv;
  uv.x += sin(uv.y * 23.0 + uTime * 3.1) * 0.0025;
  vec3 c = texture2D(uVideo, uv).rgb;
  float lum = max(c.r, max(c.g, c.b));
  float a = smoothstep(0.035, 0.22, lum);
  // Soften the card edges and let the feet melt into the floor.
  a *= smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x) * smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.95, vUv.y);

  vec3 rel = vWorld - uOrigin;
  float n = noise(rel * 6.0 + vec3(0.0, -uTime * 0.35, 0.0)) * 0.7 + noise(rel * 17.0 + uTime * 0.2) * 0.3;
  float t = uDissolve * 1.12 - 0.06;
  if (n < t) discard;
  float edge = uDissolve > 0.002 ? 1.0 - smoothstep(0.0, 0.08, n - t) : 0.0;

  float shimmer = 0.88 + 0.12 * sin(uTime * 2.3 + vWorld.y * 7.0 + n * 6.28);
  vec3 col = c * (1.15 + uLit * 1.8 + uFlare * 1.2) * shimmer;
  col += uColor * (lum * 0.35 * (0.4 + uLit * 2.5) + edge * 6.0);
  a = clamp(a * (0.86 + 0.14 * shimmer) + edge, 0.0, 1.0) * uFade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Apparition {
  readonly mesh: THREE.Mesh;
  private video: HTMLVideoElement;
  private tex: THREE.VideoTexture;
  private playing = false;
  private fade = { value: 0 };

  /** height: metres from the floor to the top of the card. */
  constructor(url: string, u: GhostUniforms, height: number, aspect = 9 / 16) {
    const v = (this.video = document.createElement("video"));
    v.src = url;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    this.tex = new THREE.VideoTexture(v);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uVideo: { value: this.tex },
        uTime: u.uTime,
        uDissolve: u.uDissolve,
        uLit: u.uLit,
        uFlare: u.uFlare,
        uColor: u.uColor,
        uOrigin: u.uOrigin,
        uFade: this.fade,
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.PlaneGeometry(height * aspect, height);
    geo.translate(0, height / 2, 0);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = "apparition";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    v.addEventListener("loadeddata", () => (this.fade.value = 1), { once: true });
  }

  /** True once the video has frames, so the 3D body can be hidden. */
  get ready() {
    return this.fade.value > 0;
  }

  /** Face the camera around the vertical axis and keep the footage running only while seen. */
  update(camera: THREE.Camera, visible: boolean) {
    if (visible !== this.playing) {
      this.playing = visible;
      if (visible) this.video.play().catch(() => {});
      else this.video.pause();
    }
    if (!visible) return;
    const parent = this.mesh.parent;
    if (!parent) return;
    const e = camera.matrixWorld.elements;
    parent.getWorldPosition(_p);
    const yaw = Math.atan2(e[12] - _p.x, e[14] - _p.z);
    parent.getWorldQuaternion(_q);
    _e.setFromQuaternion(_q, "YXZ");
    this.mesh.rotation.y = yaw - _e.y;
  }

  dispose() {
    this.video.pause();
    this.video.removeAttribute("src");
    this.tex.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
