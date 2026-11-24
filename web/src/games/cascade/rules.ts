/**
 * Cascade (working name). Players take turns adding a piece to an empty cell or one of their own.
 * A cell bursts when it holds as many pieces as it has neighbours (2 in a corner, 3 on an edge, 4 inside):
 * it sends one piece into each neighbour and takes that neighbour over. Bursts can set off more bursts.
 * Once everyone has moved, a player with no pieces left is out. Last one standing wins.
 *
 * Pure rules with no DOM. The TV plays a move back as animation, one wave of bursts at a time.
 */

export interface Board {
  readonly w: number;
  readonly h: number;
  /** Owner of each cell, -1 when empty. */
  readonly owner: Int8Array;
  /** Pieces in each cell. */
  readonly count: Uint8Array;
}

export interface Burst {
  cell: number;
  targets: number[];
}

export interface CellState {
  i: number;
  owner: number;
  count: number;
}

/** One step of a chain: every full cell bursts at once. `cells` holds each touched cell's state afterwards. */
export interface Wave {
  bursts: Burst[];
  cells: CellState[];
}

export interface Move {
  player: number;
  cell: number;
  /** The cell's piece count once the new piece is in, before anything bursts. */
  count: number;
  waves: Wave[];
  eliminated: number[];
  /** -1 while the game goes on. */
  winner: number;
}

/** A safety stop: a full board can otherwise burst forever. */
const MAX_WAVES = 2000;

export function createBoard(w: number, h: number): Board {
  return { w, h, owner: new Int8Array(w * h).fill(-1), count: new Uint8Array(w * h) };
}

export function cloneBoard(b: Board): Board {
  return { w: b.w, h: b.h, owner: b.owner.slice(), count: b.count.slice() };
}

/** Neighbours in a fixed order: left, right, up (-z), down (+z). */
export function neighbours(w: number, h: number, i: number): number[] {
  const x = i % w;
  const y = (i - x) / w;
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < w - 1) out.push(i + 1);
  if (y > 0) out.push(i - w);
  if (y < h - 1) out.push(i + w);
  return out;
}

/** Pieces that make a cell burst: its number of neighbours. */
export function capacity(w: number, h: number, i: number): number {
  const x = i % w;
  const y = (i - x) / w;
  return (x > 0 ? 1 : 0) + (x < w - 1 ? 1 : 0) + (y > 0 ? 1 : 0) + (y < h - 1 ? 1 : 0);
}

/** The one player who owns every piece on the board, or -1 if there are several (or none). */
export function soleOwner(b: Board): number {
  let who = -1;
  for (let i = 0; i < b.owner.length; i++) {
    const o = b.owner[i]!;
    if (o < 0) continue;
    if (who < 0) who = o;
    else if (o !== who) return -1;
  }
  return who;
}

/**
 * Resolve the bursts after `player` adds a piece to `start`. Mutates the board.
 * With `stopWhenSole`, stops as soon as `player` owns every piece (the game is over; a full board would burst forever).
 */
export function settle(b: Board, player: number, start: number, stopWhenSole: boolean): Wave[] {
  const waves: Wave[] = [];
  let full = b.count[start]! >= capacity(b.w, b.h, start) ? [start] : [];
  while (full.length && waves.length < MAX_WAVES) {
    const bursts: Burst[] = [];
    const touched = new Set<number>();
    for (const c of full) {
      const targets = neighbours(b.w, b.h, c);
      b.count[c] = b.count[c]! - targets.length;
      if (!b.count[c]) b.owner[c] = -1;
      bursts.push({ cell: c, targets });
      touched.add(c);
    }
    for (const { targets } of bursts) {
      for (const t of targets) {
        b.count[t] = b.count[t]! + 1;
        b.owner[t] = player;
        touched.add(t);
      }
    }
    waves.push({ bursts, cells: [...touched].map((i) => ({ i, owner: b.owner[i]!, count: b.count[i]! })) });
    if (stopWhenSole && soleOwner(b) === player) break;
    full = [...touched].filter((i) => b.count[i]! >= capacity(b.w, b.h, i));
  }
  return waves;
}

/**
 * Whether the current player's turn may pass on while they're away (`away[i]`: their phone is on another app
 * or locked). Only when at least two others still in can play on: with one, they'd just take free moves
 * against an empty chair, so the game waits for the player instead.
 */
export function canSkipAway(g: Game, away: readonly boolean[]): boolean {
  let present = 0;
  for (let q = 0; q < g.players; q++) if (q !== g.turn && g.alive[q] && !away[q]) present++;
  return g.winner < 0 && present >= 2;
}

export class Game {
  readonly board: Board;
  readonly alive: boolean[];
  /** Whether each player has had a first turn. Nobody can be knocked out before that. */
  readonly moved: boolean[];
  turn = 0;
  winner = -1;

  /** `first`: who moves first (it rotates from round to round). */
  constructor(
    readonly w: number,
    readonly h: number,
    readonly players: number,
    first = 0,
  ) {
    this.board = createBoard(w, h);
    this.alive = Array.from({ length: players }, () => true);
    this.moved = Array.from({ length: players }, () => false);
    this.turn = ((first % players) + players) % players;
  }

  /** Moves made so far this game. */
  get moves(): number {
    let n = 0;
    for (let i = 0; i < this.board.count.length; i++) n += this.board.count[i]!;
    return n;
  }

  canPlay(i: number): boolean {
    if (this.winner >= 0 || i < 0 || i >= this.w * this.h) return false;
    const o = this.board.owner[i]!;
    return o === -1 || o === this.turn;
  }

  /** Everyone still in has had a turn, so the game can end. */
  get started(): boolean {
    return this.moved.every((m, q) => m || !this.alive[q]);
  }

  piecesOf(player: number): number {
    let n = 0;
    for (let i = 0; i < this.board.owner.length; i++) if (this.board.owner[i] === player) n += this.board.count[i]!;
    return n;
  }

  play(i: number): Move | null {
    if (!this.canPlay(i)) return null;
    const p = this.turn;
    const b = this.board;
    b.owner[i] = p;
    b.count[i] = b.count[i]! + 1;
    const count = b.count[i]!;
    this.moved[p] = true;
    const waves = settle(b, p, i, this.started);

    const eliminated: number[] = [];
    for (let q = 0; q < this.players; q++) {
      if (q !== p && this.alive[q] && this.moved[q] && this.piecesOf(q) === 0) {
        this.alive[q] = false;
        eliminated.push(q);
      }
    }
    if (this.alive.filter(Boolean).length === 1) this.winner = p;
    else this.next();
    return { player: p, cell: i, count, waves, eliminated, winner: this.winner };
  }

  /**
   * Pass the turn on without a move (the player is away). It doesn't count as their first turn, so a player
   * skipped from the start can't be knocked out (and the round can't end) until they're back or gone.
   */
  skip() {
    if (this.winner < 0) this.next();
  }

  private next() {
    let q = this.turn;
    do q = (q + 1) % this.players;
    while (!this.alive[q]);
    this.turn = q;
  }
}
