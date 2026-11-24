// What the TV and the phones share: the public table (everyone sees it) and each player's secrets (only they do).
import type { InkTone } from "../kit/inked.ts";
import type { Law, Party, Phase, Power, Role, WinReason } from "./rules.ts";

export type { Law, Party, Phase, Power, Role, WinReason };

// ------------------------------------------------------------------ the printed art
// Made with `pnpm art cult` (prompts in web/art/cult.mjs), served from web/public/art/cult/.

export const ART = [
  "backdrop", "cover", "town-law", "cult-law", "card-back", "prophet", "role-town", "role-cult",
  "power-investigate", "power-peek", "power-pick", "power-burn", "badge-mayor", "badge-sheriff", "win-town", "win-cult",
] as const;
export type ArtName = (typeof ART)[number];

/** An absolute URL, so it also works from CSS variables and inside the TV app (file://). */
export const art = (name: ArtName) => new URL(`${import.meta.env.BASE_URL}art/cult/${name}.webp`, location.href).href;

/** Sets --art-<name> on an element for every piece, for the stylesheet to use. */
export function artVars(el: HTMLElement) {
  for (const n of ART) el.style.setProperty(`--art-${n}`, `url("${art(n)}")`);
}

export const ROLE_ART: Record<Role, ArtName> = { town: "role-town", cult: "role-cult", prophet: "prophet" };
export const POWER_ART: Record<Power, ArtName> = {
  investigate: "power-investigate",
  peek: "power-peek",
  pick: "power-pick",
  burn: "power-burn",
};

/** Seat colours: picked so none reads as either team's colour. */
export const SEAT_COLORS = ["#ffd23f", "#7cf29a", "#c18cff", "#ff9f43", "#ff6ad5", "#2de2c9", "#f4f3ff", "#a3e048", "#ffb3c6", "#9ad1d4"];

export const ROLE_NAME: Record<Role, string> = { town: "Town", cult: "Cult", prophet: "The Prophet" };
export const ROLE_TONE: Record<Role, InkTone> = { town: "town", cult: "cult", prophet: "prophet" };

export const POWER_NAME: Record<Power, string> = {
  investigate: "Investigate",
  peek: "Peek",
  pick: "Pick the next Mayor",
  burn: "Burn",
};

export const WIN_LINE: Record<WinReason, Record<Party, string>> = {
  laws: { town: "Five town laws", cult: "Six cult laws" },
  "prophet-elected": { town: "", cult: "The Prophet became Sheriff" },
  "prophet-burned": { town: "The Prophet burned", cult: "" },
};

export interface SeatView {
  id: string;
  name: string;
  color: string;
  alive: boolean;
  /** A computer player (or one standing in for someone who left). */
  bot: boolean;
  /** Their phone dropped; the game waits for them. */
  away: boolean;
}

export interface CultShared {
  phase: Phase;
  seats: SeatView[];
  mayor: number;
  sheriff: number | null;
  /** Nominate: who the Mayor can pick. */
  eligible: number[];
  /** Vote: who has voted (how stays hidden until everyone has). */
  voted: number[];
  /** Tally: everyone's vote. */
  votes: (boolean | null)[] | null;
  passed: boolean | null;
  town: number;
  cult: number;
  unrest: number;
  deck: number;
  /** The power under each cult law slot. */
  powers: (Power | null)[];
  power: Power | null;
  /** Power: who the Mayor can use it on. */
  targets: number[];
  target: number | null;
  law: Law | null;
  riot: boolean;
  vetoOpen: boolean;
  /** Roles: who has looked and is ready. */
  ready: number[];
  winner: Party | null;
  reason: WinReason | null;
  /** Everyone's role, once the game is over. */
  roles: Role[] | null;
  /** People who joined mid-game; they're dealt in next game. */
  watching: string[];
}

export interface CultOwn {
  seat: number;
  color: string;
  role: Role;
  /** Who you know is cult (cult members, and the Prophet at small tables). */
  allies: { seat: number; role: Role }[];
  /** Cards you hold right now (the Mayor's three, the Sheriff's two). */
  hand: Law[] | null;
  /** Peek: the next three cards. */
  peek: Law[] | null;
  /** What your investigations turned up. */
  found: { seat: number; party: Party }[];
  vote: boolean | null;
  ready: boolean;
  /** Sheriff, late game: you can ask the Mayor to throw both cards away. */
  canVeto: boolean;
}

export type CultToHost =
  | { type: "ready" }
  | { type: "vote"; yes: boolean }
  | { type: "pick"; seat: number }
  | { type: "card"; i: number }
  | { type: "veto" }
  | { type: "veto-answer"; yes: boolean }
  | { type: "done" }
  | { type: "again" };

export interface CultGame {
  toHost: CultToHost;
  toController: { type: "buzz"; kind: string } | { type: "banner"; text: string; tone: InkTone; sub: string; ms: number; art?: ArtName };
  input: never;
  shared: CultShared;
  own: CultOwn;
}
