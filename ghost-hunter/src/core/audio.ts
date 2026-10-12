import { settings } from "./settings";
import { clamp, rand } from "./util";

type V3 = { x: number; y: number; z: number };

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  at?: number;
}
interface NoiseOpts {
  type?: BiquadFilterType;
  f?: number;
  q?: number;
  gain?: number;
  attack?: number;
  at?: number;
  sweep?: number;
}

/**
 * Everything is synthesised at runtime, so there are no audio files to load.
 * One-shots can be positioned in 3D with HRTF panners; a convolution reverb
 * send makes the corridors sound like corridors.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  bus!: GainNode;
  reverbSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private rainGain!: GainNode;
  private rainFilter!: BiquadFilterNode;
  private droneGain!: GainNode;
  private humGain!: GainNode;
  private musicGain!: GainNode;
  private escapeDrone: GainNode | null = null;
  indoor = 0;

  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = settings.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.bus = ctx.createGain();
    this.bus.connect(this.master);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // Reverb: a synthetic impulse response with an exponential tail.
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    conv.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.1;
    this.reverbSend.connect(conv).connect(this.master);

    // Rain bed
    const rain = ctx.createBufferSource();
    rain.buffer = this.noiseBuf;
    rain.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 500;
    this.rainFilter = ctx.createBiquadFilter();
    this.rainFilter.type = "lowpass";
    this.rainFilter.frequency.value = 7000;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0.12;
    rain.connect(hp).connect(this.rainFilter).connect(this.rainGain).connect(this.bus);
    rain.start();

    // Building drone
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 160;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    lp.connect(this.droneGain).connect(this.bus);
    for (const f of [36.7, 37.1, 55.2]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    // Fluorescent hum
    const hum = ctx.createOscillator();
    hum.type = "square";
    hum.frequency.value = 120;
    const humLp = ctx.createBiquadFilter();
    humLp.type = "lowpass";
    humLp.frequency.value = 900;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    hum.connect(humLp).connect(this.humGain).connect(this.bus);
    hum.start();

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.5;
    this.musicGain.connect(this.master);
  }

  setVolume(v: number) {
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setListener(pos: V3, fwd: V3) {
    const ctx = this.ctx;
    if (!ctx) return;
    const L = ctx.listener;
    if (L.positionX) {
      const t = ctx.currentTime;
      L.positionX.setTargetAtTime(pos.x, t, 0.02);
      L.positionY.setTargetAtTime(pos.y, t, 0.02);
      L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      L.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else {
      (L as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(pos.x, pos.y, pos.z);
      (L as unknown as { setOrientation: (...a: number[]) => void }).setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  /** Blend outdoor rain and indoor drone. k = 0 outside, 1 inside. */
  setAmbience(indoor: number, fear: number, humLevel: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.indoor = indoor;
    this.rainGain.gain.setTargetAtTime(0.03 + 0.13 * (1 - indoor), t, 0.2);
    this.rainFilter.frequency.setTargetAtTime(700 + 6500 * (1 - indoor), t, 0.2);
    this.droneGain.gain.setTargetAtTime(indoor * (0.02 + fear * 0.05), t, 0.3);
    this.reverbSend.gain.setTargetAtTime(0.08 + indoor * 0.32, t, 0.3);
    this.humGain.gain.setTargetAtTime(humLevel * 0.006, t, 0.1);
  }

  // ------------------------------------------------------------ primitives
  private out(pos?: V3): AudioNode {
    const ctx = this.ctx!;
    if (!pos) {
      const g = ctx.createGain();
      g.connect(this.bus);
      g.connect(this.reverbSend);
      return g;
    }
    const p = ctx.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "inverse";
    p.refDistance = 1.8;
    p.rolloffFactor = 1.1;
    p.maxDistance = 60;
    if (p.positionX) {
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
    } else (p as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(pos.x, pos.y, pos.z);
    p.connect(this.bus);
    p.connect(this.reverbSend);
    return p;
  }

  noise(dur: number, o: NoiseOpts = {}, pos?: V3) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (o.at || 0);
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const fl = ctx.createBiquadFilter();
    fl.type = o.type || "bandpass";
    fl.frequency.setValueAtTime(o.f || 1000, t);
    if (o.sweep) fl.frequency.exponentialRampToValueAtTime(o.sweep, t + dur);
    fl.Q.value = o.q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain ?? 0.3, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(this.out(pos));
    s.start(t, rand() * 1.5);
    s.stop(t + dur + 0.05);
  }

  tone(f0: number, f1: number, dur: number, o: ToneOpts = {}, pos?: V3) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (o.at || 0);
    const os = ctx.createOscillator();
    os.type = o.type || "sine";
    os.frequency.setValueAtTime(f0, t);
    os.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain ?? 0.2, t + (o.attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    os.connect(g).connect(this.out(pos));
    os.start(t);
    os.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- sounds
  step(surface: "hard" | "wood" | "wet" | "soft" | "metal", run: boolean, crouch: boolean) {
    const k = crouch ? 0.35 : run ? 1.25 : 0.8;
    if (surface === "wet") {
      this.noise(0.14, { f: 1500, q: 1.2, gain: 0.16 * k });
      this.noise(0.08, { type: "lowpass", f: 400, gain: 0.12 * k });
    } else if (surface === "wood") {
      this.noise(0.1, { type: "lowpass", f: 700, gain: 0.22 * k });
      this.tone(110, 70, 0.08, { gain: 0.08 * k });
    } else if (surface === "soft") {
      this.noise(0.12, { type: "lowpass", f: 300, gain: 0.14 * k });
    } else if (surface === "metal") {
      this.noise(0.12, { f: 2200, q: 8, gain: 0.12 * k });
      this.noise(0.08, { type: "lowpass", f: 500, gain: 0.15 * k });
    } else {
      this.noise(0.08, { type: "lowpass", f: 520 + rand() * 120, gain: 0.2 * k });
      this.noise(0.03, { type: "highpass", f: 3000, gain: 0.03 * k });
    }
  }
  heart(v: number) {
    this.tone(68, 40, 0.18, { gain: 0.3 + v * 0.4 });
    this.tone(62, 36, 0.16, { gain: 0.22 + v * 0.3, at: 0.22 });
  }
  breathIn() {
    this.noise(1.0, { type: "bandpass", f: 900, q: 0.8, gain: 0.05, attack: 0.4 });
  }
  pant() {
    this.noise(0.45, { f: 1100, q: 0.7, gain: 0.08, attack: 0.1 });
  }
  gasp() {
    this.noise(0.7, { f: 900, q: 1, gain: 0.35, attack: 0.04 });
  }
  clank(pos?: V3) {
    this.noise(0.35, { f: 900, q: 6, gain: 0.45 }, pos);
    this.noise(0.6, { f: 2300, q: 14, gain: 0.22 }, pos);
    this.tone(190, 120, 0.4, { type: "square", gain: 0.04 }, pos);
  }
  slam(pos?: V3) {
    this.tone(70, 28, 0.9, { gain: 0.7 }, pos);
    this.noise(0.9, { type: "lowpass", f: 500, gain: 0.6 }, pos);
    this.noise(0.3, { f: 2500, q: 8, gain: 0.3, at: 0.05 }, pos);
  }
  scream(gentle: boolean) {
    const k = gentle ? 0.4 : 1;
    this.noise(1.4, { type: "highpass", f: 1100, gain: 0.7 * k, attack: 0.01 });
    this.tone(1150, 200, 1.3, { type: "sawtooth", gain: 0.28 * k });
    this.tone(1480, 240, 1.2, { type: "sawtooth", gain: 0.2 * k });
    this.tone(55, 28, 0.8, { type: "square", gain: 0.35 * k });
  }
  sting() {
    this.tone(1900, 1800, 1.4, { type: "sawtooth", gain: 0.05 });
    this.tone(2013, 1950, 1.4, { type: "sawtooth", gain: 0.045 });
    this.noise(0.6, { type: "highpass", f: 4000, gain: 0.12 });
    this.tone(58, 30, 0.8, { gain: 0.3 });
  }
  shriek(pos: V3) {
    this.tone(380, 1700, 1.2, { type: "sawtooth", gain: 0.12 }, pos);
    this.noise(1.2, { f: 3000, q: 2, gain: 0.18, sweep: 6000 }, pos);
  }
  whisper(pos: V3) {
    for (let i = 0; i < 6; i++) this.noise(0.35, { f: 1800 + rand() * 2400, q: 6, gain: 0.08, attack: 0.1, at: i * 0.22 }, pos);
  }
  giggle(pos: V3) {
    for (let i = 0; i < 6; i++) this.tone(860 + rand() * 240, 700, 0.1, { gain: 0.08, at: i * 0.12 }, pos);
  }
  keys(pos: V3) {
    for (let i = 0; i < 5; i++) this.noise(0.08, { f: 3200 + rand() * 1800, q: 14, gain: 0.12, at: i * 0.07 + rand() * 0.04 }, pos);
  }
  tick(pos: V3) {
    this.noise(0.03, { f: 3500, q: 10, gain: 0.25 }, pos);
  }
  crack(pos: V3) {
    this.noise(0.07, { type: "highpass", f: 1800, gain: 0.5 }, pos);
  }
  thud(pos?: V3) {
    this.tone(90, 40, 0.4, { gain: 0.35 }, pos);
    this.noise(0.3, { type: "lowpass", f: 300, gain: 0.28 }, pos);
  }
  burst(pos: V3) {
    this.noise(0.25, { type: "highpass", f: 2500, gain: 0.45 }, pos);
    this.noise(0.6, { f: 5000, q: 2, gain: 0.15, at: 0.05 }, pos);
  }
  buzz(pos: V3) {
    this.noise(0.15, { f: 120, q: 3, gain: 0.2 }, pos);
  }
  thunder(muffled: boolean) {
    this.noise(4, { type: "lowpass", f: muffled ? 140 : 260, gain: muffled ? 0.35 : 0.6, attack: 0.08 });
    this.tone(45, 25, 3, { gain: muffled ? 0.18 : 0.3 });
  }
  beep(level: number) {
    this.tone(1700 + level * 220, 1700 + level * 220, 0.04, { type: "square", gain: 0.022 + level * 0.006 });
  }
  click() {
    this.noise(0.03, { f: 4000, q: 4, gain: 0.25 });
    this.noise(0.04, { type: "lowpass", f: 900, gain: 0.15, at: 0.02 });
  }
  pickup() {
    this.tone(880, 880, 0.25, { gain: 0.07 });
    this.tone(1320, 1320, 0.35, { gain: 0.05, at: 0.08 });
  }
  paper() {
    for (let i = 0; i < 4; i++) this.noise(0.12, { f: 2500 + rand() * 2000, q: 1, gain: 0.12, at: i * 0.07 });
  }
  relic() {
    for (const [f, a] of [[220, 0], [277, 0.05], [330, 0.1], [415, 0.15]] as const) this.tone(f, f * 0.995, 3.2, { gain: 0.07, attack: 0.6, at: a });
    this.noise(2.5, { f: 6000, q: 3, gain: 0.05, attack: 0.8 });
  }
  banish(pos: V3) {
    this.noise(2.2, { type: "bandpass", f: 400, q: 0.6, gain: 0.4, sweep: 5000, attack: 0.2 }, pos);
    for (const [f, a] of [[262, 0.4], [330, 0.5], [392, 0.6], [523, 0.7]] as const) this.tone(f, f, 2.4, { gain: 0.06, attack: 0.5, at: a });
  }
  uvHum(on: boolean) {
    if (on) this.tone(240, 250, 0.12, { type: "sawtooth", gain: 0.012 });
  }
  chime() {
    this.tone(784, 784, 1.1, { gain: 0.16 });
    this.tone(622, 622, 1.4, { gain: 0.16, at: 0.6 });
  }
  bell(count: number) {
    for (let i = 0; i < count; i++) {
      this.tone(520, 516, 1.6, { gain: 0.14, at: i * 0.75 });
      this.tone(1310, 1300, 1.0, { gain: 0.05, at: i * 0.75 });
    }
  }
  win() {
    for (const [f, a] of [[262, 0], [330, 0.2], [392, 0.4], [523, 0.6]] as const) this.tone(f, f, 3, { gain: 0.08, attack: 0.3, at: a });
  }
  engine() {
    this.tone(40, 70, 1.2, { type: "sawtooth", gain: 0.12 });
    this.noise(1.5, { type: "lowpass", f: 200, gain: 0.25 });
  }

  /** Low pulsing drone during the escape sequence. */
  setEscape(on: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (on && !this.escapeDrone) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(0.06, ctx.currentTime, 1);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 2.2;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.04;
      lfo.connect(lfoG).connect(g.gain);
      lfo.start();
      for (const f of [49, 73.4, 98.2]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        o.connect(g);
        o.start();
      }
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 400;
      g.connect(lp).connect(this.musicGain);
      this.escapeDrone = g;
    } else if (!on && this.escapeDrone) {
      this.escapeDrone.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      this.escapeDrone = null;
    }
  }

  speak(text: string) {
    try {
      if (!window.speechSynthesis || settings.volume <= 0) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.75;
      u.pitch = 0.2;
      u.volume = clamp(settings.volume, 0, 1);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      /* ignore */
    }
  }
  stopSpeech() {
    try {
      speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }

  suspend() {
    this.ctx?.suspend();
  }
  resume() {
    this.ctx?.resume();
  }
}

