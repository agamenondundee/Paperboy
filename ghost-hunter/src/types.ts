/**
 * Contracts between modules. Each module implements the interfaces here and
 * exports the factory named in its comment, so modules can be built and
 * replaced independently. Keep these stable: change a signature here first.
 */
import type * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { DifficultyPreset, Quality } from "./core/settings";

// ------------------------------------------------------------------ assets
// Implemented in src/world/assets.ts: export function loadAssets(onProgress: (f: number) => void): Promise<Assets>
export interface Assets {
  /** Photo textures shipped in public/assets. null if a file failed to load. */
  tex: {
    brick: THREE.Texture | null;
    brickBump: THREE.Texture | null;
    brickRough: THREE.Texture | null;
    wood: THREE.Texture | null;
    woodRough: THREE.Texture | null;
    checker: THREE.Texture | null;
    checkerNormal: THREE.Texture | null;
    splat: THREE.Texture | null;
    splatNormal: THREE.Texture | null;
    water: THREE.Texture | null;
    headColour: THREE.Texture | null;
    headNormal: THREE.Texture | null;
  };
  /** Optional Higgsfield art from public/assets/gen. Missing files are undefined. */
  gen: {
    title?: HTMLImageElement;
    ending?: HTMLImageElement;
    faceQueen?: HTMLImageElement;
    faceJanitor?: HTMLImageElement;
    facePrincipal?: HTMLImageElement;
    posterMissing?: THREE.Texture;
    posterProm?: THREE.Texture;
    wall?: THREE.Texture;
    floor?: THREE.Texture;
    /** URL of the intro video if the file exists. */
    introVideo?: string;
    /** URL of the ending video (ending-video.mp4) if the file exists. */
    endingVideo?: string;
    /** Short clips (vision-queen.mp4 and so on) played the first time each spirit is spotted. */
    visions?: Partial<Record<GhostKind, string>>;
    /** Filmed apparition loops (ghost-queen.mp4 and so on) that replace the 3D ghost bodies. */
    ghostLoops?: Partial<Record<GhostKind, string>>;
    /** Prom night flashback played the first time the player enters the gym. */
    flashbackGym?: string;
  };
  xbot: GLTF | null; // rigged mannequin with clips: idle, walk, run, sneak_pose, sad_pose, agree, headShake
  lee: GLTF | null; // scanned head mesh
  hdr: THREE.DataTexture | null; // equirectangular night sky, not yet PMREM processed
}

// ---------------------------------------------------------------- rendering
// Implemented in src/render/renderer.ts: export function createRenderSystem(container: HTMLElement, assets: Assets): RenderSystem
export interface LightFixture {
  x: number;
  y: number;
  z: number;
  color: THREE.Color;
  /** Point light intensity in candela at full brightness. */
  intensity: number;
  range: number;
  /** Current brightness 0..1, written by the game each frame (flicker, outages). */
  level: number;
  /** Instance index in the level's emissive fixture mesh, or -1. */
  instance: number;
  room: string;
}

export interface RenderSystem {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** First-person viewmodel scene, drawn over the world with its depth cleared. */
  vmScene: THREE.Scene;
  /** Torch spotlight, a child of the camera, casts shadows. Colour/intensity/angle are set by the player. */
  torch: THREE.SpotLight;
  /** Assigns the nearest lit fixtures to the fixed pool of point lights. Call once per frame. */
  updateLights(fixtures: LightFixture[], from: THREE.Vector3): void;
  /** 0 outside .. 1 inside: fog colour and density, environment and moon intensity. */
  setIndoor(k: number): void;
  /** Post effect inputs, all 0..1. */
  setFx(fx: { fear: number; lowNerve: number; hurt: number; uv: number; escape: number }): void;
  /** Bright flash of lightning outside (sky, moon and window glow). */
  lightning(): void;
  applyQuality(q: Quality): void;
  setFov(deg: number): void;
  resize(): void;
  render(dt: number, time: number): void;
  /** Compile every shader in both scenes before play starts. */
  compile(): Promise<void>;
  stats: { fps: number; scale: number };
}

// Implemented in src/render/weather.ts: export function createWeather(scene: THREE.Scene, quality: Quality): Weather
export interface Weather {
  /** GPU rain around the camera (outdoors) and drifting dust (indoors). */
  update(time: number, cam: THREE.Vector3, indoor: number): void;
  setQuality(q: Quality): void;
}

// ------------------------------------------------------------- UV reveal
// Implemented in src/world/uvReveal.ts:
//   export const uvBeam: UvBeam
//   export function addUvDecal(scene: THREE.Object3D, d: UvDecal): THREE.Mesh
export interface UvBeam {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  /** cos of the cone half-angle */
  cos: number;
  range: number;
  /** 0..1, how strongly the beam is on (fades). */
  on: number;
}
export interface UvDecal {
  kind: "hand" | "foot" | "text";
  text?: string;
  /** Centre position. */
  x: number;
  y: number;
  z: number;
  /** Euler rotation (YXZ). Floor decals use rx = -PI/2. */
  rx: number;
  ry: number;
  rz: number;
  /** Width in metres (height follows the texture's aspect). */
  size: number;
}

