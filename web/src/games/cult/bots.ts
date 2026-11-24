// Computer players. They only use what their seat would know: their role, the cult's faces if they're cult,
// their own investigations, and which governments passed cult laws.
import * as R from "./rules.ts";
import type { CultToHost } from "./shared.ts";

export const BOT_NAMES = ["Pam", "Dale", "Crystal", "Vern", "Tammy", "Gus", "Darlene", "Rick"];

/** What everyone has seen: who was in power when each law went through. */
export interface Memory {
  laws: { mayor: number; sheriff: number; law: R.Law }[];
  /** Investigation results, by the seat that investigated. */
  found: Map<number, { seat: number; party: R.Party }[]>;
}

/** Whether this seat has something to do right now. */
export function botTurn(g: R.Game, seat: number, ready: Set<number>): boolean {
  switch (g.phase) {
    case "roles":
      return !ready.has(seat);
    case "nominate":
    case "mayor":
    case "veto":
      return seat === g.mayor;
    case "vote":
      return g.seats[seat]!.alive && g.votes[seat] === null;
    case "sheriff":
      return seat === g.sheriff;
    case "power":
      // the host times the end of pick and burn
      return seat === g.mayor && (g.target === null || g.power === "investigate");
    default:
      return false;
  }
}

export function decide(g: R.Game, seat: number, mem: Memory): CultToHost | null {
  const cult = g.seats[seat]!.role !== "town";
  const known = new Set(R.knows(g, seat));
  const sus = suspicion(g, seat, mem);
  const chance = (p: number) => Math.random() < p;
  const pick = (s: number | undefined): CultToHost | null => (s === undefined ? null : { type: "pick", seat: s });
  const least = (opts: number[]) => [...opts].sort((a, b) => sus(a) - sus(b))[0];
  const most = (opts: number[]) => [...opts].sort((a, b) => sus(b) - sus(a))[0];
  const any = (opts: number[]) => opts[Math.floor(Math.random() * opts.length)];

  switch (g.phase) {
    case "roles":
      return { type: "ready" };

    case "nominate": {
      const opts = R.eligible(g);
      if (cult) {
        const prophet = opts.find((i) => known.has(i) && g.seats[i]!.role === "prophet");
        if (prophet !== undefined && g.cult >= R.PROPHET_AFTER) return pick(prophet);
        const allies = opts.filter((i) => known.has(i));
        if (allies.length && chance(0.5)) return pick(any(allies));
      }
      return pick(least(opts));
    }

    case "vote": {
      const gov = [g.mayor, g.sheriff!];
      if (gov.includes(seat)) return { type: "vote", yes: true };
      if (cult) {
        if (g.cult >= R.PROPHET_AFTER && g.seats[g.sheriff!]!.role === "prophet") return { type: "vote", yes: true };
        return { type: "vote", yes: gov.some((i) => known.has(i)) || chance(0.45) };
      }
      // the town fears the Prophet as Sheriff late in the game, and a riot when it's close
      if (g.cult >= R.PROPHET_AFTER && sus(g.sheriff!) > 0.5) return { type: "vote", yes: false };
      if (g.unrest >= R.RIOT_AT - 1) return { type: "vote", yes: chance(0.8) };
      const risk = sus(g.mayor) + sus(g.sheriff!);
      return { type: "vote", yes: chance(risk < 1.5 ? 0.85 : 0.25) };
    }

    case "mayor": {
      const drop = g.hand.indexOf(cult && chance(0.85) ? "town" : "cult");
      return { type: "card", i: drop >= 0 ? drop : 0 };
    }

    case "sheriff": {
      if (!cult && R.vetoOpen(g) && !g.vetoRefused && g.hand.every((l) => l === "cult")) return { type: "veto" };
      // early on, the cult sometimes plays a town law to look clean
      const keep = cult && !(g.cult === 0 && chance(0.35)) ? "cult" : "town";
      const i = g.hand.indexOf(keep);
      return { type: "card", i: i >= 0 ? i : 0 };
    }

    case "veto":
      return { type: "veto-answer", yes: !cult };

    case "power": {
      if (g.power === "peek" || g.target !== null) return { type: "done" };
      const opts = R.powerTargets(g);
      const others = opts.filter((i) => !known.has(i));
      if (g.power === "investigate") return pick(cult ? any(others.length ? others : opts) : most(opts));
      if (g.power === "pick") return pick(cult ? (any(opts.filter((i) => known.has(i))) ?? least(opts)) : least(opts));
      // burn: the town burns its likeliest suspect; the cult burns whoever the town trusts most
      return pick(cult ? (least(others.length ? others : opts)) : most(opts));
    }

    default:
      return null;
  }
}

/** How cult a seat looks to this bot (higher = worse), with a little noise so bots don't all agree. */
function suspicion(g: R.Game, seat: number, mem: Memory) {
  const s = new Map<number, number>();
  const add = (i: number, d: number) => s.set(i, (s.get(i) ?? 0) + d);
  for (const l of mem.laws) {
    const d = l.law === "cult" ? 1 : -0.6;
    add(l.mayor, d * 0.7);
    add(l.sheriff, d);
  }
  for (const f of mem.found.get(seat) ?? []) s.set(f.seat, f.party === "cult" ? 99 : -99);
  const noise = g.seats.map(() => Math.random() * 0.4);
  return (i: number) => (i === seat ? -99 : (s.get(i) ?? 0) + noise[i]!);
}
