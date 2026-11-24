// Cult's logic (on the hosting phone): deals the seats, runs the rules, times each beat, tells each phone only what that
// player may know, and plays the computer seats.
import type { Host } from "@thumbtide/sdk";
import { shell } from "../../shell/host-state.ts";
import { audio } from "../../shell/sound.ts";
import { gameById } from "../registry.ts";
import { isSys, type HostMount } from "../types.ts";
import { createAudio } from "./audio.ts";
import { BOT_NAMES, botTurn, decide, type Memory } from "./bots.ts";
import * as R from "./rules.ts";
import { POWER_ART, POWER_NAME, SEAT_COLORS, type CultGame, type CultOwn, type CultShared, type CultToHost } from "./shared.ts";
import type { InkTone } from "../kit/inked.ts";
import type { ArtName } from "./shared.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** setTimeout that holds still while the game is paused. */
function createTimers() {
  interface T { fn: () => void; due: number; left: number; id: ReturnType<typeof setTimeout> | null }
  const list = new Set<T>();
  let paused = false;
  const arm = (t: T) => {
    t.due = performance.now() + t.left;
    t.id = setTimeout(() => {
      list.delete(t);
      t.fn();
    }, t.left);
  };
  return {
    after(ms: number, fn: () => void) {
      const t: T = { fn, due: 0, left: ms, id: null };
      list.add(t);
      if (!paused) arm(t);
    },
    pause() {
      paused = true;
      for (const t of list) {
        if (t.id) clearTimeout(t.id);
        t.id = null;
        t.left = Math.max(0, t.due - performance.now());
      }
    },
    resume() {
      paused = false;
      for (const t of list) arm(t);
    },
    clear() {
      for (const t of list) if (t.id) clearTimeout(t.id);
      list.clear();
    },
  };
}

