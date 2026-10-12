import * as THREE from "three";
import type { Assets, Ghost, GhostKind, GhostState, GhostSystemApi, GhostWorld, LockerSpot, RelicKind } from "../types";
import { Emitter, hummingVoice, type AudioEngine } from "../core/audio";
import { clamp, damp, lerp, lerpAngle, randRange, smoothstep } from "../core/util";
import { collide, los, steer } from "../world/map";
import { GhostKit, GhostModel, LOOKS } from "./ghostModel";
import { GhostParticles } from "./ghostFx";
import { inBeam, onScreen, pickFar, pickWander, sightRange, spotBehind, type P2 } from "./ghostAi";

/**
 * The three spirits of Hollow Creek High plus the Hollow. Fixed-step AI in
 * step(), cheap per-frame visuals in animate(). Numbers follow DESIGN.md.
 */

interface Spec {
  name: string;
  relic: RelicKind | null;
  hp: number;
  wander: number;
  chase: number;
  /** Hearing multiplier on noise radius. */
  ears: number;
}

const SPEC: Record<GhostKind, Spec> = {
  queen: { name: "The Prom Queen", relic: "crown", hp: 100, wander: 1.4, chase: 3.3, ears: 1 },
  janitor: { name: "The Janitor", relic: "keys", hp: 140, wander: 1.6, chase: 2.6, ears: 2 },
  principal: { name: "Principal Hale", relic: "register", hp: 120, wander: 1.5, chase: 5.0, ears: 1 },
  hollow: { name: "The Hollow", relic: null, hp: 1, wander: 2.2, chase: 4.4, ears: 1 },
};
const KINDS: GhostKind[] = ["queen", "janitor", "principal", "hollow"];

const RADIUS = 0.28;
const ATTACK_RANGE = 1.1;
const ATTACK_COOLDOWN = 4;
const REPEL_EXPOSURE = 1.2;
const REPEL_DIST = 25;
const BURN_RATE = 40;
const BURN_SLOW = 0.35;
const HOLLOW_LIT_SPEED = 1.5;
const BANISH_TIME = 2.5;
const SEARCH_TIME = 6;
const REACT = 0.3; // seconds of sight before a calm ghost reacts
const SPOT_GAP = 15; // seconds unseen before a sighting counts as new
const ANGER_TIME = 10;
const LOCKER_RANGE = 3.2;
const LOCKER_SUSPICION = 1.2;
const JANITOR_LOCKER_EAR = 8;

class GhostImpl implements Ghost {
  kind: GhostKind;
  name: string;
  relic: RelicKind | null;
  root: THREE.Object3D;
  x = 0;
  z = 0;
  hp: number;
  maxHp: number;
  alive = true;
  state: GhostState = "idle";
  lit = false;
  seenFor = 0;

  readonly model: GhostModel;
  readonly spec: Spec;
  // Previous step, for interpolated rendering.
  px = 0;
  pz = 0;
  pyaw = 0;
  yaw = 0;
  faceYaw = 0;
  speed = 0;
  lift = 0;
  // Navigation
  tx = 0;
  tz = 0;
  hasTarget = false;
  arrived = false;
  wx = 0;
  wz = 0;
  stx = 0;
  stz = 0;
  steerT = 0;
  pause = 0;
  stuckT = 0;
  stuckX = 0;
  stuckZ = 0;
  // State machine
  stateT = 0;
  lookBase = 0;
  lostT = 0;
  lkx = 0;
  lkz = 0;
  lastSeenT = -1e9;
  lastLosT = -1e9;
  noiseT = -1e9;
  lockerT = -1e9;
  locker: LockerSpot | null = null;
  linger = 0;
  suspicion = 0;
  exposure = 0;
  burning = 0;
  attackCd = 0;
  anger = 0;
  hadRelic = false;
  onScreen = false;
  frozen = false;
  twitchT = 2;
  teleT = 20;
  giggleT = 25;
  shriekT = 0;
  sndT = 1;
  emitT = 0;
  // Visual state
  dissolve = 1;
  fadeIn = 1;
  repelPhase = 0;
  litV = 0;
  burstT = 0;
  scareT = 0;
  scareDur = 0;
  scareGentle = false;
  scareCam: THREE.Camera | null = null;

  constructor(kind: GhostKind, model: GhostModel) {
    this.kind = kind;
    this.model = model;
    this.spec = SPEC[kind];
    this.name = this.spec.name;
    this.relic = this.spec.relic;
    this.root = model.root;
    this.hp = this.maxHp = this.spec.hp;
    this.teleT = randRange(16, 30);
    this.giggleT = randRange(18, 40);
  }
}

interface LightSlot {
  light: THREE.PointLight;
  owner: GhostImpl | null;
}

const _snd = { x: 0, y: 0, z: 0 };
const _p: P2 = { x: 0, z: 0 };
const _white = new THREE.Color(2.2, 2.0, 2.4);
const _c = new THREE.Color();

