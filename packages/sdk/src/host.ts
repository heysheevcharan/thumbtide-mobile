import {
  CLOSE_CODES,
  type HostToServer,
  type PlayerId,
  type PlayerInfo,
  type RemoveReason,
  type RoomConfig,
  type ServerToHost,
  type Target,
} from "@thumbtide/protocol";
import { Emitter } from "./emitter.ts";
import { Link, type LinkStatus } from "./link.ts";
import { session } from "./storage.ts";
import type { AnyGame, GameMessages } from "./types.ts";

export interface HostPlayer<G extends GameMessages = AnyGame> extends PlayerInfo {
  /** Latest continuous input from this player (joystick etc). `null` if none or disconnected. */
  input: G["input"] | null;
}

export interface HostOptions {
  /** Relay URL, e.g. `wss://relay.thumbtide.com`. */
  server: string;
  /** Initial game id. Controllers use it to load the right UI. */
  game?: string;
  maxPlayers?: number;
  /**
   * Remember the room in sessionStorage so a page refresh resumes it and
   * everyone stays connected (default true).
   */
  persist?: boolean;
}

type HostEvents<G extends GameMessages> = {
  /** Connected to a room. Fires again if a fresh room had to be created. */
  room: (info: { code: string; resumed: boolean }) => void;
  join: (p: HostPlayer<G>) => void;
  /** Player's connection dropped; they may come back. */
  drop: (p: HostPlayer<G>) => void;
  rejoin: (p: HostPlayer<G>) => void;
  /**
   * `p.away` changed. Away: the phone's page is in the background (another app, the screen locked), so the
   * player is still there and comes back. Keep their seat and let their piece idle: never hand it to a computer.
   * Their input is cleared. A `drop` while away is part of the same pause, not a disconnect.
   */
  away: (p: HostPlayer<G>) => void;
  /** Player is gone for good. */
  leave: (p: HostPlayer<G>, reason: RemoveReason) => void;
  message: (p: HostPlayer<G>, data: G["toHost"]) => void;
  input: (p: HostPlayer<G>, data: G["input"]) => void;
  status: (s: LinkStatus) => void;
  error: (code: string, message: string) => void;
};

const TOKEN_KEY = "thumbtide:host-token";

/**
 * The big-screen side of a room. Creates the room, tracks players, receives
 * their input and pushes state back to their phones.
 */
export class Host<G extends GameMessages = AnyGame> extends Emitter<HostEvents<G>> {
  code = "";
  config: RoomConfig = { game: "lobby", maxPlayers: 8, locked: false };
  readonly players = new Map<PlayerId, HostPlayer<G>>();

  private token: string | null;
  /** Game to use if the room has to be recreated. */
  private game: string;
  private link: Link;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;

  constructor(private readonly opts: HostOptions) {
    super();
    this.game = opts.game ?? "lobby";
    this.token = opts.persist === false ? null : session.get(TOKEN_KEY);
    this.readyPromise = new Promise((r) => (this.resolveReady = r));
    this.link = new Link(() => this.url(), {
      onMessage: (m) => this.handle(m as ServerToHost),
      onStatus: (s) => this.emit("status", s),
      onTerminal: (code) => {
        // Our saved room expired: start a fresh one rather than giving up.
        if (code === CLOSE_CODES.badToken || code === CLOSE_CODES.roomClosed) {
          this.setToken(null);
          return true;
        }
        return false;
      },
    });
  }

  /** Resolves once the room exists and `code` is set. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  get status(): LinkStatus {
    return this.link.status;
  }

  get rtt(): number {
    return this.link.rtt;
  }

  /** Connected players, in join order. */
  get list(): HostPlayer<G>[] {
    return [...this.players.values()].sort((a, b) => a.index - b.index);
  }

  /** URL for the QR code. `base` is the controller page, e.g. `https://thumbtide.com/join`. */
  joinUrl(base: string): string {
    const u = new URL(base);
    u.searchParams.set("r", this.code);
    return u.toString();
  }

  // ------------------------------------------------------------ outbound

  /** Send a one-off message to one player, several, or everyone (omit `to`). */
  send(to: Target, data: G["toController"]) {
    this.out({ t: "msg", to, d: data });
  }

  broadcast(data: G["toController"]) {
    this.out({ t: "msg", d: data });
  }