function shuffled<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j]!, b[i]!];
  }
  return b;
}

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<CultGame>;
  // how long each beat lasts comes from cult.pad's tune block
  const tune = gameById("cult")?.controls?.tune ?? {};
  const T = {
    roles: tune["roles-time"] ?? 30000,
    tally: tune["tally-time"] ?? 3500,
    law: tune["law-time"] ?? 3000,
    burn: tune["burn-time"] ?? 3500,
    pick: 2200,
    think: tune["bot-think"] ?? 1600,
    lastVote: 700,
  };
  // the TV's poster is gone: every phone draws the table from the shared state, and the big banners go out as messages
  const view = {
    render(_s: CultShared, _vip?: string) {},
    reset() {},
    dispose() {},
    banner(text: string, tone: InkTone, sub = "", ms = 1800, art?: ArtName) {
      host.broadcast({ type: "banner", text, tone, sub, ms, art });
    },
  };
  const sfx = createAudio(audio());
  const timers = createTimers();
  let paused = false;

  let g!: R.Game;
  /** Seats a computer plays: bots, and anyone who left mid-game. */
  let botSeats = new Set<number>();
  let ready = new Set<number>();
  let mem: Memory = { laws: [], found: new Map() };
  const pending = new Set<number>();
  let counting = false;
  let lastCue = "";

  const seatOf = (id: string) => g.seats.findIndex((s) => s.id === id);
  const human = (i: number) => !botSeats.has(i) && host.players.has(g.seats[i]!.id);
  const nameOf = (i: number) => g.seats[i]!.name;
  const tell = (i: number, kind: string) => {
    if (human(i)) host.send(g.seats[i]!.id, { type: "buzz", kind });
  };

  // ------------------------------------------------------------------ a new game
  function deal() {
    timers.clear();
    pending.clear();
    counting = false;
    lastCue = "";
    const people = host.list.slice(0, 8).map((p) => ({ id: p.id, name: p.name }));
    const extra = Math.max(0, Number(ctx.settings().bots) || 0);
    const bots = Math.min(8 - people.length, Math.max(R.MIN_SEATS - people.length, 0) + extra);
    const taken = new Set(people.map((p) => p.name.toLowerCase()));
    const names = shuffled(BOT_NAMES.filter((n) => !taken.has(n.toLowerCase())));
    const seats = shuffled([...people, ...Array.from({ length: bots }, (_, i) => ({ id: `bot-${i}`, name: names[i] ?? `Bot ${i + 1}` }))]);
    g = R.newGame(seats);
    botSeats = new Set(seats.flatMap((p, i) => (p.id.startsWith("bot-") ? [i] : [])));
    ready = new Set();
    mem = { laws: [], found: new Map() };
    view.reset();
    timers.after(T.roles, begin);
    publish();
  }

  function begin() {
    if (g.phase !== "roles") return;
    R.begin(g);
    publish();
  }

  // ------------------------------------------------------------------ moves (from phones and bots alike)
  function act(seat: number, m: CultToHost) {
    if (paused || seat < 0) return;
    switch (m.type) {
      case "ready":
        if (g.phase !== "roles") return;
        ready.add(seat);
        if (g.seats.every((_, i) => ready.has(i))) return begin();
        break;
      case "vote":
        if (!R.vote(g, seat, !!m.yes)) return;
        sfx?.tick();
        if (R.allVoted(g) && !counting) {
          counting = true;
          timers.after(T.lastVote, count);
        }
        break;
      case "pick":
        if (g.phase === "nominate") {
          if (!R.nominate(g, seat, Number(m.seat))) return;
        } else if (g.phase === "power") {
          if (!R.usePower(g, seat, Number(m.seat))) return;
          powerUsed();
        } else return;
        break;
      case "card":
        if (g.phase === "mayor") {
          if (!R.mayorDiscard(g, seat, Number(m.i))) return;
        } else if (g.phase === "sheriff") {
          const mayor = g.mayor;
          if (!R.sheriffEnact(g, seat, Number(m.i))) return;
          mem.laws.push({ mayor, sheriff: seat, law: g.law! });
          enacted();
        } else return;
        break;
      case "veto":
        if (!R.askVeto(g, seat)) return;
        break;
      case "veto-answer":
        if (!R.answerVeto(g, seat, !!m.yes)) return;
        if (!m.yes) view.banner("No veto", "gold", "The Sheriff has to choose", 1600);
        else if (g.phase === "enacted") enacted(); // the veto tipped the town into a riot
        else view.banner("Vetoed", "bone", "Both laws thrown away");
        break;
      case "done":
        if (g.phase !== "power" || seat !== g.mayor || (g.power !== "peek" && g.power !== "investigate")) return;
        if (!R.finishPower(g)) return;
        break;
      default:
        return;
    }
    publish();
  }

  /** Every vote is in: flip them over, then move on. */
  function count() {
    counting = false;
    if (!R.tally(g)) return;
    sfx?.reveal();
    if (g.passed) sfx?.passed();
    else sfx?.failed();
    view.banner(g.passed ? "Elected!" : "Rejected", g.passed ? "go" : "stop", "", T.tally - 300);
    publish();
    timers.after(T.tally, () => {
      R.afterTally(g);
      if (g.phase === "enacted") enacted(); // three rejections: riot
      else if (g.phase === "end") ended();
      publish();
    });
  }

  function enacted() {
    const law = g.law!;
    sfx?.law(law === "town");
    if (g.riot) {
      sfx?.riot();
      view.banner("Riot!", "stop", `The town forces a ${law} law through`, T.law);
    } else view.banner(law === "town" ? "Town law" : "Cult law", law, "", T.law - 300);
    timers.after(T.law, () => {
      R.afterEnacted(g);
      if (g.phase === "end") ended();
      else if (g.phase === "power") {
        sfx?.power();
        view.banner(POWER_NAME[g.power!], "cult", `${esc(nameOf(g.mayor))} gets a power`, 2400, POWER_ART[g.power!]);
      }
      publish();
    });
  }

  function powerUsed() {
    const t = g.target!;
    if (g.power === "investigate") {
      mem.found.set(g.mayor, [...(mem.found.get(g.mayor) ?? []), { seat: t, party: g.found! }]);
      // the Mayor reads the answer on their phone, then taps Done
    } else if (g.power === "pick") {
      view.banner(`${nameOf(t)} is next`, "gold", "A hand-picked Mayor", T.pick, "badge-mayor");
      timers.after(T.pick, () => {
        R.finishPower(g);
        publish();
      });
    } else if (g.power === "burn") {
      sfx?.burn();
      view.banner("Burn!", "cult", esc(nameOf(t)), T.burn, "power-burn");
      tell(t, "burned");
      timers.after(T.burn, () => {
        R.finishPower(g);
        if (g.phase === "end") ended();
        publish();
      });
    }
  }

  function ended() {
    sfx?.win(g.winner === "town");
    g.seats.forEach((s, i) => tell(i, R.partyOf(s.role) === g.winner ? "win" : "lose"));
  }

  // ------------------------------------------------------------------ what everyone sees, and what only you see
  function shared(): CultShared {
    const end = g.phase === "end";
    return {
      phase: g.phase,
      seats: g.seats.map((s, i) => ({
        id: s.id,
        name: s.name,
        color: SEAT_COLORS[i % SEAT_COLORS.length]!,
        alive: s.alive,
        bot: botSeats.has(i),
        away: !botSeats.has(i) && (host.players.get(s.id)?.connected === false || host.players.get(s.id)?.away === true),
      })),
      mayor: g.mayor,
      sheriff: g.sheriff,
      eligible: g.phase === "nominate" ? R.eligible(g) : [],
      voted: g.phase === "vote" ? g.votes.flatMap((v, i) => (v !== null ? [i] : [])) : [],
      votes: g.phase === "tally" ? g.votes : null,
      passed: g.passed,
      town: g.town,
      cult: g.cult,
      unrest: g.unrest,
      deck: g.deck.length,
      powers: R.powersFor(g.seats.length),
      power: g.phase === "power" ? g.power : null,
      targets: R.powerTargets(g),
      target: g.phase === "power" ? g.target : null,
      law: g.law,
      riot: g.riot,
      vetoOpen: R.vetoOpen(g),
      ready: [...ready],
      winner: end ? g.winner : null,
      reason: end ? g.reason : null,
      roles: end ? g.seats.map((s) => s.role) : null,
      watching: [...host.players.keys()].filter((id) => seatOf(id) < 0),
    };
  }

  function own(i: number): CultOwn {
    const holding = (g.phase === "mayor" && i === g.mayor) || (g.phase === "sheriff" && i === g.sheriff);
    return {
      seat: i,
      color: SEAT_COLORS[i % SEAT_COLORS.length]!,
      role: g.seats[i]!.role,
      allies: R.knows(g, i).map((j) => ({ seat: j, role: g.seats[j]!.role })),
      hand: holding ? [...g.hand] : null,
      peek: g.phase === "power" && g.power === "peek" && i === g.mayor ? R.peekCards(g) : null,
      found: mem.found.get(i) ?? [],
      vote: g.phase === "vote" ? g.votes[i]! : null,
      ready: ready.has(i),
      canVeto: g.phase === "sheriff" && i === g.sheriff && R.vetoOpen(g) && !g.vetoRefused,
    };
  }

  function publish() {
    const s = shared();
    host.setShared(s);
    g.seats.forEach((seat, i) => {
      if (human(i)) host.setOwn(seat.id, own(i));
    });
    view.render(s, shell.vip ? host.players.get(shell.vip)?.name : undefined);
    cue();
    scheduleBots();
  }

  /** A buzz for whoever has to move now. */
  function cue() {
    const key = `${g.phase}:${g.mayor}:${g.sheriff}:${g.target}`;
    if (key === lastCue) return;
    lastCue = key;
    if (g.phase === "nominate" || g.phase === "mayor" || g.phase === "veto" || (g.phase === "power" && g.target === null)) tell(g.mayor, "turn");
    else if (g.phase === "sheriff") tell(g.sheriff!, "turn");
    else if (g.phase === "vote") g.seats.forEach((s, i) => s.alive && tell(i, "vote"));
  }

  function scheduleBots() {
    if (paused) return;
    for (const i of botSeats) {
      if (pending.has(i) || !botTurn(g, i, ready)) continue;
      pending.add(i);
      const delay = g.phase === "roles" ? 400 + Math.random() * 2000 : T.think * (0.6 + Math.random() * 0.9);
      timers.after(delay, () => {
        pending.delete(i);
        if (!botSeats.has(i) || !botTurn(g, i, ready)) return;
        const m = decide(g, i, mem);
        if (m) act(i, m);
        scheduleBots();
      });
    }
  }

  // ------------------------------------------------------------------ the room
  const offs = [
    host.on("join", () => publish()), // they watch until the next game
    host.on("rejoin", () => publish()),
    host.on("drop", () => publish()),
    host.on("away", () => publish()), // the game waits for them; only a player who leaves gets a bot
    host.on("leave", (p) => {
      const i = seatOf(p.id);
      if (i >= 0 && g.phase !== "end") {
        botSeats.add(i); // a computer finishes their game, role and all
        view.banner(`${nameOf(i)} left`, "bone", "A bot takes their seat", 1800);
      }
      publish();
    }),
    host.on("message", (p, d) => {
      if (isSys(d) || !d || typeof d !== "object") return;
      if (d.type === "again") {
        if (p.id === shell.vip && g.phase === "end") deal();
        return;
      }
      const i = seatOf(p.id);
      if (i >= 0 && !botSeats.has(i)) act(i, d);
    }),
    shell.onChange(() => g && view.render(shared(), shell.vip ? host.players.get(shell.vip)?.name : undefined)),
  ];

  deal();
  // dev only: poke at the game from the browser console
  if (import.meta.env.DEV) (window as unknown as { __cult: unknown }).__cult = { get g() { return g; }, act, room: () => host.code, restart: deal, publish };

  return {
    dispose() {
      timers.clear();
      offs.forEach((o) => o());
      sfx?.dispose();
      view.dispose();
    },
    pause() {
      paused = true;
      timers.pause();
    },
    resume() {
      paused = false;
      timers.resume();
      scheduleBots();
    },
    restart() {
      deal();
    },
  };
};

export default mount;
