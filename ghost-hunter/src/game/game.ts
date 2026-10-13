import * as THREE from "three";
import type { Assets, EndResult, Ghost, GhostKind, GhostWorld, Level, LockerSpot, PlayerInput, RelicKind, RenderSystem, Spot, Viewmodel, Weather } from "../types";
import type { GhostSystem } from "./ghosts";
import type { Player } from "./player";
import type { Hud } from "../ui/hud";
import type { Menus } from "../ui/menus";
import type { Minimap } from "../ui/minimap";
import type { Input } from "../core/input";
import type { AudioEngine } from "../core/audio";
import { DIFFICULTY, loadBest, saveBest, settings, type DifficultyPreset } from "../core/settings";
import { TAU, clamp, damp, formatTime, lerp, randRange, shuffle } from "../core/util";
import { COLS, ROOM_CELLS, T, cellOf, centre, ch, charAt, distanceField, isIndoor, los, neighbours, roomBounds, route, setFrontLocked } from "../world/map";
import { addUvDecal, addUvTrail, uvBeam, UV_SIZES } from "../world/uvReveal";
import { INDOOR_CELLS, onScreen, sightRange } from "./ghostAi";
import { ItemMeshes, PICKUP_COUNT, RELICS, type Interactable, type PickupKind } from "./items";
import { RELIC_NAME, RELIC_SHORT, buildNotes, cap, type LoreNote } from "./lore";

/**
 * The run: phases, rules and everything that ties the systems together.
 * Simulation runs in fixed 60 Hz steps; look input, visuals, audio and the
 * HUD update once per rendered frame. Nothing in the per-frame path
 * allocates.
 */

export type Phase = "intro" | "hunt" | "escape" | "won" | "lost";

export interface GameDeps {
  assets: Assets;
  rs: RenderSystem;
  level: Level;
  weather: Weather;
  ghosts: GhostSystem;
  player: Player;
  vm: Viewmodel;
  hud: Hud;
  menus: Menus;
  minimap: Minimap;
  input: Input;
  audio: AudioEngine;
}

const STEP = 1 / 60;
const MAX_STEPS = 6;
const INTERACT_RANGE = 1.8;
const CAR_RANGE = 2.6;
const LOBBY_TRIGGER_Z = 48.6;
const DOOR_POS = { x: 49.5, y: 1.6, z: 51 };

const SPIRITS: GhostKind[] = ["queen", "janitor", "principal"];
const NAME: Record<GhostKind, string> = { queen: "The Prom Queen", janitor: "The Janitor", principal: "Principal Hale", hollow: "The Hollow" };
const SPIRIT_OF: Record<RelicKind, GhostKind> = { crown: "queen", keys: "janitor", register: "principal" };
const DAMAGE: Record<GhostKind, number> = { queen: 25, janitor: 32, principal: 40, hollow: 30 };
const START_ROOM: Record<GhostKind, string> = { queen: "G", janitor: "W", principal: "P", hollow: "H" };
const FAREWELL: Record<GhostKind, string> = {
  queen: 'Jenny: "Tell Danny I waited for him." The Prom Queen is at rest.',
  janitor: 'Mr Doyle: "All locked up. I can go home now." The Janitor is at rest.',
  principal: 'Mr Hale: "Class dismissed." Principal Hale is at rest.',
  hollow: "",
};
const BLOOD: Record<GhostKind, string> = { queen: "She waited", janitor: "All locked up", principal: "Class dismissed", hollow: "" };
const UV_TEXT: Record<RelicKind, string> = { crown: "SHE LEFT IT HERE", keys: "HIS KEYS", register: "SIGN THE\nREGISTER" };
const TRAIL: Record<RelicKind, "hand" | "foot"> = { crown: "foot", keys: "foot", register: "hand" };

const PA_LINES = [
  "Would Jennifer Hale please make her way to the gymnasium. Your coronation is about to begin.",
  "Mr Doyle to the boiler room, please. Mr Doyle to the boiler room.",
  "Attention, all pupils. The prom will continue until every guest has been accounted for.",
  "Any pupil found out of class after eleven forty seven will be given detention. Forever.",
  "Brodie. Brodie to the principal's office. Immediately.",
  "The register is not yet complete. Nobody goes home until the register is complete.",
  "Will the owner of a brown estate car please return to it. Your headlights are on.",
  "Reminder. Running in the corridors is strictly forbidden.",
];
const PA_LOCKED = "Welcome back to Hollow Creek High. The doors are now locked for your safety. Please enjoy the prom.";
const PA_ESCAPE = "All pupils must leave the building. The doors will lock again when the bell stops.";

const EMF_GAP = [0, 1.3, 0.85, 0.55, 0.32, 0.18];

const PROMPTS = {
  locker: "Hide in the locker",
  leave: "Leave the locker",
  crown: "Take the tiara",
  keys: "Take the ring of keys",
  register: "Take the attendance register",
  cell: "Take the UV cell",
  choc: "Eat the chocolate bar",
  note: "Read the note",
};
type PromptKey = keyof typeof PROMPTS;

type Dir = "left" | "right" | "ahead" | "behind";

/** A name used mid-sentence: "the Prom Queen" rather than "The Prom Queen". */
const mid = (name: string) => name.replace(/^The /, "the ");

const hash = (n: number) => {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
};

const _fwd = new THREE.Vector3();
const _snd = { x: 0, y: 0, z: 0 };

interface LockerAnim {
  id: number;
  t: number;
  dur: number;
  peak: number;
}

export class Game {
  // dependencies
  private assets: Assets;
  private rs: RenderSystem;
  private level: Level;
  private weather: Weather;
  private ghosts: GhostSystem;
  private player: Player;
  private vm: Viewmodel;
  private hud: Hud;
  private menus: Menus;
  private minimap: Minimap;
  private input: Input;
  private audio: AudioEngine;
  private items: ItemMeshes;

  /** Called when the player quits to the title screen. */
  onQuit: () => void = () => {};

  // ------------------------------------------------------------ run state
  phase: Phase = "intro";
  active = false;
  private ending = false;
  private diff: DifficultyPreset = DIFFICULTY.normal;
  private simTime = 0; // monotonic across runs, shared with the ghosts
  private runTime = 0;
  private acc = 0;
  private god = false;

  private relicSpot = {} as Record<RelicKind, Spot>;
  private found: Record<RelicKind, boolean> = { crown: false, keys: false, register: false };
  private hinted: Record<RelicKind, boolean> = { crown: false, keys: false, register: false };
  private banished: Record<GhostKind, boolean> = { queen: false, janitor: false, principal: false, hollow: false };
  private notes: LoreNote[] = [];
  private notesFound = 0;
  private continuesUsed = 0;
  private lostPhase: Phase = "hunt";
  private result: EndResult | null = null;
  private lastAttacker: GhostKind = "queen";
  private hollowOut = false;

  private escapeT = 0;
  private escapeDelay = -1;
  private endDelay = -1;
  private scareT = 0;
  private shake = 0;
  private hurt = 0;
  private fear = 0;
  private escapeK = 0;
  private indoorK = 0;
  private heartT = 0;
  private emfT = 0;
  private emfShown = 0.4;
  private emfLevel = 0;
  private uvHumT = 0;
  private wasBeaming = false;
  private eventT = 12;
  private paT = 60;
  private paSay: string | null = null;
  private paSayT = 0;
  private lightningT = 8;
  private thunderT = -1;
  private stingT = -99;
  private repelTold = false;
  private spottedTold = false;
  private headFlickT = 0;
  private headFlickered = false;
  private headOn = true;
  private lastObjective = "";

  // front doors and locker doors
  private door = { from: 1, to: 1, t: 1, dur: 1, cur: 1 };
  private lockerAnims: LockerAnim[] = [];

  // fixtures
  private base: Float32Array;
  private orig: Float32Array;
  private amb: Float32Array;
  private hum = 0;

  // interaction
  private interacts: Interactable[] = [];
  private target: Interactable | null = null;
  private targetLocker: LockerSpot | null = null;
  /** Prompt strings per input mode (keyboard, gamepad, touch), built once. */
  private promptCache: Partial<Record<PromptKey, string>>[] = [{}, {}, {}];

  // world for the ghost AI
  private noises: GhostWorld["noises"] = [];
  private noisePool: { x: number; z: number; r: number; t: number }[] = [];
  private noiseNext = 0;
  private lockerRec = { spot: null as unknown as LockerSpot, t: 0, seen: false };
  private world: GhostWorld;

  // decals made per run, removed on reset
  private decals: THREE.Object3D[] = [];

  // pointer lock bookkeeping
  private expectUnlock = false;
  private hadLock = false;

