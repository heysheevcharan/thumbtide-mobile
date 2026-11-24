/**
 * Peer-to-peer transport. There is no server: the phone that creates a room runs the relay (rooms.ts) in its own
 * browser and the other phones connect straight to it over WebRTC data channels. PeerJS's free public broker is
 * only used to introduce the phones to each other (and its TURN servers when two phones can't reach each other
 * directly, e.g. on mobile data).
 *
 * The SDK still talks "WebSocket": the socket factory below hands it socket-like objects for two URL schemes:
 *   local://relay?role=host|controller&…   the hosting phone's own Host and Controller, wired straight in
 *   peer://relay?role=controller&room=ABCD&… any other phone, over a PeerJS data connection
 * The first frame on a data connection is the URL's query (who is connecting); then frames flow as on a socket.
 */
import Peer, { type DataConnection } from "peerjs";
import {
  CLOSE_CODES, LIMITS, isValidRoomCode, normalizeRoomCode, session, setSocketFactory,
  type ControllerToServer, type ErrorCode, type HostToServer, type SocketLike,
} from "@thumbtide/sdk";
import { RoomManager, randomCode, type Conn, type Room, type RoomSnapshot } from "./rooms.ts";

const PREFIX = "thumbtide-mobile-v1-";
const peerIdFor = (code: string) => `${PREFIX}${code}`;
const SNAPSHOT_KEY = "thumbtide:hosted-room";
const OPEN_TIMEOUT_MS = 12_000;
/** A phone that already had a seat keeps retrying this long while the hosting phone can't be found (it may be reloading). */
const LOST_HOST_GIVE_UP_MS = 90_000;

// ------------------------------------------------------------------------------------------- socket-like object

class VSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  /** Set by the transport: how frames leave, and what to do when our side closes. */
  out: (data: string) => void = () => {};
  shut: (code: number, reason: string) => void = () => {};

  send(data: string) {
    if (this.readyState === 1) this.out(data);
  }
  close(code = 1000, reason = "") {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.shut(code, reason);
    queueMicrotask(() => this.onclose?.({ code, reason }));
  }
  open() {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(data: string) {
    if (this.readyState === 1) this.onmessage?.({ data });
  }
  closed(code: number, reason: string) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

// ------------------------------------------------------------------------------------------- the hosted relay

interface Endpoint {
  message(raw: string): void;
  closed(): void;
}

const rooms = new RoomManager();
let room: Room | null = null;

function sendError(conn: Conn, code: ErrorCode, message: string) {
  conn.send(JSON.stringify({ t: "error", code, message }));
}
function parse(raw: string): any {
  if (raw.length > LIMITS.maxMessageBytes * 8) return null;
  try {
    const m = JSON.parse(raw);
    return m && typeof m === "object" && typeof m.t === "string" ? m : null;
  } catch {
    return null;
  }
}

/** The relay's front door (desktop: server/src/index.ts). Returns null when the connection was refused. */
function accept(params: URLSearchParams, conn: Conn): Endpoint | null {
  const role = params.get("role");
  const r = room;
  if (!r || r.closed) {
    sendError(conn, "room-not-found", "no room");
    conn.close(CLOSE_CODES.roomNotFound, "room not found");
    return null;
  }
  if (role === "host") {
    const tok = params.get("token");
    if (tok && tok !== r.hostToken) {
      conn.close(CLOSE_CODES.badToken, "room expired");
      return null;
    }
    r.attachHost(conn, !!tok);
    return {
      message: (raw) => {
        const m = parse(raw) as HostToServer | null;
        if (m && !r.closed) r.onHostMessage(m);
      },
      closed: () => r.detachHost(conn),
    };
  }
  if (role !== "controller") {
    conn.close(CLOSE_CODES.badRequest, "bad role");
    return null;
  }
  const code = normalizeRoomCode(params.get("room") ?? "");
  if (!isValidRoomCode(code) || code !== r.code) {
    sendError(conn, "room-not-found", `no room ${code}`);
    conn.close(CLOSE_CODES.roomNotFound, "room not found");
    return null;
  }
  const result = r.joinController(conn, params.get("name") ?? "", params.get("token"));
  if (typeof result === "number") {
    if (result !== CLOSE_CODES.left) {
      const e: ErrorCode = result === CLOSE_CODES.roomLocked ? "room-locked" : "room-full";
      sendError(conn, e, e === "room-locked" ? "game in progress" : "room is full");
    }
    conn.close(result, "refused");
    return null;
  }
  const player = result;
  return {
    message: (raw) => {
      const m = parse(raw) as ControllerToServer | null;
      if (m && !r.closed) r.onControllerMessage(player, m);
    },
    closed: () => r.detachController(player, conn),
  };
}

/** A socket for this phone's own Host or Controller: wired straight into the relay (async both ways, like a network). */
function localSocket(url: URL): SocketLike {
  const s = new VSocket();
  let ep: Endpoint | null = null;
  let open = true;
  const conn: Conn = {
    send: (data) => open && queueMicrotask(() => s.receive(data)),
    close: (code, reason) => {
      if (!open) return;
      open = false;
      queueMicrotask(() => s.closed(code, reason));
    },
    bufferedAmount: () => 0,
  };
  s.out = (data) => queueMicrotask(() => ep?.message(data));
  s.shut = () => {
    if (!open) return;
    open = false;
    queueMicrotask(() => ep?.closed());
  };
  queueMicrotask(() => {
    s.open();
    ep = accept(url.searchParams, conn);
  });
  return s;
}

// ------------------------------------------------------------------------------------------- hosting a room

let hostPeer: Peer | null = null;

function saveSnapshot() {
  if (room && !room.closed) session.set(SNAPSHOT_KEY, JSON.stringify(room.snapshot()));
}

/** The room this tab hosted before a reload, if any (the hosting phone refreshed: bring the same room back). */
export function hostedBefore(): string | null {
  try {
    const s = JSON.parse(session.get(SNAPSHOT_KEY) ?? "null") as RoomSnapshot | null;
    return s?.code ?? null;
  } catch {
    return null;
  }
}

export function forgetHostedRoom() {
  session.set(SNAPSHOT_KEY, null);
  room?.close("host-closed");
  room = null;
  hostPeer?.destroy();
  hostPeer = null;
}

export const isHosting = () => !!room && !room.closed;

/**
 * Make this phone the room: register the room's address with the broker, then open the relay. Resolves with the
 * room code. After a reload the same code and seats come back (every phone reconnects with its token).
 */
let hosting: Promise<string> | null = null;
export function startHosting(): Promise<string> {
  // one room per page, however many times this is called (a double tap, a resume racing a tap)
  hosting ??= openRoom().catch((e) => {
    hosting = null;
    throw e;
  });
  return hosting;
}

function openRoom(): Promise<string> {
  let snap: RoomSnapshot | null = null;
  try {
    snap = JSON.parse(session.get(SNAPSHOT_KEY) ?? "null");
  } catch {
    snap = null;
  }
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = () => {
      const code = snap?.code ?? randomCode();
      const peer = new Peer(peerIdFor(code), { debug: 0 });
      let opened = false;
      peer.on("open", () => {
        opened = true;
        hostPeer = peer;
        room = rooms.get(code) ?? rooms.create(code, snap ?? undefined);
        setInterval(saveSnapshot, 1500);
        window.addEventListener("pagehide", saveSnapshot);
        saveSnapshot();
        resolve(code);
      });
      peer.on("connection", (dc) => serve(dc));
      peer.on("disconnected", () => {
        // lost the broker (the data connections carry on): get back so new phones can find us
        if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1000);
      });
      peer.on("error", (err: { type?: string }) => {
        if (opened) return;
        peer.destroy();
        tries++;
        if (err.type === "unavailable-id" && snap && tries < 20) {
          // our old registration hasn't expired yet (we just reloaded): wait for it
          setTimeout(attempt, 1500);
        } else if (err.type === "unavailable-id" && tries < 8) {
          snap = null;
          attempt();
        } else if (tries < 4) setTimeout(attempt, 1000 * tries);
        else reject(new Error(err.type === "network" || err.type === "server-error" ? "Can't reach the matchmaking server. Check your connection." : `Couldn't create a room (${err.type ?? "error"}).`));
      });
    };
    attempt();
  });
}

