import * as THREE from "three";
import { QUALITY, settings, type Quality } from "../core/settings";
import { clamp, lerp, mulberry32 } from "../core/util";
import { canvas } from "../world/canvasTex";
import { COLS, FACADE_H, GRID, ROOMS, ROWS, T } from "../world/map";
import type { Assets, LightFixture, RenderSystem } from "../types";
import { createPost } from "./post";

/**
 * Owns the WebGL renderer, the world and viewmodel scenes, the camera with
 * its torch, sky, moon, fog, the fixed point-light pool and the post chain.
 *
 * Light counts never change after start (except in applyQuality), so the
 * materials compiled by compile() stay valid for the whole game.
 *
 * Shared with weather.ts through scene.userData:
 *   torch: THREE.SpotLight, lightPool: THREE.PointLight[], flash: number (0..1)
 */

// ----------------------------------------------------------------- tuning

/** Direction towards the moon: low over the school's north-west roofline as seen from the car park. */
const MOON_DIR = new THREE.Vector3(-0.38, 0.5, -0.78).normalize();
const MOON_DIST = 255;

const LOOK = {
  fogOut: new THREE.Color(0x1b222c),
  fogIn: new THREE.Color(0x050608),
  densityOut: 0.018,
  densityIn: 0.045,
  envOut: 0.35,
  envIn: 0.12,
  moonOut: 0.85,
  moonIn: 0.02,
  hemiOut: 0.16,
  hemiIn: 0.1,
  ambient: 0.025,
  exposureOut: 1.0,
  exposureIn: 1.2,
  /** backgroundIntensity for the HDR sky (it is a bright moonlit capture) and the painted fallback. */
  skyHdr: 0.24,
  skyPainted: 1.0,
};

/** Area the static moon shadow covers: car park and front facade. */
const SHADOW_BOX = { x0: 0, x1: 114, z0: 45, z1: 90, y0: -0.5, y1: FACADE_H + 2.5 };

const LIGHT_FADE_IN = 0.15; // s
const LIGHT_FADE_OUT = 0.08; // s, when a slot hands over to a closer fixture
const LIGHT_OFF_GRACE = 0.6; // s a dark fixture keeps its slot, so flicker stays crisp
const MAX_POOL = Math.max(...Object.values(QUALITY).map((q) => q.lightPool));

// --------------------------------------------------------------- sky prep

/**
 * Copy of the HDR with the captured moon painted out (our own moon and
 * directional light replace it, so the sky, the reflections and the shadows
 * agree), and the very blue capture pulled towards a stormy grey.
 */
