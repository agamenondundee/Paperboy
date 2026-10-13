import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RelicKind, Spot } from "../types";
import { FONT } from "../world/canvasTex";
import { mulberry32 } from "../core/util";

/**
 * Things Brodie can pick up: the three relics, UV cells, chocolate bars and
 * notes. Pickups are instanced (one draw call per part), relics are small
 * merged groups, and every item's glint or glow is one shared Points draw.
 * Everything is built once, before shaders compile, and only moved or hidden
 * between runs.
 */

export type PickupKind = "cell" | "choc" | "note";
export type ItemType = PickupKind | "relic";

export interface Interactable {
  type: ItemType;
  /** Index within its kind (pickups) or into RELICS (relics). */
  idx: number;
  relic: RelicKind | null;
  x: number;
  y: number;
  z: number;
  taken: boolean;
  /** Note index for notes. */
  note: number;
}

export const RELICS: RelicKind[] = ["crown", "keys", "register"];
export const PICKUP_COUNT: Record<PickupKind, number> = { cell: 6, choc: 4, note: 6 };

// Glint slots: relics first, then the pickups in order.
const GLINT_BASE: Record<ItemType, number> = { relic: 0, cell: 3, choc: 9, note: 13 };
const GLINT_TOTAL = 19;

const RELIC_GLOW: Record<RelicKind, THREE.Color> = {
  crown: new THREE.Color(1.5, 1.05, 2.2),
  keys: new THREE.Color(1.9, 1.35, 0.55),
  register: new THREE.Color(1.8, 0.55, 0.45),
};

// ------------------------------------------------------------- geometry

type G = THREE.BufferGeometry;

/** Flat vertex colour so parts can share one material once merged. */
function tint(g: G, hex: number): G {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  const c = new THREE.Color(hex);
  const n = ng.getAttribute("position").count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  ng.setAttribute("color", new THREE.BufferAttribute(a, 3));
  if (!ng.getAttribute("uv")) ng.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return ng;
}

function merge(parts: G[]): G {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!g) throw new Error("item geometry merge failed");
  g.computeBoundingSphere();
  return g;
}

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
function place(g: G, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): G {
  E.set(rx, ry, rz, "YXZ");
  Q.setFromEuler(E);
  M.compose(P.set(x, y, z), Q, S.set(sx, sy, sz));
  g.applyMatrix4(M);
  return g;
}

/** Rhinestone tiara: a silver band with filigree spires, gems at the tips. */
function tiara(): { metal: G; gems: G } {
  const metal: G[] = [];
  const gems: G[] = [];
  const R = 0.078;
  const arc = Math.PI * 1.25;
  // Band, lying flat with the opening at the back (+z is the front).
  metal.push(tint(place(new THREE.TorusGeometry(R, 0.0042, 6, 48, arc), 0, 0.006, 0, Math.PI / 2, 0, -Math.PI / 2 - arc / 2 + Math.PI), 0xdfe3ea));
  metal.push(tint(place(new THREE.TorusGeometry(R, 0.0028, 5, 48, arc), 0, 0.017, 0, Math.PI / 2, 0, -Math.PI / 2 - arc / 2 + Math.PI), 0xd2d6de));
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5; // -0.5 .. 0.5 across the front
    const a = t * arc * 0.82;
    const peak = Math.cos(t * Math.PI);
    const h = 0.018 + 0.042 * peak * peak;
    const x = Math.sin(a) * R,
      z = Math.cos(a) * R;
    // A spire leaning out a touch, plus a filigree loop beside it.
    metal.push(tint(place(new THREE.ConeGeometry(0.0045, h, 4), x, 0.017 + h / 2, z, 0.12 * Math.cos(a), a, -0.12 * Math.sin(a)), 0xe6e9ef));
    if (i < n - 1) {
      const a2 = ((i + 0.5) / (n - 1) - 0.5) * arc * 0.82;
      const hh = 0.012 + 0.03 * Math.cos(((i + 0.5) / (n - 1) - 0.5) * Math.PI) ** 2;
      metal.push(tint(place(new THREE.TorusGeometry(0.0085, 0.0014, 4, 14), Math.sin(a2) * R, 0.017 + hh * 0.6, Math.cos(a2) * R, 0, a2, 0, 1, hh / 0.017, 1), 0xd8dce4));
    }
    gems.push(tint(place(new THREE.OctahedronGeometry(i === (n - 1) / 2 ? 0.0125 : 0.0058, 0), x, 0.019 + h, z, 0, a, 0, 1, 1.35, 1), 0xffffff));
    gems.push(tint(place(new THREE.OctahedronGeometry(0.0034, 0), x, 0.011, z, 0, a, 0), 0xffe6fb));
  }
  // The big centre stone gets a setting.
  metal.push(tint(place(new THREE.TorusGeometry(0.014, 0.0022, 5, 18), 0, 0.068, R + 0.002, 0, 0, 0), 0xe6e9ef));
  return { metal: merge(metal), gems: merge(gems) };
}

