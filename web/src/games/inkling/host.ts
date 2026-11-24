// Inkling on the TV: seats, the fixed-step loop, the sketchbook and what every phone shows. The rules live in rules.ts.
//
// Seats: players first, then computer players up to the "bots" setting (8 seats in all). A newcomer mid-match can
// guess at once and draws at the end of this round (and of each later one); in a bots-only match the first person
// starts a fresh match. A player who leaves is removed (their turn ends if they were drawing) and someone who was
// waiting for a seat gets it. A dropped phone keeps its seat; it does not hold up "everyone has it".
import type { Host, HostPlayer } from "@thumbtide/sdk";
import { shell } from "../../shell/host-state.ts";
import { isSys, type HostMount, type Settings } from "../types.ts";
import { createBots, isBot } from "./bots.ts";
import { loadFonts } from "./font.ts";
import { TIPS } from "./look.ts";
import { artistPoints, DRAW_TIMES, encodeStrokes, Inkling, MAX_SEATS, MIXES, ROUND_OPTIONS, STEP, type InkEvent, type Mix, type Options } from "./rules.ts";
import type { InkGame, InkOwn, InkShared } from "./shared.ts";


const optionsOf = (s: Settings): Options => ({
  drawTime: (DRAW_TIMES as readonly number[]).includes(Number(s.time)) ? Number(s.time) : 80,
  rounds: (ROUND_OPTIONS as readonly number[]).includes(Number(s.rounds)) ? Number(s.rounds) : 1,
  mix: String(s.words) in MIXES ? (String(s.words) as Mix) : "mixed",
});

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<InkGame>;
  void loadFonts();

  ctx.root.innerHTML = "";
  const game = new Inkling(optionsOf(ctx.settings()));
  const bots = createBots(game);
  if (import.meta.env.DEV) (window as unknown as { __inkling: unknown }).__inkling = { game, bots };
  // the TV's sticky-note feed and sheet now live on every phone: guesses go out as messages, the drawing as a stream
  const board = { clearFeed() {}, right: (name: string, slot: number, rank: number) => feed(name, slot, "", true, rank === 0), wrong: (name: string, slot: number, text: string) => feed(name, slot, text, false, false) };
  function feed(name: string, slot: number, text: string, right: boolean, first: boolean) {
    host.broadcast({ type: "feed", name, color: TIPS[slot]!, text, right, first });
  }

  // ------------------------------------------------------------ the drawing, streamed to every phone but the artist's
  const sent = { turn: -1, rev: -1, n: 0, last: 0 };
  const viewers = () => [...host.players.keys()].filter((id) => id !== game.artist || game.phase !== "draw");
  const fullSheet = (): InkGame["toController"] => ({ type: "sheet", turn: game.turn, rev: game.inkRev, full: encodeStrokes(game.strokes, 400_000) });
  function streamSheet() {
    const strokes = game.strokes;
    const n = strokes.length;
    const last = n ? strokes[n - 1]!.p.length : 0;
    if (sent.turn === game.turn && sent.rev === game.inkRev && sent.n === n && sent.last === last) return;
    const to = viewers();
    if (sent.turn !== game.turn || sent.rev !== game.inkRev || n < sent.n) {
      if (to.length) host.send(to, fullSheet());
    } else {
      const at = Math.max(0, sent.n - 1);
      const off = sent.n ? sent.last : 0;
      const s = strokes.slice(at).map((st, k): [number, number, number, number[]] => [st.id, st.c, st.w, k === 0 ? st.p.slice(off) : st.p]);
      if (to.length) host.send(to, { type: "sheet", turn: game.turn, rev: game.inkRev, at, off, s });
    }
    Object.assign(sent, { turn: game.turn, rev: game.inkRev, n, last });
  }
  let paused = false;

  // ------------------------------------------------------------ seats
  const humans = () => [...game.seats.values()].filter((s) => !s.bot).length;
  const wantedBots = () => Math.max(0, Math.min(MAX_SEATS - humans(), Number(ctx.settings().bots) || 0));
  const fillBots = () => bots.setCount(wantedBots());
  const seat = (p: HostPlayer<InkGame>) => {
    if (game.seats.has(p.id)) return;
    if (game.seats.size >= MAX_SEATS && !bots.yieldOne()) return;
    game.addSeat(p.id, p.name, false, p.index);
  };
  const watching = () => [...host.players.values()].filter((p) => !game.seats.has(p.id) && p.connected).map((p) => p.name);

  // ------------------------------------------------------------ what the phones show
  /** A phone that came back mid-turn asked for the strokes: they ride on its `own` until it draws again. */
  let restore: { id: string; seq: number; next: number; s: string } | null = null;
  let restoreSeq = 0;
  let sentShared = "";
  const sentOwn = new Map<string, string>();

  function publish() {
    const a = game.artist ? game.seats.get(game.artist) : null;
    const word = game.word?.w ?? "";
    const shared: InkShared = {
      phase: game.phase,
      turn: game.turn,
      turns: game.turnCount(),
      round: game.round + 1,
      rounds: game.order.length || game.opts.rounds,
      artistId: a?.id ?? "",
      artist: a?.name ?? "",
      artistColor: a ? TIPS[a.slot]! : "",
      mask: game.phase === "draw" ? game.mask() : game.phase === "reveal" ? word : "",
      left: Math.ceil(game.left()),
      total: game.phase === "draw" ? game.limit / 60 : game.phase === "pick" ? 15 : 0,
      got: game.guessed.slice(),
      winners: game.phase === "match" ? game.winners.map((id) => game.seats.get(id)?.name ?? "") : [],
      scores: game.standings().map((x) => ({ id: x.id, name: x.name, color: TIPS[x.slot]!, score: x.score, gained: x.gained, got: x.got, away: x.away })),
      why: "",
      next: "",
    };
    if (game.phase === "reveal") {
      const n = game.guessed.length;
      const of = [...game.seats.values()].filter((x) => x.id !== game.artist).length;
      shared.why = game.endReason === "left" ? "The artist left" : game.endReason === "alone" ? "Nobody left to guess" : n && n >= of ? "Everyone got it!" : n ? `${n} of ${of} got it` : "Nobody got it";
      shared.next = game.seats.get(game.upNext() ?? "")?.name ?? "";
    }
    const sk = JSON.stringify(shared);
    if (sk !== sentShared) {
      sentShared = sk;
      host.setShared(shared);
    }
    const ranks = game.standings();
    for (const p of host.players.values()) {
      const s = game.seats.get(p.id);
      const artist = !!s && s.id === game.artist && (game.phase === "pick" || game.phase === "draw");
      const own: InkOwn = s
        ? {
            name: s.name,
            color: TIPS[s.slot]!,
            role: artist ? "artist" : "guess",
            choices: artist && game.phase === "pick" ? game.choices.map((w) => ({ w: w.w, d: w.d, pts: artistPoints(w.d) })) : [],
            word: (artist && game.phase === "draw") || s.got || game.phase === "reveal" ? word : "",
            got: s.got,
            gained: s.gained,
            score: s.score,
            rank: ranks.indexOf(s) + 1,
            turn: game.turn,
            restore: restore && restore.id === p.id ? { seq: restore.seq, next: restore.next, s: restore.s } : null,
          }
        : { name: p.name, color: "#8d9aa1", role: "watch", choices: [], word: "", got: false, gained: 0, score: 0, rank: 0, turn: game.turn, restore: null };
      const k = JSON.stringify(own);
      if (sentOwn.get(p.id) === k) continue;
      sentOwn.set(p.id, k);
      host.setOwn(p.id, own);
    }
  }

  const tell = (id: string, msg: InkGame["toController"]) => {
    if (host.players.has(id)) host.send(id, msg);
  };
  /** The artist drew again after a restore: drop the snapshot from their `own`. */
  const drew = (id: string) => {
    if (restore?.id === id) {
      restore = null;
      publish();
    }
  };

  const offs = [
    host.on("join", (p) => {
      // bots only so far (the TV opened straight into the game): start afresh with the newcomer
      const fresh = !humans();
      seat(p);
      host.send(p.id, fullSheet());
      if (fresh) restart();
      else fillBots();
      publish();
    }),
    host.on("rejoin", (p) => {
      seat(p);
      if (p.id !== game.artist || game.phase !== "draw") host.send(p.id, fullSheet());
      game.setAway(p.id, false);
      sentOwn.delete(p.id);
      publish();
    }),
    host.on("drop", (p) => {
      game.setAway(p.id, true);
      publish();
    }),
    host.on("leave", (p) => {
      game.removeSeat(p.id);
      sentOwn.delete(p.id);
      if (restore?.id === p.id) restore = null;
      // a seat came free: hand it to someone watching, else back to a bot
      for (const w of host.players.values()) if (!game.seats.has(w.id) && w.connected) seat(w);
      fillBots();
      publish();
    }),
    host.on("message", (p, d) => {
      if (isSys(d) || !d || typeof d !== "object") return;
      if (d.type === "again") {
        if (p.id === shell.vip && game.phase === "match") restart();
        return;
      }
      if (d.type === "sync") {
        if (p.id !== game.artist || game.phase !== "draw") {
          host.send(p.id, fullSheet());
        } else {
          restore = { id: p.id, seq: ++restoreSeq, next: game.maxSid + 1, s: encodeStrokes(game.strokes) };
          sentOwn.delete(p.id);
          publish();
        }
        return;
      }
      if (paused) return;
      switch (d.type) {
        case "pick":
          if (game.pick(p.id, d.i)) publish();
          break;
        case "ink":
          if (game.ink(p.id, d.k, d.s, d.c, d.w, d.p, d.e)) drew(p.id);
          break;
        case "undo":
          if (game.undo(p.id, d.k)) drew(p.id);
          break;
        case "clear":
          if (game.clear(p.id, d.k)) drew(p.id);
          break;
        case "guess": {
          const how = game.guess(p.id, d.text);
          if (how) tell(p.id, { type: "said", text: String(d.text).replace(/\s+/g, " ").trim().slice(0, 40), how, points: how === "right" ? (game.seats.get(p.id)?.gained ?? 0) : 0 });
          break;
        }
        default:
          break;
      }
      // events from these moves are handled in the loop
    }),
    ctx.onSettings((s) => {
      game.configure(optionsOf(s));
      fillBots();
      publish();
    }),
  ];

  // ------------------------------------------------------------ events
  function handle(e: InkEvent) {
    switch (e.type) {
      case "turn":
        board.clearFeed();
        tell(e.artist, { type: "buzz", kind: "turn" });
        break;
      case "phase":
        if (e.phase === "match") board.clearFeed();
        if (e.phase === "match") for (const p of host.players.values()) tell(p.id, { type: "buzz", kind: "end" });
        if (e.phase !== "draw") restore = null;
        publish();
        break;
      case "right": {
        const s = game.seats.get(e.id);
        if (s) board.right(s.name, s.slot, e.rank);
        if (game.artist && !isBot(game.artist)) tell(game.artist, { type: "buzz", kind: "got" });
        publish();
        break;
      }
      case "wrong": {
        const s = game.seats.get(e.id);
        if (s) board.wrong(s.name, s.slot, e.text);
        break;
      }
      case "hint":
      case "end":
        publish();
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ loop: 60 Hz fixed steps, drawn in between
  let last = performance.now();
  let acc = 0;
  let raf = 0;
  let lastLeft = -1;
  const frame = (now: number) => {
    // real time, even when the browser slows timers down (a background tab): catch up in whole steps
    const dt = Math.min(2, (now - last) / 1000);
    last = now;
    if (!paused) {
      acc += dt;
      while (acc >= STEP) {
        bots.step();
        game.step();
        acc -= STEP;
      }
      for (const e of game.drainEvents()) handle(e);
      // the phones count down from the last whole second they were sent
      const left = Math.ceil(game.left());
      if (left !== lastLeft) {
        lastLeft = left;
        publish();
      }
    }
    if (now - lastStream > 70) {
      lastStream = now;
      streamSheet();
    }
  };
  let lastStream = 0;

  function restart() {
    for (const p of host.players.values()) seat(p);
    fillBots();
    restore = null;
    game.configure(optionsOf(ctx.settings()));
    game.startMatch();
    board.clearFeed();
    for (const e of game.drainEvents()) handle(e);
    publish();
  }
  for (const p of host.players.values()) seat(p);
  restart();
  // a plain timer, not animation frames: nothing is drawn here, and frames stop when the page isn't on screen
  raf = window.setInterval(() => frame(performance.now()), 33);

  return {
    dispose() {
      window.clearInterval(raf);
      offs.forEach((o) => o());
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      last = performance.now();
    },
    restart,
  };
};

export default mount;
