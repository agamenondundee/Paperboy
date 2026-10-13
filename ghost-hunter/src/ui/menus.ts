import "../style.css";
import type { EndResult, MenusApi, Note } from "../types";
import { DIFFICULTY, saveSettings, settings, type Difficulty, type Quality } from "../core/settings";
import { $, clamp, formatTime } from "../core/util";

const TIPS = [
  "Tip: a spirit only burns under UV if you carry its relic.",
  "Tip: UV light shows handprints that lead the way.",
  "Tip: running is loud. Spirits hear it from across the hall.",
  "Tip: switch your torch off and crouch to stay unseen.",
  "Tip: in a locker, hold your breath when footsteps stop outside.",
  "Tip: the EMF meter climbs as a spirit draws near.",
  "Tip: Principal Hale only moves when you are not looking.",
  "Tip: chocolate steadies your nerve. UV cells recharge the beam.",
];

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

type Back = () => void;

/**
 * Loading, title, settings, how to play, pause, notes, end screen, intro
 * video and error box. All markup lives in index.html; this binds it.
 */
export class Menus implements MenusApi {
  /** Called after any setting changes so the game can apply it. */
  onSettingsChanged: () => void = () => {};
  /** Optional UI sound hook (the game can route it to the audio engine). */
  onUiSound: (kind: "click" | "paper") => void = () => {};

  private loading = $("loading");
  private loadBar = $("loadBar");
  private loadLabel = $("loadLabel");
  private lLoad = -1;

  private titleEl = $("title");
  private titleBg = $("titleBg");
  private titleBest = $("titleBest");
  private titleResolve: (() => void) | null = null;

  private howEl = $("how");
  private settingsEl = $("settings");
  private pauseEl = $("pause");
  private noteEl = $("note");
  private endEl = $("end");
  private introEl = $("intro");
  private errorEl = $("error");

  private paused = false;
  private pauseHandlers: { resume(): void; restart(): void; quit(): void } | null = null;

  private noteOpen = false;
  private noteOpenedAt = 0;
  private noteOnClose: (() => void) | null = null;

  private endResolve: ((c: "continue" | "restart" | "quit") => void) | null = null;
  private scoreRaf = 0;

  private introSkip: (() => void) | null = null;

  /** Panels opened on top of another (settings, how to play) and how to go back. */
  private backStack: { el: HTMLElement; back: Back }[] = [];

  // settings controls
  private sSens = $<HTMLInputElement>("setSens");
  private sFov = $<HTMLInputElement>("setFov");
  private sVol = $<HTMLInputElement>("setVol");
  private sQuality = $<HTMLSelectElement>("setQuality");
  private sInvert = $<HTMLInputElement>("setInvert");
  private sBob = $<HTMLInputElement>("setBob");
  private sGentle = $<HTMLInputElement>("setGentle");
  private sCaptions = $<HTMLInputElement>("setCaptions");
  private sFps = $<HTMLInputElement>("setFps");

  constructor() {
    $("loadTip").textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    this.fillDifficultyText();
    this.bindTitle();
    this.bindSettings();
    this.bindPause();
    this.bindNote();
    this.bindEnd();
    $("errorReload").addEventListener("click", () => location.reload());
    for (const el of [this.howEl, this.settingsEl]) {
      el.querySelector("[data-back]")?.addEventListener("click", () => this.back());
      // Clicking the dimmed backdrop also goes back.
      el.addEventListener("click", (e) => e.target === el && this.back());
    }
    addEventListener("keydown", (e) => this.onKey(e), true);
    addEventListener("gamepadconnected", () => this.startPad());
  }

  // ============================================================== loading
  setLoading(frac: number, label: string) {
    const f = clamp(frac, 0, 1);
    if (Math.abs(f - this.lLoad) > 0.001) {
      this.lLoad = f;
      this.loadBar.style.transform = `scaleX(${f})`;
    }
    if (label && this.loadLabel.textContent !== label) this.loadLabel.textContent = label;
    if (!this.loading.classList.contains("show")) this.show(this.loading);
  }

