// Look 2: plasma cores over black glass. Light from below shows through the gaps between tiles in the colour of
// whoever's turn it is. Cores orbit faster as a cell fills; a full cell crackles with arcs, then flashes and fires
// its cores along the board, leaving trails.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { NOISE, SDF, WORLD_VS } from "./glsl.ts";
import { FLY, PieceLook, cheerEnd, damp, hash, upload, type CameraSpec, type LookInfo, type Piece } from "./look.ts";

const TILE = 0.9;
/** One wave of the win celebration (sin(t * 5)), in seconds. */
const WIN_WAVE = (2 * Math.PI) / 5;
const TILE_H = 0.14;
const CORE_R = 0.12;
const LIFT = 0.25;
const MAX_CORES = 900;
const MAX_GLOW = 8000;
const MAX_RINGS = 200;
const LIGHT = new THREE.Vector3(-0.35, 1, -0.5).normalize();

const TILE_VS = /* glsl */ `
attribute vec3 aCol;
attribute vec2 aFx;
varying vec3 vW;
varying vec3 vN;
varying vec3 vL;
varying vec3 vCol;
varying vec2 vFx;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vL = position;
  vN = normalize(mat3(modelMatrix) * (mat3(instanceMatrix) * normal));
  vCol = aCol;
  vFx = aFx;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const TILE_FS = /* glsl */ `
uniform vec3 uLight;
uniform vec3 uTurn;
varying vec3 vW;
varying vec3 vN;
varying vec3 vL;
varying vec3 vCol;
varying vec2 vFx;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float top = smoothstep(0.7, 0.95, n.y);
  float r = length(vL.xz);
  float aa = fwidth(r) * 1.5;
  float ring = (1.0 - smoothstep(0.012 - aa, 0.012 + aa, abs(r - 0.3))) * top;
  float pip = (1.0 - smoothstep(0.035 - aa, 0.035 + aa, r)) * top;
  vec3 h = normalize(uLight + v);
  float spec = pow(max(dot(n, h), 0.0), 120.0);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 c = vec3(0.014, 0.016, 0.022) + vec3(0.035, 0.042, 0.055) * fres + vec3(0.7, 0.8, 1.0) * spec * 0.35;
  float heat = vFx.x;
  float owned = step(0.001, dot(vCol, vCol));
  c += vCol * exp(-r * r * 7.0) * (0.05 + 0.3 * heat) * top;
  vec3 ringCol = mix(vec3(0.07, 0.085, 0.11), vCol * (0.45 + 1.1 * heat), owned);
  c += ringCol * (ring + pip * 0.8);
  c += mix(vec3(1.0), vCol, 0.6) * vFx.y * (0.25 * top + ring * 1.2);
  c += uTurn * (1.0 - top) * 0.12;
  gl_FragColor = vec4(c, 1.0);
}
`;

const GLOW_FS_UNDER = /* glsl */ `
uniform vec3 uTurn;
uniform float uTime;
uniform vec2 uHalf;
uniform sampler2D uHeat;
varying vec3 vW;
varying vec3 vN;
void main() {
  vec2 uv = (vW.xz + uHalf) / (uHalf * 2.0);
  vec3 heat = texture2D(uHeat, uv).rgb;
  vec3 c = uTurn * (0.46 + 0.08 * sin(uTime * 2.2)) + heat * 1.6;
  gl_FragColor = vec4(c, 1.0);
}
`;

const FRAME_FS = /* glsl */ `
uniform vec3 uTurn;
uniform vec2 uHalf;
uniform vec3 uLight;
varying vec3 vW;
varying vec3 vN;
${NOISE}
${SDF}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float top = step(0.6, n.y);
  vec3 c = vec3(0.035, 0.04, 0.05) * (0.85 + 0.3 * vnoise(vec2(vW.x * 60.0, vW.z * 2.0)));
  c += vec3(0.6, 0.7, 0.85) * pow(max(dot(n, normalize(uLight + v)), 0.0), 60.0) * 0.25;
  float sd = sdRoundRect(vW.xz, uHalf + 0.19, 0.12);
  float aa = fwidth(sd);
  float led = (1.0 - smoothstep(0.012 - aa, 0.012 + aa, abs(sd))) * top;
  c = mix(c, uTurn * 1.2 + 0.15, led);
  c += uTurn * exp(-abs(sd) * 30.0) * 0.18 * top;
  gl_FragColor = vec4(c, 1.0);
}
`;

const FLOOR_FS = /* glsl */ `
uniform vec3 uTurn;
uniform vec2 uHalf;
varying vec3 vW;
varying vec3 vN;
${SDF}
void main() {
  vec2 p = vW.xz;
  vec2 g = abs(fract(p * 2.0) - 0.5);
  float dots = 1.0 - smoothstep(0.03, 0.06, length(g));
  float fade = exp(-dot(p, p) * 0.006);
  float sd = sdRoundRect(p, uHalf + 0.4, 0.3);
  vec3 c = vec3(0.012, 0.015, 0.022) + vec3(0.05, 0.06, 0.08) * dots * fade;
  c += uTurn * exp(-max(sd, 0.0) * 1.1) * 0.13;
  gl_FragColor = vec4(c, 1.0);
}
`;

const CORE_VS = /* glsl */ `
attribute vec3 aCol;
attribute vec2 aFx;
varying vec3 vN;
varying vec3 vW;
varying vec3 vO;
varying vec3 vCol;
varying vec2 vFx;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * (mat3(instanceMatrix) * normal));
  vO = position / ${CORE_R.toFixed(3)};
  vCol = aCol;
  vFx = aFx;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const CORE_FS = /* glsl */ `
uniform float uTime;
varying vec3 vN;
varying vec3 vW;
varying vec3 vO;
varying vec3 vCol;
varying vec2 vFx;
${NOISE}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float f = max(dot(n, v), 0.0);
  float swirl = vnoise3(vO * 3.2 + vec3(0.0, uTime * 2.6, vFx.y * 20.0));
  vec3 hot = mix(vCol, vec3(1.0), 0.82);
  vec3 c = mix(vCol * 0.85, hot, pow(f, 1.5) * (0.6 + 0.55 * swirl));
  c += vFx.x * 0.7;
  gl_FragColor = vec4(c, 1.0);
}
`;

