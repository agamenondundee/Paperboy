import { clamp } from "../core/util";

/** Cell size in metres. Walls sit on cell edges, so they can be thin. */
export const T = 3;
export const WT = 0.2;

// Each character is one 3 m cell. Different letters next to each other get a
// wall between them unless a doorway is listed below. North is up.
const LAYOUT = [
  "                                      ",
  " AAAAAABBBBBBCCCCCCDDDDDDEEEEEEFFFFFF ",
  " AAAAAABBBBBBCCCCCCDDDDDDEEEEEEFFFFFF ",
  " AAAAAABBBBBBCCCCCCDDDDDDEEEEEEFFFFFF ",
  " AAAAAABBBBBBCCCCCCDDDDDDEEEEEEFFFFFF ",
  " HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH ",
  " GGGGGGGGGGGHLLLLLLLLHPPPPPWWWWWHSSSS ",
  " GGGGGGGGGGGHLLLLLLLLHPPPPPWWWWWHSSSS ",
  " GGGGGGGGGGGHLLLLLLLLHPPPPPWWWWWHSSSS ",
  " GGGGGGGGGGGHLLLLLLLLHPPPPPWWWWWHSSSS ",
  " GGGGGGGGGGGHLLLLLLLLHPPPPPWWWWWHSSSS ",
  " GGGGGGGGGGGHLLLLLLLLHPPPPPWWWWWHSSSS ",
  " GGGGGGGGGGGHHHHHHHHHHHHHHHHHHHHHHHHH ",
  " GGGGGGGGGGGYYYYYYYYYXXXXXXXXXXXKKKKK ",
  " GGGGGGGGGGGYYYYYYYYYXXXXXXXXXXXKKKKK ",
  " GGGGGGGGGGGYYYYYYYYYXXXXXXXXXXXKKKKK ",
  " GGGGGGGGGGGYYYYYYYYYXXXXXXXXXXXKKKKK ",
  " .................................... ",
  " .................................... ",
  " .................................... ",
  " .................................... ",
  " .................................... ",
  " .................................... ",
  " .................................... ",
  " .................................... ",
  " .................................... ",
  " .................................... ",
  " .................................... ",
  "                                      ",
];

export const ROWS = LAYOUT.length;
export const COLS = LAYOUT[0].length;
export const GRID: string[][] = LAYOUT.map((r) => r.split(""));

export type RoomType = "class" | "hall" | "gym" | "library" | "office" | "boiler" | "lab" | "lobby" | "cafe" | "kitchen" | "lot" | "void";
export type FloorKind = "vinyl" | "wood" | "carpet" | "concrete" | "checker" | "terrazzo" | "asphalt";
export type WallKind = "block" | "plaster" | "tile" | "brick" | "panel";

export interface RoomDef {
  name: string;
  type: RoomType;
  ceil: number;
  floor: FloorKind;
  wall: WallKind;
  indoor: boolean;
}

