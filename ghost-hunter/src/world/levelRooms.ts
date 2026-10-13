import * as THREE from "three";
import { ROOMS, WT, roomBounds } from "./map";
import type { Geo } from "./levelGeo";
import { type Ctx, solid, solidAt, blob, item, relic } from "./levelCtx";
import {
  loc,
  sphere,
  cyl,
  crumple,
  studentDesk,
  chair,
  stool,
  table,
  teacherDesk,
  bookcase,
  cabinet,
  filingCabinet,
  utilityShelf,
  picture,
  poster,
  framed,
  chalkboard,
  clock,
  wallFlag,
  trashCan,
  bulletinBoard,
  radiator,
  bench,
  paperSheet,
} from "./levelFurniture";

/** Furniture, lights, pickups and relic spots for every indoor room except the gym and corridors. */

const H2 = WT / 2;
const PI = Math.PI;

function troffers(ctx: Ctx, k: string, xs: number[], zs: number[], alongX = false, intensity = 12) {
  const c = ROOMS[k].ceil;
  for (const x of xs) for (const z of zs) ctx.lights.addIndoor("troffer", x, c, z, alongX ? PI / 2 : 0, k, { intensity, range: 9, lightY: c - 0.35 });
}

/** Faces of a room's walls (inside surfaces). */
function faces(k: string) {
  const b = roomBounds(k);
  return { ...b, w: b.x0 + H2, e: b.x1 - H2, n: b.z0 + H2, s: b.z1 - H2, cx: (b.x0 + b.x1) / 2, cz: (b.z0 + b.z1) / 2 };
}

// ------------------------------------------------------------ classrooms

const LABELS: Record<string, string> = {
  A: "the English room",
  B: "the history room",
  C: "the maths room",
  D: "the music room",
  E: "the geography room",
  F: "the art room",
};

function classroom(ctx: Ctx, k: string) {
  const r = ctx.rng,
    g = ctx.geo;
  const f = faces(k);
  const label = LABELS[k];
  chalkboard(ctx, `board${k}`, f.w + 0.01, 1.55, f.cz, PI / 2, 4.8);
  clock(ctx, f.w + 0.01, 2.68, f.cz, PI / 2);
  wallFlag(ctx, f.w + 0.01, 2.35, f.n + 1.6, PI / 2);
  for (let i = 0; i < 6; i++) radiator(ctx, f.x0 + 1.5 + i * 3, f.n, 0, 1.5);
  troffers(ctx, k, [f.x0 + 3.5, f.x0 + 9, f.x0 + 14.5], [f.z0 + 3.2, f.z0 + 8.8]);
  // Corridor wall: coat hooks, a calendar and posters.
  for (let i = 0; i < 10; i++) {
    const x = f.x0 + 9.5 + i * 0.32;
    g.box("chrome", x - 0.015, 1.55, f.s - 0.08, x + 0.015, 1.6, f.s, { col: 0x8a8a86 });
  }
  g.box("wood", f.x0 + 9.35, 1.5, f.s - 0.02, f.x0 + 12.75, 1.65, f.s, { col: 0x7a5032 });
  picture(ctx, "calendar", f.x0 + 4.6, 1.6, f.s - 0.011, PI, 0.35);
  poster(ctx, ["posterRead", "posterNo", "posterMissing"][(r() * 3) | 0], f.x0 + 14.5, 1.55, f.s - 0.012, PI, 0.5);
  // PA speaker above the door.
  g.box("paint", f.x0 + 7.25, 2.55, f.s - 0.08, f.x0 + 7.75, 2.85, f.s, { col: 0x8a7a62 });

  if (k === "D") return musicRoom(ctx, f);
  if (k === "F") return artRoom(ctx, f);

  // Teacher's desk at the front and the class in rows facing the board.
  const tx = f.x0 + 2.6,
    tz = f.z0 + 7.2;
  teacherDesk(ctx, tx, tz, -PI / 2);
  chair(ctx, ...loc(tx, tz, -PI / 2, 0.2, 0.75), -PI / 2, 0x3a3a3a);
  const tip = k === "B" ? 0.25 : 0.12;
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 4; j++) {
      if (r() < 0.05) continue;
      const x = f.x0 + 5.4 + i * 2.5 + (r() - 0.5) * 0.3,
        z = f.z0 + 1.9 + j * 2.6 + (r() - 0.5) * 0.3;
      const t = r() < tip ? (r() < 0.5 ? 1 : -1) : 0;
      studentDesk(ctx, x, z, PI / 2 + (r() - 0.5) * (t ? 1.2 : 0.25), t);
      if (!t && r() < 0.3) paperSheet(ctx, ...offsetY(loc(x, z, PI / 2, (r() - 0.5) * 0.3, -0.42), 0.728), r() * 6);
    }
  // Storage along the back wall with a bulletin board above.
  cabinet(ctx, f.e - 0.25, f.cz, -PI / 2, 7.2);
  bulletinBoard(ctx, f.e - 0.012, 1.85, f.cz, -PI / 2, 2.2);
  for (let i = 0; i < 4; i++) {
    const z = f.cz - 3 + i * 1.8 + r() * 0.5;
    g.box("paint", f.e - 0.42, 0.9, z, f.e - 0.18, 0.9 + 0.18 + r() * 0.1, z + 0.25 + r() * 0.2, { col: [0x6b2a24, 0x2b3f63, 0x3d5a3a, 0x8a6a3a][i] });
  }
  if (k === "E") {
    // A globe on the cabinet.
    g.at(f.e - 0.28, 0.9, f.cz + 1.2);
    cyl(g, "wood", 0, 0, 0, 0.1, 0.04, 0x5a3a20);
    g.tube("chrome", 0, 0.04, 0, 0, 0.2, 0, 0.012, 6, { col: 0xb08d3a });
    sphere(g, "gloss", 0, 0.38, 0, 0.17, 0.17, 0.17, 0x3a6a9a);
    g.reset();
    picture(ctx, "worldMap", f.x0 + 2.2, 1.75, f.s - 0.012, PI, 1.6);
  }
  if (k === "C") picture(ctx, "periodic", f.e - 0.012, 2.55, f.cz + 2.6, -PI / 2, 1.0);
  if (k === "B") picture(ctx, "posterHawks", f.e - 0.012, 2.4, f.cz + 2.9, -PI / 2, 0.45);
  trashCan(ctx, f.x0 + 1.0, f.z1 - 1.0, r() < 0.3);

  // Pickups: teacher's desk, a pupil's desk, the cabinet top.
  const [ix, iz] = loc(tx, tz, -PI / 2, -0.45, -0.36);
  if (k === "C") relic(ctx, "register", k, ...offsetY(loc(tx, tz, -PI / 2, 0.35, -0.36), 0.76), "the maths room");
  addItem(ctx, k, ix, 0.76, iz, label);
  const [dx, dz] = loc(f.x0 + 10.4, f.z0 + 7.1, PI / 2, 0, -0.56);
  addItem(ctx, k, dx, 0.73, dz, label);
  addItem(ctx, k, f.e - 0.47, 0.9, f.cz - 2.2, label);
}

const offsetY = (p: [number, number], y: number): [number, number, number] => [p[0], y, p[1]];
function addItem(ctx: Ctx, room: string, x: number, y: number, z: number, label: string) {
  item(ctx, room, x, y, z, label, ctx.rng() * PI * 2);
}

type F = ReturnType<typeof faces>;

