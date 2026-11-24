/**
 * The relay's room logic, running inside the browser of the phone that created the room (Thumbtide Mobile has no
 * server). Ported unchanged from the desktop relay (server/src/rooms.ts in thumbtide), with Web Crypto for the
 * random tokens and a snapshot so a refresh of the hosting phone keeps everyone's seat.
 */
import {
  CLOSE_CODES,
  LIMITS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type ControllerToServer,
  type HostToServer,
  type PlayerInfo,
  type RemoveReason,
  type RoomConfig,
  type ServerToController,
  type ServerToHost,
  type Target,
} from "@thumbtide/sdk";

export interface Conn {
  send(data: string): void;
  close(code: number, reason: string): void;
  /** Bytes queued but not yet sent; used to drop droppable traffic under load. */
  bufferedAmount(): number;
}

const DROPPABLE_BUFFER_LIMIT = 256 * 1024;

export interface ManagerOptions {
  maxRooms?: number;
  playerGraceMs?: number;
  /** How long a phone may stay away (connected or not) before its seat goes (default LIMITS.awayGraceMs). */
  awayGraceMs?: number;
  hostGraceMs?: number;
  /** A dropped seat can go to a newcomer in a full room only after it has been empty this long (default 10 s). */
  ghostMinMs?: number;
}

interface Player {
  info: PlayerInfo;
  token: string;
  conn: Conn | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
  /** Runs while the phone says it's away (connected or not): the seat goes when it runs out. */
  awayTimer: ReturnType<typeof setTimeout> | null;
  /** When the socket dropped (Date.now()), 0 while connected. */
  droppedAt: number;
  ownState: unknown;
}

const cleanName = (raw: string) => raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, LIMITS.maxNameLength);

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const token = () => b64url(randomBytes(18));
/** How long a room remembers the token of a seat the away limit freed while its phone was offline. */
const LOST_SEAT_MEMORY_MS = 60 * 60_000;
/** At most this many remembered tokens per room (oldest go first). */
const LOST_SEAT_MAX = 64;
const shortId = () => hex(randomBytes(4));

function sendHost(conn: Conn, msg: ServerToHost) {
  conn.send(JSON.stringify(msg));
}
function sendCtl(conn: Conn, msg: ServerToController) {
  conn.send(JSON.stringify(msg));
}

export class Room {
  host: Conn | null = null;
  hostToken = token();
  config: RoomConfig = { game: "lobby", maxPlayers: 8, locked: false };
  players = new Map<string, Player>();
  sharedState: unknown = null;
  private nextIndex = 0;
  /**
   * Tokens of seats the away limit freed while their phone was offline, with when they were freed: when that phone
   * reconnects, it is told its seat was given up (instead of quietly getting a new seat, or "room locked").
   */
  private lostAway = new Map<string, number>();
  private hostGraceTimer: ReturnType<typeof setTimeout> | null = null;
  closed = false;

  constructor(
    readonly code: string,
    private readonly mgr: RoomManager,
  ) {}

  // ---------------------------------------------------------------- host

  attachHost(conn: Conn, resumed: boolean) {
    if (this.host && this.host !== conn) {
      this.host.close(CLOSE_CODES.replaced, "replaced by a newer host connection");
    }
    this.host = conn;
    if (this.hostGraceTimer) clearTimeout(this.hostGraceTimer);
    this.hostGraceTimer = null;

    sendHost(conn, {
      t: "welcome",
      room: this.code,
      token: this.hostToken,
      config: this.config,
      players: [...this.players.values()].map((p) => p.info),
      resumed,
    });
    if (resumed) this.broadcastCtl({ t: "host", connected: true });
  }

  detachHost(conn: Conn) {
    if (this.host !== conn) return;
    this.host = null;
    this.broadcastCtl({ t: "host", connected: false });
    this.hostGraceTimer = setTimeout(() => this.close("host-timeout"), this.mgr.hostGraceMs);
  }