function prepareHdr(src: THREE.DataTexture): THREE.DataTexture {
  const img = src.image as unknown as { data: Uint16Array | Float32Array; width: number; height: number };
  const w = img.width;
  const h = img.height;
  const half = img.data instanceof Uint16Array;
  const data = img.data.slice() as Uint16Array | Float32Array;
  const rd = half ? (i: number) => THREE.DataUtils.fromHalfFloat(data[i]) : (i: number) => data[i];
  const wr = half
    ? (i: number, v: number) => (data[i] = THREE.DataUtils.toHalfFloat(v))
    : (i: number, v: number) => (data[i] = v);

  // Unpack once to floats.
  const n = w * h;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = rd(i * 4);
    rgb[i * 3 + 1] = rd(i * 4 + 1);
    rgb[i * 3 + 2] = rd(i * 4 + 2);
  }

  // Brightest pixel. Rows run from the top of the sky, so the moon is in the upper half.
  let best = -1;
  let bestL = 0;
  for (let i = 0; i < (n >> 1); i++) {
    const l = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
    if (l > bestL) {
      bestL = l;
      best = i;
    }
  }

  const lat = (row: number) => (0.5 - (row + 0.5) / h) * Math.PI;
  const lon = (col: number) => ((col + 0.5) / w) * Math.PI * 2;

  if (best >= 0 && bestL > 30) {
    const mr = Math.floor(best / w);
    const mc = best % w;
    const mla = lat(mr);
    const mlo = lon(mc);
    const mx = Math.cos(mla) * Math.cos(mlo);
    const my = Math.sin(mla);
    const mz = Math.cos(mla) * Math.sin(mlo);
    const R0 = THREE.MathUtils.degToRad(4); // fully replaced inside this
    const R1 = THREE.MathUtils.degToRad(30); // untouched outside this
    const cos1 = Math.cos(R1);
    const cosOf = (row: number, col: number) => {
      const la = lat(row);
      const lo = lon(col);
      return Math.cos(la) * Math.cos(lo) * mx + Math.sin(la) * my + Math.cos(la) * Math.sin(lo) * mz;
    };
    // Sky colour per row from pixels well away from the moon.
    const rowSky = new Float32Array(h * 3);
    const rowOk = new Uint8Array(h);
    const cosFar = Math.cos(THREE.MathUtils.degToRad(35));
    for (let r = 0; r < h; r++) {
      let sr = 0,
        sg = 0,
        sb = 0,
        cnt = 0;
      for (let c = 0; c < w; c++) {
        if (cosOf(r, c) > cosFar) continue;
        const i = (r * w + c) * 3;
        sr += rgb[i];
        sg += rgb[i + 1];
        sb += rgb[i + 2];
        cnt++;
      }
      if (cnt > 0) {
        rowSky[r * 3] = sr / cnt;
        rowSky[r * 3 + 1] = sg / cnt;
        rowSky[r * 3 + 2] = sb / cnt;
        rowOk[r] = 1;
      }
    }
    // Rows wholly inside the moon's neighbourhood (near the zenith) borrow the nearest valid row.
    for (let r = 0; r < h; r++) {
      if (rowOk[r]) continue;
      for (let d = 1; d < h; d++) {
        const a = r + d < h && rowOk[r + d] ? r + d : r - d >= 0 && rowOk[r - d] ? r - d : -1;
        if (a >= 0) {
          rowSky[r * 3] = rowSky[a * 3];
          rowSky[r * 3 + 1] = rowSky[a * 3 + 1];
          rowSky[r * 3 + 2] = rowSky[a * 3 + 2];
          break;
        }
      }
    }
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const cs = cosOf(r, c);
        if (cs < cos1) continue;
        const ang = Math.acos(clamp(cs, -1, 1));
        const t = clamp((ang - R0) / (R1 - R0), 0, 1);
        const keep = t * t * (3 - 2 * t);
        const i = (r * w + c) * 3;
        for (let k = 0; k < 3; k++) {
          const sky = rowSky[r * 3 + k];
          // Only remove excess light: never darken below the surrounding sky.
          rgb[i + k] = sky + Math.max(0, rgb[i + k] - sky) * keep;
        }
      }
    }
  }

  // Stormy grade: pull the saturated blue towards grey.
  const desat = 0.45;
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3],
      g = rgb[i * 3 + 1],
      b = rgb[i * 3 + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    wr(i * 4, r + (l - r) * desat);
    wr(i * 4 + 1, g + (l - g) * desat);
    wr(i * 4 + 2, b + (l - b) * desat);
  }

  const out = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, src.type);
  out.name = "skyHdr";
  out.mapping = THREE.EquirectangularReflectionMapping;
  out.colorSpace = src.colorSpace;
  out.flipY = src.flipY;
  out.minFilter = src.minFilter;
  out.magFilter = src.magFilter;
  out.generateMipmaps = src.generateMipmaps;
  out.needsUpdate = true;
  return out;
}