export class GhostSystem implements GhostSystemApi {
  ghosts: Ghost[] = [];
  private list: GhostImpl[] = [];
  private scene: THREE.Scene;
  private audio: AudioEngine;
  private kit: GhostKit;
  private pool = new Map<GhostKind, GhostModel[]>();
  private warmed: GhostModel[] = [];
  private lights = new Map<GhostKind, LightSlot>();
  private slots: LightSlot[] = [];
  private emitters = new Map<GhostModel, Emitter>();
  private particles: GhostParticles;
  private phase: GhostWorld["phase"] = "intro";
  private stepWall = 0;
  private stepDt = 1 / 60;
  private lockerTaken = -1e9;

  constructor(deps: { scene: THREE.Scene; assets: Assets; audio: AudioEngine }) {
    this.scene = deps.scene;
    this.audio = deps.audio;
    this.kit = new GhostKit(deps.assets);
    // One ready-made model per kind, so spawning never builds or compiles anything.
    for (const k of KINDS) this.pool.set(k, [new GhostModel(k, this.kit)]);
    // Fixed lights: one per kind, created now so the light count never changes.
    for (const k of KINDS) {
      const light = new THREE.PointLight(LOOKS[k].rim, 0, 5, 2);
      light.castShadow = false;
      light.name = "ghostLight-" + k;
      light.position.set(0, -50, 0);
      this.scene.add(light);
      const slot = { light, owner: null };
      this.lights.set(k, slot);
      this.slots.push(slot);
    }
    this.particles = new GhostParticles(this.scene);
  }

  // ------------------------------------------------------------- lifecycle

  spawn(kind: GhostKind, x: number, z: number): Ghost {
    const model = this.takeModel(kind);
    model.reset();
    const g = new GhostImpl(kind, model);
    g.x = x;
    g.z = z;
    collide(g, RADIUS, true);
    g.px = g.x;
    g.pz = g.z;
    g.yaw = g.pyaw = g.faceYaw = Math.random() * Math.PI * 2;
    g.state = this.phase === "intro" ? "idle" : "wander";
    g.dissolve = 1;
    g.fadeIn = 1 / 1.2;
    model.root.position.set(g.x, 0, g.z);
    model.root.rotation.y = g.yaw;
    this.scene.add(model.root);
    const slot = this.lights.get(kind)!;
    if (!slot.owner) slot.owner = g;
    if (kind === "queen" && !this.emitters.has(model)) this.emitters.set(model, new Emitter(this.audio, hummingVoice));
    this.list.push(g);
    this.ghosts.push(g);
    return g;
  }

  remove(g: Ghost) {
    const gi = this.find(g);
    if (!gi) return;
    this.list.splice(this.list.indexOf(gi), 1);
    const i = this.ghosts.indexOf(g);
    if (i >= 0) this.ghosts.splice(i, 1);
    this.scene.remove(gi.root);
    const slot = this.lights.get(gi.kind)!;
    if (slot.owner === gi) {
      slot.owner = this.list.find((o) => o.kind === gi.kind && o.state !== "gone") ?? null;
      slot.light.intensity = 0;
    }
    this.emitters.get(gi.model)?.update(_snd, 0);
    gi.model.reset();
    this.pool.get(gi.kind)!.push(gi.model);
  }

  private takeModel(kind: GhostKind): GhostModel {
    const free = this.pool.get(kind)!;
    const m = free.pop() ?? new GhostModel(kind, this.kit);
    const w = this.warmed.indexOf(m);
    if (w >= 0) this.warmed.splice(w, 1);
    return m;
  }

  private find(g: Ghost): GhostImpl | null {
    return this.list.find((o) => o === g) ?? null;
  }

  warmup(scene: THREE.Scene) {
    // Put every pooled model somewhere unseen but visible, so compile() sees
    // all ghost programs. The first animate() tucks them away again.
    for (const k of KINDS) {
      for (const m of this.pool.get(k)!) {
        m.reset();
        m.u.uDissolve.value = 0.3;
        m.root.position.set(0, -80, 0);
        scene.add(m.root);
        m.update(0, 0);
        this.warmed.push(m);
      }
    }
    // Ghosts already spawned may be hidden while faded out; show them for the compile.
    for (const g of this.list) if (g.state !== "gone") g.root.visible = true;
  }

  // ----------------------------------------------------------------- queries

  nearest(x: number, z: number): number {
    let best = 1e4;
    for (const g of this.list) {
      if (!g.alive || g.state === "gone") continue;
      const d = Math.hypot(g.x - x, g.z - z);
      if (d < best) best = d;
    }
    return best;
  }

