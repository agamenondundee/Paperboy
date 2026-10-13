import { settings } from "./settings";
import { clamp } from "./util";

export type Action = "run" | "crouch" | "beam" | "breath" | "interact" | "torch" | "map" | "pause";

const KEYMAP: Record<string, Action> = {
  ShiftLeft: "run",
  ShiftRight: "run",
  ControlLeft: "crouch",
  KeyC: "crouch",
  Space: "beam",
  KeyE: "interact",
  KeyF: "torch",
  Tab: "map",
  KeyM: "map",
  Escape: "pause",
  KeyP: "pause",
};

// Gamepad buttons (standard mapping): held actions and edge-triggered presses.
const PAD_HELD: [number, Action][] = [
  [7, "beam"],
  [6, "breath"],
  [4, "run"],
  [10, "run"],
];
const PAD_EDGE: [number, Action][] = [
  [0, "interact"],
  [1, "crouch"],
  [2, "torch"],
  [3, "map"],
  [8, "map"],
  [9, "pause"],
];

/**
 * Unified input for keyboard and mouse, touch and gamepad.
 * Held actions are queried every simulation step; pressed actions are edge
 * triggered and cleared when read.
 */
export class Input {
  moveX = 0;
  moveY = 0;
  lookX = 0; // accumulated pixels since the last frame
  lookY = 0;
  locked = false;
  usingGamepad = false;
  touchActive = false;

  private keys = new Set<string>();
  private held = new Set<Action>();
  private touchHeld = new Set<Action>();
  private padHeld = new Set<Action>();
  private presses = new Set<Action>();
  private mouseBeam = false;
  private crouchToggle = false;
  private stick = { id: -1, x: 0, y: 0, cx: 0, cy: 0 };
  private lookTouch = { id: -1, x: 0, y: 0 };
  private padPrev: boolean[] = [];
  private lookOut: [number, number] = [0, 0];
  enabled = false;

  constructor(private canvas: HTMLCanvasElement) {
    addEventListener("keydown", (e) => {
      if (e.code === "Tab" || e.code === "Space") e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const a = KEYMAP[e.code];
      if (a) {
        this.presses.add(a);
        if (e.code === "KeyC") this.crouchToggle = !this.crouchToggle;
      }
      this.usingGamepad = false;
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => {
      this.keys.clear();
      this.mouseBeam = false;
    });
    canvas.addEventListener("mousedown", (e) => {
      if (!this.enabled) return;
      if (e.button === 0) this.mouseBeam = true;
      if (e.button === 2) this.presses.add("interact");
    });
    addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseBeam = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    addEventListener("mousemove", (e) => {
      if (!this.enabled || !this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.mouseBeam = false;
    });
    this.setupTouch();
  }

  requestLock() {
    if (this.touchActive || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      /* ignore */
    }
  }
  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Called once per rendered frame before the simulation runs. */
  poll() {
    let mx = 0,
      my = 0;
    const k = this.keys;
    if (k.has("KeyW") || k.has("ArrowUp")) my -= 1;
    if (k.has("KeyS") || k.has("ArrowDown")) my += 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) mx -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) mx += 1;

    this.held.clear();
    for (const code of k) {
      const a = KEYMAP[code];
      if (a && a !== "crouch") this.held.add(a);
    }
    if (k.has("ControlLeft") || this.crouchToggle) this.held.add("crouch");
    if (this.mouseBeam) this.held.add("beam");
    if (this.held.has("beam")) this.held.add("breath");

    if (this.stick.id >= 0) {
      mx += this.stick.x;
      my += this.stick.y;
    }
    this.pollGamepad();
    if (this.padMove) {
      mx += this.padMove[0];
      my += this.padMove[1];
    }
    const m = Math.hypot(mx, my);
    if (m > 1) {
      mx /= m;
      my /= m;
    }
    this.moveX = mx;
    this.moveY = my;
  }

  isHeld(a: Action) {
    return this.held.has(a) || this.touchHeld.has(a) || this.padHeld.has(a);
  }
  /** Edge-triggered press. Reading it clears it. */
  wasPressed(a: Action) {
    const p = this.presses.has(a);
    this.presses.delete(a);
    return p;
  }
  clearPresses() {
    this.presses.clear();
  }
  setCrouch(on: boolean) {
    this.crouchToggle = on;
  }