/** A ring of brass and steel keys fanned out on the surface, with a leather tag. */
function keyRing(): { metal: G; leather: G } {
  const metal: G[] = [];
  const r = mulberry32(31);
  metal.push(tint(place(new THREE.TorusGeometry(0.034, 0.0028, 6, 28), 0, 0.003, 0, Math.PI / 2), 0xa8aaa6));
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = -1.2 + (i / (n - 1)) * 2.4 + (r() - 0.5) * 0.15;
    const col = i % 3 === 1 ? 0x9da3a6 : i % 3 === 2 ? 0xc49a45 : 0xb88d3c;
    const len = 0.055 + r() * 0.025;
    const parts: G[] = [];
    // Bow, shank and bit, built along +z then turned into place.
    parts.push(place(new THREE.CylinderGeometry(0.011, 0.011, 0.0026, 14), 0, 0.0035, 0.044));
    parts.push(place(new THREE.BoxGeometry(0.0055, 0.0024, len), 0, 0.0035, 0.044 + 0.008 + len / 2));
    const teeth = 2 + ((r() * 3) | 0);
    for (let t = 0; t < teeth; t++) parts.push(place(new THREE.BoxGeometry(0.006, 0.0022, 0.004), 0.005, 0.0035, 0.044 + 0.014 + len * (0.45 + t * 0.16)));
    for (const p of parts) {
      place(p, 0, 0, 0, 0, a, 0);
      metal.push(tint(p, col));
    }
  }
  const leather = merge([
    tint(place(new THREE.BoxGeometry(0.036, 0.004, 0.058), -0.038, 0.002, -0.035, 0, 0.5, 0), 0x4a2a17),
    tint(place(new THREE.CylinderGeometry(0.004, 0.004, 0.0045, 10), -0.03, 0.0025, -0.012, 0, 0, 0), 0xb08d3a),
  ]);
  return { metal: merge(metal), leather };
}

