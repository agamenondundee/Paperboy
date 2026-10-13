import * as THREE from "three";
import { clamp, damp } from "../core/util";

/**
 * The Janitor's demon dachshund. A low, long, scorched-looking sausage dog
 * with ember eyes that trots at his right heel. It is solid rather than
 * ghostly (the ghost shader fades everything near the floor), and fades in
 * and out with its master through a plain opacity.
 */

const OFFSET = new THREE.Vector3(0.62, 0, 0.35); // beside and slightly ahead of his right foot

function mats() {
  const fur = new THREE.MeshStandardMaterial({ color: 0x2a1c16, roughness: 0.8, emissive: 0x6a1406, emissiveIntensity: 1, transparent: true });
  // Smouldering cracks: a fresnel ember rim so it reads in the dark.
  fur.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\n  totalEmissiveRadiance += vec3(1.6, 0.35, 0.08) * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.5);"
    );
  };
  const skin = new THREE.MeshStandardMaterial({ color: 0x3a1a14, roughness: 0.6, emissive: 0x8a1a06, emissiveIntensity: 1, transparent: true });
  const eye = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.45, 0.15), transparent: true });
  const tooth = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.4, transparent: true });
  const ember = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.5, 0.15), transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
  return { fur, skin, eye, tooth, ember };
}

export class DemonDog {
  readonly root = new THREE.Group();
  readonly materials: THREE.Material[];
  private m = mats();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private jaw: THREE.Mesh;
  private tail = new THREE.Group();
  private legs: THREE.Group[] = [];
  private ears: THREE.Mesh[] = [];
  private embers: THREE.Mesh[] = [];
  private phase = 0;
  private speedS = 0;
  private snarl = 0;
  private snarlT = 0;