  /** Look delta in radians since the last call. The tuple is reused: read it straight away. */
  consumeLook(): [number, number] {
    const s = settings.sensitivity * 0.0022;
    const out = this.lookOut;
    out[0] = this.lookX * s;
    out[1] = this.lookY * s * (settings.invertY ? -1 : 1);
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  // ---------------------------------------------------------------- gamepad
  private padMove: [number, number] | null = null;
  private padMoveBuf: [number, number] = [0, 0];
  private pollGamepad() {
    this.padMove = null;
    this.padHeld.clear();
    const pads = navigator.getGamepads ? navigator.getGamepads() : null;
    let gp: Gamepad | null = null;
    if (pads) for (let i = 0; i < pads.length && !gp; i++) if (pads[i] && pads[i]!.connected) gp = pads[i];
    if (!gp) return;
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    const lx = dz(gp.axes[0] || 0),
      ly = dz(gp.axes[1] || 0),
      rx = dz(gp.axes[2] || 0),
      ry = dz(gp.axes[3] || 0);
    const btn = (i: number) => !!gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4);
    const any = lx || ly || rx || ry || gp.buttons.some((b) => b.pressed);
    if (any) this.usingGamepad = true;
    if (!this.usingGamepad) return;
    this.padMoveBuf[0] = lx;
    this.padMoveBuf[1] = ly;
    this.padMove = this.padMoveBuf;
    // Look speed in "pixels" so it shares the mouse sensitivity setting.
    const curve = (v: number) => Math.sign(v) * v * v;
    this.lookX += curve(rx) * 16;
    this.lookY += curve(ry) * 12;
    for (const [i, a] of PAD_HELD) if (btn(i)) this.padHeld.add(a);
    if (btn(7)) this.padHeld.add("breath");
    for (const [i, a] of PAD_EDGE) {
      const now = btn(i);
      if (now && !this.padPrev[i]) {
        this.presses.add(a);
        if (a === "crouch") this.crouchToggle = !this.crouchToggle;
      }
      this.padPrev[i] = now;
    }
  }

  // ------------------------------------------------------------------ touch
  private setupTouch() {
    const stickEl = document.getElementById("stick");
    const nub = document.getElementById("nub");
    if (!stickEl || !nub) return;
    const move = (e: PointerEvent) => {
      let dx = e.clientX - this.stick.cx,
        dy = e.clientY - this.stick.cy;
      const m = Math.hypot(dx, dy),
        max = 52;
      if (m > max) {
        dx *= max / m;
        dy *= max / m;
      }
      this.stick.x = dx / max;
      this.stick.y = dy / max;
      nub.style.transform = `translate(${dx}px,${dy}px)`;
    };
    stickEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const r = stickEl.getBoundingClientRect();
      this.stick.id = e.pointerId;
      this.stick.cx = r.left + r.width / 2;
      this.stick.cy = r.top + r.height / 2;
      stickEl.setPointerCapture(e.pointerId);
      move(e);
    });
    stickEl.addEventListener("pointermove", (e) => e.pointerId === this.stick.id && move(e));
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.id = -1;
      this.stick.x = this.stick.y = 0;
      nub.style.transform = "";
    };
    stickEl.addEventListener("pointerup", end);
    stickEl.addEventListener("pointercancel", end);

    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      this.touchActive = true;
      this.lookTouch = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.lookTouch.id || !this.enabled) return;
      this.lookX += (e.clientX - this.lookTouch.x) * 1.6;
      this.lookY += (e.clientY - this.lookTouch.y) * 1.6;
      this.lookTouch.x = e.clientX;
      this.lookTouch.y = e.clientY;
    });
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === this.lookTouch.id) this.lookTouch.id = -1;
    };
    this.canvas.addEventListener("pointerup", endLook);
    this.canvas.addEventListener("pointercancel", endLook);

    const hold = (id: string, actions: Action[]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.touchActive = true;
        actions.forEach((a) => this.touchHeld.add(a));
        el.classList.add("on");
      });
      const up = () => {
        actions.forEach((a) => this.touchHeld.delete(a));
        el.classList.remove("on");
      };
      ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => el.addEventListener(ev, up));
    };
    const tap = (id: string, a: Action) => {
      const el = document.getElementById(id);
      el?.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.touchActive = true;
        this.presses.add(a);
        if (a === "crouch") {
          this.crouchToggle = !this.crouchToggle;
          el.classList.toggle("on", this.crouchToggle);
        }
      });
    };
    hold("tBeam", ["beam", "breath"]);
    hold("tRun", ["run"]);
    tap("tAct", "interact");
    tap("tCrouch", "crouch");
    tap("tTorch", "torch");
    tap("tMap", "map");
    tap("tPause", "pause");
  }
}

export const stickMagnitude = (x: number, y: number) => clamp(Math.hypot(x, y), 0, 1);
