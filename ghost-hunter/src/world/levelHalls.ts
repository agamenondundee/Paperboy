import * as THREE from "three";
import type { LockerSpot } from "../types";
import { T, WT, Edge, OPENING, edges, ROOMS, type EdgeSeg } from "./map";
import { Geo, F_PZ, F_NZ, F_NY } from "./levelGeo";
import { type Ctx, solid, blob, item, splat } from "./levelCtx";
import { poster, bulletinBoard, fountain, extinguisher, clock, trashCan, picture } from "./levelFurniture";
import { exitSign } from "./levelShell";

/**
 * Corridors: runs of lockers (instanced, every one a hiding place with its
 * own swinging door), fluorescent lights, posters, fountains, extinguishers,
 * clocks and the odd fallen ceiling tile.
 */

const LW = 0.45,
  LD = 0.5,
  H2 = WT / 2;
const RUN_COLS = [0x2e6f73, 0x7a2c2c, 0xb8902e, 0x2b4f86, 0x5b6b3a, 0xb55a2a, 0x8a8e90];
const OPEN_ANGLE = 1.9;

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
export interface Lockers {
  spots: LockerSpot[];
  setDoor(id: number, open: number): void;
  /** Footprints of the locker runs (they do not block sight, but writing should land on them). */
  runs: Rect[];
}

function lockerGeometries() {
  const g = new Geo();
  const body = { uv: 0.45, uvOff: [0.75, 0.05] as const };
  // Open-fronted carcass (the material is double-sided, so its inside shows when the door opens).
  g.box("b", -LW / 2, 0.1, -LD / 2, LW / 2, 2.0, LD / 2 - 0.02, { ...body, skip: F_PZ | F_NY });
  g.box("b", -LW / 2, 0.1, LD / 2 - 0.02, -LW / 2 + 0.02, 2.0, LD / 2, body);
  g.box("b", LW / 2 - 0.02, 0.1, LD / 2 - 0.02, LW / 2, 2.0, LD / 2, body);
  g.box("b", -LW / 2, 1.96, LD / 2 - 0.02, LW / 2, 2.0, LD / 2, body);
  g.box("b", -LW / 2, 0.1, LD / 2 - 0.02, LW / 2, 0.13, LD / 2, body);
  g.box("b", -LW / 2 + 0.02, 0, -LD / 2 + 0.02, LW / 2 - 0.02, 0.1, LD / 2 - 0.03, { col: 0x2a2a2a, skip: F_NY });
  const bodyGeo = g.build({ b: new THREE.MeshBasicMaterial() }, () => ({ cast: false, receive: false })).get("b")!.geometry;

  const d = new Geo();
  const DW = LW - 0.02,
    y0 = 0.14,
    y1 = 1.95;
  d.quad("d", [0, y0, 0.01, DW, y0, 0.01, DW, y1, 0.01, 0, y1, 0.01], [0, 0, 0.5, 0, 0.5, 1, 0, 1]);
  d.quad("d", [DW, y0, -0.01, 0, y0, -0.01, 0, y1, -0.01, DW, y1, -0.01], [0, 0, 0.5, 0, 0.5, 1, 0, 1], { col: 0xd0d0d0 });
  d.box("d", 0, y0, -0.01, DW, y1, 0.01, { uv: 0.45, uvOff: [0.75, 0], skip: F_PZ | F_NZ });
  d.box("d", DW - 0.07, 0.98, 0.01, DW - 0.04, 1.14, 0.03, { col: 0x9a9a9a });
  const doorGeo = d.build({ d: new THREE.MeshBasicMaterial() }, () => ({ cast: false, receive: false })).get("d")!.geometry;
  return { bodyGeo, doorGeo };
}

interface Line {
  dir: "S" | "E";
  c: number;
  s: number;
  spans: [number, number][];
}

