// Cascade on the TV: seats the players, runs the turns, moves the current player's cursor from their phone,
// plays each move back on the board, and plays for computers and anyone whose phone has dropped.
// Everything is timed by the frame loop, so pausing freezes it all.
import type { Host } from "@thumbtide/sdk";
import { shell } from "../../shell/host-state.ts";
import { audio } from "../../shell/sound.ts";
import { fpsOverride, frameDrawn, frameIdle, setPerfExtras } from "../../shell/perf.ts";
import { isTV, startParam } from "../../shell/tv.ts";
import { gameById } from "../registry.ts";
import { isSys, type HostMount, type Settings } from "../types.ts";
import { createAudio } from "./audio.ts";
import { botMove } from "./bots.ts";
import { createHud } from "./hud.ts";
import { CultureLook } from "./look/culture.ts";
import { Director } from "./look/director.ts";
import { CHEER_S, type Look } from "./look/look.ts";
import { MarblesLook } from "./look/marbles.ts";
import { ReactorLook } from "./look/reactor.ts";
import { Stage } from "./look/stage.ts";
import { Game, canSkipAway, type Move } from "./rules.ts";
import { BOT_NAMES, boardFor, isLook, type CascadeGame, type CascadeOwn, type CascadeShared, type LookId, type SeatView } from "./shared.ts";
import "./cascade.css";

interface Seat {
  id: string;
  name: string;
  /** A computer plays this seat (a bot, or someone who left). */
  bot: boolean;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const makeLook = (id: LookId, lite: boolean): Look =>
  id === "marbles" ? new MarblesLook(lite) : id === "reactor" ? new ReactorLook(lite) : new CultureLook(lite);
const lookOf = (s: Settings): LookId => (isLook(s.look) ? s.look : "culture");

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<CascadeGame>;
  const tune = gameById("cascade")?.controls?.tune ?? {};
  const T = {
    think: tune["bot-think"] ?? 700, // ms a computer looks at the board before moving its cursor
    walk: tune["bot-walk"] ?? 110, // ms per cell as it walks there
    away: tune["away-wait"] ?? 3000, // ms before the computer plays for someone whose phone dropped
    skip: tune["away-skip"] ?? 20000, // timer off: ms before an away player's turn passes on (never a computer move)
    intro: 1200, // ms between a new board and the first turn
    endCard: 1800, // ms of celebration before the winner's card
  };
  const params = new URLSearchParams(location.search);
  // TVs have phone-class graphics chips: no antialiasing, 30fps (fps=60 lifts the cap, for tests at the target)
  const lite = params.get("quality") === "low" || (isTV && params.get("quality") !== "high");
  const fps = fpsOverride() ?? (lite ? 30 : 60);
  // Frame rate by state: full while anything moves; lower once the board has been still for a moment (pieces
  // only idle); lowest on the end screen once the cheer is over. A TV's graphics chip and fans get the rest.
  const calmFps = Math.min(fps, Math.max(20, fps / 2));
  const restFps = Math.min(fps, 15);
  const QUIET_MS = 1500;

  ctx.root.innerHTML = `<div class="cz"><div class="cz-stage"></div><div class="cz-hud-root"></div></div>`;
  const wrap = ctx.root.firstElementChild as HTMLElement;
  const stage = new Stage(wrap.querySelector(".cz-stage") as HTMLElement, { lite, fps, scale: Number(startParam("res")) || 0 });
  stage.fill = { x: 0.72, y: 0.78 };
  stage.center = { x: 0.17, y: -0.04 };
  const hud = createHud(wrap.querySelector(".cz-hud-root") as HTMLElement);
  const sfx = createAudio(audio());

  let lookId = lookOf(ctx.settings());
  let look = makeLook(lookId, lite);
  const director = new Director(look);
  hud.setLook(lookId);
  sfx?.setLook(lookId);