/** Overcast night sky painted on a canvas, used when the HDR is missing. */
function paintedSky(): THREE.Texture {
  const r = mulberry32(1987);
  const cv = canvas(1024, 512, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#0b1018");
    sky.addColorStop(0.3, "#121925");
    sky.addColorStop(0.47, "#1e2632");
    sky.addColorStop(0.5, "#161b22");
    sky.addColorStop(0.56, "#0a0b0d");
    sky.addColorStop(1, "#060607");
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    // Soft cloud banks, drawn three times across the seam so it wraps.
    for (let i = 0; i < 70; i++) {
      const x = r() * w;
      const y = h * (0.12 + r() * 0.34);
      const rx = 40 + r() * 140;
      const ry = rx * (0.18 + r() * 0.22);
      const a = 0.025 + r() * 0.05;
      for (const ox of [-w, 0, w]) {
        g.save();
        g.translate(x + ox, y);
        g.scale(1, ry / rx);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
        gr.addColorStop(0, `rgba(120,132,150,${a})`);
        gr.addColorStop(1, "rgba(120,132,150,0)");
        g.fillStyle = gr;
        g.fillRect(-rx, -rx, rx * 2, rx * 2);
        g.restore();
      }
    }
    // Faint sodium glow of a distant town along the horizon.
    const glow = g.createLinearGradient(0, h * 0.42, 0, h * 0.5);
    glow.addColorStop(0, "rgba(70,55,40,0)");
    glow.addColorStop(1, "rgba(70,55,40,0.18)");
    g.fillStyle = glow;
    g.fillRect(0, h * 0.42, w, h * 0.08);
  });
  const t = new THREE.CanvasTexture(cv);
  t.name = "skyPainted";
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

