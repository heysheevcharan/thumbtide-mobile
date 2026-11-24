// Odd Word Out's rules: seats, rounds, the secret words, Done, votes and the reveal.
// Plain TypeScript (no DOM), stepped by the host in milliseconds with an injected random source, so it is testable.
//
// A round: everyone dealt in gets the same word except one player, the odd one, who gets a close word (decoy mode)
// or no word (blank mode). Players describe out loud, in the order on the TV, then press Done (describe). When
// everyone who is here is done, everyone votes for who to put out (vote). The TV then shows the word, the odd one
// and who went out (reveal), and the next round starts by itself.
//
// Ties: when two or more players share the most votes, nobody goes out (and the odd one gets away).
// Joining: before anyone is done, the round is dealt again with the newcomer in; later while people describe, they
// join with the common word and speak last; while voting or in the reveal, they play from the next round.
// Away or dropped phones are waited for (a dropped phone that doesn't come back leaves after 60 s, and the host can
// remove a player from the host menu); only a player who leaves stops counting.
import { SEAT_COLORS, type Hint, type OddOwn, type OddShared, type Phase, type Reveal, type SeatView } from "./shared.ts";
import { DECKS, type Mode, type Pair } from "./words.ts";

export type Rng = () => number;

export const MAX_SEATS = 8;

export interface Options {
  mode: Mode;
  hint: Hint;
  /** How long the reveal stays up before the next round. */
  revealMs: number;
  /** Computer players act after a random wait in this range. */
  botMs: [number, number];
}

export const DEFAULTS: Options = { mode: "words", hint: "decoy", revealMs: 14000, botMs: [2500, 6000] };

export interface Seat {
  id: string;
  name: string;
  /** Colour and shape slot, 0 to MAX_SEATS - 1. */
  slot: number;
  bot: boolean;
  away: boolean;
}

export type OddEvent = { type: "phase"; phase: Phase } | { type: "round"; round: number };