  scatter(g: Ghost, fromX: number, fromZ: number, minDist: number) {
    const gi = this.find(g);
    if (!gi || gi.state === "gone" || gi.state === "banishing") return;
    pickFar(fromX, fromZ, minDist, gi.kind === "hollow", _p);
    this.relocate(gi, _p.x, _p.z);
    this.enter(gi, this.phase === "intro" ? "idle" : "wander");
    gi.dissolve = 1;
    gi.fadeIn = 1 / 1.1;
    gi.scareT = 0;
    gi.model.scare = 0;
    gi.exposure = 0;
    gi.suspicion = 0;
    gi.locker = null;
    gi.seenFor = 0;
    gi.lit = false;
    gi.burning = 0;
    gi.anger = 0;
    gi.speed = 0;
  }

  private relocate(g: GhostImpl, x: number, z: number) {
    g.x = g.px = x;
    g.z = g.pz = z;
    collide(g, RADIUS, true);
    g.px = g.x;
    g.pz = g.z;
    g.hasTarget = false;
    g.steerT = 0;
  }

  // ---------------------------------------------------------------- the AI

  step(dt: number, w: GhostWorld) {
    this.phase = w.phase;
    for (const g of this.list) {
      g.px = g.x;
      g.pz = g.z;
      g.pyaw = g.yaw;
      if (g.state === "gone") continue;
      this.think(g, dt, w);
      this.syncModel(g);
    }
    this.claimLocker(w);
    this.separate();
    this.stepWall = performance.now();
    this.stepDt = dt;
  }

  private enter(g: GhostImpl, s: GhostState) {
    g.state = s;
    g.stateT = 0;
    g.hasTarget = false;
    g.arrived = false;
    g.steerT = 0;
    g.lostT = 0;
    g.pause = 0;
    g.lookBase = g.yaw;
  }

