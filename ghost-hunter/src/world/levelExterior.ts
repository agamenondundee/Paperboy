import * as THREE from "three";
import { Geo } from "./levelGeo";
import { ROWS, T } from "./map";
import { type Ctx, solid, solidAt, blob, splat } from "./levelCtx";
import { cyl, sphere, loc, bench } from "./levelFurniture";
import { quadN } from "./levelShell";
import { beamMaterial } from "./levelMaterials";

/**
 * Outside: the rain-soaked car park with Brodie's 1980s estate car, sodium
 * lamp posts, the entrance canopy and sign, the flag at half mast, an old
 * school bus, bare trees and a ring of distant tree line silhouettes.
 */

const PI = Math.PI;
/** South fence line, edge of the grass verge, and the divider between the stall rows. */
const FENCE = (ROWS - 1) * T,
  VERGE = FENCE - 2.6,
  DIV = 66.9;

export interface Exterior {
  car: { x: number; z: number; yaw: number };
  spawn: { x: number; z: number; yaw: number };
  setHeadlights(on: boolean): void;
}

export function buildExterior(ctx: Ctx): Exterior {
  const g = ctx.geo,
    r = ctx.rng;

  // ------------------------------------------------------------ ground
  g.flat("grass", -160, -160, 270, 250, -0.02, null);
  g.flat("concrete", 3, 51.1, 111, 55.0, 0.004, null, { col: 0xb4b0a6 });
  for (let x = 4.5; x < 111; x += 1.5) g.flat("paintDecal", x - 0.012, 51.1, x + 0.012, 55.0, 0.0045, null, { col: 0x55524c });
  g.box("concrete", 3, 0, 55.0, 111, 0.12, 55.2, { col: 0xa8a49a, skip: 8 });
  // Grass verges inside the fence (the fence runs along z = FENCE), with kerbs.
  for (const [x0, z0, x1, z1] of [
    [3, 55.2, 5.6, VERGE],
    [108.4, 55.2, 111, VERGE],
    [3, VERGE, 111, FENCE],
  ]) {
    g.flat("grass", x0, z0, x1, z1, 0.008, null);
  }
  g.box("concrete", 5.6, 0, 55.2, 5.8, 0.1, VERGE, { col: 0xa8a49a, skip: 8 });
  g.box("concrete", 108.2, 0, 55.2, 108.4, 0.1, VERGE, { col: 0xa8a49a, skip: 8 });
  g.box("concrete", 5.6, 0, VERGE - 0.2, 108.4, 0.1, VERGE, { col: 0xa8a49a, skip: 8 });

  // ------------------------------------------------------ parking lines
  const W = 0xd8d4c8;
  const line = (x0: number, z0: number, x1: number, z1: number, w = 0.1, col = W) => {
    if (r() < 0.12) return;
    if (x0 === x1) g.flat("paintDecal", x0 - w / 2, Math.min(z0, z1), x0 + w / 2, Math.max(z0, z1), 0.004, null, { col });
    else g.flat("paintDecal", Math.min(x0, x1), z0 - w / 2, Math.max(x0, x1), z0 + w / 2, 0.004, null, { col });
  };
  // Two rows of stalls back to back across the middle, drive lanes either side.
  for (let x = 8; x <= 105; x += 2.7) {
    if (x > 41.5 && x < 57.5) continue;
    line(x, 61.5, x, DIV);
    line(x, DIV, x, 72.3);
  }
  line(8, DIV, 41.3, DIV);
  line(57.7, DIV, 105, DIV);
  for (let x = 12; x < 100; x += 14) arrow(ctx, x, 58.4, x < 50 ? 1 : -1);
  for (const x of [16, 30, 70, 88]) arrow(ctx, x, 77.4, x < 50 ? -1 : 1);
  // Drain grates and puddle grime.
  for (const [x, z] of [
    [30, 58.6],
    [70, 58.6],
    [40, 77.5],
    [90, 77.5],
  ]) {
    g.flat("grating", x - 0.4, z - 0.25, x + 0.4, z + 0.25, 0.006, null, { uv: 2 });
    splat(ctx, x, 0.005, z, 0, -PI / 2, 1.6, 0x101010, 0.45);
  }

  // ---------------------------------------------------------- lamp posts
  const lamps: [number, number, number, boolean][] = [
    [18.8, DIV, -1, false],
    [40.4, DIV, 1, false],
    [59.3, DIV, -1, false],
    [80.9, DIV, 1, false],
    [102.5, DIV, -1, false],
    [30, 82.7, -1, true],
    [72, 82.7, -1, false],
  ];
  for (const [x, z, dir, broken] of lamps) {
    const hz = z + dir * 1.35;
    cyl(g, "concrete", x, 0, z, 0.32, 0.55, 0x9a968c);
    g.tube("metal", x, 0.55, z, x, 7.55, z, 0.085, 10, { col: 0x5d6266 });
    g.tube("metal", x, 7.3, z, x, 7.55, hz, 0.045, 8, { col: 0x5d6266 });
    g.tube("metal", x, 6.9, z, x, 7.35, z + dir * 0.7, 0.025, 6, { col: 0x5d6266 });
    ctx.lights.add("lamp", x, 7.5, hz, Math.PI / 2, ".", { indoor: false, intensity: 60, range: 25, lightY: 7.2, broken, cone: [7.4, 3.6, 0.05] });
    solid(x - 0.3, x + 0.3, z - 0.3, z + 0.3);
    blob(ctx, x, z, 1.4, 1.4, 0, 0.5);
  }
  // Wall packs on the facade.
  const packs = [12, 27, 39, 66, 81, 99];
  packs.forEach((x, i) => ctx.lights.add("wallpack", x, 3.7, 51.1 + 0.2, 0, ".", { indoor: false, intensity: 22, range: 13, color: 0xffb060, broken: i === 2 }));

  // ------------------------------------------------- canopy and the sign
  const cz0 = 51.1,
    cz1 = 55.6;
  g.box("metal", 44.6, 3.25, cz0, 54.4, 3.6, cz1, { col: 0x3d3128 });
  g.box("paint", 44.65, 3.249, cz0, 54.35, 3.25, cz1 - 0.05, { col: 0x9a948a, skip: 1 | 2 | 4 | 16 | 32 });
  g.at(49.5, 3.42, cz1 + 0.002).rect("atlas", 9.6, 0.34, ctx.atlas.uv("canopySign"));
  g.reset();
  for (const x of [45.1, 53.9]) {
    g.box("brick", x - 0.2, 0, cz1 - 0.6, x + 0.2, 3.25, cz1 - 0.2);
    solid(x - 0.2, x + 0.2, cz1 - 0.6, cz1 - 0.2, true);
  }
  ctx.lights.add("can", 47.3, 3.25, 53.4, 0, ".", { indoor: false, intensity: 10, range: 9, lightY: 2.7, color: 0xffc890 });
  ctx.lights.add("can", 51.7, 3.25, 53.4, 0, ".", { indoor: false, intensity: 10, range: 9, lightY: 2.7, color: 0xffc890, broken: true });
  // Letters fallen from the sign, lying in a puddle.
  g.at(52.8, 0.02, 56.6, 0.7, -PI / 2);
  g.box("chrome", -0.11, -0.16, -0.01, 0.11, 0.16, 0.01, { col: 0xcfc6b0 });
  g.reset();

  // ------------------------------------------------------------ flag pole
  const fx = 42.2,
    fz = 53.6;
  cyl(g, "concrete", fx, 0, fz, 0.35, 0.25, 0x9a968c);
  g.tube("chrome", fx, 0.25, fz, fx, 9.6, fz, 0.06, 10, { col: 0xa8aaa8 });
  sphere(g, "chrome", fx, 9.68, fz, 0.1, 0.1, 0.1, 0xc9a24a);
  g.tube("paint", fx + 0.07, 1.2, fz, fx + 0.07, 9.5, fz, 0.006, 3, { col: 0xd8d4c8 });
  solid(fx - 0.35, fx + 0.35, fz - 0.35, fz + 0.35);
  buildFlag(ctx, fx + 0.07, 6.7, fz);

  // --------------------------------------------- odds and ends by the door
  for (let i = 0; i < 5; i++) {
    const x = 35.0 + i * 0.75;
    g.tube("metal", x - 0.3, 0, 53.2, x - 0.3, 0.75, 53.2, 0.025, 6, { col: 0x5d6266 });
    g.tube("metal", x + 0.3, 0, 53.2, x + 0.3, 0.75, 53.2, 0.025, 6, { col: 0x5d6266 });
    g.tube("metal", x - 0.3, 0.75, 53.2, x + 0.3, 0.75, 53.2, 0.025, 6, { col: 0x5d6266 });
  }
  solid(34.6, 38.4, 53.1, 53.3);
  bench(ctx, 58.2, 52.6, PI, 1.8);
  // Dumpster by the kitchen.
  g.at(106.6, 0, 52.9, 0.05);
  g.box("gloss", -0.95, 0.12, -0.6, 0.95, 1.15, 0.6, { col: 0x24452e });
  g.save();
  g.sub(0, 1.15, -0.6, 0, -0.3);
  g.box("gloss", -0.95, 0, 0, 0.95, 0.04, 1.2, { col: 0x1c3824 });
  g.restore();
  for (const sx of [-0.8, 0.8]) for (const sz of [-0.45, 0.45]) cyl(g, "paint", sx, 0, sz, 0.06, 0.12, 0x111111, true);
  g.reset();
  solidAt(106.6, 52.9, 1.9, 1.2, 0.05, 0.04);
  blob(ctx, 106.6, 52.9, 2.4, 1.7, 0.05, 0.6);
  for (let i = 0; i < 4; i++) sphere(g, "gloss", 105.2 + r() * 0.6, 0.18, 53.9 + r() * 0.5, 0.25, 0.2, 0.22, 0x0a0a0a);

  // ------------------------------------------------------- vehicles
  const car = { x: 47.6, z: 76.2, yaw: -0.08 };
  const head = estate(ctx, car.x, car.z, car.yaw);
  sedan(ctx, 86.0, 69.7, 0.05);
  schoolBus(ctx, 95.0, 69.6, PI / 2 + 0.04);
  // Spawn beside the driver's door (left side), looking at the front doors.
  const [sx, sz] = loc(car.x, car.z, car.yaw, -1.55, -0.25);
  const spawn = { x: sx, z: sz, yaw: Math.atan2(-(49.5 - sx), -(51 - sz)) };

  // ---------------------------------------------------------------- trees
  const trees: [number, number, number][] = [
    [0.8, 61, 9],
    [-1.2, 79, 11],
    [113.4, 58, 10],
    [114.8, 79.5, 12],
    [22, 88.5, 10],
    [61, 89.5, 13],
    [96, 88, 9],
    [-5, 26, 14],
    [117, 24, 13],
    [34, -3, 15],
    [80, -2.5, 14],
    [58, -6, 16],
  ];
  for (const [x, z, h] of trees) tree(ctx, x, z, h);
  treeLine(ctx);
  return { car, spawn, setHeadlights: head };
}

