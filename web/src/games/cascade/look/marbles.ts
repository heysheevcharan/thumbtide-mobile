// Look 1: glass marbles in a walnut board. Each cell is a carved pit. A full pit rattles, then its marbles
// hop out in arcs into the neighbouring pits, and the marbles they land among take on their colour.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { AREA_UV, areaUniform, bakeGround, type Area } from "./bake.ts";
import { NOISE, SDF, WORLD_VS } from "./glsl.ts";
import { FLY, PieceLook, bounceOut, cheerEnd, damp, hash, upload, type CameraSpec, type LookInfo, type Piece } from "./look.ts";

const R = 0.175; // marble radius
const PIT_R = 0.435;
const PIT_D = 0.17;
const MARGIN = 0.66; // wood around the outer pits
const CORNER = 0.14;
const THICK = 0.4;
const MAX = 900;
const LIGHT = new THREE.Vector3(-0.45, 1, -0.6).normalize(); // the lamp: above, behind and to the left

/** Marble spots inside a pit, by how many share it. */
const LAYOUT: [number, number][][] = [
  [],
  [[0, 0]],
  [[-0.182, 0], [0.182, 0]],
  [[0, -0.208], [0.18, 0.104], [-0.18, 0.104]],
  [[-0.19, -0.19], [0.19, -0.19], [0.19, 0.19], [-0.19, 0.19]],
];
function spot(n: number, slot: number): [number, number] {
  const row = LAYOUT[n];
  if (row?.[slot]) return row[slot]!;
  const a = (slot / n) * Math.PI * 2;
  return [Math.cos(a) * 0.24, Math.sin(a) * 0.24];
}

// The carved surface, matching surface() in the code below.
const PIT_H = /* glsl */ `
uniform vec2 uHalf;
float pitH(vec2 p) {
  vec2 g = clamp(floor(p + uHalf), vec2(0.0), uHalf * 2.0 - 1.0);
  float u = length(p - (g - uHalf + 0.5)) / ${PIT_R.toFixed(3)};
  if (u >= 1.0) return 0.0;
  float q = 1.0 - u * u;
  return -${PIT_D.toFixed(3)} * q * q;
}
`;

const WALNUT = /* glsl */ `
${NOISE}
vec3 walnut(vec3 p) {
  float warp = fbm(vec2(p.x * 0.22, p.z * 1.2)) * 2.4;
  float ring = fract(p.z * 2.4 + warp + p.y * 0.9);
  float band = smoothstep(0.0, 0.35, ring) * (1.0 - smoothstep(0.55, 1.0, ring));
  float fiber = vnoise(vec2(p.x * 3.0, p.z * 70.0 + warp * 5.0));
  vec3 c = mix(vec3(0.19, 0.105, 0.055), vec3(0.33, 0.185, 0.095), band);
  c = mix(c, vec3(0.46, 0.28, 0.14), smoothstep(0.6, 0.95, fbm(p.xz * vec2(0.5, 2.6) + 7.0)) * 0.45);
  return c * (0.86 + 0.24 * fiber);
}
`;

// The wood grain of the carved top, baked once: it never changes.
const WOOD_BAKE = /* glsl */ `gl_FragColor = vec4(walnut(vec3(p.x, pitH(p), p.y)), 1.0);`;

