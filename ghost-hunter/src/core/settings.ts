export type Quality = "low" | "medium" | "high" | "ultra";
export type Difficulty = "easy" | "normal" | "nightmare";

export interface Settings {
  sensitivity: number;
  invertY: boolean;
  fov: number;
  volume: number;
  quality: Quality;
  headBob: boolean;
  gentle: boolean; // fewer flashes and softer jump scares
  captions: boolean;
  showFps: boolean;
  difficulty: Difficulty;
}

const KEY = "brodie.settings.v2";

const defaults = (): Settings => ({
  sensitivity: 1,
  invertY: false,
  fov: 75,
  volume: 0.8,
  quality: matchMedia("(pointer: coarse)").matches ? "medium" : "high",
  headBob: true,
  gentle: false,
  captions: true,
  showFps: false,
  difficulty: "normal",
});

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch {
    /* storage can be unavailable in private windows */
  }
  return defaults();
}

export const settings: Settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export interface QualityPreset {
  maxPixelRatio: number;
  shadowSize: number;
  lightPool: number;
  smaa: boolean;
  bloom: boolean;
  rain: number;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { maxPixelRatio: 0.75, shadowSize: 512, lightPool: 3, smaa: false, bloom: false, rain: 2500 },
  medium: { maxPixelRatio: 1, shadowSize: 1024, lightPool: 5, smaa: true, bloom: true, rain: 5000 },
  high: { maxPixelRatio: 1.5, shadowSize: 1024, lightPool: 6, smaa: true, bloom: true, rain: 9000 },
  ultra: { maxPixelRatio: 2, shadowSize: 2048, lightPool: 8, smaa: true, bloom: true, rain: 14000 },
};

export interface DifficultyPreset {
  label: string;
  ghostSpeed: number;
  damage: number;
  sight: number;
  drain: number;
  escapeTime: number;
  continues: number;
  scoreMult: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyPreset> = {
  easy: { label: "Easy", ghostSpeed: 0.8, damage: 0.6, sight: 0.8, drain: 0.7, escapeTime: 120, continues: 99, scoreMult: 0.75 },
  normal: { label: "Normal", ghostSpeed: 1, damage: 1, sight: 1, drain: 1, escapeTime: 90, continues: 3, scoreMult: 1 },
  nightmare: { label: "Nightmare", ghostSpeed: 1.2, damage: 1.4, sight: 1.25, drain: 1.3, escapeTime: 70, continues: 1, scoreMult: 1.5 },
};

const BEST_KEY = "brodie.best.v2";
export interface Best {
  score: number;
  time: number;
  rank: string;
}
export function loadBest(): Partial<Record<Difficulty, Best>> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) || "{}");
  } catch {
    return {};
  }
}
export function saveBest(d: Difficulty, b: Best): boolean {
  const all = loadBest();
  const prev = all[d];
  if (prev && prev.score >= b.score) return false;
  all[d] = b;
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  return true;
}