/** Painted lane arrow; the shaft runs along local y with the head at the tip. */
function arrow(ctx: Ctx, x: number, z: number, dir: number) {
  const g = ctx.geo;
  const o = { col: 0xd8d4c8 };
  g.at(x, 0.0042, z, dir > 0 ? -PI / 2 : PI / 2, -PI / 2);
  g.rect("paintDecal", 0.18, 1.6, undefined, o);
  const tip = 0.86,
    l = 0.7,
    k = Math.SQRT1_2 * (l / 2 - 0.06);
  for (const s of [-1, 1]) {
    g.save();
    g.sub(s * k, tip - k, 0, 0, 0, s * (PI / 4));
    g.rect("paintDecal", 0.18, l, undefined, o);
    g.restore();
  }
  g.reset();
}

// ------------------------------------------------------------------ flag

function buildFlag(ctx: Ctx, x: number, y: number, z: number) {
  const W = 1.6,
    H = 1.0,
    nx = 20,
    ny = 10;
  const geo = new THREE.PlaneGeometry(W, H, nx, ny);
  geo.translate(W / 2, -H / 2, 0);
  const uvr = ctx.atlas.uv("flagUS");
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uvr.u0 + uv.getX(i) * (uvr.u1 - uvr.u0), uvr.v0 + uv.getY(i) * (uvr.v1 - uvr.v0));
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
  pos.setUsage(THREE.DynamicDrawUsage);
  nor.setUsage(THREE.DynamicDrawUsage);
  const base = Float32Array.from(pos.array as Float32Array);
  const mesh = new THREE.Mesh(geo, ctx.mats.flag);
  mesh.name = "level.flag";
  mesh.position.set(x, y, z);
  mesh.rotation.y = -0.5;
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  ctx.scene.add(mesh);
  ctx.objects.push(mesh);
  let acc = 0;
  ctx.anim.push((dt, t) => {
    // 30 Hz is plenty for cloth in the wind.
    acc += dt;
    if (acc < 1 / 30) return;
    acc = 0;
    const p = pos.array as Float32Array,
      n = nor.array as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3],
        by = base[i * 3 + 1];
      const k = bx / W;
      const ph = bx * 3.1 - t * 4.2 + by * 0.7;
      const ph2 = bx * 7.3 - t * 6.9;
      const a1 = 0.11 * k,
        a2 = 0.025 * k;
      p[i * 3] = bx * (1 - 0.04 * k);
      p[i * 3 + 1] = by - k * k * 0.12;
      p[i * 3 + 2] = Math.sin(ph) * a1 + Math.sin(ph2) * a2;
      const dzdx = Math.cos(ph) * 3.1 * a1 + Math.sin(ph) * (0.11 / W) + Math.cos(ph2) * 7.3 * a2;
      const dzdy = Math.cos(ph) * 0.7 * a1;
      const l = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      n[i * 3] = -dzdx / l;
      n[i * 3 + 1] = -dzdy / l;
      n[i * 3 + 2] = 1 / l;
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
  });
}

