export const PI = Math.PI;
export const TAU = Math.PI * 2;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export function wrapAngle(a: number) {
  while (a > PI) a -= TAU;
  while (a < -PI) a += TAU;
  return a;
}
export const lerpAngle = (a: number, b: number, t: number) => a + wrapAngle(b - a) * t;

/** Deterministic PRNG so the school is dressed the same way every visit. */
export function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = Math.random;
export const randRange = (a: number, b: number) => a + Math.random() * (b - a);
export function pick<T>(arr: readonly T[], r: () => number = Math.random): T {
  return arr[Math.floor(r() * arr.length)];
}
export function shuffle<T>(arr: T[], r: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

export const isTouchDevice = () =>
  matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
