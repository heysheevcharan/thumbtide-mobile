import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePad, PadError } from "./pad.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the games' own pad files parse", () => {
  for (const id of ["cult", "oddword", "inkling", "cascade"]) {
    const pad = parsePad(read(`../${id}/${id}.pad`), `${id}.pad`);
    assert.ok(pad, id);
  }
  const cult = parsePad(read("../cult/cult.pad"), "cult.pad");
  assert.ok(cult.tune["roles-time"]);
});

test("defaults fill in what a file leaves out", () => {
  const p = parsePad(`button go\n  label "GO"`);
  assert.equal(p.orientation, "any");
  assert.equal(p.sendRate, 40);
  assert.equal(p.stick, undefined);
  assert.equal(p.buttons[0]!.fires, "press");
  assert.equal(p.buttons[0]!.haptic, 14);
});

test("values: units, percentages, quotes, comments, repeat", () => {
  const p = parsePad(`
# a comment
controller
  send-rate 30hz   # trailing comment
stick move
  label "Go # not a comment"
  deadzone 0.1
  full-at 90%
  directions 8
button fire
  label "FIRE"
  fires repeat 120ms
`);
  assert.equal(p.sendRate, 30);
  assert.equal(p.stick!.label, "Go # not a comment");
  assert.equal(p.stick!.deadzone, 0.1);
  assert.equal(p.stick!.fullAt, 0.9);
  assert.equal(p.stick!.directions, 8);
  assert.equal(p.buttons[0]!.fires, "repeat");
  assert.equal(p.buttons[0]!.repeatMs, 120);
});

const err = (src: string) => {
  try {
    parsePad(src, "x.pad");
  } catch (e) {
    assert.ok(e instanceof PadError);
    return e.message;
  }
  assert.fail("should not parse");
};

test("mistakes say what's wrong and on which line", () => {
  assert.match(err(`stick move\n  travel 400px`), /^x\.pad:2: stick "travel" must be 16–120px/);
  assert.match(err(`stick move\n  travel 40ms`), /x\.pad:2: .*must be 16–120px/);
  assert.match(err(`stick move\n  wobble 3`), /x\.pad:2: stick has no setting "wobble"/);
  assert.match(err(`button a\n  label "A"\nbutton a\n  label "B"`), /x\.pad:3: there's already a control called "a"/);
  assert.match(err(`button a`), /x\.pad:1: button "a" needs a label/);
  assert.match(err(`  label "A"`), /x\.pad:1: this setting isn't inside a block/);
  assert.match(err(`joystick move`), /unknown block "joystick"/);
  assert.match(err(`button a\n  label "A\n`), /x\.pad:2: can't read/);
  assert.match(err(`button a\n  label "A"\n  fires repeat`), /x\.pad:3: .*"repeat" needs how often/);
  assert.match(err(`controller\n  orientation sideways\nbutton a\n  label "A"`), /x\.pad:2: .*one of: any, landscape, portrait/);
  assert.match(err(`stick move\n  deadzone 30%\n  full-at 32%`), /well past the deadzone/);
  assert.match(err(`stick move\n  label "A"\n  label "B"`), /x\.pad:3: stick "label" is set twice/);
});

test("round buttons and choices lists", () => {
  const p = parsePad(`button buzz\n  label "BUZZ!"\n  shape round\nchoices answer\n  label "Your answer"\n  layout grid\n  confirm yes`);
  assert.equal(p.buttons[0]!.shape, "round");
  assert.deepEqual(p.choices[0], { id: "answer", label: "Your answer", hint: "", layout: "grid", haptic: 14, confirm: true });
  assert.equal(parsePad(`choices vote`).choices.length, 1);
  assert.throws(() => parsePad(`choices vote\n  layout wide`, "q.pad"), /q\.pad:2: choices "layout" must be one of: auto, list, grid/);
});
