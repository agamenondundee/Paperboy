import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import type { Assets } from "../types";

/**
 * Loads everything the game needs before the title screen. Nothing here ever
 * rejects: a file that fails (or is still pending when the overall timeout
 * hits) comes back as null / undefined with a console warning, and every
 * consumer has a drawn fallback.
 */

const TIMEOUT_MS = 60_000;
const ANISOTROPY = 8;

type TexKey = keyof Assets["tex"];
type GenImageKey = "title" | "ending" | "faceQueen" | "faceJanitor" | "facePrincipal";
type GenTexKey = "posterMissing" | "posterProm" | "wall" | "floor";

// [field, file, is colour (sRGB)]
const TEXTURES: [TexKey, string, boolean][] = [
  ["brick", "brick_diffuse.jpg", true],
  ["brickBump", "brick_bump.jpg", false],
  ["brickRough", "brick_roughness.jpg", false],
  ["wood", "hardwood2_diffuse.jpg", true],
  ["woodRough", "hardwood2_roughness.jpg", false],
  ["checker", "FloorsCheckerboard_S_Diffuse.jpg", true],
  ["checkerNormal", "FloorsCheckerboard_S_Normal.jpg", false],
  ["splat", "decal-diffuse.png", true],
  ["splatNormal", "decal-normal.jpg", false],
  ["water", "waternormals.jpg", false],
  ["headColour", "Map-COL.jpg", true],
  ["headNormal", "Infinite-Level_02_Tangent_SmoothUV.jpg", false],
];

// Generated art: base file name -> field.
const GEN_IMAGES: Record<string, GenImageKey> = {
  title: "title",
  ending: "ending",
  "face-queen": "faceQueen",
  "face-janitor": "faceJanitor",
  "face-principal": "facePrincipal",
};
const GEN_TEXTURES: Record<string, GenTexKey> = {
  "poster-missing": "posterMissing",
  "poster-prom": "posterProm",
  wall: "wall",
  floor: "floor",
};
/** When several formats share a base name, the first listed wins. */
const EXT_ORDER = ["png", "webp", "jpg", "jpeg", "mp4"];

// Found at build time, so a missing file is simply absent and never requested.
const GEN_FILES = import.meta.glob("../assets/gen/*.{png,jpg,jpeg,webp,mp4}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function assetUrl(file: string) {
  const base = import.meta.env.BASE_URL || "/";
  return (base.endsWith("/") ? base : base + "/") + "assets/" + file;
}

/** Group the generated files by lower-case base name, picking one format each. */
function discoverGen(): Map<string, string> {
  const best = new Map<string, { url: string; rank: number }>();
  for (const [path, url] of Object.entries(GEN_FILES)) {
    if (typeof url !== "string" || !url) continue;
    const file = path.slice(path.lastIndexOf("/") + 1);
    const dot = file.lastIndexOf(".");
    const name = file.slice(0, dot).toLowerCase();
    const ext = file.slice(dot + 1).toLowerCase();
    // The intro must be a video; everything else must be a picture.
    if ((name === "intro") !== (ext === "mp4")) continue;
    const rank = EXT_ORDER.indexOf(ext);
    const prev = best.get(name);
    if (!prev || rank < prev.rank) best.set(name, { url, rank });
  }
  const out = new Map<string, string>();
  best.forEach((v, k) => out.set(k, v.url));
  return out;
}

function prepTexture(t: THREE.Texture, srgb: boolean) {
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISOTROPY;
  t.needsUpdate = true;
  return t;
}