export const ROOMS: Record<string, RoomDef> = {
  A: { name: "Room 101, English", type: "class", ceil: 3.2, floor: "vinyl", wall: "plaster", indoor: true },
  B: { name: "Room 102, History", type: "class", ceil: 3.2, floor: "vinyl", wall: "plaster", indoor: true },
  C: { name: "Room 103, Maths", type: "class", ceil: 3.2, floor: "vinyl", wall: "plaster", indoor: true },
  D: { name: "Room 104, Music", type: "class", ceil: 3.2, floor: "wood", wall: "panel", indoor: true },
  E: { name: "Room 105, Geography", type: "class", ceil: 3.2, floor: "vinyl", wall: "plaster", indoor: true },
  F: { name: "Art Room", type: "class", ceil: 3.2, floor: "concrete", wall: "plaster", indoor: true },
  H: { name: "Hallway", type: "hall", ceil: 3.2, floor: "vinyl", wall: "block", indoor: true },
  G: { name: "Gymnasium", type: "gym", ceil: 7.5, floor: "wood", wall: "block", indoor: true },
  L: { name: "Library", type: "library", ceil: 4.2, floor: "carpet", wall: "panel", indoor: true },
  P: { name: "Principal's Office", type: "office", ceil: 3.2, floor: "carpet", wall: "panel", indoor: true },
  W: { name: "Boiler Room", type: "boiler", ceil: 3.6, floor: "concrete", wall: "block", indoor: true },
  S: { name: "Science Lab", type: "lab", ceil: 3.2, floor: "vinyl", wall: "tile", indoor: true },
  Y: { name: "Entrance Lobby", type: "lobby", ceil: 5.0, floor: "terrazzo", wall: "tile", indoor: true },
  X: { name: "Cafeteria", type: "cafe", ceil: 4.0, floor: "checker", wall: "tile", indoor: true },
  K: { name: "Kitchen", type: "kitchen", ceil: 3.2, floor: "concrete", wall: "tile", indoor: true },
  ".": { name: "Car Park", type: "lot", ceil: 0, floor: "asphalt", wall: "brick", indoor: false },
  " ": { name: "", type: "void", ceil: 0, floor: "asphalt", wall: "brick", indoor: false },
};

export const FACADE_H = 7.6;

export const enum Edge {
  None = 0,
  Wall = 1,
  Door = 2,
  Double = 3,
  Open = 4,
  Front = 5,
  Fence = 6,
}

/** Opening width for each doorway kind. */
export const OPENING: Record<number, number> = { [Edge.Door]: 1.3, [Edge.Double]: 2.5, [Edge.Front]: 2.8, [Edge.Open]: T };

type DoorSpec = [r: number, c: number, dir: "S" | "E", kind: Edge];
const DOORS: DoorSpec[] = [
  [4, 3, "S", Edge.Door],
  [4, 9, "S", Edge.Door],
  [4, 15, "S", Edge.Door],
  [4, 21, "S", Edge.Door],
  [4, 27, "S", Edge.Door],
  [4, 33, "S", Edge.Door],
  [5, 6, "S", Edge.Double],
  [12, 11, "E", Edge.Double],
  [14, 11, "E", Edge.Double],
  [5, 16, "S", Edge.Door],
  [11, 17, "S", Edge.Door],
  [8, 21, "E", Edge.Door],
  [11, 29, "S", Edge.Door],
  [8, 32, "E", Edge.Door],
  [12, 14, "S", Edge.Open],
  [12, 15, "S", Edge.Open],
  [12, 16, "S", Edge.Open],
  [12, 17, "S", Edge.Open],
  [12, 18, "S", Edge.Open],
  [12, 24, "S", Edge.Double],
  [12, 30, "S", Edge.Door],
  [14, 20, "E", Edge.Double],
  [14, 31, "E", Edge.Door],
  [16, 16, "S", Edge.Front],
];

/** hEdge[r][c]: edge between (r,c) and (r+1,c). vEdge[r][c]: between (r,c) and (r,c+1). */
export const hEdge: Edge[][] = [];
export const vEdge: Edge[][] = [];

export const ch = (r: number, c: number) => (r < 0 || c < 0 || r >= ROWS || c >= COLS ? " " : GRID[r][c]);
export const roomOf = (r: number, c: number) => ROOMS[ch(r, c)];

function classify(a: string, b: string): Edge {
  if (a === b) return Edge.None;
  if (a === " " && b === " ") return Edge.None;
  if ((a === "." && b === " ") || (a === " " && b === ".")) return Edge.Fence;
  return Edge.Wall;
}
for (let r = 0; r < ROWS; r++) {
  hEdge.push([]);
  vEdge.push([]);
  for (let c = 0; c < COLS; c++) {
    hEdge[r].push(classify(ch(r, c), ch(r + 1, c)));
    vEdge[r].push(classify(ch(r, c), ch(r, c + 1)));
  }
}
for (const [r, c, dir, kind] of DOORS) (dir === "S" ? hEdge : vEdge)[r][c] = kind;

