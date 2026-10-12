'use strict';

/* ---------- Basics ---------- */

const W = 960, H = 540, GROUND = 452, WORLD = 3400;
const TAU = Math.PI * 2;
const R = Math.min(2, window.devicePixelRatio || 1);
const SERIF = '"Cormorant Garamond", Georgia, serif';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const rand = (a, b) => a + Math.random() * (b - a);
const damp = (k, dt) => 1 - Math.pow(k, dt);

function rng(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * R);
  c.height = Math.ceil(h * R);
  c.w = w;
  c.h = h;
  const g = c.getContext('2d');
  g.setTransform(R, 0, 0, R, 0, 0);
  return [c, g];
}

const cv = document.getElementById('game');
cv.width = W * R;
cv.height = H * R;
const ctx = cv.getContext('2d');
ctx.setTransform(R, 0, 0, R, 0, 0);

/* ---------- Scenery builders ---------- */

function branch(g, r, x, y, len, ang, w, d) {
  const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
  const bend = (r() - 0.5) * len * 0.7;
  const cx = (x + x2) / 2 + Math.cos(ang + Math.PI / 2) * bend;
  const cy = (y + y2) / 2 + Math.sin(ang + Math.PI / 2) * bend;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(cx, cy, x2, y2);
  g.stroke();
  if (d <= 0 || w < 0.7) return;
  const n = d > 4 ? 2 : r() < 0.4 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const na = ang + (i - (n - 1) / 2) * (0.45 + r() * 0.55) + (r() - 0.5) * 0.5;
    branch(g, r, x2, y2, len * (0.6 + r() * 0.24), na, w * 0.66, d - 1);
  }
}

function drawTree(g, r, bx, by, h, trunk, col, depth) {
  g.strokeStyle = col;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let i = 0; i < 6; i++) {
    const dir = i % 2 ? 1 : -1;
    const len = trunk * (1.5 + r() * 2.5);
    g.lineWidth = trunk * (0.25 + r() * 0.3);
    g.beginPath();
    g.moveTo(bx, by - trunk * 0.8);
    g.quadraticCurveTo(bx + dir * len * 0.35, by - 2, bx + dir * len, by + 2);
    g.stroke();
  }
  // trunk drawn as a twisted pair of strokes
  const lean = (r() - 0.5) * 0.5;
  branch(g, r, bx, by, h * 0.32, -Math.PI / 2 + lean, trunk, depth);
  branch(g, r, bx + trunk * 0.2, by, h * 0.28, -Math.PI / 2 + lean + 0.25, trunk * 0.6, depth - 2);
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
  g.fillRect(cx - 130 * s, base - 120 * s, 260 * s, 120 * s);
  g.beginPath();
  g.moveTo(cx - 130 * s, base - 120 * s);
  g.lineTo(cx, base - 165 * s);
  g.lineTo(cx + 130 * s, base - 120 * s);
  g.fill();
  for (let i = 0; i < 12; i++) {
    spire(g, cx + (-125 + i * 23) * s, base - 110 * s, 7 * s, (50 + r() * 40) * s);
  }
  spire(g, cx - 78 * s, base, 40 * s, 280 * s, dark);
  spire(g, cx + 80 * s, base, 38 * s, 262 * s, dark);
  spire(g, cx, base, 54 * s, 370 * s, dark);
  for (let i = 0; i < 6; i++) {
    const x = cx + (-48 + i * 19) * s;
    spire(g, x, base - 170 * s, 6 * s, 70 * s);
  }
  g.fillStyle = dark;
  g.beginPath();
  g.arc(cx, base - 92 * s, 16 * s, 0, TAU);
  g.fill();
  g.fillStyle = col;
}

