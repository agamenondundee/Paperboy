import * as THREE from "three";
import { type Ctx, solidAt, blob } from "./levelCtx";
import type { Geo, UvRect } from "./levelGeo";

/**
 * Furniture and wall dressing. Every builder works in a local frame (origin
 * on the floor, facing +z unless noted) and merges into the static buckets,
 * so a room full of desks costs no extra draw calls.
 */

/** World position of a local offset (lx, lz) from (x, z) turned by yaw. */
export const loc = (x: number, z: number, yaw: number, lx: number, lz: number): [number, number] => [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw)];

const SEATS = [0xb5562a, 0x6b4a2c, 0x2f4f7a, 0x8a7a5a, 0x3d6b4a, 0x7a2c2c];
const METAL = { col: 0x55585a };
const SPHERE = new THREE.IcosahedronGeometry(1, 2);
const LOWBALL = new THREE.IcosahedronGeometry(1, 0);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 16);
const CYL_LO = new THREE.CylinderGeometry(1, 1, 1, 8);

export function sphere(g: Geo, key: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, col: number) {
  g.save();
  g.sub(x, y, z);
  g.scale(sx, sy, sz);
  g.geom(key, SPHERE, { col });
  g.restore();
}
/** Vertical cylinder standing on y0 (local frame). */
export function cyl(g: Geo, key: string, x: number, y0: number, z: number, r: number, h: number, col: number, lo = false) {
  g.save();
  g.sub(x, y0 + h / 2, z);
  g.scale(r, h, r);
  g.geom(key, lo ? CYL_LO : CYL, { col, su: 2 * Math.PI * r, sv: h });
  g.restore();
}
export function crumple(g: Geo, x: number, y: number, z: number, s: number, col: number, rot: number) {
  g.save();
  g.sub(x, y, z, rot, rot * 0.7, rot * 1.3);
  g.scale(s, s * 0.85, s);
  g.geom("paint", LOWBALL, { col });
  g.restore();
}

// ------------------------------------------------------------- seating

/** 1980s combination desk: the student sits at +z and faces -z. tipped rolls it onto its side. */
export function studentDesk(ctx: Ctx, x: number, z: number, yaw: number, tipped = 0) {
  const g = ctx.geo,
    r = ctx.rng;
  const seat = SEATS[(r() * SEATS.length) | 0];
  if (tipped) g.at(x, 0.3, z, yaw, 0, (tipped * Math.PI) / 2);
  else g.at(x, 0, z, yaw);
  g.box("wood", -0.3, 0.7, -0.64, 0.3, 0.726, -0.17, { col: 0xd8b98c });
  g.box("metal", -0.27, 0.675, -0.6, 0.27, 0.7, -0.2, METAL);
  g.box("metal", -0.2, 0.24, -0.04, 0.2, 0.26, 0.3, METAL);
  g.box("gloss", -0.21, 0.42, -0.04, 0.21, 0.445, 0.36, { col: seat });
  g.save();
  g.sub(0, 0.69, 0.39, 0, -0.12);
  g.box("gloss", -0.2, -0.13, -0.012, 0.2, 0.13, 0.012, { col: seat });
  g.restore();
  const t = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => g.tube("metal", ax, ay, az, bx, by, bz, 0.012, 6, METAL);
  t(-0.18, 0, -0.02, -0.18, 0.42, -0.02);
  t(0.18, 0, -0.02, 0.18, 0.42, -0.02);
  t(-0.18, 0, 0.34, -0.18, 0.42, 0.34);
  t(0.18, 0, 0.34, 0.18, 0.42, 0.34);
  t(-0.18, 0.015, -0.02, -0.18, 0.015, 0.34);
  t(0.18, 0.015, -0.02, 0.18, 0.015, 0.34);
  t(0.2, 0.43, 0.05, 0.24, 0.69, -0.3);
  t(0.24, 0, -0.5, 0.24, 0.69, -0.5);
  t(0.24, 0.015, -0.5, 0.18, 0.015, -0.02);
  t(0.19, 0.44, 0.36, 0.19, 0.69, 0.39);
  t(-0.19, 0.44, 0.36, -0.19, 0.69, 0.39);
  g.reset();
  const [cx, cz] = loc(x, z, yaw, 0, -0.13);
  if (!tipped) {
    solidAt(cx, cz, 0.6, 1.0, yaw, 0.17);
    blob(ctx, cx, cz, 0.85, 1.25, yaw, 0.42);
  } else {
    solidAt(x, z, 0.8, 1.0, yaw, 0.2);
    blob(ctx, x, z, 1.0, 1.2, yaw, 0.3);
  }
}

