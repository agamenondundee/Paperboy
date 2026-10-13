import * as THREE from "three";
import { T, WT, FACADE_H, Edge, OPENING, ROOMS, GRID, ROWS, COLS, edges, type EdgeSeg } from "./map";
import { Geo, F_ALL, F_NY, F_PX, F_NX, F_PZ, F_NZ, F_PY, type GOpts, type Col } from "./levelGeo";
import { type Ctx, solid } from "./levelCtx";

/**
 * The building shell: walls (two layers per wall so each side gets its own
 * material), openings, door frames and leaves, windows, floors, ceilings,
 * cheap ambient occlusion strips, the roof, the perimeter fence and the
 * animated front doors.
 */

const H2 = WT / 2;
// Faces in edge space: u along the edge, y up, w across from side a to side b.
const EU = 1,
  EUm = 2,
  EY = 4,
  EYm = 8,
  EW = 16,
  EWm = 32;
const FB = {
  S: { up: F_PX, um: F_NX, wp: F_PZ, wm: F_NZ },
  E: { up: F_PZ, um: F_NZ, wp: F_PX, wm: F_NX },
};

export const WALL_KEY: Record<string, string> = { block: "block", plaster: "plaster", panel: "panel", tile: "tile", brick: "brick" };
export const FLOOR_KEY: Record<string, string> = { vinyl: "vinyl", wood: "woodFloor", carpet: "carpet", concrete: "concrete", checker: "checker", terrazzo: "terrazzo", asphalt: "asphalt" };

const WALL_TINT: Record<string, number> = {
  H: 0xe8e1ce,
  G: 0xd2d6c6,
  W: 0x9b988f,
  A: 0xc9d8ba,
  B: 0xe6dcae,
  C: 0xbccdd8,
  D: 0xe6cfae,
  E: 0xe8caae,
  F: 0xeeeae0,
  L: 0xf2e6da,
  P: 0xb88a64,
  S: 0xf0f0ea,
  Y: 0xe4d9c0,
  X: 0xa4cfbd,
  K: 0xf2f2ec,
};
export const FLOOR_TINT: Record<string, number> = {
  L: 0x55705c,
  P: 0x7c3434,
  W: 0x8c8780,
  K: 0xb0aca2,
  F: 0xc8c4b8,
  S: 0xeef3f3,
  ".": 0xffffff,
};

interface Side {
  ch: string;
  key: string;
  col: number;
  indoor: boolean;
  ceil: number;
}
interface Hole {
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  win?: "class" | "gym" | "lobby" | "cafe" | "kitchen";
}
interface Piece {
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  s: boolean;
  e: boolean;
  top: boolean;
  bot: boolean;
}

const pt = (e: EdgeSeg, u: number, y: number, w: number): [number, number, number] => (e.dir === "S" ? [e.x0 + u, y, e.z0 + w] : [e.x0 + w, y, e.z0 + u]);
const vec = (e: EdgeSeg, du: number, dy: number, dw: number): [number, number, number] => (e.dir === "S" ? [du, dy, dw] : [dw, dy, du]);

/** Quad that faces the given normal whatever the corner order. */
export function quadN(g: Geo, key: string, p: number[], n: readonly number[], uv: number[] | null, o?: GOpts) {
  const ux = p[3] - p[0],
    uy = p[4] - p[1],
    uz = p[5] - p[2];
  const vx = p[9] - p[0],
    vy = p[10] - p[1],
    vz = p[11] - p[2];
  const cx = uy * vz - uz * vy,
    cy = uz * vx - ux * vz,
    cz = ux * vy - uy * vx;
  if (cx * n[0] + cy * n[1] + cz * n[2] < 0) {
    p = [p[0], p[1], p[2], p[9], p[10], p[11], p[6], p[7], p[8], p[3], p[4], p[5]];
    if (uv) uv = [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]];
    if (o?.cols) o = { ...o, cols: [o.cols[0], o.cols[3], o.cols[2], o.cols[1]] };
  }
  g.quad(key, p, uv, o);
}

function ebox(g: Geo, e: EdgeSeg, key: string, u0: number, u1: number, y0: number, y1: number, w0: number, w1: number, emit: number, o?: GOpts) {
  const fb = FB[e.dir];
  let skip = F_ALL;
  if (emit & EU) skip &= ~fb.up;
  if (emit & EUm) skip &= ~fb.um;
  if (emit & EY) skip &= ~F_PY;
  if (emit & EYm) skip &= ~F_NY;
  if (emit & EW) skip &= ~fb.wp;
  if (emit & EWm) skip &= ~fb.wm;
  const oo = { ...o, skip };
  if (e.dir === "S") g.box(key, e.x0 + u0, y0, e.z0 + Math.min(w0, w1), e.x0 + u1, y1, e.z0 + Math.max(w0, w1), oo);
  else g.box(key, e.x0 + Math.min(w0, w1), y0, e.z0 + u0, e.x0 + Math.max(w0, w1), y1, e.z0 + u1, oo);
}

function equad(g: Geo, e: EdgeSeg, key: string, c: readonly (readonly [number, number, number])[], n: readonly [number, number, number], uv: number[] | null, o?: GOpts) {
  const p: number[] = [];
  for (const [u, y, w] of c) p.push(...pt(e, u, y, w));
  quadN(g, key, p, vec(e, n[0], n[1], n[2]), uv, o);
}

function sideOf(ch: string, hasGenWall: boolean): Side {
  const r = ROOMS[ch];
  if (!r.indoor) return { ch, key: "brick", col: 0xffffff, indoor: false, ceil: 0 };
  let col = WALL_TINT[ch] ?? 0xffffff;
  if (ch === "H" && hasGenWall) col = 0xffffff;
  return { ch, key: WALL_KEY[r.wall], col, indoor: true, ceil: r.ceil };
}

const scaleHex = (hex: number, k: number) => {
  const c = new THREE.Color(hex);
  return c.multiplyScalar(k);
};

