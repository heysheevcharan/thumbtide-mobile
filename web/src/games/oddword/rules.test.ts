import assert from "node:assert/strict";
import { test } from "node:test";
import { OddWord, seeded } from "./rules.ts";
import { DECKS, JOB_PAIRS, WORD_PAIRS } from "./words.ts";

function table(n: number, opts: ConstructorParameters<typeof OddWord>[0] = {}, seed = 1) {
  const g = new OddWord(opts, seeded(seed));
  for (let i = 0; i < n; i++) g.addSeat(`p${i}`, `P${i}`);
  g.drainEvents();
  return g;
}
const allDone = (g: OddWord) => g.order.forEach((id) => g.markDone(id));

// ------------------------------------------------------------------ content
test("both decks have unique pairs of two different, short words", () => {
  assert.ok(WORD_PAIRS.length >= 80 && JOB_PAIRS.length >= 50);
  for (const deck of Object.values(DECKS)) {
    const seen = new Set<string>();
    for (const [a, b] of deck) {
      assert.notEqual(a.toLowerCase(), b.toLowerCase());
      for (const w of [a, b]) {
        assert.ok(w.length <= 26, `"${w}" is too long for the TV`);
        assert.ok(!seen.has(w.toLowerCase()), `"${w}" is listed twice`);
        seen.add(w.toLowerCase());
      }
    }
  }
});

// ------------------------------------------------------------------ secrets
test("before the reveal, the shared view holds neither word nor the odd one", () => {
  for (const hint of ["decoy", "blank"] as const) {
    const g = table(5, { hint });
    for (const phase of ["describe", "vote"]) {
      assert.equal(g.phase, phase);
      const json = JSON.stringify(g.publicView());
      assert.ok(!json.includes(`"${g.word}"`) && !json.includes(g.word), `word leaked in ${phase}`);
      if (g.decoy) assert.ok(!json.includes(g.decoy), `decoy leaked in ${phase}`);
      assert.equal(g.publicView().reveal, null);
      if (phase === "describe") allDone(g);
    }
  }
});

test("decoy mode: the odd one gets the close word and is not told; everyone else gets the word", () => {
  const g = table(4, { hint: "decoy" });
  for (const id of g.order) {
    const own = g.ownView(id)!;
    assert.equal(own.odd, false);
    assert.equal(own.word, id === g.impostor ? g.decoy : g.word);
  }
  assert.ok(g.decoy && g.decoy !== g.word);
});

test("blank mode: the odd one gets no word and is told", () => {
  const g = table(4, { hint: "blank" });
  const own = g.ownView(g.impostor)!;
  assert.equal(own.word, "");
  assert.equal(own.odd, true);
  for (const id of g.order.filter((x) => x !== g.impostor)) assert.equal(g.ownView(id)!.word, g.word);
});

test("jobs mode deals from the jobs deck", () => {
  const g = table(3, { mode: "jobs" });
  assert.ok(JOB_PAIRS.some((p) => p.includes(g.word)));
  assert.equal(g.publicView().mode, "jobs");
});

// ------------------------------------------------------------------ flow
test("everyone done → vote; the most votes go out; the odd one caught", () => {
  const g = table(4);
  allDone(g);
  assert.equal(g.phase, "vote");
  const odd = g.impostor;
  for (const id of g.order) if (id !== odd) g.vote(id, odd);
  assert.equal(g.phase, "vote");
  g.vote(odd, g.order.find((x) => x !== odd)!);
  assert.equal(g.phase, "reveal");
  assert.equal(g.result!.out, odd);
  assert.equal(g.result!.caught, true);
  assert.equal(g.publicView().reveal!.word, g.word);
});

test("a tie puts nobody out", () => {
  const g = table(4);
  allDone(g);
  const [a, b, c, d] = g.order as [string, string, string, string];
  g.vote(a, b);
  g.vote(b, a);
  g.vote(c, a);
  g.vote(d, b);
  assert.equal(g.phase, "reveal");
  assert.equal(g.result!.out, null);
  assert.equal(g.result!.tie, true);
  assert.equal(g.result!.caught, false);
});

test("no self-votes, no second vote, no Done twice", () => {
  const g = table(3);
  const [a, b] = g.order as [string, string];
  assert.ok(g.markDone(a));
  assert.ok(!g.markDone(a));
  g.order.forEach((id) => g.markDone(id));
  assert.ok(!g.vote(a, a));
  assert.ok(g.vote(a, b));
  assert.ok(!g.vote(a, g.order[2]!));
});

test("the reveal ends by itself and deals a new round with a new first speaker", () => {
  const g = table(3, { revealMs: 1000 });
  const first = g.order[0];
  allDone(g);
  for (const id of g.order) g.vote(id, g.targets(id)[0]!);
  assert.equal(g.phase, "reveal");
  g.step(600);
  assert.equal(g.phase, "reveal");
  assert.equal(g.publicView().next, 1);
  g.step(600);
  assert.equal(g.phase, "describe");
  assert.notEqual(g.order[0], first);
});