// ----------------------------------------------------------------- cars

type P = [number, number];
const ESTATE: P[] = [
  [-2.72, 0.42],
  [-2.74, 0.62],
  [-2.68, 0.86],
  [-2.2, 0.93],
  [-1.3, 0.97],
  [-0.62, 1.4],
  [-0.45, 1.44],
  [2.42, 1.45],
  [2.62, 1.4],
  [2.72, 1.05],
  [2.74, 0.62],
  [2.7, 0.4],
  [2.5, 0.32],
  [-2.55, 0.32],
];
const SEDAN: P[] = [
  [-2.5, 0.42],
  [-2.52, 0.62],
  [-2.46, 0.84],
  [-1.2, 0.9],
  [-0.55, 1.33],
  [0.9, 1.35],
  [1.5, 0.95],
  [2.45, 0.9],
  [2.52, 0.62],
  [2.48, 0.4],
  [2.3, 0.32],
  [-2.35, 0.32],
];

function bodyGeometry(profile: P[], width: number) {
  const shape = new THREE.Shape(profile.map(([a, b]) => new THREE.Vector2(a, b)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width - 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 4 });
  geo.translate(0, 0, -(width - 0.08) / 2);
  geo.rotateY(-PI / 2);
  geo.computeVertexNormals();
  return geo;
}
const ESTATE_BODY = bodyGeometry(ESTATE, 1.92);
const SEDAN_BODY = bodyGeometry(SEDAN, 1.88);

