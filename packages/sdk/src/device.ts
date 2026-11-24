/** Phone helpers for controllers. All are safe no-ops where unsupported. */

// ------------------------------------------------------------------------------------------- platform

export type Platform = "ios" | "android" | "other";

export function platform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch points give it away
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

/** Launched from the home screen (no browser toolbars at all). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (navigator as { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: fullscreen)").matches
  );
}

// ------------------------------------------------------------------------------------------- haptics

let hapticsOn = true;
let iosSwitch: HTMLLabelElement | null = null;

/** Turn vibration on or off for every haptic() call (a player preference). */
export function setHaptics(on: boolean) {
  hapticsOn = on;
}

/**
 * A buzz. Android: the Vibration API (patterns work). iPhone has no Vibration API, but since iOS 18 toggling
 * a switch control gives a light tap, so we toggle a hidden one. That only works inside a touch handler,
 * which is exactly when buttons call this.
 */
export function haptic(pattern: number | number[] = 15): void {
  if (!hapticsOn || typeof navigator === "undefined") return;
  try {
    if (typeof navigator.vibrate === "function" && platform() !== "ios") {
      navigator.vibrate(pattern);
      return;
    }
  } catch {
    /* ignore */
  }
  if (platform() !== "ios" || typeof document === "undefined") return;
  if (!iosSwitch) {
    iosSwitch = document.createElement("label");
    iosSwitch.setAttribute("aria-hidden", "true");
    iosSwitch.style.cssText = "position:fixed;left:-200px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    iosSwitch.appendChild(input);
    document.body.appendChild(iosSwitch);
  }
  iosSwitch.click();
}

/** @deprecated use haptic() */
export const vibrate = haptic;

// ------------------------------------------------------------------------------------------- keep the screen on

/** Taps that count as a user gesture for play() and the like (a touch `pointerdown` does not). */
const GESTURES = ["pointerup", "touchend", "click", "keydown"] as const;

/**
 * Keep the phone screen on while the controller is open (lobby and every game). Two ways, as the phone allows:
 *  - the Wake Lock API: needs HTTPS. The browser lets go of it whenever the page is hidden, so it is taken
 *    again each time the page comes back, and on the next tap if the phone let go while we were showing.
 *  - a silent video, set up as NoSleep.js does it (not muted but at volume 0, a sound track, no `loop` on the 2 s clip but a
 *    jump back before its end): for plain http (no Wake Lock API), a refused lock, and iPhone home-screen
 *    apps (iOS before 18.4 grants the lock there but still sleeps). Browsers only start it from a tap, so
 *    every tap retries until it plays. It pauses while the page is hidden.
 * Safe to call outside a tap; the next tap finishes the job. Returns a release function.
 */
