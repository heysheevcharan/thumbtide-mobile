/**
 * Wire protocol shared by the relay server and the browser SDK.
 *
 * Roles:
 *  - host:       the big screen. Owns the room and runs the game logic.
 *  - controller: a phone. Sends input to the host, renders what the host tells it.
 *
 * The relay is deliberately dumb: it routes messages and tracks who is in the
 * room. All game logic lives on the host.
 */

export const PROTOCOL_VERSION = 1;

/** Letters only, no vowels (avoids accidental words) and no look-alikes. */
export const ROOM_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const ROOM_CODE_LENGTH = 4;

export const LIMITS = {
  /** Max bytes for a single incoming frame. */
  maxMessageBytes: 16 * 1024,
  /** Max player name length. */
  maxNameLength: 20,
  /** Hard cap on players per room (host may set lower). */
  maxPlayers: 16,
  /** How long a dropped controller keeps its slot (ms). */
  playerGraceMs: 60_000,
  /**
   * How long a controller that said it was away (its page went to the background: another app, the screen
   * locked) keeps its slot (ms), counted from when it went away, with or without its socket. The phone is
   * still in someone's hand.
   */
  awayGraceMs: 10 * 60_000,
  /** How long a room survives without its host (ms) — covers a page refresh. */
  hostGraceMs: 90_000,
  /** Token bucket per socket: sustained msgs/sec and burst size. */
  ratePerSec: 90,
  rateBurst: 180,
  /**
   * The host's own bucket. It talks to every phone, so its traffic grows with the room: a lobby with 16 phones
   * sends a few hundred sticky-state updates as they all join, and dropped sticky state leaves phones stale.
   */
  hostRatePerSec: 600,
  hostRateBurst: 1200,
} as const;

export type PlayerId = string;

export interface PlayerInfo {
  id: PlayerId;
  name: string;
  /** Join order, starting at 0. Stable across reconnects. Handy for colors / "VIP". */
  index: number;
  connected: boolean;
  /**
   * The phone's page is in the background (another app, the screen locked): the player is still there and
   * will be back. Set and cleared only by the phone; it can be true while `connected` is either value.
   */
  away: boolean;
}

export interface RoomConfig {
  /** Which game the room is currently running; controllers load the matching UI. */
  game: string;
  maxPlayers: number;
  /** When locked, new players can't join (existing ones can still reconnect). */
  locked: boolean;
}

/** Recipient selector for host → controller messages. Omitted = everyone. */
export type Target = PlayerId | PlayerId[] | undefined;

// ---------------------------------------------------------------------------
// Connection URL query params
//   host:       ?role=host[&token=<hostToken>]              (token = resume)
//   controller: ?role=controller&room=ABCD&name=Sam[&token=<playerToken>]
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Host → Server
// ---------------------------------------------------------------------------
export type HostToServer =
  /** Discrete message to one, some, or all players. */
  | { t: "msg"; to?: Target; d: unknown }
  /** Sticky state: stored by the relay and replayed to controllers that (re)connect. */
  | { t: "state"; to?: Target; d: unknown }
  | { t: "config"; d: Partial<RoomConfig> }
  | { t: "kick"; id: PlayerId }
  | { t: "close" }
  | { t: "ping"; ts: number };

// ---------------------------------------------------------------------------
// Server → Host
// ---------------------------------------------------------------------------
export type ServerToHost =
  | {
      t: "welcome";
      room: string;
      token: string;
      config: RoomConfig;
      players: PlayerInfo[];
      resumed: boolean;
    }
  | { t: "join"; p: PlayerInfo }
  /** Player socket dropped; slot is held for `LIMITS.playerGraceMs`. */
  | { t: "drop"; id: PlayerId }
  | { t: "rejoin"; p: PlayerInfo }
  /** Player's phone went to the background (`away`) or came back. */
  | { t: "away"; id: PlayerId; away: boolean }
  /** Player is gone for good (grace expired, kicked, or left). */
  | { t: "remove"; id: PlayerId; reason: RemoveReason }
  | { t: "msg"; from: PlayerId; d: unknown }
  /** Continuous input snapshot (latest-wins). */
  | { t: "in"; from: PlayerId; d: unknown }
  | { t: "pong"; ts: number }
  | { t: "error"; code: ErrorCode; message: string };

// ---------------------------------------------------------------------------
// Controller → Server
// ---------------------------------------------------------------------------
export type ControllerToServer =
  | { t: "msg"; d: unknown }
  | { t: "in"; d: unknown }
  /** The page went to the background (true) or is back (false). Sent on every change and after every welcome. */
  | { t: "away"; away: boolean }
  | { t: "leave" }
  | { t: "ping"; ts: number };

// ---------------------------------------------------------------------------
// Server → Controller
// ---------------------------------------------------------------------------
export type ServerToController =
  | {
      t: "welcome";
      room: string;
      token: string;
      you: PlayerInfo;
      config: RoomConfig;
      hostConnected: boolean;
      /** Sticky state for everyone + sticky state for this player. */
      shared: unknown;
      own: unknown;
      resumed: boolean;
    }
  | { t: "msg"; d: unknown }
  | { t: "state"; scope: "shared" | "own"; d: unknown }
  | { t: "config"; config: RoomConfig }
  | { t: "host"; connected: boolean }
  | { t: "closed"; reason: CloseReason }
  | { t: "pong"; ts: number }
  | { t: "error"; code: ErrorCode; message: string };

export type RemoveReason = "timeout" | "kicked" | "left";
/**
 * `away-timeout`: the phone stayed away (another app, locked) past `LIMITS.awayGraceMs` and its seat was freed.
 * Sent when it happens (socket open) or when the phone reconnects later with that seat's token (it was offline).
 * `away-timeout-locked`: the same, and the room is locked now, so joining again must wait for the lobby.
 */
export type CloseReason = "host-closed" | "host-timeout" | "kicked" | "left" | "away-timeout" | "away-timeout-locked";

export type ErrorCode =
  | "bad-request"
  | "room-not-found"
  | "room-full"
  | "room-locked"
  | "bad-token"
  | "too-large"
  | "rate-limited"
  | "server-full";

/**
 * WebSocket close codes the server uses for terminal conditions. Clients must
 * NOT auto-reconnect after receiving one of these.
 */
export const CLOSE_CODES = {
  roomNotFound: 4004,
  roomFull: 4005,
  roomLocked: 4006,
  badToken: 4007,
  kicked: 4008,
  roomClosed: 4009,
  badRequest: 4000,
  serverFull: 4010,
  left: 4011,
  /** Same host/player connected again from elsewhere (e.g. a second tab). */
  replaced: 4012,
} as const;

export const TERMINAL_CLOSE_CODES: ReadonlySet<number> = new Set(Object.values(CLOSE_CODES));

export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z]/g, "").slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}
