// The game library's building blocks, shared by the TV and the phones: cover art and a game's one-line facts.
import { CONTROL_ICONS } from "../kit/icons.ts";
import type { GameDef } from "../types.ts";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const playersText = (g: GameDef) =>
  g.minPlayers === g.maxPlayers ? `${g.minPlayers} players` : `${g.minPlayers}–${g.maxPlayers} players`;

export const gameColors = (g: GameDef): [string, string] => g.colors ?? ["#7c5cff", "#2de2c9"];

const gameVars = (g: GameDef) => {
  const [a, b] = gameColors(g);
  return `--ga:${a};--gb:${b}`;
};

/**
 * Cover art: the game's card image (480×270), else its older cover, else one drawn from its colours and glyph.
 * `lazy` leaves the image unloaded until it nears the screen (the TV's strip of cards).
 */
export function coverHtml(g: GameDef, o: { title?: boolean; lazy?: boolean } = {}): string {
  const glyph = g.glyph ? CONTROL_ICONS[g.glyph] : "";
  const src = g.thumb ?? g.cover;
  const art = src
    ? `<img src="${esc(src)}" alt="" decoding="async" draggable="false"${o.lazy ? ` loading="lazy"` : ""}>`
    : `<i class="cv-glyph" style="-webkit-mask-image:${maskUrl(glyph)};mask-image:${maskUrl(glyph)}"></i>`;
  return `<div class="cv ${src ? "" : "cv-drawn"}" style="${gameVars(g)}">${art}${
    o.title === false ? "" : `<div class="cv-cap"><b>${esc(g.title)}</b><small>${playersText(g)}</small></div>`
  }</div>`;
}

// single quotes: this ends up inside a style="…" attribute
const maskUrl = (svg: string) =>
  svg ? `url('data:image/svg+xml,${encodeURIComponent(svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '))}')` : "none";