function registerCover(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 340;
  const g = c.getContext("2d")!;
  g.fillStyle = "#4a1712";
  g.fillRect(0, 0, c.width, c.height);
  // Worn leather grain.
  const r = mulberry32(87);
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.12)" : "rgba(255,210,180,0.05)";
    g.fillRect(r() * c.width, r() * c.height, 1 + r() * 2, 1 + r() * 2);
  }
  const grd = g.createRadialGradient(128, 170, 30, 128, 170, 220);
  grd.addColorStop(0, "rgba(0,0,0,0)");
  grd.addColorStop(1, "rgba(0,0,0,0.45)");
  g.fillStyle = grd;
  g.fillRect(0, 0, c.width, c.height);
  // Gilt panel and lettering.
  g.strokeStyle = "rgba(201,166,64,0.85)";
  g.lineWidth = 3;
  g.strokeRect(22, 22, c.width - 44, c.height - 44);
  g.lineWidth = 1;
  g.strokeRect(30, 30, c.width - 60, c.height - 60);
  g.fillStyle = "#c9a640";
  g.textAlign = "center";
  g.font = `600 22px ${FONT.sign}`;
  g.fillText("ATTENDANCE", 128, 130);
  g.fillText("REGISTER", 128, 160);
  g.font = `600 18px ${FONT.sign}`;
  g.fillText("FORM 5H", 128, 210);
  g.fillText("1986 - 87", 128, 236);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function notePaper(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 340;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e9e1cc";
  g.fillRect(0, 0, c.width, c.height);
  const r = mulberry32(5);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(90,70,40,${0.03 + r() * 0.05})`;
    g.fillRect(r() * c.width, r() * c.height, 1 + r() * 3, 1);
  }
  g.strokeStyle = "rgba(80,110,170,0.35)";
  g.lineWidth = 1;
  for (let y = 46; y < c.height - 10; y += 18) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(c.width, y);
    g.stroke();
  }
  g.strokeStyle = "rgba(190,60,60,0.4)";
  g.beginPath();
  g.moveTo(34, 0);
  g.lineTo(34, c.height);
  g.stroke();
  // Scribbled handwriting.
  g.strokeStyle = "rgba(30,30,60,0.75)";
  g.lineWidth = 1.6;
  for (let y = 42; y < c.height - 20; y += 18) {
    let x = 42;
    const end = c.width - 18 - r() * 60;
    g.beginPath();
    g.moveTo(x, y);
    while (x < end) {
      x += 3 + r() * 4;
      g.lineTo(x, y - r() * 7);
      if (r() < 0.12) {
        x += 6;
        g.moveTo(x, y);
      }
    }
    g.stroke();
  }
  // A fold shadow and a coffee ring.
  const sh = g.createLinearGradient(0, 160, 0, 180);
  sh.addColorStop(0, "rgba(0,0,0,0)");
  sh.addColorStop(0.5, "rgba(0,0,0,0.12)");
  sh.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = sh;
  g.fillRect(0, 160, c.width, 20);
  g.strokeStyle = "rgba(110,70,30,0.25)";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(190, 270, 34, 0.4, 5.6);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ----------------------------------------------------------------- glints

const GLINT_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute float aKind;
attribute vec3 aColor;
uniform float uTime;
uniform float uScale;
varying vec3 vColor;
varying float vKind;
varying float vI;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float i;
  float size = aSize;
  if (aKind < 0.5) {
    // A brief sparkle every few seconds over a faint constant shine.
    float s = sin(uTime * 0.85 + aPhase * 6.2831);
    float sp = pow(max(s, 0.0), 40.0);
    i = 0.1 + sp * 1.4;
    size *= 0.3 + 0.7 * sp;
  } else {
    i = 0.6 + 0.4 * sin(uTime * 1.9 + aPhase * 6.2831);
    size *= 0.9 + 0.1 * i;
  }
  vI = i;
  vColor = aColor;
  vKind = aKind;
  // Fade glints out with distance so far items do not twinkle through the gloom.
  vI *= clamp(1.4 - (-mv.z) / 14.0, 0.0, 1.0);
  gl_PointSize = size * uScale / max(0.2, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const GLINT_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vKind;
varying float vI;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  float a;
  if (vKind < 0.5) {
    float core = exp(-r2 * 20.0);
    float star = exp(-abs(p.x) * 26.0) * exp(-abs(p.y) * 3.2) + exp(-abs(p.y) * 26.0) * exp(-abs(p.x) * 3.2);
    a = (core + star * 0.75) * vI;
  } else {
    a = exp(-r2 * 4.0) * (1.0 - smoothstep(0.7, 1.0, sqrt(r2))) * vI * 0.32;
  }
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor, a);
}`;

// ------------------------------------------------------------------ class

export class ItemMeshes {
  readonly group = new THREE.Group();
  private relicRoots: Record<RelicKind, THREE.Group>;
  private gemMat: THREE.MeshStandardMaterial;
  private pick: Record<PickupKind, THREE.InstancedMesh[]>;
  private glints: THREE.Points;
  private gPos: THREE.BufferAttribute;
  private gSize: THREE.BufferAttribute;
  private baseSize = new Float32Array(GLINT_TOTAL);
  private glintMat: THREE.ShaderMaterial;
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(scene: THREE.Scene) {
    this.group.name = "items";

    // Relics.
    const silver = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 1, roughness: 0.16 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 1, roughness: 0.32 });
    const leatherMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0, roughness: 0.6 });
    this.gemMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      emissive: new THREE.Color(0xd9b8ff),
      emissiveIntensity: 1.4,
      metalness: 0,
      roughness: 0.04,
    });
    const crown = new THREE.Group();
    const t = tiara();
    crown.add(new THREE.Mesh(t.metal, silver), new THREE.Mesh(t.gems, this.gemMat));
    const keys = new THREE.Group();
    const k = keyRing();
    keys.add(new THREE.Mesh(k.metal, brass), new THREE.Mesh(k.leather, leatherMat));
    const register = new THREE.Group();
    {
      const book = merge([
        tint(place(new THREE.BoxGeometry(0.235, 0.006, 0.31), 0, 0.003, 0), 0x3d130f),
        tint(place(new THREE.BoxGeometry(0.235, 0.006, 0.31), 0, 0.039, 0), 0x3d130f),
        tint(place(new THREE.CylinderGeometry(0.021, 0.021, 0.31, 10, 1, false, Math.PI, Math.PI), -0.117, 0.021, 0, Math.PI / 2, 0, 0), 0x34100c),
        tint(place(new THREE.BoxGeometry(0.004, 0.003, 0.11), 0.03, 0.043, 0.2, 0, 0, 0), 0x7a1b1b),
      ]);
      const pages = merge([tint(place(new THREE.BoxGeometry(0.226, 0.03, 0.298), 0.002, 0.021, 0), 0xe8dfc6)]);
      const cover = new THREE.Mesh(
        new THREE.PlaneGeometry(0.235, 0.31).rotateX(-Math.PI / 2).translate(0, 0.0425, 0),
        new THREE.MeshStandardMaterial({ map: registerCover(), roughness: 0.55, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 })
      );
      register.add(new THREE.Mesh(book, leatherMat), new THREE.Mesh(pages, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85 })), cover);
    }
    this.relicRoots = { crown, keys, register };
    for (const kd of RELICS) {
      const r = this.relicRoots[kd];
      r.name = "relic-" + kd;
      r.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      this.group.add(r);
    }

    // Pickups.
    const cellBody = merge([
      tint(place(new THREE.CylinderGeometry(0.017, 0.017, 0.066, 18), 0, 0.017, 0, 0, 0, Math.PI / 2), 0x1c1c22),
      tint(place(new THREE.CylinderGeometry(0.0172, 0.0172, 0.008, 18), 0.03, 0.017, 0, 0, 0, Math.PI / 2), 0xb9bcc2),
      tint(place(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 12), 0.037, 0.017, 0, 0, 0, Math.PI / 2), 0xd8dade),
      tint(place(new THREE.CylinderGeometry(0.0172, 0.0172, 0.003, 18), -0.0325, 0.017, 0, 0, 0, Math.PI / 2), 0x9a9da3),
    ]);
    const cellBand = new THREE.CylinderGeometry(0.0176, 0.0176, 0.014, 18).rotateZ(Math.PI / 2).translate(-0.006, 0.017, 0);
    const choc = merge([
      tint(place(new THREE.BoxGeometry(0.128, 0.012, 0.058), 0, 0.006, 0), 0x6b1020),
      tint(place(new THREE.BoxGeometry(0.129, 0.0122, 0.012), 0, 0.006, 0.012), 0xc9a640),
      tint(place(new THREE.BoxGeometry(0.016, 0.011, 0.059), 0.072, 0.0055, 0), 0xc8ccd2),
      tint(place(new THREE.BoxGeometry(0.016, 0.011, 0.059), -0.072, 0.0055, 0), 0xc8ccd2),
    ]);
    // A folded sheet: two leaves tented along the crease.
    const leafA = new THREE.PlaneGeometry(0.15, 0.1);
    const leafB = new THREE.PlaneGeometry(0.15, 0.1);
    {
      const uvA = leafA.getAttribute("uv") as THREE.BufferAttribute;
      const uvB = leafB.getAttribute("uv") as THREE.BufferAttribute;
      for (let i = 0; i < uvA.count; i++) {
        uvA.setY(i, 0.5 + uvA.getY(i) * 0.5);
        uvB.setY(i, uvB.getY(i) * 0.5);
      }
    }
    place(leafA.translate(0, 0.05, 0), 0, 0.001, 0, -Math.PI / 2 + 0.16, 0, 0);
    place(leafB.translate(0, -0.05, 0), 0, 0.001, 0, -Math.PI / 2 - 0.16, 0, 0);
    const noteGeo = mergeGeometries([leafA, leafB], false)!;
    leafA.dispose();
    leafB.dispose();

    const body = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.38, metalness: 0.55 });
    const wrapper = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.45, metalness: 0.25 });
    const band = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 0.85, 3.4) });
    const paper = new THREE.MeshStandardMaterial({ map: notePaper(), roughness: 0.92, side: THREE.DoubleSide, emissive: new THREE.Color(0x14120d) });
    const inst = (g: G, m: THREE.Material, n: number, name: string) => {
      const im = new THREE.InstancedMesh(g, m, n);
      im.name = name;
      im.frustumCulled = false;
      im.castShadow = true;
      im.receiveShadow = true;
      for (let i = 0; i < n; i++) im.setMatrixAt(i, this.hidden);
      this.group.add(im);
      return im;
    };
    this.pick = {
      cell: [inst(cellBody, body, PICKUP_COUNT.cell, "item-cell"), inst(cellBand, band, PICKUP_COUNT.cell, "item-cellBand")],
      choc: [inst(choc, wrapper, PICKUP_COUNT.choc, "item-choc")],
      note: [inst(noteGeo, paper, PICKUP_COUNT.note, "item-note")],
    };
    this.pick.cell[1].castShadow = false;

    // Glints and relic glows: one Points draw for everything.
    const geo = new THREE.BufferGeometry();
    this.gPos = new THREE.BufferAttribute(new Float32Array(GLINT_TOTAL * 3), 3);
    this.gSize = new THREE.BufferAttribute(new Float32Array(GLINT_TOTAL), 1);
    const phase = new Float32Array(GLINT_TOTAL);
    const kind = new Float32Array(GLINT_TOTAL);
    const colour = new Float32Array(GLINT_TOTAL * 3);
    const pr = mulberry32(19);
    for (let i = 0; i < GLINT_TOTAL; i++) {
      phase[i] = pr();
      const relic = i < 3;
      kind[i] = relic ? 1 : 0;
      const c = relic ? RELIC_GLOW[RELICS[i]] : i < GLINT_BASE.choc ? new THREE.Color(1.6, 1.3, 3.0) : new THREE.Color(2.4, 2.2, 1.9);
      colour[i * 3] = c.r;
      colour[i * 3 + 1] = c.g;
      colour[i * 3 + 2] = c.b;
      this.baseSize[i] = relic ? 0.6 : 0.16;
      this.gPos.setXYZ(i, 0, -60, 0);
    }
    this.gPos.setUsage(THREE.DynamicDrawUsage);
    this.gSize.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.gPos);
    geo.setAttribute("aSize", this.gSize);
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.setAttribute("aKind", new THREE.BufferAttribute(kind, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colour, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(57, 0, 40), 200);
    this.glintMat = new THREE.ShaderMaterial({
      vertexShader: GLINT_VERT,
      fragmentShader: GLINT_FRAG,
      uniforms: { uTime: { value: 0 }, uScale: { value: 500 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glints = new THREE.Points(geo, this.glintMat);
    this.glints.name = "item-glints";
    this.glints.frustumCulled = false;
    this.glints.renderOrder = 4;
    this.group.add(this.glints);

    scene.add(this.group);
  }

  private setGlint(i: number, x: number, y: number, z: number, on: boolean) {
    this.gPos.setXYZ(i, x, y, z);
    this.gSize.setX(i, on ? this.baseSize[i] : 0);
    this.gPos.needsUpdate = true;
    this.gSize.needsUpdate = true;
  }

  placeRelic(kind: RelicKind, s: Spot) {
    const r = this.relicRoots[kind];
    r.position.set(s.x, s.y + 0.002, s.z);
    r.rotation.set(0, s.yaw, 0);
    r.visible = true;
    r.updateMatrixWorld(true);
    this.setGlint(RELICS.indexOf(kind), s.x, s.y + (kind === "register" ? 0.08 : 0.06), s.z, true);
  }

  hideRelic(kind: RelicKind) {
    this.relicRoots[kind].visible = false;
    this.setGlint(RELICS.indexOf(kind), 0, -60, 0, false);
  }

  placePickup(kind: PickupKind, i: number, s: Spot) {
    Q.setFromAxisAngle(_Y, s.yaw);
    M.compose(P.set(s.x, s.y + 0.002, s.z), Q, S.set(1, 1, 1));
    for (const im of this.pick[kind]) {
      im.setMatrixAt(i, M);
      im.instanceMatrix.needsUpdate = true;
    }
    this.setGlint(GLINT_BASE[kind] + i, s.x, s.y + (kind === "note" ? 0.05 : 0.04), s.z, true);
  }

  hidePickup(kind: PickupKind, i: number) {
    for (const im of this.pick[kind]) {
      im.setMatrixAt(i, this.hidden);
      im.instanceMatrix.needsUpdate = true;
    }
    this.setGlint(GLINT_BASE[kind] + i, 0, -60, 0, false);
  }

  /** Per frame: pulse the relic gems and keep the glint size right for the view. */
  update(time: number, camera: THREE.PerspectiveCamera, bufferHeight: number) {
    this.glintMat.uniforms.uTime.value = time;
    this.glintMat.uniforms.uScale.value = bufferHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.gemMat.emissiveIntensity = 1.1 + 0.7 * (0.5 + 0.5 * Math.sin(time * 1.9));
  }
}

const _Y = new THREE.Vector3(0, 1, 0);