// Soft additive light: dots, or capsules when given a direction. Used for halos, flashes, sparks, trails and arcs.
const GLOW_VS = /* glsl */ `
attribute vec3 aPos;
attribute vec4 aDir;
attribute vec3 aCol;
varying vec2 vQ;
varying float vLen;
varying float vSize;
varying vec3 vCol;
void main() {
  vec4 c = viewMatrix * vec4(aPos, 1.0);
  vec2 d = (viewMatrix * vec4(aDir.xyz, 0.0)).xy;
  float len = length(d);
  vec2 ax = len > 1e-5 ? d / len : vec2(1.0, 0.0);
  vec2 ay = vec2(-ax.y, ax.x);
  float s = aDir.w;
  vec2 q = vec2(position.x * 2.0 * (len + s), position.y * 2.0 * s);
  c.xy += ax * q.x + ay * q.y;
  vQ = q;
  vLen = len;
  vSize = s;
  vCol = aCol;
  gl_Position = projectionMatrix * c;
}
`;
const GLOW_FS = /* glsl */ `
varying vec2 vQ;
varying float vLen;
varying float vSize;
varying vec3 vCol;
void main() {
  float dx = max(abs(vQ.x) - vLen, 0.0);
  float d = length(vec2(dx, vQ.y)) / vSize;
  float g = exp(-d * d * 4.5) + exp(-d * d * 30.0) * 0.8;
  gl_FragColor = vec4(vCol * g, 1.0);
}
`;

// Shock rings lying on the tiles.
const RING_VS = /* glsl */ `
attribute vec4 aRing;
attribute vec4 aCol;
varying vec2 vP;
varying vec4 vRing;
varying vec4 vCol;
void main() {
  float ext = aRing.w + aRing.z * 2.0;
  vec3 p = vec3(position.x * 2.0 * ext, 0.0, position.y * 2.0 * ext);
  vP = p.xz;
  vRing = aRing;
  vCol = aCol;
  gl_Position = projectionMatrix * viewMatrix * vec4(p + vec3(aRing.x, 0.012, aRing.y), 1.0);
}
`;
const RING_FS = /* glsl */ `
varying vec2 vP;
varying vec4 vRing;
varying vec4 vCol;
void main() {
  float d = (length(vP) - vRing.w) / vRing.z;
  gl_FragColor = vec4(vCol.rgb * exp(-d * d * 2.5) * vCol.a, 1.0);
}
`;

