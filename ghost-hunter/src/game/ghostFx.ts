import * as THREE from "three";

/**
 * One shared pool of glowing motes for every ghost effect (banishing bursts,
 * repel puffs, teleports). Particles are fire-and-forget: each stores its
 * birth time and the vertex shader does all the motion, so the CPU only
 * touches the buffers when something is emitted.
 */

export interface BurstOpts {
  /** Horizontal radius of the spawn volume. */
  spread: number;
  /** Height range of the spawn volume above y. */
  height: number;
  /** Initial outward/upward speed. */
  speed: number;
  /** Extra upward drift (m/s). */
  rise: number;
  life: number;
  size: number;
  /** Delay before the first particle appears; spread over [0, stagger]. */
  stagger?: number;
}

const VERT = /* glsl */ `
attribute vec3 aVel;
attribute vec4 aInfo; // birth, life, size, seed
attribute vec3 aColor;
uniform float uTime;
uniform float uScale;
varying vec3 vCol;
varying float vA;
void main() {
  float age = uTime - aInfo.x;
  float life = aInfo.y;
  if (age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vCol = vec3(0.0);
    vA = 0.0;
    return;
  }
  float k = age / life;
  vec3 p = position + aVel * age * (1.0 - 0.35 * k);
  p.y += 0.45 * age * age;
  float sw = aInfo.w * 6.2831;
  p.x += sin(uTime * 2.3 + sw) * 0.14 * k;
  p.z += cos(uTime * 1.9 + sw * 1.3) * 0.14 * k;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aInfo.z * uScale * (1.0 - k * 0.55) / max(0.15, -mv.z);
  vCol = aColor;
  vA = smoothstep(0.0, 0.06, k) * (1.0 - smoothstep(0.5, 1.0, k)) * (0.75 + 0.25 * sin(uTime * 23.0 + sw * 9.0));
}
`;

const FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  float a = 1.0 - d;
  a *= a;
  gl_FragColor = vec4(vCol, a * vA);
}
`;

export class GhostParticles {
  readonly points: THREE.Points;
  private readonly cap: number;
  private cursor = 0;
  private time = 0;
  private readonly pos: THREE.BufferAttribute;
  private readonly vel: THREE.BufferAttribute;
  private readonly info: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  private readonly uTime = { value: 0 };
  private readonly uScale = { value: 500 };
  private dirty = false;

  constructor(scene: THREE.Scene, capacity = 640) {
    this.cap = capacity;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.vel = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    const info = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) info[i * 4] = -1e6; // long dead
    this.info = new THREE.BufferAttribute(info, 4);
    this.col = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    for (const a of [this.pos, this.vel, this.info, this.col]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.pos);
    geo.setAttribute("aVel", this.vel);
    geo.setAttribute("aInfo", this.info);
    geo.setAttribute("aColor", this.col);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: this.uTime, uScale: this.uScale },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.name = "ghostParticles";
    scene.add(this.points);
  }

  /** Emit n motes around (x, y, z). Colour is linear and may exceed 1 for bloom. */
  emit(x: number, y: number, z: number, colour: THREE.Color, n: number, o: BurstOpts) {
    const p = this.pos.array as Float32Array,
      v = this.vel.array as Float32Array,
      inf = this.info.array as Float32Array,
      c = this.col.array as Float32Array;
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.cap;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * o.spread;
      p[i * 3] = x + Math.cos(a) * r;
      p[i * 3 + 1] = y + Math.random() * o.height;
      p[i * 3 + 2] = z + Math.sin(a) * r;
      const s = o.speed * (0.4 + Math.random() * 0.6);
      v[i * 3] = Math.cos(a) * s;
      v[i * 3 + 1] = o.rise * (0.5 + Math.random()) + s * 0.3;
      v[i * 3 + 2] = Math.sin(a) * s;
      inf[i * 4] = this.time + Math.random() * (o.stagger ?? 0);
      inf[i * 4 + 1] = o.life * (0.6 + Math.random() * 0.4);
      inf[i * 4 + 2] = o.size * (0.5 + Math.random() * 0.8);
      inf[i * 4 + 3] = Math.random();
      const b = 0.6 + Math.random() * 0.8;
      c[i * 3] = colour.r * b;
      c[i * 3 + 1] = colour.g * b;
      c[i * 3 + 2] = colour.b * b;
    }
    this.dirty = true;
  }

  update(time: number, camera: THREE.Camera) {
    this.time = time;
    this.uTime.value = time;
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const cam = camera as THREE.PerspectiveCamera;
      const h = window.innerHeight * Math.min(window.devicePixelRatio || 1, 1.5);
      this.uScale.value = (h * 0.5) / Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5);
    }
    if (this.dirty) {
      this.dirty = false;
      this.pos.needsUpdate = true;
      this.vel.needsUpdate = true;
      this.info.needsUpdate = true;
      this.col.needsUpdate = true;
    }
  }
}
