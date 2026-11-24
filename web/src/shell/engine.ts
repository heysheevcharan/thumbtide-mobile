/**
 * The game engine. In Thumbtide this was the TV page; on mobile it runs invisibly inside the browser of the phone
 * that created the room. It owns the room, decides who the VIP is (the player whose phone drives menus), mounts the
 * game logic, and carries out host commands: pause, restart, settings, kick, lock. Every phone (this one included)
 * shows the game through its controller.
 */
import { Host, LIMITS, local, type HostPlayer } from "@thumbtide/sdk";
import { LOCAL_URL } from "../net/p2p.ts";
import { gameById } from "../games/registry.ts";
import { defaultSettings, isSys, type GameHandle, type Settings, type ShellState } from "../games/types.ts";
import { shell } from "./host-state.ts";
import * as playStats from "../games/lobby/stats.ts";

export function startEngine() {
// the games' host code still builds DOM (a few TV leftovers); it goes into a detached element nobody sees
const root = document.createElement("div");
const startParam = (k: string) => new URLSearchParams(location.search).get(k);
const blip = (_k: string) => {};

// The room takes as many phones as the relay allows. Each game seats as many as it can play with
// (Wet Paint, Cult and Cascade 8) and the rest watch, so a 9th friend can still get in.
const host = new Host({ server: LOCAL_URL, game: "lobby", maxPlayers: LIMITS.maxPlayers });
shell.host = host;
// dev only: test scripts read the room code here (window.__tt.host.code) to join headless phones
if (import.meta.env.DEV) (window as unknown as { __tt: unknown }).__tt = { host };


// ------------------------------------------------------------------ settings, remembered on this TV
const SETTINGS_KEY = "thumbtide:settings";
const saved: Record<string, Settings> = (() => {
  try {
    return JSON.parse(local.get(SETTINGS_KEY) ?? "{}");
  } catch {
    return {};
  }
})();
function settingsFor(game: string): Settings {
  const def = gameById(game);
  const merged = { ...defaultSettings(def?.settings), ...(saved[game] ?? {}) };
  // ?bots=3, ?look=reactor… on the TV page (or the TV app's launch options) win: handy for testing
  for (const d of def?.settings ?? []) {
    const v = startParam(d.key);
    const opt = v === null ? undefined : d.options.find((o) => String(o.value) === v);
    if (d.key === "bots" && v !== null) merged.bots = Math.max(0, Math.min(7, Number(v) || 0));
    else if (opt) merged[d.key] = opt.value;
  }
  return merged;
}
const settingsListeners = new Set<(s: Settings) => void>();

// ------------------------------------------------------------------ state every phone sees
const state: ShellState = { vip: null, game: "lobby", paused: false, pausedBy: null, canPause: false, settings: {}, locked: false, selected: null, players: [] };
shell.state = state;

function publish() {
  state.vip = shell.vip;
  state.players = host.list.map((p) => ({ id: p.id, name: p.name, connected: p.connected, away: p.away }));
  state.settings = settingsFor(state.selected ?? state.game);
  host.broadcast({ $sys: "shell", state });
  shell.emit();
}
const tell = (p: HostPlayer) => host.send(p.id, { $sys: "shell", state });

// ------------------------------------------------------------------ mounting games
let handle: GameHandle | null = null;
let mounted = "";
let mountSeq = 0;

async function mount(id: string) {
  const def = gameById(id) ?? gameById("lobby")!;
  const seq = ++mountSeq;
  handle?.dispose();
  handle = null;
  playStats.begin(def.id); // closes the previous game's time, opens this one (the lobby is not counted)
  settingsListeners.clear();
  root.replaceChildren();
  mounted = def.id;
  if (host.config.game !== def.id) host.setGame(def.id);
  if (def.id === "lobby" && host.config.locked) host.lock(false);
  // Clear the previous game's sticky state so phones don't render stale screens.
  host.setShared(null);
  for (const p of host.players.values()) host.setOwn(p.id, null);
  Object.assign(state, { game: def.id, paused: false, pausedBy: null, canPause: false, selected: null, locked: def.id === "lobby" ? false : state.locked });
  publish();

  const mod = await def.host();
  if (seq !== mountSeq) return; // another switch happened while loading
  const result = mod.default({
    host,
    root,
    exit: () => void mount("lobby"),
    settings: () => settingsFor(def.id),
    onSettings(fn) {
      settingsListeners.add(fn);
      return () => settingsListeners.delete(fn);
    },
  });
  handle = typeof result === "function" ? { dispose: result } : result;
  state.canPause = !!(handle.pause && handle.resume);
  publish();
}
shell.mount = mount;
shell.select = (id) => {
  state.selected = id && gameById(id) ? id : null;
  publish();
};

// ------------------------------------------------------------------ host commands
function pause(by: string | null = null) {
  if (!handle?.pause || state.paused) return;
  handle.pause();
  state.paused = true;
  state.pausedBy = by;
  publish();
}
function resume() {
  if (!handle?.resume || !state.paused) return;
  handle.resume();
  state.paused = false;
  state.pausedBy = null;
  publish();
}
function restart() {
  if (handle?.restart) {
    handle.restart();
    if (state.paused) handle.resume?.();
    state.paused = false;
    state.pausedBy = null;
    publish();
  } else void mount(mounted);
}


// --------------------------------------------------------------- VIP
// The first connected player (by join order) controls menus from their phone. A phone that's away (on another
// app, or locked) hands it on while it's away, so someone can still pause or remove a seat.
function refreshVip() {
  shell.vip = (host.list.find((p) => p.connected && !p.away) ?? host.list.find((p) => p.connected))?.id ?? null;
  publish(); // also carries the player list, so send it on every change
}

host.on("join", () => refreshVip());
host.on("rejoin", (p) => {
  refreshVip();
  tell(p);
});
host.on("drop", () => refreshVip());
host.on("away", () => refreshVip());
host.on("leave", () => refreshVip());

host.on("message", (p, data) => {
  if (!isSys(data) || p.id !== shell.vip) return;
  switch (data.$sys) {
    case "start":
      if (gameById(data.game)) {
        blip("start");
        void mount(data.game);
      }
      break;
    case "exit":
      void mount("lobby");
      break;
    case "pause":
      pause(p.id);
      break;
    case "resume":
      resume();
      break;
    case "restart":
      restart();
      break;
    case "select":
      state.selected = data.game && gameById(data.game) ? data.game : null;
      publish();
      break;
    case "lock":
      if (mounted !== "lobby") {
        host.lock(!!data.locked);
        state.locked = !!data.locked;
        publish();
      }
      break;
    case "kick":
      if (data.id !== p.id) host.kick(data.id);
      break;
    case "setting": {
      const def = gameById(data.game)?.settings?.find((s) => s.key === data.key);
      if (!def || !def.options.some((o) => o.value === data.value)) break;
      saved[data.game] = { ...(saved[data.game] ?? {}), [data.key]: data.value };
      local.set(SETTINGS_KEY, JSON.stringify(saved));
      publish();
      if (data.game === mounted) for (const fn of settingsListeners) fn(settingsFor(mounted));
      break;
    }
  }
});

// -------------------------------------------------------- lifecycle
host.on("room", ({ resumed }) => {
  // Page refresh → resume whatever game the room was on (fresh state).
  // Brand-new room → lobby. Network blip → nothing to do.
  if (resumed && mounted) return;
  // ?game=<id> opens straight into a game (handy for testing and TV-app deep links).
  const direct = startParam("game");
  void mount(resumed ? host.config.game : direct && gameById(direct) ? direct : "lobby");
  refreshVip();
});

return host;
}
