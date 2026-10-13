import * as THREE from "three";

/** Shared helpers for textures painted on a 2D canvas at load time. */

export type Paint = (g: CanvasRenderingContext2D, w: number, h: number) => void;

export function canvas(w: number, h: number, paint: Paint): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  paint(cv.getContext("2d")!, w, h);
  return cv;
}

let maxAniso = 8;
export function setMaxAnisotropy(n: number) {
  maxAniso = n;
}

/** Wrap a canvas (or image) as a repeating texture. Colour maps are sRGB. */
export function toTexture(src: HTMLCanvasElement | HTMLImageElement, opts: { repeat?: [number, number]; srgb?: boolean } = {}) {
  const t = src instanceof HTMLCanvasElement ? new THREE.CanvasTexture(src) : new THREE.Texture(src);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  t.needsUpdate = true;
  return t;
}

/** Derive a tangent-space normal map from a canvas's brightness. */
export function normalFrom(src: HTMLCanvasElement, strength = 3): HTMLCanvasElement {
  const w = src.width,
    h = src.height;
  const data = src.getContext("2d")!.getImageData(0, 0, w, h).data;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 765;
  return canvas(w, h, (g) => {
    const id = g.createImageData(w, h),
      d = id.data;
    for (let y = 0; y < h; y++) {
      const y0 = ((y - 1 + h) % h) * w,
        y1 = ((y + 1) % h) * w,
        yw = y * w;
      for (let x = 0; x < w; x++) {
        const x0 = (x - 1 + w) % w,
          x1 = (x + 1) % w;
        const dx = (L[yw + x1] - L[yw + x0]) * strength,
          dy = (L[y1 + x] - L[y0 + x]) * strength;
        const l = Math.hypot(dx, dy, 1),
          i = (yw + x) * 4;
        d[i] = (-dx / l) * 127.5 + 127.5;
        d[i + 1] = (dy / l) * 127.5 + 127.5;
        d[i + 2] = (1 / l) * 127.5 + 127.5;
        d[i + 3] = 255;
      }
    }
    g.putImageData(id, 0, 0);
  });
}

// Small painting primitives used by many textures. They take an RNG so
// textures can be deterministic.
export type Rng = () => number;

export function speck(g: CanvasRenderingContext2D, w: number, h: number, n: number, alpha: number, r: Rng, light = false) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = light ? `rgba(255,255,255,${r() * alpha})` : `rgba(0,0,0,${r() * alpha})`;
    const s = 1 + r() * 3;
    g.fillRect(r() * w, r() * h, s, s);
  }
}

export function stain(g: CanvasRenderingContext2D, x: number, y: number, rad: number, colour: string) {
  const gr = g.createRadialGradient(x, y, 0, x, y, rad);
  gr.addColorStop(0, colour);
  gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr;
  g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
}

export function crack(g: CanvasRenderingContext2D, x: number, y: number, len: number, width: number, colour: string, r: Rng) {
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(x, y);
  let a = r() * Math.PI * 2;
  for (let i = 0; i < len; i++) {
    a += (r() - 0.5) * 0.9;
    x += Math.cos(a) * 6;
    y += Math.sin(a) * 6;
    g.lineTo(x, y);
  }
  g.stroke();
}

export function blob(g: CanvasRenderingContext2D, x: number, y: number, rad: number, colour: string, r: Rng) {
  g.fillStyle = colour;
  g.beginPath();
  for (let a = 0; a < Math.PI * 2; a += 0.35) {
    const rr = rad * (0.55 + r() * 0.6);
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

/** Vertical drips running down from the top, for grime and water stains. */
export function drips(g: CanvasRenderingContext2D, w: number, h: number, n: number, colour: string, r: Rng) {
  for (let i = 0; i < n; i++) {
    const x = r() * w,
      len = h * (0.1 + r() * 0.55);
    const gr = g.createLinearGradient(0, 0, 0, len);
    gr.addColorStop(0, colour);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(x, 0, 1 + r() * 5, len);
  }
}

export const FONT = {
  chalk: '"Cabin Sketch", "Comic Sans MS", cursive',
  type: '"Special Elite", "Courier New", monospace',
  sign: '"Oswald", "Arial Narrow", Arial, sans-serif',
};
