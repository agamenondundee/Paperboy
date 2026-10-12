import * as THREE from "three";
import { toTexture, speck, stain, crack, blob, drips, type Rng, type Paint } from "./canvasTex";
import { mulberry32 } from "../core/util";

/**
 * Procedural surface textures for the school, painted once at load time with
 * seeded RNGs so the building looks the same on every visit. Colour maps are
 * mostly near-white so per-room vertex colours can tint them.
 */

/**
 * CPU-backed canvas. These textures are read back for normal maps and grain,
 * and a GPU-backed canvas would stall on every readback.
 */
export function canvas(w: number, h: number, paint: Paint): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  paint(cv.getContext("2d", { willReadFrequently: true })!, w, h);
  return cv;
}

export interface Surf {
  map: THREE.Texture;
  normal?: THREE.Texture;
  rough?: THREE.Texture;
}

/** Tileable value noise: a small random grid scaled up with smoothing. */
export function noise(g: CanvasRenderingContext2D, w: number, h: number, cells: number, r: Rng, alpha: number, op: GlobalCompositeOperation = "multiply", lo = 0, hi = 255) {
  const n = cells;
  const sm = document.createElement("canvas");
  sm.width = sm.height = n + 1;
  const sg = sm.getContext("2d", { willReadFrequently: true })!;
  const id = sg.createImageData(n + 1, n + 1);
  const vals = new Float32Array(n * n);
  for (let i = 0; i < vals.length; i++) vals[i] = lo + r() * (hi - lo);
  for (let y = 0; y <= n; y++)
    for (let x = 0; x <= n; x++) {
      const v = vals[(y % n) * n + (x % n)],
        i = (y * (n + 1) + x) * 4;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
      id.data[i + 3] = 255;
    }
  sg.putImageData(id, 0, 0);
  g.save();
  g.imageSmoothingEnabled = true;
  g.globalAlpha = alpha;
  g.globalCompositeOperation = op;
  const cw = w / n,
    ch = h / n;
  g.drawImage(sm, 0, 0, n + 1, n + 1, -cw / 2, -ch / 2, cw * (n + 1), ch * (n + 1));
  g.restore();
}

/** Per-pixel grain (fibres, aggregate). */
function grain(g: CanvasRenderingContext2D, w: number, h: number, amount: number, r: Rng) {
  const id = g.getImageData(0, 0, w, h),
    d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const k = (r() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + k));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + k));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + k));
  }
  g.putImageData(id, 0, 0);
}

/** Draw a shape at x and also wrapped across the edges so the texture tiles. */
function wrap(w: number, h: number, x: number, y: number, rad: number, fn: (x: number, y: number) => void) {
  for (const ox of [-w, 0, w])
    for (const oy of [-h, 0, h]) {
      const px = x + ox,
        py = y + oy;
      if (px + rad < 0 || px - rad > w || py + rad < 0 || py - rad > h) continue;
      fn(px, py);
    }
}

const grey = (v: number) => `rgb(${v | 0},${v | 0},${v | 0})`;

/** Tangent-space normal map from a height canvas's brightness (tiling, one typed-array pass). */
export function normalFrom(src: HTMLCanvasElement, strength = 3): HTMLCanvasElement {
  const w = src.width,
    h = src.height;
  const data = src.getContext("2d")!.getImageData(0, 0, w, h).data;
  const L = new Float32Array(w * h);
  for (let i = 0, j = 0; i < L.length; i++, j += 4) L[i] = (data[j] + data[j + 1] + data[j + 2]) * (strength / 765);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const g = out.getContext("2d", { willReadFrequently: true })!;
  const id = g.createImageData(w, h),
    d = id.data;
  for (let y = 0; y < h; y++) {
    const y0 = ((y - 1 + h) % h) * w,
      y1 = ((y + 1) % h) * w,
      yw = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = x === 0 ? w - 1 : x - 1,
        x1 = x === w - 1 ? 0 : x + 1;
      const dx = L[yw + x1] - L[yw + x0],
        dy = L[y1 + x] - L[y0 + x];
      const k = 127.5 / Math.sqrt(dx * dx + dy * dy + 1),
        i = (yw + x) * 4;
      d[i] = 127.5 - dx * k;
      d[i + 1] = 127.5 + dy * k;
      d[i + 2] = 127.5 + k;
      d[i + 3] = 255;
    }
  }
  g.putImageData(id, 0, 0);
  return out;
}

function tex(c: HTMLCanvasElement, srgb = true) {
  return toTexture(c, { srgb });
}

// --------------------------------------------------------------- walls

