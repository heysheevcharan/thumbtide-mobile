// Inkling's rules: seats, turns, the secret word, guesses, scores and the drawing's stroke list.
// Plain TypeScript (no DOM, no canvas), stepped at a fixed 60 Hz with an injected random source, so it is testable.
//
// A match: every seat draws once per round (1 or 2 rounds). A turn: the artist picks one of three words (pick), then
// draws it while the others guess (draw); hints reveal a letter at 50 % and 75 % of the time; the turn ends when
// time is up or everyone has it, and the word is shown (reveal). After the last turn: the final scores (match).
import { norm, WORDS, type Word } from "./words.ts";

export type Rng = () => number;
export type Phase = "wait" | "pick" | "draw" | "reveal" | "match";
export type Mix = "easy" | "mixed" | "hard";

export const STEP = 1 / 60;
export const MAX_SEATS = 8;
export const DRAW_TIMES = [60, 80, 100] as const;
export const ROUND_OPTIONS = [1, 2] as const;
export const MIXES: Record<Mix, [1 | 2 | 3, 1 | 2 | 3, 1 | 2 | 3]> = { easy: [1, 1, 2], mixed: [1, 2, 3], hard: [2, 3, 3] };
export const PICK_STEPS = 15 * 60;
export const REVEAL_STEPS = 7 * 60;
/** Points scale with the word's difficulty. */
export const MULT = { 1: 1, 2: 1.5, 3: 2 } as const;
/** Extra points for the first, second and third right guess. */
export const RANK_BONUS = [50, 25, 10];
export const ARTIST_PER_GUESS = 40;
/** Hints come at these fractions of the draw time. */
export const HINTS = [0.5, 0.75];
/** Minimum gap between one player's guesses (steps): typing faster than this is spam. */
export const GUESS_GAP = 6;
export const MAX_GUESS = 40;

// stroke limits (also what a phone may send)
export const COORD = 1000;
export const COLORS = 8;
/** Colour index of the eraser. */
export const ERASER = 8;
export const SIZES = 3;
export const MAX_STROKES = 900;
export const MAX_POINTS = 60000;
export const MAX_BATCH = 400;

export interface Options {
  drawTime: number;
  rounds: number;
  mix: Mix;
}

export interface Seat {
  id: string;
  name: string;
  bot: boolean;
  slot: number;
  score: number;
  /** Points this turn. */
  gained: number;
  /** Has the word this turn. */
  got: boolean;
  /** Phone not connected right now (not counted for "everyone has it"). */
  away: boolean;
  lastGuess: number;
}

/** A stroke: colour (0–7, 8 = eraser), size (0–2) and flat x,y points in 0–1000 of the sheet. */
export interface Stroke {
  id: number;
  c: number;
  w: number;
  p: number[];
  done: boolean;
}

export type EndReason = "time" | "all" | "left" | "alone";

export type InkEvent =
  | { type: "phase"; phase: Phase }
  | { type: "turn"; artist: string; turn: number }
  | { type: "right"; id: string; points: number; rank: number }
  | { type: "close"; id: string; text: string }
  | { type: "wrong"; id: string; text: string }
  | { type: "hint"; n: number }
  | { type: "end"; reason: EndReason };

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

// ------------------------------------------------------------------------------------------------ guesses

function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

const squash = (s: string) => norm(s).replace(/^(a|an|the) /, "").replace(/ /g, "");
const plural = (a: string, b: string) => a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;

/** Right, close (one letter off, or a known near miss) or wrong. */
export function judgeGuess(guess: string, word: Word): "right" | "close" | "wrong" {
  const g = squash(guess);
  if (!g) return "wrong";
  const forms = [word.w, ...word.same].map(squash);
  if (forms.some((f) => plural(g, f))) return "right";
  // the answer as a whole word inside a longer guess ("a red bicycle")
  const words = ` ${norm(guess)} `;
  if ([word.w, ...word.same].some((f) => words.includes(` ${norm(f)} `))) return "right";
  if (word.near.map(squash).some((f) => plural(g, f))) return "close";
  // typos never count (only case is ignored): a one-letter slip (two in 9+ letter words) gets a private "close" hint
  for (const f of forms) {
    if (f.length >= 9 && lev(g, f, 2) <= 2) return "close";
    if (f.length >= 4 && lev(g, f, 1) <= 1) return "close";
  }
  return "wrong";
}

