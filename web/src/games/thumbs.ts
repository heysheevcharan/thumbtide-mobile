// Pre-made thumbnails, found by folder: games/<id>/thumb/card.webp (480×270, the card) and bg.webp (160×90, the
// blurred lobby background; the browser's bilinear upscaling does the blur). A game with no files yet has neither
// field and the lobby draws its cover and background from the game's two colours.
// Resolved with ?url from this script, so in the single-file TV build they sit next to it (like hammer's font).
// Make the files with `node scripts/thumbs.mjs <source folder>` (web/scripts/thumbs.mjs).
import type { GameDef } from "./types.ts";

const files = import.meta.glob("./*/thumb/*.webp", { query: "?url", import: "default", eager: true }) as Record<string, string>;

export function applyThumbs(games: GameDef[]): GameDef[] {
  for (const g of games) {
    const card = files[`./${g.id}/thumb/card.webp`];
    const bg = files[`./${g.id}/thumb/bg.webp`];
    if (card) g.thumb = card;
    if (bg) g.thumbBg = bg;
  }
  return games;
}
