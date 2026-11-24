// Computer players.
//  - As the artist: picks a word it has a doodle for (the deal only offers those), then draws that doodle stroke by
//    stroke through the same calls a phone makes, a little shifted, scaled and wobbled, done in about a third of the
//    time. The doodles are in doodles.ts.
//  - As a guesser: each turn it decides whether it will get the word (likelier for easy words and good drawings,
//    and again at each hint) and when (mostly after a hint). Until then it types plausible wrong guesses from the
//    same category now and then. Against a person's drawing it only gets it once there is real ink on the sheet.
import { DOODLE_BY_WORD } from "./doodles.ts";
import { judgeGuess, MAX_SEATS, type Inkling, type Rng, type Seat } from "./rules.ts";
import { WORDS, type Word } from "./words.ts";

export const BOT_NAMES = ["Smudge", "Scribble", "Crayon", "Charcoal", "Sepia", "Quill", "Nib", "Graphite"];
export const isBot = (id: string) => id.startsWith("bot-");

/** Chance to get a word at all, by difficulty (before skill and hints). */
const SOLVE = { 1: 0.7, 2: 0.52, 3: 0.36 } as const;

interface Guesser {
  turn: number;
  will: boolean;
  /** Fraction of the draw time when it gets it. */
  at: number;
  nextWrong: number;
  wrongs: number;
  hintsSeen: number;
}
interface Artist {
  turn: number;
  pickAt: number;
  /** The doodle to draw, flattened into a queue of strokes. */
  strokes: Array<{ c: number; w: number; p: number[] }>;
  si: number;
  pi: number;
  sid: number;
  pause: number;
  rate: number;
  batch: number[];
}