test("the round waits for away players; a player who leaves stops counting", () => {
  const g = table(4);
  const [a, b, c, d] = g.order as [string, string, string, string];
  g.setAway(d, true);
  g.markDone(a);
  g.markDone(b);
  g.markDone(c);
  assert.equal(g.phase, "describe");
  g.markDone(d);
  assert.equal(g.phase, "vote");
  g.vote(d, a);
  g.removeSeat(d);
  if (d === g.impostor) return;
  g.vote(a, b);
  g.vote(b, c);
  g.vote(c, b);
  assert.equal(g.phase, "reveal");
  assert.equal(g.result!.out, b);
});

test("a player who joins before anyone is done is dealt into this round (same round number)", () => {
  const g = table(3);
  g.addSeat("early", "Early");
  assert.ok(g.order.includes("early"));
  assert.equal(g.round, 1);
  assert.ok(g.ownView("early")!.word || g.ownView("early")!.odd);
});

test("seated one by one, every seat can be the odd one in round 1", () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 80; seed++) {
    const g = table(4, {}, seed);
    assert.equal(g.round, 1);
    seen.add(g.impostor);
  }
  assert.equal(seen.size, 4);
});

test("reset starts again from round 1 with one deal", () => {
  const g = table(4);
  allDone(g);
  g.reset();
  g.startRound();
  assert.equal(g.round, 1);
  assert.equal(g.order.length, 4);
});

test("a player who joins while others describe plays now: common word, last to speak, and the round waits", () => {
  const g = table(3);
  const odd = g.impostor;
  const word = g.word;
  g.markDone(g.order[0]!);
  g.addSeat("late", "Late");
  assert.equal(g.order.at(-1), "late");
  assert.equal(g.impostor, odd);
  assert.equal(g.word, word);
  assert.equal(g.ownView("late")!.word, word);
  g.order.filter((id) => id !== "late").forEach((id) => g.markDone(id));
  assert.equal(g.phase, "describe");
  g.markDone("late");
  assert.equal(g.phase, "vote");
});

test("a player who joins during the vote or the reveal plays from the next round", () => {
  const g = table(3);
  allDone(g);
  g.addSeat("late", "Late");
  assert.ok(!g.order.includes("late"));
  assert.equal(g.ownView("late")!.playing, false);
  assert.equal(g.ownView("late")!.word, "");
  assert.ok(!g.targets(g.order[0]!).includes("late"));
  for (const id of g.order) g.vote(id, g.targets(id)[0]!);
  assert.equal(g.phase, "reveal");
  g.addSeat("later", "Later");
  g.next();
  assert.ok(g.order.includes("late") && g.order.includes("later"));
});

test("the odd one leaving ends the round; others leaving don't block it", () => {
  const g = table(4);
  const others = g.order.filter((x) => x !== g.impostor);
  g.markDone(others[0]!);
  g.removeSeat(others[1]!);
  assert.equal(g.phase, "describe");
  g.removeSeat(g.impostor);
  assert.equal(g.phase, "reveal");
  assert.equal(g.result!.left, true);

  const h = table(4);
  allDone(h);
  const [a, b, c] = h.order.filter((x) => x !== h.impostor) as [string, string, string];
  h.vote(a, b);
  h.removeSeat(b); // a's vote is void; a votes again
  assert.equal(h.ownView(a)!.vote, null);
  h.vote(a, c);
  h.vote(c, a);
  h.vote(h.impostor, a);
  assert.equal(h.phase, "reveal");
  assert.equal(h.result!.out, a);
});

test("one or two players never get stuck", () => {
  const one = table(1, { revealMs: 500 });
  one.markDone(one.order[0]!);
  assert.equal(one.phase, "reveal");
  assert.equal(one.result!.out, null);
  one.step(600);
  assert.equal(one.phase, "describe");

  const two = table(2);
  allDone(two);
  const [a, b] = two.order as [string, string];
  two.vote(a, b);
  two.vote(b, a);
  assert.equal(two.phase, "reveal");
  assert.equal(two.result!.tie, true);
});

test("computer players press Done and vote by themselves", () => {
  const g = new OddWord({ botMs: [100, 200] }, seeded(3));
  g.addSeat("me", "Me");
  g.addSeat("b1", "Bot 1", true);
  g.addSeat("b2", "Bot 2", true);
  g.startRound();
  g.markDone("me");
  g.step(250);
  assert.equal(g.phase, "vote");
  g.vote("me", "b1");
  g.step(250);
  assert.equal(g.phase, "reveal");
});

test("the odd one is not the same player twice in a row at a table of three or more", () => {
  const g = table(3, { revealMs: 1 }, 7);
  let last = g.impostor;
  for (let i = 0; i < 30; i++) {
    allDone(g);
    for (const id of g.order) g.vote(id, g.targets(id)[0]!);
    g.step(5);
    assert.notEqual(g.impostor, last);
    last = g.impostor;
  }
});
