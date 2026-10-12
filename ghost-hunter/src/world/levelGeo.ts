import * as THREE from "three";

/**
 * Static geometry builder. Everything that never moves is emitted into
 * per-material buckets and merged into one mesh per material, so the whole
 * school costs a few dozen draw calls. UVs are in metres by default (the
 * materials set texture repeat to 1 / tile size), so textures line up across
 * neighbouring pieces.
 */

export interface UvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}
export const FULL_UV: UvRect = { u0: 0, v0: 0, u1: 1, v1: 1 };

/** A colour as an sRGB hex number or a (linear) THREE.Color. */
export type Col = number | THREE.Color;

export interface GOpts {
  col?: Col;
  /** Vertex alpha (used by transparent buckets). */
  a?: number;
  /** UV units per metre (default 1). */
  uv?: number;
  uvOff?: readonly [number, number];
  /** Box faces to leave out (F_* bitmask). */
  skip?: number;
  /** Darken towards the floor: vertex colour is scaled from `lo` at y=0 to 1 at y=`h` (world y). */
  grad?: readonly [lo: number, h: number];
  /** Per-corner colours for quad() (overrides col). */
  cols?: readonly Col[];
}

export const F_PX = 1,
  F_NX = 2,
  F_PY = 4,
  F_NY = 8,
  F_PZ = 16,
  F_NZ = 32;
export const F_ALL = 63;

type V3 = readonly [number, number, number];
// Face normal, then the u and v axes so that u x v = n (counter-clockwise from outside).
const BOX: { n: V3; t: V3; b: V3 }[] = [
  { n: [1, 0, 0], t: [0, 0, -1], b: [0, 1, 0] },
  { n: [-1, 0, 0], t: [0, 0, 1], b: [0, 1, 0] },
  { n: [0, 1, 0], t: [1, 0, 0], b: [0, 0, -1] },
  { n: [0, -1, 0], t: [1, 0, 0], b: [0, 0, 1] },
  { n: [0, 0, 1], t: [1, 0, 0], b: [0, 1, 0] },
  { n: [0, 0, -1], t: [-1, 0, 0], b: [0, 1, 0] },
];

class Bucket {
  p: number[] = [];
  n: number[] = [];
  t: number[] = [];
  c: number[] = [];
  i: number[] = [];
}