export function blockWall(sz: number): Surf {
  const r = mulberry32(101);
  const W = sz;
  const bw = W / 4,
    bh = W / 8,
    j = Math.max(2, W * 0.007);
  const height = canvas(W, W, (g) => {
    g.fillStyle = grey(70);
    g.fillRect(0, 0, W, W);
    for (let row = 0; row < 8; row++) {
      const off = (row % 2) * (bw / 2);
      for (let i = -1; i < 5; i++) {
        const x = i * bw + off,
          y = row * bh;
        const gr = g.createLinearGradient(0, y, 0, y + bh);
        gr.addColorStop(0, grey(205));
        gr.addColorStop(0.5, grey(190));
        gr.addColorStop(1, grey(170));
        g.fillStyle = gr;
        g.fillRect(x + j / 2, y + j / 2, bw - j, bh - j);
      }
    }
    // Pitted block face under the paint.
    for (let i = 0; i < W * W * 0.004; i++) {
      g.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.35})`;
      const s = 1.5 + r() * 3.5;
      g.fillRect(r() * W, r() * W, s, s * (0.6 + r() * 0.6));
    }
    noise(g, W, W, 16, r, 0.25, "overlay");
  });
  const map = canvas(W, W, (g) => {
    g.fillStyle = "#e9e5da";
    g.fillRect(0, 0, W, W);
    for (let row = 0; row < 8; row++) {
      const off = (row % 2) * (bw / 2);
      for (let i = -1; i < 5; i++) {
        const v = 226 + (r() - 0.5) * 14;
        g.fillStyle = `rgb(${v + 4},${v + 1},${v - 6})`;
        g.fillRect(i * bw + off + j / 2, row * bh + j / 2, bw - j, bh - j);
      }
    }
    g.globalAlpha = 0.5;
    g.drawImage(height, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "multiply";
    g.fillStyle = "#d8d2c4";
    g.fillRect(0, 0, W, W);
    g.globalCompositeOperation = "source-over";
    noise(g, W, W, 6, r, 0.18, "multiply", 150, 255);
    drips(g, W, W, 24, "rgba(70,58,40,0.10)", r);
    for (let i = 0; i < 10; i++) wrap(W, W, r() * W, r() * W, 60, (x, y) => stain(g, x, y, 20 + r() * 50, "rgba(90,75,50,0.10)"));
    speck(g, W, W, 600, 0.25, r);
  });
  return { map: tex(map), normal: tex(normalFrom(height, 2.2), false) };
}

/** Use the generated wall art (assets.gen.wall) and derive a normal map from it. */
export function genSurface(t: THREE.Texture, size: number, strength: number): Surf {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  const out: Surf = { map: t };
  try {
    const img = t.image as CanvasImageSource | undefined;
    if (img) {
      const c = canvas(size, size, (g) => g.drawImage(img, 0, 0, size, size));
      out.normal = tex(normalFrom(c, strength), false);
    }
  } catch {
    /* image not drawable: colour map only */
  }
  return out;
}

export function plaster(sz: number): Surf {
  const r = mulberry32(202);
  const W = sz;
  const height = canvas(W, W, (g) => {
    g.fillStyle = grey(128);
    g.fillRect(0, 0, W, W);
    noise(g, W, W, 32, r, 0.35, "overlay");
    noise(g, W, W, 96, r, 0.25, "overlay");
    for (let i = 0; i < 6; i++) crack(g, r() * W, r() * W, 12 + r() * 30, 1.2, "rgba(0,0,0,0.8)", r);
  });
  const map = canvas(W, W, (g) => {
    g.fillStyle = "#ece8de";
    g.fillRect(0, 0, W, W);
    noise(g, W, W, 5, r, 0.22, "multiply", 170, 255);
    noise(g, W, W, 18, r, 0.12, "multiply", 160, 255);
    g.globalAlpha = 0.25;
    g.drawImage(height, 0, 0);
    g.globalAlpha = 1;
    // Water stains: tide marks with a darker rim.
    for (let i = 0; i < 4; i++) {
      const x = r() * W,
        y = r() * W * 0.6,
        rad = 30 + r() * 70;
      wrap(W, W, x, y, rad * 1.2, (px, py) => {
        stain(g, px, py, rad, "rgba(140,110,60,0.16)");
        g.strokeStyle = "rgba(110,80,40,0.18)";
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(px, py, rad * 0.85, rad * 0.75, r(), 0, Math.PI * 2);
        g.stroke();
      });
    }
    drips(g, W, W, 14, "rgba(90,70,45,0.10)", r);
    speck(g, W, W, 300, 0.2, r);
  });
  return { map: tex(map), normal: tex(normalFrom(height, 1.4), false) };
}

export function panel(sz: number): Surf {
  const r = mulberry32(303);
  const W = sz;
  const boards = 6,
    bw = W / boards;
  const height = canvas(W, W, (g) => {
    g.fillStyle = grey(180);
    g.fillRect(0, 0, W, W);
    for (let i = 0; i < boards; i++) {
      const x = i * bw;
      const gr = g.createLinearGradient(x, 0, x + 5, 0);
      gr.addColorStop(0, grey(40));
      gr.addColorStop(1, grey(180));
      g.fillStyle = gr;
      g.fillRect(x, 0, 5, W);
    }
  });
  const map = canvas(W, W, (g) => {
    for (let i = 0; i < boards; i++) {
      const v = 0.85 + r() * 0.3;
      g.fillStyle = `rgb(${130 * v},${90 * v},${58 * v})`;
      g.fillRect(i * bw, 0, bw, W);
      // Grain: long wavy strokes.
      for (let k = 0; k < 26; k++) {
        const x0 = i * bw + r() * bw;
        g.strokeStyle = r() < 0.5 ? `rgba(60,35,18,${0.15 + r() * 0.25})` : `rgba(200,150,100,${0.06 + r() * 0.1})`;
        g.lineWidth = 0.6 + r() * 1.8;
        g.beginPath();
        let x = x0;
        g.moveTo(x, 0);
        for (let y = 0; y <= W; y += W / 16) {
          x += (r() - 0.5) * 3;
          g.lineTo(Math.max(i * bw + 2, Math.min((i + 1) * bw - 2, x)), y);
        }
        g.stroke();
      }
      // A knot or two.
      if (r() < 0.6) {
        const kx = i * bw + bw * (0.3 + r() * 0.4),
          ky = r() * W;
        g.fillStyle = "rgba(50,28,14,0.5)";
        g.beginPath();
        g.ellipse(kx, ky, 3 + r() * 3, 8 + r() * 8, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.fillStyle = "rgba(20,10,5,0.85)";
    for (let i = 0; i < boards; i++) g.fillRect(i * bw, 0, 3, W);
    noise(g, W, W, 8, r, 0.25, "multiply", 150, 255);
    speck(g, W, W, 200, 0.2, r, true);
  });
  return { map: tex(map), normal: tex(normalFrom(height, 2), false) };
}

export function glazedTile(sz: number): Surf {
  const r = mulberry32(404);
  const W = sz,
    n = 8,
    t = W / n,
    gw = Math.max(2, W * 0.008);
  const height = canvas(W, W, (g) => {
    g.fillStyle = grey(30);
    g.fillRect(0, 0, W, W);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const gr = g.createRadialGradient(x * t + t / 2, y * t + t / 2, t * 0.2, x * t + t / 2, y * t + t / 2, t * 0.75);
        gr.addColorStop(0, grey(235));
        gr.addColorStop(1, grey(170));
        g.fillStyle = gr;
        g.fillRect(x * t + gw / 2, y * t + gw / 2, t - gw, t - gw);
      }
  });
  const map = canvas(W, W, (g) => {
    g.fillStyle = "#8f897d";
    g.fillRect(0, 0, W, W);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = 238 + (r() - 0.5) * 12;
        g.fillStyle = `rgb(${v},${v},${v - 4})`;
        g.fillRect(x * t + gw / 2, y * t + gw / 2, t - gw, t - gw);
        // Glaze sheen.
        const gr = g.createLinearGradient(x * t, y * t, x * t + t, y * t + t);
        gr.addColorStop(0, "rgba(255,255,255,0.10)");
        gr.addColorStop(1, "rgba(0,0,0,0.06)");
        g.fillStyle = gr;
        g.fillRect(x * t + gw / 2, y * t + gw / 2, t - gw, t - gw);
        if (r() < 0.05) {
          // Chipped corner.
          g.fillStyle = "#9c968a";
          g.beginPath();
          g.moveTo(x * t + gw, y * t + gw);
          g.lineTo(x * t + gw + t * 0.25, y * t + gw);
          g.lineTo(x * t + gw, y * t + gw + t * 0.2);
          g.fill();
        }
        if (r() < 0.08) crack(g, x * t + r() * t, y * t + r() * t, 4 + r() * 6, 0.7, "rgba(60,55,45,0.5)", r);
      }
    noise(g, W, W, 6, r, 0.15, "multiply", 170, 255);
    drips(g, W, W, 10, "rgba(80,65,40,0.10)", r);
  });
  const rough = canvas(W, W, (g) => {
    g.fillStyle = grey(225);
    g.fillRect(0, 0, W, W);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        g.fillStyle = grey(30 + r() * 30);
        g.fillRect(x * t + gw / 2, y * t + gw / 2, t - gw, t - gw);
      }
    noise(g, W, W, 8, r, 0.3, "lighten", 0, 140);
  });
  return { map: tex(map), normal: tex(normalFrom(height, 2.5), false), rough: tex(rough, false) };
}

export function brickFallback(sz: number): Surf {
  const r = mulberry32(505);
  const W = sz,
    rows = 24,
    bh = W / rows,
    bw = W / 6;
  const height = canvas(W, W, (g) => {
    g.fillStyle = grey(60);
    g.fillRect(0, 0, W, W);
    for (let y = 0; y < rows; y++)
      for (let x = -1; x < 7; x++) {
        g.fillStyle = grey(170 + r() * 50);
        g.fillRect(x * bw + (y % 2) * bw * 0.5 + 2, y * bh + 2, bw - 4, bh - 4);
      }
  });
  const map = canvas(W, W, (g) => {
    g.fillStyle = "#8d8a82";
    g.fillRect(0, 0, W, W);
    for (let y = 0; y < rows; y++)
      for (let x = -1; x < 7; x++) {
        const v = 0.75 + r() * 0.35;
        g.fillStyle = `rgb(${150 * v},${70 * v},${50 * v})`;
        g.fillRect(x * bw + (y % 2) * bw * 0.5 + 2, y * bh + 2, bw - 4, bh - 4);
      }
    speck(g, W, W, 2000, 0.3, r);
  });
  return { map: tex(map), normal: tex(normalFrom(height, 2), false) };
}

// --------------------------------------------------------------- floors

export function vinyl(sz: number): Surf {
  const r = mulberry32(606);
  const W = sz,
    n = 8,
    t = W / n;
  const map = canvas(W, W, (g) => {
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const light = (x + y) % 2 === 0;
        const v = (light ? 214 : 190) + (r() - 0.5) * 8;
        g.fillStyle = light ? `rgb(${v},${v - 6},${v - 22})` : `rgb(${v - 2},${v - 6},${v - 14})`;
        g.fillRect(x * t, y * t, t, t);
        // Chips: the flecks in vinyl composition tile.
        for (let k = 0; k < t * t * 0.02; k++) {
          const s = 1 + r() * 2.5;
          g.fillStyle = r() < 0.6 ? `rgba(90,80,65,${0.2 + r() * 0.4})` : `rgba(255,250,240,${0.3 + r() * 0.4})`;
          g.fillRect(x * t + r() * t, y * t + r() * t, s, s * (0.5 + r()));
        }
      }
    // Joints and edge dirt.
    g.strokeStyle = "rgba(60,50,40,0.45)";
    g.lineWidth = Math.max(1, W / 512);
    for (let i = 0; i <= n; i++) {
      g.beginPath();
      g.moveTo(i * t, 0);
      g.lineTo(i * t, W);
      g.moveTo(0, i * t);
      g.lineTo(W, i * t);
      g.stroke();
    }
    noise(g, W, W, 8, r, 0.25, "multiply", 140, 255);
    // Heel scuffs.
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(20,18,16,${0.15 + r() * 0.3})`;
      g.lineWidth = 1 + r() * 2;
      g.beginPath();
      const x = r() * W,
        y = r() * W,
        a = r() * Math.PI * 2;
      g.arc(x, y, 6 + r() * 20, a, a + 0.5 + r());
      g.stroke();
    }
    for (let i = 0; i < 8; i++) wrap(W, W, r() * W, r() * W, 80, (x, y) => stain(g, x, y, 30 + r() * 60, "rgba(80,65,45,0.14)"));
  });
  const rough = canvas(W, W, (g) => {
    g.fillStyle = grey(70);
    g.fillRect(0, 0, W, W);
    noise(g, W, W, 6, r, 0.6, "lighten", 40, 150);
    noise(g, W, W, 24, r, 0.3, "lighten", 40, 120);
    for (let i = 0; i < 30; i++) wrap(W, W, r() * W, r() * W, 40, (x, y) => stain(g, x, y, 10 + r() * 30, "rgba(200,200,200,0.35)"));
  });
  const height = canvas(W, W, (g) => {
    g.fillStyle = grey(200);
    g.fillRect(0, 0, W, W);
    g.strokeStyle = grey(90);
    g.lineWidth = Math.max(1, W / 400);
    for (let i = 0; i <= n; i++) {
      g.beginPath();
      g.moveTo(i * t, 0);
      g.lineTo(i * t, W);
      g.moveTo(0, i * t);
      g.lineTo(W, i * t);
      g.stroke();
    }
  });
  return { map: tex(map), rough: tex(rough, false), normal: tex(normalFrom(height, 1.2), false) };
}

