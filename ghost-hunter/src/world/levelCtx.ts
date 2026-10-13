import * as THREE from "three";
import type { Assets, RelicKind, Spot } from "../types";
import type { Quality } from "../core/settings";
import { addBox } from "./map";
import type { Geo } from "./levelGeo";
import type { Atlas } from "./levelAtlas";
import type { Fixtures } from "./levelLights";
import type { LevelMats } from "./levelMaterials";

/** Shared state handed to every part of the level builder. */
export interface Ctx {
  scene: THREE.Scene;
  assets: Assets;
  quality: Quality;
  geo: Geo;
  atlas: Atlas;
  mats: LevelMats;
  lights: Fixtures;
  rng: () => number;
  items: Spot[];
  relics: Record<RelicKind, Spot[]>;
  /** Per-frame animation hooks. */
  anim: ((dt: number, time: number) => void)[];
  /** Extra meshes added to the scene (counted for the draw call estimate). */
  objects: THREE.Object3D[];
}

/** Furniture collision box (players only; ghosts pass through). */
export function solid(x0: number, x1: number, z0: number, z1: number, sight = false) {
  addBox(Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1), { sight, wall: false });
}

/** Collision for a w x d footprint centred at (x, z) and turned by yaw, inset so the player can reach the edges. */
export function solidAt(x: number, z: number, w: number, d: number, yaw = 0, inset = 0.12, sight = false) {
  const c = Math.abs(Math.cos(yaw)),
    s = Math.abs(Math.sin(yaw));
  const hx = Math.max(0.08, (w * c + d * s) / 2 - inset),
    hz = Math.max(0.08, (w * s + d * c) / 2 - inset);
  solid(x - hx, x + hx, z - hz, z + hz, sight);
}

const BLOB = { u0: 0.52, v0: 0.04, u1: 0.98, v1: 0.96 };
/** Soft round contact shadow on the floor. */
export function blob(ctx: Ctx, x: number, z: number, w: number, d: number, yaw = 0, k = 0.6, y = 0.008) {
  ctx.geo.at(x, y, z, yaw, -Math.PI / 2).rect("ao", w, d, BLOB, { col: 0, a: k });
  ctx.geo.reset();
}

/** Blood or grime splat on the floor (rx = -PI/2) or a wall. */
export function splat(ctx: Ctx, x: number, y: number, z: number, ry: number, rx: number, size: number, col: number, a = 0.9) {
  ctx.geo.at(x, y, z, ry, rx, ctx.rng() * Math.PI * 2).rect("decal", size, size, undefined, { col, a });
  ctx.geo.reset();
}

export function item(ctx: Ctx, room: string, x: number, y: number, z: number, label: string, yaw = 0) {
  ctx.items.push({ x, y, z, room, yaw, label });
}

export function relic(ctx: Ctx, kind: RelicKind, room: string, x: number, y: number, z: number, label: string, yaw = 0) {
  ctx.relics[kind].push({ x, y, z, room, yaw, label });
}
