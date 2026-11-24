// Cult: the rules, with no screens and no timers. The host drives it and decides how long each beat lasts.
//
// A town (the majority) against a cult hiding among them, led by the Prophet. Each round the Mayor nominates a
// Sheriff and everyone votes. An elected pair turns three cards into one law: the Mayor discards one, the Sheriff
// enacts one of the two left. Five town laws or burning the Prophet wins for the town. Six cult laws, or electing
// the Prophet Sheriff once three cult laws are down, wins for the cult. Cult laws hand the Mayor a power. Three
// failed votes in a row and the town riots: the top card becomes law.

export type Party = "town" | "cult";
export type Role = "town" | "cult" | "prophet";
export type Law = Party;
export type Power = "investigate" | "peek" | "pick" | "burn";
export type Phase = "roles" | "nominate" | "vote" | "tally" | "mayor" | "sheriff" | "veto" | "enacted" | "power" | "end";
export type WinReason = "laws" | "prophet-elected" | "prophet-burned";

export const MIN_SEATS = 5;
export const MAX_SEATS = 10;
export const TOWN_TO_WIN = 5;
export const CULT_TO_WIN = 6;
/** From this many cult laws on, electing the Prophet Sheriff wins for the cult. */
export const PROPHET_AFTER = 3;
/** From this many cult laws on, the Sheriff can ask to throw both cards away. */
export const VETO_AFTER = 5;
/** Failed votes in a row before the town riots. */
export const RIOT_AT = 3;
const DECK = { town: 6, cult: 11 };

/** Cult members besides the Prophet, by table size. */
const CULTISTS: Record<number, number> = { 5: 1, 6: 1, 7: 2, 8: 2, 9: 3, 10: 3 };

export const partyOf = (r: Role): Party => (r === "town" ? "town" : "cult");

/** The power each cult law hands the Mayor (index = cult laws enacted − 1); the sixth wins. */
export function powersFor(seats: number): (Power | null)[] {
  if (seats <= 6) return [null, null, "peek", "burn", "burn"];
  if (seats <= 8) return [null, "investigate", "pick", "burn", "burn"];
  return ["investigate", "investigate", "pick", "burn", "burn"];
}

export interface Seat {
  id: string;
  name: string;
  role: Role;
  alive: boolean;
}

export interface Game {
  seats: Seat[];
  phase: Phase;
  mayor: number;
  sheriff: number | null;
  /** After a hand-picked Mayor, the order picks up again after this seat. */
  resumeAfter: number | null;
  /** The last elected pair can't be nominated Sheriff (the Mayor can be, once five or fewer are alive). */
  lastMayor: number | null;
  lastSheriff: number | null;
  votes: (boolean | null)[];
  passed: boolean | null;
  deck: Law[];
  discard: Law[];
  /** Cards in play: the Mayor's three, then the Sheriff's two. */
  hand: Law[];
  town: number;
  cult: number;
  /** Failed votes in a row. */
  unrest: number;
  /** The last law enacted, and whether a riot put it there. */
  law: Law | null;
  riot: boolean;
  vetoRefused: boolean;
  power: Power | null;
  /** Who the power was used on. */
  target: number | null;
  /** Investigate: the party found. */
  found: Party | null;
  investigated: number[];
  winner: Party | null;
  reason: WinReason | null;
  rng: () => number;
}