interface Spark {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  s0: number; s1: number;
  r: number; g: number; b: number;
  i0: number; i1: number;
  drag: number;
  stretch: number;
}

interface Ring {
  x: number; z: number; t: number; dur: number; r0: number; r1: number; w: number;
  col: THREE.Color; i: number;
}

const ONE = new THREE.Vector3(1, 1, 1);
const m4 = new THREE.Matrix4();
const qi = new THREE.Quaternion();
const v1 = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);
const GREY = new THREE.Color(0.62, 0.64, 0.68);

export class ReactorLook extends PieceLook {
  readonly info: LookInfo = {
    id: "reactor",
    name: "Reactor",
    blurb: "Plasma cores over black glass. Cores orbit faster as a cell fills, crackle when it's full, then fire into the cells around it.",
    colors: ["#ff3d6a", "#2fc6ff", "#ffd43a", "#4dff8e", "#b27dff", "#ff8a2a", "#ff57d6", "#2bf0d0"],
  };
  readonly background = 0x030407;
  readonly camera: CameraSpec = { tilt: 58, fov: 30, pad: 0.55 };
  protected settleRate = 18;
  protected dropTime = 0.38;

  private phase = new Float32Array(0);
  private lift = new Float32Array(0);
  private pulse = new Float32Array(0);
  private tiles!: THREE.InstancedMesh;
  private tCol!: THREE.InstancedBufferAttribute;
  private tFx!: THREE.InstancedBufferAttribute;
  private cores!: THREE.InstancedMesh;
  private cCol!: THREE.InstancedBufferAttribute;
  private cFx!: THREE.InstancedBufferAttribute;
  private glowGeo!: THREE.InstancedBufferGeometry;
  private gPos!: THREE.InstancedBufferAttribute;
  private gDir!: THREE.InstancedBufferAttribute;
  private gCol!: THREE.InstancedBufferAttribute;
  private glowN = 0;
  private ringGeo!: THREE.InstancedBufferGeometry;
  private rA!: THREE.InstancedBufferAttribute;
  private rC!: THREE.InstancedBufferAttribute;
  private heat!: THREE.DataTexture;
  private heatData = new Uint8Array(0);
  private brackets!: THREE.Mesh;
  private hoverFill!: THREE.Mesh;
  private bracketShade!: THREE.Mesh;
  private turnCol = { value: new THREE.Color() };
  private turnTo = new THREE.Color();
  private timeU = { value: 0 };
  private sparks: Spark[] = [];
  private spareSparks: Spark[] = [];
  private rings: Ring[] = [];
  private hoverA = 0;
  private hoverGrey = 0;

  protected buildScene() {
    const { w, h } = this;
    const n = w * h;
    this.phase = Float32Array.from({ length: n }, (_, i) => hash(i + 0.5) * Math.PI * 2);
    this.lift = new Float32Array(n);
    this.pulse = new Float32Array(n);
    this.sparks = [];
    this.rings = [];
    const half = new THREE.Vector2(w / 2, h / 2);
    const light = { value: LIGHT };
    this.turnCol.value.copy(this.palette[0]!);
    this.turnTo.copy(this.palette[0]!);

    // Tiles
    const tileGeo = new RoundedBoxGeometry(TILE, TILE_H, TILE, this.lite ? 1 : 2, 0.045);
    this.tCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tFx = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage);
    tileGeo.setAttribute("aCol", this.tCol);
    tileGeo.setAttribute("aFx", this.tFx);
    this.tiles = new THREE.InstancedMesh(
      tileGeo,
      new THREE.ShaderMaterial({ uniforms: { uLight: light, uTurn: this.turnCol }, vertexShader: TILE_VS, fragmentShader: TILE_FS }),
      n,
    );
    this.tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tiles.frustumCulled = false;

