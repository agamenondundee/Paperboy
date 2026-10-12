'use strict';

/* ---------- Basics ---------- */

const W = 960, H = 540, GROUND = 452, WORLD = 3400;
const TAU = Math.PI * 2;
const R = Math.min(2, window.devicePixelRatio || 1);
const SERIF = '"Cormorant Garamond", Georgia, serif';
const MOON = { x: 318, y: 112 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const damp = (k, dt) => 1 - Math.pow(k, dt);

function rng(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mk(w, h, scale = R) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * scale);
  c.height = Math.ceil(h * scale);
  c.w = w;
  c.h = h;
  const g = c.getContext('2d');
  g.setTransform(scale, 0, 0, scale, 0, 0);
  return [c, g];
}

// Blur a pre-rendered layer by shrinking and re-enlarging it (works in every browser)
function softened(src, factor) {
  const tmp = document.createElement('canvas');
  tmp.width = Math.max(1, Math.round(src.width / factor));
  tmp.height = Math.max(1, Math.round(src.height / factor));
  const tg = tmp.getContext('2d');
  tg.imageSmoothingQuality = 'high';
  tg.drawImage(src, 0, 0, tmp.width, tmp.height);
  const [c, g] = mk(src.w, src.h);
  g.imageSmoothingQuality = 'high';
  g.drawImage(tmp, 0, 0, src.w, src.h);
  return c;
}

// #game is the HUD layer on top (it also takes input); the scene renders offscreen
// and reaches the screen through the WebGL post-processing pass on #view.
const cv = document.getElementById('game');
cv.width = W * R;
cv.height = H * R;
const hud = cv.getContext('2d');
hud.setTransform(R, 0, 0, R, 0, 0);
const [SCENE, ctx] = mk(W, H);
const view = document.createElement('canvas');
view.width = W * R;
view.height = H * R;
cv.parentNode.insertBefore(view, cv);

// Glow buffer: everything that emits light is also drawn here, then blurred into bloom
const [GLOW, gg] = mk(W, H, 0.5);
const [BL1, b1] = mk(W, H, 1 / 6);
const [BL2, b2] = mk(W, H, 1 / 16);
const [LIGHT, lg] = mk(W, H);

/* ---------- Scenery builders ---------- */

function branch(g, r, x, y, len, ang, w, d, tips) {
  const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
  const bend = (r() - 0.5) * len * 0.7;
  const cx = (x + x2) / 2 + Math.cos(ang + Math.PI / 2) * bend;
  const cy = (y + y2) / 2 + Math.sin(ang + Math.PI / 2) * bend;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(cx, cy, x2, y2);
  g.stroke();
  if (tips && d <= 3 && r() < 0.12) tips.push([x2, y2]);
  if (d <= 0 || w < 0.6) return;
  const n = d > 5 ? 2 : r() < 0.4 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const na = ang + (i - (n - 1) / 2) * (0.45 + r() * 0.55) + (r() - 0.5) * 0.5;
    branch(g, r, x2, y2, len * (0.6 + r() * 0.24), na, w * 0.67, d - 1, tips);
  }
}

function treeShape(g, r, bx, by, h, trunk, depth, tips) {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let i = 0; i < 7; i++) {
    const dir = i % 2 ? 1 : -1;
    const len = trunk * (1.5 + r() * 2.8);
    g.lineWidth = trunk * (0.22 + r() * 0.3);
    g.beginPath();
    g.moveTo(bx, by - trunk * 0.9);
    g.quadraticCurveTo(bx + dir * len * 0.35, by - 2, bx + dir * len, by + 3);
    g.stroke();
  }
  const lean = (r() - 0.5) * 0.5;
  branch(g, r, bx, by, h * 0.32, -Math.PI / 2 + lean, trunk, depth, tips);
  branch(g, r, bx + trunk * 0.2, by, h * 0.27, -Math.PI / 2 + lean + 0.28, trunk * 0.6, depth - 2, tips);
}

// Draw a tree twice from the same seed: a pale rim pass, then the dark body on top
function drawTree(g, seed, bx, by, h, trunk, col, rim, depth, moss) {
  if (rim) {
    g.save();
    g.translate(-1.6, -1);
    g.strokeStyle = rim;
    treeShape(g, rng(seed), bx, by, h, trunk, depth, null);
    g.restore();
  }
  const tips = [];
  g.strokeStyle = col;
  treeShape(g, rng(seed), bx, by, h, trunk, depth, tips);
  if (moss) {
    const r = rng(seed + 5);
    g.strokeStyle = moss;
    for (const [x, y] of tips) {
      const l = 8 + r() * 26;
      g.lineWidth = 0.5 + r() * 0.8;
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + (r() - 0.5) * 6, y + l * 0.4, x + (r() - 0.5) * 8, y + l * 0.7, x + (r() - 0.5) * 4, y + l);
      g.stroke();
    }
  }
}

function spire(g, x, base, w, h, dark) {
  const sh = h * 0.58;
  g.beginPath();
  g.moveTo(x - w / 2, base);
  g.lineTo(x - w / 2, base - sh);
  g.lineTo(x - w * 0.32, base - sh);
  g.lineTo(x, base - h);
  g.lineTo(x + w * 0.32, base - sh);
  g.lineTo(x + w / 2, base - sh);
  g.lineTo(x + w / 2, base);
  g.fill();
  // crockets running up the spire
  const steps = Math.floor(h / 22);
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    const yy = base - sh - (h - sh) * t;
    const half = w * 0.32 * (1 - t);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(x + s * half, yy);
      g.lineTo(x + s * (half + w * 0.07), yy - 2);
      g.lineTo(x + s * half, yy - 5);
      g.fill();
    }
  }
  for (const s of [-1, 1]) {
    const px = x + (s * w) / 2;
    g.beginPath();
    g.moveTo(px - w * 0.09, base - sh);
    g.lineTo(px, base - sh - h * 0.14);
    g.lineTo(px + w * 0.09, base - sh);
    g.fill();
  }
  if (dark) {
    const keep = g.fillStyle;
    g.fillStyle = dark;
    const ww = Math.max(1.2, w * 0.1);
    for (let k = 0; k < 3; k++) {
      const wy = base - sh * (0.3 + k * 0.22);
      for (const s of [-0.2, 0.2]) {
        g.beginPath();
        g.moveTo(x + s * w - ww, wy);
        g.lineTo(x + s * w - ww, wy - h * 0.05);
        g.lineTo(x + s * w, wy - h * 0.07);
        g.lineTo(x + s * w + ww, wy - h * 0.05);
        g.lineTo(x + s * w + ww, wy);
        g.fill();
      }
    }
    g.fillStyle = keep;
  }
}

function cathedral(g, r, cx, base, s, col, dark) {
  g.fillStyle = col;
  g.fillRect(cx - 140 * s, base - 120 * s, 280 * s, 120 * s);
  g.beginPath();
  g.moveTo(cx - 140 * s, base - 120 * s);
  g.lineTo(cx, base - 168 * s);
  g.lineTo(cx + 140 * s, base - 120 * s);
  g.fill();
  // flying buttresses
  g.strokeStyle = col;
  g.lineWidth = 5 * s;
  for (let i = 0; i < 7; i++) {
    const x = cx + (-130 + i * 43) * s;
    g.beginPath();
    g.moveTo(x - 20 * s, base);
    g.quadraticCurveTo(x - 18 * s, base - 90 * s, x + 4 * s, base - 128 * s);
    g.stroke();
    g.fillRect(x - 24 * s, base - 70 * s, 8 * s, 70 * s);
  }
  for (let i = 0; i < 13; i++) spire(g, cx + (-135 + i * 22.5) * s, base - 110 * s, 7 * s, (50 + r() * 44) * s);
  spire(g, cx - 82 * s, base, 42 * s, 290 * s, dark);
  spire(g, cx + 84 * s, base, 40 * s, 270 * s, dark);
  spire(g, cx, base, 56 * s, 390 * s, dark);
  for (let i = 0; i < 7; i++) spire(g, cx + (-54 + i * 18) * s, base - 175 * s, 6 * s, 70 * s);
  g.fillStyle = dark;
  g.beginPath();
  g.arc(cx, base - 92 * s, 17 * s, 0, TAU);
  g.fill();
  g.fillStyle = col;
  g.lineWidth = 1.2 * s;
  g.strokeStyle = col;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    g.beginPath();
    g.moveTo(cx, base - 92 * s);
    g.lineTo(cx + Math.cos(a) * 17 * s, base - 92 * s + Math.sin(a) * 17 * s);
    g.stroke();
  }
}

function skull(g, x, y, s, col, dark) {
  g.fillStyle = col;
  g.beginPath();
  g.ellipse(x, y, 9 * s, 8.5 * s, 0, 0, TAU);
  g.fill();
  g.beginPath();
  g.rect(x - 5.5 * s, y + 2 * s, 11 * s, 8 * s);
  g.fill();
  g.fillStyle = dark;
  for (const ex of [-3.6, 3.6]) {
    g.beginPath();
    g.ellipse(x + ex * s, y + 1 * s, 2.7 * s, 3 * s, 0, 0, TAU);
    g.fill();
  }
  g.beginPath();
  g.moveTo(x, y + 4 * s);
  g.lineTo(x - 1.3 * s, y + 6.6 * s);
  g.lineTo(x + 1.3 * s, y + 6.6 * s);
  g.fill();
  for (let i = -2; i <= 2; i++) g.fillRect(x + i * 2 * s - 0.4 * s, y + 7.5 * s, 0.8 * s, 2.5 * s);
}

function shadedSkull(g, x, y, s, r) {
  skull(g, x, y, s, '#8f879f', '#120d18');
  g.fillStyle = 'rgba(220,215,240,0.35)';
  g.beginPath();
  g.ellipse(x - 2 * s, y - 4 * s, 5 * s, 3 * s, -0.4, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(10,6,16,0.35)';
  g.beginPath();
  g.ellipse(x + 3 * s, y + 4 * s, 7 * s, 5 * s, 0, 0, TAU);
  g.fill();
  if (r() < 0.3) {
    g.strokeStyle = 'rgba(30,20,40,0.6)';
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(x - 4 * s, y - 7 * s);
    g.lineTo(x - 1 * s, y - 3 * s);
    g.lineTo(x - 3 * s, y);
    g.stroke();
  }
}

function makeSkullPile(seed, w, h) {
  const r = rng(seed);
  const [c, g] = mk(w, h);
  g.strokeStyle = '#7d768c';
  g.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    g.lineWidth = 2 + r() * 2.5;
    const x = r() * w, y = h - 4 - r() * 14, l = 10 + r() * 20, a = (r() - 0.5) * 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  for (let row = 0; row < 3; row++) {
    const n = 7 - row * 2;
    for (let i = 0; i < n; i++) {
      const s = 1 + r() * 0.7 - row * 0.1;
      const x = w / 2 + (i - (n - 1) / 2) * 18 * (1 - row * 0.15) + (r() - 0.5) * 6;
      const y = h - 12 - row * 13 - r() * 3;
      shadedSkull(g, x, y, s, r);
    }
  }
  return c;
}

function fogTint(c, colour, top = 0, bottom = 0.75) {
  const g = c.getContext('2d');
  g.save();
  g.setTransform(R, 0, 0, R, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  const gr = g.createLinearGradient(0, 0, 0, c.h);
  gr.addColorStop(0, colour.replace('A', String(top)));
  gr.addColorStop(0.55, colour.replace('A', String(lerp(top, bottom, 0.3))));
  gr.addColorStop(1, colour.replace('A', String(bottom)));
  g.fillStyle = gr;
  g.fillRect(0, 0, c.w, c.h);
  g.restore();
}

function buildSky() {
  const [c, g] = mk(W, H);
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#120822');
  gr.addColorStop(0.28, '#35204f');
  gr.addColorStop(0.55, '#664a8a');
  gr.addColorStop(0.75, '#535796');
  gr.addColorStop(1, '#1b1e3e');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  const r = rng(7);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(230,220,255,${0.15 + r() * 0.5})`;
    const s = r() * 1.2 + 0.3;
    g.fillRect(r() * W, r() * H * 0.45, s, s);
  }
  for (const [rad, a] of [[380, 0.22], [180, 0.3], [90, 0.35]]) {
    const halo = g.createRadialGradient(MOON.x, MOON.y, 0, MOON.x, MOON.y, rad);
    halo.addColorStop(0, `rgba(235,205,255,${a})`);
    halo.addColorStop(1, 'rgba(235,205,255,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, W, H);
  }
  const disc = g.createRadialGradient(MOON.x - 10, MOON.y - 12, 4, MOON.x, MOON.y, 42);
  disc.addColorStop(0, '#fbf6ff');
  disc.addColorStop(0.7, '#e2d4f2');
  disc.addColorStop(1, '#bfaedb');
  g.fillStyle = disc;
  g.beginPath();
  g.arc(MOON.x, MOON.y, 40, 0, TAU);
  g.fill();
  for (let i = 0; i < 14; i++) {
    const a = r() * TAU, d = r() * 30, s = 2 + r() * 7;
    g.fillStyle = `rgba(150,130,190,${0.12 + r() * 0.18})`;
    g.beginPath();
    g.arc(MOON.x + Math.cos(a) * d, MOON.y + Math.sin(a) * d, s, 0, TAU);
    g.fill();
  }
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(${120 + r() * 60},${90 + r() * 50},${170 + r() * 60},${0.04 + r() * 0.07})`;
    g.beginPath();
    g.ellipse(r() * W, r() * H * 0.55, 80 + r() * 220, 5 + r() * 16, (r() - 0.5) * 0.08, 0, TAU);
    g.fill();
  }
  return c;
}

function buildClouds() {
  const w = 1800, h = 260;
  const [c, g] = mk(w, h);
  const r = rng(17);
  for (let k = 0; k < 18; k++) {
    const cx = r() * w, cy = 40 + r() * 150, n = 10 + Math.floor(r() * 12), a = 0.25 + r() * 0.3;
    for (let i = 0; i < n; i++) {
      const x = cx + (r() - 0.5) * 260, y = cy + (r() - 0.5) * 30, rad = 20 + r() * 50;
      for (const ox of [-w, 0, w]) {
        const pg = g.createRadialGradient(x + ox, y - rad * 0.35, 0, x + ox, y, rad);
        pg.addColorStop(0, `rgba(175,145,215,${a})`);
        pg.addColorStop(0.55, `rgba(80,52,120,${a * 0.8})`);
        pg.addColorStop(1, 'rgba(40,24,70,0)');
        g.fillStyle = pg;
        g.fillRect(x + ox - rad, y - rad, rad * 2, rad * 2);
      }
    }
  }
  return c;
}

function buildGodRays() {
  const [c, g] = mk(W, H);
  const r = rng(29);
  for (let i = 0; i < 11; i++) {
    const a = 0.55 + r() * 1.9, wdt = 0.02 + r() * 0.05, len = 600 + r() * 300;
    const gr = g.createLinearGradient(MOON.x, MOON.y, MOON.x + Math.cos(a) * len, MOON.y + Math.sin(a) * len);
    gr.addColorStop(0, `rgba(215,190,255,${0.16 + r() * 0.12})`);
    gr.addColorStop(1, 'rgba(215,190,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(MOON.x, MOON.y);
    g.lineTo(MOON.x + Math.cos(a - wdt) * len, MOON.y + Math.sin(a - wdt) * len);
    g.lineTo(MOON.x + Math.cos(a + wdt) * len, MOON.y + Math.sin(a + wdt) * len);
    g.fill();
  }
  return softened(c, 4);
}

function buildMountains() {
  const w = 2200, h = 260;
  const [c, g] = mk(w, h);
  const r = rng(3);
  g.fillStyle = '#5a4884';
  g.beginPath();
  g.moveTo(0, h);
  let y = h - 90;
  for (let x = 0; x <= w; x += 18) {
    y = clamp(y + (r() - 0.5) * 34, h - 200, h - 40);
    g.lineTo(x, y);
  }
  g.lineTo(w, h);
  g.fill();
  fogTint(c, 'rgba(160,135,205,A)', 0.2, 0.85);
  return c;
}

function buildFar() {
  const w = 1500, h = 400;
  const [c, g] = mk(w, h);
  const r = rng(11);
  const col = '#4b3a6c', dark = '#3a2c56';
  cathedral(g, r, 420, h - 10, 0.95, col, dark);
  cathedral(g, r, 1150, h - 30, 0.55, col, dark);
  g.fillStyle = col;
  for (let i = 0; i < 9; i++) spire(g, 40 + r() * w, h - 20, 10 + r() * 14, 80 + r() * 150);
  g.beginPath();
  g.moveTo(0, h);
  for (let x = 0; x <= w; x += 30) g.lineTo(x, h - 28 - Math.sin(x * 0.004) * 12 - Math.sin(x * 0.013 + 1) * 6);
  g.lineTo(w, h);
  g.fill();
  fogTint(c, 'rgba(140,115,190,A)');
  return c;
}

function buildBack() {
  const w = 1700, h = 320;
  const [c, g] = mk(w, h);
  const r = rng(23);
  const col = '#2d2245';
  for (let i = 0; i < 9; i++) drawTree(g, 400 + i, 60 + i * 190 + r() * 80, h - 14, 150 + r() * 120, 7 + r() * 5, col, null, 6);
  g.fillStyle = col;
  for (let i = 0; i < 4; i++) {
    const x = 150 + i * 420 + r() * 100, bw = 60 + r() * 40, bh = 50 + r() * 40;
    g.save();
    g.translate(x, h - 14);
    g.rotate((r() - 0.5) * 0.12);
    g.fillRect(-bw / 2, -bh, bw, bh);
    g.beginPath();
    g.moveTo(-bw / 2 - 8, -bh);
    g.lineTo(0, -bh - 50 - r() * 20);
    g.lineTo(bw / 2 + 8, -bh);
    g.fill();
    g.fillRect(bw * 0.15, -bh - 40, 8, 26);
    g.restore();
  }
  for (let i = 0; i < 26; i++) {
    const x = r() * w, s = 0.6 + r() * 0.6;
    g.fillRect(x - 1.5 * s, h - 14 - 26 * s, 3 * s, 26 * s);
    g.fillRect(x - 8 * s, h - 14 - 20 * s, 16 * s, 3 * s);
  }
  g.beginPath();
  g.moveTo(0, h);
  for (let x = 0; x <= w; x += 20) g.lineTo(x, h - 16 - Math.sin(x * 0.01) * 5);
  g.lineTo(w, h);
  g.fill();
  fogTint(c, 'rgba(120,100,175,A)');
  return c;
}

function buildTrees2() {
  const w = 2000, h = 460;
  const [c, g] = mk(w, h);
  const r = rng(61);
  for (let i = 0; i < 7; i++) {
    drawTree(g, 600 + i, 120 + i * 290 + r() * 90, h - 8, 260 + r() * 130, 11 + r() * 6, '#251b38', 'rgba(150,130,205,0.55)', 7, 'rgba(120,110,160,0.35)');
  }
  g.fillStyle = '#251b38';
  g.fillRect(0, h - 10, w, 10);
  fogTint(c, 'rgba(115,95,170,A)', 0.05, 0.6);
  return c;
}

function hangingFigure(g, x, y, len, s, sway) {
  g.strokeStyle = 'rgba(120,110,140,0.8)';
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + sway, y + len);
  g.stroke();
  const hx = x + sway, hy = y + len;
  g.fillStyle = '#9a93b2';
  g.strokeStyle = '#9a93b2';
  g.lineCap = 'round';
  g.beginPath();
  g.arc(hx, hy + 5 * s, 4.2 * s, 0, TAU);
  g.fill();
  g.lineWidth = 3.4 * s;
  g.beginPath();
  g.moveTo(hx, hy + 9 * s);
  g.lineTo(hx + 0.5, hy + 30 * s);
  g.stroke();
  g.lineWidth = 1.6 * s;
  g.beginPath();
  g.moveTo(hx - 1, hy + 12 * s);
  g.lineTo(hx - 4 * s, hy + 30 * s);
  g.moveTo(hx + 1, hy + 12 * s);
  g.lineTo(hx + 4 * s, hy + 31 * s);
  g.moveTo(hx, hy + 30 * s);
  g.lineTo(hx - 2 * s, hy + 50 * s);
  g.moveTo(hx, hy + 30 * s);
  g.lineTo(hx + 2.5 * s, hy + 49 * s);
  g.stroke();
  g.strokeStyle = 'rgba(40,30,55,0.6)';
  g.lineWidth = 0.6;
  for (let k = 0; k < 4; k++) {
    g.beginPath();
    g.moveTo(hx - 2 * s, hy + (14 + k * 3) * s);
    g.lineTo(hx + 2 * s, hy + (14 + k * 3) * s);
    g.stroke();
  }
}

function buildMid() {
  const w = 2300, h = 540;
  const [c, g] = mk(w, h);
  const [gc, ge] = mk(w, h, 0.5);
  const r = rng(41);
  const col = '#1c1528', rim = 'rgba(160,145,215,0.6)';
  for (const [i, tx] of [180, 900, 1550, 2120].entries()) {
    drawTree(g, 700 + i, tx, h - 10, 330 + r() * 120, 18 + r() * 8, col, rim, 8, 'rgba(130,120,175,0.4)');
  }
  const hx = 1250, hy = h - 10;
  g.save();
  g.translate(hx, hy);
  g.rotate(-0.1);
  const wall = g.createLinearGradient(-85, 0, 85, 0);
  wall.addColorStop(0, '#2a2138');
  wall.addColorStop(1, '#16111f');
  g.fillStyle = wall;
  g.fillRect(-85, -360, 170, 360);
  g.fillStyle = '#1a1424';
  g.beginPath();
  g.moveTo(-108, -360);
  g.lineTo(-30, -455);
  g.lineTo(-6, -430);
  g.lineTo(26, -470);
  g.lineTo(112, -360);
  g.fill();
  g.strokeStyle = 'rgba(170,150,215,0.4)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(-108, -360);
  g.lineTo(-30, -455);
  g.lineTo(-6, -430);
  g.lineTo(26, -470);
  g.stroke();
  g.strokeStyle = 'rgba(100,80,130,0.35)';
  g.lineWidth = 1;
  for (let y = -350; y < 0; y += 13) {
    g.beginPath();
    g.moveTo(-85, y + (r() - 0.5) * 3);
    g.lineTo(85, y + (r() - 0.5) * 3);
    g.stroke();
  }
  g.fillStyle = '#120d19';
  for (const bx of [-85, -30, 30, 79]) g.fillRect(bx, -360, 6, 360);
  g.fillRect(-90, -250, 180, 8);
  g.fillRect(-90, -130, 180, 8);
  // broken planks sticking out
  g.fillStyle = '#1a1424';
  for (let i = 0; i < 6; i++) {
    g.save();
    g.translate(-90 + r() * 180, -360 + r() * 40);
    g.rotate((r() - 0.5) * 1.6);
    g.fillRect(0, -2, 30 + r() * 30, 4);
    g.restore();
  }
  g.restore();
  g.save();
  g.translate(hx + 70, hy - 160);
  g.rotate(0.42);
  g.fillStyle = '#1b1525';
  g.fillRect(0, 0, 330, 26);
  g.strokeStyle = 'rgba(110,90,140,0.45)';
  for (let x = 6; x < 330; x += 14) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + (r() - 0.5) * 4, 26 + r() * 18);
    g.stroke();
  }
  g.restore();
  // draped roots
  const vines = [];
  for (let i = 0; i < 46; i++) {
    const x = hx - 60 + r() * 380, y = hy - 360 + r() * 200, l = 40 + r() * 150;
    const pts = [x, y, x + (r() - 0.5) * 30, y + l * 0.3, x + (r() - 0.5) * 30, y + l * 0.7, x + (r() - 0.5) * 20, y + l];
    vines.push(pts);
    g.strokeStyle = 'rgba(125,118,170,0.5)';
    g.lineWidth = 0.6 + r() * 2;
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    g.bezierCurveTo(pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]);
    g.stroke();
  }
  fogTint(c, 'rgba(105,95,170,A)');
  // hanging pale bodies, as in the old tales of the vale
  for (let i = 0; i < 7; i++) hangingFigure(g, hx - 70 + i * 26 + r() * 10, hy - 352 + r() * 8, 18 + r() * 40, 0.9 + r() * 0.3, (r() - 0.5) * 6);
  // tiny white blossoms along the roots; they glow
  for (const v of vines) {
    for (let k = 0; k < 6; k++) {
      if (r() < 0.5) continue;
      const t = r();
      const x = Math.pow(1 - t, 3) * v[0] + 3 * Math.pow(1 - t, 2) * t * v[2] + 3 * (1 - t) * t * t * v[4] + t * t * t * v[6];
      const y = Math.pow(1 - t, 3) * v[1] + 3 * Math.pow(1 - t, 2) * t * v[3] + 3 * (1 - t) * t * t * v[5] + t * t * t * v[7];
      g.fillStyle = 'rgba(225,235,255,0.95)';
      g.beginPath();
      g.arc(x, y, 1.2 + r() * 1.4, 0, TAU);
      g.fill();
      ge.fillStyle = 'rgba(170,200,255,0.9)';
      ge.beginPath();
      ge.arc(x, y, 3, 0, TAU);
      ge.fill();
    }
  }
  for (const target of [g, ge]) {
    target.save();
    target.translate(hx, hy);
    target.rotate(-0.1);
    for (const [wx, wy] of [[-55, -330], [20, -320], [-50, -210], [30, -200], [-10, -100]]) {
      if (target === g) {
        const glow = g.createRadialGradient(wx + 13, wy + 18, 0, wx + 13, wy + 18, 70);
        glow.addColorStop(0, 'rgba(230,70,100,0.35)');
        glow.addColorStop(1, 'rgba(230,70,100,0)');
        g.fillStyle = glow;
        g.fillRect(wx - 60, wy - 55, 146, 146);
      }
      target.fillStyle = '#b3364f';
      target.fillRect(wx, wy, 26, 36);
      target.fillStyle = '#ff8a96';
      target.fillRect(wx + 3, wy + 3, 9, 13);
      target.fillRect(wx + 14, wy + 3, 9, 13);
      target.fillRect(wx + 3, wy + 19, 9, 14);
      target.fillRect(wx + 14, wy + 19, 9, 14);
    }
    target.restore();
  }
  return [c, gc];
}