  let seats: Seat[] = [];
  let game!: Game;
  let round = 0;
  const wins = new Map<string, number>();
  /** Each seat's cursor (a cell). It stays where they left it from turn to turn. */
  let cursor: number[] = [];
  /** Seats in the order they went out. */
  let outOrder: number[] = [];
  let phase: "play" | "end" = "play";
  /** A move is playing out on the board. */
  let busy = false;
  let mover = -1;
  let pending: Move | null = null;
  /** What the HUD and phones show: the board as of the end of the last move played out. */
  let shownPieces: number[] = [];
  let shownAlive: boolean[] = [];
  let paused = false;
  let startIn = 0;
  let endIn = 0;
  let turnMs = 0;
  let turnLeft = 0;
  let lastTick = 0;
  /** ms before the turn of an away player (phone on another app or locked) passes on. */
  let awayLeft = 0;
  /** A computer's turn: wait, walk the cursor to `target`, then play it. */
  let plan: { target: number; wait: number } | null = null;
  const sentOwn = new Map<string, string>();
  /** ms since anything moved (the cursor, a piece, a new turn); and ms on the end screen. */
  let quietFor = 0;
  let endFor = 0;
  const stir = () => (quietFor = 0);

  const colorOf = (i: number) => look.info.colors[i % look.info.colors.length]!;
  const seatOf = (id: string) => seats.findIndex((s) => s.id === id && !s.bot);
  const connected = (i: number) => !seats[i]!.bot && host.players.get(seats[i]!.id)?.connected === true;
  /** Their phone is on another app or locked: they're coming back, so a computer never plays for them. */
  const away = (i: number) => !seats[i]!.bot && host.players.get(seats[i]!.id)?.away === true;
  const tell =(i: number, kind: string) => {
    if (connected(i)) host.send(seats[i]!.id, { type: "buzz", kind });
  };
  const decider = () => (shell.vip ? host.players.get(shell.vip)?.name : undefined);

  // ------------------------------------------------------------------ a new round
  /** `again`: deal the same round over (nobody has moved yet, or the host restarted it). */
  function deal(again = false) {
    director.stop();
    hud.chainReset();
    stir();
    endFor = 0;
    pending = null;
    const people = host.list.slice(0, 8).map((p) => ({ id: p.id, name: p.name, bot: false }));
    const want = Math.max(0, Number(ctx.settings().bots) || 0);
    const bots = Math.min(8 - people.length, Math.max(2 - people.length, want));
    const taken = new Set(people.map((p) => p.name.toLowerCase()));
    const names = BOT_NAMES.filter((n) => !taken.has(n.toLowerCase()));
    seats = [...people, ...Array.from({ length: bots }, (_, i) => ({ id: `bot-${i}`, name: names[i] ?? `CPU ${i + 1}`, bot: true }))];
    if (!again || round === 0) round++;
    const [w, h] = boardFor(ctx.settings(), seats.length);
    game = new Game(w, h, seats.length, (round - 1) % seats.length);
    const mid = ((h - 1) >> 1) * w + ((w - 1) >> 1);
    cursor = seats.map(() => mid);
    outOrder = [];
    phase = "play";
    busy = false;
    mover = -1;
    plan = null;
    endIn = 0;
    shownPieces = seats.map(() => 0);
    shownAlive = seats.map(() => true);
    turnMs = (Number(ctx.settings().timer) || 0) * 1000;
    if (look.w !== w || look.h !== h) {
      look.build(w, h);
      stage.use(look, w, h);
    }
    syncLook();
    hud.end(null);
    startIn = T.intro;
    const first = game.turn;
    hud.note(`Round ${round} · <b>${esc(seats[first]!.name)}</b> starts`, colorOf(first), 1600);
    publish();
  }

  /** Put the board on the look as it stands (no animation). */
  function syncLook() {
    look.clear();
    for (let i = 0; i < game.w * game.h; i++) look.setCell(i, game.board.owner[i]!, game.board.count[i]!);
    look.turn(phase === "end" ? game.winner : game.turn);
    if (phase === "end") look.win(game.winner);
    showCursor();
  }