export function carpet(sz: number): Surf {
  const r = mulberry32(707);
  const W = sz;
  const map = canvas(W, W, (g) => {
    g.fillStyle = grey(175);
    g.fillRect(0, 0, W, W);
    noise(g, W, W, 10, r, 0.3, "multiply", 140, 255);
    noise(g, W, W, 64, r, 0.25, "multiply", 160, 255);
    grain(g, W, W, 60, r);
    // Faint repeating diamond weave, typical of commercial carpet.
    g.strokeStyle = "rgba(0,0,0,0.06)";
    g.lineWidth = 2;
    const step = W / 16;
    for (let i = -16; i < 32; i++) {
      g.beginPath();
      g.moveTo(i * step, 0);
      g.lineTo(i * step + W, W);
      g.moveTo(i * step, W);
      g.lineTo(i * step + W, 0);
      g.stroke();
    }
    for (let i = 0; i < 7; i++) wrap(W, W, r() * W, r() * W, 70, (x, y) => blob(g, x, y, 15 + r() * 40, "rgba(40,28,18,0.12)", r));
  });
  const height = canvas(W, W, (g) => {
    g.fillStyle = grey(128);
    g.fillRect(0, 0, W, W);
    grain(g, W, W, 120, r);
  });
  return { map: tex(map), normal: tex(normalFrom(height, 0.8), false) };
}