function musicRoom(ctx: Ctx, f: F) {
  const g = ctx.geo,
    r = ctx.rng;
  const cx = f.x0 + 3.0,
    cz = f.cz;
  // Conductor's podium and stand.
  g.box("wood", cx - 0.45, 0, cz - 0.45, cx + 0.45, 0.15, cz + 0.45, { col: 0x6a4a2e });
  solid(cx - 0.35, cx + 0.35, cz - 0.35, cz + 0.35);
  musicStand(ctx, cx + 0.7, cz, -PI / 2);
  // Two arcs of chairs and stands facing the podium.
  for (const [rad, n] of [
    [3.2, 7],
    [5.0, 9],
  ] as const)
    for (let i = 0; i < n; i++) {
      const a = -0.95 + (1.9 * i) / (n - 1);
      const x = cx + Math.cos(a) * rad,
        z = cz + Math.sin(a) * rad;
      const yaw = Math.atan2(Math.cos(a), Math.sin(a));
      chair(ctx, x, z, yaw + (r() - 0.5) * 0.3, 0x2b2b2b, r() < 0.12);
      if (i % 2 === 0) musicStand(ctx, cx + Math.cos(a) * (rad - 0.75), cz + Math.sin(a) * (rad - 0.75), yaw + PI);
    }
  // Upright piano against the east wall.
  const px = f.e - 0.32,
    pz = f.z0 + 4.4;
  g.at(px, 0, pz, -PI / 2);
  g.box("gloss", -0.75, 0.05, -0.3, 0.75, 1.25, 0.05, { col: 0x1d1410 });
  g.box("gloss", -0.75, 0.62, 0.05, 0.75, 0.78, 0.3, { col: 0x1d1410 });
  g.box("gloss", -0.78, 1.25, -0.32, 0.78, 1.28, 0.32, { col: 0x24180f });
  g.box("gloss", -0.75, 0.05, 0.05, -0.7, 0.62, 0.3, { col: 0x1d1410 });
  g.box("gloss", 0.7, 0.05, 0.05, 0.75, 0.62, 0.3, { col: 0x1d1410 });
  g.quad("atlas", [-0.68, 0.781, 0.28, 0.68, 0.781, 0.28, 0.68, 0.781, 0.07, -0.68, 0.781, 0.07], [ctx.atlas.uv("pianoKeys").u0, ctx.atlas.uv("pianoKeys").v0, ctx.atlas.uv("pianoKeys").u1, ctx.atlas.uv("pianoKeys").v0, ctx.atlas.uv("pianoKeys").u1, ctx.atlas.uv("pianoKeys").v1, ctx.atlas.uv("pianoKeys").u0, ctx.atlas.uv("pianoKeys").v1]);
  g.box("chrome", -0.4, 0.08, 0.04, -0.34, 0.1, 0.12, { col: 0xb08d3a });
  g.box("chrome", 0.34, 0.08, 0.04, 0.4, 0.1, 0.12, { col: 0xb08d3a });
  g.box("paint", -0.3, 0.96, 0.06, 0.3, 1.18, 0.07, { col: 0xe8e2d0 });
  g.reset();
  solidAt(px, pz, 1.56, 0.64, -PI / 2, 0.14);
  blob(ctx, px, pz, 2.0, 1.0, -PI / 2, 0.55);
  relic(ctx, "crown", "D", ...offsetY(loc(px, pz, -PI / 2, 0.35, 0.24), 1.28), "the music room");
  // Piano bench.
  const [bx, bz] = loc(px, pz, -PI / 2, 0, 0.8);
  table(ctx, bx, bz, 0.9, 0.38, 0.5, -PI / 2, { top: "gloss", topCol: 0x1d1410, leg: "gloss", legCol: 0x1d1410, thick: 0.06, inset: 0.1 });
  addItem(ctx, "D", ...offsetY(loc(bx, bz, -PI / 2, 0.3, 0.17), 0.5), "the music room");
  // Drum kit in the corner.
  const kx = f.e - 2.6,
    kz = f.n + 2.0;
  g.at(kx, 0, kz, 0.4);
  g.tube("gloss", -0.25, 0.3, 0, 0.25, 0.3, 0, 0.28, 16, { col: 0x7a1414, capped: true });
  cyl(g, "chrome", 0.6, 0.55, -0.35, 0.18, 0.12, 0xb0b0b0);
  cyl(g, "gloss", 0.45, 0.65, 0.2, 0.15, 0.14, 0x7a1414);
  for (const [sx, sz, h] of [
    [0.9, -0.5, 1.1],
    [-0.6, -0.6, 1.25],
  ]) {
    g.tube("chrome", sx, 0, sz, sx, h, sz, 0.012, 5, { col: 0x9a9a9a });
    cyl(g, "chrome", sx, h, sz, 0.22, 0.008, 0xc9a24a);
  }
  g.reset();
  solidAt(kx, kz, 1.8, 1.3, 0.4, 0.2);
  stool(ctx, kx + 0.1, kz + 0.75, 0.5);
  // Instrument cases along the corridor wall.
  for (let i = 0; i < 4; i++) {
    g.at(f.x0 + 13 + i * 0.9, 0, f.s - 0.3, 0.1 * (r() - 0.5));
    g.box("gloss", -0.35, 0, -0.15, 0.35, 0.2 + r() * 0.15, 0.15, { col: 0x151515 });
    g.reset();
  }
  solid(f.x0 + 12.6, f.x0 + 16.3, f.s - 0.45, f.s);
  addItem(ctx, "D", f.x0 + 14.3, 0.0, f.s - 0.62, "the music room");
  poster(ctx, "posterProm", f.e - 0.012, 1.6, f.cz + 2.5, -PI / 2, 0.5);
  addItem(ctx, "D", cx + 0.25, 0.15, cz - 0.42, "the music room");
}

