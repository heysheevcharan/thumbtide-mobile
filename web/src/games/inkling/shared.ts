/** Message shapes for Inkling. */
import type { Phase } from "./rules.ts";

export interface InkShared {
  phase: Phase;
  /** Turn number and turns in the match. */
  turn: number;
  turns: number;
  round: number;
  rounds: number;
  /** The artist's id, name and colour ("" when nobody draws). */
  artistId: string;
  artist: string;
  artistColor: string;
  /** The word as blanks while drawing ("_" per hidden letter); the whole word in the reveal. */
  mask: string;
  /** Whole seconds left in this phase, and the phase's length. */
  left: number;
  total: number;
  /** Ids of the players who have the word this turn. */
  got: string[];
  /** The match winners' names (match phase). */
  winners: string[];
  /** Everyone at the table, best score first. */
  scores: { id: string; name: string; color: string; score: number; gained: number; got: boolean; away: boolean }[];
  /** Reveal: how the turn ended ("Everyone got it!") and who draws next. */
  why: string;
  next: string;
}

export interface InkChoice {
  w: string;
  d: 1 | 2 | 3;
  /** Points per right guess for the artist. */
  pts: number;
}

export interface InkOwn {
  name: string;
  color: string;
  /** artist: draws this turn; guess: guesses; watch: no seat. */
  role: "artist" | "guess" | "watch";
  /** The three words on offer (the artist, while picking). */
  choices: InkChoice[];
  /** The artist's word while drawing, a guesser's once they have it. */
  word: string;
  got: boolean;
  /** Points this turn, and in all. */
  gained: number;
  score: number;
  rank: number;
  /** The turn this applies to (a new turn clears the phone's sheet). */
  turn: number;
  /** For an artist's phone that came back mid-turn: the TV's strokes, encoded (rules.ts encodeStrokes). */
  restore: { seq: number; next: number; s: string } | null;
}

export interface InkGame {
  toHost:
    | { type: "pick"; i: number }
    | { type: "ink"; k: number; s: number; c: number; w: number; p: number[]; e?: 1 }
    | { type: "undo"; k: number }
    | { type: "clear"; k: number }
    | { type: "guess"; text: string }
    | { type: "sync" }
    | { type: "again" };
  input: Record<string, never>;
  toController:
    | { type: "said"; text: string; how: "right" | "close" | "wrong"; points: number }
    | { type: "buzz"; kind: "turn" | "got" | "end" }
    /** The drawing, for everyone but the artist: all of it (`full`) or the points added since the last one. */
    | { type: "sheet"; turn: number; rev: number; full?: string; at?: number; off?: number; s?: [number, number, number, number[]][] }
    /** A guess for the feed (wrong guesses show their text; right ones don't give the word away). */
    | { type: "feed"; name: string; color: string; text: string; right: boolean; first: boolean };
  shared: InkShared | null;
  own: InkOwn;
}
