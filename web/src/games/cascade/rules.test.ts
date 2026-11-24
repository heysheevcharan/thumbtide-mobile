import assert from "node:assert/strict";
import { test } from "node:test";
import { botMove } from "./bots.ts";
import { Game, canSkipAway, capacity, neighbours } from "./rules.ts";

test("capacity is the number of neighbours", () => {
  assert.equal(capacity(9, 6, 0), 2); // corner
  assert.equal(capacity(9, 6, 4), 3); // top edge
  assert.equal(capacity(9, 6, 10), 4); // inside
  assert.deepEqual(neighbours(9, 6, 0), [1, 9]);
});

test("a full corner bursts into both neighbours and takes them", () => {
  const g = new Game(3, 3, 2);
  g.play(0); // P0
  g.play(8); // P1
  g.play(1); // P0
  g.play(7); // P1
  const m = g.play(0)!; // P0: the corner reaches 2 and bursts
  assert.equal(m.waves.length, 1);
  assert.equal(g.board.count[0], 0);
  assert.equal(g.board.owner[0], -1);
  assert.equal(g.board.count[1], 2);
  assert.equal(g.board.owner[3], 0);
});

test("nobody is out before everyone has moved, and only own or empty cells can be played", () => {
  const g = new Game(3, 3, 3);
  g.play(0);
  assert.equal(g.canPlay(0), false); // P1 can't play P0's cell
  g.play(4);
  assert.deepEqual(g.alive, [true, true, true]);
});

test("pieces are never lost, and every game ends with one winner", () => {
  for (let k = 0; k < 20; k++) {
    const g = new Game(7, 5, 2 + (k % 5), k);
    let moves = 0;
    while (g.winner < 0 && moves < 1500) {
      g.play(botMove(g));
      moves++;
      if (g.winner < 0) assert.equal(g.moves, moves);
    }
    assert.ok(g.winner >= 0);
    assert.equal(g.alive.filter(Boolean).length, 1);
  }
});

test("an away player's turn passes on without a move, and doesn't count as their first turn", () => {
  const g = new Game(3, 3, 3);
  g.play(0); // P0
  g.skip(); // P1 is away
  assert.equal(g.turn, 2);
  assert.equal(g.moves, 1);
  assert.equal(g.moved[1], false);
  g.play(8); // P2
  assert.equal(g.turn, 0);
  // P1 has never moved, so they can't be knocked out while away
  assert.deepEqual(g.alive, [true, true, true]);
});

test("a skip passes over players who are out", () => {
  const g = new Game(3, 3, 3);
  g.alive[1] = false;
  g.skip();
  assert.equal(g.turn, 2);
  g.skip();
  assert.equal(g.turn, 0);
});

test("an away player's turn passes on only while two others can still play", () => {
  const g = new Game(3, 3, 3); // P0's turn
  assert.equal(canSkipAway(g, [true, false, false]), true);
  assert.equal(canSkipAway(g, [true, true, false]), false); // one left: the game waits for them
  assert.equal(canSkipAway(g, [true, true, true]), false);
  assert.equal(canSkipAway(new Game(3, 3, 2), [true, false]), false); // a head-to-head always waits
  g.alive[2] = false;
  assert.equal(canSkipAway(g, [true, false, false]), false);
});