export function concrete(sz: number): Surf {
  const r = mulberry32(808);
  const W = sz;
  const map = canvas(W, W, (g) => {
    g.fillStyle = "#97938b";
    g.fillRect(0, 0, W, W);
    noise(g, W, W, 4, r, 0.35, "multiply", 150, 255);
    noise(g, W, W, 16, r, 0.25, "multiply", 160, 255);
    noise(g, W, W, 64, r, 0.15, "overlay");
    speck(g, W, W, 3000, 0.35, r);
    speck(g, W, W, 1500, 0.25, r, true);
    for (let i = 0; i < 5; i++) crack(g, r() * W, r() * W, 20 + r() * 40, 1.4, "rgba(30,28,25,0.55)", r);
    for (let i = 0; i < 6; i++) wrap(W, W, r() * W, r() * W, 90, (x, y) => blob(g, x, y, 20 + r() * 60, "rgba(30,25,20,0.14)", r));
  });
  const rough = canvas(W, W, (g) => {
    g.fillStyle = grey(210);
    g.fillRect(0, 0, W, W);
    noise(g, W, W, 6, r, 0.5, "darken", 110, 255);
  });
  const height = canvas(W, W, (g) => {
    g.fillStyle = grey(128);
    g.fillRect(0, 0, W, W);
    noise(g, W, W, 48, r, 0.4, "overlay");
    grain(g, W, W, 50, r);
  });
  return { map: tex(map), rough: tex(rough, false), normal: tex(normalFrom(height, 1.2), false) };
}

