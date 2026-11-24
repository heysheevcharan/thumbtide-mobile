import {
  CLOSE_CODES,
  normalizeRoomCode,
  type CloseReason,
  type ControllerToServer,
  type PlayerInfo,
  type RoomConfig,
  type ServerToController,
} from "@thumbtide/protocol";
import { Emitter } from "./emitter.ts";
import { Link, type LinkStatus } from "./link.ts";
import { session } from "./storage.ts";
import type { AnyGame, GameMessages } from "./types.ts";

export type ControllerCloseReason = CloseReason | "room-not-found" | "room-full" | "room-locked" | "replaced";

export interface ControllerOptions {
  server: string;
  room: string;
  name: string;
  /** Remember this player in sessionStorage so a refresh rejoins as the same player (default true). */
  persist?: boolean;
  /** Minimum gap between continuous input sends, in ms (default 25 = 40 updates a second). */
  inputIntervalMs?: number;
  /**
   * Tell the screen when this page goes to the background and comes back (default true in a browser), so the
   * player is paused while the phone is on another app or locked, instead of dropped. See `setAway`.
   */
  trackAway?: boolean;
}

type ControllerEvents<G extends GameMessages> = {
  /** Joined (or re-joined) the room. */
  ready: (info: { you: PlayerInfo; resumed: boolean }) => void;
  message: (data: G["toController"]) => void;
  /** Sticky state changed. */
  state: (state: { shared: G["shared"] | null; own: G["own"] | null }) => void;
  config: (config: RoomConfig) => void;
  /** The host switched games — swap the controller UI. */
  game: (game: string) => void;
  /** Big screen went away / came back. */
  host: (connected: boolean) => void;
  /** We're out of the room for good. */
  closed: (reason: ControllerCloseReason) => void;
  status: (s: LinkStatus) => void;
  error: (code: string, message: string) => void;
};

const CLOSE_REASON: Record<number, ControllerCloseReason> = {
  [CLOSE_CODES.roomNotFound]: "room-not-found",
  [CLOSE_CODES.roomFull]: "room-full",
  [CLOSE_CODES.roomLocked]: "room-locked",
  [CLOSE_CODES.kicked]: "kicked",
  [CLOSE_CODES.roomClosed]: "host-closed",
  [CLOSE_CODES.left]: "left",
  [CLOSE_CODES.replaced]: "replaced",
};

/**
 * The phone side of a room. Joins by code, sends input to the screen and
 * receives state back. Survives refreshes and network blips.
 */
export class Controller<G extends GameMessages = AnyGame> extends Emitter<ControllerEvents<G>> {
  readonly room: string;
  me: PlayerInfo | null = null;
  config: RoomConfig | null = null;
  hostConnected = false;
  shared: G["shared"] | null = null;
  own: G["own"] | null = null;

  private token: string | null;
  private link: Link;
  private closedReason: ControllerCloseReason | null = null;
  private serverReason: ControllerCloseReason | null = null;
  /** This page is in the background (what we tell the relay). */
  private away = false;
  private stopAwayWatch: (() => void) | null = null;

