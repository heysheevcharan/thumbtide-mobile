// Plays a move back on a look: the piece goes in, then each wave of bursts flies out and lands.
// Long chains speed up as they go.
import type { Move } from "../rules.ts";
import type { Look } from "./look.ts";

/** Flight time of the first wave, in seconds. Each later wave is a little quicker, down to MIN_FLIGHT. */
const FIRST_FLIGHT = 0.62;
const MIN_FLIGHT = 0.2;
const SPEEDUP = 0.92;
const GAP = 0.06;
/** From the piece going in to its cell bursting. */
const LEAD = 0.42;

/** Beats of a move as they play, for sound and the HUD. `wave` counts from 0. */
export type Beat = { kind: "place" } | { kind: "burst"; wave: number; cells: number } | { kind: "land"; wave: number } | { kind: "win" };

interface Cue {
  at: number;
  run: () => void;
}

export class Director {
  private t = 0;
  private end = 0;
  private queue: Cue[] = [];
  private done: (() => void) | null = null;

  constructor(public look: Look) {}

  get busy() {
    return this.done !== null;
  }

  play(move: Move, done: () => void, beat: (b: Beat) => void = () => {}) {
    const q: Cue[] = [
      {
        at: 0,
        run: () => {
          this.look.place(move.cell, move.player, move.count);
          beat({ kind: "place" });
        },
      },
    ];
    let t = LEAD;
    move.waves.forEach((w, k) => {
      const dur = Math.max(MIN_FLIGHT, FIRST_FLIGHT * SPEEDUP ** k);
      q.push({
        at: t,
        run: () => {
          this.look.burst(w.bursts, move.player, dur);
          beat({ kind: "burst", wave: k, cells: w.bursts.length });
        },
      });
      q.push({
        at: t + dur,
        run: () => {
          this.look.land(w.cells);
          beat({ kind: "land", wave: k });
        },
      });
      t += dur + GAP;
    });
    this.end = move.waves.length ? t + 0.15 : 0.3;
    if (move.winner >= 0) {
      q.push({
        at: this.end,
        run: () => {
          this.look.win(move.winner);
          beat({ kind: "win" });
        },
      });
    }
    this.queue = q.sort((a, b) => a.at - b.at);
    this.t = 0;
    this.done = done;
  }

  update(dt: number) {
    if (!this.done) return;
    this.t += dt;
    while (this.queue.length && this.queue[0]!.at <= this.t) this.queue.shift()!.run();
    if (!this.queue.length && this.t >= this.end) {
      const d = this.done;
      this.done = null;
      d();
    }
  }

  /** Stop playing back, without calling `done`. The caller re-syncs the look from the board. */
  stop() {
    this.queue = [];
    this.done = null;
  }

  /** Stop playing back and call `done` now. The caller re-syncs the look from the board. */
  cancel() {
    this.queue = [];
    const d = this.done;
    this.done = null;
    d?.();
  }
}