/** School chair: plastic shell on a steel frame. tipped lays it on its back. */
export function chair(ctx: Ctx, x: number, z: number, yaw: number, col?: number, tipped = false, collide = true) {
  const g = ctx.geo;
  const c = col ?? SEATS[(ctx.rng() * SEATS.length) | 0];
  if (tipped) g.at(x, 0.22, z, yaw, Math.PI / 2);
  else g.at(x, 0, z, yaw);
  g.box("gloss", -0.21, 0.43, -0.2, 0.21, 0.455, 0.2, { col: c });
  g.save();
  g.sub(0, 0.72, 0.22, 0, -0.1);
  g.box("gloss", -0.2, -0.14, -0.012, 0.2, 0.14, 0.012, { col: c });
  g.restore();
  const t = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => g.tube("chrome", ax, ay, az, bx, by, bz, 0.011, 6, { col: 0x8a8c8e });
  for (const sx of [-0.18, 0.18]) {
    t(sx, 0, -0.18, sx, 0.43, -0.17);
    t(sx, 0, 0.18, sx, 0.43, 0.17);
    t(sx, 0.44, 0.19, sx, 0.84, 0.25);
  }
  g.reset();
  if (collide && !tipped) solidAt(x, z, 0.44, 0.44, yaw, 0.08);
  if (!tipped) blob(ctx, x, z, 0.65, 0.65, yaw, 0.35);
}

/** Stool for lab benches and art tables. */
export function stool(ctx: Ctx, x: number, z: number, h = 0.65) {
  const g = ctx.geo;
  g.at(x, 0, z, ctx.rng() * Math.PI);
  cyl(g, "wood", 0, h - 0.04, 0, 0.17, 0.04, 0xa07850);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    g.tube("metal", Math.cos(a) * 0.13, h - 0.04, Math.sin(a) * 0.13, Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2, 0.012, 5, METAL);
  }
  g.reset();
  blob(ctx, x, z, 0.55, 0.55, 0, 0.3);
}

// ------------------------------------------------------------- tables

export interface TableOpts {
  top?: string;
  topCol?: number;
  leg?: string;
  legCol?: number;
  thick?: number;
  legW?: number;
  inset?: number;
  sight?: boolean;
  collide?: boolean;
}
export function table(ctx: Ctx, x: number, z: number, w: number, d: number, h: number, yaw: number, o: TableOpts = {}) {
  const g = ctx.geo;
  const t = o.thick ?? 0.035,
    lw = o.legW ?? 0.05;
  g.at(x, 0, z, yaw);
  g.box(o.top ?? "wood", -w / 2, h - t, -d / 2, w / 2, h, d / 2, { col: o.topCol ?? 0xb08a5c });
  const lk = o.leg ?? "metal",
    lc = { col: o.legCol ?? 0x4a4c4e };
  const ix = w / 2 - 0.06 - lw / 2,
    iz = d / 2 - 0.06 - lw / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(lk, sx * ix - lw / 2, 0, sz * iz - lw / 2, sx * ix + lw / 2, h - t, sz * iz + lw / 2, lc);
  g.box(lk, -ix, h - t - 0.08, -iz, ix, h - t, -iz + 0.02, lc);
  g.box(lk, -ix, h - t - 0.08, iz - 0.02, ix, h - t, iz, lc);
  g.reset();
  if (o.collide !== false) solidAt(x, z, w, d, yaw, o.inset ?? 0.14, o.sight ?? false);
  blob(ctx, x, z, w + 0.4, d + 0.4, yaw, 0.4);
}

