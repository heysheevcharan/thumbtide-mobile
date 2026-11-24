import assert from "node:assert/strict";
import { test } from "node:test";
import { createBots } from "./bots.ts";
import { DOODLES } from "./doodles.ts";
import {
  GUESS_GAP, Inkling, PICK_STEPS, REVEAL_STEPS, decodeStrokes, encodeStrokes, guessPoints, judgeGuess, maskOf, seeded,
  type InkEvent, type Stroke,
} from "./rules.ts";
import { WORDS, norm, wordByText } from "./words.ts";

const W = (w: string) => wordByText.get(norm(w))!;
const of = <T extends InkEvent["type"]>(ev: InkEvent[], t: T) => ev.filter((e) => e.type === t) as Extract<InkEvent, { type: T }>[];

/** A match with these seats, the first artist picking. */
function picking(ids: string[], opts: Partial<Inkling["opts"]> = {}, seed = 1) {
  const g = new Inkling({ drawTime: 60, ...opts }, seeded(seed));
  ids.forEach((id, i) => g.addSeat(id, id.toUpperCase(), false, i));
  g.startMatch();
  assert.equal(g.phase, "pick");
  return g;
}
/** The same, with the artist drawing word choice 0. */
function drawing(ids: string[], opts: Partial<Inkling["opts"]> = {}, seed = 1) {
  const g = picking(ids, opts, seed);
  assert.ok(g.pick(g.artist!, 0));
  g.drainEvents();
  return g;
}
const others = (g: Inkling) => [...g.seats.keys()].filter((id) => id !== g.artist);
const run = (g: Inkling, steps: number) => {
  for (let i = 0; i < steps; i++) g.step();
};

// ------------------------------------------------------------------ content
test("the word list has 400+ unique words over three difficulties, and no near miss is another word", () => {
  assert.ok(WORDS.length >= 400, `${WORDS.length} words`);
  const seen = new Set<string>();
  for (const w of WORDS) {
    const k = norm(w.w);
    assert.ok(!seen.has(k), `"${w.w}" is listed twice`);
    seen.add(k);
    assert.ok([1, 2, 3].includes(w.d));
    assert.ok(w.w.length <= 22, `"${w.w}" is too long for the TV`);
  }
  for (const d of [1, 2, 3]) assert.ok(WORDS.filter((w) => w.d === d).length >= 100, `difficulty ${d}`);
  for (const w of WORDS) for (const a of [...w.same, ...w.near]) if (norm(a) !== norm(w.w)) assert.ok(!seen.has(norm(a)), `"${a}" (of "${w.w}") is also a word`);
});

test("there are 60+ doodles, each for a listed word, with points inside the sheet", () => {
  assert.ok(DOODLES.length >= 60, `${DOODLES.length} doodles`);
  for (const d of DOODLES) {
    assert.ok(wordByText.has(norm(d.word)), `doodle "${d.word}" is not in the word list`);
    assert.ok(d.strokes.length > 0);
    for (const s of d.strokes) {
      assert.ok(s.p.length >= 4 && s.p.length % 2 === 0);
      assert.ok(s.p.every((v) => Number.isInteger(v) && v >= 0 && v <= 1000));
      assert.ok(s.c >= 0 && s.c < 8 && s.w >= 0 && s.w < 3);
    }
  }
});

// ------------------------------------------------------------------ guesses
test("guesses: right ignores case, spaces, plurals, articles and other spellings", () => {
  assert.equal(judgeGuess("Bicycle", W("bicycle")), "right");
  assert.equal(judgeGuess("  a BICYCLES ", W("bicycle")), "right");
  assert.equal(judgeGuess("bike", W("bicycle")), "right");
  assert.equal(judgeGuess("doughnut", W("donut")), "right");
  assert.equal(judgeGuess("icecream", W("ice cream")), "right");
  assert.equal(judgeGuess("a red bicycle", W("bicycle")), "right");
});

