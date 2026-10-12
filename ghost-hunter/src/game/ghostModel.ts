import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Assets, GhostKind } from "../types";
import { canvas, toTexture } from "../world/canvasTex";
import { clamp, damp, lerp, mulberry32, smoothstep } from "../core/util";
import { createGhostUniforms, ghostMaterial, glowMaterial, type GhostUniforms } from "./ghostMaterial";

/**
 * Ghost visuals: the Xbot mannequin cloned per ghost and re-dressed as a
 * spirit (scanned head, hair, dress, props), or a procedural robed figure
 * when the rig failed to load. The AI writes a few plain fields (speed,
 * sneak, frozen, scare...) and update() turns them into animation.
 *
 * All placement numbers are in the mannequin's bind pose, in metres with the
 * model standing at the origin facing +Z. Props are mounted on bones through
 * the inverse of the bone's bind-pose world matrix, so they can be authored
 * in that friendly space and still follow the animation.
 */

export interface GhostLook {
  rim: number;
  body: number;
  joints: number;
  opacity: number;
  rimStrength: number;
  scale: [number, number, number];
  hover: number;
  smoke: boolean;
  pale: number;
  pupil: number;
  pupilGlow: number;
  pupilSize: number;
  /** Ghost light intensity at rest (candela). */
  light: number;
}

export const LOOKS: Record<GhostKind, GhostLook> = {
  queen: { rim: 0xc9a2ff, body: 0xd8cfee, joints: 0xa395c2, opacity: 0.5, rimStrength: 1.8, scale: [1, 1, 1], hover: 0.15, smoke: false, pale: 0xe2dcec, pupil: 0xd9b8ff, pupilGlow: 9, pupilSize: 1, light: 1.6 },
  janitor: { rim: 0x8dff5a, body: 0xa9b89a, joints: 0x6a775e, opacity: 0.56, rimStrength: 1.6, scale: [1.12, 1.12, 1.12], hover: 0, smoke: false, pale: 0xd0d8c2, pupil: 0xb4ff70, pupilGlow: 8, pupilSize: 1, light: 1.4 },
  principal: { rim: 0xff3b2e, body: 0xb3abab, joints: 0x6d6262, opacity: 0.58, rimStrength: 1.7, scale: [1.05, 1.05, 1.05], hover: 0, smoke: false, pale: 0xded4ce, pupil: 0xff4a3a, pupilGlow: 9, pupilSize: 1, light: 1.4 },
  hollow: { rim: 0xff1a0e, body: 0x040304, joints: 0x020202, opacity: 0.88, rimStrength: 0.55, scale: [1.12, 1.22, 1.12], hover: 0, smoke: true, pale: 0x0d0b0b, pupil: 0xff2010, pupilGlow: 16, pupilSize: 0.65, light: 1.8 },
};

// Bind-pose anchors (metres, model space).
const HEAD_CENTRE = new THREE.Vector3(0.004, 1.69, 0.003);
const LEE_ORIGIN = new THREE.Vector3(0.004, 1.607, -0.012);
const LEE_SCALE = 0.05;
const WAIST = new THREE.Vector3(0, 1.12, 0.005);
const CHEST = new THREE.Vector3(0, 1.334, 0);
const RIGHT_HIP = new THREE.Vector3(-0.178, 0.99, 0.03);
const HEAD_JOINT = new THREE.Vector3(0, 1.596, -0.01);
// Eye centres on the scanned head, in its own units.
const EYES: [number, number, number][] = [
  [-0.72, 1.7, 1.97],
  [0.52, 1.7, 1.97],
];

const IDENT = new THREE.Quaternion();
const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Y = new THREE.Vector3(0, 1, 0);
const REACH_L = new THREE.Quaternion()
  .setFromAxisAngle(AX_X, -0.22)
  .multiply(new THREE.Quaternion().setFromAxisAngle(AX_Y, -Math.PI / 2 - 0.12));
const REACH_R = new THREE.Quaternion()
  .setFromAxisAngle(AX_X, -0.22)
  .multiply(new THREE.Quaternion().setFromAxisAngle(AX_Y, Math.PI / 2 + 0.12));
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _e = new THREE.Euler();

// ------------------------------------------------------------ shared kit

type ClipName = "idle" | "walk" | "run" | "sneak" | "sad" | "agree" | "shake";

/** Things every ghost shares: the rig, prepared clips, the head mesh and prop geometry. */
export class GhostKit {
  readonly xbot: GLTF | null;
  readonly clips: Partial<Record<ClipName, THREE.AnimationClip>> = {};
  readonly headGeo: THREE.BufferGeometry;
  readonly headMap: THREE.Texture | null;
  readonly headNormal: THREE.Texture | null;
  readonly pupilGeo = new THREE.SphereGeometry(0.1, 10, 8);
  private cache = new Map<string, THREE.BufferGeometry>();
  private hairTexture: THREE.Texture | null = null;