// TOP: the carved top, with its grain from the baked texture. Otherwise the slab's edges and sides, whose flat
// top is hidden under the carved top (left out, or it would cover the pits).
const BOARD_FS = /* glsl */ `
uniform vec3 uTurn;
uniform float uPulse;
uniform vec4 uHover;
uniform vec3 uHoverCol;
uniform vec3 uLight;
uniform sampler2D uWood;
uniform vec4 uWoodArea;
varying vec3 vW;
varying vec3 vN;
${PIT_H}
${SDF}
${AREA_UV}
#ifndef TOP
${WALNUT}
#endif
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
#ifdef TOP
  float top = 1.0;
  // take the normal from the surface itself so the pit rims stay smooth
  float e = 0.004;
  float hx = pitH(vW.xz + vec2(e, 0.0)) - pitH(vW.xz - vec2(e, 0.0));
  float hz = pitH(vW.xz + vec2(0.0, e)) - pitH(vW.xz - vec2(0.0, e));
  n = normalize(vec3(-hx, 2.0 * e, -hz));
  float depth = clamp(-pitH(vW.xz) / ${PIT_D.toFixed(3)}, 0.0, 1.0);
  vec3 c = texture2D(uWood, areaUv(vW.xz, uWoodArea)).rgb;
#else
  float top = step(0.5, n.y);
  vec2 inner = uHalf + ${(MARGIN - CORNER - 0.01).toFixed(3)};
  if (top > 0.5 && abs(vW.x) < inner.x && abs(vW.z) < inner.y) discard;
  float depth = 0.0;
  vec3 c = walnut(vW);
#endif
  c *= mix(1.0, 0.5, depth);
  c *= mix(0.62, 1.0, top);


  float ndl = max(dot(n, uLight), 0.0);
  vec3 h = normalize(uLight + v);
  float nh = max(dot(n, h), 0.0);
  vec3 lit = c * (0.3 + 0.85 * ndl);
  lit += vec3(1.0, 0.9, 0.75) * (pow(nh, 70.0) * 0.4 * (1.0 - depth * 0.6) + pow(nh, 8.0) * 0.05);
  lit += vec3(0.25, 0.2, 0.16) * pow(1.0 - max(dot(n, v), 0.0), 4.0) * 0.3;

  // lamp light falls off toward the edges
  lit *= 1.0 - 0.38 * smoothstep(0.2, 1.25, length(vW.xz / (uHalf + 1.0)));
#ifdef TOP

  // enamel inlay round the pits: the colour of whoever's turn it is
  float sd = sdRoundRect(vW.xz, uHalf + 0.27, 0.32);
  float aa = fwidth(sd);
  float inlay = (1.0 - smoothstep(0.02 - aa, 0.02 + aa, abs(sd))) * step(-0.005, vW.y) * top;
  vec3 enamel = uTurn * (0.62 + 0.3 * ndl) + vec3(1.0) * pow(nh, 80.0) * 0.25 + uTurn * uPulse * 0.35;
  lit = mix(lit, enamel, inlay);
  lit += uTurn * exp(-abs(sd) * 28.0) * 0.035 * (1.0 + uPulse) * top;

  // the pit being pointed at: a pool of the player's colour with a ring round the rim
  if (uHover.z > 0.001) {
    float r = length(vW.xz - uHover.xy);
    float ring = exp(-pow((r - ${PIT_R.toFixed(3)}) / 0.026, 2.0));
    lit += uHoverCol * (exp(-r * r * 9.0) * 0.32 + ring * 0.85) * uHover.z * top;
  }
#endif
  gl_FragColor = vec4(lit, 1.0);
}
`;

const TABLE_BAKE = /* glsl */ `gl_FragColor = vec4(fbm(p * 3.0), 0.0, 0.0, 1.0);`;
const TABLE_FS = /* glsl */ `
uniform vec2 uHalf;
uniform sampler2D uGrain;
uniform vec4 uGrainArea;
varying vec3 vW;
varying vec3 vN;
${SDF}
${AREA_UV}
void main() {
  vec2 p = vW.xz;
  vec3 c = vec3(0.075, 0.058, 0.047) * (0.9 + 0.2 * texture2D(uGrain, areaUv(p, uGrainArea)).r);
  float pool = exp(-dot(p / (uHalf + 3.0), p / (uHalf + 3.0)) * 1.6);
  c *= 0.35 + 0.9 * pool;
  float sd = sdRoundRect(p - vec2(0.22, 0.3), uHalf + 0.62, 0.3);
  c *= 1.0 - 0.8 * exp(-max(sd, 0.0) * 3.2);
  gl_FragColor = vec4(c, 1.0);
}
`;

const MARBLE_VS = /* glsl */ `
attribute vec3 aCol;
attribute vec2 aFx;
varying vec3 vN;
varying vec3 vW;
varying vec3 vO;
varying vec3 vVo;
varying vec3 vCol;
varying vec2 vFx;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = w.xyz;
  mat3 r = mat3(instanceMatrix);
  vN = normalize(mat3(modelMatrix) * (r * normal));
  vO = position / ${R.toFixed(3)};
  vVo = transpose(r) * (cameraPosition - w.xyz);
  vCol = aCol;
  vFx = aFx;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const MARBLE_FS = /* glsl */ `
