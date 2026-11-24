import "./kit.css";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Ink pairs: the main ink, and the second ink printed slightly off-register behind it. */
export type InkTone = "bone" | "town" | "cult" | "prophet" | "gold" | "go" | "stop";

/**
 * Display lettering for big moments (see .inked in kit.css): a heavy serif in one ink. `print` adds the second ink
 * off-register behind it, the screen-print look, for logos.
 */
export function inked(text: string, tone: InkTone = "bone", print = false): string {
  return `<span class="inked ${tone}${print ? " print" : ""}">${esc(text)}</span>`;
}
