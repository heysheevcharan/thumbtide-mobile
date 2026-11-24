import { haptic } from "../device.ts";
import { onInterrupt } from "./surface.ts";

export interface JoystickOptions {
  /**
   * "floating" (default): the stick appears wherever your thumb lands in the zone, and follows it if you
   * drag past the rim, so you never have to find the centre again. "fixed": it stays centred in the zone.
   */
  mode?: "floating" | "fixed";
  /** Floating only: the base slides after your thumb when you pass the rim (default true). */
  follow?: boolean;
  /** Thumb travel in px from the centre to the rim (default 40: a short, comfortable push). */
  radius?: number;
  /** Ignore movement below this fraction of the radius (default 0.08). */
  deadzone?: number;
  /** Full tilt is reached this fraction of the way to the rim, so you never have to hunt for the edge (default 0.85). */
  fullAt?: number;
  /** Shapes the response: 1 linear, <1 livelier near the centre, >1 finer control near the centre (default 0.9). */
  curve?: number;
  /** Snap to 4 or 8 directions (grid games). 0 = any direction (default). */
  directions?: 0 | 4 | 8;
  /** Haptic ms when the thumb lands (default 8) and when it reaches full tilt (default 0 = off). */
  hapticTouch?: number;
  hapticRim?: number;
  onMove: (v: { x: number; y: number; active: boolean }) => void;
}

/**
 * Virtual analog stick. Reports x/y in -1..1 (y down is positive, matching screen coordinates).
 * Lets go by itself when the app is interrupted, so nothing is ever left held down. Returns a destroy function.
 */
