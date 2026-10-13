import * as THREE from "three";
import type { Assets, Level, Spot, Surface } from "../types";
import type { Quality } from "../core/settings";
import { mulberry32 } from "../core/util";
import { T, ROOMS, GRID, ROWS, COLS, boxes, charAt, los } from "./map";
import { FONT } from "./canvasTex";
import { Geo } from "./levelGeo";
import { buildAtlas } from "./levelAtlas";
import { makeMaterials } from "./levelMaterials";
import { Fixtures } from "./levelLights";
import { type Ctx, splat } from "./levelCtx";
import { buildShell } from "./levelShell";
import { buildHalls, type Rect } from "./levelHalls";
import { buildRooms, GRATING } from "./levelRooms";
import { buildGym } from "./levelGym";
import { buildExterior } from "./levelExterior";

/**
 * Hollow Creek High, abandoned since prom night 1987. Builds the whole school
 * from the floor plan in map.ts: static geometry merged into one mesh per
 * material, instanced fixtures, lockers and litter, and a handful of animated
 * pieces (front doors, flag, balloons, mirror ball, candles, blood writing).
 */
export function buildLevel(scene: THREE.Scene, assets: Assets, quality: Quality): Level {
  const t0 = performance.now();
  const geo = new Geo();
  const atlas = buildAtlas(assets, quality === "low" ? 0.5 : 1);
  const t1 = performance.now();
  const mats = makeMaterials(assets, quality, atlas);
  const t2 = performance.now();
  const ctx: Ctx = {
    scene,
    assets,
    quality,
    geo,
    atlas,
    mats,
    lights: new Fixtures(geo, mulberry32(4711)),
    rng: mulberry32(1987),
    items: [],
    relics: { crown: [], keys: [], register: [] },
    anim: [],
    objects: [],
  };

  const shell = buildShell(ctx);
  const halls = buildHalls(ctx);
  buildRooms(ctx);
  buildGym(ctx);
  const ext = buildExterior(ctx);
  scatter(ctx);
  const t3 = performance.now();

  const statics = geo.build(mats.mats, mats.flags);
  for (const m of statics.values()) scene.add(m);
  const fixtureMeshes = ctx.lights.build(scene);
  validateSpots(ctx.items);
  for (const k of ["crown", "keys", "register"] as const) validateSpots(ctx.relics[k]);

  const blood = bloodPool(ctx, halls.runs);
  ext.setHeadlights(true);

  // Draw call estimate: every mesh this level put in the scene.
  const all: THREE.Object3D[] = [...statics.values(), ...fixtureMeshes, ...ctx.objects, ...blood.meshes];
  let tris = 0;
  for (const o of all) {
    const m = o as THREE.Mesh;
    if (!m.geometry) continue;
    const g = m.geometry;
    const n = g.index ? g.index.count / 3 : g.getAttribute("position").count / 3;
    tris += n * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
  }
  console.info(
    `[level] built in ${Math.round(performance.now() - t0)} ms (atlas ${Math.round(t1 - t0)}, textures ${Math.round(t2 - t1)}, layout ${Math.round(t3 - t2)}, merge ${Math.round(performance.now() - t3)}): ` +
      `${all.length} meshes (draw calls before shadows), ~${Math.round(tris / 1000)}k triangles, ${ctx.lights.list.length} fixtures, ${halls.spots.length} lockers, ${ctx.items.length} item spots`
  );

  const surfaceAt = (x: number, z: number): Surface => {
    const k = charAt(x, z);
    const room = ROOMS[k];
    if (!room.indoor) return "wet";
    if (k === "W" && x > GRATING.x0 && x < GRATING.x1 && z > GRATING.z0 && z < GRATING.z1) return "metal";
    if (room.floor === "wood") return "wood";
    if (room.floor === "carpet") return "soft";
    return "hard";
  };

  return {
    fixtures: ctx.lights.list,
    syncFixtures: () => ctx.lights.sync(),
    setEmergency: (on: boolean) => ctx.lights.emergency(on),
    lockers: halls.spots,
    setLockerDoor: halls.setDoor,
    relicSpots: ctx.relics,
    itemSpots: ctx.items,
    spawn: ext.spawn,
    car: ext.car,
    lobby: { x: 49.5, z: 46.6, yaw: 0 },
    setFrontDoors: shell.setFrontDoors,
    setHeadlights: ext.setHeadlights,
    surfaceAt,
    writeOnWall: blood.write,
    update(dt: number, time: number) {
      // The renderer shares the current lightning flash (0..1) through scene.userData.
      const flash = scene.userData.flash;
      mats.update(dt, typeof flash === "number" ? flash : 0);
      const anim = ctx.anim;
      for (let i = 0; i < anim.length; i++) anim[i](dt, time);
      blood.update(dt);
    },
  };
}

