import "./kit.css";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export type JuicyTheme = "gold" | "candy" | "mint" | "sky" | "grape" | "fire" | "ice" | "ink";

/** Glossy candy lettering (see .juicy in kit.css). */
export function juicy(text: string, theme: JuicyTheme = "gold"): string {
  const t = esc(text);
  return `<span class="juicy ${theme}" data-text="${t}"><span>${t}</span></span>`;
}
