// Renderer, camera framing, shake and picking. The look supplies everything in the scene.
import * as THREE from "three";
import type { Look } from "./look.ts";

// Colours are written exactly as chosen: no conversion or tone mapping.
THREE.ColorManagement.enabled = false;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 300);
  /** How much of the screen the board may fill, across and down (as a fraction of half the screen). */
  fill = { x: 0.86, y: 0.72 };
  /** Where the board's centre sits on screen (-1..1 each way). */
  center = { x: 0, y: -0.02 };
  private look: Look | null = null;
  private w = 9;
  private h = 6;
  private base = new THREE.Vector3();
  private target = new THREE.Vector3();
  private shake = 0;
  private t = 0;
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private observer: ResizeObserver;

  // Resolution: rendered pixels per CSS pixel. On a TV it starts below 1 and drops further if frames run long.
  private scale: number;
  private maxScale: number;
  /** The highest scale for this screen; maxScale drops below it after a step up that didn't hold, for a while. */
  private readonly topScale: number;
  private readonly minScale: number;
  private readonly frameBudget: number;
  private lastAt = 0;
  private frameMs = 0;
  private slowFor = 0;
  private fastFor = 0;
  private grace = 2;
  private clock = 0;
  private raisedAt = -99;
  private loweredAt = -99;
  private stats = { frames: 0, ms: 0, worst: 0, work: 0, workMax: 0 };

  /** `lite`: for TVs, whose graphics chips are phone-class: no antialiasing, and fewer pixels (the HUD stays sharp). */
  constructor(
    private readonly host: HTMLElement,
    opts: { lite?: boolean; fps?: number; scale?: number } = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: !opts.lite, stencil: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.maxScale = opts.lite ? 0.75 : Math.min(window.devicePixelRatio || 1, 2);
    this.minScale = opts.lite ? 0.45 : this.maxScale;
    if (opts.scale) this.maxScale = Math.min(this.maxScale, Math.max(this.minScale, opts.scale));
    this.topScale = this.maxScale;
    this.scale = this.maxScale;
    this.frameBudget = 1000 / (opts.fps ?? 60);
    this.renderer.setPixelRatio(this.scale);
    this.renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    host.appendChild(this.renderer.domElement);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
  }

  dispose() {
    this.observer.disconnect();
    if (this.look) this.scene.remove(this.look.group);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  use(look: Look, w: number, h: number) {
    if (this.look) this.scene.remove(this.look.group);
    this.look = look;
    this.w = w;
    this.h = h;
    this.scene.add(look.group);
    this.renderer.setClearColor(look.background, 1);
    look.bake(this.renderer);
    this.resize();
    // compile every shader now, not the first time a piece or a chain shows up (a visible hitch on a TV)
    this.renderer.compile(this.scene, this.camera);
    look.release?.(); // the previous board's materials, kept until now so their shader programs were reused
    this.grace = 2;
    look.kick = (a) => {
      this.shake = Math.min(1, this.shake + a);
    };
  }

  resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.frame();
  }

  /** Move the camera so the whole board (plus the look's padding) fills the allowed part of the screen. */
  private frame() {
    const look = this.look;
    if (!look) return;
    const cam = this.camera;
    cam.fov = look.camera.fov;
    cam.clearViewOffset();
    cam.updateProjectionMatrix();
    const tilt = THREE.MathUtils.degToRad(look.camera.tilt);
    const dir = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
    const hx = this.w / 2 + look.camera.pad;
    const hz = this.h / 2 + look.camera.pad;
    const corners = [
      new THREE.Vector3(-hx, 0, -hz),
      new THREE.Vector3(hx, 0, -hz),
      new THREE.Vector3(-hx, 0, hz),
      new THREE.Vector3(hx, 0, hz),
    ];
    const target = new THREE.Vector3();
    const v = new THREE.Vector3();
    const put = (d: number) => {
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateMatrixWorld(true);
    };
    const bounds = () => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of corners) {
        v.copy(c).project(cam);
        x0 = Math.min(x0, v.x);
        x1 = Math.max(x1, v.x);
        y0 = Math.min(y0, v.y);
        y1 = Math.max(y1, v.y);
      }
      return { x0, x1, y0, y1 };
    };
    const groundAt = (sx: number, sy: number) => {
      this.ray.setFromCamera(new THREE.Vector2(sx, sy), cam);
      return this.ray.ray.intersectPlane(this.ground, new THREE.Vector3()) ?? new THREE.Vector3();
    };
    let d = 20;
    for (let pass = 0; pass < 4; pass++) {
      let lo = 0.5;
      let hi = 300;
      for (let k = 0; k < 40; k++) {
        d = (lo + hi) / 2;
        put(d);
        const b = bounds();
        if ((b.x1 - b.x0) / 2 <= this.fill.x && (b.y1 - b.y0) / 2 <= this.fill.y) hi = d;
        else lo = d;
      }
      d = hi;
      put(d);
      // Put the board's centre where it's wanted (a tilted view draws the near edge bigger than the far one).
      const b = bounds();
      target.add(groundAt((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2).sub(groundAt(0, this.center.y)));
    }
    put(d);
    this.base.copy(cam.position);
    this.target.copy(target);
    // slide the picture sideways with a lens shift, so the board is still seen square-on
    if (this.center.x) {
      const w = this.host.clientWidth || 1;
      const h = this.host.clientHeight || 1;
      cam.setViewOffset(w, h, (-this.center.x * w) / 2, 0, w, h);
    }
  }

  /** The cell under a screen point, or -1. */
  pick(clientX: number, clientY: number): number {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = this.ray.ray.intersectPlane(this.ground, new THREE.Vector3());
    if (!hit) return -1;
    const x = Math.floor(hit.x + this.w / 2);
    const z = Math.floor(hit.z + this.h / 2);
    if (x < 0 || z < 0 || x >= this.w || z >= this.h) return -1;
    return z * this.w + x;
  }

  /** How long the game's own code took for a frame (ms), drawing included. */
  work(ms: number) {
    this.stats.work += ms;
    this.stats.workMax = Math.max(this.stats.workMax, ms);
  }

  /** Frames drawn since the last call: the average rate, the longest gap, the resolution and the game's own time. */
  perf() {
    const { frames, ms, worst, work, workMax } = this.stats;
    this.stats = { frames: 0, ms: 0, worst: 0, work: 0, workMax: 0 };
    return {
      fps: frames && ms ? Math.round((frames * 1000) / ms) : 0,
      worst: Math.round(worst),
      scale: this.scale,
      js: frames ? `${(work / frames).toFixed(1)}ms (max ${Math.round(workMax)})` : "-",
      draws: this.renderer.info.render.calls,
    };
  }

  // Keep the frame rate: when frames run long for a while, draw fewer pixels; creep back up when there's room.
  private adapt(ms: number) {
    const s = ms / 1000;
    this.clock += s;
    this.stats.frames++;
    this.stats.ms += ms;
    this.stats.worst = Math.max(this.stats.worst, ms);
    this.frameMs = this.frameMs ? this.frameMs + (ms - this.frameMs) * 0.06 : ms;
    if (this.grace > 0) {
      this.grace -= s; // a new board compiles shaders and uploads textures: don't judge those frames
      return;
    }
    if (this.minScale >= this.maxScale) return;
    if (this.frameMs > this.frameBudget * 1.12) {
      this.slowFor += s;
      this.fastFor = 0;
    } else if (this.frameMs < this.frameBudget * 1.08) {
      this.fastFor += s;
      this.slowFor = 0;
    } else this.slowFor = this.fastFor = 0;
    if (this.slowFor > 1 && this.scale > this.minScale) {
      const next = Math.max(this.minScale, this.scale - 0.1);
      if (this.clock - this.raisedAt < 10) {
        this.maxScale = next; // that step up didn't hold: stay below it for a while
        this.loweredAt = this.clock;
      }
      this.setScale(next);
    } else if (this.fastFor > 8 && this.scale >= this.maxScale && this.maxScale < this.topScale && this.clock - this.loweredAt > 60) {
      this.maxScale = Math.min(this.topScale, this.maxScale + 0.05); // a minute on: try higher again
      this.loweredAt = this.clock;
    } else if (this.fastFor > 8 && this.scale < this.maxScale) {
      this.raisedAt = this.clock;
      this.setScale(Math.min(this.maxScale, this.scale + 0.05));
    }
  }

  private setScale(s: number) {
    this.scale = s;
    this.slowFor = this.fastFor = 0;
    this.frameMs = this.frameBudget;
    // only the pixel count changes: the canvas size and the camera framing stay (setPixelRatio keeps the size)
    this.renderer.setPixelRatio(s);
  }

  /** `judge`: false for frames drawn at a lower rate on purpose (idle), which must not lower the resolution. */
  render(dt: number, judge = true) {
    const at = performance.now();
    if (judge && this.lastAt && at - this.lastAt < 250) this.adapt(at - this.lastAt);
    this.lastAt = judge ? at : 0;
    this.t += dt;
    this.shake *= Math.exp(-dt * 7);
    if (this.shake < 1e-3) this.shake = 0; // still, exactly: an idle board is a still picture
    const s = this.shake * this.shake * 0.08;
    const t = this.t;
    this.camera.position.set(
      this.base.x + Math.sin(t * 53) * s,
      this.base.y + Math.sin(t * 47 + 1.3) * s * 0.6,
      this.base.z + Math.sin(t * 59 + 2.1) * s,
    );
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
  }
}