export const cellOf = (x: number, z: number): [number, number] => [clamp(Math.floor(z / T), 0, ROWS - 1), clamp(Math.floor(x / T), 0, COLS - 1)];
export const centre = (r: number, c: number) => ({ x: c * T + T / 2, z: r * T + T / 2 });
export const charAt = (x: number, z: number) => {
  const [r, c] = cellOf(x, z);
  return ch(r, c);
};
export const isIndoor = (x: number, z: number) => ROOMS[charAt(x, z)].indoor;

/** Cells grouped by room character. */
export const ROOM_CELLS: Record<string, [number, number][]> = {};
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    const k = GRID[r][c];
    (ROOM_CELLS[k] ||= []).push([r, c]);
  }

export function roomBounds(k: string) {
  const cells = ROOM_CELLS[k];
  let r0 = 1e9,
    r1 = -1,
    c0 = 1e9,
    c1 = -1;
  for (const [r, c] of cells) {
    r0 = Math.min(r0, r);
    r1 = Math.max(r1, r);
    c0 = Math.min(c0, c);
    c1 = Math.max(c1, c);
  }
  return { r0, r1, c0, c1, x0: c0 * T, x1: (c1 + 1) * T, z0: r0 * T, z1: (r1 + 1) * T };
}

// ------------------------------------------------------------- collision
export interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  solid: boolean;
  sight: boolean; // blocks line of sight
  wall: boolean; // ghosts collide with walls only
  tag?: string;
}

const boxGrid: Box[][] = Array.from({ length: ROWS * COLS }, () => []);
export const boxes: Box[] = [];

export function addBox(x0: number, x1: number, z0: number, z1: number, o: Partial<Box> = {}): Box {
  const b: Box = { x0, x1, z0, z1, solid: true, sight: false, wall: false, ...o };
  boxes.push(b);
  const m = 0.5;
  const r0 = Math.max(0, Math.floor((z0 - m) / T)),
    r1 = Math.min(ROWS - 1, Math.floor((z1 + m) / T));
  const c0 = Math.max(0, Math.floor((x0 - m) / T)),
    c1 = Math.min(COLS - 1, Math.floor((x1 + m) / T));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) boxGrid[r * COLS + c].push(b);
  return b;
}

export interface EdgeSeg {
  r: number;
  c: number;
  dir: "S" | "E";
  kind: Edge;
  a: string; // room char on the north or west side
  b: string; // room char on the south or east side
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export const edges: EdgeSeg[] = [];
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    const h = hEdge[r][c];
    if (h !== Edge.None) edges.push({ r, c, dir: "S", kind: h, a: ch(r, c), b: ch(r + 1, c), x0: c * T, x1: (c + 1) * T, z0: (r + 1) * T, z1: (r + 1) * T });
    const v = vEdge[r][c];
    if (v !== Edge.None) edges.push({ r, c, dir: "E", kind: v, a: ch(r, c), b: ch(r, c + 1), x0: (c + 1) * T, x1: (c + 1) * T, z0: r * T, z1: (r + 1) * T });
  }

/** Solid wall pieces along an edge, as [start, end] distances from the edge's start. */
export function wallSpans(e: EdgeSeg): [number, number][] {
  const h = WT / 2;
  if (e.kind === Edge.Wall || e.kind === Edge.Fence) return [[-h, T + h]];
  if (e.kind === Edge.Open) return [];
  const w = OPENING[e.kind];
  return [
    [-h, (T - w) / 2],
    [(T + w) / 2, T + h],
  ];
}