export function terrazzo(sz: number): Surf {
  const r = mulberry32(909);
  const W = sz;
  const cols = ["#5e5e5c", "#8c2f2a", "#2a2a2a", "#f2efe8", "#b58b5c", "#7b8b8f"];
  const map = canvas(W, W, (g) => {
    g.fillStyle = "#d8cfbe";
    g.fillRect(0, 0, W, W);
    noise(g, W, W, 6, r, 0.15, "multiply", 190, 255);
    const n = W * W * 0.012;
    for (let i = 0; i < n; i++) {
      g.fillStyle = cols[(r() * cols.length) | 0];
      g.globalAlpha = 0.55 + r() * 0.45;
      const x = r() * W,
        y = r() * W,
        s = 1 + r() * r() * 7;
      g.beginPath();
      g.moveTo(x + s, y);
      for (let k = 1; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + r() * 0.6;
        g.lineTo(x + Math.cos(a) * s * (0.6 + r() * 0.6), y + Math.sin(a) * s * (0.6 + r() * 0.6));
      }
      g.fill();
    }
    g.globalAlpha = 1;
    // Brass divider strips every 1.2 m (texture spans 3.6 m).
    g.fillStyle = "#a8873e";
    const lw = Math.max(2, W * 0.004);
    for (let i = 0; i < 3; i++) {
      g.fillRect((i * W) / 3, 0, lw, W);
      g.fillRect(0, (i * W) / 3, W, lw);
    }
    for (let i = 0; i < 6; i++) wrap(W, W, r() * W, r() * W, 100, (x, y) => stain(g, x, y, 40 + r() * 70, "rgba(70,60,45,0.12)"));
  });
  const rough = canvas(W, W, (g) => {
    g.fillStyle = grey(45);
    g.fillRect(0, 0, W, W);
    noise(g, W, W, 5, r, 0.6, "lighten", 30, 140);
  });
  return { map: tex(map), rough: tex(rough, false) };
}

export function asphalt(sz: number): Surf {
  const r = mulberry32(1010);
  const W = sz;
  // Irregular puddles: clusters of overlapping blobs, the same shapes in every map.
  const puddles: [number, number, number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const cx = r() * W,
      cy = r() * W,
      base = W * (0.015 + r() * 0.035);
    for (let k = 0; k < 5; k++) puddles.push([cx + (r() - 0.5) * base * 3, cy + (r() - 0.5) * base * 1.6, base * (0.6 + r() * 0.8), r() * 1000]);
  }
  const puddle = (g: CanvasRenderingContext2D, colour: string, grow: number) => {
    for (const [x, y, rad, seed] of puddles)
      wrap(W, W, x, y, rad * 2.2, (px, py) => {
        const pr = mulberry32(seed | 0);
        g.save();
        g.filter = `blur(${Math.max(1, rad * 0.12)}px)`;
        blob(g, px, py, rad * grow, colour, pr);
        g.restore();
      });
  };
  const map = canvas(W, W, (g) => {
    g.fillStyle = "#3a3a3c";
    g.fillRect(0, 0, W, W);
    noise(g, W, W, 5, r, 0.35, "multiply", 150, 255);
    noise(g, W, W, 40, r, 0.2, "overlay");
    speck(g, W, W, W * 10, 0.45, r);
    speck(g, W, W, W * 3, 0.08, r, true);
    // Patched repairs and cracks with tar sealant.
    for (let i = 0; i < 4; i++) {
      g.fillStyle = "rgba(20,20,22,0.35)";
      g.fillRect(r() * W, r() * W, 40 + r() * 120, 30 + r() * 90);
    }
    for (let i = 0; i < 10; i++) crack(g, r() * W, r() * W, 20 + r() * 50, 2 + r() * 2, "rgba(10,10,10,0.7)", r);
    for (let i = 0; i < 5; i++) wrap(W, W, r() * W, r() * W, 60, (x, y) => blob(g, x, y, 15 + r() * 35, "rgba(10,8,12,0.35)", r));
    puddle(g, "rgba(10,12,16,0.22)", 1);
  });
  const rough = canvas(W, W, (g) => {
    g.fillStyle = grey(120);
    g.fillRect(0, 0, W, W);
    noise(g, W, W, 8, r, 0.5, "darken", 80, 255);
    puddle(g, grey(10), 1.1);
  });
  return { map: tex(map), rough: tex(rough, false) };
}