// ------------------------------------------------------------------ build

export interface Shell {
  setFrontDoors(open: number): void;
}

let lowQuality = false;

export function buildShell(ctx: Ctx): Shell {
  const g = ctx.geo;
  lowQuality = ctx.quality === "low";
  const hasGen = !!ctx.assets.gen.wall;

  // Wall ends meeting other walls are hidden; only free ends get an end face.
  const vcount = new Map<number, number>();
  const vid = (r: number, c: number) => r * (COLS + 1) + c;
  const ends = (e: EdgeSeg): [number, number] => (e.dir === "S" ? [vid(e.r + 1, e.c), vid(e.r + 1, e.c + 1)] : [vid(e.r, e.c + 1), vid(e.r + 1, e.c + 1)]);
  for (const e of edges) {
    if (e.kind === Edge.Open) continue;
    for (const v of ends(e)) vcount.set(v, (vcount.get(v) ?? 0) + 1);
  }

  const posts = new Set<number>();
  for (const e of edges) {
    if (e.kind === Edge.Fence) {
      fence(ctx, e, ends(e), posts);
      continue;
    }
    const sa = sideOf(e.a, hasGen),
      sb = sideOf(e.b, hasGen);
    const H = !sa.indoor || !sb.indoor ? FACADE_H : Math.max(sa.ceil, sb.ceil);
    const sides: [Side, number][] = [
      [sa, -1],
      [sb, 1],
    ];

    if (e.kind === Edge.Open) {
      if (sa.indoor && sb.indoor && sa.ceil !== sb.ceil) {
        const lo = Math.min(sa.ceil, sb.ceil);
        for (const [sd, s] of sides) {
          const emit = (s < 0 ? EWm : EW) | (sd.ceil > lo ? EYm : 0);
          ebox(g, e, sd.key, 0, T, lo, H, s < 0 ? -H2 : 0, s < 0 ? 0 : H2, emit, { col: sd.col });
          if (sd.ceil > lo) aoStrip(g, e, 0, T, sd.ceil - 0.006, s, 0.4, 0.45, false);
        }
      }
      continue;
    }

    const holes: Hole[] = [];
    let doorH = 0;
    if (e.kind === Edge.Door || e.kind === Edge.Double || e.kind === Edge.Front) {
      const w = OPENING[e.kind];
      doorH = e.kind === Edge.Front ? 3.0 : e.kind === Edge.Double ? 2.45 : 2.25;
      holes.push({ u0: (T - w) / 2, u1: (T + w) / 2, y0: 0, y1: doorH });
    }
    holes.push(...windowHoles(e));
    holes.sort((p, q) => p.u0 - q.u0);

    const [v0, v1] = ends(e);
    const freeS = (vcount.get(v0) ?? 0) <= 1,
      freeE = (vcount.get(v1) ?? 0) <= 1;
    const pieces: Piece[] = [];
    let cur = -H2,
      startFace = freeS;
    for (const ho of holes) {
      if (ho.u0 > cur + 1e-4) pieces.push({ u0: cur, u1: ho.u0, y0: 0, y1: H, s: startFace, e: true, top: false, bot: false });
      if (ho.y0 > 0) pieces.push({ u0: ho.u0, u1: ho.u1, y0: 0, y1: ho.y0, s: false, e: false, top: true, bot: false });
      if (ho.y1 < H) pieces.push({ u0: ho.u0, u1: ho.u1, y0: ho.y1, y1: H, s: false, e: false, top: false, bot: true });
      cur = ho.u1;
      startFace = true;
    }
    if (cur < T + H2 - 1e-4) pieces.push({ u0: cur, u1: T + H2, y0: 0, y1: H, s: startFace, e: freeE, top: false, bot: false });

    for (const pc of pieces)
      for (const [sd, s] of sides) {
        let emit = s < 0 ? EWm : EW;
        if (pc.s) emit |= EUm;
        if (pc.e) emit |= EU;
        if (pc.top) emit |= EY;
        if (pc.bot) emit |= EYm;
        ebox(g, e, sd.key, pc.u0, pc.u1, pc.y0, pc.y1, s < 0 ? -H2 : 0, s < 0 ? 0 : H2, emit, { col: sd.col, grad: sd.indoor ? [0.8, 2.6] : [0.7, 2.4] });
        if (sd.indoor || sd.ch === ".") {
          if (pc.y0 === 0) aoStrip(g, e, pc.u0, pc.u1, sd.indoor ? 0.006 : 0.012, s, 0.5, sd.indoor ? 0.55 : 0.4, true);
          if (sd.indoor && pc.y1 >= sd.ceil - 1e-3 && pc.y0 < sd.ceil) aoStrip(g, e, pc.u0, pc.u1, sd.ceil - 0.006, s, 0.4, 0.45, false);
        }
        if (sd.indoor) bands(g, e, sd, s, pc);
      }

    if (e.kind === Edge.Door || e.kind === Edge.Double) doorway(ctx, e, doorH);
    if (e.kind === Edge.Front) frontFrame(ctx, e);
    for (const ho of holes) if (ho.win) windowDecor(ctx, e, ho);
  }

  floorsAndCeilings(ctx);
  roof(ctx);
  return frontDoors(ctx);
}

// ------------------------------------------------------------- details

function aoStrip(g: Geo, e: EdgeSeg, u0: number, u1: number, y: number, s: number, width: number, k: number, floor: boolean) {
  const w0 = s * H2,
    w1 = s * (H2 + width);
  equad(
    g,
    e,
    "ao",
    [
      [u0, y, w0],
      [u1, y, w0],
      [u1, y, w1],
      [u0, y, w1],
    ],
    [0, floor ? 1 : -1, 0],
    [0.25, 0.98, 0.25, 0.98, 0.25, 0.02, 0.25, 0.02],
    { col: 0, a: k }
  );
}

