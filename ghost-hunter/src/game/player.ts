import * as THREE from "three";
import type { AudioEngine } from "../core/audio";
import type { Level, LockerSpot, PlayerApi, PlayerInput, PlayerState } from "../types";
import { collide, isIndoor, charAt } from "../world/map";
import { clamp, damp, lerp, lerpAngle, smoothstep, wrapAngle } from "../core/util";

/**
 * Brodie: first-person movement, stamina, footsteps and noise, the torch and
 * its UV beam, and hiding in lockers. The simulation runs at a fixed rate;
 * the camera is placed between the last two steps so motion stays smooth at
 * any frame rate, while look input is applied straight away every frame.
 */

const RADIUS = 0.3;
const EYE_STAND = 1.65;
const EYE_CROUCH = 1.1;
const SPEED_WALK = 2.6;
const SPEED_RUN = 5.2;
const SPEED_CROUCH = 1.4;
const ACCEL = 12;

const STAMINA_MAX = 100;
const STAMINA_DRAIN = 22;
const STAMINA_REGEN = 14;
const STAMINA_DELAY = 1;
const WINDED_UNTIL = 30;

const NOISE_RUN = 12;
const NOISE_WALK = 5;
const NOISE_CROUCH = 0.5;
const NOISE_CLANK = 8;
const NOISE_GASP = 7;

const BATTERY_MAX = 100;
const BATTERY_DRAIN = 14;
const BATTERY_RECHARGE = 3;

const BREATH_MAX = 100;
const BREATH_DRAIN = 22;
const BREATH_RECOVER = 15;
const GASP_COOLDOWN = 1.6;

const PITCH_LIMIT = 1.35;
const LOCKER_YAW = 0.55;
const LOCKER_PITCH = 0.35;
/** Camera sits this far from the locker's centre towards its door. */
const LOCKER_INSET = 0.1;
const LOCKER_EYE = 1.6;
const LOCKER_EXIT = 0.8;

// Stride lengths in metres per footstep. Running covers more ground per
// stride but at a much quicker cadence.
const STRIDE_WALK = 0.95;
const STRIDE_RUN = 1.35;
const STRIDE_CROUCH = 0.62;

// Torch looks.
const TORCH_WARM = new THREE.Color(0xfff1d6);
const TORCH_UV = new THREE.Color(0xb59cff);
const TORCH_ANGLE = 0.55;
const UV_ANGLE = 0.32;
const TORCH_INTENSITY = 45;
const UV_INTENSITY = 70;
const LOW_BATTERY = 15;

interface Tween {
  active: boolean;
  t: number;
  dur: number;
  /** Drive yaw and pitch as well (entering a locker). */
  rot: boolean;
  fx: number;
  fz: number;
  fyaw: number;
  fpitch: number;
  feye: number;
  tx: number;
  tz: number;
  tyaw: number;
  tpitch: number;
  teye: number;
}

export class Player implements PlayerApi {
  s: PlayerState;
  onNoise: (x: number, z: number, r: number) => void = () => {};

  private camera: THREE.PerspectiveCamera;
  private torch: THREE.SpotLight;
  private audio: AudioEngine;
  private level: Level;

  // Interpolation: previous and current step values.
  private px = 0;
  private pz = 0;
  private pEye = EYE_STAND;
  private pSide = 0;
  private pRoll = 0;
  private pYaw = 0;
  private pPitch = 0;
  private side = 0; // lateral head bob, metres
  private roll = 0;
  private baseEye = EYE_STAND; // eye height before bob

  private bobAmp = 0;
  private sinceRun = 10;
  private pantTimer = 0;
  private beamLocked = false;
  private flick = 1;
  private flickHold = 0;
  private torchLevel = TORCH_INTENSITY;
  private time = 0;
  private lastDt = 1 / 60;
  private readonly p = { x: 0, z: 0 };
  private readonly tw: Tween = {
    active: false,
    t: 0,
    dur: 0.4,
    rot: false,
    fx: 0,
    fz: 0,
    fyaw: 0,
    fpitch: 0,
    feye: 0,
    tx: 0,
    tz: 0,
    tyaw: 0,
    tpitch: 0,
    teye: 0,
  };
  private readonly targetColour = new THREE.Color();

