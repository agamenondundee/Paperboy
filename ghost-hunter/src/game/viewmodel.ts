import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Viewmodel } from "../types";
import { canvas, normalFrom, toTexture, speck, blob } from "../world/canvasTex";
import { clamp, damp, lerp, mulberry32 } from "../core/util";

/**
 * Brodie's hands: a black anodised torch in the right hand and an EMF meter
 * in the left, drawn in the separate viewmodel scene over the world. The
 * whole rig follows the camera every frame, then sways, bobs and trembles in
 * camera space. Geometry is merged per material per hand, the LEDs are one
 * instanced mesh, and every light in the scene is created here once.
 */

// ------------------------------------------------------------------ poses
// Camera-space placements (metres, -Z forwards). Everything stays between
// 0.15 m and 0.6 m from the eye so nothing nears the clip plane.
const TORCH_POS = new THREE.Vector3(0.158, -0.168, -0.37);
const TORCH_AIM = new THREE.Vector3(0.0, -0.012, -8);
const TORCH_ROLL = 0.45;
const TORCH_BEAM_POS = new THREE.Vector3(0.146, -0.155, -0.412);
const TORCH_BEAM_AIM = new THREE.Vector3(0, 0, -8);
const TORCH_BEAM_ROLL = 0.3;
const TORCH_ELBOW = new THREE.Vector3(0.36, -0.47, 0.02);

const EMF_LOW_POS = new THREE.Vector3(-0.17, -0.205, -0.35);
const EMF_LOW_LOOK = new THREE.Vector3(0.06, 0.32, 0.05);
const EMF_LOW_ROLL = -0.28;
const EMF_HIGH_POS = new THREE.Vector3(-0.094, -0.13, -0.322);
const EMF_HIGH_LOOK = new THREE.Vector3(0.0, 0.02, 0.0);
const EMF_HIGH_ROLL = -0.1;
const EMF_ELBOW = new THREE.Vector3(-0.36, -0.5, 0.02);

/** Nominal torch intensity from the player, used to normalise the lens glow. */
const TORCH_NOMINAL = 45;

const LED_COLOURS = [0x2bff5a, 0x2bff5a, 0xffe03a, 0xff8a1a, 0xff2a1e].map((c) => new THREE.Color(c));
const LED_Y = 0.034;
const LED_X = [-0.016, -0.008, 0, 0.008, 0.016];
const LCD_W = 256,
  LCD_H = 128;

// ------------------------------------------------------- scratch (build)
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

// --------------------------------------------------------- geometry kit

/** Capsule between two points. */
function bone(a: THREE.Vector3, b: THREE.Vector3, r: number, radial = 10): THREE.BufferGeometry {
  _v.subVectors(b, a);
  const len = _v.length();
  const g = new THREE.CapsuleGeometry(r, Math.max(1e-4, len), 4, radial);
  _q.setFromUnitVectors(UP, _v.normalize());
  _w.addVectors(a, b).multiplyScalar(0.5);
  g.applyMatrix4(_m.compose(_w, _q, _one));
  return g;
}

/** Tapered cylinder between two points (radius ra at a, rb at b). */
function segment(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, radial = 16, open = false): THREE.BufferGeometry {
  _v.subVectors(b, a);
  const len = _v.length();
  const g = new THREE.CylinderGeometry(rb, ra, len, radial, 1, open);
  _q.setFromUnitVectors(UP, _v.normalize());
  _w.addVectors(a, b).multiplyScalar(0.5);
  g.applyMatrix4(_m.compose(_w, _q, _one));
  return g;
}

/** Cylinder on the torch axis, front (more negative z) radius first. */
function tube(rFront: number, rBack: number, zFront: number, zBack: number, radial = 32): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rFront, rBack, zBack - zFront, radial);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, (zFront + zBack) / 2);
  return g;
}

/** Ring around the torch axis. */
function ring(r: number, t: number, z: number, radial = 32): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(r, t, 6, radial);
  g.translate(0, 0, z);
  return g;
}

/** Squashed sphere for palms and knuckle pads. */
function ellipsoid(c: THREE.Vector3, sx: number, sy: number, sz: number, rot?: THREE.Euler): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 20, 14);
  g.scale(sx, sy, sz);
  if (rot) g.applyMatrix4(_m.makeRotationFromEuler(rot));
  g.translate(c.x, c.y, c.z);
  return g;
}