/** Skirting, stripes, dado and rails on the room side of a wall piece. */
function bands(g: Geo, e: EdgeSeg, sd: Side, s: number, pc: Piece) {
  const face = s * H2;
  const band = (key: string, y0: number, y1: number, t: number, col: Col, ledge: boolean) => {
    if (pc.y0 > y0 + 1e-4 || pc.y1 < y1 - 1e-4) return;
    let emit = (s < 0 ? EWm : EW) | EU | EUm;
    if (ledge) emit |= EY | EYm;
    ebox(g, e, key, pc.u0, pc.u1, y0, y1, face, face + s * t, emit, { col });
  };
  band("paint", 0, 0.1, 0.012, 0x1c1a18, true);
  const ch = sd.ch;
  const room = ROOMS[ch];
  if (ch === "H") {
    band("gloss", 1.05, 1.27, 0.006, 0x6b2222, false);
    band("gloss", 0.98, 1.01, 0.006, 0xb08a3a, false);
  } else if (ch === "G") {
    band("gloss", 1.5, 1.9, 0.006, 0x6b2222, false);
    band("gloss", 1.92, 1.98, 0.006, 0xb08a3a, false);
  } else if (room.wall === "plaster") {
    band("plaster", 0.1, 0.9, 0.006, scaleHex(sd.col, 0.72), false);
    band("wood", 0.88, 0.95, 0.025, 0x7a5032, true);
  } else if (room.wall === "panel") {
    band("wood", 0.88, 0.95, 0.025, 0x4a2e1a, true);
    band("wood", room.ceil - 0.12, room.ceil, 0.04, 0x4a2e1a, true);
  } else if (ch === "Y") {
    band("tile", 1.25, 1.55, 0.006, 0x7a2626, false);
  } else if (ch === "X") {
    band("tile", 1.1, 1.25, 0.006, 0x2d6a58, false);
  } else if (ch === "S") {
    band("tile", 1.45, 1.55, 0.006, 0x2f4f7a, false);
  }
}

function windowHoles(e: EdgeSeg): Hole[] {
  if (e.dir !== "S") return [];
  if (e.r === 0 && "ABCDEF".includes(e.b)) return [{ u0: 0.42, u1: 2.58, y0: 1.0, y1: 2.8, win: "class" }];
  if (e.r === 16 && e.b === ".") {
    if (e.a === "G") return [{ u0: 0.35, u1: 2.65, y0: 4.3, y1: 6.7, win: "gym" }];
    if (e.a === "Y" && [13, 14, 15, 17, 18, 19].includes(e.c)) return [{ u0: 0.3, u1: 2.7, y0: 0.7, y1: 3.6, win: "lobby" }];
    if (e.a === "X") return [{ u0: 0.4, u1: 2.6, y0: 1.0, y1: 3.0, win: "cafe" }];
    if (e.a === "K" && (e.c === 33 || e.c === 35)) return [{ u0: 0.7, u1: 2.3, y0: 1.3, y1: 2.5, win: "kitchen" }];
  }
  return [];
}

const MOON_DIR = new THREE.Vector3(0.28, -0.6, 0.75).normalize();
const LAMP_DIR = new THREE.Vector3(-0.12, -0.62, -0.78).normalize();
const GYM_DIR = new THREE.Vector3(0.1, -0.42, -0.9).normalize();