  // ================================================================ title
  title(bg: HTMLImageElement | null, best: string): Promise<void> {
    this.hide(this.loading);
    this.closePause();
    if (bg && bg.src) {
      this.titleBg.style.backgroundImage = `url("${bg.src.replace(/"/g, '\\"')}")`;
      this.titleBg.classList.add("on");
      this.titleEl.classList.add("has-bg");
    } else {
      this.titleBg.style.backgroundImage = "";
      this.titleBg.classList.remove("on");
      this.titleEl.classList.remove("has-bg");
    }
    this.titleBest.hidden = !best;
    this.titleBest.textContent = best;
    const radio = this.titleEl.querySelector<HTMLInputElement>(`input[name="diff"][value="${settings.difficulty}"]`);
    if (radio) radio.checked = true;
    this.show(this.titleEl);
    this.focusFirst(this.titleEl, "#btnStart");
    return new Promise<void>((res) => (this.titleResolve = res));
  }

  private fillDifficultyText() {
    const e = DIFFICULTY.easy,
      n = DIFFICULTY.normal,
      x = DIFFICULTY.nightmare;
    const conts = (c: number) => (c >= 99 ? "Unlimited continues" : c === 1 ? "One continue" : `${c} continues`);
    $("diffEasy").textContent = `Slower, duller spirits. ${conts(e.continues)}, ${e.escapeTime} s to escape.`;
    $("diffNormal").textContent = `The night as it happened. ${conts(n.continues)}, ${n.escapeTime} s to escape.`;
    $("diffNightmare").textContent = `Faster, sharper spirits. ${conts(x.continues)}, ${x.escapeTime} s to escape.`;
  }

  private bindTitle() {
    this.titleEl.querySelectorAll<HTMLInputElement>('input[name="diff"]').forEach((r) =>
      r.addEventListener("change", () => {
        if (!r.checked) return;
        settings.difficulty = r.value as Difficulty;
        saveSettings();
        this.onUiSound("click");
      })
    );
    $("btnStart").addEventListener("click", () => {
      const r = this.titleEl.querySelector<HTMLInputElement>('input[name="diff"]:checked');
      if (r && r.value in DIFFICULTY) settings.difficulty = r.value as Difficulty;
      saveSettings();
      this.onUiSound("click");
      this.hide(this.titleEl);
      this.closePanels();
      const res = this.titleResolve;
      this.titleResolve = null;
      // Resolve inside the click so the caller still has a user gesture.
      res?.();
    });
    $("btnHow").addEventListener("click", () => this.openPanel(this.howEl, $("btnHow")));
    $("btnSettings").addEventListener("click", () => this.openPanel(this.settingsEl, $("btnSettings")));
  }

  // ========================================================== intro video
  playIntro(url: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const v = $<HTMLVideoElement>("introVideo");
      const t0 = performance.now();
      let done = false;
      let safety = 0;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(safety);
        this.introSkip = null;
        this.introEl.removeEventListener("pointerdown", onPointer);
        v.onended = v.onerror = v.onloadedmetadata = null;
        this.hide(this.introEl);
        try {
          v.pause();
          v.removeAttribute("src");
          v.load();
        } catch {
          /* ignore */
        }
        resolve();
      };
      // Ignore the tail of the Start click that led here.
      const onPointer = (e: PointerEvent) => {
        if (performance.now() - t0 < 400) return;
        e.preventDefault();
        finish();
      };
      this.introSkip = () => {
        if (performance.now() - t0 >= 400) finish();
      };
      this.introEl.addEventListener("pointerdown", onPointer);
      $("introSkip").onclick = finish;

