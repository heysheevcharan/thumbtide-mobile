// What every look provides, and the shared bookkeeping for pieces that sit in cells and fly between them.
import * as THREE from "three";
import { capacity, type Burst, type CellState } from "../rules.ts";

export interface LookInfo {
  id: string;
  name: string;
  blurb: string;
  /** Player colours as this look draws them, in seat order. */
  colors: string[];
}

export interface CameraSpec {
  /** Degrees above the table. */
  tilt: number;
  fov: number;
  /** Room around the cells to keep in frame, in cells. */
  pad: number;
}

/** A look draws the board and plays back moves. Cells are 1 unit square, centred on the origin, x across and z down. */
export interface Look {
  readonly info: LookInfo;
  readonly group: THREE.Group;
  readonly background: number;
  readonly camera: CameraSpec;
  /** Board size it was last built for. */
  readonly w: number;
  readonly h: number;
  /** Set by the stage: ask for a camera shake. */
  kick: (amount: number) => void;
  build(w: number, h: number): void;
  /** Draws what never changes into textures, once the renderer exists. Called after build. */
  bake(renderer: THREE.WebGLRenderer): void;
  dispose(): void;
  /** Frees what the previous build left alive. The stage calls it once the new scene has compiled. */
  release?(): void;
  clear(): void;
  /** Jump a cell straight to a state, no animation. */
  setCell(i: number, owner: number, count: number): void;
  /** A player adds a piece; `count` includes it. */
  place(i: number, owner: number, count: number): void;
  /** Full cells burst; their pieces take `dur` seconds to reach the neighbours. */
  burst(bursts: Burst[], owner: number, dur: number): void;
  /** The pieces from the last burst arrive; `cells` is the state afterwards. */
  land(cells: CellState[]): void;
  turn(owner: number): void;
  /** The cell the current player is pointing at (-1: none). `ok` is false over a cell they can't play. */
  hover(i: number, owner: number, ok?: boolean): void;
  /** The current player tried to play somewhere they can't: shake the cursor. */
  nope(): void;
  win(owner: number): void;
  update(dt: number, camera: THREE.Camera): void;
}

export const REST = 0;
export const DROP = 1;
export const FLY = 2;

export interface Piece {
  /** The cell it sits in, or is flying to. */
  cell: number;
  /** The cell it last flew from. */
  src: number;
  owner: number;
  /** Its place in the cell's arrangement, and how many share the cell. */
  slot: number;
  n: number;
  mode: number;
  t: number;
  dur: number;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  from: THREE.Vector3;
  /** Where a flight ends (kept up to date while flying). */
  to: THREE.Vector3;
  col: THREE.Color;
  colTo: THREE.Color;
  /** 1 when it changes hands, fading out. */
  flash: number;
  /** A small hop, fading out (looks use it as they like). */
  jolt: number;
  seed: number;
  age: number;
  /** Delay before this piece joins the win celebration. */
  hop: number;
  quat: THREE.Quaternion;
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export function bounceOut(t: number) {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}
/** Send only the first `count` items of an attribute to the graphics chip this frame, not the whole buffer. */
export function upload(a: THREE.BufferAttribute, count: number) {
  if (count <= 0) return;
  a.clearUpdateRanges();
  a.addUpdateRange(0, count * a.itemSize);
  a.needsUpdate = true;
}

/** About how long a win is celebrated, in seconds, before the pieces settle and the end screen can rest. */
export const CHEER_S = 5;
/** CHEER_S rounded up to whole cycles of a look's own motion, so the cheer stops at rest (not mid-hop). */
export const cheerEnd = (period: number) => Math.ceil(CHEER_S / period) * period;

export function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const v3 = new THREE.Vector3();
const euler = new THREE.Euler();

/** Frees the geometry and materials under `root`, except those in `keep`. */
function freeObject(root: THREE.Object3D, keep: Set<unknown>) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !keep.has(m.geometry)) m.geometry.dispose();
    for (const x of ([] as THREE.Material[]).concat(m.material ?? [])) if (!keep.has(x)) x.dispose();
  });
}

