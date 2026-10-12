import type { MinimapApi } from "../types";
import { COLS, Edge, GRID, OPENING, ROOM_CELLS, ROOMS, ROWS, T, charAt, edges, roomBounds, wallSpans, type EdgeSeg } from "../world/map";
import { $, clamp, mulberry32 } from "../core/util";
import { speck } from "../world/canvasTex";

type Marker = { x: number; z: number; kind: "relic" | "note" | "car" | "hint"; label: string };

const MARGIN = 0.45; // cells of paper around the plan
const INK = "rgba(232, 241, 252, 0.94)";
const INK_FAINT = "rgba(170, 205, 245, 0.2)";
const WASH = "rgba(120, 175, 240, 0.16)";
const WASH_HALL = "rgba(150, 195, 250, 0.1)";
const LABEL = "rgba(236, 243, 250, 0.9)";
const CHALK_FONT = '"Cabin Sketch", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
const TYPE_FONT = '"Special Elite", "Courier New", Courier, monospace';
const HEAD_FONT = '"Oswald", "Arial Narrow", Arial, sans-serif';

/** Extent of the non-empty part of the grid, so the plan fills the frame. */
const EXTENT = (() => {
  let r0 = ROWS,
    r1 = 0,
    c0 = COLS,
    c1 = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (GRID[r][c] !== " ") {
        r0 = Math.min(r0, r);
        r1 = Math.max(r1, r);
        c0 = Math.min(c0, c);
        c1 = Math.max(c1, c);
      }
  return { r0, r1, c0, c1, rows: r1 - r0 + 1, cols: c1 - c0 + 1 };
})();

/** Where each room's name goes: the bounds centre, or the middle of its longest row for odd shapes. */
const LABEL_SPOTS: Record<string, { x: number; z: number; w: number; h: number }> = (() => {
  const out: Record<string, { x: number; z: number; w: number; h: number }> = {};
  for (const k of Object.keys(ROOM_CELLS)) {
    if (k === " ") continue;
    const cells = ROOM_CELLS[k];
    const b = roomBounds(k);
    const rect = cells.length === (b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1);
    if (rect) {
      out[k] = { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, w: b.x1 - b.x0, h: b.z1 - b.z0 };
      continue;
    }
    let best = { r: 0, c0: 0, len: 0 };
    for (let r = b.r0; r <= b.r1; r++) {
      let run = 0;
      for (let c = b.c0; c <= b.c1 + 1; c++) {
        if (c <= b.c1 && GRID[r][c] === k) run++;
        else {
          if (run > best.len) best = { r, c0: c - run, len: run };
          run = 0;
        }
      }
    }
    out[k] = { x: (best.c0 + best.len / 2) * T, z: (best.r + 0.5) * T, w: best.len * T, h: T };
  }
  return out;
})();

/**
 * Hand-drawn blueprint of the school. Walls, doors and labels are painted to
 * a cached layer that is rebuilt only when a new room is visited or the size
 * changes; each frame just blits it and draws the markers and the player.
 */
export class Minimap implements MinimapApi {
  private overlay = $("mapOverlay");
  private wrap = $("mapWrap");
  private canvas = $<HTMLCanvasElement>("mapCanvas");
  private g = this.canvas.getContext("2d")!;
  private layer = document.createElement("canvas");
  private visited = new Set<string>();
  private markers: Marker[] = [];
  private player = { x: 0, z: 0, yaw: 0 };
  private opened = false;
  private dirty = true;
  private raf = 0;
  // layout in CSS pixels
  private cell = 20;
  private ox = 0;
  private oy = 0;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;

  constructor() {
    $("mapClose").addEventListener("click", () => this.close());
    this.overlay.addEventListener("click", (e) => e.target === this.overlay && this.close());
    addEventListener("resize", () => {
      if (this.opened) this.layout();
    });
    // Canvas text only uses web fonts once they are loaded; repaint when they are.
    const fonts = document.fonts;
    if (fonts && fonts.load) {
      Promise.all([fonts.load(`700 20px ${CHALK_FONT}`), fonts.load(`14px ${TYPE_FONT}`), fonts.load(`600 14px ${HEAD_FONT}`)])
        .then(() => (this.dirty = true))
        .catch(() => {});
    }
  }

