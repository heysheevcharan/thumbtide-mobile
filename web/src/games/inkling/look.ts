// Inkling's palette and type in one place: a sketchbook on a drafting table.
export const LOOK = {
  desk: "#2f3a3f",
  deskDark: "#252e32",
  paper: "#fbfaf6",
  grid: "#cfe0ee",
  sticky: "#ffe46b",
  marker: "#1a1a1a",
} as const;

/** Player colours: marker tips that read on the dark desk and on paper. */
export const TIPS = ["#e8453c", "#2f7fe0", "#2fa84f", "#f39c12", "#9b59d0", "#16a3a3", "#e2508f", "#a8743f"];

/** The eight drawing inks (index 8 is the eraser). The same on the phone and the TV. */
export const INKS = ["#1a1a1a", "#e03131", "#f08c00", "#f2b705", "#2f9e44", "#1c7ed6", "#7048e8", "#8b5a2b"];
export const INK_NAMES = ["Black", "Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Brown"];
/** Brush widths as a fraction of the sheet's width; the eraser is wider. */
export const SIZES = [0.007, 0.015, 0.03];
export const ERASER_SCALE = 2.2;
/** Sheet width / height. */
export const ASPECT = 3 / 4;

export const HAND = `"Inkling Hand", "Caveat Brush", "Comic Sans MS", cursive`;
export const SANS = `"Inkling Sans", Inter, system-ui, sans-serif`;

/** Draws strokes onto a 2D context sized w × h (0–1000 sheet coordinates). `from` lets a caller draw only new points. */
export function drawStroke(ctx: CanvasRenderingContext2D, s: { c: number; w: number; p: number[] }, w: number, h: number, from = 0) {
  const p = s.p;
  if (p.length < 2) return;
  const eraser = s.c >= INKS.length;
  const lw = Math.max(1, SIZES[s.w]! * w * (eraser ? ERASER_SCALE : 1));
  ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
  ctx.strokeStyle = ctx.fillStyle = eraser ? "#000" : INKS[s.c]!;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const sx = w / 1000, sy = h / 1000;
  if (p.length === 2) {
    if (from > 0) return;
    ctx.beginPath();
    ctx.arc(p[0]! * sx, p[1]! * sy, lw / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const start = Math.max(0, from - 2);
    if (start + 2 >= p.length) return;
    ctx.beginPath();
    ctx.moveTo(p[start]! * sx, p[start + 1]! * sy);
    for (let i = start + 2; i < p.length; i += 2) ctx.lineTo(p[i]! * sx, p[i + 1]! * sy);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
}

/** The faint blue grid of the sheet, baked once per size. */
export function bakeGrid(ctx: CanvasRenderingContext2D, w: number, h: number, cells = 15) {
  ctx.fillStyle = LOOK.paper;
  ctx.fillRect(0, 0, w, h);
  const step = w / cells;
  ctx.strokeStyle = LOOK.grid;
  ctx.lineWidth = Math.max(1, w / 600);
  ctx.beginPath();
  for (let x = step; x < w - 1; x += step) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, h);
  }
  for (let y = step; y < h - 1; y += step) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(w, Math.round(y) + 0.5);
  }
  ctx.stroke();
}