// -------------------------------------------------------------------- level
// Implemented in src/world/level.ts: export function buildLevel(scene: THREE.Scene, assets: Assets, quality: Quality): Level
export type Surface = "hard" | "wood" | "wet" | "soft" | "metal";
export interface Spot {
  x: number;
  y: number;
  z: number;
  room: string; // room character from map.ts
  yaw: number;
  label: string; // e.g. "the gym stage"
}
export interface LockerSpot {
  id: number;
  x: number;
  z: number;
  /** Outward normal of the locker door (unit, axis aligned). */
  nx: number;
  nz: number;
  /** Yaw the player faces when inside, looking out through the vents. */
  yaw: number;
}
export type RelicKind = "crown" | "keys" | "register";
export interface Level {
  fixtures: LightFixture[];
  /** Push fixture levels into the emissive instance colours. Call once per frame after changing levels. */
  syncFixtures(): void;
  /** Turn the building's lights to red emergency lighting (escape phase). */
  setEmergency(on: boolean): void;
  lockers: LockerSpot[];
  /** Animate a locker door, 0 closed .. 1 open. */
  setLockerDoor(id: number, open: number): void;
  relicSpots: Record<RelicKind, Spot[]>;
  /** Candidate places on surfaces for pickups and notes, spread across rooms. */
  itemSpots: Spot[];
  /** Where the player starts (beside the car) and the car itself. */
  spawn: { x: number; z: number; yaw: number };
  car: { x: number; z: number; yaw: number };
  /** Where you come round after using a continue. */
  lobby: { x: number; z: number; yaw: number };
  /** Front entrance doors, 0 shut .. 1 open. */
  setFrontDoors(open: number): void;
  setHeadlights(on: boolean): void;
  surfaceAt(x: number, z: number): Surface;
  /** Write text on the nearest wall in front of a point (blood writing). */
  writeOnWall(x: number, z: number, yaw: number, text: string): void;
  /** Per-frame animation of decorative things (disco ball, flag, candles). */
  update(dt: number, time: number): void;
}

// ------------------------------------------------------------------- player
// Implemented in src/game/player.ts: export class Player implements PlayerApi
//   constructor(deps: { camera: THREE.PerspectiveCamera; torch: THREE.SpotLight; audio: AudioEngine; level: Level })
export interface PlayerState {
  x: number;
  z: number;
  /** Eye height above the floor, including crouch and bob. */
  eye: number;
  yaw: number;
  pitch: number;
  vx: number;
  vz: number;
  crouch: number; // 0..1
  stamina: number;
  winded: boolean;
  nerve: number;
  battery: number;
  breath: number;
  holdingBreath: boolean;
  gaspCooldown: number;
  torchOn: boolean;
  beaming: boolean;
  hidden: LockerSpot | null;
  running: boolean;
  moving: boolean;
  /** Noise radius this step (metres). */
  noise: number;
  bob: number; // head bob phase
  indoor: boolean;
  room: string;
}
export interface PlayerInput {
  moveX: number;
  moveY: number;
  run: boolean;
  crouch: boolean;
  beam: boolean;
  breath: boolean;
}
export interface PlayerApi {
  s: PlayerState;
  reset(at: { x: number; z: number; yaw: number }): void;
  /** Mouse/stick look, radians. Applied every rendered frame. */
  look(dx: number, dy: number): void;
  /** Fixed-step simulation. */
  step(dt: number, inp: PlayerInput, opts: { canMove: boolean; drain: number; headBob: boolean }): void;
  /** Place the camera between the previous and current step. */
  applyCamera(alpha: number, shake: number): void;
  enterLocker(l: LockerSpot): void;
  exitLocker(): void;
  /** Called with noise events (x, z, radius) for the ghosts to hear. */
  onNoise: (x: number, z: number, r: number) => void;
}

// Implemented in src/game/viewmodel.ts: export function createViewmodel(vmScene: THREE.Scene, camera: THREE.PerspectiveCamera): Viewmodel
export interface Viewmodel {
  update(
    dt: number,
    v: {
      beaming: boolean;
      torchOn: boolean;
      emfLevel: number; // 0..5
      emfValue: number; // milligauss shown on the screen
      hidden: boolean;
      bob: number;
      moving: boolean;
      running: boolean;
      lookDX: number; // this frame's look delta, for sway
      lookDY: number;
      fear: number;
      battery: number;
    }
  ): void;
  setVisible(v: boolean): void;
}

