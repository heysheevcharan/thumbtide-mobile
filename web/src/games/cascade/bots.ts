// Computer players: try every legal cell, play out the chain, and score what's left.
import { capacity, cloneBoard, neighbours, settle, soleOwner, type Game } from "./rules.ts";

export function botMove(g: Game, rng: () => number = Math.random): number {
  const b = g.board;
  const p = g.turn;
  const n = b.w * b.h;
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!g.canPlay(i)) continue;
    const t = cloneBoard(b);
    t.owner[i] = p;
    t.count[i] = t.count[i]! + 1;
    settle(t, p, i, true);
    if (g.started && soleOwner(t) === p) return i;

    let score = 0;
    for (let c = 0; c < n; c++) {
      const o = t.owner[c]!;
      if (o < 0) continue;
      const k = t.count[c]!;
      if (o !== p) {
        score -= k * 0.8;
        continue;
      }
      score += k;
      // A rival cell that's one short of bursting next to ours will take it.
      for (const nb of neighbours(b.w, b.h, c)) {
        const on = t.owner[nb]!;
        if (on >= 0 && on !== p && t.count[nb] === capacity(b.w, b.h, nb) - 1) {
          score -= 1.5 + k;
          break;
        }
      }
    }
    // Corners are safe early on.
    if (b.count[i] === 0 && capacity(b.w, b.h, i) === 2) score += 1.5;
    score += rng() * 2.5;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}
