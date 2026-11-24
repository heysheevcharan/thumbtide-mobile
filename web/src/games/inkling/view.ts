// The TV: a sketchbook page on a drafting table, light by design.
//  - The stage is a fixed 1920 × 1080 layout scaled to the window (one transform, set on resize).
//  - The sheet's paper and faint blue grid are baked once per size into one canvas; the spiral binding too.
//  - The ink is one persistent canvas over it. New points are appended as they arrive; the whole sheet is redrawn
//    only on undo, clear and a new turn (the rules bump `inkRev`).
//  - Everything else is DOM, rebuilt only when what it shows changes: the word blanks, the pencil timer (a
//    transform), the score column and the sticky-note feed (a note slaps on once, with a small tilt).
const isTV = false;
import { ASPECT, bakeGrid, drawStroke, LOOK, TIPS } from "./look.ts";
import type { Inkling, Seat } from "./rules.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const STAGE_W = 1920;
export const STAGE_H = 1080;
const SHEET_H = 796;
const SHEET_W = Math.round(SHEET_H * ASPECT);
const SHEET_X = Math.round((STAGE_W - SHEET_W) / 2);
const SHEET_Y = 246;
const FEED_MAX = 6;

const PENCIL = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.2-4.6L15.6 5a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z" fill="currentColor"/><path d="M4 20l4.6-1.2-3.4-3.4z" fill="#1a1a1a"/></svg>`;
const CHECK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** A small tilt per note, the same for the same text. */
const tiltOf = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((h % 7) - 3) * 0.7;
};

export interface Extra {
  /** The players who are waiting for a seat. */
  watching: string[];
}

export class Board {
  readonly el: HTMLElement;
  private stage: HTMLElement;
  private grid: HTMLCanvasElement;
  private ink: HTMLCanvasElement;
  private ictx: CanvasRenderingContext2D;
  private rings: HTMLCanvasElement;
  private who: HTMLElement;
  private blanks: HTMLElement;
  private timer: HTMLElement;
  private body: HTMLElement;
  private cap: HTMLElement;
  private secs: HTMLElement;
  private list: HTMLElement;
  private notes: HTMLElement;
  private over: HTMLElement;
  private meta: HTMLElement;
  /** Backing pixels per stage pixel. */
  private res = 1;
  private rev = -1;
  private drawn: number[] = [];
  private keys: Record<string, string> = {};
  private frac = -1;

  constructor(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "ink";
    this.el.innerHTML = `
      <div class="ink-stage">
        <header class="ink-top">
          <div class="ink-who"></div>
          <div class="ink-blanks"></div>
          <div class="ink-timer"><div class="ink-pencil"><i class="ink-cap"><b></b><em></em></i><i class="ink-body"></i><i class="ink-cone"></i></div><b class="ink-secs"></b></div>
        </header>
        <aside class="ink-col ink-board"><h3>Scores</h3><ol class="ink-list"></ol><p class="ink-meta"></p></aside>
        <div class="ink-sheet">
          <canvas class="ink-grid"></canvas><canvas class="ink-ink"></canvas><canvas class="ink-rings"></canvas>
          <div class="ink-over"></div>
        </div>
        <aside class="ink-col ink-feed"><h3>Guesses</h3><div class="ink-notes"></div></aside>
      </div>`;
    root.appendChild(this.el);
    const $ = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
    this.stage = $(".ink-stage");
    this.grid = $(".ink-grid");
    this.ink = $(".ink-ink");
    this.ictx = this.ink.getContext("2d")!;
    this.rings = $(".ink-rings");
    this.who = $(".ink-who");
    this.blanks = $(".ink-blanks");
    this.timer = $(".ink-timer");
    this.body = $(".ink-body");
    this.cap = $(".ink-cap");
    this.secs = $(".ink-secs");
    this.list = $(".ink-list");
    this.notes = $(".ink-notes");
    this.over = $(".ink-over");
    this.meta = $(".ink-meta");
    const sheet = $(".ink-sheet");
    Object.assign(sheet.style, { left: `${SHEET_X}px`, top: `${SHEET_Y}px`, width: `${SHEET_W}px`, height: `${SHEET_H}px` });
    this.layout();
  }