  constructor() {
    const { fur, skin, eye, tooth, ember } = this.m;
    this.materials = [fur, skin, eye, tooth, ember];
    this.root.name = "demon-dachshund";
    this.root.position.copy(OFFSET);
    this.root.scale.setScalar(1.35); // a big, wrong-looking dog
    this.root.add(this.body);

    // Long sausage body, lying along +Z (the way the Janitor faces).
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.42, 6, 12), fur);
    torso.rotation.x = Math.PI / 2;
    torso.position.set(0, 0.2, 0);
    torso.scale.set(1, 1, 0.92);
    this.body.add(torso);
    // A ridge of scorched spines along the back.
    const spineGeo = new THREE.ConeGeometry(0.018, 0.07, 5);
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(spineGeo, skin);
      s.position.set(0, 0.29, -0.2 + i * 0.065);
      s.rotation.x = -0.35;
      this.body.add(s);
    }

    // Head and snout.
    this.head.position.set(0, 0.27, 0.3);
    this.body.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), fur);
    skull.scale.set(1, 0.95, 1.1);
    this.head.add(skull);
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.048, 0.13, 10), fur);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, -0.015, 0.1);
    this.head.add(snout);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), skin);
    nose.position.set(0, -0.008, 0.168);
    this.head.add(nose);
    this.jaw = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.016, 0.11), skin);
    this.jaw.geometry.translate(0, 0, 0.055);
    this.jaw.position.set(0, -0.045, 0.045);
    this.head.add(this.jaw);
    const fangGeo = new THREE.ConeGeometry(0.006, 0.026, 5);
    for (const sx of [-1, 1]) {
      const fang = new THREE.Mesh(fangGeo, tooth);
      fang.position.set(sx * 0.018, -0.04, 0.15);
      fang.rotation.x = Math.PI;
      this.head.add(fang);
      // Ember eyes, set deep under a heavy brow.
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), eye);
      e.position.set(sx * 0.035, 0.022, 0.06);
      this.head.add(e);
      // Long floppy ears.
      const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.07, 4, 8), fur);
      ear.scale.set(1, 1, 0.35);
      ear.position.set(sx * 0.07, -0.02, -0.01);
      ear.rotation.z = sx * 0.25;
      this.head.add(ear);
      this.ears.push(ear);
    }
    // Two stubby horns.
    const hornGeo = new THREE.ConeGeometry(0.012, 0.05, 6);
    for (const sx of [-1, 1]) {
      const h = new THREE.Mesh(hornGeo, skin);
      h.position.set(sx * 0.03, 0.07, 0.0);
      h.rotation.set(-0.4, 0, sx * -0.35);
      this.head.add(h);
    }

    // Four short legs, pivoting at the hip.
    const legGeo = new THREE.CapsuleGeometry(0.022, 0.08, 4, 8);
    legGeo.translate(0, -0.06, 0);
    for (const [x, z] of [
      [-0.05, 0.2],
      [0.05, 0.2],
      [-0.05, -0.2],
      [0.05, -0.2],
    ]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.15, z);
      pivot.add(new THREE.Mesh(legGeo, fur));
      this.body.add(pivot);
      this.legs.push(pivot);
    }

    // Whip tail.
    this.tail.position.set(0, 0.23, -0.27);
    const tailMesh = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.2, 6), fur);
    tailMesh.rotation.x = -Math.PI / 2 - 0.5;
    tailMesh.position.set(0, 0.04, -0.08);
    this.tail.add(tailMesh);
    this.body.add(this.tail);

    // Embers drifting off its breath.
    const emberGeo = new THREE.SphereGeometry(0.009, 6, 4);
    for (let i = 0; i < 6; i++) {
      const e = new THREE.Mesh(emberGeo, ember);
      this.head.add(e);
      this.embers.push(e);
    }

    this.root.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
  }

  /** A snarl: jaws open, head low, for about a second. */
  growl() {
    this.snarlT = 1.1;
  }

  update(dt: number, time: number, speed: number, frozen: boolean, visible: number, lit: number) {
    const op = clamp(visible, 0, 1);
    this.root.visible = op > 0.01;
    if (!this.root.visible) return;
    const { fur, skin, eye, tooth, ember } = this.m;
    fur.opacity = skin.opacity = tooth.opacity = op;
    eye.opacity = op;
    ember.opacity = 0.6 * op;
    // The UV beam makes it flare like its master.
    const glow = 1 + lit * 3;
    fur.emissiveIntensity = glow;
    skin.emissiveIntensity = glow * 1.3;

    if (!frozen) {
      this.speedS += (speed - this.speedS) * damp(6, dt);
      // Short legs mean a fast scurry: stride rate rises steeply with speed.
      this.phase += dt * (2 + this.speedS * 9);
    }
    const s = clamp(this.speedS / 1.6, 0, 1);
    const p = this.phase;
    const swing = 0.75 * s;
    this.legs[0].rotation.x = Math.sin(p) * swing;
    this.legs[3].rotation.x = Math.sin(p) * swing;
    this.legs[1].rotation.x = Math.sin(p + Math.PI) * swing;
    this.legs[2].rotation.x = Math.sin(p + Math.PI) * swing;
    this.body.position.y = Math.abs(Math.sin(p)) * 0.02 * s;
    this.body.rotation.z = Math.sin(p) * 0.04 * s;
    this.tail.rotation.y = Math.sin(time * (6 + 6 * s)) * 0.5;
    this.tail.rotation.x = -0.2 + Math.sin(time * 3.1) * 0.1;

    if (this.snarlT > 0) this.snarlT -= dt;
    this.snarl += ((this.snarlT > 0 ? 1 : 0) - this.snarl) * damp(10, dt);
    // Idle: sniffs the floor. Snarling: head low, jaws open, ears pinned back.
    const sniff = (1 - s) * (1 - this.snarl);
    this.head.rotation.x = 0.35 * sniff + Math.sin(time * 9) * 0.05 * sniff + 0.28 * this.snarl + Math.sin(time * 40) * 0.03 * this.snarl;
    this.head.rotation.y = Math.sin(time * 1.3) * 0.25 * sniff;
    this.jaw.rotation.x = 0.55 * this.snarl + 0.06 * Math.max(0, Math.sin(time * 5));
    for (const [i, ear] of this.ears.entries()) ear.rotation.x = Math.sin(p + i) * 0.25 * s - 0.5 * this.snarl;

    // Embers rise from the snout and loop.
    for (let i = 0; i < this.embers.length; i++) {
      const k = (time * 0.55 + i / this.embers.length) % 1;
      const e = this.embers[i];
      e.position.set(Math.sin(i * 2.3 + time * 1.7) * 0.03 * k, 0.0 + k * 0.22, 0.17 + k * 0.05);
      e.scale.setScalar(1 - k);
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}
