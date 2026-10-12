import * as THREE from "three";
import type { LightFixture } from "../types";
import type { Geo } from "./levelGeo";
import { beamMaterial } from "./levelMaterials";

/**
 * Light fixtures. Each fixture is one instance in a per-shape InstancedMesh of
 * unlit emissive parts, plus static housings merged into the level geometry.
 * The renderer turns the nearest lit fixtures into real point lights; this
 * module only keeps the glowing parts in step with each fixture's level.
 */

export type Shape = "troffer" | "bulb" | "highbay" | "sconce" | "can" | "lamp" | "wallpack" | "none";

interface Rec {
  f: LightFixture;
  shape: Shape;
  pos: THREE.Vector3;
  yaw: number;
  glow: number;
  indoor: boolean;
  baseColor: THREE.Color;
  baseIntensity: number;
  baseLevel: number;
  cone: { len: number; rad: number; k: number } | null;
  inst: number;
  coneInst: number;
}

export interface AddOpts {
  color?: number;
  intensity: number;
  range: number;
  /** Start broken (level 0). */
  broken?: boolean;
  indoor?: boolean;
  /** Height of the light source if different from the fixture. */
  lightY?: number;
  /** Fake volumetric cone below the fixture: length, bottom radius, strength. */
  cone?: [number, number, number];
  glow?: number;
}

const DEFAULT_GLOW: Record<Shape, number> = { troffer: 3.2, bulb: 7, highbay: 6, sconce: 2.6, can: 5, lamp: 9, wallpack: 6, none: 0 };
const DEAD = 0.025;
const EMERGENCY = new THREE.Color(0xff1e0e);

function shapeGeometry(s: Shape): THREE.BufferGeometry {
  switch (s) {
    case "troffer":
      return new THREE.BoxGeometry(0.56, 0.02, 1.16);
    case "bulb":
      return new THREE.SphereGeometry(0.07, 12, 8);
    case "highbay":
      return new THREE.CylinderGeometry(0.33, 0.33, 0.02, 20);
    case "sconce":
      return new THREE.CylinderGeometry(0.17, 0.11, 0.3, 14, 1, false, -Math.PI / 2, Math.PI);
    case "can":
      return new THREE.CylinderGeometry(0.1, 0.1, 0.012, 16);
    case "lamp": {
      const g = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      g.scale(0.34, 0.09, 0.18);
      return g;
    }
    case "wallpack": {
      const g = new THREE.BoxGeometry(0.28, 0.14, 0.02);
      g.rotateX(0.35);
      return g;
    }
    default:
      return new THREE.BoxGeometry(0.01, 0.01, 0.01);
  }
}

/** Open cone hanging from y=0 down to y=-1, radius 1 at the bottom; uv.y runs 0 (top) to 1 (bottom). */
function coneGeometry() {
  const g = new THREE.CylinderGeometry(0.12, 1, 1, 24, 6, true);
  g.translate(0, -0.5, 0);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 1 - uv.getY(i));
  return g;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const ZERO = new THREE.Vector3();
// Emissive part offset from the mount point (recessed lenses sit just below the ceiling).
const INSET: Partial<Record<Shape, THREE.Vector3>> = { troffer: new THREE.Vector3(0, -0.024, 0), can: new THREE.Vector3(0, -0.008, 0) };
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0);

export class Fixtures {
  list: LightFixture[] = [];
  private recs: Rec[] = [];
  private meshes = new Map<Shape, THREE.InstancedMesh>();
  private cones: THREE.InstancedMesh | null = null;
  private last = new Float32Array(0);
  private lastCone = new Float32Array(0);
  // Meshes indexed for allocation-free dirty tracking in sync().
  private meshList: THREE.InstancedMesh[] = [];
  private meshOf: number[] = [];
  private dirty: boolean[] = [];
  private emergencyOn = false;

  constructor(private geo: Geo, private rng: () => number) {}