/** Which hall walls carry lockers. */
function lockerWall(e: EdgeSeg): number {
  if (e.dir === "S" && e.r === 4 && e.b === "H" && "ABCDEF".includes(e.a)) return 1;
  if (e.dir === "S" && e.r === 5 && e.a === "H" && (e.b === "G" || e.b === "L")) return -1;
  if (e.dir === "S" && e.r === 12 && e.a === "H" && e.b === "X") return -1;
  if (e.dir === "E" && e.c === 11 && e.a === "G" && e.b === "H" && e.r <= 11) return 1;
  return 0;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _Y = new THREE.Vector3(0, 1, 0);

export function buildHalls(ctx: Ctx): Lockers {
  const g = ctx.geo,
    rng = ctx.rng;

  // ---------------------------------------------------------- lockers
  const lines = new Map<string, Line>();
  for (const e of edges) {
    if (e.kind !== Edge.Wall && e.kind !== Edge.Door && e.kind !== Edge.Double) continue;
    const s = lockerWall(e);
    if (!s) continue;
    const base = e.dir === "S" ? e.x0 : e.z0;
    const c = e.dir === "S" ? e.z0 : e.x0;
    const key = `${e.dir}:${c}:${s}`;
    let L = lines.get(key);
    if (!L) lines.set(key, (L = { dir: e.dir, c, s, spans: [] }));
    if (e.kind === Edge.Wall) L.spans.push([base, base + T]);
    else {
      const w = OPENING[e.kind];
      L.spans.push([base, base + (T - w) / 2 - 0.16]);
      L.spans.push([base + (T + w) / 2 + 0.16, base + T]);
    }
  }

  interface Placed {
    x: number;
    z: number;
    yaw: number;
    nx: number;
    nz: number;
    col: THREE.Color;
  }
  const placed: Placed[] = [];
  const runs: Rect[] = [];
  const gaps: { L: Line; a: number; len: number }[] = [];
  for (const L of lines.values()) {
    L.spans.sort((p, q) => p[0] - q[0]);
    const merged: [number, number][] = [];
    for (const sp of L.spans) {
      const last = merged[merged.length - 1];
      if (last && Math.abs(last[1] - sp[0]) < 1e-6) last[1] = sp[1];
      else merged.push([sp[0], sp[1]]);
    }
    const nx = L.dir === "E" ? L.s : 0,
      nz = L.dir === "S" ? L.s : 0;
    const off = L.s * (H2 + 0.015 + LD / 2);
    for (let [a0, a1] of merged) {
      if (Math.abs(a0 / T - Math.round(a0 / T)) < 1e-6) a0 += 0.55;
      if (Math.abs(a1 / T - Math.round(a1 / T)) < 1e-6) a1 -= 0.55;
      let a = a0;
      while (a1 - a >= LW * 3) {
        const want = 6 + Math.floor(rng() * 9);
        const n = Math.min(want, Math.floor((a1 - a) / LW));
        const col = new THREE.Color(RUN_COLS[(rng() * RUN_COLS.length) | 0]);
        for (let i = 0; i < n; i++) {
          const along = a + (i + 0.5) * LW;
          const x = L.dir === "S" ? along : L.c + off;
          const z = L.dir === "S" ? L.c + off : along;
          const v = 0.85 + rng() * 0.2;
          placed.push({ x, z, yaw: Math.atan2(nx, nz), nx, nz, col: col.clone().multiplyScalar(v) });
        }
        // One collision box per run of lockers.
        const r0 = a,
          r1 = a + n * LW;
        const d0 = L.c + L.s * H2,
          d1 = L.c + L.s * (H2 + 0.03 + LD);
        const box = L.dir === "S" ? { x0: r0, x1: r1, z0: Math.min(d0, d1), z1: Math.max(d0, d1) } : { x0: Math.min(d0, d1), x1: Math.max(d0, d1), z0: r0, z1: r1 };
        solid(box.x0, box.x1, box.z0, box.z1);
        runs.push(box);
        const bc = (r0 + r1) / 2,
          bd = L.c + L.s * (H2 + LD * 0.6);
        if (L.dir === "S") blob(ctx, bc, bd, r1 - r0 + 0.4, 1.1, 0, 0.35);
        else blob(ctx, bd, bc, r1 - r0 + 0.4, 1.1, Math.PI / 2, 0.35);
        a = r1;
        const gap = 1.4 + rng() * 1.8;
        if (a1 - a > gap) gaps.push({ L, a: a + gap / 2, len: gap });
        a += gap;
      }
    }
  }

  const { bodyGeo, doorGeo } = lockerGeometries();
  const n = placed.length;
  const bodies = new THREE.InstancedMesh(bodyGeo, ctx.mats.locker, n);
  const doors = new THREE.InstancedMesh(doorGeo, ctx.mats.locker, n);
  bodies.name = "level.lockers";
  doors.name = "level.lockerDoors";
  doors.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const spots: LockerSpot[] = [];
  const hinges: THREE.Vector3[] = [];
  placed.forEach((p, i) => {
    _q.setFromAxisAngle(_Y, p.yaw);
    _m.compose(_p.set(p.x, 0, p.z), _q, _one);
    bodies.setMatrixAt(i, _m);
    bodies.setColorAt(i, p.col);
    doors.setColorAt(i, p.col);
    // Hinge on the left as you face the locker.
    const c = Math.cos(p.yaw),
      s = Math.sin(p.yaw);
    const lx = -LW / 2 + 0.01,
      lz = LD / 2 + 0.011;
    hinges.push(new THREE.Vector3(p.x + lx * c + lz * s, 0, p.z - lx * s + lz * c));
    spots.push({ id: i, x: p.x, z: p.z, nx: p.nx, nz: p.nz, yaw: Math.atan2(-p.nx, -p.nz) });
  });
  const setDoor = (id: number, open: number) => {
    const p = placed[id];
    if (!p) return;
    const o = Math.max(0, Math.min(1, open));
    _q.setFromAxisAngle(_Y, p.yaw - o * OPEN_ANGLE);
    _m.compose(hinges[id], _q, _one);
    doors.setMatrixAt(id, _m);
    doors.instanceMatrix.needsUpdate = true;
  };
  for (let i = 0; i < n; i++) setDoor(i, 0);
  // A few doors left hanging open.
  for (let i = 0; i < n; i++) if (rng() < 0.06) setDoor(i, 0.25 + rng() * 0.6);
  bodies.instanceMatrix.needsUpdate = true;
  bodies.computeBoundingSphere();
  doors.computeBoundingSphere();
  bodies.frustumCulled = doors.frustumCulled = false;
  bodies.castShadow = doors.castShadow = true;
  bodies.receiveShadow = doors.receiveShadow = true;
  ctx.scene.add(bodies, doors);
  ctx.objects.push(bodies, doors);

  // ------------------------------------------------- gaps between runs
  for (const gp of gaps) {
    const { L } = gp;
    const yaw = Math.atan2(L.dir === "E" ? L.s : 0, L.dir === "S" ? L.s : 0);
    const at = (d: number): [number, number] => (L.dir === "S" ? [gp.a, L.c + L.s * d] : [L.c + L.s * d, gp.a]);
    const k = rng();
    const [px, pz] = at(H2 + 0.012);
    if (k < 0.3) poster(ctx, rng() < 0.6 ? "posterMissing" : "posterProm", px, 1.5, pz, yaw, 0.5);
    else if (k < 0.45 && gp.len > 2.1) bulletinBoard(ctx, px, 1.55, pz, yaw, 1.6);
    else if (k < 0.6) {
      const [fx, fz] = at(H2);
      fountain(ctx, fx, fz, yaw);
    } else if (k < 0.72) extinguisher(ctx, px, 1.3, pz, yaw);
    else if (k < 0.85) {
      poster(ctx, rng() < 0.5 ? "posterHawks" : "posterMissing", px, 1.5, pz, yaw, 0.48);
      const [tx, tz] = at(H2 + 0.45);
      trashCan(ctx, tx, tz, rng() < 0.3);
    }
  }

  // ------------------------------------ posters on walls without lockers
  for (const e of edges) {
    if (e.kind !== Edge.Wall) continue;
    const hallA = e.a === "H",
      hallB = e.b === "H";
    if (hallA === hallB || lockerWall(e)) continue;
    const other = hallA ? e.b : e.a;
    if (!ROOMS[other].indoor || other === "Y") continue;
    if (rng() > 0.45) continue;
    const s = hallA ? -1 : 1;
    const u = T * (0.3 + rng() * 0.4);
    const d = s * (H2 + 0.012);
    const x = e.dir === "S" ? e.x0 + u : e.x0 + d,
      z = e.dir === "S" ? e.z0 + d : e.z0 + u;
    const yaw = Math.atan2(e.dir === "E" ? s : 0, e.dir === "S" ? s : 0);
    const k = rng();
    const name = k < 0.4 ? "posterMissing" : k < 0.65 ? "posterProm" : k < 0.75 ? "posterNo" : k < 0.85 ? "posterHawks" : "posterRead";
    if (rng() < 0.15) bulletinBoard(ctx, x, 1.55, z, yaw, 1.5);
    else poster(ctx, name, x, 1.5 + (rng() - 0.5) * 0.15, z, yaw, 0.5);
  }

  // ------------------------------------------------------------ lights
  const L = ctx.lights;
  const trof = (x: number, z: number, alongX: boolean) => L.addIndoor("troffer", x, 3.2, z, alongX ? Math.PI / 2 : 0, "H", { intensity: 10, range: 9, lightY: 2.85 });
  for (let x = 6; x <= 108; x += 6) trof(x, 16.5, true);
  for (const x of [37.5, 64.5, 97.5]) for (const z of [21.5, 27.5, 33.5]) trof(x, z, false);
  for (let x = 43.5; x <= 109; x += 6) trof(x, 37.5, true);

  // Exit signs at the corridor ends, clocks on the long walls.
  exitSign(g, ctx, 3.1 + 0.08, 2.65, 16.5, Math.PI / 2);
  exitSign(g, ctx, 110.9 - 0.08, 2.65, 16.5, -Math.PI / 2);
  exitSign(g, ctx, 110.9 - 0.08, 2.65, 37.5, -Math.PI / 2);
  for (const x of [31.5, 58.5, 85.5]) clock(ctx, x, 2.6, 18 - H2 - 0.01, Math.PI);
  clock(ctx, 75, 2.6, 36 + H2 + 0.01, 0);
  picture(ctx, "bannerHawks", 22, 2.55, 15 + H2 + 0.013, 0, 1.4);

  // ---------------------------------------------- fallen ceiling tiles
  const fallen = [
    [13.5, 16.5],
    [52.5, 16.5],
    [91.5, 16.5],
    [37.5, 25.5],
    [64.5, 30],
    [80.5, 37.5],
  ];
  for (const [x, z] of fallen) {
    const hx = (rng() - 0.5) * 0.6,
      hz = (rng() - 0.5) * 0.6;
    g.box("paint", x + hx - 0.3, 3.193, z + hz - 0.6, x + hx + 0.3, 3.197, z + hz + 0.6, { col: 0x050505 });
    g.at(x + hx + 0.2, 0.02, z + hz + 0.3, rng() * Math.PI, (rng() - 0.5) * 0.15, (rng() - 0.5) * 0.15);
    g.box("ceiling", -0.3, -0.01, -0.6, 0.3, 0.008, 0.6, { col: 0xd8d2c0 });
    g.reset();
    for (let i = 0; i < 5; i++) {
      g.at(x + hx + (rng() - 0.5) * 1.2, 0.012, z + hz + (rng() - 0.5) * 1.2, rng() * 6, 0, 0);
      g.box("ceiling", -0.06, -0.01, -0.05, 0.06, 0.01, 0.05, { col: 0xd0c8b4 });
      g.reset();
    }
    // A tile hanging by one edge.
    if (rng() < 0.5) {
      g.at(x - hx, 3.19, z - hz, 0, 0.9);
      g.box("ceiling", -0.3, -0.008, 0, 0.3, 0.008, 1.2, { col: 0xd8d2c0 });
      g.reset();
    }
    splat(ctx, x + hx, 0.006, z + hz, 0, -Math.PI / 2, 0.9, 0x3a2e20, 0.5);
  }

  // Pickup spots on hall floors.
  item(ctx, "H", 22.6, 0, 16.9, "the north corridor");
  item(ctx, "H", 70.2, 0, 17.4, "the north corridor");
  item(ctx, "H", 38.6, 0, 31.2, "the west corridor");
  item(ctx, "H", 98.5, 0, 22.3, "the east corridor");
  item(ctx, "H", 86.2, 0, 36.6, "the south corridor");
  return { spots, setDoor, runs };
}