  function showCursor() {
    if (phase !== "play" || busy || startIn > 0) return look.hover(-1, 0);
    const s = game.turn;
    look.hover(cursor[s]!, s, game.canPlay(cursor[s]!));
  }

  // ------------------------------------------------------------------ turns
  function startTurn() {
    stir();
    const s = game.turn;
    turnLeft = turnMs;
    awayLeft = turnMs || T.skip;
    lastTick = 0;
    plan = null;
    look.turn(s);
    showCursor();
    sfx?.turn();
    tell(s, "turn");
    // away: nobody plays for them; the turn banner says "Waiting for…" and awayTurn() runs the clock
    if (seats[s]!.bot) planFor(T.think);
    else if (!away(s) && !connected(s)) planFor(T.away);
    publish();
  }

  function planFor(wait: number) {
    plan = { target: botMove(game), wait: wait * (0.75 + Math.random() * 0.5) };
    if (plan.target < 0) plan = null;
  }

  function moveCursor(s: number, dx: number, dy: number) {
    const w = game.w;
    const x = Math.max(0, Math.min(w - 1, (cursor[s]! % w) + dx));
    const y = Math.max(0, Math.min(game.h - 1, Math.floor(cursor[s]! / w) + dy));
    const next = y * w + x;
    if (next === cursor[s]) return;
    cursor[s] = next;
    stir();
    sfx?.step();
    showCursor();
  }

  function tryPlace(s: number) {
    if (game.canPlay(cursor[s]!)) return play(cursor[s]!);
    sfx?.nope();
    look.nope();
    stir();
    tell(s, "nope");
  }

  function play(cell: number) {
    const s = game.turn;
    const move = game.play(cell);
    if (!move) return;
    cursor[s] = cell;
    busy = true;
    mover = s;
    plan = null;
    pending = move;
    look.hover(-1, s);
    publish();
    director.play(move, () => finish(move), (b) => {
      if (b.kind === "place") sfx?.place();
      else if (b.kind === "burst") {
        sfx?.burst(b.wave, b.cells);
        hud.chain(b.wave + 1, colorOf(s));
      } else if (b.kind === "land") sfx?.land(b.wave);
      else if (b.kind === "win") sfx?.win();
    });
  }

  /** A move has finished playing out. */
  function finish(move: Move) {
    busy = false;
    pending = null;
    hud.chainDone();
    shownAlive = [...game.alive];
    shownPieces = seats.map((_, i) => game.piecesOf(i));
    for (const q of move.eliminated) {
      outOrder.push(q);
      tell(q, "out");
      if (move.winner < 0) {
        hud.note(`<b>${esc(seats[q]!.name)}</b> is out`, colorOf(q));
        sfx?.out();
      }
    }
    if (move.winner >= 0) return win(move.winner);
    startTurn();
  }

  function win(w: number) {
    phase = "end";
    const id = seats[w]!.id;
    wins.set(id, (wins.get(id) ?? 0) + 1);
    seats.forEach((_, i) => tell(i, i === w ? "win" : "lose"));
    endIn = T.endCard;
    publish();
  }

  /** Finishing order: the winner, then whoever went out last, and so on. */
  const standings = () => [game.winner, ...[...outOrder].reverse()].filter((i, k, a) => i >= 0 && a.indexOf(i) === k);

