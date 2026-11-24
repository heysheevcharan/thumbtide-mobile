// What the phones share. Every phone draws the board from `board`, and plays each move back as it happens
// (the `move` message carries its waves of bursts).
import type { Move } from "./rules.ts";

/** Seat colours: bright, distinct, and readable on the dark board. */
export const COLORS = ["#ff4d6d", "#3a86ff", "#ffbe0b", "#2ec27e", "#a26bff", "#ff8a3d", "#ff5fc1", "#2ad4c8"];

/** Board sizes (cells across, down), upright for a phone. "auto" picks by how many are playing. */
export const BOARDS: Record<string, [number, number]> = {
  small: [5, 7],
  medium: [6, 9],
  large: [7, 11],
  xl: [8, 13],
  huge: [10, 16],
};
/** The board for the settings: a size, "custom" (the cols and rows settings) or "auto". */
export function boardFor(s: { board?: unknown; cols?: unknown; rows?: unknown }, seats: number): [number, number] {
  if (s.board === "custom") {
    const fit = (v: unknown, min: number, max: number, fallback: number) => Math.max(min, Math.min(max, Math.round(Number(v)) || fallback));
    return [fit(s.cols, 4, 12, 7), fit(s.rows, 4, 20, 11)];
  }
  const b = typeof s.board === "string" ? BOARDS[s.board] : undefined;
  return b ?? (seats <= 4 ? BOARDS.medium! : BOARDS.large!);
}

export const BOT_NAMES = ["Nova", "Pip", "Juno", "Moss", "Rex", "Kit", "Olive", "Ziggy"];

/** How long a move takes to play out: the placing beat, then each wave (long chains speed up). Phones and host agree. */
export const PLACE_MS = 220;
export const waveMs = (waves: number) => Math.max(70, Math.min(260, 4200 / Math.max(1, waves)));
export const moveMs = (waves: number) => PLACE_MS + waves * waveMs(waves) + 150;

export interface SeatView {
  id: string;
  name: string;
  color: string;
  alive: boolean;
  bot: boolean;
  /** Their phone dropped or is on another app. */
  away: boolean;
  pieces: number;
  wins: number;
}

export interface BoardView {
  w: number;
  h: number;
  /** One character per cell: "." empty, else the owner's seat (0–7). */
  owner: string;
  /** One digit per cell: pieces in it. */
  count: string;
}

export interface CascadeShared {
  phase: "play" | "end";
  round: number;
  seats: SeatView[];
  /** Whose turn it is, or -1 while a move plays out (or before the first turn). */
  turn: number;
  /** Who is moving right now (also while their move plays out), -1 if nobody. */
  active: number;
  /** Turn timer: ms left when this was sent (0 = no timer), out of `timeTotal`. */
  timeLeft: number;
  timeTotal: number;
  winner: number;
  /** Once a round is over: seats in finishing order, winner first. */
  standings: number[];
  /** People who joined mid-game: they're dealt in next round. */
  watching: string[];
  /** The board as it stands once the last move has played out. */
  board: BoardView;
  /** A short line for everyone: "Round 2 · Nova starts", "Kit is out". */
  note: string;
  /** Bumped by every move: a phone that missed a move's message just snaps to `board`. */
  moves: number;
}

export interface CascadeOwn {
  seat: number;
  color: string;
}

export type CascadeToHost = { type: "place"; cell: number } | { type: "again" };

export interface CascadeGame {
  toHost: CascadeToHost;
  toController: { type: "buzz"; kind: string } | { type: "move"; n: number; move: Move };
  input: never;
  shared: CascadeShared;
  own: CascadeOwn;
}
