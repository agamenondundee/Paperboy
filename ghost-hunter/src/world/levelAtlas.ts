import * as THREE from "three";
import type { Assets } from "../types";
import { toTexture, speck, stain, crack, blob, drips, FONT, type Rng } from "./canvasTex";
import { noise, canvas } from "./levelTextures";
import { mulberry32 } from "../core/util";
import type { UvRect } from "./levelGeo";

/**
 * One big canvas atlas holding everything printed, painted or written in the
 * school: chalkboards, posters, signs, clocks, book spines and so on. All of it
 * shares one material, so it costs a single draw call.
 */

type Painter = (g: CanvasRenderingContext2D, w: number, h: number, r: Rng) => void;
interface Entry {
  name: string;
  w: number;
  h: number;
  paint: Painter;
}

export interface Atlas {
  texture: THREE.Texture;
  uv(name: string): UvRect;
  /** Width / height of an entry. */
  aspect(name: string): number;
}

const IMPACT = 'Impact, "Arial Black", "Arial Narrow", sans-serif';

function txt(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, font: string, fill: string, align: CanvasTextAlign = "center", maxW?: number) {
  g.font = `${size}px ${font}`;
  g.textAlign = align;
  g.textBaseline = "middle";
  g.fillStyle = fill;
  if (maxW) g.fillText(s, x, y, maxW);
  else g.fillText(s, x, y);
}

function paper(g: CanvasRenderingContext2D, w: number, h: number, r: Rng, base = "#ece4cf") {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  noise(g, w, h, 6, r, 0.2, "multiply", 170, 255);
  for (let i = 0; i < 3; i++) stain(g, r() * w, r() * h, 10 + r() * w * 0.3, "rgba(150,120,60,0.15)");
  const e = g.createLinearGradient(0, 0, w, h);
  e.addColorStop(0, "rgba(120,90,40,0.15)");
  e.addColorStop(0.5, "rgba(0,0,0,0)");
  e.addColorStop(1, "rgba(120,90,40,0.2)");
  g.fillStyle = e;
  g.fillRect(0, 0, w, h);
}

