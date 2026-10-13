import "../style.css";
import type { GhostKind, HudApi } from "../types";
import { settings } from "../core/settings";
import { $, clamp, formatTime, isTouchDevice, mulberry32 } from "../core/util";

type SpiritState = "loose" | "anchored" | "vulnerable" | "at rest";
type Dir = "left" | "right" | "ahead" | "behind";

const STATE_LABEL: Record<SpiritState, string> = {
  loose: "Loose",
  anchored: "Anchored",
  vulnerable: "Vulnerable",
  "at rest": "At rest",
};
const STATE_CLASS: Record<SpiritState, string> = {
  loose: "st-loose",
  anchored: "st-anchored",
  vulnerable: "st-vulnerable",
  "at rest": "st-rest",
};

const RING_C = 2 * Math.PI * 17;
const ARROW_ROT: Record<Dir, number> = { ahead: 0, right: 90, behind: 180, left: -90 };
const ARROW_SVG = '<path d="M12 3 21 14h-6v7H9v-7H3z"/>';
const SVG_NS = "http://www.w3.org/2000/svg";

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Msg {
  el: HTMLElement;
  key: string;
  timer: number;
  count: number;
  countEl: HTMLElement | null;
}

/**
 * Heads-up display. Every setter caches what is on screen and touches the DOM
 * only when the visible value changes, so calling them every frame is cheap.
 */
export class Hud implements HudApi {
  private root = $("hud");

  // bars
  private barNerve = $("barNerve");
  private barBattery = $("barBattery");
  private barStamina = $("barStamina");
  private nerveFill = this.barNerve.querySelector<HTMLElement>(".fill")!;
  private nerveGhost = this.barNerve.querySelector<HTMLElement>(".ghost-fill")!;
  private batteryFill = this.barBattery.querySelector<HTMLElement>(".fill")!;
  private staminaFill = this.barStamina.querySelector<HTMLElement>(".fill")!;
  private breathBox = $("breath");
  private breathLabel = $("breathLabel");
  private breathFill = this.breathBox.querySelector<HTMLElement>(".fill")!;
  private lNerve = -1;
  private lBattery = -1;
  private lStamina = -1;
  private lBreath = -2;
  private lStaminaOn = true;
  private lNerveLow = false;
  private lBatteryLow = false;
  private lStaminaLow = false;
  private lBreathDanger = false;
  private lBreathLabel = "";

  // objective, timer, tally
  private objectiveBox = $("objectiveBox");
  private objectiveEl = $("objective");
  private lObjective: string | null = null;
  private timerEl = $("timer");
  private lTimer = "";
  private tally = $("tally");
  private spiritsUl = $("spirits");
  private relicsUl = $("relics");
  private spiritRows: { li: HTMLElement; chip: HTMLElement; name: string; state: SpiritState | "" }[] = [];
  private relicRows: { li: HTMLElement; name: string; found: boolean }[] = [];

  // centre
  private crosshair = $("crosshair");
  private ring = $("ring");
  private lRing = -1;
  private promptEl = $("prompt");
  private lPrompt: string | null = null;

  // messages
  private toastsEl = $("toasts");
  private captionsEl = $("captions");
  private toasts: Msg[] = [];
  private captions: Msg[] = [];
  private paEl = $("pa");
  private paText = $("paText");
  private paTimer = 0;

  // fx
  private flashes: Record<"red" | "white" | "uv", { el: HTMLElement; anim: Animation | null; t: number; s: number; base: number; dur: number }>;
  private scare = $("scare");
  private scareCanvas = $<HTMLCanvasElement>("scareCanvas");
  private scareAnims: Animation[] = [];
  private scareTimer = 0;
  private faceCache = new Map<GhostKind, HTMLCanvasElement>();
  private imgCache = new WeakMap<HTMLImageElement, HTMLCanvasElement>();
  private vents = $("vents");
  private lVents = false;
  private fpsEl = $("fps");
  private lFps = -1;
  private lScale = -1;