test("guesses: case is ignored but typos never count (a slip is close), the rest is wrong", () => {
  assert.equal(judgeGuess("bicyle", W("bicycle")), "close");
  assert.equal(judgeGuess("BICYLE", W("bicycle")), "close");
  assert.equal(judgeGuess("BiCyClE", W("bicycle")), "right");
  assert.equal(judgeGuess("sofa", W("couch")), "close");
  assert.equal(judgeGuess("lighthuose", W("lighthouse")), "close"); // long words: two slips are still only close
  assert.equal(judgeGuess("cat", W("car")), "wrong"); // short words: no "close"
  assert.equal(judgeGuess("teapot", W("bicycle")), "wrong");
  assert.equal(judgeGuess("", W("bicycle")), "wrong");
});

test("the mask hides letters but shows spaces and marks", () => {
  assert.equal(maskOf("ice cream", []), "___ _____");
  assert.equal(maskOf("t-shirt", [0]), "t-_____");
  assert.equal(maskOf("crows feet", [0, 6]), "c____ f___");
});

test("points: faster and harder words are worth more; the first right guess gets a bonus", () => {
  assert.ok(guessPoints(0.9, 0, 1) > guessPoints(0.2, 0, 1));
  assert.ok(guessPoints(0.5, 1, 3) > guessPoints(0.5, 1, 1));
  assert.ok(guessPoints(0.5, 0, 2) > guessPoints(0.5, 1, 2));
  assert.ok(guessPoints(0, 5, 1) > 0);
});

// ------------------------------------------------------------------ a turn
test("the artist gets three words by the difficulty mix, never repeated in a match", () => {
  for (const [mix, want] of [["easy", [1, 1, 2]], ["mixed", [1, 2, 3]], ["hard", [2, 3, 3]]] as const) {
    const g = picking(["a", "b"], { mix });
    assert.deepEqual(g.choices.map((w) => w.d), want);
    assert.equal(new Set(g.choices.map((w) => w.w)).size, 3);
  }
  const g = picking(["a", "b", "c"]);
  const first = g.choices[2]!.w;
  g.pick(g.artist!, 2);
  assert.ok(g.used.has(first));
  for (let i = 0; i < 40; i++) assert.ok(!g.deal(false).some((w) => w.w === first));
});

test("a slow artist gets the middle word after the pick time", () => {
  const g = picking(["a", "b"]);
  const mid = g.choices[1]!;
  run(g, PICK_STEPS);
  assert.equal(g.phase, "draw");
  assert.equal(g.word, mid);
});

test("only the artist picks, and only a listed choice", () => {
  const g = picking(["a", "b"]);
  const other = others(g)[0]!;
  assert.equal(g.pick(other, 0), false);
  assert.equal(g.pick(g.artist!, 3), false);
  assert.equal(g.pick(g.artist!, -1), false);
  assert.equal(g.phase, "pick");
});

test("right guesses score by speed and order; the artist scores per right guess; the turn ends when all have it", () => {
  const g = drawing(["a", "b", "c"]);
  const artist = g.artist!;
  const [x, y] = others(g) as [string, string];
  const word = g.word!.w;
  assert.equal(g.guess(artist, word), null, "the artist cannot guess");
  run(g, 60);
  assert.equal(g.guess(x, word), "right");
  assert.equal(g.guess(x, word), null, "no second guess once you have it");
  run(g, 600);
  assert.equal(g.guess(y, word.toUpperCase()), "right");
  const ev = g.drainEvents();
  const rights = of(ev, "right");
  assert.deepEqual(rights.map((e) => [e.id, e.rank]), [[x, 0], [y, 1]]);
  assert.ok(g.seats.get(x)!.score > g.seats.get(y)!.score);
  assert.ok(g.seats.get(artist)!.score > 0);
  assert.equal(g.phase, "reveal");
  assert.deepEqual(of(ev, "end").map((e) => e.reason), ["all"]);
});

test("close and wrong guesses are events of their own; a close one is never a wrong one", () => {
  const g = drawing(["a", "b"], {}, 3);
  const x = others(g)[0]!;
  g.word = W("couch");
  assert.equal(g.guess(x, "sofa"), "close");
  run(g, GUESS_GAP);
  assert.equal(g.guess(x, "teapot"), "wrong");
  const ev = g.drainEvents();
  assert.deepEqual(of(ev, "close").map((e) => e.text), ["sofa"]);
  assert.deepEqual(of(ev, "wrong").map((e) => e.text), ["teapot"]);
});