/** Offset a profile point outward from the body surface (for glass on sloped panels). */
function lift(a: P, b: P, d: number): [P, P] {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l = Math.hypot(dx, dy);
  const nx = -dy / l,
    ny = dx / l;
  // The profile runs front to back over the top, so the outward normal points up.
  const sx = ny < 0 ? -1 : 1;
  return [
    [a[0] + nx * d * sx, a[1] + ny * d * sx],
    [b[0] + nx * d * sx, b[1] + ny * d * sx],
  ];
}

function wheels(g: Geo, hw: number, zs: number[], y: number, rad: number, flat = 1) {
  for (const z of zs)
    for (const s of [-1, 1]) {
      g.save();
      g.sub(0, y, z);
      g.scale(1, flat, 1);
      g.tube("paint", s * (hw - 0.26), 0, 0, s * (hw + 0.02), 0, 0, rad, 16, { col: 0x111111, capped: true });
      g.tube("chrome", s * (hw + 0.02), 0, 0, s * (hw + 0.035), 0, 0, rad * 0.58, 14, { col: 0xb8b8b4, capped: true });
      g.restore();
    }
}

/** Brodie's estate car: returns the headlight switch. */
function estate(ctx: Ctx, x: number, z: number, yaw: number) {
  const g = ctx.geo;
  g.at(x, 0.04, z, yaw);
  g.geom("gloss", ESTATE_BODY, { col: 0x4e1a16 });
  const hw = 0.96;
  // Wood-grain side panels with chrome trim.
  for (const s of [-1, 1]) {
    const px = s * (hw + 0.006);
    quadN(g, "wood", [px, 0.5, -2.25, px, 0.5, 2.45, px, 0.86, 2.45, px, 0.86, -2.25], [s, 0, 0], [0, 0, 4.7, 0, 4.7, 0.36, 0, 0.36], { col: 0xb07a48 });
    g.box("chrome", px - 0.006, 0.86, -2.3, px + 0.006, 0.885, 2.5, { col: 0xc0c0bc });
    g.box("chrome", px - 0.006, 0.475, -2.3, px + 0.006, 0.5, 2.5, { col: 0xc0c0bc });
    // Side windows and pillars.
    const gx = s * (hw + 0.008);
    quadN(g, "darkGlass", [gx, 1.0, -1.15, gx, 1.0, 2.55, gx, 1.38, 2.38, gx, 1.36, -0.62], [s, 0, 0], null);
    for (const pz of [0.2, 1.3]) g.box("paint", gx - 0.006, 0.98, pz - 0.05, gx + 0.006, 1.42, pz + 0.05, { col: 0x111111 });
    // Door handles and a mirror on the driver's side.
    for (const dz of [-0.35, 0.85]) g.box("chrome", gx - 0.01, 0.9, dz, gx + 0.012, 0.92, dz + 0.12, { col: 0xc0c0bc });
    g.box("paint", s * (hw + 0.02), 1.0, -1.18, s * (hw + 0.14), 1.1, -1.05, { col: 0x111111 });
  }
  const [w0, w1] = lift([-1.3, 0.97], [-0.62, 1.4], 0.05);
  quadN(g, "darkGlass", [-0.8, w0[1], w0[0], 0.8, w0[1], w0[0], 0.77, w1[1], w1[0], -0.77, w1[1], w1[0]], [0, 0.85, -0.53], null);
  const [r0, r1] = lift([2.62, 1.4], [2.72, 1.05], 0.05);
  quadN(g, "darkGlass", [-0.78, r0[1], r0[0], 0.78, r0[1], r0[0], 0.8, r1[1], r1[0], -0.8, r1[1], r1[0]], [0, 0.27, 0.96], null);
  // Bumpers, grille, plates.
  g.box("chrome", -0.98, 0.36, -2.92, 0.98, 0.54, -2.76, { col: 0xc8c8c4 });
  g.box("chrome", -0.98, 0.36, 2.76, 0.98, 0.54, 2.92, { col: 0xc8c8c4 });
  g.box("paint", -0.46, 0.6, -2.79, 0.46, 0.8, -2.76, { col: 0x151515 });
  g.box("chrome", -0.48, 0.79, -2.8, 0.48, 0.81, -2.76, { col: 0xc8c8c4 });
  g.box("chrome", -0.48, 0.59, -2.8, 0.48, 0.61, -2.76, { col: 0xc8c8c4 });
  g.at(x, 0.04, z, yaw).sub(0, 0.45, -2.925, PI).rect("atlas", 0.3, 0.15, ctx.atlas.uv("plate"));
  g.at(x, 0.04, z, yaw).sub(0, 0.68, 2.795).rect("atlas", 0.3, 0.15, ctx.atlas.uv("plate"));
  // Roof rack, aerial, wheels.
  g.at(x, 0.04, z, yaw);
  for (const s of [-1, 1]) {
    g.tube("chrome", s * 0.7, 1.55, -0.3, s * 0.7, 1.55, 2.3, 0.015, 6, { col: 0xb0b0ac });
    for (const pz of [-0.3, 2.3]) g.tube("chrome", s * 0.7, 1.46, pz, s * 0.7, 1.55, pz, 0.015, 5, { col: 0xb0b0ac });
  }
  for (const pz of [0.4, 1.6]) g.tube("chrome", -0.7, 1.55, pz, 0.7, 1.55, pz, 0.012, 5, { col: 0xb0b0ac });
  g.tube("chrome", 0.85, 0.95, -1.4, 0.95, 1.9, -1.2, 0.003, 3, { col: 0x9a9a9a });
  wheels(g, hw, [-1.5, 1.42], 0.36, 0.36);
  g.reset();
  solidAt(x, z, 2.0, 5.8, yaw, 0.1);
  blob(ctx, x, z, 2.8, 6.6, yaw, 0.85);

  // Lamps: their own small mesh so they can be switched without touching the body.
  const lg = new Geo();
  lg.at(x, 0.04, z, yaw);
  const white = new THREE.Color(3.2, 3.0, 2.6),
    red = new THREE.Color(2.4, 0.12, 0.06),
    amber = new THREE.Color(2.4, 0.9, 0.1);
  const lamp = (x0: number, x1: number, y0: number, y1: number, zz: number, n: number, col: THREE.Color) =>
    quadN(lg, "l", [x0, y0, zz, x1, y0, zz, x1, y1, zz, x0, y1, zz], [0, 0, n], null, { col });
  for (const s of [-1, 1]) {
    lamp(s * 0.52, s * 0.68, 0.63, 0.77, -2.8, -1, white);
    lamp(s * 0.71, s * 0.87, 0.63, 0.77, -2.8, -1, white);
    lamp(s * 0.72, s * 0.92, 0.6, 0.98, 2.8, 1, red);
    lamp(s * 0.62, s * 0.7, 0.6, 0.72, 2.8, 1, amber);
  }
  lg.reset();
  const lights = lg.build({ l: ctx.mats.carLights }, () => ({ cast: false, receive: false })).get("l")!;
  ctx.scene.add(lights);
  ctx.objects.push(lights);

  // Two real spotlights (created now so the light count never changes) and soft beams in the rain.
  const spots: THREE.SpotLight[] = [];
  const bg = new Geo();
  const cone = new THREE.CylinderGeometry(0.1, 1, 1, 18, 4, true).translate(0, -0.5, 0);
  const cuv = cone.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < cuv.count; i++) cuv.setXY(i, 0.5, 1 - cuv.getY(i));
  const fwd = new THREE.Vector3(-Math.sin(yaw), -0.06, -Math.cos(yaw)).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), fwd);
  for (const s of [-1, 1]) {
    const [hx, hz] = loc(x, z, yaw, s * 0.7, -2.85);
    const sp = new THREE.SpotLight(0xfff0d8, 0, 45, 0.42, 0.55, 2);
    sp.name = "level.headlight";
    sp.position.set(hx, 0.74, hz);
    sp.target.position.set(hx + fwd.x * 20, 0.0, hz + fwd.z * 20);
    sp.castShadow = false;
    ctx.scene.add(sp, sp.target);
    spots.push(sp);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(hx, 0.74, hz), q, new THREE.Vector3(1.6, 16, 0.9));
    bg.setMatrix(m);
    bg.geom("beam", cone, { col: new THREE.Color(0.06, 0.056, 0.048) });
  }
  const beams = bg.build({ beam: beamMaterial(true) }, () => ({ cast: false, receive: false, order: 10 })).get("beam")!;
  ctx.scene.add(beams);
  ctx.objects.push(beams);
  return (on: boolean) => {
    for (const sp of spots) sp.intensity = on ? 160 : 0;
    ctx.mats.carLights.color.setScalar(on ? 1 : 0.035);
    beams.visible = on;
  };
}