function windowDecor(ctx: Ctx, e: EdgeSeg, ho: Hole) {
  const g = ctx.geo,
    rng = ctx.rng;
  const kind = ho.win!;
  const s = kind === "class" ? 1 : -1; // room side
  const { u0, u1, y0, y1 } = ho;
  const wdt = u1 - u0,
    hgt = y1 - y0,
    mid = (u0 + u1) / 2;
  const frame = { col: 0x3e3a35 };
  const fb = (a0: number, a1: number, b0: number, b1: number) => ebox(g, e, "metal", a0, a1, b0, b1, -0.035, 0.035, 63, frame);
  fb(u0, u0 + 0.05, y0, y1);
  fb(u1 - 0.05, u1, y0, y1);
  fb(u0, u1, y0, y0 + 0.05);
  fb(u0, u1, y1 - 0.05, y1);
  if (kind === "gym") {
    for (let i = 1; i < 4; i++) fb(u0 + (wdt * i) / 4 - 0.025, u0 + (wdt * i) / 4 + 0.025, y0, y1);
    fb(u0, u1, y0 + hgt * 0.5 - 0.02, y0 + hgt * 0.5 + 0.02);
  } else {
    fb(mid - 0.025, mid + 0.025, y0, y1);
    const tr = kind === "lobby" ? y0 + hgt * 0.72 : y0 + hgt * 0.66;
    fb(u0, u1, tr - 0.02, tr + 0.02);
  }

  const inN: [number, number, number] = [0, 0, s];
  const outN: [number, number, number] = [0, 0, -s];
  const rect = (w: number) =>
    [
      [u0, y0, w],
      [u1, y0, w],
      [u1, y1, w],
      [u0, y1, w],
    ] as [number, number, number][];

  if (kind === "class") {
    equad(g, e, "moon", rect(s * 0.004), inN, [0, 0, 1, 0, 1, 1, 0, 1], { col: new THREE.Color(1.35, 1.35, 1.45) });
    // Wooden sill.
    ebox(g, e, "wood", u0 - 0.05, u1 + 0.05, y0 - 0.035, y0 + 0.01, 0, s * (H2 + 0.07), 63, { col: 0x8a6a4a });
    // Half-drawn blinds, a few hanging crooked.
    const drop = 0.35 + rng() * 0.3;
    const yb = y1 - 0.07 - drop * hgt;
    const tilt = rng() < 0.3 ? (rng() - 0.5) * 0.24 : 0;
    ebox(g, e, "paint", u0 + 0.02, u1 - 0.02, y1 - 0.075, y1 - 0.02, s * 0.045, s * 0.095, 63, { col: 0xd8d0bc });
    const c = pt(e, mid, (yb + y1 - 0.07) / 2, s * 0.07);
    const yaw = Math.atan2(vec(e, 0, 0, s)[0], vec(e, 0, 0, s)[2]);
    const bw = wdt - 0.08,
      bh = y1 - 0.07 - yb;
    g.at(c[0], c[1], c[2], yaw, 0, tilt);
    g.rect("blinds", bw, bh, { u0: 0, v0: 0, u1: bw, v1: bh });
    g.box("paint", -bw / 2, -bh / 2 - 0.03, -0.012, bw / 2, -bh / 2, 0.012, { col: 0xcfc6b0 });
    g.box("paint", bw / 2 - 0.1, -bh / 2 - 0.45, -0.003, bw / 2 - 0.095, -bh / 2, 0.003, { col: 0xe0d8c8 });
    g.reset();
    shaft(g, e, u0 + 0.05, u1 - 0.05, y0 + 0.05, yb, s, MOON_DIR, [0.032, 0.042, 0.07], [0.05, 0.065, 0.11]);
    return;
  }

  // South facade: the outside face and the inside face.
  const boarded = kind !== "gym" && rng() < 0.38;
  ebox(g, e, "concrete", u0 - 0.1, u1 + 0.1, y0 - 0.1, y0, -s * H2, -s * (H2 + 0.08), 63, { col: 0xb0aa9e });
  ebox(g, e, "concrete", u0 - 0.1, u1 + 0.1, y1, y1 + 0.2, -s * H2, -s * (H2 + 0.02), 63, { col: 0xa8a296 });
  if (boarded) {
    const bu0 = u0 - 0.08,
      bu1 = u1 + 0.08,
      by0 = y0 - 0.02,
      by1 = y1 + 0.06;
    ebox(g, e, "wood", bu0, bu1, by0, by1, -s * (H2 + 0.005), -s * (H2 + 0.03), EU | EUm | EY | EYm, { col: 0x6a5238 });
    const gi = (rng() * 3) | 0;
    const r = ctx.atlas.uv(`graffiti${gi}`);
    equad(g, e, "atlas", rect(-s * (H2 + 0.031)).map(([u, y, w]) => [u < mid ? bu0 : bu1, y < (y0 + y1) / 2 ? by0 : by1, w] as [number, number, number]), outN, [r.u0, r.v0, r.u1, r.v0, r.u1, r.v1, r.u0, r.v1]);
    equad(g, e, "wood", rect(-s * 0.03), inN, null, { col: 0x3a3026 });
    equad(g, e, "glass", rect(s * 0.004), inN, null, { col: 0x8899aa, a: 0.16 });
  } else {
    equad(g, e, "darkGlass", rect(-s * 0.004), outN, null);
    // Cool night sky above, a low sodium glow from the car park below.
    const top = new THREE.Color(0.05, 0.06, 0.095),
      mid = new THREE.Color(0.085, 0.09, 0.12),
      bot = new THREE.Color(0.2, 0.12, 0.055);
    const ym = y0 + hgt * 0.35;
    const band = (ya: number, yb: number, ca: THREE.Color, cb: THREE.Color) =>
      equad(
        g,
        e,
        "rainGlass",
        [
          [u0, ya, s * 0.004],
          [u1, ya, s * 0.004],
          [u1, yb, s * 0.004],
          [u0, yb, s * 0.004],
        ],
        inN,
        [u0, ya, u1, ya, u1, yb, u0, yb],
        { cols: [ca, ca, cb, cb] }
      );
    band(y0, ym, bot, mid);
    band(ym, y1, mid, top);
    if (kind === "gym") shaft(g, e, u0 + 0.05, u1 - 0.05, y0 + 0.05, y1 - 0.05, s, GYM_DIR, [0.022, 0.011, 0.003], [0.016, 0.008, 0.002]);
    else if (kind !== "kitchen") shaft(g, e, u0 + 0.05, u1 - 0.05, y0 + 0.05, y1 - 0.05, s, LAMP_DIR, [0.024, 0.012, 0.0035], [0.02, 0.01, 0.0025]);
  }
  if (kind === "gym") {
    // Wire ball guards on the inside.
    equad(g, e, "fence", rect(s * 0.09), inN, [u0, y0, u1, y0, u1, y1, u0, y1]);
  } else {
    ebox(g, e, "concrete", u0 - 0.05, u1 + 0.05, y0 - 0.04, y0 + 0.01, 0, s * (H2 + 0.06), 63, { col: 0xc8c2b6 });
  }
}

/** Fake light shaft through a window plus the pool of light it leaves on the floor. */
function shaft(g: Geo, e: EdgeSeg, u0: number, u1: number, y0: number, y1: number, s: number, dir: THREE.Vector3, col: number[], pool: number[]) {
  if (y1 <= y0 || lowQuality) return;
  // Point the light into the room: the component across the wall takes the room's side.
  const inW = vec(e, 0, 0, s);
  const across = Math.abs(dir.z);
  const wd = e.dir === "S" ? [dir.x, dir.y, across * Math.sign(inW[2])] : [across * Math.sign(inW[0]), dir.y, dir.x];
  const corners = [pt(e, u0, y0, s * 0.01), pt(e, u1, y0, s * 0.01), pt(e, u1, y1, s * 0.01), pt(e, u0, y1, s * 0.01)];
  const proj = corners.map(([x, y, z]) => {
    const t = (y - 0.012) / -wd[1];
    return [x + wd[0] * t, 0.012, z + wd[2] * t];
  });
  const c = new THREE.Color(col[0], col[1], col[2]);
  const sheet = (a: number, b: number) => {
    const p = [...corners[a], ...corners[b], ...proj[b], ...proj[a]];
    g.quad("beam", p, [0, 0, 1, 0, 1, 1, 0, 1], { col: c });
  };
  sheet(0, 1);
  sheet(3, 2);
  sheet(0, 3);
  sheet(1, 2);
  const pc = new THREE.Color(pool[0], pool[1], pool[2]);
  quadN(g, "beam", [...proj[0], ...proj[1], ...proj[2], ...proj[3]], [0, 1, 0], [2, 0, 3, 0, 3, 1, 2, 1], { col: pc });
}

