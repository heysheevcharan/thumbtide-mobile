import assert from "node:assert/strict";
import { test } from "node:test";
import * as R from "./rules.ts";

/** Repeatable randomness. */
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

/** A started game with the Mayor at seat 0 and roles laid out as given. */
function table(roles: R.Role[], deck: R.Law[] = []) {
  const g = R.newGame(players(roles.length), seeded(1));
  g.seats.forEach((s, i) => (s.role = roles[i]!));
  g.mayor = 0;
  R.begin(g);
  if (deck.length) g.deck = [...deck, ...g.deck];
  return g;
}

/** Nominate, then everyone votes the same way and the votes are counted. */
function elect(g: R.Game, sheriff: number, yes = true) {
  assert.ok(R.nominate(g, g.mayor, sheriff), `nominate ${sheriff}`);
  g.seats.forEach((s, i) => s.alive && R.vote(g, i, yes));
  assert.ok(R.tally(g));
  R.afterTally(g);
}

test("roles and who knows whom", () => {
  for (const [n, cult] of [[5, 1], [6, 1], [7, 2], [8, 2]] as const) {
    const g = R.newGame(players(n), seeded(n));
    assert.equal(g.seats.filter((s) => s.role === "prophet").length, 1);
    assert.equal(g.seats.filter((s) => s.role === "cult").length, cult);
    assert.equal(g.deck.length, 17);
    const prophet = g.seats.findIndex((s) => s.role === "prophet");
    const cultist = g.seats.findIndex((s) => s.role === "cult");
    const town = g.seats.findIndex((s) => s.role === "town");
    assert.deepEqual(R.knows(g, town), []);
    assert.ok(R.knows(g, cultist).includes(prophet));
    // the Prophet knows the cult only at small tables
    assert.equal(R.knows(g, prophet).length, n <= 6 ? cult : 0);
  }
});

test("the last elected pair sits out as Sheriff; at five alive the Mayor doesn't", () => {
  const g = table(["town", "town", "town", "cult", "prophet", "town"], ["town", "town", "cult"]);
  elect(g, 2);
  R.mayorDiscard(g, 0, 2);
  R.sheriffEnact(g, 2, 0);
  R.afterEnacted(g);
  assert.equal(g.mayor, 1);
  assert.ok(!R.eligible(g).includes(0) && !R.eligible(g).includes(2));
  g.seats[5]!.alive = false; // five left
  assert.ok(R.eligible(g).includes(0) && !R.eligible(g).includes(2));
});

test("a tie fails; three failures in a row riot and enact the top card", () => {
  const g = table(["town", "town", "town", "cult", "prophet", "town"]);
  g.deck.unshift("cult");
  R.nominate(g, 0, 1);
  [true, true, true, false, false, false].forEach((v, i) => R.vote(g, i, v));
  R.tally(g);
  assert.equal(g.passed, false);
  R.afterTally(g);
  assert.equal(g.unrest, 1);
  elect(g, 3, false);
  elect(g, 4, false);
  assert.equal(g.phase, "enacted");
  assert.ok(g.riot);
  assert.equal(g.cult, 1);
  assert.equal(g.unrest, 0);
  assert.equal(g.power, null);
  assert.equal(g.lastSheriff, null);
});

test("electing the Prophet Sheriff wins for the cult, but only after three cult laws", () => {
  const g = table(["town", "town", "town", "cult", "prophet"]);
  elect(g, 4);
  assert.equal(g.phase, "mayor");
  const h = table(["town", "town", "town", "cult", "prophet"]);
  h.cult = 3;
  elect(h, 4);
  assert.equal(h.phase, "end");
  assert.equal(h.winner, "cult");
  assert.equal(h.reason, "prophet-elected");
});

test("cult laws hand out powers; burning the Prophet wins for the town", () => {
  const g = table(["town", "town", "town", "cult", "prophet"], ["cult", "cult", "town"]);
  g.cult = 3; // the next cult law is the fourth: burn
  elect(g, 1);
  R.mayorDiscard(g, 0, 2);
  R.sheriffEnact(g, 1, 0);
  assert.equal(g.power, "burn");
  R.afterEnacted(g);
  assert.equal(g.phase, "power");
  assert.ok(!R.powerTargets(g).includes(0));
  assert.ok(R.usePower(g, 0, 4));
  assert.ok(R.finishPower(g));
  assert.equal(g.phase, "end");
  assert.equal(g.winner, "town");
});

test("veto: agreed throws both cards away; refused makes the Sheriff enact", () => {
  const g = table(["town", "town", "town", "cult", "prophet", "town"], ["cult", "cult", "cult", "cult", "cult", "cult"]);
  g.cult = 5;
  elect(g, 1);
  R.mayorDiscard(g, 0, 0);
  assert.ok(R.askVeto(g, 1));
  assert.ok(R.answerVeto(g, 0, true));
  assert.equal(g.unrest, 1);
  assert.equal(g.mayor, 1);
  elect(g, 2);
  R.mayorDiscard(g, 1, 0);
  R.askVeto(g, 2);
  R.answerVeto(g, 1, false);
  assert.equal(g.phase, "sheriff");
  assert.ok(!R.askVeto(g, 2), "one veto request per session");
  R.sheriffEnact(g, 2, 0);
  assert.equal(g.winner, "cult");
});

test("a hand-picked Mayor, then the order carries on after the one who picked", () => {
  const g = table(["town", "town", "town", "cult", "prophet", "town", "cult"], ["cult", "cult", "cult"]);
  g.cult = 2; // the next cult law is the third: pick, at seven seats
  elect(g, 1);
  R.mayorDiscard(g, 0, 0);
  R.sheriffEnact(g, 1, 0);
  R.afterEnacted(g);
  assert.equal(g.power, "pick");
  R.usePower(g, 0, 4);
  R.finishPower(g);
  assert.equal(g.mayor, 4);
  elect(g, 2, false);
  assert.equal(g.mayor, 1);
});

test("the deck reshuffles and never loses a card", () => {
  const g = table(["town", "town", "town", "cult", "prophet"]);
  for (let round = 0; round < 8 && g.phase !== "end"; round++) {
    const total = g.deck.length + g.discard.length + g.town + g.cult;
    assert.equal(total, 17);
    elect(g, R.eligible(g)[0]!);
    if (g.phase !== "mayor") break;
    R.mayorDiscard(g, g.mayor, 0);
    R.sheriffEnact(g, g.sheriff!, g.hand.indexOf("town") >= 0 ? g.hand.indexOf("town") : 0);
    R.afterEnacted(g);
    if ((g.phase as R.Phase) === "power") {
      if (g.power === "peek") R.finishPower(g);
      else {
        R.usePower(g, g.mayor, R.powerTargets(g).find((i) => g.seats[i]!.role !== "prophet")!);
        R.finishPower(g);
      }
    }
  }
});