let frontBlock: Box | null = null;
for (const e of edges) {
  const fence = e.kind === Edge.Fence;
  for (const [s0, s1] of wallSpans(e)) {
    if (e.dir === "S") addBox(e.x0 + s0, e.x0 + s1, e.z0 - WT / 2, e.z0 + WT / 2, { sight: !fence, wall: true });
    else addBox(e.x0 - WT / 2, e.x0 + WT / 2, e.z0 + s0, e.z0 + s1, { sight: !fence, wall: true });
  }
  if (e.kind === Edge.Front) {
    const w = OPENING[Edge.Front];
    frontBlock = addBox(e.x0 + (T - w) / 2, e.x0 + (T + w) / 2, e.z0 - WT / 2, e.z0 + WT / 2, { sight: false, wall: true, tag: "front" });
  }
}

export let doorsVersion = 0;
export let frontLocked = false;
export function setFrontLocked(v: boolean) {
  frontLocked = v;
  if (frontBlock) frontBlock.solid = v;
  doorsVersion++;
}
setFrontLocked(false);

/** Push a circle out of solid boxes. Ghosts only collide with walls. */
export function collide(p: { x: number; z: number }, rad: number, ghost = false) {
  for (let it = 0; it < 3; it++) {
    const [r, c] = cellOf(p.x, p.z);
    const list = boxGrid[r * COLS + c];
    let moved = false;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b.solid || (ghost && !b.wall)) continue;
      const cx = clamp(p.x, b.x0, b.x1),
        cz = clamp(p.z, b.z0, b.z1);
      const dx = p.x - cx,
        dz = p.z - cz,
        d2 = dx * dx + dz * dz;
      if (d2 >= rad * rad) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2),
          k = (rad - d) / d;
        p.x += dx * k;
        p.z += dz * k;
      } else {
        // Centre inside the box: leave by the shallowest side.
        const l = p.x - b.x0 + rad,
          rr = b.x1 - p.x + rad,
          u = p.z - b.z0 + rad,
          dd = b.z1 - p.z + rad;
        const m = Math.min(l, rr, u, dd);
        if (m === l) p.x -= l;
        else if (m === rr) p.x += rr;
        else if (m === u) p.z -= u;
        else p.z += dd;
      }
      moved = true;
    }
    if (!moved) break;
  }
}

export function pointBlocked(x: number, z: number, rad: number) {
  const [r, c] = cellOf(x, z);
  for (const b of boxGrid[r * COLS + c]) {
    if (!b.solid) continue;
    if (x > b.x0 - rad && x < b.x1 + rad && z > b.z0 - rad && z < b.z1 + rad) return true;
  }
  return false;
}