export function grass(sz: number): Surf {
  const r = mulberry32(1111);
  const W = sz;
  const map = canvas(W, W, (g) => {
    g.fillStyle = "#2c3322";
    g.fillRect(0, 0, W, W);
    noise(g, W, W, 6, r, 0.4, "multiply", 120, 255);
    for (let i = 0; i < W * W * 0.03; i++) {
      const x = r() * W,
        y = r() * W,
        l = 3 + r() * 7;
      const v = r();
      g.strokeStyle = v < 0.5 ? `rgba(${60 + r() * 30},${75 + r() * 30},${40 + r() * 20},0.6)` : v < 0.8 ? `rgba(90,85,55,0.5)` : `rgba(20,25,15,0.6)`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 3, y - l);
      g.stroke();
    }
    for (let i = 0; i < 6; i++) wrap(W, W, r() * W, r() * W, 80, (x, y) => blob(g, x, y, 25 + r() * 50, "rgba(55,42,30,0.45)", r));
  });
  return { map: tex(map) };
}

export function ceilingTile(sz: number): Surf {
  const r = mulberry32(1212);
  const W = sz,
    cols = 4,
    rows = 2;
  const tw = W / cols,
    th = W / rows,
    bar = Math.max(3, W * 0.01);
  const height = canvas(W, W, (g) => {
    g.fillStyle = grey(140);
    g.fillRect(0, 0, W, W);
    grain(g, W, W, 50, r);
    for (let i = 0; i < W * W * 0.003; i++) {
      g.fillStyle = grey(60);
      g.fillRect(r() * W, r() * W, 1 + r() * 4, 1 + r() * 1.5);
    }
    g.fillStyle = grey(240);
    for (let i = 0; i <= cols; i++) g.fillRect(i * tw - bar / 2, 0, bar, W);
    for (let i = 0; i <= rows; i++) g.fillRect(0, i * th - bar / 2, W, bar);
  });
  const map = canvas(W, W, (g) => {
    g.fillStyle = "#dcd7ca";
    g.fillRect(0, 0, W, W);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const v = 0.9 + r() * 0.12;
        g.fillStyle = `rgba(${220 * v},${214 * v},${198 * v},1)`;
        g.fillRect(x * tw, y * th, tw, th);
      }
    // Fissured acoustic pattern.
    for (let i = 0; i < W * W * 0.004; i++) {
      g.fillStyle = `rgba(90,85,75,${0.2 + r() * 0.35})`;
      g.save();
      g.translate(r() * W, r() * W);
      g.rotate(r() * Math.PI);
      g.fillRect(0, 0, 2 + r() * 6, 1 + r());
      g.restore();
    }
    // Water damage: yellow-brown rings on a couple of tiles.
    for (let i = 0; i < 3; i++) {
      const cx = (((r() * cols) | 0) + 0.5) * tw,
        cy = (((r() * rows) | 0) + 0.5) * th,
        rad = tw * (0.3 + r() * 0.4);
      stain(g, cx, cy, rad, "rgba(150,110,50,0.35)");
      g.strokeStyle = "rgba(120,80,30,0.35)";
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(cx, cy, rad * 0.8, rad * 0.65, r(), 0, Math.PI * 2);
      g.stroke();
    }
    for (let i = 0; i < 3; i++) blob(g, r() * W, r() * W, 6 + r() * 14, "rgba(40,45,30,0.35)", r);
    // T-bar grid.
    g.fillStyle = "#bdbab2";
    for (let i = 0; i <= cols; i++) g.fillRect(i * tw - bar / 2, 0, bar, W);
    for (let i = 0; i <= rows; i++) g.fillRect(0, i * th - bar / 2, W, bar);
    g.fillStyle = "rgba(0,0,0,0.25)";
    for (let i = 0; i <= cols; i++) g.fillRect(i * tw + bar / 2, 0, 1.5, W);
    for (let i = 0; i <= rows; i++) g.fillRect(0, i * th + bar / 2, W, 1.5);
  });
  return { map: tex(map), normal: tex(normalFrom(height, 1.3), false) };
}

export function steelDeck(sz: number): Surf {
  const r = mulberry32(1313);
  const W = sz;
  const height = canvas(W, W, (g) => {
    for (let x = 0; x < W; x++) {
      const t = (x / W) * 4;
      const v = 128 + Math.sin(t * Math.PI * 2) * 100;
      g.fillStyle = grey(v);
      g.fillRect(x, 0, 1, W);
    }
  });
  const map = canvas(W, W, (g) => {
    g.fillStyle = "#55595c";
    g.fillRect(0, 0, W, W);
    g.globalAlpha = 0.35;
    g.drawImage(height, 0, 0);
    g.globalAlpha = 1;
    noise(g, W, W, 6, r, 0.3, "multiply", 120, 255);
    drips(g, W, W, 12, "rgba(90,55,30,0.25)", r);
  });
  return { map: tex(map), normal: tex(normalFrom(height, 3), false) };
}

export function grating(sz: number): Surf {
  const W = sz;
  const bars = 8;
  const map = canvas(W, W, (g) => {
    g.fillStyle = "#0c0c0c";
    g.fillRect(0, 0, W, W);
    g.fillStyle = "#6c6f70";
    const s = W / bars;
    for (let i = 0; i < bars; i++) {
      g.fillRect(i * s, 0, s * 0.18, W);
      g.fillRect(0, i * s * 2, W, s * 0.12);
    }
    const r = mulberry32(1414);
    drips(g, W, W, 10, "rgba(110,60,25,0.4)", r);
  });
  return { map: tex(map), normal: tex(normalFrom(map, 3), false) };
}