  constructor(deps: { camera: THREE.PerspectiveCamera; torch: THREE.SpotLight; audio: AudioEngine; level: Level }) {
    this.camera = deps.camera;
    this.torch = deps.torch;
    this.audio = deps.audio;
    this.level = deps.level;
    this.camera.rotation.order = "YXZ";
    this.s = {
      x: 0,
      z: 0,
      eye: EYE_STAND,
      yaw: 0,
      pitch: 0,
      vx: 0,
      vz: 0,
      crouch: 0,
      stamina: STAMINA_MAX,
      winded: false,
      nerve: 100,
      battery: BATTERY_MAX,
      breath: BREATH_MAX,
      holdingBreath: false,
      gaspCooldown: 0,
      torchOn: true,
      beaming: false,
      hidden: null,
      running: false,
      moving: false,
      noise: 0,
      bob: 0,
      indoor: false,
      room: " ",
    };
    this.torch.color.copy(TORCH_WARM);
    this.torch.angle = TORCH_ANGLE;
    this.torch.intensity = TORCH_INTENSITY;
  }

  reset(at: { x: number; z: number; yaw: number }) {
    const s = this.s;
    s.x = at.x;
    s.z = at.z;
    s.yaw = at.yaw;
    s.pitch = 0;
    s.vx = s.vz = 0;
    s.crouch = 0;
    s.eye = EYE_STAND;
    s.stamina = STAMINA_MAX;
    s.winded = false;
    s.nerve = 100;
    s.battery = BATTERY_MAX;
    s.breath = BREATH_MAX;
    s.holdingBreath = false;
    s.gaspCooldown = 0;
    s.torchOn = true;
    s.beaming = false;
    s.hidden = null;
    s.running = false;
    s.moving = false;
    s.noise = 0;
    s.bob = 0;
    s.indoor = isIndoor(s.x, s.z);
    s.room = charAt(s.x, s.z);
    this.tw.active = false;
    this.baseEye = EYE_STAND;
    this.side = this.roll = 0;
    this.bobAmp = 0;
    this.sinceRun = 10;
    this.pantTimer = 0;
    this.beamLocked = false;
    this.flick = 1;
    this.flickHold = 0;
    this.torchLevel = TORCH_INTENSITY;
    this.torch.color.copy(TORCH_WARM);
    this.torch.angle = TORCH_ANGLE;
    this.torch.intensity = TORCH_INTENSITY;
    this.snapPrev();
    this.applyCamera(1, 0);
  }

  /** dx > 0 turns right, dy > 0 looks down (screen-space mouse convention). */
  look(dx: number, dy: number) {
    const s = this.s;
    if (this.tw.active && this.tw.rot) return;
    s.yaw = wrapAngle(s.yaw - dx);
    s.pitch = clamp(s.pitch - dy, -PITCH_LIMIT, PITCH_LIMIT);
    if (s.hidden) {
      const d = clamp(wrapAngle(s.yaw - s.hidden.yaw), -LOCKER_YAW, LOCKER_YAW);
      s.yaw = wrapAngle(s.hidden.yaw + d);
      s.pitch = clamp(s.pitch, -LOCKER_PITCH, LOCKER_PITCH);
    }
  }

  toggleTorch() {
    this.s.torchOn = !this.s.torchOn;
    this.audio.click();
  }

