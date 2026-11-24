// Cascade's logic, on the hosting phone: seats the players, runs the turns and the turn timer, plays for
// computers and anyone whose phone has dropped, and tells every phone what happened. Every phone draws the board
// itself (controller.ts) and plays each move back from the `move` message; the next turn starts once that
// animation has had time to finish (moveMs in shared.ts).
import type { Host } from "@thumbtide/sdk";
import { shell } from "../../shell/host-state.ts";
import { gameById } from "../registry.ts";
import { isSys, type HostMount } from "../types.ts";
import { botMove } from "./bots.ts";
import { Game, canSkipAway, type Move } from "./rules.ts";
import { BOT_NAMES, COLORS, boardFor, moveMs, type CascadeGame, type CascadeOwn, type CascadeShared, type SeatView } from "./shared.ts";

interface Seat {
  id: string;
  name: string;
  /** A computer plays this seat (a bot, or someone who left). */
  bot: boolean;
}

const TICK = 100;

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<CascadeGame>;
  const tune = gameById("cascade")?.controls?.tune ?? {};
  const T = {
    think: tune["bot-think"] ?? 900,
    away: tune["away-wait"] ?? 3000,
    skip: tune["away-skip"] ?? 20000,
    intro: 1400,
    endCard: 1200,
  };

  let seats: Seat[] = [];
  let game!: Game;
  let round = 0;
  const wins = new Map<string, number>();
  let outOrder: number[] = [];
  let phase: "play" | "end" = "play";
  /** A move is playing out on the phones. */
  let busy = 0;
  let mover = -1;
  let moves = 0;
  let paused = false;
  let startIn = 0;
  let turnMs = 0;
  let turnLeft = 0;
  let awayLeft = 0;
  /** A computer's turn: wait this long, then play. */
  let botWait = -1;
  let note = "";
  /** The board as phones should show it: as of the end of the last move played out. */
  let shown = { owner: "", count: "" };
  let shownAlive: boolean[] = [];
  let shownPieces: number[] = [];
  const sentOwn = new Map<string, string>();

  const colorOf = (i: number) => COLORS[i % COLORS.length]!;
  const seatOf = (id: string) => seats.findIndex((s) => s.id === id && !s.bot);
  const connected = (i: number) => !seats[i]!.bot && host.players.get(seats[i]!.id)?.connected === true;
  /** Their phone is on another app or locked: they're coming back, so a computer never plays for them. */
  const away = (i: number) => !seats[i]!.bot && host.players.get(seats[i]!.id)?.away === true;
  const tell = (i: number, kind: string) => {
    if (connected(i)) host.send(seats[i]!.id, { type: "buzz", kind });
  };
  const snapshot = () => {
    shown = {
      owner: [...game.board.owner].map((o) => (o < 0 ? "." : String(o))).join(""),
      count: [...game.board.count].map((c) => String(Math.min(9, c))).join(""),
    };
    shownAlive = [...game.alive];
    shownPieces = seats.map((_, i) => game.piecesOf(i));
  };

  // ------------------------------------------------------------------ a new round
  /** `again`: deal the same round over (nobody has moved yet, or the host restarted it). */
  function deal(again = false) {
    const people = host.list.slice(0, 8).map((p) => ({ id: p.id, name: p.name, bot: false }));
    const want = Math.max(0, Number(ctx.settings().bots) || 0);
    const bots = Math.min(8 - people.length, Math.max(2 - people.length, want));
    const taken = new Set(people.map((p) => p.name.toLowerCase()));
    const names = BOT_NAMES.filter((n) => !taken.has(n.toLowerCase()));
    seats = [...people, ...Array.from({ length: bots }, (_, i) => ({ id: `bot-${i}`, name: names[i] ?? `CPU ${i + 1}`, bot: true }))];
    if (!again || round === 0) round++;
    const [w, h] = boardFor(ctx.settings(), seats.length);
    game = new Game(w, h, seats.length, (round - 1) % seats.length);
    outOrder = [];
    phase = "play";
    busy = 0;
    mover = -1;
    botWait = -1;
    turnMs = (Number(ctx.settings().timer) || 0) * 1000;
    startIn = T.intro;
    note = `Round ${round} · ${seats[game.turn]!.name} starts`;
    snapshot();
    publish();
  }

  // ------------------------------------------------------------------ turns
  function startTurn() {
    const s = game.turn;
    turnLeft = turnMs;
    awayLeft = turnMs || T.skip;
    botWait = -1;
    tell(s, "turn");
    // away: nobody plays for them; the turn passes on after a while (awayTurn)
    if (seats[s]!.bot) botWait = T.think * (0.75 + Math.random() * 0.5);
    else if (!away(s) && !connected(s)) botWait = T.away;
    publish();
  }

  function tryPlace(s: number, cell: number) {
    if (game.canPlay(cell)) return play(cell);
    tell(s, "nope");
  }

  function play(cell: number) {
    const s = game.turn;
    const move = game.play(cell);
    if (!move) return;
    mover = s;
    botWait = -1;
    moves++;
    busy = moveMs(move.waves.length);
    note = "";
    host.broadcast({ type: "move", n: moves, move });
    publish();
    pending = move;
  }
  let pending: Move | null = null;

  /** A move has finished playing out on the phones. */
  function finish(move: Move) {
    pending = null;
    mover = -1;
    snapshot();
    for (const q of move.eliminated) {
      outOrder.push(q);
      tell(q, "out");
      if (move.winner < 0) note = `${seats[q]!.name} is out`;
    }
    if (move.winner >= 0) return win(move.winner);
    startTurn();
  }

  function win(w: number) {
    phase = "end";
    const id = seats[w]!.id;
    wins.set(id, (wins.get(id) ?? 0) + 1);
    seats.forEach((_, i) => tell(i, i === w ? "win" : "lose"));
    note = `${seats[w]!.name} wins round ${round}!`;
    publish();
  }

  /** Finishing order: the winner, then whoever went out last, and so on. */
  const standings = () => [game.winner, ...[...outOrder].reverse()].filter((i, k, a) => i >= 0 && a.indexOf(i) === k);

  // ------------------------------------------------------------------ what the phones show
  function shared(): CascadeShared {
    const live = phase === "play" && !busy && startIn <= 0;
    return {
      phase,
      round,
      seats: seats.map(
        (s, i): SeatView => ({
          id: s.id,
          name: s.name,
          color: colorOf(i),
          alive: shownAlive[i] ?? true,
          bot: s.bot,
          away: !s.bot && (host.players.get(s.id)?.connected === false || host.players.get(s.id)?.away === true),
          pieces: shownPieces[i] ?? 0,
          wins: wins.get(s.id) ?? 0,
        }),
      ),
      turn: live ? game.turn : -1,
      active: phase === "end" ? -1 : busy ? mover : game.turn,
      timeLeft: live && turnMs ? Math.round(turnLeft) : 0,
      timeTotal: turnMs,
      winner: phase === "end" ? game.winner : -1,
      standings: phase === "end" ? standings() : [],
      watching: [...host.players.values()].filter((p) => seatOf(p.id) < 0).map((p) => p.name),
      board: { w: game.w, h: game.h, ...shown },
      note,
      moves,
    };
  }

  function publish() {
    host.setShared(shared());
    seats.forEach((seat, i) => {
      if (seat.bot || !host.players.has(seat.id)) return;
      const own: CascadeOwn = { seat: i, color: colorOf(i) };
      const key = JSON.stringify(own);
      if (sentOwn.get(seat.id) === key) return;
      sentOwn.set(seat.id, key);
      host.setOwn(seat.id, own);
    });
  }

  // ------------------------------------------------------------------ the clock
  let last = performance.now();
  function update() {
    const now = performance.now();
    const ms = Math.min(2000, now - last);
    last = now;
    if (paused || phase === "end") return;
    if (startIn > 0) {
      if ((startIn -= ms) <= 0) startTurn();
      return;
    }
    if (busy) {
      if ((busy -= ms) <= 0) {
        busy = 0;
        if (pending) finish(pending);
      }
      return;
    }
    const s = game.turn;
    if (away(s)) return awayTurn(s, ms);
    if (turnMs) {
      turnLeft -= ms;
      if (turnLeft <= 0) {
        // out of time: the computer's pick for them
        const c = botMove(game);
        if (c >= 0) play(c);
        return;
      }
    }
    if (botWait >= 0 && (botWait -= ms) <= 0) {
      botWait = -1;
      const c = botMove(game);
      if (c >= 0) play(c);
    }
  }

  /** The player whose turn it is is away: after a while their turn passes on, if enough others are playing. */
  function awayTurn(s: number, ms: number) {
    botWait = -1;
    if (!canSkipAway(game, seats.map((_, i) => away(i)))) return;
    awayLeft -= ms;
    if (awayLeft > 0) return;
    note = `${seats[s]!.name} is away · turn passed on`;
    game.skip();
    startTurn();
  }
  const clock = window.setInterval(update, TICK);

  // ------------------------------------------------------------------ the room
  const offs = [
    host.on("join", () => {
      if (phase === "play" && game.moves === 0 && !busy) deal(true); // nobody has moved yet: deal them in
      else publish(); // they watch until the next round
    }),
    host.on("rejoin", (p) => {
      const i = seatOf(p.id);
      if (i >= 0 && i === game.turn && phase === "play" && !busy && startIn <= 0 && !seats[i]!.bot) botWait = -1; // they're back: their move
      sentOwn.delete(p.id);
      publish();
    }),
    host.on("drop", (p) => {
      const i = seatOf(p.id);
      // a real disconnect: the computer plays for them. Not when they said they're away first (that's a pause)
      if (i >= 0 && i === game.turn && phase === "play" && !busy && startIn <= 0 && botWait < 0 && !p.away) botWait = T.away;
      publish();
    }),
    host.on("away", (p) => {
      const i = seatOf(p.id);
      if (i >= 0 && i === game.turn && phase === "play" && !busy && startIn <= 0) {
        if (p.away) {
          botWait = -1;
          awayLeft = turnMs ? Math.max(0, turnLeft) : T.skip;
        } else {
          turnLeft = turnMs; // back: a fresh turn
          if (!p.connected && botWait < 0) botWait = T.away;
        }
      }
      publish();
    }),
    host.on("leave", (p) => {
      const i = seats.findIndex((s) => s.id === p.id);
      sentOwn.delete(p.id);
      if (i >= 0 && phase === "play") {
        seats[i]!.bot = true; // a computer finishes their game
        if (game.alive[i]) note = `${seats[i]!.name} left · a computer takes over`;
        if (i === game.turn && !busy && startIn <= 0 && botWait < 0) botWait = T.think;
      }
      publish();
    }),
    host.on("message", (p, d) => {
      if (isSys(d) || !d || typeof d !== "object" || paused) return;
      if (d.type === "again") {
        if (p.id === shell.vip && phase === "end") deal();
        return;
      }
      const s = seatOf(p.id);
      if (s < 0 || phase !== "play" || busy || startIn > 0 || game.turn !== s) return;
      if (d.type === "place" && Number.isInteger(d.cell)) {
        botWait = -1; // they're playing it themselves
        tryPlace(s, d.cell);
      }
    }),
    ctx.onSettings((s) => {
      const t = (Number(s.timer) || 0) * 1000;
      if (t !== turnMs) {
        turnMs = t;
        turnLeft = t;
      }
      // board size and computer players apply from the next round, or now if nobody has moved yet
      if (phase === "play" && !busy && game.moves === 0) deal(true);
      else publish();
    }),
  ];

  deal();
  if (import.meta.env.DEV) {
    (window as unknown as { __cascade: unknown }).__cascade = {
      get game() { return game; },
      get seats() { return seats; },
      play: (c: number) => !busy && phase === "play" && startIn <= 0 && play(c),
      deal,
    };
  }

  return {
    dispose() {
      window.clearInterval(clock);
      offs.forEach((o) => o());
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      last = performance.now();
    },
    restart() {
      deal(true);
    },
  };
};

export default mount;