uniform vec3 uLight;
varying vec3 vN;
varying vec3 vW;
varying vec3 vO;
varying vec3 vVo;
varying vec3 vCol;
varying vec2 vFx;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  vec3 col = vCol;
  // glass body: deep in the middle, glowing where the lamp light gathers on the far side
  float through = pow(clamp(dot(n, normalize(-uLight + v * 0.7)) * 0.5 + 0.5, 0.0, 1.0), 2.2);
  vec3 c = mix(col * 0.2, col * 1.25 + 0.05, through);
  // a twisted cat's-eye vane inside, seen through the glass
  vec3 q = vO - normalize(vVo) * 0.5;
  float twist = q.y * 2.4 + vFx.y * 6.283;
  float vane = 0.0;
  for (int k = 0; k < 3; k++) {
    float a = twist + float(k) * 2.094;
    float d = abs(dot(q.xz, vec2(cos(a), sin(a))));
    vane = max(vane, (1.0 - smoothstep(0.03, 0.15, d)) * (1.0 - smoothstep(0.25, 0.9, length(q))));
  }
  vec3 vaneCol = mix(col * 1.55 + 0.1, vec3(1.0), 0.2);
  c = mix(c, vaneCol * (0.55 + 0.5 * through), vane * 0.8);
  // the room reflected in the glass, and the lamp's highlight
  vec3 r = reflect(-v, n);
  vec3 env = mix(vec3(0.04, 0.03, 0.025), vec3(0.85, 0.74, 0.6), smoothstep(0.2, 0.95, r.y));
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  c = mix(c, env, fres * 0.65);
  float rl = max(dot(r, uLight), 0.0);
  c += vec3(1.0, 0.96, 0.88) * (pow(rl, 260.0) * 2.4 + pow(rl, 16.0) * 0.1);
  c *= 0.55 + 0.45 * smoothstep(-0.95, 0.1, n.y);
  c += col * vFx.x * 0.9;
  gl_FragColor = vec4(c, 1.0);
}
`;

const DECAL_VS = /* glsl */ `
attribute vec4 aD;
varying vec2 vUv;
varying vec4 vD;
void main() {
  vUv = uv;
  vD = aD;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const SHADOW_FS = /* glsl */ `
varying vec2 vUv;
varying vec4 vD;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  gl_FragColor = vec4(0.03, 0.015, 0.0, vD.a * pow(clamp(1.0 - r, 0.0, 1.0), 1.5));
}
`;
const GLINT_FS = /* glsl */ `
varying vec2 vUv;
varying vec4 vD;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  gl_FragColor = vec4(vD.rgb, vD.a * pow(clamp(1.0 - r, 0.0, 1.0), 2.2));
}
`;

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const m4 = new THREE.Matrix4();
const q4 = new THREE.Quaternion();
const qr = new THREE.Quaternion();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const axis = new THREE.Vector3();

export class MarblesLook extends PieceLook {
  readonly info: LookInfo = {
    id: "marbles",
    name: "Marbles",
    blurb: "Glass marbles in a walnut board. A full pit rattles, then its marbles hop into the pits next door and turn the marbles there.",
    colors: ["#e0283f", "#2a6ee6", "#f2a516", "#1e9e5a", "#8f45d6", "#f06722", "#e2468f", "#16b0ae"],
  };
  readonly background = 0x0b0907;
  readonly camera: CameraSpec = { tilt: 54, fov: 30, pad: 0.72 };
  protected dropTime = 0.55;

  private angle = new Float32Array(0);
  private boardMat!: THREE.ShaderMaterial;
  private tableMat!: THREE.ShaderMaterial;
  private woodArea: Area = { x0: 0, z0: 0, x1: 1, z1: 1 };
  private tableArea: Area = { x0: 0, z0: 0, x1: 1, z1: 1 };
  /** Resting heights by cell and spot: working them out takes a few dozen samples of the surface. */
  private restCache = new Map<number, number>();
  private marbles!: THREE.InstancedMesh;
  private shadows!: THREE.InstancedMesh;
  private glints!: THREE.InstancedMesh;
  private aCol!: THREE.InstancedBufferAttribute;
  private aFx!: THREE.InstancedBufferAttribute;
  private aShadow!: THREE.InstancedBufferAttribute;
  private aGlint!: THREE.InstancedBufferAttribute;
  private turnTo = new THREE.Color();
  private pulse = 0;
  private hoverA = 0;
  private hoverAt = new THREE.Vector2();

  /** Height of the board's top at (x, z): flat wood with a bowl at each cell. */
  private surface(x: number, z: number) {
    const ix = Math.min(this.w - 1, Math.max(0, Math.floor(x + this.w / 2)));
    const iz = Math.min(this.h - 1, Math.max(0, Math.floor(z + this.h / 2)));
    const dx = x - (ix - this.w / 2 + 0.5);
    const dz = z - (iz - this.h / 2 + 0.5);
    const u = Math.sqrt(dx * dx + dz * dz) / PIT_R;
    if (u >= 1) return 0;
    const q = 1 - u * u;
    return -PIT_D * q * q;
  }

  /** Centre height of a marble resting at (x, z). */
  private restY(x: number, z: number) {
    let y = this.surface(x, z) + R;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      for (const f of [0.5, 0.9]) {
        const d = R * f;
        const s = this.surface(x + Math.cos(a) * d, z + Math.sin(a) * d) + Math.sqrt(R * R - d * d);
        if (s > y) y = s;
      }
    }
    return y;
  }

  protected buildScene() {
    const { w, h } = this;
    this.angle = Float32Array.from({ length: w * h }, (_, i) => hash(i * 3.7 + 1) * Math.PI * 2);
    this.restCache.clear();
    const half = new THREE.Vector2(w / 2, h / 2);
    const light = { value: LIGHT };
    // Top: flat wood with a bowl carved at every cell. It covers the slab's flat top exactly.
    const tw = w + 2 * MARGIN - 2 * CORNER;
    const th = h + 2 * MARGIN - 2 * CORNER;
    this.woodArea = { x0: -tw / 2, z0: -th / 2, x1: tw / 2, z1: th / 2 };
    this.tableArea = { x0: -w / 2 - 14, z0: -h / 2 - 14, x1: w / 2 + 14, z1: h / 2 + 14 };

    const uniforms = {
      uTurn: { value: new THREE.Color(this.palette[0]!) },
      uPulse: { value: 0 },
      uHover: { value: new THREE.Vector4() },
      uHoverCol: { value: new THREE.Color() },
      uHalf: { value: half },
      uLight: light,
      uWood: { value: null as THREE.Texture | null },
      uWoodArea: { value: areaUniform(this.woodArea) },
    };
    this.boardMat = new THREE.ShaderMaterial({ uniforms, vertexShader: WORLD_VS, fragmentShader: BOARD_FS, defines: { TOP: 1 } });
    const slabMat = new THREE.ShaderMaterial({ uniforms, vertexShader: WORLD_VS, fragmentShader: BOARD_FS });
    const per = this.lite ? 16 : 26;
    const topGeo = new THREE.PlaneGeometry(tw, th, Math.ceil(tw * per), Math.ceil(th * per));
    topGeo.rotateX(-Math.PI / 2);
    const pos = topGeo.attributes.position!;
    for (let k = 0; k < pos.count; k++) pos.setY(k, this.surface(pos.getX(k), pos.getZ(k)));
    topGeo.computeVertexNormals();
    const top = new THREE.Mesh(topGeo, this.boardMat);
    const slab = new THREE.Mesh(new RoundedBoxGeometry(w + 2 * MARGIN, THICK, h + 2 * MARGIN, 4, CORNER), slabMat);
    slab.position.y = -THICK / 2 - 0.003;
    slab.renderOrder = 1; // after the top, so the hidden parts fail the depth test early
    this.tableMat = new THREE.ShaderMaterial({
      uniforms: { uHalf: { value: half }, uGrain: { value: null }, uGrainArea: { value: areaUniform(this.tableArea) } },
      vertexShader: WORLD_VS,
      fragmentShader: TABLE_FS,
    });
    const table = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), this.tableMat);
    table.position.y = -THICK;
    table.renderOrder = 1;
    this.group.add(top, slab, table);

    // Marbles, plus a soft shadow and a coloured glint of focused light under each.
    const sphere = new THREE.SphereGeometry(R, this.lite ? 22 : 32, this.lite ? 14 : 22);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aFx = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2).setUsage(THREE.DynamicDrawUsage);
    sphere.setAttribute("aCol", this.aCol);
    sphere.setAttribute("aFx", this.aFx);
    this.marbles = new THREE.InstancedMesh(
      sphere,
      new THREE.ShaderMaterial({ uniforms: { uLight: light }, vertexShader: MARBLE_VS, fragmentShader: MARBLE_FS }),
      MAX,
    );
    this.marbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.marbles.frustumCulled = false;
    this.marbles.renderOrder = 3;

    const decal = (fs: string, blending: THREE.Blending, order: number) => {
      const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("aD", a);
      const mesh = new THREE.InstancedMesh(
        g,
        new THREE.ShaderMaterial({ vertexShader: DECAL_VS, fragmentShader: fs, transparent: true, depthWrite: false, blending }),
        MAX,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      return { mesh, a };
    };
    const sh = decal(SHADOW_FS, THREE.NormalBlending, 1);
    const gl = decal(GLINT_FS, THREE.AdditiveBlending, 2);
    this.shadows = sh.mesh;
    this.aShadow = sh.a;
    this.glints = gl.mesh;
    this.aGlint = gl.a;
    this.group.add(this.shadows, this.glints, this.marbles);
  }

  protected bakeScene(renderer: THREE.WebGLRenderer) {
    const wood = bakeGround(renderer, this.woodArea, this.lite ? 96 : 128, `${PIT_H}\n${WALNUT}`, WOOD_BAKE, {
      uHalf: this.boardMat.uniforms.uHalf!,
    });
    const grain = bakeGround(renderer, this.tableArea, this.lite ? 16 : 24, NOISE, TABLE_BAKE);
    this.targets.push(wood, grain);
    this.boardMat.uniforms.uWood!.value = wood.texture;
    this.tableMat.uniforms.uGrain!.value = grain.texture;
  }

  protected home(p: Piece, out: THREE.Vector3) {
    const c = p.cell;
    const [ox, oz] = spot(p.n, p.slot);
    const a = this.angle[c]!;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let x = this.cx(c) + ox * ca - oz * sa;
    let z = this.cz(c) + ox * sa + oz * ca;
    const key = p.n < 16 && p.slot < 16 ? (c * 16 + p.n) * 16 + p.slot : -1;
    let y = key >= 0 ? this.restCache.get(key) : undefined;
    if (y === undefined) {
      y = this.restY(x, z);
      if (key >= 0) this.restCache.set(key, y);
    }
    const rattle = p.mode !== FLY && this.critical(c);
    if (rattle) {
      const t = this.time;
      const s = p.seed * 50;
      const env = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.3 + s));
      x += Math.sin(t * 43 + s) * 0.011 * env;
      z += Math.cos(t * 37 + s * 1.3) * 0.011 * env;
    }
    if (rattle) y += Math.max(0, Math.sin(this.time * 7 + p.seed * 40)) ** 12 * 0.03;
    if (p.mode !== FLY) y += p.jolt * Math.abs(Math.sin(p.age * 17));
    if (this.winner >= 0 && this.winT > p.hop && this.winT < p.hop + cheerEnd(1.9)) {
      const u = (this.winT - p.hop) % 1.9;
      if (u < 0.55) y += Math.sin((u / 0.55) * Math.PI) * 0.42;
    }
    out.set(x, y, z);
  }

  protected flight(p: Piece, k: number, out: THREE.Vector3) {
    out.lerpVectors(p.from, p.to, k);
    out.y += 4 * k * (1 - k) * (0.5 + 0.35 * p.seed);
  }

  protected drop(_p: Piece, k: number, home: THREE.Vector3, out: THREE.Vector3) {
    out.copy(home);
    out.y += (1 - bounceOut(k)) * 1.3;
  }

  protected onBurst() {
    this.kick(0.05);
  }

  protected onLand(p: Piece) {
    p.jolt = 0.08;
    for (const o of this.cells[p.cell]!) if (o !== p) o.jolt = Math.max(o.jolt, 0.035);
    this.kick(0.015);
  }

  protected onTurn(owner: number) {
    this.turnTo.copy(this.palette[owner]!);
    this.pulse = 1;
  }

  protected onWin(owner: number) {
    this.turnTo.copy(this.palette[owner]!);
    this.eachPiece((p) => {
      p.hop = Math.hypot(p.pos.x, p.pos.z) * 0.1;
    });
  }

  protected render(dt: number) {
    const u = this.boardMat.uniforms;
    (u.uTurn!.value as THREE.Color).lerp(this.turnTo, damp(8, dt));
    this.pulse *= Math.exp(-dt * 2.5);
    u.uPulse!.value = this.pulse;
    const on = this.hoverCell >= 0;
    if (on) this.hoverAt.set(this.cx(this.hoverCell) + this.shake(), this.cz(this.hoverCell));
    this.hoverA += ((on ? (this.hoverOk ? 1 : 0.4) : 0) - this.hoverA) * damp(14, dt);
    (u.uHover!.value as THREE.Vector4).set(this.hoverAt.x, this.hoverAt.y, this.hoverA, 0);
    if (on) (u.uHoverCol!.value as THREE.Color).copy(this.palette[this.hoverOwner]!);

    const sx = -LIGHT.x / LIGHT.y;
    const sz = -LIGHT.z / LIGHT.y;
    let n = 0;
    this.eachPiece((p) => {
      if (n >= MAX) return;
      // roll with the distance travelled; spin a little in the air
      const dx = p.pos.x - p.prev.x;
      const dz = p.pos.z - p.prev.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-5) {
        axis.set(dz / d, 0, -dx / d);
        qr.setFromAxisAngle(axis, d / R);
        p.quat.premultiply(qr);
      }
      this.marbles.setMatrixAt(n, m4.compose(p.pos, p.quat, ONE));
      this.aCol.setXYZ(n, p.col.r, p.col.g, p.col.b);
      this.aFx.setXY(n, p.flash, p.seed);

      // shadow and glint land on the board below, pushed away from the lamp
      const ground = this.surface(p.pos.x, p.pos.z);
      const lift = Math.max(0, p.pos.y - R - ground);
      const off = p.pos.y - ground;
      const gx = p.pos.x + sx * off;
      const gz = p.pos.z + sz * off;
      const gy = this.surface(gx, gz);
      v1.set(this.surface(gx - 0.02, gz) - this.surface(gx + 0.02, gz), 0.04, this.surface(gx, gz - 0.02) - this.surface(gx, gz + 0.02)).normalize();
      q4.setFromUnitVectors(UP, v1);
      const s = R * 2.4 * (1 + lift * 1.4);
      v2.set(gx, gy, gz).addScaledVector(v1, 0.018);
      this.shadows.setMatrixAt(n, m4.compose(v2, q4, axis.set(s, 1, s)));
      this.aShadow.setXYZW(n, 0, 0, 0, 0.62 / (1 + lift * 4));
      const gs = R * 1.15;
      v2.set(gx + sx * R * 0.25, gy, gz + sz * R * 0.25).addScaledVector(v1, 0.02);
      this.glints.setMatrixAt(n, m4.compose(v2, q4, axis.set(gs, 1, gs)));
      this.aGlint.setXYZW(n, p.col.r * 1.3 + 0.1, p.col.g * 1.3 + 0.1, p.col.b * 1.3 + 0.1, 0.55 / (1 + lift * 6));
      n++;
    });
    for (const mesh of [this.marbles, this.shadows, this.glints]) {
      mesh.count = n;
      upload(mesh.instanceMatrix, n);
    }
    for (const a of [this.aCol, this.aFx, this.aShadow, this.aGlint]) upload(a, n);
  }
}