  step(dt: number, inp: PlayerInput, opts: { canMove: boolean; drain: number; headBob: boolean }) {
    const s = this.s;
    this.lastDt = dt;
    this.time += dt;
    this.snapPrev();

    const ox = s.x,
      oz = s.z;
    let running = false;
    let crouching = false;

    if (this.tw.active) {
      this.stepTween(dt);
      s.vx = s.vz = 0;
    } else if (s.hidden) {
      s.vx = s.vz = 0;
    } else {
      // ------------------------------------------------------- movement
      let tvx = 0,
        tvz = 0;
      if (opts.canMove) {
        const mx = inp.moveX,
          my = inp.moveY;
        const mag = Math.min(1, Math.hypot(mx, my));
        crouching = inp.crouch;
        const forward = -my; // moveY is -1 for forwards
        const wantRun = inp.run && !crouching && mag > 0.3 && forward > 0.5 * mag;
        running = wantRun && !s.winded && s.stamina > 0;
        const speed = crouching ? SPEED_CROUCH : running ? SPEED_RUN : SPEED_WALK;
        const c = Math.cos(s.yaw),
          sn = Math.sin(s.yaw);
        tvx = (mx * c + my * sn) * speed;
        tvz = (-mx * sn + my * c) * speed;
      }
      const k = damp(ACCEL, dt);
      s.vx += (tvx - s.vx) * k;
      s.vz += (tvz - s.vz) * k;
      const p = this.p;
      p.x = s.x + s.vx * dt;
      p.z = s.z + s.vz * dt;
      collide(p, RADIUS);
      s.x = p.x;
      s.z = p.z;
      // Walls eat velocity, so sliding along them feels right and speed
      // does not pile up while pressing into a corner.
      if (dt > 0) {
        s.vx = (s.x - ox) / dt;
        s.vz = (s.z - oz) / dt;
      }
    }

    const dist = Math.hypot(s.x - ox, s.z - oz);
    const speed = dt > 0 ? dist / dt : 0;
    const moving = !s.hidden && !this.tw.active && speed > 0.35;
    s.moving = moving;
    s.running = running && moving && speed > SPEED_WALK * 1.05;

    // --------------------------------------------------------- stamina
    if (s.running) {
      s.stamina -= STAMINA_DRAIN * dt;
      this.sinceRun = 0;
      if (s.stamina <= 0) {
        s.stamina = 0;
        s.winded = true;
        this.audio.pant();
        this.pantTimer = 0.9;
      }
    } else {
      this.sinceRun += dt;
      if (this.sinceRun >= STAMINA_DELAY) s.stamina = Math.min(STAMINA_MAX, s.stamina + STAMINA_REGEN * dt);
    }
    if (s.winded) {
      if (s.stamina >= WINDED_UNTIL) s.winded = false;
      else if ((this.pantTimer -= dt) <= 0) {
        this.audio.pant();
        this.pantTimer = 0.85 + Math.random() * 0.25;
      }
    }

    // ---------------------------------------------------------- crouch
    const wantCrouch = !s.hidden && !this.tw.active && opts.canMove && inp.crouch;
    s.crouch += ((wantCrouch ? 1 : 0) - s.crouch) * damp(10, dt);
    if (!this.tw.active && !s.hidden) this.baseEye = lerp(EYE_STAND, EYE_CROUCH, s.crouch);

    // ------------------------------------------------- footsteps & bob
    const crouched = s.crouch > 0.5;
    s.noise = 0;
    if (moving) {
      const stride = s.running ? STRIDE_RUN : crouched ? STRIDE_CROUCH : STRIDE_WALK;
      const before = Math.floor(s.bob / Math.PI);
      s.bob += (dist / stride) * Math.PI;
      const r = s.running ? NOISE_RUN : crouched ? NOISE_CROUCH : NOISE_WALK;
      s.noise = r;
      if (Math.floor(s.bob / Math.PI) !== before) {
        this.audio.step(this.level.surfaceAt(s.x, s.z), s.running, crouched);
        this.onNoise(s.x, s.z, r);
      }
      if (s.bob > 2000 * Math.PI) s.bob -= 2000 * Math.PI;
    }
    const ampTarget = moving ? (s.running ? 1.55 : crouched ? 0.55 : 1) * Math.min(1, speed / SPEED_WALK + 0.2) : 0;
    this.bobAmp += (ampTarget - this.bobAmp) * damp(moving ? 6 : 4, dt);
    if (opts.headBob) {
      const a = this.bobAmp;
      // Lowest at each footfall (bob = k * PI), swaying side to side over two steps.
      const bobY = -Math.cos(2 * s.bob) * 0.018 * a;
      this.side = Math.sin(s.bob) * 0.022 * a;
      this.roll = Math.sin(s.bob) * 0.0055 * a;
      s.eye = this.baseEye + bobY;
    } else {
      this.side = 0;
      this.roll = 0;
      s.eye = this.baseEye;
    }

    // ----------------------------------------------------------- breath
    if (s.hidden && !this.tw.active) {
      const want = inp.breath && s.gaspCooldown <= 0 && s.breath > 0;
      if (want && !s.holdingBreath) this.audio.breathIn();
      else if (!want && s.holdingBreath) this.exhale();
      s.holdingBreath = want;
      if (s.holdingBreath) {
        s.breath -= BREATH_DRAIN * dt;
        if (s.breath <= 0) {
          s.breath = 0;
          s.holdingBreath = false;
          s.gaspCooldown = GASP_COOLDOWN;
          this.audio.gasp();
          this.onNoise(s.x, s.z, NOISE_GASP);
        }
      }
    } else {
      s.holdingBreath = false;
    }
    if (!s.holdingBreath) s.breath = Math.min(BREATH_MAX, s.breath + BREATH_RECOVER * dt);
    s.gaspCooldown = Math.max(0, s.gaspCooldown - dt);

    // ---------------------------------------------------- torch & beam
    const beamHeld = inp.beam && opts.canMove && !s.hidden && !this.tw.active;
    if (!beamHeld || s.battery >= 10) this.beamLocked = false;
    if (beamHeld && s.battery <= 0) this.beamLocked = true;
    s.beaming = beamHeld && !this.beamLocked && s.battery > 0;
    if (s.beaming) s.battery = Math.max(0, s.battery - BATTERY_DRAIN * opts.drain * dt);
    else if (s.battery < BATTERY_MAX) s.battery = Math.min(BATTERY_MAX, s.battery + BATTERY_RECHARGE * dt);
    this.updateTorch(dt);

    s.indoor = isIndoor(s.x, s.z);
    s.room = charAt(s.x, s.z);
  }