/** Door frame, threshold, sign and leaves for an ordinary doorway. */
function doorway(ctx: Ctx, e: EdgeSeg, dh: number) {
  const g = ctx.geo,
    rng = ctx.rng;
  const w = OPENING[e.kind];
  const ua = (T - w) / 2,
    ub = (T + w) / 2;
  const fr = { col: 0x34373a };
  ebox(g, e, "metal", ua, ua + 0.05, 0, dh, -0.13, 0.13, 63, fr);
  ebox(g, e, "metal", ub - 0.05, ub, 0, dh, -0.13, 0.13, 63, fr);
  ebox(g, e, "metal", ua, ub, dh - 0.05, dh, -0.13, 0.13, 63, fr);
  ebox(g, e, "chrome", ua + 0.05, ub - 0.05, 0, 0.01, -0.1, 0.1, EY | EW | EWm, { col: 0x8a8478 });

  // Doors swing into rooms, not into halls or the lobby.
  const A = ROOMS[e.a],
    B = ROOMS[e.b];
  const corridor = (t: string) => t === "hall" || t === "lobby";
  let into = 1;
  if (corridor(B.type) && !corridor(A.type)) into = -1;
  else if (corridor(A.type) && !corridor(B.type)) into = 1;
  else if (A.type === "gym") into = -1;
  const roomCh = into < 0 ? e.a : e.b;

  // Room sign over the door on the corridor side.
  const signName = `sign${roomCh}`;
  try {
    const r = ctx.atlas.uv(signName);
    const p = pt(e, T / 2, dh + 0.22, -into * (H2 + 0.012));
    const n = vec(e, 0, 0, -into);
    g.at(p[0], p[1], p[2], Math.atan2(n[0], n[2]));
    g.rect("atlas", 0.8, 0.2, r);
    g.reset();
  } catch {
    /* no sign for this room */
  }

  const inner0 = ua + 0.05,
    inner1 = ub - 0.05;
  const clear = inner1 - inner0 - 0.01;
  const leaves: { hinge: number; dirU: number; width: number; angle: number }[] = [];
  if (e.kind === Edge.Door) {
    const left = rng() < 0.5;
    leaves.push({ hinge: left ? inner0 : inner1, dirU: left ? 1 : -1, width: clear, angle: (78 + rng() * 40) * (Math.PI / 180) });
  } else {
    const wide = rng() < 0.5;
    leaves.push({ hinge: inner0, dirU: 1, width: clear / 2, angle: (wide ? 80 + rng() * 20 : 25 + rng() * 20) * (Math.PI / 180) });
    leaves.push({ hinge: inner1, dirU: -1, width: clear / 2, angle: (wide ? 25 + rng() * 20 : 80 + rng() * 20) * (Math.PI / 180) });
  }
  const style = e.kind === Edge.Door ? "wood" : "metal";
  const paint = [0x31535e, 0x5e2424, 0x4a4f3a][(rng() * 3) | 0];
  const woodCol = [0xb07a4a, 0x9a6a40, 0xa47a52][(rng() * 3) | 0];
  for (const L of leaves) {
    const hw = pt(e, L.hinge, 0, into * 0.06);
    // Leaf direction in edge space, then world.
    const du = L.dirU * Math.cos(L.angle),
      dw = into * Math.sin(L.angle);
    const d = vec(e, du, 0, dw);
    const yaw = Math.atan2(-d[2], d[0]);
    // Which local z side faces away from the swing (the push side).
    const c0 = vec(e, L.dirU, 0, 0);
    const yaw0 = Math.atan2(-c0[2], c0[0]);
    const iw = vec(e, 0, 0, into);
    const swingZ = Math.sin(yaw0) * iw[0] + Math.cos(yaw0) * iw[2] > 0 ? 1 : -1;
    g.at(hw[0], 0, hw[2], yaw);
    leaf(g, style, L.width, dh - 0.06, -swingZ, style === "wood" ? woodCol : paint);
    g.reset();
    // Collision along the leaf as a few short boxes.
    for (let i = 0; i < 3; i++) {
      const t0 = (i / 3) * L.width,
        t1 = ((i + 1) / 3) * L.width;
      const ax = hw[0] + d[0] * t0,
        az = hw[2] + d[2] * t0,
        bx = hw[0] + d[0] * t1,
        bz = hw[2] + d[2] * t1;
      solid(Math.min(ax, bx) - 0.035, Math.max(ax, bx) + 0.035, Math.min(az, bz) - 0.035, Math.max(az, bz) + 0.035);
    }
  }
  // Exit signs over the doors people would flee through.
  if (e.kind === Edge.Double) {
    const p = pt(e, T / 2, dh + 0.5, into * (H2 + 0.08));
    const n = vec(e, 0, 0, into);
    exitSign(g, ctx, p[0], p[1], p[2], Math.atan2(n[0], n[2]));
  }
}