  /** Add a fixture: emits its housing into the static geometry and returns the fixture record. */
  add(shape: Shape, x: number, y: number, z: number, yaw: number, room: string, o: AddOpts): LightFixture {
    const indoor = o.indoor ?? true;
    const color = new THREE.Color(o.color ?? (indoor ? 0xdfeeff : 0xffa040));
    const broken = o.broken ?? false;
    const f: LightFixture = {
      x,
      y: o.lightY ?? y,
      z,
      color,
      intensity: o.intensity,
      range: o.range,
      level: broken ? 0 : 1,
      instance: -1,
      room,
    };
    const rec: Rec = {
      f,
      shape,
      pos: new THREE.Vector3(x, y, z),
      yaw,
      glow: o.glow ?? DEFAULT_GLOW[shape],
      indoor,
      baseColor: color.clone(),
      baseIntensity: o.intensity,
      baseLevel: f.level,
      cone: o.cone ? { len: o.cone[0], rad: o.cone[1], k: o.cone[2] } : null,
      inst: -1,
      coneInst: -1,
    };
    this.recs.push(rec);
    this.list.push(f);
    this.housing(shape, x, y, z, yaw);
    return f;
  }

  /** Indoor fixture that starts broken about 35% of the time. */
  addIndoor(shape: Shape, x: number, y: number, z: number, yaw: number, room: string, o: Omit<AddOpts, "broken">) {
    return this.add(shape, x, y, z, yaw, room, { ...o, broken: this.rng() < 0.35 });
  }