// ------------------------------------------------------------------- ghosts
// Implemented in src/game/ghosts.ts: export class GhostSystem implements GhostSystemApi
//   constructor(deps: { scene: THREE.Scene; assets: Assets; audio: AudioEngine })
export type GhostKind = "queen" | "janitor" | "principal" | "hollow";
export type GhostState = "idle" | "wander" | "investigate" | "chase" | "search" | "locker" | "repelled" | "stunned" | "banishing" | "gone";
export interface Ghost {
  kind: GhostKind;
  name: string;
  relic: RelicKind | null;
  root: THREE.Object3D;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  state: GhostState;
  /** True while the UV beam is on it this step. */
  lit: boolean;
  /** Seconds the player has been in its sight. */
  seenFor: number;
}
export interface GhostWorld {
  time: number;
  phase: "intro" | "hunt" | "escape";
  player: PlayerState;
  camera: THREE.PerspectiveCamera;
  diff: DifficultyPreset;
  beam: UvBeam;
  hasRelic(k: RelicKind): boolean;
  /** Recent noises, newest last; entries older than 1.5 s are removed by the game. */
  noises: { x: number; z: number; r: number; t: number }[];
  /** Locker the player most recently entered and when, so ghosts can check it. */
  lastLocker: { spot: LockerSpot; t: number; seen: boolean } | null;
  onAttack(g: Ghost, fromLocker: boolean): void;
  onBanished(g: Ghost): void;
  onRepelled(g: Ghost): void;
  onSpotted(g: Ghost): void;
}
export interface GhostSystemApi {
  ghosts: Ghost[];
  spawn(kind: GhostKind, x: number, z: number): Ghost;
  remove(g: Ghost): void;
  /** Move a ghost somewhere far from the player (after an attack or a continue). */
  scatter(g: Ghost, fromX: number, fromZ: number, minDist: number): void;
  /** Fixed-step AI. */
  step(dt: number, w: GhostWorld): void;
  /** Per-frame visuals (animation mixers, shader time). */
  animate(dt: number, time: number, camera: THREE.Camera): void;
  /** Distance to the nearest living ghost, for the EMF meter. */
  nearest(x: number, z: number): number;
  /** Put a ghost right in front of the camera for a jump scare; returns duration in seconds. */
  jumpScare(g: Ghost, camera: THREE.Camera, gentle: boolean): number;
  /** Shader warm-up: make every ghost material visible to renderer.compile. */
  warmup(scene: THREE.Scene): void;
}

// ----------------------------------------------------------------------- UI
// Implemented in src/ui/hud.ts: export class Hud implements HudApi (uses DOM ids from index.html)
export interface HudApi {
  show(v: boolean): void;
  setBars(b: { nerve: number; battery: number; stamina: number; breath: number | null; breathDanger: boolean; breathLabel: string }): void;
  setObjective(text: string): void;
  setSpirits(list: { name: string; state: "loose" | "anchored" | "vulnerable" | "at rest" }[]): void;
  setRelics(list: { name: string; found: boolean }[]): void;
  setTimer(seconds: number | null): void;
  toast(text: string, ms?: number): void;
  /** Sound caption with an optional direction arrow, only shown when captions are on. */
  caption(text: string, dir?: "left" | "right" | "ahead" | "behind"): void;
  prompt(text: string | null): void;
  /** Crosshair ring showing a spirit's remaining HP while it burns, or null. */
  setTargetRing(frac: number | null): void;
  flash(colour: "red" | "white" | "uv", strength: number): void;
  /** 2D jump-scare frame (Higgsfield face or a drawn fallback) over the 3D scare. */
  scareFlash(img: HTMLImageElement | null, kind: GhostKind, gentle: boolean): void;
  setLockerVents(on: boolean): void;
  setFps(fps: number | null, scale: number): void;
  pa(text: string): void; // PA announcement subtitle
}

// Implemented in src/ui/minimap.ts: export class Minimap implements MinimapApi (canvas id "mapCanvas")
export interface MinimapApi {
  /** Mark the room containing (x, z) as explored. */
  visit(x: number, z: number): void;
  setMarkers(m: { x: number; z: number; kind: "relic" | "note" | "car" | "hint"; label: string }[]): void;
  open(player: { x: number; z: number; yaw: number }): void;
  close(): void;
  isOpen(): boolean;
  reset(): void;
}

// Implemented in src/ui/menus.ts: export class Menus implements MenusApi
export interface EndResult {
  won: boolean;
  title: string;
  text: string;
  time: number;
  score: number;
  rank: string;
  best: boolean;
  notes: number;
  continuesUsed: number;
  canContinue: boolean;
  image: HTMLImageElement | null;
  /** Looping background video for the end screen, shown over the image. */
  video?: string | null;
}
export interface Note {
  id: string;
  title: string;
  body: string;
}
export interface MenusApi {
  setLoading(frac: number, label: string): void;
  /** Title screen. Resolves when the player starts, with the chosen difficulty already saved to settings. */
  title(bg: HTMLImageElement | null, best: string): Promise<void>;
  /** Plays the intro video full screen; resolves when it ends or is skipped. */
  playIntro(url: string): Promise<void>;
  pause(handlers: { resume(): void; restart(): void; quit(): void }): void;
  closePause(): void;
  isPaused(): boolean;
  showNote(n: Note, onClose: () => void): void;
  isNoteOpen(): boolean;
  /** End screen; resolves with the player's choice. */
  end(r: EndResult): Promise<"continue" | "restart" | "quit">;
  /** Settings changed in the menus: the game applies them. */
  onSettingsChanged: () => void;
  showError(text: string): void;
}