function buildFog(colour, seed) {
  const w = 600, h = 180;
  const [c, g] = mk(w, h);
  const r = rng(seed);
  for (let i = 0; i < 52; i++) {
    const x = r() * w, y = 50 + r() * 80, rad = 40 + r() * 90;
    for (const ox of [-w, 0, w]) {
      const gr = g.createRadialGradient(x + ox, y, 0, x + ox, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.13)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(x + ox - rad, y - rad, rad * 2, rad * 2);
    }
  }
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = colour;
  g.fillRect(0, 0, w, h);
  return c;
}

function buildGroundTex() {
  const w = 1200, h = H - GROUND + 16;
  const [c, g] = mk(w, h);
  const r = rng(91);
  g.beginPath();
  g.moveTo(0, h);
  for (let x = 0; x <= w; x += 12) g.lineTo(x, 10 + Math.sin(x * 0.013) * 3 + Math.sin(x * 0.041) * 1.5 + (r() - 0.5) * 2);
  g.lineTo(w, h);
  g.closePath();
  const base = g.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, '#2b2244');
  base.addColorStop(0.12, '#1a1429');
  base.addColorStop(0.5, '#0f0b18');
  base.addColorStop(1, '#050409');
  g.fillStyle = base;
  g.fill();
  g.save();
  g.clip();
  for (let i = 0; i < 4000; i++) {
    const y = 8 + Math.pow(r(), 1.6) * h;
    g.fillStyle = r() < 0.5 ? `rgba(120,105,160,${0.05 + r() * 0.12})` : `rgba(0,0,0,${0.1 + r() * 0.25})`;
    g.fillRect(r() * w, y, 1 + r() * 2, 1 + r() * 1.5);
  }
  g.lineCap = 'round';
  for (let i = 0; i < 30; i++) {
    const x = r() * w, y = 14 + r() * 40, l = 40 + r() * 120;
    g.strokeStyle = 'rgba(10,7,16,0.8)';
    g.lineWidth = 1.5 + r() * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + l * 0.3, y + (r() - 0.5) * 20, x + l * 0.6, y + (r() - 0.5) * 20, x + l, y + (r() - 0.5) * 12);
    g.stroke();
    g.strokeStyle = 'rgba(120,110,170,0.18)';
    g.lineWidth = 0.8;
    g.stroke();
  }
  for (let i = 0; i < 60; i++) {
    const x = r() * w, y = 12 + Math.pow(r(), 1.3) * (h - 20), rx = 3 + r() * 10, ry = rx * (0.4 + r() * 0.3);
    const sg = g.createLinearGradient(0, y - ry, 0, y + ry);
    sg.addColorStop(0, '#463d5e');
    sg.addColorStop(1, '#100c17');
    g.fillStyle = sg;
    g.beginPath();
    g.ellipse(x, y, rx, ry, (r() - 0.5) * 0.4, 0, TAU);
    g.fill();
  }
  g.strokeStyle = 'rgba(150,142,170,0.35)';
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = 16 + r() * 50, l = 6 + r() * 12, a = (r() - 0.5) * 1.2;
    g.lineWidth = 1.5 + r() * 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  g.restore();
  return c;
}

function buildForeground() {
  const w = 2600, h = 130;
  const [c, g] = mk(w, h);
  const r = rng(77);
  const col = '#07050c';
  g.fillStyle = col;
  g.strokeStyle = col;
  g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const x = 120 + i * 370 + r() * 120;
    for (let k = 0; k < 6; k++) skull(g, x + (k - 3) * 22 + r() * 8, h - 20 - r() * 18, 1.6 + r() * 0.8, '#1a1523', col);
  }
  for (let i = 0; i < 300; i++) {
    const x = r() * w, hh = 20 + r() * 80, lean = (r() - 0.5) * 30;
    g.lineWidth = 1.5 + r() * 3;
    g.beginPath();
    g.moveTo(x, h);
    g.quadraticCurveTo(x + lean * 0.3, h - hh * 0.6, x + lean, h - hh);
    g.stroke();
  }
  return softened(c, 3.5);
}

function buildVignette() {
  const [c, g] = mk(W, H);
  const gr = g.createRadialGradient(W / 2, H * 0.48, H * 0.28, W / 2, H * 0.5, W * 0.66);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(2,0,8,0.82)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  return c;
}

function buildGrain() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const id = g.createImageData(256, 256);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 255;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
    id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return c;
}

function buildSplat(seed) {
  const s = 320;
  const [c, g] = mk(s, s);
  const r = rng(seed);
  const cx = s / 2, cy = s / 2;
  const fill = (x, y, rad) => {
    const gr = g.createRadialGradient(x - rad * 0.3, y - rad * 0.3, 0, x, y, rad);
    gr.addColorStop(0, '#9a0c18');
    gr.addColorStop(0.75, '#5e040c');
    gr.addColorStop(1, '#3a0207');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, rad, 0, TAU);
    g.fill();
  };
  for (let i = 0; i < 9; i++) fill(cx + (r() - 0.5) * 50, cy + (r() - 0.5) * 50, 18 + r() * 26);
  for (let i = 0; i < 40; i++) {
    const a = r() * TAU, d = 50 + r() * 100;
    fill(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1.5 + r() * 7);
  }
  g.strokeStyle = '#7a0812';
  g.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const x = cx + (r() - 0.5) * 80, y = cy + r() * 20, l = 30 + r() * 90;
    g.lineWidth = 3 + r() * 5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 4, y + l);
    g.stroke();
    fill(x, y + l, g.lineWidth * 0.8);
  }
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(255,150,150,0.22)';
  for (let i = 0; i < 20; i++) {
    g.beginPath();
    g.ellipse(cx + (r() - 0.5) * 140, cy + (r() - 0.5) * 140, 6 + r() * 10, 2 + r() * 3, r() * TAU, 0, TAU);
    g.fill();
  }
  return c;
}

const SKY = buildSky();
const CLOUDS = buildClouds();
const RAYS = buildGodRays();
const MOUNT = buildMountains();
const FAR = buildFar();
const BACK = buildBack();
const TREES2 = buildTrees2();
const [MID, MID_GLOW] = buildMid();
const FOG_PURPLE = buildFog('rgba(190,160,235,1)', 3);
const FOG_BLUE = buildFog('rgba(140,165,240,1)', 9);
const GROUND_TEX = buildGroundTex();
const FORE = buildForeground();
const VIGNETTE = buildVignette();
const GRAIN = buildGrain();
const SPLATS = [5, 6, 7].map(buildSplat);
const PILES = [1, 2, 3].map(s => makeSkullPile(s * 31, 150, 70));
const TREE_NEAR = (() => {
  const [c, g] = mk(520, 560);
  drawTree(g, 99, 260, 550, 420, 26, '#100b16', 'rgba(150,140,215,0.7)', 9, 'rgba(110,100,150,0.4)');
  return c;
})();
let grainPattern = null;

/* ---------- World decoration ---------- */

const deco = { grass: [], piles: [], stones: [], flowers: [], lamps: [], trees: [], puddles: [] };
(() => {
  const r = rng(5);
  for (let x = 0; x < WORLD; x += 5) deco.grass.push({ x: x + r() * 5, h: 8 + r() * 24, lean: (r() - 0.5) * 0.7, pale: r() < 0.25 });
  for (const x of [230, 880, 1480, 2160, 2820, 3260]) deco.piles.push({ x, img: PILES[Math.floor(r() * 3)] });
  for (let i = 0; i < 18; i++) deco.stones.push({ x: 100 + r() * (WORLD - 200), kind: Math.floor(r() * 3), s: 0.8 + r() * 0.5, tilt: (r() - 0.5) * 0.3 });
  for (let i = 0; i < 11; i++) {
    const cx = 150 + r() * (WORLD - 300), dots = [];
    for (let k = 0; k < 20; k++) dots.push({ dx: (r() - 0.5) * 90, dy: -r() * 16, s: 1 + r() * 1.6, ph: r() * TAU });
    deco.flowers.push({ x: cx, dots });
  }
  for (const x of [520, 1300, 2050, 2900]) deco.lamps.push({ x });
  for (const x of [60, 1720, 3150]) deco.trees.push({ x });
  for (let i = 0; i < 9; i++) deco.puddles.push({ x: 200 + r() * (WORLD - 400), w: 30 + r() * 50, y: 10 + r() * 14 });
})();

/* ---------- Input ---------- */

const keys = {}, pressed = {};
const KEYMAP = {
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyW: 'jump', ArrowUp: 'jump', Space: 'jump',
  KeyJ: 'attack', KeyK: 'heavy', ShiftLeft: 'dodge', ShiftRight: 'dodge', KeyL: 'dodge',
  KeyE: 'heal', KeyR: 'heal', Enter: 'start', KeyP: 'pause', Escape: 'pause', KeyM: 'mute', KeyB: 'gore',
  KeyS: 'down', ArrowDown: 'down', KeyQ: 'swap', Digit1: 'w1', Digit2: 'w2', Digit3: 'w3'
};

function press(k) {
  if (!keys[k]) pressed[k] = true;
  keys[k] = true;
  initAudio();
}

addEventListener('keydown', e => {
  const k = KEYMAP[e.code];
  if (!k) return;
  e.preventDefault();
  press(k);
});
addEventListener('keyup', e => {
  const k = KEYMAP[e.code];
  if (k) keys[k] = false;
});
cv.addEventListener('mousedown', e => {
  press(e.button === 2 ? 'heavy' : 'attack');
  pressed.start = true;
});
addEventListener('mouseup', () => { keys.attack = false; keys.heavy = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('touchstart', () => { pressed.start = true; initAudio(); }, { passive: true });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

for (const b of document.querySelectorAll('#touch button')) {
  const k = b.dataset.k;
  const up = () => { keys[k] = false; b.classList.remove('held'); };
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    press(k);
    pressed.start = true;
    b.classList.add('held');
  });
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
}

/* ---------- Audio ---------- */

let AC = null, master = null, noiseBuf = null, muted = false;

function initAudio() {
  if (AC) {
    if (AC.state === 'suspended') AC.resume();
    return;
  }
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return;
  AC = new Ctor();
  master = AC.createGain();
  master.gain.value = 0.55;
  master.connect(AC.destination);
  noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const lp = AC.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 170;
  const dg = AC.createGain();
  dg.gain.value = 0.06;
  lp.connect(dg).connect(master);
  for (const f of [49, 49.6, 73.5]) {
    const o = AC.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.connect(lp);
    o.start();
  }
  const wind = AC.createBufferSource();
  wind.buffer = noiseBuf;
  wind.loop = true;
  const bp = AC.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 420;
  bp.Q.value = 0.7;
  const wg = AC.createGain();
  wg.gain.value = 0.05;
  const lfo = AC.createOscillator();
  lfo.frequency.value = 0.09;
  const lfoGain = AC.createGain();
  lfoGain.gain.value = 220;
  lfo.connect(lfoGain).connect(bp.frequency);
  lfo.start();
  wind.connect(bp).connect(wg).connect(master);
  wind.start();
}

function noise(dur, f0, f1, q, vol, type = 'bandpass') {
  if (!AC || muted) return;
  const t = AC.currentTime;
  const s = AC.createBufferSource();
  s.buffer = noiseBuf;
  const f = AC.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  f.Q.value = q;
  const g = AC.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random());
  s.stop(t + dur + 0.05);
}