/** Head-and-shoulders silhouette for photos. */
function person(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, hair: string, skin: string, body: string, bigHair = true) {
  g.fillStyle = body;
  g.beginPath();
  g.ellipse(cx, cy + s * 1.25, s * 1.05, s * 0.6, 0, Math.PI, 0);
  g.fill();
  g.fillRect(cx - s * 1.05, cy + s * 1.25, s * 2.1, s);
  if (bigHair) {
    g.fillStyle = hair;
    g.beginPath();
    g.ellipse(cx, cy + s * 0.05, s * 0.85, s * 0.95, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = skin;
  g.beginPath();
  g.ellipse(cx, cy + s * 0.15, s * 0.42, s * 0.55, 0, 0, Math.PI * 2);
  g.fill();
  g.fillRect(cx - s * 0.16, cy + s * 0.55, s * 0.32, s * 0.4);
  g.fillStyle = hair;
  g.beginPath();
  g.ellipse(cx, cy - s * 0.3, s * 0.5, s * 0.25, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = "rgba(0,0,0,0.6)";
  g.fillRect(cx - s * 0.22, cy + s * 0.05, s * 0.1, s * 0.05);
  g.fillRect(cx + s * 0.12, cy + s * 0.05, s * 0.1, s * 0.05);
}

/** Chalk writing: drawn on a temp canvas, then grainy and smudged. */
function chalk(g: CanvasRenderingContext2D, w: number, h: number, r: Rng, draw: (t: CanvasRenderingContext2D) => void) {
  g.fillStyle = "#24332a";
  g.fillRect(0, 0, w, h);
  noise(g, w, h, 6, r, 0.25, "overlay");
  noise(g, w, h, 40, r, 0.12, "overlay");
  // Old eraser swipes.
  for (let i = 0; i < 16; i++) {
    g.strokeStyle = `rgba(200,215,200,${0.025 + r() * 0.04})`;
    g.lineWidth = 20 + r() * 30;
    g.beginPath();
    const x = r() * w,
      y = r() * h;
    g.arc(x, y + 60, 60 + r() * 80, -Math.PI * 0.8, -Math.PI * 0.2);
    g.stroke();
  }
  const t = canvas(w, h, (tg) => {
    tg.fillStyle = tg.strokeStyle = "rgba(236,236,226,0.92)";
    tg.lineCap = "round";
    tg.lineJoin = "round";
    draw(tg);
    tg.globalCompositeOperation = "destination-out";
    for (let i = 0; i < w * h * 0.05; i++) {
      tg.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.7})`;
      tg.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5);
    }
  });
  g.drawImage(t, 0, 0);
  // Dust collected on the bottom edge.
  const d = g.createLinearGradient(0, h - 18, 0, h);
  d.addColorStop(0, "rgba(220,220,210,0)");
  d.addColorStop(1, "rgba(220,220,210,0.3)");
  g.fillStyle = d;
  g.fillRect(0, h - 18, w, 18);
}

function scrawl(t: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, rot: number, align: CanvasTextAlign = "center") {
  t.save();
  t.translate(x, y);
  t.rotate(rot);
  t.font = `${size}px ${FONT.chalk}`;
  t.textAlign = align;
  t.textBaseline = "middle";
  t.fillText(s, 0, 0);
  t.restore();
}

function drawImageCover(g: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s,
    dh = img.height * s;
  g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** Draw a generated poster image if it is usable, else fall back. */
function genOr(t: THREE.Texture | undefined, fallback: Painter): Painter {
  return (g, w, h, r) => {
    const img = t?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
    if (img && img.width > 0) {
      try {
        drawImageCover(g, img, w, h);
        // Age it to match the corridor.
        g.globalCompositeOperation = "multiply";
        g.fillStyle = "rgba(225,215,190,1)";
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = "source-over";
        stain(g, r() * w, r() * h, w * 0.4, "rgba(120,90,40,0.18)");
        return;
      } catch {
        /* fall through */
      }
    }
    fallback(g, w, h, r);
  };
}

// ------------------------------------------------------------- painters

const missingPoster: Painter = (g, w, h, r) => {
  paper(g, w, h, r, "#efe8d2");
  txt(g, "MISSING", w / 2, 44, 58, IMPACT, "#a01c18");
  g.fillStyle = "#cfc8b4";
  g.fillRect(48, 80, w - 96, 150);
  g.save();
  g.beginPath();
  g.rect(48, 80, w - 96, 150);
  g.clip();
  g.fillStyle = "#77736a";
  g.fillRect(48, 80, w - 96, 150);
  person(g, w / 2, 140, 44, "#d9c79a", "#b9b2a2", "#e8a8c0");
  g.restore();
  txt(g, "JENNY HALE", w / 2, 252, 30, IMPACT, "#1b1b1b");
  const lines = ["Age 17. Last seen 16 May 1987", "at the Hollow Creek High prom.", "Blonde hair, blue eyes,", "pink prom dress.", "Any information, please call", "555-1147"];
  lines.forEach((s, i) => txt(g, s, w / 2, 280 + i * 15, 13, FONT.type, "#222"));
  // Tear-off tabs, a few already taken.
  for (let i = 0; i < 8; i++) {
    const x = 8 + i * ((w - 16) / 8);
    if (r() < 0.35) {
      g.clearRect(x, h - 22, (w - 16) / 8, 22);
      continue;
    }
    g.strokeStyle = "rgba(0,0,0,0.3)";
    g.strokeRect(x, h - 22, (w - 16) / 8, 22);
  }
};

const promPoster: Painter = (g, w, h) => {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#1a0b2e");
  bg.addColorStop(0.6, "#4b1450");
  bg.addColorStop(1, "#13081f");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  // Neon sun and grid horizon.
  const sun = g.createLinearGradient(0, 120, 0, 220);
  sun.addColorStop(0, "#ffd36e");
  sun.addColorStop(1, "#ff3d8b");
  g.fillStyle = sun;
  g.beginPath();
  g.arc(w / 2, 220, 70, Math.PI, 0);
  g.fill();
  g.fillStyle = "#4b1450";
  for (let i = 0; i < 5; i++) g.fillRect(w / 2 - 75, 180 + i * 9, 150, 3);
  g.strokeStyle = "#ff4fd8";
  g.lineWidth = 1.5;
  for (let i = 0; i < 9; i++) {
    g.beginPath();
    g.moveTo(w / 2, 222);
    g.lineTo(-w + (i * 3 * w) / 8, h);
    g.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const y = 222 + i * i * 4.5;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.shadowColor = "#35e8ff";
  g.shadowBlur = 12;
  txt(g, "PROM", w / 2, 58, 64, IMPACT, "#7ff3ff");
  txt(g, "1987", w / 2, 112, 44, IMPACT, "#ff7ad9");
  g.shadowBlur = 0;
  txt(g, "A NIGHT TO REMEMBER", w / 2, 300, 18, FONT.sign, "#ffe7a8");
  txt(g, "Saturday 16 May, 8pm", w / 2, 324, 14, FONT.type, "#f2d9ff");
  txt(g, "Hollow Creek High Gymnasium", w / 2, 342, 12, FONT.type, "#f2d9ff");
  txt(g, "Tickets $15 in the cafeteria", w / 2, 360, 12, FONT.type, "#f2d9ff");
};

const sayNoPoster: Painter = (g, w, h, r) => {
  paper(g, w, h, r, "#f2efe6");
  g.fillStyle = "#c41e24";
  g.fillRect(0, 0, w, 120);
  txt(g, "JUST", w / 2, 40, 44, IMPACT, "#fff");
  txt(g, "SAY NO", w / 2, 90, 52, IMPACT, "#fff");
  g.strokeStyle = "#c41e24";
  g.lineWidth = 14;
  g.beginPath();
  g.arc(w / 2, 230, 70, 0, Math.PI * 2);
  g.moveTo(w / 2 - 50, 180);
  g.lineTo(w / 2 + 50, 280);
  g.stroke();
  txt(g, "Be smart. Stay safe.", w / 2, 336, 18, FONT.sign, "#222");
  txt(g, "Hollow Creek Student Council", w / 2, 362, 12, FONT.type, "#444");
};

const hawksPoster: Painter = (g, w, h, r) => {
  g.fillStyle = "#5a1414";
  g.fillRect(0, 0, w, h);
  noise(g, w, h, 6, r, 0.2, "multiply", 160, 255);
  txt(g, "GO", w / 2, 50, 48, IMPACT, "#e8b923");
  txt(g, "HAWKS!", w / 2, 104, 60, IMPACT, "#e8b923");
  hawk(g, w / 2, 200, 70, "#e8b923");
  const games = ["SEPT 12  vs  RIVERDALE", "SEPT 19  @  MILL VALLEY", "SEPT 26  vs  CEDAR FALLS", "OCT 3  @  PINE RIDGE"];
  games.forEach((s, i) => txt(g, s, w / 2, 290 + i * 20, 13, FONT.sign, "#f6e8c0"));
};

function hawk(g: CanvasRenderingContext2D, x: number, y: number, s: number, c: string) {
  g.fillStyle = c;
  g.beginPath();
  g.moveTo(x, y - s * 0.3);
  g.quadraticCurveTo(x - s * 0.6, y - s * 0.9, x - s * 1.3, y - s * 0.5);
  g.quadraticCurveTo(x - s * 0.7, y - s * 0.35, x - s * 0.9, y);
  g.quadraticCurveTo(x - s * 0.4, y - s * 0.1, x - s * 0.15, y + s * 0.2);
  g.lineTo(x - s * 0.25, y + s * 0.7);
  g.lineTo(x, y + s * 0.45);
  g.lineTo(x + s * 0.25, y + s * 0.7);
  g.lineTo(x + s * 0.15, y + s * 0.2);
  g.quadraticCurveTo(x + s * 0.4, y - s * 0.1, x + s * 0.9, y);
  g.quadraticCurveTo(x + s * 0.7, y - s * 0.35, x + s * 1.3, y - s * 0.5);
  g.quadraticCurveTo(x + s * 0.6, y - s * 0.9, x, y - s * 0.3);
  g.fill();
  g.beginPath();
  g.arc(x, y - s * 0.4, s * 0.16, 0, Math.PI * 2);
  g.fill();
}

const readPoster: Painter = (g, w, h, r) => {
  paper(g, w, h, r, "#e7f0f2");
  txt(g, "READ!", w / 2, 60, 70, IMPACT, "#1d5a8c");
  g.fillStyle = "#c0392b";
  g.fillRect(w / 2 - 70, 130, 140, 100);
  g.fillStyle = "#f4f0e2";
  g.fillRect(w / 2 - 62, 136, 60, 88);
  g.fillRect(w / 2 + 2, 136, 60, 88);
  g.strokeStyle = "rgba(0,0,0,0.25)";
  for (let i = 0; i < 8; i++) {
    g.beginPath();
    g.moveTo(w / 2 - 56, 150 + i * 9);
    g.lineTo(w / 2 - 8, 150 + i * 9);
    g.moveTo(w / 2 + 8, 150 + i * 9);
    g.lineTo(w / 2 + 56, 150 + i * 9);
    g.stroke();
  }
  txt(g, "Open a book,", w / 2, 280, 20, FONT.sign, "#222");
  txt(g, "open your mind.", w / 2, 306, 20, FONT.sign, "#222");
  txt(g, "Library hours 8am to 4pm", w / 2, 350, 12, FONT.type, "#444");
};

const gogglesPoster: Painter = (g, w, h, r) => {
  paper(g, w, h, r, "#f6e64a");
  g.fillStyle = "#111";
  g.fillRect(0, 0, w, 70);
  txt(g, "CAUTION", w / 2, 36, 44, IMPACT, "#f6e64a");
  g.strokeStyle = "#111";
  g.lineWidth = 8;
  g.beginPath();
  g.ellipse(w / 2 - 45, 180, 38, 30, 0, 0, Math.PI * 2);
  g.ellipse(w / 2 + 45, 180, 38, 30, 0, 0, Math.PI * 2);
  g.stroke();
  txt(g, "SAFETY GOGGLES", w / 2, 270, 26, IMPACT, "#111");
  txt(g, "MUST BE WORN", w / 2, 304, 26, IMPACT, "#111");
  txt(g, "at all times in the lab", w / 2, 340, 15, FONT.type, "#111");
};

const periodic: Painter = (g, w, h, r) => {
  paper(g, w, h, r, "#f4f1e8");
  txt(g, "PERIODIC TABLE OF THE ELEMENTS", w / 2, 16, 15, FONT.sign, "#222");
  const cw = (w - 20) / 18,
    chh = (h - 50) / 9;
  const cols = ["#f3a6a6", "#f7cf8a", "#f2f29a", "#b4e3a3", "#9fd3ef", "#c9b3ef", "#e6e6e6"];
  const layout = [
    [0, 17],
    [0, 1, 12, 13, 14, 15, 16, 17],
    [0, 1, 12, 13, 14, 15, 16, 17],
  ];
  let n = 1;
  for (let row = 0; row < 7; row++) {
    const cs = row < 3 ? layout[row] : Array.from({ length: 18 }, (_, i) => i);
    for (const c of cs) {
      const x = 10 + c * cw,
        y = 30 + row * chh;
      g.fillStyle = cols[(c + row) % cols.length];
      g.fillRect(x + 1, y + 1, cw - 2, chh - 2);
      txt(g, String(n++), x + cw / 2, y + chh / 2, 8, FONT.type, "#333");
    }
  }
  for (let row = 0; row < 2; row++)
    for (let c = 2; c < 17; c++) {
      g.fillStyle = row ? "#d9c0e8" : "#f1c6dc";
      g.fillRect(10 + c * cw + 1, 30 + (7.3 + row) * chh + 1, cw - 2, chh - 2);
    }
};

const worldMap: Painter = (g, w, h, r) => {
  g.fillStyle = "#8fb8cf";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(255,255,255,0.3)";
  for (let i = 1; i < 8; i++) {
    g.beginPath();
    g.moveTo((i * w) / 8, 0);
    g.lineTo((i * w) / 8, h);
    g.stroke();
  }
  for (let i = 1; i < 4; i++) {
    g.beginPath();
    g.moveTo(0, (i * h) / 4);
    g.lineTo(w, (i * h) / 4);
    g.stroke();
  }
  const land = (pts: number[][], c: string) => {
    g.fillStyle = c;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)));
    g.closePath();
    g.fill();
  };
  land([[0.08, 0.2], [0.25, 0.12], [0.32, 0.25], [0.26, 0.45], [0.22, 0.5], [0.16, 0.42], [0.1, 0.35]], "#e8d49a");
  land([[0.24, 0.52], [0.32, 0.55], [0.3, 0.8], [0.26, 0.9], [0.23, 0.7]], "#c9e09a");
  land([[0.46, 0.18], [0.56, 0.14], [0.6, 0.3], [0.52, 0.34], [0.47, 0.3]], "#f0b9a0");
  land([[0.47, 0.38], [0.58, 0.38], [0.6, 0.6], [0.54, 0.8], [0.5, 0.62]], "#f3dc8f");
  land([[0.58, 0.12], [0.85, 0.1], [0.9, 0.3], [0.78, 0.45], [0.66, 0.4], [0.6, 0.28]], "#b9d99a");
  land([[0.8, 0.62], [0.9, 0.6], [0.92, 0.75], [0.82, 0.76]], "#f2c2d9");
  noise(g, w, h, 6, r, 0.2, "multiply", 170, 255);
  txt(g, "THE WORLD", w / 2, 14, 13, FONT.sign, "#234");
};

const memorial: Painter = (g, w, h, r) => {
  // Cork board.
  g.fillStyle = "#a77a4b";
  g.fillRect(0, 0, w, h);
  speck(g, w, h, 4000, 0.4, r);
  speck(g, w, h, 1500, 0.3, r, true);
  g.strokeStyle = "#5b3c1e";
  g.lineWidth = 14;
  g.strokeRect(7, 7, w - 14, h - 14);
  // Cut-out letters.
  const title = "WE MISS YOU JENNY";
  const lc = ["#e85b8a", "#f5f0e0", "#e8b923", "#7fc4e8"];
  g.font = `40px ${IMPACT}`;
  let x = 40;
  for (let i = 0; i < title.length; i++) {
    const ch = title[i];
    if (ch === " ") {
      x += 18;
      continue;
    }
    g.save();
    g.translate(x, 52);
    g.rotate((r() - 0.5) * 0.25);
    g.fillStyle = lc[i % lc.length];
    g.textBaseline = "middle";
    g.fillText(ch, 0, 0);
    g.restore();
    x += g.measureText(ch).width + 4;
  }
  // Polaroids.
  for (let i = 0; i < 5; i++) {
    const px = 30 + i * 92 + (r() - 0.5) * 10,
      py = 100 + (i % 2) * 30;
    g.save();
    g.translate(px + 40, py + 50);
    g.rotate((r() - 0.5) * 0.3);
    g.fillStyle = "#f4f1ea";
    g.fillRect(-40, -50, 80, 96);
    g.fillStyle = "#4a4652";
    g.fillRect(-34, -44, 68, 66);
    g.save();
    g.beginPath();
    g.rect(-34, -44, 68, 66);
    g.clip();
    person(g, 0, -14, 18, "#d9c79a", "#c9b9a8", i === 2 ? "#e8a8c0" : "#3b4a6b");
    g.restore();
    g.fillStyle = "#c33";
    g.beginPath();
    g.arc(0, -46, 4, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  // Notes from classmates.
  const notes = ["Come home Jenny", "Prom Queen forever", "We will never forget you", "11:47"];
  notes.forEach((s, i) => {
    g.save();
    g.translate(60 + i * 115, 300 + (r() - 0.5) * 30);
    g.rotate((r() - 0.5) * 0.3);
    g.fillStyle = ["#fff59a", "#f7c6d9", "#d6f0ff", "#f4f1ea"][i];
    g.fillRect(-48, -32, 96, 64);
    txt(g, s, 0, 0, s.length > 14 ? 11 : 15, FONT.chalk, i === 3 ? "#8a1010" : "#333", "center", 90);
    g.restore();
  });
  // A dried rose taped to the corner.
  g.strokeStyle = "#3d4a22";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(w - 40, h - 20);
  g.lineTo(w - 90, h - 120);
  g.stroke();
  blob(g, w - 92, h - 126, 14, "#5a1020", r);
};

const portrait: Painter = (g, w, h, r) => {
  g.fillStyle = "#6e5420";
  g.fillRect(0, 0, w, h);
  const fr = g.createLinearGradient(0, 0, w, h);
  fr.addColorStop(0, "#d8b55a");
  fr.addColorStop(0.5, "#7c5c1c");
  fr.addColorStop(1, "#c9a24a");
  g.fillStyle = fr;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#151410";
  g.fillRect(20, 20, w - 40, h - 40);
  const bg = g.createRadialGradient(w / 2, h * 0.4, 10, w / 2, h * 0.4, h * 0.6);
  bg.addColorStop(0, "#3b2f22");
  bg.addColorStop(1, "#0d0b08");
  g.fillStyle = bg;
  g.fillRect(24, 24, w - 48, h - 48);
  // Suit, shirt, tie.
  g.fillStyle = "#1c1c22";
  g.beginPath();
  g.ellipse(w / 2, h - 40, 100, 90, 0, Math.PI, 0);
  g.fill();
  g.fillRect(w / 2 - 100, h - 40, 200, 20);
  g.fillStyle = "#d9d4c6";
  g.beginPath();
  g.moveTo(w / 2 - 24, h - 130);
  g.lineTo(w / 2 + 24, h - 130);
  g.lineTo(w / 2, h - 60);
  g.fill();
  g.fillStyle = "#5a1414";
  g.beginPath();
  g.moveTo(w / 2 - 7, h - 125);
  g.lineTo(w / 2 + 7, h - 125);
  g.lineTo(w / 2 + 9, h - 70);
  g.lineTo(w / 2, h - 60);
  g.lineTo(w / 2 - 9, h - 70);
  g.fill();
  // Head.
  g.fillStyle = "#b39a80";
  g.beginPath();
  g.ellipse(w / 2, 128, 44, 58, 0, 0, Math.PI * 2);
  g.fill();
  g.fillRect(w / 2 - 18, 170, 36, 40);
  g.fillStyle = "#6d6a64";
  g.beginPath();
  g.ellipse(w / 2, 86, 46, 22, 0, Math.PI, 0);
  g.fill();
  g.fillRect(w / 2 - 46, 84, 10, 40);
  g.fillRect(w / 2 + 36, 84, 10, 40);
  // Glasses and eyes that seem to follow you.
  g.strokeStyle = "#222";
  g.lineWidth = 2.5;
  g.strokeRect(w / 2 - 34, 116, 26, 16);
  g.strokeRect(w / 2 + 8, 116, 26, 16);
  g.beginPath();
  g.moveTo(w / 2 - 8, 122);
  g.lineTo(w / 2 + 8, 122);
  g.stroke();
  g.fillStyle = "#e9e6d6";
  g.fillRect(w / 2 - 28, 120, 14, 7);
  g.fillRect(w / 2 + 14, 120, 14, 7);
  g.fillStyle = "#111";
  g.fillRect(w / 2 - 22, 121, 5, 5);
  g.fillRect(w / 2 + 19, 121, 5, 5);
  g.strokeStyle = "#5a4636";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(w / 2 - 14, 160);
  g.lineTo(w / 2 + 14, 160);
  g.stroke();
  // Craquelure and varnish.
  for (let i = 0; i < 25; i++) crack(g, 24 + r() * (w - 48), 24 + r() * (h - 48), 4 + r() * 8, 0.5, "rgba(0,0,0,0.35)", r);
  g.fillStyle = "rgba(140,100,30,0.15)";
  g.fillRect(24, 24, w - 48, h - 48);
  g.fillStyle = "#c9a24a";
  g.fillRect(w / 2 - 50, h - 18, 100, 12);
  txt(g, "PRINCIPAL R. HALE", w / 2, h - 12, 9, FONT.sign, "#3a2a0a");
};

const scoreboard: Painter = (g, w, h, r) => {
  g.fillStyle = "#121212";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "#5a1414";
  g.lineWidth = 10;
  g.strokeRect(5, 5, w - 10, h - 10);
  txt(g, "HOME", 90, 34, 26, FONT.sign, "#e8e2d0");
  txt(g, "GUEST", w - 90, 34, 26, FONT.sign, "#e8e2d0");
  txt(g, "HAWKS", w / 2, 30, 22, FONT.sign, "#e8b923");
  const led = (s: string, x: number, y: number, size: number, c: string) => {
    g.shadowColor = c;
    g.shadowBlur = 8;
    txt(g, s, x, y, size, '"Courier New", monospace', c);
    g.shadowBlur = 0;
  };
  led("00", 90, 100, 64, "#ff3b2f");
  led("00", w - 90, 100, 64, "#ff3b2f");
  led("11:47", w / 2, 100, 56, "#ffb02e");
  txt(g, "PERIOD", w / 2, 150, 16, FONT.sign, "#bbb");
  led("4", w / 2, 174, 26, "#ff3b2f");
  speck(g, w, h, 600, 0.3, r, true);
};

function banner(text: string, sub: string, bg: string, fg: string, accent: string): Painter {
  return (g, w, h, r) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 8, r, 0.2, "multiply", 160, 255);
    g.strokeStyle = accent;
    g.lineWidth = 8;
    g.strokeRect(10, 10, w - 20, h - 20);
    txt(g, text, w / 2, h * (sub ? 0.42 : 0.5), h * 0.42, IMPACT, fg, "center", w - 60);
    if (sub) txt(g, sub, w / 2, h * 0.78, h * 0.16, FONT.sign, accent, "center", w - 80);
    drips(g, w, h, 12, "rgba(40,30,20,0.25)", r);
    // Water damage and a tear.
    stain(g, w * (0.2 + r() * 0.6), h * 0.3, h * 0.6, "rgba(90,70,40,0.25)");
  };
}

const promBanner: Painter = (g, w, h, r) => {
  const bg = g.createLinearGradient(0, 0, w, 0);
  bg.addColorStop(0, "#2a0f3d");
  bg.addColorStop(0.5, "#5b1a5e");
  bg.addColorStop(1, "#2a0f3d");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(255,${200 + r() * 55},${220 + r() * 35},${0.3 + r() * 0.6})`;
    const s = 1 + r() * 2;
    g.fillRect(r() * w, r() * h, s, s);
  }
  g.shadowColor = "#ff7ad9";
  g.shadowBlur = 14;
  txt(g, "PROM 1987", w / 2, h * 0.42, h * 0.5, IMPACT, "#ffd9f4");
  g.shadowBlur = 0;
  txt(g, "A NIGHT TO REMEMBER", w / 2, h * 0.82, h * 0.15, FONT.sign, "#ffe7a8");
  stain(g, w * 0.7, h * 0.2, h * 0.7, "rgba(40,10,20,0.35)");
  drips(g, w, h, 8, "rgba(20,0,10,0.3)", r);
};

const canopySign: Painter = (g, w, h, r) => {
  g.fillStyle = "#3d2516";
  g.fillRect(0, 0, w, h);
  noise(g, w, h, 12, r, 0.25, "multiply", 120, 255);
  drips(g, w, h, 30, "rgba(10,10,10,0.35)", r);
  const s = "HOLLOW CREEK HIGH SCHOOL";
  const missing = 20; // the second O of SCHOOL
  g.font = `${h * 0.66}px ${FONT.sign}`;
  g.textBaseline = "middle";
  const spacing = 10;
  let total = 0;
  for (const c of s) total += g.measureText(c).width + spacing;
  let x = (w - total) / 2;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const cw = g.measureText(c).width;
    if (i === missing) {
      // Ghost of the fallen letter: cleaner brick behind it and four bolt holes.
      g.fillStyle = "rgba(120,90,60,0.35)";
      g.fillText(c, x, h / 2 + 2);
      g.fillStyle = "#0d0907";
      for (const [dx, dy] of [
        [0.2, 0.25],
        [0.8, 0.25],
        [0.2, 0.75],
        [0.8, 0.75],
      ])
        g.fillRect(x + cw * dx - 2, h * dy - 2, 4, 4);
    } else if (c !== " ") {
      g.fillStyle = "#1a120c";
      g.fillText(c, x + 3, h / 2 + 4);
      const lg = g.createLinearGradient(0, h * 0.2, 0, h * 0.8);
      lg.addColorStop(0, "#f0e7cf");
      lg.addColorStop(1, "#a99f86");
      g.fillStyle = lg;
      g.fillText(c, x, h / 2);
      // Rust bleeding from the fixings.
      if (r() < 0.4) {
        g.fillStyle = "rgba(120,60,20,0.5)";
        g.fillRect(x + cw * 0.5, h * 0.7, 2, h * 0.3);
      }
    }
    x += cw + spacing;
  }
};

function roomSign(num: string, name: string): Painter {
  return (g, w, h) => {
    g.fillStyle = "#3b2a1e";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#c9b48a";
    g.lineWidth = 3;
    g.strokeRect(4, 4, w - 8, h - 8);
    if (num) {
      txt(g, num, 44, h / 2, 30, FONT.sign, "#efe6cf");
      txt(g, name, 88, h / 2, 22, FONT.sign, "#efe6cf", "left", w - 100);
    } else txt(g, name, w / 2, h / 2, 22, FONT.sign, "#efe6cf", "center", w - 20);
  };
}

const exitSign: Painter = (g, w, h) => {
  g.fillStyle = "#1a0505";
  g.fillRect(0, 0, w, h);
  g.shadowColor = "#ff2a1a";
  g.shadowBlur = 6;
  txt(g, "EXIT", w / 2, h / 2 + 2, h * 0.72, FONT.sign, "#ff4a30");
  g.shadowBlur = 0;
};

const clockFace: Painter = (g, w, h, r) => {
  g.fillStyle = "#1b1b1b";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#efeadb";
  g.beginPath();
  g.arc(w / 2, h / 2, w * 0.44, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2,
      l = i % 5 ? 4 : 9;
    g.strokeStyle = "#222";
    g.lineWidth = i % 5 ? 1 : 2.5;
    g.beginPath();
    g.moveTo(w / 2 + Math.sin(a) * (w * 0.42 - l), h / 2 - Math.cos(a) * (w * 0.42 - l));
    g.lineTo(w / 2 + Math.sin(a) * w * 0.42, h / 2 - Math.cos(a) * w * 0.42);
    g.stroke();
  }
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    txt(g, String(i), w / 2 + Math.sin(a) * w * 0.31, h / 2 - Math.cos(a) * w * 0.31, 13, FONT.sign, "#222");
  }
  const hand = (a: number, len: number, wd: number, c: string) => {
    g.strokeStyle = c;
    g.lineWidth = wd;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(w / 2, h / 2);
    g.lineTo(w / 2 + Math.sin(a) * len, h / 2 - Math.cos(a) * len);
    g.stroke();
  };
  hand(((11 + 47 / 60) / 12) * Math.PI * 2, w * 0.22, 4, "#111");
  hand((47 / 60) * Math.PI * 2, w * 0.36, 2.5, "#111");
  hand((13 / 60) * Math.PI * 2, w * 0.38, 1, "#b01010");
  g.fillStyle = "#111";
  g.beginPath();
  g.arc(w / 2, h / 2, 3, 0, Math.PI * 2);
  g.fill();
  crack(g, w * 0.3, h * 0.3, 8, 1, "rgba(255,255,255,0.4)", r);
};

const plate: Painter = (g, w, h) => {
  g.fillStyle = "#e9e4d4";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "#1d3b6e";
  g.lineWidth = 3;
  g.strokeRect(3, 3, w - 6, h - 6);
  txt(g, "LEVEL 99", w / 2, 13, 10, FONT.sign, "#1d3b6e");
  txt(g, "GHST 99", w / 2, h / 2 + 6, 28, FONT.sign, "#7a1010");
};

const noTrespass: Painter = (g, w, h, r) => {
  g.fillStyle = "#f2efe6";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#b51c1c";
  g.fillRect(0, 0, w, 54);
  txt(g, "NO TRESPASSING", w / 2, 28, 32, IMPACT, "#fff");
  txt(g, "PROPERTY OF", w / 2, 76, 15, FONT.sign, "#222");
  txt(g, "HOLLOW CREEK SCHOOL DISTRICT", w / 2, 96, 15, FONT.sign, "#222");
  txt(g, "Violators will be prosecuted", w / 2, 128, 13, FONT.type, "#333");
  drips(g, w, h, 16, "rgba(110,60,20,0.45)", r);
  for (let i = 0; i < 4; i++) blob(g, r() * w, r() * h, 4 + r() * 6, "rgba(110,60,20,0.5)", r);
};

const bulletin: Painter = (g, w, h, r) => {
  g.fillStyle = "#a9804f";
  g.fillRect(0, 0, w, h);
  speck(g, w, h, 3000, 0.4, r);
  g.strokeStyle = "#6b4a28";
  g.lineWidth = 10;
  g.strokeRect(5, 5, w - 10, h - 10);
  const notes: [string, string, string][] = [
    ["PROM COMMITTEE", "Meeting Thursday, gym", "#fff6c8"],
    ["LOST CAT", "Answers to Biscuit", "#f4f1ea"],
    ["BAKE SALE", "Friday at lunch", "#d7f0ff"],
    ["DRAMA CLUB", "Auditions: Our Town", "#ffd7e6"],
    ["SENIOR TRIP", "Forms due 22 May", "#e6ffd7"],
    ["HAVE YOU SEEN HER?", "Call 555-1147", "#f4f1ea"],
  ];
  notes.forEach(([t, s, c], i) => {
    const x = 20 + (i % 3) * 160 + (r() - 0.5) * 16,
      y = 24 + Math.floor(i / 3) * 112 + (r() - 0.5) * 12;
    g.save();
    g.translate(x + 70, y + 48);
    g.rotate((r() - 0.5) * 0.2);
    g.fillStyle = c;
    g.fillRect(-68, -46, 136, 92);
    txt(g, t, 0, -22, 14, FONT.sign, "#222", "center", 128);
    txt(g, s, 0, 6, 11, FONT.type, "#333", "center", 128);
    if (i === 5) person(g, 0, 28, 9, "#d9c79a", "#bbb", "#e8a8c0");
    g.fillStyle = "#c22";
    g.beginPath();
    g.arc(0, -42, 4, 0, Math.PI * 2);
    g.fill();
    g.restore();
  });
};

const calendar: Painter = (g, w, h, r) => {
  paper(g, w, h, r, "#f4f1ea");
  g.fillStyle = "#2d4f7a";
  g.fillRect(0, 0, w, 30);
  txt(g, "MAY 1987", w / 2, 16, 16, FONT.sign, "#fff");
  const cw = (w - 8) / 7,
    chh = (h - 40) / 6;
  let d = 1;
  for (let row = 0; row < 6 && d <= 31; row++)
    for (let c = 0; c < 7 && d <= 31; c++) {
      if (row === 0 && c < 5) continue;
      const x = 4 + c * cw,
        y = 36 + row * chh;
      txt(g, String(d), x + cw / 2, y + chh / 2, 10, FONT.type, "#333");
      if (d === 16) {
        g.strokeStyle = "#b01010";
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(x + cw / 2, y + chh / 2, cw * 0.55, chh * 0.5, 0.2, 0, Math.PI * 2);
        g.stroke();
      }
      if (d > 16) {
        g.strokeStyle = "rgba(0,0,0,0.5)";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x + 2, y + 2);
        g.lineTo(x + cw - 2, y + chh - 2);
        g.stroke();
      }
      d++;
    }
};