  /**
   * Sticky state shown on every controller. The relay keeps the latest value,
   * so phones that reconnect get it immediately. Use this for "what should the
   * controller screen show right now".
   */
  setShared(data: G["shared"]) {
    this.out({ t: "state", d: data });
  }

  /** Sticky state for specific player(s) — their role, hand of cards, color... */
  setOwn(to: PlayerId | PlayerId[], data: G["own"]) {
    this.out({ t: "state", to, d: data });
  }

  /** Switch game; controllers swap their UI. */
  setGame(game: string) {
    this.config = { ...this.config, game };
    this.game = game;
    this.out({ t: "config", d: { game } });
  }

  /** Stop new players from joining (reconnects still work). */
  lock(locked = true) {
    this.config = { ...this.config, locked };
    this.out({ t: "config", d: { locked } });
  }

  setMaxPlayers(maxPlayers: number) {
    this.config = { ...this.config, maxPlayers };
    this.out({ t: "config", d: { maxPlayers } });
  }

  kick(id: PlayerId) {
    this.out({ t: "kick", id });
  }

  /** End the room for everyone. */
  close() {
    this.out({ t: "close" });
    this.setToken(null);
    this.link.close();
  }

  // ------------------------------------------------------------- inbound

  private handle(m: ServerToHost) {
    switch (m.t) {
      case "welcome": {
        this.setToken(m.token);
        const changed = this.code !== "" && this.code !== m.room;
        this.code = m.room;
        this.config = m.config;
        // Push our seat limit to the room: a new room starts at the relay default, and a resumed one may
        // carry the limit of an older version of this page.
        if (this.opts.maxPlayers && m.config.maxPlayers !== this.opts.maxPlayers) {
          this.setMaxPlayers(this.opts.maxPlayers);
        }
        // Reconcile players: anything we knew about that the server doesn't is gone.
        const seen = new Set<PlayerId>();
        for (const info of m.players) {
          seen.add(info.id);
          const existing = this.players.get(info.id);
          if (existing) Object.assign(existing, info);
          else this.players.set(info.id, { ...info, input: null });
        }
        for (const [id, p] of this.players) {
          if (!seen.has(id)) {
            this.players.delete(id);
            this.emit("leave", p, "timeout");
          }
        }
        this.emit("room", { code: m.room, resumed: m.resumed && !changed });
        this.resolveReady();
        break;
      }
      case "join": {
        const p: HostPlayer<G> = { ...m.p, input: null };
        this.players.set(p.id, p);
        this.emit("join", p);
        break;
      }
      case "drop": {
        const p = this.players.get(m.id);
        if (!p) return;
        p.connected = false;
        p.input = null;
        this.emit("drop", p);
        break;
      }
      case "rejoin": {
        const p = this.players.get(m.p.id);
        if (!p) {
          const np: HostPlayer<G> = { ...m.p, input: null };
          this.players.set(np.id, np);
          this.emit("join", np);
          return;
        }
        Object.assign(p, m.p);
        this.emit("rejoin", p);
        break;
      }
      case "away": {
        const p = this.players.get(m.id);
        if (!p || p.away === m.away) return;
        p.away = m.away;
        if (m.away) p.input = null;
        this.emit("away", p);
        break;
      }
      case "remove": {
        const p = this.players.get(m.id);
        if (!p) return;
        this.players.delete(m.id);
        this.emit("leave", p, m.reason);
        break;
      }
      case "msg": {
        const p = this.players.get(m.from);
        if (p) this.emit("message", p, m.d as G["toHost"]);
        break;
      }
      case "in": {
        const p = this.players.get(m.from);
        if (!p) return;
        p.input = m.d as G["input"];
        this.emit("input", p, p.input);
        break;
      }
      case "error":
        this.emit("error", m.code, m.message);
        break;
    }
  }

  private out(msg: HostToServer) {
    this.link.send(msg);
  }

  private setToken(t: string | null) {
    this.token = t;
    if (this.opts.persist !== false) session.set(TOKEN_KEY, t);
  }

  private url(): string {
    const u = new URL(this.opts.server);
    u.searchParams.set("role", "host");
    if (this.token) u.searchParams.set("token", this.token);
    else u.searchParams.set("game", this.game);
    return u.toString();
  }
}