  // reused per-frame objects
  private pin: PlayerInput = { moveX: 0, moveY: 0, run: false, crouch: false, beam: false, breath: false };
  private stepOpts = { canMove: true, drain: 1, headBob: true };
  private bars = { nerve: 100, battery: 100, stamina: 100, breath: null as number | null, breathDanger: false, breathLabel: "Hold your breath" };
  private fx = { fear: 0, lowNerve: 0, hurt: 0, uv: 0, escape: 0 };
  private vmState = {
    beaming: false,
    torchOn: true,
    emfLevel: 0,
    emfValue: 0,
    hidden: false,
    bob: 0,
    moving: false,
    running: false,
    lookDX: 0,
    lookDY: 0,
    fear: 0,
    battery: 100,
  };
  private bufSize = new THREE.Vector2();

  // debug
  drawCalls = 0;
  triangles = 0;
  private debug = false;
  private simInput: Partial<PlayerInput> | null = null;

  constructor(d: GameDeps) {
    this.assets = d.assets;
    this.rs = d.rs;
    this.level = d.level;
    this.weather = d.weather;
    this.ghosts = d.ghosts;
    this.player = d.player;
    this.vm = d.vm;
    this.hud = d.hud;
    this.menus = d.menus;
    this.minimap = d.minimap;
    this.input = d.input;
    this.audio = d.audio;
    this.items = new ItemMeshes(this.rs.scene);

    const n = this.level.fixtures.length;
    this.orig = new Float32Array(n);
    this.base = new Float32Array(n);
    this.amb = new Float32Array(n);
    for (let i = 0; i < n; i++) this.orig[i] = this.level.fixtures[i].level;

    for (let i = 0; i < 24; i++) this.noisePool.push({ x: 0, z: 0, r: 0, t: 0 });
    for (let i = 0; i < 2; i++) this.lockerAnims.push({ id: -1, t: 0, dur: 1, peak: 0 });
    for (const k of RELICS) this.interacts.push(this.slot("relic", RELICS.indexOf(k), k));
    for (const kind of ["cell", "choc", "note"] as PickupKind[]) for (let i = 0; i < PICKUP_COUNT[kind]; i++) this.interacts.push(this.slot(kind, i, null));

    this.world = {
      time: 0,
      phase: "intro",
      player: this.player.s,
      camera: this.rs.camera,
      diff: this.diff,
      beam: uvBeam,
      hasRelic: (k) => this.found[k],
      noises: this.noises,
      lastLocker: null,
      onAttack: (g, fromLocker) => this.onAttack(g, fromLocker),
      onBanished: (g) => this.onBanished(g),
      onRepelled: (g) => this.onRepelled(g),
      onSpotted: (g) => this.onSpotted(g),
    };
    this.player.onNoise = (x, z, r) => this.pushNoise(x, z, r);

    this.permanentWriting();
    this.resetRun();
    this.bindEvents();
  }

  private slot(type: Interactable["type"], idx: number, relic: RelicKind | null): Interactable {
    return { type, idx, relic, x: 0, y: -50, z: 0, taken: true, note: -1 };
  }

  // =============================================================== events