export function keepAwake(): () => void {
  if (typeof document === "undefined") return () => {};
  let lock: WakeLockSentinel | null = null;
  let video: HTMLVideoElement | null = null;
  let src: string | null = null;
  let stopped = false;
  let refused = false;
  const hasApi = "wakeLock" in navigator;
  const videoToo = platform() === "ios" && isStandalone();
  const held = () => !!lock && !lock.released;
  const playing = () => !!video && !video.paused;
  const wantVideo = () => !hasApi || refused || videoToo;

  // play() has to run inside the tap, so the video is loaded up front rather than when it's first needed
  void import("./nosleep-video.ts").then((m) => {
    src = m.BLANK_MP4;
    if (wantVideo()) playVideo();
  });

  const playVideo = () => {
    if (stopped || !src || document.visibilityState !== "visible") return;
    if (!video) {
      const v = document.createElement("video");
      v.setAttribute("playsinline", "");
      v.setAttribute("title", "");
      v.src = src;
      // not `muted` (a muted video doesn't keep some phones awake), but at volume 0: the clip is silent anyway,
      // and this way it can never be heard. The phone may still show media controls for it.
      v.volume = 0;
      v.addEventListener("timeupdate", () => {
        if (v.currentTime > 1) v.currentTime = 0.1;
      });
      // in the page and on screen (a tiny transparent corner): some browsers pause or ignore off-screen video
      v.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1";
      document.body.appendChild(v);
      video = v;
    }
    if (video.paused) void video.play().catch(() => {});
  };

  let asking = false;
  const requestLock = () => {
    if (!hasApi || held() || refused || asking) return;
    asking = true;
    navigator.wakeLock.request("screen").then(
      (l) => {
        asking = false;
        if (stopped || held()) return void l.release().catch(() => {});
        lock = l;
        l.addEventListener("release", () => {
          if (lock === l) lock = null;
        });
      },
      () => {
        asking = false;
        // not allowed (battery saver, a permissions policy…): the video takes over
        refused = true;
        playVideo();
      },
    );
  };

  const acquire = () => {
    if (stopped || document.visibilityState !== "visible") return;
    requestLock();
    if (wantVideo()) playVideo();
  };
  const onVis = () => {
    if (document.visibilityState !== "visible") return void video?.pause();
    refused = false; // a fresh try at the lock each time we come back
    acquire();
  };
  const onTap = () => {
    if (!held() && !playing()) acquire();
  };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pageshow", onVis);
  for (const e of GESTURES) document.addEventListener(e, onTap, true);
  acquire();
  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pageshow", onVis);
    for (const e of GESTURES) document.removeEventListener(e, onTap, true);
    void lock?.release().catch(() => {});
    video?.pause();
    video?.remove();
  };
}

// ------------------------------------------------------------------------------------------- fullscreen

export function canFullscreen(): boolean {
  return typeof document !== "undefined" && !!document.documentElement.requestFullscreen && platform() !== "ios";
}

export function isFullscreen(): boolean {
  return typeof document !== "undefined" && !!document.fullscreenElement;
}

/**
 * Go fullscreen (hides the URL bar and system bars on Android). Must be called from a tap.
 * Optionally lock the orientation (only works while fullscreen, on Android).
 */
export async function enterFullscreen(orientation?: "portrait" | "landscape"): Promise<boolean> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
  } catch {
    return false; // iPhone doesn't allow fullscreen for pages
  }
  if (orientation) {
    try {
      await (screen.orientation as unknown as { lock(o: string): Promise<void> })?.lock?.(orientation);
    } catch {
      /* not supported */
    }
  }
  return isFullscreen();
}

export function onFullscreenChange(fn: (on: boolean) => void): () => void {
  const h = () => fn(isFullscreen());
  document.addEventListener("fullscreenchange", h);
  return () => document.removeEventListener("fullscreenchange", h);
}

// ------------------------------------------------------------------------------------------- motion

/**
 * Ask for motion-sensor access. iOS requires this to be called from a user
 * gesture (tap handler). Resolves true if tilt events will flow.
 */
export async function requestMotion(): Promise<boolean> {
  const DOE = (globalThis as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  if (!DOE) return false;
  if (typeof DOE.requestPermission === "function") {
    try {
      return (await DOE.requestPermission()) === "granted";
    } catch {
      return false;
    }
  }
  return true;
}

export interface Tilt {
  /** Left/right, -1..1. */
  x: number;
  /** Toward/away, -1..1. */
  y: number;
}

/**
 * Tilt the phone like a steering wheel / marble maze. `maxDeg` is the angle
 * that maps to ±1. Call `requestMotion()` first on iOS.
 */
export function onTilt(cb: (t: Tilt) => void, maxDeg = 30): () => void {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const handler = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    const angle = (screen.orientation?.angle ?? (window as { orientation?: number }).orientation ?? 0) as number;
    let x = e.gamma;
    let y = e.beta;
    // Remap axes in landscape so "left" is always left.
    if (angle === 90) [x, y] = [e.beta, -e.gamma];
    else if (angle === -90 || angle === 270) [x, y] = [-e.beta, e.gamma];
    cb({ x: clamp(x / maxDeg), y: clamp(y / maxDeg) });
  };
  window.addEventListener("deviceorientation", handler);
  return () => window.removeEventListener("deviceorientation", handler);
}