/** An abandoned sedan: rusting, flat tyres, no lights. */
function sedan(ctx: Ctx, x: number, z: number, yaw: number) {
  const g = ctx.geo;
  g.at(x, -0.04, z, yaw, 0.02, 0.015);
  g.geom("gloss", SEDAN_BODY, { col: 0x3a5250 });
  const hw = 0.94;
  for (const s of [-1, 1]) quadN(g, "darkGlass", [s * (hw + 0.008), 0.96, -1.05, s * (hw + 0.008), 0.96, 1.4, s * (hw + 0.008), 1.3, 0.85, s * (hw + 0.008), 1.28, -0.5], [s, 0, 0], null);
  const [w0, w1] = lift([-1.2, 0.9], [-0.55, 1.33], 0.05);
  quadN(g, "darkGlass", [-0.78, w0[1], w0[0], 0.78, w0[1], w0[0], 0.74, w1[1], w1[0], -0.74, w1[1], w1[0]], [0, 0.85, -0.53], null);
  g.box("chrome", -0.95, 0.36, -2.66, 0.95, 0.52, -2.52, { col: 0x8a8a84 });
  g.box("chrome", -0.95, 0.36, 2.52, 0.95, 0.52, 2.66, { col: 0x8a8a84 });
  wheels(g, hw, [-1.4, 1.35], 0.33, 0.36, 0.82);
  g.reset();
  // Oil leaked from the engine over the years.
  splat(ctx, ...offset3(loc(x, z, yaw, 0.1, -1.6), 0.005), yaw, -PI / 2, 1.3, 0x0c0a08, 0.7);
  splat(ctx, ...offset3(loc(x, z, yaw, -0.3, 0.4), 0.005), yaw, -PI / 2, 0.8, 0x0c0a08, 0.5);
  solidAt(x, z, 1.95, 5.3, yaw, 0.1);
  blob(ctx, x, z, 2.7, 6.0, yaw, 0.85);
}
const offset3 = (p: [number, number], y: number): [number, number, number] => [p[0], y, p[1]];

