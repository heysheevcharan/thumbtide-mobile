let installed = false;

/** Elements (or their ancestors) with this attribute may scroll; everything else is locked in place. */
export const SCROLLABLE = "data-scroll";

/**
 * Make the page behave like a game controller instead of a web page:
 * - no pinch zoom, double-tap zoom or iOS gesture zoom
 * - no text selection, long-press menus, link previews or image dragging
 * - no rubber-band scrolling or pull-to-refresh (except inside [data-scroll] panels)
 * - the layout always fits the visible area: `--app-h` tracks the visual viewport, which changes as
 *   browser toolbars and the keyboard come and go
 * Call once on controller pages.
 */
export function controllerSurface(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;

  const style = document.createElement("style");
  style.textContent = `
    html, body {
      touch-action: none;
      overscroll-behavior: none;
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
      -webkit-tap-highlight-color: transparent;
      -webkit-text-size-adjust: 100%;
      text-size-adjust: 100%;
      overflow: hidden;
      position: fixed;
      inset: 0;
    }
    img, svg, a { -webkit-user-drag: none; user-drag: none; }
    [${SCROLLABLE}] { touch-action: pan-y; overscroll-behavior: contain; overflow-y: auto; -webkit-overflow-scrolling: touch; }
    input, textarea { -webkit-user-select: text; user-select: text; touch-action: manipulation; }
  `;
  document.head.appendChild(style);

  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "viewport";
    document.head.appendChild(meta);
  }
  meta.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content";

  const allowed = (t: EventTarget | null) => t instanceof Element && !!t.closest(`[${SCROLLABLE}], input, textarea`);

  // iOS ignores user-scalable=no; block gesture zoom and stray scrolling directly.
  const block = (e: Event) => {
    if (!allowed(e.target)) e.preventDefault();
  };
  for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener("touchmove", (e) => {
    if (e.touches.length > 1 || !allowed(e.target)) e.preventDefault();
  }, { passive: false });
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("selectstart", block);
  document.addEventListener("dragstart", (e) => e.preventDefault());

  // Fit the visible area exactly (toolbars showing or not, keyboard open or not).
  const vv = window.visualViewport;
  const fit = () => {
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty("--app-h", `${Math.round(h)}px`);
    // iOS sometimes scrolls the page when the keyboard closes; put it back
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
  };
  vv?.addEventListener("resize", fit);
  vv?.addEventListener("scroll", fit);
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", () => setTimeout(fit, 250));
  fit();
}

/**
 * Called when the player's fingers may have left without us hearing about it: the app was switched,
 * a notification or call came in, the screen locked. Controls use this to let go of everything.
 */
export function onInterrupt(fn: () => void): () => void {
  const vis = () => {
    if (document.visibilityState !== "visible") fn();
  };
  document.addEventListener("visibilitychange", vis);
  window.addEventListener("blur", fn);
  window.addEventListener("pagehide", fn);
  return () => {
    document.removeEventListener("visibilitychange", vis);
    window.removeEventListener("blur", fn);
    window.removeEventListener("pagehide", fn);
  };
}