const menuBoard: Painter = (g, w, h, r) => {
  g.fillStyle = "#151515";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "#555";
  g.lineWidth = 6;
  g.strokeRect(3, 3, w - 6, h - 6);
  for (let y = 12; y < h; y += 8) {
    g.fillStyle = "rgba(255,255,255,0.03)";
    g.fillRect(6, y, w - 12, 2);
  }
  const lines = ["FRIDAY 15 MAY", "PIZZA SQUARES", "TATER TOTS", "FRUIT CUP", "CHOC MILK 25c", "PROM TICKETS HERE"];
  lines.forEach((s, i) => txt(g, s, w / 2, 26 + i * 28, i ? 18 : 20, FONT.sign, i === 5 ? "#ff7ad9" : "#f0f0e8"));
  speck(g, w, h, 300, 0.3, r, true);
};

const notePaper: Painter = (g, w, h, r) => {
  g.fillStyle = "#f3f1ea";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(90,130,200,0.5)";
  g.lineWidth = 1;
  for (let y = 12; y < h; y += 6) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.strokeStyle = "rgba(220,80,80,0.6)";
  g.beginPath();
  g.moveTo(10, 0);
  g.lineTo(10, h);
  g.stroke();
  g.strokeStyle = "rgba(30,30,60,0.6)";
  for (let y = 16; y < h - 6; y += 6) {
    g.beginPath();
    g.moveTo(13, y);
    for (let x = 13; x < w - 4 - r() * 20; x += 3) g.lineTo(x, y - r() * 2);
    g.stroke();
  }
  stain(g, r() * w, r() * h, 20, "rgba(120,90,40,0.25)");
};

