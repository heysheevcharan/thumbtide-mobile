import type { Controller, Host } from "@thumbtide/sdk";

// ----------------------------------------------------------------------------------------------- controls
// Each game describes its phone controller in a .pad file (see kit/pad.ts): which controls it has and how they
// feel. The platform builds the phone gamepad and the help sheet from it.

import type { PadSpec } from "./kit/pad.ts";
export type { PadSpec };

export type ControlIcon = "splat" | "dash" | "pulse" | "jump" | "action" | "special" | "eye";

// ----------------------------------------------------------------------------------------------- settings
// What the host can change for a game (from the VIP's phone, in the lobby or mid-game).

export type SettingValue = string | number | boolean;
export type Settings = Record<string, SettingValue>;

export interface SettingDef {
  key: string;
  label: string;
  options: { value: SettingValue; label: string }[];
  default: SettingValue;
  /** "now" applies straight away; "round" from the next round (default). */
  applies?: "now" | "round";
  /** Only shown while another setting has this value (e.g. a board's width once "Custom" is picked). */
  when?: { key: string; value: SettingValue };
  /** Fine-tuning most hosts never touch: shown under "More settings", folded away by default. */
  advanced?: boolean;
}

export function defaultSettings(defs: SettingDef[] = []): Settings {
  return Object.fromEntries(defs.map((d) => [d.key, d.default]));
}

// ----------------------------------------------------------------------------------------------- shell state
// What every phone knows about the room besides the game itself. Sent as a $sys message whenever it
// changes, and again to anyone who (re)joins.

export interface ShellState {
  vip: string | null;
  game: string;
  paused: boolean;
  /** Who paused (a player's id), or null when the TV did or nobody is known. */
  pausedBy: string | null;
  /** The current game supports pause/restart. */
  canPause: boolean;
  /** Settings of the current game, or of the game the VIP is looking at in the lobby. */
  settings: Settings;
  locked: boolean;
  /** Lobby: the game the VIP is looking at (the TV shows its card). */
  selected: string | null;
  /** `away`: the phone is on another app or locked (the seat waits for them; see HostPlayer.away). */
  players: { id: string; name: string; connected: boolean; away: boolean }[];
}

export type SysMessage =
  // phone → screen (VIP only)
  | { $sys: "start"; game: string }
  | { $sys: "exit" }
  | { $sys: "pause" }
  | { $sys: "resume" }
  | { $sys: "restart" }
  | { $sys: "setting"; game: string; key: string; value: SettingValue }
  | { $sys: "kick"; id: string }
  | { $sys: "lock"; locked: boolean }
  | { $sys: "select"; game: string | null }
  // screen → phone
  | { $sys: "shell"; state: ShellState };

export const isSys = (d: unknown): d is SysMessage => !!d && typeof d === "object" && "$sys" in d;

// ----------------------------------------------------------------------------------------------- mounting

export interface HostContext {
  host: Host;
  root: HTMLElement;
  /** Return to the lobby. */
  exit(): void;
  /** This game's current settings. */
  settings(): Settings;
  /** Settings changed (by the host, from the VIP's phone). Returns unsubscribe. */
  onSettings(fn: (s: Settings) => void): () => void;
}

/** What a mounted game gives the shell. Pause/restart are optional; games that have them get the host menu items. */
export interface GameHandle {
  dispose(): void;
  pause?(): void;
  resume?(): void;
  restart?(): void;
}

export interface ControllerContext {
  ctl: Controller;
  root: HTMLElement;
  /** True if this player currently has menu control (first connected player). */
  isVip(): boolean;
  /** Called whenever VIP status may have changed. Returns unsubscribe. */
  onVip(fn: () => void): () => void;
  /** Room-level state: paused, settings, who's VIP. */
  shell(): ShellState | null;
  onShell(fn: (s: ShellState) => void): () => void;
  /** VIP only: start a game / return to the lobby. */
  startGame(id: string): void;
  exitToLobby(): void;
  /** VIP only: send any host command. */
  sys(msg: SysMessage): void;
}

/** Mount a game into `root`. Returns a cleanup function or a handle. */
export type HostMount = (ctx: HostContext) => GameHandle | (() => void);
export type ControllerMount = (ctx: ControllerContext) => () => void;

export interface GameDef {
  id: string;
  title: string;
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
  /** Two colours for the game's card. */
  colors?: [string, string];
  /** Lobby card, 480×270 WebP (games/<id>/thumb/card.webp, filled in by games/thumbs.ts). Beats `cover`. */
  thumb?: string;
  /** Lobby background, 160×90 WebP, scaled up to full screen for a free blur (thumb/bg.webp). */
  thumbBg?: string;
  /** Cover art for the library (an image URL). Games without one get a cover drawn from colors + glyph. */
  cover?: string;
  /** Icon for the drawn cover and small tiles. */
  glyph?: ControlIcon;
  /** The phone controller, parsed from the game's .pad file. */
  controls?: PadSpec;
  settings?: SettingDef[];
  /** Hidden games (lobby) don't appear in the picker. */
  hidden?: boolean;
  host: () => Promise<{ default: HostMount }>;
  controller: () => Promise<{ default: ControllerMount }>;
}