/** Another phone connected to us: the first frame says who it is, then it's a socket like any other. */
function serve(dc: DataConnection) {
  let ep: Endpoint | null = null;
  let open = true;
  const conn: Conn = {
    send: (data) => {
      if (open && dc.open) dc.send(data);
    },
    close: (code, reason) => {
      if (!open) return;
      open = false;
      try {
        if (dc.open) dc.send(JSON.stringify({ t: "$close", code, reason }));
      } catch {
        /* already gone */
      }
      // give the close frame a moment to leave
      setTimeout(() => dc.close(), 300);
    },
    bufferedAmount: () => dc.dataChannel?.bufferedAmount ?? 0,
  };
  dc.on("data", (d) => {
    const raw = typeof d === "string" ? d : "";
    if (!ep) {
      if (!open) return;
      try {
        const hello = JSON.parse(raw) as { hello?: string };
        if (typeof hello.hello !== "string") throw new Error();
        ep = accept(new URLSearchParams(hello.hello), conn);
      } catch {
        conn.close(CLOSE_CODES.badRequest, "bad hello");
      }
      return;
    }
    ep.message(raw);
  });
  dc.on("close", () => {
    open = false;
    ep?.closed();
    ep = null;
  });
  dc.on("error", () => dc.close());
}

// ------------------------------------------------------------------------------------------- joining a room

let clientPeer: Promise<Peer> | null = null;
/** Connections waiting to open, by the peer they're dialling (so a "no such peer" error can fail them). */
const dialling = new Map<string, Set<(why: "missing" | "error") => void>>();
const lostSince = new Map<string, number>();

function getClientPeer(): Promise<Peer> {
  if (clientPeer) return clientPeer;
  clientPeer = new Promise((resolve, reject) => {
    const peer = new Peer({ debug: 0 });
    peer.on("open", () => resolve(peer));
    peer.on("disconnected", () => {
      if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1000);
    });
    peer.on("error", (err: { type?: string; message?: string }) => {
      if (err.type === "peer-unavailable") {
        for (const [id, fails] of dialling) if (err.message?.includes(id)) for (const f of fails) f("missing");
        return;
      }
      if (!peer.open || peer.destroyed) {
        clientPeer = null;
        peer.destroy();
        reject(err);
      }
    });
    peer.on("close", () => {
      clientPeer = null;
    });
  });
  return clientPeer;
}

function peerSocket(url: URL): SocketLike {
  const s = new VSocket();
  const code = normalizeRoomCode(url.searchParams.get("room") ?? "");
  const target = peerIdFor(code);
  const hadSeat = url.searchParams.has("token");
  let dc: DataConnection | null = null;
  let done = false;
  const fail = (why: "missing" | "error") => {
    if (done) return;
    done = true;
    dialling.get(target)?.delete(fail);
    dc?.close();
    if (why === "missing") {
      // a brand-new join to a room that isn't there: say so. A phone that had a seat keeps trying a while (the
      // hosting phone may be reloading), then gives up.
      const since = lostSince.get(code) ?? Date.now();
      lostSince.set(code, since);
      if (!hadSeat || Date.now() - since > LOST_HOST_GIVE_UP_MS) return s.closed(CLOSE_CODES.roomNotFound, "room not found");
    }
    s.closed(1006, why);
  };
  s.out = (data) => {
    if (dc?.open) dc.send(data);
  };
  s.shut = () => {
    done = true;
    dialling.get(target)?.delete(fail);
    dc?.close();
  };
  const timer = setTimeout(() => fail("error"), OPEN_TIMEOUT_MS);
  getClientPeer().then(
    (peer) => {
      if (done) return;
      if (!dialling.has(target)) dialling.set(target, new Set());
      dialling.get(target)!.add(fail);
      dc = peer.connect(target, { reliable: true, serialization: "json" });
      dc.on("open", () => {
        if (done) return;
        clearTimeout(timer);
        dialling.get(target)?.delete(fail);
        lostSince.delete(code);
        dc!.send(JSON.stringify({ hello: url.search.slice(1) }));
        s.open();
      });
      dc.on("data", (d) => {
        const raw = typeof d === "string" ? d : "";
        if (raw.startsWith('{"t":"$close"')) {
          try {
            const m = JSON.parse(raw) as { code: number; reason: string };
            done = true;
            return s.closed(m.code, m.reason);
          } catch {
            /* fall through */
          }
        }
        s.receive(raw);
      });
      dc.on("close", () => {
        clearTimeout(timer);
        if (!done) {
          done = true;
          s.closed(1006, "closed");
        }
      });
      dc.on("error", () => fail("error"));
    },
    () => {
      clearTimeout(timer);
      fail("error");
    },
  );
  return s;
}

/** Route every SDK socket through the P2P transport. Call once at start-up. */
export function installP2P() {
  setSocketFactory((raw) => {
    const url = new URL(raw);
    return url.protocol === "local:" ? localSocket(url) : peerSocket(url);
  });
}

export const LOCAL_URL = "local://relay";
export const PEER_URL = "peer://relay";