function graffiti(text: string, colour: string, extra: number): Painter {
  return (g, w, h, r) => {
    // Plywood.
    g.fillStyle = "#9c7a4e";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(${r() < 0.5 ? "70,45,20" : "200,160,110"},${0.1 + r() * 0.2})`;
      g.lineWidth = 1 + r() * 3;
      g.beginPath();
      const y = r() * h;
      g.moveTo(0, y);
      g.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 20, w * 0.6, y + (r() - 0.5) * 20, w, y + (r() - 0.5) * 10);
      g.stroke();
    }
    noise(g, w, h, 6, r, 0.25, "multiply", 120, 255);
    drips(g, w, h, 10, "rgba(40,25,10,0.35)", r);
    // Spray paint with runs.
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate((r() - 0.5) * 0.3);
    g.shadowColor = colour;
    g.shadowBlur = 6;
    g.font = `${text.length > 8 ? 34 : 54}px ${IMPACT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = colour;
    const lines = text.split("\n");
    lines.forEach((s, i) => g.fillText(s, 0, (i - (lines.length - 1) / 2) * 50));
    g.shadowBlur = 0;
    for (let i = 0; i < 12; i++) {
      g.fillRect((r() - 0.5) * w * 0.7, (r() - 0.2) * 40, 2, 10 + r() * 40);
    }
    g.restore();
    if (extra === 1) {
      // A wide-open eye.
      g.strokeStyle = "#e8e8e8";
      g.lineWidth = 5;
      g.beginPath();
      g.ellipse(w / 2, h * 0.82, 40, 16, 0, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = "#e8e8e8";
      g.beginPath();
      g.arc(w / 2, h * 0.82, 9, 0, Math.PI * 2);
      g.fill();
    } else if (extra === 2) {
      txt(g, "1987", w * 0.75, h * 0.18, 24, IMPACT, "#2fbf6a");
    }
    // Nail heads.
    g.fillStyle = "#3a3a3a";
    for (const [x, y] of [
      [8, 8],
      [w - 8, 8],
      [8, h - 8],
      [w - 8, h - 8],
      [w / 2, 8],
      [w / 2, h - 8],
    ])
      g.fillRect(x - 2, y - 2, 4, 4);
  };
}

function bookSpines(seed: number): Painter {
  return (g, w, h) => {
    const r = mulberry32(seed);
    g.fillStyle = "#0b0907";
    g.fillRect(0, 0, w, h);
    const cols = ["#5b1e1e", "#1f3b5b", "#2f4a2a", "#6b5428", "#3c2a4d", "#7a6a55", "#1d1d1d", "#8a3a22", "#2b5560", "#9b8a64", "#4a3020"];
    let x = 0;
    while (x < w) {
      if (r() < 0.04) {
        x += 6 + r() * 20;
        continue;
      }
      const bw = 7 + r() * 16,
        bh = h * (0.68 + r() * 0.3);
      const c = cols[(r() * cols.length) | 0];
      const lean = r() < 0.05 ? (r() - 0.5) * 0.25 : 0;
      g.save();
      g.translate(x + bw / 2, h);
      g.rotate(lean);
      g.fillStyle = c;
      g.fillRect(-bw / 2, -bh, bw, bh);
      const sh = g.createLinearGradient(-bw / 2, 0, bw / 2, 0);
      sh.addColorStop(0, "rgba(0,0,0,0.45)");
      sh.addColorStop(0.35, "rgba(255,255,255,0.08)");
      sh.addColorStop(1, "rgba(0,0,0,0.5)");
      g.fillStyle = sh;
      g.fillRect(-bw / 2, -bh, bw, bh);
      g.fillStyle = r() < 0.5 ? "rgba(220,190,120,0.7)" : "rgba(235,230,215,0.6)";
      g.fillRect(-bw / 2 + 1, -bh * 0.8, bw - 2, 2);
      g.fillRect(-bw / 2 + 1, -bh * 0.25, bw - 2, 2);
      if (bw > 11) g.fillRect(-bw / 4, -bh * 0.66, bw / 2, bh * 0.3);
      g.restore();
      x += bw + 0.5;
    }
    speck(g, w, h, 400, 0.3, r, true);
  };
}

const drawers: Painter = (g, w, h, r) => {
  g.fillStyle = "#6b4a2c";
  g.fillRect(0, 0, w, h);
  const cols = 4,
    rows = 6;
  const dw = w / cols,
    dh = h / rows;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const v = 0.85 + r() * 0.25;
      g.fillStyle = `rgb(${135 * v},${92 * v},${55 * v})`;
      g.fillRect(x * dw + 3, y * dh + 3, dw - 6, dh - 6);
      g.fillStyle = "#c9a85a";
      g.fillRect(x * dw + dw / 2 - 14, y * dh + 10, 28, 12);
      g.fillStyle = "#efe8d2";
      g.fillRect(x * dw + dw / 2 - 11, y * dh + 12, 22, 8);
      g.fillStyle = "#b8963f";
      g.beginPath();
      g.arc(x * dw + dw / 2, y * dh + dh * 0.68, 5, 0, Math.PI * 2);
      g.fill();
    }
  noise(g, w, h, 6, r, 0.2, "multiply", 150, 255);
};

function painting(kind: number): Painter {
  return (g, w, h, r) => {
    g.fillStyle = "#f2efe6";
    g.fillRect(0, 0, w, h);
    if (kind === 0) {
      // A child's drawing of a girl in a pink dress, eyes scribbled out.
      g.fillStyle = "#7fb0e0";
      g.fillRect(0, 0, w, h * 0.6);
      g.fillStyle = "#6fae5a";
      g.fillRect(0, h * 0.6, w, h * 0.4);
      g.fillStyle = "#f08fc0";
      g.beginPath();
      g.moveTo(w / 2, h * 0.38);
      g.lineTo(w / 2 + 50, h * 0.85);
      g.lineTo(w / 2 - 50, h * 0.85);
      g.fill();
      g.fillStyle = "#f2d0b0";
      g.beginPath();
      g.arc(w / 2, h * 0.3, 26, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#e8d070";
      g.beginPath();
      g.arc(w / 2, h * 0.26, 30, Math.PI, 0);
      g.fill();
      g.strokeStyle = "#111";
      g.lineWidth = 3;
      for (let i = 0; i < 14; i++) {
        g.beginPath();
        g.moveTo(w / 2 - 18 + r() * 10, h * 0.29 + r() * 6);
        g.lineTo(w / 2 + 8 + r() * 10, h * 0.29 + r() * 6);
        g.stroke();
      }
      txt(g, "JENNY", w / 2, h * 0.94, 20, FONT.chalk, "#333");
    } else if (kind === 1) {
      // A dark corridor with a figure at the end.
      g.fillStyle = "#1b1c20";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "#5a5a60";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(w * 0.42, h * 0.42);
      g.moveTo(w, 0);
      g.lineTo(w * 0.58, h * 0.42);
      g.moveTo(0, h);
      g.lineTo(w * 0.42, h * 0.58);
      g.moveTo(w, h);
      g.lineTo(w * 0.58, h * 0.58);
      g.stroke();
      g.fillStyle = "#cfc8b8";
      g.fillRect(w * 0.42, h * 0.42, w * 0.16, h * 0.16);
      g.fillStyle = "#0a0a0a";
      g.fillRect(w * 0.48, h * 0.45, w * 0.04, h * 0.12);
      g.beginPath();
      g.arc(w * 0.5, h * 0.44, 4, 0, Math.PI * 2);
      g.fill();
    } else {
      // A melting clock, stuck at 11:47.
      g.fillStyle = "#d9b77a";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#e9e2cf";
      g.beginPath();
      g.ellipse(w / 2, h * 0.45, 70, 60, 0.2, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(w / 2 - 20, h * 0.6);
      g.quadraticCurveTo(w / 2, h * 0.95, w / 2 + 20, h * 0.6);
      g.fill();
      g.strokeStyle = "#222";
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(w / 2, h * 0.45);
      g.lineTo(w / 2 - 6, h * 0.25);
      g.moveTo(w / 2, h * 0.45);
      g.lineTo(w / 2 - 50, h * 0.38);
      g.stroke();
    }
    noise(g, w, h, 8, r, 0.2, "multiply", 160, 255);
    g.strokeStyle = "#4a3420";
    g.lineWidth = 10;
    g.strokeRect(5, 5, w - 10, h - 10);
  };
}

const pianoKeys: Painter = (g, w, h) => {
  g.fillStyle = "#efeadc";
  g.fillRect(0, 0, w, h);
  const n = 26,
    kw = w / n;
  g.strokeStyle = "#555";
  g.lineWidth = 1;
  for (let i = 0; i <= n; i++) {
    g.beginPath();
    g.moveTo(i * kw, 0);
    g.lineTo(i * kw, h);
    g.stroke();
  }
  g.fillStyle = "#111";
  for (let i = 0; i < n; i++) {
    const m = i % 7;
    if (m === 2 || m === 6) continue;
    g.fillRect((i + 0.65) * kw, 0, kw * 0.7, h * 0.6);
  }
};

const gauge: Painter = (g, w, h, r) => {
  g.fillStyle = "#222";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#e6e0cf";
  g.beginPath();
  g.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#b01010";
  g.lineWidth = 3;
  g.beginPath();
  g.arc(w / 2, h / 2, w * 0.34, -0.4, 0.5);
  g.stroke();
  g.strokeStyle = "#111";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(w / 2, h / 2);
  g.lineTo(w / 2 + w * 0.3, h / 2 + w * 0.08);
  g.stroke();
  stain(g, r() * w, r() * h, 20, "rgba(100,60,20,0.4)");
};

const washSign: Painter = (g, w, h) => {
  g.fillStyle = "#f2f2ee";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#1d4f8a";
  g.fillRect(0, 0, w, 26);
  txt(g, "NOTICE", w / 2, 14, 16, FONT.sign, "#fff");
  txt(g, "EMPLOYEES MUST", w / 2, 46, 13, FONT.sign, "#111");
  txt(g, "WASH HANDS", w / 2, 66, 15, FONT.sign, "#111");
};

const usFlag: Painter = (g, w, h) => {
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 ? "#e9e4d8" : "#9e1b22";
    g.fillRect(0, (i * h) / 13, w, h / 13 + 1);
  }
  g.fillStyle = "#1e2b55";
  g.fillRect(0, 0, w * 0.42, (h * 7) / 13);
  g.fillStyle = "#e9e4d8";
  for (let y = 0; y < 9; y++)
    for (let x = 0; x < (y % 2 ? 5 : 6); x++) {
      const px = (x + (y % 2 ? 1 : 0.5)) * ((w * 0.42) / 6),
        py = (y + 0.5) * ((h * 7) / 13 / 9);
      g.beginPath();
      g.arc(px, py, 2.2, 0, Math.PI * 2);
      g.fill();
    }
};

const plaques: Painter = (g, w, h, r) => {
  g.fillStyle = "#2a1c12";
  g.fillRect(0, 0, w, h);
  const items = ["STATE CHAMPIONS 1984", "REGIONAL FINALS 1985", "SPELLING BEE 1986", "PROM QUEEN 1987"];
  items.forEach((s, i) => {
    const x = 6 + (i % 2) * (w / 2),
      y = 6 + Math.floor(i / 2) * (h / 2);
    g.fillStyle = "#5a3a20";
    g.fillRect(x, y, w / 2 - 12, h / 2 - 12);
    g.fillStyle = "#c9a24a";
    g.fillRect(x + 10, y + 14, w / 2 - 32, h / 2 - 40);
    txt(g, s, x + (w / 2 - 12) / 2, y + (h / 2 - 12) / 2 - 4, 9, FONT.sign, "#3a2808", "center", w / 2 - 40);
  });
  speck(g, w, h, 200, 0.3, r, true);
};

const crest: Painter = (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#5a1414";
  g.beginPath();
  g.arc(w / 2, h / 2, w * 0.48, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#c9a24a";
  g.beginPath();
  g.arc(w / 2, h / 2, w * 0.36, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#5a1414";
  g.beginPath();
  g.arc(w / 2, h / 2, w * 0.33, 0, Math.PI * 2);
  g.fill();
  hawk(g, w / 2, h / 2 + 4, w * 0.22, "#c9a24a");
  const s = "HOLLOW CREEK HIGH  EST 1952  ";
  g.font = `${w * 0.075}px ${FONT.sign}`;
  g.fillStyle = "#e9dcc0";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let i = 0; i < s.length; i++) {
    const a = (i / s.length) * Math.PI * 2 - Math.PI / 2;
    g.save();
    g.translate(w / 2 + Math.cos(a) * w * 0.42, h / 2 + Math.sin(a) * w * 0.42);
    g.rotate(a + Math.PI / 2);
    g.fillText(s[i], 0, 0);
    g.restore();
  }
};

const vending: Painter = (g, w, h, r) => {
  g.fillStyle = "#8a1a1a";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#0e1114";
  g.fillRect(10, 30, w * 0.62, h - 60);
  for (let row = 0; row < 6; row++)
    for (let c = 0; c < 4; c++) {
      if (r() < 0.4) continue;
      g.fillStyle = ["#d33", "#e8b923", "#3a7", "#36c"][(row + c) % 4];
      g.globalAlpha = 0.5;
      g.fillRect(16 + c * 18, 40 + row * 30, 12, 20);
      g.globalAlpha = 1;
    }
  txt(g, "SNACKS", w / 2, 16, 18, IMPACT, "#f2e6c8");
  g.fillStyle = "#222";
  g.fillRect(w * 0.72, 40, w * 0.22, 60);
  g.fillRect(w * 0.72, h - 50, w * 0.22, 20);
  txt(g, "OUT OF ORDER", w * 0.36, h / 2, 12, FONT.chalk, "#f5f0dc");
};

const fireSign: Painter = (g, w, h) => {
  g.fillStyle = "#c1121c";
  g.fillRect(0, 0, w, h);
  txt(g, "FIRE", w / 2, h * 0.35, 18, IMPACT, "#fff");
  txt(g, "EXTINGUISHER", w / 2, h * 0.7, 8, FONT.sign, "#fff");
};

const busText: Painter = (g, w, h) => {
  g.clearRect(0, 0, w, h);
  txt(g, "HOLLOW CREEK SCHOOL DISTRICT", w / 2, h / 2, h * 0.62, FONT.sign, "#111", "center", w - 10);
};

// ------------------------------------------------------------- chalkboards

const boards: Record<string, Painter> = {
  A: (g, w, h, r) =>
    chalk(g, w, h, r, (t) => {
      scrawl(t, "Fri 15 May 1987", 40, 30, 22, 0, "left");
      scrawl(t, "Homework: read 'The Raven', p. 112", 40, 62, 22, 0, "left");
      scrawl(t, "SHE NEVER LEFT", w * 0.55, h * 0.62, 92, -0.06);
      t.lineWidth = 5;
      t.beginPath();
      t.moveTo(w * 0.2, h * 0.86);
      t.lineTo(w * 0.9, h * 0.8);
      t.stroke();
    }),
  B: (g, w, h, r) =>
    chalk(g, w, h, r, (t) => {
      scrawl(t, "Chapter 12: Reconstruction", 40, 30, 24, 0, "left");
      for (let i = 0; i < 5; i++) scrawl(t, "WHERE IS JENNY HALE?", w * 0.5 + (r() - 0.5) * 60, 80 + i * 36, 30 + r() * 12, (r() - 0.5) * 0.12);
      t.lineWidth = 3;
      for (let i = 0; i < 9; i++) {
        t.beginPath();
        t.moveTo(w - 140 + i * 12, 30);
        t.lineTo(w - 140 + i * 12, 70);
        t.stroke();
      }
    }),
  C: (g, w, h, r) =>
    chalk(g, w, h, r, (t) => {
      scrawl(t, "x² + 5x + 6 = 0", 40, 36, 30, 0, "left");
      scrawl(t, "(x + 2)(x + 3) = 0", 40, 76, 30, 0, "left");
      scrawl(t, "x = -2 or x = -3", 40, 116, 30, 0, "left");
      for (let i = 0; i < 6; i++) scrawl(t, "11:47  11:47  11:47", w * 0.68 + (r() - 0.5) * 30, 34 + i * 36, 30, (r() - 0.5) * 0.08);
      scrawl(t, "IT NEVER ENDS", w * 0.3, h * 0.82, 48, -0.05);
    }),
  D: (g, w, h, r) =>
    chalk(g, w, h, r, (t) => {
      t.lineWidth = 2;
      for (let s = 0; s < 2; s++)
        for (let i = 0; i < 5; i++) {
          t.beginPath();
          t.moveTo(30, 30 + s * 90 + i * 12);
          t.lineTo(w - 30, 30 + s * 90 + i * 12);
          t.stroke();
        }
      for (let i = 0; i < 26; i++) {
        const x = 70 + i * 34,
          y = 30 + (i % 2) * 90 + ((r() * 9) | 0) * 6;
        t.beginPath();
        t.ellipse(x, y, 7, 5, -0.4, 0, Math.PI * 2);
        t.fill();
        t.fillRect(x + 6, y - 32, 2, 32);
      }
      scrawl(t, "SHE STILL SINGS", w * 0.5, h * 0.86, 52, 0.03);
    }),
  E: (g, w, h, r) =>
    chalk(g, w, h, r, (t) => {
      scrawl(t, "Capitals quiz on Monday", 40, 30, 24, 0, "left");
      t.lineWidth = 3;
      t.beginPath();
      t.moveTo(60, 80);
      for (let i = 0; i < 20; i++) t.lineTo(60 + i * 14, 80 + Math.sin(i) * 20 + r() * 20);
      t.lineTo(330, 180);
      t.lineTo(80, 190);
      t.closePath();
      t.stroke();
      scrawl(t, "THE JANITOR", w * 0.66, h * 0.4, 56, -0.04);
      scrawl(t, "LOCKED EVERY DOOR", w * 0.66, h * 0.72, 56, -0.03);
    }),
  F: (g, w, h, r) =>
    chalk(g, w, h, r, (t) => {
      scrawl(t, "Still life: draw what you see", 40, 34, 26, 0, "left");
      scrawl(t, "DRAW WHAT YOU", w * 0.42, h * 0.62, 70, -0.04);
      scrawl(t, "SAW", w * 0.84, h * 0.6, 80, 0.08);
      t.lineWidth = 4;
      t.beginPath();
      t.moveTo(w * 0.36, 40);
      t.lineTo(w * 0.56, 30);
      t.stroke();
    }),
  S: (g, w, h, r) =>
    chalk(g, w, h, r, (t) => {
      scrawl(t, "Lab 14: Reaction rates", 40, 30, 26, 0, "left");
      scrawl(t, "2H₂ + O₂ → 2H₂O", 40, 76, 30, 0, "left");
      t.lineWidth = 3;
      t.beginPath();
      t.moveTo(60, 200);
      t.lineTo(60, 120);
      t.moveTo(60, 200);
      t.lineTo(300, 200);
      t.moveTo(60, 190);
      t.quadraticCurveTo(140, 120, 290, 125);
      t.stroke();
      scrawl(t, "DON'T TURN AROUND", w * 0.7, h * 0.66, 50, -0.05);
    }),
};

// ------------------------------------------------------------------- build

export function buildAtlas(assets: Assets, scale: number): Atlas {
  const E: Entry[] = [];
  const add = (name: string, w: number, h: number, paint: Painter) => E.push({ name, w, h, paint });

  for (const k of Object.keys(boards)) add(`board${k}`, 1024, 256, boards[k]);
  add("posterMissing", 256, 384, genOr(assets.gen.posterMissing, missingPoster));
  add("posterProm", 256, 384, genOr(assets.gen.posterProm, promPoster));
  add("posterNo", 256, 384, sayNoPoster);
  add("posterHawks", 256, 384, hawksPoster);
  add("posterRead", 256, 384, readPoster);
  add("posterGoggles", 256, 384, gogglesPoster);
  add("periodic", 512, 256, periodic);
  add("worldMap", 512, 256, worldMap);
  add("memorial", 512, 384, memorial);
  add("portrait", 256, 320, portrait);
  add("scoreboard", 512, 192, scoreboard);
  add("bannerProm", 1024, 192, promBanner);
  add("bannerWelcome", 1024, 160, banner("WELCOME TO HOLLOW CREEK HIGH", "HOME OF THE HAWKS", "#e9dfc6", "#5a1414", "#a8823a"));
  add("bannerHawks", 512, 192, banner("GO HAWKS!", "1986 DISTRICT CHAMPIONS", "#5a1414", "#e8b923", "#e9dfc6"));
  add("canopySign", 2048, 128, canopySign);
  const signs: [string, string, string][] = [
    ["signA", "101", "ENGLISH"],
    ["signB", "102", "HISTORY"],
    ["signC", "103", "MATHS"],
    ["signD", "104", "MUSIC"],
    ["signE", "105", "GEOGRAPHY"],
    ["signF", "106", "ART"],
    ["signL", "", "LIBRARY"],
    ["signP", "", "PRINCIPAL"],
    ["signW", "", "BOILER ROOM: STAFF ONLY"],
    ["signS", "", "SCIENCE LAB"],
    ["signG", "", "GYMNASIUM"],
    ["signX", "", "CAFETERIA"],
    ["signK", "", "KITCHEN: STAFF ONLY"],
  ];
  for (const [n, num, name] of signs) add(n, 256, 64, roomSign(num, name));
  add("exit", 128, 48, exitSign);
  add("clock", 128, 128, clockFace);
  add("plate", 128, 64, plate);
  add("busText", 512, 64, busText);
  add("noTrespass", 256, 160, noTrespass);
  add("bulletin", 512, 256, bulletin);
  add("calendar", 128, 160, calendar);
  add("menu", 256, 192, menuBoard);
  add("paper", 64, 80, notePaper);
  add("graffiti0", 256, 256, graffiti("GET OUT", "#d8d8d8", 1));
  add("graffiti1", 256, 256, graffiti("11:47", "#c0141a", 2));
  add("graffiti2", 256, 256, graffiti("SHE'S STILL\nHERE", "#e04ab0", 0));
  add("books0", 1024, 128, bookSpines(31));
  add("books1", 1024, 128, bookSpines(57));
  add("drawers", 256, 256, drawers);
  add("painting0", 256, 256, painting(0));
  add("painting1", 256, 256, painting(1));
  add("painting2", 256, 256, painting(2));
  add("pianoKeys", 256, 32, pianoKeys);
  add("gauge", 64, 64, gauge);
  add("wash", 128, 96, washSign);
  add("flagUS", 256, 160, usFlag);
  add("plaques", 256, 128, plaques);
  add("crest", 256, 256, crest);
  add("vending", 128, 256, vending);
  add("fire", 64, 64, fireSign);

  // Shelf packing, tallest first.
  const W = 2048,
    pad = 4;
  const order = [...E].sort((a, b) => b.h - a.h || b.w - a.w);
  const place = new Map<string, { x: number; y: number; w: number; h: number }>();
  let x = 0,
    y = 0,
    rowH = 0;
  for (const e of order) {
    if (x + e.w > W) {
      x = 0;
      y += rowH + pad;
      rowH = 0;
    }
    place.set(e.name, { x, y, w: e.w, h: e.h });
    x += e.w + pad;
    rowH = Math.max(rowH, e.h);
  }
  const H = Math.ceil((y + rowH) / 256) * 256;
  const cw = Math.round(W * scale),
    chh = Math.round(H * scale);
  const cv = canvas(cw, chh, (g) => {
    g.fillStyle = "#808080";
    g.fillRect(0, 0, cw, chh);
    let seed = 1;
    for (const e of E) {
      const p = place.get(e.name)!;
      g.save();
      g.scale(scale, scale);
      g.translate(p.x, p.y);
      g.beginPath();
      g.rect(0, 0, p.w, p.h);
      g.clip();
      g.clearRect(0, 0, p.w, p.h);
      try {
        e.paint(g, p.w, p.h, mulberry32(9000 + seed++ * 77));
      } catch (err) {
        console.warn("[level] atlas entry failed", e.name, err);
      }
      g.restore();
    }
  });
  const texture = toTexture(cv);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  const uvs = new Map<string, UvRect>();
  for (const [n, p] of place) {
    uvs.set(n, { u0: (p.x + 1) / W, u1: (p.x + p.w - 1) / W, v1: 1 - (p.y + 1) / H, v0: 1 - (p.y + p.h - 1) / H });
  }
  return {
    texture,
    uv(name: string) {
      const u = uvs.get(name);
      if (!u) throw new Error(`atlas entry ${name} missing`);
      return u;
    },
    aspect(name: string) {
      const p = place.get(name)!;
      return p.w / p.h;
    },
  };
}
