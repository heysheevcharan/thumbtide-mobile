# Making games for Thumbtide

How the platform works, and a step-by-step guide to adding a game. Set the project up first (see the
[README](../README.md#quick-start)), and read [notes.md](notes.md) for the design rules before you design one.

## How it works

```
 phone ──┐                          ┌── TV page (the "host")
 phone ──┼── WebSocket ── relay ────┤   runs all game logic
 phone ──┘                          └── draws the game
```

- The **relay** (`server/`) is deliberately simple. It creates rooms with 4-letter codes, passes messages along and
  tracks who's connected. It knows nothing about games.
- The **TV page** owns the game. It reads players' input, runs the rules and draws everything.
- **Phones** are controllers. They show what the TV tells them to and send input back.

### Where things are

```
packages/protocol    The messages the relay, TV and phones exchange (types, limits, close codes)
packages/sdk         Browser library: Host (TV side), Controller (phone side), touch buttons, haptics, QR codes
server               The relay (Node + ws)
web                  The site
  index.html           the TV page
  join/                the phone page
  src/shell/           what every game gets for free: lobby frame, host menu, pause menu, settings, sound, TV app support
  src/games/           one folder per game, plus:
    registry.ts          the list of games, their settings and controllers
    types.ts             what a game must export
    kit/                 shared parts for games: the .pad language, the phone gamepad, lettering, icons
  public/              images served as-is (covers, art, icons)
  art/                 prompts for generated art
  scripts/             tv.mjs (LG TV app), art.mjs (art generation)
  tv/webos/            the LG TV app's manifest and icons
```

### Sending messages between the TV and phones

The SDK gives every game four ways to talk:

| Call | Direction | Use it for | Delivery |
|---|---|---|---|
| `ctl.send()` → `host.on("message")` | phone → TV | button presses, votes, picks | reliable, in order |
| `ctl.input()` → `player.input` | phone → TV | sticks, tilt: anything continuous | latest value wins, about 40 times a second |
| `host.send()` / `host.broadcast()` | TV → phone | one-off events: buzz, "you got hit" | reliable, in order |
| `host.setShared()` / `host.setOwn()` | TV → phone | what a phone should show right now | **sticky**: a phone that reconnects gets it again |

`setShared` goes to every phone. `setOwn` goes to one player, for things only they should see (their colour, a secret
role, their hand of cards).

### What the platform already handles

You don't need to build any of this into a game:

- **Dropped phones.** A phone that loses Wi-Fi or reloads keeps its place for 60 seconds and rejoins as the
  same player. A TV page reload keeps the same room and everyone stays in.
- **Phones on another app.** A phone that switches app or locks tells the TV it's *away* first. Its player is
  paused, not dropped: the seat waits up to 10 minutes and no computer takes it over.
- **The host menu.** Pause, resume, restart, end the game, change settings, lock the room and remove players, all
  from the host's phone. The TV never needs a keyboard. A game switches on pause and restart by returning those functions.
- **Phone-as-controller problems.** Fullscreen on Android (and an Add to Home Screen prompt on iPhone, which can't go
  fullscreen in the browser), the back gesture asks before leaving, the screen stays awake, controls let go when a
  notification pops up, no zooming or text selection, safe areas around notches, a left-handed switch, a connection
  dot, and haptics (Android, and iPhones on iOS 18 or newer).
- **A help sheet.** Each game's **?** button lists its controls, built from its `.pad` file.
- **TV remote support.** Arrow keys and OK in the lobby, Back for the pause menu.

### The phone controller: `.pad` files

Each game describes its phone controller in a `<game>.pad` file, a small language made for this project: which
controls the phone shows, how the stick and buttons feel, the vibration patterns and any numbers the game wants to
tune. Save the file and phones pick up the change straight away.

```
controller
  orientation  landscape     # landscape | portrait | any
  send-rate    40hz          # stick updates per second

stick move
  label        "Steer"       # shown faintly until the first touch
  travel       40px          # thumb travel from centre to rim
  full-at      80%           # full speed this far out
  deadzone     7%
  curve        0.85          # 1 = linear; lower = livelier with a small push
  directions   any           # any | 8 | 4 (4 for grid games)

button splat
  label        "SPLAT!"
  style        primary       # primary | secondary
  shape        rounded       # rounded | round (one big arcade button)
  haptic       22ms
  fires        press         # press | release | repeat 150ms

choices answer               # a list the game fills in when it needs a pick (answers, votes)
  layout       auto          # auto | list | grid | row

buzz                         # named vibration patterns: ms on, off, on…
  hit          60 40 120

tune                         # numbers the game reads (speeds, delays…)
  accel        20
```

Mistakes are reported with the file and line, for example `wetpaint.pad:14: stick "travel" must be 16–120px`.
Every setting and its limits are documented at the top of `web/src/games/kit/pad.ts`.


## Build your own game

The quickest start is to copy **Sandbox**, the smallest game: one stick, one button, about 200 lines in all.

### Step 1: copy Sandbox

```sh
cp -r web/src/games/sandbox web/src/games/mygame
cd web/src/games/mygame
mv sandbox.pad mygame.pad
mv sandbox.css mygame.css
```

Then, inside the copied files, change `"sandbox"` to `"mygame"`, `SandboxGame` to `MyGame`, the `./sandbox.css`
import to `./mygame.css`, and the `sbx-` class names to a prefix of your own.

A game is these files:

| File | Runs on | What goes in it |
|---|---|---|
| `shared.ts` | both | The message types: what phones send, what the TV sends back |
| `mygame.pad` | phone | The controller: stick, buttons, choices, vibrations, tune numbers |
| `host.ts` | TV | The game: rules, drawing, sound |
| `controller.ts` | phone | The controller screen (usually just the gamepad built from the `.pad` file) |

Bigger games also keep their rules in a separate `rules.ts` with no drawing code, so they can be tested (see Step 6).

### Step 2: describe the messages (`shared.ts`)

```ts
export interface MyGame {
  toHost: { type: "jump" };                 // phone → TV, with ctl.send()
  input: { x: number; y: number };          // phone → TV, continuous, with ctl.input()
  toController: { type: "hit" };            // TV → phone, with host.send() / host.broadcast()
  shared: { phase: "play" | "end" } | null; // TV → every phone, with host.setShared()
  own: { color: string };                   // TV → one phone, with host.setOwn()
}
```

TypeScript then checks every message on both sides.

### Step 3: the controller (`mygame.pad` and `controller.ts`)

Describe the controls in `mygame.pad` (see the format above). `controller.ts` builds the gamepad from it and wires
up what happens:

```ts
import type { Controller } from "@thumbtide/sdk";
import { gamepad } from "../kit/gamepad.ts";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import type { MyGame } from "./shared.ts";
import "./mygame.css";

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<MyGame>;
  const pad = gamepad(ctx.root, gameById("mygame")!.controls!, {
    ctl,
    onStick: ({ x, y }) => ctl.input({ x, y }),
    onPress: (id) => id === "jump" && ctl.send({ type: "jump" }),
  });

  const offs = [
    // ctl.shared or ctl.own changed: update the phone, e.g. tint it in the player's colour
    ctl.on("state", () => pad.el.style.setProperty("--c", ctl.own?.color ?? "#7c5cff")),
    // a one-off event from the TV: play a vibration pattern from the .pad file
    ctl.on("message", (msg) => msg.type === "hit" && pad.buzz("hit")),
  ];

  return () => {
    pad.destroy();
    offs.forEach((off) => off());
  };
};

export default mount;
```

For a pick from a list (a quiz answer, a vote), add a `choices` block to the `.pad` file, call
`pad.showChoices("answer", ["Paris", "Rome", "Oslo"])` and handle `onChoose: (id, index) => …`.
A phone can also draw its own screen into `ctx.root` instead of using the gamepad. Cult does this for its role card.

### Step 4: the game itself (`host.ts`)

The TV side gets a `root` element to draw into (a canvas, a three.js scene or plain HTML) and the `host` object for
players and messages:

```ts
import type { Host } from "@thumbtide/sdk";
import { colorFor } from "../../config.ts";
import { isSys, type HostMount } from "../types.ts";
import type { MyGame } from "./shared.ts";

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<MyGame>;
  const canvas = document.createElement("canvas");
  ctx.root.appendChild(canvas);

  // Players already in the room are in host.players when the game starts; "join" fires for newcomers.
  const welcome = () => {
    for (const p of host.players.values()) host.setOwn(p.id, { color: colorFor(p.index) });
  };
  welcome();

  const offs = [
    host.on("join", welcome),
    host.on("leave", (p) => { /* remove their piece */ }),
    host.on("message", (p, msg) => {
      if (isSys(msg)) return; // platform messages (pause, settings…) are handled for you
      if (msg.type === "jump") { /* make p jump, and maybe host.send(p.id, { type: "hit" }) */ }
    }),
  ];

  let raf = requestAnimationFrame(function frame() {
    raf = requestAnimationFrame(frame);
    for (const p of host.players.values()) {
      const stick = p.input ?? { x: 0, y: 0 }; // the latest stick position
      // move p, then draw
    }
  });

  // Return a cleanup function, or { dispose, pause, resume, restart } to switch on those host-menu items.
  return () => {
    cancelAnimationFrame(raf);
    offs.forEach((off) => off());
  };
};

export default mount;
```

Each player has `id`, `name`, `index` (their join order, used for colours), `connected`, `away` and `input`. Other events:
`drop` (their phone disconnected, they may come back), `rejoin`, and `away` (`p.away` changed: their phone is on
another app or locked; keep their seat, let their piece idle and don't hand it to a computer).
Settings are read with `ctx.settings()`. `ctx.onSettings(fn)` tells you when the host changes one mid-game.
`ctx.exit()` returns to the lobby.

### Step 5: add it to the library (`web/src/games/registry.ts`)

```ts
import mygamePad from "./mygame/mygame.pad?raw";

// add to the GAMES list:
{
  id: "mygame",
  title: "My Game",
  tagline: "One line for the library.",
  minPlayers: 1,
  maxPlayers: 8,
  colors: ["#ff5d73", "#3ec5ff"],        // a drawn cover in these colours…
  glyph: "action",                       // …with this icon. Or set `cover` to an image in web/public/covers/
  controls: parsePad(mygamePad, "mygame.pad"),
  settings: [
    {
      key: "rounds",
      label: "Rounds",
      options: [3, 5, 7].map((n) => ({ value: n, label: String(n) })),
      default: 5,
      // applies: "now",                 // apply mid-game rather than from the next round
      // when: { key: "mode", value: "custom" },  // only show while another setting has this value
    },
  ],
  host: () => import("./mygame/host.ts"),
  controller: () => import("./mygame/controller.ts"),
},
```

With `pnpm dev` running, open **http://localhost:5173/?game=mygame** and join from a phone, or pick it from the
library.

### Step 6: test it

- Put the rules in `rules.ts`, as plain TypeScript with no drawing, and test them in `rules.test.ts` next to it.
  `pnpm test` runs every `web/src/games/*/*.test.ts` with Node's built-in test runner. `cascade/rules.test.ts` is a
  short example.
- `pnpm typecheck` before you share your work.
- Try it on a real phone. A desktop browser doesn't show how a stick feels under a thumb.

### Tips from the games so far

- **Keep the phone a controller.** The TV does the showing. A phone shows controls, a label or two and secrets
  (a hidden role, a hand of cards).
- **Give each game its own look.** Each game has its own fonts, colours and art, and doesn't reuse another game's style.
- **Don't explain the rules on screen.** Controls are labelled, and the help sheet comes from the `.pad` file.
- **Computer players** (`bots.ts` in Wet Paint, Cult and Cascade) make it playable alone and fill seats when someone leaves.
- **TVs are slow.** If the game is for the LG TV app: it runs an old Chrome (79 to 87), so avoid CSS `color-mix()`,
  `:has()` and `aspect-ratio`. Check `isWebOS` from `shell/tv.ts` to switch on a lighter mode (30fps, lower
  resolution), as `cascade/look/stage.ts` and Wet Paint's low quality do. Details in [docs/lg-tv.md](lg-tv.md).
- The full list of design rules is in [docs/notes.md](notes.md).
- **Sound.** `shell/sound.ts` is the TV's shared sound engine. Cascade plays short recordings
  (`cascade/audio.ts`, files in `cascade/sounds/`) bundled into the code, so they also work in the TV app.