  private think(g: GhostImpl, dt: number, w: GhostWorld) {
    const p = w.player;
    g.attackCd = Math.max(0, g.attackCd - dt);
    g.stateT += dt;

    if (g.state === "banishing") return this.stepBanish(g, dt);
    if (g.scareT > 0) {
      g.lit = false;
      return;
    }
    if (g.state === "repelled") return this.stepRepel(g, dt, w);
    if (g.dissolve > 0) g.dissolve = Math.max(0, g.dissolve - dt * g.fadeIn);

    const dxp = p.x - g.x,
      dzp = p.z - g.z;
    const dist = Math.hypot(dxp, dzp);
    const sp = w.diff.ghostSpeed;

    // Relics: picking one up angers its owner.
    const holds = g.relic ? w.hasRelic(g.relic) : false;
    if (holds && !g.hadRelic) g.anger = ANGER_TIME;
    g.hadRelic = holds;

    // On-screen test for the two ghosts that care.
    g.onScreen = (g.kind === "principal" || g.kind === "queen") && g.dissolve < 0.9 && onScreen(w.camera, g.x, 0.35, g.model.headY, g.z);

    if (w.phase === "intro") {
      if (g.state !== "idle") this.enter(g, "idle");
      g.lit = false;
      g.seenFor = 0;
      g.frozen = false;
      this.halt(g, dt);
      g.faceYaw = g.lookBase + Math.sin(g.stateT * 0.25) * 0.6;
      this.turn(g, dt, 2);
      this.ambient(g, dt, w, dist);
      return;
    }

    // UV beam.
    const lit = inBeam(w.beam, g.x, g.model.chestY, g.z) && g.dissolve < 0.6 && los(w.beam.origin.x, w.beam.origin.z, g.x, g.z);
    g.lit = lit;
    let cap = Infinity;
    if (lit) {
      if (g.kind === "hollow") cap = HOLLOW_LIT_SPEED;
      else if (holds) {
        g.hp = Math.max(0, g.hp - BURN_RATE * dt);
        g.burning = 0.3;
        g.shriekT -= dt;
        if (g.shriekT <= 0) {
          g.shriekT = randRange(1.3, 2.1);
          this.audio.shriek(this.at(g, g.model.headY));
        }
        g.burstT -= dt;
        if (g.burstT <= 0) {
          g.burstT = 0.12;
          this.particles.emit(g.x, 0.6, g.z, _c.copy(g.model.colour).multiplyScalar(3), 4, { spread: 0.3, height: 1.2, speed: 0.5, rise: 0.6, life: 1.1, size: 0.05 });
        }
        if (g.hp <= 0) return this.banish(g, w);
      } else {
        g.exposure += dt;
        if (g.exposure >= REPEL_EXPOSURE) {
          w.onRepelled(g);
          return this.repel(g);
        }
      }
    } else {
      g.exposure = Math.max(0, g.exposure - dt * 0.5);
      g.shriekT = 0;
    }
    g.model.writhe = g.burning > 0 ? 1 : (g.exposure / REPEL_EXPOSURE) * 0.6;

    // Principal Hale only moves while unwatched.
    g.frozen = g.kind === "principal" && g.onScreen;
    if (g.frozen) {
      g.twitchT -= dt;
      if (g.twitchT <= 0) {
        g.twitchT = randRange(1.2, 3.5);
        g.model.twitch();
        if (dist < 30) this.audio.crack(this.at(g, g.model.headY));
      }
    }

    // Perception.
    const knowsAll = (g.kind === "hollow" && w.phase === "escape") || g.anger > 0;
    if (g.anger > 0) g.anger -= dt;
    const sees = !p.hidden && g.dissolve < 0.7 && dist <= sightRange(w) && los(g.x, g.z, p.x, p.z);
    g.seenFor = sees ? g.seenFor + dt : 0;
    if (sees) g.lastLosT = w.time;
    const alert = g.state === "chase" || g.state === "search" || g.state === "locker" || g.state === "stunned";
    const spotted = sees && (g.seenFor >= REACT || alert || dist < 3);
    if (spotted) {
      if (w.time - g.lastSeenT > SPOT_GAP) w.onSpotted(g);
      g.lastSeenT = w.time;
    }
    if (spotted || (knowsAll && !p.hidden)) {
      g.lkx = p.x;
      g.lkz = p.z;
      if (g.state !== "chase" && g.state !== "stunned") this.enter(g, "chase");
    }

    // Burning holds it in place, writhing.
    if (g.burning > 0) {
      g.burning -= dt;
      if (g.state !== "stunned") this.enter(g, "stunned");
    } else if (g.state === "stunned") {
      g.lkx = p.x;
      g.lkz = p.z;
      this.enter(g, "chase");
    }

    // A locker it saw (or, for the Janitor, heard) the player climb into.
    const L = w.lastLocker;
    if (L && L.t > g.lockerT && p.hidden && p.hidden.id === L.spot.id && g.state !== "stunned" && g.state !== "locker") {
      const ld = Math.hypot(L.spot.x - g.x, L.spot.z - g.z);
      const witnessed = L.seen && w.time - g.lastLosT < 2.5;
      const heard = g.kind === "janitor" && w.time - L.t < 1.5 && ld <= JANITOR_LOCKER_EAR;
      if (witnessed || heard) this.goLocker(g, L.spot, L.t);
    }

    // Noises: the newest one it can hear.
    if (g.state === "wander" || g.state === "idle" || g.state === "investigate" || g.state === "search") {
      for (let i = w.noises.length - 1; i >= 0; i--) {
        const n = w.noises[i];
        if (n.t <= g.noiseT) break;
        if (Math.hypot(n.x - g.x, n.z - g.z) <= n.r * g.spec.ears) {
          g.noiseT = n.t;
          this.enter(g, "investigate");
          g.tx = n.x;
          g.tz = n.z;
          g.hasTarget = true;
          break;
        }
      }
    }

    // Queen: slips round behind the player when nobody is looking.
    if (g.kind === "queen" && w.phase === "hunt") this.queenTricks(g, dt, w, dist);

    // ----- behaviour per state
    const W = g.spec.wander * sp,
      C = g.spec.chase * sp;
    const outside = g.kind === "hollow";
    switch (g.state) {
      case "idle":
        this.enter(g, "wander");
        break;
      case "wander": {
        if (!g.hasTarget) {
          if (g.pause > 0) g.pause -= dt;
          else {
            pickWander(g.x, g.z, p.x, p.z, w.phase === "hunt" && p.indoor && Math.random() < 0.5, _p);
            g.tx = _p.x;
            g.tz = _p.z;
            g.hasTarget = true;
            g.stateT = 0;
          }
        }
        if (g.hasTarget) {
          if (this.travel(g, dt, g.tx, g.tz, W, cap, 0.6, outside, false) || g.stateT > 25) {
            g.hasTarget = false;
            g.pause = randRange(1.5, 4);
            g.lookBase = g.yaw;
          }
        } else {
          this.halt(g, dt);
          g.faceYaw = g.lookBase + Math.sin(g.pause * 1.4) * 0.5;
        }
        break;
      }
      case "investigate": {
        if (!g.arrived) {
          g.arrived = this.travel(g, dt, g.tx, g.tz, W * 1.3, cap, 0.7, outside, false);
          if (g.arrived) {
            g.stateT = 0;
            g.lookBase = g.yaw;
          } else if (g.stateT > 14) this.enter(g, "wander");
        } else {
          this.halt(g, dt);
          g.faceYaw = g.lookBase + Math.sin(g.stateT * 1.5) * 1.2;
          if (g.stateT > 2.6) this.enter(g, "wander");
        }
        break;
      }
      case "chase": {
        if (!spotted && !(knowsAll && !p.hidden)) {
          g.lostT += dt;
          // Keeps tracking briefly round a corner.
          if (g.lostT < 0.5 && !p.hidden) {
            g.lkx = p.x;
            g.lkz = p.z;
          }
          if (g.lostT > 0.6) {
            this.enter(g, "search");
            break;
          }
        } else g.lostT = 0;
        if (!g.frozen) this.travel(g, dt, g.lkx, g.lkz, C, cap, 0.25, outside, true);
        if (dist < 2.5) g.faceYaw = Math.atan2(dxp, dzp);
        break;
      }
      case "search": {
        if (!g.arrived) {
          if (!g.frozen) g.arrived = this.travel(g, dt, g.lkx, g.lkz, W * 1.25, cap, 0.6, outside, false);
          if (g.arrived) g.lookBase = g.yaw;
        } else {
          this.halt(g, dt);
          g.faceYaw = g.lookBase + Math.sin(g.stateT * 1.6) * 1.4;
        }
        if ((g.arrived && g.stateT > SEARCH_TIME) || g.stateT > SEARCH_TIME + 6) this.enter(g, "wander");
        break;
      }
      case "locker":
        this.stepLocker(g, dt, w, cap, outside);
        break;
      case "stunned": {
        if (!g.frozen) this.travel(g, dt, p.x, p.z, C * BURN_SLOW, cap, 0.25, outside, true);
        g.faceYaw = Math.atan2(dxp, dzp);
        break;
      }
      default:
        this.halt(g, dt);
    }
    this.turn(g, dt, g.kind === "principal" ? 11 : g.state === "chase" ? 8 : 5);

    // Attack.
    if (g.state !== "locker" && !p.hidden && dist < ATTACK_RANGE && g.attackCd <= 0 && g.dissolve < 0.3 && !g.frozen) {
      g.attackCd = ATTACK_COOLDOWN;
      w.onAttack(g, false);
      // The game normally answers with jumpScare(); if not, it still vanishes.
      const st = g.state as GhostState;
      if (g.scareT <= 0 && st !== "banishing" && st !== "repelled" && st !== "gone") this.repel(g);
    }
    this.ambient(g, dt, w, dist);
  }