/** Mulberry32: a small seeded random source for tests. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class OddWord {
  opts: Options;
  readonly seats = new Map<string, Seat>();
  phase: Phase = "describe";
  round = 0;
  /** This round's players in speaking order. */
  order: string[] = [];
  word = "";
  decoy = "";
  impostor = "";
  impostorName = "";
  /** The mode and hint the current round was dealt with (settings apply from the next round). */
  dealt: { mode: Mode; hint: Hint } = { mode: "words", hint: "decoy" };
  readonly done = new Set<string>();
  /** Voter → target. */
  readonly votes = new Map<string, string>();
  result: Reveal | null = null;
  revealLeft = 0;

  private readonly rng: Rng;
  private events: OddEvent[] = [];
  private botAt = new Map<string, number>();
  private recent: Record<Mode, number[]> = { words: [], jobs: [] };
  private lastImpostor = "";
  /** The previous round's odd one (a re-deal must still avoid them). */
  private prevImpostor = "";

  constructor(opts: Partial<Options> = {}, rng: Rng = Math.random) {
    this.opts = { ...DEFAULTS, ...opts };
    this.rng = rng;
  }

  configure(opts: Partial<Options>) {
    this.opts = { ...this.opts, ...opts };
  }

  drainEvents(): OddEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ------------------------------------------------------------------ seats
  freeSlot(): number {
    const used = new Set([...this.seats.values()].map((s) => s.slot));
    for (let i = 0; i < MAX_SEATS; i++) if (!used.has(i)) return i;
    return -1;
  }

  addSeat(id: string, name: string, bot = false): boolean {
    if (this.seats.has(id) || this.seats.size >= MAX_SEATS) return false;
    this.seats.set(id, { id, name, slot: this.freeSlot(), bot, away: false });
    // nobody is playing (the first player, or everyone left): deal a round now
    if (!this.order.length) this.startRound();
    // the round has only just started (nobody is done yet): deal it again with them in, a new pair and a new odd
    // one, so the first to join isn't always the odd one (anyone who already looked sees a fresh word)
    else if (this.phase === "describe" && !this.done.size) this.deal();
    // mid-round, while people describe: join now with the common word, last in the speaking order
    else if (this.phase === "describe") {
      this.order.push(id);
      if (bot) this.scheduleBot(id);
    }
    // voting or the reveal: from the next round
    return true;
  }

  removeSeat(id: string) {
    if (!this.seats.delete(id)) return;
    const wasPlaying = this.order.includes(id);
    this.order = this.order.filter((x) => x !== id);
    this.done.delete(id);
    this.botAt.delete(id);
    this.votes.delete(id);
    // votes for them no longer count: those voters vote again
    for (const [v, t] of [...this.votes]) if (t === id) this.votes.delete(v);
    if (!wasPlaying || this.phase === "reveal") return;
    if (id === this.impostor) return this.finish(true);
    if (!this.order.length) return this.startRound();
    this.check();
  }

  /** Away (phone locked, on another app, or dropped) only shows on the TV: the round still waits for them. */
  setAway(id: string, away: boolean) {
    const s = this.seats.get(id);
    if (s) s.away = away;
  }

  /** Who `id` may vote for: everyone else in the round. */
  targets(id: string): string[] {
    return this.order.includes(id) ? this.order.filter((x) => x !== id) : [];
  }

  /** A fresh start (the host menu's restart): round 1 is dealt next. */
  reset() {
    this.round = 0;
    this.order = [];
    this.lastImpostor = this.prevImpostor = this.impostor = "";
    this.done.clear();
    this.votes.clear();
    this.result = null;
    this.botAt.clear();
    this.phase = "describe";
  }

  // ------------------------------------------------------------------ the round
  startRound() {
    if (!this.seats.size) {
      // nobody to deal to: wait (the first seat deals round 1)
      this.order = [];
      this.word = this.decoy = this.impostor = "";
      return;
    }
    this.round++;
    this.prevImpostor = this.lastImpostor;
    this.events.push({ type: "round", round: this.round });
    this.deal();
  }

  /** Deals the current round: speaking order, the odd one and the words. Also re-deals it when someone joins early. */
  private deal() {
    this.phase = "describe";
    this.done.clear();
    this.votes.clear();
    this.result = null;
    this.revealLeft = 0;
    this.dealt = { mode: this.opts.mode, hint: this.opts.hint };
    const all = [...this.seats.values()].sort((a, b) => a.slot - b.slot).map((s) => s.id);
    // the speaking order goes round the table: a different first speaker each round
    const k = all.length ? (this.round - 1) % all.length : 0;
    this.order = [...all.slice(k), ...all.slice(0, k)];
    if (!this.order.length) {
      this.word = this.decoy = this.impostor = "";
      return;
    }
    // the odd one: anyone, but not last round's odd one when there's a choice
    const pool = this.order.length > 2 ? this.order.filter((id) => id !== this.prevImpostor) : this.order;
    this.impostor = pool[Math.floor(this.rng() * pool.length)]!;
    this.impostorName = this.seats.get(this.impostor)!.name;
    this.lastImpostor = this.impostor;
    const pair = this.drawPair(this.dealt.mode);
    const flip = this.rng() < 0.5;
    this.word = flip ? pair[1] : pair[0];
    this.decoy = this.dealt.hint === "decoy" ? (flip ? pair[0] : pair[1]) : "";
    this.events.push({ type: "phase", phase: "describe" });
    this.scheduleBots();
  }

  /** A pair not used in the last half of the deck. */
  private drawPair(mode: Mode): Pair {
    const deck = DECKS[mode];
    const recent = this.recent[mode];
    const fresh = deck.map((_, i) => i).filter((i) => !recent.includes(i));
    const i = fresh[Math.floor(this.rng() * fresh.length)]!;
    recent.push(i);
    while (recent.length > Math.floor(deck.length / 2)) recent.shift();
    return deck[i]!;
  }

  markDone(id: string): boolean {
    if (this.phase !== "describe" || !this.order.includes(id) || this.done.has(id)) return false;
    this.done.add(id);
    this.check();
    return true;
  }

  vote(id: string, target: string): boolean {
    if (this.phase !== "vote" || this.votes.has(id) || !this.targets(id).includes(target)) return false;
    this.votes.set(id, target);
    this.check();
    return true;
  }

  /** Skip the rest of the reveal. */
  next(): boolean {
    if (this.phase !== "reveal") return false;
    this.startRound();
    return true;
  }

  /** Moves on when everyone who is here has done their part. */
  private check() {
    const here = this.order;
    if (this.phase === "describe") {
      if (here.length && here.every((id) => this.done.has(id))) {
        this.phase = "vote";
        this.events.push({ type: "phase", phase: "vote" });
        this.scheduleBots();
        this.check(); // one player alone has nobody to vote for
      }
    } else if (this.phase === "vote") {
      const voters = here.filter((id) => this.targets(id).length);
      if (voters.every((id) => this.votes.has(id))) this.finish(false);
    }
  }

  private finish(left: boolean) {
    const tally = new Map<string, number>();
    if (!left) for (const t of this.votes.values()) tally.set(t, (tally.get(t) ?? 0) + 1);
    const top = Math.max(0, ...tally.values());
    const leaders = [...tally].filter(([, n]) => n === top && top > 0).map(([id]) => id);
    const out = leaders.length === 1 ? leaders[0]! : null;
    this.result = {
      word: this.word,
      decoy: this.decoy,
      impostor: this.impostor,
      impostorName: this.seats.get(this.impostor)?.name ?? this.impostorName,
      out,
      tie: leaders.length > 1,
      caught: out !== null && out === this.impostor,
      left,
      votes: left ? {} : Object.fromEntries(this.votes),
    };
    this.phase = "reveal";
    this.revealLeft = this.opts.revealMs;
    this.botAt.clear();
    this.events.push({ type: "phase", phase: "reveal" });
  }

  // ------------------------------------------------------------------ time and computer players
  private scheduleBots() {
    this.botAt.clear();
    for (const id of this.order) if (this.seats.get(id)?.bot) this.scheduleBot(id);
  }
  private scheduleBot(id: string) {
    const [lo, hi] = this.opts.botMs;
    this.botAt.set(id, lo + this.rng() * (hi - lo));
  }

  step(ms: number) {
    for (const [id, left] of [...this.botAt]) {
      if (left - ms > 0) {
        this.botAt.set(id, left - ms);
        continue;
      }
      this.botAt.delete(id);
      if (this.phase === "describe") this.markDone(id);
      else if (this.phase === "vote") {
        const t = this.targets(id);
        if (t.length) this.vote(id, t[Math.floor(this.rng() * t.length)]!);
      }
    }
    if (this.phase === "reveal") {
      this.revealLeft -= ms;
      if (this.revealLeft <= 0) this.startRound();
    }
  }

  // ------------------------------------------------------------------ what the TV and phones see
  seatView(s: Seat): SeatView {
    return { id: s.id, name: s.name, color: SEAT_COLORS[s.slot]!, shape: s.slot, bot: s.bot, away: s.away, playing: this.order.includes(s.id) };
  }

  /** Everyone sees this. No word and no odd one before the reveal. */
  publicView(): OddShared {
    return {
      phase: this.phase,
      mode: this.dealt.mode,
      hint: this.dealt.hint,
      round: this.round,
      seats: [...this.seats.values()].sort((a, b) => a.slot - b.slot).map((s) => this.seatView(s)),
      order: this.order.slice(),
      done: this.order.filter((id) => this.done.has(id)),
      voted: this.order.filter((id) => this.votes.has(id)),
      reveal: this.phase === "reveal" ? this.result : null,
      next: this.phase === "reveal" ? Math.max(0, Math.ceil(this.revealLeft / 1000)) : 0,
    };
  }

  /** Only this player sees this. */
  ownView(id: string): OddOwn | null {
    const s = this.seats.get(id);
    if (!s) return null;
    const playing = this.order.includes(id);
    const odd = playing && id === this.impostor;
    return {
      color: SEAT_COLORS[s.slot]!,
      shape: s.slot,
      playing,
      word: !playing ? "" : odd ? this.decoy : this.word,
      // decoy mode never tells the odd one; blank mode does (they have no word)
      odd: odd && this.dealt.hint === "blank",
      done: this.done.has(id),
      vote: this.votes.get(id) ?? null,
      targets: this.phase === "vote" ? this.targets(id) : [],
      round: this.round,
    };
  }
}