function schoolBus(ctx: Ctx, x: number, z: number, yaw: number) {
  const g = ctx.geo;
  const Y = 0xd8a020;
  g.at(x, 0, z, yaw);
  // Body runs along local z; the bonnet is at -z.
  g.box("gloss", -1.2, 0.5, -4.2, 1.2, 2.95, 5.6, { col: Y });
  g.box("gloss", -1.05, 0.5, -5.6, 1.05, 1.55, -4.2, { col: Y });
  g.box("paint", -1.1, 0.45, -5.75, 1.1, 0.75, -5.55, { col: 0x111111 });
  g.box("paint", -1.25, 0.45, 5.55, 1.25, 0.75, 5.75, { col: 0x111111 });
  for (const s of [-1, 1]) {
    const px = s * 1.205;
    g.box("paint", px - 0.005, 1.25, -4.1, px + 0.005, 1.32, 5.5, { col: 0x111111 });
    g.box("paint", px - 0.005, 0.95, -4.1, px + 0.005, 1.02, 5.5, { col: 0x111111 });
    quadN(g, "darkGlass", [px + s * 0.003, 1.55, -3.6, px + s * 0.003, 1.55, 5.3, px + s * 0.003, 2.45, 5.3, px + s * 0.003, 2.45, -3.6], [s, 0, 0], null);
    for (let i = 0; i <= 10; i++) g.box("gloss", px - 0.01, 1.5, -3.65 + i * 0.89, px + 0.012, 2.5, -3.55 + i * 0.89, { col: Y });
    g.save();
    g.sub(px + s * 0.004, 1.12, 0.6, s > 0 ? PI / 2 : -PI / 2);
    g.rect("atlas", 6.0, 0.75, ctx.atlas.uv("busText"));
    g.restore();
  }
  quadN(g, "darkGlass", [-1.1, 1.6, -4.205, 1.1, 1.6, -4.205, 1.1, 2.6, -4.205, -1.1, 2.6, -4.205], [0, 0, -1], null);
  quadN(g, "darkGlass", [-0.9, 1.6, 5.605, 0.9, 1.6, 5.605, 0.9, 2.5, 5.605, -0.9, 2.5, 5.605], [0, 0, 1], null);
  g.box("paint", -0.5, 1.9, -4.3, -0.3, 2.1, -4.21, { col: 0x111111 });
  g.box("gloss", -1.4, 1.6, -3.6, -1.22, 1.9, -3.3, { col: 0xa01818 });
  wheels(g, 1.2, [-4.4, 3.6], 0.5, 0.5);
  g.reset();
  solidAt(x, z, 2.5, 11.4, yaw, 0.1, true);
  blob(ctx, x, z, 3.4, 12.4, yaw, 0.85);
}