test("guesses are rate-limited, trimmed and capped", () => {
  const g = drawing(["a", "b"]);
  const x = others(g)[0]!;
  assert.equal(g.guess(x, "one"), "wrong");
  assert.equal(g.guess(x, "two"), null, "too soon after the last");
  run(g, GUESS_GAP);
  assert.equal(g.guess(x, `   ${"z".repeat(80)}  `), "wrong");
  const w = of(g.drainEvents(), "wrong");
  assert.equal(w[1]!.text.length, 40);
  run(g, GUESS_GAP);
  assert.equal(g.guess(x, 42), null);
  assert.equal(g.guess(x, "   "), null);
});

test("hints reveal a letter at 50 % and 75 % of the time, and time runs out", () => {
  const g = drawing(["a", "b", "c"], { drawTime: 60 });
  g.word = W("pineapple");
  run(g, g.limit * 0.5 - 1);
  assert.equal(g.revealed.length, 0);
  run(g, 1);
  assert.equal(g.revealed.length, 1);
  run(g, g.limit * 0.25);
  assert.equal(g.revealed.length, 2);
  assert.equal([...g.mask()].filter((c) => c !== "_").length, 2);
  run(g, g.limit * 0.25);
  assert.equal(g.phase, "reveal");
  assert.deepEqual(of(g.drainEvents(), "end").map((e) => e.reason), ["time"]);
});

test("short words keep at least two letters hidden", () => {
  const g = drawing(["a", "b"]);
  g.word = W("cat");
  run(g, g.limit - 1);
  assert.equal(g.revealed.length, 1);
});

test("a match: everyone draws once per round, then the winner", () => {
  for (const rounds of [1, 2]) {
    const g = picking(["a", "b", "c"], { rounds });
    assert.equal(g.turnCount(), 3 * rounds);
    const artists: string[] = [];
    let guard = 0;
    while (g.phase !== "match" && guard++ < 100) {
      artists.push(g.artist!);
      g.pick(g.artist!, 0);
      // the second seat after the artist always guesses right
      const x = others(g)[0]!;
      g.guess(x, g.word!.w);
      run(g, g.limit + REVEAL_STEPS);
    }
    assert.equal(g.phase, "match");
    assert.equal(artists.length, 3 * rounds);
    for (const id of ["a", "b", "c"]) assert.equal(artists.filter((a) => a === id).length, rounds);
    const top = Math.max(...[...g.seats.values()].map((s) => s.score));
    assert.ok(g.winners.length >= 1);
    for (const w of g.winners) assert.equal(g.seats.get(w)!.score, top);
  }
});

// ------------------------------------------------------------------ seats
test("a newcomer guesses at once and draws later in the round", () => {
  const g = drawing(["a", "b"]);
  assert.equal(g.turnCount(), 2);
  g.addSeat("n", "New", false, 5);
  assert.equal(g.turnCount(), 3);
  assert.notEqual(g.guess("n", "teapot"), null);
  let drew = false;
  for (let i = 0; i < 4 && g.phase !== "match"; i++) {
    if (g.artist === "n") drew = true;
    if (g.phase === "pick") g.pick(g.artist!, 0);
    run(g, g.limit + REVEAL_STEPS + 1);
  }
  assert.ok(drew);
});

test("the artist leaving ends the turn; dropping below two players waits", () => {
  const g = drawing(["a", "b", "c"]);
  const artist = g.artist!;
  g.removeSeat(artist);
  assert.equal(g.phase, "reveal");
  assert.deepEqual(of(g.drainEvents(), "end").map((e) => e.reason), ["left"]);
  run(g, REVEAL_STEPS);
  assert.equal(g.phase, "pick");
  g.removeSeat(others(g)[0]!);
  g.removeSeat(g.artist!);
  run(g, REVEAL_STEPS + 1);
  assert.equal(g.phase, "wait");
  g.addSeat("x", "X");
  g.addSeat("y", "Y");
  run(g, 1);
  assert.equal(g.phase, "pick");
});