// ---------------------------------------------------------- litter, decals

function scatter(ctx: Ctx) {
  const r = ctx.rng;
  const PI = Math.PI;
  // Instanced paper litter across indoor floors, thickest in the corridors.
  const cells: [number, number, string][] = [];
  for (let row = 0; row < ROWS; row++)
    for (let c = 0; c < COLS; c++) {
      const k = GRID[row][c];
      if (!ROOMS[k].indoor || k === "W") continue;
      const n = k === "H" ? 3 : k === "G" ? 1 : 1;
      for (let i = 0; i < n; i++) if (r() < (k === "G" ? 0.35 : 0.7)) cells.push([row, c, k]);
    }
  const count = ctx.quality === "low" ? Math.min(160, cells.length) : cells.length;
  const sheet = new THREE.PlaneGeometry(0.21, 0.28).rotateX(-PI / 2);
  // The shared atlas material uses vertex colours, so give the sheet white ones.
  sheet.setAttribute("color", new THREE.Float32BufferAttribute(new Array(sheet.getAttribute("position").count * 4).fill(1), 4));
  const ur = ctx.atlas.uv("paper");
  const uv = sheet.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, ur.u0 + uv.getX(i) * (ur.u1 - ur.u0), ur.v0 + uv.getY(i) * (ur.v1 - ur.v0));
  const litter = new THREE.InstancedMesh(sheet, ctx.mats.mats.atlas, count);
  litter.name = "level.litter";
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    p = new THREE.Vector3(),
    s = new THREE.Vector3(),
    col = new THREE.Color();
  const tints = [0xffffff, 0xf2ecd8, 0xf5eeb0, 0xd8e6f2, 0xf2d8e0];
  for (let i = 0; i < count; i++) {
    const [row, c] = cells[i];
    p.set(c * T + 0.2 + r() * (T - 0.4), 0.007 + i * 0.00002, row * T + 0.2 + r() * (T - 0.4));
    e.set((r() - 0.5) * 0.08, r() * PI * 2, (r() - 0.5) * 0.08);
    q.setFromEuler(e);
    const k = 0.85 + r() * 0.3;
    m.compose(p, q, s.set(k, 1, k));
    litter.setMatrixAt(i, m);
    litter.setColorAt(i, col.setHex(tints[(r() * tints.length) | 0]));
  }
  litter.receiveShadow = true;
  litter.frustumCulled = false;
  ctx.scene.add(litter);
  ctx.objects.push(litter);

  // Blood and grime.
  const BLOOD = 0x4a0306,
    OLD = 0x2e0806,
    GRIME = 0x2a2218;
  const floor = (x: number, z: number, size: number, col: number, a = 0.9) => splat(ctx, x, 0.006, z, 0, -PI / 2, size, col, a);
  const wall = (x: number, y: number, z: number, yaw: number, size: number, col: number, a = 0.85) => splat(ctx, x, y, z, yaw, 0, size, col, a);
  // A drag trail along the north corridor towards the gym doors.
  for (let i = 0; i < 18; i++) floor(48 - i * 1.6 + (r() - 0.5) * 0.4, 16.6 + Math.sin(i * 0.7) * 0.35, 0.5 + r() * 0.35, i < 3 ? BLOOD : OLD, 0.9 - i * 0.025);
  floor(19.5, 17.2, 1.2, BLOOD);
  wall(17.2, 1.15, 17.89, Math.PI, 0.55, BLOOD);
  wall(21.8, 0.9, 17.89, Math.PI, 0.4, OLD);
  // Pools and spatter in rooms.
  floor(77.6, 28.2, 1.4, OLD);
  floor(103.2, 43.6, 1.1, BLOOD);
  floor(88.5, 33.9, 0.9, OLD);
  floor(58.8, 23.6, 0.8, OLD);
  floor(31.2, 9.5, 0.9, OLD);
  wall(52.5, 1.4, 36 + 0.111, 0, 0.5, BLOOD);
  wall(66 + 0.111, 1.2, 30.5, PI / 2, 0.45, OLD);
  wall(99 - 0.111, 1.6, 30.2, -PI / 2, 0.4, OLD);
  // Grime: water stains, mould and dirt by the walls.
  for (let i = 0; i < 26; i++) {
    const row = 1 + ((r() * 16) | 0),
      c = 1 + ((r() * 36) | 0);
    const k = GRID[row][c];
    if (!ROOMS[k].indoor) continue;
    floor(c * T + 0.3 + r() * 2.4, row * T + 0.3 + r() * 2.4, 0.8 + r() * 1.4, r() < 0.3 ? 0x2a3020 : GRIME, 0.35 + r() * 0.3);
  }
  for (const x of [8, 30, 44, 71, 88, 105]) wall(x, 2.6 + r() * 0.3, 15 + 0.111, 0, 1.2, GRIME, 0.35);
}