  constructor() {
    const fl = (id: string, base: number) => ({ el: $(id), anim: null as Animation | null, t: -1e9, s: 0, base, dur: base });
    this.flashes = { red: fl("flashRed", 750), white: fl("flashWhite", 480), uv: fl("flashUv", 650) };

    // Touch controls show on touch devices, and appear on a hybrid as soon as it is touched.
    if (isTouchDevice()) document.body.classList.add("touch");
    addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType === "touch") document.body.classList.add("touch");
        else if (e.pointerType === "mouse" && !matchMedia("(pointer: coarse)").matches) document.body.classList.remove("touch");
      },
      { capture: true, passive: true }
    );
    this.objectiveBox.classList.add("empty");
    this.tally.hidden = true;
  }

  show(v: boolean) {
    this.root.classList.toggle("hidden", !v);
  }

  // ------------------------------------------------------------------ bars
  setBars(b: { nerve: number; battery: number; stamina: number; breath: number | null; breathDanger: boolean; breathLabel: string }) {
    const n = Math.round(clamp(b.nerve, 0, 100) * 2) / 2;
    if (n !== this.lNerve) {
      const tf = `scaleX(${n / 100})`;
      this.nerveFill.style.transform = tf;
      this.nerveGhost.style.transform = tf;
      this.lNerve = n;
      const low = n < 30;
      if (low !== this.lNerveLow) this.barNerve.classList.toggle("low", (this.lNerveLow = low));
    }
    const bat = Math.round(clamp(b.battery, 0, 100) * 2) / 2;
    if (bat !== this.lBattery) {
      this.batteryFill.style.transform = `scaleX(${bat / 100})`;
      this.lBattery = bat;
      const low = bat < 15;
      if (low !== this.lBatteryLow) this.barBattery.classList.toggle("low", (this.lBatteryLow = low));
    }
    const st = Math.round(clamp(b.stamina, 0, 100) * 2) / 2;
    if (st !== this.lStamina) {
      this.staminaFill.style.transform = `scaleX(${st / 100})`;
      this.lStamina = st;
      const on = st < 99.5;
      if (on !== this.lStaminaOn) this.barStamina.classList.toggle("off", !(this.lStaminaOn = on));
      const low = st < 30;
      if (low !== this.lStaminaLow) this.barStamina.classList.toggle("low", (this.lStaminaLow = low));
    }

    const br = b.breath === null ? -1 : Math.round(clamp(b.breath, 0, 100) * 2) / 2;
    if (br !== this.lBreath) {
      if (br < 0) this.breathBox.classList.remove("on");
      else {
        if (this.lBreath < 0) this.breathBox.classList.add("on");
        this.breathFill.style.transform = `scaleX(${br / 100})`;
      }
      this.lBreath = br;
    }
    if (b.breathDanger !== this.lBreathDanger) this.breathBox.classList.toggle("danger", (this.lBreathDanger = b.breathDanger));
    if (b.breathLabel !== this.lBreathLabel) this.breathLabel.textContent = this.lBreathLabel = b.breathLabel;
  }

  // ------------------------------------------------------- objective, tally
  setObjective(text: string) {
    if (text === this.lObjective) return;
    this.lObjective = text;
    this.objectiveEl.textContent = text;
    this.objectiveBox.classList.toggle("empty", !text);
    if (text && !reducedMotion()) {
      this.objectiveBox.animate(
        [
          { boxShadow: "0 0 0 1px rgba(255,74,61,0.7), 0 0 30px rgba(255,74,61,0.35)", filter: "brightness(1.5)" },
          { boxShadow: "0 0 0 1px rgba(255,74,61,0), 0 0 0 rgba(255,74,61,0)", filter: "brightness(1)" },
        ],
        { duration: 1400, easing: "ease-out" }
      );
    }
  }

  setSpirits(list: { name: string; state: SpiritState }[]) {
    let same = list.length === this.spiritRows.length;
    for (let i = 0; same && i < list.length; i++) if (list[i].name !== this.spiritRows[i].name) same = false;
    if (!same) {
      this.spiritsUl.textContent = "";
      this.spiritRows = list.map((s) => {
        const li = document.createElement("li");
        const nm = document.createElement("span");
        nm.className = "nm";
        nm.textContent = s.name;
        const chip = document.createElement("span");
        chip.className = "st";
        li.append(nm, chip);
        this.spiritsUl.appendChild(li);
        return { li, chip, name: s.name, state: "" as SpiritState | "" };
      });
    }
    for (let i = 0; i < list.length; i++) {
      const row = this.spiritRows[i],
        st = list[i].state;
      if (row.state === st) continue;
      const prev = row.state;
      row.state = st;
      row.chip.className = "st " + STATE_CLASS[st];
      row.chip.textContent = STATE_LABEL[st];
      row.li.classList.toggle("rest", st === "at rest");
      if (prev && (st === "at rest" || st === "vulnerable")) this.pulseRow(row.li);
    }
    this.updateTallyVisibility();
  }

  setRelics(list: { name: string; found: boolean }[]) {
    let same = list.length === this.relicRows.length;
    for (let i = 0; same && i < list.length; i++) if (list[i].name !== this.relicRows[i].name) same = false;
    if (!same) {
      this.relicsUl.textContent = "";
      this.relicRows = list.map((r) => {
        const li = document.createElement("li");
        const nm = document.createElement("span");
        nm.className = "nm";
        nm.textContent = r.name;
        const chk = document.createElement("span");
        chk.className = "chk";
        li.append(nm, chk);
        li.classList.add(r.found ? "found" : "unknown");
        this.relicsUl.appendChild(li);
        return { li, name: r.name, found: r.found };
      });
    }
    for (let i = 0; i < list.length; i++) {
      const row = this.relicRows[i],
        f = list[i].found;
      if (row.found === f) continue;
      row.found = f;
      row.li.classList.toggle("found", f);
      row.li.classList.toggle("unknown", !f);
      if (f) this.pulseRow(row.li);
    }
    this.updateTallyVisibility();
  }

  private pulseRow(li: HTMLElement) {
    li.classList.remove("flash-in");
    void li.offsetWidth;
    li.classList.add("flash-in");
  }

  private updateTallyVisibility() {
    const empty = this.spiritRows.length === 0 && this.relicRows.length === 0;
    if (this.tally.hidden !== empty) this.tally.hidden = empty;
    // A heading with nothing under it reads oddly, so hide each half on its own.
    const sh = this.spiritsUl.previousElementSibling as HTMLElement,
      rh = this.relicsUl.previousElementSibling as HTMLElement;
    const sEmpty = this.spiritRows.length === 0,
      rEmpty = this.relicRows.length === 0;
    if (sh.hidden !== sEmpty) sh.hidden = this.spiritsUl.hidden = sEmpty;
    if (rh.hidden !== rEmpty) rh.hidden = this.relicsUl.hidden = rEmpty;
  }

  setTimer(seconds: number | null) {
    let s = "";
    if (seconds !== null) {
      const v = Math.max(0, seconds);
      s = v < 10 ? v.toFixed(1) : formatTime(Math.ceil(v));
    }
    if (s === this.lTimer) return;
    const wasUrgent = this.lTimer !== "" && this.lTimer.indexOf(":") < 0;
    this.lTimer = s;
    if (!s) {
      this.timerEl.hidden = true;
      this.timerEl.classList.remove("urgent");
      return;
    }
    this.timerEl.hidden = false;
    this.timerEl.textContent = s;
    const urgent = s.indexOf(":") < 0;
    if (urgent !== wasUrgent) this.timerEl.classList.toggle("urgent", urgent);
  }

  // -------------------------------------------------------------- messages
  toast(text: string, ms = 2800) {
    // Repeated toasts refresh the one already showing instead of stacking.
    const dup = this.toasts.find((t) => t.key === text && !t.el.classList.contains("out"));
    if (dup) {
      clearTimeout(dup.timer);
      dup.timer = window.setTimeout(() => this.dismiss(this.toasts, dup), ms);
      return;
    }
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    this.toastsEl.appendChild(el);
    const m: Msg = { el, key: text, timer: 0, count: 1, countEl: null };
    m.timer = window.setTimeout(() => this.dismiss(this.toasts, m), ms);
    this.toasts.push(m);
    const max = innerHeight < 520 || innerWidth < 640 ? 2 : 3;
    while (this.toasts.length > max) this.dismiss(this.toasts, this.toasts[0], true);
  }

  caption(text: string, dir?: Dir) {
    if (!settings.captions) return;
    const key = dir ? text + "|" + dir : text;
    const live = this.captions.find((c) => c.key === key && !c.el.classList.contains("out"));
    if (live) {
      clearTimeout(live.timer);
      live.count++;
      if (!live.countEl) {
        live.countEl = document.createElement("span");
        live.countEl.className = "cnt";
        live.el.appendChild(live.countEl);
      }
      live.countEl.textContent = "x" + live.count;
      live.timer = window.setTimeout(() => this.dismiss(this.captions, live), 3200);
      return;
    }
    const el = document.createElement("div");
    el.className = "caption";
    const span = document.createElement("span");
    span.textContent = text;
    if (dir) {
      const arrow = document.createElementNS(SVG_NS, "svg");
      arrow.setAttribute("viewBox", "0 0 24 24");
      arrow.setAttribute("class", "arr");
      arrow.setAttribute("aria-hidden", "true");
      arrow.innerHTML = ARROW_SVG;
      arrow.style.transform = `rotate(${ARROW_ROT[dir]}deg)`;
      if (dir === "right") el.append(span, arrow);
      else el.append(arrow, span);
      el.setAttribute("aria-label", `${text}, ${dir}`);
    } else el.append(span);
    this.captionsEl.appendChild(el);
    const m: Msg = { el, key, timer: 0, count: 1, countEl: null };
    m.timer = window.setTimeout(() => this.dismiss(this.captions, m), 3200);
    this.captions.push(m);
    const max = innerHeight < 520 || innerWidth < 640 ? 2 : 4;
    while (this.captions.length > max) this.dismiss(this.captions, this.captions[0], true);
  }

  private dismiss(list: Msg[], m: Msg, fast = false) {
    const i = list.indexOf(m);
    if (i < 0) return;
    list.splice(i, 1);
    clearTimeout(m.timer);
    if (fast) {
      m.el.remove();
      return;
    }
    m.el.classList.add("out");
    setTimeout(() => m.el.remove(), 520);
  }

  pa(text: string) {
    clearTimeout(this.paTimer);
    this.paText.textContent = text;
    this.paEl.classList.add("on");
    const ms = clamp(2600 + text.length * 60, 3200, 9000);
    this.paTimer = window.setTimeout(() => this.paEl.classList.remove("on"), ms);
  }

  prompt(text: string | null) {
    if (text === this.lPrompt) return;
    this.lPrompt = text;
    if (!text) {
      this.promptEl.classList.remove("on");
      return;
    }
    // "[E] Hide in the locker" renders the bracketed key as a key cap.
    this.promptEl.textContent = "";
    const re = /\[([^\]]{1,14})\]/g;
    let last = 0,
      m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last) this.promptEl.append(text.slice(last, m.index));
      const k = document.createElement("kbd");
      k.textContent = m[1];
      this.promptEl.append(k);
      last = m.index + m[0].length;
    }
    if (last < text.length) this.promptEl.append(last ? text.slice(last).trimStart() : text);
    this.promptEl.classList.add("on");
  }

  setTargetRing(frac: number | null) {
    const q = frac === null ? -1 : Math.round(clamp(frac, 0, 1) * 200) / 200;
    if (q === this.lRing) return;
    if (q < 0) this.crosshair.classList.remove("ring");
    else {
      if (this.lRing < 0) this.crosshair.classList.add("ring");
      this.ring.style.strokeDashoffset = String(RING_C * (1 - q));
    }
    this.lRing = q;
  }

  setFps(fps: number | null, scale: number) {
    if (fps === null) {
      if (this.lFps !== -1) {
        this.fpsEl.hidden = true;
        this.lFps = -1;
      }
      return;
    }
    const f = Math.round(fps),
      sc = Math.round(scale * 100);
    if (f === this.lFps && sc === this.lScale) return;
    if (this.lFps === -1) this.fpsEl.hidden = false;
    this.lFps = f;
    this.lScale = sc;
    this.fpsEl.textContent = sc < 100 ? `${f} fps, ${sc}% res` : `${f} fps`;
    this.fpsEl.className = f < 30 ? "mono bad" : f < 50 ? "mono warn" : "mono";
  }

  // -------------------------------------------------------------------- fx
  flash(colour: "red" | "white" | "uv", strength: number) {
    const f = this.flashes[colour];
    if (!f) return;
    const gentle = settings.gentle;
    const s = clamp(strength, 0, 1) * (gentle ? (colour === "white" ? 0.15 : 0.3) : colour === "white" ? 0.85 : 1);
    if (s < 0.01) return;
    const now = performance.now(),
      el = now - f.t;
    // Skip if the flash already showing is brighter, and throttle repeated calls.
    const current = el < f.dur ? f.s * (1 - el / f.dur) : 0;
    if (current >= s || (el < 80 && s <= f.s * 1.05)) return;
    f.anim?.cancel();
    f.t = now;
    f.s = s;
    f.dur = gentle ? f.base * 1.3 : f.base;
    f.el.style.visibility = "visible";
    const anim = f.el.animate([{ opacity: s }, { opacity: 0 }], { duration: f.dur, easing: "cubic-bezier(0.2, 0.6, 0.35, 1)" });
    anim.onfinish = () => {
      if (f.anim === anim) f.el.style.visibility = "hidden";
    };
    f.anim = anim;
  }

  scareFlash(img: HTMLImageElement | null, kind: GhostKind, gentle: boolean) {
    const g = this.scareCanvas.getContext("2d");
    if (!g) return;
    const src = img && img.complete && img.naturalWidth > 0 ? this.gradedImage(img) : this.face(kind);
    const w = this.scareCanvas.width,
      h = this.scareCanvas.height;
    g.clearRect(0, 0, w, h);
    g.drawImage(src, 0, 0, w, h);

    for (const a of this.scareAnims) a.cancel();
    clearTimeout(this.scareTimer);
    this.scare.classList.add("on");
    const calm = gentle || settings.gentle;
    const amp = reducedMotion() ? 0.3 : 1;
    let dur: number;
    if (calm) {
      dur = 520;
      this.scareAnims = [
        this.scare.animate([{ opacity: 0 }, { opacity: 0.32, offset: 0.3 }, { opacity: 0 }], { duration: dur, easing: "ease-in-out" }),
        this.scareCanvas.animate([{ transform: "scale(1.05)", filter: "blur(2px)" }, { transform: "scale(1)", filter: "blur(2px)" }], { duration: dur }),
      ];
    } else {
      dur = 620;
      const r = Math.random;
      const j = (k: number) => ((r() - 0.5) * 2 * k * amp).toFixed(2);
      const frames: Keyframe[] = [];
      const steps = 9;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps,
          k = Math.pow(1 - t, 1.6);
        const sc = 1 + 0.5 * k * amp + (i === 0 ? 0.2 * amp : 0);
        frames.push({
          offset: t,
          transform: i === steps ? "translate(0,0) scale(1) rotate(0deg)" : `translate(${j(6 * k)}%, ${j(5 * k)}%) scale(${sc.toFixed(3)}) rotate(${j(4 * k)}deg)`,
        });
      }
      this.scareAnims = [
        this.scare.animate(
          [
            { opacity: 0, offset: 0 },
            { opacity: 1, offset: 0.03 },
            { opacity: 0.75, offset: 0.12 },
            { opacity: 1, offset: 0.16 },
            { opacity: 1, offset: 0.58 },
            { opacity: 0.55, offset: 0.66 },
            { opacity: 0.85, offset: 0.7 },
            { opacity: 0, offset: 1 },
          ],
          { duration: dur, easing: "linear" }
        ),
        this.scareCanvas.animate(frames, { duration: dur, easing: "linear" }),
      ];
    }
    this.scareTimer = window.setTimeout(() => this.scare.classList.remove("on"), dur + 30);
  }

  setLockerVents(on: boolean) {
    if (on === this.lVents) return;
    this.lVents = on;
    this.vents.classList.toggle("on", on);
  }

  // ----------------------------------------------------------- scare faces
  /** Higgsfield art cropped to cover, pushed darker and redder. Cached per image. */
  private gradedImage(img: HTMLImageElement) {
    const hit = this.imgCache.get(img);
    if (hit) return hit;
    const S = 768;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d")!;
    const iw = img.naturalWidth,
      ih = img.naturalHeight,
      k = Math.max(S / iw, S / ih);
    const dw = iw * k,
      dh = ih * k;
    g.fillStyle = "#000";
    g.fillRect(0, 0, S, S);
    g.drawImage(img, (S - dw) / 2, (S - dh) / 2, dw, dh);
    g.globalCompositeOperation = "multiply";
    g.fillStyle = "rgb(255, 214, 205)";
    g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = "source-over";
    vignette(g, S, 0.8);
    grain(g, S, mulberry32(7), 0.12);
    this.imgCache.set(img, cv);
    return cv;
  }

  private face(kind: GhostKind) {
    let cv = this.faceCache.get(kind);
    if (!cv) {
      cv = document.createElement("canvas");
      cv.width = cv.height = 768;
      paintFace(cv.getContext("2d")!, 768, kind);
      this.faceCache.set(kind, cv);
    }
    return cv;
  }
}