test("a dropped phone does not hold up 'everyone has it'", () => {
  const g = drawing(["a", "b", "c"]);
  const [x, y] = others(g) as [string, string];
  g.setAway(y, true);
  g.guess(x, g.word!.w);
  assert.equal(g.phase, "reveal");
});

test("a lone guesser's phone dropping does not end the turn; the last guesser leaving does", () => {
  const g = drawing(["a", "b"]);
  const x = others(g)[0]!;
  g.setAway(x, true);
  assert.equal(g.phase, "draw");
  g.setAway(x, false);
  g.removeSeat(x);
  assert.equal(g.phase, "reveal");
  assert.deepEqual(of(g.drainEvents(), "end").map((e) => e.reason), ["alone"]);
});

test("seats get distinct colours, and at most eight", () => {
  const g = new Inkling();
  for (let i = 0; i < 10; i++) g.addSeat(`p${i}`, `P${i}`, false, 0);
  assert.equal(g.seats.size, 8);
  assert.equal(new Set([...g.seats.values()].map((s) => s.slot)).size, 8);
});

// ------------------------------------------------------------------ the drawing
test("ink: only the artist, this turn, in-range points and rising stroke ids", () => {
  const g = drawing(["a", "b"]);
  const a = g.artist!;
  const x = others(g)[0]!;
  const t = g.turn;
  assert.equal(g.ink(x, t, 1, 0, 1, [1, 2], 0), false, "not the artist");
  assert.equal(g.ink(a, t + 1, 1, 0, 1, [1, 2], 0), false, "another turn");
  assert.equal(g.ink(a, t, 1, 9, 1, [1, 2], 0), false, "no such colour");
  assert.equal(g.ink(a, t, 1, 0, 3, [1, 2], 0), false, "no such size");
  assert.equal(g.ink(a, t, 1, 0, 1, [1, 2, 3], 0), false, "odd point list");
  assert.equal(g.ink(a, t, 1, 0, 1, [1, 2000], 0), false, "off the sheet");
  assert.equal(g.ink(a, t, 1, 0, 1, [1.5, 2], 0), false, "not whole");
  assert.equal(g.ink(a, t, 1, 0, 1, "nope", 0), false);
  assert.equal(g.ink(a, t, 1, 0, 1, [10, 10], 0), true);
  assert.equal(g.ink(a, t, 1, 0, 1, [20, 20], 1), true);
  assert.equal(g.ink(a, t, 1, 0, 1, [30, 30], 0), false, "that stroke is done");
  assert.equal(g.ink(a, t, 2, 8, 2, [5, 5], 1), true, "the eraser");
  assert.equal(g.strokes.length, 2);
  assert.deepEqual(g.strokes[0]!.p, [10, 10, 20, 20]);
  assert.equal(g.inkPoints, 3);
  const rev = g.inkRev;
  assert.ok(g.undo(a, t));
  assert.equal(g.strokes.length, 1);
  assert.ok(g.inkRev > rev);
  assert.equal(g.ink(a, t, 2, 0, 1, [1, 1], 0), false, "an undone stroke's id is not reused");
  assert.ok(g.ink(a, t, 3, 0, 1, [1, 1], 0));
  assert.ok(g.clear(a, t));
  assert.equal(g.strokes.length, 0);
  assert.equal(g.inkPoints, 0);
  assert.equal(g.undo(x, t), false);
});

test("a new turn starts a clean sheet", () => {
  const g = drawing(["a", "b"]);
  g.ink(g.artist!, g.turn, 1, 0, 1, [10, 10, 20, 20], 1);
  const rev = g.inkRev;
  run(g, g.limit + REVEAL_STEPS);
  assert.equal(g.strokes.length, 0);
  assert.ok(g.inkRev > rev);
});

