import * as THREE from "three";
import type { UvBeam, UvDecal } from "../types";
import { canvas, toTexture, speck, blob, FONT, type Rng } from "./canvasTex";
import { clamp, mulberry32 } from "../core/util";

/**
 * Hidden clues that only show inside the player's UV beam: handprints,
 * footprints and scrawled writing. Every decal shares one shader program;
 * the beam state is read straight from `uvBeam` whenever the material's
 * uniforms are uploaded, so the game just writes to `uvBeam` each frame.
 *
 * Decals are always visible to the renderer (they discard every fragment
 * while the beam is off) so `renderer.compile` sees them before play.
 */

export const uvBeam: UvBeam = {
  origin: new THREE.Vector3(),
  dir: new THREE.Vector3(0, 0, -1),
  cos: Math.cos(0.22),
  range: 12,
  on: 0,
};

/** Suggested widths in metres for single decals, matching the trails. */
export const UV_SIZES = { hand: 0.21, foot: 0.15 } as const;

// ------------------------------------------------------------------ shader

const _dir = new THREE.Vector3();
// Live uniforms: three reads `.value` on every upload (once per material per
// render), so these always reflect the current beam with no update call.
const shared = {
  uOrigin: {
    get value() {
      return uvBeam.origin;
    },
    set value(_v: THREE.Vector3) {},
  },
  uDir: {
    get value() {
      return _dir.copy(uvBeam.dir).normalize();
    },
    set value(_v: THREE.Vector3) {},
  },
  uHalf: {
    get value() {
      return Math.acos(clamp(uvBeam.cos, -1, 1));
    },
    set value(_v: number) {},
  },
  uRange: {
    get value() {
      return Math.max(0.01, uvBeam.range);
    },
    set value(_v: number) {},
  },
  uOn: {
    get value() {
      return clamp(uvBeam.on, 0, 1);
    },
    set value(_v: number) {},
  },
  uTime: {
    get value() {
      return (performance.now() * 0.001) % 1000;
    },
    set value(_v: number) {},
  },
  uColor: { value: new THREE.Color("#b59cff") },
};