// --------------------------------------------------------------- misc

/** Chain-link fence alpha (white wire on black). */
export function chainLink(sz: number): THREE.Texture {
  const W = sz;
  const c = canvas(W, W, (g) => {
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, W);
    g.strokeStyle = "#fff";
    g.lineWidth = W * 0.06;
    g.lineCap = "round";
    for (const o of [-W, 0, W]) {
      g.beginPath();
      g.moveTo(o, 0);
      g.lineTo(o + W, W);
      g.moveTo(o + W, 0);
      g.lineTo(o, W);
      g.stroke();
    }
  });
  const t = toTexture(c, { srgb: false });
  return t;
}

/** Moonlit window glass: night sky with branches and raindrops. */
export function moonGlass(w: number, h: number): THREE.Texture {
  const r = mulberry32(1515);
  const c = canvas(w, h, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "#5a6f96");
    gr.addColorStop(0.55, "#33456a");
    gr.addColorStop(1, "#141c2c");
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) stain(g, r() * w, r() * h * 0.5, 30 + r() * 60, "rgba(160,180,210,0.12)");
    // Bare branches silhouetted against the sky.
    g.strokeStyle = "rgba(6,8,12,0.9)";
    g.lineCap = "round";
    const branch = (x: number, y: number, a: number, len: number, wdt: number, d: number) => {
      if (d > 5 || len < 4) return;
      const x2 = x + Math.cos(a) * len,
        y2 = y + Math.sin(a) * len;
      g.lineWidth = wdt;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x2, y2);
      g.stroke();
      branch(x2, y2, a - 0.3 - r() * 0.4, len * 0.72, wdt * 0.65, d + 1);
      branch(x2, y2, a + 0.2 + r() * 0.4, len * 0.68, wdt * 0.65, d + 1);
    };
    branch(w * 0.15, h, -Math.PI / 2 - 0.15, h * 0.28, 9, 0);
    branch(w * 0.92, h, -Math.PI / 2 + 0.25, h * 0.22, 7, 0);
    // Raindrops on the pane.
    for (let i = 0; i < 160; i++) {
      const x = r() * w,
        y = r() * h,
        s = 1 + r() * 2.5;
      g.fillStyle = "rgba(220,230,255,0.35)";
      g.beginPath();
      g.arc(x, y, s, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.beginPath();
      g.arc(x + s * 0.3, y + s * 0.4, s * 0.7, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = "rgba(200,215,255,0.18)";
    for (let i = 0; i < 18; i++) {
      g.lineWidth = 1 + r();
      const x = r() * w;
      let y = r() * h * 0.5;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 10; k++) g.lineTo(x + (r() - 0.5) * 3, (y += h * 0.04 * (0.5 + r())));
      g.stroke();
    }
  });
  return toTexture(c);
}