/** Points for a right guess: by time left and order, scaled by difficulty. */
export function guessPoints(leftFrac: number, rank: number, d: 1 | 2 | 3): number {
  const base = (50 + 150 * Math.max(0, Math.min(1, leftFrac))) * MULT[d];
  return Math.round(base / 5) * 5 + (RANK_BONUS[rank] ?? 0);
}
export const artistPoints = (d: 1 | 2 | 3) => Math.round((ARTIST_PER_GUESS * MULT[d]) / 5) * 5;

/** The word as shown to guessers: "_" for each hidden letter; spaces and punctuation are shown. */
export function maskOf(word: string, revealed: readonly number[]): string {
  return [...word].map((ch, i) => (/[a-z0-9À-ɏ]/i.test(ch) && !revealed.includes(i) ? "_" : ch)).join("");
}

// ------------------------------------------------------------------------------------------------ strokes

const intIn = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/** Douglas–Peucker on flat x,y points. */
export function simplify(p: number[], tol: number): number[] {
  const n = p.length / 2;
  if (n <= 2 || tol <= 0) return p.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = p[a * 2]!, ay = p[a * 2 + 1]!, bx = p[b * 2]!, by = p[b * 2 + 1]!;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * p[i * 2]! - dx * p[i * 2 + 1]! + bx * ay - by * ax) / len;
      if (d > fd) {
        fd = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2]!, p[i * 2 + 1]!);
  return out;
}

/**
 * The stroke list as a compact string for a phone that comes back mid-turn: "c.w.id:x,y,dx,dy,…" joined by "|".
 * Simplified harder until it fits in `budget` characters (the relay drops frames over 16 KB).
 */
export function encodeStrokes(strokes: readonly Stroke[], budget = 11000): string {
  for (const tol of [0, 2, 4, 7, 12, 20, 32]) {
    const parts: string[] = [];
    for (const s of strokes) {
      const p = simplify(s.p, tol);
      const d: number[] = [];
      for (let i = 0; i < p.length; i += 2) d.push(i ? p[i]! - p[i - 2]! : p[i]!, i ? p[i + 1]! - p[i - 1]! : p[i + 1]!);
      parts.push(`${s.c}.${s.w}.${s.id}:${d.join(",")}`);
    }
    const out = parts.join("|");
    if (out.length <= budget) return out;
  }
  // still too long: keep the newest strokes that fit
  let out = "";
  for (let i = strokes.length - 1; i >= 0; i--) {
    const one = encodeStrokes([strokes[i]!], budget);
    if (out.length + one.length + 1 > budget) break;
    out = out ? `${one}|${out}` : one;
  }
  return out;
}