test("the stroke snapshot for a returning phone round-trips and stays under the relay's size", () => {
  const small: Stroke[] = [
    { id: 3, c: 1, w: 2, p: [10, 20, 30, 40, 50, 60], done: true },
    { id: 7, c: 8, w: 0, p: [500, 500], done: true },
  ];
  const back = decodeStrokes(encodeStrokes(small));
  assert.deepEqual(back.map((s) => [s.id, s.c, s.w, s.p]), small.map((s) => [s.id, s.c, s.w, s.p]));
  // a huge, scribbly drawing still fits (simplified)
  const rng = seeded(9);
  const big: Stroke[] = Array.from({ length: 600 }, (_, i) => ({
    id: i + 1, c: i % 9, w: i % 3, done: true,
    p: Array.from({ length: 200 }, () => Math.floor(rng() * 1001)),
  }));
  const enc = encodeStrokes(big);
  assert.ok(enc.length <= 11000, `${enc.length} chars`);
  const dec = decodeStrokes(enc);
  assert.ok(dec.length > 0);
  for (const s of dec) assert.ok(s.p.every((v) => v >= 0 && v <= 1000));
  assert.deepEqual(decodeStrokes("junk|1.2:x"), []);
});

// ------------------------------------------------------------------ bots
test("bots play a whole match: bot artists draw their doodle word, bot guessers guess", () => {
  const rng = seeded(4);
  const g = new Inkling({ drawTime: 60 }, rng);
  const bots = createBots(g, rng);
  bots.setCount(4);
  g.startMatch();
  let strokes = 0, rights = 0, wrongs = 0;
  const words: string[] = [];
  for (let i = 0; i < 60 * 60 * 10 && g.phase !== "match"; i++) {
    bots.step();
    g.step();
    if (g.phase === "draw" && g.word && words[words.length - 1] !== g.word.w) words.push(g.word.w);
    strokes = Math.max(strokes, g.strokes.length);
    for (const e of g.drainEvents()) {
      if (e.type === "right") rights++;
      if (e.type === "wrong") wrongs++;
    }
  }
  assert.equal(g.phase, "match");
  assert.equal(words.length, 4);
  for (const w of words) assert.ok(DOODLES.some((d) => d.word === w), `bots drew "${w}" without a doodle`);
  assert.ok(strokes >= 2);
  assert.ok(rights >= 3 && rights <= 12, `${rights} right guesses`);
  assert.ok(wrongs > 0);
});

test("bot guessers wait for real ink from a person", () => {
  const rng = seeded(5);
  const g = new Inkling({ drawTime: 60 }, rng);
  g.addSeat("human", "Human", false, 0);
  const bots = createBots(g, rng);
  bots.setCount(3);
  g.startMatch();
  // play until the person draws
  for (let i = 0; i < 60 * 60 * 6 && !(g.artist === "human" && g.phase === "pick"); i++) {
    bots.step();
    g.step();
  }
  assert.equal(g.artist, "human");
  g.pick("human", 0);
  g.drainEvents();
  for (let i = 0; i < g.limit - 1; i++) {
    bots.step();
    g.step();
  }
  assert.equal(of(g.drainEvents(), "right").length, 0);
});

test("setting the bot count adds and removes bots, never the one drawing", () => {
  const rng = seeded(6);
  const g = new Inkling({}, rng);
  const bots = createBots(g, rng);
  bots.setCount(5);
  assert.equal(g.seats.size, 5);
  g.startMatch();
  const artist = g.artist!;
  bots.setCount(1);
  assert.equal(bots.count, 1);
  assert.ok(g.seats.has(artist));
});

test("a guess late in one turn never blocks guesses early in the next turn (the turn clock restarts)", () => {
  const g = drawing(["a", "b", "c"], {}, 4);
  const late = others(g)[0]!;
  run(g, 30 * 60);
  assert.equal(g.guess(late, "zzzz not it"), "wrong");
  // play out this turn and the reveal, then the next artist picks
  for (let i = 0; i < 200 * 60 && g.phase !== "pick"; i++) g.step();
  assert.equal(g.phase, "pick");
  assert.ok(g.pick(g.artist!, 0));
  const guesser = g.artist === late ? others(g)[0]! : late;
  run(g, 60); // one second into the new turn
  assert.equal(g.guess(guesser, g.word!.w.toUpperCase()), "right");
});
