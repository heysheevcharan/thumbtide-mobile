// Sound for the TV page: one audio engine for the whole visit, started as early as the browser allows.
//
// Browsers only let a page make sound once someone has pressed a key or clicked on it (or the page runs in an
// app that allows it, like our TV app). So: we start the engine straight away, and the first key press or click
// anywhere on the TV (usually in the lobby) switches it on for good. Games share this engine, so by the time a
// game starts, sound is already on. While it's still blocked, a small muted-speaker icon sits in the corner.

type Listener = () => void;
let ctx: AudioContext | null = null;
let out: GainNode | null = null;
const listeners = new Set<Listener>();

/** The shared audio engine (created on first call). Null where the browser has no WebAudio. */
// Mobile: the game logic runs on one phone, so its sounds would play only there. Off for now.
const HOST_SOUND = false as boolean;
export function audio(): AudioContext | null {
  return HOST_SOUND ? engine() : null;
}
function engine(): AudioContext | null {
  if (ctx) return ctx;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx({ latencyHint: "interactive" });
  out = ctx.createGain();
  out.gain.value = 0.5;
  out.connect(ctx.destination);
  ctx.onstatechange = () => listeners.forEach((f) => f());
  const wake = () => {
    if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
  };
  wake(); // allowed already? (TV app, or the browser trusts this site)
  for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, wake, { capture: true, passive: true });
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && wake());
  return ctx;
}

export const soundOn = () => ctx?.state === "running";

export function onSoundChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Small interface sounds for the platform itself (lobby joins, choosing a game). */
export function blip(kind: "join" | "leave" | "move" | "start") {
  const c = audio();
  if (!c || !out || c.state !== "running") return;
  const t = c.currentTime;
  const note = (freq: number, at: number, dur: number, peak: number) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, t + at);
    g.gain.setValueAtTime(0.0001, t + at);
    g.gain.exponentialRampToValueAtTime(peak, t + at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
    o.connect(g).connect(out!);
    o.start(t + at);
    o.stop(t + at + dur + 0.05);
  };
  if (kind === "join") {
    note(660, 0, 0.18, 0.18);
    note(990, 0.08, 0.24, 0.14);
  } else if (kind === "leave") {
    note(520, 0, 0.18, 0.12);
    note(390, 0.08, 0.22, 0.1);
  } else if (kind === "move") {
    note(880, 0, 0.07, 0.06);
  } else {
    note(523, 0, 0.16, 0.16);
    note(659, 0.09, 0.16, 0.16);
    note(784, 0.18, 0.3, 0.18);
  }
}

/** The muted-speaker icon, shown only while the browser is holding sound back. */
export function soundHint(parent: HTMLElement) {
  const el = document.createElement("div");
  el.className = "sound-hint";
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Press any key for sound</span>`;
  parent.appendChild(el);
  const sync = () => (el.hidden = !audio() || soundOn());
  sync();
  onSoundChange(sync);
}
