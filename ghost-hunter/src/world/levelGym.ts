import * as THREE from "three";
import { type Ctx, solid, solidAt, blob, item, relic, splat } from "./levelCtx";
import { chair, cyl, sphere, picture } from "./levelFurniture";
import { quadN } from "./levelShell";

/**
 * The gymnasium, still dressed for prom night 1987: stage with curtains and
 * banner, bleachers, hoops, court lines, steel trusses with hanging lamps,
 * streamers, balloons and a slowly turning mirror ball.
 */

const PI = Math.PI;
const GYM = { w: 3.1, e: 35.9, n: 18.1, s: 50.9, ceil: 7.5 };
const BALLOON_COLS = [0xff6fb0, 0xd8d8e0, 0xf4f0e8, 0x9a5ad0, 0xd02040, 0xffb0d8];

export function buildGym(ctx: Ctx) {
  const g = ctx.geo,
    r = ctx.rng;
  const tint = { col: 0xd2d6c6 };

  // ------------------------------------------------------------ trusses
  const chordLo = 6.45,
    chordHi = 7.35;
  const steel = { col: 0x3d4246 };
  for (const x of [11, 16.5, 22, 27.5, 33]) {
    g.box("metal", x - 0.07, chordHi - 0.07, GYM.n, x + 0.07, chordHi + 0.07, GYM.s, steel);
    g.box("metal", x - 0.06, chordLo - 0.06, GYM.n + 0.3, x + 0.06, chordLo + 0.06, GYM.s - 0.3, steel);
    const n = 20;
    for (let i = 0; i <= n; i++) {
      const z = GYM.n + 0.3 + (i / n) * (GYM.s - GYM.n - 0.6);
      g.tube("metal", x, chordLo, z, x, chordHi, z, 0.03, 4, steel);
      if (i < n) {
        const z2 = GYM.n + 0.3 + ((i + 1) / n) * (GYM.s - GYM.n - 0.6);
        if (i % 2) g.tube("metal", x, chordLo, z, x, chordHi, z2, 0.025, 4, steel);
        else g.tube("metal", x, chordHi, z, x, chordLo, z2, 0.025, 4, steel);
      }
    }
    g.box("metal", x - 0.2, chordLo - 0.3, GYM.n, x + 0.2, GYM.ceil, GYM.n + 0.3, steel);
    g.box("metal", x - 0.2, chordLo - 0.3, GYM.s - 0.3, x + 0.2, GYM.ceil, GYM.s, steel);
  }
  for (const z of [24.5, 34.5, 44.5]) g.box("metal", 11, chordHi - 0.05, z - 0.04, 33, chordHi + 0.05, z + 0.04, steel);

  // ------------------------------------------------------ hanging lamps
  for (const x of [11, 22, 33])
    for (const z of [24.5, 34.5, 44.5]) {
      if (x === 22 && z === 34.5) continue;
      ctx.lights.addIndoor("highbay", x, 5.95, z, 0, "G", { intensity: 45, range: 18, lightY: 5.6, cone: [5.9, 2.7, 0.04] });
    }

  // ------------------------------------------------------------- stage
  const sx1 = 8.6;
  g.box("wood", GYM.w, 0, 25, sx1, 1.0, 44, { col: 0x5a3a24, skip: 2 | 4 | 8 });
  g.flat("woodFloor", GYM.w, 25, sx1, 44, 1.0, null, { col: 0xb89a70 });
  g.box("wood", sx1 - 0.05, 0.95, 25, sx1 + 0.06, 1.02, 44, { col: 0x2e1d12 });
  for (let i = 0; i < 3; i++) {
    g.box("wood", sx1, 0, 25.2, sx1 + (3 - i) * 0.3, (i + 1) * 0.25, 26.6, { col: 0x5a3a24, skip: 2 | 4 | 8 });
    g.flat("woodFloor", sx1, 25.2, sx1 + (3 - i) * 0.3, 26.6, (i + 1) * 0.25, null, { col: 0xb89a70 });
  }
  // Proscenium piers and header: the stage sits in an alcove.
  g.box("block", GYM.w, 0, GYM.n, sx1 + 0.1, GYM.ceil, 24.6, { ...tint, skip: 2 | 4 | 8 | 32 });
  g.box("block", GYM.w, 0, 44.4, sx1 + 0.1, GYM.ceil, GYM.s, { ...tint, skip: 2 | 4 | 8 | 16 });
  g.box("block", GYM.w, 6.9, 24.6, sx1 + 0.1, GYM.ceil, 44.4, { ...tint, skip: 2 | 4 });
  for (const z of [24.6, 44.4]) g.box("paint", sx1 + 0.1, 0, z - (z < 30 ? 0.15 : -0.15) - 0.06, sx1 + 0.13, 6.9, z - (z < 30 ? 0.15 : -0.15) + 0.06, { col: 0x5a1414 });
  solid(GYM.w, sx1 + 0.1, GYM.n, 24.6, true);
  solid(GYM.w, sx1 + 0.1, 44.4, GYM.s, true);
  solid(GYM.w, sx1 - 0.3, 24.6, 44.4);
  solid(sx1, sx1 + 0.9, 25.2, 26.6);
  // Curtains: back drape, wings and valance.
  const curtain = (p: number[], n: number[], u0: number, u1: number, v0: number, v1: number, col: number) => quadN(g, "curtain", p, n, [u0, v0, u1, v0, u1, v1, u0, v1], { col });
  curtain([3.16, 1.0, 44.4, 3.16, 1.0, 24.6, 3.16, 6.9, 24.6, 3.16, 6.9, 44.4], [1, 0, 0], 0, 19.8, 0, 5.9, 0x6a0c14);
  for (const z of [25.0, 44.0]) curtain([3.2, 1.0, z, 8.3, 1.0, z, 8.3, 6.9, z, 3.2, 6.9, z], [0, 0, z < 30 ? 1 : -1], 0, 5.1, 0, 5.9, 0x5a0a12);
  curtain([8.45, 5.55, 44.4, 8.45, 5.55, 24.6, 8.45, 6.9, 24.6, 8.45, 6.9, 44.4], [1, 0, 0], 0, 19.8, 0, 1.35, 0x7a1018);
  // Gathered curtain at the sides of the opening.
  for (const z of [25.3, 43.7]) {
    g.at(8.2, 1.0, z);
    g.save();
    g.sub(0, 2.9, 0);
    g.scale(0.32, 5.8, 0.32);
    g.geom("curtain", new THREE.CylinderGeometry(1, 0.7, 1, 12, 1), { col: 0x6a0c14, su: 1.8, sv: 5.8 });
    g.restore();
    g.reset();
  }
  picture(ctx, "bannerProm", sx1 - 0.13, 6.2, 34.5, PI / 2, 5.4);
  // The prom queen's throne.
  g.at(5.2, 1.0, 34.5, PI / 2);
  g.box("cloth", -0.42, 0.0, -0.35, 0.42, 0.48, 0.35, { col: 0x7a1018 });
  g.box("cloth", -0.42, 0.48, 0.25, 0.42, 1.7, 0.4, { col: 0x7a1018 });
  g.box("chrome", -0.46, 0.0, -0.38, -0.38, 0.75, 0.42, { col: 0xc9a24a });
  g.box("chrome", 0.38, 0.0, -0.38, 0.46, 0.75, 0.42, { col: 0xc9a24a });
  g.box("chrome", -0.46, 1.7, 0.22, 0.46, 1.82, 0.42, { col: 0xc9a24a });
  g.reset();
  relic(ctx, "crown", "G", sx1 - 0.15, 1.0, 33.4, "the gym stage");
  item(ctx, "G", sx1 + 1.6, 0, 27.4, "the gym stage");

  // ---------------------------------------------------------- bleachers
  const bx0 = 9.5,
    bx1 = 33.5;
  for (let i = 0; i < 5; i++) {
    const z0 = 46.3 + i * 0.9,
      top = 0.45 + i * 0.42;
    const y0 = i === 0 ? 0 : top - 0.42;
    g.box(["paint", "paint", "wood", null, null, "wood"], bx0, y0, z0, bx1, top, GYM.s, { col: 0x3a3632 });
    g.box("wood", bx0, top, z0, bx1, top + 0.04, z0 + 0.3, { col: 0xa88a5a });
    // Aisle step markings.
    g.box("paint", 21.2, top + 0.001, z0 + 0.3, 21.8, top + 0.004, z0 + 0.9, { col: 0xd8c040 });
  }
  for (const x of [bx0 + 0.05, bx1 - 0.05]) g.tube("chrome", x, 0.5, 46.4, x, 2.6, 50.6, 0.025, 6, { col: 0x8a8a8a });
  g.tube("chrome", bx0, 3.1, 50.7, bx1, 3.1, 50.7, 0.03, 6, { col: 0x8a8a8a });
  solid(bx0, bx1, 46.45, GYM.s);
  blob(ctx, (bx0 + bx1) / 2, 46.5, bx1 - bx0 + 0.6, 1.0, 0, 0.5);
  relic(ctx, "crown", "G", 25.2, 0.49, 46.38, "the gym bleachers");
  item(ctx, "G", 14.3, 0.49, 46.38, "the gym bleachers");

  // ---------------------------------------------------------------- hoops
  hoop(ctx, 11.3, 1);
  hoop(ctx, 32.7, -1);
  for (let i = 0; i < 7; i++) g.box("gloss", GYM.e - 0.06, 0.15, 31.0 + i, GYM.e, 2.15, 31.96 + i, { col: 0x6b2222 });

  // ---------------------------------------------------------- court lines
  const line = (x0: number, z0: number, x1: number, z1: number, w: number, col: number) => {
    const dx = x1 - x0,
      dz = z1 - z0,
      l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * (w / 2),
      nz = (dx / l) * (w / 2);
    quadN(g, "paintDecal", [x0 + nx, 0.003, z0 + nz, x1 + nx, 0.003, z1 + nz, x1 - nx, 0.003, z1 - nz, x0 - nx, 0.003, z0 - nz], [0, 1, 0], null, { col });
  };
  const arc = (cx: number, cz: number, rad: number, a0: number, a1: number, col: number) => {
    const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) * rad * 3));
    for (let i = 0; i < n; i++) {
      const p = a0 + ((a1 - a0) * i) / n,
        q = a0 + ((a1 - a0) * (i + 1)) / n;
      line(cx + Math.cos(p) * rad, cz + Math.sin(p) * rad, cx + Math.cos(q) * rad, cz + Math.sin(q) * rad, 0.05, col);
    }
  };
  const W = 0xe6dfcc,
    M = 0x6b2222;
  const cx0 = 10.5,
    cx1 = 33.5,
    cz0 = 27.5,
    cz1 = 41.5,
    cmz = 34.5;
  line(cx0, cz0, cx1, cz0, 0.06, W);
  line(cx0, cz1, cx1, cz1, 0.06, W);
  line(cx0, cz0, cx0, cz1, 0.06, W);
  line(cx1, cz0, cx1, cz1, 0.06, W);
  line(22, cz0, 22, cz1, 0.05, W);
  arc(22, cmz, 1.8, 0, PI * 2, W);
  for (const [bx, dir] of [
    [cx0, 1],
    [cx1, -1],
  ] as const) {
    const ft = bx + dir * 5.8;
    g.at((bx + ft) / 2, 0.0025, cmz, 0, -PI / 2).rect("paintDecal", 5.8, 3.6, undefined, { col: M });
    g.reset();
    line(bx, cmz - 1.8, ft, cmz - 1.8, 0.05, W);
    line(bx, cmz + 1.8, ft, cmz + 1.8, 0.05, W);
    line(ft, cmz - 1.8, ft, cmz + 1.8, 0.05, W);
    arc(ft, cmz, 1.8, 0, PI * 2, W);
    const rim = bx + dir * 1.18;
    arc(rim, cmz, 6.0, dir > 0 ? -PI / 2 : PI / 2, dir > 0 ? PI / 2 : PI * 1.5, W);
  }
  g.at(22, 0.0035, cmz, 0, -PI / 2).rect("atlasDecal", 3.4, 3.4, ctx.atlas.uv("crest"));
  g.reset();

  // ---------------------------------------------------- scoreboard, banners
  g.at(28, 4.9, GYM.n);
  g.box("paint", -1.75, -0.7, 0, 1.75, 0.7, 0.25, { col: 0x151515 });
  g.sub(0, 0, 0.252).rect("glow", 3.3, 3.3 / ctx.atlas.aspect("scoreboard"), ctx.atlas.uv("scoreboard"), { col: new THREE.Color(1.5, 1.5, 1.5) });
  g.reset();
  picture(ctx, "bannerHawks", 13.5, 5.2, GYM.n + 0.015, 0, 3.0);

  // -------------------------------------------------- prom tables & punch
  const tables: [number, number][] = [
    [13.4, 22.6],
    [25.2, 22.4],
    [31.0, 23.6],
    [15.2, 43.8],
    [28.6, 44.0],
  ];
  const cloth = [0xf2e6ea, 0xe8a8c8];
  for (const [i, [x, z]] of tables.entries()) {
    g.at(x, 0, z);
    cyl(g, "wood", 0, 0.72, 0, 0.8, 0.03, 0x7a5a3a);
    g.save();
    g.sub(0, 0.39, 0);
    g.scale(1, 0.72, 1);
    g.geom("cloth", new THREE.CylinderGeometry(0.83, 0.95, 1, 22, 1, true), { col: cloth[i % 2], su: 5, sv: 0.72 });
    g.restore();
    cyl(g, "cloth", 0, 0.75, 0, 0.83, 0.012, cloth[i % 2]);
    g.tube("glass", 0, 0.762, 0, 0, 0.98, 0, 0.06, 10, { col: 0xb8d0d8, a: 0.35, capped: true });
    sphere(g, "cloth", 0, 1.0, 0, 0.07, 0.05, 0.07, 0x7a1018);
    g.reset();
    solidAt(x, z, 1.8, 1.8, 0, 0.32);
    blob(ctx, x, z, 2.4, 2.4, 0, 0.5);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * PI * 2 + r();
      const tipped = r() < 0.2;
      chair(ctx, x + Math.cos(a) * 1.25, z + Math.sin(a) * 1.25, Math.atan2(Math.cos(a), Math.sin(a)) + (r() - 0.5) * 0.4, 0xd8d8d8, tipped);
    }
    if (i === 0 || i === 3) item(ctx, "G", x + 0.74, 0.763, z, "the gym", r() * 6);
  }
  // Punch table against the north wall.
  g.box("cloth", 23.4, 0.0, GYM.n + 0.15, 27.0, 0.78, GYM.n + 0.95, { col: 0xf2e6ea });
  g.tube("glass", 25.2, 0.78, GYM.n + 0.55, 25.2, 0.98, GYM.n + 0.55, 0.22, 16, { col: 0xc8d8e0, a: 0.4, capped: true });
  cyl(g, "gloss", 25.2, 0.79, GYM.n + 0.55, 0.2, 0.12, 0x8a0a14);
  for (let i = 0; i < 10; i++) cyl(g, "paint", 23.7 + r() * 3.0, 0.78, GYM.n + 0.3 + r() * 0.5, 0.035, 0.09, 0xe8e2d4, true);
  solid(23.5, 26.9, GYM.n, GYM.n + 0.85);
  blob(ctx, 25.2, GYM.n + 0.6, 4.2, 1.4, 0, 0.5);

  // ----------------------------------------------------------- streamers
  const streamCols = [0xe85b9a, 0xc8c8d0, 0xf0ece4, 0x8a4ab0];
  for (const x of [11, 16.5, 22, 27.5, 33])
    for (let i = 0; i < 12; i++) {
      const z = GYM.n + 1 + r() * (GYM.s - GYM.n - 2);
      const len = 1.2 + r() * 2.6;
      g.at(x + (r() - 0.5) * 0.1, chordLo - 0.05, z, r() * PI, 0, (r() - 0.5) * 0.15);
      g.box("cloth", -0.025, -len, -0.002, 0.025, 0, 0.002, { col: streamCols[(r() * 4) | 0] });
      g.reset();
    }
  for (const z of [22, 28, 34.5, 41, 47])
    for (let t = 0; t < 4; t++) {
      const xa = 11 + t * 5.5,
        xb = xa + 5.5;
      const col = streamCols[(t + Math.round(z)) % 4];
      let px = xa,
        py = chordLo;
      for (let i = 1; i <= 10; i++) {
        const u = i / 10;
        const x = xa + (xb - xa) * u,
          y = chordLo - Math.sin(u * PI) * 0.9;
        g.tube("cloth", px, py, z, x, y, z, 0.035, 4, { col });
        px = x;
        py = y;
      }
    }
  // Confetti across the dance floor.
  for (let i = 0; i < 360; i++) {
    const a = r() * PI * 2,
      d = Math.sqrt(r()) * 9;
    g.at(22 + Math.cos(a) * d * 1.3, 0.004, cmz + Math.sin(a) * d * 0.8, r() * PI, -PI / 2);
    g.rect("paintDecal", 0.025, 0.025, undefined, { col: [0xff6fb0, 0xd8d8e0, 0xe8b923, 0x9a5ad0][(r() * 4) | 0] });
    g.reset();
  }
  // Deflated balloons on the floor.
  for (let i = 0; i < 12; i++) {
    const x = 10 + r() * 24,
      z = 20 + r() * 25;
    g.at(x, 0.03, z, r() * PI);
    g.scale(1, 0.25, 1);
    sphere(g, "gloss", 0, 0, 0, 0.15, 0.15, 0.15, BALLOON_COLS[(r() * BALLOON_COLS.length) | 0]);
    g.reset();
  }
  // Something terrible happened on the dance floor.
  splat(ctx, 21.2, 0.006, 33.6, 0, -PI / 2, 1.8, 0x3a0204, 0.92);
  splat(ctx, 22.6, 0.006, 35.1, 0, -PI / 2, 0.9, 0x3a0204, 0.85);

  item(ctx, "G", 33.8, 0, 20.2, "the gym");
  buildBalloons(ctx, tables);
  buildMirrorBall(ctx);
}