  // Continuous input coalescing.
  private inputInterval: number;
  private pendingInput: G["input"] | undefined;
  private lastInput: G["input"] | undefined;
  private lastInputAt = 0;
  private inputTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: ControllerOptions) {
    super();
    this.room = normalizeRoomCode(opts.room);
    this.inputInterval = opts.inputIntervalMs ?? 25;
    this.token = opts.persist === false ? null : session.get(this.tokenKey());
    this.link = new Link(() => this.url(), {
      onMessage: (m) => this.handle(m as ServerToController),
      onStatus: (s) => this.emit("status", s),
      onTerminal: (code) => {
        this.finish(this.serverReason ?? CLOSE_REASON[code] ?? "host-closed");
      },
    });
    if (opts.trackAway !== false) this.watchAway();
  }

  get status(): LinkStatus {
    return this.link.status;
  }

  get rtt(): number {
    return this.link.rtt;
  }

  /** Discrete event (button press, vote). Dropped if currently disconnected. */
  send(data: G["toHost"]): boolean {
    return this.out({ t: "msg", d: data });
  }

  /**
   * Continuous input (joystick position, tilt). Call as often as you like;
   * at most one update goes out per `inputIntervalMs`, always the latest.
   */
  input(data: G["input"]) {
    this.pendingInput = data;
    if (this.inputTimer) return;
    const wait = this.inputInterval - (performance.now() - this.lastInputAt);
    if (wait <= 0) this.flushInput();
    else this.inputTimer = setTimeout(() => this.flushInput(), wait);
  }

  /** How many continuous-input updates go out per second (10–60). Games set this from their controls. */
  setInputRate(perSecond: number) {
    this.inputInterval = 1000 / Math.max(10, Math.min(60, perSecond));
  }

  /**
   * Tell the screen this phone is away (its page is in the background) or back. The relay holds an away
   * player's seat much longer when the socket then dies, and games pause the player instead of handing them
   * to a computer. Done for you from page visibility unless `trackAway: false`; sent again after every welcome.
   */
  setAway(away: boolean) {
    if (this.away === away) return;
    this.away = away;
    this.out({ t: "away", away });
  }

  /** Leave the room on purpose (frees the slot immediately). */
  leave() {
    this.out({ t: "leave" });
    this.save(null);
    this.finish("left");
  }

  private flushInput() {
    this.inputTimer = null;
    if (this.pendingInput === undefined) return;
    this.lastInputAt = performance.now();
    this.lastInput = this.pendingInput;
    this.pendingInput = undefined;
    this.out({ t: "in", d: this.lastInput });
  }

  private handle(m: ServerToController) {
    switch (m.t) {
      case "welcome": {
        this.token = m.token;
        this.save(m.token);
        this.me = m.you;
        const prevGame = this.config?.game;
        this.config = m.config;
        this.hostConnected = m.hostConnected;
        this.shared = m.shared as G["shared"];
        this.own = m.own as G["own"];
        this.emit("ready", { you: m.you, resumed: m.resumed });
        this.emit("config", m.config);
        if (prevGame !== m.config.game) this.emit("game", m.config.game);
        this.emit("host", m.hostConnected);
        this.emit("state", { shared: this.shared, own: this.own });
        // The relay keeps our away flag from before; a "back" may have gone into a dead socket, so say it again.
        if (m.you.away !== this.away) this.out({ t: "away", away: this.away });
        // Host cleared our input when we dropped; resend the last known value.
        if (this.lastInput !== undefined && !this.away) this.out({ t: "in", d: this.lastInput });
        break;
      }
      case "msg":
        this.emit("message", m.d as G["toController"]);
        break;
      case "state":
        if (m.scope === "shared") this.shared = m.d as G["shared"];
        else this.own = m.d as G["own"];
        this.emit("state", { shared: this.shared, own: this.own });
        break;
      case "config": {
        const prevGame = this.config?.game;
        this.config = m.config;
        this.emit("config", m.config);
        if (prevGame !== m.config.game) this.emit("game", m.config.game);
        break;
      }
      case "host":
        this.hostConnected = m.connected;
        this.emit("host", m.connected);
        break;
      case "closed":
        this.serverReason = m.reason;
        break;
      case "error":
        if (m.code === "room-not-found") this.serverReason = "room-not-found";
        this.emit("error", m.code, m.message);
        break;
    }
  }

  private finish(reason: ControllerCloseReason) {
    if (this.closedReason) return;
    this.closedReason = reason;
    if (this.inputTimer) clearTimeout(this.inputTimer);
    this.stopAwayWatch?.();
    if (reason !== "replaced") this.save(null);
    this.link.close();
    this.emit("closed", reason);
  }

  /**
   * Away while the page is hidden: another app, the screen locked, the tab switched. `pagehide` covers the
   * page going into the back/forward cache (or closing) without a visibility change first. Each fires before
   * the browser freezes the page, so the message goes out on the open socket.
   */
  private watchAway() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const check = () => this.setAway(document.visibilityState === "hidden");
    const hide = () => this.setAway(true);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", check);
    this.away = document.visibilityState === "hidden";
    this.stopAwayWatch = () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", check);
    };
  }

  private out(msg: ControllerToServer): boolean {
    return this.link.send(msg);
  }

  private save(token: string | null) {
    if (this.opts.persist !== false) session.set(this.tokenKey(), token);
  }

  private tokenKey() {
    return `thumbtide:player:${this.room}`;
  }

  private url(): string {
    const u = new URL(this.opts.server);
    u.searchParams.set("role", "controller");
    u.searchParams.set("room", this.room);
    u.searchParams.set("name", this.opts.name);
    if (this.token) u.searchParams.set("token", this.token);
    return u.toString();
  }
}
