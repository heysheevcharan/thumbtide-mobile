// Look 3: a culture dish on a light table. Each cell holds a colony; its nuclei are the pieces. A colony grows
// with every nucleus, bulges toward its neighbours when it's full, then divides: daughters slide into the cells
// around it and stain whatever colony they reach in their own colour.
import * as THREE from "three";
import { AREA_UV, areaUniform, bakeGround, type Area } from "./bake.ts";
import { NOISE, SDF, WORLD_VS } from "./glsl.ts";
import { CHEER_S, FLY, PieceLook, damp, easeInOut, hash, smooth, upload, type CameraSpec, type LookInfo, type Piece } from "./look.ts";

const PAD = 0.42; // agar beyond the outer cells
const CORNER = 0.34;
const WALL = 0.07;
const WALL_H = 0.15;
const MAX_DAUGHTERS = 900;
const LIGHT = new THREE.Vector3(-0.3, 1, -0.45).normalize();
const radiusFor = (n: number) => (n ? 0.19 + 0.068 * Math.min(n, 4) : 0);

// The agar's mottling and grain never change, so they're baked once (see bakeScene).
const AGAR_NOISE = /* glsl */ `gl_FragColor = vec4(fbm(p * 1.3), vnoise(p * 15.0), 0.0, 1.0);`;
const BENCH_NOISE = /* glsl */ `gl_FragColor = vec4(vnoise(p * 6.0), 0.0, 0.0, 1.0);`;

