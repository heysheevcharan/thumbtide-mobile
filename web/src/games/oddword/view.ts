// Odd Word Out on the TV: plain DOM. One focal point per phase (a big tilted card in the middle), the players as a
// row of characters along the bottom, and the stage colour changing with the phase. Things animate once, when
// they happen (a Done stamp thumps down, the reveal cards drop in one after another).
import { esc, mug, REVEAL_SETTLE_MS, type Mood } from "./look.ts";
import type { OddShared, SeatView } from "./shared.ts";

const PROMPT = {
  words: { head: "One adjective each", sub: "Describe your word out loud, in this order" },
  jobs: { head: "What happens in this job?", sub: "Say one thing that happens there, in this order" },
} as const;

interface SeatEl {
  el: HTMLElement;
  key: string;
}

export class Stage {
  private readonly el: HTMLElement;
  private readonly main: HTMLElement;
  private readonly seatsEl: HTMLElement;
  private readonly count: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly seats = new Map<string, SeatEl>();
  private mainKey = "";
  private revealAt = 0;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private last: { v: OddShared; watching: string[] } | null = null;
  private join = { code: "", at: "" };

  constructor(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "ow";
    this.el.innerHTML = `
      <div class="ow-bg"><i class="ow-sun"></i><i class="ow-burst"></i><i class="ow-hill"></i></div>
      <header class="ow-top">
        <div class="ow-logo"><span>Odd</span><span>Word Out</span></div>
        <div class="ow-chips"></div>
      </header>
      <main class="ow-main"></main>
      <div class="ow-count"></div>
      <section class="ow-seats"></section>`;
    root.appendChild(this.el);
    const $ = (s: string) => this.el.querySelector(s) as HTMLElement;
    this.main = $(".ow-main");
    this.seatsEl = $(".ow-seats");
    this.count = $(".ow-count");
    this.chips = $(".ow-chips");
  }

  /** The room code and where phones go, always on screen (people join mid-game). */
  sync(v: OddShared, watching: string[], join: { code: string; at: string }) {
    this.last = { v, watching };
    this.join = join;
    this.el.dataset.phase = v.phase;
    this.chips.innerHTML =
      (join.code ? `<span class="ow-chip join">Room <b>${esc(join.code)}</b></span>` : "") +
      `<span class="ow-chip">${v.mode === "jobs" ? "Jobs" : "Words"}</span>` +
      (v.round ? `<span class="ow-chip">Round ${v.round}</span>` : "");
    this.drawMain(v);
    this.drawSeats(v);
    this.drawCount(v, watching);
  }

  private nameOf(v: OddShared, id: string | null) {
    return v.seats.find((s) => s.id === id)?.name ?? "Someone";
  }
  private seatOf(v: OddShared, id: string | null): SeatView | undefined {
    return v.seats.find((s) => s.id === id);
  }