function skull(g, x, y, s, col, dark) {
  g.fillStyle = col;
  g.beginPath();
  g.ellipse(x, y, 9 * s, 8.5 * s, 0, 0, TAU);
  g.fill();
  g.beginPath();
  g.roundRect ? g.roundRect(x - 5.5 * s, y + 2 * s, 11 * s, 8 * s, 2 * s) : g.rect(x - 5.5 * s, y + 2 * s, 11 * s, 8 * s);
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

function makeSkullPile(seed, w, h, col, dark) {
  const r = rng(seed);
  const [c, g] = mk(w, h);
  const rows = 3;
  for (let row = 0; row < rows; row++) {
    const n = 7 - row * 2;
    for (let i = 0; i < n; i++) {
      const s = 1 + r() * 0.7 - row * 0.1;
      const x = w / 2 + (i - (n - 1) / 2) * 18 * (1 - row * 0.15) + (r() - 0.5) * 6;
      const y = h - 12 - row * 13 - r() * 3;
      skull(g, x, y, s, col, dark);
    }
  }
  // scattered bones
  g.strokeStyle = col;
  g.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    g.lineWidth = 2 + r() * 2;
    const x = r() * w, y = h - 4 - r() * 6, l = 10 + r() * 16, a = (r() - 0.5) * 0.6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  return c;
}

function fogTint(c, colour) {
  const g = c.getContext('2d');
  g.save();
  g.setTransform(R, 0, 0, R, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  const gr = g.createLinearGradient(0, 0, 0, c.h);
  gr.addColorStop(0, colour.replace('A', '0'));
  gr.addColorStop(0.55, colour.replace('A', '0.15'));
  gr.addColorStop(1, colour.replace('A', '0.75'));
  g.fillStyle = gr;
  g.fillRect(0, 0, c.w, c.h);
  g.restore();
}

function buildSky() {
  const [c, g] = mk(W, H);
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#170c28');
  gr.addColorStop(0.3, '#3e2658');
  gr.addColorStop(0.58, '#6a4d8c');
  gr.addColorStop(0.78, '#4f4f8c');
  gr.addColorStop(1, '#1b1d3b');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  const halo = g.createRadialGradient(W * 0.36, 150, 0, W * 0.36, 150, 340);
  halo.addColorStop(0, 'rgba(235,200,255,0.32)');
  halo.addColorStop(1, 'rgba(235,200,255,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, W, H);
  const r = rng(7);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(${150 + r() * 60},${110 + r() * 50},${190 + r() * 50},${0.03 + r() * 0.05})`;
    g.beginPath();
    g.ellipse(r() * W, r() * H * 0.55, 80 + r() * 200, 8 + r() * 22, (r() - 0.5) * 0.1, 0, TAU);
    g.fill();
  }
  return c;
}

function buildFar() {
  const w = 1500, h = 400;
  const [c, g] = mk(w, h);
  const r = rng(11);
  const col = '#4b3a6c', dark = '#3a2c56';
  cathedral(g, r, 420, h - 10, 0.95, col, dark);
  cathedral(g, r, 1150, h - 30, 0.55, col, dark);
  // distant spires
  g.fillStyle = col;
  for (let i = 0; i < 9; i++) spire(g, 40 + r() * w, h - 20, 10 + r() * 14, 80 + r() * 150);
  // hills
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
  for (let i = 0; i < 9; i++) drawTree(g, r, 60 + i * 190 + r() * 80, h - 14, 150 + r() * 120, 7 + r() * 5, col, 6);
  // crooked cottages and grave crosses
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
  // a few dim windows that survive the fog
  for (let i = 0; i < 4; i++) {
    const x = 150 + i * 420 + (r() - 0.5) * 30;
    g.fillStyle = 'rgba(220,110,140,0.55)';
    g.fillRect(x - 6, h - 60, 5, 7);
  }
  return c;
}

function buildMid() {
  const w = 2300, h = 540;
  const [c, g] = mk(w, h);
  const r = rng(41);
  const col = '#1c1528';
  for (const tx of [180, 900, 1550, 2120]) drawTree(g, r, tx, h - 10, 330 + r() * 120, 18 + r() * 8, col, 8);
  // ruined leaning tower house
  const hx = 1250, hy = h - 10;
  g.save();
  g.translate(hx, hy);
  g.rotate(-0.1);
  g.fillStyle = '#1e1729';
  g.fillRect(-85, -360, 170, 360);
  g.beginPath();
  g.moveTo(-108, -360);
  g.lineTo(-30, -455);
  g.lineTo(-6, -430);
  g.lineTo(26, -470);
  g.lineTo(112, -360);
  g.fill();
  g.strokeStyle = 'rgba(95,75,120,0.35)';
  g.lineWidth = 1;
  for (let y = -350; y < 0; y += 13) {
    g.beginPath();
    g.moveTo(-85, y + (r() - 0.5) * 3);
    g.lineTo(85, y + (r() - 0.5) * 3);
    g.stroke();
  }
  g.fillStyle = '#140f1c';
  for (const bx of [-85, -30, 30, 79]) g.fillRect(bx, -360, 6, 360);
  g.fillRect(-90, -250, 180, 8);
  g.fillRect(-90, -130, 180, 8);
  g.restore();
  // collapsed lean-to roof with broken planks
  g.save();
  g.translate(hx + 70, hy - 160);
  g.rotate(0.42);
  g.fillStyle = '#1b1525';
  g.fillRect(0, 0, 330, 26);
  g.strokeStyle = 'rgba(100,80,130,0.4)';
  for (let x = 6; x < 330; x += 14) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + (r() - 0.5) * 4, 26 + r() * 18);
    g.stroke();
  }
  g.restore();
  // hanging roots and vines
  g.strokeStyle = 'rgba(120,115,165,0.45)';
  for (let i = 0; i < 40; i++) {
    const x = hx - 60 + r() * 380, y = hy - 360 + r() * 200, l = 40 + r() * 140;
    g.lineWidth = 0.6 + r() * 2;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + (r() - 0.5) * 30, y + l * 0.3, x + (r() - 0.5) * 30, y + l * 0.7, x + (r() - 0.5) * 20, y + l);
    g.stroke();
  }
  fogTint(c, 'rgba(105,95,170,A)');
  // red windows painted after the fog so they burn through it
  g.save();
  g.translate(hx, hy);
  g.rotate(-0.1);
  for (const [wx, wy] of [[-55, -330], [20, -320], [-50, -210], [30, -200], [-10, -100]]) {
    const glow = g.createRadialGradient(wx + 13, wy + 18, 0, wx + 13, wy + 18, 60);
    glow.addColorStop(0, 'rgba(220,70,100,0.35)');
    glow.addColorStop(1, 'rgba(220,70,100,0)');
    g.fillStyle = glow;
    g.fillRect(wx - 50, wy - 45, 126, 126);
    g.fillStyle = '#b3364f';
    g.fillRect(wx, wy, 26, 36);
    g.fillStyle = '#e06a7c';
    g.fillRect(wx + 3, wy + 3, 9, 13);
    g.fillRect(wx + 14, wy + 3, 9, 13);
    g.fillRect(wx + 3, wy + 19, 9, 14);
    g.fillRect(wx + 14, wy + 19, 9, 14);
  }
  g.restore();
  return c;
}

function buildFog(colour, seed) {
  const w = 600, h = 180;
  const [c, g] = mk(w, h);
  const r = rng(seed);
  for (let i = 0; i < 46; i++) {
    const x = r() * w, y = 50 + r() * 80, rad = 40 + r() * 80;
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

function buildForeground() {
  const w = 2600, h = 120;
  const [c, g] = mk(w, h);
  const r = rng(77);
  const col = '#08060d';
  g.fillStyle = col;
  g.strokeStyle = col;
  g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const x = 120 + i * 370 + r() * 120;
    for (let k = 0; k < 6; k++) skull(g, x + (k - 3) * 22 + r() * 8, h - 20 - r() * 18, 1.6 + r() * 0.8, '#17131f', col);
  }
  for (let i = 0; i < 260; i++) {
    const x = r() * w, hh = 20 + r() * 70, lean = (r() - 0.5) * 30;
    g.lineWidth = 1.5 + r() * 2.5;
    g.beginPath();
    g.moveTo(x, h);
    g.quadraticCurveTo(x + lean * 0.3, h - hh * 0.6, x + lean, h - hh);
    g.stroke();
  }
  return c;
}

function buildVignette() {
  const [c, g] = mk(W, H);
  const gr = g.createRadialGradient(W / 2, H * 0.48, H * 0.3, W / 2, H * 0.5, W * 0.68);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(2,0,8,0.78)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  return c;
}

const SKY = buildSky();
const FAR = buildFar();
const BACK = buildBack();
const MID = buildMid();
const FOG_PURPLE = buildFog('rgba(190,160,235,1)', 3);
const FOG_BLUE = buildFog('rgba(140,165,240,1)', 9);
const FORE = buildForeground();
const VIGNETTE = buildVignette();
const [LIGHT, lg] = mk(W, H);
const PILES = [1, 2, 3].map(s => makeSkullPile(s * 31, 150, 66, '#a59cb3', '#1a1422'));
const TREE_NEAR = (() => {
  const [c, g] = mk(520, 560);
  drawTree(g, rng(99), 260, 550, 420, 26, '#110c17', 8);
  return c;
})();

/* ---------- World decoration ---------- */

const deco = { grass: [], piles: [], stones: [], flowers: [], lamps: [], trees: [] };
(() => {
  const r = rng(5);
  for (let x = 0; x < WORLD; x += 6) deco.grass.push({ x: x + r() * 5, h: 8 + r() * 22, lean: (r() - 0.5) * 0.7, pale: r() < 0.25 });
  for (const x of [230, 880, 1480, 2160, 2820, 3260]) deco.piles.push({ x, img: PILES[Math.floor(r() * 3)] });
  for (let i = 0; i < 16; i++) deco.stones.push({ x: 100 + r() * (WORLD - 200), kind: Math.floor(r() * 3), s: 0.8 + r() * 0.5, tilt: (r() - 0.5) * 0.3 });
  for (let i = 0; i < 10; i++) {
    const cx = 150 + r() * (WORLD - 300), dots = [];
    for (let k = 0; k < 18; k++) dots.push({ dx: (r() - 0.5) * 90, dy: -r() * 16, s: 1 + r() * 1.6, ph: r() * TAU });
    deco.flowers.push({ x: cx, dots });
  }
  for (const x of [520, 1300, 2050, 2900]) deco.lamps.push({ x });
  for (const x of [60, 1720, 3150]) deco.trees.push({ x });
})();

/* ---------- Input ---------- */

const keys = {}, pressed = {};
const KEYMAP = {
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyW: 'jump', ArrowUp: 'jump', Space: 'jump',
  KeyJ: 'attack', KeyK: 'heavy', ShiftLeft: 'dodge', ShiftRight: 'dodge', KeyL: 'dodge',
  KeyE: 'heal', KeyR: 'heal', Enter: 'start', KeyP: 'pause', Escape: 'pause', KeyM: 'mute'
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
  // low drone and wind
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
  boss: () => { tone(60, 40, 2.5, 0.5, 'sawtooth', 300); noise(2, 200, 60, 0.5, 0.4, 'lowpass'); }
};

/* ---------- Game state ---------- */

let mode = 'title', time = 0, camX = 600, shake = 0, hitStop = 0, redFlash = 0;
let wave = 0, toSpawn = 0, spawnT = 0, nextWaveT = 0, waveCleared = true, score = 0, kills = 0;
let banner = { text: '', sub: '', t: 99 }, swingCounter = 0, deadT = 0, playT = 0;
let enemies = [], particles = [], spikes = [], shocks = [], pickups = [];
let best = 0;
try { best = +localStorage.getItem('hollow-lantern-best') || 0; } catch (e) { /* storage unavailable */ }

function newPlayer() {
  return {
    x: 700, y: GROUND, vx: 0, vy: 0, face: 1, hp: 100, maxHp: 100, hpLag: 100, st: 100, stDelay: 0,
    state: 'idle', t: 0, inv: 0, onGround: true, vials: 3, swing: 0, walk: 0, buf: null, bufT: 0,
    dodgeDir: 1, lunged: false, healed: false, trail: [], lx: 700, ly: GROUND - 40
  };
}
let P = newPlayer();

function reset() {
  P = newPlayer();
  enemies = []; particles = []; spikes = []; shocks = []; pickups = [];
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
  const hp = 30 + wave * 6;
  enemies.push({
    type: 'ghoul', x, lane: rand(-3, 14), face: P.x > x ? 1 : -1, hp, maxHp: hp,
    state: rise ? 'rise' : 'walk', t: 0, cd: rand(0.3, 1), speed: rand(50, 80) + wave * 3,
    pale: Math.random() < 0.55, phase: rand(0, TAU), hitBy: 0, flash: 0, vx: 0, alpha: 1,
    scale: rand(0.9, 1.15), struck: false
  });
  if (rise) burst(x, GROUND, 18, 'dust');
}

function spawnBoss() {
  const x = clamp(P.x + (P.x < WORLD / 2 ? 380 : -380), 150, WORLD - 150);
  const hp = 600 + wave * 70;
  const r = rng(wave * 13);
  const veins = [];
  for (let i = 0; i < 26; i++) {
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

/* ---------- Particles ---------- */

const PCOL = {
  ichor: ['#2a0f2c', '#3d1438', '#160818'],
  dust: ['rgba(120,105,150,0.5)', 'rgba(90,80,120,0.5)'],
  wisp: ['#8fb4ff', '#b9d0ff', '#6f8cff'],
  spark: ['#e8eeff', '#a9c1ff'],
  ember: ['#ff8a3a', '#ffb060', '#ff6a2a'],
  blood: ['#7a0f1f', '#a3162b'],
  heal: ['#ffcf7a', '#ff9a6a']
};

function burst(x, y, n, type, dir = 0, power = 1) {
  for (let i = 0; i < n; i++) {
    const cols = PCOL[type];
    const p = { x, y, vx: 0, vy: 0, life: 0, max: 1, size: 2, col: cols[Math.floor(Math.random() * cols.length)], g: 0, add: false, drag: 0.9, type, seed: Math.random() * 10 };
    switch (type) {
      case 'ichor':
      case 'blood':
        p.vx = (dir * rand(60, 260) + rand(-80, 80)) * power;
        p.vy = rand(-260, -40) * power;
        p.g = 900; p.max = rand(0.4, 0.9); p.size = rand(1.5, 3.5); p.drag = 0.98;
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

function ambient(dt) {
  if (Math.random() < dt * 16) {
    particles.push({
      x: camX + rand(-40, W + 40), y: rand(GROUND - 30, H), vx: rand(-10, 25), vy: rand(-45, -15), life: 0, max: rand(3, 7),
      size: rand(0.8, 2), col: PCOL.ember[Math.floor(Math.random() * 3)], g: -4, add: true, drag: 1, type: 'ember', seed: Math.random() * 10
    });
  }
  for (const f of deco.flowers) {
    if (f.x < camX - 60 || f.x > camX + W + 60) continue;
    if (Math.random() < dt * 1.2) {
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
    p.vy += p.g * dt;
    const d = Math.pow(p.drag, dt * 60);
    p.vx *= d;
    p.vy *= d;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if ((p.type === 'ichor' || p.type === 'blood') && p.y > GROUND + 8) { p.y = GROUND + 8; p.vx *= 0.5; p.vy = 0; p.g = 0; }
  }
  particles = particles.filter(p => p.life < p.max);
}

/* ---------- Combat ---------- */

function damageEnemy(e, dmg, kb, heavy) {
  e.hp -= dmg;
  e.flash = 0.12;
  const dir = P.face;
  const hy = e.type === 'bloom' ? GROUND - 120 : GROUND - 50;
  burst(e.x, hy, heavy ? 22 : 12, 'ichor', dir, heavy ? 1.3 : 1);
  burst(e.x, hy, 8, 'spark', dir);
  sfx.hit();
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
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  e.dead = true;
  e.state = 'dead';
  e.t = 0;
  kills++;
  if (e.type === 'ghoul') {
    score += 10 * wave + 5;
    burst(e.x, GROUND - 40, 16, 'wisp');
    sfx.die();
    if (Math.random() < 0.13) pickups.push({ x: e.x, y: GROUND - 50, vy: -200, t: 0 });
  } else {
    score += 400 + wave * 100;
    burst(e.x, GROUND - 120, 60, 'wisp');
    shake = 18;
    sfx.boss();
    showBanner('Bloom Felled', 'The roots wither and fall still');
    pickups.push({ x: e.x - 30, y: GROUND - 120, vy: -260, t: 0 });
    pickups.push({ x: e.x + 30, y: GROUND - 120, vy: -260, t: 0 });
  }
}

function playerHits(range, dmg, kb, heavy) {
  for (const e of enemies) {
    if (e.dead || e.hitBy === P.swing) continue;
    if ((e.state === 'rise' && e.t < 0.6) || (e.state === 'emerge' && e.t < 1.6)) continue;
    const half = e.type === 'bloom' ? 70 : 16;
    const dx = (e.x - P.x) * P.face;
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
  burst(P.x, GROUND - 60, 14, 'blood', dir);
  sfx.hurt();
  if (P.hp <= 0) {
    P.hp = 0;
    P.state = 'dead';
    P.t = 0;
    mode = 'dead';
    deadT = 0;
    sfx.death();
    if (score > best) {
      best = score;
      try { localStorage.setItem('hollow-lantern-best', String(best)); } catch (e) { /* storage unavailable */ }
    }
  }
}

/* ---------- Updates ---------- */

function startAttack(mv) {
  P.state = 'attack'; P.t = 0; P.st -= 14; P.stDelay = 0.6; P.swing = ++swingCounter; P.buf = null;
  if (mv) P.face = mv;
  sfx.swing();
}

function updatePlayer(dt) {
  const p = P;
  p.t += dt;
  p.inv = Math.max(0, p.inv - dt);
  p.hpLag = p.hpLag > p.hp ? Math.max(p.hp, p.hpLag - 35 * dt) : p.hp;
  p.bufT -= dt;
  if (p.bufT <= 0) p.buf = null;
  const mv = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const busy = p.state === 'attack' || p.state === 'heavy' || p.state === 'dodge' || p.state === 'hurt' || p.state === 'heal' || p.state === 'dead';

  if (!busy) {
    if (p.buf === 'attack' && p.st > 0) startAttack(mv);
    else if (p.buf === 'heavy' && p.st > 10 && p.onGround) {
      p.state = 'heavy'; p.t = 0; p.st -= 32; p.stDelay = 0.8; p.swing = ++swingCounter; p.buf = null; p.lunged = false;
      if (mv) p.face = mv;
    } else if (p.buf === 'dodge' && p.st > 10 && p.onGround) {
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
    case 'idle':
    case 'run':
      if (mv) {
        p.face = mv;
        p.vx = lerp(p.vx, mv * 240, damp(0.0005, dt));
        p.state = 'run';
      } else {
        p.vx = lerp(p.vx, 0, damp(p.onGround ? 0.00002 : 0.05, dt));
        p.state = 'idle';
      }
      break;
    case 'attack':
      p.vx *= Math.pow(0.01, dt);
      if (p.t >= 0.126 && p.t <= 0.231) playerHits(110, 22, 170, false);
      if (p.t > 0.28 && p.buf === 'attack' && p.st > 0) startAttack(mv);
      else if (p.t >= 0.42) { p.state = 'idle'; p.t = 0; }
      break;
    case 'heavy':
      if (p.t < 0.38) p.vx *= Math.pow(0.001, dt);
      else if (!p.lunged) { p.lunged = true; p.vx = p.face * 280; sfx.heavy(); }
      else p.vx *= Math.pow(0.02, dt);
      if (p.t >= 0.4 && p.t <= 0.56) playerHits(140, 62, 330, true);
      if (p.t >= 0.82) { p.state = 'idle'; p.t = 0; }
      break;
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
  switch (e.state) {
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
        if (Math.abs(P.x - (e.x + e.face * 30)) < 46 && P.y > GROUND - 60) hurtPlayer(10 + wave * 1.5, e.face);
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
      e.alpha = 1 - e.t / 0.9;
      if (Math.random() < dt * 20) burst(e.x, GROUND - 20, 1, 'wisp');
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
    if (s.t >= 0.8 && s.t < 0.82 && !s.sounded) { s.sounded = true; shake = Math.max(shake, 4); burst(s.x, GROUND, 8, 'dust'); }
    if (!s.hit && s.t >= 0.8 && s.t < 1.15 && Math.abs(P.x - s.x) < 32 && P.y > GROUND - 75) {
      s.hit = true;
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
  if (mode === 'title') {
    camX = 300 + (Math.sin(time * 0.06) * 0.5 + 0.5) * (WORLD - W - 600);
    P.x = camX + W * 0.5;
    if (pressed.start || pressed.attack || pressed.jump) reset();
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
  for (const e of enemies) (e.type === 'ghoul' ? updateGhoul : updateBloom)(e, dt);
  // keep ghouls from stacking into one blob
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

function drawTiled(img, f, y, extra = 0) {
  const w = img.w;
  let off = -((camX * f + extra) % w);
  if (off > 0) off -= w;
  for (let x = off; x < W; x += w) ctx.drawImage(img, x, y, w, img.h);
}

function drawFogBand(img, f, y, speed, alpha) {
  ctx.globalAlpha = alpha;
  drawTiled(img, f, y, time * speed);
  ctx.globalAlpha = 1;
}

function drawGround() {
  const gr = ctx.createLinearGradient(0, GROUND - 10, 0, H);
  gr.addColorStop(0, '#221a38');
  gr.addColorStop(0.25, '#140f22');
  gr.addColorStop(1, '#050409');
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let sx = 0; sx <= W + 20; sx += 20) {
    const wx = sx + camX;
    ctx.lineTo(sx, GROUND - 3 + Math.sin(wx * 0.013) * 3 + Math.sin(wx * 0.041) * 1.5);
  }
  ctx.lineTo(W, H);
  ctx.fill();
  const sheen = ctx.createLinearGradient(0, GROUND - 6, 0, GROUND + 40);
  sheen.addColorStop(0, 'rgba(120,135,215,0.22)');
  sheen.addColorStop(1, 'rgba(120,135,215,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, GROUND - 6, W, 46);
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
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx + 24, GROUND - 140);
  ctx.lineTo(sx + 24, GROUND - 128);
  ctx.stroke();
  ctx.fillStyle = '#16131d';
  ctx.fillRect(sx + 18, GROUND - 128, 12, 16);
  ctx.fillStyle = '#d8ecff';
  ctx.fillRect(sx + 21, GROUND - 125, 6, 10 + Math.sin(time * 9 + x) * 1);
}

function drawStone(s) {
  const sx = s.x - camX;
  if (sx < -60 || sx > W + 60) return;
  ctx.save();
  ctx.translate(sx, GROUND + 4);
  ctx.rotate(s.tilt);
  ctx.scale(s.s, s.s);
  ctx.fillStyle = '#231d31';
  ctx.strokeStyle = 'rgba(150,150,210,0.25)';
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
  ctx.restore();
}

function drawGrass(front) {
  const step = front ? 3 : 1;
  ctx.lineCap = 'round';
  const passes = front ? [['#0b0912', false]] : [['#1b1628', false], ['#3c3658', true]];
  for (const [col, paleOnly] of passes) {
    ctx.strokeStyle = col;
    ctx.lineWidth = front ? 2.2 : 1.4;
    ctx.beginPath();
    for (let i = 0; i < deco.grass.length; i += step) {
      const g = deco.grass[i];
      const sx = g.x - camX;
      if (sx < -20 || sx > W + 20) continue;
      if (paleOnly && !g.pale) continue;
      const base = GROUND + (front ? 14 : 2);
      const h = front ? g.h * 0.9 : g.h;
      const sway = Math.sin(time * 1.6 + g.x * 0.03) * 3;
      for (let b = -1; b <= 1; b++) {
        ctx.moveTo(sx + b * 3, base);
        ctx.quadraticCurveTo(sx + b * 3 + g.lean * h * 0.4, base - h * 0.6, sx + b * 4 + g.lean * h + sway, base - h * (1 - Math.abs(b) * 0.25));
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
      ctx.fillStyle = `rgba(215,230,255,${0.55 + tw * 0.45})`;
      const x = sx + d.dx, y = GROUND + d.dy;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU + d.ph;
        ctx.ellipse(x + Math.cos(a) * d.s, y + Math.sin(a) * d.s, d.s * 0.8, d.s * 0.5, a, 0, TAU);
      }
      ctx.fill();
    }
  }
}

/* ---------- Drawing: characters ---------- */

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

function drawAxe(a) {
  ctx.save();
  ctx.rotate(a);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#2b2331';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-38, 0);
  ctx.lineTo(118, 0);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(170,175,230,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-36, -1.5);
  ctx.lineTo(116, -1.5);
  ctx.stroke();
  ctx.strokeStyle = '#3d3344';
  ctx.lineWidth = 4.6;
  for (let x = 30; x < 92; x += 9) {
    ctx.beginPath();
    ctx.moveTo(x, -1);
    ctx.lineTo(x + 3, 1);
    ctx.stroke();
  }
  // crescent blade
  ctx.fillStyle = '#3c3f55';
  ctx.beginPath();
  ctx.moveTo(98, 0);
  ctx.quadraticCurveTo(92, 18, 80, 42);
  ctx.quadraticCurveTo(118, 48, 142, 22);
  ctx.quadraticCurveTo(128, 10, 121, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(225,232,255,0.95)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(81, 41);
  ctx.quadraticCurveTo(118, 47, 141, 22);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(120,125,170,0.5)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(100, 8);
  ctx.quadraticCurveTo(108, 22, 100, 34);
  ctx.moveTo(110, 8);
  ctx.quadraticCurveTo(122, 20, 120, 34);
  ctx.stroke();
  // top spike and back hook
  ctx.fillStyle = '#23242f';
  ctx.beginPath();
  ctx.moveTo(104, 0);
  ctx.lineTo(112, -16);
  ctx.lineTo(117, 0);
  ctx.moveTo(118, -3);
  ctx.lineTo(134, -1);
  ctx.lineTo(118, 3);
  ctx.fill();
  ctx.restore();
}

function drawPlayer(p, wx, alpha, ghost) {
  const sx = wx - camX, sy = p.y + 6;
  if (sx < -160 || sx > W + 160) return;
  const C = ghost
    ? { cloak: '#5f7cff', body: '#6f8cff', dark: '#5f7cff', hat: '#6f8cff', rim: 'rgba(0,0,0,0)' }
    : { cloak: '#110e17', body: '#1c1a25', dark: '#0f0d14', hat: '#121019', rim: 'rgba(160,172,240,0.55)' };
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sx, sy);
  ctx.scale(p.face, 1);
  const st = p.state, t = p.t;
  const run = clamp(Math.abs(p.vx) / 240, 0, 1);
  let crouch = 0, tilt = 0;
  if (st === 'heavy' && t < 0.4) crouch = ease(t / 0.4) * 6;
  if (st === 'attack') tilt = Math.sin(clamp(t / 0.42, 0, 1) * Math.PI) * 0.12;
  if (st === 'dodge') { crouch = 16; tilt = 0.45; }
  if (st === 'hurt') tilt = -0.18;
  if (st === 'heal') crouch = 5;
  if (st === 'run') tilt = 0.08 * run;
  if (st === 'dead') tilt = -Math.min(1, t / 0.7) * 1.45;
  ctx.rotate(tilt);
  ctx.translate(0, crouch);
  const bob = st === 'run' ? Math.abs(Math.sin(p.walk * 2)) * -2.5 : Math.sin(time * 2) * 0.6;

  // cloak behind
  const flow = run * 18 + (p.onGround ? 0 : 10) + Math.sin(time * 3) * 2 + (st === 'dodge' ? 14 : 0);
  ctx.fillStyle = C.cloak;
  ctx.beginPath();
  ctx.moveTo(-8, -74 + bob);
  ctx.quadraticCurveTo(-20 - flow * 0.5, -52, -22 - flow, -12 + flow * 0.2);
  const hem = 7;
  for (let i = 0; i <= hem; i++) {
    const k = i / hem;
    const hx = lerp(-22 - flow, 8, k);
    const hy = lerp(-12 + flow * 0.2, -22, k) + (i % 2 ? -8 : 0) + Math.sin(time * 5 + i) * 1.5;
    ctx.lineTo(hx, hy);
  }
  ctx.lineTo(10, -70 + bob);
  ctx.closePath();
  ctx.fill();

  // legs
  const sw = Math.sin(p.walk) * run;
  let fb = [-4 - sw * 14, -Math.max(0, Math.cos(p.walk)) * 6 * run];
  let ff = [6 + sw * 14, -Math.max(0, -Math.cos(p.walk)) * 6 * run];
  if (!p.onGround) { fb = [-10, -10]; ff = [10, -16]; }
  if (st === 'dodge' || st === 'heavy') { fb = [-14, 0]; ff = [14, 0]; }
  ctx.strokeStyle = C.dark;
  ctx.lineCap = 'round';
  ctx.lineWidth = 7;
  for (const [f, off] of [[fb, -2], [ff, 3]]) {
    const hip = [off, -34 + bob];
    const knee = [(hip[0] + f[0]) / 2 + 5, (hip[1] + f[1]) / 2 - 2];
    ctx.beginPath();
    ctx.moveTo(hip[0], hip[1]);
    ctx.lineTo(knee[0], knee[1]);
    ctx.lineTo(f[0], f[1] - 3);
    ctx.stroke();
    ctx.fillStyle = C.dark;
    ctx.fillRect(f[0] - 4, f[1] - 6, 11, 6);
  }

  // coat skirt and torso
  ctx.fillStyle = C.body;
  ctx.beginPath();
  ctx.moveTo(-9, -42 + bob);
  ctx.lineTo(11, -42 + bob);
  ctx.lineTo(15 + run * 3, -18);
  ctx.lineTo(8, -14);
  ctx.lineTo(2, -20);
  ctx.lineTo(-5, -13);
  ctx.lineTo(-12 - run * 4, -18);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-10, -75 + bob);
  ctx.lineTo(12, -74 + bob);
  ctx.lineTo(10, -38 + bob);
  ctx.lineTo(-8, -38 + bob);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = C.rim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-10, -74 + bob);
  ctx.lineTo(-8, -38 + bob);
  ctx.stroke();
  ctx.fillStyle = ghost ? C.body : '#2a2232';
  ctx.fillRect(-9, -42 + bob, 20, 3);

  // pauldron, collar, head
  ctx.fillStyle = ghost ? C.body : '#24212d';
  ctx.beginPath();
  ctx.ellipse(1, -71 + bob, 13, 6, -0.1, 0, TAU);
  ctx.fill();
  ctx.fillStyle = C.dark;
  ctx.beginPath();
  ctx.arc(5, -82 + bob, 7, 0, TAU);
  ctx.fill();
  ctx.fillStyle = ghost ? C.body : '#19161f';
  ctx.beginPath();
  ctx.moveTo(-7, -79 + bob);
  ctx.lineTo(14, -80 + bob);
  ctx.lineTo(15, -71 + bob);
  ctx.lineTo(-9, -70 + bob);
  ctx.fill();

  // hat
  ctx.save();
  ctx.translate(3, -89 + bob);
  ctx.rotate(-0.07 + (st === 'run' ? Math.sin(p.walk * 2) * 0.02 : 0));
  ctx.fillStyle = C.hat;
  ctx.beginPath();
  ctx.ellipse(0, 0, 31, 5.5, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-11, -1);
  ctx.lineTo(-9, -15);
  ctx.quadraticCurveTo(1, -21, 11, -15);
  ctx.lineTo(13, -1);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = C.rim;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(0, -0.5, 31, 5.5, 0, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-9, -15);
  ctx.quadraticCurveTo(1, -21, 11, -15);
  ctx.stroke();
  ctx.restore();

  // lantern at the hip
  const la = Math.sin(time * 3.2) * 0.25 - clamp(p.vx, -300, 300) * 0.0012;
  const lx0 = 13, ly0 = -40 + bob;
  const lx = lx0 + Math.sin(la) * 9, ly = ly0 + Math.cos(la) * 9;
  ctx.strokeStyle = '#3a3344';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(lx0, ly0);
  ctx.lineTo(lx, ly);
  ctx.stroke();
  ctx.fillStyle = '#16131c';
  ctx.fillRect(lx - 5, ly, 10, 14);
  ctx.beginPath();
  ctx.moveTo(lx - 6, ly);
  ctx.lineTo(lx, ly - 4);
  ctx.lineTo(lx + 6, ly);
  ctx.fill();
  if (!ghost) {
    ctx.fillStyle = '#e4f1ff';
    ctx.fillRect(lx - 3, ly + 2, 6, 10);
    ctx.fillStyle = '#8fb0ff';
    ctx.fillRect(lx - 3, ly + 6, 6, 1);
  }
  if (!ghost && alpha === 1) {
    const cos = Math.cos(tilt), sin = Math.sin(tilt);
    const rx = lx * cos - (ly + 7 + crouch) * sin, ry = lx * sin + (ly + 7 + crouch) * cos;
    p.lx = wx + rx * p.face;
    p.ly = sy + ry;
  }

  // arms and axe
  const a = axeAngle(p);
  const pv = [4 + Math.cos(a) * 18, -64 + bob + Math.sin(a) * 18];
  const h2 = [pv[0] + Math.cos(a) * 24, pv[1] + Math.sin(a) * 24];
  const swinging = (st === 'attack' && t > 0.12 && t < 0.25) || (st === 'heavy' && t > 0.38 && t < 0.56);
  if (swinging && !ghost) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const grd = ctx.createRadialGradient(pv[0], pv[1], 70, pv[0], pv[1], 140);
    grd.addColorStop(0, 'rgba(140,170,255,0)');
    grd.addColorStop(1, 'rgba(170,195,255,0.35)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(pv[0], pv[1], 140, a - 1.1, a);
    ctx.arc(pv[0], pv[1], 70, a, a - 1.1, true);
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = C.body;
  ctx.lineWidth = 5.5;
  ctx.beginPath();
  ctx.moveTo(-3, -69 + bob);
  ctx.lineTo((pv[0] - 3) / 2 - 3, (pv[1] - 69 + bob) / 2 + 6);
  ctx.lineTo(pv[0], pv[1]);
  ctx.stroke();
  ctx.save();
  ctx.translate(pv[0], pv[1]);
  drawAxe(a);
  ctx.restore();
  ctx.strokeStyle = ghost ? C.body : '#211e2a';
  ctx.beginPath();
  ctx.moveTo(8, -69 + bob);
  ctx.lineTo((h2[0] + 8) / 2 + 2, (h2[1] - 69 + bob) / 2 + 7);
  ctx.lineTo(h2[0], h2[1]);
  ctx.stroke();
  ctx.fillStyle = C.dark;
  ctx.beginPath();
  ctx.arc(pv[0], pv[1], 3.2, 0, TAU);
  ctx.arc(h2[0], h2[1], 3.2, 0, TAU);
  ctx.fill();

  // healing vial raised to the face
  if (st === 'heal' && t < 0.6 && !ghost) {
    ctx.fillStyle = '#b5223a';
    ctx.fillRect(12, -80 + bob, 5, 9);
  }
  ctx.restore();
}

function ghoulShape(e, ox, oy, col, lw) {
  const st = e.state, t = e.t;
  const step = Math.sin(e.phase);
  let lean = 0.38 + Math.sin(time * 2 + e.phase) * 0.05;
  let el = [7, 22], hd = [13, 46];
  let el2 = [2, 22], hd2 = [6, 45];
  const sway = Math.sin(time * 2.4 + e.phase) * 4;
  hd[0] += sway; hd2[0] -= sway * 0.6;
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
  } else if (st === 'dead') {
    lean = 0.38 + Math.min(1, t / 0.6) * 1.1;
  }
  const hip = [ox, oy - 40];
  const sh = [hip[0] + Math.sin(lean) * 34, hip[1] - Math.cos(lean) * 34];
  const head = [sh[0] + Math.sin(lean + 0.6) * 15, sh[1] - Math.cos(lean + 0.6) * 15];
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const walking = st === 'walk';
  const fb = [ox - 10 + (walking ? step * 13 : 0), oy];
  const ff = [ox + 10 - (walking ? step * 13 : 0), oy];
  for (const f of [fb, ff]) {
    const knee = [(hip[0] + f[0]) / 2 + 9, (hip[1] + f[1]) / 2 - 1];
    ctx.lineWidth = 5 + lw;
    ctx.beginPath();
    ctx.moveTo(hip[0], hip[1]);
    ctx.lineTo(knee[0], knee[1]);
    ctx.lineTo(f[0], f[1]);
    ctx.lineTo(f[0] + 7, f[1]);
    ctx.stroke();
  }
  // back arm
  ctx.lineWidth = 3.5 + lw;
  ctx.beginPath();
  ctx.moveTo(sh[0] - 3, sh[1]);
  ctx.lineTo(sh[0] - 3 + el2[0], sh[1] + el2[1]);
  ctx.lineTo(sh[0] - 3 + hd2[0], sh[1] + hd2[1]);
  ctx.stroke();
  // torso with a hunched rib cage
  ctx.lineWidth = 9 + lw;
  ctx.beginPath();
  ctx.moveTo(hip[0], hip[1]);
  ctx.quadraticCurveTo(hip[0] + Math.sin(lean) * 10 - 8, hip[1] - 22, sh[0], sh[1]);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse((hip[0] + sh[0]) / 2 + 1, (hip[1] + sh[1]) / 2 - 2, 9 + lw / 2, 13 + lw / 2, lean, 0, TAU);
  ctx.fill();
  ctx.lineWidth = 4 + lw;
  ctx.beginPath();
  ctx.moveTo(sh[0], sh[1]);
  ctx.lineTo(head[0], head[1]);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(head[0] + 3, head[1] - 2, 8 + lw / 2, 13 + lw / 2, lean + 0.9, 0, TAU);
  ctx.fill();
  // front arm with long fingers
  ctx.lineWidth = 3.5 + lw;
  const e1 = [sh[0] + el[0], sh[1] + el[1]], h1 = [sh[0] + hd[0], sh[1] + hd[1]];
  ctx.beginPath();
  ctx.moveTo(sh[0], sh[1]);
  ctx.lineTo(e1[0], e1[1]);
  ctx.lineTo(h1[0], h1[1]);
  ctx.stroke();
  const fa = Math.atan2(h1[1] - e1[1], h1[0] - e1[0]);
  ctx.lineWidth = 1.3 + lw;
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    ctx.moveTo(h1[0], h1[1]);
    ctx.lineTo(h1[0] + Math.cos(fa + i * 0.35) * 11, h1[1] + Math.sin(fa + i * 0.35) * 11);
  }
  ctx.stroke();
  return head;
}

function drawGhoul(e) {
  const sx = e.x - camX;
  if (sx < -120 || sx > W + 120) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, e.alpha);
  let yOff = e.lane;
  if (e.state === 'rise') {
    const k = clamp(e.t, 0, 1);
    ctx.beginPath();
    ctx.rect(sx - 90, 0, 180, GROUND + e.lane + 3);
    ctx.clip();
    yOff += (1 - ease(k)) * 100;
  }
  if (e.state === 'dead') yOff += e.t * 14;
  ctx.translate(sx, GROUND + yOff);
  ctx.scale(e.face * e.scale, e.scale);
  const fog = clamp((e.lane + 3) / 17, 0, 1);
  const body = e.flash > 0 ? '#ece6ff' : e.pale ? '#7d7690' : '#3e394d';
  ghoulShape(e, -1.4, -1.6, `rgba(175,185,240,${0.35 + fog * 0.25})`, 1.4);
  const head = ghoulShape(e, 0, 0, body, 0);
  // hollow eye sockets
  ctx.fillStyle = '#0b0910';
  ctx.beginPath();
  ctx.ellipse(head[0] + 6, head[1] - 1, 2.2, 3.2, 0.6, 0, TAU);
  ctx.ellipse(head[0] + 2, head[1] + 5, 2, 3, 0.6, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawBloom(b) {
  const sx = b.x - camX;
  if (sx < -260 || sx > W + 260) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, b.alpha);
  let sink = 0;
  if (b.state === 'emerge') {
    sink = (1 - ease(clamp(b.t / 2.2, 0, 1))) * 240;
    ctx.beginPath();
    ctx.rect(sx - 260, 0, 520, GROUND + 4);
    ctx.clip();
  }
  if (b.state === 'dead') sink = b.t * 40;
  ctx.translate(sx, GROUND + b.lane + 10 + sink);
  ctx.scale(b.face, 1);
  const lift = b.lift;
  const breathe = Math.sin(b.phase * 1.6) * 3;
  const flash = b.flash > 0;
  const plate = flash ? '#d9d2ee' : '#3a3349';
  const plateRim = 'rgba(180,175,230,0.45)';

  // root legs
  ctx.strokeStyle = '#191422';
  ctx.lineCap = 'round';
  for (const [x, w] of [[-38, 18], [34, 18], [-10, 10], [58, 8], [-62, 8]]) {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x * 0.6, -60 + lift);
    ctx.quadraticCurveTo(x * 1.2, -30 + lift / 2, x * 1.4, 0);
    ctx.stroke();
  }

  // the two split husk halves
  for (const s of [-1, 1]) {
    const open = (b.state === 'slamWind' ? 10 : 0) + breathe;
    ctx.save();
    ctx.scale(s, 1);
    ctx.translate(open, lift);
    ctx.fillStyle = plate;
    ctx.beginPath();
    ctx.moveTo(-26, -222);
    ctx.quadraticCurveTo(-138, -210, -118, -100);
    ctx.quadraticCurveTo(-104, -36, -50, -26);
    ctx.quadraticCurveTo(-92, -120, -26, -222);
    ctx.fill();
    ctx.strokeStyle = plateRim;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-26, -222);
    ctx.quadraticCurveTo(-138, -210, -118, -100);
    ctx.quadraticCurveTo(-104, -36, -50, -26);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(20,14,28,0.7)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(-40 - i * 4, -200 + i * 8);
      ctx.quadraticCurveTo(-112 + i * 6, -150 + i * 12, -64 + i * 2, -40 - i * 2);
      ctx.stroke();
    }
    // horn tip
    ctx.fillStyle = plate;
    ctx.beginPath();
    ctx.moveTo(-26, -222);
    ctx.quadraticCurveTo(-10, -246, 6, -250);
    ctx.quadraticCurveTo(-8, -234, -12, -214);
    ctx.fill();
    ctx.restore();
  }

  // the root-knotted core
  ctx.save();
  ctx.translate(0, -124 + lift);
  const gr = ctx.createRadialGradient(0, 0, 4, 0, 0, 80);
  gr.addColorStop(0, flash ? '#efe9ff' : '#3c3448');
  gr.addColorStop(1, flash ? '#9c94b8' : '#110d17');
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.ellipse(0, 0, 62, 84 + breathe, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(170,165,225,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 62, 84 + breathe, 0, Math.PI * 0.95, Math.PI * 1.75);
  ctx.stroke();
  ctx.lineCap = 'round';
  for (const v of b.veins) {
    ctx.strokeStyle = 'rgba(8,5,12,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(v[0][0], v[0][1]);
    for (const pt of v) ctx.lineTo(pt[0], pt[1]);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(140,130,185,0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // tendrils on top
  ctx.strokeStyle = '#1a1422';
  ctx.lineWidth = 2;
  for (let i = 0; i < 9; i++) {
    const x = -40 + i * 10, w = Math.sin(b.phase * 2 + i) * 6;
    ctx.beginPath();
    ctx.moveTo(x, -70);
    ctx.quadraticCurveTo(x + w, -100, x + w * 2 + (i - 4) * 4, -118 - (i % 3) * 8);
    ctx.stroke();
  }
  // the small skull at its heart
  skull(ctx, 0, -6, 1.15, flash ? '#ffffff' : '#c9c0d6', '#120c16');
  const angry = b.state === 'slamWind' || b.state === 'rootWind' || b.hp < b.maxHp * 0.5;
  if (angry) {
    ctx.fillStyle = 'rgba(255,70,90,0.9)';
    ctx.beginPath();
    ctx.arc(-4, -5, 1.6, 0, TAU);
    ctx.arc(4, -5, 1.6, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

function drawSpikes() {
  for (const s of spikes) {
    if (s.t < 0) continue;
    const sx = s.x - camX;
    if (s.t < 0.8) {
      const k = s.t / 0.8;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(180,90,220,${0.15 + k * 0.35})`;
      ctx.beginPath();
      ctx.ellipse(sx, GROUND + 4, 36 * (0.5 + k * 0.5), 6, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      continue;
    }
    const up = s.t < 1.0 ? ease((s.t - 0.8) / 0.2) : s.t > 1.3 ? 1 - (s.t - 1.3) / 0.3 : 1;
    ctx.fillStyle = '#1a1320';
    ctx.strokeStyle = 'rgba(200,190,240,0.5)';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      const h = (90 - Math.abs(i) * 22) * up, x = sx + i * 11;
      ctx.beginPath();
      ctx.moveTo(x - 7, GROUND + 6);
      ctx.quadraticCurveTo(x - 2 + i * 2, GROUND - h * 0.5, x + i * 4, GROUND - h);
      ctx.quadraticCurveTo(x + 3, GROUND - h * 0.4, x + 7, GROUND + 6);
      ctx.fill();
      ctx.stroke();
    }
  }
  for (const s of shocks) {
    const sx = s.x - camX, a = 1 - s.t / 1.5;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gr = ctx.createLinearGradient(sx - s.dir * 40, 0, sx, 0);
    gr.addColorStop(0, 'rgba(140,160,255,0)');
    gr.addColorStop(1, `rgba(190,205,255,${0.6 * a})`);
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(sx - s.dir * 50, GROUND + 4);
    ctx.quadraticCurveTo(sx - s.dir * 6, GROUND - 26, sx + s.dir * 4, GROUND + 4);
    ctx.fill();
    ctx.restore();
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
  }
}

function drawParticles(additive) {
  if (additive) ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    if (p.add !== additive) continue;
    const sx = p.x - camX;
    if (sx < -20 || sx > W + 20) continue;
    const k = p.life / p.max;
    let a = p.type === 'ember' ? Math.sin(k * Math.PI) * (0.6 + 0.4 * Math.sin(time * 12 + p.seed * 7)) : 1 - k;
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.fillStyle = p.col;
    const size = p.type === 'dust' ? p.size * (1 + k) : p.size;
    ctx.beginPath();
    ctx.arc(sx, p.y, size, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------- Lighting ---------- */

function collectLights() {
  const L = [];
  const flick = 0.92 + Math.sin(time * 13) * 0.04 + Math.sin(time * 7.3) * 0.04;
  if (P.state !== 'dead' || P.t < 3) {
    const k = P.state === 'dead' ? Math.max(0, 1 - P.t / 3) : 1;
    L.push({ x: P.lx - camX, y: P.ly, r: 250 * flick, s: 0.95 * k, glow: `rgba(90,140,255,${0.32 * k})`, gr: 170, core: true });
  }
  for (const l of deco.lamps) {
    const x = l.x + 24 - camX;
    if (x > -200 && x < W + 200) L.push({ x, y: GROUND - 120, r: 190 * flick, s: 0.75, glow: 'rgba(110,150,255,0.28)', gr: 120, core: true });
  }
  for (const f of deco.flowers) {
    const x = f.x - camX;
    if (x > -100 && x < W + 100) L.push({ x, y: GROUND - 6, r: 80, s: 0.45, glow: 'rgba(160,190,255,0.16)', gr: 60 });
  }
  for (const e of enemies) {
    if (e.type === 'bloom' && !e.dead) L.push({ x: e.x - camX, y: GROUND - 120 + e.lift, r: 120, s: 0.35, glow: 'rgba(170,120,255,0.14)', gr: 90 });
  }
  for (const k of pickups) L.push({ x: k.x - camX, y: k.y - 5, r: 50, s: 0.5, glow: 'rgba(255,70,100,0.35)', gr: 26 });
  for (const s of spikes) if (s.t > 0 && s.t < 0.8) L.push({ x: s.x - camX, y: GROUND, r: 60, s: 0.5 });
  return L;
}

function drawLighting(lights) {
  lg.globalCompositeOperation = 'source-over';
  lg.clearRect(0, 0, W, H);
  const gr = lg.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, 'rgba(8,4,22,0.28)');
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
      const c = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, 16);
      c.addColorStop(0, 'rgba(230,240,255,0.9)');
      c.addColorStop(1, 'rgba(120,160,255,0)');
      ctx.fillStyle = c;
      ctx.fillRect(l.x - 16, l.y - 16, 32, 32);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------- HUD ---------- */

function bar(x, y, w, h, frac, lag, col1, col2) {
  ctx.fillStyle = 'rgba(5,3,10,0.65)';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  if (lag !== null) {
    ctx.fillStyle = 'rgba(230,200,180,0.6)';
    ctx.fillRect(x, y, w * clamp(lag, 0, 1), h);
  }
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, col1);
  g.addColorStop(1, col2);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
  ctx.strokeStyle = 'rgba(170,150,190,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);
}

function centreText(text, y, size, colour, weight = 700, spacing = 0) {
  ctx.font = `${weight} ${size}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = spacing + 'px';
  ctx.fillStyle = colour;
  ctx.fillText(text, W / 2, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

function drawHUD() {
  bar(26, 24, 250, 10, P.hp / P.maxHp, P.hpLag / P.maxHp, '#6e1020', '#c0303f');
  bar(26, 42, 200, 6, P.st / 100, null, '#4f6a55', '#8fae86');
  for (let i = 0; i < 5; i++) {
    const x = 30 + i * 16, y = 64;
    ctx.globalAlpha = i < P.vials ? 1 : 0.2;
    ctx.fillStyle = '#c1263f';
    ctx.beginPath();
    ctx.ellipse(x, y + 4, 5, 6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#3a2830';
    ctx.fillRect(x - 2, y - 6, 4, 4);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.font = `700 22px ${SERIF}`;
  ctx.fillStyle = '#ddd2ea';
  ctx.fillText(wave ? 'Wave ' + wave : '', W - 26, 18);
  ctx.font = `500 17px ${SERIF}`;
  ctx.fillStyle = '#b9aed0';
  ctx.fillText('Echoes ' + score, W - 26, 44);

  const boss = enemies.find(e => e.type === 'bloom' && !e.dead);
  if (boss) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = `600 18px ${SERIF}`;
    ctx.fillStyle = '#e1d7ee';
    ctx.fillText('The Hollow Bloom', W / 2 - 260, H - 56);
    bar(W / 2 - 260, H - 50, 520, 8, boss.hp / boss.maxHp, null, '#5a1424', '#a32a3a');
  }

  if (banner.t < 3.2) {
    const a = banner.t < 0.5 ? banner.t / 0.5 : banner.t > 2.5 ? 1 - (banner.t - 2.5) / 0.7 : 1;
    ctx.globalAlpha = clamp(a, 0, 1);
    centreText(banner.text, H * 0.3, 52, '#e9dff5', 700, 2);
    centreText(banner.sub, H * 0.3 + 40, 20, '#b6aacd', 500, 1);
    ctx.globalAlpha = 1;
  }

  if (playT < 12 && mode === 'play') {
    ctx.globalAlpha = clamp((12 - playT) / 2, 0, 0.85);
    centreText('A D move  ·  W jump  ·  J or click to swing  ·  K or right click heavy  ·  Shift roll  ·  E drink vial', H - 18, 15, '#cbc0dc', 500);
    ctx.globalAlpha = 1;
  }
  if (muted) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `500 14px ${SERIF}`;
    ctx.fillStyle = '#8f84a6';
    ctx.fillText('Sound off (M)', 26, 82);
  }
}

function drawTitle() {
  ctx.fillStyle = 'rgba(6,3,14,0.35)';
  ctx.fillRect(0, 0, W, H);
  const pulse = 0.75 + Math.sin(time * 2.2) * 0.25;
  centreText('HOLLOW LANTERN', H * 0.3, 78, '#ece2f7', 700, 8);
  centreText('A hunt through the Vale of Bones', H * 0.3 + 52, 22, '#b8acd0', 500, 2);
  ctx.globalAlpha = pulse;
  centreText('Press Enter, click or tap to begin', H * 0.62, 22, '#d9cfe9', 600, 1);
  ctx.globalAlpha = 1;
  centreText('A D move  ·  W jump  ·  J swing  ·  K heavy  ·  Shift roll  ·  E vial  ·  P pause  ·  M sound', H * 0.62 + 36, 15, '#9a8fb3', 500);
  if (best) centreText('Best hunt: ' + best + ' echoes', H * 0.62 + 62, 15, '#9a8fb3', 500);
}

function drawDeath() {
  const a = clamp((deadT - 0.6) / 1.2, 0, 1);
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, H * 0.36, W, H * 0.22);
  centreText('YOU DIED', H * 0.47, 76, '#9e1426', 600, 10);
  ctx.globalAlpha = clamp((deadT - 1.6) / 0.8, 0, 1);
  centreText(`Wave ${wave}  ·  ${kills} slain  ·  ${score} echoes`, H * 0.64, 20, '#c8bcd8', 500, 1);
  centreText('Press Enter or tap to rise again', H * 0.64 + 30, 17, '#9a8fb3', 500);
  ctx.globalAlpha = 1;
}

/* ---------- Frame ---------- */

function render() {
  ctx.save();
  if (shake > 0.3) ctx.translate(rand(-shake, shake) * 0.6, rand(-shake, shake) * 0.6);

  ctx.drawImage(SKY, -20, -20, W + 40, H + 40);
  drawTiled(FAR, 0.08, 40);
  drawFogBand(FOG_PURPLE, 0.1, 250, 6, 0.9);
  drawTiled(BACK, 0.28, 146);
  drawFogBand(FOG_PURPLE, 0.25, 300, 10, 0.8);
  drawTiled(MID, 0.55, -70);
  drawFogBand(FOG_BLUE, 0.5, 330, 14, 0.75);

  for (const t of deco.trees) {
    const sx = t.x - camX;
    if (sx > -300 && sx < W + 300) ctx.drawImage(TREE_NEAR, sx - TREE_NEAR.w / 2, GROUND + 8 - TREE_NEAR.h, TREE_NEAR.w, TREE_NEAR.h);
  }
  drawGround();
  for (const s of deco.stones) drawStone(s);
  for (const l of deco.lamps) drawLamp(l.x);
  for (const pl of deco.piles) {
    const sx = pl.x - camX;
    if (sx > -160 && sx < W + 160) ctx.drawImage(pl.img, sx - pl.img.w / 2, GROUND + 8 - pl.img.h, pl.img.w, pl.img.h);
  }
  drawGrass(false);
  drawFlowers();
  drawFogBand(FOG_BLUE, 0.9, GROUND - 110, 20, 0.45);

  drawSpikes();
  drawPickups();
  const actors = enemies.slice();
  actors.push({ type: 'player', lane: 6 });
  actors.sort((a, b) => a.lane - b.lane);
  for (const a of actors) {
    if (a.type === 'player') {
      for (const tr of P.trail) drawPlayer(P, tr.x, tr.a * 0.5, true);
      drawPlayer(P, P.x, 1, false);
    } else if (a.type === 'ghoul') drawGhoul(a);
    else drawBloom(a);
  }
  drawParticles(false);
  drawGrass(true);
  drawFogBand(FOG_PURPLE, 1.1, GROUND - 60, 26, 0.35);

  drawLighting(collectLights());
  drawParticles(true);
  drawTiled(FORE, 1.35, H - 100);
  ctx.restore();

  ctx.drawImage(VIGNETTE, 0, 0, W, H);
  if (redFlash > 0) {
    ctx.fillStyle = `rgba(140,10,30,${redFlash * 0.35})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (P.hp > 0 && P.hp < 30 && mode === 'play') {
    ctx.fillStyle = `rgba(120,0,20,${0.1 + Math.sin(time * 5) * 0.06})`;
    ctx.fillRect(0, 0, W, H);
  }

  if (mode === 'title') drawTitle();
  else {
    drawHUD();
    if (mode === 'dead') drawDeath();
    if (mode === 'paused') {
      ctx.fillStyle = 'rgba(4,2,10,0.55)';
      ctx.fillRect(0, 0, W, H);
      centreText('Paused', H * 0.45, 56, '#e6dcf2', 700, 4);
      centreText('Press P to return to the hunt', H * 0.45 + 42, 18, '#a99ec2', 500);
    }
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  for (const k in pressed) pressed[k] = false;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