/** A chain of capsules through the given joints, radius tapering to the tip. */
function digit(out: THREE.BufferGeometry[], pts: THREE.Vector3[], r0: number, r1: number) {
  for (let i = 0; i < pts.length - 1; i++) {
    const r = lerp(r0, r1, i / Math.max(1, pts.length - 2));
    out.push(bone(pts[i], pts[i + 1], r));
  }
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // RoundedBoxGeometry is non-indexed; the merge needs all or none indexed.
  const mixed = list.some((p) => !p.index) && list.some((p) => p.index);
  const parts = mixed ? list.map((p) => (p.index ? p.toNonIndexed() : p)) : list;
  const g = mergeGeometries(parts, false);
  for (const p of list) p.dispose();
  for (const p of parts) p.dispose();
  if (!g) throw new Error("viewmodel: geometry merge failed");
  g.computeBoundingSphere();
  return g;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** Point at angle a around the torch axis, radius r, depth z. */
const P = (a: number, r: number, z: number) => new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z);

// ---------------------------------------------------------------- textures

function noiseNormal(size: number, seed: number, strength: number, paint: (g: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void, repeat: [number, number]) {
  const r = mulberry32(seed);
  const cv = canvas(size, size, (g, w, h) => {
    g.fillStyle = "#808080";
    g.fillRect(0, 0, w, h);
    paint(g, w, h, r);
  });
  return toTexture(normalFrom(cv, strength), { srgb: false, repeat });
}

function knurlTexture() {
  const cv = canvas(64, 64, (g, w, h) => {
    g.fillStyle = "#c8c8c8";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#1a1a1a";
    g.lineWidth = 4;
    for (let k = -2; k <= 3; k++) {
      g.beginPath();
      g.moveTo(k * 32, 0);
      g.lineTo(k * 32 + 64, 64);
      g.moveTo(k * 32, 64);
      g.lineTo(k * 32 + 64, 0);
      g.stroke();
    }
  });
  return toTexture(normalFrom(cv, 5), { srgb: false, repeat: [20, 18] });
}

function lensTexture() {
  const cv = canvas(128, 128, (g, w, h) => {
    const c = w / 2;
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, "#ffffff");
    gr.addColorStop(0.1, "#ffffff");
    gr.addColorStop(0.22, "#c9c9c9");
    gr.addColorStop(0.55, "#6a6a6a");
    gr.addColorStop(0.9, "#3a3a3a");
    gr.addColorStop(1, "#1a1a1a");
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    // Orange-peel reflector facets.
    g.strokeStyle = "rgba(255,255,255,0.12)";
    g.lineWidth = 1.5;
    for (let rr = 14; rr < c; rr += 5) {
      g.beginPath();
      g.arc(c, c, rr, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = "#ffffff";
    g.fillRect(c - 6, c - 6, 12, 12);
  });
  return toTexture(cv, { srgb: true });
}

function glowTexture() {
  const cv = canvas(64, 64, (g, w, h) => {
    const c = w / 2;
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.18, "rgba(255,255,255,0.55)");
    gr.addColorStop(0.45, "rgba(255,255,255,0.14)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Printed face of the meter: labels, LED window, LCD surround, grip ribs. */
function faceTexture(fw: number, fh: number) {
  const W = 220,
    H = 500;
  const px = (x: number) => ((x + fw / 2) / fw) * W;
  const py = (y: number) => ((fh / 2 - y) / fh) * H;
  const cv = canvas(W, H, (g) => {
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#1b1c20");
    bg.addColorStop(1, "#0e0f11");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    speck(g, W, H, 900, 0.06, mulberry32(7), true);

    // Rounded rectangle path in face coordinates (no reliance on ctx.roundRect).
    const rr = (x0: number, y0: number, x1: number, y1: number, rad: number) => {
      const l = px(x0),
        t = py(y1),
        r = px(x1),
        b = py(y0);
      g.beginPath();
      g.moveTo(l + rad, t);
      g.arcTo(r, t, r, b, rad);
      g.arcTo(r, b, l, b, rad);
      g.arcTo(l, b, l, t, rad);
      g.arcTo(l, t, r, t, rad);
      g.closePath();
    };

    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#d8d8d8";
    g.font = "bold 22px Oswald, 'Arial Narrow', Arial, sans-serif";
    g.fillText("EMF METER", W / 2, py(0.0445));

    // LED window
    rr(-0.0205, LED_Y - 0.0058, 0.0205, LED_Y + 0.0058, 10);
    g.fillStyle = "#050505";
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = "#5a5c60";
    g.stroke();

    g.font = "bold 12px Arial, sans-serif";
    g.fillStyle = "#9a9ca0";
    const labels = ["1.5", "2.5", "10", "20", "20+"];
    for (let i = 0; i < 5; i++) g.fillText(labels[i], px(LED_X[i]), py(LED_Y - 0.0092));

    // LCD surround
    rr(-0.0205, -0.0008, 0.0205, 0.0208, 12);
    g.fillStyle = "#030303";
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = "#3c3e42";
    g.stroke();

    g.font = "bold 11px Arial, sans-serif";
    g.fillStyle = "#8a8c90";
    g.fillText("MILLIGAUSS", W / 2, py(-0.0055));

    // Button ring
    g.beginPath();
    g.arc(px(0), py(-0.0145), (0.0072 / fw) * W, 0, Math.PI * 2);
    g.lineWidth = 3;
    g.strokeStyle = "#4a4c50";
    g.stroke();
    g.fillText("HOLD", W / 2, py(-0.0245));

    // Moulded grip ribs on the lower half.
    for (let y = -0.03; y > -0.049; y -= 0.0026) {
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillRect(px(-0.019), py(y), px(0.019) - px(-0.019), 3);
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(px(-0.019), py(y) + 3, px(0.019) - px(-0.019), 1);
    }
  });
  return toTexture(cv, { srgb: true });
}

// --------------------------------------------------------------- springs

interface Spring {
  x: number;
  v: number;
}
const spring = (): Spring => ({ x: 0, v: 0 });
function stepSpring(s: Spring, target: number, k: number, c: number, dt: number) {
  s.v += ((target - s.x) * k - s.v * c) * dt;
  s.x += s.v * dt;
}

// ------------------------------------------------------------------ build

export function createViewmodel(vmScene: THREE.Scene, camera: THREE.PerspectiveCamera): Viewmodel {
  // ---------------------------------------------------------- materials
  const fabricN = noiseNormal(
    128,
    11,
    2.4,
    (g, w, h, r) => {
      // Twill weave: offset diagonal ribs plus slub noise.
      for (let y = 0; y < h; y += 4)
        for (let x = 0; x < w; x += 4) {
          const on = ((x >> 2) + (y >> 2)) % 4 < 2;
          g.fillStyle = on ? "#9a9a9a" : "#646464";
          g.fillRect(x, y, 4, 4);
        }
      speck(g, w, h, 500, 0.25, r);
      speck(g, w, h, 300, 0.2, r, true);
    },
    [6, 10]
  );
  const leatherN = noiseNormal(
    128,
    23,
    1.6,
    (g, w, h, r) => {
      for (let i = 0; i < 140; i++) blob(g, r() * w, r() * h, 3 + r() * 6, `rgba(0,0,0,${0.08 + r() * 0.12})`, r);
      speck(g, w, h, 600, 0.2, r);
    },
    [2, 2]
  );
  const plasticN = noiseNormal(
    64,
    37,
    0.7,
    (g, w, h, r) => {
      speck(g, w, h, 700, 0.35, r);
      speck(g, w, h, 400, 0.3, r, true);
    },
    [3, 6]
  );

  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x252a33, roughness: 0.93, metalness: 0, normalMap: fabricN, normalScale: new THREE.Vector2(0.7, 0.7) });
  const gloveMat = new THREE.MeshStandardMaterial({ color: 0x1c1b1d, roughness: 0.56, metalness: 0, normalMap: leatherN, normalScale: new THREE.Vector2(0.45, 0.45) });
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.34, metalness: 0.7 });
  const knurlMat = new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.48, metalness: 0.7, normalMap: knurlTexture(), normalScale: new THREE.Vector2(1.1, 1.1) });
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0xa4a7ad, roughness: 0.22, metalness: 1 });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1c, roughness: 0.82, metalness: 0 });
  const lensTex = lensTexture();
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    map: lensTex,
    roughness: 0.06,
    metalness: 0.2,
    emissive: 0xffffff,
    emissiveMap: lensTex,
    emissiveIntensity: 0,
  });
  const emfMat = new THREE.MeshStandardMaterial({ color: 0x131417, roughness: 0.46, metalness: 0, normalMap: plasticN, normalScale: new THREE.Vector2(0.35, 0.35) });
  const FACE_W = 0.042,
    FACE_H = 0.1;
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTexture(FACE_W, FACE_H), roughness: 0.3, metalness: 0 });
  const buttonMat = new THREE.MeshStandardMaterial({ color: 0x8a1c1a, roughness: 0.5, metalness: 0 });

  // Lit materials whose albedo is dimmed while hiding (scene environment
  // intensity is shared with the world, so darkening goes through colour).
  const dimmable = [sleeveMat, gloveMat, bodyMat, knurlMat, bezelMat, rubberMat, lensMat, emfMat, faceMat, buttonMat];
  const baseColours = dimmable.map((m) => m.color.clone());

  // --------------------------------------------------------------- rig
  const root = new THREE.Group();
  root.name = "viewmodel";
  const rig = new THREE.Group();
  const torchArm = new THREE.Group();
  const emfArm = new THREE.Group();
  root.add(rig);
  rig.add(torchArm, emfArm);
  vmScene.add(root);

  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D) => {
    const o = new THREE.Mesh(g, m);
    o.frustumCulled = false;
    o.castShadow = o.receiveShadow = false;
    parent.add(o);
    return o;
  };

  const poseQ = (pos: THREE.Vector3, look: THREE.Vector3, roll: number, faceLook: boolean) => {
    // faceLook: +Z faces the look point (meter screen); otherwise -Z aims at it (torch).
    if (faceLook) _m.lookAt(look, pos, UP);
    else _m.lookAt(pos, look, UP);
    const q = new THREE.Quaternion().setFromRotationMatrix(_m);
    return q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, roll));
  };
  /** Camera-space point into an arm's rest-pose local space. */
  const toLocal = (p: THREE.Vector3, pos: THREE.Vector3, q: THREE.Quaternion) => p.clone().sub(pos).applyQuaternion(q.clone().invert());

  const qTorch = poseQ(TORCH_POS, TORCH_AIM, TORCH_ROLL, false);
  const qTorchBeam = poseQ(TORCH_BEAM_POS, TORCH_BEAM_AIM, TORCH_BEAM_ROLL, false);
  const qEmfLow = poseQ(EMF_LOW_POS, EMF_LOW_LOOK, EMF_LOW_ROLL, true);
  const qEmfHigh = poseQ(EMF_HIGH_POS, EMF_HIGH_LOOK, EMF_HIGH_ROLL, true);

  /** Jacket sleeve from the wrist back to an elbow off screen, with a knitted cuff. */
  const sleeve = (wrist: THREE.Vector3, elbow: THREE.Vector3, palm: THREE.Vector3, parent: THREE.Object3D) => {
    const dir = elbow.clone().sub(wrist).normalize();
    const start = wrist.clone().addScaledVector(dir, 0.012);
    const parts = [segment(start, elbow, 0.037, 0.056, 20)];
    // Slight bunching folds along the sleeve.
    for (let i = 1; i <= 3; i++) {
      const c = start.clone().lerp(elbow, i * 0.17);
      const t = new THREE.TorusGeometry(lerp(0.038, 0.05, i * 0.17), 0.0045, 6, 20);
      t.applyMatrix4(_m.compose(c, _q.setFromUnitVectors(Z, dir), _one));
      parts.push(t);
    }
    mesh(merge(parts), sleeveMat, parent);
    // Knit cuff and the glove's gauntlet running into it.
    const cuff = new THREE.TorusGeometry(0.033, 0.0075, 8, 24);
    cuff.applyMatrix4(_m.compose(start.clone().addScaledVector(dir, 0.004), _q.setFromUnitVectors(Z, dir), _one));
    return { cuff, gauntlet: bone(palm, wrist.clone().addScaledVector(dir, 0.03), 0.026, 14) };
  };

  // ------------------------------------------------------------- torch
  {
    const body: THREE.BufferGeometry[] = [];
    body.push(tube(0.0172, 0.0172, 0.072, 0.093)); // tail cap
    body.push(ring(0.0172, 0.0011, 0.081, 32));
    body.push(tube(0.0165, 0.0172, -0.022, -0.018)); // grip front shoulder
    body.push(tube(0.0225, 0.0165, -0.05, -0.022)); // neck flare
    body.push(tube(0.0235, 0.0235, -0.099, -0.05)); // head
    for (let i = 0; i < 5; i++) body.push(tube(0.0248, 0.0248, -0.0575 - i * 0.0072, -0.0545 - i * 0.0072)); // cooling fins
    // Pocket clip down the left of the grip.
    const clip = new THREE.BoxGeometry(0.0035, 0.007, 0.064);
    clip.translate(-0.0182, 0.004, 0.036);
    body.push(clip);
    mesh(merge(body), bodyMat, torchArm);

    mesh(tube(0.0162, 0.0162, -0.018, 0.072, 40), knurlMat, torchArm);

    const bezel: THREE.BufferGeometry[] = [tube(0.0252, 0.0252, -0.106, -0.099), ring(0.0226, 0.0026, -0.1062, 40)];
    // Crenellated strike bezel.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const b = new THREE.BoxGeometry(0.008, 0.004, 0.004);
      b.rotateZ(a + Math.PI / 2);
      b.translate(Math.cos(a) * 0.0236, Math.sin(a) * 0.0236, -0.108);
      bezel.push(b);
    }
    mesh(merge(bezel), bezelMat, torchArm);

    const lens = new THREE.CircleGeometry(0.0208, 40);
    lens.rotateY(Math.PI); // face -Z
    lens.translate(0, 0, -0.1035);
    mesh(lens, lensMat, torchArm);

    const tail = new THREE.SphereGeometry(0.0115, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    tail.rotateX(Math.PI / 2);
    tail.scale(1, 1, 0.55);
    tail.translate(0, 0, 0.093);
    mesh(tail, rubberMat, torchArm);
  }

  // Lens glow: soft additive sprite just in front of the glass.
  const glowMat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: 0x000000,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    fog: false,
  });
  const lensGlow = new THREE.Sprite(glowMat);
  lensGlow.position.set(0, 0, -0.112);
  lensGlow.scale.set(0.08, 0.08, 1);
  lensGlow.frustumCulled = false;
  lensGlow.renderOrder = 10;
  torchArm.add(lensGlow);

  // ------------------------------------------------------- right hand
  {
    const hand: THREE.BufferGeometry[] = [];
    // Palm on the right of the grip, back of the hand facing out.
    hand.push(ellipsoid(V(0.039, 0.002, 0.04), 0.021, 0.031, 0.047, new THREE.Euler(0, 0, 0.25)));
    // Four fingers wrap under the barrel and up its left side; index at the front.
    const fingerR = [0.0088, 0.0093, 0.009, 0.0078];
    const reach = [-2.8, -2.85, -2.75, -2.5];
    for (let i = 0; i < 4; i++) {
      const z = 0.008 + i * 0.0185;
      const r = fingerR[i];
      const pts = [P(0.38, 0.041, z + 0.004), P(-0.72, 0.0275 + r * 0.3, z), P(-1.85, 0.0255 + r * 0.2, z - 0.002), P(reach[i], 0.0252, z - 0.004)];
      digit(hand, pts, r, r * 0.92);
      hand.push(ellipsoid(pts[0], r * 1.15, r * 1.1, r * 1.05)); // knuckle
    }
    // Thumb from the heel of the palm over the top towards the index finger.
    digit(hand, [V(0.034, 0.016, 0.072), V(0.022, 0.03, 0.054), V(0.003, 0.0285, 0.036), V(-0.013, 0.0235, 0.022)], 0.0105, 0.0092);
    hand.push(ellipsoid(V(0.03, 0.019, 0.066), 0.014, 0.012, 0.02)); // thenar pad

    const wrist = V(0.047, -0.024, 0.122);
    const elbow = toLocal(TORCH_ELBOW, TORCH_POS, qTorch);
    const sl = sleeve(wrist, elbow, V(0.04, -0.004, 0.06), torchArm);
    hand.push(sl.gauntlet);
    mesh(merge(hand), gloveMat, torchArm);
    mesh(sl.cuff, sleeveMat, torchArm);
  }

  // ------------------------------------------------------- EMF meter
  const BW = 0.056,
    BH = 0.124,
    BD = 0.024;
  const FZ = BD / 2; // front face plane
  {
    mesh(new RoundedBoxGeometry(BW, BH, BD, 4, 0.007), emfMat, emfArm);

    const bump: THREE.BufferGeometry[] = [];
    const top = new RoundedBoxGeometry(BW + 0.004, 0.016, BD + 0.004, 3, 0.006);
    top.translate(0, BH / 2 - 0.006, 0);
    const bottom = new RoundedBoxGeometry(BW + 0.004, 0.016, BD + 0.004, 3, 0.006);
    bottom.translate(0, -BH / 2 + 0.006, 0);
    // Sensor nub on the top end.
    const nub = new THREE.CylinderGeometry(0.006, 0.0075, 0.006, 16);
    nub.translate(0.014, BH / 2 + 0.004, 0);
    bump.push(top, bottom, nub);
    mesh(merge(bump), rubberMat, emfArm);

    const face = new THREE.PlaneGeometry(FACE_W, FACE_H);
    face.translate(0, 0, FZ + 0.0003);
    mesh(face, faceMat, emfArm);

    // Chrome LED bezels.
    const rings: THREE.BufferGeometry[] = [];
    for (const x of LED_X) {
      const r = new THREE.TorusGeometry(0.0036, 0.0007, 6, 16);
      r.translate(x, LED_Y, FZ + 0.0008);
      rings.push(r);
    }
    mesh(merge(rings), bezelMat, emfArm);

    const button = new THREE.CylinderGeometry(0.0052, 0.0056, 0.003, 20);
    button.rotateX(Math.PI / 2);
    button.translate(0, -0.0145, FZ + 0.0012);
    mesh(button, buttonMat, emfArm);
  }

  // LEDs: one instanced dome mesh plus one instanced additive glow quad.
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const domeGeo = new THREE.SphereGeometry(0.0031, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  domeGeo.rotateX(Math.PI / 2);
  const leds = new THREE.InstancedMesh(domeGeo, ledMat, 5);
  const glowQuadMat = new THREE.MeshBasicMaterial({
    map: glowMat.map,
    color: 0xffffff,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const ledGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.022, 0.022), glowQuadMat, 5);
  for (let i = 0; i < 5; i++) {
    _m.makeTranslation(LED_X[i], LED_Y, FZ + 0.0006);
    leds.setMatrixAt(i, _m);
    _m.makeTranslation(LED_X[i], LED_Y, FZ + 0.0045);
    ledGlow.setMatrixAt(i, _m);
    leds.setColorAt(i, LED_COLOURS[i]);
    ledGlow.setColorAt(i, LED_COLOURS[i]);
  }
  leds.frustumCulled = ledGlow.frustumCulled = false;
  ledGlow.renderOrder = 10;
  emfArm.add(leds, ledGlow);

  // LCD
  const lcdCanvas = document.createElement("canvas");
  lcdCanvas.width = LCD_W;
  lcdCanvas.height = LCD_H;
  const lcd = lcdCanvas.getContext("2d")!;
  const lcdTex = new THREE.CanvasTexture(lcdCanvas);
  lcdTex.colorSpace = THREE.SRGBColorSpace;
  lcdTex.anisotropy = 4;
  const lcdMat = new THREE.MeshBasicMaterial({ map: lcdTex, color: 0xffffff });
  const lcdBase = 0.85;
  {
    const g = new THREE.PlaneGeometry(0.036, 0.018);
    g.translate(0, 0.01, FZ + 0.0006);
    mesh(g, lcdMat, emfArm);
  }
  const lcdBg = lcd.createLinearGradient(0, 0, 0, LCD_H);
  lcdBg.addColorStop(0, "#a9dc8c");
  lcdBg.addColorStop(1, "#7cbc66");
  const lcdVig = lcd.createRadialGradient(LCD_W / 2, LCD_H / 2, LCD_H * 0.3, LCD_W / 2, LCD_H / 2, LCD_W * 0.62);
  lcdVig.addColorStop(0, "rgba(0,0,0,0)");
  lcdVig.addColorStop(1, "rgba(0,0,0,0.32)");
  const INK = "#0f220d";
  const GHOST = "rgba(15,34,13,0.08)";
  const drawLcd = (text: string, level: number) => {
    const g = lcd;
    g.fillStyle = lcdBg;
    g.fillRect(0, 0, LCD_W, LCD_H);
    g.textBaseline = "alphabetic";
    g.font = "bold 18px Arial, sans-serif";
    g.textAlign = "left";
    g.fillStyle = INK;
    g.fillText("EMF", 12, 24);
    g.textAlign = "right";
    g.fillText(level >= 4 ? "ALERT" : "SCAN", LCD_W - 12, 24);
    g.font = "bold 66px 'Courier New', Courier, monospace";
    g.fillStyle = GHOST;
    g.fillText("888.8", 196, 86);
    g.fillStyle = INK;
    g.fillText(text, 196, 86);
    g.font = "bold 24px Arial, sans-serif";
    g.textAlign = "left";
    g.fillText("mG", 201, 86);
    // Ten-segment bar graph.
    const lit = Math.round(level * 2);
    for (let i = 0; i < 10; i++) {
      g.fillStyle = i < lit ? INK : GHOST;
      g.fillRect(14 + i * 23, 100, 18, 14);
    }
    g.fillStyle = lcdVig;
    g.fillRect(0, 0, LCD_W, LCD_H);
    lcdTex.needsUpdate = true;
  };
  drawLcd("0.0", 0);

  // ------------------------------------------------------- left hand
  {
    const hand: THREE.BufferGeometry[] = [];
    // Palm behind the meter, fingers round its right edge, thumb up the left.
    hand.push(ellipsoid(V(-0.002, -0.036, -0.027), 0.036, 0.044, 0.0145, new THREE.Euler(0, 0, -0.25)));
    const fingerR = [0.0086, 0.009, 0.0087, 0.0076];
    for (let i = 0; i < 4; i++) {
      const y = -0.0075 - i * 0.0172;
      const r = fingerR[i];
      const tipX = i === 3 ? 0.031 : 0.027;
      const pts = [V(0.016, y - 0.004, -0.031), V(0.0365, y - 0.002, -0.019), V(0.0385, y, 0.004), V(tipX, y + 0.003, FZ + r - 0.0005)];
      digit(hand, pts, r, r * 0.92);
      hand.push(ellipsoid(pts[0], r * 1.15, r * 1.05, r * 1.1));
    }
    digit(hand, [V(-0.022, -0.058, -0.022), V(-0.0375, -0.042, -0.009), V(-0.037, -0.026, 0.008), V(-0.023, -0.013, FZ + 0.0085)], 0.0105, 0.0092);
    hand.push(ellipsoid(V(-0.026, -0.056, -0.018), 0.016, 0.02, 0.014)); // thenar pad

    const wrist = V(-0.02, -0.078, -0.034);
    const elbow = toLocal(EMF_ELBOW, EMF_LOW_POS, qEmfLow);
    const sl = sleeve(wrist, elbow, V(-0.008, -0.05, -0.027), emfArm);
    hand.push(sl.gauntlet);
    mesh(merge(hand), gloveMat, emfArm);
    mesh(sl.cuff, sleeveMat, emfArm);
  }

  // -------------------------------------------------------------- lights
  // Fixed set, created once: soft ambient, a key light carrying the torch
  // colour, a cool rim from the world ahead, and the LEDs' spill.
  const ambient = new THREE.AmbientLight(0x8a96b8, 0.32);
  const key = new THREE.DirectionalLight(0xfff1d6, 1.2);
  key.position.set(0.35, 0.45, 0.25);
  key.target.position.set(0, -0.2, -0.4);
  const rim = new THREE.DirectionalLight(0x7088c8, 0.55);
  rim.position.set(-0.6, 0.15, -0.7);
  rim.target.position.set(0, -0.15, -0.3);
  const ledLight = new THREE.PointLight(0xff2a1e, 0, 0.3, 2);
  ledLight.position.set(0, LED_Y, FZ + 0.012);
  emfArm.add(ledLight);
  for (const l of [key, rim]) l.castShadow = false;
  root.add(ambient, key, key.target, rim, rim.target);
  const AMBIENT = 0.32,
    RIM = 0.55;

  // ----------------------------------------------------------- runtime
  let torchLight: THREE.SpotLight | null = null;
  const findTorch = () => {
    const kids = camera.children;
    for (let i = 0; i < kids.length; i++) {
      const o = kids[i] as THREE.SpotLight;
      if (o.isSpotLight) return o;
    }
    return null;
  };

  const swayYaw = spring(),
    swayPitch = spring(),
    push = spring();
  let time = 0;
  let moveK = 0,
    runK = 0,
    raiseK = 0,
    hideK = 0,
    fearK = 0;
  const ledOn = new Float32Array(5);
  let lcdTimer = 1;
  let lcdText = "";
  let lcdLevel = -1;

  const _scale = new THREE.Vector3();
  const _pos = new THREE.Vector3();
  const _qa = new THREE.Quaternion();
  const _qb = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _c = new THREE.Color();
  const lensColour = new THREE.Color();
  const WARM = new THREE.Color(0xfff1d6);
  const UV = new THREE.Color(0xb59cff);
  const NEUTRAL = new THREE.Color(0xbfc8dc);

  return {
    setVisible(v: boolean) {
      root.visible = v;
    },

    update(dtIn, v) {
      const dt = Math.min(Math.max(dtIn, 0), 0.1);
      const sdt = Math.min(dt, 1 / 30);
      time += dt;

      // Follow the camera exactly, then animate in its local space.
      camera.updateMatrixWorld();
      camera.matrixWorld.decompose(root.position, root.quaternion, _scale);

      // ------------------------------------------------------ smoothing
      moveK += ((v.moving ? 1 : 0) - moveK) * damp(6, dt);
      runK += ((v.running ? 1 : 0) - runK) * damp(5, dt);
      hideK += ((v.hidden ? 1 : 0) - hideK) * damp(5, dt);
      fearK += (clamp(v.fear, 0, 1) - fearK) * damp(3, dt);
      const raiseTarget = clamp(v.emfLevel / 5, 0, 1) * (v.hidden ? 0.6 : 1);
      raiseK += (raiseTarget - raiseK) * damp(raiseTarget > raiseK ? 4 : 2, dt);
      stepSpring(push, v.beaming && !v.hidden ? 1 : 0, 260, 24, sdt);

      // Sway lags behind the look: turning right swings the hands left.
      const inv = dt > 1e-4 ? 1 / dt : 0;
      const tYaw = clamp(v.lookDX * inv * 0.02, -0.14, 0.14);
      const tPitch = clamp(v.lookDY * inv * 0.02, -0.11, 0.11);
      stepSpring(swayYaw, tYaw, 150, 17, sdt);
      stepSpring(swayPitch, tPitch, 150, 17, sdt);

      // ------------------------------------------------------------ rig
      const ph = v.bob;
      const amp = moveK * (1 + runK * 1.3);
      const breathe = Math.sin(time * 1.55) * (1 - moveK * 0.6);
      const tr = Math.pow(fearK, 1.6);
      rig.position.set(
        Math.sin(ph) * 0.0065 * amp + (Math.sin(time * 21.3) + Math.sin(time * 34.7 + 1.2) * 0.6) * 0.0011 * tr,
        -Math.cos(2 * ph) * 0.0045 * amp + breathe * 0.0022 - 0.02 * runK - 0.06 * hideK + Math.sin(time * 27.1 + 0.4) * 0.0012 * tr,
        0.02 * hideK
      );
      rig.rotation.set(
        swayPitch.x + breathe * 0.006 - 0.09 * hideK + Math.sin(time * 18.9 + 2.2) * 0.006 * tr,
        swayYaw.x + Math.sin(time * 23.3 + 0.8) * 0.005 * tr,
        swayYaw.x * 0.55 + Math.sin(ph) * 0.012 * amp
      );

      // ---------------------------------------------------------- torch
      const pk = push.x;
      const pkc = clamp(pk, 0, 1);
      const pump = Math.sin(ph) * runK * moveK;
      _pos.lerpVectors(TORCH_POS, TORCH_BEAM_POS, pk);
      torchArm.position.set(_pos.x + pump * 0.01, _pos.y + Math.abs(Math.sin(ph)) * 0.008 * runK * moveK, _pos.z - pump * 0.012);
      torchArm.quaternion.slerpQuaternions(qTorch, qTorchBeam, pkc);
      _e.set(-0.14 * runK + pump * 0.07 + Math.sin(time * 31.3) * 0.004 * tr, pump * 0.04, 0);
      torchArm.quaternion.multiply(_qa.setFromEuler(_e));

      // Lens and glow mirror the real torch light, flicker included.
      if (!torchLight) torchLight = findTorch();
      let lensK: number;
      if (torchLight) {
        lensK = torchLight.intensity / TORCH_NOMINAL;
        lensColour.copy(torchLight.color);
      } else {
        lensK = v.beaming ? 1.5 : v.torchOn ? 1 : 0;
        lensColour.copy(v.beaming ? UV : WARM);
      }
      lensK = clamp(lensK, 0, 2);
      const dim = 1 - 0.72 * hideK;
      lensMat.emissive.copy(lensColour);
      lensMat.emissiveIntensity = lensK * 7 * (1 - 0.4 * hideK);
      glowMat.color.copy(lensColour).multiplyScalar(lensK * 1.1 * (1 - 0.5 * hideK));
      const gs = 0.075 + 0.04 * pkc;
      lensGlow.scale.set(gs, gs, 1);

      // ------------------------------------------------------------ EMF
      _pos.lerpVectors(EMF_LOW_POS, EMF_HIGH_POS, raiseK);
      emfArm.position.set(_pos.x - pump * 0.01, _pos.y + Math.abs(Math.cos(ph)) * 0.007 * runK * moveK, _pos.z + pump * 0.012);
      _qb.slerpQuaternions(qEmfLow, qEmfHigh, raiseK);
      _e.set(-0.12 * runK - pump * 0.06 + Math.sin(time * 29.7 + 1.7) * 0.006 * tr, Math.sin(time * 25.1 + 0.3) * 0.005 * tr, 0);
      emfArm.quaternion.copy(_qb).multiply(_qa.setFromEuler(_e));

      const level = clamp(v.emfLevel, 0, 5);
      const wild = level >= 4;
      let spill = 0;
      let top = -1;
      for (let i = 0; i < 5; i++) {
        const lit = i < level ? 1 : 0;
        ledOn[i] += (lit - ledOn[i]) * damp(lit > ledOn[i] ? 40 : 9, dt);
        let f = 1;
        if (wild && lit) {
          f = 0.55 + Math.random() * 0.45;
          if (Math.random() < 0.06) f *= 0.15;
        }
        const on = ledOn[i] * f;
        if (lit) top = i;
        _c.copy(LED_COLOURS[i]).multiplyScalar((0.05 + 3.4 * on) * (1 - 0.35 * hideK));
        leds.setColorAt(i, _c);
        _c.copy(LED_COLOURS[i]).multiplyScalar(on * 0.85 * (1 - 0.35 * hideK));
        ledGlow.setColorAt(i, _c);
        spill += on;
      }
      leds.instanceColor!.needsUpdate = true;
      ledGlow.instanceColor!.needsUpdate = true;
      if (top >= 0) ledLight.color.copy(LED_COLOURS[top]);
      ledLight.intensity = spill * 0.0003;

      lcdTimer += dt;
      if (lcdTimer >= 0.125) {
        lcdTimer = 0;
        const val = clamp(v.emfValue, 0, 999.9);
        const text = val < 100 ? val.toFixed(1) : val.toFixed(0);
        const lv = Math.round(level);
        if (text !== lcdText || lv !== lcdLevel) {
          lcdText = text;
          lcdLevel = lv;
          drawLcd(text, lv);
        }
      }
      lcdMat.color.setScalar(lcdBase * (1 - 0.55 * hideK) * (wild ? 0.92 + Math.random() * 0.08 : 1));

      // --------------------------------------------------------- lights
      for (let i = 0; i < dimmable.length; i++) dimmable[i].color.copy(baseColours[i]).multiplyScalar(dim);
      const lit = Math.min(lensK, 1.6);
      key.color.copy(NEUTRAL).lerp(lensColour, clamp(lit * 1.5, 0, 1));
      key.intensity = (0.35 + 2.1 * lit) * dim;
      ambient.intensity = AMBIENT * dim;
      rim.intensity = RIM * dim * (1 + 0.4 * tr);
    },
  };
}