/** An <img> that is fully decoded, so showing it later never stalls a frame. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      // decode() can reject spuriously for very large images; onload is enough then.
      if (typeof img.decode === "function") img.decode().then(() => resolve(img), () => resolve(img));
      else resolve(img);
    };
    img.onerror = () => reject(new Error("could not load " + url));
    img.src = url;
  });
}

interface Job {
  name: string;
  weight: number;
  frac: number;
  done: boolean;
}

export async function loadAssets(onProgress: (f: number) => void): Promise<Assets> {
  const assets: Assets = {
    tex: {
      brick: null,
      brickBump: null,
      brickRough: null,
      wood: null,
      woodRough: null,
      checker: null,
      checkerNormal: null,
      splat: null,
      splatNormal: null,
      water: null,
      headColour: null,
      headNormal: null,
    },
    gen: {},
    xbot: null,
    lee: null,
    hdr: null,
  };

  const jobs: Job[] = [];
  let totalWeight = 0;
  let reported = 0;
  let closed = false; // set once we have returned; late arrivals are dropped

  const report = (f: number) => {
    if (f <= reported) return;
    reported = f;
    try {
      onProgress(f);
    } catch (e) {
      console.warn("[assets] progress callback failed", e);
    }
  };
  const update = () => {
    if (closed || totalWeight <= 0) return;
    let sum = 0;
    for (const j of jobs) sum += j.weight * (j.done ? 1 : j.frac);
    // Hold back the last sliver until everything is truly finished.
    report(Math.min(0.995, sum / totalWeight));
  };

  const tasks: Promise<void>[] = [];
  /**
   * Run one load. `run` receives a partial-progress callback; `store` is only
   * called if the load succeeds before the timeout.
   */
  function add<T>(name: string, weight: number, run: (progress: (f: number) => void) => Promise<T>, store: (v: T) => void) {
    const job: Job = { name, weight, frac: 0, done: false };
    jobs.push(job);
    totalWeight += weight;
    const progress = (f: number) => {
      if (job.done || !(f > job.frac)) return;
      job.frac = Math.min(0.98, f);
      update();
    };
    let p: Promise<T>;
    try {
      p = run(progress);
    } catch (e) {
      p = Promise.reject(e);
    }
    tasks.push(
      p.then(
        (v) => {
          if (closed) return;
          try {
            store(v);
          } catch (e) {
            console.warn(`[assets] ${name} loaded but could not be prepared, using fallback`, e);
          }
          job.done = true;
          update();
        },
        (e) => {
          if (closed) return; // already reported as timed out
          console.warn(`[assets] ${name} failed to load, using fallback`, e);
          job.done = true;
          update();
        }
      )
    );
  }

  const xhrProgress = (cb: (f: number) => void) => (e: ProgressEvent) => {
    if (e.lengthComputable && e.total > 0) cb(e.loaded / e.total);
  };

  const texLoader = new THREE.TextureLoader();
  const gltfLoader = new GLTFLoader();
  const rgbeLoader = new RGBELoader().setDataType(THREE.HalfFloatType);

  // Big files first so they start downloading straight away.
  add(
    "Xbot.glb",
    9,
    (p) => gltfLoader.loadAsync(assetUrl("Xbot.glb"), xhrProgress(p)),
    (g: GLTF) => (assets.xbot = g)
  );
  add(
    "narrow_moonlit_road_1k.hdr",
    5,
    (p) => rgbeLoader.loadAsync(assetUrl("narrow_moonlit_road_1k.hdr"), xhrProgress(p)),
    (t: THREE.DataTexture) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.needsUpdate = true;
      assets.hdr = t;
    }
  );
  add(
    "LeePerrySmith.glb",
    1.5,
    (p) => gltfLoader.loadAsync(assetUrl("LeePerrySmith.glb"), xhrProgress(p)),
    (g: GLTF) => (assets.lee = g)
  );
  for (const [key, file, srgb] of TEXTURES) {
    add(
      file,
      1,
      () => texLoader.loadAsync(assetUrl(file)),
      (t: THREE.Texture) => {
        t.name = key;
        assets.tex[key] = prepTexture(t, srgb);
      }
    );
  }

  const gen = discoverGen();
  gen.forEach((url, name) => {
    const imgKey = GEN_IMAGES[name];
    const texKey = GEN_TEXTURES[name];
    if (imgKey) {
      add(`gen/${name}`, 2, () => loadImage(url), (img: HTMLImageElement) => (assets.gen[imgKey] = img));
    } else if (texKey) {
      add(
        `gen/${name}`,
        2,
        () => texLoader.loadAsync(url),
        (t: THREE.Texture) => {
          t.name = texKey;
          assets.gen[texKey] = prepTexture(t, true);
        }
      );
    } else if (name === "intro") {
      // Streamed by the <video> element when it plays, so nothing to fetch now.
      assets.gen.introVideo = url;
    }
  });

  report(0.001);

  let timer = 0;
  const timedOut = await Promise.race([
    Promise.all(tasks).then(() => false),
    new Promise<boolean>((resolve) => {
      timer = window.setTimeout(() => resolve(true), TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
  closed = true;

  if (timedOut) {
    const pending = jobs.filter((j) => !j.done).map((j) => j.name);
    console.warn(`[assets] gave up after ${TIMEOUT_MS / 1000} s waiting for: ${pending.join(", ")}`);
  }
  report(1);
  return assets;
}