  // ------------------------------------------------------------------ the focal card
  private drawMain(v: OddShared) {
    const key = `${v.phase}:${v.round}:${v.mode}:${v.order.length ? "" : `empty:${this.join.code}`}`;
    if (key === this.mainKey) return;
    this.mainKey = key;
    if (v.phase === "reveal") {
      // the faces and vote dots wait until the cards are down, so the row doesn't give the result away
      this.revealAt = performance.now();
      clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => this.last && this.drawSeats(this.last.v), REVEAL_SETTLE_MS + 50);
    }
    if (!v.order.length) {
      const how = this.join.code ? `<p>Go to <b>${esc(this.join.at)}</b> on your phone and enter <b class="ow-code">${esc(this.join.code)}</b></p>` : "";
      this.main.innerHTML = `<div class="ow-card ow-banner"><h1>Waiting for players</h1>${how}</div>`;
      return;
    }
    if (v.phase === "describe") {
      const p = PROMPT[v.mode];
      this.main.innerHTML = `<div class="ow-card ow-banner drop"><h1>${p.head}</h1><p>${p.sub}</p></div>`;
    } else if (v.phase === "vote") {
      this.main.innerHTML = `<div class="ow-card ow-banner drop"><h1>Who has the odd word?</h1><p>Vote on your phone</p></div>`;
    } else if (v.reveal) {
      const r = v.reveal;
      const odd = this.seatOf(v, r.impostor);
      const out = this.seatOf(v, r.out);
      const head = r.left ? "The odd one ran off!" : r.caught ? "Caught!" : "Got away!";
      const verdict = r.left
        ? `<p class="ow-v-text">They left the game</p>`
        : out
          ? `<div class="ow-mug-l">${mug(out.color, out.shape, "out")}</div><b class="ow-name">${esc(out.name)}</b><p class="ow-v-text">${r.caught ? "had the odd word" : "had the real word"}</p>`
          : `<p class="ow-v-text big">${r.tie ? "A tie: nobody goes out" : "Nobody voted"}</p>`;
      const decoy = r.decoy ? `had <q>${esc(r.decoy)}</q>` : "had no word";
      this.main.innerHTML = `
        <h1 class="ow-head ${r.caught ? "good" : "bad"}">${head}</h1>
        <div class="ow-reveal">
          <div class="ow-card ow-r1 drop d1"><small>The word was</small><div class="ow-word">${esc(r.word)}</div></div>
          <div class="ow-card ow-r2 drop d2"><small>The odd one</small>
            ${odd ? `<div class="ow-mug-l">${mug(odd.color, odd.shape, "sly")}</div><b class="ow-name">${esc(odd.name)}</b>` : `<b class="ow-name">${esc(r.impostorName)}</b>`}
            <p class="ow-v-text">${decoy}</p></div>
          <div class="ow-card ow-r3 drop d3"><small>Voted out</small>${verdict}${!r.left && out ? `<i class="ow-stamp ${r.caught ? "good" : "bad"}">${r.caught ? "Caught" : "Oops"}</i>` : ""}</div>
        </div>`;
    }
  }

  // ------------------------------------------------------------------ the row of players
  private drawSeats(v: OddShared) {
    const keep = new Set(v.seats.map((s) => s.id));
    for (const [id, s] of this.seats) if (!keep.has(id)) (s.el.remove(), this.seats.delete(id));
    // votes received, shown in the reveal as the voters' colours
    const got = new Map<string, string[]>();
    const r = v.reveal && performance.now() - this.revealAt >= REVEAL_SETTLE_MS ? v.reveal : null;
    if (r) for (const [voter, target] of Object.entries(r.votes)) got.set(target, [...(got.get(target) ?? []), this.seatOf(v, voter)?.color ?? "#fff"]);

    v.seats.forEach((s, i) => {
      const n = v.order.indexOf(s.id);
      const done = v.done.includes(s.id);
      const voted = v.voted.includes(s.id);
      let mood: Mood = "idle";
      let badge = "";
      if (!s.playing) badge = `<i class="ow-tag">Next round</i>`;
      else if (v.phase === "describe" && done) (mood = "done"), (badge = `<i class="ow-stamp small good">Done</i>`);
      else if (v.phase === "vote" && voted) (mood = "done"), (badge = `<i class="ow-stamp small vote">Voted</i>`);
      else if (v.phase === "vote") mood = "worried";
      else if (r && s.id === r.out) mood = "out";
      else if (r && s.id === r.impostor) mood = "sly";
      const dots = r ? `<span class="ow-dots">${(got.get(s.id) ?? []).map((c) => `<i style="background:${c}"></i>`).join("")}</span>` : "";
      const turn = v.phase === "describe" && s.playing && n >= 0 ? `<i class="ow-num">${n + 1}</i>` : "";
      const html = `${turn}<div class="ow-mug">${mug(s.color, s.shape, mood)}</div><b class="ow-plate" style="--c:${s.color}">${esc(s.name)}</b>${badge}${dots}`;
      const key = `${html}:${s.away}:${s.playing}`;
      let el = this.seats.get(s.id);
      if (!el) {
        const div = document.createElement("div");
        div.className = "ow-seat pop";
        el = { el: div, key: "" };
        this.seats.set(s.id, el);
      }
      // seats sit in speaking order while describing, else in seat order
      el.el.style.order = String(v.phase === "describe" && n >= 0 ? n : 10 + i);
      if (el.key !== key) {
        el.key = key;
        el.el.innerHTML = html;
        el.el.classList.toggle("away", s.away);
        el.el.classList.toggle("benched", !s.playing);
      }
      if (el.el.parentElement !== this.seatsEl) this.seatsEl.appendChild(el.el);
    });
  }

  private drawCount(v: OddShared, watching: string[]) {
    const watch = watching.length ? ` · ${watching.map(esc).join(", ")} watching` : "";
    this.count.style.visibility = v.order.length ? "" : "hidden";
    if (v.phase === "describe") this.count.innerHTML = `<b>${v.done.length}</b> of ${v.order.length} done${watch}`;
    else if (v.phase === "vote") this.count.innerHTML = `<b>${v.voted.length}</b> of ${v.order.length} voted${watch}`;
    else this.count.innerHTML = `Next round in <b>${v.next}</b>${watch}`;
  }

  dispose() {
    clearTimeout(this.settleTimer);
    this.el.remove();
  }
}
