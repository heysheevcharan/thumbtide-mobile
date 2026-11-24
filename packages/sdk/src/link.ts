import { TERMINAL_CLOSE_CODES } from "@thumbtide/protocol";

export type LinkStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface LinkHandlers {
  onMessage(msg: any): void;
  onStatus(status: LinkStatus): void;
  /** Server closed with a terminal code. Return true to reconnect anyway (e.g. after resetting a token). */
  onTerminal(code: number, reason: string): boolean | void;
}

/** Anything that behaves like a browser WebSocket (the P2P transport provides one). */
export type SocketLike = Pick<WebSocket, "readyState" | "send" | "close"> & {
  onopen: ((ev: any) => void) | null;
  onmessage: ((ev: { data: any }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: any) => void) | null;
};
let socketFactory: (url: string) => SocketLike = (url) => new WebSocket(url) as unknown as SocketLike;
/** Swap how sockets are opened (Thumbtide Mobile connects phones peer to peer instead of through a relay). */
export function setSocketFactory(f: (url: string) => SocketLike) {
  socketFactory = f;
}

const PING_EVERY_MS = 2_000;
/** If nothing arrives for this long, assume the socket is dead (phone slept, wifi switched). */
const DEAD_AFTER_MS = 7_000;
const BACKOFF_MIN_MS = 250;
const BACKOFF_MAX_MS = 5_000;

/**
 * A WebSocket that keeps itself alive: reconnects with backoff, detects dead
 * connections with app-level pings, measures round-trip time, and reconnects
 * immediately when the page becomes visible again or the network returns.
 */
export class Link {
  status: LinkStatus = "connecting";
  /** Smoothed round-trip time in ms (0 until measured). */
  rtt = 0;

  private ws: SocketLike | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeen = 0;
  private stopped = false;
  private everOpened = false;
  private cleanupListeners: (() => void) | null = null;

  constructor(
    private readonly buildUrl: () => string,
    private readonly h: LinkHandlers,
  ) {
    this.watchEnvironment();
    this.open();
  }

  send(msg: unknown): boolean {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Stop for good. */
  close(code = 1000, reason = "") {
    this.stopped = true;
    this.clearTimers();
    this.cleanupListeners?.();
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= 1) ws.close(code, reason);
    this.setStatus("closed");
  }

  /** Drop the current socket and reconnect right away. */
  reconnectNow() {
    if (this.stopped) return;
    this.attempt = 0;
    this.dropSocket();
    this.open();
  }

  private open() {
    if (this.stopped) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.setStatus(this.everOpened ? "reconnecting" : "connecting");

    let ws: SocketLike;
    try {
      ws = socketFactory(this.buildUrl());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.everOpened = true;
      this.lastSeen = Date.now();
      this.setStatus("open");
      this.startPing();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.lastSeen = Date.now();
      let msg: any;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      if (msg?.t === "pong" && typeof msg.ts === "number") {
        const sample = performance.now() - msg.ts;
        this.rtt = this.rtt ? this.rtt * 0.8 + sample * 0.2 : sample;
        return;
      }
      this.h.onMessage(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      if (this.stopped) return;
      if (TERMINAL_CLOSE_CODES.has(ev.code)) {
        if (this.h.onTerminal(ev.code, ev.reason) === true) {
          this.attempt = 0;
          this.open();
        } else {
          this.stopped = true;
          this.cleanupListeners?.();
          this.setStatus("closed");
        }
        return;
      }
      this.scheduleRetry();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleRetry() {
    if (this.stopped) return;
    this.setStatus(this.everOpened ? "reconnecting" : "connecting");
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.attempt++);
    const delay = base / 2 + Math.random() * (base / 2);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private startPing() {
    this.clearTimers();
    const tick = () => {
      if (Date.now() - this.lastSeen > DEAD_AFTER_MS) {
        this.dropSocket();
        this.scheduleRetry();
        return;
      }
      this.send({ t: "ping", ts: performance.now() });
    };
    tick();
    this.pingTimer = setInterval(tick, PING_EVERY_MS);
  }

  private dropSocket() {
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }

  private clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private setStatus(s: LinkStatus) {
    if (this.status === s) return;
    this.status = s;
    this.h.onStatus(s);
  }

  private watchEnvironment() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    // Phones suspend tabs; when we come back, don't wait out the backoff.
    const wake = () => {
      if (this.stopped) return;
      if (document.visibilityState === "visible" && this.status !== "open") this.reconnectNow();
    };
    const online = () => {
      if (!this.stopped && this.status !== "open") this.reconnectNow();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", online);
    this.cleanupListeners = () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", online);
    };
  }
}