  constructor(assets: Assets) {
    this.xbot = assets.xbot && assets.xbot.scene ? assets.xbot : null;
    if (this.xbot) {
      const find = (n: string) => this.xbot!.animations.find((c) => c.name === n) || null;
      const base = (n: string) => find(n);
      const additive = (n: string, pose: boolean) => {
        const src = find(n);
        if (!src) return null;
        let c = src.clone();
        THREE.AnimationUtils.makeClipAdditive(c);
        if (pose) c = THREE.AnimationUtils.subclip(c, n + "_add", 2, 3, 30);
        return c;
      };
      const set = (k: ClipName, c: THREE.AnimationClip | null) => {
        if (c) this.clips[k] = c;
      };
      set("idle", base("idle"));
      set("walk", base("walk"));
      set("run", base("run"));
      set("sneak", additive("sneak_pose", true));
      set("sad", additive("sad_pose", true));
      set("agree", additive("agree", false));
      set("shake", additive("headShake", false));
    }
    this.headGeo = this.buildHeadGeo(assets);
    this.headMap = assets.tex.headColour;
    this.headNormal = assets.tex.headNormal;
  }

  geo(key: string, build: () => THREE.BufferGeometry) {
    let g = this.cache.get(key);
    if (!g) {
      g = build();
      this.cache.set(key, g);
    }
    return g;
  }

  get hairTex() {
    if (!this.hairTexture) this.hairTexture = paintHair();
    return this.hairTexture;
  }

  private buildHeadGeo(assets: Assets): THREE.BufferGeometry {
    let src: THREE.BufferGeometry | null = null;
    const scenes = assets.lee ? (assets.lee.scenes?.length ? assets.lee.scenes : [assets.lee.scene]) : [];
    for (const s of scenes) {
      s?.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!src && m.isMesh && m.geometry) src = m.geometry;
      });
      if (src) break;
    }
    if (src) {
      // Drop the shoulders: keep the head and a stub of neck.
      const g = (src as THREE.BufferGeometry).clone();
      const pos = g.getAttribute("position");
      const idx = g.index;
      if (idx) {
        const keep: number[] = [];
        for (let i = 0; i < idx.count; i += 3) {
          const a = idx.getX(i),
            b = idx.getX(i + 1),
            c = idx.getX(i + 2);
          if (pos.getY(a) < -1.65 || pos.getY(b) < -1.65 || pos.getY(c) < -1.65) continue;
          keep.push(a, b, c);
        }
        g.setIndex(keep);
      }
      g.computeBoundingSphere();
      return g;
    }
    // No scan: an egg-shaped skull in the same units as the scan.
    const g = new THREE.SphereGeometry(1, 32, 24);
    g.scale(1.85, 2.45, 2.15);
    g.translate(-0.1, 1.55, 0.25);
    return g;
  }
}

function paintHair(): THREE.Texture {
  const r = mulberry32(1987);
  const cv = canvas(64, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const base = g.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, "rgba(22,15,17,0.97)");
    base.addColorStop(0.55, "rgba(19,13,15,0.86)");
    base.addColorStop(1, "rgba(18,12,14,0)");
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 110; i++) {
      const x = r() * w,
        len = h * (0.5 + r() * 0.5),
        c = 22 + r() * 52;
      g.strokeStyle = `rgba(${c | 0},${(c * 0.78) | 0},${(c * 0.84) | 0},${0.45 + r() * 0.55})`;
      g.lineWidth = 0.6 + r() * 1.4;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + (r() - 0.5) * 6, len * 0.4, x + (r() - 0.5) * 8, len * 0.7, x + (r() - 0.5) * 6, len);
      g.stroke();
    }
    // Ragged tips: cut gaps between clumps towards the ends.
    g.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 16; i++) {
      const x = r() * w;
      const gr = g.createLinearGradient(0, h * 0.4, 0, h);
      gr.addColorStop(0, "rgba(0,0,0,0)");
      gr.addColorStop(1, "rgba(0,0,0,0.95)");
      g.fillStyle = gr;
      g.fillRect(x, h * 0.4, 1 + r() * 4, h * 0.6);
    }
    g.globalCompositeOperation = "source-over";
  });
  return toTexture(cv);
}

// ------------------------------------------------------- prop geometry

/** Merge, converting to non-indexed when the inputs disagree. */
function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const mixed = list.some((g) => g.index) && list.some((g) => !g.index);
  const src = mixed ? list.map((g) => (g.index ? g.toNonIndexed() : g)) : list;
  for (const g of src) {
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv" && k !== "aSway") g.deleteAttribute(k);
  }
  const out = mergeGeometries(src, false);
  if (!out) throw new Error("ghost prop merge failed");
  out.computeBoundingSphere();
  return out;
}

function placed(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1) {
  _m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(_e.set(rx, ry, rz)), new THREE.Vector3(s, s, s));
  g.applyMatrix4(_m);
  return g;
}

function withSway(g: THREE.BufferGeometry, value = 0) {
  const n = g.getAttribute("position").count;
  g.setAttribute("aSway", new THREE.BufferAttribute(new Float32Array(n).fill(value), 1));
  return g;
}