function shuffle<T>(a: T[], rng: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function newGame(players: { id: string; name: string }[], rng: () => number = Math.random): Game {
  const n = players.length;
  if (n < MIN_SEATS || n > MAX_SEATS) throw new Error(`Cult needs ${MIN_SEATS}–${MAX_SEATS} seats, not ${n}`);
  const cultists = CULTISTS[n]!;
  const roles = shuffle<Role>(["prophet", ...Array<Role>(cultists).fill("cult"), ...Array<Role>(n - 1 - cultists).fill("town")], rng);
  const deck = shuffle<Law>([...Array<Law>(DECK.town).fill("town"), ...Array<Law>(DECK.cult).fill("cult")], rng);
  return {
    seats: players.map((p, i) => ({ id: p.id, name: p.name, role: roles[i]!, alive: true })),
    phase: "roles",
    mayor: Math.floor(rng() * n),
    sheriff: null,
    resumeAfter: null,
    lastMayor: null,
    lastSheriff: null,
    votes: players.map(() => null),
    passed: null,
    deck,
    discard: [],
    hand: [],
    town: 0,
    cult: 0,
    unrest: 0,
    law: null,
    riot: false,
    vetoRefused: false,
    power: null,
    target: null,
    found: null,
    investigated: [],
    winner: null,
    reason: null,
    rng,
  };
}

/** The seats this seat knows are cult. The cult knows each other; the Prophet only at small tables. */
export function knows(g: Game, seat: number): number[] {
  const me = g.seats[seat]!.role;
  if (me === "town" || (me === "prophet" && g.seats.length > 6)) return [];
  return g.seats.flatMap((s, i) => (i !== seat && s.role !== "town" ? [i] : []));
}

export const aliveCount = (g: Game) => g.seats.filter((s) => s.alive).length;

/** Seats the Mayor may nominate Sheriff. */
export function eligible(g: Game): number[] {
  const many = aliveCount(g) > 5;
  return g.seats.flatMap((s, i) =>
    s.alive && i !== g.mayor && i !== g.lastSheriff && !(many && i === g.lastMayor) ? [i] : [],
  );
}

export const vetoOpen = (g: Game) => g.cult >= VETO_AFTER;
export const allVoted = (g: Game) => g.seats.every((s, i) => !s.alive || g.votes[i] !== null);

/** Everyone has seen their role: the first Mayor picks a Sheriff. */
export function begin(g: Game) {
  if (g.phase === "roles") setMayor(g, g.mayor);
}

export function nominate(g: Game, by: number, seat: number): boolean {
  if (g.phase !== "nominate" || by !== g.mayor || !eligible(g).includes(seat)) return false;
  g.sheriff = seat;
  g.votes = g.seats.map(() => null);
  g.phase = "vote";
  return true;
}

/** Votes can change until they're counted. */
export function vote(g: Game, seat: number, yes: boolean): boolean {
  if (g.phase !== "vote" || !g.seats[seat]?.alive) return false;
  g.votes[seat] = yes;
  return true;
}

/** Count the votes: more yes than no elects the pair. */
export function tally(g: Game): boolean {
  if (g.phase !== "vote" || !allVoted(g)) return false;
  const yes = g.votes.filter((v) => v === true).length;
  const no = g.votes.filter((v) => v === false).length;
  g.passed = yes > no;
  g.phase = "tally";
  return true;
}

/** After the votes have been shown: the elected pair gets the cards, or the town grows restless. */
export function afterTally(g: Game) {
  if (g.phase !== "tally") return;
  if (!g.passed) return failed(g);
  g.lastMayor = g.mayor;
  g.lastSheriff = g.sheriff;
  if (g.cult >= PROPHET_AFTER && g.seats[g.sheriff!]!.role === "prophet") return win(g, "cult", "prophet-elected");
  g.hand = draw(g, 3);
  g.vetoRefused = false;
  g.phase = "mayor";
}

export function mayorDiscard(g: Game, by: number, i: number): boolean {
  if (g.phase !== "mayor" || by !== g.mayor || !(i >= 0 && i < g.hand.length)) return false;
  g.discard.push(...g.hand.splice(i, 1));
  g.phase = "sheriff";
  return true;
}

export function sheriffEnact(g: Game, by: number, i: number): boolean {
  if (g.phase !== "sheriff" || by !== g.sheriff || !(i >= 0 && i < g.hand.length)) return false;
  const [law] = g.hand.splice(i, 1);
  g.discard.push(...g.hand);
  g.hand = [];
  enact(g, law!, false);
  return true;
}

export function askVeto(g: Game, by: number): boolean {
  if (g.phase !== "sheriff" || by !== g.sheriff || !vetoOpen(g) || g.vetoRefused) return false;
  g.phase = "veto";
  return true;
}

/** The Mayor agrees (both cards are thrown away and the town grows restless) or refuses (the Sheriff must enact). */
export function answerVeto(g: Game, by: number, agree: boolean): boolean {
  if (g.phase !== "veto" || by !== g.mayor) return false;
  if (agree) {
    g.discard.push(...g.hand);
    g.hand = [];
    failed(g);
  } else {
    g.vetoRefused = true;
    g.phase = "sheriff";
  }
  return true;
}

/** After the law has been shown: the game ends, the Mayor gets a power, or the next Mayor steps up. */
export function afterEnacted(g: Game) {
  if (g.phase !== "enacted") return;
  if (g.winner) g.phase = "end";
  else if (g.power) {
    g.phase = "power";
    g.target = null;
    g.found = null;
  } else nextMayor(g);
}

/** Peek: the top three cards, in order. */
export const peekCards = (g: Game) => g.deck.slice(0, 3);

/** Who the Mayor can use the current power on. */
export function powerTargets(g: Game): number[] {
  if (g.phase !== "power" || g.power === "peek") return [];
  return g.seats.flatMap((s, i) =>
    s.alive && i !== g.mayor && !(g.power === "investigate" && g.investigated.includes(i)) ? [i] : [],
  );
}

export function usePower(g: Game, by: number, seat: number): boolean {
  if (g.phase !== "power" || by !== g.mayor || g.target !== null || !powerTargets(g).includes(seat)) return false;
  g.target = seat;
  if (g.power === "investigate") {
    g.investigated.push(seat);
    g.found = partyOf(g.seats[seat]!.role);
  } else if (g.power === "burn") {
    g.seats[seat]!.alive = false;
    if (g.seats[seat]!.role === "prophet") {
      g.winner = "town";
      g.reason = "prophet-burned";
    }
  }
  return true;
}

/** The power is done with (peek and investigate: the Mayor says so; the host times the others). */
export function finishPower(g: Game): boolean {
  if (g.phase !== "power" || (g.power !== "peek" && g.target === null)) return false;
  if (g.winner) g.phase = "end";
  else if (g.power === "pick") {
    g.resumeAfter = g.mayor;
    setMayor(g, g.target!);
  } else nextMayor(g);
  return true;
}

// ------------------------------------------------------------------------------------------ inside

function failed(g: Game) {
  g.unrest++;
  if (g.unrest < RIOT_AT) return nextMayor(g);
  // riot: the top card becomes law, no power, and everyone can be nominated again
  g.lastMayor = g.lastSheriff = null;
  enact(g, draw(g, 1)[0]!, true);
}

function enact(g: Game, law: Law, riot: boolean) {
  g.law = law;
  g.riot = riot;
  g.unrest = 0;
  if (law === "town") g.town++;
  else g.cult++;
  g.power = !riot && law === "cult" ? (powersFor(g.seats.length)[g.cult - 1] ?? null) : null;
  g.target = null;
  g.found = null;
  if (g.deck.length < 3) reshuffle(g);
  if (g.town >= TOWN_TO_WIN) win(g, "town", "laws");
  else if (g.cult >= CULT_TO_WIN) win(g, "cult", "laws");
  // the law is shown first; afterEnacted() moves on to the end, if there is one
  g.phase = "enacted";
}

function win(g: Game, party: Party, reason: WinReason) {
  g.winner = party;
  g.reason = reason;
  g.phase = "end";
}

function draw(g: Game, n: number): Law[] {
  if (g.deck.length < n) reshuffle(g);
  return g.deck.splice(0, n);
}

function reshuffle(g: Game) {
  g.deck = shuffle([...g.deck, ...g.discard], g.rng);
  g.discard = [];
}

function nextMayor(g: Game) {
  let i = g.resumeAfter ?? g.mayor;
  g.resumeAfter = null;
  do i = (i + 1) % g.seats.length;
  while (!g.seats[i]!.alive);
  setMayor(g, i);
}

function setMayor(g: Game, seat: number) {
  g.mayor = seat;
  g.sheriff = null;
  g.votes = g.seats.map(() => null);
  g.passed = null;
  g.hand = [];
  g.power = null;
  g.target = null;
  g.found = null;
  g.phase = "nominate";
}