    // Light under the tiles, showing through the gaps
    this.heatData = new Uint8Array(n * 4);
    this.heat = new THREE.DataTexture(this.heatData, w, h, THREE.RGBAFormat);
    this.heat.magFilter = THREE.LinearFilter;
    this.heat.minFilter = THREE.LinearFilter;
    this.heat.needsUpdate = true;
    this.textures.push(this.heat);
    const under = new THREE.Mesh(
      new THREE.PlaneGeometry(w + 0.14, h + 0.14).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: { uTurn: this.turnCol, uTime: this.timeU, uHalf: { value: half }, uHeat: { value: this.heat } },
        vertexShader: WORLD_VS,
        fragmentShader: GLOW_FS_UNDER,
      }),
    );
    under.position.y = -0.09;
    under.renderOrder = 1; // after the tiles: only the gaps get shaded

    const frame = new THREE.Mesh(
      new RoundedBoxGeometry(w + 0.62, 0.3, h + 0.62, 3, 0.12),
      new THREE.ShaderMaterial({ uniforms: { uTurn: this.turnCol, uHalf: { value: half }, uLight: light }, vertexShader: WORLD_VS, fragmentShader: FRAME_FS }),
    );
    frame.position.y = -0.105 - 0.15;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({ uniforms: { uTurn: this.turnCol, uHalf: { value: half } }, vertexShader: WORLD_VS, fragmentShader: FLOOR_FS }),
    );
    floor.position.y = -0.4;
    floor.renderOrder = 1;

    // Cores
    const sphere = new THREE.SphereGeometry(CORE_R, this.lite ? 16 : 24, this.lite ? 10 : 16);
    this.cCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CORES * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.cFx = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CORES * 2), 2).setUsage(THREE.DynamicDrawUsage);
    sphere.setAttribute("aCol", this.cCol);
    sphere.setAttribute("aFx", this.cFx);
    this.cores = new THREE.InstancedMesh(
      sphere,
      new THREE.ShaderMaterial({ uniforms: { uTime: this.timeU }, vertexShader: CORE_VS, fragmentShader: CORE_FS }),
      MAX_CORES,
    );
    this.cores.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cores.frustumCulled = false;
    this.cores.renderOrder = 2;

    // Glow
    this.glowGeo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    this.glowGeo.index = quad.index;
    this.glowGeo.setAttribute("position", quad.attributes.position!);
    this.gPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLOW * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.gDir = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLOW * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.gCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLOW * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.glowGeo.setAttribute("aPos", this.gPos);
    this.glowGeo.setAttribute("aDir", this.gDir);
    this.glowGeo.setAttribute("aCol", this.gCol);
    const glow = new THREE.Mesh(
      this.glowGeo,
      new THREE.ShaderMaterial({ vertexShader: GLOW_VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }),
    );
    glow.frustumCulled = false;
    glow.renderOrder = 5;

    // Shock rings
    this.ringGeo = new THREE.InstancedBufferGeometry();
    this.ringGeo.index = quad.index;
    this.ringGeo.setAttribute("position", quad.attributes.position!);
    this.rA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.rC = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.ringGeo.setAttribute("aRing", this.rA);
    this.ringGeo.setAttribute("aCol", this.rC);
    const rings = new THREE.Mesh(
      this.ringGeo,
      new THREE.ShaderMaterial({ vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }),
    );
    rings.frustumCulled = false;
    rings.renderOrder = 4;

    // Cursor: four solid corner brackets on a dark outline (so they read over a board full of glow), and a wash
    // of the player's colour over the cell
    const corners = (a: number, t: number, o: number) => {
      const shape = (sx: number, sz: number) => {
        const s = new THREE.Shape();
        s.moveTo(sx * o, sz * o);
        s.lineTo(sx * (o - a), sz * o);
        s.lineTo(sx * (o - a), sz * (o - t));
        s.lineTo(sx * (o - t), sz * (o - t));
        s.lineTo(sx * (o - t), sz * (o - a));
        s.lineTo(sx * o, sz * (o - a));
        s.closePath();
        return s;
      };
      const g = new THREE.ShapeGeometry([shape(1, 1), shape(-1, 1), shape(1, -1), shape(-1, -1)]);
      g.rotateX(Math.PI / 2);
      return g;
    };
    const flat = (blending: THREE.Blending = THREE.NormalBlending) =>
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, blending, side: THREE.DoubleSide });
    this.brackets = new THREE.Mesh(corners(0.3, 0.095, 0.53), flat());
    this.brackets.renderOrder = 7;
    this.bracketShade = new THREE.Mesh(corners(0.36, 0.165, 0.565), flat());
    this.bracketShade.renderOrder = 6;
    (this.bracketShade.material as THREE.MeshBasicMaterial).color.setRGB(0, 0, 0);
    const fillGeo = new THREE.PlaneGeometry(0.9, 0.9);
    fillGeo.rotateX(-Math.PI / 2);
    this.hoverFill = new THREE.Mesh(fillGeo, flat(THREE.AdditiveBlending));
    this.hoverFill.renderOrder = 5;

    this.group.add(floor, frame, under, this.tiles, this.cores, rings, glow, this.hoverFill, this.bracketShade, this.brackets);
  }

  protected beforeUpdate(dt: number) {
    for (let c = 0; c < this.cells.length; c++) {
      const n = this.cells[c]!.length;
      const w = !n ? 0 : this.critical(c) ? 6.5 : 1.1 + (2.6 * n) / this.cap(c);
      this.phase[c] = this.phase[c]! + w * dt;
    }
  }

  protected home(p: Piece, out: THREE.Vector3) {
    const c = p.cell;
    const n = Math.max(1, p.n);
    const a = this.phase[c]! + (p.slot / n) * Math.PI * 2;
    const rad = n === 1 ? 0 : n === 2 ? 0.17 : n === 3 ? 0.2 : 0.23;
    let x = this.cx(c) + Math.cos(a) * rad;
    let z = this.cz(c) + Math.sin(a) * rad;
    let y = LIFT + this.lift[c]! + (n > 1 ? Math.sin(a) * 0.04 : 0) + Math.sin(this.time * 2.2 + p.seed * 9) * 0.02;
    if (p.mode !== FLY && this.critical(c)) {
      const t = this.time * 61 + p.seed * 30;
      x += Math.sin(t) * 0.012;
      z += Math.cos(t * 1.13) * 0.012;
      y += Math.sin(t * 0.87) * 0.01;
    }
    if (this.winner >= 0 && this.winT > p.hop && this.winT < p.hop + cheerEnd(WIN_WAVE)) {
      y += Math.max(0, Math.sin((this.winT - p.hop) * 5)) * 0.12;
    }
    out.set(x, y, z);
  }

  protected flight(p: Piece, k: number, out: THREE.Vector3) {
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    out.lerpVectors(p.from, p.to, e);
    out.y += Math.sin(k * Math.PI) * 0.16;
  }

  protected drop(_p: Piece, k: number, home: THREE.Vector3, out: THREE.Vector3) {
    out.copy(home);
    out.y += (1 - k) ** 3 * 1.2;
  }

  private spark(o: Partial<Spark> & { x: number; y: number; z: number; max: number }) {
    const s = this.spareSparks.pop() ?? ({} as Spark);
    s.x = o.x;
    s.y = o.y;
    s.z = o.z;
    s.max = o.max;
    s.life = 0;
    s.vx = o.vx ?? 0;
    s.vy = o.vy ?? 0;
    s.vz = o.vz ?? 0;
    s.s0 = o.s0 ?? 0.1;
    s.s1 = o.s1 ?? 0;
    s.r = o.r ?? 1;
    s.g = o.g ?? 1;
    s.b = o.b ?? 1;
    s.i0 = o.i0 ?? 1;
    s.i1 = o.i1 ?? 0;
    s.drag = o.drag ?? 0;
    s.stretch = o.stretch ?? 0;
    this.sparks.push(s);
  }

  /** `col` is one of the palette's colours, which don't change while a ring lives. */
  private ring(x: number, z: number, col: THREE.Color, dur: number, r1: number, i = 1) {
    if (this.rings.length >= MAX_RINGS) this.rings.shift();
    this.rings.push({ x, z, t: 0, dur, r0: 0.08, r1, w: 0.07, col, i });
  }

  private burstFx(x: number, z: number, col: THREE.Color, big: number) {
    this.spark({ x, y: LIFT, z, max: 0.28, s0: 0.25, s1: 1.15 * big, r: 1, g: 1, b: 1, i0: 0.8, i1: 0 });
    this.spark({ x, y: LIFT, z, max: 0.45, s0: 0.5, s1: 1.1 * big, r: col.r, g: col.g, b: col.b, i0: 0.9, i1: 0 });
    this.ring(x, z, col, 0.45, 1.05 * big);
    const count = Math.round((this.lite ? 6 : 10) * big);
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2.2 + Math.random() * 2.6;
      this.spark({
        x, y: LIFT, z, max: 0.3 + Math.random() * 0.25,
        vx: Math.cos(a) * sp, vy: 0.6 + Math.random() * 1.6, vz: Math.sin(a) * sp,
        s0: 0.03, s1: 0.012, r: col.r * 0.7 + 0.3, g: col.g * 0.7 + 0.3, b: col.b * 0.7 + 0.3, i0: 1.2, i1: 0, drag: 4, stretch: 0.045,
      });
    }
  }

  protected onPlace(p: Piece) {
    const c = p.cell;
    this.ring(this.cx(c), this.cz(c), this.palette[p.owner]!, 0.4, 0.55, 0.7);
    this.pulse[c] = 0.8;
  }

  protected onBurst(cell: number, owner: number) {
    this.burstFx(this.cx(cell), this.cz(cell), this.palette[owner]!, 1);
    this.pulse[cell] = 1.2;
    this.lift[cell] = -0.05;
    this.kick(0.07);
  }

  protected onLand(p: Piece) {
    const c = p.cell;
    this.pulse[c] = Math.max(this.pulse[c]!, 0.8);
    this.spark({ x: p.pos.x, y: p.pos.y, z: p.pos.z, max: 0.22, s0: 0.2, s1: 0.6, r: p.col.r, g: p.col.g, b: p.col.b, i0: 0.8, i1: 0 });
  }

  protected onCapture(cell: number, _from: number, to: number) {
    this.ring(this.cx(cell), this.cz(cell), this.palette[to]!, 0.35, 0.5, 0.8);
  }

  protected onTurn(owner: number) {
    this.turnTo.copy(this.palette[owner]!);
  }

  protected onWin(owner: number) {
    this.turnTo.copy(this.palette[owner]!);
    this.eachPiece((p) => {
      p.hop = Math.hypot(p.pos.x, p.pos.z) * 0.12;
    });
  }

  protected onClear() {
    this.sparks.length = 0;
    this.rings.length = 0;
  }

  private glow(x: number, y: number, z: number, dx: number, dy: number, dz: number, size: number, r: number, g: number, b: number) {
    const i = this.glowN;
    if (i >= MAX_GLOW) return;
    this.gPos.setXYZ(i, x, y, z);
    this.gDir.setXYZW(i, dx, dy, dz, size);
    this.gCol.setXYZ(i, r, g, b);
    this.glowN++;
  }

  /** A flickering jagged bolt from a to b. */
  private bolt(a: THREE.Vector3, b: THREE.Vector3, col: THREE.Color, seed: number) {
    const steps = 6;
    let px = a.x, py = a.y, pz = a.z;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const j = k === steps ? 0 : (hash(seed + k * 7.3) - 0.5) * 0.09;
      const x = a.x + dx * t + nx * j;
      const y = a.y + (b.y - a.y) * t + (hash(seed + k * 3.1) - 0.5) * 0.05 * (k === steps ? 0 : 1);
      const z = a.z + dz * t + nz * j;
      const hx = (x - px) / 2, hy = (y - py) / 2, hz = (z - pz) / 2;
      this.glow(px + hx, py + hy, pz + hz, hx, hy, hz, 0.014, col.r * 0.6 + 0.5, col.g * 0.6 + 0.5, col.b * 0.6 + 0.5);
      this.glow(px + hx, py + hy, pz + hz, hx, hy, hz, 0.05, col.r * 0.22, col.g * 0.22, col.b * 0.22);
      px = x;
      py = y;
      pz = z;
    }
  }

  protected render(dt: number) {
    this.timeU.value = this.time;
    this.turnCol.value.lerp(this.turnTo, damp(7, dt));
    const { w, h } = this;
    this.glowN = 0;

    // tiles: lift, heat and the light underneath
    const hov = this.hoverCell;
    let heatChanged = false;
    for (let c = 0; c < w * h; c++) {
      const list = this.cells[c]!;
      const n = list.length;
      const owner = this.owners[c]!;
      const crit = this.critical(c);
      const target = c === hov ? 0.035 : 0;
      this.lift[c] = this.lift[c]! + (target - this.lift[c]!) * damp(12, dt);
      this.pulse[c] = this.pulse[c]! * Math.exp(-dt * 4);
      let win = 0;
      if (this.winner >= 0) {
        const u = this.winT - Math.hypot(this.cx(c), this.cz(c)) * 0.12;
        if (u < cheerEnd(WIN_WAVE)) win = Math.max(0, Math.sin(u * 5)) * 0.6;
      }
      v1.set(this.cx(c), -TILE_H / 2 + this.lift[c]!, this.cz(c));
      this.tiles.setMatrixAt(c, m4.compose(v1, qi, ONE));
      const col = owner >= 0 ? this.palette[owner]! : this.winner >= 0 ? this.palette[this.winner]! : null;
      const flicker = crit ? 0.75 + 0.25 * Math.sin(this.time * 31 + c) : 0;
      const heat = owner >= 0 ? (crit ? 0.8 + 0.2 * flicker : (0.6 * n) / this.cap(c)) : 0;
      if (col) this.tCol.setXYZ(c, col.r, col.g, col.b);
      else this.tCol.setXYZ(c, 0, 0, 0);
      this.tFx.setXY(c, heat, this.pulse[c]! + win);
      const hk = owner >= 0 ? (crit ? 0.55 + 0.25 * flicker : (0.12 * n) / this.cap(c)) : 0;
      const hc = this.palette[Math.max(0, owner)]!;
      // the heat texture goes to the graphics chip only when a texel changed (most idle frames, none do)
      const hr = Math.min(255, hc.r * hk * 255) | 0;
      const hg = Math.min(255, hc.g * hk * 255) | 0;
      const hb = Math.min(255, hc.b * hk * 255) | 0;
      const hk4 = c * 4;
      if (this.heatData[hk4] !== hr || this.heatData[hk4 + 1] !== hg || this.heatData[hk4 + 2] !== hb || this.heatData[hk4 + 3] !== 255) {
        this.heatData[hk4] = hr;
        this.heatData[hk4 + 1] = hg;
        this.heatData[hk4 + 2] = hb;
        this.heatData[hk4 + 3] = 255;
        heatChanged = true;
      }

      // arcs in a full cell
      if (crit && hash(Math.floor(this.time * 22) + c * 13.1) > 0.25) {
        const seed = Math.floor(this.time * 22) * 17.7 + c;
        if (n >= 2) {
          for (let k = 0; k < (n === 2 ? 1 : n); k++) this.bolt(list[k]!.pos, list[(k + 1) % n]!.pos, hc, seed + k * 5.1);
        } else if (n === 1) {
          const a = hash(seed) * Math.PI * 2;
          this.bolt(list[0]!.pos, v1.set(this.cx(c) + Math.cos(a) * 0.3, 0.005, this.cz(c) + Math.sin(a) * 0.3), hc, seed);
        }
      }
    }
    this.tiles.instanceMatrix.needsUpdate = true;
    this.tCol.needsUpdate = true;
    this.tFx.needsUpdate = true;
    if (heatChanged) this.heat.needsUpdate = true;

    // cores and their halos; trails behind the ones in flight
    let k = 0;
    this.eachPiece((p) => {
      if (k >= MAX_CORES) return;
      const crit = p.mode !== FLY && this.critical(p.cell);
      const grow = p.mode === 1 ? Math.min(1, p.t / p.dur) : 1;
      v1.setScalar(0.4 + 0.6 * grow);
      this.cores.setMatrixAt(k, m4.compose(p.pos, qi, v1));
      this.cCol.setXYZ(k, p.col.r, p.col.g, p.col.b);
      this.cFx.setXY(k, p.flash, p.seed);
      const n = this.cells[p.cell]!.length;
      const heat = p.mode === FLY ? 1 : crit ? 1 : n / this.cap(p.cell);
      const i = 0.32 + 0.3 * heat + p.flash * 0.6;
      this.glow(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, 0.36 + 0.14 * heat, p.col.r * i, p.col.g * i, p.col.b * i);
      if (p.mode === FLY) {
        const hx = (p.pos.x - p.prev.x) / 2, hy = (p.pos.y - p.prev.y) / 2, hz = (p.pos.z - p.prev.z) / 2;
        this.glow(p.pos.x - hx, p.pos.y - hy, p.pos.z - hz, hx, hy, hz, 0.07, p.col.r * 0.9 + 0.2, p.col.g * 0.9 + 0.2, p.col.b * 0.9 + 0.2);
        this.spark({ x: p.pos.x, y: p.pos.y, z: p.pos.z, max: 0.24, s0: 0.075, s1: 0.0, r: p.col.r, g: p.col.g, b: p.col.b, i0: 0.75, i1: 0 });
      }
      k++;
    });
    this.cores.count = k;
    upload(this.cores.instanceMatrix, k);
    upload(this.cCol, k);
    upload(this.cFx, k);

    // sparks, flashes and trail bits
    let live = 0;
    for (let j = 0; j < this.sparks.length; j++) {
      const s = this.sparks[j]!;
      s.life += dt;
      if (s.life >= s.max) {
        this.spareSparks.push(s);
        continue;
      }
      const f = Math.exp(-s.drag * dt);
      s.vx *= f;
      s.vz *= f;
      s.vy = s.vy * f - 4 * dt * (s.drag ? 1 : 0);
      s.x += s.vx * dt;
      s.y = Math.max(0.02, s.y + s.vy * dt);
      s.z += s.vz * dt;
      const t = s.life / s.max;
      const size = s.s0 + (s.s1 - s.s0) * t;
      const i = s.i0 + (s.i1 - s.i0) * t;
      const st = s.stretch;
      this.glow(s.x, s.y, s.z, s.vx * st, s.vy * st, s.vz * st, size, s.r * i, s.g * i, s.b * i);
      this.sparks[live++] = s;
    }
    this.sparks.length = live;

    // hover brackets
    const on = hov >= 0;
    this.hoverA += ((on ? 1 : 0) - this.hoverA) * damp(16, dt);
    // a cell they can't play: still easy to see, but grey
    this.hoverGrey += ((this.hoverOk ? 0 : 1) - this.hoverGrey) * damp(16, dt);
    this.brackets.visible = this.hoverFill.visible = this.bracketShade.visible = this.hoverA > 0.01;
    if (on) {
      const beat = Math.sin(this.time * 6);
      const a = this.hoverA;
      this.brackets.position.set(this.cx(hov) + this.shake(), 0.02 + this.lift[hov]!, this.cz(hov));
      this.bracketShade.position.copy(this.brackets.position);
      this.hoverFill.position.copy(this.brackets.position);
      this.brackets.scale.setScalar(1 + 0.04 * beat);
      this.bracketShade.scale.copy(this.brackets.scale);
      const bm = this.brackets.material as THREE.MeshBasicMaterial;
      bm.color.copy(this.palette[this.hoverOwner]!).lerp(WHITE, 0.45).lerp(GREY, this.hoverGrey * 0.8);
      bm.opacity = a;
      (this.bracketShade.material as THREE.MeshBasicMaterial).opacity = a * 0.8;
      (this.hoverFill.material as THREE.MeshBasicMaterial).color.copy(this.palette[this.hoverOwner]!).multiplyScalar(a * (1 - this.hoverGrey) * (0.22 + 0.06 * beat));
    }

    // rings
    let r = 0;
    let kept = 0;
    for (const g of this.rings) if ((g.t += dt) < g.dur) this.rings[kept++] = g;
    this.rings.length = kept;
    for (const g of this.rings) {
      const t = g.t / g.dur;
      const e = 1 - (1 - t) ** 3;
      this.rA.setXYZW(r, g.x, g.z, g.w * (1 - 0.5 * t), g.r0 + (g.r1 - g.r0) * e);
      this.rC.setXYZW(r, g.col.r, g.col.g, g.col.b, g.i * (1 - t) * 1.4);
      r++;
    }
    this.ringGeo.instanceCount = r;
    upload(this.rA, r);
    upload(this.rC, r);

    this.glowGeo.instanceCount = this.glowN;
    upload(this.gPos, this.glowN);
    upload(this.gDir, this.glowN);
    upload(this.gCol, this.glowN);
  }
}