/** Long hair, relative to HEAD_CENTRE: [scalp cap, hanging strand cards]. */
function buildHair(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const r = mulberry32(5161987);
  // The scanned skull, as an ellipsoid around (CX, 0, CZ) from HEAD_CENTRE.
  const RX = 0.082,
    RY = 0.118,
    RZ = 0.106,
    CX = -0.007,
    CZ = -0.011;
  const cap = new THREE.SphereGeometry(1, 30, 12, 0, Math.PI * 2, 0, 1.2);
  cap.scale(RX + 0.007, RY + 0.007, RZ + 0.007);
  cap.rotateX(-0.32);
  cap.translate(CX, 0.002, CZ);
  // Use only the dense upper part of the strand texture, wrapped a few times.
  const cuv = cap.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < cuv.count; i++) cuv.setXY(i, cuv.getX(i) * 5, 1 - (1 - cuv.getY(i)) * 0.4);
  withSway(cap, 0);

  const pos: number[] = [],
    nor: number[] = [],
    uv: number[] = [],
    sway: number[] = [],
    idx: number[] = [];
  const S = 7;
  const layer = (n: number, off: number, lenK: number) => {
    for (let i = 0; i < n; i++) {
      const psi0 = lerp(-2.25, 2.25, (i + 0.2 + r() * 0.6) / n);
      const side = Math.abs(psi0) > 1.2;
      const L = (side ? 0.3 + r() * 0.1 : 0.42 + r() * 0.13) * lenK;
      const cos2 = Math.cos(psi0) ** 2;
      const yr = 0.06 - 0.03 * cos2 - r() * 0.01;
      const w0 = 0.02 + r() * 0.014;
      const u0 = r() * 0.5;
      const twist = (r() - 0.5) * 0.12;
      const base = pos.length / 3;
      let rPrev = 0;
      for (let j = 0; j <= S; j++) {
        const t = j / S;
        const psi = psi0 + twist * t;
        const dx = Math.sin(psi),
          dz = -Math.cos(psi);
        const tx = Math.cos(psi),
          tz = Math.sin(psi);
        const y = yr - L * t;
        const R = 1 / Math.sqrt((dx / RX) ** 2 + (dz / RZ) ** 2);
        const f = Math.sqrt(Math.max(0, 1 - (y / RY) ** 2));
        let rad = Math.max(rPrev, R * f + off);
        // Fall clear of the ears, then of the shoulders and back.
        rad = Math.max(rad, (0.098 + off) * Math.abs(dx) ** 4 * smoothstep(0.07, 0.0, y));
        rad = Math.max(rad, (side ? 0.16 : 0.145) * smoothstep(-0.08, -0.2, y));
        rPrev = rad;
        rad += 0.025 * t * t;
        const w = w0 * (1 - 0.6 * t);
        const cx = CX + dx * rad,
          cz = CZ + dz * rad;
        pos.push(cx - (tx * w) / 2, y, cz - (tz * w) / 2, cx + (tx * w) / 2, y, cz + (tz * w) / 2);
        nor.push(dx, 0, dz, dx, 0, dz);
        const v = 1 - t * 0.97;
        uv.push(u0, v, u0 + 0.5, v);
        sway.push(t, t);
        if (j < S) {
          const a = base + j * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
    }
  };
  layer(64, 0.01, 1);
  layer(44, 0.019, 0.85);
  const strands = new THREE.BufferGeometry();
  strands.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  strands.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  strands.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  strands.setAttribute("aSway", new THREE.Float32BufferAttribute(sway, 1));
  strands.setIndex(idx);
  strands.computeBoundingSphere();
  return [cap, strands];
}

/** Bell skirt from the waist, tattered hem, relative to WAIST. */
function buildSkirt(): THREE.BufferGeometry {
  const prof: [number, number][] = [
    [0.118, 0.1],
    [0.13, 0.04],
    [0.15, -0.03],
    [0.185, -0.12],
    [0.235, -0.26],
    [0.3, -0.44],
    [0.36, -0.62],
    [0.41, -0.8],
    [0.44, -0.92],
    [0.455, -0.98],
  ];
  const segs = 56;
  const g = new THREE.LatheGeometry(
    prof.map(([rr, y]) => new THREE.Vector2(rr, y)),
    segs
  );
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const np = prof.length;
  const sway = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const j = i % np;
    const x = p.getX(i),
      z = p.getZ(i);
    const phi = Math.atan2(x, z);
    let y = p.getY(i);
    // Periodic in phi so the seam stays closed.
    const tear = (Math.sin(phi * 7 + 1.3) * 0.5 + 0.5) * (Math.sin(phi * 3 + 0.4) * 0.5 + 0.5) * 0.13 + (Math.sin(phi * 23) * 0.5 + 0.5) * 0.035;
    if (j === np - 1) y += tear;
    else if (j === np - 2) y += tear * 0.35;
    p.setXYZ(i, x * 1.12, y, z);
    sway[i] = clamp((0.1 - y) / 1.08, 0, 1);
  }
  g.setAttribute("aSway", new THREE.BufferAttribute(sway, 1));
  g.computeVertexNormals();
  return g;
}