export abstract class PieceLook implements Look {
  abstract readonly info: LookInfo;
  abstract readonly background: number;
  abstract readonly camera: CameraSpec;
  readonly group = new THREE.Group();
  kick: (amount: number) => void = () => {};

  w = 0;
  h = 0;
  protected palette: THREE.Color[] = [];
  protected cells: Piece[][] = [];
  protected owners = new Int8Array(0);
  protected flyers: Piece[] = [];
  protected textures: THREE.Texture[] = [];
  protected targets: THREE.WebGLRenderTarget[] = [];
  private baked = true;
  protected time = 0;
  protected hoverCell = -1;
  protected hoverOwner = 0;
  protected hoverOk = true;
  private nopeAt = -10;
  protected turnOwner = 0;
  protected winner = -1;
  protected winT = 0;
  /** How quickly resting pieces slide to their spot (per second). */
  protected settleRate = 14;
  protected dropTime = 0.45;
  private spare: Piece[] = [];
  private seedN = 0;
  /** The previous build's scene, kept until the new one has compiled (see build). */
  private old: { objects: THREE.Object3D[]; textures: THREE.Texture[]; targets: THREE.WebGLRenderTarget[] } | null = null;

  /** `lite`: for TVs, whose graphics chips are phone-class: lighter meshes and effects. */
  constructor(readonly lite = false) {}

  build(w: number, h: number) {
    // Keep the old scene's materials alive until the new scene has compiled (stage.use calls release): three.js
    // then reuses their shader programs, instead of compiling each one again (~60 ms each on a TV).
    this.release();
    this.old = { objects: [...this.group.children], textures: this.textures, targets: this.targets };
    this.group.clear();
    this.textures = [];
    this.targets = [];
    this.w = w;
    this.h = h;
    this.palette = this.info.colors.map((c) => new THREE.Color(c));
    this.cells = Array.from({ length: w * h }, () => []);
    this.owners = new Int8Array(w * h).fill(-1);
    this.flyers = [];
    this.winner = -1;
    this.buildScene();
    this.baked = false;
  }

  bake(renderer: THREE.WebGLRenderer) {
    if (this.baked) return;
    this.baked = true;
    for (const t of this.targets) t.dispose();
    this.targets = [];
    this.bakeScene(renderer);
  }