  private bindEvents() {
    const canvas = this.rs.renderer.domElement;
    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement === canvas) {
        this.hadLock = true;
        return;
      }
      if (this.expectUnlock) {
        this.expectUnlock = false;
        return;
      }
      if (this.active && !this.ending && this.hadLock && !this.menus.isPaused() && !this.menus.isNoteOpen()) this.pause();
    });
    // Desktop: a click on the view takes the mouse back if the lock was lost.
    canvas.addEventListener("mousedown", () => {
      if (this.active && !this.ending && !this.menus.isPaused() && !this.menus.isNoteOpen() && !this.input.locked && !this.isTouch()) this.input.requestLock();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.active && !this.ending) this.pause();
    });
  }

  private isTouch() {
    return this.input.touchActive || document.body.classList.contains("touch");
  }

  private releaseLock() {
    if (document.pointerLockElement) {
      this.expectUnlock = true;
      this.input.exitLock();
    }
  }

  private canPause() {
    return this.active && !this.ending && !this.menus.isPaused() && !this.menus.isNoteOpen();
  }

  pause() {
    if (!this.canPause()) return;
    this.minimap.close();
    this.menus.pause({
      resume: () => this.resume(),
      restart: () => this.start(),
      quit: () => this.quit(),
    });
    this.releaseLock();
    this.hud.prompt(null);
    this.audio.stopSpeech();
    this.audio.suspend();
  }

  private resume() {
    this.audio.resume();
    this.input.clearPresses();
    this.input.requestLock();
    this.acc = 0;
  }

  // ============================================================ lifecycle

  /** A fresh run from the car park. Call inside a user gesture so the pointer lock works. */
  start() {
    this.diff = DIFFICULTY[settings.difficulty] ?? DIFFICULTY.normal;
    this.world.diff = this.diff;
    this.continuesUsed = 0;
    this.resetRun();
    this.active = true;
    this.ending = false;
    this.hud.show(true);
    this.vm.setVisible(true);
    this.input.enabled = true;
    this.input.clearPresses();
    this.input.setCrouch(false);
    this.audio.resume();
    this.input.requestLock();
    this.hud.toast("Hollow Creek High, 11:47 pm. Three spirits are waiting.", 4200);
  }

  quit() {
    this.active = false;
    this.ending = false;
    this.menus.closePause();
    this.minimap.close();
    this.releaseLock();
    this.audio.resume();
    this.audio.setEscape(false);
    this.audio.stopSpeech();
    this.hud.show(false);
    this.hud.prompt(null);
    this.vm.setVisible(false);
    this.resetRun();
    this.onQuit();
  }

  /** Put the world back as it was for a new run: spirits, relics, pickups, doors, lights, decals. */
  private resetRun() {
    const L = this.level;
    this.phase = "intro";
    this.runTime = 0;
    this.acc = 0;
    this.notesFound = 0;
    this.result = null;
    this.escapeT = 0;
    this.escapeDelay = -1;
    this.endDelay = -1;
    this.scareT = 0;
    this.shake = 0;
    this.hurt = 0;
    this.fear = 0;
    this.escapeK = 0;
    this.eventT = randRange(10, 18);
    this.paT = randRange(50, 80);
    this.paSay = null;
    this.lightningT = randRange(6, 14);
    this.thunderT = -1;
    this.repelTold = false;
    this.spottedTold = false;
    this.headFlickT = 0;
    this.headFlickered = false;
    this.hollowOut = false;
    this.lastObjective = "";
    this.noises.length = 0;
    this.world.lastLocker = null;
    for (const k of RELICS) this.found[k] = this.hinted[k] = false;
    for (const k of SPIRITS) this.banished[k] = false;
    this.banished.hollow = false;

    // World state.
    L.setEmergency(false);
    for (let i = 0; i < L.fixtures.length; i++) {
      L.fixtures[i].level = this.orig[i];
      this.base[i] = this.orig[i];
      this.amb[i] = 0;
    }
    L.syncFixtures();
    L.setHeadlights(true);
    this.headOn = true;
    setFrontLocked(false);
    this.door.from = this.door.to = this.door.cur = 1;
    this.door.t = this.door.dur = 1;
    L.setFrontDoors(1);
    for (const a of this.lockerAnims) {
      if (a.id >= 0) L.setLockerDoor(a.id, 0);
      a.id = -1;
    }
    this.audio.setEscape(false);
    this.audio.stopSpeech();

    // Spirits, idle in their haunts until the doors lock.
    for (let i = this.ghosts.ghosts.length - 1; i >= 0; i--) this.ghosts.remove(this.ghosts.ghosts[i]);
    for (const k of SPIRITS) {
      const b = roomBounds(START_ROOM[k]);
      this.ghosts.spawn(k, (b.x0 + b.x1) / 2 + randRange(-1.5, 1.5), (b.z0 + b.z1) / 2 + randRange(-1.5, 1.5));
    }

    this.placeItems();

    // Player and UI.
    this.player.reset(L.spawn);
    uvBeam.on = 0;
    this.minimap.reset();
    this.minimap.close();
    this.refreshMarkers();
    this.hud.setTimer(null);
    this.hud.prompt(null);
    this.hud.setLockerVents(false);
    this.hud.setTargetRing(null);
    this.refreshTally();
    this.refreshObjective();
  }

  // ================================================================ items

  private placeItems() {
    const scene = this.rs.scene;
    for (const d of this.decals) {
      scene.remove(d);
      if (d.name.startsWith("uv-trail")) (d as THREE.Mesh).geometry?.dispose();
    }
    this.decals.length = 0;

    for (const k of RELICS) {
      const spots = this.level.relicSpots[k];
      const s = spots.length ? spots[(Math.random() * spots.length) | 0] : this.level.itemSpots[(Math.random() * this.level.itemSpots.length) | 0];
      this.relicSpot[k] = s;
      this.items.placeRelic(k, s);
      const it = this.interacts[RELICS.indexOf(k)];
      it.x = s.x;
      it.y = s.y;
      it.z = s.z;
      it.taken = false;
      this.buildTrail(k, s);
      this.relicWriting(k, s);
    }

    // Pickups on distinct spots, not crowding the relics.
    const pool = shuffle(this.level.itemSpots.filter((s) => RELICS.every((k) => Math.hypot(s.x - this.relicSpot[k].x, s.z - this.relicSpot[k].z) > 2.5)));
    if (!pool.length) pool.push(...this.level.itemSpots);
    this.notes = buildNotes(this.relicSpot);
    const noteOrder = shuffle([0, 1, 2, 3, 4, 5]);
    let n = 0;
    for (let i = 3; i < this.interacts.length; i++) {
      const it = this.interacts[i];
      const s = pool[n++ % pool.length];
      if (!s) continue;
      it.x = s.x;
      it.y = s.y;
      it.z = s.z;
      it.taken = false;
      it.note = it.type === "note" ? noteOrder[it.idx % noteOrder.length] : -1;
      this.items.placePickup(it.type as PickupKind, it.idx, s);
    }
  }

  /** UV prints from the nearest corridor to the relic. */
  private buildTrail(k: RelicKind, s: Spot) {
    const [rr, rc] = cellOf(s.x, s.z);
    const field = distanceField(rr, rc, false);
    let best = -1,
      bd = 1e9;
    for (const [r, c] of ROOM_CELLS["H"]) {
      const d = field[r * COLS + c];
      if (d >= 0 && d < bd) {
        bd = d;
        best = r * COLS + c;
      }
    }
    if (best < 0) return;
    const hr = (best / COLS) | 0,
      hc = best % COLS;
    const path = route(hr, hc, rr, rc, false);
    const pts: { x: number; z: number }[] = [];
    // Start a cell further back along the corridor so the trail is easy to come across.
    const back = neighbours(hr, hc, false).find(([r, c]) => ch(r, c) === "H" && !(path.length && path[0][0] === r && path[0][1] === c));
    if (back) pts.push(centre(back[0], back[1]));
    pts.push(centre(hr, hc));
    for (let i = 0; i < path.length - 1; i++) {
      const p = centre(path[i][0], path[i][1]);
      // Wander a little inside the cell, but never so far as to miss a doorway.
      p.x += randRange(-0.3, 0.3);
      p.z += randRange(-0.3, 0.3);
      pts.push(p);
    }
    const last = pts[pts.length - 1];
    const dx = s.x - last.x,
      dz = s.z - last.z,
      l = Math.hypot(dx, dz);
    if (l > 0.5) {
      const stop = l - 0.45;
      pts.push({ x: last.x + (dx / l) * stop, z: last.z + (dz / l) * stop });
    }
    this.decals.push(addUvTrail(this.rs.scene, pts, TRAIL[k]));
  }

  /** Writing in UV ink on the wall nearest the relic, with a couple of handprints beside it. */
  private relicWriting(k: RelicKind, s: Spot) {
    const w = wallNear(s.x, s.z, 4.5, 0.8) ?? wallNear(s.x, s.z, 7, 0.6);
    if (!w) return;
    const ry = Math.atan2(w.nx, w.nz);
    const ox = w.x + w.nx * 0.012,
      oz = w.z + w.nz * 0.012;
    this.decals.push(addUvDecal(this.rs.scene, { kind: "text", text: UV_TEXT[k], x: ox, y: 1.6, z: oz, rx: 0, ry, rz: randRange(-0.04, 0.04), size: 1.25 }));
    const tx = -w.nz,
      tz = w.nx;
    for (const side of [-1, 1]) {
      const d = 0.85 + Math.random() * 0.15;
      const px = ox + tx * d * side,
        pz = oz + tz * d * side;
      if (!wallBehind(px - w.nx * 0.1, pz - w.nz * 0.1, -w.nx, -w.nz)) continue;
      const m = addUvDecal(this.rs.scene, { kind: "hand", x: px, y: randRange(0.95, 1.35), z: pz, rx: 0, ry, rz: randRange(-0.5, 0.5), size: UV_SIZES.hand });
      if (side < 0) m.scale.x *= -1;
      this.decals.push(m);
    }
  }

  /** UV writing that stays put between runs. */
  private permanentWriting() {
    const put = (x: number, z: number, text: string, size: number) => {
      const w = wallNear(x, z, 3, size / 2 + 0.1);
      if (!w) return;
      addUvDecal(this.rs.scene, { kind: "text", text, x: w.x + w.nx * 0.012, y: 1.7, z: w.z + w.nz * 0.012, rx: 0, ry: Math.atan2(w.nx, w.nz), rz: 0.03, size });
    };
    put(42, 41, "11:47", 0.9);
    put(40.5, 16.5, "WE NEVER LEFT", 1.4);
    put(96, 33, "SHE IS STILL\nDANCING", 1.2);
  }

  // =========================================================== main loop

  /** One rendered frame of play (or of the end and pause screens behind their menus). */
  frame(dt: number, time: number) {
    const inp = this.input,
      s = this.player.s,
      cam = this.rs.camera;
    inp.poll();
    const look = inp.consumeLook();
    const paused = this.menus.isPaused();
    const noteOpen = this.menus.isNoteOpen();
    const mapOpen = this.minimap.isOpen();
    const live = this.active && !this.ending;
    const playing = live && (this.phase === "intro" || this.phase === "hunt" || this.phase === "escape");

    // ------------------------------------------------------------ presses
    if (inp.wasPressed("pause") && live) {
      if (paused) {
        this.menus.closePause();
        this.resume();
      } else if (mapOpen) this.minimap.close();
      else this.pause();
    }
    const free = playing && !paused && !noteOpen;
    if (inp.wasPressed("map") && free) {
      if (mapOpen) this.minimap.close();
      else this.minimap.open(s);
    }
    if (inp.wasPressed("torch") && free && !s.hidden) this.player.toggleTorch();
    if (inp.wasPressed("interact") && free && !this.minimap.isOpen()) this.interact();

    // --------------------------------------------------------------- look
    let ldx = 0,
      ldy = 0;
    if (free && !this.minimap.isOpen() && this.scareT <= 0) {
      ldx = look[0];
      ldy = look[1];
      this.player.look(ldx, ldy);
    }

    // -------------------------------------------------------- simulation
    if (this.active && !paused && !noteOpen) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < MAX_STEPS) {
        this.step(STEP);
        this.acc -= STEP;
        n++;
      }
      if (n === MAX_STEPS) this.acc = 0;
    }
    if (this.minimap.isOpen()) this.minimap.open(s);
    this.player.applyCamera(this.acc / STEP, this.shake);

    // ------------------------------------------------------- render rate
    const vdt = paused || noteOpen ? 0 : dt;
    this.ghosts.animate(vdt, time, cam);
    this.level.update(vdt, time);
    this.updateFixtures(vdt, time);

    this.indoorK += ((s.indoor ? 1 : 0) - this.indoorK) * damp(2.2, dt);
    this.rs.setIndoor(this.indoorK);
    this.weather.update(time, cam.position, this.indoorK);

    // Viewmodel (also refreshes the camera's world matrix).
    const v = this.vmState;
    const nearest = this.ghosts.nearest(s.x, s.z);
    this.emfLevel = nearest > 22 ? 0 : nearest > 15 ? 1 : nearest > 10 ? 2 : nearest > 6 ? 3 : nearest > 3 ? 4 : 5;
    const emfTarget = nearest >= 30 ? 0.3 + Math.random() * 0.15 : clamp(60 / (nearest + 1), 0.3, 99) * (0.92 + Math.random() * 0.16);
    this.emfShown += (emfTarget - this.emfShown) * damp(4, dt);
    v.beaming = s.beaming;
    v.torchOn = s.torchOn;
    v.emfLevel = this.emfLevel;
    v.emfValue = this.emfShown;
    v.hidden = !!s.hidden;
    v.bob = s.bob;
    v.moving = s.moving;
    v.running = s.running;
    v.lookDX = ldx;
    v.lookDY = ldy;
    v.fear = this.fear;
    v.battery = s.battery;
    this.vm.update(dt, v);

    // UV beam from the camera.
    cam.getWorldDirection(_fwd);
    uvBeam.origin.copy(cam.position);
    uvBeam.dir.copy(_fwd);
    uvBeam.on += ((s.beaming ? 1 : 0) - uvBeam.on) * damp(s.beaming ? 16 : 9, dt);
    if (uvBeam.on < 0.001) uvBeam.on = 0;

    this.audio.setListener(cam.position, _fwd);
    this.audio.setAmbience(this.indoorK, this.fear, this.hum);

    this.items.update(time, cam, this.rs.renderer.getDrawingBufferSize(this.bufSize).y);
    this.updateHud(paused || noteOpen || this.minimap.isOpen());

    const fx = this.fx;
    fx.fear = this.fear;
    fx.lowNerve = clamp(1 - s.nerve / 45, 0, 1);
    fx.hurt = this.hurt;
    fx.uv = uvBeam.on;
    this.escapeK += ((this.phase === "escape" ? 1 : 0) - this.escapeK) * damp(1.5, dt);
    fx.escape = this.escapeK;
    this.rs.setFx(fx);
    this.draw(dt, time);
  }

  /** Behind the title menu: a slow camera drifting through the rain in the car park. */
  titleFrame(dt: number, time: number) {
    const cam = this.rs.camera;
    this.input.poll();
    this.input.consumeLook();
    this.input.clearPresses();
    const t = time;
    cam.position.set(46.5 + Math.sin(t * 0.045) * 7, 1.45 + Math.sin(t * 0.11) * 0.12, 82.4 - (0.5 + 0.5 * Math.sin(t * 0.031)) * 3);
    cam.lookAt(49.5 + Math.sin(t * 0.027) * 3, 4.6 + Math.sin(t * 0.05) * 0.4, 49);
    cam.updateMatrixWorld();

    this.ghosts.animate(dt, time, cam);
    this.level.update(dt, time);
    this.updateFixtures(dt, time);
    this.indoorK = 0;
    this.rs.setIndoor(0);
    this.weather.update(time, cam.position, 0);
    uvBeam.on = 0;
    this.items.update(time, cam, this.rs.renderer.getDrawingBufferSize(this.bufSize).y);

    this.lightningT -= dt;
    if (this.lightningT <= 0) {
      this.rs.lightning();
      this.lightningT = randRange(14, 30);
      if (this.audio.ctx) this.thunderT = randRange(0.6, 2.4);
    }
    if (this.thunderT > 0 && (this.thunderT -= dt) <= 0) this.audio.thunder(false);

    const fx = this.fx;
    fx.fear = fx.lowNerve = fx.hurt = fx.uv = fx.escape = 0;
    this.rs.setFx(fx);
    this.hud.setFps(settings.showFps ? this.rs.stats.fps : null, this.rs.stats.scale);
    this.draw(dt, time);
  }

  private draw(dt: number, time: number) {
    const info = this.rs.renderer.info;
    if (this.debug) info.reset();
    this.rs.render(dt, time);
    if (this.debug) {
      this.drawCalls = info.render.calls;
      this.triangles = info.render.triangles;
    }
  }

  // ========================================================== fixed step

  private step(dt: number) {
    const s = this.player.s;
    const inp = this.input;
    this.simTime += dt;
    const playing = this.phase === "intro" || this.phase === "hunt" || this.phase === "escape";
    if (playing) this.runTime += dt;

    // Player.
    const mapOpen = this.minimap.isOpen();
    const pin = this.pin;
    const canMove = playing && this.active && !this.ending && this.scareT <= 0 && !mapOpen;
    pin.moveX = canMove ? inp.moveX : 0;
    pin.moveY = canMove ? inp.moveY : 0;
    pin.run = inp.isHeld("run");
    pin.crouch = inp.isHeld("crouch");
    pin.beam = canMove && inp.isHeld("beam");
    pin.breath = inp.isHeld("breath");
    const so = this.simInput;
    if (so) {
      if (canMove) {
        pin.moveX = so.moveX ?? pin.moveX;
        pin.moveY = so.moveY ?? pin.moveY;
        pin.beam = so.beam ?? pin.beam;
      }
      pin.run = so.run ?? pin.run;
      pin.crouch = so.crouch ?? pin.crouch;
      pin.breath = so.breath ?? pin.breath;
    }
    const o = this.stepOpts;
    o.canMove = canMove;
    o.drain = this.diff.drain;
    o.headBob = settings.headBob;
    this.player.step(dt, pin, o);
    if (this.god) s.battery = 100;
    this.minimap.visit(s.x, s.z);

    while (this.noises.length && this.simTime - this.noises[0].t > 1.5) this.noises.shift();

    // Phase triggers.
    if (this.phase === "intro" && s.room === "Y" && s.z < LOBBY_TRIGGER_Z) this.startHunt();

    // Spirits.
    if (playing) {
      const w = this.world;
      w.time = this.simTime;
      w.phase = this.phase as GhostWorld["phase"];
      this.ghosts.step(dt, w);
      const gl = this.ghosts.ghosts;
      for (let i = gl.length - 1; i >= 0; i--) if (gl[i].state === "gone") this.ghosts.remove(gl[i]);
    }

    this.stepFear(dt, playing);
    this.stepDoors(dt);
    this.stepTimers(dt, playing);
  }

  private stepFear(dt: number, playing: boolean) {
    const s = this.player.s;
    const cam = this.rs.camera;
    const gl = this.ghosts.ghosts;
    let target = 0,
      drain = 0,
      nearest = 1e4;
    for (let i = 0; i < gl.length; i++) {
      const g = gl[i];
      if (!g.alive || g.state === "gone" || g.state === "banishing") continue;
      const d = Math.hypot(g.x - s.x, g.z - s.z);
      if (d < nearest) nearest = d;
      if (d > 18) continue;
      const seen = d < 12 && g.state !== "repelled" && onScreen(cam, g.x, 0.4, 1.7, g.z);
      const f = (1 - d / 18) * (seen ? 1 : 0.5) + (g.state === "chase" ? 0.18 : 0);
      if (f > target) target = f;
      if (seen && !s.hidden && d < 10 && this.phase !== "intro" && this.scareT <= 0) {
        const k = 1 - d / 10;
        drain += k * k * 7;
        this.lastAttacker = g.kind;
      }
    }
    if (this.phase === "escape") target = Math.max(target, 0.4);
    target = clamp(target, 0, 1);
    this.fear += (target - this.fear) * damp(target > this.fear ? 4 : 1.1, dt);
    if (!playing) return;

    if (drain > 0) {
      if (!this.god) s.nerve -= drain * this.diff.drain * dt;
    } else if (s.hidden || nearest > 15) s.nerve = Math.min(100, s.nerve + 1.5 * dt);
    if (s.nerve <= 0) {
      s.nerve = 0;
      if (!this.god) this.lose("caught");
      else s.nerve = 1;
    }

    // Heartbeat with fear or when shaken.
    const beat = Math.max(this.fear, clamp(1 - s.nerve / 35, 0, 1));
    this.heartT -= dt;
    if (beat > 0.3 && this.heartT <= 0) {
      this.audio.heart(beat);
      this.heartT = lerp(1.15, 0.42, beat);
    }
  }

  private stepTimers(dt: number, playing: boolean) {
    const s = this.player.s;
    this.scareT = Math.max(0, this.scareT - dt);
    this.shake = Math.max(0, this.shake - dt * (this.shake > 1 ? 2.2 : 1.4));
    this.hurt = Math.max(0, this.hurt - dt * 0.9);

    // EMF chirps and the UV hum.
    if (playing) {
      this.emfT -= dt;
      if (this.emfLevel > 0 && this.emfT <= 0) {
        this.audio.beep(this.emfLevel);
        this.emfT = EMF_GAP[this.emfLevel];
      }
      if (s.beaming) {
        if ((this.uvHumT -= dt) <= 0) {
          this.audio.uvHum(true);
          this.uvHumT = 0.1;
        }
        if (!this.wasBeaming) this.hud.flash("uv", 0.16);
      }
      this.wasBeaming = s.beaming;
    }

    // Lightning and thunder.
    this.lightningT -= dt;
    if (this.lightningT <= 0) {
      this.rs.lightning();
      this.lightningT = randRange(18, 40);
      this.thunderT = randRange(0.4, 2.6);
    }
    if (this.thunderT > 0 && (this.thunderT -= dt) <= 0) {
      this.audio.thunder(this.indoorK > 0.5);
      if (this.indoorK < 0.5) this.hud.caption("Thunder");
    }

    // Spoken PA, shortly after its chime.
    if (this.paSay && (this.paSayT -= dt) <= 0) {
      this.audio.speak(this.paSay);
      this.hud.pa(this.paSay);
      this.paSay = null;
    }

    if (this.phase === "hunt" || this.phase === "escape") {
      this.eventT -= dt;
      if (this.eventT <= 0) {
        this.ambientEvent();
        this.eventT = randRange(8, 22);
      }
    }
    if (this.phase === "hunt") {
      this.paT -= dt;
      if (this.paT <= 0) {
        this.announce(PA_LINES[(Math.random() * PA_LINES.length) | 0]);
        this.paT = randRange(60, 110);
      }
      if (this.escapeDelay > 0 && (this.escapeDelay -= dt) <= 0) this.startEscape();
    }

    if (this.phase === "escape") {
      if (!this.god) this.escapeT -= dt;
      const car = this.level.car;
      const dc = Math.hypot(s.x - car.x, s.z - car.z);
      if (!this.headFlickered && !s.indoor && dc < 20) {
        this.headFlickered = true;
        this.headFlickT = 1.8;
      }
      if (dc < CAR_RANGE || carGap(s.x, s.z, car) < 0.75) this.win();
      else if (this.escapeT <= 0) {
        this.escapeT = 0;
        this.lose("timer");
      }
    }
    if (this.headFlickT > 0) {
      this.headFlickT -= dt;
      const on = this.headFlickT <= 0 || hash(Math.floor(this.headFlickT * 15) * 3.17) > 0.45;
      if (on !== this.headOn) {
        this.headOn = on;
        this.level.setHeadlights(on);
      }
    }

    if (this.endDelay > 0 && (this.endDelay -= dt) <= 0) this.showEnd();
  }

  // ================================================================ doors

  private animDoors(to: number, dur: number) {
    const d = this.door;
    d.from = d.cur;
    d.to = to;
    d.t = 0;
    d.dur = dur;
  }

  private lockerDoor(id: number, peak: number, dur: number) {
    let a = this.lockerAnims.find((x) => x.id === id) ?? this.lockerAnims.find((x) => x.id < 0);
    if (!a) {
      a = this.lockerAnims[0];
      this.level.setLockerDoor(a.id, 0);
    }
    a.id = id;
    a.t = 0;
    a.dur = dur;
    a.peak = peak;
  }

  private stepDoors(dt: number) {
    const d = this.door;
    if (d.t < d.dur) {
      d.t = Math.min(d.dur, d.t + dt);
      const k = d.t / d.dur;
      // Slams accelerate shut; opening eases out.
      const e = d.to < d.from ? k * k : 1 - (1 - k) * (1 - k);
      d.cur = lerp(d.from, d.to, e);
      this.level.setFrontDoors(d.cur);
    }
    for (const a of this.lockerAnims) {
      if (a.id < 0) continue;
      a.t += dt;
      if (a.t >= a.dur) {
        this.level.setLockerDoor(a.id, 0);
        a.id = -1;
      } else this.level.setLockerDoor(a.id, a.peak * Math.sin((Math.PI * a.t) / a.dur));
    }
  }

  // ======================================================== interaction

  private findTarget() {
    const s = this.player.s;
    const cam = this.rs.camera;
    this.target = null;
    this.targetLocker = null;
    if (s.hidden) return;
    cam.getWorldDirection(_fwd);
    const ex = cam.position.x,
      ey = cam.position.y,
      ez = cam.position.z;
    let best = -1e9;
    for (let i = 0; i < this.interacts.length; i++) {
      const it = this.interacts[i];
      if (it.taken) continue;
      const hd = Math.hypot(it.x - s.x, it.z - s.z);
      if (hd > INTERACT_RANGE) continue;
      const vx = it.x - ex,
        vy = it.y + 0.03 - ey,
        vz = it.z - ez;
      const l = Math.hypot(vx, vy, vz) || 1;
      const dot = (vx * _fwd.x + vy * _fwd.y + vz * _fwd.z) / l;
      // Close to the feet the item fills more of the view, so allow a wider angle.
      if (dot < (hd < 1 ? 0.62 : 0.78)) continue;
      if (!los(s.x, s.z, it.x, it.z)) continue;
      const score = dot * 2 - hd * 0.3 + 0.15;
      if (score > best) {
        best = score;
        this.target = it;
      }
    }
    const lockers = this.level.lockers;
    for (let i = 0; i < lockers.length; i++) {
      const l = lockers[i];
      if (Math.abs(l.x - s.x) > 2.4 || Math.abs(l.z - s.z) > 2.4) continue;
      if ((s.x - l.x) * l.nx + (s.z - l.z) * l.nz < 0.15) continue;
      const px = l.x + l.nx * 0.3,
        pz = l.z + l.nz * 0.3;
      const hd = Math.hypot(px - s.x, pz - s.z);
      if (hd > 1.4) continue;
      // Aim at the nearest point on the door's height, so looking anywhere on it counts.
      const fh = Math.hypot(_fwd.x, _fwd.z) || 1e-3;
      const vx = px - ex,
        vy = clamp(ey + (_fwd.y * hd) / fh, 0.25, 1.85) - ey,
        vz = pz - ez;
      const len = Math.hypot(vx, vy, vz) || 1;
      const dot = (vx * _fwd.x + vy * _fwd.y + vz * _fwd.z) / len;
      if (dot < 0.8) continue;
      const score = dot * 2 - hd * 0.3;
      if (score > best) {
        best = score;
        this.target = null;
        this.targetLocker = l;
      }
    }
  }

  private interact() {
    const s = this.player.s;
    if (this.scareT > 0) return;
    if (s.hidden) {
      const id = s.hidden.id;
      this.player.exitLocker();
      this.lockerDoor(id, 0.85, 0.6);
      return;
    }
    this.findTarget();
    if (this.targetLocker) return this.hide(this.targetLocker);
    const it = this.target;
    if (!it || it.taken) return;
    if (it.type === "relic") this.takeRelic(it.relic!, true);
    else if (it.type === "cell") {
      it.taken = true;
      this.items.hidePickup("cell", it.idx);
      s.battery = Math.min(100, s.battery + 60);
      this.audio.pickup();
      this.hud.toast("UV cell. The beam is charged.");
    } else if (it.type === "choc") {
      it.taken = true;
      this.items.hidePickup("choc", it.idx);
      s.nerve = Math.min(100, s.nerve + 30);
      this.audio.pickup();
      this.hud.toast("Chocolate. Your nerve steadies.");
    } else if (it.type === "note") {
      it.taken = true;
      this.items.hidePickup("note", it.idx);
      this.notesFound++;
      const note = this.notes[it.note] ?? this.notes[0];
      this.releaseLock();
      this.hud.prompt(null);
      this.menus.showNote(note, () => this.noteClosed(note));
    }
  }

  private noteClosed(note: LoreNote) {
    if (note.hint && !this.found[note.hint] && !this.hinted[note.hint]) {
      this.hinted[note.hint] = true;
      this.refreshMarkers();
      this.hud.toast(`Clue marked on your map: the ${RELIC_NAME[note.hint]}.`, 3800);
    }
    this.input.clearPresses();
    this.acc = 0;
    if (this.active && !this.ending) this.input.requestLock();
  }

  private hide(l: LockerSpot) {
    const s = this.player.s;
    // Did anything see Brodie climb in?
    let seen = false;
    const gl = this.ghosts.ghosts;
    const range = sightRange(this.world);
    for (let i = 0; i < gl.length && !seen; i++) {
      const g = gl[i];
      if (!g.alive || g.state === "gone" || g.state === "repelled" || g.state === "banishing") continue;
      const d = Math.hypot(g.x - s.x, g.z - s.z);
      seen = d < range && los(g.x, g.z, s.x, s.z);
    }
    this.player.enterLocker(l);
    const rec = this.lockerRec;
    rec.spot = l;
    rec.t = this.simTime;
    rec.seen = seen;
    this.world.lastLocker = rec;
    this.lockerDoor(l.id, 0.75, 0.5);
  }

  private takeRelic(k: RelicKind, announce: boolean) {
    if (this.found[k]) return;
    this.found[k] = true;
    const it = this.interacts[RELICS.indexOf(k)];
    it.taken = true;
    this.items.hideRelic(k);
    this.refreshMarkers();
    this.refreshTally();
    this.refreshObjective();
    if (!announce) return;
    const first = RELICS.filter((r) => this.found[r]).length === 1;
    this.audio.relic();
    this.hud.flash("white", 0.25);
    this.hud.toast(`You have the ${RELIC_NAME[k]}. ${NAME[SPIRIT_OF[k]]} can be burned now.`, 4200);
    if (first) this.hud.toast("Taking it has made its spirit angry. It knows where you are.", 4600);
    const g = this.ghostOf(SPIRIT_OF[k]);
    if (g) this.hud.caption(`${g.name} screams`, this.dirTo(g.x, g.z));
  }

  // ========================================================== callbacks

  private onAttack(g: Ghost, fromLocker: boolean) {
    if (this.phase !== "hunt" && this.phase !== "escape") return;
    const s = this.player.s;
    const gentle = settings.gentle;
    const dur = this.ghosts.jumpScare(g, this.rs.camera, gentle);
    this.scareT = dur;
    this.hud.scareFlash(this.faceOf(g.kind), g.kind, gentle);
    this.audio.scream(gentle);
    this.hud.flash("red", gentle ? 0.5 : 1);
    this.shake = gentle ? 0.6 : 1.6;
    this.hurt = 1;
    this.lastAttacker = g.kind;
    if (fromLocker && s.hidden) {
      const id = s.hidden.id;
      this.player.exitLocker();
      this.lockerDoor(id, 1, 2.4);
    }
    if (!this.god) s.nerve = Math.max(0, s.nerve - (DAMAGE[g.kind] * this.diff.damage + (fromLocker ? 10 : 0)));
    if (s.nerve <= 0) this.lose("caught");
  }

  private onBanished(g: Ghost) {
    if (this.banished[g.kind]) return;
    this.banished[g.kind] = true;
    const s = this.player.s;
    this.hud.toast(FAREWELL[g.kind], 5600);
    this.hud.flash("white", 0.55);
    this.shake = Math.max(this.shake, 0.5);
    if (BLOOD[g.kind]) this.level.writeOnWall(s.x, s.z, s.yaw, BLOOD[g.kind]);
    this.refreshTally();
    const left = SPIRITS.filter((k) => !this.banished[k]).length;
    if (left === 0) {
      this.escapeDelay = 3.2;
      this.hud.caption("The building groans");
    } else this.hud.toast(`${3 - left} of 3 spirits at rest.`, 3200);
    this.refreshObjective();
  }

  private onRepelled(g: Ghost) {
    if (!this.repelTold) {
      this.repelTold = true;
      this.hud.toast(`The beam only drives ${mid(g.name)} away. Find what anchors it to the school.`, 5200);
    } else this.hud.caption(`${g.name} recoils from the light`, this.dirTo(g.x, g.z));
  }

  private onSpotted(g: Ghost) {
    if (this.simTime - this.stingT > 6) {
      this.stingT = this.simTime;
      this.audio.sting();
    }
    this.hud.caption(`${g.name} has seen you`, this.dirTo(g.x, g.z));
    if (!this.spottedTold) {
      this.spottedTold = true;
      this.hud.toast("Break its line of sight, or hide in a locker and hold your breath.", 4600);
    }
  }

  // ============================================================== phases

  private startHunt() {
    this.phase = "hunt";
    setFrontLocked(true);
    this.animDoors(0, 0.32);
    this.audio.slam(DOOR_POS);
    this.audio.sting();
    this.shake = 0.7;
    this.hud.flash("white", 0.12);
    this.hud.caption("The doors slam shut", "behind");
    this.announce(PA_LOCKED, 2.4);
    this.paT = randRange(55, 85);
    this.eventT = randRange(7, 12);
    this.hud.toast("The doors have locked behind you. Find the relics and put the spirits to rest.", 5200);
    this.refreshObjective();
    this.refreshTally();
  }

  private startEscape() {
    if (this.phase !== "hunt") return;
    this.phase = "escape";
    this.escapeT = this.diff.escapeTime;
    const L = this.level;
    L.setEmergency(true);
    // The lights die: only the working ones come back, in red.
    for (let i = 0; i < L.fixtures.length; i++) {
      const f = L.fixtures[i];
      if (f.room === ".") continue;
      this.base[i] = this.base[i] > 0 ? 1 : 0;
      f.level = this.base[i];
    }
    L.syncFixtures();
    this.audio.setEscape(true);
    this.audio.bell(8);
    setFrontLocked(false);
    this.animDoors(1, 1.8);
    this.audio.slam(DOOR_POS);
    this.spawnHollow();
    this.hud.flash("red", 0.45);
    this.shake = Math.max(this.shake, 0.5);
    this.announce(PA_ESCAPE, 1.2);
    this.hud.toast("The front doors are open. Run!", 4000);
    this.refreshObjective();
    this.refreshTally();
  }

  private spawnHollow() {
    const s = this.player.s;
    const fx = -Math.sin(s.yaw),
      fz = -Math.cos(s.yaw);
    const [pr, pc] = cellOf(s.x, s.z);
    const field = distanceField(pr, pc, false);
    let bx = 0,
      bz = 0,
      best = -1e9;
    for (let i = 0; i < INDOOR_CELLS.length; i++) {
      const [r, c] = INDOOR_CELLS[i];
      const d = field[r * COLS + c];
      if (d < 4 || d > 10) continue;
      const cx = c * T + T / 2,
        cz = r * T + T / 2;
      const vx = cx - s.x,
        vz = cz - s.z;
      const l = Math.hypot(vx, vz) || 1;
      const behind = -(vx * fx + vz * fz) / l;
      const score = behind - Math.abs(l - 20) * 0.06 + Math.random() * 0.25;
      if (score > best) {
        best = score;
        bx = cx;
        bz = cz;
      }
    }
    if (best === -1e9) {
      const b = roomBounds("G");
      bx = (b.x0 + b.x1) / 2;
      bz = (b.z0 + b.z1) / 2;
    }
    const g = this.ghosts.spawn("hollow", bx, bz);
    this.hollowOut = true;
    _snd.x = g.x;
    _snd.y = 1.6;
    _snd.z = g.z;
    this.audio.shriek(_snd);
    this.hud.caption("Something is coming", this.dirTo(g.x, g.z));
  }

  private win() {
    if (this.phase === "won" || this.phase === "lost") return;
    this.phase = "won";
    const s = this.player.s;
    this.audio.setEscape(false);
    this.audio.engine();
    this.audio.win();
    this.level.setHeadlights(true);
    this.headFlickT = 0;
    this.headOn = true;
    this.hud.setTimer(null);
    this.hud.flash("white", 0.3);
    const raw = 5000 + 400 * this.notesFound + 20 * s.nerve - 3 * this.runTime - 1500 * this.continuesUsed;
    const score = Math.max(0, Math.floor(raw * this.diff.scoreMult));
    const rank = score >= 8000 ? "S" : score >= 6500 ? "A" : score >= 5000 ? "B" : "C";
    const best = saveBest(settings.difficulty, { score, time: this.runTime, rank });
    this.result = {
      won: true,
      title: "School's Out",
      text: "Three spirits at rest and the Hollow left standing in the rain. Brodie pulls away as, somewhere behind him, every clock in Hollow Creek High starts ticking again.",
      time: this.runTime,
      score,
      rank,
      best,
      notes: this.notesFound,
      continuesUsed: this.continuesUsed,
      canContinue: false,
      image: this.assets.gen.ending ?? null,
      video: this.assets.gen.endingVideo ?? null,
    };
    this.endDelay = 2.2;
    this.refreshObjective();
  }

  private lose(reason: "caught" | "timer") {
    if (this.phase === "won" || this.phase === "lost") return;
    this.lostPhase = this.phase === "escape" ? "escape" : "hunt";
    this.phase = "lost";
    if (reason === "timer") {
      setFrontLocked(true);
      this.animDoors(0, 0.4);
      this.audio.slam(DOOR_POS);
      this.hud.flash("red", 0.6);
    }
    this.hud.setTimer(null);
    const banished = SPIRITS.filter((k) => this.banished[k]).length;
    const score = Math.max(0, Math.floor((400 * this.notesFound + 1000 * banished) * this.diff.scoreMult));
    const canContinue = this.continuesUsed < this.diff.continues;
    const who = NAME[this.lastAttacker];
    this.result = {
      won: false,
      title: reason === "timer" ? "Locked In" : "Caught",
      text:
        reason === "timer"
          ? "The bell stopped and every door locked itself. Hollow Creek High has a new pupil."
          : `Brodie's nerve gave out. ${who} has him now, and the school will not let him go.`,
      time: this.runTime,
      score,
      rank: "C",
      best: false,
      notes: this.notesFound,
      continuesUsed: this.continuesUsed,
      canContinue,
      image: null,
    };
    this.endDelay = reason === "timer" ? 2.2 : 1.7;
  }

  private async showEnd() {
    const r = this.result;
    if (!r || this.ending) return;
    this.ending = true;
    this.minimap.close();
    this.hud.prompt(null);
    this.hud.show(false);
    this.vm.setVisible(false);
    this.releaseLock();
    this.audio.stopSpeech();
    if (!r.won) this.audio.setEscape(false);
    const choice = await this.menus.end(r);
    if (!this.active) return;
    if (choice === "continue" && r.canContinue) this.doContinue();
    else if (choice === "restart") this.start();
    else this.quit();
  }

  /** Come round in the lobby with 60 nerve; the spirits scatter and the escape clock gets a reprieve. */
  private doContinue() {
    const L = this.level;
    this.continuesUsed++;
    this.ending = false;
    this.result = null;
    this.endDelay = -1;
    this.phase = this.lostPhase;
    this.player.reset(L.lobby);
    this.player.s.nerve = 60;
    this.scareT = this.shake = this.hurt = this.fear = 0;
    this.acc = 0;
    this.noises.length = 0;
    this.world.lastLocker = null;
    const gl = this.ghosts.ghosts;
    for (let i = 0; i < gl.length; i++) if (gl[i].alive) this.ghosts.scatter(gl[i], L.lobby.x, L.lobby.z, 25);
    if (this.phase === "escape") {
      this.escapeT = Math.max(this.escapeT, 45);
      setFrontLocked(false);
      this.animDoors(1, 1.2);
      this.audio.setEscape(true);
    } else if (this.escapeDelay <= 0 && SPIRITS.every((k) => this.banished[k])) this.escapeDelay = 2;
    this.hud.show(true);
    this.vm.setVisible(true);
    this.input.clearPresses();
    this.input.requestLock();
    this.hud.toast("Brodie comes round on the cold lobby floor.", 3800);
    this.refreshObjective();
    this.refreshTally();
  }

  // ======================================================== atmosphere

  private announce(text: string, delay = 1.3) {
    this.audio.chime();
    this.paSay = text;
    this.paSayT = delay;
  }

  /** Something happens somewhere nearby: whispers, thuds, slams, a light bursting. */
  private ambientEvent() {
    const s = this.player.s;
    if (!s.indoor) return;
    const p = _snd;
    let ok = false;
    for (let i = 0; i < 10 && !ok; i++) {
      const a = Math.random() * TAU,
        d = randRange(5, 16);
      p.x = s.x + Math.cos(a) * d;
      p.z = s.z + Math.sin(a) * d;
      ok = isIndoor(p.x, p.z) && charAt(p.x, p.z) !== " ";
    }
    if (!ok) return;
    p.y = 1.4;
    const dir = this.dirTo(p.x, p.z);
    const roll = Math.random();
    if (roll < 0.24) {
      this.audio.whisper(p);
      this.hud.caption("Whispering", dir);
    } else if (roll < 0.42) {
      p.y = 0.4;
      this.audio.thud(p);
      this.hud.caption("A heavy thud", dir);
    } else if (roll < 0.58) {
      this.audio.slam(p);
      this.hud.caption("A door slams", dir);
      this.shake = Math.max(this.shake, 0.15);
    } else if (roll < 0.74) {
      this.audio.clank(p);
      this.hud.caption("A locker bangs shut", dir);
    } else if (!this.burstLight()) {
      this.audio.whisper(p);
      this.hud.caption("Whispering", dir);
    }
  }

  private burstLight() {
    const s = this.player.s;
    const fx = this.level.fixtures;
    let pickI = -1,
      seen = 0;
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i];
      if (this.base[i] <= 0 || f.room === "." || f.instance < 0) continue;
      const d = Math.hypot(f.x - s.x, f.z - s.z);
      if (d < 3 || d > 14) continue;
      if (Math.random() * ++seen < 1) pickI = i;
    }
    if (pickI < 0) return false;
    const f = fx[pickI];
    this.base[pickI] = 0;
    _snd.x = f.x;
    _snd.y = f.y;
    _snd.z = f.z;
    this.audio.burst(_snd);
    this.hud.caption("A light bursts", this.dirTo(f.x, f.z));
    return true;
  }

  /** Fixture brightness: base level, flicker near spirits, and the odd random stutter. */
  private updateFixtures(dt: number, time: number) {
    const fx = this.level.fixtures;
    const gl = this.ghosts.ghosts;
    const s = this.player.s;
    const cam = this.rs.camera.position;
    let hum = 0;
    if (dt > 0 && Math.random() < dt * 0.4) {
      const i = (Math.random() * fx.length) | 0;
      const f = fx[i];
      if (this.base[i] > 0 && Math.abs(f.x - s.x) + Math.abs(f.z - s.z) < 26) this.amb[i] = randRange(0.25, 1.3);
    }
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i];
      const b = this.base[i];
      if (b <= 0) {
        f.level = 0;
        continue;
      }
      let lv = b;
      let near = 0;
      for (let j = 0; j < gl.length; j++) {
        const g = gl[j];
        if (!g.alive || g.state === "gone") continue;
        const dx = g.x - f.x,
          dz = g.z - f.z,
          d2 = dx * dx + dz * dz;
        if (d2 < 36) {
          const k = 1 - Math.sqrt(d2) / 6;
          if (k > near) near = k;
        }
      }
      if (near > 0) {
        const h = hash(i * 12.9898 + Math.floor(time * (8 + near * 16)) * 78.233);
        lv *= h < near * 0.6 ? 0.03 + h * 0.25 : 0.72 + 0.28 * hash(i * 3.1 + time * 7.7);
      }
      const a = this.amb[i];
      if (a > 0) {
        this.amb[i] = a - dt;
        const h = hash(i * 3.7 + Math.floor(time * 17) * 1.37);
        lv *= h < 0.4 ? 0.06 : 0.85 + 0.15 * h;
      }
      f.level = lv;
      if (f.room !== ".") {
        const dx = f.x - cam.x,
          dz = f.z - cam.z,
          d2 = dx * dx + dz * dz;
        if (d2 < 30) {
          const k = lv * (1 - Math.sqrt(d2) / 5.5);
          if (k > hum) hum = k;
        }
      }
    }
    this.hum = hum;
    this.level.syncFixtures();
    this.rs.updateLights(fx, cam);
  }

  // ================================================================= HUD

  private updateHud(blocked: boolean) {
    const s = this.player.s;
    const hud = this.hud;
    const b = this.bars;
    b.nerve = s.nerve;
    b.battery = s.battery;
    b.stamina = s.stamina;
    b.breath = s.hidden ? s.breath : null;
    b.breathDanger = s.gaspCooldown > 0 || s.breath < 30;
    b.breathLabel = s.gaspCooldown > 0 ? "Catch your breath" : s.holdingBreath ? "Holding your breath" : "Hold your breath";
    hud.setBars(b);
    hud.setTimer(this.phase === "escape" ? Math.max(0, this.escapeT) : null);
    hud.setLockerVents(!!s.hidden && this.active);
    hud.setFps(settings.showFps ? this.rs.stats.fps : null, this.rs.stats.scale);

    // Crosshair ring while a spirit burns.
    let ring: number | null = null;
    const gl = this.ghosts.ghosts;
    for (let i = 0; i < gl.length; i++) {
      const g = gl[i];
      if (g.state === "stunned" || (g.lit && g.relic && this.found[g.relic])) ring = g.hp / g.maxHp;
      else if (g.state === "banishing" && ring === null) ring = 0;
    }
    hud.setTargetRing(this.active ? ring : null);

    // Interaction prompt, shown continuously.
    let p: string | null = null;
    const live = this.active && !this.ending && (this.phase === "intro" || this.phase === "hunt" || this.phase === "escape");
    if (live && !blocked) {
      const touch = this.isTouch();
      if (!touch && !this.input.usingGamepad && !this.input.locked) p = "Click to look around";
      else if (s.hidden) p = this.promptText("leave", touch);
      else {
        this.findTarget();
        if (this.targetLocker) p = this.promptText("locker", touch);
        else if (this.target) p = this.promptText(this.target.type === "relic" ? (this.target.relic as PromptKey) : (this.target.type as PromptKey), touch);
      }
    }
    hud.prompt(p);
  }

  private promptText(k: PromptKey, touch: boolean) {
    const mode = touch ? 2 : this.input.usingGamepad ? 1 : 0;
    const cache = this.promptCache[mode];
    let t = cache[k];
    if (!t) {
      t = `${["[E]", "[A]", "[Use]"][mode]} ${PROMPTS[k]}`;
      if (k === "leave") t += ["   [Space] Hold your breath", "   [LT] Hold your breath", "   [UV] Hold your breath"][mode];
      cache[k] = t;
    }
    return t;
  }

  private refreshObjective() {
    let t: string;
    if (this.phase === "intro") t = "Get inside the school. The front doors are across the car park.";
    else if (this.phase === "escape") t = "Run! Get back to the car before the bell stops.";
    else if (this.phase === "won") t = "You made it out.";
    else if (this.phase === "lost") t = this.lastObjective;
    else {
      const n = SPIRITS.filter((k) => this.banished[k]).length;
      const held = RELICS.find((k) => this.found[k] && !this.banished[SPIRIT_OF[k]]);
      if (n === 3) t = "Something else is waking up. Get ready to run.";
      else if (held) t = `Burn ${mid(NAME[SPIRIT_OF[held]])} with your UV beam while you carry the ${RELIC_NAME[held]}.`;
      else if (n === 0 && !RELICS.some((k) => this.found[k])) t = "Find the relics that anchor the spirits. Your UV beam shows the way.";
      else t = `Find the next relic. ${n} of 3 spirits at rest.`;
    }
    if (t !== this.lastObjective) {
      this.lastObjective = t;
      this.hud.setObjective(t);
    }
  }

  private refreshTally() {
    const list: { name: string; state: "loose" | "anchored" | "vulnerable" | "at rest" }[] = SPIRITS.map((k) => {
      const relic = RELICS.find((r) => SPIRIT_OF[r] === k)!;
      return { name: NAME[k], state: this.banished[k] ? "at rest" : this.found[relic] ? "vulnerable" : "anchored" };
    });
    if (this.hollowOut) list.push({ name: NAME.hollow, state: "loose" });
    this.hud.setSpirits(list);
    this.hud.setRelics(RELICS.map((k) => ({ name: RELIC_SHORT[k], found: this.found[k] })));
  }

  private refreshMarkers() {
    const car = this.level.car;
    const m: { x: number; z: number; kind: "relic" | "note" | "car" | "hint"; label: string }[] = [{ x: car.x, z: car.z, kind: "car", label: "Car" }];
    for (const k of RELICS) {
      if (!this.hinted[k] || this.found[k]) continue;
      const s = this.relicSpot[k];
      m.push({ x: s.x, z: s.z, kind: "hint", label: `${RELIC_SHORT[k]}? ${cap(s.label)}` });
    }
    this.minimap.setMarkers(m);
  }

  // ============================================================= helpers

  private pushNoise(x: number, z: number, r: number) {
    const n = this.noisePool[this.noiseNext];
    this.noiseNext = (this.noiseNext + 1) % this.noisePool.length;
    const old = this.noises.indexOf(n);
    if (old >= 0) this.noises.splice(old, 1);
    n.x = x;
    n.z = z;
    n.r = r;
    n.t = this.simTime;
    this.noises.push(n);
  }

  private dirTo(x: number, z: number): Dir {
    const s = this.player.s;
    const dx = x - s.x,
      dz = z - s.z;
    const fwd = -dx * Math.sin(s.yaw) - dz * Math.cos(s.yaw);
    const right = dx * Math.cos(s.yaw) - dz * Math.sin(s.yaw);
    if (Math.abs(fwd) >= Math.abs(right)) return fwd >= 0 ? "ahead" : "behind";
    return right >= 0 ? "right" : "left";
  }

  private ghostOf(kind: GhostKind): Ghost | null {
    const gl = this.ghosts.ghosts;
    for (let i = 0; i < gl.length; i++) if (gl[i].kind === kind && gl[i].alive) return gl[i];
    return null;
  }

  private faceOf(kind: GhostKind): HTMLImageElement | null {
    const g = this.assets.gen;
    return (kind === "queen" ? g.faceQueen : kind === "janitor" ? g.faceJanitor : kind === "principal" ? g.facePrincipal : undefined) ?? null;
  }

  /** "Best: Normal 8,420 (S)" for the title screen. */
  bestLine() {
    const all = loadBest();
    const parts: string[] = [];
    for (const d of ["easy", "normal", "nightmare"] as const) {
      const b = all[d];
      if (b) parts.push(`${DIFFICULTY[d].label} ${b.score.toLocaleString("en-GB")} (${b.rank}, ${formatTime(b.time)})`);
    }
    return parts.length ? "Best: " + parts.join(" · ") : "";
  }

  // =============================================================== debug

  installDebug() {
    this.debug = true;
    this.rs.renderer.info.autoReset = false;
    const g = this.ghosts;
    const api = {
      state: () => {
        const s = this.player.s;
        return {
          phase: this.phase,
          x: s.x,
          z: s.z,
          yaw: s.yaw,
          nerve: s.nerve,
          battery: s.battery,
          hidden: !!s.hidden,
          relics: { ...this.found },
          notes: this.notesFound,
          escapeTime: this.escapeT,
          ghosts: g.ghosts.map((o) => ({ kind: o.kind, x: o.x, z: o.z, state: o.state, hp: o.hp, alive: o.alive })),
          fps: this.rs.stats.fps,
          drawCalls: this.drawCalls,
          triangles: this.triangles,
        };
      },
      teleport: (x: number, z: number, yaw?: number, pitch = 0) => {
        const s = this.player.s;
        if (s.hidden) this.player.exitLocker();
        s.x = x;
        s.z = z;
        s.vx = s.vz = 0;
        if (typeof yaw === "number") s.yaw = yaw;
        s.pitch = pitch;
      },
      setPhase: (p: Phase) => {
        if (p === "intro") this.start();
        else if (p === "hunt") {
          if (this.phase === "intro") this.startHunt();
        } else if (p === "escape") {
          if (this.phase === "intro") this.startHunt();
          for (const k of SPIRITS) if (!this.banished[k]) api.banish(k);
          this.escapeDelay = -1;
          this.startEscape();
        } else if (p === "won") this.win();
        else if (p === "lost") this.lose("caught");
      },
      giveRelics: () => {
        for (const k of RELICS) this.takeRelic(k, false);
      },
      banish: (kind: GhostKind) => {
        const ghost = this.ghostOf(kind);
        if (!ghost || kind === "hollow") return false;
        this.onBanished(ghost);
        g.remove(ghost);
        return true;
      },
      spawnNear: (kind: GhostKind, dist = 4) => {
        const s = this.player.s;
        const o = g.spawn(kind, s.x - Math.sin(s.yaw) * dist, s.z - Math.cos(s.yaw) * dist);
        return { kind: o.kind, x: o.x, z: o.z };
      },
      god: (on = true) => {
        this.god = on;
        return on;
      },
      /** Run the simulation for `seconds` without drawing, with optional held input. */
      sim: (seconds: number, held: Partial<PlayerInput> = {}) => {
        this.simInput = held;
        const cam = this.rs.camera;
        try {
          for (let t = 0; t < seconds; t += STEP) {
            this.step(STEP);
            this.player.applyCamera(1, this.shake);
            cam.updateMatrixWorld();
            this.ghosts.animate(STEP, this.simTime, cam);
            cam.getWorldDirection(_fwd);
            uvBeam.origin.copy(cam.position);
            uvBeam.dir.copy(_fwd);
            uvBeam.on = this.player.s.beaming ? 1 : 0;
            if (this.ending) break;
          }
        } finally {
          this.simInput = null;
        }
        return api.state();
      },
      /** Interact with whatever is in front, as the E key does. */
      interact: () => {
        this.interact();
        return api.state();
      },
      spots: () => ({
        relics: { ...this.relicSpot },
        lockers: this.level.lockers.slice(0, 4),
        car: this.level.car,
        lobby: this.level.lobby,
        items: this.interacts.map((i) => ({ type: i.type, x: i.x, y: i.y, z: i.z, taken: i.taken })),
        decals: this.decals.map((d) => ({ name: d.name, x: d.position.x, y: d.position.y, z: d.position.z, ry: d.rotation.y })),
      }),
    };
    (window as unknown as { __brodie: typeof api }).__brodie = api;
  }
}