      v.onended = finish;
      v.onerror = finish;
      // Safety net in case the video stalls; long videos get their full length.
      safety = window.setTimeout(finish, 20000);
      v.onloadedmetadata = () => {
        if (isFinite(v.duration) && v.duration > 17) {
          clearTimeout(safety);
          safety = window.setTimeout(finish, (v.duration + 3) * 1000);
        }
      };
      v.volume = clamp(settings.volume, 0, 1);
      v.muted = false;
      v.src = url;
      this.show(this.introEl);
      const p = v.play();
      if (p && typeof p.catch === "function")
        p.catch(() => {
          if (done) return;
          v.muted = true;
          v.play().catch(finish);
        });
    });
  }

  // ============================================================== settings
  private bindSettings() {
    const range = (el: HTMLInputElement, apply: (v: number) => void) =>
      el.addEventListener("input", () => {
        apply(parseFloat(el.value));
        this.changed();
      });
    range(this.sSens, (v) => (settings.sensitivity = clamp(v, 0.2, 3)));
    range(this.sFov, (v) => (settings.fov = clamp(Math.round(v), 60, 100)));
    range(this.sVol, (v) => (settings.volume = clamp(v, 0, 1)));
    this.sQuality.addEventListener("change", () => {
      settings.quality = this.sQuality.value as Quality;
      this.changed();
    });
    const toggle = (el: HTMLInputElement, apply: (v: boolean) => void) =>
      el.addEventListener("change", () => {
        apply(el.checked);
        this.onUiSound("click");
        this.changed();
      });
    toggle(this.sInvert, (v) => (settings.invertY = v));
    toggle(this.sBob, (v) => (settings.headBob = v));
    toggle(this.sGentle, (v) => (settings.gentle = v));
    toggle(this.sCaptions, (v) => (settings.captions = v));
    toggle(this.sFps, (v) => (settings.showFps = v));
  }

  private syncSettings() {
    this.sSens.value = String(settings.sensitivity);
    this.sFov.value = String(settings.fov);
    this.sVol.value = String(settings.volume);
    this.sQuality.value = settings.quality;
    this.sInvert.checked = settings.invertY;
    this.sBob.checked = settings.headBob;
    this.sGentle.checked = settings.gentle;
    this.sCaptions.checked = settings.captions;
    this.sFps.checked = settings.showFps;
    this.syncOutputs();
  }

  private syncOutputs() {
    $("outSens").textContent = settings.sensitivity.toFixed(2);
    $("outFov").textContent = `${Math.round(settings.fov)}°`;
    $("outVol").textContent = `${Math.round(settings.volume * 100)}%`;
    for (const el of [this.sSens, this.sFov, this.sVol]) {
      const p = ((parseFloat(el.value) - parseFloat(el.min)) / (parseFloat(el.max) - parseFloat(el.min))) * 100;
      el.style.setProperty("--p", `${clamp(p, 0, 100)}%`);
    }
  }

  private changed() {
    saveSettings();
    this.syncOutputs();
    try {
      this.onSettingsChanged();
    } catch (err) {
      console.error(err);
    }
  }

  // ============================================================ how / panels
  private openPanel(el: HTMLElement, opener: HTMLElement) {
    if (el === this.settingsEl) this.syncSettings();
    this.onUiSound("click");
    this.backStack.push({
      el,
      back: () => {
        this.hide(el);
        opener.focus({ preventScroll: true });
      },
    });
    this.show(el);
    const body = el.querySelector<HTMLElement>(".panel-body");
    if (body) body.scrollTop = 0;
    this.focusFirst(el);
  }

  private back() {
    const top = this.backStack.pop();
    if (!top) return;
    this.onUiSound("click");
    top.back();
  }

  private closePanels() {
    while (this.backStack.length) this.hide(this.backStack.pop()!.el);
  }

  // ================================================================= pause
  private bindPause() {
    const act = (id: string, fn: () => void) => $(id).addEventListener("click", fn);
    act("btnResume", () => {
      const h = this.pauseHandlers;
      this.onUiSound("click");
      this.closePause();
      h?.resume();
    });
    act("btnRestart", () => {
      const h = this.pauseHandlers;
      this.onUiSound("click");
      this.closePause();
      h?.restart();
    });
    act("btnQuit", () => {
      const h = this.pauseHandlers;
      this.onUiSound("click");
      this.closePause();
      h?.quit();
    });
    act("btnPauseSettings", () => this.openPanel(this.settingsEl, $("btnPauseSettings")));
    act("btnPauseHow", () => this.openPanel(this.howEl, $("btnPauseHow")));
  }

  pause(handlers: { resume(): void; restart(): void; quit(): void }) {
    this.pauseHandlers = handlers;
    if (this.paused) return;
    this.paused = true;
    this.show(this.pauseEl);
    this.focusFirst(this.pauseEl, "#btnResume");
  }

  closePause() {
    if (!this.paused) return;
    this.paused = false;
    this.closePanels();
    this.hide(this.pauseEl);
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  isPaused() {
    return this.paused;
  }

  // ================================================================== note
  private bindNote() {
    $("noteClose").addEventListener("click", () => this.closeNote());
    this.noteEl.addEventListener("click", (e) => {
      if (e.target === this.noteEl && performance.now() - this.noteOpenedAt > 300) this.closeNote();
    });
  }

  showNote(n: Note, onClose: () => void) {
    $("noteTitle").textContent = n.title;
    const body = $("noteBody");
    body.textContent = "";
    for (const para of n.body.split(/\n\s*\n/)) {
      const p = document.createElement("p");
      const lines = para.split("\n");
      lines.forEach((line, i) => {
        if (i) p.appendChild(document.createElement("br"));
        p.append(line);
      });
      body.appendChild(p);
    }
    const paper = this.noteEl.querySelector<HTMLElement>(".paper");
    if (paper) {
      paper.scrollTop = 0;
      paper.style.setProperty("rotate", `${((Math.random() - 0.5) * 1.6).toFixed(2)}deg`);
    }
    this.noteOnClose = onClose;
    this.noteOpen = true;
    this.noteOpenedAt = performance.now();
    this.onUiSound("paper");
    this.show(this.noteEl);
    this.focusFirst(this.noteEl, "#noteClose");
  }

  private closeNote() {
    if (!this.noteOpen) return;
    this.noteOpen = false;
    this.hide(this.noteEl);
    (document.activeElement as HTMLElement | null)?.blur?.();
    const cb = this.noteOnClose;
    this.noteOnClose = null;
    this.onUiSound("paper");
    cb?.();
  }

  isNoteOpen() {
    return this.noteOpen;
  }

  // =================================================================== end
  private bindEnd() {
    const pick = (id: string, c: "continue" | "restart" | "quit") =>
      $(id).addEventListener("click", () => {
        const res = this.endResolve;
        if (!res) return;
        this.endResolve = null;
        cancelAnimationFrame(this.scoreRaf);
        this.onUiSound("click");
        this.hide(this.endEl);
        res(c);
      });
    pick("btnContinue", "continue");
    pick("btnRetry", "restart");
    pick("btnEndQuit", "quit");
  }

  end(r: EndResult): Promise<"continue" | "restart" | "quit"> {
    this.closePause();
    this.closePanels();
    const el = this.endEl;
    el.classList.toggle("won", r.won);
    el.classList.toggle("lost", !r.won);
    $("endKicker").textContent = `${DIFFICULTY[settings.difficulty]?.label ?? "Normal"} difficulty`;
    $("endTitle").textContent = r.title;
    $("endText").textContent = r.text;
    $("endTime").textContent = formatTime(Math.max(0, r.time));
    $("endNotes").textContent = String(r.notes);
    $("endConts").textContent = String(r.continuesUsed);
    const rank = $("endRank");
    const letter = (r.rank || "C").slice(0, 2).toUpperCase();
    rank.textContent = letter;
    rank.className = `rank r-${letter[0]}`;
    $("endBest").hidden = !r.best;
    $("btnContinue").hidden = !r.canContinue;

    const bg = $("endBg");
    if (r.image && r.image.src) {
      bg.style.backgroundImage = `url("${r.image.src.replace(/"/g, '\\"')}")`;
      bg.classList.add("on");
    } else {
      bg.style.backgroundImage = "";
      bg.classList.remove("on");
    }
    bg.querySelector("video")?.remove();
    if (r.video) {
      const v = document.createElement("video");
      v.src = r.video;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.autoplay = true;
      v.setAttribute("aria-hidden", "true");
      bg.appendChild(v);
      bg.classList.add("on");
      v.play().catch(() => {});
    }

    this.countScore(Math.max(0, Math.round(r.score)));
    this.show(el);
    this.focusFirst(el, r.canContinue ? "#btnContinue" : "#btnRetry");
    return new Promise((res) => (this.endResolve = res));
  }

  private countScore(target: number) {
    const out = $("endScore");
    cancelAnimationFrame(this.scoreRaf);
    const fmt = (n: number) => n.toLocaleString("en-GB");
    if (reducedMotion() || target === 0) {
      out.textContent = fmt(target);
      return;
    }
    const t0 = performance.now() + 350,
      dur = 1200;
    out.textContent = "0";
    const tick = (now: number) => {
      const t = clamp((now - t0) / dur, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      out.textContent = fmt(Math.round(target * e));
      if (t < 1) this.scoreRaf = requestAnimationFrame(tick);
    };
    this.scoreRaf = requestAnimationFrame(tick);
  }

  // ================================================================= error
  showError(text: string) {
    $("errorText").textContent = text;
    this.hide(this.loading);
    this.show(this.errorEl);
    this.focusFirst(this.errorEl, "#errorReload");
  }

  // =============================================================== helpers
  private show(el: HTMLElement) {
    el.classList.add("show");
    el.setAttribute("aria-hidden", "false");
    this.startPad();
  }

  private hide(el: HTMLElement) {
    el.classList.remove("show");
    el.setAttribute("aria-hidden", "true");
  }

  private focusFirst(root: HTMLElement, sel?: string) {
    const el = (sel && root.querySelector<HTMLElement>(sel)) || this.focusables(root)[0];
    if (el) requestAnimationFrame(() => el.focus({ preventScroll: true }));
  }

  /** The overlay the player is interacting with, highest first. */
  private topOverlay(): HTMLElement | null {
    const order = [this.errorEl, this.introEl, this.noteEl, ...this.backStack.map((b) => b.el).reverse(), this.endEl, this.pauseEl, this.titleEl];
    for (const el of order) if (el.classList.contains("show")) return el;
    return null;
  }

  private focusables(root: HTMLElement) {
    return Array.from(root.querySelectorAll<HTMLElement>("button, input, select")).filter(
      (el) => !(el as HTMLButtonElement).disabled && !el.closest("[hidden]") && el.getClientRects().length > 0
    );
  }

  private moveFocus(dir: 1 | -1) {
    const top = this.topOverlay();
    if (!top) return;
    const list = this.focusables(top);
    if (!list.length) return;
    // Radio groups count as one stop: arrows within them change the choice.
    const stops = list.filter((el) => !(el instanceof HTMLInputElement && el.type === "radio" && !el.checked));
    const i = stops.indexOf(document.activeElement as HTMLElement);
    const next = stops[(i < 0 ? (dir > 0 ? 0 : stops.length - 1) : i + dir + stops.length) % stops.length];
    next.focus({ preventScroll: false });
  }

  private adjust(dir: 1 | -1) {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement && el.type === "range") {
      if (dir > 0) el.stepUp();
      else el.stepDown();
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (el instanceof HTMLSelectElement) {
      el.selectedIndex = clamp(el.selectedIndex + dir, 0, el.options.length - 1);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el instanceof HTMLInputElement && el.type === "radio") {
      const group = Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="${el.name}"]`));
      const n = group[clamp(group.indexOf(el) + dir, 0, group.length - 1)];
      if (n !== el) {
        n.checked = true;
        n.focus();
        n.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } else if (el instanceof HTMLInputElement && el.type === "checkbox") {
      if (el.checked !== dir > 0) el.click();
    } else this.moveFocus(dir);
  }

  /** Capture-phase keys: menus that own a key stop the game from also seeing it. */
  private onKey(e: KeyboardEvent) {
    const swallow = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (this.introEl.classList.contains("show")) {
      e.stopPropagation();
      if (e.code === "Space" || e.code === "Tab" || e.code === "Escape") e.preventDefault();
      if (!e.repeat) this.introSkip?.();
      return;
    }
    if (this.noteOpen) {
      if (e.code === "KeyE" || e.code === "Escape") {
        swallow();
        if (!e.repeat && performance.now() - this.noteOpenedAt > 150) this.closeNote();
      }
      return;
    }
    if (this.backStack.length && e.code === "Escape") {
      swallow();
      this.back();
      return;
    }
    const top = this.topOverlay();
    if (!top) return;
    const active = document.activeElement;
    const onControl = active instanceof HTMLInputElement || active instanceof HTMLSelectElement;
    if (e.code === "ArrowDown" || e.code === "ArrowUp") {
      if (active instanceof HTMLSelectElement) return;
      swallow();
      this.moveFocus(e.code === "ArrowDown" ? 1 : -1);
    } else if ((e.code === "ArrowLeft" || e.code === "ArrowRight") && !onControl) {
      swallow();
      this.moveFocus(e.code === "ArrowRight" ? 1 : -1);
    } else if (e.code === "Tab") {
      // Keep Tab inside the open dialog (the game uses Tab for the map).
      swallow();
      this.moveFocus(e.shiftKey ? -1 : 1);
    }
  }

  // ------------------------------------------------- gamepad menu navigation
  private padRaf = 0;
  private padPrev: boolean[] = [];
  private padRepeat = 0;
  private padHeldDir = 0;
  private padPrimed = false;

  private startPad() {
    if (this.padRaf || !navigator.getGamepads) return;
    // Buttons already held when a menu opens (the press that opened it) are not presses.
    this.padPrimed = false;
    const loop = (now: number) => {
      this.padRaf = 0;
      const top = this.topOverlay();
      if (!top || top === this.errorEl) {
        this.padPrev.length = 0;
        return;
      }
      this.pollPad(top, now);
      this.padRaf = requestAnimationFrame(loop);
    };
    this.padRaf = requestAnimationFrame(loop);
  }

  private pollPad(top: HTMLElement, now: number) {
    const pads = navigator.getGamepads();
    let gp: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) gp = gp || p;
    if (!gp) return;
    const btn = (i: number) => !!gp!.buttons[i] && gp!.buttons[i].pressed;
    if (!this.padPrimed) {
      this.padPrimed = true;
      for (let i = 0; i < gp.buttons.length; i++) this.padPrev[i] = btn(i);
      this.padHeldDir = 0;
      return;
    }
    const edge = (i: number) => {
      const now = btn(i),
        was = !!this.padPrev[i];
      this.padPrev[i] = now;
      return now && !was;
    };
    const ay = gp.axes[1] || 0,
      ax = gp.axes[0] || 0;
    const v = btn(12) || ay < -0.6 ? -1 : btn(13) || ay > 0.6 ? 1 : 0;
    const h = btn(14) || ax < -0.6 ? -1 : btn(15) || ax > 0.6 ? 1 : 0;
    const dir = v ? v * 2 : h;
    if (dir !== this.padHeldDir) {
      this.padHeldDir = dir;
      this.padRepeat = now + 380;
      if (dir) this.padStep(dir);
    } else if (dir && now > this.padRepeat) {
      this.padRepeat = now + 110;
      this.padStep(dir);
    }

    if (edge(0)) {
      if (top === this.introEl) this.introSkip?.();
      else {
        const a = document.activeElement as HTMLElement | null;
        if (a && top.contains(a)) {
          if (a instanceof HTMLInputElement && a.type === "range") return;
          a.click();
        } else this.focusFirst(top);
      }
    }
    if (edge(1)) {
      if (top === this.introEl) this.introSkip?.();
      else if (top === this.noteEl) this.closeNote();
      else if (this.backStack.length) this.back();
    }
  }

  private padStep(dir: number) {
    const top = this.topOverlay();
    if (!top || top === this.introEl) return;
    const a = document.activeElement as HTMLElement | null;
    if (!a || !top.contains(a)) {
      this.focusFirst(top);
      return;
    }
    if (dir === 2 || dir === -2) this.moveFocus(dir > 0 ? 1 : -1);
    else this.adjust(dir as 1 | -1);
  }
}