// ======================================================================
// Procedural jump-scare faces, painted once per kind and cached.

function vignette(g: CanvasRenderingContext2D, S: number, k: number) {
  const v = g.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, `rgba(0,0,0,${k})`);
  g.fillStyle = v;
  g.fillRect(0, 0, S, S);
}

function grain(g: CanvasRenderingContext2D, S: number, r: () => number, a: number) {
  for (let i = 0; i < 9000; i++) {
    const v = r() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${r() * a})`;
    const s = 1 + r() * 2;
    g.fillRect(r() * S, r() * S, s, s);
  }
}

interface FaceStyle {
  bg: string;
  skin: [string, string, string];
  eye: string;
  glow: string;
  seed: number;
}

const FACE: Record<GhostKind, FaceStyle> = {
  queen: { bg: "#140a1c", skin: ["#efe7f0", "#a59ab5", "#2a2033"], eye: "#e9d7ff", glow: "#b48cff", seed: 11 },
  janitor: { bg: "#0d1209", skin: ["#d9d8c2", "#8b8a6e", "#22231a"], eye: "#fff2b0", glow: "#d8ff5a", seed: 23 },
  principal: { bg: "#1a0807", skin: ["#ebe0d4", "#9c8478", "#2c1b16"], eye: "#ffd2c8", glow: "#ff3b2f", seed: 37 },
  hollow: { bg: "#030304", skin: ["#9a9aa0", "#3c3c44", "#050507"], eye: "#ffffff", glow: "#ff2a1a", seed: 53 },
};

function paintFace(g: CanvasRenderingContext2D, S: number, kind: GhostKind) {
  const st = FACE[kind];
  const r = mulberry32(st.seed);
  const cx = S / 2,
    cy = S * 0.53;
  const rx = S * 0.3,
    ry = S * 0.42;

  // backdrop
  const bg = g.createRadialGradient(cx, cy, S * 0.1, cx, cy, S * 0.75);
  bg.addColorStop(0, st.bg);
  bg.addColorStop(1, "#000");
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);

  // long hair behind the head (queen) or a dark hood of shadow (hollow)
  if (kind === "queen") {
    g.strokeStyle = "rgba(8,5,10,0.9)";
    for (let i = 0; i < 140; i++) {
      const x0 = cx + (r() - 0.5) * rx * 1.6;
      g.lineWidth = 2 + r() * 6;
      g.beginPath();
      g.moveTo(x0, cy - ry * 0.95);
      g.bezierCurveTo(x0 + (r() - 0.5) * 220, cy, x0 + (r() - 0.5) * 260, cy + ry * 0.6, x0 + (r() - 0.5) * 300, S + 20);
      g.stroke();
    }
  }

  // skull-like head with a wobbly outline
  g.save();
  const N = 28;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const sn = Math.sin(a);
    const jaw = sn > 0 ? 1 + 0.22 * sn * sn * sn : 1;
    const wob = 1 + (r() - 0.5) * 0.035;
    pts.push([cx + Math.cos(a) * rx * wob * (sn > 0 ? 1 - 0.2 * sn : 1), cy + sn * ry * wob * jaw]);
  }
  // Smooth closed curve through the midpoints.
  g.beginPath();
  const mid = (i: number) => {
    const p = pts[i % N],
      q = pts[(i + 1) % N];
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  };
  const m0 = mid(0);
  g.moveTo(m0[0], m0[1]);
  for (let i = 1; i <= N; i++) {
    const p = pts[i % N],
      m = mid(i);
    g.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  g.closePath();
  const sk = g.createRadialGradient(cx - rx * 0.15, cy - ry * 0.25, rx * 0.1, cx, cy, ry * 1.1);
  sk.addColorStop(0, st.skin[0]);
  sk.addColorStop(0.55, st.skin[1]);
  sk.addColorStop(1, st.skin[2]);
  g.fillStyle = sk;
  g.fill();
  g.clip();

  // hollow cheeks and temples
  for (const sx of [-1, 1]) {
    const c = g.createRadialGradient(cx + sx * rx * 0.62, cy + ry * 0.2, 0, cx + sx * rx * 0.62, cy + ry * 0.2, rx * 0.55);
    c.addColorStop(0, "rgba(0,0,0,0.6)");
    c.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = c;
    g.fillRect(0, 0, S, S);
  }

  // veins and cracks
  g.strokeStyle = kind === "queen" ? "rgba(70,40,110,0.55)" : "rgba(40,10,10,0.55)";
  for (let i = 0; i < 26; i++) {
    let x = cx + (r() - 0.5) * rx * 1.6,
      y = cy + (r() - 0.5) * ry * 1.6;
    g.lineWidth = 0.8 + r() * 1.8;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (r() - 0.5) * 50;
      y += (r() - 0.5) * 50;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // harsh light from above: dark brow line and chin shadow
  const sh = g.createLinearGradient(0, cy - ry, 0, cy + ry * 1.2);
  sh.addColorStop(0, "rgba(0,0,0,0.55)");
  sh.addColorStop(0.3, "rgba(0,0,0,0)");
  sh.addColorStop(0.75, "rgba(0,0,0,0.05)");
  sh.addColorStop(1, "rgba(0,0,0,0.75)");
  g.fillStyle = sh;
  g.fillRect(0, 0, S, S);
  g.restore();

  // eye sockets
  const eyeY = cy - ry * 0.12,
    eyeDX = rx * 0.42;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * eyeDX;
    const so = g.createRadialGradient(ex, eyeY, 4, ex, eyeY, rx * 0.42);
    so.addColorStop(0, "#000");
    so.addColorStop(0.55, "rgba(0,0,0,0.95)");
    so.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = so;
    g.beginPath();
    g.ellipse(ex, eyeY, rx * 0.36, rx * 0.3 + (kind === "hollow" ? 30 : 0), sx * 0.15, 0, Math.PI * 2);
    g.fill();
    // tear streaks
    g.strokeStyle = kind === "queen" ? "rgba(10,5,15,0.85)" : "rgba(30,0,0,0.6)";
    for (let t = 0; t < 3; t++) {
      g.lineWidth = 2 + r() * 4;
      g.beginPath();
      const tx = ex + (r() - 0.5) * 40;
      g.moveTo(tx, eyeY + 30);
      g.bezierCurveTo(tx + (r() - 0.5) * 20, eyeY + 120, tx + (r() - 0.5) * 30, eyeY + 180, tx + (r() - 0.5) * 30, eyeY + 160 + r() * 140);
      g.stroke();
    }
    // pinpoint pupils
    g.save();
    g.shadowColor = st.glow;
    g.shadowBlur = 40;
    g.fillStyle = st.eye;
    g.beginPath();
    g.arc(ex + sx * 4, eyeY + 6, kind === "hollow" ? 9 : 6.5, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 80;
    g.globalAlpha = 0.6;
    g.fill();
    g.restore();
  }

  // gaping mouth
  const my = cy + ry * 0.48;
  g.save();
  g.beginPath();
  g.ellipse(cx, my, rx * 0.3, ry * (kind === "hollow" ? 0.34 : 0.26), 0, 0, Math.PI * 2);
  const mo = g.createRadialGradient(cx, my, 2, cx, my, rx * 0.4);
  mo.addColorStop(0, "#000");
  mo.addColorStop(0.7, "#050000");
  mo.addColorStop(1, "rgba(40,0,0,0.9)");
  g.fillStyle = mo;
  g.fill();
  g.clip();
  if (kind !== "hollow") {
    g.fillStyle = "rgba(210,200,170,0.85)";
    const top = my - ry * 0.26;
    for (let i = -5; i <= 5; i++) {
      const w = 10 + r() * 6;
      g.fillRect(cx + i * 15 - w / 2, top - 4, w, 20 + r() * 26);
    }
  }
  g.restore();
  if (kind === "queen") {
    // smeared lipstick
    g.strokeStyle = "rgba(170,10,40,0.7)";
    g.lineWidth = 9;
    g.beginPath();
    g.ellipse(cx, my, rx * 0.32, ry * 0.27, 0, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(cx + rx * 0.3, my);
    g.quadraticCurveTo(cx + rx * 0.55, my + 30, cx + rx * 0.62, my + 70);
    g.stroke();
  }

  // kind props
  if (kind === "queen") {
    // lank hair hanging over the sides of the face
    g.strokeStyle = "rgba(6,3,8,0.92)";
    for (let i = 0; i < 90; i++) {
      const side = i % 2 ? 1 : -1;
      const x0 = cx + side * (10 + r() * rx * 0.5);
      g.lineWidth = 1.5 + r() * 5;
      g.beginPath();
      g.moveTo(x0, cy - ry * 0.98);
      g.bezierCurveTo(x0 + side * rx * (0.4 + r() * 0.4), cy - ry * 0.6, cx + side * rx * (0.55 + r() * 0.45), cy, cx + side * rx * (0.5 + r() * 0.6), cy + ry * (0.6 + r() * 0.5));
      g.stroke();
    }
    g.save();
    g.strokeStyle = "rgba(220,190,120,0.85)";
    g.fillStyle = "rgba(160,130,70,0.5)";
    g.lineWidth = 5;
    g.beginPath();
    const ty = cy - ry * 0.9;
    g.moveTo(cx - rx * 0.6, ty + 40);
    for (let i = 0; i <= 8; i++) g.lineTo(cx - rx * 0.6 + (i * rx * 1.2) / 8, ty + (i % 2 ? -10 - (i === 4 ? 40 : 0) : 30));
    g.stroke();
    g.restore();
  } else if (kind === "janitor") {
    g.fillStyle = "#14160f";
    g.beginPath();
    g.ellipse(cx, cy - ry * 0.78, rx * 1.05, ry * 0.28, 0, Math.PI, Math.PI * 2);
    g.fill();
    g.fillRect(cx - rx * 1.25, cy - ry * 0.8, rx * 2.5, 26);
    // stubble
    g.fillStyle = "rgba(20,20,10,0.5)";
    for (let i = 0; i < 900; i++) {
      const a = r() * Math.PI,
        d = 0.75 + r() * 0.25;
      g.fillRect(cx + Math.cos(a) * rx * 0.8 * d, cy + ry * 0.25 + Math.sin(a) * ry * 0.65 * d, 2, 2);
    }
  } else if (kind === "principal") {
    // slicked hair and cracked spectacles
    g.fillStyle = "#120c09";
    g.beginPath();
    g.ellipse(cx + 20, cy - ry * 0.82, rx * 1.02, ry * 0.32, -0.08, Math.PI, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(25,20,18,0.95)";
    g.lineWidth = 7;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.arc(cx + sx * eyeDX, eyeY, rx * 0.3, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(cx - eyeDX + rx * 0.3, eyeY);
    g.quadraticCurveTo(cx, eyeY - 18, cx + eyeDX - rx * 0.3, eyeY);
    g.stroke();
    g.strokeStyle = "rgba(230,230,240,0.55)";
    g.lineWidth = 1.5;
    const lx = cx + eyeDX;
    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2;
      g.beginPath();
      g.moveTo(lx - 20, eyeY - 30);
      g.lineTo(lx - 20 + Math.cos(a) * rx * 0.3, eyeY - 30 + Math.sin(a) * rx * 0.3);
      g.stroke();
    }
  }

  // tint, glitch slices, grain and vignette
  g.globalCompositeOperation = "overlay";
  g.fillStyle = kind === "queen" ? "rgba(120,60,200,0.25)" : kind === "janitor" ? "rgba(120,160,40,0.18)" : "rgba(200,30,20,0.25)";
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = "source-over";
  for (let i = 0; i < 10; i++) {
    const y = r() * S,
      h = 4 + r() * 26,
      dx = (r() - 0.5) * 60;
    g.drawImage(g.canvas, 0, y, S, h, dx, y, S, h);
  }
  grain(g, S, r, 0.18);
  vignette(g, S, 0.9);
}