/** Steel teacher's desk with a laminate top; the teacher sits at +z. */
export function teacherDesk(ctx: Ctx, x: number, z: number, yaw: number, col = 0x6f776c) {
  const g = ctx.geo;
  g.at(x, 0, z, yaw);
  const m = { col };
  g.box("wood", -0.78, 0.72, -0.4, 0.78, 0.76, 0.4, { col: 0x9a7a54 });
  g.box("metal", -0.76, 0.06, -0.37, -0.36, 0.72, 0.37, m);
  g.box("metal", 0.36, 0.06, -0.37, 0.76, 0.72, 0.37, m);
  g.box("metal", -0.36, 0.3, -0.37, 0.36, 0.72, -0.34, m);
  g.box("metal", -0.36, 0.6, -0.34, 0.36, 0.72, 0.36, m);
  for (const sx of [-0.56, 0.56])
    for (let i = 0; i < 3; i++) {
      const y = 0.12 + i * 0.2;
      g.box("metal", sx - 0.18, y, 0.37, sx + 0.18, y + 0.17, 0.375, m);
      g.box("chrome", sx - 0.06, y + 0.12, 0.375, sx + 0.06, y + 0.14, 0.39, { col: 0xa0a0a0 });
    }
  g.box("paint", -0.78, 0, -0.38, 0.78, 0.06, 0.38, { col: 0x222222 });
  // A blotter, papers, a mug and a stack of books.
  g.box("paint", -0.3, 0.76, -0.2, 0.3, 0.765, 0.2, { col: 0x2a4a3a });
  g.box("paint", 0.45, 0.76, -0.25, 0.68, 0.9, -0.05, { col: 0x6b2a24 });
  g.box("paint", 0.44, 0.9, -0.23, 0.66, 0.96, -0.07, { col: 0x2b3f63 });
  cyl(g, "gloss", -0.6, 0.76, 0.1, 0.045, 0.1, 0xd8d2c4);
  g.reset();
  solidAt(x, z, 1.56, 0.8, yaw, 0.15);
  blob(ctx, x, z, 2.0, 1.2, yaw, 0.5);
}

// ----------------------------------------------------------- storage

/** Books standing on a shelf: a dark block with a strip of spines on the front face (local frame, facing +z). */
export function bookRow(ctx: Ctx, x0: number, x1: number, y: number, zBack: number, zFront: number, h: number) {
  const g = ctx.geo,
    r = ctx.rng;
  let x = x0;
  while (x < x1 - 0.1) {
    const len = Math.min(x1 - x, 0.25 + r() * 0.7);
    if (r() < 0.12) {
      x += len * 0.5;
      continue;
    }
    const hh = h * (0.85 + r() * 0.15);
    g.box("paint", x, y, zBack, x + len, y + hh, zFront - 0.002, { col: 0x221a14, skip: 16 });
    const rect = ctx.atlas.uv(r() < 0.5 ? "books0" : "books1");
    const span = (rect.u1 - rect.u0) * Math.min(1, len / 2.0);
    const u0 = rect.u0 + r() * (rect.u1 - rect.u0 - span);
    g.quad("atlas", [x, y, zFront, x + len, y, zFront, x + len, y + hh, zFront, x, y + hh, zFront], [u0, rect.v0, u0 + span, rect.v0, u0 + span, rect.v1, u0, rect.v1]);
    x += len + 0.01;
  }
}

export interface ShelfOpts {
  shelves?: number;
  double?: boolean;
  col?: number;
  fill?: number;
  sight?: boolean;
}
/** Wooden bookcase, back against local -z; double-sided units have books both ways. */
export function bookcase(ctx: Ctx, x: number, z: number, yaw: number, w: number, h: number, d: number, o: ShelfOpts = {}) {
  const g = ctx.geo,
    r = ctx.rng;
  const n = o.shelves ?? 5;
  const col = { col: o.col ?? 0x6b4a2e };
  g.at(x, 0, z, yaw);
  const hw = w / 2,
    hd = d / 2;
  g.box("wood", -hw, 0, -hd, -hw + 0.025, h, hd, col);
  g.box("wood", hw - 0.025, 0, -hd, hw, h, hd, col);
  g.box("wood", -hw, h - 0.03, -hd, hw, h, hd, col);
  g.box("wood", -hw + 0.025, 0, -hd + 0.02, hw - 0.025, 0.09, hd - 0.02, col);
  if (!o.double) g.box("wood", -hw + 0.025, 0.09, -hd, hw - 0.025, h - 0.03, -hd + 0.015, { col: 0x3a281a });
  else g.box("wood", -hw + 0.025, 0.09, -0.008, hw - 0.025, h - 0.03, 0.008, { col: 0x3a281a });
  const step = (h - 0.12) / n;
  for (let i = 0; i < n; i++) {
    const y = 0.09 + i * step;
    if (i > 0) g.box("wood", -hw + 0.025, y - 0.02, -hd + 0.015, hw - 0.025, y, hd, col);
    if (r() < (o.fill ?? 0.9)) {
      const bh = Math.min(0.3, step - 0.05);
      if (o.double) {
        bookRow(ctx, -hw + 0.03, hw - 0.03, y, 0.01, hd - 0.03, bh);
        g.save();
        g.sub(0, 0, 0, Math.PI);
        bookRow(ctx, -hw + 0.03, hw - 0.03, y, 0.01, hd - 0.03, bh);
        g.restore();
      } else bookRow(ctx, -hw + 0.03, hw - 0.03, y, -hd + 0.03, hd - 0.03, bh);
    }
  }
  g.reset();
  solidAt(x, z, w, d, yaw, 0.04, o.sight ?? h > 1.5);
  blob(ctx, x, z, w + 0.3, d + 0.4, yaw, 0.55);
}