// ------------------------------------------------------- spot validation

/** Keep pickups out of collision boxes: nudge any that landed inside one. */
function validateSpots(list: Spot[]) {
  for (const s of list) {
    for (let it = 0; it < 4; it++) {
      let inside = null;
      for (const b of boxes) {
        if (!b.solid || b.tag === "front") continue;
        if (s.x > b.x0 && s.x < b.x1 && s.z > b.z0 && s.z < b.z1) {
          inside = b;
          break;
        }
      }
      if (!inside) break;
      const d = [s.x - inside.x0, inside.x1 - s.x, s.z - inside.z0, inside.z1 - s.z];
      const i = d.indexOf(Math.min(...d));
      if (i === 0) s.x = inside.x0 - 0.04;
      else if (i === 1) s.x = inside.x1 + 0.04;
      else if (i === 2) s.z = inside.z0 - 0.04;
      else s.z = inside.z1 + 0.04;
      if (import.meta.env.DEV) console.warn(`[level] moved spot "${s.label}" out of a collision box`);
    }
  }
}

// ---------------------------------------------------------- blood writing

interface Writing {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  tex: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  t: number;
  active: boolean;
}

/**
 * A small pool of text planes made up front (so no shader compiles mid-game).
 * Writing finds the wall in front of a point and fades the words in.
 */