export function decodeStrokes(s: string): Stroke[] {
  if (!s) return [];
  const out: Stroke[] = [];
  for (const part of s.split("|")) {
    const [head, body = ""] = part.split(":");
    const [c, w, id] = (head ?? "").split(".").map(Number);
    if (!intIn(c, 0, ERASER) || !intIn(w, 0, SIZES - 1) || !intIn(id, 0, 1e9)) continue;
    const d = body ? body.split(",").map(Number) : [];
    const p: number[] = [];
    for (let i = 0; i + 1 < d.length; i += 2) p.push(i ? p[i - 2]! + d[i]! : d[i]!, i ? p[i - 1]! + d[i + 1]! : d[i + 1]!);
    if (p.every(Number.isFinite)) out.push({ id, c, w, p, done: true });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the game

export class Inkling {
  seats = new Map<string, Seat>();
  phase: Phase = "wait";
  /** Steps in this phase. */
  t = 0;
  opts: Options;
  /** Artist order, one list per round. */
  order: string[][] = [];
  round = 0;
  pos = -1;
  /** Turns played so far this match (the current one included). */
  turn = 0;
  artist: string | null = null;
  choices: Word[] = [];
  word: Word | null = null;
  revealed: number[] = [];
  hints = 0;
  /** Right guessers this turn, in order. */
  guessed: string[] = [];
  endReason: EndReason | null = null;
  strokes: Stroke[] = [];
  /** Bumped on undo and clear (the TV redraws the whole sheet). */
  inkRev = 0;
  inkPoints = 0;
  /** The highest stroke id seen this turn: a new stroke needs a higher one. */
  maxSid = -1;
  /** Draw time of the current turn, in steps. */
  limit = 80 * 60;
  winners: string[] = [];
  /** Words used this match (not offered again). */
  used = new Set<string>();
  /** For a bot artist: only words it has a doodle for. */
  botWords: ((w: Word) => boolean) | null = null;
  private events: InkEvent[] = [];

  constructor(opts: Partial<Options> = {}, readonly rng: Rng = Math.random) {
    this.opts = { drawTime: 80, rounds: 1, mix: "mixed", ...opts };
  }

  configure(opts: Partial<Options>) {
    const rounds = this.opts.rounds;
    this.opts = { ...this.opts, ...opts };
    if (this.order.length && this.opts.rounds !== rounds && this.phase !== "match" && this.phase !== "wait") {
      const base = this.order[0] ?? [];
      while (this.order.length < this.opts.rounds) this.order.push(base.filter((id) => this.seats.has(id)));
      this.order.length = Math.max(this.round + 1, Math.min(this.order.length, this.opts.rounds));
    }
  }

  drainEvents(): InkEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
  private emit(e: InkEvent) {
    this.events.push(e);
  }
  private go(phase: Phase) {
    this.phase = phase;
    this.t = 0;
    // the guess spam check counts in this phase's steps: a guess time from an earlier turn must not block new guesses
    for (const s of this.seats.values()) s.lastGuess = -1e9;
    this.emit({ type: "phase", phase });
  }

  // ------------------------------------------------------------------ seats
  addSeat(id: string, name: string, bot = false, want = 0): Seat | null {
    const had = this.seats.get(id);
    if (had) return had;
    if (this.seats.size >= MAX_SEATS) return null;
    const taken = new Set([...this.seats.values()].map((s) => s.slot));
    let slot = ((want % MAX_SEATS) + MAX_SEATS) % MAX_SEATS;
    while (taken.has(slot)) slot = (slot + 1) % MAX_SEATS;
    const s: Seat = { id, name, bot, slot, score: 0, gained: 0, got: false, away: false, lastGuess: -1e9 };
    this.seats.set(id, s);
    // mid-match: they draw too, at the end of this round and of every later one
    if (this.phase !== "wait" && this.phase !== "match") for (let r = this.round; r < this.order.length; r++) this.order[r]!.push(id);
    return s;
  }

  removeSeat(id: string) {
    if (!this.seats.delete(id)) return;
    this.guessed = this.guessed.filter((g) => g !== id);
    if (id === this.artist && (this.phase === "pick" || this.phase === "draw")) this.endTurn("left");
    else if (this.phase === "draw" && ![...this.seats.keys()].some((s) => s !== this.artist)) this.endTurn("alone");
    else if (this.phase === "draw") this.checkAll();
  }

  setAway(id: string, away: boolean) {
    const s = this.seats.get(id);
    if (!s) return;
    s.away = away;
    if (this.phase === "draw") this.checkAll();
  }

  /** Seats by score (then colour). */
  standings(): Seat[] {
    return [...this.seats.values()].sort((a, b) => b.score - a.score || a.slot - b.slot);
  }

  /** Turns in the whole match (played and still to come). */
  turnCount(): number {
    let n = this.turn;
    for (let r = this.round; r < this.order.length; r++) {
      const list = this.order[r]!;
      for (let i = r === this.round ? this.pos + 1 : 0; i < list.length; i++) if (this.seats.has(list[i]!)) n++;
    }
    return n;
  }

  // ------------------------------------------------------------------ match flow
  startMatch() {
    for (const s of this.seats.values()) {
      s.score = 0;
      s.gained = 0;
      s.got = false;
    }
    this.used.clear();
    this.winners = [];
    this.turn = 0;
    this.round = 0;
    this.pos = -1;
    this.artist = null;
    this.word = null;
    this.clearInk();
    if (this.seats.size < 2) {
      this.order = [];
      this.go("wait");
      return;
    }
    const base = [...this.seats.values()].sort((a, b) => a.slot - b.slot).map((s) => s.id);
    // a random first artist, then round the table
    const k = Math.floor(this.rng() * base.length);
    const ring = [...base.slice(k), ...base.slice(0, k)];
    this.order = Array.from({ length: this.opts.rounds }, () => ring.slice());
    this.nextTurn();
  }

  private nextTurn() {
    for (const s of this.seats.values()) {
      s.gained = 0;
      s.got = false;
    }
    this.guessed = [];
    this.word = null;
    this.revealed = [];
    this.hints = 0;
    this.endReason = null;
    this.clearInk();
    this.resetSid();
    if (this.seats.size < 2) {
      this.artist = null;
      this.go("wait");
      return;
    }
    for (;;) {
      this.pos++;
      const list = this.order[this.round];
      if (!list) break;
      if (this.pos >= list.length) {
        this.round++;
        this.pos = -1;
        continue;
      }
      const id = list[this.pos]!;
      if (!this.seats.has(id)) continue;
      this.artist = id;
      this.turn++;
      this.choices = this.deal(this.seats.get(id)!.bot);
      this.emit({ type: "turn", artist: id, turn: this.turn });
      this.go("pick");
      return;
    }
    this.finish();
  }

  private finish() {
    this.artist = null;
    const top = Math.max(...[...this.seats.values()].map((s) => s.score));
    this.winners = this.standings().filter((s) => s.score === top).map((s) => s.id);
    this.round = Math.max(0, this.order.length - 1);
    this.go("match");
  }

  /** Three words for the artist, by the difficulty mix; a bot artist only gets words it can draw. */
  deal(bot: boolean): Word[] {
    const fits = (w: Word) => !this.used.has(w.w) && (!bot || !this.botWords || this.botWords(w));
    const out: Word[] = [];
    for (const d of MIXES[this.opts.mix] ?? MIXES.mixed) {
      let pool = WORDS.filter((w) => w.d === d && fits(w) && !out.includes(w));
      if (!pool.length) pool = WORDS.filter((w) => fits(w) && !out.includes(w));
      if (!pool.length) pool = WORDS.filter((w) => !out.includes(w));
      out.push(pool[Math.floor(this.rng() * pool.length)]!);
    }
    return out;
  }

  /** The artist picks one of the three words. */
  pick(id: string, i: number): boolean {
    if (this.phase !== "pick" || id !== this.artist || !intIn(i, 0, this.choices.length - 1)) return false;
    this.word = this.choices[i]!;
    this.used.add(this.word.w);
    this.limit = Math.round((DRAW_TIMES as readonly number[]).includes(this.opts.drawTime) ? this.opts.drawTime : 80) * 60;
    this.go("draw");
    return true;
  }

  /** Who draws after the current turn (null after the last one). */
  upNext(): string | null {
    for (let r = this.round, i = this.pos + 1; r < this.order.length; r++, i = 0) {
      const list = this.order[r]!;
      for (; i < list.length; i++) if (this.seats.has(list[i]!)) return list[i]!;
    }
    return null;
  }

  /** Seconds left in the current phase. */
  left(): number {
    const total = this.phase === "pick" ? PICK_STEPS : this.phase === "draw" ? this.limit : this.phase === "reveal" ? REVEAL_STEPS : 0;
    return Math.max(0, (total - this.t) / 60);
  }

  mask(): string {
    return this.word ? maskOf(this.word.w, this.revealed) : "";
  }

  /** Who could still guess: everyone but the artist, here and without the word yet. */
  guessers(): Seat[] {
    return [...this.seats.values()].filter((s) => s.id !== this.artist && !s.away);
  }

  /** Ends the turn when every guesser here has the word. A phone that drops never ends it on its own. */
  private checkAll() {
    if (this.phase !== "draw") return;
    const g = this.guessers();
    if (g.length && g.every((s) => s.got)) this.endTurn("all");
  }

  private endTurn(reason: EndReason) {
    if (this.phase !== "pick" && this.phase !== "draw") return;
    this.endReason = reason;
    if (this.phase === "pick" && reason !== "left") this.word = this.choices[1] ?? null;
    if (this.word) this.revealed = [...this.word.w].map((_, i) => i);
    this.emit({ type: "end", reason });
    this.go("reveal");
  }

  step() {
    this.t++;
    switch (this.phase) {
      case "wait":
        if (this.seats.size >= 2) this.startMatch();
        break;
      case "pick":
        if (this.t >= PICK_STEPS && this.artist) this.pick(this.artist, 1);
        break;
      case "draw": {
        const due = HINTS.filter((h) => this.t >= this.limit * h).length;
        while (this.hints < due) {
          this.hints++;
          this.hint();
        }
        if (this.t >= this.limit) this.endTurn("time");
        break;
      }
      case "reveal":
        if (this.t >= REVEAL_STEPS) this.nextTurn();
        break;
      default:
        break;
    }
  }

  /** Reveals one more hidden letter, while at least two stay hidden. */
  private hint() {
    if (!this.word) return;
    const hidden = [...this.word.w].flatMap((ch, i) => (/[a-z0-9]/i.test(norm(ch)) && !this.revealed.includes(i) ? [i] : []));
    if (hidden.length < 3) return;
    this.revealed.push(hidden[Math.floor(this.rng() * hidden.length)]!);
    this.emit({ type: "hint", n: this.hints });
  }

  /** A guess from a phone (or a bot). Returns how it went, or null when it was not taken. */
  guess(id: string, text: unknown): "right" | "close" | "wrong" | null {
    const s = this.seats.get(id);
    if (this.phase !== "draw" || !s || id === this.artist || s.got || !this.word || typeof text !== "string") return null;
    const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_GUESS);
    if (!clean || this.t - s.lastGuess < GUESS_GAP) return null;
    s.lastGuess = this.t;
    const how = judgeGuess(clean, this.word);
    if (how === "right") {
      const rank = this.guessed.length;
      const pts = guessPoints(1 - this.t / this.limit, rank, this.word.d);
      s.got = true;
      s.score += pts;
      s.gained = pts;
      this.guessed.push(id);
      const a = this.artist ? this.seats.get(this.artist) : null;
      if (a) {
        const ap = artistPoints(this.word.d);
        a.score += ap;
        a.gained += ap;
      }
      this.emit({ type: "right", id, points: pts, rank });
      this.checkAll();
    } else if (how === "close") this.emit({ type: "close", id, text: clean });
    else this.emit({ type: "wrong", id, text: clean });
    return how;
  }

  // ------------------------------------------------------------------ the drawing
  private clearInk() {
    this.strokes = [];
    this.inkPoints = 0;
    this.inkRev++;
  }
  private resetSid() {
    this.maxSid = -1;
  }
  private canInk(id: string, turn: unknown) {
    return this.phase === "draw" && id === this.artist && turn === this.turn;
  }

  /** New points for stroke `sid` (a new id starts a stroke). Everything is checked: phones send this. */
  ink(id: string, turn: unknown, sid: unknown, c: unknown, w: unknown, pts: unknown, end: unknown): boolean {
    if (!this.canInk(id, turn) || !intIn(sid, 0, 1e9) || !Array.isArray(pts) || pts.length % 2 || pts.length > MAX_BATCH * 2) return false;
    if (!pts.every((v) => intIn(v, 0, COORD))) return false;
    let s = this.strokes[this.strokes.length - 1];
    if (!s || s.id !== sid) {
      if (sid <= this.maxSid) return false; // an old stroke (undone, cleared, or a late batch)
      if (!intIn(c, 0, ERASER) || !intIn(w, 0, SIZES - 1) || this.strokes.length >= MAX_STROKES) return false;
      if (s) s.done = true;
      s = { id: sid, c, w, p: [], done: false };
      this.maxSid = sid;
      this.strokes.push(s);
    } else if (s.done) return false;
    const room = Math.max(0, (MAX_POINTS - this.inkPoints) * 2);
    const add = (pts as number[]).slice(0, room);
    s.p.push(...add);
    this.inkPoints += add.length / 2;
    if (end) s.done = true;
    return true;
  }

  undo(id: string, turn: unknown): boolean {
    if (!this.canInk(id, turn) || !this.strokes.length) return false;
    const s = this.strokes.pop()!;
    this.inkPoints -= s.p.length / 2;
    this.inkRev++;
    return true;
  }

  clear(id: string, turn: unknown): boolean {
    if (!this.canInk(id, turn)) return false;
    this.clearInk();
    return true;
  }
}