/** Low storage cabinet with doors (classrooms, labs). */
export function cabinet(ctx: Ctx, x: number, z: number, yaw: number, w: number, h = 0.9, d = 0.5, col = 0xb89a72, top = 0x7a6a5a) {
  const g = ctx.geo;
  g.at(x, 0, z, yaw);
  g.box("wood", -w / 2, 0.08, -d / 2, w / 2, h - 0.03, d / 2, { col });
  g.box("gloss", -w / 2 - 0.02, h - 0.03, -d / 2, w / 2 + 0.02, h, d / 2 + 0.02, { col: top });
  g.box("paint", -w / 2 + 0.02, 0, -d / 2 + 0.03, w / 2 - 0.02, 0.08, d / 2 - 0.04, { col: 0x1c1a18 });
  const n = Math.max(1, Math.round(w / 0.6));
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + (i * w) / n;
    g.box("wood", x0 + 0.01, 0.1, d / 2, x0 + w / n - 0.01, h - 0.05, d / 2 + 0.01, { col });
    g.box("chrome", x0 + w / n - 0.07, h - 0.25, d / 2 + 0.01, x0 + w / n - 0.05, h - 0.12, d / 2 + 0.03, { col: 0x9a9a9a });
  }
  g.reset();
  solidAt(x, z, w, d, yaw, 0.08);
  blob(ctx, x, z, w + 0.3, d + 0.4, yaw, 0.45);
}

export function filingCabinet(ctx: Ctx, x: number, z: number, yaw: number, open = -1) {
  const g = ctx.geo;
  const col = { col: 0x8a8670 };
  g.at(x, 0, z, yaw);
  g.box("metal", -0.23, 0, -0.33, 0.23, 1.32, 0.32, col);
  for (let i = 0; i < 4; i++) {
    const y = 0.05 + i * 0.32;
    const pull = i === open ? 0.38 : 0;
    g.box("metal", -0.22, y, 0.32 + pull - 0.02, 0.22, y + 0.3, 0.335 + pull, col);
    g.box("chrome", -0.06, y + 0.2, 0.335 + pull, 0.06, y + 0.23, 0.355 + pull, { col: 0xa8a8a0 });
    g.box("paint", -0.04, y + 0.24, 0.336 + pull, 0.04, y + 0.27, 0.338 + pull, { col: 0xe8e2cc });
    if (pull) {
      g.box("metal", -0.21, y + 0.02, 0.32, 0.21, y + 0.24, 0.32 + pull, col);
      g.box("paint", -0.19, y + 0.04, 0.33, 0.19, y + 0.27, 0.32 + pull - 0.03, { col: 0xd8cfa8 });
    }
  }
  g.reset();
  solidAt(x, z, 0.46, 0.65, yaw, 0.05);
  blob(ctx, x, z, 0.75, 0.95, yaw, 0.5);
}