  applyCamera(alpha: number, shake: number) {
    const s = this.s;
    const a = clamp(alpha, 0, 1);
    const x = lerp(this.px, s.x, a),
      z = lerp(this.pz, s.z, a),
      y = lerp(this.pEye, s.eye, a);
    const side = lerp(this.pSide, this.side, a);
    const roll = lerp(this.pRoll, this.roll, a);
    let yaw = s.yaw,
      pitch = s.pitch;
    if (this.tw.active && this.tw.rot) {
      yaw = lerpAngle(this.pYaw, s.yaw, a);
      pitch = lerp(this.pPitch, s.pitch, a);
    }
    const rx = Math.cos(yaw),
      rz = -Math.sin(yaw);
    let jx = 0,
      jy = 0,
      jz = 0,
      jp = 0,
      jw = 0,
      jr = 0;
    if (shake > 0) {
      // Layered sines read as a violent handheld judder without per-frame noise speckle.
      const t = this.time + a * this.lastDt;
      const k = Math.min(shake, 2);
      jx = (Math.sin(t * 41.3) + Math.sin(t * 27.7 + 1.9) * 0.6 + (Math.random() - 0.5) * 0.5) * 0.03 * k;
      jy = (Math.sin(t * 37.1 + 0.7) + Math.sin(t * 19.3 + 2.4) * 0.6 + (Math.random() - 0.5) * 0.5) * 0.025 * k;
      jz = Math.sin(t * 33.9 + 4.1) * 0.015 * k;
      jp = (Math.sin(t * 29.3 + 1.1) + (Math.random() - 0.5) * 0.4) * 0.025 * k;
      jw = Math.sin(t * 23.7 + 3.3) * 0.025 * k;
      jr = Math.sin(t * 31.1 + 5.2) * 0.035 * k;
    }
    this.camera.position.set(x + rx * side + jx, y + jy, z + rz * side + jz);
    this.camera.rotation.set(pitch + jp, yaw + jw, roll + jr, "YXZ");
  }

  enterLocker(l: LockerSpot) {
    const s = this.s;
    if (s.hidden) return;
    s.hidden = l;
    s.vx = s.vz = 0;
    s.running = s.moving = false;
    s.holdingBreath = false;
    s.beaming = false;
    const tw = this.tw;
    tw.active = true;
    tw.t = 0;
    tw.dur = 0.45;
    tw.rot = true;
    tw.fx = s.x;
    tw.fz = s.z;
    tw.fyaw = s.yaw;
    tw.fpitch = s.pitch;
    tw.feye = this.baseEye;
    tw.tx = l.x + l.nx * LOCKER_INSET;
    tw.tz = l.z + l.nz * LOCKER_INSET;
    tw.tyaw = l.yaw;
    tw.tpitch = 0;
    tw.teye = LOCKER_EYE;
    this.audio.clank();
    this.onNoise(l.x, l.z, NOISE_CLANK);
  }