function musicStand(ctx: Ctx, x: number, z: number, yaw: number) {
  const g = ctx.geo;
  g.at(x, 0, z, yaw);
  g.tube("metal", 0, 0, 0, 0, 1.05, 0, 0.01, 5, { col: 0x222222 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2;
    g.tube("metal", 0, 0.3, 0, Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25, 0.008, 4, { col: 0x222222 });
  }
  g.sub(0, 1.1, 0, 0, -0.35);
  g.box("metal", -0.25, -0.17, -0.01, 0.25, 0.17, 0.0, { col: 0x222222 });
  g.sub(-0.08, 0.01, 0.003);
  g.rect("atlas", 0.2, 0.26, ctx.atlas.uv("paper"));
  g.reset();
}

function artRoom(ctx: Ctx, f: F) {
  const g = ctx.geo,
    r = ctx.rng;
  const spots: [number, number][] = [
    [f.x0 + 5.5, f.z0 + 3.9],
    [f.x0 + 5.5, f.z0 + 8.3],
    [f.x0 + 10.2, f.z0 + 3.9],
    [f.x0 + 10.2, f.z0 + 8.3],
  ];
  for (const [x, z] of spots) {
    table(ctx, x, z, 2.4, 1.2, 0.82, (r() - 0.5) * 0.1, { top: "wood", topCol: 0xc8b090, leg: "wood", legCol: 0x8a6a4a, thick: 0.05, legW: 0.08 });
    for (const sx of [-0.8, 0, 0.8]) for (const sz of [-0.85, 0.85]) if (r() < 0.8) stool(ctx, x + sx + (r() - 0.5) * 0.2, z + sz + (r() - 0.5) * 0.15);
    // Paint pots, brushes in a jar, paper.
    for (let i = 0; i < 3; i++) cyl(g, "gloss", x - 0.8 + r() * 1.6, 0.82, z - 0.3 + r() * 0.6, 0.05, 0.08, [0xc0302a, 0x2a5ac0, 0xe0c030, 0x30a050][(r() * 4) | 0], true);
    paperSheet(ctx, x + (r() - 0.5), 0.822, z + (r() - 0.5) * 0.4, r() * 6);
  }
  const [kx, kz] = spots[3];
  relic(ctx, "keys", "F", kx + 0.6, 0.82, kz + 0.55, "the art room");
  addItem(ctx, "F", spots[0][0] - 0.7, 0.82, spots[0][1] - 0.55, "the art room");
  // Easels with paintings.
  for (let i = 0; i < 3; i++) {
    const x = f.x0 + 14.2 + (i % 2) * 1.4,
      z = f.z0 + 3.2 + i * 2.6;
    const yaw = -PI / 2 + (r() - 0.5) * 0.5;
    g.at(x, 0, z, yaw);
    g.tube("wood", -0.35, 0, 0.15, -0.05, 1.7, 0, 0.018, 5, { col: 0x9a7a52 });
    g.tube("wood", 0.35, 0, 0.15, 0.05, 1.7, 0, 0.018, 5, { col: 0x9a7a52 });
    g.tube("wood", 0, 0, -0.45, 0, 1.6, 0, 0.018, 5, { col: 0x9a7a52 });
    g.box("wood", -0.4, 0.78, 0.1, 0.4, 0.82, 0.18, { col: 0x9a7a52 });
    g.box("paint", -0.33, 0.82, 0.08, 0.33, 1.5, 0.1, { col: 0xe8e2d4 });
    g.sub(0, 1.16, 0.101, 0, -0.06);
    g.rect("atlas", 0.62, 0.62, ctx.atlas.uv(`painting${i}`));
    g.reset();
    solidAt(x, z, 0.8, 0.6, yaw, 0.1);
  }
  // Sink counter, drying rack, kiln.
  cabinet(ctx, f.e - 0.3, f.z0 + 9.5, -PI / 2, 3.0, 0.9, 0.6, 0x9a8a72, 0x5a6a6a);
  g.box("paint", f.e - 0.5, 0.86, f.z0 + 9.0, f.e - 0.14, 0.91, f.z0 + 9.8, { col: 0x2a2a2a });
  g.tube("chrome", f.e - 0.12, 0.9, f.z0 + 9.4, f.e - 0.12, 1.2, f.z0 + 9.4, 0.015, 6, { col: 0xb0b0b0 });
  g.tube("chrome", f.e - 0.12, 1.2, f.z0 + 9.4, f.e - 0.3, 1.15, f.z0 + 9.4, 0.012, 6, { col: 0xb0b0b0 });
  addItem(ctx, "F", f.e - 0.55, 0.9, f.z0 + 10.4, "the art room");
  const kx2 = f.e - 0.6,
    kz2 = f.n + 0.8;
  g.box("metal", kx2 - 0.45, 0, kz2 - 0.45, kx2 + 0.45, 1.0, kz2 + 0.45, { col: 0x8a8a84 });
  g.box("metal", kx2 - 0.42, 1.0, kz2 - 0.42, kx2 + 0.42, 1.06, kz2 + 0.42, { col: 0x6a6a64 });
  g.box("paint", kx2 - 0.46, 0.55, kz2 - 0.1, kx2 - 0.45, 0.75, kz2 + 0.1, { col: 0x111111 });
  solidAt(kx2, kz2, 0.9, 0.9, 0, 0.05);
  // Paint spilt across the floor.
  for (let i = 0; i < 10; i++) {
    const c = [0xb0201a, 0x1a4ab0, 0xd0b020, 0x20a050, 0xe8e8e0][(r() * 5) | 0];
    ctx.geo.at(f.x0 + 4 + r() * 9, 0.007, f.z0 + 2 + r() * 8, 0, -PI / 2, r() * 6).rect("decal", 0.4 + r() * 0.7, 0.4 + r() * 0.7, undefined, { col: c, a: 0.85 });
    ctx.geo.reset();
  }
}

// ------------------------------------------------------------- library

function library(ctx: Ctx) {
  const g = ctx.geo,
    r = ctx.rng;
  const f = faces("L");
  // Wall shelving on the west and north walls.
  for (let z = 19.0; z <= 35.0; z += 1.0) bookcase(ctx, f.w + 0.185, z, PI / 2, 0.98, 2.2, 0.35, { shelves: 6 });
  for (let x = 40.1; x <= 47.2; x += 1.0) bookcase(ctx, x, f.n + 0.185, 0, 0.98, 2.2, 0.35, { shelves: 6 });
  for (let z = 19.0; z <= 31.0; z += 1.0) bookcase(ctx, f.e - 0.185, z, -PI / 2, 0.98, 2.2, 0.35, { shelves: 6 });
  // Free-standing double-sided stacks with a gap through the middle.
  for (const x of [41.9, 44.7])
    for (let z = 21.0; z <= 33.0; z += 1.0) {
      if (z === 27) continue;
      bookcase(ctx, x, z, PI / 2, 0.98, 1.85, 0.6, { shelves: 5, double: true, fill: 0.85 });
    }
  // Reading tables with chairs.
  for (const z of [21.5, 25.5, 29.5]) {
    table(ctx, 58.5, z, 2.4, 1.1, 0.76, 0, { top: "wood", topCol: 0xb08a5c, leg: "wood", legCol: 0x7a5a3a, thick: 0.045, legW: 0.07 });
    for (const sx of [-0.8, 0, 0.8]) {
      chair(ctx, 58.5 + sx, z + 0.85 + (r() - 0.5) * 0.2, (r() - 0.5) * 0.3, 0x6a4a2e, r() < 0.1);
      chair(ctx, 58.5 + sx, z - 0.85 + (r() - 0.5) * 0.2, PI + (r() - 0.5) * 0.3, 0x6a4a2e, r() < 0.1);
    }
    for (let i = 0; i < 2; i++) g.box("paint", 57.6 + r() * 1.6, 0.76, z - 0.3 + r() * 0.4, 57.6 + r() * 1.6 + 0.25, 0.81, z - 0.1 + r() * 0.4, { col: 0x5a2a24 });
  }
  addItem(ctx, "L", 57.4, 0.76, 21.5 - 0.5, "the library");
  addItem(ctx, "L", 59.6, 0.76, 29.5 + 0.5, "the library");
  addItem(ctx, "L", f.w + 0.34, 0.09 + 3 * ((2.2 - 0.12) / 6), 24.0, "the library");
  // Circulation desk and card catalogue near the south door.
  g.box("wood", 55.5, 0, 33.4, 59.5, 1.05, 34.3, { col: 0x5a3a22 });
  g.box("wood", 55.4, 1.05, 33.35, 59.6, 1.09, 34.35, { col: 0x7a5232 });
  g.box("wood", 59.5, 0, 31.6, 60.4, 1.05, 34.3, { col: 0x5a3a22 });
  solid(55.62, 60.28, 33.52, 34.18);
  solid(59.62, 60.28, 31.72, 33.6);
  blob(ctx, 57.8, 33.9, 5.2, 1.4, 0, 0.5);
  relic(ctx, "register", "L", 56.6, 1.09, 34.27, "the library");
  g.box("paint", 57.8, 1.09, 33.6, 58.2, 1.2, 33.9, { col: 0x3a3a3a });
  chair(ctx, 57.5, 32.8, PI, 0x3a3a3a);
  g.box("wood", f.e - 0.5, 0, 33.0, f.e, 1.3, 34.4, { col: 0x6b4a2c });
  g.quad("atlas", [f.e - 0.501, 0.05, 34.4, f.e - 0.501, 0.05, 33.0, f.e - 0.501, 1.25, 33.0, f.e - 0.501, 1.25, 34.4], uvq(ctx, "drawers"));
  solid(f.e - 0.45, f.e, 33.1, 34.3);
  // Globe, posters, lights.
  g.at(55.2, 0, 20.4);
  g.tube("wood", 0, 0, 0, 0, 0.8, 0, 0.03, 6, { col: 0x5a3a20 });
  sphere(g, "gloss", 0, 1.05, 0, 0.26, 0.26, 0.26, 0x3a6a9a);
  g.reset();
  solidAt(55.2, 20.4, 0.5, 0.5, 0, 0.05);
  poster(ctx, "posterRead", 52.4, 1.6, f.n + 0.012, 0, 0.55);
  troffers(ctx, "L", [43, 51, 59], [21.5, 27, 32.5], false, 13);
}

const uvq = (ctx: Ctx, name: string) => {
  const u = ctx.atlas.uv(name);
  return [u.u0, u.v0, u.u1, u.v0, u.u1, u.v1, u.u0, u.v1];
};

// ------------------------------------------------------------- office

function office(ctx: Ctx) {
  const g = ctx.geo,
    r = ctx.rng;
  const f = faces("P");
  // Reception.
  teacherDesk(ctx, 69.8, 21.2, PI, 0x6a6458);
  g.box("metal", 69.3, 0.76, 21.0, 69.75, 0.9, 21.4, { col: 0x3a3a38 });
  g.box("paint", 69.35, 0.9, 21.05, 69.7, 0.93, 21.2, { col: 0xe8e2d0 });
  chair(ctx, 69.8, 20.4, PI, 0x3a3a3a);
  addItem(ctx, "P", ...offsetY(loc(69.8, 21.2, PI, -0.5, -0.36), 0.76), "the principal's office");
  for (let i = 0; i < 3; i++) chair(ctx, 67.4 + i * 0.75, f.s - 0.35, 0, 0x5a2a24);
  g.at(66.55, 0, 33.6);
  g.box("gloss", -0.18, 0, -0.18, 0.18, 1.0, 0.18, { col: 0xd8d4c8 });
  g.tube("glass", 0, 1.0, 0, 0, 1.45, 0, 0.16, 12, { col: 0x9ab8d0, a: 0.4, capped: true });
  g.reset();
  solid(66.35, 66.75, 33.4, 33.8);
  picture(ctx, "calendar", f.w + 0.011, 1.6, 21.6, PI / 2, 0.35);
  // The principal's desk, portrait and flags.
  const px = 77.2,
    pz = 27;
  g.at(px, 0, pz, PI / 2);
  g.box("wood", -1.0, 0.73, -0.5, 1.0, 0.78, 0.5, { col: 0x5a3420 });
  g.box("wood", -0.98, 0.05, -0.47, -0.45, 0.73, 0.45, { col: 0x4a2a18 });
  g.box("wood", 0.45, 0.05, -0.47, 0.98, 0.73, 0.45, { col: 0x4a2a18 });
  g.box("wood", -0.45, 0.3, -0.47, 0.45, 0.73, -0.43, { col: 0x4a2a18 });
  for (const sx of [-0.71, 0.71]) for (let i = 0; i < 3; i++) g.box("chrome", sx - 0.05, 0.2 + i * 0.2, 0.45, sx + 0.05, 0.22 + i * 0.2, 0.47, { col: 0xb08d3a });
  g.box("paint", -0.35, 0.78, -0.25, 0.35, 0.785, 0.2, { col: 0x2a3a2a });
  g.box("gloss", 0.6, 0.78, -0.1, 0.8, 0.95, 0.1, { col: 0x1a1a1a });
  g.box("chrome", -0.85, 0.78, -0.35, -0.6, 0.8, -0.25, { col: 0xb08d3a });
  g.reset();
  solidAt(px, pz, 2.0, 1.0, PI / 2, 0.15);
  blob(ctx, px, pz, 2.6, 1.5, PI / 2, 0.55);
  relic(ctx, "register", "P", ...offsetY(loc(px, pz, PI / 2, 0.2, -0.42), 0.785), "the principal's office");
  // High-backed leather chair.
  g.at(78.25, 0, pz, -PI / 2);
  g.box("cloth", -0.3, 0.42, -0.28, 0.3, 0.55, 0.28, { col: 0x3a1a12 });
  g.box("cloth", -0.3, 0.55, 0.22, 0.3, 1.25, 0.34, { col: 0x3a1a12 });
  g.tube("chrome", 0, 0, 0, 0, 0.42, 0, 0.03, 6, { col: 0x555555 });
  g.reset();
  solidAt(78.25, pz, 0.6, 0.6, 0, 0.1);
  chair(ctx, 75.6, 26.3, -PI / 2, 0x5a2a24);
  chair(ctx, 75.6, 27.7, -PI / 2 + 0.3, 0x5a2a24, r() < 0.5);
  framed(ctx, "portrait", f.e - 0.012, 1.85, pz, -PI / 2, 0.8, 0x8a6a2a);
  for (const [z, which] of [
    [24.6, 0],
    [29.4, 1],
  ] as const) {
    g.at(f.e - 0.5, 0, z);
    cyl(g, "chrome", 0, 0, 0, 0.16, 0.05, 0xb08d3a);
    g.tube("wood", 0, 0, 0, 0, 2.2, 0, 0.02, 6, { col: 0x6a4a2a });
    sphere(g, "chrome", 0, 2.24, 0, 0.04, 0.05, 0.04, 0xc9a24a);
    const fname = which ? "bannerHawks" : "flagUS";
    const fh = 0.9 / ctx.atlas.aspect(fname);
    g.sub(0, 2.12 - fh / 2, 0.0, PI / 2 + (which ? 0.35 : -0.35));
    g.sub(0.47, 0, 0, 0, 0, which ? 0.04 : -0.04);
    g.rect("atlas", 0.9, fh, ctx.atlas.uv(fname));
    g.sub(0, 0, -0.003, PI);
    g.rect("atlas", 0.9, fh, ctx.atlas.uv(fname));
    g.reset();
    solidAt(f.e - 0.5, z, 0.35, 0.35, 0, 0.05);
  }
  // Filing cabinets, bookcase, a paddle on the wall, a dead plant.
  for (let i = 0; i < 4; i++) filingCabinet(ctx, 72.6 + i * 0.5, f.n + 0.34, 0, i === 2 ? 1 : -1);
  addItem(ctx, "P", 74.1, 1.32, f.n + 0.66, "the principal's office");
  bookcase(ctx, 77.2, f.s - 0.2, PI, 2.0, 2.0, 0.4, { shelves: 5, col: 0x4a2a18 });
  addItem(ctx, "P", 77.6, 0.09 + 2 * ((2.0 - 0.12) / 5), f.s - 0.42, "the principal's office");
  g.at(79.2, 1.6, f.n + 0.02);
  g.box("wood", -0.06, -0.35, 0, 0.06, 0.05, 0.02, { col: 0x8a5a32 });
  g.box("wood", -0.12, 0.05, 0, 0.12, 0.4, 0.02, { col: 0x8a5a32 });
  g.reset();
  g.at(f.e - 0.4, 0, f.n + 0.4);
  cyl(g, "paint", 0, 0, 0, 0.22, 0.35, 0x7a4a2a);
  for (let i = 0; i < 6; i++) g.tube("wood", 0, 0.33, 0, (r() - 0.5) * 0.7, 0.9 + r() * 0.6, (r() - 0.5) * 0.7, 0.01, 4, { col: 0x4a3a28 });
  g.reset();
  solidAt(f.e - 0.4, f.n + 0.4, 0.44, 0.44, 0, 0.02);
  troffers(ctx, "P", [69, 74, 79], [22.5, 31.5]);
}

// ---------------------------------------------------------- boiler room

/** Grating floor around the boiler (metal footsteps). */
export const GRATING = { x0: 83.4, x1: 93.8, z0: 20.2, z1: 27.6 };

function boilerRoom(ctx: Ctx) {
  const g = ctx.geo,
    r = ctx.rng;
  const f = faces("W");
  g.flat("grating", GRATING.x0, GRATING.z0, GRATING.x1, GRATING.z1, 0.012, null, { uv: 1 });
  g.box("metal", GRATING.x0, 0, GRATING.z0, GRATING.x1, 0.012, GRATING.z1, { col: 0x3a3a3a, skip: 4 | 8 });
  // The boiler: a riveted horizontal drum on a plinth, burner at the west end.
  const by = 1.5,
    bz = 23.6;
  g.box("concrete", 85.6, 0, 22.2, 91.4, 0.3, 25.0, { col: 0x8a8680 });
  g.tube("metal", 86.0, by, bz, 91.0, by, bz, 1.05, 22, { col: 0x5e4436, capped: true });
  for (const x of [86.6, 88.0, 89.4, 90.6]) g.tube("metal", x - 0.04, by, bz, x + 0.04, by, bz, 1.08, 22, { col: 0x4a3428, capped: true });
  for (const x of [86.5, 90.5]) g.box("metal", x - 0.2, 0.3, bz - 0.8, x + 0.2, 0.75, bz + 0.8, { col: 0x3a3a38 });
  g.box("metal", 85.05, 0.3, bz - 0.85, 85.95, 2.4, bz + 0.85, { col: 0x2e2e2c });
  g.tube("metal", 84.6, 1.2, bz, 85.05, 1.2, bz, 0.25, 14, { col: 0x3a3a38, capped: true });
  g.tube("metal", 90.4, by + 1.0, bz, 90.4, 3.6, bz, 0.32, 14, { col: 0x4a4a48 });
  for (const [y, z] of [
    [2.0, bz - 0.35],
    [2.0, bz + 0.35],
    [1.55, bz],
  ])
    picture(ctx, "gauge", 85.04, y, z, -PI / 2, 0.22);
  solid(84.5, 91.4, 22.2, 25.0, true);
  blob(ctx, 88.3, bz, 8, 4, 0, 0.7);
  // Water heater.
  g.tube("metal", 94.3, 0.0, 20.5, 94.3, 2.0, 20.5, 0.5, 16, { col: 0x8a8676, capped: true });
  g.tube("metal", 94.3, 2.0, 20.5, 94.3, 3.6, 20.5, 0.06, 8, { col: 0x6a5a4a });
  solidAt(94.3, 20.5, 1.0, 1.0, 0, 0.1);
  // Pipework along the ceiling and walls with red valve wheels.
  const pipe = (ax: number, ay: number, az: number, bx: number, b2: number, bz2: number, rad: number, col: number) => g.tube("metal", ax, ay, az, bx, b2, bz2, rad, 10, { col });
  pipe(f.w, 3.25, 18.6, f.e, 3.25, 18.6, 0.1, 0xd8d2c0);
  pipe(f.w, 3.38, 19.05, f.e, 3.38, 19.05, 0.06, 0x6a5040);
  pipe(f.e - 0.25, 2.95, f.n, f.e - 0.25, 2.95, f.s, 0.08, 0x6a5040);
  pipe(f.e - 0.45, 3.25, f.n, f.e - 0.45, 3.25, f.s, 0.1, 0xd8d2c0);
  for (const x of [83.0, 94.6]) {
    pipe(x, 3.38, 19.05, x, 1.5, 19.05, 0.06, 0x6a5040);
    g.at(x, 1.7, 19.25);
    g.geom("metal", WHEEL, { col: 0xa01a1a });
    g.reset();
    g.tube("metal", x, 1.7, 19.05, x, 1.7, 19.25, 0.015, 6, { col: 0x6a5040 });
  }
  // Workbench with a pegboard.
  table(ctx, f.w + 0.4, 30, 3.0, 0.8, 0.9, PI / 2, { top: "wood", topCol: 0x6a4a2e, leg: "metal", legCol: 0x3a3a3a, thick: 0.06 });
  g.box("paint", f.w, 1.1, 28.6, f.w + 0.02, 2.0, 31.4, { col: 0x8a6a42 });
  for (let i = 0; i < 9; i++) g.box("metal", f.w + 0.02, 1.25 + (i % 3) * 0.25, 28.9 + Math.floor(i / 3) * 0.8, f.w + 0.05, 1.42 + (i % 3) * 0.25, 28.95 + Math.floor(i / 3) * 0.8 + 0.1 + r() * 0.2, { col: 0x2a2a2a });
  g.box("gloss", f.w + 0.15, 0.9, 31.0, f.w + 0.55, 1.1, 31.45, { col: 0xa01a1a });
  relic(ctx, "keys", "W", f.w + 0.73, 0.9, 29.3, "the boiler room");
  // Janitor's cart, mop bucket and drums.
  const jx = 86.6,
    jz = 32.6;
  g.at(jx, 0, jz, 0.3);
  g.box("gloss", -0.55, 0.12, -0.25, 0.55, 0.16, 0.25, { col: 0x5a5e62 });
  g.box("gloss", -0.55, 0.85, -0.25, 0.55, 0.89, 0.25, { col: 0x5a5e62 });
  for (const sx of [-0.53, 0.53]) for (const sz of [-0.23, 0.23]) g.tube("chrome", sx, 0.08, sz, sx, 0.89, sz, 0.015, 5, { col: 0x8a8a8a });
  g.tube("gloss", 0.75, 0.05, 0, 0.75, 0.42, 0, 0.22, 14, { col: 0xd8b020, capped: true });
  g.tube("wood", 0.75, 0.3, 0.05, 0.6, 1.45, 0.2, 0.014, 5, { col: 0x9a7a52 });
  sphere(g, "paint", -0.25, 0.42, 0, 0.26, 0.26, 0.22, 0x111111);
  for (let i = 0; i < 3; i++) cyl(g, "gloss", 0.1 + i * 0.12, 0.89, 0, 0.04, 0.22, [0x2a7ab0, 0xe8e8e0, 0x30a050][i], true);
  g.reset();
  solidAt(jx + 0.1, jz, 1.6, 0.6, 0.3, 0.12);
  blob(ctx, jx, jz, 2.0, 1.0, 0.3, 0.5);
  addItem(ctx, "W", jx - 0.3, 0, jz + 0.78, "the boiler room");
  for (const [x, z, c, t] of [
    [93.6, 34.9, 0x2a4a6a, 0],
    [94.4, 34.3, 0x7a2a1a, 0],
    [92.6, 34.6, 0x2a4a6a, 1],
  ] as const) {
    if (t) {
      g.tube("metal", x - 0.45, 0.29, z, x + 0.45, 0.29, z, 0.29, 14, { col: c, capped: true });
      solid(x - 0.4, x + 0.4, z - 0.2, z + 0.2);
    } else {
      g.tube("metal", x, 0, z, x, 0.88, z, 0.29, 14, { col: c, capped: true });
      solidAt(x, z, 0.58, 0.58, 0, 0.04);
    }
  }
  addItem(ctx, "W", 93.6, 0.88, 34.63, "the boiler room");
  utilityShelf(ctx, f.e - 0.25, 30.0, -PI / 2, 2.4);
  addItem(ctx, "W", f.e - 0.47, 0.12 + (1.9 - 0.15) / 3, 29.4, "the boiler room");
  g.box("metal", f.w, 1.0, 22.0, f.w + 0.18, 2.0, 22.8, { col: 0x6a6e62 });
  g.box("paint", f.w + 0.18, 1.7, 22.1, f.w + 0.181, 1.9, 22.7, { col: 0xd8c820 });
  for (const [x, z] of [
    [84.5, 22],
    [93, 22],
    [84.5, 31],
    [93, 31],
  ])
    ctx.lights.addIndoor("bulb", x, 3.35, z, 0, "W", { intensity: 6, range: 7, color: 0xffe2b0 });
}
const WHEEL = new THREE.TorusGeometry(0.13, 0.018, 6, 16);

// ------------------------------------------------------------------- lab

function lab(ctx: Ctx) {
  const g = ctx.geo,
    r = ctx.rng;
  const f = faces("S");
  chalkboard(ctx, "boardS", 105, 1.55, f.n + 0.01, 0, 4.4);
  clock(ctx, 105, 2.65, f.n + 0.01, 0);
  labBench(ctx, 105, 20.4, 3.2, 0.85, 0, 1);
  const benches: [number, number][] = [];
  for (const x of [102.9, 107.9])
    for (const z of [24.6, 28.6, 32.6]) {
      labBench(ctx, x, z, 3.0, 0.95, 0, 2);
      benches.push([x, z]);
      for (const sx of [-0.8, 0.8]) for (const sz of [-0.8, 0.8]) if (r() < 0.85) stool(ctx, x + sx + (r() - 0.5) * 0.2, z + sz + (r() - 0.5) * 0.2, 0.68);
    }
  for (const [i, [x, z]] of benches.entries()) if (i % 2 === 0) addItem(ctx, "S", x - 1.1, 0.93, z + 0.44, "the science lab");
  // Fume hood.
  g.box("gloss", f.e - 0.8, 0, 21.4, f.e, 2.3, 23.6, { col: 0xd8d8d0, skip: 2 });
  g.box("paint", f.e - 0.75, 0.9, 21.5, f.e - 0.05, 2.0, 23.5, { col: 0x111111 });
  g.box("glass", f.e - 0.8, 1.2, 21.5, f.e - 0.78, 2.0, 23.5, { col: 0xb8c8d0, a: 0.3 });
  g.box("gloss", f.e - 0.8, 0, 21.4, f.e - 0.75, 0.9, 23.6, { col: 0xd8d8d0 });
  g.box("gloss", f.e - 0.8, 2.0, 21.4, f.e - 0.75, 2.3, 23.6, { col: 0xd8d8d0 });
  solid(f.e - 0.75, f.e, 21.5, 23.5);
  // Shelves of jars along the corridor wall.
  utilityShelf(ctx, 103.5, f.s - 0.25, PI, 2.4);
  for (let i = 0; i < 8; i++) {
    const x = 102.6 + i * 0.25,
      y = 0.12 + (1.9 - 0.15) / 3 + (i % 2) * ((1.9 - 0.15) / 3);
    g.tube("glass", x, y, f.s - 0.3, x, y + 0.2, f.s - 0.3, 0.06, 10, { col: 0xb8d0d8, a: 0.35, capped: true });
    cyl(g, "gloss", x, y + 0.01, f.s - 0.3, 0.05, 0.08 + r() * 0.08, [0x6a9a3a, 0xb0402a, 0x3a6ab0, 0xd8c040][i % 4], true);
  }
  // Classroom skeleton in the corner.
  skeleton(ctx, f.e - 0.6, f.s - 0.6, -PI * 0.75);
  picture(ctx, "periodic", f.w + 0.012, 1.7, 31.5, PI / 2, 1.8);
  poster(ctx, "posterGoggles", f.w + 0.012, 1.55, 22.4, PI / 2, 0.5);
  troffers(ctx, "S", [102.5, 107.5], [22.5, 27.5, 32.5]);
}

function labBench(ctx: Ctx, x: number, z: number, w: number, d: number, yaw: number, sinks: number) {
  const g = ctx.geo;
  g.at(x, 0, z, yaw);
  g.box("wood", -w / 2 + 0.05, 0.08, -d / 2 + 0.05, w / 2 - 0.05, 0.88, d / 2 - 0.05, { col: 0x8a6a4a });
  g.box("paint", -w / 2 + 0.07, 0, -d / 2 + 0.07, w / 2 - 0.07, 0.08, d / 2 - 0.07, { col: 0x111111 });
  g.box("gloss", -w / 2, 0.88, -d / 2, w / 2, 0.93, d / 2, { col: 0x141414 });
  for (let i = 0; i < sinks; i++) {
    const sx = sinks === 1 ? w / 2 - 0.45 : (i === 0 ? -1 : 1) * w * 0.25;
    g.box("paint", sx - 0.2, 0.931, -0.15, sx + 0.2, 0.932, 0.15, { col: 0x050505 });
    g.tube("chrome", sx, 0.93, 0, sx, 1.25, 0, 0.012, 6, { col: 0xb0b0b0 });
    g.tube("chrome", sx, 1.25, 0, sx, 1.22, 0.14, 0.012, 6, { col: 0xb0b0b0 });
    g.box("chrome", sx - 0.05, 1.0, -0.01, sx + 0.05, 1.03, 0.01, { col: 0xb0b0b0 });
    for (const gx of [-0.35, 0.35]) g.tube("chrome", sx + gx, 0.93, 0, sx + gx, 1.02, 0, 0.012, 6, { col: 0xb08d3a });
  }
  g.reset();
  solidAt(x, z, w, d, yaw, 0.12);
  blob(ctx, x, z, w + 0.4, d + 0.5, yaw, 0.5);
}

function skeleton(ctx: Ctx, x: number, z: number, yaw: number) {
  const g = ctx.geo;
  const b = 0xe2d9c0;
  g.at(x, 0, z, yaw);
  cyl(g, "metal", 0, 0, 0, 0.22, 0.04, 0x2a2a2a);
  g.tube("chrome", 0, 0.04, 0, 0, 1.0, -0.05, 0.012, 5, { col: 0x8a8a8a });
  g.tube("paint", 0, 0.95, 0, 0, 1.5, 0, 0.022, 6, { col: b });
  sphere(g, "gloss", 0, 1.7, 0.01, 0.1, 0.12, 0.11, b);
  g.box("paint", -0.04, 1.6, 0.06, 0.04, 1.62, 0.1, { col: 0x111111 });
  for (let i = 0; i < 6; i++) {
    g.save();
    g.sub(0, 1.22 + i * 0.05, 0.02);
    g.scale(1 - i * 0.03, 1, 0.7);
    g.geom("paint", RIB, { col: b });
    g.restore();
  }
  sphere(g, "paint", 0, 0.95, 0, 0.14, 0.07, 0.09, b);
  for (const sx of [-1, 1]) {
    g.tube("paint", sx * 0.16, 1.45, 0, sx * 0.22, 1.12, 0.05, 0.016, 5, { col: b });
    g.tube("paint", sx * 0.22, 1.12, 0.05, sx * 0.24, 0.85, 0.12, 0.013, 5, { col: b });
    g.tube("paint", sx * 0.08, 0.92, 0, sx * 0.1, 0.5, 0.02, 0.02, 5, { col: b });
    g.tube("paint", sx * 0.1, 0.5, 0.02, sx * 0.1, 0.08, 0, 0.016, 5, { col: b });
  }
  g.reset();
  solidAt(x, z, 0.45, 0.45, 0, 0.02);
}
const RIB = new THREE.TorusGeometry(0.12, 0.012, 4, 14).rotateX(PI / 2);

// ------------------------------------------------------------- cafeteria

function cafeteria(ctx: Ctx) {
  const g = ctx.geo,
    r = ctx.rng;
  const f = faces("X");
  const tops: [number, number, number][] = [];
  for (const x of [68.5, 74.2, 79.9, 85.6])
    for (const z of [44.6, 48.4]) {
      const n = tops.length;
      const yaw = n % 3 === 0 ? 0 : r() < 0.25 ? (r() - 0.5) * 0.6 : (r() - 0.5) * 0.06;
      cafTable(ctx, x, z, yaw);
      tops.push([x, z, yaw]);
    }
  for (const i of [0, 3, 6]) {
    const [x, z, yaw] = tops[i];
    addItem(ctx, "X", ...offsetY(loc(x, z, yaw, 1.2, -0.33), 0.75), "the cafeteria");
  }
  // Serving counter with sneeze guard and tray rail.
  g.box("chrome", 93.0, 0, 46.2, 94.0, 0.9, 50.6, { col: 0xa8aaa6 });
  g.box("gloss", 92.95, 0.9, 46.15, 94.05, 0.94, 50.65, { col: 0x8a8c88 });
  for (let i = 0; i < 3; i++) g.box("paint", 93.15, 0.86, 46.5 + i * 1.4, 93.85, 0.941, 47.6 + i * 1.4, { col: 0x1a1a1a });
  g.quad("glass", [93.05, 1.3, 46.2, 93.05, 1.3, 50.6, 93.35, 1.55, 50.6, 93.35, 1.55, 46.2], null, { col: 0xb8c8d0, a: 0.25 });
  for (const zz of [46.25, 48.4, 50.55]) g.tube("chrome", 93.5, 0.94, zz, 93.2, 1.4, zz, 0.012, 5, { col: 0xa0a0a0 });
  for (const y of [0.8, 0.88]) g.tube("chrome", 92.7, y, 46.2, 92.7, y, 50.6, 0.018, 6, { col: 0xa8a8a8 });
  for (const zz of [46.4, 48.4, 50.4]) g.tube("chrome", 92.7, 0.88, zz, 93.0, 0.88, zz, 0.012, 5, { col: 0xa8a8a8 });
  for (let i = 0; i < 9; i++) g.box("gloss", 93.2, 0.94 + i * 0.022, 46.3, 93.75, 0.955 + i * 0.022, 46.7, { col: 0xb5652a });
  solid(92.75, 94.0, 46.3, 50.5);
  blob(ctx, 93.4, 48.4, 1.9, 5.0, 0, 0.5);
  addItem(ctx, "X", 94.02, 0.94, 49.5, "the cafeteria");
  picture(ctx, "menu", f.e - 0.012, 2.4, 48.4, -PI / 2, 1.4);
  // Dead vending machine.
  g.at(65.6, 0, f.n + 0.42);
  g.box("gloss", -0.45, 0, -0.4, 0.45, 1.85, 0.4, { col: 0x7a1818 });
  g.sub(0, 0.95, 0.401).rect("atlas", 0.86, 1.72, ctx.atlas.uv("vending"));
  g.reset();
  solidAt(65.6, f.n + 0.42, 0.9, 0.8, 0, 0.03, true);
  blob(ctx, 65.6, f.n + 0.5, 1.3, 1.2, 0, 0.6);
  poster(ctx, "posterProm", f.w + 0.012, 1.7, 48.6, PI / 2, 0.6);
  poster(ctx, "posterMissing", f.w + 0.012, 1.6, 40.5, PI / 2, 0.5);
  trashCan(ctx, 71.2, 40.0, false);
  trashCan(ctx, 89.2, 40.0, true);
  troffers(ctx, "X", [67.5, 74, 80.5, 87, 93.5], [42.5, 47.5], true, 13);
}

function cafTable(ctx: Ctx, x: number, z: number, yaw: number) {
  const g = ctx.geo,
    r = ctx.rng;
  const seat = [0x7a2c2c, 0x2b4f86, 0x3d6b4a][(r() * 3) | 0];
  g.at(x, 0, z, yaw);
  g.box("gloss", -1.8, 0.72, -0.38, 1.8, 0.75, 0.38, { col: 0xd8cfb4 });
  g.box("chrome", -1.8, 0.72, -0.385, 1.8, 0.75, -0.38, { col: 0x9a9a9a });
  g.box("chrome", -1.8, 0.72, 0.38, 1.8, 0.75, 0.385, { col: 0x9a9a9a });
  for (const sz of [-1, 1]) {
    g.box("gloss", -1.7, 0.43, sz * 0.62 - 0.15, 1.7, 0.46, sz * 0.62 + 0.15, { col: seat });
    for (const sx of [-1.2, 0, 1.2]) g.tube("metal", sx, 0.44, sz * 0.62, sx * 0.9, 0.02, sz * 0.15, 0.018, 5, { col: 0x4a4c4e });
  }
  for (const sx of [-1.4, 1.4]) g.tube("metal", sx, 0.72, 0, sx, 0.02, 0, 0.025, 6, { col: 0x4a4c4e });
  // Trays, cartons and a forgotten lunch.
  for (let i = 0; i < 3; i++) {
    if (r() < 0.4) continue;
    const tx = -1.4 + r() * 2.8,
      tz = (r() < 0.5 ? -1 : 1) * 0.18;
    g.box("gloss", tx - 0.2, 0.75, tz - 0.14, tx + 0.2, 0.765, tz + 0.14, { col: 0xb5652a });
    g.box("paint", tx + 0.05, 0.765, tz - 0.05, tx + 0.12, 0.86, tz + 0.02, { col: 0xe8e4d8 });
  }
  g.reset();
  // Benches and end caps collide; the table top between them stays reachable.
  for (const sz of [-0.62, 0.62]) solidAt(...loc(x, z, yaw, 0, sz), 3.4, 0.3, yaw, 0.03);
  for (const sx of [-1.72, 1.72]) solidAt(...loc(x, z, yaw, sx, 0), 0.16, 0.94, yaw, 0.0);
  blob(ctx, x, z, 4.2, 2.1, yaw, 0.5);
}

// ---------------------------------------------------------------- kitchen

function kitchen(ctx: Ctx) {
  const g = ctx.geo,
    r = ctx.rng;
  const f = faces("K");
  const st = { col: 0xb4b6b2 };
  // North counter with sink and mixer.
  g.box("chrome", 97.4, 0, f.n, f.e, 0.9, f.n + 0.7, st);
  g.box("chrome", 97.4, 0.9, f.n, f.e, 1.2, f.n + 0.04, st);
  g.box("paint", 101.6, 0.88, f.n + 0.12, 102.6, 0.901, f.n + 0.58, { col: 0x101010 });
  g.tube("chrome", 102.1, 0.9, f.n + 0.08, 102.1, 1.25, f.n + 0.08, 0.015, 6, { col: 0xc0c0c0 });
  g.tube("chrome", 102.1, 1.25, f.n + 0.08, 102.1, 1.2, f.n + 0.3, 0.014, 6, { col: 0xc0c0c0 });
  g.box("gloss", 98.6, 0.9, f.n + 0.15, 99.0, 1.45, f.n + 0.55, { col: 0xd8d8d0 });
  solid(97.4, f.e, f.n, f.n + 0.58);
  blob(ctx, 104, f.n + 0.5, 14, 1.4, 0, 0.45);
  addItem(ctx, "K", 105.2, 0.9, f.n + 0.66, "the kitchen");
  picture(ctx, "wash", 102.1, 1.62, f.n + 0.05, 0, 0.4);
  // Range and hood on the east wall.
  g.box("gloss", f.e - 0.8, 0, 41.2, f.e, 0.9, 44.2, { col: 0x1a1a1a });
  for (let i = 0; i < 6; i++) cyl(g, "metal", f.e - 0.55 + (i % 2) * 0.3, 0.9, 41.6 + Math.floor(i / 2) * 0.95, 0.12, 0.015, 0x2a2a2a);
  for (let i = 0; i < 6; i++) g.box("chrome", f.e - 0.82, 0.75, 41.5 + i * 0.45, f.e - 0.8, 0.8, 41.56 + i * 0.45, { col: 0xb0b0b0 });
  g.box("chrome", f.e - 1.0, 2.1, 41.0, f.e, 2.6, 44.4, st);
  solid(f.e - 0.8, f.e, 41.2, 44.2);
  // Walk-in freezer door.
  g.box("chrome", f.e - 0.06, 0, 46.4, f.e, 2.2, 48.6, { col: 0xc8c8c4 });
  g.box("chrome", f.e - 0.14, 1.0, 46.6, f.e - 0.06, 1.25, 46.75, { col: 0x8a8a8a });
  // Island with a pot rack and hanging pans.
  g.box("chrome", 101, 0, 44.4, 106, 0.9, 45.9, st);
  g.box("chrome", 101, 0.12, 44.45, 106, 0.14, 45.85, { col: 0x8a8c88 });
  solid(101.14, 105.86, 44.54, 45.76);
  blob(ctx, 103.5, 45.15, 5.6, 2.0, 0, 0.55);
  relic(ctx, "keys", "K", 103.6, 0.9, 44.46, "the kitchen");
  addItem(ctx, "K", 101.4, 0.9, 45.84, "the kitchen");
  for (const [ax, az] of [
    [101.3, 44.6],
    [105.7, 44.6],
    [101.3, 45.7],
    [105.7, 45.7],
  ])
    g.tube("chrome", ax, 2.25, az, ax, 3.2, az, 0.01, 4, { col: 0x8a8a8a });
  for (const zz of [44.6, 45.7]) g.tube("chrome", 101.3, 2.25, zz, 105.7, 2.25, zz, 0.02, 6, { col: 0x8a8a8a });
  for (let i = 0; i < 9; i++) {
    const px = 101.6 + i * 0.5,
      pz = i % 2 ? 44.6 : 45.7;
    const drop = 0.25 + r() * 0.2;
    g.tube("chrome", px, 2.25, pz, px, 2.25 - drop, pz, 0.006, 3, { col: 0x8a8a8a });
    g.at(px, 2.25 - drop, pz, r() * 0.4, 0, (r() - 0.5) * 0.1);
    g.box("metal", -0.02, -0.25, -0.01, 0.02, 0, 0.01, { col: 0x2a2a2a });
    g.tube("metal", 0, -0.3, 0, 0, -0.42, 0, 0.11 + r() * 0.05, 14, { col: i % 3 === 0 ? 0x8a5a3a : 0x3a3a3a, capped: true });
    g.reset();
  }
  utilityShelf(ctx, 102.5, f.s - 0.25, PI, 3.0);
  addItem(ctx, "K", 101.6, 0.12 + 2 * ((1.9 - 0.15) / 3), f.s - 0.47, "the kitchen");
  g.at(98.3, 0, 49.8);
  g.tube("gloss", 0, 0, 0, 0, 0.38, 0, 0.21, 14, { col: 0xd8b020, capped: true });
  g.tube("wood", 0.05, 0.3, 0, 0.3, 1.4, 0.15, 0.014, 5, { col: 0x9a7a52 });
  g.reset();
  solidAt(98.3, 49.8, 0.42, 0.42, 0, 0.04);
  troffers(ctx, "K", [100, 107], [42.5, 48]);
}

// ------------------------------------------------------------------ lobby

function lobby(ctx: Ctx) {
  const g = ctx.geo,
    r = ctx.rng;
  const f = faces("Y");
  // Trophy case.
  const tx0 = 37.0,
    tx1 = 41.6,
    tz0 = f.n,
    tz1 = f.n + 0.5;
  g.box("wood", tx0, 0, tz0, tx1, 0.9, tz1, { col: 0x5a3a22 });
  g.box("wood", tx0 - 0.03, 2.05, tz0, tx1 + 0.03, 2.15, tz1 + 0.03, { col: 0x5a3a22 });
  for (const x of [tx0, tx1 - 0.04]) g.box("wood", x, 0.9, tz0, x + 0.04, 2.05, tz1, { col: 0x5a3a22 });
  g.quad("atlas", [tx0 + 0.04, 0.92, tz0 + 0.01, tx1 - 0.04, 0.92, tz0 + 0.01, tx1 - 0.04, 2.04, tz0 + 0.01, tx0 + 0.04, 2.04, tz0 + 0.01], uvq(ctx, "plaques"));
  g.box("glass", tx0 + 0.04, 1.45, tz0 + 0.02, tx1 - 0.04, 1.47, tz1 - 0.03, { col: 0xb8c8d0, a: 0.25 });
  g.box("glass", tx0 + 0.04, 0.9, tz1 - 0.01, tx1 - 0.04, 2.05, tz1, { col: 0xa8bcc8, a: 0.18, skip: 1 | 2 | 4 | 8 });
  for (let i = 0; i < 9; i++) {
    const x = tx0 + 0.35 + (i % 5) * 0.95 + r() * 0.2,
      y = i < 5 ? 0.9 : 1.47,
      z = tz0 + 0.25;
    trophy(g, x, y, z, 0.6 + r() * 0.6, r() < 0.7 ? 0xc9a24a : 0xb0b0b0);
  }
  solid(tx0, tx1, tz0, tz1, true);
  blob(ctx, (tx0 + tx1) / 2, tz1, tx1 - tx0 + 0.4, 0.8, 0, 0.5);
  // Memorial for Jenny with candles, flowers and a teddy bear.
  framed(ctx, "memorial", 59.8, 1.75, f.n + 0.012, 0, 2.2, 0x5a3a22);
  table(ctx, 59.8, f.n + 0.55, 1.8, 0.6, 0.78, 0, { top: "cloth", topCol: 0x2a2a2a, leg: "metal", legCol: 0x2a2a2a, thick: 0.03 });
  g.box("cloth", 58.9, 0.3, f.n + 0.84, 60.7, 0.78, f.n + 0.86, { col: 0x2a2a2a });
  sphere(g, "cloth", 60.4, 0.9, f.n + 0.5, 0.11, 0.12, 0.1, 0x8a6a4a);
  sphere(g, "cloth", 60.4, 1.06, f.n + 0.5, 0.075, 0.075, 0.07, 0x8a6a4a);
  g.tube("glass", 59.2, 0.78, f.n + 0.45, 59.2, 1.0, f.n + 0.45, 0.07, 10, { col: 0xb8d0d8, a: 0.35, capped: true });
  for (let i = 0; i < 7; i++) {
    g.tube("wood", 59.2, 0.95, f.n + 0.45, 59.2 + (r() - 0.5) * 0.25, 1.25 + r() * 0.1, f.n + 0.45 + (r() - 0.5) * 0.2, 0.006, 3, { col: 0x3d4a22 });
    sphere(g, "cloth", 59.2 + (r() - 0.5) * 0.25, 1.28 + r() * 0.1, f.n + 0.45 + (r() - 0.5) * 0.2, 0.04, 0.04, 0.04, 0x5a1020);
  }
  const flames: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    const x = 59.0 + i * 0.3 + (r() - 0.5) * 0.08,
      z = f.n + 0.6 + (r() - 0.5) * 0.15,
      h = 0.08 + r() * 0.12;
    cyl(g, "gloss", x, 0.78, z, 0.035, h, 0xe8e0d0);
    g.tube("glass", x, 0.78, z, x, 0.78 + h + 0.05, z, 0.05, 10, { col: 0xc04040, a: 0.25 });
    flames.push(new THREE.Vector3(x, 0.78 + h + 0.035, z));
  }
  addItem(ctx, "Y", 58.95, 0.78, f.n + 0.79, "the lobby");
  const candle = ctx.lights.add("none", 59.8, 1.05, f.n + 0.7, 0, "Y", { intensity: 1.6, range: 4.5, color: 0xff9a40, indoor: false });
  candleFlames(ctx, flames, candle);
  // Benches under the windows, the school crest in the floor, banner and lights.
  bench(ctx, 42.0, f.s - 0.9, 0, 2.0);
  bench(ctx, 57.0, f.s - 0.9, 0, 2.0);
  addItem(ctx, "Y", 41.2, 0.46, f.s - 0.73, "the lobby");
  ctx.geo.at(49.5, 0.004, 45.0, 0, -PI / 2).rect("atlasDecal", 2.6, 2.6, ctx.atlas.uv("crest"));
  ctx.geo.reset();
  picture(ctx, "bannerWelcome", 49.5, 4.15, 39 + H2 + 0.015, 0, 5.2);
  for (const z of [40.4, 47.6]) {
    ctx.lights.addIndoor("sconce", f.w + 0.05, 2.7, z, PI / 2, "Y", { intensity: 7, range: 7, color: 0xffd6a8 });
    ctx.lights.addIndoor("sconce", f.e - 0.05, 2.7, z, -PI / 2, "Y", { intensity: 7, range: 7, color: 0xffd6a8 });
  }
  for (const [x, z] of [
    [42, 42.5],
    [57, 42.5],
    [42, 48.5],
    [57, 48.5],
    [49.5, 45],
  ])
    ctx.lights.addIndoor("can", x, 5.0, z, 0, "Y", { intensity: 18, range: 11, lightY: 3.7 });
  trashCan(ctx, 37.0, f.s - 0.6, false);
  // A fallen prom poster on the floor.
  ctx.geo.at(52.6, 0.006, 47.6, 0.6, -PI / 2).rect("atlas", 0.5, 0.75, ctx.atlas.uv("posterProm"));
  ctx.geo.reset();
}