function tone(f0, f1, dur, vol, type = 'sine', cutoff = 0) {
  if (!AC || muted) return;
  const t = AC.currentTime;
  const o = AC.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  let node = o;
  if (cutoff) {
    const f = AC.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    o.connect(f);
    node = f;
  }
  node.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const sfx = {
  swing: () => noise(0.22, 500, 2600, 1.4, 0.22),
  heavy: () => { noise(0.42, 260, 1800, 1, 0.32); tone(120, 60, 0.3, 0.12, 'triangle'); },
  hit: () => { tone(150, 45, 0.2, 0.5, 'triangle'); noise(0.12, 1400, 300, 0.8, 0.35, 'lowpass'); },
  splat: () => { noise(0.35, 900, 120, 0.6, 0.45, 'lowpass'); noise(0.18, 2400, 700, 4, 0.12); },
  hurt: () => { tone(240, 80, 0.35, 0.3, 'sawtooth', 900); noise(0.2, 800, 200, 1, 0.3); },
  groan: () => tone(rand(70, 110), rand(45, 60), rand(0.7, 1.2), 0.08, 'sawtooth', 380),
  claw: () => noise(0.16, 1800, 600, 2, 0.15),
  slam: () => { tone(80, 28, 0.8, 0.8); noise(0.6, 500, 60, 0.7, 0.6, 'lowpass'); },
  spike: () => noise(0.3, 300, 1200, 3, 0.25),
  heal: () => { tone(330, 660, 0.6, 0.14); tone(495, 990, 0.6, 0.08); },
  jump: () => noise(0.1, 400, 900, 1, 0.08),
  roll: () => noise(0.25, 300, 120, 0.8, 0.18, 'lowpass'),
  pick: () => tone(660, 1320, 0.25, 0.12, 'triangle'),
  die: () => tone(180, 40, 0.6, 0.2, 'sawtooth', 600),
  death: () => { tone(110, 35, 2.2, 0.4, 'sawtooth', 500); tone(55, 30, 2.4, 0.4); },
  boss: () => { tone(60, 40, 2.5, 0.5, 'sawtooth', 300); noise(2, 200, 60, 0.5, 0.4, 'lowpass'); },
  shot: () => { noise(0.5, 3000, 120, 0.5, 0.9, 'lowpass'); tone(90, 30, 0.35, 0.6, 'triangle'); },
  blast: () => { noise(0.8, 2400, 60, 0.4, 1, 'lowpass'); tone(70, 22, 0.6, 0.8, 'triangle'); },
  click: () => noise(0.06, 3000, 2000, 6, 0.15),
  swap: () => { noise(0.08, 4000, 2500, 8, 0.12); tone(900, 1200, 0.08, 0.05, 'triangle'); },
  whiff: () => noise(0.18, 1400, 400, 1.5, 0.12),
  reload: () => { noise(0.05, 2500, 1800, 5, 0.12); tone(600, 500, 0.05, 0.05, 'square'); }
};

/* ---------- Weapons ---------- */

const WEAPONS = [
  {
    id: 'axe', name: "Hunter's Axe", note: 'Balanced cuts',
    light: { dur: 0.42, from: 0.126, to: 0.231, range: 110, dmg: 22, kb: 170, st: 14 },
    heavy: { dur: 0.82, from: 0.4, to: 0.56, range: 140, dmg: 62, kb: 330, st: 32, lunge: 280 }
  },
  {
    id: 'scythe', name: 'Bone Scythe', note: 'Long reach, heavy spins both ways',
    light: { dur: 0.5, from: 0.17, to: 0.3, range: 158, dmg: 19, kb: 150, st: 16 },
    heavy: { dur: 0.95, from: 0.42, to: 0.68, range: 165, dmg: 46, kb: 260, st: 34, lunge: 120, both: true }
  },
  {
    id: 'gun', name: 'Blunderbuss', note: 'Spread shot; heavy is a point-blank blast',
    light: { dur: 0.38, fire: 0.07, range: 330, dmg: 17, kb: 120, st: 6, ammo: 1, spread: 3 },
    heavy: { dur: 0.75, fire: 0.28, range: 150, dmg: 58, kb: 460, st: 20, ammo: 3, spread: 9 }
  }
];
const AMMO_MAX = 8;
const weapon = () => WEAPONS[P.weapon];

/* ---------- Game state ---------- */

let mode = 'title', time = 0, camX = 600, shake = 0, hitStop = 0, redFlash = 0;
let wave = 0, toSpawn = 0, spawnT = 0, nextWaveT = 0, waveCleared = true, score = 0, kills = 0;
let banner = { text: '', sub: '', t: 99 }, swingCounter = 0, deadT = 0, playT = 0;
let enemies = [], particles = [], spikes = [], shocks = [], pickups = [];
let decals = [], fountains = [], screenSplats = [];
let gore = true, best = 0, fxLow = false, slowT = 0;
let zoom = 1.12, zoomKick = 0, bats = [], batT = 3;
try {
  best = +localStorage.getItem('hollow-lantern-best') || 0;
  gore = localStorage.getItem('hollow-lantern-gore') !== 'off';
} catch (e) { /* storage unavailable */ }

function newPlayer() {
  return {
    x: 700, y: GROUND, vx: 0, vy: 0, face: 1, hp: 100, maxHp: 100, hpLag: 100, st: 100, stDelay: 0,
    state: 'idle', t: 0, inv: 0, onGround: true, vials: 3, swing: 0, walk: 0, buf: null, bufT: 0,
    dodgeDir: 1, lunged: false, healed: false, trail: [], lx: 700, ly: GROUND - 40,
    blood: 0, bladeX: 700, bladeY: GROUND - 40, weapon: 0, ammo: AMMO_MAX, ammoT: 0, fired: false,
    muzzleX: 700, muzzleY: GROUND - 60, flash: 0, swapT: 9, lowHit: false
  };
}
let P = newPlayer();

function titleGhouls() {
  enemies = [];
  for (let i = 0; i < 5; i++) {
    const g = makeGhoul(400 + i * 520 + rand(-80, 80), 'idle');
    g.face = Math.random() < 0.5 ? 1 : -1;
    enemies.push(g);
  }
}

function reset() {
  P = newPlayer();
  cloth.ready = false;
  enemies = []; particles = []; spikes = []; shocks = []; pickups = [];
  decals = []; fountains = []; screenSplats = [];
  wave = 0; toSpawn = 0; score = 0; kills = 0; waveCleared = true; nextWaveT = 1.2;
  mode = 'play'; deadT = 0; playT = 0; redFlash = 0;
  camX = clamp(P.x - W / 2, 0, WORLD - W);
}

function showBanner(text, sub) { banner = { text, sub: sub || '', t: 0 }; }

function startWave() {
  wave++;
  waveCleared = false;
  if (wave % 3 === 0) {
    spawnBoss();
    toSpawn = 2 + wave;
    showBanner('The Hollow Bloom', 'Wave ' + wave);
  } else {
    toSpawn = 3 + wave * 2;
    showBanner('Wave ' + wave, wave === 1 ? 'The hollow stir in the fog' : 'More of them crawl from the mire');
  }
  spawnT = 0.6;
}

function makeGhoul(x, state) {
  const hp = 30 + wave * 6;
  return {
    type: 'ghoul', x, lane: rand(-3, 14), face: P.x > x ? 1 : -1, hp, maxHp: hp,
    state, t: 0, cd: rand(0.3, 1), speed: rand(50, 80) + wave * 3,
    pale: Math.random() < 0.6, cloth: Math.random() < 0.45, phase: rand(0, TAU), hitBy: 0, flash: 0, vx: 0, alpha: 1,
    scale: rand(0.9, 1.15), struck: false, headless: false, wounds: 0
  };
}

function spawnGhoul() {
  const side = Math.random() < 0.5 ? -1 : 1;
  const rise = Math.random() < 0.4;
  let x;
  if (rise) {
    x = clamp(P.x + side * rand(170, 320), 40, WORLD - 40);
  } else {
    x = side < 0 ? camX - 60 : camX + W + 60;
    if (x < 20 || x > WORLD - 20) x = side < 0 ? camX + W + 60 : camX - 60;
    x = clamp(x, 20, WORLD - 20);
  }
  enemies.push(makeGhoul(x, rise ? 'rise' : 'walk'));
  if (rise) burst(x, GROUND, 18, 'dust');
}

function spawnBoss() {
  const x = clamp(P.x + (P.x < WORLD / 2 ? 380 : -380), 150, WORLD - 150);
  const hp = 600 + wave * 70;
  const r = rng(wave * 13);
  const veins = [];
  for (let i = 0; i < 30; i++) {
    const a = r() * TAU, pts = [[0, 0]];
    let px = 0, py = 0, ang = a;
    for (let k = 0; k < 5; k++) {
      ang += (r() - 0.5) * 0.9;
      px += Math.cos(ang) * 14;
      py += Math.sin(ang) * 16;
      pts.push([px, py]);
    }
    veins.push(pts);
  }
  enemies.push({
    type: 'bloom', x, lane: -12, face: P.x > x ? 1 : -1, hp, maxHp: hp, state: 'emerge', t: 0, cd: 1.5,
    hitBy: 0, flash: 0, alpha: 1, lift: 0, veins, phase: 0
  });
  shake = 10;
  sfx.boss();
}

/* ---------- Particles and blood ---------- */

const PCOL = {
  ichor: ['#2a0f2c', '#3d1438', '#160818'],
  dust: ['rgba(120,105,150,0.5)', 'rgba(90,80,120,0.5)'],
  wisp: ['#8fb4ff', '#b9d0ff', '#6f8cff'],
  spark: ['#e8eeff', '#a9c1ff'],
  ember: ['#ff8a3a', '#ffb060', '#ff6a2a'],
  blood: ['#a50d1c', '#c8142a', '#860816', '#e0283a'],
  mist: ['rgba(140,10,24,0.14)'],
  chunk: ['#5e0a14', '#7a1220', '#47060e'],
  heal: ['#ffcf7a', '#ff9a6a']
};

function burst(x, y, n, type, dir = 0, power = 1) {
  if (!gore && (type === 'blood' || type === 'chunk' || type === 'mist')) type = 'ichor';
  for (let i = 0; i < n; i++) {
    const p = {
      x, y, vx: 0, vy: 0, life: 0, max: 1, size: 2, col: pick(PCOL[type]), g: 0, add: false, drag: 0.9,
      type, seed: Math.random() * 10, lane: rand(0, 12), rot: rand(0, TAU), spin: 0
    };
    switch (type) {
      case 'ichor':
        p.vx = (dir * rand(60, 260) + rand(-80, 80)) * power;
        p.vy = rand(-260, -40) * power;
        p.g = 900; p.max = rand(0.4, 0.9); p.size = rand(1.5, 3.5); p.drag = 0.98;
        break;
      case 'blood':
        p.vx = (dir * rand(80, 420) + rand(-90, 90)) * power;
        p.vy = rand(-380, -40) * power;
        p.g = 1100; p.max = 3; p.size = rand(1.2, 3.8); p.drag = 0.985;
        break;
      case 'chunk':
        p.vx = (dir * rand(60, 260) + rand(-70, 70)) * power;
        p.vy = rand(-420, -160) * power;
        p.g = 1200; p.max = 4; p.size = rand(2.5, 5); p.drag = 0.99; p.spin = rand(-14, 14);
        break;
      case 'mist':
        p.vx = dir * rand(20, 90) + rand(-30, 30); p.vy = rand(-40, 10); p.max = rand(0.5, 1.1); p.size = rand(8, 18); p.drag = 0.93;
        break;
      case 'dust':
        p.vx = rand(-90, 90) * power; p.vy = rand(-50, -5); p.max = rand(0.6, 1.3); p.size = rand(6, 14); p.drag = 0.92; p.y += rand(-4, 2);
        break;
      case 'wisp':
        p.vx = rand(-30, 30); p.vy = rand(-90, -20); p.max = rand(0.9, 2); p.size = rand(1.5, 3); p.add = true; p.drag = 0.97; p.x += rand(-14, 14); p.y += rand(-50, 0);
        break;
      case 'spark':
        p.vx = dir * rand(80, 320) + rand(-60, 60); p.vy = rand(-200, 60); p.max = rand(0.15, 0.35); p.size = rand(1, 2); p.add = true; p.drag = 0.9;
        break;
      case 'heal':
        p.vx = rand(-40, 40); p.vy = rand(-80, -20); p.max = rand(0.6, 1.1); p.size = rand(1.5, 2.5); p.add = true; p.x += rand(-14, 14); p.y += rand(-60, 0);
        break;
    }
    particles.push(p);
  }
}

function addDecal(x, y, rx, ry, col, a = 0.9, grow = 0) {
  if (!gore) return;
  decals.push({ x, y, rx: grow ? rx * 0.1 : rx, ry: grow ? ry * 0.1 : ry, max: rx, maxY: ry, grow, col, a, age: 0, rot: rand(-0.15, 0.15) });
  if (decals.length > 520) decals.splice(0, decals.length - 520);
}

function bleed(x, y, dir, amount, heavy) {
  burst(x, y, Math.round(amount), 'blood', dir, heavy ? 1.25 : 1);
  burst(x, y, heavy ? 6 : 3, 'mist', dir);
  if (heavy) burst(x, y, 4, 'chunk', dir);
}

function ambient(dt) {
  if (Math.random() < dt * 3) {
    particles.push({
      x: camX + rand(0, W), y: rand(GROUND - 150, GROUND - 8), vx: rand(-10, 10), vy: rand(-6, 6), life: 0, max: rand(4, 8),
      size: rand(1.1, 2), col: pick(['#bfe0ff', '#d8f0ff', '#a8c8ff']), g: 0, add: true, drag: 0.985, type: 'firefly', seed: Math.random() * 10
    });
  }
  if (mode !== 'title' && P.state !== 'dead' && Math.random() < dt * 14) {
    particles.push({
      x: P.lx + rand(-120, 120), y: P.ly + rand(-100, 60), vx: rand(-6, 6), vy: rand(-8, 4), life: 0, max: rand(2, 4),
      size: rand(0.5, 1.1), col: '#e4ecff', g: 0, add: true, drag: 1, type: 'mote', seed: Math.random() * 10
    });
  }
  if (Math.random() < dt * 18) {
    particles.push({
      x: camX + rand(-40, W + 40), y: rand(GROUND - 30, H), vx: rand(-10, 25), vy: rand(-45, -15), life: 0, max: rand(3, 7),
      size: rand(0.8, 2), col: pick(PCOL.ember), g: -4, add: true, drag: 1, type: 'ember', seed: Math.random() * 10
    });
  }
  for (const f of deco.flowers) {
    if (f.x < camX - 60 || f.x > camX + W + 60) continue;
    if (Math.random() < dt * 1.4) {
      particles.push({
        x: f.x + rand(-40, 40), y: GROUND - rand(0, 16), vx: rand(-8, 8), vy: rand(-22, -8), life: 0, max: rand(2, 4),
        size: rand(0.8, 1.6), col: '#cfe0ff', g: 0, add: true, drag: 1, type: 'ember', seed: Math.random() * 10
      });
    }
  }
}

function updateParticles(dt) {
  for (const p of particles) {
    p.life += dt;
    if (p.type === 'ember') p.vx += Math.sin(time * 2 + p.seed) * dt * 18;
    if (p.type === 'firefly') { p.vx += Math.sin(time * 1.7 + p.seed * 3) * dt * 40; p.vy += Math.cos(time * 1.3 + p.seed * 5) * dt * 30; }
    p.px = p.x;
    p.py = p.y;
    p.vy += p.g * dt;
    const d = Math.pow(p.drag, dt * 60);
    p.vx *= d;
    p.vy *= d;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
    const floor = GROUND + p.lane;
    if (p.type === 'ichor' && p.y > GROUND + 8) { p.y = GROUND + 8; p.vx *= 0.5; p.vy = 0; p.g = 0; }
    if ((p.type === 'blood' || p.type === 'chunk') && p.vy > 0 && p.y > floor) {
      if (p.type === 'blood') {
        const s = p.size * rand(1.3, 2.6) + Math.min(6, Math.abs(p.vx) * 0.01);
        addDecal(p.x, floor, s, s * rand(0.25, 0.45), p.col);
      } else {
        addDecal(p.x, floor, p.size * 2.2, p.size * 0.8, '#5a0a12');
        addDecal(p.x, floor - 1, p.size * 1.1, p.size * 0.7, p.col, 1);
      }
      p.life = p.max;
    }
  }
  particles = particles.filter(p => p.life < p.max);
  if (particles.length > 1400) particles.splice(0, particles.length - 1400);

  for (const d of decals) {
    d.age += dt;
    if (d.grow && d.rx < d.max) {
      d.rx = Math.min(d.max, d.rx + d.grow * dt);
      d.ry = d.rx * (d.maxY / d.max);
    }
    if (d.age > 50) d.a -= dt * 0.05;
  }
  decals = decals.filter(d => d.a > 0);

  for (const f of fountains) {
    f.t += dt;
    if (f.t < f.dur && Math.random() < dt * 60) {
      const k = 1 - f.t / f.dur;
      particles.push({
        x: f.x + rand(-2, 2), y: f.y, vx: f.dir * rand(10, 90) + rand(-40, 40), vy: -rand(200, 420) * k, life: 0, max: 3,
        size: rand(1.2, 3), col: pick(PCOL.blood), g: 1100, add: false, drag: 0.99, type: 'blood', seed: 0, lane: rand(0, 10), rot: 0, spin: 0
      });
    }
  }
  fountains = fountains.filter(f => f.t < f.dur);
  for (const s of screenSplats) s.a -= dt * 0.35;
  screenSplats = screenSplats.filter(s => s.a > 0);
}

/* ---------- Cloth: the hunter's cloak and scarf are verlet chains ---------- */

const CLOAK_ANCHORS = [[-10, -73], [-4, -75], [2, -75], [8, -73]];
const cloth = { ready: false, strands: [], scarf: null };

function makeChain(n, seg) {
  const nodes = [];
  for (let i = 0; i < n; i++) nodes.push({ x: 0, y: 0, px: 0, py: 0 });
  return { nodes, seg };
}

function clothChains() {
  const pose = playerPose(P);
  const list = cloth.strands.map((c, i) => [c, CLOAK_ANCHORS[i][0], CLOAK_ANCHORS[i][1] + pose.bob, true]);
  list.push([cloth.scarf, -3, -79 + pose.bob, false]);
  return [list, pose];
}

function resetCloth() {
  cloth.strands = CLOAK_ANCHORS.map((a, i) => makeChain(7, i === 0 || i === 3 ? 8.4 : 8.9));
  cloth.scarf = makeChain(7, 5.4);
  const [list, pose] = clothChains();
  for (const [c, ax, ay] of list) {
    const [x0, y0] = poseToWorld(P, pose, ax, ay);
    c.nodes.forEach((q, i) => { q.x = q.px = x0 - P.face * i * 2; q.y = q.py = y0 + i * c.seg * 0.9; });
  }
  cloth.ready = true;
}

function updateCloth(dt) {
  if (!cloth.ready) resetCloth();
  const [list, pose] = clothChains();
  const windA = Math.sin(time * 1.1) * 60 + Math.sin(time * 2.9) * 30 - 40;
  const dt2 = dt * dt;
  for (const [c, ax, ay, isCloak] of list) {
    const n = c.nodes;
    [n[0].x, n[0].y] = poseToWorld(P, pose, ax, ay);
    n[0].px = n[0].x;
    n[0].py = n[0].y;
    for (let i = 1; i < n.length; i++) {
      const q = n[i];
      const vx = (q.x - q.px) * 0.965, vy = (q.y - q.py) * 0.965;
      q.px = q.x;
      q.py = q.y;
      q.x += vx + windA * dt2 * (i / n.length);
      q.y += vy + 1000 * dt2;
    }
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < n.length; i++) {
        const a = n[i - 1], b = n[i];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        const diff = (d - c.seg) / d;
        if (i === 1) { b.x -= dx * diff; b.y -= dy * diff; }
        else { a.x += dx * diff * 0.5; a.y += dy * diff * 0.5; b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5; }
      }
      for (let i = 1; i < n.length; i++) {
        const q = n[i];
        if (q.y > GROUND + 5) q.y = GROUND + 5;
        if (isCloak) {
          // keep the cloak hanging behind the hunter rather than through his legs
          const lx = (q.x - P.x) * P.face;
          if (lx > 9) q.x = P.x + 9 * P.face;
        }
      }
    }
  }
}

function drawCloth(g) {
  if (!cloth.ready) return;
  const fx = P.x, fy = P.y + 6;
  const S = cloth.strands;
  const cg = g.createLinearGradient(0, -80, 0, 0);
  cg.addColorStop(0, '#2b2539');
  cg.addColorStop(1, '#08060d');
  g.fillStyle = cg;
  g.beginPath();
  const first = S[0].nodes, last = S[S.length - 1].nodes;
  g.moveTo(first[0].x - fx, first[0].y - fy);
  for (const q of first) g.lineTo(q.x - fx, q.y - fy);
  // jagged hem: dip up between the strand tips
  for (let k = 1; k < S.length; k++) {
    const b = S[k].nodes[S[k].nodes.length - 1];
    const ma = S[k - 1].nodes[S[k - 1].nodes.length - 2], mb = S[k].nodes[S[k].nodes.length - 2];
    g.lineTo((ma.x + mb.x) / 2 - fx, (ma.y + mb.y) / 2 - fy + 2);
    g.lineTo(b.x - fx, b.y - fy);
  }
  for (let i = last.length - 1; i >= 0; i--) g.lineTo(last[i].x - fx, last[i].y - fy);
  g.closePath();
  g.fill();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 1.4;
  for (let k = 1; k < S.length - 1; k++) {
    g.beginPath();
    S[k].nodes.forEach((q, i) => (i ? g.lineTo(q.x - fx, q.y - fy) : g.moveTo(q.x - fx, q.y - fy)));
    g.stroke();
  }
  g.strokeStyle = 'rgba(165,180,250,0.55)';
  g.lineWidth = 1;
  g.beginPath();
  first.forEach((q, i) => (i ? g.lineTo(q.x - fx, q.y - fy) : g.moveTo(q.x - fx, q.y - fy)));
  g.stroke();
  // scarf ribbon
  const sc = cloth.scarf.nodes;
  g.strokeStyle = '#2c1d2c';
  g.lineWidth = 5;
  g.beginPath();
  sc.forEach((q, i) => (i ? g.lineTo(q.x - fx, q.y - fy) : g.moveTo(q.x - fx, q.y - fy)));
  g.stroke();
  g.strokeStyle = 'rgba(200,150,190,0.25)';
  g.lineWidth = 1.2;
  g.stroke();
}

/* ---------- Sky life ---------- */

function updateBats(dt) {
  batT -= dt;
  if (batT <= 0) {
    batT = rand(7, 15);
    const dir = Math.random() < 0.5 ? 1 : -1, y0 = rand(50, 200), n = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      bats.push({ x: dir > 0 ? -30 - i * rand(14, 34) : W + 30 + i * rand(14, 34), y: y0 + rand(-30, 30), vx: dir * rand(110, 170), ph: rand(0, TAU), s: rand(0.6, 1.1) });
    }
  }
  for (const b of bats) {
    b.x += b.vx * dt;
    b.ph += dt * rand(14, 20);
    b.y += Math.sin(b.ph * 0.15) * 12 * dt;
  }
  bats = bats.filter(b => b.x > -400 && b.x < W + 400);
}

function drawBats() {
  ctx.fillStyle = '#120c1c';
  for (const b of bats) {
    const f = Math.sin(b.ph) * 7 * b.s, s = b.s;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.quadraticCurveTo(b.x - 6 * s, b.y - f - 3 * s, b.x - 13 * s, b.y - f * 1.3);
    ctx.lineTo(b.x - 9 * s, b.y - f * 0.4 + 1);
    ctx.lineTo(b.x - 5 * s, b.y + 1);
    ctx.lineTo(b.x, b.y + 3 * s);
    ctx.lineTo(b.x + 5 * s, b.y + 1);
    ctx.lineTo(b.x + 9 * s, b.y - f * 0.4 + 1);
    ctx.lineTo(b.x + 13 * s, b.y - f * 1.3);
    ctx.quadraticCurveTo(b.x + 6 * s, b.y - f - 3 * s, b.x, b.y);
    ctx.fill();
  }
}

/* ---------- Combat ---------- */

function damageEnemy(e, dmg, kb, heavy) {
  e.hp -= dmg;
  e.flash = 0.14;
  const dir = P.face;
  const hy = e.type === 'bloom' ? GROUND - 120 : GROUND - 55;
  if (e.type === 'bloom') {
    bleed(e.x - dir * 30, hy, dir, heavy ? 34 : 18, heavy);
    burst(e.x, hy, 6, 'ichor', dir);
  } else {
    bleed(e.x, hy, dir, heavy ? 40 : 22, heavy);
    e.wounds++;
  }
  burst(e.x, hy, 8, 'spark', dir);
  if (weapon().id !== 'gun') P.blood = Math.min(1, P.blood + (heavy ? 0.45 : 0.22));
  if (heavy) zoomKick = Math.max(zoomKick, 0.025);
  sfx.hit();
  if (gore) sfx.splat();
  hitStop = heavy ? 0.09 : 0.05;
  shake = Math.max(shake, heavy ? 9 : 4);
  if (e.type === 'ghoul') {
    e.vx = dir * kb;
    e.state = 'hurt';
    e.t = 0;
    e.face = -dir;
  } else if (heavy && e.state === 'walk') {
    e.x += dir * 12;
  }
  if (e.hp <= 0) killEnemy(e, heavy);
}

function killEnemy(e, heavy) {
  e.dead = true;
  e.state = 'dead';
  e.t = 0;
  kills++;
  const dir = P.face;
  if (e.type === 'ghoul') {
    score += 10 * wave + 5;
    burst(e.x, GROUND - 40, 12, 'wisp');
    sfx.die();
    if (gore) {
      addDecal(e.x + dir * 30, GROUND + e.lane + 2, rand(30, 46), rand(7, 10), '#4f050d', 0.95, 30);
      bleed(e.x, GROUND - 60, dir, 34, true);
      if (heavy && Math.random() < 0.7) {
        e.headless = true;
        const hx = e.x + e.face * 22 * e.scale, hy = GROUND - 92 * e.scale;
        particles.push({
          x: hx, y: hy, vx: dir * rand(120, 260), vy: -rand(320, 480), life: 0, max: 6, size: 1, col: e.pale ? '#8d86a0' : '#4a4458',
          g: 1200, add: false, drag: 0.995, type: 'head', seed: 0, lane: rand(2, 10), rot: 0, spin: dir * rand(8, 14), pale: e.pale
        });
        fountains.push({ x: hx, y: hy, dir: -dir, t: 0, dur: 0.9, e });
      }
    }
    if (Math.random() < 0.13) pickups.push({ x: e.x, y: GROUND - 50, vy: -200, t: 0 });
    const corpses = enemies.filter(o => o.dead && o.type === 'ghoul');
    if (corpses.length > 10) corpses[0].t = Math.max(corpses[0].t, 7);
  } else {
    score += 400 + wave * 100;
    burst(e.x, GROUND - 120, 60, 'wisp');
    bleed(e.x, GROUND - 130, 1, 60, true);
    bleed(e.x, GROUND - 130, -1, 60, true);
    addDecal(e.x, GROUND - 4, 120, 16, '#3e0410', 0.95, 50);
    shake = 18;
    sfx.boss();
    showBanner('Bloom Felled', 'The roots wither and fall still');
    pickups.push({ x: e.x - 30, y: GROUND - 120, vy: -260, t: 0 });
    pickups.push({ x: e.x + 30, y: GROUND - 120, vy: -260, t: 0 });
  }
}

function hittable(e) {
  if (e.dead || e.hitBy === P.swing || e.state === 'idle') return false;
  return !((e.state === 'rise' && e.t < 0.6) || (e.state === 'emerge' && e.t < 1.6));
}

function playerHits(range, dmg, kb, heavy, both) {
  for (const e of enemies) {
    if (!hittable(e)) continue;
    const half = e.type === 'bloom' ? 70 : 16;
    let dx = (e.x - P.x) * P.face;
    if (both) dx = Math.abs(dx);
    if (dx > -half - 12 && dx < range + half && P.y > GROUND - (e.type === 'bloom' ? 220 : 110)) {
      e.hitBy = P.swing;
      damageEnemy(e, dmg, kb, heavy);
    }
  }
}