export function joystick(zone: HTMLElement, o: JoystickOptions): () => void {
  const mode = o.mode ?? "floating";
  const follow = o.follow ?? true;
  const dead = o.deadzone ?? 0.08;
  const full = Math.max(dead + 0.05, Math.min(1, o.fullAt ?? 0.85));
  const curve = o.curve ?? 0.9;
  const dirs = o.directions ?? 0;
  const radiusFor = () => o.radius ?? 40;
  let radius = radiusFor();
  let atRim = false;

  zone.style.touchAction = "none";
  if (getComputedStyle(zone).position === "static") zone.style.position = "relative";
  zone.classList.add("tt-stick-zone");

  const base = document.createElement("div");
  base.className = "tt-stick";
  base.innerHTML = `<i class="tt-stick-dir"></i><b class="tt-stick-knob"></b>`;
  const knob = base.querySelector(".tt-stick-knob") as HTMLElement;
  const dir = base.querySelector(".tt-stick-dir") as HTMLElement;
  zone.appendChild(base);
  installStyles();

  const size = () => {
    radius = radiusFor();
    base.style.width = base.style.height = `${radius * 2}px`;
    base.style.margin = `${-radius}px 0 0 ${-radius}px`;
    const k = Math.max(52, radius * 1.1);
    knob.style.width = knob.style.height = `${k}px`;
    knob.style.margin = `${-k / 2}px 0 0 ${-k / 2}px`;
  };
  const center = () => {
    const r = zone.getBoundingClientRect();
    return { x: r.width / 2, y: r.height / 2 };
  };
  const place = (x: number, y: number) => {
    base.style.left = `${x}px`;
    base.style.top = `${y}px`;
  };
  size();
  if (mode === "fixed") {
    const c = center();
    place(c.x, c.y);
    base.classList.add("idle");
  }

  let pointer: number | null = null;
  let origin = { x: 0, y: 0 };
  let last = { x: 0, y: 0 };

  const report = (dx: number, dy: number, active: boolean) => {
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, radius);
    let ang = Math.atan2(dy, dx);
    knob.style.transform = `translate(${Math.cos(ang) * clamped}px, ${Math.sin(ang) * clamped}px)`;
    const raw = clamped / radius;
    const mag = raw < dead ? 0 : Math.pow(Math.min(1, (raw - dead) / (full - dead)), curve);
    if (dirs && mag > 0) {
      const step = (Math.PI * 2) / dirs;
      ang = Math.round(ang / step) * step;
    }
    const rim = active && mag >= 1;
    if (rim && !atRim && o.hapticRim) haptic(o.hapticRim);
    atRim = rim;
    dir.style.opacity = String(mag);
    dir.style.transform = `rotate(${ang}rad)`;
    const x = dist ? Math.round(Math.cos(ang) * mag * 1000) / 1000 : 0;
    const y = dist ? Math.round(Math.sin(ang) * mag * 1000) / 1000 : 0;
    if (x === last.x && y === last.y && active) return;
    last = { x, y };
    o.onMove({ x, y, active });
  };

  const local = (e: PointerEvent) => {
    const r = zone.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: PointerEvent) => {
    if (pointer !== null) return;
    e.preventDefault();
    pointer = e.pointerId;
    try {
      zone.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer */
    }
    size();
    origin = mode === "floating" ? local(e) : center();
    place(origin.x, origin.y);
    base.classList.remove("idle");
    base.classList.add("on");
    if ((o.hapticTouch ?? 8) > 0) haptic(o.hapticTouch ?? 8);
    const p = local(e);
    report(p.x - origin.x, p.y - origin.y, true);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    const p = local(e);
    let dx = p.x - origin.x;
    let dy = p.y - origin.y;
    const d = Math.hypot(dx, dy);
    if (mode === "floating" && follow && d > radius) {
      // the base slides after the thumb, so the stick never runs out of travel
      origin.x += (dx / d) * (d - radius);
      origin.y += (dy / d) * (d - radius);
      place(origin.x, origin.y);
      dx = p.x - origin.x;
      dy = p.y - origin.y;
    }
    report(dx, dy, true);
  };
  const release = () => {
    if (pointer === null) return;
    pointer = null;
    base.classList.remove("on");
    if (mode === "fixed") base.classList.add("idle");
    report(0, 0, false);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId === pointer) release();
  };

  zone.addEventListener("pointerdown", down);
  zone.addEventListener("pointermove", move);
  zone.addEventListener("pointerup", up);
  zone.addEventListener("pointercancel", up);
  zone.addEventListener("lostpointercapture", up);
  const offInterrupt = onInterrupt(release);
  return () => {
    zone.removeEventListener("pointerdown", down);
    zone.removeEventListener("pointermove", move);
    zone.removeEventListener("pointerup", up);
    zone.removeEventListener("pointercancel", up);
    zone.removeEventListener("lostpointercapture", up);
    offInterrupt();
    base.remove();
  };
}

let styled = false;
function installStyles() {
  if (styled) return;
  styled = true;
  const s = document.createElement("style");
  s.textContent = `
    .tt-stick { position: absolute; left: 50%; top: 50%; border-radius: 50%; pointer-events: none; opacity: 0;
      background: radial-gradient(circle, rgba(255,255,255,0.05) 0 55%, rgba(255,255,255,0.12) 70%, rgba(255,255,255,0.02) 71%);
      box-shadow: inset 0 0 0 3px rgba(255,255,255,0.28); transition: opacity 120ms; }
    .tt-stick.on { opacity: 1; transition: none; }
    .tt-stick.idle { opacity: 0.45; }
    .tt-stick-dir { position: absolute; inset: -6px; border-radius: 50%; opacity: 0;
      background: conic-gradient(from 60deg, transparent 0 0deg, var(--cl, #fff) 30deg, transparent 60deg);
      -webkit-mask: radial-gradient(circle, transparent 0 62%, #000 64%); mask: radial-gradient(circle, transparent 0 62%, #000 64%); }
    .tt-stick-knob { position: absolute; left: 50%; top: 50%; border-radius: 50%; will-change: transform;
      background: radial-gradient(circle at 35% 30%, #fff 0 12%, color-mix(in srgb, var(--cl, #ddd) 60%, #fff) 30%, var(--c, #999) 100%);
      box-shadow: 0 6px 16px rgba(0,0,0,0.45), inset 0 -4px 0 rgba(0,0,0,0.18); }
  `;
  document.head.appendChild(s);
}