  exitLocker() {
    const s = this.s;
    const l = s.hidden;
    if (!l) return;
    s.hidden = null;
    if (s.holdingBreath) this.exhale();
    s.holdingBreath = false;
    const p = this.p;
    p.x = l.x + l.nx * LOCKER_EXIT;
    p.z = l.z + l.nz * LOCKER_EXIT;
    collide(p, RADIUS);
    const tw = this.tw;
    tw.active = true;
    tw.t = 0;
    tw.dur = 0.35;
    tw.rot = false;
    tw.fx = s.x;
    tw.fz = s.z;
    tw.fyaw = tw.tyaw = s.yaw;
    tw.fpitch = tw.tpitch = s.pitch;
    tw.feye = this.baseEye;
    tw.tx = p.x;
    tw.tz = p.z;
    tw.teye = EYE_STAND;
    s.crouch = 0;
    // Hinges and a soft scrape of sheet metal: louder than nothing, quieter than the slam in.
    this.audio.noise(0.3, { f: 1300, q: 7, gain: 0.08, attack: 0.05 });
    this.audio.noise(0.18, { type: "lowpass", f: 420, gain: 0.12, at: 0.05 });
  }

  // ------------------------------------------------------------- private

  private snapPrev() {
    const s = this.s;
    this.px = s.x;
    this.pz = s.z;
    this.pEye = s.eye;
    this.pSide = this.side;
    this.pRoll = this.roll;
    this.pYaw = s.yaw;
    this.pPitch = s.pitch;
  }

  private stepTween(dt: number) {
    const s = this.s,
      tw = this.tw;
    tw.t = Math.min(tw.dur, tw.t + dt);
    const e = smoothstep(0, 1, tw.t / tw.dur);
    s.x = lerp(tw.fx, tw.tx, e);
    s.z = lerp(tw.fz, tw.tz, e);
    this.baseEye = lerp(tw.feye, tw.teye, e);
    if (tw.rot) {
      s.yaw = wrapAngle(lerpAngle(tw.fyaw, tw.tyaw, e));
      s.pitch = lerp(tw.fpitch, tw.tpitch, e);
    }
    if (tw.t >= tw.dur) tw.active = false;
  }

  private exhale() {
    this.audio.noise(0.6, { type: "bandpass", f: 700, q: 0.7, gain: 0.04, attack: 0.08 });
  }

  private updateTorch(dt: number) {
    const s = this.s,
      torch = this.torch;
    let target = 0;
    let angle = TORCH_ANGLE;
    if (s.beaming) {
      this.targetColour.copy(TORCH_UV);
      angle = UV_ANGLE;
      // The beam sags as the cell runs flat.
      target = UV_INTENSITY * (0.55 + 0.45 * smoothstep(0, 20, s.battery));
    } else if (s.torchOn) {
      this.targetColour.copy(TORCH_WARM);
      target = TORCH_INTENSITY;
    } else {
      this.targetColour.copy(torch.color);
    }

    // Low battery: the bulb stutters, more often the flatter it gets.
    let flick = 1;
    const low = !s.beaming && s.torchOn && s.battery < LOW_BATTERY;
    if (low) {
      const k = 1 - s.battery / LOW_BATTERY;
      if (this.flickHold > 0) this.flickHold -= dt;
      else if (Math.random() < (0.03 + 0.18 * k) * dt * 60) {
        this.flick = 0.15 + Math.random() * 0.55;
        this.flickHold = 0.03 + Math.random() * 0.09;
      } else this.flick = 1;
      flick = (this.flickHold > 0 ? this.flick : 1) * (1 - 0.08 * k * Math.random());
    } else {
      this.flickHold = 0;
    }

    const r = damp(28, dt);
    this.torchLevel += (target - this.torchLevel) * r;
    if (this.torchLevel < 0.01) this.torchLevel = 0;
    torch.intensity = this.torchLevel * flick;
    torch.color.lerp(this.targetColour, damp(22, dt));
    torch.angle += (angle - torch.angle) * damp(20, dt);
  }
}