const VERT = /* glsl */ `
attribute float aSeed;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vSeed;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec3 o = modelMatrix[3].xyz;
  vSeed = aSeed + fract(sin(dot(o, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uOrigin;
uniform vec3 uDir;
uniform float uHalf;
uniform float uRange;
uniform float uOn;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vSeed;
#include <common>
#include <logdepthbuf_pars_fragment>

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  #include <logdepthbuf_fragment>
  if (uOn < 0.002) discard; // uniform branch: free while the beam is off

  // Seen from behind, mirror so writing still reads the right way round.
  vec2 uv = vUv;
  if (!gl_FrontFacing) uv.x = 1.0 - uv.x;
  float m = texture2D(uMap, uv).a;

  vec3 toF = vWorld - uOrigin;
  float d = length(toF);
  vec3 L = toF / max(d, 1e-4);
  float ang = acos(clamp(dot(L, uDir), -1.0, 1.0));
  float cone = 1.0 - smoothstep(uHalf * 0.7, uHalf * 1.06, ang);
  float fall = (1.0 - smoothstep(uRange * 0.55, uRange, d)) * (1.1 - 0.45 * clamp(d / uRange, 0.0, 1.0));
  float facing = mix(0.45, 1.0, abs(dot(normalize(vNormalW), L)));
  float beam = cone * fall * facing * uOn;
  if (beam * m < 0.002) discard;

  // Fluorescent crawl, a slow pulse and the odd glint where residue is thick.
  float t = uTime;
  float crawl = vnoise(uv * 9.0 + vec2(t * 0.55, -t * 0.4) + vSeed * 17.0);
  float shimmer = 0.8 + 0.2 * crawl + 0.06 * sin(t * 6.3 + vSeed * 31.0);
  float glint = step(0.993, hash12(floor(uv * 96.0) + floor(t * 9.0 + vSeed * 7.0))) * smoothstep(0.45, 0.9, m);

  float hot = 1.0 - smoothstep(0.0, uHalf * 0.8, ang); // centre of the beam
  float core = smoothstep(0.6, 1.0, m);
  vec3 col = mix(uColor, vec3(1.0, 0.95, 1.0), core * core * (0.25 + 0.75 * hot));
  float intensity = beam * (shimmer * (m * 1.1 + core * (0.35 + 1.25 * hot)) + glint * 2.2);
  gl_FragColor = vec4(col * intensity, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function makeMaterial(map: THREE.Texture, name: string) {
  return new THREE.ShaderMaterial({
    name,
    uniforms: { ...shared, uMap: { value: map } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // Additive on colour, leaves the target's alpha alone.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    fog: false,
    lights: false,
  });
}

/** Decal masks live in the alpha channel; clamp so edges never wrap. */
function maskTexture(cv: HTMLCanvasElement, name: string) {
  const t = toTexture(cv, { srgb: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.name = name;
  return t;
}

// ----------------------------------------------------------- painting kit

type Pt = [number, number];
const WHITE = (a: number) => `rgba(255,255,255,${a})`;

/** Closed curve through the midpoints of a polygon, so corners come out round. */
function smoothClosed(g: CanvasRenderingContext2D, pts: Pt[]) {
  const n = pts.length;
  g.beginPath();
  g.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
  for (let i = 0; i < n; i++) {
    const a = pts[i],
      b = pts[(i + 1) % n];
    g.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  g.closePath();
}

function pad(g: CanvasRenderingContext2D, x: number, y: number, rad: number, a: number) {
  const gr = g.createRadialGradient(x, y, 0, x, y, rad);
  gr.addColorStop(0, WHITE(a));
  gr.addColorStop(0.55, WHITE(a * 0.75));
  gr.addColorStop(1, WHITE(0));
  g.fillStyle = gr;
  g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
}

/** A residue smear running down from (x, y), fading out. */
function streak(g: CanvasRenderingContext2D, x: number, y: number, len: number, width: number, a: number, drift: number, r: Rng) {
  const gr = g.createLinearGradient(x, y, x + drift, y + len);
  gr.addColorStop(0, WHITE(a));
  gr.addColorStop(0.55, WHITE(a * 0.45));
  gr.addColorStop(1, WHITE(0));
  g.strokeStyle = gr;
  g.lineWidth = width;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x + drift * 0.4 + (r() - 0.5) * width * 1.6, y + len * 0.5, x + drift, y + len);
  g.stroke();
}

/** A thin wet run that tapers and ends in a bead. */
function drip(g: CanvasRenderingContext2D, x: number, y: number, len: number, width: number, a: number, r: Rng) {
  const gr = g.createLinearGradient(x, y, x, y + len);
  gr.addColorStop(0, WHITE(a));
  gr.addColorStop(1, WHITE(a * 0.75));
  g.fillStyle = gr;
  const wob = (r() - 0.5) * width * 0.8;
  g.beginPath();
  g.moveTo(x - width / 2, y);
  g.quadraticCurveTo(x - width * 0.35 + wob, y + len * 0.5, x - width * 0.28, y + len);
  g.lineTo(x + width * 0.28, y + len);
  g.quadraticCurveTo(x + width * 0.35 + wob, y + len * 0.5, x + width / 2, y);
  g.closePath();
  g.fill();
  g.fillStyle = WHITE(a);
  g.beginPath();
  g.ellipse(x, y + len, width * 0.6, width * 0.75, 0, 0, Math.PI * 2);
  g.fill();
}

/** Papillary ridges: concentric loops cut out of a finger or toe pad. */
function whorl(g: CanvasRenderingContext2D, x: number, y: number, rad: number, rot: number, step: number, r: Rng) {
  g.lineWidth = Math.max(1, step * 0.36);
  g.strokeStyle = WHITE(0.3);
  // Loops rather than a bullseye: each ring opens a little and drifts down.
  const drift = (r() - 0.5) * 0.5;
  for (let i = 0, k = step * 0.8; k < rad; k += step, i++) {
    const a0 = Math.PI * (0.35 + drift) + (r() - 0.5) * 0.5;
    g.beginPath();
    g.ellipse(x + Math.sin(rot) * i * step * 0.12, y + Math.cos(rot) * i * step * 0.18, k, k * 1.45, rot, a0, a0 + Math.PI * (1.55 + r() * 0.35));
    g.stroke();
  }
}

/** Fine, slightly wavy ridges across a whole print. */
function ridges(g: CanvasRenderingContext2D, w: number, y0: number, y1: number, step: number, a: number, r: Rng) {
  g.lineWidth = Math.max(1, step * 0.36);
  g.strokeStyle = WHITE(a);
  const ph = r() * 10;
  for (let y = y0; y < y1; y += step) {
    g.beginPath();
    for (let x = 0; x <= w; x += 6) {
      const yy = y + Math.sin(x * 0.045 + y * 0.02 + ph) * step * 0.9 + Math.sin(x * 0.013 + ph * 2) * step * 2;
      if (x === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }
}

function crease(g: CanvasRenderingContext2D, pts: Pt[], width: number, a: number) {
  g.strokeStyle = WHITE(a);
  g.lineWidth = width;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 3) g.quadraticCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
  else for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.stroke();
}

/** Skin pores and gaps in the residue: tiny round holes (use with destination-out). */
function pores(g: CanvasRenderingContext2D, w: number, h: number, n: number, maxR: number, r: Rng) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = WHITE(0.25 + r() * 0.65);
    g.beginPath();
    g.arc(r() * w, r() * h, 0.5 + r() * r() * maxR, 0, Math.PI * 2);
    g.fill();
  }
}

/** Final pass: a soft glow halo baked into the mask around every stroke. */
function withHalo(src: HTMLCanvasElement, blur: number, a: number) {
  return canvas(src.width, src.height, (g) => {
    g.shadowColor = WHITE(a);
    g.shadowBlur = blur;
    g.drawImage(src, 0, 0);
  });
}

// ------------------------------------------------------------- handprint

/** A right handprint (thumb on the left), smeared downwards. 384 x 512. */
function paintHand(): HTMLCanvasElement {
  const W = 384,
    H = 512,
    U = W;
  const r = mulberry32(0x68616e64);
  const P = (x: number, y: number): Pt => [(x + 0.03) * U, (y + 0.04) * U];
  const dirOf = (a: number): Pt => [Math.sin(a), -Math.cos(a)];

  const fingers = [
    { b: P(0.33, 0.47), a: -0.14, len: 0.33, w: 0.093 }, // index
    { b: P(0.45, 0.455), a: -0.035, len: 0.375, w: 0.098 }, // middle
    { b: P(0.565, 0.47), a: 0.075, len: 0.35, w: 0.093 }, // ring
    { b: P(0.675, 0.51), a: 0.21, len: 0.27, w: 0.081 }, // little
    { b: P(0.335, 0.77), a: -0.8, len: 0.29, w: 0.11 }, // thumb
  ];
  const palm: Pt[] = [
    P(0.31, 0.47),
    P(0.45, 0.44),
    P(0.6, 0.45),
    P(0.72, 0.5),
    P(0.75, 0.62),
    P(0.73, 0.78),
    P(0.66, 0.92),
    P(0.53, 0.965),
    P(0.4, 0.935),
    P(0.31, 0.84),
    P(0.27, 0.7),
    P(0.28, 0.56),
  ];
  const along = (f: (typeof fingers)[number], t: number): Pt => {
    const d = dirOf(f.a);
    return [f.b[0] + d[0] * f.len * U * t, f.b[1] + d[1] * f.len * U * t];
  };
  const tipPad = (f: (typeof fingers)[number]): Pt => along(f, 1 - (f.w * 0.62) / f.len);

  // Silhouette.
  const shape = canvas(W, H, (g) => {
    g.fillStyle = g.strokeStyle = "#fff";
    g.lineCap = "round";
    smoothClosed(g, palm);
    g.fill();
    for (const f of fingers) {
      const isThumb = f === fingers[4];
      const from = along(f, isThumb ? -0.05 : -0.12);
      // Three overlapping strokes so each finger tapers a little.
      const segs = [
        [0, 0.45, 1],
        [0.4, 0.75, 0.95],
        [0.7, 1 - (f.w * 0.5) / f.len, 0.9],
      ];
      for (const [t0, t1, k] of segs) {
        const a = t0 === 0 ? from : along(f, t0);
        const b = along(f, t1);
        g.lineWidth = f.w * U * k;
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        g.stroke();
      }
    }
  });

  // Residue density inside the silhouette: strongest on the pads.
  const print = canvas(W, H, (g) => {
    g.fillStyle = WHITE(0.42);
    g.fillRect(0, 0, W, H);
    for (const f of fingers) {
      const t = tipPad(f);
      pad(g, t[0], t[1], f.w * U * 0.8, 1);
      const mid = along(f, 0.58);
      pad(g, mid[0], mid[1], f.w * U * 0.55, 0.5);
    }
    for (const [x, y] of [
      [0.37, 0.5],
      [0.48, 0.49],
      [0.6, 0.5],
      [0.7, 0.54],
    ])
      pad(g, ...P(x, y), 0.075 * U, 0.85);
    pad(g, ...P(0.39, 0.81), 0.13 * U, 0.9); // thenar
    pad(g, ...P(0.68, 0.72), 0.11 * U, 0.8); // hypothenar
    pad(g, ...P(0.54, 0.9), 0.08 * U, 0.7); // heel

    g.globalCompositeOperation = "destination-in";
    g.drawImage(shape, 0, 0);

    g.globalCompositeOperation = "destination-out";
    // The hollow of the palm barely touches the wall.
    const [hx, hy] = P(0.54, 0.68);
    const hollow = g.createRadialGradient(hx, hy, 0, hx, hy, 0.14 * U);
    hollow.addColorStop(0, WHITE(0.6));
    hollow.addColorStop(1, WHITE(0));
    g.fillStyle = hollow;
    g.fillRect(hx - 0.14 * U, hy - 0.14 * U, 0.28 * U, 0.28 * U);

    ridges(g, W, 0, H, 0.0088 * U, 0.26, r);
    for (const f of fingers) {
      const t = tipPad(f);
      whorl(g, t[0], t[1], f.w * U * 0.62, f.a, 0.0088 * U, r);
      // Joint creases across each finger.
      const d = dirOf(f.a);
      const n: Pt = [-d[1], d[0]];
      const joints = f === fingers[4] ? [0.5] : [0.02, 0.42, 0.7];
      for (const j of joints) {
        const c = along(f, j);
        const hw = f.w * U * 0.6;
        crease(
          g,
          [
            [c[0] - n[0] * hw, c[1] - n[1] * hw],
            [c[0] + n[0] * hw, c[1] + n[1] * hw],
          ],
          0.012 * U,
          0.9
        );
      }
    }
    crease(g, [P(0.75, 0.585), P(0.6, 0.565), P(0.43, 0.52)], 0.011 * U, 0.85); // heart line
    crease(g, [P(0.29, 0.6), P(0.48, 0.63), P(0.7, 0.7)], 0.011 * U, 0.85); // head line
    crease(g, [P(0.3, 0.6), P(0.42, 0.72), P(0.45, 0.95)], 0.012 * U, 0.85); // life line
    for (let i = 0; i < 46; i++) blob(g, r() * W, r() * H, (0.012 + r() * 0.035) * U, WHITE(0.1 + r() * 0.25), r);
    pores(g, W, H, 2200, 1.8, r);
  });

  const body = canvas(W, H, (g) => {
    // Dragged copies under the print give the smear its body.
    for (let k = 1; k <= 28; k++) {
      g.globalAlpha = 0.05 * Math.pow(1 - k / 29, 1.3);
      g.drawImage(print, k * 0.25, k * 3.4);
    }
    g.globalAlpha = 1;
    for (const f of fingers.slice(0, 4)) {
      const t = tipPad(f);
      for (const s of [-0.22, 0.2]) {
        streak(g, t[0] + s * f.w * U, t[1], (0.12 + r() * 0.2) * U, (0.02 + r() * 0.016) * U, 0.4 + r() * 0.2, (r() - 0.3) * 6, r);
      }
    }
    for (let i = 0; i < 6; i++) {
      const [x, y] = P(0.4 + r() * 0.3, 0.86 + r() * 0.05);
      streak(g, x, y, (0.1 + r() * 0.2) * U, (0.016 + r() * 0.018) * U, 0.3 + r() * 0.25, (r() - 0.3) * 8, r);
    }
    const [tx, ty] = P(0.36, 0.86);
    streak(g, tx, ty, 0.16 * U, 0.03 * U, 0.4, 2, r);
    g.drawImage(print, 0, 0);
    for (let i = 0; i < 3; i++) {
      const [x, y] = P(0.44 + r() * 0.22, 0.93);
      drip(g, x, y, Math.min((0.1 + r() * 0.16) * U, H - y - 0.05 * U), (0.009 + r() * 0.006) * U, 0.75, r);
    }
  });

  return withHalo(body, 12, 0.55);
}

// ------------------------------------------------------------- footprint

/** A bare right footprint (big toe on the left, toes up). 256 x 464. */
function paintFoot(): HTMLCanvasElement {
  const W = 256,
    H = 464,
    U = W;
  const r = mulberry32(0x666f6f74);
  const P = (x: number, y: number): Pt => [x * U, (y - 0.22) * U];

  const sole: Pt[] = [
    P(0.3, 0.8),
    P(0.4, 0.67),
    P(0.62, 0.66),
    P(0.8, 0.76),
    P(0.83, 0.96),
    P(0.79, 1.2),
    P(0.75, 1.45),
    P(0.76, 1.63),
    P(0.7, 1.83),
    P(0.54, 1.9),
    P(0.38, 1.84),
    P(0.32, 1.66),
    P(0.38, 1.48),
    P(0.53, 1.3),
    P(0.5, 1.1),
    P(0.35, 0.96),
  ];
  const toes = [
    { c: P(0.33, 0.47), rx: 0.112, ry: 0.142, rot: -0.15 },
    { c: P(0.52, 0.47), rx: 0.07, ry: 0.085, rot: 0.05 },
    { c: P(0.645, 0.505), rx: 0.064, ry: 0.076, rot: 0.15 },
    { c: P(0.75, 0.56), rx: 0.058, ry: 0.068, rot: 0.25 },
    { c: P(0.835, 0.64), rx: 0.051, ry: 0.06, rot: 0.35 },
  ];

  const shape = canvas(W, H, (g) => {
    g.fillStyle = "#fff";
    smoothClosed(g, sole);
    g.fill();
    for (const t of toes) {
      g.beginPath();
      g.ellipse(t.c[0], t.c[1], t.rx * U, t.ry * U, t.rot, 0, Math.PI * 2);
      g.fill();
    }
  });

  const print = canvas(W, H, (g) => {
    g.fillStyle = WHITE(0.4);
    g.fillRect(0, 0, W, H);
    toes.forEach((t, i) => pad(g, t.c[0], t.c[1] - t.ry * U * 0.1, t.rx * U * 1.15, i === 0 ? 1 : 0.9));
    pad(g, ...P(0.42, 0.79), 0.17 * U, 0.95); // ball, big toe side
    pad(g, ...P(0.67, 0.81), 0.15 * U, 0.85); // ball, little toe side
    pad(g, ...P(0.74, 1.25), 0.1 * U, 0.55); // outer edge
    pad(g, ...P(0.55, 1.68), 0.21 * U, 0.95); // heel

    g.globalCompositeOperation = "destination-in";
    g.drawImage(shape, 0, 0);

    g.globalCompositeOperation = "destination-out";
    const [ax, ay] = P(0.6, 1.28);
    const arch = g.createRadialGradient(ax, ay, 0, ax, ay, 0.14 * U);
    arch.addColorStop(0, WHITE(0.45));
    arch.addColorStop(1, WHITE(0));
    g.fillStyle = arch;
    g.fillRect(ax - 0.14 * U, ay - 0.14 * U, 0.28 * U, 0.28 * U);
    ridges(g, W, 0, H, 0.012 * U, 0.24, r);
    toes.forEach((t) => whorl(g, t.c[0], t.c[1], t.rx * U * 0.95, t.rot, 0.012 * U, r));
    for (let i = 0; i < 34; i++) blob(g, r() * W, r() * H, (0.015 + r() * 0.04) * U, WHITE(0.1 + r() * 0.22), r);
    pores(g, W, H, 1500, 1.6, r);
  });

  const body = canvas(W, H, (g) => {
    // A slight slip at the heel.
    for (let k = 1; k <= 4; k++) {
      g.globalAlpha = 0.1 / k;
      g.drawImage(print, 0, k * 2.5);
    }
    g.globalAlpha = 1;
    g.drawImage(print, 0, 0);
  });

  return withHalo(body, 9, 0.5);
}

// ------------------------------------------------------------------ text

const chalkFont = (px: number) => `700 ${Math.max(1, Math.round(px))}px ${FONT.chalk}`;
const TEXT_PX = 120;
const TEXT_MAX_W = 2048;
// Canvas height in units of the font size: top pad, cap height, line gaps, descent and room for drips.
const textRows = (lines: number) => 2.05 + (lines - 1) * 1.12;
const textPadX = (F: number) => F * 0.32;

let measureCtx: CanvasRenderingContext2D | null = null;
function lineWidth(g: CanvasRenderingContext2D, line: string) {
  let w = 0;
  for (const ch of line) w += g.measureText(ch).width * 0.97;
  return w;
}

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Size a canvas to fit the text at the default font size. */
function makeTextCanvas(text: string) {
  const lines = text.split("\n");
  measureCtx ??= document.createElement("canvas").getContext("2d")!;
  const g = measureCtx;
  let F = TEXT_PX;
  g.font = chalkFont(F);
  let maxW = 1;
  for (const l of lines) maxW = Math.max(maxW, lineWidth(g, l));
  const full = maxW + textPadX(F) * 2;
  if (full > TEXT_MAX_W) {
    // Long lines: shrink the lettering rather than exceed the texture limit.
    const k = TEXT_MAX_W / full;
    F *= k;
    maxW *= k;
  }
  const w = Math.min(TEXT_MAX_W, Math.ceil(maxW + textPadX(F) * 2));
  const h = Math.ceil(F * textRows(lines.length));
  const cv = document.createElement("canvas");
  cv.width = Math.max(16, w);
  cv.height = Math.max(16, h);
  paintText(cv, text);
  return cv;
}

/** Scrawl the text into an existing canvas (also used to redraw once the chalk font arrives). */
function paintText(cv: HTMLCanvasElement, text: string) {
  const W = cv.width,
    H = cv.height;
  const lines = text.split("\n");
  const r = mulberry32(hashString(text));

  const body = canvas(W, H, (g) => {
    let F = H / textRows(lines.length);
    g.font = chalkFont(F);
    let maxW = 1;
    for (const l of lines) maxW = Math.max(maxW, lineWidth(g, l));
    const avail = W - textPadX(F) * 2;
    if (maxW > avail) {
      F *= avail / maxW;
      g.font = chalkFont(F);
    }
    g.textBaseline = "alphabetic";
    g.fillStyle = g.strokeStyle = "#fff";
    g.lineJoin = "round";

    const slope = (r() - 0.5) * 0.06;
    let lastBase = 0;
    lines.forEach((line, li) => {
      const lw = lineWidth(g, line);
      let x = (W - lw) / 2;
      const base = F * (0.3 + 0.9 + li * 1.12);
      lastBase = base;
      let j = 0;
      for (const ch of line) {
        const adv = g.measureText(ch).width * 0.97;
        if (ch.trim()) {
          const y = base + (x - W / 2) * slope + Math.sin(j * 0.9 + li) * F * 0.025 + (r() - 0.5) * F * 0.05;
          const s = 1 + (r() - 0.5) * 0.12;
          g.save();
          g.translate(x + adv / 2, y);
          g.rotate((r() - 0.5) * 0.16);
          g.scale(s, s * (1 + (r() - 0.5) * 0.1));
          g.globalAlpha = 0.9;
          g.fillText(ch, -adv / 2, 0);
          // Rough, doubled edges like a chalk stick dragged twice.
          g.globalAlpha = 0.35;
          g.fillText(ch, -adv / 2 + (r() - 0.5) * F * 0.03, (r() - 0.5) * F * 0.03);
          g.fillText(ch, -adv / 2 + (r() - 0.5) * F * 0.03, (r() - 0.5) * F * 0.03);
          g.globalAlpha = 0.45;
          g.lineWidth = F * 0.022;
          g.strokeText(ch, -adv / 2, 0);
          g.restore();
        }
        x += adv;
        j++;
      }
    });

    // Chalk grain: dust gaps and skips along the writing direction.
    g.globalAlpha = 1;
    g.globalCompositeOperation = "destination-out";
    speck(g, W, H, Math.round((W * H) / 45), 0.75, r);
    g.lineCap = "round";
    for (let i = 0, n = Math.round((W * H) / 2600); i < n; i++) {
      const x = r() * W,
        y = r() * H,
        len = F * (0.05 + r() * 0.22);
      g.strokeStyle = WHITE(0.25 + r() * 0.35);
      g.lineWidth = 1 + r() * F * 0.012;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + len, y + (r() - 0.5) * len * 0.3);
      g.stroke();
    }
    g.globalCompositeOperation = "source-over";

    // Drips hang from the lowest painted pixel of random columns.
    const data = g.getImageData(0, 0, W, H).data;
    const yMax = Math.min(H - 1, Math.round(lastBase + F * 0.3));
    const chars = text.replace(/\s/g, "").length;
    const want = clamp(Math.round(chars * 0.55), chars ? 2 : 0, 40);
    for (let i = 0, tries = 0; i < want && tries < want * 8; tries++) {
      const x = Math.round(textPadX(F) * 0.5 + r() * (W - textPadX(F)));
      let y = -1;
      for (let yy = yMax; yy > 0; yy--) {
        if (data[(yy * W + x) * 4 + 3] > 150) {
          y = yy;
          break;
        }
      }
      if (y < 0) continue;
      const wd = F * (0.018 + r() * 0.022);
      const len = Math.min(F * (0.1 + Math.pow(r(), 1.6) * 0.7), H - y - wd * 1.6 - 2);
      if (len > F * 0.05) drip(g, x, y - wd, len, wd, 0.82, r);
      i++;
    }
  });

  const g = cv.getContext("2d")!;
  g.clearRect(0, 0, W, H);
  g.shadowColor = WHITE(0.5);
  g.shadowBlur = Math.max(6, H * 0.03);
  g.drawImage(body, 0, 0);
}

// Start fetching the chalk face early (no-op if the page never declares it).
try {
  document.fonts?.load(chalkFont(64), "A").catch(() => {});
} catch {
  /* font loading API unavailable */
}

// ----------------------------------------------------------- kinds cache

interface Kind {
  mat: THREE.ShaderMaterial;
  /** Height / width of the texture. */
  aspect: number;
}
const kinds: Partial<Record<"hand" | "foot", Kind>> = {};
const textKinds = new Map<string, Kind>();

function printKind(k: "hand" | "foot"): Kind {
  let kind = kinds[k];
  if (!kind) {
    const cv = k === "hand" ? paintHand() : paintFoot();
    kind = kinds[k] = { mat: makeMaterial(maskTexture(cv, "uv-" + k), "uv-" + k), aspect: cv.height / cv.width };
  }
  return kind;
}

function textKind(text: string): Kind {
  let kind = textKinds.get(text);
  if (!kind) {
    const cv = makeTextCanvas(text);
    const tex = maskTexture(cv, "uv-text");
    kind = { mat: makeMaterial(tex, "uv-text"), aspect: cv.height / cv.width };
    textKinds.set(text, kind);
    // Drawn with a fallback face if the chalk font is still on its way: redraw when it lands.
    try {
      const fonts = document.fonts;
      const font = chalkFont(64);
      if (fonts && text.trim() && !fonts.check(font, text)) {
        fonts
          .load(font, text)
          .then((faces) => {
            if (!faces.length) return;
            paintText(cv, text);
            tex.needsUpdate = true;
          })
          .catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }
  return kind;
}

function kindFor(d: { kind: UvDecal["kind"]; text?: string }): Kind {
  return d.kind === "text" ? textKind(d.text ?? "") : printKind(d.kind);
}

let unitPlane: THREE.PlaneGeometry | null = null;
function plane() {
  if (!unitPlane) {
    unitPlane = new THREE.PlaneGeometry(1, 1);
    unitPlane.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(4), 1));
  }
  return unitPlane;
}

// ------------------------------------------------------------------- API

/**
 * One glowing quad. Width is `d.size` metres; height follows the texture. The
 * plane faces +Z before rotation, so floor decals use rx = -PI/2 (toes or
 * fingers then point along -Z rotated by ry).
 */
export function addUvDecal(parent: THREE.Object3D, d: UvDecal): THREE.Mesh {
  const kind = kindFor(d);
  const mesh = new THREE.Mesh(plane(), kind.mat);
  const w = d.size > 0 ? d.size : d.kind === "text" ? 1.2 : UV_SIZES[d.kind];
  mesh.name = "uv-" + d.kind;
  mesh.position.set(d.x, d.y, d.z);
  mesh.rotation.set(d.rx, d.ry, d.rz, "YXZ");
  mesh.scale.set(w, w * kind.aspect, 1);
  mesh.renderOrder = 2;
  parent.add(mesh);
  return mesh;
}

/**
 * Prints every ~0.9 m along a floor polyline (in `parent`'s space), left and
 * right alternately, facing the way of travel. One merged mesh per call.
 */
export function addUvTrail(parent: THREE.Object3D, points: { x: number; z: number }[], kind: "hand" | "foot"): THREE.Object3D {
  const n = points.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  const total = n > 0 ? cum[n - 1] : 0;
  if (n < 2 || total < 0.3) {
    const empty = new THREE.Object3D();
    empty.name = "uv-trail-" + kind;
    parent.add(empty);
    return empty;
  }

  const at = (s: number, out: Pt) => {
    s = clamp(s, 0, total);
    let i = 1;
    while (i < n - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1];
    const t = seg > 1e-6 ? (s - cum[i - 1]) / seg : 0;
    out[0] = points[i - 1].x + (points[i].x - points[i - 1].x) * t;
    out[1] = points[i - 1].z + (points[i].z - points[i - 1].z) * t;
    return out;
  };

  const k = printKind(kind);
  const hand = kind === "hand";
  const size = UV_SIZES[kind];
  const spacing = 0.9;
  const lateral = hand ? 0.17 : 0.1;
  const splay = hand ? 0.3 : 0.09; // prints turn slightly outwards
  const r = mulberry32((Math.round(points[0].x * 97) * 73856093) ^ (Math.round(points[0].z * 97) * 19349663) ^ (n * 83492791));

  const prints: { x: number; z: number; fx: number; fz: number; sc: number; left: boolean; seed: number }[] = [];
  const p: Pt = [0, 0],
    a: Pt = [0, 0],
    b: Pt = [0, 0];
  let side = r() < 0.5 ? 1 : -1;
  for (let s = Math.min(spacing * 0.5, total * 0.5); s <= total + 1e-6; s += spacing) {
    const ss = clamp(s + (r() - 0.5) * 0.12, 0, total);
    at(ss, p);
    at(ss - 0.35, a);
    at(ss + 0.35, b);
    let dx = b[0] - a[0],
      dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) continue;
    dx /= len;
    dz /= len;
    // Right of travel is (-dz, dx).
    const off = side * (lateral + (r() - 0.5) * 0.04);
    const turn = side * splay + (r() - 0.5) * 0.14;
    const c = Math.cos(turn),
      sn = Math.sin(turn);
    // Rotate the heading towards the print's own side.
    const fx = dx * c - dz * sn,
      fz = dz * c + dx * sn;
    prints.push({ x: p[0] - dz * off, z: p[1] + dx * off, fx, fz, sc: 0.94 + r() * 0.12, left: side < 0, seed: r() * 10 });
    side = -side;
  }

  const count = prints.length;
  const pos = new Float32Array(count * 12);
  const nor = new Float32Array(count * 12);
  const uv = new Float32Array(count * 8);
  const seed = new Float32Array(count * 4);
  const index = count * 4 > 65535 ? new Uint32Array(count * 6) : new Uint16Array(count * 6);
  const y = 0.012;
  prints.forEach((q, i) => {
    const hw = (size * q.sc) / 2,
      hh = (size * q.sc * k.aspect) / 2;
    const rx = -q.fz,
      rz = q.fx; // right vector
    // back-left, back-right, front-left, front-right
    const corners = [
      [-hw, -hh],
      [hw, -hh],
      [-hw, hh],
      [hw, hh],
    ];
    corners.forEach(([u, v], j) => {
      const o = (i * 4 + j) * 3;
      pos[o] = q.x + rx * u + q.fx * v;
      pos[o + 1] = y;
      pos[o + 2] = q.z + rz * u + q.fz * v;
      nor[o + 1] = 1;
      const t = (i * 4 + j) * 2;
      const uu = j & 1 ? 1 : 0;
      uv[t] = q.left ? 1 - uu : uu; // left prints are the right print mirrored
      uv[t + 1] = j >> 1;
      seed[i * 4 + j] = q.seed;
    });
    const v0 = i * 4,
      o = i * 6;
    index[o] = v0;
    index[o + 1] = v0 + 1;
    index[o + 2] = v0 + 2;
    index[o + 3] = v0 + 2;
    index[o + 4] = v0 + 1;
    index[o + 5] = v0 + 3;
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, k.mat);
  mesh.name = "uv-trail-" + kind;
  mesh.renderOrder = 2;
  parent.add(mesh);
  return mesh;
}
