# The games

What each game is, its settings, and where its code lives. The games are in `web/src/games/<id>/`.

## Wet Paint (`web/src/games/wetpaint/`)
Tiny brushes, one canvas: cover the most of it before time runs out. Steer with the stick; your brush lays thick
oil-paint strokes until it runs dry, then you refill at the paint pots. **SPLAT** lobs a glob that knocks over anyone
under it. **DASH** rams a rival and steals some of their paint. Power-up candies (Turbo, Mega Brush, Paint Bomb,
Shield, Paint Rain, Dry Spell) and surprise events (Power-up Shower, Turpentine, Final Frenzy) keep rounds changing.

Settings: round length, power-ups, events, computer brushes (0–4).

`sim.ts` holds the rules (unit-tested), `paint/` the three.js painter, `fx.ts` the candy and callouts, `hud.ts`,
`host.ts` and `controller.ts`. The brush marks, dab shader and canvas finish are adapted from
[Oil paint](https://patch.gg/blendi/oil-paint) by @blendi (MIT; see `paint/LICENSE-oilpaint.txt`).

## Cult (`web/src/games/cult/`)
A hidden-role game for 5–8. Most of the table is the town; a few are the cult, led by the Prophet. Each round the
Mayor nominates a Sheriff and everyone votes on their phone. An elected pair turns three law cards into one. The town
wins with five town laws or by burning the Prophet; the cult wins with six cult laws, or by getting the Prophet
elected Sheriff late in the game. Cult laws give the Mayor powers (investigate, peek, pick the next Mayor, burn).
The phone holds your secret: hold the card to see your role.

Settings: extra computer players (0–3). The pace is in `cult.pad`'s `tune` block.

`rules.ts` (unit-tested), `bots.ts`, `host.ts`, `view.ts`, `controller.ts`.

## Cascade (`web/src/games/cascade/`)
Take turns dropping pieces on a grid. A cell bursts when it holds as many pieces as it has neighbours, throws one into
each and takes them over, which can set off a chain across the board. Last colour standing wins. The phone's stick
walks a cursor across the TV's board, and the round **Place** button drops a piece there.

Three looks, switchable mid-game: **Culture** (a petri dish, the default), **Marbles** (walnut and glass) and
**Reactor** (neon cores).

Settings: look, board size (automatic, five sizes, or a custom size up to 20 × 12), turn timer, computer players (0–4).

`rules.ts` (unit-tested), `bots.ts`, `host.ts`, `hud.ts`, `audio.ts` + `sounds/`, and `look/` for the three.js scene:
`stage.ts` (renderer and TV lite mode), `director.ts` (times the chain animation), `bake.ts` (pre-baked textures) and
one file per look.

## Rotor Brawl (`web/src/games/hammer/`)
Up to eight little flying machines, each with a heavy weapon on a rod or chain. The phone is a joystick, held upright
or sideways: the machine flies where you push, so flying in circles whips the weapon round. Damage comes from how hard
a hit lands, big hits stun, and blades cut harder when they slide across fast. Last machine flying wins the round.

40 weapons in four classes: 8 hammers, 8 axes, 10 maces and flails, and 14 swords and blades. They come from
Hammerfight's object files and from its item factory in the exe; only the great maul and the wooden flail are ours (see `weapons.ts`).
Heavier weapons hit harder but drag the
machine round.

With a weapon you can take a gun (arquebus, mortar, heavy mortar, rocket launcher; hold Fire on the phone) and a
shield: two plates on short rods, from light wood to armour. A fast, hard hit knocks a plate off; holding Shield
spreads the plates and halves thrust. Hold Fire and push the stick to aim
the arquebus (our addition: Hammerfight's guns don't aim): it swings toward the stick, fires once it points within
11°. A gun's body never hurts anyone, but it is heavy and fragile: a few hard blows break it off (our addition).
A shot that lands knocks the target back and is spent (a mortar's balls also stun); shots bounce only off walls and
crates; a gun kicks the shooter back along the barrel (not the launcher: its rockets push themselves; see `web/src/games/hammer/RE_GUNS.md`). Blades cut on the side Hammerfight draws as the edge; the back of a one-sided axe
only bludgeons. Weapons, guns and plates are drawn with Hammerfight's own sprites.

The stick tune lives in `hammer.pad` (`stick 420`, `steer 5.6`; 30% softer than before after a play test).

Arenas (setting **Arena**): Classic, Walls and crates, Big and Huge with a saw on each side wall (it cuts and stuns a
machine shoved into it), and six after Hammerfight's levels (see
`arenas.ts` and `RE_ARENAS.md`): **The Stands**, **Sunrise Towers**, **The Eye**, **Melka Arena** (cages swing on
ropes), **Block Hall** (loose blocks to knock around) and **The Pit** (a hanging chain). The middle of every arena is
open; plank walls toward the sides are slam surfaces (a reeling machine knocked into one gets more stun) and break
after a beating. Machines can't leave the screen at any edge.

Each round starts with a warm-up: fly and swing with no damage, and pick a weapon, a gun and a shield on the phone.

Modes: **Free for all**, **Teams** (Red P1, P3, P5, P7 against Blue P2, P4, P6, P8; computer players fill free seats) and **Co-op vs CPU**
(all players against 1–7 computer machines), and **Co-op vs monsters**: waves of flying worms (armoured ones from wave 3,
after Hammerfight's Polypod creatures; see `monsters.ts`); "rounds to win" is the number of waves to survive, and
computer players fight on your side. Settings: mode, rounds to win (2, 3 or 5), computer players (0–7), music, slow
motion on big hits, teammates collide, friendly fire. After 60 s of fight a round goes to sudden death: every hit counts.

The physics is a small engine of its own (`engine.ts`, `collide.ts`, `sim.ts`) that follows Hammerfight's model:
Verlet at 50 Hz, joints corrected by position only (which gives the weapons their whip), impulse controls, quadratic
drag and a speed limit. `HAMMERFIGHT_PHYSICS.md` records that model; `weapons.ts` has the weapon shapes and masses.
`/lab/hammer/?bots=3` is a workbench with mouse control, `[` `]` to change weapon, and live sliders (only while `pnpm dev`
runs). `sim.test.ts` covers the engine and the rules.

## Inkling (`web/src/games/inkling/`)
A draw-and-guess game. On your turn you pick one of three words and draw it on your phone; the drawing appears on the
TV stroke by stroke while everyone else types guesses on their phones. Letters of the word are revealed at half and
three-quarters of the time. Right guesses score more the earlier they come (bonuses for the first three), harder words
are worth more, and the artist scores for every player who gets it. Only exact spellings count (letter case aside); a
one-letter slip gets a private "Close!".

Settings: draw time (60, 80 or 100 s), turns each (1 or 2), words (easy, mixed or hard), computer players (0–7).

`rules.ts` (unit-tested), `words.ts`, `bots.ts` and `doodles.ts` (the computer players' drawings), `host.ts`, `view.ts`,
`controller.ts`.