/** A persistent positional sound such as a ghost humming. */
export class Emitter {
  private panner: PannerNode | null = null;
  private gain: GainNode | null = null;
  constructor(private audio: AudioEngine, private build: (ctx: AudioContext, out: AudioNode) => void) {}
  private ensure() {
    const ctx = this.audio.ctx;
    if (!ctx || this.panner) return;
    this.panner = ctx.createPanner();
    this.panner.panningModel = "HRTF";
    this.panner.distanceModel = "inverse";
    this.panner.refDistance = 2;
    this.panner.rolloffFactor = 1.3;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.build(ctx, this.gain);
    this.gain.connect(this.panner);
    this.panner.connect(this.audio.bus);
    this.panner.connect(this.audio.reverbSend);
  }
  update(pos: V3, level: number) {
    this.ensure();
    const ctx = this.audio.ctx;
    if (!ctx || !this.panner || !this.gain) return;
    const t = ctx.currentTime;
    if (this.panner.positionX) {
      this.panner.positionX.setTargetAtTime(pos.x, t, 0.05);
      this.panner.positionY.setTargetAtTime(pos.y, t, 0.05);
      this.panner.positionZ.setTargetAtTime(pos.z, t, 0.05);
    }
    this.gain.gain.setTargetAtTime(level, t, 0.15);
  }
}

/** A wordless lullaby, detuned and wavering. Jenny hums it. */
export function hummingVoice(ctx: AudioContext, out: AudioNode) {
  const notes = [392, 440, 392, 330, 349, 330, 294, 262, 294, 330, 392, 330];
  const o = ctx.createOscillator();
  o.type = "triangle";
  const o2 = ctx.createOscillator();
  o2.type = "sine";
  const vib = ctx.createOscillator();
  vib.frequency.value = 5.5;
  const vibG = ctx.createGain();
  vibG.gain.value = 6;
  vib.connect(vibG);
  vibG.connect(o.frequency);
  vibG.connect(o2.frequency);
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 900;
  f.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.value = 0.08;
  o.connect(f);
  o2.connect(f);
  f.connect(g).connect(out);
  const t0 = ctx.currentTime;
  // Schedule a long loop of the melody up front; cheap and glitch free.
  for (let rep = 0; rep < 60; rep++) {
    notes.forEach((n, i) => {
      const t = t0 + (rep * notes.length + i) * 0.62;
      o.frequency.setValueAtTime(n * 0.5, t);
      o2.frequency.setValueAtTime(n * 0.502, t);
    });
  }
  o.start();
  o2.start();
  vib.start();
}