/** Backboard, rim and net. dir is +1 when the board faces +x. */
function hoop(ctx: Ctx, bx: number, dir: number) {
  const g = ctx.geo;
  const z = 34.5;
  const front = bx + dir * 0.02;
  g.box("gloss", bx - 0.02, 2.75, z - 0.9, bx + 0.02, 3.8, z + 0.9, { col: 0xe8e8e0 });
  const mark = (y0: number, y1: number, z0: number, z1: number) => g.box("paint", Math.min(front, front + dir * 0.004), y0, z0, Math.max(front, front + dir * 0.004), y1, z1, { col: 0xd8541a });
  mark(3.04, 3.08, z - 0.3, z + 0.3);
  mark(3.47, 3.51, z - 0.3, z + 0.3);
  mark(3.04, 3.51, z - 0.3, z - 0.26);
  mark(3.04, 3.51, z + 0.26, z + 0.3);
  mark(2.75, 2.8, z - 0.9, z + 0.9);
  mark(3.75, 3.8, z - 0.9, z + 0.9);
  const rx = bx + dir * 0.38;
  g.box("metal", Math.min(front, front + dir * 0.15), 3.0, z - 0.08, Math.max(front, front + dir * 0.15), 3.06, z + 0.08, { col: 0xd8541a });
  g.at(rx, 3.05, z);
  g.geom("metal", RIM, { col: 0xd8541a });
  g.sub(0, -0.21, 0);
  g.geom("fence", NET, { su: 1.3, sv: 0.42 });
  g.reset();
  if (dir > 0) {
    // Suspended from the truss above.
    g.tube("metal", bx - 0.05, 3.8, z - 0.6, 11, 6.4, z - 0.6, 0.04, 6, { col: 0x3d4246 });
    g.tube("metal", bx - 0.05, 3.8, z + 0.6, 11, 6.4, z + 0.6, 0.04, 6, { col: 0x3d4246 });
    g.tube("metal", bx - 0.05, 3.3, z, 11, 6.4, z + 1.6, 0.035, 6, { col: 0x3d4246 });
    g.tube("metal", bx - 0.05, 3.3, z, 11, 6.4, z - 1.6, 0.035, 6, { col: 0x3d4246 });
  } else {
    // Bracketed off the east wall.
    for (const y of [2.95, 3.65]) for (const dz of [-0.6, 0.6]) g.tube("metal", bx + 0.02, y, z + dz, 35.9, y, z + dz * 1.3, 0.04, 6, { col: 0x3d4246 });
    g.tube("metal", bx + 0.02, 3.65, z, 35.9, 2.4, z, 0.04, 6, { col: 0x3d4246 });
  }
}
const RIM = new THREE.TorusGeometry(0.23, 0.01, 6, 24).rotateX(PI / 2);
const NET = new THREE.CylinderGeometry(0.23, 0.15, 0.42, 14, 1, true);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);