function hurtPlayer(dmg, dir) {
  if (P.inv > 0 || P.state === 'dead') return;
  P.hp -= dmg;
  P.state = 'hurt';
  P.t = 0;
  P.vx = dir * 240;
  P.inv = 0.6;
  shake = Math.max(shake, 9);
  redFlash = 0.6;
  bleed(P.x, GROUND - 62, dir, 20, false);
  if (gore) {
    screenSplats.push({ img: pick(SPLATS), x: rand(80, W - 80), y: rand(60, H - 60), s: rand(0.7, 1.3), rot: rand(0, TAU), a: 0.85 });
  }
  sfx.hurt();
  if (P.hp <= 0) {
    P.hp = 0;
    P.state = 'dead';
    P.t = 0;
    mode = 'dead';
    deadT = 0;
    sfx.death();
    if (gore) {
      bleed(P.x, GROUND - 50, dir, 50, true);
      addDecal(P.x - 30, GROUND + 6, 44, 9, '#4f050d', 0.95, 22);
      for (let i = 0; i < 2; i++) screenSplats.push({ img: pick(SPLATS), x: rand(80, W - 80), y: rand(60, H - 60), s: rand(1, 1.6), rot: rand(0, TAU), a: 0.9 });
    }
    if (score > best) {
      best = score;
      try { localStorage.setItem('hollow-lantern-best', String(best)); } catch (e) { /* storage unavailable */ }
    }
  }
}

/* ---------- Updates ---------- */

function startAttack(mv) {
  const w = weapon();
  if (w.id === 'gun' && P.ammo < w.light.ammo) { sfx.click(); P.buf = null; return; }
  P.state = 'attack'; P.t = 0; P.st -= w.light.st; P.stDelay = 0.6; P.swing = ++swingCounter; P.buf = null; P.fired = false;
  if (mv) P.face = mv;
  if (w.id !== 'gun') sfx.swing();
}

function startHeavy(mv) {
  const w = weapon();
  if (w.id === 'gun' && P.ammo < w.heavy.ammo) { sfx.click(); P.buf = null; return; }
  P.state = 'heavy'; P.t = 0; P.st -= w.heavy.st; P.stDelay = 0.8; P.swing = ++swingCounter; P.buf = null; P.lunged = false; P.fired = false;
  if (mv) P.face = mv;
  if (w.id === 'gun') sfx.reload();
}

// The blunderbuss fires a spread of shot: it hits the nearest few enemies in front.
function fireGun(spec, heavy) {
  P.ammo -= spec.ammo;
  P.fired = true;
  P.flash = heavy ? 0.16 : 0.1;
  const dir = P.face;
  const mx = P.muzzleX, my = P.muzzleY;
  (heavy ? sfx.blast : sfx.shot)();
  shake = Math.max(shake, heavy ? 12 : 6);
  zoomKick = Math.max(zoomKick, heavy ? 0.03 : 0.012);
  for (let i = 0; i < (heavy ? 30 : 16); i++) {
    particles.push({
      x: mx, y: my, vx: dir * rand(300, 900), vy: rand(-140, 140), life: 0, max: rand(0.08, 0.2), size: rand(1, 2.2),
      col: pick(['#fff1c4', '#ffc46a', '#ff8a3a']), g: 0, add: true, drag: 0.85, type: 'spark', seed: 0
    });
  }
  for (let i = 0; i < (heavy ? 14 : 7); i++) {
    particles.push({
      x: mx + dir * rand(0, 30), y: my + rand(-6, 6), vx: dir * rand(20, 120), vy: rand(-40, -5), life: 0, max: rand(0.8, 1.6),
      size: rand(5, 11), col: 'rgba(150,140,170,0.35)', g: -10, add: false, drag: 0.94, type: 'dust', seed: 0
    });
  }
  const targets = enemies
    .filter(e => hittable(e) && (e.x - P.x) * dir > -10 && Math.abs(e.x - P.x) < spec.range + (e.type === 'bloom' ? 60 : 0))
    .sort((a, b) => Math.abs(a.x - P.x) - Math.abs(b.x - P.x))
    .slice(0, spec.spread);
  for (const e of targets) {
    const d = Math.abs(e.x - P.x);
    const fall = clamp(1.25 - d / spec.range, 0.45, 1.2);
    e.hitBy = P.swing;
    damageEnemy(e, Math.round(spec.dmg * fall), spec.kb * fall, heavy);
  }
  P.vx -= dir * (heavy ? 260 : 90);
}

function swapWeapon(i) {
  if (i === P.weapon) return;
  P.weapon = i;
  P.swapT = 0;
  sfx.swap();
}

function updatePlayer(dt) {
  const p = P;
  p.t += dt;
  p.inv = Math.max(0, p.inv - dt);
  p.hpLag = p.hpLag > p.hp ? Math.max(p.hp, p.hpLag - 35 * dt) : p.hp;
  p.bufT -= dt;
  if (p.bufT <= 0) p.buf = null;
  p.blood = Math.max(0, p.blood - dt * 0.02);
  if (gore && p.blood > 0.2 && WEAPONS[p.weapon].id !== 'gun' && Math.random() < dt * p.blood * 7) {
    particles.push({
      x: p.bladeX, y: p.bladeY, vx: rand(-10, 10), vy: rand(0, 40), life: 0, max: 3, size: rand(1, 2), col: pick(PCOL.blood),
      g: 1100, add: false, drag: 0.99, type: 'blood', seed: 0, lane: rand(2, 10), rot: 0, spin: 0
    });
  }
  const mv = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const busy = p.state === 'attack' || p.state === 'heavy' || p.state === 'dodge' || p.state === 'hurt' || p.state === 'heal' || p.state === 'dead';

  p.flash = Math.max(0, p.flash - dt);
  p.swapT += dt;
  p.ammoT += dt;
  if (p.ammo < AMMO_MAX && p.ammoT > 2.2) { p.ammo++; p.ammoT = 0; }
  if (pressed.swap) p.nextWeapon = ((p.nextWeapon == null ? p.weapon : p.nextWeapon) + 1) % WEAPONS.length;
  for (let i = 0; i < 3; i++) if (pressed['w' + (i + 1)]) p.nextWeapon = i;
  if (p.nextWeapon != null && (p.state === 'idle' || p.state === 'run' || p.state === 'crouch')) {
    swapWeapon(p.nextWeapon);
    p.nextWeapon = null;
  }
  const w = WEAPONS[p.weapon];
  if (!busy) {
    if (p.buf === 'attack' && p.st > 0) startAttack(mv);
    else if (p.buf === 'heavy' && p.st > 10 && p.onGround) startHeavy(mv);
    else if (p.buf === 'dodge' && p.st > 10 && p.onGround) {
      p.state = 'dodge'; p.t = 0; p.st -= 22; p.stDelay = 0.6; p.dodgeDir = mv || p.face; p.inv = 0.32; p.buf = null;
      sfx.roll();
      burst(p.x, GROUND, 6, 'dust');
    } else if (p.buf === 'heal' && p.vials > 0 && p.onGround) {
      p.state = 'heal'; p.t = 0; p.healed = false; p.buf = null;
    } else if (p.buf === 'jump' && p.onGround) {
      p.vy = -640; p.onGround = false; p.buf = null;
      sfx.jump();
      burst(p.x, GROUND, 5, 'dust');
    }
  }

  switch (p.state) {
    case 'crouch':
      if (mv) p.face = mv;
      p.vx = lerp(p.vx, mv * 80, damp(0.001, dt));
      if (!keys.down || !p.onGround) { p.state = 'idle'; p.t = 0; }
      break;
    case 'idle':
    case 'run':
      if (keys.down && p.onGround) { p.state = 'crouch'; p.t = 0; break; }
      if (mv) {
        p.face = mv;
        p.vx = lerp(p.vx, mv * 240, damp(0.0005, dt));
        p.state = 'run';
      } else {
        p.vx = lerp(p.vx, 0, damp(p.onGround ? 0.00002 : 0.05, dt));
        p.state = 'idle';
      }
      break;
    case 'attack': {
      const L = w.light;
      p.vx *= Math.pow(0.01, dt);
      if (w.id === 'gun') { if (!p.fired && p.t >= L.fire) fireGun(L, false); }
      else if (p.t >= L.from && p.t <= L.to) playerHits(L.range, L.dmg, L.kb, false);
      if (p.t > L.dur * 0.68 && p.buf === 'attack' && p.st > 0 && w.id !== 'gun') startAttack(mv);
      else if (p.t >= L.dur) { p.state = keys.down ? 'crouch' : 'idle'; p.t = 0; }
      break;
    }
    case 'heavy': {
      const Hv = w.heavy;
      const wind = w.id === 'gun' ? Hv.fire : Hv.from - 0.02;
      if (p.t < wind) p.vx *= Math.pow(0.001, dt);
      else if (!p.lunged) {
        p.lunged = true;
        if (Hv.lunge) { p.vx = p.face * Hv.lunge; sfx.heavy(); }
      } else p.vx *= Math.pow(0.02, dt);
      if (w.id === 'gun') { if (!p.fired && p.t >= Hv.fire) fireGun(Hv, true); }
      else if (p.t >= Hv.from && p.t <= Hv.to) playerHits(Hv.range, Hv.dmg, Hv.kb, true, Hv.both);
      if (w.id === 'scythe' && p.t > Hv.from && p.t < Hv.to && Math.random() < dt * 30) sfx.whiff();
      if (p.t >= Hv.dur) { p.state = 'idle'; p.t = 0; }
      break;
    }
    case 'dodge':
      p.vx = p.dodgeDir * lerp(500, 140, p.t / 0.4);
      p.trail.push({ x: p.x, a: 0.35 });
      if (p.t >= 0.4) { p.state = 'idle'; p.t = 0; p.face = p.dodgeDir; }
      break;
    case 'hurt':
      p.vx *= Math.pow(0.005, dt);
      if (p.t >= 0.32) { p.state = 'idle'; p.t = 0; }
      break;
    case 'heal':
      p.vx *= Math.pow(0.001, dt);
      if (p.t >= 0.45 && !p.healed) {
        p.healed = true; p.vials--; p.hp = Math.min(p.maxHp, p.hp + 45);
        sfx.heal();
        burst(p.x, GROUND - 20, 22, 'heal');
      }
      if (p.t >= 0.78) { p.state = 'idle'; p.t = 0; }
      break;
    case 'dead':
      p.vx *= Math.pow(0.01, dt);
      break;
  }

  p.vy += 1800 * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  if (p.y >= GROUND) {
    if (!p.onGround && p.vy > 400) burst(p.x, GROUND, 6, 'dust');
    p.y = GROUND; p.vy = 0; p.onGround = true;
  } else p.onGround = false;
  p.x = clamp(p.x, 30, WORLD - 30);

  const spending = p.state === 'attack' || p.state === 'heavy' || p.state === 'dodge';
  if (p.state === 'crouch') p.st = Math.min(100, p.st + 10 * dt);
  p.stDelay -= dt;
  if (!spending && p.stDelay <= 0) p.st = Math.min(100, p.st + 48 * dt);
  p.st = Math.max(0, p.st);
  p.walk += Math.abs(p.vx) * dt * 0.045;
  for (const tr of p.trail) tr.a -= dt * 1.4;
  p.trail = p.trail.filter(tr => tr.a > 0).slice(-6);
}

function updateGhoul(e, dt) {
  e.t += dt;
  e.flash = Math.max(0, e.flash - dt);
  const dx = P.x - e.x, dist = Math.abs(dx);
  if (!e.dead && e.wounds > 0 && gore && Math.random() < dt * e.wounds * 1.5) {
    particles.push({
      x: e.x + rand(-6, 6), y: GROUND - rand(40, 70), vx: rand(-15, 15), vy: rand(0, 30), life: 0, max: 3, size: rand(1, 2),
      col: pick(PCOL.blood), g: 1100, add: false, drag: 0.99, type: 'blood', seed: 0, lane: e.lane, rot: 0, spin: 0
    });
  }
  switch (e.state) {
    case 'idle':
      e.phase += dt;
      break;
    case 'rise':
      if (e.t >= 1) { e.state = 'walk'; e.t = 0; }
      break;
    case 'walk':
      e.face = dx > 0 ? 1 : -1;
      e.phase += dt * 6.5;
      if (dist > 46) e.x += e.face * e.speed * dt * (0.55 + 0.45 * Math.abs(Math.sin(e.phase)));
      e.cd -= dt;
      if (dist < 62 && e.cd <= 0 && P.state !== 'dead') { e.state = 'wind'; e.t = 0; e.struck = false; }
      if (dist < 500 && Math.random() < dt * 0.04) sfx.groan();
      break;
    case 'wind':
      if (e.t >= 0.48) { e.state = 'strike'; e.t = 0; sfx.claw(); }
      break;
    case 'strike':
      if (!e.struck && e.t > 0.05) {
        e.struck = true;
        if (Math.abs(P.x - (e.x + e.face * 30)) < 46 && P.y > GROUND - 60) {
          if (P.state === 'crouch') { sfx.whiff(); burst(P.x, GROUND - 40, 4, 'spark', e.face); }
          else hurtPlayer(10 + wave * 1.5, e.face);
        }
      }
      if (e.t >= 0.2) { e.state = 'recover'; e.t = 0; }
      break;
    case 'recover':
      if (e.t >= 0.55) { e.state = 'walk'; e.t = 0; e.cd = rand(0.5, 1.4); }
      break;
    case 'hurt':
      e.x += e.vx * dt;
      e.vx *= Math.pow(0.003, dt);
      if (e.t >= 0.32) { e.state = 'walk'; e.t = 0; e.cd = Math.max(e.cd, 0.3); }
      break;
    case 'dead':
      e.x += e.vx * dt;
      e.vx *= Math.pow(0.002, dt);
      e.alpha = e.t < 7 ? 1 : 1 - (e.t - 7) / 1.5;
      break;
  }
  e.x = clamp(e.x, 20, WORLD - 20);
}

function updateBloom(b, dt) {
  b.t += dt;
  b.flash = Math.max(0, b.flash - dt);
  b.phase += dt;
  const dx = P.x - b.x, dist = Math.abs(dx);
  const enraged = b.hp < b.maxHp * 0.5;
  const sp = enraged ? 1.35 : 1;
  switch (b.state) {
    case 'emerge':
      if (Math.random() < dt * 30) burst(b.x + rand(-80, 80), GROUND, 2, 'dust');
      shake = Math.max(shake, 3);
      if (b.t >= 2.2) { b.state = 'walk'; b.t = 0; }
      break;
    case 'walk':
      b.face = dx > 0 ? 1 : -1;
      if (dist > 140) b.x += b.face * 48 * sp * dt;
      b.cd -= dt;
      if (b.cd <= 0 && P.state !== 'dead') {
        b.t = 0;
        if (dist < 230) b.state = 'slamWind';
        else { b.state = 'rootWind'; sfx.spike(); }
      }
      b.lift = lerp(b.lift, 0, damp(0.01, dt));
      break;
    case 'slamWind': {
      const d = 0.9 / sp;
      b.lift = -ease(Math.min(1, b.t / d)) * 46;
      if (b.t >= d) {
        b.state = 'slam'; b.t = 0; b.lift = 6;
        sfx.slam();
        shake = 16;
        burst(b.x - 60, GROUND, 14, 'dust');
        burst(b.x + 60, GROUND, 14, 'dust');
        shocks.push({ x: b.x - 70, dir: -1, t: 0, hit: false });
        shocks.push({ x: b.x + 70, dir: 1, t: 0, hit: false });
        if (dist < 115 && P.y > GROUND - 40) hurtPlayer(26, dx > 0 ? 1 : -1);
      }
      break;
    }
    case 'slam':
      if (b.t >= 0.25) { b.state = 'recover'; b.t = 0; }
      break;
    case 'rootWind':
      if (b.t < 0.02) {
        const n = enraged ? 5 : 3;
        for (let i = 0; i < n; i++) spikes.push({ x: clamp(P.x + (i - (n - 1) / 2) * 85 + rand(-10, 10), 30, WORLD - 30), t: -i * 0.12, hit: false });
      }
      b.lift = Math.sin(b.t * 12) * 3;
      if (b.t >= 1.3) { b.state = 'recover'; b.t = 0; }
      break;
    case 'recover':
      b.lift = lerp(b.lift, 0, damp(0.01, dt));
      if (b.t >= 0.9 / sp) { b.state = 'walk'; b.t = 0; b.cd = rand(0.8, 1.6) / sp; }
      break;
    case 'dead':
      b.alpha = 1 - b.t / 2.2;
      if (Math.random() < dt * 40) burst(b.x + rand(-60, 60), GROUND - rand(20, 200), 1, 'wisp');
      break;
  }
}

function updateHazards(dt) {
  for (const s of spikes) {
    s.t += dt;
    if (s.t > 0 && s.t < 0.8 && Math.random() < dt * 20) burst(s.x, GROUND, 1, 'dust');
    if (s.t >= 0.8 && !s.sounded) { s.sounded = true; shake = Math.max(shake, 4); burst(s.x, GROUND, 8, 'dust'); }
    if (!s.hit && s.t >= 0.8 && s.t < 1.15 && Math.abs(P.x - s.x) < 32 && P.y > GROUND - 75) {
      s.hit = true;
      s.bloody = true;
      hurtPlayer(20 + wave, P.x > s.x ? 1 : -1);
    }
  }
  spikes = spikes.filter(s => s.t < 1.6);
  for (const s of shocks) {
    s.t += dt;
    s.x += s.dir * 380 * dt;
    if (Math.random() < dt * 30) burst(s.x, GROUND, 1, 'dust');
    if (!s.hit && Math.abs(P.x - s.x) < 24 && P.y > GROUND - 26) { s.hit = true; hurtPlayer(16 + wave, s.dir); }
  }
  shocks = shocks.filter(s => s.t < 1.5);
}

function updatePickups(dt) {
  for (const k of pickups) {
    k.t += dt;
    k.vy += 900 * dt;
    k.y = Math.min(GROUND - 10, k.y + k.vy * dt);
    if (k.y >= GROUND - 10) k.vy = 0;
    if (!k.taken && P.state !== 'dead' && Math.abs(P.x - k.x) < 28 && k.t > 0.4) {
      k.taken = true;
      P.vials = Math.min(5, P.vials + 1);
      sfx.pick();
      burst(k.x, k.y, 10, 'heal');
    }
  }
  pickups = pickups.filter(k => !k.taken && k.t < 25);
}

function updateWaves(dt) {
  if (mode !== 'play') return;
  const alive = enemies.filter(e => !e.dead);
  if (toSpawn > 0) {
    spawnT -= dt;
    const cap = 5 + Math.floor(wave / 2);
    if (spawnT <= 0 && alive.filter(e => e.type === 'ghoul').length < cap) {
      spawnGhoul();
      toSpawn--;
      spawnT = rand(0.5, 1.4);
    }
  } else if (alive.length === 0) {
    if (!waveCleared) {
      waveCleared = true;
      nextWaveT = 3;
      if (wave % 3 !== 0) showBanner('Wave cleared', 'Catch your breath, hunter');
    } else {
      nextWaveT -= dt;
      if (nextWaveT <= 0) startWave();
    }
  }
}

function update(dt) {
  time += dt;
  if (pressed.mute) {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.55;
  }
  if (pressed.gore) {
    gore = !gore;
    if (!gore) { decals = []; screenSplats = []; fountains = []; }
    try { localStorage.setItem('hollow-lantern-gore', gore ? 'on' : 'off'); } catch (e) { /* storage unavailable */ }
  }
  if (mode === 'title') {
    if (!enemies.length) titleGhouls();
    camX = 300 + (Math.sin(time * 0.06) * 0.5 + 0.5) * (WORLD - W - 600);
    P.x = camX + W * 0.5;
    P.face = Math.cos(time * 0.06) >= 0 ? 1 : -1;
    for (const e of enemies) updateGhoul(e, dt);
    if (pressed.start || pressed.attack || pressed.jump) reset();
    else updateCloth(dt);
    updateBats(dt);
    zoom = lerp(zoom, 1.1, damp(0.3, dt));
    ambient(dt);
    updateParticles(dt);
    return;
  }
  if (pressed.pause && (mode === 'play' || mode === 'paused')) mode = mode === 'play' ? 'paused' : 'play';
  if (mode === 'paused') return;

  if (P.state !== 'dead') {
    for (const a of ['attack', 'heavy', 'dodge', 'heal', 'jump']) if (pressed[a]) { P.buf = a; P.bufT = 0.25; }
  }
  if (hitStop > 0) { hitStop -= dt; return; }

  playT += dt;
  updatePlayer(dt);
  updateCloth(dt);
  updateBats(dt);
  const bossUp = enemies.some(e => e.type === 'bloom' && !e.dead);
  zoom = lerp(zoom, bossUp ? 1.04 : 1.16, damp(0.3, dt));
  zoomKick *= Math.pow(0.002, dt);
  for (const e of enemies) (e.type === 'ghoul' ? updateGhoul : updateBloom)(e, dt);
  const gs = enemies.filter(e => e.type === 'ghoul' && !e.dead);
  for (let i = 0; i < gs.length; i++) {
    for (let j = i + 1; j < gs.length; j++) {
      const d = gs[j].x - gs[i].x;
      if (Math.abs(d) < 24) {
        const push = (24 - Math.abs(d)) * 0.5 * (d >= 0 ? 1 : -1);
        gs[i].x -= push * 0.5;
        gs[j].x += push * 0.5;
      }
    }
  }
  enemies = enemies.filter(e => !(e.dead && e.alpha <= 0));
  updateHazards(dt);
  updatePickups(dt);
  updateWaves(dt);
  updateParticles(dt);
  ambient(dt);

  const target = clamp(P.x - W / 2 + P.face * 70, 0, WORLD - W);
  camX = lerp(camX, target, damp(0.03, dt));
  shake *= Math.pow(0.004, dt);
  redFlash = Math.max(0, redFlash - dt * 1.4);
  banner.t += dt;
  if (mode === 'dead') {
    deadT += dt;
    if (deadT > 1.8 && (pressed.start || pressed.attack)) reset();
  }
}

/* ---------- Drawing: world ---------- */

function drawTiled(g, img, f, y, extra = 0) {
  const w = img.w;
  let off = -((camX * f + extra) % w);
  if (off > 0) off -= w;
  for (let x = off; x < W; x += w) g.drawImage(img, x, y, w, img.h);
}

function drawFogBand(img, f, y, speed, alpha) {
  ctx.globalAlpha = alpha;
  drawTiled(ctx, img, f, y, time * speed);
  ctx.globalAlpha = 1;
}

