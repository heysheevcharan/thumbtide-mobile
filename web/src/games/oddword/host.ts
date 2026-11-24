// Odd Word Out on the TV: seats, a 10 Hz clock for the reveal timer and computer players, and what every phone
// shows. The rules live in rules.ts; the drawing in view.ts.
//
// Seats: players first, then computer players up to the "bots" setting (8 seats in all). A phone that drops or goes
// to another app keeps its seat and the round waits for it. A newcomer plays at once while people describe, and from
// the next round if they join during the vote or the reveal (rules.ts). The host menu's room lock stops new joins.
import type { Host, HostPlayer } from "@thumbtide/sdk";
import { shell } from "../../shell/host-state.ts";
import { gameById } from "../registry.ts";
import { isSys, type HostMount, type Settings } from "../types.ts";
import { loadFonts } from "./font.ts";
import { MAX_SEATS, OddWord, type OddEvent, type Options } from "./rules.ts";
import type { Hint, OddGame, OddOwn } from "./shared.ts";

const TICK = 100;

const optionsOf = (s: Settings): Partial<Options> => {
  const tune = gameById("oddword")?.controls?.tune ?? {};
  return {
    mode: s.mode === "jobs" ? "jobs" : "words",
    hint: (s.hint === "blank" ? "blank" : "decoy") as Hint,
    revealMs: tune["reveal-time"] ?? 14000,
    botMs: [tune["bot-min"] ?? 2500, tune["bot-max"] ?? 6000],
  };
};

const BOT_NAMES = ["Biscuit", "Noodle", "Pickles", "Waffles", "Gizmo", "Toast", "Mochi"];

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<OddGame>;
  void loadFonts();
  ctx.root.innerHTML = "";
  const game = new OddWord(optionsOf(ctx.settings()));
  if (import.meta.env.DEV) (window as unknown as { __oddword: unknown }).__oddword = game;
  let paused = false;

  // ------------------------------------------------------------ seats
  const bots = () => [...game.seats.values()].filter((s) => s.bot);
  const humans = () => [...game.seats.values()].filter((s) => !s.bot).length;
  function fillBots() {
    const want = Math.max(0, Math.min(MAX_SEATS - humans(), Number(ctx.settings().bots) || 0));
    const have = bots();
    for (let i = have.length; i < want; i++) {
      const name = BOT_NAMES.find((n) => ![...game.seats.values()].some((s) => s.name === n)) ?? `Bot ${i + 1}`;
      game.addSeat(`bot:${name}`, name, true);
    }
    for (const b of have.slice(want)) game.removeSeat(b.id);
  }
  const awayOf = (p: HostPlayer<OddGame>) => !p.connected || p.away;
  function seat(p: HostPlayer<OddGame>) {
    if (game.seats.has(p.id)) return;
    // a full table: a computer player makes room
    if (game.seats.size >= MAX_SEATS) {
      const b = bots().pop();
      if (!b) return;
      game.removeSeat(b.id);
    }
    game.addSeat(p.id, p.name);
  }
  const watching = () => [...host.players.values()].filter((p) => !game.seats.has(p.id) && p.connected).map((p) => p.name);

  // ------------------------------------------------------------ what the phones show
  let sentShared = "";
  const sentOwn = new Map<string, string>();
  function publish() {
    const shared = game.publicView();
    const sk = JSON.stringify(shared);
    if (sk !== sentShared) {
      sentShared = sk;
      host.setShared(shared);
    }
    for (const p of host.players.values()) {
      const own: OddOwn = game.ownView(p.id) ?? { color: "#cccccc", shape: 0, playing: false, word: "", odd: false, done: false, vote: null, targets: [], round: game.round };
      const k = JSON.stringify(own);
      if (sentOwn.get(p.id) === k) continue;
      sentOwn.set(p.id, k);
      host.setOwn(p.id, own);
    }
    void watching;
  }

  const tellAll = (msg: OddGame["toController"], who?: (id: string) => boolean) => {
    for (const p of host.players.values()) if (game.order.includes(p.id) && (!who || who(p.id))) host.send(p.id, msg);
  };
  function handle(e: OddEvent) {
    if (e.type === "round") tellAll({ type: "buzz", kind: "round" });
    else if (e.phase === "vote") tellAll({ type: "buzz", kind: "vote" });
    else if (e.phase === "reveal" && game.result) {
      const r = game.result;
      // the odd one feels the opposite of everyone else
      tellAll({ type: "buzz", kind: r.caught ? "caught" : "escaped" }, (id) => id !== r.impostor);
      tellAll({ type: "buzz", kind: r.caught ? "escaped" : "caught" }, (id) => id === r.impostor);
    }
  }
  const flush = () => {
    for (const e of game.drainEvents()) handle(e);
    publish();
  };

  const offs = [
    host.on("join", (p) => {
      const fresh = !humans();
      seat(p);
      game.setAway(p.id, awayOf(p));
      // computer players only so far: start a fresh round with the newcomer in it
      if (fresh && !game.order.includes(p.id)) game.startRound();
      fillBots();
      flush();
    }),
    host.on("room", () => publish()),
    host.on("rejoin", (p) => {
      seat(p);
      game.setAway(p.id, awayOf(p));
      sentOwn.delete(p.id);
      flush();
    }),
    host.on("drop", (p) => {
      game.setAway(p.id, true);
      flush();
    }),
    host.on("away", (p) => {
      game.setAway(p.id, awayOf(p));
      flush();
    }),
    host.on("leave", (p) => {
      game.removeSeat(p.id);
      sentOwn.delete(p.id);
      for (const w of host.players.values()) if (!game.seats.has(w.id) && w.connected) seat(w);
      fillBots();
      flush();
    }),
    host.on("message", (p, d) => {
      if (isSys(d) || !d || typeof d !== "object" || paused) return;
      if (d.type === "done") game.markDone(p.id);
      else if (d.type === "vote") game.vote(p.id, String(d.target));
      else if (d.type === "next" && p.id === shell.vip) game.next();
      flush();
    }),
    ctx.onSettings((s) => {
      game.configure(optionsOf(s));
      fillBots();
      flush();
    }),
  ];

  // ------------------------------------------------------------ clock: timers and computer players
  let lastNext = -1;
  const clock = setInterval(() => {
    if (paused) return;
    game.step(TICK);
    const ev = game.drainEvents();
    ev.forEach(handle);
    const next = game.publicView().next;
    if (ev.length || next !== lastNext) {
      lastNext = next;
      publish();
    }
  }, TICK);

  /** A fresh game from round 1: seats everyone in the room first, then deals once. */
  function restart() {
    game.configure(optionsOf(ctx.settings()));
    game.reset();
    for (const p of host.players.values()) seat(p);
    for (const p of host.players.values()) game.setAway(p.id, awayOf(p));
    fillBots();
    if (!game.order.length) game.startRound();
    flush();
  }
  restart();

  return {
    dispose() {
      clearInterval(clock);
      offs.forEach((o) => o());
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    restart,
  };
};

export default mount;