// ---------------------------------------------------------------- trees

function tree(ctx: Ctx, x: number, z: number, h: number) {
  const g = ctx.geo,
    r = ctx.rng;
  const bark = { col: 0x2a2420 };
  const branch = (ax: number, ay: number, az: number, dx: number, dy: number, dz: number, len: number, rad: number, depth: number) => {
    const bx = ax + dx * len,
      by = ay + dy * len,
      bz = az + dz * len;
    g.tube("paint", ax, ay, az, bx, by, bz, rad, depth < 2 ? 7 : 4, bark);
    if (depth >= 4 || rad < 0.015) return;
    const n = depth === 0 ? 4 : 2 + ((r() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const a = r() * PI * 2;
      const spread = 0.5 + r() * 0.5;
      let nx = dx + Math.cos(a) * spread,
        ny = dy + 0.25 + r() * 0.3,
        nz = dz + Math.sin(a) * spread;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const t = depth === 0 ? 0.55 + r() * 0.4 : 1;
      branch(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, nx, ny, nz, len * (0.55 + r() * 0.2), rad * 0.55, depth + 1);
    }
  };
  branch(x, -0.1, z, (r() - 0.5) * 0.12, 1, (r() - 0.5) * 0.12, h * 0.55, 0.12 + h * 0.012, 0);
  blob(ctx, x, z, 3, 3, 0, 0.5);
  solid(x - 0.25, x + 0.25, z - 0.25, z + 0.25);
}

/** Two rings of distant tree silhouettes, faded by the fog. */
function treeLine(ctx: Ctx) {
  const g = ctx.geo;
  const cx = 57,
    cz = 45;
  for (const [rad, h, seg, off] of [
    [125, 24, 36, 0],
    [175, 34, 40, 0.37],
  ] as const) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * PI * 2 + off,
        a1 = ((i + 1) / seg) * PI * 2 + off;
      const x0 = cx + Math.cos(a0) * rad,
        z0 = cz + Math.sin(a0) * rad,
        x1 = cx + Math.cos(a1) * rad,
        z1 = cz + Math.sin(a1) * rad;
      const u0 = (i * 0.37) % 1,
        u1 = u0 + 0.33;
      g.quad("treeline", [x0, -1, z0, x1, -1, z1, x1, h, z1, x0, h, z0], [u0, 0, u1, 0, u1, 1, u0, 1]);
    }
  }
}
