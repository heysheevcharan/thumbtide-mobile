// Odd Word Out's look: a loud late-night quiz show drawn with flat, blocky shapes. Each phase has its own stage
// colour, everything has a thick dark outline and a hard offset shadow, and every player is a simple character
// with a distinct silhouette (one of eight shapes) in their seat colour. Shared by the TV and the phone.

export const LOOK = {
  ink: "#1d1236",
  cream: "#fff4dc",
  sun: "#ffd23f",
  stage: { describe: "#ff7a3d", vote: "#22a99c", reveal: "#e8407a" },
} as const;

export const DISPLAY = `"Odd Display", "Lilita One", "Arial Black", sans-serif`;
export const SANS = `"Odd Sans", Inter, system-ui, sans-serif`;

/** The TV's reveal cards are all down after this long (oddword.css: the last card drops at 2.9 s, the stamp at 3.6 s). */
export const REVEAL_SETTLE_MS = 4200;

export type Mood = "idle" | "done" | "out" | "sly" | "worried";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * A player character: a body in one of eight shapes with eyes and a mouth that change with the mood.
 * Sized by the parent's font-size (1em = the body's width). Styles: .om-* in oddword.css.
 */
export function mug(color: string, shape: number, mood: Mood = "idle", extra = ""): string {
  return `<span class="om om-s${shape % 8} om-${mood}${extra ? ` ${esc(extra)}` : ""}" style="--c:${esc(color)}"><i class="om-eye l"></i><i class="om-eye r"></i><i class="om-mouth"></i></span>`;
}

export { esc };