/** Crooked rhinestone tiara: [metal, stones], relative to its own centre. */
function buildTiara(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const R = 0.078;
  const metal: THREE.BufferGeometry[] = [];
  const stones: THREE.BufferGeometry[] = [];
  const band = new THREE.TorusGeometry(R, 0.0028, 6, 40, Math.PI);
  band.rotateX(Math.PI / 2);
  metal.push(band);
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = lerp(0.18, Math.PI - 0.18, i / (n - 1));
    const peak = 1 - Math.abs(a - Math.PI / 2) / (Math.PI / 2);
    const h = 0.012 + 0.032 * peak ** 1.5;
    const x = R * Math.cos(a),
      z = R * Math.sin(a);
    const cone = new THREE.ConeGeometry(0.0042, h, 4);
    cone.translate(0, h / 2, 0);
    metal.push(placed(cone, x, 0, z, 0, -a, 0));
    stones.push(placed(new THREE.OctahedronGeometry(i === (n - 1) / 2 ? 0.0075 : 0.0042), x, h + 0.002, z));
    if (i < n - 1) {
      const a2 = a + (Math.PI - 0.36) / (n - 1) / 2;
      const loop = new THREE.TorusGeometry(0.008, 0.0012, 4, 14);
      metal.push(placed(loop, R * Math.cos(a2), 0.011, R * Math.sin(a2), 0, Math.PI / 2 - a2, 0));
      stones.push(placed(new THREE.OctahedronGeometry(0.003), R * Math.cos(a2), 0.011, R * Math.sin(a2)));
    }
  }
  const m = mergeAll(metal);
  m.scale(1, 1, 1.16);
  const s = mergeAll(stones);
  s.scale(1, 1, 1.16);
  return [m, s];
}

/** Janitor's work cap, relative to HEAD_CENTRE. */
function buildCap(): THREE.BufferGeometry {
  const crown = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  crown.scale(0.106, 0.076, 0.12);
  crown.translate(0, 0.05, -0.006);
  const band = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
  band.scale(0.106, 0.022, 0.12);
  band.translate(0, 0.04, -0.006);
  const brim = new THREE.CylinderGeometry(1, 1, 0.006, 24, 1, false, -Math.PI / 2, Math.PI);
  brim.scale(0.1, 1, 0.13);
  placed(brim, 0, 0.036, 0.03, 0.14, 0, 0);
  return mergeAll([crown, band, brim]);
}

/** Ring of brass keys, hanging from its clip at the origin. Also returns the cap badge. */
function buildKeys(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const ring = new THREE.TorusGeometry(0.03, 0.0028, 6, 24);
  ring.rotateY(Math.PI / 2);
  ring.translate(0, -0.03, 0);
  parts.push(ring);
  parts.push(placed(new THREE.BoxGeometry(0.006, 0.02, 0.012), 0, 0.006, 0));
  const r = mulberry32(42);
  for (let i = 0; i < 6; i++) {
    const phi = lerp(-0.9, 0.9, i / 5) + (r() - 0.5) * 0.15;
    const ax = 0,
      ay = -0.03 - 0.03 * Math.cos(phi),
      az = 0.03 * Math.sin(phi);
    const key: THREE.BufferGeometry[] = [];
    const bow = new THREE.TorusGeometry(0.0085, 0.0024, 5, 12);
    bow.rotateY(Math.PI / 2);
    bow.translate(0, -0.009, 0);
    key.push(bow);
    const len = 0.036 + r() * 0.014;
    key.push(placed(new THREE.BoxGeometry(0.0016, len, 0.0038), 0, -0.017 - len / 2, 0));
    key.push(placed(new THREE.BoxGeometry(0.0016, 0.006, 0.0042), 0, -0.017 - len + 0.008, 0.0035));
    key.push(placed(new THREE.BoxGeometry(0.0016, 0.004, 0.0036), 0, -0.017 - len + 0.016, 0.0032));
    const k = mergeAll(key);
    placed(k, ax, ay, az, phi * 0.8, (r() - 0.5) * 1.2, 0);
    parts.push(k);
  }
  return mergeAll(parts);
}

/** Principal's wire glasses, relative to HEAD_CENTRE. */
function buildGlasses(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const rim = new THREE.TorusGeometry(0.0185, 0.0011, 5, 28);
    rim.scale(1, 0.82, 1);
    parts.push(placed(rim, s * 0.034, 0.003, 0.104, 0, s * 0.08, 0));
    const a = new THREE.Vector3(s * 0.0525, 0.006, 0.1);
    const b = new THREE.Vector3(s * 0.094, 0.004, -0.025);
    const d = b.clone().sub(a);
    const arm = new THREE.CylinderGeometry(0.0009, 0.0009, d.length(), 4, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(AX_Y, d.clone().normalize());
    arm.applyQuaternion(q);
    const mid = a.add(b).multiplyScalar(0.5);
    arm.translate(mid.x, mid.y, mid.z);
    parts.push(arm);
  }
  const bridge = new THREE.TorusGeometry(0.0095, 0.001, 4, 12, Math.PI);
  parts.push(placed(bridge, 0, 0.004, 0.11));
  return mergeAll(parts);
}

