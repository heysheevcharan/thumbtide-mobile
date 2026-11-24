import { haptic } from "../device.ts";
import { onInterrupt } from "./surface.ts";

export interface ButtonOptions {
  onPress?: () => void;
  onRelease?: () => void;
  /** Haptic tap on press in ms (0 = none). Default 12. Works on Android, and on iPhone (iOS 18+) too. */
  haptic?: number;
  /**
   * "press" (default): fires the instant a finger lands — for game controls.
   * "tap": fires when the finger lifts without having moved — for menus and lists, so a scroll that starts
   * on a button scrolls instead of choosing it.
   */
  mode?: "press" | "tap";
}

const TAP_SLOP = 10; // px a finger may wander and still count as a tap

/**
 * Turn any element into a responsive button. Toggles a `pressed` class + `data-pressed` for styling,
 * works alongside a joystick under another thumb, and lets go by itself if the app is interrupted.
 */
export function button(el: HTMLElement, o: ButtonOptions): () => void {
  return (o.mode ?? "press") === "tap" ? tapButton(el, o) : pressButton(el, o);
}

function setPressed(el: HTMLElement, on: boolean) {
  el.classList.toggle("pressed", on);
  if (on) el.dataset.pressed = "true";
  else delete el.dataset.pressed;
}

function pressButton(el: HTMLElement, o: ButtonOptions): () => void {
  el.style.touchAction = "none";
  const active = new Set<number>();

  const release = () => {
    if (!active.size && !el.classList.contains("pressed")) return;
    active.clear();
    setPressed(el, false);
    o.onRelease?.();
  };
  const down = (e: PointerEvent) => {
    e.preventDefault();
    if (e.button > 0) return; // right / middle mouse
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer */
    }
    const first = active.size === 0;
    active.add(e.pointerId);
    if (!first) return;
    setPressed(el, true);
    if (o.haptic !== 0) haptic(o.haptic ?? 12);
    o.onPress?.();
  };
  const up = (e: PointerEvent) => {
    if (!active.delete(e.pointerId) || active.size) return;
    setPressed(el, false);
    o.onRelease?.();
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("lostpointercapture", up);
  const offInterrupt = onInterrupt(release);
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    el.removeEventListener("lostpointercapture", up);
    offInterrupt();
  };
}

function tapButton(el: HTMLElement, o: ButtonOptions): () => void {
  el.style.touchAction = "pan-y";
  let pointer: number | null = null;
  let start = { x: 0, y: 0 };

  const cancel = () => {
    pointer = null;
    setPressed(el, false);
  };
  const down = (e: PointerEvent) => {
    if (e.button > 0 || pointer !== null) return;
    pointer = e.pointerId;
    start = { x: e.clientX, y: e.clientY };
    setPressed(el, true);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) cancel();
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    cancel();
    if ((el as HTMLButtonElement).disabled) return;
    if (o.haptic !== 0) haptic(o.haptic ?? 10);
    o.onPress?.();
    o.onRelease?.();
  };
  // keyboards and remotes
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    o.onPress?.();
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("pointerleave", cancel);
  el.addEventListener("keydown", key);
  const offInterrupt = onInterrupt(cancel);
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", cancel);
    el.removeEventListener("pointerleave", cancel);
    el.removeEventListener("keydown", key);
    offInterrupt();
  };
}