const _col = new THREE.Color();
const _e = new THREE.Euler(0, 0, 0, "YXZ");
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class Geo {
  private buckets = new Map<string, Bucket>();
  private m = new THREE.Matrix4();
  private nm = new THREE.Matrix3();
  private stack: THREE.Matrix4[] = [];
  private cr = 1;
  private cg = 1;
  private cb = 1;
  private ca = 1;
  private gradLo = 1;
  private gradH = 0;

  /** Placement frame: translate, then yaw (ry), pitch (rx) and roll (rz), Euler order YXZ. */
  at(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1) {
    _e.set(rx, ry, rz, "YXZ");
    _q.setFromEuler(_e);
    this.m.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
    this.nm.getNormalMatrix(this.m);
    return this;
  }
  /** Compose a child frame onto the current one. */
  sub(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1) {
    _e.set(rx, ry, rz, "YXZ");
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
    this.m.multiply(_m);
    this.nm.getNormalMatrix(this.m);
    return this;
  }
  setMatrix(m: THREE.Matrix4) {
    this.m.copy(m);
    this.nm.getNormalMatrix(this.m);
    return this;
  }
  /** Non-uniform scale on top of the current frame. */
  scale(x: number, y: number, z: number) {
    this.m.scale(_s.set(x, y, z));
    this.nm.getNormalMatrix(this.m);
    return this;
  }
  save() {
    this.stack.push(this.m.clone());
    return this;
  }
  restore() {
    const m = this.stack.pop();
    if (m) this.setMatrix(m);
    return this;
  }
  reset() {
    this.m.identity();
    this.nm.identity();
    this.stack.length = 0;
    return this;
  }

  private bucket(key: string) {
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = new Bucket()));
    return b;
  }

  private colour(o?: GOpts) {
    if (o?.col === undefined) {
      this.cr = this.cg = this.cb = 1;
    } else {
      if (typeof o.col === "number") _col.setHex(o.col);
      else _col.copy(o.col);
      this.cr = _col.r;
      this.cg = _col.g;
      this.cb = _col.b;
    }
    this.ca = o?.a ?? 1;
    this.gradLo = o?.grad ? o.grad[0] : 1;
    this.gradH = o?.grad ? o.grad[1] : 0;
  }

  private v(b: Bucket, x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) {
    const e = this.m.elements;
    const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
    b.p.push(e[0] * x + e[4] * y + e[8] * z + e[12], wy, e[2] * x + e[6] * y + e[10] * z + e[14]);
    const k = this.nm.elements;
    const X = k[0] * nx + k[3] * ny + k[6] * nz,
      Y = k[1] * nx + k[4] * ny + k[7] * nz,
      Z = k[2] * nx + k[5] * ny + k[8] * nz;
    const l = Math.sqrt(X * X + Y * Y + Z * Z) || 1;
    b.n.push(X / l, Y / l, Z / l);
    b.t.push(u, v);
    let g = 1;
    if (this.gradH > 0) {
      const f = wy <= 0 ? 0 : wy >= this.gradH ? 1 : wy / this.gradH;
      g = this.gradLo + (1 - this.gradLo) * f;
    }
    b.c.push(this.cr * g, this.cg * g, this.cb * g, this.ca);
  }

  /** Axis-aligned box in the current frame. `keys` is one bucket or one per face (+x,-x,+y,-y,+z,-z; null skips). */
  box(keys: string | readonly (string | null)[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, o?: GOpts) {
    // Accept corners in any order; reversed bounds would turn the box inside out.
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (y0 > y1) [y0, y1] = [y1, y0];
    if (z0 > z1) [z0, z1] = [z1, z0];
    this.colour(o);
    const s = o?.uv ?? 1,
      ou = o?.uvOff ? o.uvOff[0] : 0,
      ov = o?.uvOff ? o.uvOff[1] : 0;
    const cx = (x0 + x1) / 2,
      cy = (y0 + y1) / 2,
      cz = (z0 + z1) / 2;
    const hx = (x1 - x0) / 2,
      hy = (y1 - y0) / 2,
      hz = (z1 - z0) / 2;
    const skip = o?.skip ?? 0;
    for (let f = 0; f < 6; f++) {
      if (skip & (1 << f)) continue;
      const key = typeof keys === "string" ? keys : keys[f];
      if (!key) continue;
      const F = BOX[f];
      const fx = cx + F.n[0] * hx,
        fy = cy + F.n[1] * hy,
        fz = cz + F.n[2] * hz;
      const tx = F.t[0] * hx,
        ty = F.t[1] * hy,
        tz = F.t[2] * hz;
      const bx = F.b[0] * hx,
        by = F.b[1] * hy,
        bz = F.b[2] * hz;
      const b = this.bucket(key);
      const base = b.p.length / 3;
      for (let k = 0; k < 4; k++) {
        const st = k === 1 || k === 2 ? 1 : -1;
        const sb = k >= 2 ? 1 : -1;
        const px = fx + tx * st + bx * sb,
          py = fy + ty * st + by * sb,
          pz = fz + tz * st + bz * sb;
        const u = (px * F.t[0] + py * F.t[1] + pz * F.t[2]) * s + ou;
        const v = (px * F.b[0] + py * F.b[1] + pz * F.b[2]) * s + ov;
        this.v(b, px, py, pz, F.n[0], F.n[1], F.n[2], u, v);
      }
      b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  /** Box from centre and size (local frame). */
  cbox(keys: string | readonly (string | null)[], cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, o?: GOpts) {
    this.box(keys, cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, o);
  }

  /** Planar quad a,b,c,d counter-clockwise seen from the front. uv is [u,v] x4 or null for metres along ab/ad. */
  quad(key: string, p: readonly number[], uv: readonly number[] | null, o?: GOpts) {
    this.colour(o);
    const ux = p[3] - p[0],
      uy = p[4] - p[1],
      uz = p[5] - p[2];
    const vx = p[9] - p[0],
      vy = p[10] - p[1],
      vz = p[11] - p[2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const b = this.bucket(key);
    const base = b.p.length / 3;
    const lu = Math.sqrt(ux * ux + uy * uy + uz * uz),
      lv = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const s = o?.uv ?? 1;
    const def = [0, 0, lu * s, 0, lu * s, lv * s, 0, lv * s];
    const t = uv ?? def;
    for (let k = 0; k < 4; k++) {
      if (o?.cols) this.colour({ col: o.cols[k], a: o.a });
      this.v(b, p[k * 3], p[k * 3 + 1], p[k * 3 + 2], nx, ny, nz, t[k * 2], t[k * 2 + 1]);
    }
    b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** w x h rectangle in the local XY plane facing +z, centred on the frame origin. */
  rect(key: string, w: number, h: number, r: UvRect = FULL_UV, o?: GOpts) {
    const x = w / 2,
      y = h / 2;
    this.quad(key, [-x, -y, 0, x, -y, 0, x, y, 0, -x, y, 0], [r.u0, r.v0, r.u1, r.v0, r.u1, r.v1, r.u0, r.v1], o);
  }

  /** Floor-style rectangle in the local XZ plane facing +y (u along x, v along -z). */
  flat(key: string, x0: number, z0: number, x1: number, z1: number, y: number, r: UvRect | null = null, o?: GOpts) {
    const s = o?.uv ?? 1;
    const uv = r ? [r.u0, r.v0, r.u1, r.v0, r.u1, r.v1, r.u0, r.v1] : [x0 * s, -z1 * s, x1 * s, -z1 * s, x1 * s, -z0 * s, x0 * s, -z0 * s];
    this.quad(key, [x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0], uv, o);
  }

  /** Append a THREE geometry (positions, normals, uvs) through the current frame. su/sv scale its UVs. */
  geom(key: string, g: THREE.BufferGeometry, o?: GOpts & { su?: number; sv?: number }) {
    this.colour(o);
    const pos = g.getAttribute("position"),
      nor = g.getAttribute("normal"),
      uv = g.getAttribute("uv");
    const su = o?.su ?? 1,
      sv = o?.sv ?? 1;
    const b = this.bucket(key);
    const base = b.p.length / 3;
    for (let i = 0; i < pos.count; i++) {
      this.v(b, pos.getX(i), pos.getY(i), pos.getZ(i), nor ? nor.getX(i) : 0, nor ? nor.getY(i) : 1, nor ? nor.getZ(i) : 0, uv ? uv.getX(i) * su : 0, uv ? uv.getY(i) * sv : 0);
    }
    const idx = g.getIndex();
    if (idx) for (let i = 0; i < idx.count; i++) b.i.push(base + idx.getX(i));
    else for (let i = 0; i < pos.count; i++) b.i.push(base + i);
  }

  /** Cylinder between two points (local frame); capped adds end discs. */
  tube(key: string, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, seg = 8, o?: GOpts & { capped?: boolean }) {
    const dx = bx - ax,
      dy = by - ay,
      dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-5) return;
    const g = cylCache(seg, !!o?.capped);
    this.save();
    _p.set(dx / len, dy / len, dz / len);
    _q.setFromUnitVectors(UP, _p);
    _m.compose(_s.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, TMP.set(r, len, r));
    this.m.multiply(_m);
    this.nm.getNormalMatrix(this.m);
    this.geom(key, g, { ...o, su: 2 * Math.PI * r * (o?.uv ?? 1), sv: len * (o?.uv ?? 1) });
    this.restore();
  }

  has(key: string) {
    const b = this.buckets.get(key);
    return !!b && b.i.length > 0;
  }

  /** Merge every bucket that has a material into one mesh each. */
  build(mats: Record<string, THREE.Material>, flags: (key: string) => { cast: boolean; receive: boolean; order?: number }): Map<string, THREE.Mesh> {
    const out = new Map<string, THREE.Mesh>();
    for (const [key, b] of this.buckets) {
      if (!b.i.length) continue;
      const mat = mats[key];
      if (!mat) {
        console.warn(`[level] no material for bucket "${key}"`);
        continue;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(b.p), 3));
      g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(b.n), 3));
      g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(b.t), 2));
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(b.c), 4));
      const n = b.p.length / 3;
      g.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(b.i) : new Uint16Array(b.i), 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `level.${key}`;
      const f = flags(key);
      mesh.castShadow = f.cast;
      mesh.receiveShadow = f.receive;
      if (f.order !== undefined) mesh.renderOrder = f.order;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      out.set(key, mesh);
    }
    this.buckets.clear();
    return out;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const TMP = new THREE.Vector3();
const cyls = new Map<number, THREE.BufferGeometry>();
function cylCache(seg: number, capped: boolean) {
  const k = seg * 2 + (capped ? 1 : 0);
  let g = cyls.get(k);
  if (!g) cyls.set(k, (g = new THREE.CylinderGeometry(1, 1, 1, seg, 1, !capped)));
  return g;
}

/** Yaw that turns local +z towards (nx, nz). */
export const yawTo = (nx: number, nz: number) => Math.atan2(nx, nz);
/** Camera yaw that looks along (dx, dz): forward is (-sin yaw, -cos yaw). */
export const camYaw = (dx: number, dz: number) => Math.atan2(-dx, -dz);