/** Metal utility shelving with boxes, cans and bottles. */
export function utilityShelf(ctx: Ctx, x: number, z: number, yaw: number, w: number, h = 1.9, d = 0.45) {
  const g = ctx.geo,
    r = ctx.rng;
  g.at(x, 0, z, yaw);
  const m = { col: 0x6a6e70 };
  for (const sx of [-w / 2, w / 2 - 0.035]) for (const sz of [-d / 2, d / 2 - 0.035]) g.box("metal", sx, 0, sz, sx + 0.035, h, sz + 0.035, m);
  for (let i = 0; i < 4; i++) {
    const y = 0.12 + i * ((h - 0.15) / 3);
    g.box("metal", -w / 2, y - 0.025, -d / 2, w / 2, y, d / 2, m);
    let px = -w / 2 + 0.06;
    while (px < w / 2 - 0.15) {
      const kind = r();
      if (kind < 0.35) {
        const bw = 0.2 + r() * 0.25,
          bh = 0.15 + r() * 0.2;
        g.box("paint", px, y, -d / 2 + 0.04, px + bw, y + bh, d / 2 - 0.05, { col: [0x9a7a52, 0x8a6a42, 0xb09068][(r() * 3) | 0] });
        px += bw + 0.03;
      } else if (kind < 0.7) {
        for (let k = 0; k < 3 && px < w / 2 - 0.1; k++) {
          cyl(g, "chrome", px + 0.05, y, 0.0, 0.045, 0.12, [0xb0302a, 0x3a6a3a, 0xc8a040, 0x8a8a8a][(r() * 4) | 0], true);
          px += 0.11;
        }
      } else if (kind < 0.85) {
        cyl(g, "gloss", px + 0.06, y, 0.02, 0.05, 0.22 + r() * 0.1, [0x2a5a8a, 0xd8d8d0, 0x8a2a2a][(r() * 3) | 0], true);
        px += 0.14;
      } else px += 0.15 + r() * 0.2;
    }
  }
  g.reset();
  solidAt(x, z, w, d, yaw, 0.04, h > 1.5);
  blob(ctx, x, z, w + 0.3, d + 0.4, yaw, 0.5);
}

// --------------------------------------------------------- wall dressing

/** Atlas picture on a wall, w wide, height from the entry's aspect. */
export function picture(ctx: Ctx, name: string, x: number, y: number, z: number, yaw: number, w: number, roll = 0, key = "atlas") {
  const h = w / ctx.atlas.aspect(name);
  ctx.geo.at(x, y, z, yaw, 0, roll).rect(key, w, h, ctx.atlas.uv(name));
  ctx.geo.reset();
  return h;
}

/** Poster on a wall, slightly crooked. */
export function poster(ctx: Ctx, name: string, x: number, y: number, z: number, yaw: number, w = 0.5) {
  picture(ctx, name, x, y, z, yaw, w, (ctx.rng() - 0.5) * 0.08);
  // Tape at the corners.
  const g = ctx.geo;
  g.at(x, y, z, yaw);
  const h = w / ctx.atlas.aspect(name);
  for (const [sx, sy] of [
    [-1, 1],
    [1, 1],
  ])
    g.box("paint", sx * w * 0.5 - 0.03, sy * h * 0.5 - 0.015, 0.0, sx * w * 0.5 + 0.03, sy * h * 0.5 + 0.015, 0.002, { col: 0xd9cfa8 });
  g.reset();
}

export function framed(ctx: Ctx, name: string, x: number, y: number, z: number, yaw: number, w: number, frameCol = 0x4a3420) {
  const g = ctx.geo;
  const h = w / ctx.atlas.aspect(name);
  g.at(x, y, z, yaw);
  const f = 0.04,
    c = { col: frameCol };
  g.box("wood", -w / 2 - f, -h / 2 - f, -0.005, w / 2 + f, -h / 2, 0.03, c);
  g.box("wood", -w / 2 - f, h / 2, -0.005, w / 2 + f, h / 2 + f, 0.03, c);
  g.box("wood", -w / 2 - f, -h / 2, -0.005, -w / 2, h / 2, 0.03, c);
  g.box("wood", w / 2, -h / 2, -0.005, w / 2 + f, h / 2, 0.03, c);
  g.sub(0, 0, 0.012);
  g.rect("atlas", w, h, ctx.atlas.uv(name));
  g.reset();
}