export function createBots(game: Inkling, rng: Rng = Math.random) {
  const skill = new Map<string, number>();
  const guessers = new Map<string, Guesser>();
  const artists = new Map<string, Artist>();
  game.botWords = (w: Word) => DOODLE_BY_WORD.has(w.w);
  let made = 0;

  const ids = () => [...game.seats.values()].filter((s) => s.bot).map((s) => s.id);

  function addOne(): string | null {
    if (game.seats.size >= MAX_SEATS) return null;
    const taken = new Set([...game.seats.values()].map((s) => s.name));
    const name = BOT_NAMES.find((n) => !taken.has(n)) ?? `Bot ${made + 1}`;
    const id = `bot-${++made}`;
    const free = [...Array(MAX_SEATS).keys()].find((i) => ![...game.seats.values()].some((s) => s.slot === i)) ?? 0;
    if (!game.addSeat(id, name, true, free)) return null;
    skill.set(id, 0.85 + rng() * 0.3);
    return id;
  }

  /** Removes one bot, never the one drawing right now if another will do. */
  function removeOne(): boolean {
    const list = ids();
    const id = list.reverse().find((b) => b !== game.artist) ?? list[0];
    if (!id) return false;
    game.removeSeat(id);
    guessers.delete(id);
    artists.delete(id);
    return true;
  }

  // ------------------------------------------------------------------ guessing
  function planGuess(s: Seat): Guesser {
    const word = game.word!;
    const sk = skill.get(s.id) ?? 1;
    const botArt = !!game.artist && game.seats.get(game.artist)?.bot;
    const p = Math.min(0.95, SOLVE[word.d] * sk + (botArt ? 0.08 : 0));
    // most get it after a hint; a few early
    const at = rng() < 0.3 ? 0.14 + rng() * 0.34 : 0.52 + rng() * 0.42;
    return { turn: game.turn, will: rng() < p, at, nextWrong: 0.06 + rng() * 0.12, wrongs: 0, hintsSeen: 0 };
  }

  function wrongGuess(word: Word): string | null {
    const pool = WORDS.filter((w) => w.cat === word.cat && w.w !== word.w);
    for (let i = 0; i < 6 && pool.length; i++) {
      const w = pool[Math.floor(rng() * pool.length)]!;
      if (judgeGuess(w.w, word) === "wrong") return w.w;
    }
    return null;
  }

  function stepGuesser(s: Seat) {
    const word = game.word;
    if (!word || s.got) return;
    let g = guessers.get(s.id);
    if (!g || g.turn !== game.turn) {
      g = planGuess(s);
      guessers.set(s.id, g);
    }
    // a hint gives a bot that was stuck another chance
    if (game.hints > g.hintsSeen) {
      g.hintsSeen = game.hints;
      if (!g.will && rng() < 0.22 * (skill.get(s.id) ?? 1)) {
        g.will = true;
        g.at = Math.max(game.t / game.limit + 0.04 + rng() * 0.1, g.at);
      }
    }
    const f = game.t / game.limit;
    const humanArt = !!game.artist && !game.seats.get(game.artist)?.bot;
    const enoughInk = !humanArt || game.inkPoints >= 40;
    if (g.will && f >= g.at && game.t > 6 * 60 && enoughInk) {
      game.guess(s.id, word.w);
      return;
    }
    if (f >= g.nextWrong && g.wrongs < 4 && game.inkPoints > 0) {
      const text = wrongGuess(word);
      if (text) game.guess(s.id, text);
      g.wrongs++;
      g.nextWrong = f + 0.1 + rng() * 0.14;
    }
  }

  // ------------------------------------------------------------------ drawing
  function planArt(): Artist {
    const doodle = game.word ? DOODLE_BY_WORD.get(game.word.w) : undefined;
    const sc = 0.88 + rng() * 0.14;
    const dx = (rng() - 0.5) * 70;
    const dy = (rng() - 0.5) * 60;
    const tilt = (rng() - 0.5) * 0.08;
    const cos = Math.cos(tilt), sin = Math.sin(tilt);
    const strokes = (doodle?.strokes ?? []).map((s) => {
      const p: number[] = [];
      for (let i = 0; i < s.p.length; i += 2) {
        // the sheet is 3:4, so turn in a square space
        const x = (s.p[i]! - 500) * 0.75, y = s.p[i + 1]! - 500;
        const rx = (x * cos - y * sin) / 0.75, ry = x * sin + y * cos;
        const wob = () => (rng() - 0.5) * 3;
        p.push(clamp(500 + rx * sc + dx + wob()), clamp(500 + ry * sc + dy + wob()));
      }
      return { c: s.c, w: s.w, p };
    });
    const pts = strokes.reduce((n, s) => n + s.p.length / 2, 0);
    const steps = Math.max(8 * 60, Math.min(28 * 60, game.limit * 0.32)) - strokes.length * 10;
    return { turn: game.turn, pickAt: 0, strokes, si: 0, pi: 0, sid: 1, pause: 30, rate: Math.max(0.5, pts / Math.max(60, steps)), batch: [] };
  }

  function stepArtist(id: string) {
    if (game.phase === "pick") {
      let a = artists.get(id);
      if (!a || a.turn !== game.turn) {
        a = { turn: game.turn, pickAt: 70 + Math.floor(rng() * 90), strokes: [], si: 0, pi: 0, sid: 1, pause: 0, rate: 1, batch: [] };
        artists.set(id, a);
      }
      if (game.t >= a.pickAt) {
        const r = rng();
        game.pick(id, r < 0.3 ? 0 : r < 0.75 ? 1 : 2);
      }
      return;
    }
    let a = artists.get(id);
    if (!a || a.turn !== game.turn || (a.strokes.length === 0 && a.pickAt !== -1)) {
      a = planArt();
      a.pickAt = -1;
      artists.set(id, a);
    }
    if (a.si >= a.strokes.length) return;
    if (a.pause > 0) {
      a.pause--;
      return;
    }
    const s = a.strokes[a.si]!;
    const n = s.p.length / 2;
    a.pi += a.rate;
    const upto = Math.min(n, Math.floor(a.pi));
    const sent = a.batch.length / 2;
    // points not yet sent for this stroke, sent every 3 steps (a phone sends about every 50 ms)
    const from = Math.floor(sent);
    if (upto > from && (game.t % 3 === 0 || upto >= n)) {
      const pts = s.p.slice(from * 2, upto * 2);
      a.batch.push(...pts);
      game.ink(id, game.turn, a.sid, s.c, s.w, pts, upto >= n);
    }
    if (upto >= n) {
      a.si++;
      a.sid++;
      a.pi = 0;
      a.batch = [];
      a.pause = 6 + Math.floor(rng() * 10);
    }
  }

  const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));

  return {
    get count() {
      return ids().length;
    },
    addOne,
    /** Sets the number of bots (as far as seats allow). */
    setCount(n: number) {
      while (ids().length > n && removeOne());
      while (ids().length < n && addOne());
    },
    /** Frees a seat for a person: removes one bot. */
    yieldOne: removeOne,
    step() {
      if (game.phase !== "pick" && game.phase !== "draw") return;
      const art = game.artist ? game.seats.get(game.artist) : null;
      if (art?.bot) stepArtist(art.id);
      if (game.phase !== "draw") return;
      for (const s of game.seats.values()) if (s.bot && s.id !== game.artist) stepGuesser(s);
    },
  };
}

export type Bots = ReturnType<typeof createBots>;