  onHostMessage(msg: HostToServer) {
    switch (msg.t) {
      case "msg": {
        const out = JSON.stringify({ t: "msg", d: msg.d } satisfies ServerToController);
        for (const p of this.resolve(msg.to)) p.conn?.send(out);
        break;
      }
      case "state": {
        if (msg.to === undefined) {
          this.sharedState = msg.d;
          this.broadcastCtl({ t: "state", scope: "shared", d: msg.d });
        } else {
          const out = JSON.stringify({ t: "state", scope: "own", d: msg.d } satisfies ServerToController);
          for (const p of this.resolve(msg.to)) {
            p.ownState = msg.d;
            p.conn?.send(out);
          }
        }
        break;
      }
      case "config": {
        const d = msg.d ?? {};
        if (typeof d.game === "string" && d.game.length <= 64) this.config.game = d.game;
        if (typeof d.locked === "boolean") this.config.locked = d.locked;
        if (typeof d.maxPlayers === "number" && Number.isFinite(d.maxPlayers)) {
          this.config.maxPlayers = Math.max(1, Math.min(LIMITS.maxPlayers, Math.floor(d.maxPlayers)));
        }
        this.broadcastCtl({ t: "config", config: this.config });
        break;
      }
      case "kick": {
        const p = this.players.get(msg.id);
        if (p) this.removePlayer(p, "kicked");
        break;
      }
      case "close":
        this.close("host-closed");
        break;
      case "ping":
        if (this.host) sendHost(this.host, { t: "pong", ts: msg.ts });
        break;
    }
  }

  // ---------------------------------------------------------- controller

  /** Returns the player, or a close code if the join was refused. */
  joinController(conn: Conn, name: string, playerToken: string | null): Player | number {
    // Reconnect with a known token → take over the existing slot.
    if (playerToken) {
      for (const p of this.players.values()) {
        if (p.token === playerToken) return this.resume(p, conn);
      }
      // The away limit gave this phone's seat up while it was offline: say so. Not only once: a phone coming back
      // often opens two sockets in a row (back online, and visible again) and the first answer can be lost with
      // the socket it dropped. The SDK forgets the token when told, so joining again is a new tap without it.
      const lostAt = this.lostAway.get(playerToken);
      if (lostAt !== undefined && Date.now() - lostAt < LOST_SEAT_MEMORY_MS) {
        sendCtl(conn, { t: "closed", reason: this.awayTimeoutReason() });
        return CLOSE_CODES.left;
      }
      // Unknown/expired token: fall through and join as a new player.
    }

    // A locked room lets nobody in without a token (also not by name: anyone can read a name off the TV).
    if (this.config.locked) return CLOSE_CODES.roomLocked;

    // No usable token, but a disconnected player has this name: it's the same person back without their token
    // (the QR code opened a new tab, or the browser dropped the tab). Give them their seat back instead of a
    // second seat ("Sam 2") next to their own ghost. New token, so the old tab can't take it back.
    const wanted = cleanName(name).toLowerCase();
    if (wanted) {
      for (const p of this.players.values()) {
        if (p.conn || p.info.name.toLowerCase() !== wanted) continue;
        p.token = token();
        return this.resume(p, conn);
      }
    }

    if (this.players.size >= this.config.maxPlayers) {
      // Full, but some seats may belong to phones that dropped and are still in their grace period.
      // A real person at the door beats a ghost: free the seat that has been empty longest, if it has been empty
      // for ghostMinMs (a phone whose Wi-Fi blips for a second keeps its seat). A phone that said it was away
      // (another app, the screen locked) is still in its player's hand: its seat is not a ghost.
      let ghost: Player | null = null;
      for (const p of this.players.values()) {
        if (!p.conn && !p.info.away && Date.now() - p.droppedAt >= this.mgr.ghostMinMs && (!ghost || p.droppedAt < ghost.droppedAt)) ghost = p;
      }
      if (!ghost) return CLOSE_CODES.roomFull;
      this.removePlayer(ghost, "timeout");
    }

    const p: Player = {
      info: { id: shortId(), name: this.uniqueName(name), index: this.nextIndex++, connected: true, away: false },
      token: token(),
      conn,
      graceTimer: null,
      awayTimer: null,
      droppedAt: 0,
      ownState: null,
    };
    this.players.set(p.info.id, p);
    this.welcomeCtl(p, false);
    if (this.host) sendHost(this.host, { t: "join", p: p.info });
    return p;
  }