  // ------------------------------------------------------------------ what the TV and the phones show
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
      timeLeft: live && turnMs ? Math.round(turnLeft) : 0,
      timeTotal: turnMs,
      winner: phase === "end" ? game.winner : -1,
      standings: phase === "end" ? standings() : [],
      watching: [...host.players.keys()].filter((id) => seatOf(id) < 0),
    };
  }

  function publish() {
    const s = shared();
    host.setShared(s);
    seats.forEach((seat, i) => {
      if (seat.bot || !host.players.has(seat.id)) return;
      const own: CascadeOwn = { seat: i, color: colorOf(i) };
      const key = JSON.stringify(own);
      if (sentOwn.get(seat.id) === key) return;
      sentOwn.set(seat.id, key);
      host.setOwn(seat.id, own);
    });
    const active = phase === "end" ? -1 : busy ? mover : game.turn;
    hud.seats(s.seats, active);
    hud.turn(phase === "play" && active >= 0 ? s.seats[active]! : null);
    if (phase === "end" && endIn <= 0) hud.end(s, standings(), decider());
  }

  // ------------------------------------------------------------------ the clock
  function update(dt: number) {
    const ms = dt * 1000;
    if (busy) stir();
    else quietFor += ms;
    if (phase === "end") {
      endFor += ms;
      if (endIn > 0 && (endIn -= ms) <= 0) publish();
      return;
    }
    if (startIn > 0) {
      if ((startIn -= ms) <= 0) startTurn();
      return;
    }
    if (busy) return;
    const s = game.turn;
    if (away(s)) return awayTurn(s, ms);
    if (turnMs) {
      turnLeft -= ms;
      hud.timer(turnLeft / turnMs);
      const sec = Math.ceil(turnLeft / 1000);
      if (sec <= 3 && sec > 0 && sec !== lastTick) {
        lastTick = sec;
        sfx?.tick();
      }
      if (turnLeft <= 0) {
        // out of time: play where the cursor is if that's allowed, else wherever the computer would
        const c = game.canPlay(cursor[s]!) ? cursor[s]! : botMove(game);
        if (c >= 0) play(c);
        return;
      }
    } else hud.timer(null);
    if (plan && (plan.wait -= ms) <= 0) {
      const w = game.w;
      const at = cursor[s]!;
      const [x, y, tx, ty] = [at % w, Math.floor(at / w), plan.target % w, Math.floor(plan.target / w)];
      if (at === plan.target) play(at);
      else {
        if (Math.abs(tx - x) >= Math.abs(ty - y)) moveCursor(s, Math.sign(tx - x), 0);
        else moveCursor(s, 0, Math.sign(ty - y));
        plan.wait = cursor[s] === plan.target ? 260 : T.walk;
      }
    }
  }

  /**
   * The player whose turn it is is away (phone on another app, or locked). Nobody plays for them: after the
   * turn timer (or `away-skip` with the timer off) their turn passes on, if enough others are still playing;
   * otherwise the game holds the turn for them.
   */
  function awayTurn(s: number, ms: number) {
    plan = null;
    if (!canSkipAway(game, seats.map((_, i) => away(i)))) return hud.timer(null);
    awayLeft -= ms;
    hud.timer(Math.max(0, awayLeft / (turnMs || T.skip)));
    if (awayLeft > 0) return;
    hud.note(`<b>${esc(seats[s]!.name)}</b> is away · turn passed on`, colorOf(s));
    game.skip();
    startTurn();
  }

  /** The frame rate for the current state. */
  function rate() {
    if (busy || startIn > 0) return fps;
    if (phase === "end") return endFor > T.endCard + CHEER_S * 1000 ? restFps : fps;
    return quietFor > QUIET_MS ? calmFps : fps;
  }

  let raf = 0;
  let last = performance.now();
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const r = rate();
    if (r < 60 && now - last < 1000 / r - 4) return;
    // a slower state takes longer steps (the turn timer stays true); a long stall is still clamped
    const dt = Math.min(Math.max(0.05, 1.6 / r), (now - last) / 1000);
    last = now;
    if (paused) return;
    const slowed = r < fps;
    if (slowed) frameIdle();
    else frameDrawn(now);
    const t0 = performance.now();
    update(dt);
    look.update(dt, stage.camera);
    director.update(dt);
    stage.render(dt, !slowed); // frames slowed on purpose don't count against the resolution
    stage.work(performance.now() - t0);
  }

  // ------------------------------------------------------------------ the look, live from the settings
  function switchLook(id: LookId) {
    if (id === lookId) return;
    look.dispose();
    lookId = id;
    look = makeLook(id, lite);
    director.look = look;
    look.build(game.w, game.h);
    stage.use(look, game.w, game.h);
    hud.setLook(id);
    sfx?.setLook(id);
    sentOwn.clear();
    stir();
    syncLook();
    // a move that was playing jumps to its end
    if (busy && pending) director.cancel();
    publish();
  }

  // ------------------------------------------------------------------ the room
  const offs = [
    host.on("join", () => {
      if (phase === "play" && game.moves === 0 && !busy) deal(true); // nobody has moved yet: deal them in
      else publish(); // they watch until the next round
    }),
    host.on("rejoin", (p) => {
      const i = seatOf(p.id);
      if (i >= 0 && i === game.turn && plan && phase === "play" && !busy) plan = null; // they're back: their move
      publish();
    }),
    host.on("drop", (p) => {
      const i = seatOf(p.id);
      // a real disconnect: the computer plays for them. Not when they said they're away first (that's a pause)
      if (i >= 0 && i === game.turn && phase === "play" && !busy && startIn <= 0 && !plan && !p.away) planFor(T.away);
      publish();
    }),
    host.on("away", (p) => {
      const i = seatOf(p.id);
      if (i >= 0 && i === game.turn && phase === "play" && !busy && startIn <= 0) {
        if (p.away) {
          plan = null; // a computer never moves for an away player
          awayLeft = turnMs ? Math.max(0, turnLeft) : T.skip;
        } else {
          turnLeft = turnMs; // back: a fresh turn
          lastTick = 0;
          if (!p.connected && !plan) planFor(T.away);
        }
      }
      publish();
    }),
    host.on("leave", (p) => {
      const i = seats.findIndex((s) => s.id === p.id);
      sentOwn.delete(p.id);
      if (i >= 0 && phase === "play") {
        seats[i]!.bot = true; // a computer finishes their game
        if (game.alive[i]) hud.note(`<b>${esc(seats[i]!.name)}</b> left · a computer takes over`, colorOf(i));
        if (i === game.turn && !busy && startIn <= 0 && !plan) planFor(T.think);
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
      plan = null; // they're playing it themselves
      if (d.type === "move") moveCursor(s, Math.sign(Number(d.dx) || 0), Math.sign(Number(d.dy) || 0));
      else if (d.type === "place") tryPlace(s);
    }),
    ctx.onSettings((s) => {
      switchLook(lookOf(s));
      const t = (Number(s.timer) || 0) * 1000;
      if (t !== turnMs) {
        turnMs = t;
        turnLeft = t;
      }
      // board size and computer players apply from the next round, or now if nobody has moved yet
      if (phase === "play" && !busy && game.moves === 0) deal(true);
      else publish();
    }),
    shell.onChange(() => game && phase === "end" && endIn <= 0 && hud.end(shared(), standings(), decider())),
  ];

  deal();
  raf = requestAnimationFrame(frame);
  // perf=… (pnpm perf, pnpm tv --perf): the frame monitor adds these to each report
  const offPerf = setPerfExtras(() => {
    const { fps: _fps, worst: _worst, ...s } = stage.perf();
    const r = rate();
    const mode = r === fps ? "full" : phase === "end" ? "rest" : "calm";
    return { look: lookId, board: `${game.w}x${game.h}`, pieces: game.board.count.reduce((a, b) => a + b, 0), chain: busy, mode, ...s };
  });
  // dev only: poke at the game from the browser console
  if (import.meta.env.DEV) {
    (window as unknown as { __cascade: unknown }).__cascade = {
      get game() { return game; },
      get seats() { return seats; },
      play: (c: number) => !busy && phase === "play" && startIn <= 0 && play(c),
      deal,
      move: (dx: number, dy: number) => moveCursor(game.turn, dx, dy),
      look: (id: LookId) => switchLook(id),
      room: () => host.code,
    };
  }

  return {
    dispose() {
      cancelAnimationFrame(raf);
      offPerf();
      offs.forEach((o) => o());
      director.stop();
      look.dispose();
      stage.dispose();
      hud.dispose();
      sfx?.dispose();
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