/** Red tie lying on the chest, relative to CHEST. */
function buildTie(): THREE.BufferGeometry {
  // [y, z, width] in bind-pose world metres down the centre line.
  const pts: [number, number, number][] = [
    [1.505, 0.06, 0.03],
    [1.475, 0.08, 0.036],
    [1.455, 0.092, 0.024],
    [1.4, 0.122, 0.034],
    [1.33, 0.15, 0.044],
    [1.26, 0.158, 0.052],
    [1.19, 0.157, 0.06],
    [1.135, 0.152, 0.064],
    [1.105, 0.15, 0.0],
  ];
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  pts.forEach(([y, z, w], i) => {
    pos.push(-w / 2, y - CHEST.y, z - CHEST.z, w / 2, y - CHEST.y, z - CHEST.z);
    const v = i / (pts.length - 1);
    uv.push(0, v, 1, v);
    if (i < pts.length - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Fallback robe, relative to WAIST (top at the shoulders, hem at the floor). */
function buildRobe(): THREE.BufferGeometry {
  const prof: [number, number][] = [
    [0.05, 0.47],
    [0.12, 0.43],
    [0.19, 0.36],
    [0.205, 0.2],
    [0.2, 0.02],
    [0.24, -0.25],
    [0.31, -0.55],
    [0.38, -0.85],
    [0.43, -1.06],
  ];
  const g = new THREE.LatheGeometry(
    prof.map(([rr, y]) => new THREE.Vector2(rr, y)),
    40
  );
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const sway = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const phi = Math.atan2(p.getX(i), p.getZ(i));
    if (i % prof.length === prof.length - 1) p.setY(i, y + (Math.sin(phi * 5 + 0.7) * 0.5 + 0.5) * (Math.sin(phi * 11) * 0.5 + 0.5) * 0.12);
    p.setX(i, p.getX(i) * 1.1);
    sway[i] = clamp((0.47 - y) / 1.53, 0, 1);
  }
  g.setAttribute("aSway", new THREE.BufferAttribute(sway, 1));
  g.computeVertexNormals();
  return g;
}

/** Group parented to `parent` whose origin sits at `anchor` in the bind pose. */
function mount(parent: THREE.Object3D, parentBind: THREE.Matrix4, anchor: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  _m.copy(parentBind).invert().multiply(_m2.makeTranslation(anchor.x, anchor.y, anchor.z));
  _m.decompose(g.position, g.quaternion, g.scale);
  parent.add(g);
  return g;
}

// ----------------------------------------------------------------- model

interface Actions {
  idle: THREE.AnimationAction | null;
  walk: THREE.AnimationAction | null;
  run: THREE.AnimationAction | null;
  sneak: THREE.AnimationAction | null;
  sad: THREE.AnimationAction | null;
  agree: THREE.AnimationAction | null;
  shake: THREE.AnimationAction | null;
}
type Weights = Record<keyof Actions, number>;
const WEIGHT_KEYS: (keyof Weights)[] = ["idle", "walk", "run", "sneak", "sad", "agree", "shake"];

export class GhostModel {
  readonly kind: GhostKind;
  readonly look: GhostLook;
  /** Placed by the AI: floor position and yaw. */
  readonly root = new THREE.Group();
  readonly u: GhostUniforms;
  readonly colour: THREE.Color;
  /** World heights above the root, with scale and hover. */
  readonly chestY: number;
  readonly headY: number;
  readonly rigged: boolean;

  // Written by the AI.
  speed = 0;
  sneak = 0;
  frozen = false;
  scare = 0;
  reach = 0;
  writhe = 0;
  /** Extra head pitch in radians, positive looks up (to meet the camera in a scare). */
  gaze = 0;

  private body = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private act: Actions = { idle: null, walk: null, run: null, sneak: null, sad: null, agree: null, shake: null };
  private w: Weights = { idle: 1, walk: 0, run: 0, sneak: 0, sad: 0, agree: 0, shake: 0 };
  private headBone: THREE.Object3D | null = null;
  private pivot: THREE.Object3D;
  private spineBones: THREE.Object3D[] = [];
  private spine2: THREE.Object3D | null = null;
  private arms: [THREE.Object3D | null, THREE.Object3D | null] = [null, null];
  private forearms: [THREE.Object3D | null, THREE.Object3D | null] = [null, null];
  private sleeves: THREE.Object3D[] = [];
  private figure: THREE.Object3D | null = null;
  private keySwing: THREE.Object3D | null = null;
  private hang: THREE.Object3D | null = null;
  private headChain: THREE.Object3D[] = [];
  private twitchT = 0;
  private twitchQ = new THREE.Quaternion();
  private kv = 0;
  private mats: THREE.Material[] = [];

  constructor(kind: GhostKind, kit: GhostKit) {
    this.kind = kind;
    const look = (this.look = LOOKS[kind]);
    this.colour = new THREE.Color(look.rim);
    const u = (this.u = createGhostUniforms(this.colour));
    this.root.name = "ghost-" + kind;
    this.root.add(this.body);
    this.body.scale.set(look.scale[0], look.scale[1], look.scale[2]);
    this.chestY = 1.25 * look.scale[1] + look.hover;
    this.headY = HEAD_CENTRE.y * look.scale[1] + look.hover;

    const bodyMat = this.mat(
      ghostMaterial(u, "body", { color: look.body, opacity: look.opacity, rim: look.rimStrength, roughness: 0.45, smoke: look.smoke })
    );
    const jointMat = this.mat(
      ghostMaterial(u, "body", { color: look.joints, opacity: Math.min(1, look.opacity + 0.12), rim: look.rimStrength * 0.8, roughness: 0.5, smoke: look.smoke })
    );

    let headBind: THREE.Matrix4;
    let hipsBind: THREE.Matrix4;
    let chestBind: THREE.Matrix4;
    let hipsObj: THREE.Object3D;
    let chestObj: THREE.Object3D;

    const rig = kit.xbot ? this.buildRig(kit, bodyMat, jointMat) : null;
    this.rigged = !!rig;
    if (rig) {
      this.pivot = rig.pivot;
      headBind = rig.headBind;
      hipsBind = rig.hipsBind;
      chestBind = rig.chestBind;
      hipsObj = rig.hips;
      chestObj = rig.chest;
    } else {
      // Procedural robed figure with stand-in bones at the same heights.
      const fig = (this.figure = new THREE.Group());
      hipsObj = new THREE.Object3D();
      hipsObj.position.set(0, 1.04, 0.02);
      chestObj = new THREE.Object3D();
      chestObj.position.copy(CHEST);
      this.pivot = new THREE.Object3D();
      this.pivot.position.copy(HEAD_JOINT);
      fig.add(hipsObj, chestObj, this.pivot);
      fig.updateMatrixWorld(true);
      headBind = this.pivot.matrixWorld.clone();
      hipsBind = hipsObj.matrixWorld.clone();
      chestBind = chestObj.matrixWorld.clone();
      this.body.add(fig);
      const robeMat = this.mat(ghostMaterial(u, "skirt", { color: look.body, opacity: Math.min(1, look.opacity + 0.1), rim: look.rimStrength, roughness: 0.7, side: THREE.DoubleSide, smoke: look.smoke }));
      const robe = new THREE.Mesh(
        kit.geo("robe", buildRobe),
        robeMat
      );
      mount(hipsObj, hipsBind, WAIST).add(robe);
      const sleeveGeo = kit.geo("sleeve", () => {
        const g = new THREE.CylinderGeometry(0.05, 0.085, 0.55, 12, 1, true);
        g.translate(0, -0.275, 0);
        return g;
      });
      const sleeveMat = this.mat(ghostMaterial(u, "solid", { color: look.joints, opacity: Math.min(1, look.opacity + 0.1), rim: look.rimStrength, roughness: 0.7, side: THREE.DoubleSide, smoke: look.smoke }));
      for (const s of [-1, 1]) {
        const sl = new THREE.Mesh(sleeveGeo, sleeveMat);
        sl.position.set(s * 0.2, 1.43 - CHEST.y, 0);
        sl.rotation.z = s * 0.12;
        chestObj.add(sl);
        this.sleeves.push(sl);
      }
    }

    this.buildHead(kit, headBind);
    this.buildProps(kit, headBind, hipsObj, hipsBind, chestObj, chestBind);
    for (let o: THREE.Object3D | null = this.pivot; o && o !== this.body; o = o.parent) this.headChain.unshift(o);
    this.root.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  private buildRig(kit: GhostKit, bodyMat: THREE.Material, jointMat: THREE.Material) {
    const model = cloneSkinned(kit.xbot!.scene);
    const byName = (n: string) => model.getObjectByName("mixamorig" + n) ?? model.getObjectByName("mixamorig:" + n) ?? null;
    const head = byName("Head"),
      neck = byName("Neck"),
      hips = byName("Hips"),
      spine2 = byName("Spine2");
    if (!head || !neck || !hips || !spine2) return null;
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.material = /joint/i.test(m.name) ? jointMat : bodyMat;
      m.frustumCulled = false; // bounds do not follow the animation
    });
    model.updateMatrixWorld(true); // bind pose, before any parent transform
    this.headBone = head;
    this.spine2 = spine2;
    this.spineBones = [byName("Spine"), byName("Spine1"), spine2, neck].filter((b): b is THREE.Object3D => !!b);
    this.arms = [byName("LeftArm"), byName("RightArm")];
    this.forearms = [byName("LeftForeArm"), byName("RightForeArm")];

    // The scanned head rides on a pivot that copies the head bone each frame,
    // so the mannequin's own head can be shrunk away.
    const pivot = new THREE.Object3D();
    pivot.position.copy(head.position);
    pivot.quaternion.copy(head.quaternion);
    neck.add(pivot);

    const mixer = (this.mixer = new THREE.AnimationMixer(model));
    const mk = (k: ClipName, w: number) => {
      const c = kit.clips[k];
      if (!c) return null;
      const a = mixer.clipAction(c);
      a.enabled = true;
      a.setEffectiveTimeScale(1);
      a.setEffectiveWeight(w);
      a.play();
      return a;
    };
    this.act = {
      idle: mk("idle", 1),
      walk: mk("walk", 0),
      run: mk("run", 0),
      sneak: mk("sneak", 0),
      sad: mk("sad", 0),
      agree: mk("agree", 0),
      shake: mk("shake", 0),
    };
    // Desynchronise ghosts that share clips.
    for (const a of Object.values(this.act)) if (a) a.time = Math.random() * a.getClip().duration;

    this.body.add(model);
    return {
      pivot,
      hips,
      chest: spine2,
      headBind: head.matrixWorld.clone(),
      hipsBind: hips.matrixWorld.clone(),
      chestBind: spine2.matrixWorld.clone(),
    };
  }

  private buildHead(kit: GhostKit, headBind: THREE.Matrix4) {
    const look = this.look;
    const headMat = this.mat(
      ghostMaterial(this.u, "head", {
        color: 0xffffff,
        opacity: look.smoke ? 0.9 : 0.84,
        rim: look.rimStrength * 0.9,
        roughness: 0.68,
        map: kit.headMap,
        normalMap: kit.headNormal,
        pale: look.pale,
      })
    );
    const m = mount(this.pivot, headBind, LEE_ORIGIN);
    const head = new THREE.Mesh(kit.headGeo, headMat);
    head.scale.setScalar(LEE_SCALE);
    head.name = "ghostHead";
    m.add(head);
    const glow = this.mat(glowMaterial(this.u, this.colour.clone().lerp(new THREE.Color(look.pupil), 0.7), look.pupilGlow));
    for (const [x, y, z] of EYES) {
      const p = new THREE.Mesh(kit.pupilGeo, glow);
      p.position.set(x, y, z);
      p.scale.setScalar(look.pupilSize);
      p.renderOrder = 2;
      head.add(p);
    }
  }

  private buildProps(kit: GhostKit, headBind: THREE.Matrix4, hips: THREE.Object3D, hipsBind: THREE.Matrix4, chest: THREE.Object3D, chestBind: THREE.Matrix4) {
    const u = this.u;
    const head = () => mount(this.pivot, headBind, HEAD_CENTRE);
    if (this.kind === "queen") {
      const hm = head();
      const hairMat = this.mat(
        ghostMaterial(u, "hair", { color: 0x5a5060, opacity: 0.97, rim: 0.2, roughness: 0.85, map: kit.hairTex, side: THREE.DoubleSide, alphaTest: 0.32 })
      );
      let hair: [THREE.BufferGeometry, THREE.BufferGeometry] | null = null;
      const hp = () => (hair ||= buildHair());
      hm.add(new THREE.Mesh(kit.geo("hairCap", () => hp()[0]), hairMat));
      // Strands hang from a group that is turned back towards upright each
      // frame, so the hair falls with gravity rather than with the skull.
      const hang = (this.hang = new THREE.Group());
      hang.add(new THREE.Mesh(kit.geo("hairStrands", () => hp()[1]), hairMat));
      hm.add(hang);

      let parts: [THREE.BufferGeometry, THREE.BufferGeometry] | null = null;
      const tp = () => (parts ||= buildTiara());
      const metalGeo = kit.geo("tiaraMetal", () => tp()[0]);
      const stoneGeo = kit.geo("tiaraStones", () => tp()[1]);
      const tiara = new THREE.Group();
      tiara.position.set(0.004, 0.083, -0.016);
      tiara.rotation.set(-0.3, 0.1, 0.2);
      const metal = this.mat(ghostMaterial(u, "solid", { color: 0xd8dce6, opacity: 0.96, rim: 0.5, roughness: 0.22, metalness: 1 }));
      const stones = this.mat(ghostMaterial(u, "solid", { color: 0xffffff, opacity: 0.95, rim: 0.4, roughness: 0.05, metalness: 0.2, emissive: 0xf4e6ff, emissiveIntensity: 2.6 }));
      tiara.add(new THREE.Mesh(metalGeo, metal), new THREE.Mesh(stoneGeo, stones));
      hm.add(tiara);

      const skirtMat = this.mat(ghostMaterial(u, "skirt", { color: 0xe6dcf2, opacity: 0.52, rim: 1.5, roughness: 0.6, side: THREE.DoubleSide }));
      if (this.rigged) mount(hips, hipsBind, WAIST).add(new THREE.Mesh(kit.geo("skirt", buildSkirt), skirtMat));
    } else if (this.kind === "janitor") {
      const hm = head();
      const capMat = this.mat(ghostMaterial(u, "solid", { color: 0x2b3542, opacity: 0.93, rim: 0.9, roughness: 0.85 }));
      hm.add(new THREE.Mesh(kit.geo("cap", buildCap), capMat));
      const brass = this.mat(ghostMaterial(u, "solid", { color: 0xc9a14a, opacity: 0.96, rim: 0.55, roughness: 0.32, metalness: 0.9, emissive: 0x3a2a08 }));
      const badge = new THREE.Mesh(kit.geo("badge", () => new THREE.BoxGeometry(0.026, 0.016, 0.004)), brass);
      badge.position.set(0, 0.062, 0.12);
      badge.rotation.x = -0.35;
      hm.add(badge);
      const km = mount(hips, hipsBind, RIGHT_HIP);
      const swing = (this.keySwing = new THREE.Group());
      swing.add(new THREE.Mesh(kit.geo("keys", buildKeys), brass));
      km.add(swing);
    } else if (this.kind === "principal") {
      const hm = head();
      const wire = this.mat(ghostMaterial(u, "solid", { color: 0xc4b27e, opacity: 1, rim: 0.35, roughness: 0.3, metalness: 1 }));
      hm.add(new THREE.Mesh(kit.geo("glasses", buildGlasses), wire));
      const tieMat = this.mat(ghostMaterial(u, "solid", { color: 0x7a0a0e, opacity: 0.95, rim: 0.8, roughness: 0.55, side: THREE.DoubleSide }));
      mount(chest, chestBind, CHEST).add(new THREE.Mesh(kit.geo("tie", buildTie), tieMat));
    }
  }

  /** A sharp involuntary head twitch (the Principal when watched). */
  twitch() {
    this.twitchT = 0.12 + Math.random() * 0.08;
    this.twitchQ.setFromEuler(_e.set((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 1.0, (Math.random() - 0.5) * 0.8));
  }

  materials(): readonly THREE.Material[] {
    return this.mats;
  }

  update(dt: number, time: number) {
    const u = this.u;
    u.uTime.value = time;
    const s = this.speed;
    this.kv += (clamp(s / 3.5, 0, 1) - this.kv) * damp(4, dt);
    u.uDrag.value.set(0, 0.012 * this.kv, -0.06 * this.kv);

    // Hover and bob.
    const bob = this.kind === "queen" ? Math.sin(time * 1.3) * 0.035 : 0;
    this.body.position.y = this.look.hover + bob;

    if (this.mixer) this.animateRig(dt, time);
    else this.animateFigure(dt, time);

    if (this.hang) {
      _q.identity();
      for (const n of this.headChain) _q.multiply(n.quaternion);
      this.hang.quaternion.slerpQuaternions(IDENT, _q.invert(), 0.75);
    }

    if (this.keySwing) {
      const k = clamp(s / 1.6, 0, 1);
      this.keySwing.rotation.x = Math.sin(time * 8.5) * 0.35 * k + Math.sin(time * 1.7) * 0.05;
      this.keySwing.rotation.z = Math.sin(time * 6.1 + 1.2) * 0.22 * k;
    }
  }

  private animateRig(dt: number, time: number) {
    const mixer = this.mixer!,
      a = this.act,
      w = this.w,
      s = this.speed,
      scare = this.scare;
    mixer.timeScale = this.frozen ? 0 : 1;
    if (!this.frozen) {
      const moving = smoothstep(0.08, 0.7, s);
      let runK = smoothstep(2.0, 3.3, s);
      if (this.kind === "hollow" && s > 0.4) runK = 1;
      const calm = 1 - scare;
      const tgt: Weights = {
        idle: (1 - moving) * calm + scare,
        walk: moving * (1 - runK) * calm,
        run: moving * runK * calm,
        sneak: (this.kind === "janitor" ? 0.35 + 0.65 * this.sneak : this.kind === "hollow" ? 0.45 : 0) * calm,
        sad: (this.kind === "queen" ? 0.42 : 0) * calm,
        agree: scare * 0.25,
        shake: Math.max(scare * 0.45, this.writhe * 0.7),
      };
      const k = damp(scare > 0 ? 18 : 6, dt);
      for (const key of WEIGHT_KEYS) {
        w[key] += (tgt[key] - w[key]) * k;
        a[key]?.setEffectiveWeight(w[key]);
      }
      a.walk?.setEffectiveTimeScale(clamp(s / 1.25, 0.55, 1.9) * (this.kind === "queen" ? 0.8 : 1));
      a.run?.setEffectiveTimeScale(clamp(s / 3.8, 0.7, 1.45));
      a.shake?.setEffectiveTimeScale(scare > 0 ? 3.4 : 2.2);
      a.agree?.setEffectiveTimeScale(2.8);
    }
    mixer.update(dt);

    // Procedural layers on top of the clips.
    if (this.kind === "principal") for (const b of this.spineBones) b.quaternion.slerp(IDENT, 0.65);
    const reach = Math.max(this.reach, scare);
    if (reach > 0.001) {
      this.arms[0]?.quaternion.slerp(REACH_L, reach * 0.9);
      this.arms[1]?.quaternion.slerp(REACH_R, reach * 0.9);
      this.forearms[0]?.quaternion.slerp(IDENT, reach * 0.7);
      this.forearms[1]?.quaternion.slerp(IDENT, reach * 0.7);
      if (this.spine2) this.spine2.quaternion.multiply(_q.setFromAxisAngle(AX_X, 0.22 * scare));
    }
    const hb = this.headBone!;
    this.pivot.position.copy(hb.position);
    this.pivot.quaternion.copy(hb.quaternion);
    this.applyTwitch(dt, time);
    hb.scale.setScalar(1e-4);
  }

  private animateFigure(dt: number, time: number) {
    const fig = this.figure!;
    if (!this.frozen) {
      const k = this.kv;
      fig.rotation.x = 0.12 * k + 0.2 * this.scare;
      fig.rotation.z = Math.sin(time * 1.9) * 0.03 + Math.sin(time * 23) * 0.04 * this.writhe;
      const reach = Math.max(this.reach, this.scare);
      this.sleeves.forEach((sl, i) => {
        const swing = Math.sin(time * (3 + 5 * k) + i * Math.PI) * 0.45 * k;
        sl.rotation.x = lerp(swing, -1.3, reach);
      });
      const nod = Math.sin(time * 0.7) * 0.06 + Math.sin(time * 31) * 0.12 * this.scare;
      this.pivot.quaternion.setFromEuler(_e.set(nod, Math.sin(time * 0.43) * 0.1, 0));
    }
    this.applyTwitch(dt, time);
  }

  private applyTwitch(dt: number, _time: number) {
    if (this.gaze !== 0) this.pivot.quaternion.multiply(_q.setFromAxisAngle(AX_X, -this.gaze));
    if (this.twitchT > 0) {
      this.twitchT -= dt;
      this.pivot.quaternion.multiply(this.twitchQ);
    }
  }

  /** Back to a calm default, ready to be spawned again. */
  reset() {
    this.speed = 0;
    this.sneak = 0;
    this.frozen = false;
    this.scare = 0;
    this.reach = 0;
    this.writhe = 0;
    this.gaze = 0;
    this.twitchT = 0;
    this.u.uDissolve.value = 1;
    this.u.uLit.value = 0;
    this.u.uFlare.value = 0;
    this.root.visible = true;
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    this.mixer?.stopAllAction();
  }
}