  private resume(p: Player, conn: Conn): Player {
    if (p.conn && p.conn !== conn) p.conn.close(CLOSE_CODES.replaced, "replaced by a newer connection");
    if (p.graceTimer) clearTimeout(p.graceTimer);
    p.graceTimer = null;
    p.conn = conn;
    p.droppedAt = 0;
    p.info.connected = true;
    this.welcomeCtl(p, true);
    if (this.host) sendHost(this.host, { t: "rejoin", p: p.info });
    return p;
  }

  detachController(p: Player, conn: Conn) {
    if (p.conn !== conn) return; // an old socket closing after a reconnect
    p.conn = null;
    p.droppedAt = Date.now();
    p.info.connected = false;
    if (!this.players.has(p.info.id)) return;
    if (this.host) sendHost(this.host, { t: "drop", id: p.info.id });
    // Away first (the page went to the background), then the socket died: the phone is still in use, so the
    // seat waits for the away timer instead. A drop with no "away" before it is a real disconnect.
    if (p.info.away) return;
    p.graceTimer = setTimeout(() => this.removePlayer(p, "timeout"), this.mgr.playerGraceMs);
  }

  onControllerMessage(p: Player, msg: ControllerToServer) {
    switch (msg.t) {
      case "msg":
        if (this.host) sendHost(this.host, { t: "msg", from: p.info.id, d: msg.d });
        break;
      case "in":
        // Continuous input is latest-wins, so it's safe to drop under backpressure.
        if (this.host && this.host.bufferedAmount() < DROPPABLE_BUFFER_LIMIT) {
          sendHost(this.host, { t: "in", from: p.info.id, d: msg.d });
        }
        break;
      case "away": {
        // The phone owns this flag: the relay never clears it on a drop or a reconnect.
        // Away has its own limit, from when it starts: a hidden phone can keep its socket (or reconnect in the
        // background), and its seat must still go in the end.
        const away = msg.away === true;
        if (p.info.away === away) break;
        p.info.away = away;
        if (p.awayTimer) clearTimeout(p.awayTimer);
        p.awayTimer = away ? setTimeout(() => this.awayExpired(p), this.mgr.awayGraceMs) : null;
        if (this.host) sendHost(this.host, { t: "away", id: p.info.id, away });
        break;
      }
      case "leave":
        this.removePlayer(p, "left");
        break;
      case "ping":
        if (p.conn) sendCtl(p.conn, { t: "pong", ts: msg.ts });
        break;
    }
  }

  // ------------------------------------------------------------- helpers

  private welcomeCtl(p: Player, resumed: boolean) {
    if (!p.conn) return;
    sendCtl(p.conn, {
      t: "welcome",
      room: this.code,
      token: p.token,
      you: p.info,
      config: this.config,
      hostConnected: this.host !== null,
      shared: this.sharedState,
      own: p.ownState,
      resumed,
    });
  }

  private removePlayer(p: Player, reason: RemoveReason) {
    if (!this.players.delete(p.info.id)) return;
    if (p.graceTimer) clearTimeout(p.graceTimer);
    if (p.awayTimer) clearTimeout(p.awayTimer);
    p.graceTimer = p.awayTimer = null;
    if (p.conn) {
      if (reason === "kicked") {
        sendCtl(p.conn, { t: "closed", reason: "kicked" });
        p.conn.close(CLOSE_CODES.kicked, "kicked");
      } else if (reason === "timeout") {
        // only the away limit times out a seat whose socket is still open: say so, not "you left"
        sendCtl(p.conn, { t: "closed", reason: this.awayTimeoutReason() });
        p.conn.close(CLOSE_CODES.left, "away too long");
      } else {
        p.conn.close(CLOSE_CODES.left, "left");
      }
      p.conn = null;
    }
    if (this.host) sendHost(this.host, { t: "remove", id: p.info.id, reason });
  }

  /** The away limit ran out. A phone that is offline hears about it when it reconnects (its token is remembered). */
  private awayExpired(p: Player) {
    if (!p.conn) {
      const now = Date.now();
      for (const [tok, at] of this.lostAway) if (now - at >= LOST_SEAT_MEMORY_MS || this.lostAway.size >= LOST_SEAT_MAX) this.lostAway.delete(tok);
      this.lostAway.set(p.token, now);
    }
    this.removePlayer(p, "timeout");
  }