/** Balloons: one instanced mesh, each bobbing gently on its string. */
function buildBalloons(ctx: Ctx, tables: [number, number][]) {
  const r = ctx.rng;
  const pts: { p: THREE.Vector3; ph: number; amp: number }[] = [];
  const cluster = (x: number, y: number, z: number, n: number, spread: number) => {
    for (let i = 0; i < n; i++) pts.push({ p: new THREE.Vector3(x + (r() - 0.5) * spread, y + r() * 0.5, z + (r() - 0.5) * spread), ph: r() * 10, amp: 0.03 + r() * 0.03 });
  };
  cluster(8.9, 2.3, 25.6, 7, 0.6);
  cluster(8.9, 2.3, 43.4, 7, 0.6);
  for (const [x, z] of tables) cluster(x, 1.85, z, 3, 0.35);
  cluster(9.6, 1.6, 46.6, 5, 0.5);
  cluster(33.4, 1.6, 46.6, 5, 0.5);
  for (let i = 0; i < 26; i++) {
    const a = r() * PI * 2,
      d = 2 + r() * 9;
    pts.push({ p: new THREE.Vector3(22 + Math.cos(a) * d, 7.15 - r() * 0.15, 34.5 + Math.sin(a) * d * 0.9), ph: r() * 10, amp: 0.012 });
  }
  const geo = new THREE.SphereGeometry(0.15, 14, 10);
  geo.scale(1, 1.18, 1);
  const knot = new THREE.ConeGeometry(0.02, 0.04, 6).translate(0, -0.19, 0);
  const string = new THREE.CylinderGeometry(0.0025, 0.0025, 1.1, 3).translate(0, -0.76, 0);
  const merged = mergeSimple([geo, knot, string]);
  const mesh = new THREE.InstancedMesh(merged, ctx.mats.balloon, pts.length);
  mesh.name = "level.balloons";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const c = new THREE.Color();
  pts.forEach((b, i) => mesh.setColorAt(i, c.setHex(BALLOON_COLS[(r() * BALLOON_COLS.length) | 0])));
  const pos = new THREE.Vector3();
  const update = (_dt: number, t: number) => {
    for (let i = 0; i < pts.length; i++) {
      const b = pts[i];
      pos.copy(b.p);
      pos.y += Math.sin(t * 0.7 + b.ph) * b.amp;
      _e.set(Math.sin(t * 0.5 + b.ph) * 0.06, b.ph, Math.cos(t * 0.43 + b.ph) * 0.06);
      _q.setFromEuler(_e);
      _m.compose(pos, _q, _s);
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0, 0);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  ctx.scene.add(mesh);
  ctx.objects.push(mesh);
  ctx.anim.push(update);
}

/** Merge a few non-indexed-compatible geometries (position, normal, uv) into one. */
function mergeSimple(list: THREE.BufferGeometry[]) {
  const pos: number[] = [],
    nor: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  for (const g of list) {
    const base = pos.length / 3;
    const p = g.getAttribute("position"),
      n = g.getAttribute("normal"),
      t = g.getAttribute("uv");
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(t.getX(i), t.getY(i));
    }
    const ix = g.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

function buildMirrorBall(ctx: Ctx) {
  const g = ctx.geo;
  const y = 5.35,
    x = 22,
    z = 34.5;
  g.tube("chrome", x, y + 0.36, z, x, 6.45, z, 0.008, 4, { col: 0x9a9a9a });
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.36, 3), ctx.mats.mirror);
  ball.name = "level.mirrorBall";
  ball.position.set(x, y, z);
  ball.castShadow = true;
  ctx.scene.add(ball);
  ctx.objects.push(ball);
  ctx.anim.push((dt) => {
    ball.rotation.y += dt * 0.35;
  });
}
