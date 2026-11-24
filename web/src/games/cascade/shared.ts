// What the TV and the phones share. The board itself lives on the TV; phones only need whose turn it is.

export const LOOKS = ["culture", "marbles", "reactor"] as const;
export type LookId = (typeof LOOKS)[number];
export const isLook = (v: unknown): v is LookId => LOOKS.includes(v as LookId);

/** Board sizes (cells across, down). "auto" picks by how many are playing. */
export const BOARDS: Record<string, [number, number]> = {
  small: [7, 5],
  medium: [9, 6],
  large: [11, 7],
  xl: [14, 8],
  huge: [18, 10],
};
/** The board for the settings: a size, "custom" (the cols and rows settings, up to 20 × 12) or "auto". */
export function boardFor(s: { board?: unknown; cols?: unknown; rows?: unknown }, seats: number): [number, number] {
  if (s.board === "custom") {
    const fit = (v: unknown, min: number, max: number, fallback: number) => Math.max(min, Math.min(max, Math.round(Number(v)) || fallback));
    return [fit(s.cols, 4, 20, 12), fit(s.rows, 3, 12, 8)];
  }
  const b = typeof s.board === "string" ? BOARDS[s.board] : undefined;
  return b ?? (seats <= 4 ? BOARDS.medium! : BOARDS.large!);
}

export const BOT_NAMES = ["Nova", "Pip", "Juno", "Moss", "Rex", "Kit", "Olive", "Ziggy"];

export interface SeatView {
  id: string;
  name: string;
  color: string;
  alive: boolean;
  bot: boolean;
  /** Their phone dropped; the game plays for them when it's their turn. */
  away: boolean;
  pieces: number;
  wins: number;
}

export interface CascadeShared {
  phase: "play" | "end";
  round: number;
  seats: SeatView[];
  /** Whose turn it is, or -1 while a move plays out. */
  turn: number;
  /** Turn timer: ms left when this was sent (0 = no timer), out of `timeTotal`. */
  timeLeft: number;
  timeTotal: number;
  winner: number;
  /** Once a round is over: seats in finishing order, winner first. */
  standings: number[];
  /** People who joined mid-game: they're dealt in next round. */
  watching: string[];
}

export interface CascadeOwn {
  seat: number;
  color: string;
}

export type CascadeToHost = { type: "move"; dx: number; dy: number } | { type: "place" } | { type: "again" };

export interface CascadeGame {
  toHost: CascadeToHost;
  toController: { type: "buzz"; kind: string };
  input: never;
  shared: CascadeShared;
  own: CascadeOwn;
}
