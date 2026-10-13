import * as THREE from "three";
import type { GhostWorld, UvBeam } from "../types";
import { COLS, ROOM_CELLS, ROOMS, T, centre, cellOf, charAt, collide, distanceField, isIndoor, los, pointBlocked } from "../world/map";

/** Perception and placement helpers for the ghost AI. */

export interface P2 {
  x: number;
  z: number;
}

/** Every indoor cell, for wander targets and scattering. */
export const INDOOR_CELLS: [number, number][] = [];
/** Car park cells, which only the Hollow may use. */
export const LOT_CELLS: [number, number][] = [];
for (const k of Object.keys(ROOM_CELLS)) {
  const def = ROOMS[k];
  if (!def) continue;
  if (def.indoor) INDOOR_CELLS.push(...ROOM_CELLS[k]);
  else if (def.type === "lot") LOT_CELLS.push(...ROOM_CELLS[k]);
}
const OUTDOOR_POOL = INDOOR_CELLS.concat(LOT_CELLS);

/** How far a ghost can see the player, per DESIGN.md. */
export function sightRange(w: GhostWorld) {
  let r = 14 * w.diff.sight + (w.player.torchOn ? 5 : 0);
  if (w.player.crouch > 0.5 && !w.player.torchOn) r *= 0.5;
  return r;
}

/** A random point inside cell (r, c), kept clear of its walls. */
export function pointInCell(r: number, c: number, out: P2, jitter = 0.9) {
  const p = centre(r, c);
  out.x = p.x + (Math.random() * 2 - 1) * jitter;
  out.z = p.z + (Math.random() * 2 - 1) * jitter;
  collide(out, 0.35, true);
  return out;
}

/**
 * Somewhere new to drift to, reachable from where the ghost is. With
 * nearPlayer it stays within reach of the player so the school never feels
 * empty for long.
 */
export function pickWander(gx: number, gz: number, px: number, pz: number, nearPlayer: boolean, out: P2) {
  const [gr, gc] = cellOf(gx, gz);
  const field = distanceField(gr, gc, false);
  for (let i = 0; i < 28; i++) {
    const [r, c] = INDOOR_CELLS[(Math.random() * INDOOR_CELLS.length) | 0];
    if (field[r * COLS + c] < 0) continue;
    const cx = c * T + T / 2,
      cz = r * T + T / 2;
    if (Math.hypot(cx - gx, cz - gz) < 5) continue;
    if (nearPlayer && Math.hypot(cx - px, cz - pz) > 24) continue;
    return pointInCell(r, c, out);
  }
  const [r, c] = INDOOR_CELLS[(Math.random() * INDOOR_CELLS.length) | 0];
  return pointInCell(r, c, out);
}

/**
 * A place at least minDist from (fx, fz), preferring one not absurdly far.
 * Falls back to the farthest candidate tried.
 */
export function pickFar(fx: number, fz: number, minDist: number, outside: boolean, out: P2) {
  const pool = outside ? OUTDOOR_POOL : INDOOR_CELLS;
  let best = pool[0],
    bestD = -1;
  for (let i = 0; i < 48; i++) {
    const cell = pool[(Math.random() * pool.length) | 0];
    const d = Math.hypot(cell[1] * T + T / 2 - fx, cell[0] * T + T / 2 - fz);
    if (d >= minDist && d <= minDist + 30) {
      best = cell;
      break;
    }
    if (d > bestD) {
      bestD = d;
      best = cell;
    }
  }
  return pointInCell(best[0], best[1], out, 0.7);
}

const _v = new THREE.Vector3();

/** Is a point inside the UV cone, padded a little for the ghost's width? Range and on-state included. */
export function inBeam(beam: UvBeam, x: number, y: number, z: number) {
  if (beam.on <= 0.5) return false;
  _v.set(x - beam.origin.x, y - beam.origin.y, z - beam.origin.z);
  const d = _v.length();
  if (d > beam.range || d < 1e-3) return false;
  const dirLen = beam.dir.length() || 1;
  const cosA = _v.dot(beam.dir) / (d * dirLen);
  if (cosA > beam.cos) return true;
  const half = Math.acos(THREE.MathUtils.clamp(beam.cos, -1, 1)) + Math.atan(0.25 / d);
  return Math.acos(THREE.MathUtils.clamp(cosA, -1, 1)) <= half;
}

/** On screen: a point between yLo and yHi projects inside the view, with nothing solid between. */
export function onScreen(camera: THREE.Camera, x: number, yLo: number, yHi: number, z: number) {
  const e = camera.matrixWorld.elements;
  let hit = false;
  for (let i = 0; i < 3 && !hit; i++) {
    _v.set(x, i === 0 ? yHi : i === 1 ? (yLo + yHi) * 0.5 : yLo, z).project(camera);
    hit = _v.z > -1 && _v.z < 1 && Math.abs(_v.x) < 1.04 && Math.abs(_v.y) < 1.06;
  }
  return hit && los(e[12], e[14], x, z);
}

/** A free indoor spot about `dist` behind the player (facing fx, fz), for the Queen's trick. */
export function spotBehind(px: number, pz: number, fx: number, fz: number, dist: number, out: P2) {
  const l = Math.hypot(fx, fz) || 1;
  const bx = -fx / l,
    bz = -fz / l;
  for (const a of [0, 0.35, -0.35, 0.7, -0.7]) {
    const c = Math.cos(a),
      s = Math.sin(a);
    for (const d of [dist, dist - 1, dist + 1]) {
      const x = px + (bx * c - bz * s) * d,
        z = pz + (bx * s + bz * c) * d;
      if (!isIndoor(x, z) || charAt(x, z) === " ") continue;
      if (pointBlocked(x, z, 0.45)) continue;
      if (!los(px, pz, x, z)) continue;
      out.x = x;
      out.z = z;
      return true;
    }
  }
  return false;
}