export function chalkboard(ctx: Ctx, name: string, x: number, y: number, z: number, yaw: number, w = 4.8) {
  const g = ctx.geo,
    r = ctx.rng;
  const h = w / ctx.atlas.aspect(name);
  g.at(x, y, z, yaw);
  g.box("paint", -w / 2 - 0.02, -h / 2 - 0.02, -0.002, w / 2 + 0.02, h / 2 + 0.02, 0.008, { col: 0x1a221d });
  g.sub(0, 0, 0.009);
  g.rect("atlas", w, h, ctx.atlas.uv(name), { col: 0xe0e0e0 });
  g.sub(0, 0, -0.009);
  const f = { col: 0x8a8c8a };
  g.box("chrome", -w / 2 - 0.06, h / 2, -0.005, w / 2 + 0.06, h / 2 + 0.05, 0.03, f);
  g.box("chrome", -w / 2 - 0.06, -h / 2 - 0.05, -0.005, -w / 2, h / 2, 0.03, f);
  g.box("chrome", w / 2, -h / 2 - 0.05, -0.005, w / 2 + 0.06, h / 2, 0.03, f);
  g.box("chrome", -w / 2 - 0.06, -h / 2 - 0.06, -0.005, w / 2 + 0.06, -h / 2 - 0.04, 0.09, f);
  g.box("chrome", -w / 2 - 0.06, -h / 2 - 0.06, 0.08, w / 2 + 0.06, -h / 2 - 0.02, 0.09, f);
  // Chalk and a felt eraser in the tray.
  for (let i = 0; i < 4; i++) {
    const px = (r() - 0.5) * w * 0.8;
    g.box("paint", px, -h / 2 - 0.04, 0.03, px + 0.08, -h / 2 - 0.03, 0.04, { col: [0xf0f0e8, 0xf0d8d8, 0xd8e8f0][i % 3] });
  }
  const ex = (r() - 0.5) * w * 0.6;
  g.box("paint", ex, -h / 2 - 0.04, 0.025, ex + 0.13, -h / 2 - 0.005, 0.075, { col: 0x5a4a3a });
  g.reset();
}

export function clock(ctx: Ctx, x: number, y: number, z: number, yaw: number) {
  const g = ctx.geo;
  g.at(x, y, z, yaw, Math.PI / 2);
  g.save();
  g.sub(0, 0.025, 0);
  g.scale(0.17, 0.05, 0.17);
  g.geom("paint", CYL, { col: 0x1d1d1d });
  g.restore();
  g.at(x, y, z, yaw).sub(0, 0, 0.051).rect("atlas", 0.3, 0.3, ctx.atlas.uv("clock"));
  g.reset();
}

/** Classroom flag on a short pole angled out from the wall. */
export function wallFlag(ctx: Ctx, x: number, y: number, z: number, yaw: number) {
  const g = ctx.geo;
  g.at(x, y, z, yaw);
  g.box("chrome", -0.05, -0.08, 0, 0.05, 0.08, 0.02, { col: 0xb08d3a });
  g.tube("wood", 0, 0, 0.02, 0, 0.55, 0.62, 0.012, 6, { col: 0x8a6a4a });
  sphere(g, "chrome", 0, 0.57, 0.64, 0.03, 0.03, 0.03, 0xc9a24a);
  g.sub(0.0, 0.27, 0.42, Math.PI / 2, 0.05);
  g.rect("atlas", 0.6, 0.38, ctx.atlas.uv("flagUS"));
  g.sub(0, 0, -0.002, Math.PI);
  g.rect("atlas", 0.6, 0.38, ctx.atlas.uv("flagUS"));
  g.reset();
}

export function fountain(ctx: Ctx, x: number, z: number, yaw: number) {
  const g = ctx.geo;
  g.at(x, 0, z, yaw);
  g.box("chrome", -0.25, 0.75, 0, 0.25, 0.95, 0.4, { col: 0xb8b8b4 });
  g.box("paint", -0.2, 0.94, 0.05, 0.2, 0.952, 0.35, { col: 0x3a3a38 });
  g.box("chrome", -0.08, 0.2, 0, 0.08, 0.75, 0.15, { col: 0x9a9a96 });
  g.box("chrome", 0.12, 0.95, 0.1, 0.16, 1.0, 0.16, { col: 0xd0d0cc });
  g.reset();
  solidAt(...loc(x, z, yaw, 0, 0.2), 0.5, 0.4, yaw, 0.05);
}