/** Rain running down glass: grey 0.5 average, brighter streaks; multiplied over a vertex-colour gradient. */
export function rainStreaks(w: number, h: number): THREE.Texture {
  const r = mulberry32(1616);
  const c = canvas(w, h, (g) => {
    g.fillStyle = grey(150);
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 8, r, 0.2, "overlay");
    for (let i = 0; i < 22; i++) {
      const x0 = r() * w;
      g.strokeStyle = `rgba(255,255,255,${0.12 + r() * 0.2})`;
      g.lineWidth = 0.8 + r();
      for (const oy of [-h, 0, h]) {
        let x = x0,
          y = r() * h + oy;
        g.beginPath();
        g.moveTo(x, y);
        const len = h * (0.2 + r() * 0.6);
        for (let k = 0; k < 20; k++) {
          x += (r() - 0.5) * 2.5;
          y += len / 20;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    for (let i = 0; i < 340; i++) {
      const x = r() * w,
        y = r() * h,
        s = 0.8 + r() * 2.2;
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.beginPath();
      g.arc(x, y, s, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.beginPath();
      g.arc(x, y + s * 0.5, s * 0.6, 0, Math.PI * 2);
      g.fill();
    }
  });
  return toTexture(c);
}

/** Venetian blind slats with see-through gaps (4 slats per tile). */
export function blindSlats(): THREE.Texture {
  const c = canvas(64, 128, (g) => {
    g.clearRect(0, 0, 64, 128);
    for (let i = 0; i < 4; i++) {
      const y = i * 32;
      const gr = g.createLinearGradient(0, y, 0, y + 26);
      gr.addColorStop(0, "#f0e8d6");
      gr.addColorStop(0.5, "#d9cfb9");
      gr.addColorStop(1, "#a59a84");
      g.fillStyle = gr;
      g.fillRect(0, y, 64, 26);
    }
  });
  return toTexture(c);
}

/** Velvet curtain folds (vertical). */
export function curtain(sz: number): Surf {
  const W = sz,
    H = sz / 4;
  const height = canvas(W, H, (g) => {
    for (let x = 0; x < W; x++) {
      const t = (x / W) * Math.PI * 2 * 5;
      const v = 128 + Math.sin(t) * 80 + Math.sin(t * 2.3) * 30;
      g.fillStyle = grey(v);
      g.fillRect(x, 0, 1, H);
    }
  });
  const map = canvas(W, H, (g) => {
    g.drawImage(height, 0, 0);
    g.globalCompositeOperation = "multiply";
    g.fillStyle = "#c8c8c8";
    g.fillRect(0, 0, W, H);
  });
  return { map: tex(map), normal: tex(normalFrom(height, 4), false) };
}

/** Painted steel locker: left half is the door (vents, latch), right half the plain body. */
export function lockerTex(): Surf {
  const r = mulberry32(1717);
  const W = 256,
    H = 512;
  const height = canvas(W, H, (g) => {
    g.fillStyle = grey(160);
    g.fillRect(0, 0, W, H);
    g.fillStyle = grey(200);
    g.fillRect(8, 8, 112, H - 16);
    g.fillStyle = grey(30);
    for (const y0 of [40, H - 110]) for (let i = 0; i < 6; i++) g.fillRect(28, y0 + i * 11, 72, 5);
    g.fillStyle = grey(60);
    g.fillRect(96, H * 0.47, 14, 44);
    g.fillStyle = grey(120);
    for (let y = 0; y < H; y += 128) g.fillRect(128, y, 128, 3);
  });
  const map = canvas(W, H, (g) => {
    g.fillStyle = "#d8d8d6";
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.45;
    g.drawImage(height, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = "#1a1a1a";
    for (const y0 of [40, H - 110]) for (let i = 0; i < 6; i++) g.fillRect(28, y0 + i * 11, 72, 4);
    // Latch and number plate.
    g.fillStyle = "#3b3b3b";
    g.fillRect(96, H * 0.47, 14, 44);
    g.fillStyle = "#b0a68a";
    g.fillRect(44, 20, 40, 12);
    // Scratches, dents and rust.
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = `rgba(${r() < 0.5 ? "60,60,60" : "250,250,250"},${0.15 + r() * 0.25})`;
      g.lineWidth = 0.6 + r();
      const x = r() * W,
        y = r() * H;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 12);
      g.stroke();
    }
    for (let i = 0; i < 10; i++) blob(g, r() * W, H * (0.6 + r() * 0.4), 3 + r() * 8, "rgba(110,60,25,0.45)", r);
    drips(g, W, H, 8, "rgba(90,50,20,0.2)", r);
    noise(g, W, H, 8, r, 0.15, "multiply", 160, 255);
    // Vent slots are cut right through, so a hiding player can see out.
    for (const y0 of [40, H - 110]) for (let i = 0; i < 6; i++) g.clearRect(30, y0 + i * 11, 68, 4);
  });
  return { map: tex(map), normal: tex(normalFrom(height, 2.5), false) };
}

/** Soft gradient used for the cheap ambient occlusion: left half a linear ramp, right half a round blob. */
export function aoTex(): THREE.Texture {
  const c = canvas(128, 64, (g) => {
    g.fillStyle = "#000";
    g.fillRect(0, 0, 128, 64);
    const lg = g.createLinearGradient(0, 0, 0, 64);
    lg.addColorStop(0, "rgba(255,255,255,1)");
    lg.addColorStop(0.35, "rgba(255,255,255,0.45)");
    lg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = lg;
    g.fillRect(0, 0, 64, 64);
    const rg = g.createRadialGradient(96, 32, 0, 96, 32, 31);
    rg.addColorStop(0, "rgba(255,255,255,1)");
    rg.addColorStop(0.5, "rgba(255,255,255,0.6)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg;
    g.fillRect(64, 0, 64, 64);
  });
  const t = toTexture(c, { srgb: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Fallback blood/grime splat (white with alpha) when the shipped decal is missing. */
export function splatFallback(): THREE.Texture {
  const r = mulberry32(1818);
  const c = canvas(256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    blob(g, 128, 128, 60, "#fff", r);
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2,
        d = 60 + r() * 50;
      blob(g, 128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 4 + r() * 12, "#fff", r);
    }
  });
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Distant tree line silhouettes (alpha in the texture). */
export function treeLine(w: number, h: number): THREE.Texture {
  const r = mulberry32(1919);
  const c = canvas(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#fff";
    g.strokeStyle = "#fff";
    g.lineCap = "round";
    // Undergrowth band.
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, h - 12 - r() * 26 - Math.sin(x * 0.01) * 6);
    g.lineTo(w, h);
    g.fill();
    const branch = (x: number, y: number, a: number, len: number, wdt: number, d: number) => {
      if (d > 6 || len < 3) return;
      const x2 = x + Math.cos(a) * len,
        y2 = y + Math.sin(a) * len;
      g.lineWidth = Math.max(0.8, wdt);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x2, y2);
      g.stroke();
      const n = d < 2 ? 3 : 2;
      for (let i = 0; i < n; i++) branch(x2, y2, a + (r() - 0.5) * 1.1, len * (0.62 + r() * 0.15), wdt * 0.62, d + 1);
    };
    const n = Math.round(w / 40);
    for (let i = 0; i < n; i++) {
      const x = (i + r()) * (w / n);
      const th = h * (0.35 + r() * 0.5);
      branch(x, h - 10, -Math.PI / 2 + (r() - 0.5) * 0.2, th * 0.4, 3 + r() * 4, 0);
    }
  });
  const t = toTexture(c);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