/** A door leaf in the current frame: hinge at the origin, leaf along +x, push side towards pushZ. */
function leaf(g: Geo, style: "wood" | "metal", W: number, Hh: number, pushZ: number, col: number) {
  const t = 0.045,
    z0 = -t / 2,
    z1 = t / 2;
  const key = style === "wood" ? "wood" : "gloss";
  const hx0 = style === "wood" ? W - 0.42 : W * 0.5 - 0.1,
    hx1 = style === "wood" ? W - 0.24 : W * 0.5 + 0.1;
  const hy0 = style === "wood" ? 1.15 : 1.2,
    hy1 = style === "wood" ? 1.9 : 2.0;
  const o = { col, uv: 1 };
  g.box(key, 0, 0, z0, hx0, Hh, z1, o);
  g.box(key, hx1, 0, z0, W, Hh, z1, o);
  g.box(key, hx0, 0, z0, hx1, hy0, z1, o);
  g.box(key, hx0, hy1, z0, hx1, Hh, z1, o);
  g.box("glass", hx0, hy0, -0.004, hx1, hy1, 0.004, { col: 0xb8c8d0, a: 0.28, skip: F_PX | F_NX | F_PY | F_NY });
  const k = { col: 0x9a9890 };
  g.box("chrome", 0.03, 0.0, z1, W - 0.03, 0.25, z1 + 0.002, k);
  g.box("chrome", 0.03, 0.0, z0 - 0.002, W - 0.03, 0.25, z0, k);
  // Hinges.
  for (const y of [0.25, 1.1, Hh - 0.25]) g.box("chrome", -0.012, y - 0.06, -0.01, 0.012, y + 0.06, 0.01, k);
  if (style === "wood") {
    for (const sz of [1, -1]) {
      const zf = sz > 0 ? z1 : z0;
      g.box("chrome", W - 0.11, 0.97, zf, W - 0.06, 1.03, zf + sz * 0.02, k);
      g.box("chrome", W - 0.2, 0.985, zf + sz * 0.015, W - 0.07, 1.015, zf + sz * 0.035, k);
    }
  } else {
    // Push bar on the push side, pull handle on the other.
    const zp = pushZ > 0 ? z1 : z0;
    g.box("chrome", 0.08, 0.98, zp, 0.12, 1.08, zp + pushZ * 0.07, k);
    g.box("chrome", W - 0.12, 0.98, zp, W - 0.08, 1.08, zp + pushZ * 0.07, k);
    g.box("chrome", 0.08, 1.0, zp + pushZ * 0.05, W - 0.08, 1.06, zp + pushZ * 0.08, k);
    const zq = pushZ > 0 ? z0 : z1;
    g.box("chrome", W - 0.14, 0.75, zq, W - 0.1, 1.35, zq - pushZ * 0.05, k);
  }
}

export function exitSign(g: Geo, ctx: Ctx, x: number, y: number, z: number, yaw: number) {
  g.at(x, y, z, yaw);
  g.box("paint", -0.17, -0.08, -0.07, 0.17, 0.08, 0.0, { col: 0xd9d6cc });
  g.sub(0, 0, 0.002);
  g.rect("glow", 0.3, 0.12, ctx.atlas.uv("exit"), { col: new THREE.Color(2.6, 2.6, 2.6) });
  g.reset();
}

/** Aluminium storefront frame and transom around the front entrance. */
function frontFrame(ctx: Ctx, e: EdgeSeg) {
  const g = ctx.geo;
  const w = OPENING[Edge.Front];
  const ua = (T - w) / 2,
    ub = (T + w) / 2;
  const al = { col: 0x9a9c98 };
  ebox(g, e, "chrome", ua, ua + 0.06, 0, 3.0, -0.08, 0.08, 63, al);
  ebox(g, e, "chrome", ub - 0.06, ub, 0, 3.0, -0.08, 0.08, 63, al);
  ebox(g, e, "chrome", ua, ub, 2.94, 3.0, -0.08, 0.08, 63, al);
  ebox(g, e, "chrome", ua, ub, 2.33, 2.42, -0.08, 0.08, 63, al);
  ebox(g, e, "chrome", T / 2 - 0.03, T / 2 + 0.03, 2.42, 2.94, -0.06, 0.06, 63, al);
  ebox(g, e, "chrome", ua + 0.06, ub - 0.06, 0, 0.012, -0.12, 0.12, EY | EW | EWm, { col: 0x8a8478 });
  // Transom glass, both faces.
  const tg = (ww: number, n: number) =>
    equad(
      g,
      e,
      "glass",
      [
        [ua + 0.06, 2.42, ww],
        [ub - 0.06, 2.42, ww],
        [ub - 0.06, 2.94, ww],
        [ua + 0.06, 2.94, ww],
      ],
      [0, 0, n],
      null,
      { col: 0x9fb2bb, a: 0.25 }
    );
  tg(0.004, 1);
  tg(-0.004, -1);
  // Exit sign inside, above the doors.
  const p = pt(e, T / 2, 3.35, -(H2 + 0.08));
  exitSign(g, ctx, p[0], p[1], p[2], Math.PI);
}