  /** Scales the stage to the window and re-bakes the sheet at the new resolution. */
  layout() {
    const W = this.el.clientWidth || window.innerWidth;
    const H = this.el.clientHeight || window.innerHeight;
    const s = Math.min(W / STAGE_W, H / STAGE_H);
    this.stage.style.transform = `translate(${(W - STAGE_W * s) / 2}px, ${(H - STAGE_H * s) / 2}px) scale(${s})`;
    // backing pixels: full DPR, but never past 1920 wide for the whole stage on the TV
    const dpr = window.devicePixelRatio || 1;
    this.res = Math.max(0.5, Math.min(isTV ? 1 : 2, s * dpr));
    const bw = Math.round(SHEET_W * this.res);
    const bh = Math.round(SHEET_H * this.res);
    for (const c of [this.grid, this.ink]) {
      c.width = bw;
      c.height = bh;
    }
    bakeGrid(this.grid.getContext("2d")!, bw, bh);
    this.bakeRings();
    this.rev = -1; // redraw the ink at the new size
  }

  private bakeRings() {
    const w = Math.round(SHEET_W * this.res);
    const h = Math.round(46 * this.res);
    this.rings.width = w;
    this.rings.height = h;
    const x = this.rings.getContext("2d")!;
    const r = this.res;
    const n = 14;
    const gap = (SHEET_W - 60) / (n - 1);
    for (let i = 0; i < n; i++) {
      const cx = (30 + i * gap) * r;
      // the punched hole in the paper, then the wire loop over the top edge
      x.fillStyle = LOOK.deskDark;
      x.beginPath();
      x.arc(cx, 34 * r, 5.5 * r, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = "#c9ced1";
      x.lineWidth = 3.2 * r;
      x.lineCap = "round";
      x.beginPath();
      x.moveTo(cx - 3 * r, 33 * r);
      x.bezierCurveTo(cx - 6 * r, 8 * r, cx + 8 * r, 4 * r, cx + 5 * r, 30 * r);
      x.stroke();
      x.strokeStyle = "rgba(255,255,255,0.55)";
      x.lineWidth = 1 * r;
      x.beginPath();
      x.moveTo(cx - 2 * r, 22 * r);
      x.bezierCurveTo(cx - 3 * r, 10 * r, cx + 4 * r, 8 * r, cx + 4 * r, 16 * r);
      x.stroke();
    }
  }

  // ------------------------------------------------------------------ the ink
  private syncInk(game: Inkling) {
    const w = this.ink.width, h = this.ink.height;
    const strokes = game.strokes;
    if (game.inkRev !== this.rev) {
      this.rev = game.inkRev;
      this.ictx.clearRect(0, 0, w, h);
      this.drawn = [];
      for (const s of strokes) {
        drawStroke(this.ictx, s, w, h);
        this.drawn.push(s.p.length);
      }
      return;
    }
    // only the last stroke grows; anything after it is new
    for (let i = Math.max(0, this.drawn.length - 1); i < strokes.length; i++) {
      const s = strokes[i]!;
      const had = this.drawn[i] ?? 0;
      if (s.p.length > had) {
        drawStroke(this.ictx, s, w, h, had);
        this.drawn[i] = s.p.length;
      }
    }
  }

  // ------------------------------------------------------------------ every frame
  sync(game: Inkling, extra: Extra) {
    this.syncInk(game);
    const artist = game.artist ? game.seats.get(game.artist) : null;
    const phase = game.phase;

    // who draws
    const whoKey = `${phase}|${artist?.id}|${artist?.name}`;
    if (this.keys.who !== whoKey) {
      this.keys.who = whoKey;
      const verb = phase === "pick" ? "is picking a word" : phase === "draw" ? "is drawing" : "drew";
      this.who.innerHTML = artist && (phase === "pick" || phase === "draw" || phase === "reveal")
        ? `<i class="ink-tip" style="--c:${TIPS[artist.slot]}"></i><span><b>${esc(artist.name)}</b> ${verb}</span>`
        : "";
    }

    // the blanks (the whole word in the reveal)
    const mask = phase === "draw" ? game.mask() : phase === "reveal" && game.word ? game.word.w : "";
    const bKey = `${phase}|${mask}`;
    if (this.keys.blanks !== bKey) {
      this.keys.blanks = bKey;
      const words = mask.split(" ");
      const lens = words.map((w) => w.replace(/[^_a-z0-9À-ɏ]/gi, "").length);
      this.blanks.className = `ink-blanks${phase === "reveal" ? " reveal" : ""}${mask.length > 14 ? " long" : ""}`;
      this.blanks.innerHTML = mask
        ? words
            .map((w) => `<span class="ink-word">${[...w].map((ch) => (ch === "_" ? `<i></i>` : /[a-z0-9À-ɏ]/i.test(ch) ? `<i class="on">${esc(ch)}</i>` : `<i class="mark">${esc(ch)}</i>`)).join("")}</span>`)
            .join("") + (phase === "draw" ? `<small>${lens.join(" ")}</small>` : "")
        : "";
    }

    // the pencil
    const total = phase === "draw" ? game.limit : 0;
    const showTimer = phase === "draw" || phase === "pick";
    this.timer.classList.toggle("off", !showTimer);
    if (showTimer) {
      const left = game.left();
      const all = phase === "draw" ? total / 60 : 15;
      const f = Math.max(0, Math.min(1, left / all));
      if (Math.abs(f - this.frac) > 0.001) {
        this.frac = f;
        this.body.style.transform = `scaleX(${f.toFixed(4)})`;
        this.cap.style.transform = `translateX(${((1 - f) * BODY_W).toFixed(1)}px)`;
      }
      const sk = String(Math.ceil(left));
      if (this.keys.secs !== sk) {
        this.keys.secs = sk;
        this.secs.textContent = sk;
        this.timer.classList.toggle("low", phase === "draw" && left <= 10);
      }
    }

    this.syncBoard(game, extra);
    this.syncOver(game);
  }

  private syncBoard(game: Inkling, extra: Extra) {
    const list = game.standings();
    const reveal = game.phase === "reveal";
    const k = list.map((s) => `${s.id}:${s.name}:${s.slot}:${s.score}:${s.got}:${s.away}:${s.id === game.artist}:${reveal ? s.gained : ""}`).join("|") + game.phase;
    if (this.keys.board !== k) {
      this.keys.board = k;
      this.list.innerHTML = list
        .map((s: Seat) => {
          const drawing = s.id === game.artist && (game.phase === "pick" || game.phase === "draw");
          const mark = drawing ? `<em class="ink-st draw">${PENCIL}</em>` : s.got && game.phase === "draw" ? `<em class="ink-st got">${CHECK}</em>` : "";
          const plus = reveal && s.gained ? `<em class="ink-plus">+${s.gained}</em>` : "";
          return `<li class="${s.got && game.phase !== "match" ? "got" : ""}${s.away ? " away" : ""}" style="--c:${TIPS[s.slot]}"><i class="ink-tip"></i><span class="ink-nm">${esc(s.name)}</span>${mark}${plus}<b>${s.score}</b></li>`;
        })
        .join("");
    }
    const turns = game.turnCount();
    const mk = `${game.phase}|${game.turn}|${turns}|${game.round}|${game.order.length}|${extra.watching.join(",")}`;
    if (this.keys.meta !== mk) {
      this.keys.meta = mk;
      const parts: string[] = [];
      if (game.turn && game.phase !== "wait" && game.phase !== "match") parts.push(`Turn ${game.turn} of ${turns}`);
      if (game.order.length > 1 && game.phase !== "match") parts.push(`round ${game.round + 1} of ${game.order.length}`);
      let html = parts.length ? `<span>${parts.join(" · ")}</span>` : "";
      if (extra.watching.length) html += `<span>Waiting: ${extra.watching.map(esc).join(", ")}</span>`;
      this.meta.innerHTML = html;
    }
  }

  private syncOver(game: Inkling) {
    const artist = game.artist ? game.seats.get(game.artist) : null;
    let html = "";
    let k: string = game.phase;
    switch (game.phase) {
      case "wait":
        html = `<div class="ink-msg"><h2>Waiting for players</h2><p>Two or more to play. Join on your phone.</p></div>`;
        break;
      case "pick":
        k += artist?.id;
        html = artist ? `<div class="ink-msg"><i class="ink-tip big" style="--c:${TIPS[artist.slot]}"></i><h2>${esc(artist.name)} is picking a word</h2></div>` : "";
        break;
      case "reveal": {
        const n = game.guessed.length;
        const of = [...game.seats.values()].filter((x) => x.id !== game.artist).length;
        const why = game.endReason === "left" ? "The artist left" : game.endReason === "alone" ? "Nobody left to guess" : n && n >= of ? "Everyone got it!" : n ? `${n} of ${of} got it` : "Nobody got it";
        const up = game.seats.get(game.upNext() ?? "");
        k += `${game.turn}|${why}|${up?.id}`;
        html = `<div class="ink-reveal" style="--t:${tiltOf(why + game.turn)}deg"><b>${why}</b>${
          up ? `<span><i class="ink-tip" style="--c:${TIPS[up.slot]}"></i>${esc(up.name)} draws next</span>` : `<span>That was the last turn</span>`
        }</div>`;
        break;
      }
      case "match": {
        const st = game.standings();
        const win = st.filter((s) => game.winners.includes(s.id));
        k += st.map((s) => `${s.id}${s.score}`).join();
        html = `<div class="ink-final${st.length > 5 || win.length > 1 ? " many" : ""}">
          <small>Final page</small>
          <h2>${win.map((s) => `<span style="--c:${TIPS[s.slot]}">${esc(s.name)}</span>`).join(" &amp; ") || "Nobody"}</h2>
          <p>${win.length > 1 ? "share the win" : "wins"}</p>
          <ol>${st.map((s, i) => `<li style="--c:${TIPS[s.slot]}"><em>${i + 1}</em><i class="ink-tip"></i><span>${esc(s.name)}</span><b>${s.score}</b></li>`).join("")}</ol>
        </div>`;
        break;
      }
      default:
        k = "";
    }
    if (this.keys.over === k) return;
    this.keys.over = k;
    this.over.innerHTML = html;
    this.over.classList.toggle("dim", game.phase === "match" || game.phase === "wait");
  }

  // ------------------------------------------------------------------ the feed
  /** A wrong guess: a small pale note. */
  wrong(name: string, slot: number, text: string) {
    this.add(`<div class="ink-note" style="--c:${TIPS[slot]};--t:${tiltOf(name + text)}deg"><small><i class="ink-tip"></i>${esc(name)}</small><p>${esc(text)}</p></div>`);
  }
  /** A right guess: a yellow sticky note slapped on. */
  right(name: string, slot: number, rank: number) {
    this.add(`<div class="ink-note got${rank === 0 ? " first" : ""}" style="--c:${TIPS[slot]};--t:${tiltOf(name)}deg"><p><i class="ink-tip"></i>${esc(name)} got it</p></div>`);
  }
  private add(html: string) {
    this.notes.insertAdjacentHTML("afterbegin", html);
    while (this.notes.children.length > FEED_MAX) this.notes.lastElementChild!.remove();
  }
  clearFeed() {
    this.notes.innerHTML = "";
  }

  dispose() {
    this.el.remove();
  }
}

/** The pencil body's length in stage pixels (matches the CSS). */
const BODY_W = 520;
