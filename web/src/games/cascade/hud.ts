// The TV's HUD around the board: the players down the left, whose turn it is and the chain counter up top,
// short notes ("Ben is out"), and the winner's card. Styled per look (cascade.css), plain enough for TV browsers.
import type { CascadeShared, LookId, SeatView } from "./shared.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A colour mixed toward white (k > 0) or black (k < 0). TV browsers predate CSS color-mix(). */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k)));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
/** CSS variables for a player's colour: --c, plus lighter (--cl), deeper (--cm, for text on light panels) and darker (--cd). */
export const colorVars = (c: string) => `--c:${c};--cl:${shade(c, 0.45)};--cm:${shade(c, -0.22)};--cd:${shade(c, -0.45)}`;

export function createHud(root: HTMLElement) {
  root.classList.add("cz-hud");
  root.innerHTML = `
    <aside class="cz-rail"></aside>
    <div class="cz-top">
      <div class="cz-turn"></div>
      <div class="cz-chain"><small>Chain</small><b></b></div>
    </div>
    <div class="cz-notes"></div>
    <div class="cz-end" hidden></div>`;
  const $ = (sel: string) => root.querySelector(sel) as HTMLElement;
  const rail = $(".cz-rail");
  const turnEl = $(".cz-turn");
  const chainEl = $(".cz-chain");
  const chainN = chainEl.querySelector("b") as HTMLElement;
  const notes = $(".cz-notes");
  const end = $(".cz-end");
  let railKey = "";
  let turnKey = "";
  let timerBar: HTMLElement | null = null;
  let timerOn = false;
  let chainHide: ReturnType<typeof setTimeout> | null = null;
  /** What each card's line shows now, so unchanged text isn't written (and laid out) again. */
  let subs: string[] = [];
  let endHtml = "";

  const piece = (c: string, cls = "") => `<i class="cz-piece ${cls}" style="${colorVars(c)}"></i>`;

  return {
    setLook(id: LookId) {
      root.dataset.look = id;
    },

    /** The player cards. `active` is the seat to highlight (whose turn it is, or who just moved). */
    seats(seats: SeatView[], active: number) {
      const key = seats.map((s) => `${s.id}|${s.name}|${s.color}|${s.bot}`).join(",");
      if (key !== railKey) {
        railKey = key;
        rail.innerHTML = seats
          .map(
            (s, i) => `<div class="cz-seat" data-i="${i}" style="${colorVars(s.color)}">
              ${piece(s.color)}
              <span class="cz-name">${esc(s.name)}</span>
              <span class="cz-sub"></span>
              <span class="cz-wins"></span>
              <i class="cz-time"><i></i></i>
            </div>`,
          )
          .join("");
        subs = [];
        timerBar = null;
        timerOn = false;
      }
      rail.style.setProperty("--n", String(seats.length));
      rail.querySelectorAll<HTMLElement>(".cz-seat").forEach((el, i) => {
        const s = seats[i]!;
        el.classList.toggle("on", i === active);
        el.classList.toggle("out", !s.alive);
        el.classList.toggle("away", s.away);
        const tag = s.bot ? "CPU" : s.away ? "Away" : "";
        const sub = !s.alive ? "Out" : `<b>${s.pieces}</b> ${s.pieces === 1 ? "piece" : "pieces"}${tag ? `<em>${tag}</em>` : ""}`;
        if (subs[i] !== sub) {
          subs[i] = sub;
          (el.querySelector(".cz-sub") as HTMLElement).innerHTML = sub;
        }
        const winsEl = el.querySelector(".cz-wins") as HTMLElement;
        const wins = s.wins ? `${s.wins}` : "";
        if (winsEl.textContent !== wins) winsEl.textContent = wins;
        winsEl.classList.toggle("has", s.wins > 0);
      });
      // the turn timer moves to the new active card; the running one isn't reset (no flicker on a join or drop)
      const bar = active >= 0 ? (rail.querySelector(`.cz-seat[data-i="${active}"] .cz-time i`) as HTMLElement | null) : null;
      if (bar !== timerBar) {
        timerBar?.parentElement!.classList.remove("run", "low");
        timerBar = bar;
        timerOn = false;
      }
    },

    /** Whose turn it is, up top (null hides it). */
    turn(seat: SeatView | null) {
      const key = seat ? `${seat.id}|${seat.color}|${seat.away}` : "";
      if (key === turnKey) return;
      turnKey = key;
      turnEl.classList.toggle("show", !!seat);
      if (seat) {
        turnEl.setAttribute("style", colorVars(seat.color));
        // away (phone on another app, or dropped): the game waits for them, and says so for as long as it waits
        turnEl.innerHTML = seat.away
          ? `${piece(seat.color)}<span>Waiting for <b>${esc(seat.name)}</b></span>`
          : `${piece(seat.color)}<span><b>${esc(seat.name)}</b>’s turn</span>`;
        turnEl.classList.remove("pop");
        void turnEl.offsetWidth;
        turnEl.classList.add("pop");
      }
    },

    /** Turn timer on the active card: 1 = full, 0 = out of time, null = no timer. */
    timer(frac: number | null) {
      if (!timerBar || (frac === null && !timerOn)) return;
      timerOn = frac !== null;
      timerBar.parentElement!.classList.toggle("run", timerOn);
      if (frac !== null) {
        timerBar.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
        timerBar.parentElement!.classList.toggle("low", frac < 0.25);
      }
    },

    /** The chain so far (waves), shown from the third wave on. */
    chain(waves: number, color: string) {
      if (chainHide) clearTimeout(chainHide);
      chainHide = null;
      if (waves < 3) return;
      chainEl.setAttribute("style", colorVars(color));
      chainN.textContent = `×${waves}`;
      chainEl.classList.add("show");
      turnEl.classList.add("hush");
      chainN.classList.remove("tick");
      void chainN.offsetWidth;
      chainN.classList.add("tick");
    },
    /** A new board: the counter goes at once (a chain that was playing never finishes). */
    chainReset() {
      if (chainHide) clearTimeout(chainHide);
      chainHide = null;
      chainEl.classList.remove("show");
      turnEl.classList.remove("hush");
    },
    chainDone() {
      if (!chainEl.classList.contains("show")) return;
      chainHide = setTimeout(() => {
        chainEl.classList.remove("show");
        turnEl.classList.remove("hush");
      }, 1100);
    },

    /** A short note that fades by itself. */
    note(html: string, color: string, ms = 2200) {
      const el = document.createElement("div");
      el.className = "cz-note";
      el.setAttribute("style", colorVars(color));
      el.innerHTML = html;
      notes.appendChild(el);
      setTimeout(() => el.classList.add("bye"), ms);
      setTimeout(() => el.remove(), ms + 500);
    },

    /** The end of a round: the winner, everyone's finish, and who decides what's next. */
    end(s: CascadeShared | null, order: number[] = [], decider?: string) {
      if (!s || s.winner < 0) {
        if (!endHtml) return;
        endHtml = "";
        end.hidden = true;
        end.innerHTML = "";
        return;
      }
      const w = s.seats[s.winner]!;
      const place = (k: number) => (k === 0 ? "1st" : k === 1 ? "2nd" : k === 2 ? "3rd" : `${k + 1}th`);
      const html = `
        <div class="cz-end-card" style="${colorVars(w.color)}">
          ${piece(w.color, "big")}
          <h1><b>${esc(w.name)}</b> wins</h1>
          <p class="cz-end-round">Round ${s.round}</p>
          <ol class="cz-standings">${order
            .map((i, k) => {
              const x = s.seats[i]!;
              return `<li style="${colorVars(x.color)}"><span class="cz-place">${place(k)}</span>${piece(x.color)}<span class="cz-name">${esc(x.name)}</span><span class="cz-wins ${x.wins ? "has" : ""}">${x.wins || ""}</span></li>`;
            })
            .join("")}</ol>
          <p class="cz-end-next">${decider ? `<b>${esc(decider)}</b> picks what's next` : "Play again from a phone"}</p>
        </div>`;
      // room events publish often during the end screen: rebuild (and replay its entrance) only when it changed
      if (html === endHtml) return;
      endHtml = html;
      end.innerHTML = html;
      end.hidden = false;
    },

    dispose() {
      if (chainHide) clearTimeout(chainHide);
      root.innerHTML = "";
    },
  };
}

export type Hud = ReturnType<typeof createHud>;