/** Front entrance doors (animated): aluminium-framed glass with push bars, chain and padlock. */
function frontDoors(ctx: Ctx): Shell {
  const e = edges.find((q) => q.kind === Edge.Front)!;
  const w = OPENING[Edge.Front];
  const x0 = e.x0 + (T - w) / 2 + 0.06,
    x1 = e.x0 + (T + w) / 2 - 0.06;
  const W = (x1 - x0) / 2 - 0.006,
    Hh = 2.32;
  const zc = e.z0;
  const mats = ctx.mats;

  // One leaf, hinge at the origin, extending along +x, inside (lobby) towards -z.
  const lg = new Geo();
  const al = { col: 0x9a9c98 };
  const t = 0.05;
  lg.box("chrome", 0, 0, -t / 2, 0.09, Hh, t / 2, al);
  lg.box("chrome", W - 0.09, 0, -t / 2, W, Hh, t / 2, al);
  lg.box("chrome", 0.09, Hh - 0.09, -t / 2, W - 0.09, Hh, t / 2, al);
  lg.box("chrome", 0.09, 0, -t / 2, W - 0.09, 0.24, t / 2, al);
  lg.box("chrome", 0.09, 1.0, -t / 2, W - 0.09, 1.06, t / 2, al);
  // Push bar inside, pull handle outside.
  lg.box("chrome", 0.15, 0.95, -t / 2 - 0.07, 0.19, 1.07, -t / 2, al);
  lg.box("chrome", W - 0.19, 0.95, -t / 2 - 0.07, W - 0.15, 1.07, -t / 2, al);
  lg.tube("chrome", 0.15, 1.01, -t / 2 - 0.075, W - 0.15, 1.01, -t / 2 - 0.075, 0.022, 10, { col: 0xb0b2ae });
  lg.tube("chrome", W - 0.16, 0.7, t / 2 + 0.06, W - 0.16, 1.5, t / 2 + 0.06, 0.016, 8, { col: 0xb0b2ae });
  lg.box("chrome", W - 0.18, 0.7, t / 2, W - 0.14, 0.74, t / 2 + 0.06, al);
  lg.box("chrome", W - 0.18, 1.46, t / 2, W - 0.14, 1.5, t / 2 + 0.06, al);
  lg.box("doorGlass", 0.09, 0.24, -0.006, W - 0.09, 1.0, 0.006, { skip: F_PX | F_NX | F_PY | F_NY });
  lg.box("doorGlass", 0.09, 1.06, -0.006, W - 0.09, Hh - 0.09, 0.006, { skip: F_PX | F_NX | F_PY | F_NY });
  const leafMeshes = lg.build({ chrome: mats.mats.chrome, doorGlass: mats.doorGlass }, (k) => ({ cast: k === "chrome", receive: true, order: k === "doorGlass" ? 5 : undefined }));
  const makeLeaf = (hx: number, mirror: boolean) => {
    const pivot = new THREE.Group();
    pivot.name = "level.frontDoor";
    pivot.position.set(hx, 0, zc);
    if (mirror) pivot.scale.x = -1;
    for (const m of leafMeshes.values()) {
      const c = m.clone();
      c.matrixAutoUpdate = true;
      pivot.add(c);
    }
    ctx.scene.add(pivot);
    ctx.objects.push(...pivot.children);
    return pivot;
  };
  const left = makeLeaf(x0, false);
  const right = makeLeaf(x1, true);

  // Chain wrapped round both push bars, with a padlock.
  const zBar = zc - t / 2 - 0.075;
  const xm = (x0 + x1) / 2;
  const cg = new Geo();
  const link = new THREE.TorusGeometry(0.02, 0.0055, 5, 10);
  const path: THREE.Vector3[] = [];
  for (const bx of [xm - 0.24, xm + 0.24])
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      path.push(new THREE.Vector3(bx + (i / 14 - 0.5) * 0.06, 1.01 + Math.cos(a) * 0.05, zBar + Math.sin(a) * 0.05));
    }
  path.push(new THREE.Vector3(xm, 0.88, zBar - 0.04));
  const curve = new THREE.CatmullRomCurve3(path);
  const n = 46;
  for (let i = 0; i < n; i++) {
    const p = curve.getPointAt(i / n),
      tng = curve.getTangentAt(i / n);
    const yaw = Math.atan2(tng.x, tng.z);
    const pitch = -Math.asin(Math.max(-1, Math.min(1, tng.y)));
    cg.at(p.x, p.y, p.z, yaw, pitch, i % 2 ? Math.PI / 2 : 0);
    cg.sub(0, 0, 0, Math.PI / 2);
    cg.scale(1.5, 1, 1);
    cg.geom("chrome", link, { col: 0x6d6f70 });
  }
  cg.at(xm, 0.8, zBar - 0.04);
  cg.box("chrome", -0.04, -0.05, -0.015, 0.04, 0.03, 0.015, { col: 0xb08d3a });
  cg.sub(0, 0.03, 0, 0, 0, 0);
  cg.geom("chrome", new THREE.TorusGeometry(0.025, 0.006, 6, 12, Math.PI), { col: 0x9a9c98 });
  cg.reset();
  const chainOn = [...cg.build({ chrome: mats.mats.chrome }, () => ({ cast: false, receive: true })).values()];
  // The same chain lying on the floor once the doors are open.
  const fg = new Geo();
  for (let i = 0; i < 30; i++) {
    const a = i * 0.45;
    fg.at(xm - 0.6 + Math.cos(a) * 0.18 + i * 0.012, 0.01, zc - 0.7 + Math.sin(a) * 0.12, a, Math.PI / 2, i % 2 ? Math.PI / 2 : 0);
    fg.scale(1.5, 1, 1);
    fg.geom("chrome", link, { col: 0x6d6f70 });
  }
  fg.at(xm - 0.25, 0.02, zc - 0.55, 0.6);
  fg.box("chrome", -0.04, -0.015, -0.05, 0.04, 0.015, 0.03, { col: 0xb08d3a });
  fg.reset();
  const chainOff = [...fg.build({ chrome: mats.mats.chrome }, () => ({ cast: false, receive: true })).values()];
  for (const m of [...chainOn, ...chainOff]) {
    ctx.scene.add(m);
    ctx.objects.push(m);
  }

  const MAXA = 1.45;
  let state = -1;
  const set = (open: number) => {
    const o = Math.max(0, Math.min(1, open));
    if (o === state) return;
    state = o;
    // Ease so the swing slows as the door reaches the wall.
    const k = 1 - (1 - o) * (1 - o);
    left.rotation.y = -MAXA * k;
    right.rotation.y = MAXA * k;
    const shut = o < 0.03;
    for (const m of chainOn) m.visible = shut;
    for (const m of chainOff) m.visible = !shut;
  };
  // map.ts starts with the entrance unlocked, so the doors start open (chain on the floor).
  set(1);
  return { setFrontDoors: set };
}

// ---------------------------------------------------------- floors etc.

function floorsAndCeilings(ctx: Ctx) {
  const g = ctx.geo;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const k = GRID[r][c];
      if (k === " ") continue;
      const room = ROOMS[k];
      const x0 = c * T,
        z0 = r * T;
      g.flat(FLOOR_KEY[room.floor], x0, z0, x0 + T, z0 + T, 0, null, { col: FLOOR_TINT[k] ?? 0xffffff });
      if (!room.indoor) continue;
      const y = room.ceil;
      const key = k === "G" ? "deck" : k === "W" ? "concrete" : k === "Y" ? "plaster" : "ceiling";
      const col = k === "W" ? 0x7a7872 : k === "Y" ? 0xe8e4da : 0xffffff;
      g.quad(key, [x0, y, z0, x0 + T, y, z0, x0 + T, y, z0 + T, x0, y, z0 + T], [x0, z0, x0 + T, z0, x0 + T, z0 + T, x0, z0 + T], { col });
    }
}