export function extinguisher(ctx: Ctx, x: number, y: number, z: number, yaw: number) {
  const g = ctx.geo;
  g.at(x, y, z, yaw);
  g.box("paint", -0.22, -0.4, 0, 0.22, 0.4, 0.12, { col: 0xb01818 });
  g.box("glass", -0.18, -0.36, 0.121, 0.18, 0.36, 0.125, { col: 0xc8d8e0, a: 0.3 });
  cyl(g, "gloss", 0, -0.33, 0.06, 0.07, 0.5, 0xc01a1a);
  g.sub(0, 0.55, 0.002);
  g.rect("atlas", 0.2, 0.2, ctx.atlas.uv("fire"));
  g.reset();
}

export function trashCan(ctx: Ctx, x: number, z: number, tipped = false) {
  const g = ctx.geo,
    r = ctx.rng;
  if (tipped) g.at(x, 0.24, z, r() * Math.PI * 2, Math.PI / 2);
  else g.at(x, 0, z);
  g.save();
  g.sub(0, 0.33, 0);
  g.scale(0.24, 0.66, 0.24);
  g.geom("metal", new THREE.CylinderGeometry(1, 0.85, 1, 14, 1, true), { col: 0x5e6b62, su: 1.5, sv: 0.66 });
  g.restore();
  g.save();
  g.sub(0, 0.66, 0);
  g.geom("metal", RIM, { col: 0x4a5450 });
  g.restore();
  cyl(g, "paint", 0, 0.0, 0, 0.2, 0.02, 0x1a1a1a, true);
  g.reset();
  if (!tipped) {
    for (let i = 0; i < 3; i++) crumple(g, x + (r() - 0.5) * 0.12, 0.6, z + (r() - 0.5) * 0.12, 0.06, 0xe8e4d8, r() * 6);
    solidAt(x, z, 0.48, 0.48, 0, 0.06);
  } else for (let i = 0; i < 5; i++) crumple(g, x + (r() - 0.5) * 1.2, 0.05, z + (r() - 0.5) * 1.2, 0.05 + r() * 0.03, 0xe8e4d8, r() * 6);
  blob(ctx, x, z, 0.7, 0.7, 0, 0.45);
}
const RIM = new THREE.TorusGeometry(0.24, 0.015, 5, 16).rotateX(Math.PI / 2);

export function bulletinBoard(ctx: Ctx, x: number, y: number, z: number, yaw: number, w = 1.8) {
  framed(ctx, "bulletin", x, y, z, yaw, w, 0x5a3a20);
}

/** Wall-mounted cast iron radiator under a window (local frame against the wall, facing +z). */
export function radiator(ctx: Ctx, x: number, z: number, yaw: number, w: number) {
  const g = ctx.geo;
  g.at(x, 0, z, yaw);
  const n = Math.floor(w / 0.06);
  for (let i = 0; i < n; i++) {
    const px = -w / 2 + i * 0.06;
    g.box("metal", px, 0.12, 0.02, px + 0.045, 0.78, 0.17, { col: 0xc8c0b0 });
  }
  g.box("metal", -w / 2, 0.7, 0.03, w / 2, 0.74, 0.16, { col: 0xc8c0b0 });
  g.box("metal", -w / 2, 0.16, 0.03, w / 2, 0.2, 0.16, { col: 0xc8c0b0 });
  g.tube("metal", -w / 2 - 0.05, 0.0, 0.08, -w / 2 - 0.05, 0.2, 0.08, 0.02, 6, { col: 0x8a7a6a });
  g.reset();
}

export function bench(ctx: Ctx, x: number, z: number, yaw: number, w = 1.8) {
  const g = ctx.geo;
  g.at(x, 0, z, yaw);
  g.box("wood", -w / 2, 0.42, -0.2, w / 2, 0.46, 0.2, { col: 0x8a6440 });
  for (const sx of [-w / 2 + 0.1, w / 2 - 0.14]) g.box("metal", sx, 0, -0.18, sx + 0.04, 0.42, 0.18, METAL);
  g.reset();
  solidAt(x, z, w, 0.4, yaw, 0.1);
  blob(ctx, x, z, w + 0.4, 0.8, yaw, 0.4);
}

/** Paper sheet lying on a surface (atlas). */
export function paperSheet(ctx: Ctx, x: number, y: number, z: number, yaw: number) {
  ctx.geo.at(x, y, z, yaw, -Math.PI / 2).rect("atlas", 0.21, 0.27, ctx.atlas.uv("paper") as UvRect);
  ctx.geo.reset();
}