// ---------------------------------------------------------------- walls

/** Distance from (x, z) to the side of the estate car's 2 x 5.8 m footprint. */
function carGap(x: number, z: number, car: { x: number; z: number; yaw: number }) {
  const dx = x - car.x,
    dz = z - car.z;
  const c = Math.cos(car.yaw),
    s = Math.sin(car.yaw);
  const lx = dx * c - dz * s,
    lz = dx * s + dz * c;
  return Math.hypot(Math.max(Math.abs(lx) - 1, 0), Math.max(Math.abs(lz) - 2.9, 0));
}

/** Is there a sight-blocking wall within 0.4 m of (x, z) in direction (dx, dz)? */
function wallBehind(x: number, z: number, dx: number, dz: number) {
  return !los(x, z, x + dx * 0.4, z + dz * 0.4);
}

/**
 * The closest wall to (x, z) along the four axes that has a clear stretch of
 * at least `half` metres either side (so writing never hangs over a doorway).
 * Returns the point on its face and the normal pointing back into the room.
 */
function wallNear(x: number, z: number, maxD: number, half: number) {
  let best: { x: number; z: number; nx: number; nz: number } | null = null,
    bestD = 1e9;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dz] of dirs) {
    let hit = -1;
    for (let d = 0.2; d <= maxD; d += 0.1) {
      if (!los(x, z, x + dx * d, z + dz * d)) {
        hit = d;
        break;
      }
    }
    if (hit < 0) continue;
    let lo = hit - 0.1,
      hi = hit;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (los(x, z, x + dx * mid, z + dz * mid)) lo = mid;
      else hi = mid;
    }
    const wx = x + dx * lo,
      wz = z + dz * lo;
    const tx = -dz,
      tz = dx;
    let ok = true;
    for (let k = -2; k <= 2 && ok; k++) {
      const o = (k / 2) * half;
      const px = wx + tx * o - dx * 0.15,
        pz = wz + tz * o - dz * 0.15;
      ok = los(wx - dx * 0.15, wz - dz * 0.15, px, pz) && wallBehind(px, pz, dx, dz);
    }
    if (!ok) continue;
    if (lo < bestD) {
      bestD = lo;
      best = { x: wx, z: wz, nx: -dx, nz: -dz };
    }
  }
  return best;
}