  /** Move towards a target with smooth speed; returns true on arrival. */
  private travel(g: GhostImpl, dt: number, tx: number, tz: number, speed: number, cap: number, arriveR: number, outside: boolean, hurry: boolean) {
    const dx = tx - g.x,
      dz = tz - g.z;
    const d = Math.hypot(dx, dz);
    if (d <= arriveR) {
      this.halt(g, dt);
      return true;
    }
    g.steerT -= dt;
    if (g.steerT <= 0 || Math.hypot(g.wx - g.x, g.wz - g.z) < 0.35 || Math.abs(tx - g.stx) + Math.abs(tz - g.stz) > 1.5) {
      const s = steer(g.x, g.z, tx, tz, RADIUS, outside);
      g.wx = s.x;
      g.wz = s.z;
      g.stx = tx;
      g.stz = tz;
      g.steerT = hurry ? 0.12 : 0.3;
    }
    const v = Math.min(speed, cap);
    g.speed += (v - g.speed) * damp(hurry ? 6 : 3.5, dt);
    const wx = g.wx - g.x,
      wz = g.wz - g.z;
    const wl = Math.hypot(wx, wz) || 1;
    const stepLen = Math.min(g.speed * dt, d);
    g.x += (wx / wl) * stepLen;
    g.z += (wz / wl) * stepLen;
    collide(g, RADIUS, true);
    g.faceYaw = Math.atan2(wx, wz);

    // Unstick: if it has barely moved for a while, re-plan.
    g.stuckT += dt;
    if (g.stuckT > 1.5) {
      if (Math.hypot(g.x - g.stuckX, g.z - g.stuckZ) < 0.3 && g.speed > 0.4) {
        g.steerT = 0;
        if (g.state === "wander" || g.state === "investigate") g.hasTarget = false;
      }
      g.stuckT = 0;
      g.stuckX = g.x;
      g.stuckZ = g.z;
    }
    return false;
  }

  private halt(g: GhostImpl, dt: number) {
    g.speed += (0 - g.speed) * damp(5, dt);
    if (g.speed < 0.02) g.speed = 0;
  }

  private turn(g: GhostImpl, dt: number, rate: number) {
    if (g.frozen) return;
    g.yaw = lerpAngle(g.yaw, g.faceYaw, damp(rate, dt));
  }

  private goLocker(g: GhostImpl, spot: LockerSpot, t: number) {
    g.lockerT = t;
    this.lockerTaken = t;
    g.locker = spot;
    this.enter(g, "locker");
    g.linger = randRange(6, 9);
    g.suspicion = 0;
    g.tx = spot.x + spot.nx * 0.95;
    g.tz = spot.z + spot.nz * 0.95;
  }