// ------------------------------------------------------------ line of sight
let stamp = 1;
const stamps = new WeakMap<Box, number>();
function segBox(ax: number, az: number, dx: number, dz: number, b: Box) {
  let t0 = 0,
    t1 = 1;
  for (const [p, d, lo, hi] of [
    [ax, dx, b.x0, b.x1],
    [az, dz, b.z0, b.z1],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;
    } else {
      let ta = (lo - p) / d,
        tb = (hi - p) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** True when nothing that blocks sight lies between a and b. */
export function los(ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax,
    dz = bz - az,
    len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(len / (T / 3)));
  stamp++;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [r, c] = cellOf(ax + dx * t, az + dz * t);
    const list = boxGrid[r * COLS + c];
    for (let j = 0; j < list.length; j++) {
      const b = list[j];
      if (!b.sight || !b.solid || stamps.get(b) === stamp) continue;
      stamps.set(b, stamp);
      if (segBox(ax, az, dx, dz, b)) return false;
    }
  }
  return true;
}

/** Line of sight wide enough for a body of the given radius to pass. */
export function clearPath(ax: number, az: number, bx: number, bz: number, rad: number) {
  const dx = bx - ax,
    dz = bz - az,
    l = Math.hypot(dx, dz) || 1;
  const nx = (-dz / l) * rad,
    nz = (dx / l) * rad;
  return los(ax, az, bx, bz) && los(ax + nx, az + nz, bx + nx, bz + nz) && los(ax - nx, az - nz, bx - nx, bz - nz);
}

// ------------------------------------------------------------- pathfinding
function passable(e: Edge) {
  return e === Edge.None || e === Edge.Door || e === Edge.Double || e === Edge.Open || (e === Edge.Front && !frontLocked);
}
export function neighbours(r: number, c: number, outside: boolean): [number, number][] {
  const out: [number, number][] = [];
  const ok = (rr: number, cc: number) => {
    const k = ch(rr, cc);
    return k !== " " && (outside || ROOMS[k].indoor);
  };
  if (r > 0 && passable(hEdge[r - 1][c]) && ok(r - 1, c)) out.push([r - 1, c]);
  if (r < ROWS - 1 && passable(hEdge[r][c]) && ok(r + 1, c)) out.push([r + 1, c]);
  if (c > 0 && passable(vEdge[r][c - 1]) && ok(r, c - 1)) out.push([r, c - 1]);
  if (c < COLS - 1 && passable(vEdge[r][c]) && ok(r, c + 1)) out.push([r, c + 1]);
  return out;
}

const fieldCache = new Map<string, { dist: Int16Array; version: number }>();
/** Breadth-first distance field towards a target cell. */
export function distanceField(tr: number, tc: number, outside: boolean) {
  const key = `${tr},${tc},${outside ? 1 : 0}`;
  const hit = fieldCache.get(key);
  if (hit && hit.version === doorsVersion) return hit.dist;
  const dist = new Int16Array(ROWS * COLS).fill(-1);
  const q = [tr * COLS + tc];
  dist[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const cur = q[h],
      r = (cur / COLS) | 0,
      c = cur % COLS;
    for (const [nr, nc] of neighbours(r, c, outside)) {
      const ni = nr * COLS + nc;
      if (dist[ni] !== -1) continue;
      dist[ni] = dist[cur] + 1;
      q.push(ni);
    }
  }
  if (fieldCache.size > 400) fieldCache.clear();
  fieldCache.set(key, { dist, version: doorsVersion });
  return dist;
}

/** Cells along the shortest route from a to b (excluding a). */
export function route(ar: number, ac: number, br: number, bc: number, outside: boolean, max = 200): [number, number][] {
  const dist = distanceField(br, bc, outside);
  const path: [number, number][] = [];
  let r = ar,
    c = ac;
  if (dist[r * COLS + c] < 0) return path;
  for (let i = 0; i < max && (r !== br || c !== bc); i++) {
    let best: [number, number] | null = null,
      bd = dist[r * COLS + c];
    for (const [nr, nc] of neighbours(r, c, outside)) {
      const d = dist[nr * COLS + nc];
      if (d >= 0 && d < bd) {
        bd = d;
        best = [nr, nc];
      }
    }
    if (!best) break;
    [r, c] = best;
    path.push(best);
  }
  return path;
}

/**
 * Where a walker at (x,z) should head next to reach (tx,tz). Goes straight if
 * the way is clear, otherwise follows the grid route and skips ahead to the
 * farthest cell it can reach in a straight line.
 */
export function steer(x: number, z: number, tx: number, tz: number, rad: number, outside: boolean) {
  if (clearPath(x, z, tx, tz, rad)) return { x: tx, z: tz };
  const [ar, ac] = cellOf(x, z),
    [br, bc] = cellOf(tx, tz);
  const path = route(ar, ac, br, bc, outside, 10);
  if (!path.length) return { x: tx, z: tz };
  let best = centre(path[0][0], path[0][1]);
  for (let i = 1; i < path.length; i++) {
    const p = centre(path[i][0], path[i][1]);
    if (!clearPath(x, z, p.x, p.z, rad)) break;
    best = p;
  }
  return best;
}

export const roomCharsIndoor = Object.keys(ROOMS).filter((k) => ROOMS[k].indoor);