const AGAR_FS = /* glsl */ `
uniform vec3 uTurn;
uniform vec2 uHalf;
uniform vec4 uHover;
uniform vec3 uHoverCol;
uniform sampler2D uStain;
uniform sampler2D uNoise;
uniform vec4 uNoiseArea;
uniform vec3 uLight;
varying vec3 vW;
varying vec3 vN;
${SDF}
${AREA_UV}
void main() {
  vec2 p = vW.xz;
  float edge = sdRoundRect(p, uHalf + ${PAD.toFixed(2)}, ${CORNER.toFixed(2)});
  if (edge > 0.0) discard;
  vec3 c = vec3(0.97, 0.91, 0.77);
  vec2 nz = texture2D(uNoise, areaUv(p, uNoiseArea)).rg;
  c *= 0.96 + 0.06 * nz.r + 0.02 * nz.g;
  c *= 1.04 - 0.1 * smoothstep(0.3, 1.1, length(p / (uHalf + 0.6)));
  // each colony stains the agar under it a little
  vec4 st = texture2D(uStain, (p + uHalf) / (uHalf * 2.0));
  c = mix(c, c * (st.rgb / max(st.a, 0.001)) * 1.1, st.a * 0.14);

  // counting grid: triple lines on every cell edge, faint quarters inside, inked in the colour of whoever's turn it is
  vec2 g = p + uHalf;
  float inside = step(-0.05, g.x) * step(g.x, uHalf.x * 2.0 + 0.05) * step(-0.05, g.y) * step(g.y, uHalf.y * 2.0 + 0.05);
  float aa = length(fwidth(g));
  vec2 f = abs(fract(g + 0.5) - 0.5);
  float d = min(f.x, f.y);
  float mainLine = 1.0 - smoothstep(0.005, 0.005 + aa, d);
  float side = 1.0 - smoothstep(0.0025, 0.0025 + aa, abs(d - 0.028));
  vec2 fq = abs(fract(g * 4.0 + 0.5) - 0.5) / 4.0;
  float quarter = 1.0 - smoothstep(0.0015, 0.0015 + aa, min(fq.x, fq.y));
  vec3 ink = mix(vec3(0.42, 0.3, 0.18), uTurn * 0.8, 0.8);
  c = mix(c, vec3(0.5, 0.38, 0.25), quarter * 0.09 * inside);
  c = mix(c, ink, (mainLine * 0.6 + side * 0.3) * inside);

  // meniscus where the agar meets the glass
  c += vec3(0.06, 0.05, 0.03) * exp(edge * 14.0);
  c *= 1.0 - 0.25 * exp(edge * 60.0);
  // a soft sheen of the lamp on the wet surface
  vec3 v = normalize(cameraPosition - vW);
  c += vec3(1.0, 0.98, 0.95) * pow(max(dot(vec3(0.0, 1.0, 0.0), normalize(uLight + v)), 0.0), 40.0) * 0.04;

  // reticle on the cell being pointed at
  if (uHover.z > 0.001) {
    vec2 q = p - uHover.xy;
    float r = length(q);
    float ring = 1.0 - smoothstep(0.02, 0.02 + aa, abs(r - 0.45));
    float tick = (1.0 - smoothstep(0.016, 0.016 + aa, abs(q.x))) * (1.0 - smoothstep(0.06, 0.06 + aa, abs(abs(q.y) - 0.45)));
    tick = max(tick, (1.0 - smoothstep(0.016, 0.016 + aa, abs(q.y))) * (1.0 - smoothstep(0.06, 0.06 + aa, abs(abs(q.x) - 0.45))));
    c = mix(c, c * mix(vec3(1.0), uHoverCol, 0.45), (1.0 - smoothstep(0.0, 0.47, r)) * uHover.z * 0.7);
    c = mix(c, uHoverCol * 0.85, max(ring, tick) * uHover.z);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

const GLASS_FS = /* glsl */ `
uniform vec3 uLight;
varying vec3 vW;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float fres = pow(1.0 - abs(dot(n, v)), 2.0);
  float spec = pow(max(dot(reflect(-uLight, n), v), 0.0), 50.0);
  float topEdge = smoothstep(${(WALL_H - 0.02).toFixed(3)}, ${WALL_H.toFixed(3)}, vW.y);
  vec3 c = vec3(0.93, 0.97, 1.0);
  float a = 0.1 + 0.4 * fres + spec * 0.3 + topEdge * 0.3;
  gl_FragColor = vec4(c + spec * 0.15, clamp(a, 0.0, 0.85));
}
`;

const BENCH_FS = /* glsl */ `
uniform vec2 uHalf;
uniform sampler2D uNoise;
uniform vec4 uNoiseArea;
varying vec3 vW;
varying vec3 vN;
${SDF}
${AREA_UV}
void main() {
  vec2 p = vW.xz;
  vec3 c = vec3(0.83, 0.81, 0.77) * (0.97 + 0.04 * texture2D(uNoise, areaUv(p, uNoiseArea)).r);
  float panel = sdRoundRect(p, uHalf + 1.1, 0.5);
  c = mix(c, vec3(0.93, 0.92, 0.89), 1.0 - smoothstep(-0.05, 0.05, panel));
  c *= 1.0 - 0.35 * smoothstep(0.4, 1.6, length(p / (uHalf + 2.5)));
  float sd = sdRoundRect(p - vec2(0.12, 0.2), uHalf + ${(PAD + WALL).toFixed(2)}, ${CORNER.toFixed(2)});
  c *= 1.0 - 0.22 * exp(-max(sd, 0.0) * 6.0);
  gl_FragColor = vec4(c, 1.0);
}
`;

// Shading shared by colonies and daughters: translucent cytoplasm, dark membrane at the edge, nuclei inside.
const CELL_SHADE = /* glsl */ `
vec4 shadeCell(vec3 n, vec3 v, vec2 lp, vec3 col, float nuc, float nucleolus, float seed, vec3 light) {
  float facing = max(dot(n, v), 0.0);
  float rim = 1.0 - facing;
  float gran = vnoise(lp * 7.0 + seed * 10.0) * 0.6 + vnoise(lp * 19.0 + seed) * 0.4;
  vec3 cyto = mix(vec3(0.97, 0.94, 0.86), col, 0.68) * (0.9 + 0.15 * gran);
  vec3 dark = col * 0.42;
  vec3 c = mix(cyto, mix(col * 0.78, dark, 0.45), nuc * 0.88);
  c = mix(c, dark * 0.7, nucleolus * 0.8);
  float mem = smoothstep(0.35, 0.8, rim);
  c = mix(c, col * 0.3, mem * 0.9);
  vec3 h = normalize(light + v);
  float nh = max(dot(n, h), 0.0);
  c += vec3(1.0) * (pow(nh, 40.0) * 0.1 + pow(nh, 8.0) * 0.02);
  return vec4(c, mix(0.74, 0.96, max(mem, nuc * 0.5)));
}
`;

// All the colonies are drawn together; each one's size, shape, colours and nuclei come in per instance.
const COLONY_VS = /* glsl */ `
attribute vec3 aAt;
attribute vec4 aShape; // radius, wobble, seed, how far a new colour has spread
attribute vec4 aLobe;
attribute vec3 aCol;
attribute vec3 aOld;
attribute vec2 aFrom; // the side a new colour comes in from
attribute vec4 aNuc0;
attribute vec4 aNuc1;
attribute vec4 aNuc2;
attribute vec4 aNuc3;
uniform float uTime;
varying vec3 vW;
varying vec3 vN;
varying vec3 vLocal;
varying vec4 vShape;
varying vec3 vCol;
varying vec3 vOld;
varying vec2 vFrom;
varying vec4 vNuc0;
varying vec4 vNuc1;
varying vec4 vNuc2;
varying vec4 vNuc3;
float lobeAt(float th) {
  float c = cos(th);
  float s = sin(th);
  return aLobe.x * pow(max(c, 0.0), 6.0) + aLobe.y * pow(max(-c, 0.0), 6.0) + aLobe.z * pow(max(s, 0.0), 6.0) + aLobe.w * pow(max(-s, 0.0), 6.0);
}
vec3 shape(vec3 d) {
  float th = atan(d.z, d.x);
  float wob = sin(th * 3.0 + uTime * 1.3 + aShape.z * 6.0) * 0.022 + sin(th * 5.0 - uTime * 1.9 + aShape.z * 3.0) * 0.01;
  wob *= 1.0 + aShape.y * 1.3;
  float lobe = lobeAt(th);
  float rr = aShape.x * (1.0 + wob + lobe);
  float hh = aShape.x * 0.5 * (1.0 - min(lobe, 1.0) * 0.3);
  float y = d.y > 0.0 ? d.y * hh : d.y * 0.01;
  return vec3(d.x * rr, y, d.z * rr);
}
void main() {
  vec3 d = normalize(position);
  vec3 p = shape(d);
  vec3 t1 = normalize(cross(d, abs(d.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(d, t1);
  vec3 p1 = shape(normalize(d + t1 * 0.03));
  vec3 p2 = shape(normalize(d + t2 * 0.03));
  vec3 nrm = normalize(cross(p1 - p, p2 - p));
  if (dot(nrm, d) < 0.0) nrm = -nrm;
  vLocal = p;
  vec4 w = modelMatrix * vec4(p + aAt, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * nrm);
  vShape = aShape;
  vCol = aCol;
  vOld = aOld;
  vFrom = aFrom;
  vNuc0 = aNuc0;
  vNuc1 = aNuc1;
  vNuc2 = aNuc2;
  vNuc3 = aNuc3;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const COLONY_FS = /* glsl */ `
uniform vec3 uLight;
varying vec3 vW;
varying vec3 vN;
varying vec3 vLocal;
varying vec4 vShape;
varying vec3 vCol;
varying vec3 vOld;
varying vec2 vFrom;
varying vec4 vNuc0;
varying vec4 vNuc1;
varying vec4 vNuc2;
varying vec4 vNuc3;
${NOISE}
${CELL_SHADE}
void nucleus(vec4 q, inout float nuc, inout float nucleolus) {
  float d = length(vLocal.xz - q.xy) / max(q.z, 0.001);
  nuc = max(nuc, (1.0 - smoothstep(0.75, 1.0, d)) * q.w);
  nucleolus = max(nucleolus, (1.0 - smoothstep(0.18, 0.32, d)) * q.w);
}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  // a new owner's colour spreads from the side the daughter came in
  vec2 lp = vLocal.xz / max(vShape.x, 0.05);
  float s = clamp(dot(lp, vFrom) * 0.5 + 0.5, 0.0, 1.0);
  float edge = 1.0 - vShape.w * 1.4;
  vec3 col = mix(vOld, vCol, smoothstep(edge - 0.12, edge + 0.12, s));
  float nuc = 0.0;
  float nucleolus = 0.0;
  nucleus(vNuc0, nuc, nucleolus);
  nucleus(vNuc1, nuc, nucleolus);
  nucleus(vNuc2, nuc, nucleolus);
  nucleus(vNuc3, nuc, nucleolus);
  gl_FragColor = shadeCell(n, v, vLocal.xz * 3.0, col, nuc, nucleolus, vShape.z, uLight);
}
`;

const DAUGHTER_VS = /* glsl */ `
attribute vec3 aCol;
varying vec3 vW;
varying vec3 vN;
varying vec3 vO;
varying vec3 vCol;
void main() {
  mat3 m = mat3(instanceMatrix);
  vec3 s2 = vec3(dot(m[0], m[0]), dot(m[1], m[1]), dot(m[2], m[2]));
  vN = normalize(mat3(modelMatrix) * (m * (normal / s2)));
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vO = position;
  vCol = aCol;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const DAUGHTER_FS = /* glsl */ `
uniform vec3 uLight;
varying vec3 vW;
varying vec3 vN;
varying vec3 vO;
varying vec3 vCol;
${NOISE}
${CELL_SHADE}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float d = length(vO.xz) / 0.42;
  float nuc = 1.0 - smoothstep(0.75, 1.0, d);
  float nucleolus = 1.0 - smoothstep(0.18, 0.32, d);
  gl_FragColor = shadeCell(n, v, vO.xz, vCol, nuc, nucleolus, 0.0, uLight);
}
`;

interface Colony {
  visible: boolean;
  seed: number;
  /** The side a new colour comes in from. */
  from: THREE.Vector2;
  r: number;
  rv: number;
  hold: number;
  lobe: THREE.Vector4;
  burstDirs: THREE.Vector4;
  burstT: number;
  burstDur: number;
  wob: number;
  infectT: number;
  col: THREE.Color;
  shown: THREE.Color;
}

const m4 = new THREE.Matrix4();
const q4 = new THREE.Quaternion();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);

export class CultureLook extends PieceLook {
  readonly info: LookInfo = {
    id: "culture",
    name: "Culture",
    blurb: "Colonies in a dish on a light table. Each one swells as it fills, then divides into the cells next door and stains them its colour.",
    colors: ["#e23c5c", "#2c6cd8", "#d9a20f", "#22a05a", "#7d43d0", "#e8742a", "#cf3f9c", "#16a19c"],
  };
  readonly background = 0xb9b4aa;
  readonly camera: CameraSpec = { tilt: 66, fov: 27, pad: 0.6 };
  protected settleRate = 7;

  private colonies: Colony[] = [];
  private colonyGeo!: THREE.InstancedBufferGeometry;
  private ca!: Record<"at" | "shape" | "lobe" | "col" | "old" | "from", THREE.InstancedBufferAttribute> & { nuc: THREE.InstancedBufferAttribute[] };
  private agarMat!: THREE.ShaderMaterial;
  private benchMat!: THREE.ShaderMaterial;
  private agarArea: Area = { x0: 0, z0: 0, x1: 1, z1: 1 };
  private benchArea: Area = { x0: 0, z0: 0, x1: 1, z1: 1 };
  private daughters!: THREE.InstancedMesh;
  private dCol!: THREE.InstancedBufferAttribute;
  private stain!: THREE.DataTexture;
  private stainData = new Uint8Array(0);
  private lastFrom = new Int32Array(0);
  private turnTo = new THREE.Color();
  private hoverA = 0;
  private hoverAt = new THREE.Vector2();
  private timeU = { value: 0 };

  protected buildScene() {
    const { w, h } = this;
    const n = w * h;
    const half = new THREE.Vector2(w / 2, h / 2);
    const light = { value: LIGHT };
    const time = this.timeU;
    this.lastFrom = new Int32Array(n).fill(-1);
    this.turnTo.copy(this.palette[0]!);
    this.agarArea = { x0: -w / 2 - PAD, z0: -h / 2 - PAD, x1: w / 2 + PAD, z1: h / 2 + PAD };
    this.benchArea = { x0: -w / 2 - 14, z0: -h / 2 - 14, x1: w / 2 + 14, z1: h / 2 + 14 };

    this.stainData = new Uint8Array(n * 4);
    this.stain = new THREE.DataTexture(this.stainData, w, h, THREE.RGBAFormat);
    this.stain.magFilter = THREE.LinearFilter;
    this.stain.minFilter = THREE.LinearFilter;
    this.stain.needsUpdate = true;
    this.textures.push(this.stain);

    this.agarMat = new THREE.ShaderMaterial({
      uniforms: {
        uTurn: { value: new THREE.Color(this.palette[0]!) },
        uHalf: { value: half },
        uHover: { value: new THREE.Vector4() },
        uHoverCol: { value: new THREE.Color() },
        uStain: { value: this.stain },
        uNoise: { value: null },
        uNoiseArea: { value: areaUniform(this.agarArea) },
        uLight: light,
      },
      vertexShader: WORLD_VS,
      fragmentShader: AGAR_FS,
    });
    const agar = new THREE.Mesh(new THREE.PlaneGeometry(w + 2 * PAD, h + 2 * PAD).rotateX(-Math.PI / 2), this.agarMat);

    // the dish wall
    const rr = <T extends THREE.Path>(s: T, hx: number, hz: number, r: number): T => {
      s.moveTo(-hx + r, -hz);
      s.lineTo(hx - r, -hz);
      s.quadraticCurveTo(hx, -hz, hx, -hz + r);
      s.lineTo(hx, hz - r);
      s.quadraticCurveTo(hx, hz, hx - r, hz);
      s.lineTo(-hx + r, hz);
      s.quadraticCurveTo(-hx, hz, -hx, hz - r);
      s.lineTo(-hx, -hz + r);
      s.quadraticCurveTo(-hx, -hz, -hx + r, -hz);
      return s;
    };
    const outer = rr(new THREE.Shape(), w / 2 + PAD + WALL, h / 2 + PAD + WALL, CORNER + WALL);
    outer.holes.push(rr(new THREE.Path(), w / 2 + PAD, h / 2 + PAD, CORNER));
    const wallGeo = new THREE.ExtrudeGeometry(outer, { depth: WALL_H + 0.03, bevelEnabled: false, curveSegments: 12 });
    wallGeo.rotateX(-Math.PI / 2);
    wallGeo.computeVertexNormals();
    const wall = new THREE.Mesh(
      wallGeo,
      new THREE.ShaderMaterial({ uniforms: { uLight: light }, vertexShader: WORLD_VS, fragmentShader: GLASS_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    wall.position.y = -0.03;
    wall.renderOrder = 6;

    this.benchMat = new THREE.ShaderMaterial({
      uniforms: { uHalf: { value: half }, uNoise: { value: null }, uNoiseArea: { value: areaUniform(this.benchArea) } },
      vertexShader: WORLD_VS,
      fragmentShader: BENCH_FS,
    });
    const bench = new THREE.Mesh(new THREE.PlaneGeometry(90, 90).rotateX(-Math.PI / 2), this.benchMat);
    bench.renderOrder = 1; // after the agar, so the bench under the dish is never shaded
    bench.position.y = -0.03;

    // the colonies, one per cell, drawn together
    const sphere = new THREE.SphereGeometry(1, this.lite ? 36 : 56, this.lite ? 14 : 22);
    this.colonyGeo = new THREE.InstancedBufferGeometry();
    this.colonyGeo.index = sphere.index;
    this.colonyGeo.setAttribute("position", sphere.attributes.position!);
    const each = (size: number) => new THREE.InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
    this.ca = { at: each(3), shape: each(4), lobe: each(4), col: each(3), old: each(3), from: each(2), nuc: [each(4), each(4), each(4), each(4)] };
    const ca = this.ca;
    for (const [name, a] of [["aAt", ca.at], ["aShape", ca.shape], ["aLobe", ca.lobe], ["aCol", ca.col], ["aOld", ca.old], ["aFrom", ca.from]] as const) {
      this.colonyGeo.setAttribute(name, a);
    }
    ca.nuc.forEach((a, i) => this.colonyGeo.setAttribute(`aNuc${i}`, a));
    this.colonyGeo.instanceCount = 0;
    const colonies = new THREE.Mesh(
      this.colonyGeo,
      new THREE.ShaderMaterial({ uniforms: { uTime: time, uLight: light }, vertexShader: COLONY_VS, fragmentShader: COLONY_FS, transparent: true, depthWrite: false }),
    );
    colonies.renderOrder = 2;
    colonies.frustumCulled = false;
    this.colonies = Array.from({ length: n }, (_, c) => ({
      visible: false, seed: hash(c * 2.3 + 0.7), from: new THREE.Vector2(1, 0),
      r: 0, rv: 0, hold: 0,
      lobe: new THREE.Vector4(), burstDirs: new THREE.Vector4(), burstT: 1, burstDur: 1,
      wob: 0, infectT: 1, col: new THREE.Color(), shown: new THREE.Color(),
    }));

    // daughters, while they travel
    const dGeo = new THREE.SphereGeometry(1, this.lite ? 20 : 28, this.lite ? 9 : 12);
    const pos = dGeo.attributes.position!;
    for (let k = 0; k < pos.count; k++) if (pos.getY(k) < 0) pos.setY(k, pos.getY(k) * 0.04);
    dGeo.computeVertexNormals();
    this.dCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DAUGHTERS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    dGeo.setAttribute("aCol", this.dCol);
    this.daughters = new THREE.InstancedMesh(
      dGeo,
      new THREE.ShaderMaterial({ uniforms: { uLight: light }, vertexShader: DAUGHTER_VS, fragmentShader: DAUGHTER_FS, transparent: true, depthWrite: false }),
      MAX_DAUGHTERS,
    );
    this.daughters.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.daughters.frustumCulled = false;
    this.daughters.renderOrder = 3;

    this.group.add(bench, agar, colonies, this.daughters, wall);
  }

  protected bakeScene(renderer: THREE.WebGLRenderer) {
    const agar = bakeGround(renderer, this.agarArea, this.lite ? 64 : 88, NOISE, AGAR_NOISE);
    const bench = bakeGround(renderer, this.benchArea, this.lite ? 18 : 24, NOISE, BENCH_NOISE);
    this.targets.push(agar, bench);
    this.agarMat.uniforms.uNoise!.value = agar.texture;
    this.benchMat.uniforms.uNoise!.value = bench.texture;
  }

  protected home(p: Piece, out: THREE.Vector3) {
    const c = p.cell;
    const n = Math.max(1, p.n);
    const spin = this.time * 0.22 * (hash(c * 1.3) > 0.5 ? 1 : -1) + hash(c * 1.7) * 6.283;
    const rad = n === 1 ? 0 : n === 2 ? 0.11 : n === 3 ? 0.135 : 0.16;
    const a = spin + (p.slot / n) * Math.PI * 2;
    let x = this.cx(c) + Math.cos(a) * rad + Math.sin(this.time * 0.9 + p.seed * 20) * 0.012;
    let z = this.cz(c) + Math.sin(a) * rad + Math.cos(this.time * 0.8 + p.seed * 13) * 0.012;
    if (p.mode !== FLY && this.critical(c)) {
      x += Math.sin(this.time * 23 + p.seed * 40) * 0.008;
      z += Math.cos(this.time * 19 + p.seed * 30) * 0.008;
    }
    out.set(x, 0, z);
  }

  protected flight(p: Piece, k: number, out: THREE.Vector3) {
    out.lerpVectors(p.from, p.to, easeInOut(k));
    out.y = 0;
  }

  protected drop(_p: Piece, _k: number, home: THREE.Vector3, out: THREE.Vector3) {
    out.copy(home);
  }

  private dirIndex(from: number, to: number) {
    if (to === from + 1) return 0;
    if (to === from - 1) return 1;
    if (to === from + this.w) return 2;
    return 3;
  }

  protected onPlace(p: Piece) {
    const col = this.colonies[p.cell]!;
    col.rv += 1.4;
  }

  protected onRecount(cell: number) {
    const col = this.colonies[cell]!;
    const owner = this.owners[cell]!;
    if (owner < 0) return;
    const c = this.palette[owner]!;
    // a colony that was empty (or nearly gone) just takes the new colour
    if (col.r < 0.05 || !col.visible) {
      col.col.copy(c);
      col.shown.copy(c);
      col.infectT = 1;
    }
  }

  protected onBurst(cell: number, _owner: number, targets: number[], dur: number) {
    const col = this.colonies[cell]!;
    col.hold = this.time + dur * 0.38;
    col.burstT = 0;
    col.burstDur = dur;
    col.burstDirs.set(0, 0, 0, 0);
    for (const t of targets) col.burstDirs.setComponent(this.dirIndex(cell, t), 1);
    this.kick(0.03);
  }

  protected onLand(p: Piece) {
    const col = this.colonies[p.cell]!;
    col.rv += 0.9;
    this.lastFrom[p.cell] = p.src;
  }

  protected onCapture(cell: number, _from: number, to: number) {
    const col = this.colonies[cell]!;
    col.shown.copy(col.col);
    col.col.copy(this.palette[to]!);
    col.infectT = 0;
    const src = this.lastFrom[cell]!;
    const dx = src >= 0 ? this.cx(src) - this.cx(cell) : 1;
    const dz = src >= 0 ? this.cz(src) - this.cz(cell) : 0;
    const l = Math.hypot(dx, dz) || 1;
    col.from.set(dx / l, dz / l);
  }

  protected onTurn(owner: number) {
    this.turnTo.copy(this.palette[owner]!);
  }

  protected onWin(owner: number) {
    this.turnTo.copy(this.palette[owner]!);
  }

  protected render(dt: number) {
    this.timeU.value = this.time;
    const u = this.agarMat.uniforms;
    (u.uTurn!.value as THREE.Color).lerp(this.turnTo, damp(6, dt));
    const on = this.hoverCell >= 0;
    if (on) this.hoverAt.set(this.cx(this.hoverCell) + this.shake(), this.cz(this.hoverCell));
    this.hoverA += ((on ? (this.hoverOk ? 1 : 0.4) : 0) - this.hoverA) * damp(14, dt);
    (u.uHover!.value as THREE.Vector4).set(this.hoverAt.x, this.hoverAt.y, this.hoverA, 0);
    if (on) (u.uHoverCol!.value as THREE.Color).copy(this.palette[this.hoverOwner]!);

    const ca = this.ca;
    let shown = 0;
    for (let c = 0; c < this.colonies.length; c++) {
      const col = this.colonies[c]!;
      const list = this.cells[c]!;
      const n = list.length;
      const crit = this.critical(c);
      // size: a springy chase of the target, held still for a moment as it divides
      const target = this.time < col.hold ? col.r : radiusFor(n);
      col.rv += (target - col.r) * 190 * dt;
      col.rv *= Math.exp(-13 * dt);
      col.r = Math.max(0, col.r + col.rv * dt);
      if (n === 0 && this.time >= col.hold && col.r < 0.02) col.r = 0;
      col.visible = col.r > 0.004;
      if (!col.visible) continue;

      // bulges: a little toward every neighbour when full, a lot toward each target while dividing
      col.burstT += dt;
      const k = col.burstT / col.burstDur;
      const env = k < 0.3 ? smooth(0, 0.3, k) * 0.6 : 0.6 * (1 - smooth(0.3, 0.55, k));
      const fullBulge = crit ? 0.1 + 0.05 * Math.sin(this.time * 6 + c) : 0;
      const x = c % this.w;
      const y = Math.floor(c / this.w);
      for (let d = 0; d < 4; d++) {
        const has = d === 0 ? x < this.w - 1 : d === 1 ? x > 0 : d === 2 ? y < this.h - 1 : y > 0;
        const want = Math.max(has ? fullBulge : 0, col.burstDirs.getComponent(d) * env);
        const cur = col.lobe.getComponent(d);
        col.lobe.setComponent(d, cur + (want - cur) * damp(20, dt));
      }
      col.wob += ((crit || (this.winner >= 0 && this.winT < CHEER_S) ? 1 : 0) - col.wob) * damp(5, dt);
      col.infectT = Math.min(1, col.infectT + dt / 0.5);

      const i = shown++;
      const cx = this.cx(c);
      const cz = this.cz(c);
      ca.at.setXYZ(i, cx, 0.003, cz);
      ca.shape.setXYZW(i, col.r, col.wob, col.seed, col.infectT);
      ca.lobe.setXYZW(i, col.lobe.x, col.lobe.y, col.lobe.z, col.lobe.w);
      ca.col.setXYZ(i, col.col.r, col.col.g, col.col.b);
      ca.old.setXYZ(i, col.shown.r, col.shown.g, col.shown.b);
      ca.from.setXY(i, col.from.x, col.from.y);
      for (let j = 0; j < 4; j++) {
        const p = list[j];
        if (!p) ca.nuc[j]!.setXYZW(i, 0, 0, 0, 0);
        else ca.nuc[j]!.setXYZW(i, p.pos.x - cx, p.pos.z - cz, 0.088 * (0.4 + 0.6 * (p.mode === 1 ? smooth(0, 1, p.t / 0.3) : 1)), 1);
      }
    }
    this.colonyGeo.instanceCount = shown;
    for (const a of [ca.at, ca.shape, ca.lobe, ca.col, ca.old, ca.from, ...ca.nuc]) upload(a, shown);

    // stain under each colony (sent to the graphics chip only when it changes)
    const sd = this.stainData;
    let changed = false;
    for (let c = 0; c < this.colonies.length; c++) {
      const owner = this.owners[c]!;
      const a = owner >= 0 ? 0.35 + (0.65 * this.cells[c]!.length) / this.cap(c) : 0;
      const col = this.palette[Math.max(0, owner)]!;
      const r = Math.floor(col.r * a * 255);
      const g = Math.floor(col.g * a * 255);
      const b = Math.floor(col.b * a * 255);
      const al = Math.floor(a * 255);
      const k = c * 4;
      if (sd[k] !== r || sd[k + 1] !== g || sd[k + 2] !== b || sd[k + 3] !== al) {
        sd[k] = r;
        sd[k + 1] = g;
        sd[k + 2] = b;
        sd[k + 3] = al;
        changed = true;
      }
    }
    if (changed) this.stain.needsUpdate = true;

    // daughters squash and stretch as they slide
    let k = 0;
    for (const p of this.flyers) {
      if (k >= MAX_DAUGHTERS) break;
      const t = Math.min(1, p.t / p.dur);
      const dx = p.pos.x - p.prev.x;
      const dz = p.pos.z - p.prev.z;
      const speed = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
      const st = 1 + Math.min(0.6, speed * 0.13);
      const size = 0.24 * (0.6 + 0.4 * smooth(0, 0.45, t)) * (1 - 0.2 * smooth(0.8, 1, t));
      const yaw = Math.atan2(p.to.z - p.from.z, p.to.x - p.from.x);
      q4.setFromAxisAngle(UPV, -yaw);
      v1.set(p.pos.x, 0.004, p.pos.z);
      v2.set(size * st, size * 0.5, size / st);
      this.daughters.setMatrixAt(k, m4.compose(v1, q4, v2));
      this.dCol.setXYZ(k, p.col.r, p.col.g, p.col.b);
      k++;
    }
    this.daughters.count = k;
    upload(this.daughters.instanceMatrix, k);
    upload(this.dCol, k);
  }
}