  release() {
    const old = this.old;
    if (!old) return;
    this.old = null;
    // anything the new scene still uses stays
    const keep = new Set<unknown>();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      keep.add(m.geometry);
      for (const x of ([] as unknown[]).concat(m.material ?? [])) keep.add(x);
    });
    for (const o of old.objects) freeObject(o, keep);
    for (const t of old.textures) if (!this.textures.includes(t)) t.dispose();
    for (const t of old.targets) if (!this.targets.includes(t)) t.dispose();
  }

  dispose() {
    this.release();
    for (const o of this.group.children) freeObject(o, new Set());
    for (const t of this.textures) t.dispose();
    this.textures = [];
    for (const t of this.targets) t.dispose();
    this.targets = [];
    this.group.clear();
  }

  protected abstract buildScene(): void;
  protected bakeScene(_renderer: THREE.WebGLRenderer) {}
  /** Where a piece rests (or, for a flying piece, where it will land). */
  protected abstract home(p: Piece, out: THREE.Vector3): void;
  protected abstract render(dt: number, camera: THREE.Camera): void;

  protected flight(p: Piece, k: number, out: THREE.Vector3) {
    out.lerpVectors(p.from, p.to, k);
    out.y += 4 * k * (1 - k) * 0.5;
  }
  protected drop(_p: Piece, k: number, home: THREE.Vector3, out: THREE.Vector3) {
    out.copy(home);
    out.y += (1 - bounceOut(k)) * 1.3;
  }
  protected beforeUpdate(_dt: number) {}
  protected onPlace(_p: Piece) {}
  protected onBurst(_cell: number, _owner: number, _targets: number[], _dur: number) {}
  protected onLaunch(_p: Piece) {}
  protected onLand(_p: Piece) {}
  protected onCapture(_cell: number, _from: number, _to: number) {}
  /** A cell's piece count was set (after place, land or setCell). */
  protected onRecount(_cell: number) {}
  protected onTurn(_owner: number) {}
  protected onWin(_owner: number) {}
  protected onClear() {}

  cx(i: number) {
    return (i % this.w) - this.w / 2 + 0.5;
  }
  cz(i: number) {
    return Math.floor(i / this.w) - this.h / 2 + 0.5;
  }
  cap(i: number) {
    return capacity(this.w, this.h, i);
  }
  /** One more piece and this cell bursts. */
  critical(i: number) {
    const n = this.cells[i]!.length;
    return n > 0 && n >= this.cap(i) - 1;
  }

  protected newPiece(cell: number, owner: number): Piece {
    const p: Piece = this.spare.pop() ?? {
      cell: 0, src: 0, owner: 0, slot: 0, n: 1, mode: REST, t: 0, dur: 1,
      pos: new THREE.Vector3(), prev: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(),
      col: new THREE.Color(), colTo: new THREE.Color(), flash: 0, jolt: 0, seed: 0, age: 0, hop: 0,
      quat: new THREE.Quaternion(),
    };
    p.cell = cell;
    p.src = cell;
    p.owner = owner;
    p.slot = 0;
    p.n = 1;
    p.mode = REST;
    p.t = 0;
    p.flash = 0;
    p.jolt = 0;
    p.age = 0;
    p.hop = 0;
    p.seed = hash(++this.seedN * 1.618);
    p.quat.setFromEuler(euler.set(p.seed * 9, p.seed * 23, p.seed * 5));
    p.col.copy(this.palette[owner] ?? this.palette[0]!);
    p.colTo.copy(p.col);
    return p;
  }

  protected reslot(i: number) {
    const list = this.cells[i]!;
    list.forEach((p, k) => {
      p.slot = k;
      p.n = list.length;
    });
  }

  protected eachPiece(fn: (p: Piece) => void) {
    for (const list of this.cells) for (const p of list) fn(p);
    for (const p of this.flyers) fn(p);
  }

  clear() {
    for (const list of this.cells) {
      for (const p of list) this.spare.push(p);
      list.length = 0;
    }
    for (const p of this.flyers) this.spare.push(p);
    this.flyers = [];
    this.owners.fill(-1);
    this.winner = -1;
    this.onClear();
  }

  setCell(i: number, owner: number, count: number) {
    const list = this.cells[i]!;
    while (list.length > count) this.spare.push(list.pop()!);
    while (list.length < count) list.push(this.newPiece(i, owner));
    this.owners[i] = count ? owner : -1;
    this.reslot(i);
    for (const p of list) {
      p.owner = owner;
      p.col.copy(this.palette[owner]!);
      p.colTo.copy(p.col);
      p.mode = REST;
      this.home(p, p.pos);
      p.prev.copy(p.pos);
    }
    this.onRecount(i);
  }

  place(i: number, owner: number, count: number) {
    const list = this.cells[i]!;
    while (list.length > count - 1) this.spare.push(list.pop()!);
    while (list.length < count - 1) list.push(this.newPiece(i, owner));
    const p = this.newPiece(i, owner);
    list.push(p);
    this.owners[i] = owner;
    this.reslot(i);
    p.mode = DROP;
    p.t = 0;
    p.dur = this.dropTime;
    this.home(p, p.pos);
    p.prev.copy(p.pos);
    this.onRecount(i);
    this.onPlace(p);
  }

  burst(bursts: Burst[], owner: number, dur: number) {
    const incoming = new Map<number, number>();
    const launched: Piece[] = [];
    for (const b of bursts) {
      const list = this.cells[b.cell]!;
      for (const t of b.targets) {
        let p = list.pop();
        if (!p) {
          p = this.newPiece(b.cell, owner);
          this.home(p, p.pos);
        }
        const already = incoming.get(t) ?? 0;
        p.mode = FLY;
        p.t = 0;
        p.dur = dur;
        p.src = b.cell;
        p.cell = t;
        p.slot = this.cells[t]!.length + already;
        p.from.copy(p.pos);
        incoming.set(t, already + 1);
        launched.push(p);
        this.flyers.push(p);
      }
      if (!list.length) this.owners[b.cell] = -1;
      this.reslot(b.cell);
    }
    for (const p of launched) {
      p.n = this.cells[p.cell]!.length + (incoming.get(p.cell) ?? 0);
      this.home(p, p.to);
    }
    for (const b of bursts) this.onBurst(b.cell, owner, b.targets, dur);
    for (const p of launched) this.onLaunch(p);
  }

  land(cells: CellState[]) {
    const arrived = this.flyers;
    this.flyers = [];
    for (const p of arrived) {
      p.mode = REST;
      p.age = 0;
      this.cells[p.cell]!.push(p);
    }
    for (const { i, owner, count } of cells) {
      const before = this.owners[i]!;
      const list = this.cells[i]!;
      while (list.length > count) this.spare.push(list.pop()!);
      while (list.length < count) {
        const p = this.newPiece(i, owner);
        list.push(p);
        this.home(p, p.pos);
      }
      this.owners[i] = count ? owner : -1;
      for (const p of list) {
        if (p.owner === owner) continue;
        p.owner = owner;
        p.colTo.copy(this.palette[owner]!);
        p.flash = 1;
      }
      this.reslot(i);
      if (before >= 0 && before !== owner && count) this.onCapture(i, before, owner);
      this.onRecount(i);
    }
    for (const p of arrived) this.onLand(p);
  }

  turn(owner: number) {
    this.turnOwner = owner;
    this.onTurn(owner);
  }

  hover(i: number, owner: number, ok = true) {
    this.hoverCell = i;
    this.hoverOwner = owner;
    this.hoverOk = ok;
  }

  nope() {
    this.nopeAt = this.time;
  }

  /** Sideways wobble for the cursor after a refused move, in cells. */
  protected shake() {
    const t = this.time - this.nopeAt;
    return t < 0.4 ? Math.sin(t * 55) * 0.07 * (1 - t / 0.4) : 0;
  }

  win(owner: number) {
    this.winner = owner;
    this.winT = 0;
    this.onWin(owner);
  }

  update(dt: number, camera: THREE.Camera) {
    this.time += dt;
    if (this.winner >= 0) this.winT += dt;
    this.beforeUpdate(dt);
    const k = damp(this.settleRate, dt);
    const kc = damp(9, dt);
    const fade = Math.exp(-dt * 4);
    const joltFade = Math.exp(-dt * 5);
    const step = (p: Piece) => {
      p.prev.copy(p.pos);
      p.age += dt;
      if (p.mode === FLY) {
        p.t += dt;
        this.home(p, p.to);
        this.flight(p, Math.min(1, p.t / p.dur), p.pos);
      } else if (p.mode === DROP) {
        p.t += dt;
        const q = Math.min(1, p.t / p.dur);
        this.home(p, v3);
        this.drop(p, q, v3, p.pos);
        if (q >= 1) p.mode = REST;
      } else {
        this.home(p, v3);
        p.pos.lerp(v3, k);
      }
      p.col.lerp(p.colTo, kc);
      p.flash *= fade;
      p.jolt *= joltFade;
    };
    this.eachPiece(step);
    this.render(dt, camera);
  }
}
