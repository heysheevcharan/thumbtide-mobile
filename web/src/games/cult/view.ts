// The TV, printed like a gig poster: the town at night behind everything, the two law boards dealt with printed
// cards, one line saying what's happening, and the seats along the bottom. Plain DOM over the art.
import { inked, type InkTone } from "../kit/inked.ts";
import {
  POWER_ART, POWER_NAME, ROLE_NAME, WIN_LINE, artVars,
  type ArtName, type CultShared, type SeatView,
} from "./shared.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STAR = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6z"/></svg>`;
const EYE = `<svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M12 5C6.5 5 2.7 8.6 1 12c1.7 3.4 5.5 7 11 7s9.3-3.6 11-7c-1.7-3.4-5.5-7-11-7zm0 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9zm0 2.5a2 2 0 1 0 0 4 2 2 0 1 0 0-4z"/></svg>`;
const pic = (name: ArtName, cls = "") => `<i class="cf-art ${cls}" style="background-image:var(--art-${name})"></i>`;

const who = (s: SeatView | undefined) => (s ? `<b class="cf-who" style="--c:${s.color}">${esc(s.name)}</b>` : "");

/** One line saying what's happening at the table (the TV's status line; every phone shows it too). */
export function statusLine(s: CultShared): string {
  const mayor = who(s.seats[s.mayor]);
  const sheriff = s.sheriff !== null ? who(s.seats[s.sheriff]) : "";
  const target = s.target !== null ? who(s.seats[s.target]) : "";
  switch (s.phase) {
    case "nominate":
      return `${mayor} is Mayor. Who'll be Sheriff?`;
    case "vote": {
      const alive = s.seats.filter((x) => x.alive).length;
      return `${mayor} for Mayor, ${sheriff} for Sheriff. Vote <span class="cf-count">${s.voted.length}/${alive}</span>`;
    }
    case "tally":
      return s.passed ? `${mayor} and ${sheriff} are in` : `${mayor} and ${sheriff} are out`;
    case "mayor":
      return `${mayor} is throwing one law away`;
    case "sheriff":
      return `${sheriff} is choosing the law`;
    case "veto":
      return `${sheriff} wants to throw both laws away. ${mayor}, agree?`;
    case "power":
      switch (s.power) {
        case "investigate":
          return target ? `${mayor} has looked into ${target}` : `${mayor} is investigating someone`;
        case "peek":
          return `${mayor} is peeking at the next three laws`;
        case "pick":
          return target ? `${target} is the next Mayor` : `${mayor} is picking the next Mayor`;
        case "burn":
          return target ? `${target} burns` : `${mayor} is choosing who to burn`;
      }
      return "";
    default:
      return "";
  }
}