  /** If a ghost was seen climbing in but nobody claimed it, the nearest one comes. */
  private claimLocker(w: GhostWorld) {
    const L = w.lastLocker;
    if (!L || !L.seen || L.t <= this.lockerTaken || w.phase === "intro") return;
    if (!w.player.hidden || w.player.hidden.id !== L.spot.id || w.time - L.t < 1) return;
    let best: GhostImpl | null = null,
      bd = 30;
    for (const g of this.list) {
      if (g.state === "gone" || g.state === "banishing" || g.state === "repelled" || g.state === "stunned" || g.state === "locker" || g.scareT > 0) continue;
      const d = Math.hypot(L.spot.x - g.x, L.spot.z - g.z);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    if (best) this.goLocker(best, L.spot, L.t);
    else this.lockerTaken = L.t;
  }

  private stepLocker(g: GhostImpl, dt: number, w: GhostWorld, cap: number, outside: boolean) {
    const p = w.player,
      spot = g.locker;
    if (!spot) return this.enter(g, "wander");
    const inside = !!p.hidden && p.hidden.id === spot.id;
    if (!inside && g.stateT > 0.5) {
      // The player slipped out: look around where they were.
      g.lkx = spot.x + spot.nx;
      g.lkz = spot.z + spot.nz;
      g.locker = null;
      return this.enter(g, "search");
    }
    if (!g.arrived) {
      if (!g.frozen) g.arrived = this.travel(g, dt, g.tx, g.tz, g.spec.wander * w.diff.ghostSpeed * 1.3, cap, 0.3, outside, false);
      if (g.stateT > 20) g.arrived = true;
    } else {
      this.halt(g, dt);
      g.faceYaw = Math.atan2(-spot.nx, -spot.nz) + Math.sin(g.stateT * 0.9) * 0.15;
      g.linger -= dt;
    }
    if (inside && Math.hypot(spot.x - g.x, spot.z - g.z) <= LOCKER_RANGE) {
      if (!p.holdingBreath) g.suspicion += dt;
      else g.suspicion = Math.max(0, g.suspicion - dt * 0.3);
      if (g.suspicion >= LOCKER_SUSPICION && g.attackCd <= 0) {
        g.suspicion = 0;
        g.attackCd = ATTACK_COOLDOWN;
        g.locker = null;
        this.enter(g, "chase");
        g.lkx = p.x;
        g.lkz = p.z;
        w.onAttack(g, true);
        if (g.scareT <= 0 && g.state === "chase") this.repel(g);
        return;
      }
    }
    if (g.arrived && g.linger <= 0) {
      g.locker = null;
      this.enter(g, "wander");
    }
  }

  private queenTricks(g: GhostImpl, dt: number, w: GhostWorld, dist: number) {
    const p = w.player;
    g.teleT -= dt;
    if (g.teleT <= 0) {
      g.teleT = randRange(16, 30);
      const free = g.state === "wander" || g.state === "investigate" || g.state === "search" || g.state === "chase";
      if (free && !g.onScreen && p.indoor && !p.hidden && dist > 7 && g.dissolve < 0.1 && Math.random() < 0.75) {
        const e = w.camera.matrixWorld.elements;
        if (spotBehind(p.x, p.z, -e[8], -e[10], 5, _p)) {
          this.particles.emit(g.x, 0.2, g.z, _c.copy(g.model.colour).multiplyScalar(2.5), 18, { spread: 0.35, height: 1.6, speed: 0.4, rise: 0.8, life: 1.2, size: 0.05 });
          this.relocate(g, _p.x, _p.z);
          g.dissolve = 1;
          g.fadeIn = 1 / 0.7;
          g.yaw = g.pyaw = g.faceYaw = Math.atan2(p.x - g.x, p.z - g.z);
          this.enter(g, "investigate");
          g.tx = p.x;
          g.tz = p.z;
          g.hasTarget = true;
          this.audio.giggle(this.at(g, g.model.headY));
        }
      }
    }
    g.giggleT -= dt;
    if (g.giggleT <= 0) {
      g.giggleT = randRange(20, 45);
      if (dist < 22) this.audio.giggle(this.at(g, g.model.headY));
    }
  }

  // -------------------------------------------------- repel, banish, scare

  private repel(g: GhostImpl) {
    this.enter(g, "repelled");
    g.repelPhase = 0;
    g.exposure = 0;
    g.lit = false;
    g.burning = 0;
    g.locker = null;
    this.audio.burst(this.at(g, g.model.chestY));
    this.particles.emit(g.x, 0.3, g.z, _c.copy(g.model.colour).multiplyScalar(3), 40, { spread: 0.35, height: 1.5, speed: 1.6, rise: 0.4, life: 0.9, size: 0.06 });
  }

  private stepRepel(g: GhostImpl, dt: number, w: GhostWorld) {
    g.lit = false;
    g.seenFor = 0;
    this.halt(g, dt);
    if (g.repelPhase === 0) {
      g.dissolve = Math.min(1, g.dissolve + dt / 0.35);
      g.model.writhe = 1;
      if (g.dissolve >= 1) {
        pickFar(w.player.x, w.player.z, REPEL_DIST, g.kind === "hollow", _p);
        this.relocate(g, _p.x, _p.z);
        g.repelPhase = 1;
        g.stateT = 0;
        g.model.writhe = 0;
      }
    } else if (g.stateT > 0.6) {
      g.dissolve = Math.max(0, g.dissolve - dt / 0.9);
      if (g.dissolve <= 0) this.enter(g, "wander");
    }
  }

  private banish(g: GhostImpl, w: GhostWorld) {
    this.enter(g, "banishing");
    g.hp = 0;
    g.lit = false;
    g.burning = 0;
    g.seenFor = 0;
    g.locker = null;
    w.onBanished(g);
    const pos = this.at(g, g.model.chestY);
    this.audio.banish(pos);
    this.audio.shriek(pos);
    this.particles.emit(g.x, 0.1, g.z, _c.copy(g.model.colour).multiplyScalar(4), 90, { spread: 0.45, height: 1.8, speed: 1.1, rise: 1.2, life: 2.2, size: 0.07 });
    this.particles.emit(g.x, 0.4, g.z, _white, 30, { spread: 0.3, height: 1.4, speed: 0.6, rise: 1.6, life: 2.6, size: 0.05, stagger: 1.2 });
  }

  private stepBanish(g: GhostImpl, dt: number) {
    g.lit = false;
    this.halt(g, dt);
    g.dissolve = smoothstep(0.25, BANISH_TIME, g.stateT);
    g.lift = 0.25 * g.stateT * g.stateT * 0.4;
    g.model.writhe = 1 - g.dissolve;
    g.burstT -= dt;
    if (g.burstT <= 0 && g.stateT < BANISH_TIME - 0.4) {
      g.burstT = 0.08;
      this.particles.emit(g.x, g.lift + 0.2, g.z, _c.copy(g.model.colour).multiplyScalar(3.5), 6, { spread: 0.35, height: 1.6, speed: 0.4, rise: 1.4, life: 1.6, size: 0.055 });
    }
    if (g.stateT >= BANISH_TIME) {
      g.dissolve = 1;
      g.alive = false;
      g.state = "gone";
      g.root.visible = false;
      g.lift = 0;
      this.emitters.get(g.model)?.update(this.at(g, 1.5), 0);
      const slot = this.lights.get(g.kind)!;
      if (slot.owner === g) {
        slot.light.intensity = 0;
        slot.owner = this.list.find((o) => o !== g && o.kind === g.kind && o.state !== "gone") ?? null;
      }
    }
  }

  jumpScare(g: Ghost, camera: THREE.Camera, gentle: boolean): number {
    const gi = this.find(g);
    const dur = gentle ? 0.6 : 0.9;
    if (!gi || gi.state === "gone") return dur;
    gi.scareT = gi.scareDur = dur;
    gi.scareGentle = gentle;
    gi.scareCam = camera;
    gi.dissolve = 0;
    gi.lit = false;
    gi.burning = 0;
    gi.speed = 0;
    gi.model.scare = gentle ? 0.65 : 1;
    gi.model.frozen = false;
    if (gi.state === "banishing" || gi.state === "repelled") this.enter(gi, "chase");
    this.placeScare(gi, camera, 0);
    return dur;
  }

  private placeScare(g: GhostImpl, camera: THREE.Camera, k: number) {
    const e = camera.matrixWorld.elements;
    const cx = e[12],
      cy = e[13],
      cz = e[14];
    let fx = -e[8],
      fz = -e[10];
    const l = Math.hypot(fx, fz) || 1;
    fx /= l;
    fz /= l;
    const d = lerp(0.8, 0.55, smoothstep(0, 0.25, k)) - (g.scareGentle ? 0 : Math.sin(k * 40) * 0.015);
    g.x = g.px = cx + fx * d;
    g.z = g.pz = cz + fz * d;
    g.yaw = g.pyaw = g.faceYaw = Math.atan2(cx - g.x, cz - g.z);
    const r = g.root;
    r.position.set(g.x, cy - (g.model.headY - 0.03), g.z);
    r.rotation.y = g.yaw;
  }

  // ------------------------------------------------------------- per frame

  private syncModel(g: GhostImpl) {
    const m = g.model;
    m.speed = g.frozen ? m.speed : g.speed;
    m.frozen = g.frozen;
    m.sneak = g.state === "search" || g.state === "investigate" || g.state === "locker" ? 1 : 0;
    m.reach = g.kind === "hollow" && g.state === "chase" ? 0.55 : 0;
    if (g.state !== "repelled" && g.state !== "banishing" && g.burning <= 0 && g.exposure <= 0) m.writhe = 0;
  }

  animate(dt: number, time: number, camera: THREE.Camera) {
    if (this.warmed.length) {
      for (const m of this.warmed) {
        m.root.parent?.remove(m.root);
        m.root.position.set(0, 0, 0);
      }
      this.warmed.length = 0;
    }
    const alpha = clamp((performance.now() - this.stepWall) / (this.stepDt * 1000), 0, 1);
    for (const g of this.list) {
      const slot = this.lights.get(g.kind)!;
      if (g.state === "gone") {
        g.root.visible = false;
        continue;
      }
      const u = g.model.u;
      let flare = 0;
      if (g.scareT > 0) {
        g.scareT = Math.max(0, g.scareT - dt);
        const k = 1 - g.scareT / g.scareDur;
        this.placeScare(g, g.scareCam ?? camera, k);
        flare = (g.scareGentle ? 0.5 : 1) * (1 - smoothstep(0.75, 1, k));
        if (g.scareT <= 0) {
          const e = (g.scareCam ?? camera).matrixWorld.elements;
          g.model.scare = 0;
          g.scareCam = null;
          this.scatter(g, e[12], e[14], REPEL_DIST);
        }
      } else {
        g.root.position.set(lerp(g.px, g.x, alpha), g.lift, lerp(g.pz, g.z, alpha));
        g.root.rotation.y = lerpAngle(g.pyaw, g.yaw, alpha);
      }
      g.litV += ((g.lit ? 1 : 0) - g.litV) * damp(g.lit ? 14 : 4, dt);
      u.uLit.value = g.litV;
      u.uFlare.value = flare;
      u.uDissolve.value = g.dissolve;
      u.uOrigin.value.copy(g.root.position);
      g.root.visible = g.dissolve < 0.995;
      if (g.root.visible) g.model.update(dt, time);

      if (slot.owner === g) {
        const L = slot.light;
        const vis = Math.pow(1 - g.dissolve, 1.5);
        const banish = g.state === "banishing" ? 9 * (1 - smoothstep(0, BANISH_TIME, g.stateT)) : 0;
        const flick = 0.85 + 0.1 * Math.sin(time * 13.1 + g.x) + 0.05 * Math.sin(time * 37.7);
        L.intensity = g.model.look.light * vis * flick * (1 + g.litV * 2.5 + flare * 2) + banish;
        L.position.set(g.root.position.x, g.root.position.y + g.model.chestY, g.root.position.z);
      }
    }
    for (const slot of this.slots) if (!slot.owner || slot.owner.state === "gone") slot.light.intensity = 0;
    this.particles.update(time, camera);
  }

  // ---------------------------------------------------------------- sound

  private at(g: GhostImpl, y: number) {
    _snd.x = g.x;
    _snd.y = g.lift + y;
    _snd.z = g.z;
    return _snd;
  }

  private ambient(g: GhostImpl, dt: number, w: GhostWorld, dist: number) {
    const near = dist < 32 && g.dissolve < 0.95;
    const moving = g.speed > 0.25 && !g.frozen;
    switch (g.kind) {
      case "queen": {
        g.emitT -= dt;
        if (g.emitT <= 0) {
          g.emitT = 0.1;
          const em = this.emitters.get(g.model);
          if (em) {
            const base = w.phase === "intro" ? 0.45 : 0.85;
            const level = base * (1 - g.dissolve) * (0.5 + 0.5 * (1 - smoothstep(2, 18, dist)));
            em.update(this.at(g, g.model.headY), level);
          }
        }
        break;
      }
      case "janitor":
        if (moving && near) {
          g.sndT -= dt;
          if (g.sndT <= 0) {
            g.sndT = (0.62 / clamp(g.speed / 1.6, 0.6, 2.2)) * randRange(0.85, 1.2);
            this.audio.keys(this.at(g, 0.95));
          }
        }
        break;
      case "principal":
        if (moving && near) {
          g.sndT -= dt;
          if (g.sndT <= 0) {
            g.sndT = 0.5;
            this.audio.tick(this.at(g, g.model.chestY));
          }
        }
        break;
      case "hollow":
        g.sndT -= dt;
        if (g.sndT <= 0) {
          g.sndT = randRange(1.9, 2.7);
          if (near) {
            const pos = this.at(g, g.model.headY);
            this.audio.noise(1.1, { type: "lowpass", f: 240, q: 0.8, gain: 0.34, attack: 0.35 }, pos);
            this.audio.noise(0.8, { type: "bandpass", f: 520, q: 1.4, gain: 0.07, attack: 0.3, at: 1.2 }, pos);
          }
        }
        break;
    }
  }

  // --------------------------------------------------------------- spacing

  private separate() {
    const l = this.list;
    for (let i = 0; i < l.length; i++) {
      const a = l[i];
      if (a.state === "gone" || a.scareT > 0) continue;
      for (let j = i + 1; j < l.length; j++) {
        const b = l[j];
        if (b.state === "gone" || b.scareT > 0) continue;
        const dx = b.x - a.x,
          dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= 0.7 || d < 1e-4) continue;
        const push = (0.7 - d) * 0.5;
        const nx = dx / d,
          nz = dz / d;
        if (!a.frozen) {
          a.x -= nx * push;
          a.z -= nz * push;
          collide(a, RADIUS, true);
        }
        if (!b.frozen) {
          b.x += nx * push;
          b.z += nz * push;
          collide(b, RADIUS, true);
        }
      }
    }
  }
}
