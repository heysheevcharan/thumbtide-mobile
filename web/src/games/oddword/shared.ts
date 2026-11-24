// What the TV and the phones share. The word and who is the odd one out never go in `shared` before the reveal:
// each phone gets its own word in `own` (rules.ts builds both views, and rules.test.ts checks that nothing leaks).
import type { Mode } from "./words.ts";

export type { Mode };
export type Phase = "describe" | "vote" | "reveal";
/** decoy: the odd one gets a close word and doesn't know; blank: the odd one gets no word and knows. */
export type Hint = "decoy" | "blank";

/** Seat colours: bright, and each reads on all three stage colours with the dark outline. */
export const SEAT_COLORS = ["#ffd23f", "#4cc9f0", "#b5e550", "#ff8fd8", "#ffffff", "#a98bff", "#ff6b6b", "#6ef0c8"];
/** The eight character shapes (view.ts and the phone draw them), one per seat. */
export const SHAPES = 8;

export interface SeatView {
  id: string;
  name: string;
  color: string;
  /** Character shape, 0 to SHAPES - 1. */
  shape: number;
  bot: boolean;
  /** The phone dropped or is on another app: the round doesn't wait for them. */
  away: boolean;
  /** Dealt into this round (people who joined mid-round wait for the next). */
  playing: boolean;
}

export interface Reveal {
  word: string;
  /** The odd one's word in decoy mode, "" in blank mode. */
  decoy: string;
  impostor: string;
  /** Kept here too: the odd one may have left. */
  impostorName: string;
  /** Who was voted out: null on a tie or with no votes. */
  out: string | null;
  tie: boolean;
  caught: boolean;
  /** The odd one left mid-round, so the round ended early. */
  left: boolean;
  /** Voter id → who they voted for. */
  votes: Record<string, string>;
}

export interface OddShared {
  phase: Phase;
  mode: Mode;
  hint: Hint;
  round: number;
  seats: SeatView[];
  /** Speaking order this round (ids). */
  order: string[];
  /** Describe: who has pressed Done. */
  done: string[];
  /** Vote: who has voted (not for whom). */
  voted: string[];
  /** Only in the reveal. */
  reveal: Reveal | null;
  /** Reveal: whole seconds to the next round. */
  next: number;
}

export interface OddOwn {
  color: string;
  shape: number;
  playing: boolean;
  /** Your word; "" for the odd one in blank mode (then `odd` is true). */
  word: string;
  /** True only when you know you are the odd one (blank mode). Decoy mode never tells you. */
  odd: boolean;
  done: boolean;
  /** Who you voted for. */
  vote: string | null;
  /** Ids you may vote for. */
  targets: string[];
  round: number;
}

export type OddToHost = { type: "done" } | { type: "vote"; target: string } | { type: "next" };

export interface OddGame {
  toHost: OddToHost;
  toController: { type: "buzz"; kind: "round" | "vote" | "caught" | "escaped" };
  input: never;
  shared: OddShared | null;
  own: OddOwn;
}