function roof(ctx: Ctx) {
  const g = ctx.geo;
  const y = FACADE_H;
  g.box("concrete", 2.9, y, 2.9, 111.1, y + 0.25, 51.1, { col: 0x3d3d3d, skip: F_NY });
  const cp = { col: 0x7a7d7e };
  g.box("metal", 2.82, y + 0.1, 2.82, 111.18, y + 0.42, 3.2, cp);
  g.box("metal", 2.82, y + 0.1, 50.8, 111.18, y + 0.42, 51.18, cp);
  g.box("metal", 2.82, y + 0.1, 3.2, 3.2, y + 0.42, 50.8, cp);
  g.box("metal", 110.8, y + 0.1, 3.2, 111.18, y + 0.42, 50.8, cp);
  // Boiler chimney and rooftop plant, visible above the parapet from the car park.
  g.box("brick", 87, y, 24, 88.8, 15.2, 25.8, { skip: F_NY });
  g.box("concrete", 86.85, 15.2, 23.85, 88.95, 15.45, 25.95, { col: 0x77736b });
  g.box("metal", 20, y + 0.25, 30, 24, y + 1.9, 33, { col: 0x6f7477 });
  g.box("metal", 70, y + 0.25, 40, 73, y + 1.5, 42.5, { col: 0x6f7477 });
  g.tube("metal", 22, y + 1.9, 31.5, 22, y + 2.6, 31.5, 0.35, 12, { col: 0x5a5e60 });
  // Concrete plinth along the facade and downpipes.
  const fz = 51.1;
  g.box("concrete", 2.9, 0, fz, 48.1, 0.4, fz + 0.03, { col: 0x9c968a });
  g.box("concrete", 50.9, 0, fz, 111.1, 0.4, fz + 0.03, { col: 0x9c968a });
  for (const x of [3.3, 36, 63, 96, 110.7]) {
    g.tube("metal", x, 0.05, fz + 0.09, x, FACADE_H + 0.1, fz + 0.09, 0.055, 8, { col: 0x5a5e60 });
    g.box("metal", x - 0.08, 0, fz + 0.03, x + 0.08, 0.12, fz + 0.3, { col: 0x5a5e60 });
  }
}

/** Chain-link fence with posts, top rail and barbed wire. */
function fence(ctx: Ctx, e: EdgeSeg, vs: [number, number], posts: Set<number>) {
  const g = ctx.geo;
  const Hf = 2.2;
  const out = e.a === " " ? -1 : 1;
  const a0 = e.dir === "S" ? e.x0 : e.z0;
  equad(
    g,
    e,
    "fence",
    [
      [0, 0.03, 0],
      [T, 0.03, 0],
      [T, Hf, 0],
      [0, Hf, 0],
    ],
    [0, 0, 1],
    [a0, 0.03, a0 + T, 0.03, a0 + T, Hf, a0, Hf]
  );
  const pc = { col: 0x6d7378 };
  const rail = (u0: number, y0: number, w0: number, u1: number, y1: number, w1: number, rad: number, seg = 6) => {
    const p = pt(e, u0, y0, w0),
      q = pt(e, u1, y1, w1);
    g.tube("metal", p[0], p[1], p[2], q[0], q[1], q[2], rad, seg, pc);
  };
  rail(0, Hf, 0, T, Hf, 0, 0.022);
  rail(0, 0.08, 0, T, 0.08, 0, 0.008, 4);
  for (const [k, v] of [
    [0, vs[0]],
    [T, vs[1]],
  ] as const) {
    if (posts.has(v)) continue;
    posts.add(v);
    rail(k, 0, 0, k, Hf + 0.08, 0, 0.045, 8);
    rail(k, Hf + 0.05, 0, k, Hf + 0.42, out * 0.3, 0.012, 4);
  }
  for (let i = 0; i < 3; i++) rail(0, Hf + 0.15 + i * 0.12, out * (0.1 + i * 0.1), T, Hf + 0.15 + i * 0.12, out * (0.1 + i * 0.1), 0.004, 3);
  // Chained gate in the south fence.
  if (e.dir === "S" && e.r === ROWS - 2 && e.c >= 15 && e.c <= 17) {
    const z = e.z0;
    if (e.c === 16) {
      for (const x of [45.2, 49.4, 49.6, 53.8]) g.tube("metal", x, 0.1, z - 0.05, x, 2.1, z - 0.05, 0.03, 8, { col: 0x7a8085 });
      for (const [xa, xb] of [
        [45.2, 49.4],
        [49.6, 53.8],
      ]) {
        g.tube("metal", xa, 2.1, z - 0.05, xb, 2.1, z - 0.05, 0.03, 8, { col: 0x7a8085 });
        g.tube("metal", xa, 0.1, z - 0.05, xb, 0.1, z - 0.05, 0.03, 8, { col: 0x7a8085 });
        g.tube("metal", xa, 0.1, z - 0.05, xb, 2.1, z - 0.05, 0.02, 6, { col: 0x7a8085 });
      }
      for (const x of [45, 54]) g.tube("metal", x, 0, z, x, 2.5, z, 0.07, 10, { col: 0x5d6368 });
      g.box("chrome", 49.45, 1.0, z - 0.12, 49.55, 1.1, z - 0.07, { col: 0xb08d3a });
      g.at(47.3, 1.35, z - 0.08, Math.PI);
      g.rect("atlas", 1.0, 0.62, ctx.atlas.uv("noTrespass"));
      g.reset();
    }
  }
}