function trophy(g: Geo, x: number, y: number, z: number, s: number, col: number) {
  g.at(x, y, z, 0, 0, 0, s * 0.3);
  g.box("wood", -0.12, 0, -0.12, 0.12, 0.12, 0.12, { col: 0x2a1a10 });
  g.geom("chrome", CUP, { col });
  g.reset();
}
const CUP = new THREE.LatheGeometry(
  [
    [0.0, 0.12],
    [0.1, 0.13],
    [0.03, 0.18],
    [0.03, 0.32],
    [0.06, 0.36],
    [0.16, 0.5],
    [0.18, 0.62],
    [0.16, 0.63],
  ].map(([a, b]) => new THREE.Vector2(a, b)),
  14
);

/** Flickering candle flames on the memorial (additive, instanced), tied to a fixture so they die with it. */
function candleFlames(ctx: Ctx, at: THREE.Vector3[], fx: { level: number }) {
  const geo = new THREE.SphereGeometry(1, 8, 6);
  geo.scale(0.012, 0.035, 0.012);
  const mesh = new THREE.InstancedMesh(geo, ctx.mats.flame, at.length);
  mesh.name = "level.candleFlames";
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    s = new THREE.Vector3(),
    c = new THREE.Color();
  const phase = at.map(() => ctx.rng() * 10);
  const update = (_dt: number, t: number) => {
    for (let i = 0; i < at.length; i++) {
      const k = Math.max(0, Math.min(1.2, fx.level));
      const fl = 0.8 + Math.sin(t * 13 + phase[i]) * 0.1 + Math.sin(t * 7.3 + phase[i] * 2) * 0.1;
      s.set(k * fl, k * (0.8 + fl * 0.4), k * fl);
      m.compose(at[i], q, s);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setRGB(3.2 * fl, 1.5 * fl, 0.45 * fl));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  update(0, 0);
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  ctx.scene.add(mesh);
  ctx.objects.push(mesh);
  ctx.anim.push(update);
}

// --------------------------------------------------------------------- all

export function buildRooms(ctx: Ctx) {
  for (const k of ["A", "B", "C", "D", "E", "F"]) classroom(ctx, k);
  library(ctx);
  office(ctx);
  boilerRoom(ctx);
  lab(ctx);
  cafeteria(ctx);
  kitchen(ctx);
  lobby(ctx);
  // A few crumpled papers in every room.
  const r = ctx.rng;
  for (const k of ["A", "B", "C", "D", "E", "F", "L", "P", "S", "X", "K", "Y"]) {
    const b = roomBounds(k);
    for (let i = 0; i < 6; i++) crumple(ctx.geo, b.x0 + 0.6 + r() * (b.x1 - b.x0 - 1.2), 0.04, b.z0 + 0.6 + r() * (b.z1 - b.z0 - 1.2), 0.04 + r() * 0.03, 0xe8e4d8, r() * 6);
  }
}