export function createView(root: HTMLElement) {
  const el = document.createElement("div");
  el.className = "cf";
  artVars(el);
  el.innerHTML = `
    <div class="cf-bg"></div>
    <header class="cf-top">
      <div class="cf-sign">${inked("Cult", "bone", true)}</div>
      <div class="cf-meta">
        <div class="cf-unrest"><span>Unrest</span><i></i><i></i><i></i></div>
        <div class="cf-deck">${pic("card-back", "cf-deck-card")}<b></b></div>
      </div>
    </header>
    <section class="cf-boards">
      <div class="cf-board town"><h3>${inked("Town", "town")}</h3><div class="cf-slots"></div></div>
      <div class="cf-board cult"><h3>${inked("Cult", "cult")}</h3><div class="cf-slots"></div></div>
      <p class="cf-note"></p>
    </section>
    <p class="cf-status"></p>
    <ol class="cf-seats"></ol>
    <div class="cf-banner" hidden></div>
    <div class="cf-intro" hidden></div>
    <div class="cf-end" hidden></div>
    <div class="cf-grain"></div>`;
  root.appendChild(el);
  const $ = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const townSlots = $(".cf-board.town .cf-slots");
  const cultSlots = $(".cf-board.cult .cf-slots");
  const bannerEl = $(".cf-banner");
  let bannerTimer: ReturnType<typeof setTimeout> | null = null;
  let shown = { town: 0, cult: 0 };
  let boardKey = "";
  let introKey = "";
  let statusKey = "";
  let endKey = "";


  function boards(s: CultShared) {
    // rebuilt only when a law goes down, so the slam plays out
    const key = `${s.town}/${s.cult}/${s.powers.join()}`;
    if (key !== boardKey) {
      boardKey = key;
      lawSlots(s);
    }
    const notes = [
      s.cult >= 3 ? "The Prophet as Sheriff wins it for the cult" : "",
      s.vetoOpen ? "The Sheriff can veto" : "",
    ].filter(Boolean);
    $(".cf-note").textContent = notes.join("  ·  ");
    el.querySelectorAll(".cf-unrest i").forEach((d, i) => d.classList.toggle("on", i < s.unrest));
    $(".cf-unrest").classList.toggle("hot", s.unrest >= 2);
    $(".cf-deck b").textContent = String(s.deck);
  }

  function lawSlots(s: CultShared) {
    const card = (kind: "town" | "cult", fresh: boolean) =>
      `<div class="cf-slot filled ${fresh ? "slam" : ""}">${pic(kind === "town" ? "town-law" : "cult-law", "cf-card")}</div>`;
    townSlots.innerHTML = Array.from({ length: 5 }, (_, i) =>
      i < s.town ? card("town", i >= shown.town) : `<div class="cf-slot">${i === 4 ? `<span class="cf-win">${STAR}</span>` : ""}</div>`,
    ).join("");
    cultSlots.innerHTML = Array.from({ length: 6 }, (_, i) => {
      if (i < s.cult) return card("cult", i >= shown.cult);
      const p = s.powers[i];
      if (i === 5) return `<div class="cf-slot"><span class="cf-win">${EYE}</span></div>`;
      return `<div class="cf-slot">${p ? `${pic(POWER_ART[p], "cf-power")}<small>${POWER_NAME[p].replace("Pick the next Mayor", "Pick Mayor")}</small>` : ""}</div>`;
    }).join("");
    for (const [board, fresh] of [[$(".cf-board.town"), s.town > shown.town], [$(".cf-board.cult"), s.cult > shown.cult]] as const) {
      if (!fresh) continue;
      board.classList.remove("thud");
      void board.offsetWidth;
      board.classList.add("thud");
    }
    shown = { town: s.town, cult: s.cult };
  }

  // Seats are built once per game and patched in place, so a badge pins, a stamp lands or a role flips over once,
  // when it happens, not on every update.
  let seatKey = "";
  let seatEls: HTMLElement[] = [];
  const parts = new Map<Element, string>();
  const patch = (el: Element | null, html: string) => {
    if (el && parts.get(el) !== html) {
      parts.set(el, html);
      el.innerHTML = html;
    }
  };

  function seats(s: CultShared) {
    const list = $(".cf-seats");
    const key = s.seats.map((x) => x.id).join();
    if (key !== seatKey) {
      seatKey = key;
      parts.clear();
      list.innerHTML = s.seats
        .map((x, i) => `<li class="cf-seat" style="--c:${x.color};--i:${i}">
          <span class="cf-pin"></span><span class="cf-face">${esc((x.name.trim()[0] ?? "?").toUpperCase())}</span>
          <span class="cf-name">${esc(x.name)}</span><span class="cf-tagbox"></span><span class="cf-stamp"></span>
        </li>`)
        .join("");
      seatEls = [...list.children] as HTMLElement[];
    }
    const playing = s.phase !== "roles" && s.phase !== "end";
    s.seats.forEach((x, i) => {
      const li = seatEls[i]!;
      const mayor = playing && i === s.mayor;
      const sheriff = playing && i === s.sheriff;
      li.className = [
        "cf-seat",
        mayor ? "mayor" : "",
        sheriff ? "sheriff" : "",
        !x.alive ? "dead" : "",
        x.away ? "away" : "",
        s.phase === "vote" && s.voted.includes(i) ? "voted" : "",
        s.phase === "roles" && s.ready.includes(i) ? "voted" : "",
        s.phase === "nominate" && x.alive && i !== s.mayor && !s.eligible.includes(i) ? "benched" : "",
        s.phase === "power" && s.target === i ? `target ${s.power}` : "",
        s.roles ? `role-${s.roles[i]}` : "",
      ].join(" ");
      const v = s.votes?.[i];
      patch(li.querySelector(".cf-pin"), mayor ? pic("badge-mayor", "cf-badge") : sheriff ? pic("badge-sheriff", "cf-badge") : "");
      patch(
        li.querySelector(".cf-tagbox"),
        s.roles ? `<span class="cf-role">${ROLE_NAME[s.roles[i]!]}</span>`
        : mayor ? `<span class="cf-tag mayor">Mayor</span>`
        : sheriff ? `<span class="cf-tag sheriff">Sheriff</span>`
        : x.away ? `<span class="cf-tag">away</span>`
        : x.bot ? `<span class="cf-tag">bot</span>`
        : "",
      );
      patch(li.querySelector(".cf-stamp"), s.phase === "tally" && v != null ? `<span class="cf-vote ${v ? "yes" : "no"}">${v ? "Yes" : "No"}</span>` : "");
    });
  }

  function intro(s: CultShared) {
    const box = $(".cf-intro");
    box.hidden = s.phase !== "roles";
    if (box.hidden) return void (introKey = "");
    const key = s.seats.map((x) => x.id).join();
    if (key !== introKey) {
      introKey = key;
      const n = s.seats.length;
      // one card per seat, dealt into a fan
      box.innerHTML = `
        <div class="cf-fan">${s.seats
          .map((x, i) => `<i class="cf-back" style="--r:${((i - (n - 1) / 2) * 7).toFixed(1)}deg;--i:${i};--c:${x.color};background-image:var(--art-card-back)"></i>`)
          .join("")}</div>
        <h1>${inked("Cult", "bone", true)}</h1>
        <p>Check your role on your phone. Keep it to yourself.</p>
        <p class="cf-count"></p>`;
    }
    // a card lifts when its player is ready
    box.querySelectorAll(".cf-back").forEach((b, i) => b.classList.toggle("up", s.ready.includes(i)));
    const people = s.seats.filter((x) => !x.bot).length;
    const ready = s.ready.filter((i) => !s.seats[i]!.bot).length;
    $(".cf-intro .cf-count").textContent = people ? `${ready}/${people} ready` : "";
  }

  function end(s: CultShared, vip?: string) {
    const box = $(".cf-end");
    box.hidden = s.phase !== "end" || !s.winner || !s.reason;
    if (box.hidden || !s.winner || !s.reason) return void (endKey = "");
    bannerEl.hidden = true;
    el.classList.remove("cf-banner-on");
    const key = `${s.winner}/${s.reason}/${vip}`;
    if (key === endKey) return;
    endKey = key;
    const tone: InkTone = s.winner === "town" ? "town" : "cult";
    box.innerHTML = `
      ${pic(s.winner === "town" ? "win-town" : "win-cult", "cf-end-art")}
      <div class="cf-end-text">
        <h1>${inked(s.winner === "town" ? "The town wins!" : "The cult wins!", tone)}</h1>
        <p>${esc(WIN_LINE[s.reason][s.winner])}</p>
        ${vip ? `<p class="cf-next"><b>${esc(vip)}</b> picks what's next</p>` : ""}
      </div>`;
  }

  return {
    render(s: CultShared, vip?: string) {
      el.dataset.phase = s.phase;
      boards(s);
      const st = $(".cf-status");
      st.innerHTML = statusLine(s);
      const moment = `${s.phase}:${s.mayor}:${s.sheriff}:${s.target}:${s.passed}`;
      if (moment !== statusKey) {
        statusKey = moment;
        st.classList.remove("swap");
        void st.offsetWidth;
        st.classList.add("swap");
      }
      seats(s);
      intro(s);
      end(s, vip);
    },

    /** Big poster lettering in the open middle, with an optional picture above and a line under it. */
    banner(text: string, tone: InkTone, sub = "", ms = 1800, art?: ArtName) {
      bannerEl.hidden = false;
      bannerEl.innerHTML = `${art ? pic(art, "cf-banner-art") : ""}<div class="cf-banner-text">${inked(text, tone)}${sub ? `<small>${sub}</small>` : ""}</div>`;
      bannerEl.classList.remove("show", "out");
      void bannerEl.offsetWidth;
      bannerEl.classList.add("show");
      el.classList.add("cf-banner-on");
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        bannerEl.classList.replace("show", "out");
        el.classList.remove("cf-banner-on");
        bannerTimer = setTimeout(() => (bannerEl.hidden = true), 260);
      }, Math.max(300, ms - 260));
    },

    /** A new game: empty boards. */
    reset() {
      shown = { town: 0, cult: 0 };
      boardKey = "";
    },

    dispose() {
      if (bannerTimer) clearTimeout(bannerTimer);
      el.remove();
    },
  };
}

export type View = ReturnType<typeof createView>;