  visit(x: number, z: number) {
    const k = charAt(x, z);
    if (k === " " || this.visited.has(k)) return;
    this.visited.add(k);
    this.dirty = true;
  }

  setMarkers(m: Marker[]) {
    this.markers = m.slice();
  }

  open(player: { x: number; z: number; yaw: number }) {
    this.player.x = player.x;
    this.player.z = player.z;
    this.player.yaw = player.yaw;
    if (this.opened) return;
    this.opened = true;
    this.overlay.classList.add("show");
    this.layout();
    const loop = (t: number) => {
      if (!this.opened) return;
      this.draw(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  close() {
    if (!this.opened) return;
    this.opened = false;
    cancelAnimationFrame(this.raf);
    this.overlay.classList.remove("show");
  }

  isOpen() {
    return this.opened;
  }

  reset() {
    this.visited.clear();
    this.markers = [];
    this.dirty = true;
  }

  // ---------------------------------------------------------------- layout
  private layout() {
    const availW = Math.max(120, this.wrap.clientWidth),
      availH = Math.max(100, this.wrap.clientHeight);
    const cw = EXTENT.cols + MARGIN * 2,
      chh = EXTENT.rows + MARGIN * 2;
    const cell = Math.max(4, Math.min(availW / cw, availH / chh));
    const cssW = Math.floor(cw * cell),
      cssH = Math.floor(chh * cell);
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    if (cssW === this.cssW && cssH === this.cssH && dpr === this.dpr && !this.dirty) return;
    this.cell = cell;
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.ox = (MARGIN - EXTENT.c0) * cell;
    this.oy = (MARGIN - EXTENT.r0) * cell;
    const bw = Math.round(cssW * dpr),
      bh = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = this.layer.width = bw;
    this.canvas.height = this.layer.height = bh;
    this.dirty = true;
  }

  private px(x: number) {
    return this.ox + (x / T) * this.cell;
  }
  private py(z: number) {
    return this.oy + (z / T) * this.cell;
  }

  // ------------------------------------------------------------ static layer
  private paintLayer() {
    const g = this.layer.getContext("2d")!;
    const { cssW: W, cssH: H, cell } = this;
    const r = mulberry32(1987);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    // paper
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#123150");
    bg.addColorStop(1, "#0a1d31");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 14; i++) {
      const x = r() * W,
        y = r() * H,
        rad = (0.15 + r() * 0.35) * Math.max(W, H);
      const s = g.createRadialGradient(x, y, 0, x, y, rad);
      s.addColorStop(0, r() < 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.12)");
      s.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = s;
      g.fillRect(0, 0, W, H);
    }
    speck(g, W, H, Math.round((W * H) / 220), 0.12, r, true);
    speck(g, W, H, Math.round((W * H) / 300), 0.25, r);

    // grid: 1.5 m minor, 3 m major
    g.lineWidth = 1;
    for (let i = 0; i <= (EXTENT.cols + 2) * 2; i++) {
      const x = this.px((EXTENT.c0 - 1) * T + (i * T) / 2);
      g.strokeStyle = i % 2 ? "rgba(160,200,255,0.035)" : "rgba(160,200,255,0.075)";
      g.beginPath();
      g.moveTo(Math.round(x) + 0.5, 0);
      g.lineTo(Math.round(x) + 0.5, H);
      g.stroke();
    }
    for (let i = 0; i <= (EXTENT.rows + 2) * 2; i++) {
      const y = this.py((EXTENT.r0 - 1) * T + (i * T) / 2);
      g.strokeStyle = i % 2 ? "rgba(160,200,255,0.035)" : "rgba(160,200,255,0.075)";
      g.beginPath();
      g.moveTo(0, Math.round(y) + 0.5);
      g.lineTo(W, Math.round(y) + 0.5);
      g.stroke();
    }

    // room washes
    for (const k of this.visited) {
      const cells = ROOM_CELLS[k];
      if (!cells) continue;
      const type = ROOMS[k].type;
      g.beginPath();
      for (const [rr, cc] of cells) g.rect(this.px(cc * T) - 0.5, this.py(rr * T) - 0.5, cell + 1, cell + 1);
      if (type === "lot") {
        g.save();
        g.clip();
        g.strokeStyle = "rgba(160,200,255,0.06)";
        g.lineWidth = 1;
        for (let d = -H; d < W; d += Math.max(5, cell * 0.35)) {
          g.beginPath();
          g.moveTo(d, H);
          g.lineTo(d + H, 0);
          g.stroke();
        }
        g.restore();
      } else {
        g.fillStyle = type === "hall" ? WASH_HALL : WASH;
        g.fill();
        // watercolour bleed
        g.save();
        g.translate(cell * 0.04, cell * 0.03);
        g.globalAlpha = 0.45;
        g.fill();
        g.restore();
      }
      this.roomDetail(g, k, r);
    }

    // walls and doors
    g.lineCap = "round";
    g.lineJoin = "round";
    for (let i = 0; i < edges.length; i++) this.paintEdge(g, edges[i], mulberry32(i * 7919 + 13));

    // labels
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const k of Object.keys(LABEL_SPOTS)) {
      const spot = LABEL_SPOTS[k];
      const x = this.px(spot.x),
        y = this.py(spot.z);
      if (this.visited.has(k)) this.paintLabel(g, ROOMS[k].name, x, y, (spot.w / T) * cell, (spot.h / T) * cell, r);
      else if (ROOMS[k].indoor) {
        g.font = `700 ${Math.round(clamp(cell * 0.6, 10, 26))}px ${CHALK_FONT}`;
        g.fillStyle = "rgba(170,205,245,0.3)";
        g.fillText("?", x, y);
      }
    }

    this.compass(g, W, H);
    this.scaleBar(g, H);
    this.dirty = false;
  }

  /** A few architectural touches inside rooms once explored. */
  private roomDetail(g: CanvasRenderingContext2D, k: string, r: () => number) {
    const type = ROOMS[k].type;
    const b = roomBounds(k);
    const x0 = this.px(b.x0),
      x1 = this.px(b.x1),
      y0 = this.py(b.z0),
      y1 = this.py(b.z1);
    const cx = (x0 + x1) / 2,
      cy = (y0 + y1) / 2,
      c = this.cell;
    g.save();
    g.strokeStyle = "rgba(200,225,255,0.18)";
    g.lineWidth = 1;
    if (type === "gym") {
      const pad = c * 0.6;
      g.strokeRect(x0 + pad, y0 + pad, x1 - x0 - pad * 2, y1 - y0 - pad * 2);
      g.beginPath();
      g.moveTo(cx, y0 + pad);
      g.lineTo(cx, y1 - pad);
      g.stroke();
      g.beginPath();
      g.arc(cx, cy, c * 1.1, 0, Math.PI * 2);
      g.stroke();
    } else if (type === "library") {
      for (let i = 1; i < 4; i++) {
        const y = y0 + ((y1 - y0) * i) / 4;
        g.beginPath();
        g.moveTo(x0 + c * 0.7, y);
        g.lineTo(x1 - c * 0.7, y);
        g.stroke();
      }
    } else if (type === "class") {
      // rows of desks
      const cols = 3,
        rows = 3;
      for (let i = 0; i < cols; i++)
        for (let j = 0; j < rows; j++) {
          const dx = x0 + (x1 - x0) * ((i + 1) / (cols + 1)),
            dy = y0 + (y1 - y0) * ((j + 1.3) / (rows + 1.5));
          g.strokeRect(dx - c * 0.22 + (r() - 0.5), dy - c * 0.12, c * 0.44, c * 0.24);
        }
    } else if (type === "cafe") {
      for (let i = 0; i < 3; i++) {
        const dx = x0 + (x1 - x0) * ((i + 1) / 4);
        g.strokeRect(dx - c * 0.35, cy - c * 0.9, c * 0.7, c * 1.8);
      }
    }
    g.restore();
  }

  private paintEdge(g: CanvasRenderingContext2D, e: EdgeSeg, r: () => number) {
    const known = this.visited.has(e.a) || this.visited.has(e.b);
    const outer = e.a === " " || e.b === " " || e.a === "." || e.b === ".";
    const c = this.cell;
    const along = (s: number): [number, number] =>
      e.dir === "S" ? [this.px(e.x0 + s), this.py(e.z0)] : [this.px(e.x0), this.py(e.z0 + s)];

    if (e.kind === Edge.Fence) {
      const [ax, ay] = along(0),
        [bx, by] = along(T);
      g.save();
      g.setLineDash([c * 0.18, c * 0.12]);
      g.strokeStyle = known ? "rgba(200,225,255,0.45)" : "rgba(170,205,245,0.14)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.stroke();
      g.restore();
      return;
    }

    const width = (outer ? 2.6 : 1.8) * clamp(c / 22, 0.7, 1.4);
    for (const [s0, s1] of wallSpans(e)) {
      const [ax, ay] = along(s0),
        [bx, by] = along(s1);
      if (known) {
        inkLine(g, ax, ay, bx, by, r, width, INK, c * 0.035, c * 0.06);
        g.globalAlpha = 0.35;
        inkLine(g, ax, ay, bx, by, r, width * 0.6, INK, c * 0.05, c * 0.1);
        g.globalAlpha = 1;
      } else inkLine(g, ax, ay, bx, by, r, 1, INK_FAINT, c * 0.02, 0);
    }

    // door swings drawn in pencil once a side is explored
    if (!known || (e.kind !== Edge.Door && e.kind !== Edge.Double && e.kind !== Edge.Front)) return;
    const w = OPENING[e.kind];
    const leaves = e.kind === Edge.Door ? 1 : 2;
    const leaf = (w / leaves / T) * c;
    g.save();
    g.strokeStyle = "rgba(220,235,255,0.4)";
    g.lineWidth = 1;
    const [hx0, hy0] = along((T - w) / 2);
    const [hx1, hy1] = along((T + w) / 2);
    // Doors open into the room on the south or east side.
    const sgn = 1;
    const hinges: [number, number, number][] = leaves === 1 ? [[hx0, hy0, 1]] : [[hx0, hy0, 1], [hx1, hy1, -1]];
    for (const [hx, hy, dirAlong] of hinges) {
      g.beginPath();
      if (e.dir === "S") {
        const a0 = dirAlong > 0 ? 0 : Math.PI;
        g.moveTo(hx, hy);
        g.lineTo(hx, hy + leaf * sgn);
        g.moveTo(hx + leaf * dirAlong, hy);
        g.arc(hx, hy, leaf, a0, Math.PI / 2, dirAlong < 0);
      } else {
        const a0 = dirAlong > 0 ? Math.PI / 2 : -Math.PI / 2;
        g.moveTo(hx, hy);
        g.lineTo(hx + leaf * sgn, hy);
        g.moveTo(hx, hy + leaf * dirAlong);
        g.arc(hx, hy, leaf, a0, 0, dirAlong > 0);
      }
      g.stroke();
    }
    g.restore();
  }

  private paintLabel(g: CanvasRenderingContext2D, name: string, x: number, y: number, w: number, h: number, r: () => number) {
    const maxW = w * 0.86;
    const base = clamp(this.cell * 0.72, 11, 28);
    let size = base;
    let lines = [name];
    const fits = () => {
      g.font = `700 ${size}px ${CHALK_FONT}`;
      return lines.every((l) => g.measureText(l).width <= maxW);
    };
    if (!fits() && name.includes(", ")) {
      lines = name.split(", ");
      size = base;
    }
    while (!fits() && size > 8) size -= 0.5;
    const lh = size * 1.05;
    if (lines.length * lh > h * 0.9 && lines.length > 1) {
      lines = [name];
      size = base;
      while (!fits() && size > 7) size -= 0.5;
    }
    g.save();
    g.translate(x, y);
    g.rotate((r() - 0.5) * 0.06);
    g.font = `700 ${size}px ${CHALK_FONT}`;
    g.shadowColor = "rgba(5,15,30,0.9)";
    g.shadowBlur = 4;
    g.fillStyle = LABEL;
    const top = -((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => g.fillText(l, 0, top + i * lh));
    g.restore();
  }

  private compass(g: CanvasRenderingContext2D, W: number, H: number) {
    const s = clamp(this.cell * 0.9, 14, 34);
    const x = W - s * 1.2,
      y = H - s * 1.5;
    g.save();
    g.translate(x, y);
    g.strokeStyle = "rgba(220,235,255,0.6)";
    g.fillStyle = "rgba(220,235,255,0.75)";
    g.lineWidth = 1;
    g.beginPath();
    g.arc(0, 0, s * 0.62, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(0, -s * 0.8);
    g.lineTo(s * 0.2, 0);
    g.lineTo(0, -s * 0.12);
    g.lineTo(-s * 0.2, 0);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(0, s * 0.8);
    g.lineTo(s * 0.2, 0);
    g.lineTo(-s * 0.2, 0);
    g.closePath();
    g.stroke();
    g.font = `600 ${Math.round(s * 0.42)}px ${HEAD_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.fillText("N", 0, -s * 0.84);
    g.restore();
  }

  private scaleBar(g: CanvasRenderingContext2D, H: number) {
    const c = this.cell;
    const x = c * 0.7,
      y = H - c * 0.55,
      len = c * 3; // 9 m
    g.save();
    g.strokeStyle = "rgba(220,235,255,0.6)";
    g.fillStyle = "rgba(220,235,255,0.7)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y - 4);
    g.lineTo(x, y);
    g.lineTo(x + len, y);
    g.lineTo(x + len, y - 4);
    for (let i = 1; i < 3; i++) {
      g.moveTo(x + c * i, y);
      g.lineTo(x + c * i, y - 2.5);
    }
    g.stroke();
    g.font = `${Math.round(clamp(c * 0.36, 9, 13))}px ${TYPE_FONT}`;
    g.textBaseline = "bottom";
    g.textAlign = "left";
    g.fillText("9 m", x + len + 5, y + 2);
    g.restore();
  }

  // ------------------------------------------------------------ per frame
  private draw(t: number) {
    if (this.dirty) {
      this.layout();
      this.paintLayer();
    }
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.layer, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (let i = 0; i < this.markers.length; i++) this.drawMarker(g, this.markers[i], t);
    this.drawPlayer(g, t);
  }

  private drawMarker(g: CanvasRenderingContext2D, m: Marker, t: number) {
    const x = this.px(m.x),
      y = this.py(m.z);
    const s = clamp(this.cell * 0.34, 5, 12);
    g.save();
    g.translate(x, y);
    if (m.kind === "relic") {
      const p = 0.5 + 0.5 * Math.sin(t * 0.004);
      g.shadowColor = "rgba(240,180,76,0.9)";
      g.shadowBlur = 6 + p * 8;
      g.fillStyle = "#f0b44c";
      g.beginPath();
      g.moveTo(0, -s);
      g.lineTo(s * 0.8, 0);
      g.lineTo(0, s);
      g.lineTo(-s * 0.8, 0);
      g.closePath();
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = "rgba(60,35,0,0.8)";
      g.lineWidth = 1;
      g.stroke();
    } else if (m.kind === "note") {
      g.rotate(-0.12);
      g.fillStyle = "#efe6cf";
      g.shadowColor = "rgba(0,0,0,0.5)";
      g.shadowBlur = 3;
      g.fillRect(-s * 0.7, -s * 0.85, s * 1.4, s * 1.7);
      g.shadowBlur = 0;
      g.strokeStyle = "rgba(60,80,120,0.7)";
      g.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const ly = -s * 0.4 + i * s * 0.4;
        g.beginPath();
        g.moveTo(-s * 0.45, ly);
        g.lineTo(s * 0.45, ly);
        g.stroke();
      }
    } else if (m.kind === "car") {
      g.fillStyle = "#8fd19e";
      g.strokeStyle = "rgba(10,30,15,0.8)";
      g.lineWidth = 1;
      roundRect(g, -s * 1.3, -s * 0.55, s * 2.6, s * 1.1, s * 0.35);
      g.fill();
      g.stroke();
      g.fillStyle = "rgba(10,30,15,0.65)";
      roundRect(g, -s * 0.5, -s * 0.4, s * 1.1, s * 0.8, s * 0.2);
      g.fill();
    } else {
      const p = 0.5 + 0.5 * Math.sin(t * 0.005 + m.x);
      g.shadowColor = "rgba(167,125,255,1)";
      g.shadowBlur = 8 + p * 8;
      g.fillStyle = "rgba(167,125,255,0.95)";
      g.beginPath();
      g.arc(0, 0, s * 0.75, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = "#14082a";
      g.font = `700 ${Math.round(s * 1.2)}px ${HEAD_FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("?", 0, s * 0.05);
    }
    g.restore();

    if (!m.label) return;
    const fs = Math.round(clamp(this.cell * 0.4, 10, 14));
    g.font = `${fs}px ${TYPE_FONT}`;
    g.textBaseline = "middle";
    const tw = g.measureText(m.label).width;
    const right = x + s * 1.6 + tw < this.cssW - 4;
    g.textAlign = right ? "left" : "right";
    const lx = right ? x + s * 1.6 : x - s * 1.6;
    g.lineWidth = 3;
    g.strokeStyle = "rgba(6,16,28,0.92)";
    g.lineJoin = "round";
    g.strokeText(m.label, lx, y);
    g.fillStyle = m.kind === "relic" ? "#ffd98a" : m.kind === "hint" ? "#d6c2ff" : "#e6eef8";
    g.fillText(m.label, lx, y);
  }

  private drawPlayer(g: CanvasRenderingContext2D, t: number) {
    const x = this.px(this.player.x),
      y = this.py(this.player.z);
    const s = clamp(this.cell * 0.42, 6, 15);
    const pulse = (t % 1600) / 1600;
    g.save();
    g.translate(x, y);
    // ping
    g.strokeStyle = `rgba(255,90,71,${(1 - pulse) * 0.6})`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(0, 0, s * (0.8 + pulse * 2.2), 0, Math.PI * 2);
    g.stroke();
    // camera yaw 0 faces north (up); positive yaw turns left
    g.rotate(-this.player.yaw);
    const cone = g.createRadialGradient(0, 0, 0, 0, 0, s * 4);
    cone.addColorStop(0, "rgba(255,230,180,0.28)");
    cone.addColorStop(1, "rgba(255,230,180,0)");
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, s * 4, -Math.PI / 2 - 0.45, -Math.PI / 2 + 0.45);
    g.closePath();
    g.fill();
    g.shadowColor = "rgba(255,70,50,0.9)";
    g.shadowBlur = 8;
    g.fillStyle = "#ff5a47";
    g.strokeStyle = "#fff4ec";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -s);
    g.lineTo(s * 0.72, s * 0.8);
    g.lineTo(0, s * 0.42);
    g.lineTo(-s * 0.72, s * 0.8);
    g.closePath();
    g.fill();
    g.shadowBlur = 0;
    g.stroke();
    g.restore();
  }
}

/** A slightly wobbly pen stroke with a little overshoot at the ends. */
function inkLine(
  g: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: () => number,
  width: number,
  colour: string,
  wobble: number,
  overshoot: number
) {
  const dx = bx - ax,
    dy = by - ay,
    len = Math.hypot(dx, dy) || 1;
  const ux = dx / len,
    uy = dy / len,
    nx = -uy,
    ny = ux;
  const o0 = overshoot * r(),
    o1 = overshoot * r();
  const sx = ax - ux * o0,
    sy = ay - uy * o0,
    ex = bx + ux * o1,
    ey = by + uy * o1;
  const n = Math.max(1, Math.round(len / 18));
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(sx + nx * (r() - 0.5) * wobble, sy + ny * (r() - 0.5) * wobble);
  for (let i = 1; i <= n; i++) {
    const t1 = i / n,
      tm = (i - 0.5) / n;
    const w1 = (r() - 0.5) * wobble * 2,
      wm = (r() - 0.5) * wobble * 2;
    const mx = sx + (ex - sx) * tm + nx * wm,
      my = sy + (ey - sy) * tm + ny * wm;
    const px = sx + (ex - sx) * t1 + nx * w1,
      py = sy + (ey - sy) * t1 + ny * w1;
    g.quadraticCurveTo(mx, my, px, py);
  }
  g.stroke();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number) {
  g.beginPath();
  g.moveTo(x + rad, y);
  g.lineTo(x + w - rad, y);
  g.quadraticCurveTo(x + w, y, x + w, y + rad);
  g.lineTo(x + w, y + h - rad);
  g.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  g.lineTo(x + rad, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - rad);
  g.lineTo(x, y + rad);
  g.quadraticCurveTo(x, y, x + rad, y);
  g.closePath();
}