function moonTexture(): THREE.Texture {
  const r = mulberry32(1147);
  const cv = canvas(256, 256, (g, w) => {
    const c = w / 2;
    // Halo, reaching zero at the sprite edge.
    const halo = g.createRadialGradient(c, c, 0, c, c, c);
    halo.addColorStop(0, "rgba(190,205,255,0.55)");
    halo.addColorStop(0.16, "rgba(150,170,230,0.32)");
    halo.addColorStop(0.35, "rgba(100,120,180,0.1)");
    halo.addColorStop(0.7, "rgba(70,85,130,0.025)");
    halo.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = halo;
    g.fillRect(0, 0, w, w);
    // Disc with limb darkening.
    const rad = w * 0.085;
    const disc = g.createRadialGradient(c - rad * 0.2, c - rad * 0.2, 0, c, c, rad);
    disc.addColorStop(0, "#f4f6ff");
    disc.addColorStop(0.75, "#dfe5f6");
    disc.addColorStop(1, "#aeb8d4");
    g.fillStyle = disc;
    g.beginPath();
    g.arc(c, c, rad, 0, Math.PI * 2);
    g.fill();
    // Maria.
    g.save();
    g.beginPath();
    g.arc(c, c, rad, 0, Math.PI * 2);
    g.clip();
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * rad * 0.7;
      const s = rad * (0.15 + r() * 0.3);
      const gr = g.createRadialGradient(c + Math.cos(a) * d, c + Math.sin(a) * d, 0, c + Math.cos(a) * d, c + Math.sin(a) * d, s);
      gr.addColorStop(0, "rgba(120,128,150,0.45)");
      gr.addColorStop(1, "rgba(120,128,150,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, w, w);
    }
    g.restore();
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Torch cookie: hot centre, reflector ring, soft spill. Values are linear. */
function torchCookie(): THREE.Texture {
  const cv = canvas(256, 256, (g, w) => {
    const c = w / 2;
    g.fillStyle = "#000";
    g.fillRect(0, 0, w, w);
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, "rgb(255,255,255)");
    gr.addColorStop(0.18, "rgb(240,240,240)");
    gr.addColorStop(0.3, "rgb(170,170,170)");
    gr.addColorStop(0.4, "rgb(200,200,200)"); // reflector ring
    gr.addColorStop(0.48, "rgb(130,130,130)");
    gr.addColorStop(0.75, "rgb(70,70,70)");
    gr.addColorStop(0.97, "rgb(30,30,30)");
    gr.addColorStop(1, "rgb(0,0,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, w, w);
    // Smudges on the lens.
    const r = mulberry32(42);
    for (let i = 0; i < 14; i++) {
      const x = c + (r() - 0.5) * w * 0.6;
      const y = c + (r() - 0.5) * w * 0.6;
      const s = 8 + r() * 26;
      const sm = g.createRadialGradient(x, y, 0, x, y, s);
      sm.addColorStop(0, `rgba(0,0,0,${0.05 + r() * 0.07})`);
      sm.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sm;
      g.fillRect(x - s, y - s, s * 2, s * 2);
    }
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Environment for reflections when there is no HDR: the painted sky, PMREM filtered. */
function buildEnvironment(renderer: THREE.WebGLRenderer, sky: THREE.Texture): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromEquirectangular(sky);
  pmrem.dispose();
  return rt.texture;
}

// ------------------------------------------------------------- GPU timer

interface TimerQueryExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/** GPU frame time from EXT_disjoint_timer_query_webgl2 where available (Chromium). */
function createGpuTimer(gl: WebGL2RenderingContext) {
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerQueryExt | null;
  if (!ext) return null;
  const free: WebGLQuery[] = [];
  const pending: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;
  const state = { ms: -1 };
  return {
    state,
    begin() {
      if (active || pending.length >= 4) return;
      const q = free.pop() || gl.createQuery();
      if (!q) return;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      active = q;
    },
    end() {
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    poll() {
      while (pending.length) {
        const q = pending[0];
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
        pending.shift();
        free.push(q);
        if (!disjoint && ns > 0) {
          const ms = ns / 1e6;
          state.ms = state.ms < 0 ? ms : lerp(state.ms, ms, 0.1);
        }
      }
    },
  };
}

// ------------------------------------------------------------- light pool

interface Slot {
  light: THREE.PointLight;
  fix: LightFixture | null;
  next: LightFixture | null;
  fade: number;
  off: number; // seconds the current fixture has been dark
  keep: boolean;
}

// --------------------------------------------------------------- factory

export function createRenderSystem(container: HTMLElement, assets: Assets): RenderSystem {
  let quality: Quality = settings.quality;

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  let prCap = Math.min(window.devicePixelRatio || 1, QUALITY[quality].maxPixelRatio);
  let pr = prCap;
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  const cv = renderer.domElement;
  cv.style.position = "fixed";
  cv.style.left = "0";
  cv.style.top = "0";
  cv.style.display = "block";
  cv.style.outline = "none";
  cv.style.touchAction = "none";
  container.appendChild(cv);

  let moonShadowFrames = 3;
  cv.addEventListener(
    "webglcontextlost",
    (e) => {
      e.preventDefault(); // allow the browser to restore it
      console.error("[render] WebGL context lost");
    },
    false
  );
  cv.addEventListener("webglcontextrestored", () => {
    console.warn("[render] WebGL context restored");
    moonShadowFrames = 3;
  });

  // ---------------------------------------------------------------- scene
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, LOOK.densityOut);
  const fog = scene.fog as THREE.FogExp2;
  fog.color.copy(LOOK.fogOut);

  let hdr: THREE.DataTexture | null = null;
  if (assets.hdr) {
    try {
      hdr = prepareHdr(assets.hdr);
    } catch (e) {
      console.warn("[render] could not prepare the HDR sky, using it as loaded", e);
      hdr = assets.hdr;
    }
  }
  const sky = hdr ?? paintedSky();
  const skyBase = hdr ? LOOK.skyHdr : LOOK.skyPainted;
  scene.background = sky; // the background never takes fog
  scene.backgroundIntensity = skyBase;
  const envMap = buildEnvironment(renderer, sky);
  scene.environment = envMap;
  scene.environmentIntensity = LOOK.envOut;

  const vmScene = new THREE.Scene();
  vmScene.environment = envMap;
  vmScene.environmentIntensity = LOOK.envOut;

  // Moon sprite: additive so its halo melts into the sky; HDR bright so the disc blooms.
  const moonSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: moonTexture(),
      color: new THREE.Color(2.4, 2.6, 3.0),
      fog: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
    })
  );
  moonSprite.name = "moon";
  moonSprite.scale.setScalar(MOON_DIST * 0.62);
  moonSprite.renderOrder = -10;
  scene.add(moonSprite);

  // --------------------------------------------------------------- lights
  const moon = new THREE.DirectionalLight(0xa9bcff, LOOK.moonOut);
  moon.name = "moonLight";
  moon.castShadow = true;
  const shadowCentre = new THREE.Vector3((SHADOW_BOX.x0 + SHADOW_BOX.x1) / 2, 0, (SHADOW_BOX.z0 + SHADOW_BOX.z1) / 2);
  moon.target.position.copy(shadowCentre);
  moon.position.copy(shadowCentre).addScaledVector(MOON_DIR, 170);
  scene.add(moon, moon.target);
  {
    // Fit the orthographic shadow frustum to the box as seen from the moon.
    const probe = new THREE.OrthographicCamera();
    probe.position.copy(moon.position);
    probe.lookAt(shadowCentre);
    probe.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity,
      zMin = Infinity;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? SHADOW_BOX.x1 : SHADOW_BOX.x0, i & 2 ? SHADOW_BOX.y1 : SHADOW_BOX.y0, i & 4 ? SHADOW_BOX.z1 : SHADOW_BOX.z0);
      v.applyMatrix4(probe.matrixWorldInverse);
      x0 = Math.min(x0, v.x);
      x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y);
      y1 = Math.max(y1, v.y);
      zMin = Math.min(zMin, v.z);
    }
    const sc = moon.shadow.camera;
    sc.left = x0 - 1;
    sc.right = x1 + 1;
    sc.bottom = y0 - 1;
    sc.top = y1 + 1;
    // Near stays close to the light so casters outside the box (the school
    // roof) still throw their shadows into it.
    sc.near = 1;
    sc.far = -zMin + 25;
    sc.updateProjectionMatrix();
  }
  moon.shadow.bias = -0.00025;
  moon.shadow.normalBias = 0.045;
  moon.shadow.autoUpdate = false;
  moon.shadow.needsUpdate = true;

  const hemi = new THREE.HemisphereLight(0x3a4a66, 0x0c0e12, LOOK.hemiOut);
  hemi.name = "skyFill";
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0x4a5468, LOOK.ambient);
  ambient.name = "ambient";
  scene.add(ambient);

  // --------------------------------------------------------------- camera
  const camera = new THREE.PerspectiveCamera(settings.fov || 75, window.innerWidth / window.innerHeight, 0.05, 300);
  camera.rotation.order = "YXZ";
  scene.add(camera);

  const torch = new THREE.SpotLight(0xfff0dc, 45, 30, 0.55, 0.65, 2);
  torch.name = "torch";
  torch.position.set(0.18, -0.18, 0.05);
  // Aimed at the view axis 8 m out, so the hotspot sits on the crosshair at room distances
  // (a target 1 m out would swing the beam up and left of centre beyond arm's length).
  torch.target.position.set(0, 0, -8);
  torch.map = torchCookie();
  torch.castShadow = true;
  torch.shadow.camera.near = 0.1;
  torch.shadow.camera.far = 30;
  torch.shadow.bias = -0.00006;
  torch.shadow.normalBias = 0.02;
  camera.add(torch, torch.target);

  // ----------------------------------------------------------- light pool
  const slots: Slot[] = [];
  const poolLights: THREE.PointLight[] = [];
  function buildPool(n: number) {
    for (const s of slots) {
      scene.remove(s.light);
      s.light.dispose();
    }
    slots.length = 0;
    poolLights.length = 0;
    for (let i = 0; i < n; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 10, 2);
      light.name = "poolLight" + i;
      light.castShadow = false;
      light.position.set(0, -50, 0);
      scene.add(light);
      slots.push({ light, fix: null, next: null, fade: 0, off: 0, keep: false });
      poolLights.push(light);
    }
  }
  buildPool(QUALITY[quality].lightPool);

  scene.userData.torch = torch;
  scene.userData.lightPool = poolLights;
  scene.userData.flash = 0;

  const want: (LightFixture | null)[] = new Array(MAX_POOL).fill(null);
  const wantD = new Float64Array(MAX_POOL);
  let lightClock = performance.now();

  function slotOf(f: LightFixture): Slot | null {
    for (let i = 0; i < slots.length; i++) if (slots[i].fix === f) return slots[i];
    return null;
  }
  /** Room character at a point (map.ts's charAt allocates, this does not). */
  function roomAt(x: number, z: number) {
    return GRID[clamp(Math.floor(z / T), 0, ROWS - 1)][clamp(Math.floor(x / T), 0, COLS - 1)];
  }
  function wanted(f: LightFixture | null, count: number) {
    if (!f) return false;
    for (let j = 0; j < count; j++) if (want[j] === f) return true;
    return false;
  }

  function updateLights(fixtures: LightFixture[], from: THREE.Vector3) {
    const now = performance.now();
    const dt = clamp((now - lightClock) / 1000, 0, 0.1);
    lightClock = now;
    const n = slots.length;
    if (n === 0) return;

    for (let i = 0; i < n; i++) {
      const s = slots[i];
      if (s.fix) s.off = s.fix.level > 0.02 ? 0 : s.off + dt;
    }

    // n nearest lit fixtures. Pool lights have no shadows and shine through
    // walls, so fixtures in the player's own room count as nearer and ones on
    // the other side of the outside wall as further. The ones already shown
    // get a 10% head start so two lights at similar distances do not keep
    // trading places.
    const here = roomAt(from.x, from.z);
    const hereIn = ROOMS[here] ? ROOMS[here].indoor : false;
    let count = 0;
    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i];
      if (f.intensity <= 0) continue;
      const held = slotOf(f);
      if (f.level <= 0.02 && !(held && held.off < LIGHT_OFF_GRACE)) continue;
      const dx = f.x - from.x,
        dy = f.y - from.y,
        dz = f.z - from.z;
      let d = dx * dx + dy * dy + dz * dz;
      const room = f.room || roomAt(f.x, f.z);
      if (room === here) d *= 0.55;
      else if ((ROOMS[room] ? ROOMS[room].indoor : true) !== hereIn) d *= 3;
      if (held) d *= 0.8;
      if (count === n && d >= wantD[n - 1]) continue;
      let j = count < n ? count++ : n - 1;
      while (j > 0 && wantD[j - 1] > d) {
        want[j] = want[j - 1];
        wantD[j] = wantD[j - 1];
        j--;
      }
      want[j] = f;
      wantD[j] = d;
    }

    // Match wanted fixtures to slots. A slot showing an unwanted fixture fades
    // it out and then hands over to its `next`; an empty slot fades straight in.
    for (let i = 0; i < n; i++) {
      const s = slots[i];
      const fixWanted = wanted(s.fix, count);
      // Cancel a hand-over if its fixture fell out of the set or the old one came back.
      if (s.next && (fixWanted || !wanted(s.next, count))) s.next = null;
      s.keep = fixWanted;
    }
    for (let j = 0; j < count; j++) {
      const f = want[j];
      let taken = false;
      for (let i = 0; i < n && !taken; i++) taken = slots[i].fix === f || slots[i].next === f;
      if (taken) continue;
      let target: Slot | null = null;
      for (let i = 0; i < n && !target; i++) if (!slots[i].fix && !slots[i].next) target = slots[i];
      for (let i = 0; i < n && !target; i++) if (!slots[i].keep && !slots[i].next) target = slots[i];
      if (!target) break;
      if (target.fix) target.next = f;
      else {
        target.fix = f;
        target.fade = 0;
        target.off = 0;
        target.keep = true;
      }
    }

    // Fade and apply.
    for (let i = 0; i < n; i++) {
      const s = slots[i];
      if (s.fix && s.keep && !s.next) s.fade = Math.min(1, s.fade + dt / LIGHT_FADE_IN);
      else if (s.fix) {
        s.fade = Math.max(0, s.fade - dt / LIGHT_FADE_OUT);
        if (s.fade <= 0) {
          s.fix = s.next;
          s.next = null;
          s.off = 0;
        }
      }
      const L = s.light;
      const f = s.fix;
      if (f) {
        const e = s.fade * s.fade * (3 - 2 * s.fade);
        L.position.set(f.x, f.y, f.z);
        L.color.copy(f.color);
        L.distance = f.range;
        L.intensity = f.intensity * clamp(f.level, 0, 4) * e;
      } else {
        L.intensity = 0;
      }
    }
    for (let j = 0; j < count; j++) want[j] = null;
  }

  // ----------------------------------------------------------------- post
  const post = createPost(renderer, scene, vmScene, camera, quality);

  // ------------------------------------------------- atmosphere & lightning
  let indoor = 0;
  let flash = 0;
  let boltT = 99;
  const boltAt = new Float32Array(3);
  const boltAmp = new Float32Array(3);

  function lightning() {
    boltT = 0;
    const gentle = settings.gentle ? 0.55 : 1;
    boltAt[0] = 0;
    boltAmp[0] = (0.75 + Math.random() * 0.25) * gentle;
    boltAt[1] = 0.08 + Math.random() * 0.06;
    boltAmp[1] = (0.45 + Math.random() * 0.45) * gentle;
    const third = Math.random() < 0.6;
    boltAt[2] = 0.22 + Math.random() * 0.14;
    boltAmp[2] = third ? (0.3 + Math.random() * 0.5) * gentle : 0;
  }

  function stepLightning(dt: number) {
    if (boltT > 1) {
      flash = 0;
      return;
    }
    boltT += dt;
    let f = 0;
    for (let i = 0; i < 3; i++) {
      const t = boltT - boltAt[i];
      if (t < 0 || boltAmp[i] <= 0) continue;
      // Near-instant rise, fast decay with a little flutter.
      const rise = Math.min(1, t / 0.012);
      const v = boltAmp[i] * rise * Math.exp(-t / 0.055) * (0.85 + 0.15 * Math.sin(t * 160));
      if (v > f) f = v;
    }
    flash = f;
  }

  const fogCol = new THREE.Color();
  function applyAtmosphere() {
    const k = indoor;
    // Indoors the flash only reaches in through windows.
    const fl = flash * (1 - k * 0.8);
    fogCol.copy(LOOK.fogOut).lerp(LOOK.fogIn, k);
    fog.color.setRGB(fogCol.r + fl * 0.045, fogCol.g + fl * 0.05, fogCol.b + fl * 0.065);
    fog.density = lerp(LOOK.densityOut, LOOK.densityIn, k);
    const env = lerp(LOOK.envOut, LOOK.envIn, k) + fl * 0.9;
    scene.environmentIntensity = env;
    vmScene.environmentIntensity = env;
    // Unshadowed indoors (the shadow box ends at the facade), so keep it tiny there.
    moon.intensity = lerp(LOOK.moonOut, LOOK.moonIn, k) + fl * 9 * (1 - k * 0.9);
    hemi.intensity = lerp(LOOK.hemiOut, LOOK.hemiIn, k) + fl * 2.2;
    scene.backgroundIntensity = skyBase * (1 + fl * 5);
    post.setExposure(lerp(LOOK.exposureOut, LOOK.exposureIn, k) * (1 + fl * 0.12));
    scene.userData.flash = fl;
  }
  applyAtmosphere();

  // ------------------------------------------------------ resolution & size
  const stats = { fps: 60, scale: 1 };
  let width = window.innerWidth;
  let height = window.innerHeight;
  let frameSum = 0;
  let frameN = 0;
  let windowT = 0;
  let raiseBlock = 0;
  let grace = 1.5; // ignore timings right after start, resize or quality changes
  const gpu = createGpuTimer(renderer.getContext() as WebGL2RenderingContext);

  function setPixelRatio(v: number) {
    const next = Math.round(clamp(v, prCap * 0.55, prCap) * 100) / 100;
    if (Math.abs(next - pr) < 0.005) return;
    pr = next;
    renderer.setPixelRatio(pr);
    post.setSize(width, height);
    stats.scale = pr / prCap;
  }

  function dynamicResolution(dt: number) {
    if (grace > 0) {
      grace -= dt;
      return;
    }
    if (dt <= 0 || dt > 0.25) return; // a hitch or a background tab, not a trend
    frameSum += dt;
    frameN++;
    windowT += dt;
    raiseBlock -= dt;
    if (windowT < 1) return;
    const avg = (frameSum / frameN) * 1000;
    frameSum = 0;
    frameN = 0;
    windowT = 0;
    stats.fps = Math.round(1000 / avg);
    const gpuMs = gpu ? gpu.state.ms : -1;
    if (avg > 18) {
      // If the GPU is clearly idle the slowdown is elsewhere; a blurrier picture would not help.
      if (gpuMs < 0 || gpuMs > 8) {
        setPixelRatio(pr * 0.9);
        raiseBlock = 3;
      }
    } else if (raiseBlock <= 0 && pr < prCap) {
      // At a locked 60 Hz the frame time never drops under 12 ms, so use the GPU time when known.
      if (avg < 12 || (gpuMs >= 0 && gpuMs < 9.5 && avg < 17.6)) setPixelRatio(pr * 1.05);
    }
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    prCap = Math.min(window.devicePixelRatio || 1, QUALITY[quality].maxPixelRatio);
    pr = clamp(pr, prCap * 0.55, prCap);
    renderer.setPixelRatio(pr);
    renderer.setSize(width, height);
    post.setSize(width, height);
    stats.scale = pr / prCap;
    grace = Math.max(grace, 0.75);
  }
  window.addEventListener("resize", resize);

  // ---------------------------------------------------------------- quality
  function resizeShadow(light: THREE.DirectionalLight | THREE.SpotLight, size: number) {
    if (light.shadow.mapSize.x === size) return;
    light.shadow.mapSize.set(size, size);
    if (light.shadow.map) {
      light.shadow.map.dispose();
      (light.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
  }

  function applyQuality(q: Quality) {
    quality = q;
    const Q = QUALITY[q];
    resizeShadow(torch, Q.shadowSize);
    resizeShadow(moon, clamp(Q.shadowSize * 2, 1024, 2048));
    moonShadowFrames = 3;
    post.setQuality(q);
    if (slots.length !== Q.lightPool) buildPool(Q.lightPool);
    prCap = Math.min(window.devicePixelRatio || 1, Q.maxPixelRatio);
    pr = prCap;
    renderer.setPixelRatio(pr);
    post.setSize(width, height);
    stats.scale = 1;
    raiseBlock = 0;
    frameSum = frameN = windowT = 0;
    grace = 2;
  }
  // Shadow sizes for the starting quality (the pool and post already match).
  resizeShadow(torch, QUALITY[quality].shadowSize);
  resizeShadow(moon, clamp(QUALITY[quality].shadowSize * 2, 1024, 2048));

  // ----------------------------------------------------------------- render
  let lastTime = 0;
  let childCount = -1;

  function render(dt: number, time: number) {
    lastTime = time;
    stepLightning(dt);
    applyAtmosphere();
    moonSprite.position.copy(camera.position).addScaledVector(MOON_DIR, MOON_DIST);

    // The moon shadow is static: redraw it only when the scene's top level changes.
    if (scene.children.length !== childCount) {
      childCount = scene.children.length;
      moonShadowFrames = Math.max(moonShadowFrames, 2);
    }
    if (moonShadowFrames > 0) {
      moon.shadow.needsUpdate = true;
      moonShadowFrames--;
    }

    if (gpu) gpu.begin();
    post.render(dt, time);
    if (gpu) {
      gpu.end();
      gpu.poll();
    }
    dynamicResolution(dt);
  }

  async function compile() {
    try {
      await renderer.compileAsync(scene, camera);
      await renderer.compileAsync(vmScene, camera);
    } catch (e) {
      console.warn("[render] async shader compile failed, compiling synchronously", e);
      renderer.compile(scene, camera);
      renderer.compile(vmScene, camera);
    }
    moonShadowFrames = 3;
    // One real frame builds the post materials and the shadow maps.
    render(1 / 60, lastTime);
    grace = 2;
    frameSum = frameN = windowT = 0;
  }

  return {
    renderer,
    scene,
    camera,
    vmScene,
    torch,
    updateLights,
    setIndoor(k: number) {
      indoor = clamp(k, 0, 1);
    },
    setFx(fx) {
      post.setFx(fx);
    },
    lightning,
    applyQuality,
    setFov(deg: number) {
      camera.fov = deg;
      camera.updateProjectionMatrix();
    },
    resize,
    render,
    compile,
    stats,
  };
}
