import "./style.css";
import * as THREE from "three";
import type { Assets } from "./types";
import { loadAssets } from "./world/assets";
import { buildLevel } from "./world/level";
import { createRenderSystem } from "./render/renderer";
import { createWeather } from "./render/weather";
import { GhostSystem } from "./game/ghosts";
import { Player } from "./game/player";
import { createViewmodel } from "./game/viewmodel";
import { Game } from "./game/game";
import { Hud } from "./ui/hud";
import { Menus } from "./ui/menus";
import { Minimap } from "./ui/minimap";
import { Input } from "./core/input";
import { AudioEngine } from "./core/audio";
import { settings, type Quality } from "./core/settings";
import { $ } from "./core/util";

/**
 * Boot: load, build, compile every shader behind the loading screen, then
 * hand over to the title screen and the game loop.
 */

let menus: Menus | null = null;
let failed = false;

function describe(e: unknown) {
  if (e instanceof Error) return `${e.message}\n\n${(e.stack ?? "").split("\n").slice(0, 6).join("\n")}`;
  return String(e);
}

function fatal(e: unknown) {
  console.error(e);
  if (failed) return;
  failed = true;
  const text = describe(e);
  if (menus) menus.showError(text);
  else {
    const el = document.getElementById("errorText");
    if (el) el.textContent = text;
    document.getElementById("error")?.classList.add("show");
    document.getElementById("loading")?.classList.remove("show");
  }
}

addEventListener("error", (e) => fatal(e.error ?? e.message));
addEventListener("unhandledrejection", (e) => fatal(e.reason));

/** Let the browser paint the loading bar before the next long synchronous step. */
function nextPaint() {
  return new Promise<void>((res) => {
    let done = false;
    const fin = () => {
      if (done) return;
      done = true;
      res();
    };
    requestAnimationFrame(() => setTimeout(fin, 0));
    setTimeout(fin, 150);
  });
}

const TEX_KEYS = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "bumpMap", "alphaMap", "lightMap", "displacementMap", "specularMap"] as const;

/** Upload every texture in use now, so the first frames of play never stall on a texture upload. */
function uploadTextures(renderer: THREE.WebGLRenderer, scenes: THREE.Scene[], assets: Assets) {
  const seen = new Set<THREE.Texture>();
  const up = (t: unknown) => {
    const tex = t as THREE.Texture | null | undefined;
    if (!tex || !tex.isTexture || seen.has(tex)) return;
    seen.add(tex);
    if ((tex as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture || !tex.image) return;
    try {
      renderer.initTexture(tex);
    } catch (e) {
      console.warn("[boot] texture upload failed", e);
    }
  };
  for (const t of Object.values(assets.tex)) up(t);
  const g = assets.gen;
  for (const t of [g.posterMissing, g.posterProm, g.wall, g.floor]) up(t);
  for (const scene of scenes) {
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        const rec = mat as unknown as Record<string, unknown>;
        for (const k of TEX_KEYS) up(rec[k]);
        const uniforms = (mat as THREE.ShaderMaterial).uniforms;
        if (uniforms) for (const u of Object.values(uniforms)) up(u?.value);
      }
    });
  }
}

async function boot() {
  menus = new Menus();
  const m = menus;
  m.setLoading(0, "Waking the dead");

  const assets = await loadAssets((f) => m.setLoading(f * 0.68, "Loading textures and spirits"));

  m.setLoading(0.7, "Building the school");
  await nextPaint();
  const rs = createRenderSystem($("game"), assets);
  rs.setFov(settings.fov);
  const level = buildLevel(rs.scene, assets, settings.quality);

  m.setLoading(0.8, "Raising the spirits");
  await nextPaint();
  const weather = createWeather(rs.scene, settings.quality);
  const audio = new AudioEngine();
  const ghosts = new GhostSystem({ scene: rs.scene, assets, audio });
  const player = new Player({ camera: rs.camera, torch: rs.torch, audio, level });
  const vm = createViewmodel(rs.vmScene, rs.camera);
  const hud = new Hud();
  const minimap = new Minimap();
  const input = new Input(rs.renderer.domElement);
  const game = new Game({ assets, rs, level, weather, ghosts, player, vm, hud, menus: m, minimap, input, audio });

  m.setLoading(0.88, "Preparing graphics");
  await nextPaint();
  // Every ghost, decal, pickup and the viewmodel are in the scenes now, so one compile covers the game.
  ghosts.warmup(rs.scene);
  uploadTextures(rs.renderer, [rs.scene, rs.vmScene], assets);
  await rs.compile();
  m.setLoading(1, "Ready");
  await nextPaint();

  // ---------------------------------------------------------- settings
  m.onUiSound = (k) => (k === "click" ? audio.click() : audio.paper());
  let quality: Quality = settings.quality;
  m.onSettingsChanged = () => {
    rs.setFov(settings.fov);
    audio.setVolume(settings.volume);
    if (settings.quality !== quality) {
      quality = settings.quality;
      rs.applyQuality(quality);
      weather.setQuality(quality);
    }
  };
  if (location.search.includes("debug")) game.installDebug();

  // -------------------------------------------------------------- loop
  vm.setVisible(false);
  hud.show(false);
  let mode: "title" | "play" = "title";
  let covered = false; // title art or the intro video hides the 3D view
  let last = performance.now();
  let time = 0;
  let titleAcc = 0;
  const loop = (now: number) => {
    if (failed) return;
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    time += dt;
    try {
      if (mode === "play") game.frame(dt, time);
      else {
        // Behind opaque title art the scene only needs to tick over, so draw it at 30 Hz.
        titleAcc += dt;
        if (covered && titleAcc < 1 / 30) return;
        game.titleFrame(Math.min(titleAcc, 0.1), time);
        titleAcc = 0;
      }
    } catch (e) {
      fatal(e);
    }
  };
  requestAnimationFrame(loop);

  const title = async () => {
    mode = "title";
    covered = !!assets.gen.title;
    await m.title(assets.gen.title ?? null, game.bestLine());
    // Still inside the Start click: unlock audio and input.
    audio.init();
    audio.setVolume(settings.volume);
    input.enabled = true;
    if (assets.gen.introVideo) {
      covered = true;
      await m.playIntro(assets.gen.introVideo);
    }
    covered = false;
    mode = "play";
    game.start();
  };
  game.onQuit = () => {
    title().catch(fatal);
  };
  await title();
}

boot().catch(fatal);