  private housing(shape: Shape, x: number, y: number, z: number, yaw: number) {
    const g = this.geo;
    g.at(x, y, z, yaw);
    switch (shape) {
      case "troffer": {
        // Recessed frame around the diffuser, flush with the ceiling.
        const c = { col: 0xc9c6bd };
        g.box("paint", -0.31, -0.036, -0.61, 0.31, -0.001, -0.58, c);
        g.box("paint", -0.31, -0.036, 0.58, 0.31, -0.001, 0.61, c);
        g.box("paint", -0.31, -0.036, -0.58, -0.28, -0.001, 0.58, c);
        g.box("paint", 0.28, -0.036, -0.58, 0.31, -0.001, 0.58, c);
        break;
      }
      case "bulb": {
        g.tube("metal", 0, 0.25, 0, 0, 0.12, 0, 0.06, 10, { col: 0x3a3a38 });
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.4;
          g.tube("metal", Math.cos(a) * 0.06, 0.12, Math.sin(a) * 0.06, Math.cos(a) * 0.1, -0.02, Math.sin(a) * 0.1, 0.006, 4, { col: 0x2a2a28 });
          g.tube("metal", Math.cos(a) * 0.1, -0.02, Math.sin(a) * 0.1, 0, -0.1, 0, 0.006, 4, { col: 0x2a2a28 });
        }
        break;
      }
      case "highbay": {
        g.save();
        g.sub(0, 0.22, 0);
        g.geom("metal", REFLECTOR, { col: 0x50555a });
        g.restore();
        g.tube("metal", 0, 0.4, 0, 0, 1.5, 0, 0.02, 6, { col: 0x222222 });
        break;
      }
      case "sconce":
        g.box("chrome", -0.12, -0.2, -0.04, 0.12, 0.2, 0.0, { col: 0x8a7a5a });
        break;
      case "can":
        g.save();
        g.sub(0, -0.004, 0);
        g.geom("chrome", RING, { col: 0xb0b0aa });
        g.restore();
        break;
      case "lamp":
        g.save();
        g.sub(0, 0.0, 0);
        g.geom("metal", LAMP_HEAD, { col: 0x5d6266 });
        g.restore();
        break;
      case "wallpack":
        g.box("metal", -0.18, -0.12, -0.2, 0.18, 0.14, 0.0, { col: 0x3b3128 });
        break;
      default:
        break;
    }
    g.reset();
  }

  /** Create the instanced emissive meshes and light cones. */
  build(scene: THREE.Scene): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    const byShape = new Map<Shape, Rec[]>();
    for (const r of this.recs) {
      if (r.shape === "none") continue;
      let a = byShape.get(r.shape);
      if (!a) byShape.set(r.shape, (a = []));
      a.push(r);
    }
    for (const [shape, recs] of byShape) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true });
      mat.name = `level.fixture.${shape}`;
      const mesh = new THREE.InstancedMesh(shapeGeometry(shape), mat, recs.length);
      mesh.name = `level.fixtures.${shape}`;
      recs.forEach((r, i) => {
        r.inst = i;
        r.f.instance = i;
        _q.setFromAxisAngle(Y, r.yaw);
        _m.compose(_p.copy(r.pos).add(INSET[shape] ?? ZERO), _q, _s.set(1, 1, 1));
        mesh.setMatrixAt(i, _m);
        mesh.setColorAt(i, _c.setRGB(1, 1, 1));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.meshes.set(shape, mesh);
      out.push(mesh);
    }
    const coned = this.recs.filter((r) => r.cone);
    if (coned.length) {
      const mat = beamMaterial(false);
      mat.name = "level.cones";
      const cones = new THREE.InstancedMesh(coneGeometry(), mat, coned.length);
      cones.name = "level.lightCones";
      coned.forEach((r, i) => {
        r.coneInst = i;
        const c = r.cone!;
        _q.identity();
        _m.compose(_s.set(r.pos.x, r.pos.y - 0.05, r.pos.z), _q, new THREE.Vector3(c.rad, c.len, c.rad));
        cones.setMatrixAt(i, _m);
        cones.setColorAt(i, _c.setRGB(1, 1, 1));
      });
      cones.instanceMatrix.needsUpdate = true;
      cones.frustumCulled = false;
      cones.renderOrder = 11;
      scene.add(cones);
      this.cones = cones;
      out.push(cones);
    }
    this.meshList = [...this.meshes.values()];
    if (this.cones) this.meshList.push(this.cones);
    this.meshOf = this.recs.map((r) => (r.inst >= 0 ? this.meshList.indexOf(this.meshes.get(r.shape)!) : -1));
    this.dirty = this.meshList.map(() => false);
    this.last = new Float32Array(this.recs.length * 3).fill(-1);
    this.lastCone = new Float32Array(this.recs.length * 3).fill(-1);
    this.sync();
    return out;
  }

  /** Write fixture levels into the instance colours, flagging only what changed. */
  sync() {
    const recs = this.recs,
      last = this.last,
      lastC = this.lastCone;
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (r.inst < 0 && r.coneInst < 0) continue;
      const f = r.f;
      const lv = f.level < 0 ? 0 : f.level > 1.5 ? 1.5 : f.level;
      if (r.inst >= 0) {
        const k = DEAD + lv * r.glow;
        const cr = f.color.r * k,
          cg = f.color.g * k,
          cb = f.color.b * k;
        const j = i * 3;
        if (Math.abs(cr - last[j]) > 1e-3 || Math.abs(cg - last[j + 1]) > 1e-3 || Math.abs(cb - last[j + 2]) > 1e-3) {
          last[j] = cr;
          last[j + 1] = cg;
          last[j + 2] = cb;
          const mi = this.meshOf[i];
          this.meshList[mi].setColorAt(r.inst, _c.setRGB(cr, cg, cb));
          this.dirty[mi] = true;
        }
      }
      if (r.coneInst >= 0 && this.cones) {
        const k = lv * r.cone!.k;
        const cr = f.color.r * k,
          cg = f.color.g * k,
          cb = f.color.b * k;
        const j = i * 3;
        if (Math.abs(cr - lastC[j]) > 1e-4 || Math.abs(cg - lastC[j + 1]) > 1e-4 || Math.abs(cb - lastC[j + 2]) > 1e-4) {
          lastC[j] = cr;
          lastC[j + 1] = cg;
          lastC[j + 2] = cb;
          this.cones.setColorAt(r.coneInst, _c.setRGB(cr, cg, cb));
          this.dirty[this.meshList.length - 1] = true;
        }
      }
    }
    const dirty = this.dirty;
    for (let i = 0; i < dirty.length; i++) {
      if (!dirty[i]) continue;
      dirty[i] = false;
      const ic = this.meshList[i].instanceColor;
      if (ic) ic.needsUpdate = true;
    }
  }

  /** Red emergency lighting for every indoor fixture; restores the originals when switched off. */
  emergency(on: boolean) {
    if (on === this.emergencyOn) return;
    this.emergencyOn = on;
    for (const r of this.recs) {
      if (!r.indoor) continue;
      if (on) {
        r.f.color.copy(EMERGENCY);
        r.f.intensity = r.baseIntensity * 0.45;
        r.f.level = 1;
      } else {
        r.f.color.copy(r.baseColor);
        r.f.intensity = r.baseIntensity;
        r.f.level = r.baseLevel;
      }
    }
    this.sync();
  }
}

// Shared housing shapes.
const REFLECTOR = (() => {
  const g = new THREE.CylinderGeometry(0.12, 0.36, 0.42, 20, 1, true);
  return g;
})();
const RING = new THREE.TorusGeometry(0.11, 0.015, 6, 20).rotateX(Math.PI / 2);
const LAMP_HEAD = (() => {
  const g = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(0.38, 0.14, 0.21);
  return g;
})();