  private awayTimeoutReason() {
    return this.config.locked ? ("away-timeout-locked" as const) : ("away-timeout" as const);
  }

  private resolve(to: Target): Player[] {
    if (to === undefined) return [...this.players.values()];
    const ids = Array.isArray(to) ? to : [to];
    const out: Player[] = [];
    for (const id of ids) {
      const p = typeof id === "string" ? this.players.get(id) : undefined;
      if (p) out.push(p);
    }
    return out;
  }

  private broadcastCtl(msg: ServerToController) {
    const out = JSON.stringify(msg);
    for (const p of this.players.values()) p.conn?.send(out);
  }

  private uniqueName(raw: string): string {
    const base = cleanName(raw) || `Player ${this.nextIndex + 1}`;
    const taken = new Set([...this.players.values()].map((p) => p.info.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base.slice(0, LIMITS.maxNameLength - 3)} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  /** What a refresh of the hosting phone needs to bring the room back: who sits where, and their tokens. */
  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      hostToken: this.hostToken,
      config: this.config,
      nextIndex: this.nextIndex,
      players: [...this.players.values()].map((p) => ({ info: p.info, token: p.token })),
    };
  }

  /** Bring a room back from a snapshot: every phone is disconnected until it reconnects (with the usual grace). */
  restore(s: RoomSnapshot) {
    this.hostToken = s.hostToken;
    this.config = s.config;
    this.nextIndex = s.nextIndex;
    for (const { info, token } of s.players) {
      const p: Player = { info: { ...info, connected: false }, token, conn: null, graceTimer: null, awayTimer: null, droppedAt: Date.now(), ownState: null };
      p.graceTimer = setTimeout(() => this.removePlayer(p, "timeout"), this.mgr.playerGraceMs);
      this.players.set(info.id, p);
    }
  }

  close(reason: "host-closed" | "host-timeout") {
    if (this.closed) return;
    this.closed = true;
    if (this.hostGraceTimer) clearTimeout(this.hostGraceTimer);
    for (const p of this.players.values()) {
      if (p.graceTimer) clearTimeout(p.graceTimer);
      if (p.awayTimer) clearTimeout(p.awayTimer);
      if (p.conn) {
        sendCtl(p.conn, { t: "closed", reason });
        p.conn.close(CLOSE_CODES.roomClosed, reason);
      }
    }
    this.players.clear();
    this.host?.close(CLOSE_CODES.roomClosed, reason);
    this.host = null;
    this.mgr.delete(this);
  }
}

export interface RoomSnapshot {
  code: string;
  hostToken: string;
  config: RoomConfig;
  nextIndex: number;
  players: { info: PlayerInfo; token: string }[];
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private byHostToken = new Map<string, Room>();
  readonly maxRooms: number;
  readonly playerGraceMs: number;
  readonly awayGraceMs: number;
  readonly hostGraceMs: number;
  readonly ghostMinMs: number;

  constructor(opts: ManagerOptions = {}) {
    this.maxRooms = opts.maxRooms ?? 5000;
    this.playerGraceMs = opts.playerGraceMs ?? LIMITS.playerGraceMs;
    this.awayGraceMs = opts.awayGraceMs ?? LIMITS.awayGraceMs;
    this.hostGraceMs = opts.hostGraceMs ?? LIMITS.hostGraceMs;
    this.ghostMinMs = opts.ghostMinMs ?? 10_000;
  }

  create(code = randomCode(), snap?: RoomSnapshot): Room | null {
    if (this.rooms.size >= this.maxRooms || this.rooms.has(code)) return null;
    const room = new Room(code, this);
    if (snap) room.restore(snap);
    this.rooms.set(code, room);
    this.byHostToken.set(room.hostToken, room);
    return room;
  }

  get(code: string) {
    return this.rooms.get(code);
  }

  byToken(hostToken: string) {
    return this.byHostToken.get(hostToken);
  }

  delete(room: Room) {
    this.rooms.delete(room.code);
    this.byHostToken.delete(room.hostToken);
  }
}

export function randomCode(): string {
  let code = "";
  for (const b of randomBytes(ROOM_CODE_LENGTH)) code += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
  return code;
}