function drawSky() {
  ctx.drawImage(SKY, 0, 0, W, H);
  gg.fillStyle = 'rgba(230,210,255,0.35)';
  gg.beginPath();
  gg.arc(MOON.x, MOON.y, 36, 0, TAU);
  gg.fill();
  ctx.globalAlpha = 0.85;
  drawTiled(ctx, CLOUDS, 0.015, 0, time * 4);
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = (POST ? 0.25 : 0.55) + Math.sin(time * 0.4) * 0.1;
  ctx.drawImage(RAYS, 0, 0, W, H);
  ctx.restore();
}

function drawGround() {
  drawTiled(ctx, GROUND_TEX, 1, GROUND - 14);
  const sheen = ctx.createLinearGradient(0, GROUND - 6, 0, GROUND + 40);
  sheen.addColorStop(0, 'rgba(120,135,215,0.2)');
  sheen.addColorStop(1, 'rgba(120,135,215,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, GROUND - 6, W, 46);
}

function drawPuddles() {
  for (const p of deco.puddles) {
    const sx = p.x - camX;
    if (sx < -100 || sx > W + 100) continue;
    const y = GROUND + p.y;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(sx, y, p.w, p.w * 0.12, 0, 0, TAU);
    const pg = ctx.createLinearGradient(0, y - 6, 0, y + 6);
    pg.addColorStop(0, 'rgba(150,130,215,0.75)');
    pg.addColorStop(1, 'rgba(35,30,75,0.85)');
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.clip();
    // reflection of the hunter's lantern
    const d = Math.abs(P.lx - p.x);
    if (d < 260) {
      const k = 1 - d / 260;
      const rx = P.lx - camX;
      const rg = ctx.createRadialGradient(rx, y, 0, rx, y, 50);
      rg.addColorStop(0, `rgba(200,225,255,${0.7 * k})`);
      rg.addColorStop(1, 'rgba(200,225,255,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(rx - 50, y - 10, 100, 20);
    }
    ctx.strokeStyle = 'rgba(210,200,255,0.35)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 3; i++) {
      const rr = ((time * 14 + i * 12 + p.x) % 36);
      ctx.globalAlpha = 1 - rr / 36;
      ctx.beginPath();
      ctx.ellipse(sx + Math.sin(p.x + i) * p.w * 0.4, y, rr, rr * 0.12, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawDecals(mul = 1) {
  for (const d of decals) {
    const sx = d.x - camX;
    if (sx < -140 || sx > W + 140) continue;
    ctx.globalAlpha = clamp(d.a, 0, 1) * mul;
    ctx.fillStyle = d.col;
    ctx.beginPath();
    ctx.ellipse(sx, d.y, d.rx, d.ry, d.rot, 0, TAU);
    ctx.fill();
    if (d.rx > 14) {
      ctx.fillStyle = 'rgba(255,110,120,0.12)';
      ctx.beginPath();
      ctx.ellipse(sx - d.rx * 0.2, d.y - d.ry * 0.3, d.rx * 0.5, d.ry * 0.3, d.rot, 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawLamp(x) {
  const sx = x - camX;
  if (sx < -80 || sx > W + 80) return;
  ctx.strokeStyle = '#120f18';
  ctx.lineWidth = 5;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(sx, GROUND + 4);
  ctx.lineTo(sx, GROUND - 130);
  ctx.quadraticCurveTo(sx + 4, GROUND - 146, sx + 26, GROUND - 140);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(160,170,240,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx - 2, GROUND + 4);
  ctx.lineTo(sx - 2, GROUND - 130);
  ctx.stroke();
  ctx.strokeStyle = '#120f18';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx + 24, GROUND - 140);
  ctx.lineTo(sx + 24, GROUND - 128);
  ctx.stroke();
  ctx.fillStyle = '#16131d';
  ctx.fillRect(sx + 17, GROUND - 129, 14, 18);
  const fl = 10 + Math.sin(time * 9 + x) * 1.2;
  for (const g of [ctx, gg]) {
    g.fillStyle = '#e4f1ff';
    g.fillRect(sx + 20, GROUND - 126, 8, fl);
  }
  ctx.fillStyle = '#16131d';
  ctx.fillRect(sx + 23.3, GROUND - 129, 1.4, 18);
}

function drawStone(s) {
  const sx = s.x - camX;
  if (sx < -60 || sx > W + 60) return;
  ctx.save();
  ctx.translate(sx, GROUND + 4);
  ctx.rotate(s.tilt);
  ctx.scale(s.s, s.s);
  const sg = ctx.createLinearGradient(-14, -46, 14, 0);
  sg.addColorStop(0, '#3a3250');
  sg.addColorStop(1, '#16121f');
  ctx.fillStyle = sg;
  ctx.strokeStyle = 'rgba(170,165,230,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (s.kind === 0) {
    ctx.moveTo(-12, 0); ctx.lineTo(-12, -32); ctx.arc(0, -32, 12, Math.PI, 0); ctx.lineTo(12, 0);
  } else if (s.kind === 1) {
    ctx.rect(-3, -46, 6, 46); ctx.rect(-14, -36, 28, 6);
  } else {
    ctx.moveTo(-10, 0); ctx.lineTo(-9, -22); ctx.lineTo(-2, -26); ctx.lineTo(4, -20); ctx.lineTo(10, -24); ctx.lineTo(11, 0);
  }
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(80,110,90,0.25)';
  ctx.beginPath();
  ctx.ellipse(-4, -6, 8, 4, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawGrass(front) {
  const step = front ? 3 : 1;
  ctx.lineCap = 'round';
  const passes = front ? [['#09070f', false]] : [['#1b1628', false], ['#463f66', true]];
  for (const [col, paleOnly] of passes) {
    ctx.strokeStyle = col;
    ctx.lineWidth = front ? 2.2 : 1.3;
    ctx.beginPath();
    for (let i = 0; i < deco.grass.length; i += step) {
      const gr = deco.grass[i];
      const sx = gr.x - camX;
      if (sx < -20 || sx > W + 20) continue;
      if (paleOnly && !gr.pale) continue;
      const base = GROUND + (front ? 14 : 2);
      const h = front ? gr.h * 0.9 : gr.h;
      // grass bends away from whoever walks through it
      let push = 0;
      const pd = gr.x - P.x;
      if (Math.abs(pd) < 30 && mode !== 'title') push = (30 - Math.abs(pd)) * 0.5 * Math.sign(pd);
      const sway = Math.sin(time * 1.6 + gr.x * 0.03) * 3 + push;
      for (let b = -1; b <= 1; b++) {
        ctx.moveTo(sx + b * 3, base);
        ctx.quadraticCurveTo(sx + b * 3 + gr.lean * h * 0.4, base - h * 0.6, sx + b * 4 + gr.lean * h + sway, base - h * (1 - Math.abs(b) * 0.25));
      }
    }
    ctx.stroke();
  }
}

function drawFlowers() {
  for (const f of deco.flowers) {
    const sx = f.x - camX;
    if (sx < -60 || sx > W + 60) continue;
    for (const d of f.dots) {
      const tw = 0.6 + Math.sin(time * 2 + d.ph) * 0.4;
      const x = sx + d.dx, y = GROUND + d.dy;
      ctx.fillStyle = `rgba(220,232,255,${0.55 + tw * 0.45})`;
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU + d.ph;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * d.s, y + Math.sin(a) * d.s, d.s * 0.8, d.s * 0.5, a, 0, TAU);
        ctx.fill();
      }
      gg.fillStyle = `rgba(160,195,255,${0.5 * tw})`;
      gg.beginPath();
      gg.arc(x, y, d.s * 2.2, 0, TAU);
      gg.fill();
    }
  }
}

/* ---------- Drawing: characters ---------- */

// Each actor is drawn into its own buffer, lit there by the lantern and moon, then composited.
const [ABUF, ab] = mk(340, 340);
const [BBUF, bb] = mk(480, 420);

function renderActor(buf, g, ox, oy, wx, footY, drawFn, opts = {}) {
  const sx = wx - camX;
  if (sx < -buf.w || sx > W + buf.w) return;
  g.save();
  g.setTransform(R, 0, 0, R, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, buf.w, buf.h);
  g.translate(ox, oy);
  drawFn(g);
  g.restore();
  if (opts.light !== false) {
    g.save();
    g.setTransform(R, 0, 0, R, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    const lights = [{ x: P.lx, y: P.ly, r: 230, c: '160,190,255', k: P.state === 'dead' ? 0.3 : 0.6 }];
    if (!fxLow) for (const l of deco.lamps) if (Math.abs(l.x + 24 - wx) < 260) lights.push({ x: l.x + 24, y: GROUND - 120, r: 240, c: '150,180,255', k: 0.45 });
    for (const l of lights) {
      const lx = l.x - wx + ox, ly = l.y - footY + oy;
      const lgd = g.createRadialGradient(lx, ly, 0, lx, ly, l.r);
      lgd.addColorStop(0, `rgba(${l.c},${l.k})`);
      lgd.addColorStop(1, `rgba(${l.c},0)`);
      g.fillStyle = lgd;
      g.fillRect(0, 0, buf.w, buf.h);
    }
    const top = g.createLinearGradient(0, oy - 220, 0, oy);
    top.addColorStop(0, 'rgba(200,170,255,0.16)');
    top.addColorStop(0.5, 'rgba(200,170,255,0)');
    top.addColorStop(0.85, 'rgba(0,0,0,0)');
    top.addColorStop(1, 'rgba(0,0,0,0.4)');
    g.fillStyle = top;
    g.fillRect(0, 0, buf.w, buf.h);
    if (opts.flash) {
      g.fillStyle = `rgba(255,235,240,${opts.flash})`;
      g.fillRect(0, 0, buf.w, buf.h);
    }
    g.restore();
  }
  ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
  ctx.drawImage(buf, sx - ox, footY - oy, buf.w, buf.h);
  ctx.globalAlpha = 1;
}

function drawShadow(wx, footY, w, alpha = 0.55) {
  const sx = wx - camX;
  if (sx < -200 || sx > W + 200) return;
  const away = clamp((wx - P.lx) * 0.18, -26, 26);
  const sg = ctx.createRadialGradient(sx + away, footY, 0, sx + away, footY, w);
  sg.addColorStop(0, `rgba(0,0,0,${alpha})`);
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.ellipse(sx + away, footY, w, w * 0.16, 0, 0, TAU);
  ctx.fill();
}

function playerPose(p) {
  const st = p.state, t = p.t;
  const run = clamp(Math.abs(p.vx) / 240, 0, 1);
  const w = WEAPONS[p.weapon];
  let crouch = 0, tilt = 0;
  if (st === 'heavy') {
    const wind = w.id === 'gun' ? w.heavy.fire : w.heavy.from;
    if (t < wind) crouch = ease(t / wind) * 6;
  }
  if (st === 'attack') tilt = Math.sin(clamp(t / w.light.dur, 0, 1) * Math.PI) * (w.id === 'gun' ? -0.05 : 0.12);
  if (st === 'dodge') { crouch = 16; tilt = 0.45; }
  if (st === 'crouch') { crouch = 24 + Math.sin(time * 2) * 0.6; tilt = 0.14; }
  if (st === 'hurt') tilt = -0.18;
  if (st === 'heal') crouch = 5;
  if (st === 'run') tilt = 0.08 * run;
  if (st === 'dead') tilt = -Math.min(1, t / 0.7) * 1.45;
  const bob = st === 'run' ? Math.abs(Math.sin(p.walk * 2)) * -2.5 : Math.sin(time * 2) * 0.6;
  return { crouch, tilt, bob };
}

function poseToWorld(p, pose, lx, ly) {
  const c = Math.cos(pose.tilt), s = Math.sin(pose.tilt);
  return [p.x + (lx * c - (ly + pose.crouch) * s) * p.face, p.y + 6 + lx * s + (ly + pose.crouch) * c];
}

function weaponAngle(p) {
  const w = WEAPONS[p.weapon], t = p.t;
  if (w.id === 'gun') {
    if (p.state === 'attack' || p.state === 'heavy') {
      const fire = (p.state === 'attack' ? w.light : w.heavy).fire;
      if (t < fire) return lerp(0.3, -0.04, ease(t / fire));
      const k = (t - fire) / 0.32;
      return -0.04 - (p.state === 'heavy' ? 1 : 0.55) * Math.max(0, 1 - k) * Math.min(1, k * 8);
    }
    if (p.state === 'crouch') return -0.02;
    if (p.state === 'run') return 0.55 + Math.sin(p.walk * 2) * 0.05;
    if (p.state === 'idle') return 0.32 + Math.sin(time * 1.8) * 0.03;
  }
  if (w.id === 'scythe') {
    if (p.state === 'attack') {
      const k = t / w.light.dur;
      if (k < 0.34) return lerp(0.35, -2.3, ease(k / 0.34));
      if (k < 0.6) return lerp(-2.3, 1.25, ease((k - 0.34) / 0.26));
      return lerp(1.25, 0.35, ease(Math.min(1, (k - 0.6) / 0.4)));
    }
    if (p.state === 'heavy') {
      const Hv = w.heavy;
      if (t < Hv.from) return lerp(0.35, -1.6, ease(t / Hv.from));
      if (t < Hv.to) return -1.6 + ease((t - Hv.from) / (Hv.to - Hv.from)) * (TAU + 0.9);
      return lerp(TAU - 0.7, TAU + 0.35, ease(Math.min(1, (t - Hv.to) / (Hv.dur - Hv.to))));
    }
  }
  if (p.state === 'crouch') return 0.75;
  return axeAngle(p);
}

function axeAngle(p) {
  const t = p.t;
  switch (p.state) {
    case 'attack': {
      const k = t / 0.42;
      if (k < 0.3) return lerp(0.35, -2.1, ease(k / 0.3));
      if (k < 0.55) return lerp(-2.1, 1.05, ease((k - 0.3) / 0.25));
      return lerp(1.05, 0.35, ease(Math.min(1, (k - 0.55) / 0.45)));
    }
    case 'heavy': {
      if (t < 0.38) return lerp(0.35, -2.75, ease(t / 0.38));
      if (t < 0.52) return lerp(-2.75, 1.3, ease((t - 0.38) / 0.14));
      return lerp(1.3, 0.35, ease(Math.min(1, (t - 0.52) / 0.3)));
    }
    case 'dodge': return 0.9;
    case 'hurt': return -0.4;
    case 'heal': return 0.9;
    case 'dead': return 1.4;
    case 'run': return 0.55 + Math.sin(p.walk * 2) * 0.06;
    default: return 0.35 + Math.sin(time * 1.8) * 0.03;
  }
}

function bladePath(g) {
  g.beginPath();
  g.moveTo(98, 0);
  g.quadraticCurveTo(92, 18, 80, 42);
  g.quadraticCurveTo(118, 48, 142, 22);
  g.quadraticCurveTo(128, 10, 121, 0);
  g.closePath();
}

function drawAxe(g, a, blood) {
  g.save();
  g.rotate(a);
  g.lineCap = 'round';
  const shaft = g.createLinearGradient(0, -2, 0, 2);
  shaft.addColorStop(0, '#5a4234');
  shaft.addColorStop(1, '#1c130f');
  g.strokeStyle = shaft;
  g.lineWidth = 4.2;
  g.beginPath();
  g.moveTo(-38, 0);
  g.lineTo(118, 0);
  g.stroke();
  g.strokeStyle = '#2b1f22';
  g.lineWidth = 5;
  for (let x = 30; x < 92; x += 8) {
    g.beginPath();
    g.moveTo(x, -1.4);
    g.lineTo(x + 3, 1.4);
    g.stroke();
  }
  g.fillStyle = '#7b7688';
  for (const x of [-38, 0, 92]) g.fillRect(x - 2, -3, 4, 6);
  g.fillStyle = '#c8c4d8';
  for (const x of [-38, 0, 92]) g.fillRect(x - 2, -3, 4, 1.2);
  // crescent blade
  const steel = g.createLinearGradient(88, 4, 132, 40);
  steel.addColorStop(0, '#20222e');
  steel.addColorStop(0.6, '#4a4f66');
  steel.addColorStop(1, '#8c93b4');
  g.fillStyle = steel;
  bladePath(g);
  g.fill();
  if (blood > 0) {
    g.save();
    bladePath(g);
    g.clip();
    g.globalAlpha = Math.min(1, blood * 1.2);
    g.fillStyle = '#6a0a14';
    g.beginPath();
    g.ellipse(124, 30, 24 * (0.5 + blood), 16 * (0.5 + blood), -0.6, 0, TAU);
    g.fill();
    g.fillStyle = '#a3121f';
    g.beginPath();
    g.ellipse(130, 26, 12 * (0.4 + blood), 7 * (0.4 + blood), -0.6, 0, TAU);
    g.fill();
    g.fillStyle = '#7a0a14';
    for (let i = 0; i < 4; i++) g.fillRect(96 + i * 9, 10 + i * 6, 2, 10 + blood * 14);
    g.restore();
  }
  g.strokeStyle = 'rgba(230,236,255,0.95)';
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(81, 41);
  g.quadraticCurveTo(118, 47, 141, 22);
  g.stroke();
  g.strokeStyle = 'rgba(150,155,200,0.55)';
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(100, 8);
  g.quadraticCurveTo(108, 22, 100, 34);
  g.moveTo(110, 8);
  g.quadraticCurveTo(122, 20, 120, 34);
  g.moveTo(104, 16);
  g.arc(106, 18, 3, 0, TAU);
  g.stroke();
  g.fillStyle = '#23242f';
  g.beginPath();
  g.moveTo(104, 0);
  g.lineTo(112, -16);
  g.lineTo(117, 0);
  g.moveTo(118, -3);
  g.lineTo(134, -1);
  g.lineTo(118, 3);
  g.fill();
  g.restore();
}

function drawScythe(g, a, blood) {
  g.save();
  g.rotate(a);
  g.lineCap = 'round';
  const shaft = g.createLinearGradient(0, -2, 0, 2);
  shaft.addColorStop(0, '#4d3a30');
  shaft.addColorStop(1, '#16100c');
  g.strokeStyle = shaft;
  g.lineWidth = 3.6;
  g.beginPath();
  g.moveTo(-42, 0);
  g.quadraticCurveTo(60, -4, 152, 0);
  g.stroke();
  // vertebrae bound along the haft
  for (let x = 40; x < 140; x += 11) {
    g.fillStyle = '#b9b1c6';
    g.beginPath();
    g.ellipse(x, -0.5, 3.2, 2.6, 0, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(30,20,40,0.6)';
    g.fillRect(x - 0.5, -2.5, 1, 4);
  }
  const steel = g.createLinearGradient(100, 0, 150, 60);
  steel.addColorStop(0, '#1b1d28');
  steel.addColorStop(0.5, '#454a62');
  steel.addColorStop(1, '#9aa1c2');
  g.fillStyle = steel;
  g.beginPath();
  g.moveTo(148, -4);
  g.quadraticCurveTo(166, 44, 86, 70);
  g.quadraticCurveTo(140, 38, 140, 4);
  g.closePath();
  g.fill();
  if (blood > 0) {
    g.fillStyle = `rgba(120,8,22,${Math.min(0.95, blood)})`;
    g.beginPath();
    g.moveTo(144, 8);
    g.quadraticCurveTo(140, 40, 92, 66);
    g.quadraticCurveTo(128, 48, 138 + blood * 6, 14);
    g.fill();
  }
  g.strokeStyle = 'rgba(232,238,255,0.95)';
  g.lineWidth = 1.8;
  g.beginPath();
  g.moveTo(140, 5);
  g.quadraticCurveTo(140, 38, 88, 69);
  g.stroke();
  g.fillStyle = '#d6cee2';
  g.beginPath();
  g.arc(150, -2, 5, 0, TAU);
  g.fill();
  g.fillStyle = '#120c16';
  g.fillRect(148, -3.5, 1.5, 2);
  g.fillRect(151, -3.5, 1.5, 2);
  g.restore();
}

function drawGun(g, a) {
  g.save();
  g.rotate(a);
  const wood = g.createLinearGradient(0, -6, 0, 8);
  wood.addColorStop(0, '#6a4a34');
  wood.addColorStop(1, '#22150e');
  g.fillStyle = wood;
  g.beginPath();
  g.moveTo(-26, -1);
  g.lineTo(8, -4);
  g.lineTo(10, 4);
  g.lineTo(-6, 5);
  g.lineTo(-24, 11);
  g.closePath();
  g.fill();
  const iron = g.createLinearGradient(0, -4, 0, 4);
  iron.addColorStop(0, '#8d90a6');
  iron.addColorStop(0.5, '#3a3c4c');
  iron.addColorStop(1, '#16161e');
  g.fillStyle = iron;
  g.fillRect(4, -3.5, 50, 6);
  g.beginPath();
  g.moveTo(52, -4);
  g.lineTo(64, -8);
  g.lineTo(64, 7);
  g.lineTo(52, 3);
  g.closePath();
  g.fill();
  g.fillStyle = '#0a0a0e';
  g.fillRect(63, -6, 1.5, 11);
  g.fillStyle = '#a88a4a';
  for (const x of [10, 30, 48]) g.fillRect(x, -4.5, 3, 8);
  g.fillStyle = '#2a2a34';
  g.beginPath();
  g.moveTo(4, -4);
  g.lineTo(0, -10);
  g.lineTo(5, -9);
  g.lineTo(8, -4);
  g.fill();
  g.strokeStyle = '#2a2a34';
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(4, 5, 4, 0, Math.PI);
  g.stroke();
  g.restore();
}

function drawPlayerBody(g, p, ghost) {
  const C = ghost
    ? { cloakA: '#6f8cff', cloakB: '#5f7cff', body: '#6f8cff', dark: '#5f7cff', hat: '#6f8cff', rim: 'rgba(0,0,0,0)', trim: '#6f8cff' }
    : { cloakA: '#272235', cloakB: '#09070e', body: '#1d1a27', dark: '#0e0c13', hat: '#13111a', rim: 'rgba(165,180,250,0.6)', trim: '#3c2c2a' };
  g.scale(p.face, 1);
  const st = p.state, t = p.t;
  const run = clamp(Math.abs(p.vx) / 240, 0, 1);
  const pose = playerPose(p);
  const { crouch, tilt, bob } = pose;
  g.rotate(tilt);
  g.translate(0, crouch);
  const toWorld = (lx, ly) => poseToWorld(p, pose, lx, ly);

  // scarf tail and cloak (the live hunter wears simulated cloth instead, drawn before this)
  if (ghost) {
  const flow = run * 18 + (p.onGround ? 0 : 10) + Math.sin(time * 3) * 2 + (st === 'dodge' ? 14 : 0);
  g.fillStyle = ghost ? C.body : '#2a1d2a';
  g.beginPath();
  g.moveTo(-4, -79 + bob);
  for (let i = 0; i <= 6; i++) g.lineTo(-6 - i * (4 + flow * 0.15), -78 + bob + i * 2.4 + Math.sin(time * 6 + i) * (1 + flow * 0.06));
  for (let i = 6; i >= 0; i--) g.lineTo(-6 - i * (4 + flow * 0.15), -74 + bob + i * 2.4 + Math.sin(time * 6 + i + 0.5) * (1 + flow * 0.06));
  g.closePath();
  g.fill();

  // cloak behind
  const cg = g.createLinearGradient(0, -76, 0, -10);
  cg.addColorStop(0, C.cloakA);
  cg.addColorStop(1, C.cloakB);
  g.fillStyle = cg;
  g.beginPath();
  g.moveTo(-8, -74 + bob);
  g.quadraticCurveTo(-20 - flow * 0.5, -52, -22 - flow, -12 + flow * 0.2);
  const hem = 9;
  const hemPts = [];
  for (let i = 0; i <= hem; i++) {
    const k = i / hem;
    const hx = lerp(-22 - flow, 8, k);
    const hy = lerp(-12 + flow * 0.2, -22, k) + (i % 2 ? -7 : 0) + Math.sin(time * 5 + i) * 1.5;
    hemPts.push([hx, hy]);
    g.lineTo(hx, hy);
  }
  g.lineTo(10, -70 + bob);
  g.closePath();
  g.fill();
  if (!ghost) {
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 1.2;
    for (let i = 1; i < hem; i += 2) {
      g.beginPath();
      g.moveTo(lerp(-6, 6, i / hem), -68 + bob);
      g.quadraticCurveTo(hemPts[i][0] + 4, (hemPts[i][1] - 68) / 2, hemPts[i][0], hemPts[i][1]);
      g.stroke();
    }
    g.strokeStyle = C.rim;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-8, -74 + bob);
    g.quadraticCurveTo(-20 - flow * 0.5, -52, -22 - flow, -12 + flow * 0.2);
    g.stroke();
  }
  }

  // legs
  const sw = Math.sin(p.walk) * run;
  let fb = [-4 - sw * 14, -Math.max(0, Math.cos(p.walk)) * 6 * run];
  let ff = [6 + sw * 14, -Math.max(0, -Math.cos(p.walk)) * 6 * run];
  if (!p.onGround) { fb = [-10, -10]; ff = [10, -16]; }
  if (st === 'dodge' || st === 'heavy') { fb = [-14, 0]; ff = [14, 0]; }
  if (st === 'crouch') { fb = [-12 - sw * 6, 0]; ff = [13 + sw * 6, 0]; }
  // keep the feet planted while the body sinks
  if (p.onGround) { fb[1] -= crouch; ff[1] -= crouch; }
  g.lineCap = 'round';
  for (const [f, off, col] of [[fb, -2, C.dark], [ff, 3, ghost ? C.dark : '#17141d']]) {
    const hip = [off, -34 + bob];
    const knee = [(hip[0] + f[0]) / 2 + 5 + crouch * 0.75, (hip[1] + f[1]) / 2 - 2];
    g.strokeStyle = col;
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(hip[0], hip[1]);
    g.lineTo(knee[0], knee[1]);
    g.lineTo(f[0], f[1] - 3);
    g.stroke();
    g.fillStyle = col;
    g.fillRect(f[0] - 4, f[1] - 8, 12, 8);
    if (!ghost) {
      g.fillStyle = 'rgba(160,170,230,0.35)';
      g.fillRect(f[0] - 4, f[1] - 8, 12, 1.2);
      g.fillStyle = '#4a3a30';
      g.fillRect(f[0] - 4, f[1] - 13, 11, 2);
    }
  }

  // coat skirt and torso
  const tg = g.createLinearGradient(-10, -76, 12, -20);
  tg.addColorStop(0, ghost ? C.body : '#2b2738');
  tg.addColorStop(1, C.body);
  g.fillStyle = tg;
  g.beginPath();
  g.moveTo(-9, -42 + bob);
  g.lineTo(11, -42 + bob);
  g.lineTo(15 + run * 3, -18);
  g.lineTo(8, -14);
  g.lineTo(2, -20);
  g.lineTo(-5, -13);
  g.lineTo(-12 - run * 4, -18);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(-10, -75 + bob);
  g.lineTo(12, -74 + bob);
  g.lineTo(10, -38 + bob);
  g.lineTo(-8, -38 + bob);
  g.closePath();
  g.fill();
  if (!ghost) {
    g.strokeStyle = C.rim;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-10, -74 + bob);
    g.lineTo(-8, -38 + bob);
    g.stroke();
    // bandolier with blood vials
    g.strokeStyle = '#3d2c25';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-8, -72 + bob);
    g.lineTo(10, -44 + bob);
    g.stroke();
    for (let i = 0; i < p.vials; i++) {
      const vx = -5 + i * 3.6, vy = -67 + bob + i * 5.4;
      g.fillStyle = '#c4243a';
      g.fillRect(vx - 1.3, vy - 2.5, 2.6, 5);
      g.fillStyle = '#ff9aa8';
      g.fillRect(vx - 0.8, vy - 2, 0.8, 2);
    }
    g.fillStyle = '#3a2c26';
    g.fillRect(-9, -42 + bob, 20, 3.5);
    g.fillStyle = '#9b8a62';
    g.fillRect(0, -42.5 + bob, 4, 4.5);
    g.fillStyle = '#2a201e';
    g.fillRect(-10, -40 + bob, 6, 7);
  }

  // pauldron, collar, head
  g.fillStyle = ghost ? C.body : '#2b2735';
  g.beginPath();
  g.ellipse(1, -71 + bob, 13, 6, -0.1, 0, TAU);
  g.fill();
  if (!ghost) {
    g.strokeStyle = 'rgba(190,195,245,0.45)';
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(1, -71 + bob, 13, 6, -0.1, Math.PI, TAU);
    g.stroke();
  }
  g.fillStyle = C.dark;
  g.beginPath();
  g.arc(5, -82 + bob, 7, 0, TAU);
  g.fill();
  if (!ghost) {
    g.strokeStyle = 'rgba(190,200,245,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(5, -82 + bob, 6, 0.2, 1.2);
    g.stroke();
  }
  g.fillStyle = ghost ? C.body : '#1d1822';
  g.beginPath();
  g.moveTo(-7, -79 + bob);
  g.lineTo(14, -80 + bob);
  g.lineTo(15, -71 + bob);
  g.lineTo(-9, -70 + bob);
  g.fill();

  // hat with a frayed brim
  g.save();
  g.translate(3, -89 + bob);
  g.rotate(-0.07 + (st === 'run' ? Math.sin(p.walk * 2) * 0.02 : 0));
  const hg = g.createLinearGradient(0, -20, 0, 5);
  hg.addColorStop(0, ghost ? C.hat : '#2a2533');
  hg.addColorStop(1, C.hat);
  g.fillStyle = hg;
  g.beginPath();
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * TAU;
    const fray = i % 3 === 0 ? 1.8 : 0;
    g.lineTo(Math.cos(a) * (31 - fray), Math.sin(a) * (5.5 - fray * 0.3));
  }
  g.fill();
  g.beginPath();
  g.moveTo(-11, -1);
  g.lineTo(-9, -15);
  g.quadraticCurveTo(1, -21, 11, -15);
  g.lineTo(13, -1);
  g.closePath();
  g.fill();
  if (!ghost) {
    g.fillStyle = C.trim;
    g.fillRect(-10.5, -5, 23, 3);
    g.fillStyle = '#9b8a62';
    g.fillRect(4, -5.5, 3.5, 4);
    g.strokeStyle = C.rim;
    g.lineWidth = 1.2;
    g.beginPath();
    g.ellipse(0, -0.5, 31, 5.5, 0, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
    g.beginPath();
    g.moveTo(-9, -15);
    g.quadraticCurveTo(1, -21, 11, -15);
    g.stroke();
  }
  g.restore();

  // lantern at the hip
  const la = Math.sin(time * 3.2) * 0.25 - clamp(p.vx, -300, 300) * 0.0012;
  const lx0 = 13, ly0 = -40 + bob;
  const lx = lx0 + Math.sin(la) * 9, ly = ly0 + Math.cos(la) * 9;
  g.strokeStyle = '#4a4254';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(lx0, ly0);
  g.lineTo(lx, ly);
  g.stroke();
  g.fillStyle = '#1a1720';
  g.fillRect(lx - 5, ly, 10, 14);
  g.beginPath();
  g.moveTo(lx - 6, ly);
  g.lineTo(lx, ly - 4);
  g.lineTo(lx + 6, ly);
  g.fill();
  if (!ghost) {
    const flick = 0.8 + Math.sin(time * 17) * 0.1 + Math.sin(time * 29) * 0.1;
    g.fillStyle = '#eaf4ff';
    g.fillRect(lx - 3, ly + 2, 6, 10);
    g.fillStyle = `rgba(140,180,255,${flick})`;
    g.beginPath();
    g.ellipse(lx, ly + 8, 1.8, 3.5 * flick, 0, 0, TAU);
    g.fill();
    g.fillStyle = '#1a1720';
    g.fillRect(lx - 0.6, ly + 1, 1.2, 12);
    if (!p.ghostPass) [p.lx, p.ly] = toWorld(lx, ly + 7);
  }

  // arms and weapon
  const w = WEAPONS[p.weapon];
  const a = weaponAngle(p);
  const reach = w.id === 'gun' ? 14 : 18;
  const pv = [4 + Math.cos(a) * reach, -64 + bob + Math.sin(a) * reach];
  const grip = w.id === 'gun' ? 20 : 24;
  const h2 = [pv[0] + Math.cos(a) * grip, pv[1] + Math.sin(a) * grip];
  const L = w.light, Hv = w.heavy;
  const swinging = w.id !== 'gun' && ((st === 'attack' && t > L.from - 0.01 && t < L.to + 0.01) || (st === 'heavy' && t > Hv.from - 0.02 && t < Hv.to));
  if (swinging && !ghost) {
    const outer = w.id === 'scythe' ? 172 : 145, inner = w.id === 'scythe' ? 110 : 100, arc = st === 'heavy' && w.id === 'scythe' ? 2.4 : 0.9;
    g.save();
    g.globalCompositeOperation = 'lighter';
    const grd = g.createRadialGradient(pv[0], pv[1], inner * 0.7, pv[0], pv[1], outer);
    grd.addColorStop(0, 'rgba(140,170,255,0)');
    grd.addColorStop(0.75, 'rgba(170,195,255,0.08)');
    grd.addColorStop(1, 'rgba(230,240,255,0.35)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(pv[0], pv[1], outer, a - arc, a);
    g.arc(pv[0], pv[1], inner, a, a - arc, true);
    g.fill();
    if (p.blood > 0.3 && gore) {
      g.globalCompositeOperation = 'source-over';
      g.strokeStyle = 'rgba(150,10,25,0.55)';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(pv[0], pv[1], outer - 15, a - arc, a);
      g.stroke();
    }
    g.restore();
  }
  g.strokeStyle = ghost ? C.body : '#25212f';
  g.lineWidth = 5.5;
  g.beginPath();
  g.moveTo(-3, -69 + bob);
  g.lineTo((pv[0] - 3) / 2 - 3, (pv[1] - 69 + bob) / 2 + 6);
  g.lineTo(pv[0], pv[1]);
  g.stroke();
  g.save();
  g.translate(pv[0], pv[1]);
  const bl = gore && !ghost ? p.blood : 0;
  if (w.id === 'axe') drawAxe(g, a, bl);
  else if (w.id === 'scythe') drawScythe(g, a, bl);
  else drawGun(g, a);
  if (w.id === 'gun' && p.flash > 0 && !ghost) {
    // muzzle flash
    g.rotate(a);
    g.globalCompositeOperation = 'lighter';
    const k = p.flash / 0.16;
    const fl = g.createRadialGradient(66, 0, 0, 66, 0, 46 * k + 10);
    fl.addColorStop(0, 'rgba(255,250,220,1)');
    fl.addColorStop(0.3, 'rgba(255,190,90,0.85)');
    fl.addColorStop(1, 'rgba(255,90,30,0)');
    g.fillStyle = fl;
    g.beginPath();
    g.moveTo(62, 0);
    g.lineTo(110 * k + 70, -14 * k);
    g.lineTo(140 * k + 70, 0);
    g.lineTo(110 * k + 70, 14 * k);
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(66, 0, 22 * k + 6, 0, TAU);
    g.fill();
  }
  g.restore();
  if (!ghost && !p.ghostPass) {
    const tip = w.id === 'scythe' ? [128, 44] : w.id === 'gun' ? [66, 0] : [112, 30];
    const bx = pv[0] + Math.cos(a) * tip[0] - Math.sin(a) * tip[1], by = pv[1] + Math.sin(a) * tip[0] + Math.cos(a) * tip[1];
    if (w.id === 'gun') [p.muzzleX, p.muzzleY] = toWorld(bx, by);
    else [p.bladeX, p.bladeY] = toWorld(bx, by);
  }
  g.strokeStyle = ghost ? C.body : '#2a2634';
  g.beginPath();
  g.moveTo(8, -69 + bob);
  g.lineTo((h2[0] + 8) / 2 + 2, (h2[1] - 69 + bob) / 2 + 7);
  g.lineTo(h2[0], h2[1]);
  g.stroke();
  g.fillStyle = ghost ? C.dark : '#3a2e2a';
  g.beginPath();
  g.arc(pv[0], pv[1], 3.4, 0, TAU);
  g.arc(h2[0], h2[1], 3.4, 0, TAU);
  g.fill();

  if (st === 'heal' && t < 0.6 && !ghost) {
    g.fillStyle = '#c4243a';
    g.fillRect(12, -80 + bob, 5, 9);
  }
}

function ghoulPose(e) {
  const st = e.state, t = e.t;
  let lean = 0.38 + Math.sin(time * 2 + e.phase) * 0.05;
  let el = [7, 22], hd = [13, 46];
  const sway = Math.sin(time * 2.4 + e.phase) * 4;
  hd = [hd[0] + sway, hd[1]];
  if (st === 'idle') lean = 0.5 + Math.sin(time * 1.3 + e.phase) * 0.08;
  if (st === 'wind') {
    const k = ease(Math.min(1, t / 0.48));
    lean = lerp(0.38, -0.1, k);
    el = [lerp(7, -12, k), lerp(22, -22, k)];
    hd = [lerp(13, -24, k), lerp(46, -40, k)];
  } else if (st === 'strike') {
    const k = ease(Math.min(1, t / 0.09));
    lean = 0.75;
    el = [lerp(-12, 24, k), lerp(-22, 6, k)];
    hd = [lerp(-24, 50, k), lerp(-40, 26, k)];
  } else if (st === 'recover') {
    lean = lerp(0.75, 0.38, Math.min(1, t / 0.55));
    el = [18, 14]; hd = [34, 38];
  } else if (st === 'hurt') {
    lean = -0.25 + t;
  }
  return { lean, el, hd, el2: [2, 22], hd2: [6 - sway * 0.6, 45] };
}

function ghoulShape(g, e, ox, oy, col, lw, detail) {
  const step = Math.sin(e.phase);
  const { lean, el, hd, el2, hd2 } = ghoulPose(e);
  const hip = [ox, oy - 40];
  const sh = [hip[0] + Math.sin(lean) * 34, hip[1] - Math.cos(lean) * 34];
  const head = [sh[0] + Math.sin(lean + 0.6) * 15, sh[1] - Math.cos(lean + 0.6) * 15];
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const walking = e.state === 'walk';
  const fb = [ox - 10 + (walking ? step * 13 : 0), oy];
  const ff = [ox + 10 - (walking ? step * 13 : 0), oy];
  for (const f of [fb, ff]) {
    const knee = [(hip[0] + f[0]) / 2 + 9, (hip[1] + f[1]) / 2 - 1];
    g.lineWidth = 5 + lw;
    g.beginPath();
    g.moveTo(hip[0], hip[1]);
    g.lineTo(knee[0], knee[1]);
    g.lineTo(f[0], f[1]);
    g.lineTo(f[0] + 8, f[1]);
    g.stroke();
  }
  g.lineWidth = 3.5 + lw;
  g.beginPath();
  g.moveTo(sh[0] - 3, sh[1]);
  g.lineTo(sh[0] - 3 + el2[0], sh[1] + el2[1]);
  g.lineTo(sh[0] - 3 + hd2[0], sh[1] + hd2[1]);
  g.stroke();
  g.lineWidth = 9 + lw;
  g.beginPath();
  g.moveTo(hip[0], hip[1]);
  g.quadraticCurveTo(hip[0] + Math.sin(lean) * 10 - 8, hip[1] - 22, sh[0], sh[1]);
  g.stroke();
  const chest = [(hip[0] + sh[0]) / 2 + 1, (hip[1] + sh[1]) / 2 - 2];
  g.beginPath();
  g.ellipse(chest[0], chest[1], 9 + lw / 2, 13 + lw / 2, lean, 0, TAU);
  g.fill();
  if (!e.headless) {
    g.lineWidth = 4 + lw;
    g.beginPath();
    g.moveTo(sh[0], sh[1]);
    g.lineTo(head[0], head[1]);
    g.stroke();
    g.beginPath();
    g.ellipse(head[0] + 3, head[1] - 2, 8 + lw / 2, 13 + lw / 2, lean + 0.9, 0, TAU);
    g.fill();
    g.beginPath();
    g.ellipse(head[0] + 8, head[1] + 6, 4 + lw / 2, 6 + lw / 2, lean + 0.5, 0, TAU);
    g.fill();
  }
  g.lineWidth = 3.5 + lw;
  const e1 = [sh[0] + el[0], sh[1] + el[1]], h1 = [sh[0] + hd[0], sh[1] + hd[1]];
  g.beginPath();
  g.moveTo(sh[0], sh[1]);
  g.lineTo(e1[0], e1[1]);
  g.lineTo(h1[0], h1[1]);
  g.stroke();
  const fa = Math.atan2(h1[1] - e1[1], h1[0] - e1[0]);
  g.lineWidth = 1.3 + lw;
  g.beginPath();
  for (let i = -1; i <= 1; i++) {
    g.moveTo(h1[0], h1[1]);
    g.quadraticCurveTo(
      h1[0] + Math.cos(fa + i * 0.35) * 8, h1[1] + Math.sin(fa + i * 0.35) * 8,
      h1[0] + Math.cos(fa + i * 0.35 + 0.4) * 14, h1[1] + Math.sin(fa + i * 0.35 + 0.4) * 14
    );
  }
  g.stroke();
  if (detail) {
    // ribs, spine and a gaping face
    g.strokeStyle = 'rgba(15,10,22,0.55)';
    g.lineWidth = 1.1;
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.ellipse(chest[0] + 2, chest[1] - 8 + k * 4.5, 7, 3, lean, 0.2, Math.PI - 0.2);
      g.stroke();
    }
    g.fillStyle = 'rgba(15,10,22,0.45)';
    for (let k = 0; k < 6; k++) {
      const t = k / 6;
      const bx = lerp(hip[0], sh[0], t) - Math.cos(lean) * 8, by = lerp(hip[1], sh[1], t) - Math.sin(lean) * 4;
      g.beginPath();
      g.arc(bx, by, 1.6, 0, TAU);
      g.fill();
    }
    if (!e.headless) {
      g.fillStyle = '#07050b';
      g.beginPath();
      g.ellipse(head[0] + 6, head[1] - 1, 2.4, 3.4, 0.6, 0, TAU);
      g.fill();
      g.beginPath();
      g.ellipse(head[0] + 2, head[1] + 5, 2, 3, 0.6, 0, TAU);
      g.fill();
      const gape = e.state === 'wind' || e.state === 'strike' ? 5 : 3;
      g.beginPath();
      g.ellipse(head[0] + 9, head[1] + 7, 2, gape, lean + 0.5, 0, TAU);
      g.fill();
    } else {
      g.fillStyle = '#7a0a14';
      g.beginPath();
      g.ellipse(sh[0] + 2, sh[1] - 2, 5, 3, lean, 0, TAU);
      g.fill();
      g.fillStyle = '#c4c0cc';
      g.fillRect(sh[0], sh[1] - 4, 2, 3);
    }
    if (e.cloth) {
      g.fillStyle = '#1d1822';
      g.beginPath();
      g.moveTo(hip[0] - 9, hip[1] - 4);
      g.lineTo(hip[0] + 9, hip[1] - 6);
      for (let k = 0; k <= 5; k++) g.lineTo(hip[0] + 9 - k * 3.6, hip[1] + 10 + (k % 2) * 6 + Math.sin(time * 4 + k) * 1.5);
      g.closePath();
      g.fill();
    }
    if (gore && e.wounds > 0) {
      g.fillStyle = '#7a0a14';
      for (let k = 0; k < Math.min(4, e.wounds); k++) {
        g.beginPath();
        g.ellipse(chest[0] + (k % 2 ? 4 : -3), chest[1] - 6 + k * 5, 3, 1.4, 0.8, 0, TAU);
        g.fill();
        g.fillRect(chest[0] + (k % 2 ? 4 : -3) - 0.6, chest[1] - 6 + k * 5, 1.2, 6 + k * 2);
      }
    }
  }
}

function drawGhoulBody(g, e) {
  if (e.state === 'dead') {
    const k = ease(Math.min(1, e.t / 0.55));
    g.rotate(-e.face * k * 1.5);
  }
  g.scale(e.face * e.scale, e.scale);
  const grad = g.createLinearGradient(0, -110, 0, 0);
  if (e.pale) { grad.addColorStop(0, '#a49db8'); grad.addColorStop(1, '#4a4460'); } else { grad.addColorStop(0, '#5e5774'); grad.addColorStop(1, '#1f1b2a'); }
  ghoulShape(g, e, -1.4, -1.6, 'rgba(190,200,250,0.6)', 1.4, false);
  ghoulShape(g, e, 0, 0, grad, 0, true);
}

function drawGhoul(e) {
  const sx = e.x - camX;
  if (sx < -140 || sx > W + 140) return;
  const footY = GROUND + e.lane + (e.state === 'dead' ? 0 : 0);
  let clipY = null, yOff = 0;
  if (e.state === 'rise') {
    yOff = (1 - ease(clamp(e.t, 0, 1))) * 100;
    clipY = footY + 3;
  }
  drawShadow(e.x, footY, 26 * e.scale, e.state === 'rise' ? 0.2 : 0.5);
  if (clipY !== null) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx - 170, 0, 340, clipY);
    ctx.clip();
  }
  const fogK = clamp((e.lane + 3) / 17, 0, 1);
  renderActor(ABUF, ab, 170, 290, e.x, footY + yOff, g => drawGhoulBody(g, e), {
    flash: e.flash > 0 ? 0.75 : 0,
    alpha: Math.max(0, e.alpha) * (0.88 + fogK * 0.12)
  });
  if (clipY !== null) ctx.restore();
}

function drawBloomBody(g, b) {
  g.scale(b.face, 1);
  const lift = b.lift;
  const breathe = Math.sin(b.phase * 1.6) * 3;
  const plateRim = 'rgba(190,185,240,0.5)';
  g.strokeStyle = '#191422';
  g.lineCap = 'round';
  for (const [x, w] of [[-38, 18], [34, 18], [-10, 10], [58, 8], [-62, 8]]) {
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x * 0.6, -60 + lift);
    g.quadraticCurveTo(x * 1.2, -30 + lift / 2, x * 1.4, 0);
    g.stroke();
  }
  for (const s of [-1, 1]) {
    const open = (b.state === 'slamWind' ? 10 : 0) + breathe;
    g.save();
    g.scale(s, 1);
    g.translate(open, lift);
    const pg = g.createLinearGradient(-120, -220, -40, -30);
    pg.addColorStop(0, '#4b4360');
    pg.addColorStop(0.6, '#2c2638');
    pg.addColorStop(1, '#14101b');
    g.fillStyle = pg;
    g.beginPath();
    g.moveTo(-26, -222);
    g.quadraticCurveTo(-138, -210, -118, -100);
    g.quadraticCurveTo(-104, -36, -50, -26);
    g.quadraticCurveTo(-92, -120, -26, -222);
    g.fill();
    g.strokeStyle = plateRim;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(-26, -222);
    g.quadraticCurveTo(-138, -210, -118, -100);
    g.quadraticCurveTo(-104, -36, -50, -26);
    g.stroke();
    g.strokeStyle = 'rgba(15,10,22,0.75)';
    g.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      g.moveTo(-36 - i * 4, -205 + i * 8);
      g.quadraticCurveTo(-114 + i * 6, -150 + i * 12, -62 + i * 2, -40 - i * 2);
      g.stroke();
    }
    g.fillStyle = '#3b3449';
    g.beginPath();
    g.moveTo(-26, -222);
    g.quadraticCurveTo(-10, -246, 6, -250);
    g.quadraticCurveTo(-8, -234, -12, -214);
    g.fill();
    g.restore();
  }
  g.save();
  g.translate(0, -124 + lift);
  const gr = g.createRadialGradient(0, 0, 4, 0, 0, 84);
  gr.addColorStop(0, '#4a3f58');
  gr.addColorStop(0.5, '#241d2e');
  gr.addColorStop(1, '#0e0b14');
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(0, 0, 62, 84 + breathe, 0, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(180,170,235,0.45)';
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(0, 0, 62, 84 + breathe, 0, Math.PI * 0.95, Math.PI * 1.75);
  g.stroke();
  const pulse = 0.45 + Math.sin(b.phase * 3) * 0.2;
  g.lineCap = 'round';
  for (const v of b.veins) {
    g.strokeStyle = 'rgba(8,5,12,0.9)';
    g.lineWidth = 3.4;
    g.beginPath();
    g.moveTo(v[0][0], v[0][1]);
    for (const pt of v) g.lineTo(pt[0], pt[1]);
    g.stroke();
    g.strokeStyle = `rgba(190,120,255,${pulse * 0.5})`;
    g.lineWidth = 1;
    g.stroke();
  }
  g.strokeStyle = '#1a1422';
  g.lineWidth = 2;
  for (let i = 0; i < 11; i++) {
    const x = -46 + i * 9.2, w = Math.sin(b.phase * 2 + i) * 6;
    g.beginPath();
    g.moveTo(x, -70);
    g.quadraticCurveTo(x + w, -100, x + w * 2 + (i - 5) * 4, -118 - (i % 3) * 8);
    g.stroke();
  }
  skull(g, 0, -6, 1.15, '#d6cee2', '#120c16');
  if (gore && b.hp < b.maxHp) {
    const k = 1 - b.hp / b.maxHp;
    g.fillStyle = '#6a0812';
    for (let i = 0; i < Math.floor(k * 10); i++) {
      g.beginPath();
      g.ellipse(-40 + ((i * 37) % 80), -50 + ((i * 53) % 100), 4, 2, i, 0, TAU);
      g.fill();
      g.fillRect(-40 + ((i * 37) % 80) - 0.8, -50 + ((i * 53) % 100), 1.6, 8 + (i % 4) * 4);
    }
  }
  const angry = b.state === 'slamWind' || b.state === 'rootWind' || b.hp < b.maxHp * 0.5;
  if (angry) {
    g.fillStyle = 'rgba(255,70,90,0.95)';
    g.beginPath();
    g.arc(-4, -5, 1.7, 0, TAU);
    g.arc(4, -5, 1.7, 0, TAU);
    g.fill();
  }
  g.restore();
}

function drawBloom(b) {
  const sx = b.x - camX;
  if (sx < -260 || sx > W + 260) return;
  let sink = 0, clipped = false;
  if (b.state === 'emerge') {
    sink = (1 - ease(clamp(b.t / 2.2, 0, 1))) * 240;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx - 260, 0, 520, GROUND + 4);
    ctx.clip();
    clipped = true;
  }
  if (b.state === 'dead') sink = b.t * 40;
  const footY = GROUND + b.lane + 10;
  drawShadow(b.x, footY, 110, 0.6);
  renderActor(BBUF, bb, 240, 400, b.x, footY + sink, g => drawBloomBody(g, b), { flash: b.flash > 0 ? 0.7 : 0, alpha: Math.max(0, b.alpha) });
  if (clipped) ctx.restore();
  if (!b.dead) {
    const cy = footY + sink - 124 + b.lift;
    const pulse = 0.4 + Math.sin(b.phase * 3) * 0.2;
    gg.fillStyle = `rgba(170,100,255,${pulse})`;
    gg.beginPath();
    gg.ellipse(sx, cy, 40, 60, 0, 0, TAU);
    gg.fill();
  }
}

function drawPlayer() {
  const footY = P.y + 6;
  drawShadow(P.x, GROUND + 6, 30, P.onGround ? 0.55 : 0.3);
  for (const tr of P.trail) {
    P.ghostPass = true;
    renderActor(ABUF, ab, 170, 290, tr.x, footY, g => drawPlayerBody(g, P, true), { light: false, alpha: tr.a * 0.45 });
  }
  P.ghostPass = false;
  renderActor(ABUF, ab, 170, 290, P.x, footY, g => { drawCloth(g); drawPlayerBody(g, P, false); }, { flash: P.inv > 0.45 ? 0.4 : 0 });
}

function drawSpikes() {
  for (const s of spikes) {
    if (s.t < 0) continue;
    const sx = s.x - camX;
    if (s.t < 0.8) {
      const k = s.t / 0.8;
      for (const g of [ctx, gg]) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = `rgba(180,90,220,${0.15 + k * 0.35})`;
        g.beginPath();
        g.ellipse(sx, GROUND + 4, 36 * (0.5 + k * 0.5), 6, 0, 0, TAU);
        g.fill();
        g.restore();
      }
      continue;
    }
    const up = s.t < 1.0 ? ease((s.t - 0.8) / 0.2) : s.t > 1.3 ? 1 - (s.t - 1.3) / 0.3 : 1;
    for (let i = -2; i <= 2; i++) {
      const h = (90 - Math.abs(i) * 22) * up, x = sx + i * 11;
      const sg = ctx.createLinearGradient(x - 7, 0, x + 7, 0);
      sg.addColorStop(0, '#3a2f48');
      sg.addColorStop(1, '#120d18');
      ctx.fillStyle = sg;
      ctx.strokeStyle = 'rgba(200,190,240,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 7, GROUND + 6);
      ctx.quadraticCurveTo(x - 2 + i * 2, GROUND - h * 0.5, x + i * 4, GROUND - h);
      ctx.quadraticCurveTo(x + 3, GROUND - h * 0.4, x + 7, GROUND + 6);
      ctx.fill();
      ctx.stroke();
      if (s.bloody && gore) {
        ctx.fillStyle = '#8e0a18';
        ctx.beginPath();
        ctx.moveTo(x + i * 4, GROUND - h);
        ctx.lineTo(x + i * 3 - 2, GROUND - h * 0.6);
        ctx.lineTo(x + i * 3 + 2, GROUND - h * 0.65);
        ctx.fill();
      }
    }
  }
  for (const s of shocks) {
    const sx = s.x - camX, a = 1 - s.t / 1.5;
    for (const g of [ctx, gg]) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      const gr = g.createLinearGradient(sx - s.dir * 40, 0, sx, 0);
      gr.addColorStop(0, 'rgba(140,160,255,0)');
      gr.addColorStop(1, `rgba(190,205,255,${0.6 * a})`);
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(sx - s.dir * 50, GROUND + 4);
      g.quadraticCurveTo(sx - s.dir * 6, GROUND - 26, sx + s.dir * 4, GROUND + 4);
      g.fill();
      g.restore();
    }
  }
}