function bloodPool(ctx: Ctx, extra: Rect[]) {
  const pool: Writing[] = [];
  const geo = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < 4; i++) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 256;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      roughness: 0.25,
      metalness: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    mat.name = "level.bloodWriting";
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "level.bloodWriting";
    mesh.position.set(0, -50, 0);
    mesh.renderOrder = 3;
    ctx.scene.add(mesh);
    pool.push({ mesh, mat, tex, canvas, t: 0, active: false });
  }
  let next = 0;
  const rng = mulberry32(666);

  const paint = (w: Writing, text: string) => {
    const g = w.canvas.getContext("2d", { willReadFrequently: true })!;
    const W = w.canvas.width,
      H = w.canvas.height;
    g.clearRect(0, 0, W, H);
    let size = 150;
    g.font = `bold ${size}px ${FONT.chalk}`;
    const tw = g.measureText(text).width;
    if (tw > W * 0.92) {
      size = Math.floor((size * W * 0.92) / tw);
      g.font = `bold ${size}px ${FONT.chalk}`;
    }
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.lineCap = "round";
    const cy = H * 0.4;
    const scale = Math.min(1, (W * 0.92) / tw);
    // Letter by letter, each a little off-line, stroked thick so any font reads as finger-painted.
    let x = W / 2 - (tw * scale) / 2;
    for (const ch of text) {
      const cw = g.measureText(ch).width;
      g.save();
      g.translate(x + cw / 2, cy + (rng() - 0.5) * size * 0.12);
      g.rotate((rng() - 0.5) * 0.16);
      g.lineWidth = size * 0.11;
      g.strokeStyle = "rgba(60,0,2,0.55)";
      g.strokeText(ch, -cw / 2 + (rng() - 0.5) * 4, (rng() - 0.5) * 4);
      g.lineWidth = size * 0.05;
      g.strokeStyle = "rgba(105,4,6,0.9)";
      g.strokeText(ch, -cw / 2, 0);
      g.fillStyle = "rgba(128,8,10,0.95)";
      g.fillText(ch, -cw / 2, 0);
      g.restore();
      x += cw;
    }
    // Smears where the hand dragged.
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(80,0,3,${0.08 + rng() * 0.1})`;
      g.beginPath();
      g.ellipse(W / 2 + (rng() - 0.5) * tw * scale, cy + (rng() - 0.5) * size * 0.6, 20 + rng() * 60, 6 + rng() * 14, (rng() - 0.5) * 0.6, 0, Math.PI * 2);
      g.fill();
    }
    // Runs dripping down from the letters.
    const width = Math.min(W * 0.92, tw * (size / 150));
    for (let i = 0; i < 26; i++) {
      const x = W / 2 + (rng() - 0.5) * width;
      const y0 = cy + size * (0.05 + rng() * 0.25);
      const len = 20 + rng() * (H - y0 - 20);
      const wd = 2 + rng() * 5;
      const gr = g.createLinearGradient(0, y0, 0, y0 + len);
      gr.addColorStop(0, "rgba(110,4,6,0.9)");
      gr.addColorStop(1, "rgba(90,2,4,0.75)");
      g.fillStyle = gr;
      g.fillRect(x - wd / 2, y0, wd, len);
      g.beginPath();
      g.arc(x, y0 + len, wd * 0.8, 0, Math.PI * 2);
      g.fill();
    }
    w.tex.needsUpdate = true;
  };

  // Walls block sight; locker runs do not, but blood should still land on them.
  const inExtra = (px: number, pz: number) => {
    for (let i = 0; i < extra.length; i++) {
      const b = extra[i];
      if (px > b.x0 && px < b.x1 && pz > b.z0 && pz < b.z1) return true;
    }
    return false;
  };
  const blocked = (ax: number, az: number, bx: number, bz: number) => !los(ax, az, bx, bz) || inExtra(bx, bz);

  const write = (x: number, z: number, yaw: number, text: string) => {
    const dx = -Math.sin(yaw),
      dz = -Math.cos(yaw);
    let prev = 0.2,
      hit = -1;
    for (let d = 0.35; d <= 30; d += 0.12) {
      if (blocked(x, z, x + dx * d, z + dz * d)) {
        hit = d;
        break;
      }
      prev = d;
    }
    if (hit < 0) return;
    let lo = prev,
      hi = hit;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (blocked(x, z, x + dx * mid, z + dz * mid)) hi = mid;
      else lo = mid;
    }
    const px = x + dx * lo,
      pz = z + dz * lo,
      ex = x + dx * hi,
      ez = z + dz * hi;
    const bx = blocked(px, pz, ex, pz),
      bz = blocked(px, pz, px, ez);
    let nx = 0,
      nz = 0;
    if (bx && !bz) nx = -Math.sign(dx);
    else if (bz && !bx) nz = -Math.sign(dz);
    else if (Math.abs(dx) > Math.abs(dz)) nx = -Math.sign(dx);
    else nz = -Math.sign(dz);
    const w = pool[next];
    next = (next + 1) % pool.length;
    paint(w, text.toUpperCase());
    // Find how far the surface runs either side so the words never hang over a doorway.
    const tx = -nz,
      tz = nx;
    const surface = (s: number) => {
      const fx = px + nx * 0.1 + tx * s,
        fz = pz + nz * 0.1 + tz * s;
      return blocked(fx, fz, fx - nx * 0.2, fz - nz * 0.2);
    };
    let left = 0,
      right = 0;
    while (left < 1.8 && surface(-(left + 0.1))) left += 0.1;
    while (right < 1.8 && surface(right + 0.1)) right += 0.1;
    const want = Math.max(1.2, Math.min(3.2, 0.26 * text.length + 0.4));
    const width = Math.max(0.8, Math.min(want, left + right - 0.1));
    const shift = (right - left) / 2;
    w.mesh.scale.set(width, width / 4, 1);
    // Sit on the surface, just proud of it, facing back the way we came.
    const fx = px + nx * 0.012 + tx * shift,
      fz = pz + nz * 0.012 + tz * shift;
    w.mesh.position.set(fx, 1.55, fz);
    w.mesh.rotation.set(0, Math.atan2(nx, nz), (rng() - 0.5) * 0.06);
    w.mat.opacity = 0;
    w.t = 0;
    w.active = true;
  };

  const update = (dt: number) => {
    for (let i = 0; i < pool.length; i++) {
      const w = pool[i];
      if (!w.active) continue;
      w.t += dt;
      const k = Math.min(1, w.t / 3);
      w.mat.opacity = k * k * (3 - 2 * k) * 0.95;
      if (k >= 1) w.active = false;
    }
  };

  return { write, update, meshes: pool.map((w) => w.mesh) };
}