function drawPickups() {
  for (const k of pickups) {
    const sx = k.x - camX, y = k.y + Math.sin(time * 3 + k.x) * 2;
    ctx.fillStyle = '#2a1a22';
    ctx.fillRect(sx - 2, y - 16, 4, 4);
    ctx.fillStyle = '#c1263f';
    ctx.beginPath();
    ctx.ellipse(sx, y - 5, 6, 7, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ff8aa0';
    ctx.fillRect(sx - 3, y - 8, 2, 4);
    gg.fillStyle = 'rgba(255,60,90,0.8)';
    gg.beginPath();
    gg.arc(sx, y - 5, 9, 0, TAU);
    gg.fill();
  }
}

const GORE_TYPES = new Set(['blood', 'chunk', 'head']);

function drawParticles(additive, goreOnly = false) {
  for (const g of additive ? [ctx, gg] : [ctx]) {
    if (additive) g.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      if (p.add !== additive) continue;
      if (!additive && GORE_TYPES.has(p.type) !== goreOnly) continue;
      const sx = p.x - camX;
      if (sx < -30 || sx > W + 30) continue;
      const k = p.life / p.max;
      let a = p.type === 'ember' ? Math.sin(k * Math.PI) * (0.6 + 0.4 * Math.sin(time * 12 + p.seed * 7)) : 1 - k;
      if (p.type === 'firefly') a = Math.sin(k * Math.PI) * (0.35 + 0.65 * Math.max(0, Math.sin(time * 3 + p.seed * 9)));
      if (p.type === 'mote') a = Math.sin(k * Math.PI) * clamp(1 - Math.hypot(p.x - P.lx, p.y - P.ly) / 140, 0, 1) * 0.9;
      if (p.type === 'blood') {
        g.globalAlpha = 0.95;
        g.strokeStyle = p.col;
        g.lineWidth = p.size;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo((p.px == null ? p.x : p.px) - camX, p.py == null ? p.y : p.py);
        g.lineTo(sx + 0.01, p.y);
        g.stroke();
        continue;
      }
      if (p.type === 'chunk') {
        g.globalAlpha = 1;
        g.fillStyle = p.col;
        g.save();
        g.translate(sx, p.y);
        g.rotate(p.rot);
        g.beginPath();
        g.moveTo(-p.size, -p.size * 0.6);
        g.lineTo(p.size * 0.8, -p.size * 0.8);
        g.lineTo(p.size, p.size * 0.5);
        g.lineTo(-p.size * 0.4, p.size * 0.9);
        g.fill();
        g.restore();
        continue;
      }
      if (p.type === 'head') {
        g.globalAlpha = 1;
        g.save();
        g.translate(sx, p.y);
        g.rotate(p.rot);
        g.fillStyle = p.col;
        g.beginPath();
        g.ellipse(0, 0, 8, 12, 0.9, 0, TAU);
        g.fill();
        g.fillStyle = '#07050b';
        g.beginPath();
        g.ellipse(3, -1, 2.2, 3.2, 0.6, 0, TAU);
        g.fill();
        g.fillStyle = '#8e0a18';
        g.beginPath();
        g.ellipse(-6, 6, 5, 3, 0.9, 0, TAU);
        g.fill();
        g.restore();
        continue;
      }
      g.globalAlpha = clamp(a, 0, 1);
      g.fillStyle = p.col;
      const size = p.type === 'dust' || p.type === 'mist' ? p.size * (1 + k) : p.size;
      g.beginPath();
      g.arc(sx, p.y, size, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
}

// Severed heads come to rest and stay on the ground for a while
function settleHeads() {
  for (const p of particles) {
    if (p.type !== 'head') continue;
    const floor = GROUND + p.lane - 6;
    if (p.y > floor && p.vy > 0) {
      p.y = floor;
      if (Math.abs(p.vy) > 120) {
        p.vy *= -0.35;
        if (gore) addDecal(p.x, GROUND + p.lane, 8, 2.5, '#6e0610');
      } else {
        p.vy = 0;
        p.g = 0;
      }
      p.vx *= 0.6;
      p.spin *= 0.5;
    }
  }
}

/* ---------- Lighting ---------- */

function collectLights() {
  const L = [];
  const flick = 0.92 + Math.sin(time * 13) * 0.04 + Math.sin(time * 7.3) * 0.04;
  if (P.state !== 'dead' || P.t < 3) {
    const k = P.state === 'dead' ? Math.max(0, 1 - P.t / 3) : 1;
    L.push({ x: P.lx - camX, y: P.ly, r: 260 * flick, s: 0.95 * k, glow: `rgba(90,140,255,${0.3 * k})`, gr: 170, core: k });
  }
  for (const l of deco.lamps) {
    const x = l.x + 24 - camX;
    if (x > -200 && x < W + 200) L.push({ x, y: GROUND - 120, r: 200 * flick, s: 0.75, glow: 'rgba(110,150,255,0.26)', gr: 120, core: 0.8 });
  }
  for (const f of deco.flowers) {
    const x = f.x - camX;
    if (x > -100 && x < W + 100) L.push({ x, y: GROUND - 6, r: 80, s: 0.45, glow: 'rgba(160,190,255,0.14)', gr: 60 });
  }
  for (const e of enemies) {
    if (e.type === 'bloom' && !e.dead) L.push({ x: e.x - camX, y: GROUND - 120 + e.lift, r: 140, s: 0.4, glow: 'rgba(170,110,255,0.14)', gr: 100 });
  }
  if (P.flash > 0) {
    const k = P.flash / 0.16;
    L.push({ x: P.muzzleX - camX + P.face * 30, y: P.muzzleY, r: 340 * k + 80, s: 0.9 * Math.min(1, k * 1.5), glow: `rgba(255,170,80,${0.5 * k})`, gr: 160 * k + 30, core: k });
  }
  for (const k of pickups) L.push({ x: k.x - camX, y: k.y - 5, r: 50, s: 0.5, glow: 'rgba(255,70,100,0.35)', gr: 26 });
  for (const s of spikes) if (s.t > 0 && s.t < 0.8) L.push({ x: s.x - camX, y: GROUND, r: 60, s: 0.5 });
  L.push({ x: MOON.x, y: MOON.y + 60, r: 420, s: 0.35 });
  return L;
}

function drawLighting(lights) {
  lg.globalCompositeOperation = 'source-over';
  lg.clearRect(0, 0, W, H);
  const gr = lg.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, 'rgba(8,4,22,0.25)');
  gr.addColorStop(0.55, 'rgba(6,3,18,0.5)');
  gr.addColorStop(1, 'rgba(2,1,8,0.82)');
  lg.fillStyle = gr;
  lg.fillRect(0, 0, W, H);
  lg.globalCompositeOperation = 'destination-out';
  for (const l of lights) {
    const g = lg.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
    g.addColorStop(0, `rgba(0,0,0,${l.s})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lg.fillStyle = g;
    lg.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  }
  ctx.drawImage(LIGHT, 0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    if (!l.glow) continue;
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.gr);
    g.addColorStop(0, l.glow);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(l.x - l.gr, l.y - l.gr, l.gr * 2, l.gr * 2);
    if (l.core) {
      for (const [tg, rad, k] of [[ctx, 16, 0.9], [gg, 10, 0.55]]) {
        const c = tg.createRadialGradient(l.x, l.y, 0, l.x, l.y, rad);
        c.addColorStop(0, `rgba(235,244,255,${k * l.core})`);
        c.addColorStop(1, 'rgba(120,160,255,0)');
        tg.fillStyle = c;
        tg.fillRect(l.x - rad, l.y - rad, rad * 2, rad * 2);
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

function bloom() {
  b1.save();
  b1.setTransform(1, 0, 0, 1, 0, 0);
  b1.clearRect(0, 0, BL1.width, BL1.height);
  b1.drawImage(GLOW, 0, 0, BL1.width, BL1.height);
  b1.restore();
  b2.save();
  b2.setTransform(1, 0, 0, 1, 0, 0);
  b2.clearRect(0, 0, BL2.width, BL2.height);
  b2.drawImage(BL1, 0, 0, BL2.width, BL2.height);
  b2.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 0.55;
  ctx.drawImage(BL1, 0, 0, W, H);
  ctx.globalAlpha = 0.22;
  if (fxLow) {
    ctx.globalAlpha = 0.8;
    ctx.drawImage(BL2, 0, 0, W, H);
  } else for (const [ox, oy] of [[-6, -4], [6, -4], [-6, 4], [6, 4]]) ctx.drawImage(BL2, ox, oy, W, H);
  ctx.restore();
}

function grade() {
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  const gr = ctx.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, 'rgba(150,90,210,0.55)');
  gr.addColorStop(0.6, 'rgba(90,90,190,0.35)');
  gr.addColorStop(1, 'rgba(30,50,140,0.5)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function drawGrain() {
  if (fxLow) return;
  if (!grainPattern) grainPattern = ctx.createPattern(GRAIN, 'repeat');
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.07;
  ctx.translate(-Math.random() * 256, -Math.random() * 256);
  ctx.fillStyle = grainPattern;
  ctx.fillRect(0, 0, W + 256, H + 256);
  ctx.restore();
}

function drawScreenSplats() {
  for (const s of screenSplats) {
    hud.save();
    hud.globalAlpha = clamp(s.a * 1.1, 0, 0.92);
    hud.translate(s.x, s.y);
    hud.rotate(s.rot);
    hud.scale(s.s, s.s);
    hud.drawImage(s.img, -160, -160, 320, 320);
    hud.restore();
  }
}

/* ---------- HUD ---------- */

function bar(x, y, w, h, frac, lag, col1, col2) {
  hud.fillStyle = 'rgba(5,3,10,0.7)';
  hud.fillRect(x - 3, y - 3, w + 6, h + 6);
  if (lag !== null) {
    hud.fillStyle = 'rgba(230,200,180,0.6)';
    hud.fillRect(x, y, w * clamp(lag, 0, 1), h);
  }
  const g = hud.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, col1);
  g.addColorStop(1, col2);
  hud.fillStyle = g;
  hud.fillRect(x, y, w * clamp(frac, 0, 1), h);
  hud.fillStyle = 'rgba(255,255,255,0.18)';
  hud.fillRect(x, y, w * clamp(frac, 0, 1), Math.max(1, h * 0.3));
  hud.strokeStyle = 'rgba(180,160,200,0.5)';
  hud.lineWidth = 1;
  hud.strokeRect(x - 3.5, y - 3.5, w + 7, h + 7);
  hud.fillStyle = 'rgba(180,160,200,0.7)';
  for (const ex of [x - 3.5, x + w + 3.5]) {
    hud.beginPath();
    hud.moveTo(ex, y - 7);
    hud.lineTo(ex + 3, y + h / 2);
    hud.lineTo(ex, y + h + 7);
    hud.lineTo(ex - 3, y + h / 2);
    hud.fill();
  }
}

function centreText(text, y, size, colour, weight = 700, spacing = 0, glow = 0) {
  hud.font = `${weight} ${size}px ${SERIF}`;
  hud.textAlign = 'center';
  hud.textBaseline = 'middle';
  if ('letterSpacing' in hud) hud.letterSpacing = spacing + 'px';
  hud.fillStyle = colour;
  if (glow) {
    hud.shadowColor = glow;
    hud.shadowBlur = 26;
  }
  hud.fillText(text, W / 2, y);
  hud.shadowBlur = 0;
  if ('letterSpacing' in hud) hud.letterSpacing = '0px';
}

function drawHUD() {
  bar(30, 26, 250, 10, P.hp / P.maxHp, P.hpLag / P.maxHp, '#5e0a18', '#c42a3a');
  bar(30, 46, 200, 6, P.st / 100, null, '#4f6a55', '#9cbc90');
  for (let i = 0; i < 5; i++) {
    const x = 34 + i * 17, y = 68;
    hud.globalAlpha = i < P.vials ? 1 : 0.2;
    const vg = hud.createRadialGradient(x - 2, y + 2, 0, x, y + 4, 7);
    vg.addColorStop(0, '#ff7a8a');
    vg.addColorStop(1, '#8e0f22');
    hud.fillStyle = vg;
    hud.beginPath();
    hud.ellipse(x, y + 4, 5.5, 6.5, 0, 0, TAU);
    hud.fill();
    hud.fillStyle = '#5a4a40';
    hud.fillRect(x - 2, y - 6, 4, 4);
  }
  hud.globalAlpha = 1;
  drawWeaponPanel();
  hud.textAlign = 'right';
  hud.textBaseline = 'top';
  hud.font = `700 24px ${SERIF}`;
  hud.fillStyle = '#e4d9f0';
  hud.fillText(wave ? 'Wave ' + wave : '', W - 30, 18);
  hud.font = `500 17px ${SERIF}`;
  hud.fillStyle = '#bcb0d4';
  hud.fillText('Echoes ' + score, W - 30, 46);

  const boss = enemies.find(e => e.type === 'bloom' && !e.dead);
  if (boss) {
    hud.textAlign = 'left';
    hud.textBaseline = 'bottom';
    hud.font = `600 18px ${SERIF}`;
    hud.fillStyle = '#e1d7ee';
    hud.fillText('The Hollow Bloom', W / 2 - 260, H - 58);
    bar(W / 2 - 260, H - 50, 520, 8, boss.hp / boss.maxHp, null, '#4a0c1c', '#a32a3a');
  }

  if (banner.t < 3.2) {
    const a = banner.t < 0.5 ? banner.t / 0.5 : banner.t > 2.5 ? 1 - (banner.t - 2.5) / 0.7 : 1;
    hud.globalAlpha = clamp(a, 0, 1);
    centreText(banner.text, H * 0.3, 54, '#efe5f8', 700, 3, 'rgba(200,170,255,0.6)');
    centreText(banner.sub, H * 0.3 + 42, 20, '#b6aacd', 500, 1);
    hud.globalAlpha = 1;
  }

  if (playT < 12 && mode === 'play') {
    hud.globalAlpha = clamp((12 - playT) / 2, 0, 0.85);
    centreText('A D move  ·  W jump  ·  S duck  ·  J or click attack  ·  K or right click heavy  ·  Shift roll  ·  E vial  ·  Q or 1 2 3 weapons', H - 18, 15, '#cbc0dc', 500);
    hud.globalAlpha = 1;
  }
  const notes = [];
  if (muted) notes.push('Sound off (M)');
  if (!gore) notes.push('Blood off (B)');
  if (notes.length) {
    hud.textAlign = 'left';
    hud.textBaseline = 'top';
    hud.font = `500 14px ${SERIF}`;
    hud.fillStyle = '#8f84a6';
    hud.fillText(notes.join('  ·  '), 30, 134);
  }
}

function weaponIcon(g, id, x, y, s) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.rotate(-0.7);
  g.lineCap = 'round';
  g.strokeStyle = '#6a5040';
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(-14, 0);
  g.lineTo(id === 'gun' ? 6 : 14, 0);
  g.stroke();
  g.fillStyle = '#c9cde0';
  g.beginPath();
  if (id === 'axe') { g.moveTo(8, 0); g.quadraticCurveTo(4, 8, 2, 12); g.quadraticCurveTo(12, 14, 18, 6); g.lineTo(14, 0); }
  else if (id === 'scythe') { g.moveTo(14, -1); g.quadraticCurveTo(20, 12, -4, 18); g.quadraticCurveTo(12, 10, 11, 1); }
  else { g.rect(2, -2.2, 16, 4.4); g.moveTo(17, -3.5); g.lineTo(21, -5); g.lineTo(21, 5); g.lineTo(17, 3.5); }
  g.fill();
  g.restore();
}

function drawWeaponPanel() {
  const x = 30, y = 92;
  WEAPONS.forEach((w, i) => {
    const on = i === P.weapon;
    hud.globalAlpha = on ? 1 : 0.38;
    hud.fillStyle = on ? 'rgba(30,20,48,0.75)' : 'rgba(10,6,18,0.5)';
    hud.fillRect(x + i * 40, y, 34, 34);
    hud.strokeStyle = on ? 'rgba(210,190,240,0.8)' : 'rgba(150,130,180,0.4)';
    hud.lineWidth = 1;
    hud.strokeRect(x + i * 40 + 0.5, y + 0.5, 33, 33);
    weaponIcon(hud, w.id, x + i * 40 + 17, y + 17, 0.95);
    hud.font = `600 11px ${SERIF}`;
    hud.textAlign = 'left';
    hud.textBaseline = 'top';
    hud.fillStyle = '#d9cfe8';
    hud.fillText(String(i + 1), x + i * 40 + 3, y + 2);
  });
  hud.globalAlpha = 1;
  const w = WEAPONS[P.weapon];
  hud.font = `600 16px ${SERIF}`;
  hud.fillStyle = '#e4d9f0';
  hud.textBaseline = 'top';
  hud.fillText(w.name, x + 128, y + 2);
  if (w.id === 'gun') {
    for (let i = 0; i < AMMO_MAX; i++) {
      hud.fillStyle = i < P.ammo ? '#d8b56a' : 'rgba(120,110,140,0.35)';
      hud.fillRect(x + 128 + i * 8, y + 23, 5, 8);
    }
  } else {
    hud.font = `500 13px ${SERIF}`;
    hud.fillStyle = '#a99ec2';
    hud.fillText(w.note, x + 128, y + 21);
  }
  if (P.swapT < 1.2) {
    hud.globalAlpha = 1 - P.swapT / 1.2;
    centreText(w.name, H * 0.66, 26, '#efe5f8', 700, 2, 'rgba(200,170,255,0.7)');
    hud.globalAlpha = 1;
  }
}

function drawTitle() {
  hud.fillStyle = 'rgba(6,3,14,0.3)';
  hud.fillRect(0, 0, W, H);
  const pulse = 0.75 + Math.sin(time * 2.2) * 0.25;
  centreText('HOLLOW LANTERN', H * 0.3, 82, '#f1e8fa', 700, 9, 'rgba(190,160,255,0.55)');
  centreText('A hunt through the Vale of Bones', H * 0.3 + 54, 22, '#c0b4d8', 500, 2);
  hud.globalAlpha = pulse;
  centreText('Press Enter, click or tap to begin', H * 0.62, 22, '#e0d6ee', 600, 1);
  hud.globalAlpha = 1;
  centreText('A D move  ·  W jump  ·  S duck  ·  J attack  ·  K heavy  ·  Shift roll  ·  E vial  ·  Q weapons  ·  P pause  ·  M sound  ·  B blood', H * 0.62 + 36, 15, '#a296bb', 500);
  if (best) centreText('Best hunt: ' + best + ' echoes', H * 0.62 + 62, 15, '#a296bb', 500);
}

function drawDeath() {
  const a = clamp((deadT - 0.6) / 1.2, 0, 1);
  hud.globalAlpha = a;
  const band = hud.createLinearGradient(0, H * 0.34, 0, H * 0.6);
  band.addColorStop(0, 'rgba(0,0,0,0)');
  band.addColorStop(0.3, 'rgba(0,0,0,0.7)');
  band.addColorStop(0.7, 'rgba(0,0,0,0.7)');
  band.addColorStop(1, 'rgba(0,0,0,0)');
  hud.fillStyle = band;
  hud.fillRect(0, H * 0.34, W, H * 0.26);
  centreText('YOU DIED', H * 0.47, 80, '#a5162a', 600, 12, 'rgba(255,40,60,0.45)');
  hud.globalAlpha = clamp((deadT - 1.6) / 0.8, 0, 1);
  centreText(`Wave ${wave}  ·  ${kills} slain  ·  ${score} echoes`, H * 0.64, 20, '#c8bcd8', 500, 1);
  centreText('Press Enter or tap to rise again', H * 0.64 + 30, 17, '#9a8fb3', 500);
  hud.globalAlpha = 1;
}

/* ---------- GPU post-processing ---------- */

// The 2D scene is uploaded as a texture each frame and finished on the GPU:
// soft bloom, crepuscular rays through the branches, drifting volumetric fog lit by
// the lanterns, heat shimmer, lens fringing, a filmic grade, vignette and grain.
function initPost(canvas) {
  let gl = null;
  try { gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false }); } catch (e) { gl = null; }
  if (!gl) return null;

  const VS = 'attribute vec2 p; varying vec2 v; void main() { v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
  const HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\nvarying vec2 v;\n';
  const NOISE = `
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float s = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
      return s;
    }`;

  const PRE = HEAD + `
    uniform sampler2D uScene, uGlow;
    void main() {
      vec3 s = texture2D(uScene, v).rgb;
      vec3 b = max(s - vec3(0.74), 0.0) * 1.2;
      gl_FragColor = vec4(texture2D(uGlow, v).rgb * 1.2 + b, 1.0);
    }`;
  const BLUR = HEAD + `
    uniform sampler2D uTex; uniform vec2 uDir;
    void main() {
      vec3 c = texture2D(uTex, v).rgb * 0.227027;
      c += (texture2D(uTex, v + uDir * 1.3846).rgb + texture2D(uTex, v - uDir * 1.3846).rgb) * 0.316216;
      c += (texture2D(uTex, v + uDir * 3.2308).rgb + texture2D(uTex, v - uDir * 3.2308).rgb) * 0.070270;
      gl_FragColor = vec4(c, 1.0);
    }`;
  const RAYS = HEAD + `
    uniform sampler2D uScene; uniform vec2 uMoon; uniform float uK;
    void main() {
      vec2 uv = v;
      vec2 dlt = (uv - uMoon) * (0.92 / 48.0);
      float ill = 1.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 48; i++) {
        uv -= dlt;
        vec3 s = texture2D(uScene, uv).rgb;
        float l = dot(s, vec3(0.3, 0.59, 0.11));
        float m = smoothstep(0.42, 0.8, l) * smoothstep(0.35, 0.55, uv.y);
        acc += s * m * ill;
        ill *= 0.962;
      }
      gl_FragColor = vec4(acc * (uK / 48.0), 1.0);
    }`;
  const COMP = HEAD + NOISE + `
    uniform sampler2D uScene, uBloom, uRays;
    uniform vec2 uRes, uMoon;
    uniform float uTime, uCam, uHurt, uLowHp, uFx;
    uniform vec3 uLight, uFlash;
    uniform vec4 uLamps[4];
    vec3 tonemap(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    void main() {
      vec2 asp = vec2(uRes.x / uRes.y, 1.0);
      vec2 uv = v;
      vec2 ld = (v - uLight.xy) * asp;
      float lr = length(ld);
      // heat shimmer above the lantern flame
      float sh = smoothstep(0.14, 0.0, lr) * uLight.z * uFx;
      uv += vec2(noise(v * 60.0 + vec2(0.0, -uTime * 4.0)) - 0.5, noise(v * 60.0 + vec2(5.0, -uTime * 5.0)) - 0.5) * 0.004 * sh;
      vec2 c = uv - 0.5;
      float ca = (0.0012 + uHurt * 0.01) * dot(c, c) * 4.0;
      vec3 col;
      col.r = texture2D(uScene, uv - c * ca).r;
      col.g = texture2D(uScene, uv).g;
      col.b = texture2D(uScene, uv + c * ca).b;

      // light reaching the air from the lantern, the lamps and any muzzle flash
      float lan = uLight.z * exp(-lr * lr * 14.0);
      float lamps = 0.0;
      for (int i = 0; i < 4; i++) {
        vec2 q = (v - uLamps[i].xy) * asp;
        lamps += uLamps[i].z * exp(-dot(q, q) * 26.0);
      }
      vec2 fq = (v - uFlash.xy) * asp;
      float flash = uFlash.z * exp(-dot(fq, fq) * 9.0);
      vec3 airLight = vec3(0.45, 0.62, 1.15) * (lan * 1.3 + lamps) + vec3(1.2, 0.7, 0.35) * flash;

      // two drifting banks of ground fog, each scrolling with its own parallax
      vec2 fp = vec2(v.x * asp.x, v.y);
      float f1 = fbm(fp * vec2(1.6, 3.6) + vec2(uCam * 0.9 + uTime * 0.035, uTime * 0.01));
      float f2 = fbm(fp * vec2(3.4, 6.5) + vec2(uCam * 1.4 - uTime * 0.06, -uTime * 0.02));
      float band = smoothstep(0.62, 0.2, v.y) * smoothstep(-0.05, 0.2, v.y);
      float fog = band * (smoothstep(0.35, 0.85, f1) * 0.75 + smoothstep(0.4, 0.9, f2) * 0.55) * uFx;
      vec3 fogCol = vec3(0.2, 0.17, 0.34) + airLight * 0.7;
      col = mix(col, fogCol, clamp(fog * 0.2, 0.0, 0.35));
      col += airLight * (0.025 + fog * 0.16);

      col += texture2D(uRays, v).rgb * vec3(0.95, 0.82, 1.1) * 0.32;
      col += texture2D(uBloom, v).rgb * 0.6;

      // grade: cool deep shadows, a little extra saturation, gentle S-curve
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(0.82, 0.84, 1.15), smoothstep(0.4, 0.0, l) * 0.6);
      col = mix(vec3(l), col, 1.15);
      vec3 sc = clamp(col, 0.0, 1.0);
      col = mix(col, sc * sc * (3.0 - 2.0 * sc), 0.45);
      col = mix(col, tonemap(col * 1.1), 0.35);

      float vig = smoothstep(1.2, 0.3, length(c * vec2(1.15, 1.0)));
      col *= mix(0.38, 1.0, vig);
      float edge = smoothstep(0.35, 0.95, length(c * 2.0));
      col = mix(col, vec3(0.42, 0.0, 0.04), clamp(edge * (uHurt * 0.9 + uLowHp * 0.45), 0.0, 0.85));
      col += (hash(v * uRes * 1.7 + fract(uTime * 13.0) * 91.0) - 0.5) * 0.06 * uFx;
      gl_FragColor = vec4(col, 1.0);
    }`;

  function shader(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(sh)); return null; }
    return sh;
  }
  function program(fs) {
    const vs = shader(gl.VERTEX_SHADER, VS), f = shader(gl.FRAGMENT_SHADER, fs);
    if (!vs || !f) return null;
    const pr = gl.createProgram();
    gl.attachShader(pr, vs);
    gl.attachShader(pr, f);
    gl.bindAttribLocation(pr, 0, 'p');
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(pr)); return null; }
    return { pr, loc: {} };
  }
  const progs = { pre: program(PRE), blur: program(BLUR), rays: program(RAYS), comp: program(COMP) };
  if (Object.values(progs).some(x => !x)) return null;

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function texture() {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function target(w, h) {
    const t = texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { f, t, w, h };
  }
  const BW = W / 2, BH = H / 2;
  const sceneT = texture(), glowT = texture();
  const A = target(BW, BH), B = target(BW, BH), RT = target(BW, BH);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

  function run(pg, out, texs, uni) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.f : null);
    gl.viewport(0, 0, out ? out.w : canvas.width, out ? out.h : canvas.height);
    gl.useProgram(pg.pr);
    const loc = n => (n in pg.loc ? pg.loc[n] : (pg.loc[n] = gl.getUniformLocation(pg.pr, n)));
    texs.forEach(([name, t], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(loc(name), i);
    });
    for (const k in uni) {
      const val = uni[k], l = loc(k);
      if (typeof val === 'number') gl.uniform1f(l, val);
      else if (val.length === 2) gl.uniform2fv(l, val);
      else if (val.length === 3) gl.uniform3fv(l, val);
      else gl.uniform4fv(l, val);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  return {
    render(u) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneT);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, SCENE);
      gl.bindTexture(gl.TEXTURE_2D, glowT);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, GLOW);
      run(progs.pre, A, [['uScene', sceneT], ['uGlow', glowT]], {});
      const steps = u.fx > 0.5 ? [1, 2, 4] : [1.5, 3];
      for (const k of steps) {
        run(progs.blur, B, [['uTex', A.t]], { uDir: [k / BW, 0] });
        run(progs.blur, A, [['uTex', B.t]], { uDir: [0, k / BH] });
      }
      run(progs.rays, RT, [['uScene', sceneT]], { uMoon: u.moon, uK: u.fx > 0.5 ? 1.0 : 0.6 });
      run(progs.comp, null, [['uScene', sceneT], ['uBloom', A.t], ['uRays', RT.t]], {
        uRes: [W, H], uMoon: u.moon, uTime: time % 1000, uCam: u.cam, uHurt: u.hurt, uLowHp: u.low, uFx: u.fx,
        uLight: u.light, uFlash: u.flash, 'uLamps[0]': u.lamps
      });
    }
  };
}

/* ---------- Frame ---------- */

let POST = null;
const ZA = { x: W / 2, y: 410 };

function toUV(x, y) {
  const z = zoom + zoomKick;
  return [((x - ZA.x) * z + ZA.x) / W, 1 - ((y - ZA.y) * z + ZA.y) / H];
}

function postUniforms() {
  const lantK = P.state === 'dead' ? Math.max(0, 1 - P.t / 3) : 1;
  const lamps = new Float32Array(16);
  const vis = deco.lamps
    .map(l => ({ x: l.x + 24 - camX, d: Math.abs(l.x + 24 - camX - W / 2) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 4);
  vis.forEach((l, i) => {
    const [ux, uy] = toUV(l.x, GROUND - 120);
    lamps.set([ux, uy, 0.75, 0], i * 4);
  });
  const fk = P.flash / 0.16;
  return {
    light: [...toUV(P.lx - camX, P.ly), lantK],
    flash: P.flash > 0 ? [...toUV(P.muzzleX - camX + P.face * 30, P.muzzleY), fk * 1.4] : [0, 0, 0],
    moon: toUV(MOON.x, MOON.y),
    lamps,
    cam: camX / W,
    hurt: redFlash,
    low: P.hp > 0 && P.hp < 30 && mode === 'play' ? 0.5 + Math.sin(time * 5) * 0.5 : 0,
    fx: fxLow ? 0.35 : 1
  };
}

function render() {
  gg.save();
  gg.setTransform(1, 0, 0, 1, 0, 0);
  gg.clearRect(0, 0, GLOW.width, GLOW.height);
  gg.restore();

  const z = zoom + zoomKick;
  const sh = shake > 0.3 ? [rand(-shake, shake) * 0.6, rand(-shake, shake) * 0.6] : [0, 0];
  for (const g of [ctx, gg]) {
    g.save();
    g.translate(sh[0] + ZA.x, sh[1] + ZA.y);
    g.scale(z, z);
    g.translate(-ZA.x, -ZA.y);
  }

  drawSky();
  drawBats();
  drawTiled(ctx, MOUNT, 0.03, 170);
  drawTiled(ctx, FAR, 0.08, 40);
  drawFogBand(FOG_PURPLE, 0.1, 250, 6, 0.9);
  drawTiled(ctx, BACK, 0.2, 146);
  drawFogBand(FOG_PURPLE, 0.2, 290, 9, 0.7);
  drawTiled(ctx, TREES2, 0.35, 0);
  drawFogBand(FOG_PURPLE, 0.3, 310, 11, 0.7);
  drawTiled(ctx, MID, 0.55, -70);
  drawTiled(gg, MID_GLOW, 0.55, -70);
  drawFogBand(FOG_BLUE, 0.5, 330, 14, 0.75);

  for (const t of deco.trees) {
    const sx = t.x - camX;
    if (sx > -300 && sx < W + 300) ctx.drawImage(TREE_NEAR, sx - TREE_NEAR.w / 2, GROUND + 8 - TREE_NEAR.h, TREE_NEAR.w, TREE_NEAR.h);
  }
  drawGround();
  drawPuddles();
  drawDecals();
  for (const s of deco.stones) drawStone(s);
  for (const l of deco.lamps) drawLamp(l.x);
  for (const pl of deco.piles) {
    const sx = pl.x - camX;
    if (sx > -160 && sx < W + 160) ctx.drawImage(pl.img, sx - pl.img.w / 2, GROUND + 8 - pl.img.h, pl.img.w, pl.img.h);
  }
  drawGrass(false);
  drawFlowers();
  drawFogBand(FOG_BLUE, 0.9, GROUND - 110, 20, 0.4);

  drawSpikes();
  drawPickups();
  const actors = enemies.slice();
  if (mode !== 'title') actors.push({ type: 'player', lane: 6 });
  actors.sort((a, b) => a.lane - b.lane);
  for (const a of actors) {
    if (a.type === 'player') drawPlayer();
    else if (a.type === 'ghoul') drawGhoul(a);
    else drawBloom(a);
  }
  if (mode === 'title') drawPlayer();
  drawParticles(false);
  drawGrass(true);
  drawFogBand(FOG_PURPLE, 1.1, GROUND - 60, 26, 0.35);

  drawLighting(collectLights());
  // blood stays readable in the dark: a second, lighter pass of the stains and the flying gore
  drawDecals(POST ? 0.2 : 0.4);
  drawParticles(false, true);
  drawParticles(true);
  drawTiled(ctx, FORE, 1.35, H - 115);
  gg.restore();
  ctx.restore();

  if (POST) POST.render(postUniforms());
  else {
    bloom();
    grade();
    ctx.drawImage(VIGNETTE, 0, 0, W, H);
    drawGrain();
  }

  hud.clearRect(0, 0, W, H);
  drawScreenSplats();
  if (!POST) {
    if (redFlash > 0) {
      hud.fillStyle = `rgba(140,10,30,${redFlash * 0.35})`;
      hud.fillRect(0, 0, W, H);
    }
    if (P.hp > 0 && P.hp < 30 && mode === 'play') {
      const k = 0.5 + Math.sin(time * 5) * 0.5;
      const vg = hud.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.6);
      vg.addColorStop(0, 'rgba(120,0,20,0)');
      vg.addColorStop(1, `rgba(120,0,20,${0.3 + k * 0.2})`);
      hud.fillStyle = vg;
      hud.fillRect(0, 0, W, H);
    }
  }
  if (mode === 'title') drawTitle();
  else {
    drawHUD();
    if (mode === 'dead') drawDeath();
    if (mode === 'paused') {
      hud.fillStyle = 'rgba(4,2,10,0.55)';
      hud.fillRect(0, 0, W, H);
      centreText('Paused', H * 0.45, 56, '#e6dcf2', 700, 4);
      centreText('Press P to return to the hunt', H * 0.45 + 42, 18, '#a99ec2', 500);
    }
  }
}

POST = initPost(view);
if (!POST) {
  // no WebGL: show the 2D scene directly and finish it with the canvas effects
  view.replaceWith(SCENE);
}

let last = performance.now();
function frame(now) {
  const raw = (now - last) / 1000;
  const dt = Math.min(1 / 30, raw);
  last = now;
  // drop the costliest effects if the device keeps missing frames
  if (!fxLow && raw < 0.5) {
    slowT = raw > 0.026 ? slowT + raw : Math.max(0, slowT - raw * 0.5);
    if (slowT > 4) fxLow = true;
  }
  update(dt);
  settleHeads();
  render();
  for (const k in pressed) pressed[k] = false;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
