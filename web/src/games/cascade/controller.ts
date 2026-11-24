// The phone: the whole board, the players along the top, and whose turn it is. On your turn, tap a cell (an empty
// one or one of yours) to drop a piece there. Every move plays back on every phone, one wave of bursts at a time.
import { haptic, type Controller } from "@thumbtide/sdk";
import { button } from "@thumbtide/sdk/ui";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import { capacity, type Move } from "./rules.ts";
import { PLACE_MS, waveMs, type CascadeGame, type CascadeShared } from "./shared.ts";
import "./cascade.css";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ordinal = (k: number) => (k === 0 ? "1st" : k === 1 ? "2nd" : k === 2 ? "3rd" : `${k + 1}th`);

/** Where the pieces sit inside a cell, by how many there are (percent of the cell). */
const DOTS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[34, 50], [66, 50]],
  3: [[50, 30], [32, 64], [68, 64]],
  4: [[33, 33], [67, 33], [33, 67], [67, 67]],
};

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<CascadeGame>;
  const pad = gameById("cascade")!.controls!;
  const buzz = (name: string) => {
    const p = pad.buzz[name];
    if (p) haptic(p.length === 1 ? p[0]! : p);
  };

  const root = document.createElement("div");
  root.className = "czp";
  root.innerHTML = `
    <header class="czp-head"><ol class="czp-seats"></ol></header>
    <div class="czp-status"><i class="czp-dot"></i><span class="czp-line"></span><b class="czp-time"></b></div>
    <div class="czp-timer"><i></i></div>
    <main class="czp-main"><div class="czp-board"></div></main>
    <p class="czp-note"></p>
    <div class="czp-end" hidden></div>`;
  ctx.root.appendChild(root);
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const main = $(".czp-main");
  const boardEl = $(".czp-board");
  const endEl = $(".czp-end");
  const offs: Array<() => void> = [];

  // ------------------------------------------------------------------ the board
  let W = 0, H = 0;
  let owner: number[] = [];
  let count: number[] = [];
  let cells: HTMLElement[] = [];
  /** A move playing back: the board shown is ours, not the shared one, until it's done. */
  let playing = false;
  let shownMoves = -1;
  let timers: ReturnType<typeof setTimeout>[] = [];

  function build(w: number, h: number) {
    W = w;
    H = h;
    boardEl.style.setProperty("--w", String(w));
    boardEl.style.setProperty("--h", String(h));
    boardEl.innerHTML = Array.from({ length: w * h }, (_, i) => `<button class="czp-cell" data-i="${i}" aria-label="Cell ${i + 1}"><span></span></button>`).join("");
    cells = [...boardEl.children] as HTMLElement[];
    fit();
  }
  /** The biggest board of square cells that fits the space. */
  function fit() {
    if (!W || !H) return;
    const cw = main.clientWidth, ch = main.clientHeight;
    if (!cw || !ch) return;
    const cell = Math.floor(Math.min(cw / W, ch / H));
    boardEl.style.width = `${cell * W}px`;
    boardEl.style.height = `${cell * H}px`;
    boardEl.style.setProperty("--cell", `${cell}px`);
  }
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
  ro?.observe(main);

  const colorOf = (o: number) => ctl.shared?.seats[o]?.color ?? "#888";
  function paintCell(i: number) {
    const el = cells[i];
    if (!el) return;
    const o = owner[i]!, n = count[i]!;
    const cap = capacity(W, H, i);
    const span = el.firstElementChild as HTMLElement;
    el.style.setProperty("--c", o >= 0 ? colorOf(o) : "transparent");
    el.classList.toggle("owned", o >= 0);
    el.classList.toggle("ready", o >= 0 && n === cap - 1);
    const dots = DOTS[Math.min(4, n)] ?? [];
    span.innerHTML = dots.map(([x, y]) => `<i style="left:${x}%;top:${y}%"></i>`).join("") + (n > 4 ? `<b>${n}</b>` : "");
  }
  function paintAll() {
    for (let i = 0; i < W * H; i++) paintCell(i);
  }
  function fromShared(s: CascadeShared) {
    const b = s.board;
    if (b.w !== W || b.h !== H || cells.length !== b.w * b.h) build(b.w, b.h);
    owner = [...b.owner].map((c) => (c === "." ? -1 : Number(c)));
    count = [...b.count].map(Number);
    paintAll();
  }

  /** Play a move back: the piece lands, then each wave of bursts. */
  function playMove(n: number, move: Move) {
    const s = ctl.shared;
    if (!s) return;
    stopPlayback();
    if (s.board.w !== W) fromShared(s);
    playing = true;
    shownMoves = n;
    const wm = waveMs(move.waves.length);
    owner[move.cell] = move.player;
    count[move.cell] = move.count;
    paintCell(move.cell);
    pulse(move.cell, "land");
    move.waves.forEach((wave, k) => {
      timers.push(
        setTimeout(() => {
          for (const b of wave.bursts) pulse(b.cell, "burst");
          for (const c of wave.cells) {
            owner[c.i] = c.owner;
            count[c.i] = c.count;
            paintCell(c.i);
          }
          if (k === 0 || k % 3 === 0) haptic(8);
        }, PLACE_MS + k * wm),
      );
    });
    timers.push(
      setTimeout(() => {
        playing = false;
        render();
      }, PLACE_MS + move.waves.length * wm + 120),
    );
  }
  function pulse(i: number, kind: string) {
    const el = cells[i];
    if (!el) return;
    el.classList.remove("land", "burst");
    void el.offsetWidth;
    el.classList.add(kind);
  }
  function stopPlayback() {
    timers.forEach(clearTimeout);
    timers = [];
    playing = false;
  }

  // a tap on the board
  const onTap = (e: Event) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".czp-cell");
    if (!el) return;
    const s = ctl.shared, o = ctl.own;
    const i = Number(el.dataset.i);
    if (!s || !o || s.phase !== "play") return;
    if (s.turn !== o.seat || playing) return buzz("wait");
    if (owner[i] !== -1 && owner[i] !== o.seat) {
      pulse(i, "nope");
      return buzz("nope");
    }
    haptic(pad.buttons[0]?.haptic ?? 22);
    el.classList.add("picked");
    ctl.send({ type: "place", cell: i });
  };
  boardEl.addEventListener("click", onTap);
  offs.push(() => boardEl.removeEventListener("click", onTap));

  // ------------------------------------------------------------------ everything else
  let seatsKey = "";
  let endKey = "";
  let endOffs: Array<() => void> = [];
  let leftAt = 0;
  let left = 0;

  function render() {
    const s = ctl.shared;
    const o = ctl.own;
    if (!s) return;
    // the board: snap to the shared one unless a move is playing back (or we missed a move's message)
    if (!playing) {
      fromShared(s);
      shownMoves = s.moves;
    }
    for (const el of cells) el.classList.remove("picked");
    const me = o?.seat ?? -1;
    root.style.setProperty("--me", me >= 0 ? s.seats[me]?.color ?? "#888" : "#888");
    const myTurn = s.phase === "play" && s.turn === me && me >= 0;
    root.classList.toggle("my-turn", myTurn);

    // the players
    const sk = JSON.stringify([s.seats, s.active, me]);
    if (sk !== seatsKey) {
      seatsKey = sk;
      $(".czp-seats").innerHTML = s.seats
        .map(
          (x, i) => `<li class="${i === s.active ? "on" : ""}${x.alive ? "" : " out"}${x.away ? " away" : ""}${i === me ? " me" : ""}" style="--c:${x.color}">
            <i class="czp-piece"></i><span>${esc(i === me ? "You" : x.name)}</span><small>${x.alive ? x.pieces : "out"}${x.wins ? ` · ${"★".repeat(Math.min(3, x.wins))}` : ""}</small></li>`,
        )
        .join("");
    }

    // whose turn
    const who = s.seats[s.active];
    $(".czp-dot").style.background = who?.color ?? "transparent";
    $(".czp-line").innerHTML =
      s.phase === "end" ? `<b>${esc(s.seats[s.winner]?.name ?? "")}</b> wins!`
      : !who ? "Get ready…"
      : myTurn ? "<b>Your turn</b> · tap a cell"
      : s.active === me ? "Your move…"
      : who.away ? `Waiting for <b>${esc(who.name)}</b> (away)`
      : `<b>${esc(who.name)}</b>'s turn`;
    left = s.timeLeft;
    leftAt = performance.now();
    $(".czp-note").textContent = o ? s.note : s.watching.length ? "You're watching: you're dealt in next round." : s.note;

    // the end of a round
    endEl.hidden = s.phase !== "end";
    const vip = ctx.isVip();
    const ek = JSON.stringify([s.phase, s.standings, vip, s.round]);
    if (ek !== endKey) {
      endKey = ek;
      endOffs.forEach((f) => f());
      endOffs = [];
      if (s.phase === "end") {
        const sh = ctx.shell();
        const decider = sh?.players.find((p) => p.id === sh.vip)?.name;
        const won = s.winner === me;
        endEl.innerHTML = `<div class="czp-card">
          <h2>${won ? "You win!" : `${esc(s.seats[s.winner]?.name ?? "")} wins`}</h2>
          <ol>${s.standings.map((i, k) => `<li style="--c:${s.seats[i]!.color}"><em>${ordinal(k)}</em><i class="czp-piece"></i><span>${esc(i === me ? "You" : s.seats[i]!.name)}</span><b>${"★".repeat(Math.min(5, s.seats[i]!.wins))}</b></li>`).join("")}</ol>
          ${vip ? `<div class="czp-actions"><button class="czp-btn primary" data-act="again">Next round</button><button class="czp-btn" data-act="lobby">Back to lobby</button></div>` : `<p><b>${esc(decider ?? "The host")}</b> picks what's next.</p>`}
        </div>`;
        for (const b of endEl.querySelectorAll<HTMLElement>("[data-act]")) {
          endOffs.push(button(b, { mode: "tap", haptic: 18, onPress: () => (b.dataset.act === "again" ? ctl.send({ type: "again" }) : ctx.exitToLobby()) }));
        }
      }
    }
    tick();
  }

  // the turn timer counts down between updates
  function tick() {
    const s = ctl.shared;
    const live = !!s && s.timeTotal > 0 && s.turn >= 0 && s.phase === "play";
    const ms = live ? Math.max(0, left - (performance.now() - leftAt)) : 0;
    $(".czp-time").textContent = live ? String(Math.ceil(ms / 1000)) : "";
    const bar = $(".czp-timer");
    bar.hidden = !live;
    if (live) (bar.firstElementChild as HTMLElement).style.transform = `scaleX(${(ms / s!.timeTotal).toFixed(3)})`;
  }
  const ticker = window.setInterval(tick, 200);

  offs.push(
    ctl.on("state", () => {
      // a move we never saw played (we joined or reconnected mid-move): snap to the board
      if (playing && ctl.shared && ctl.shared.moves !== shownMoves) stopPlayback();
      render();
    }),
    ctx.onVip(() => {
      endKey = "";
      render();
    }),
    ctl.on("message", (m) => {
      if (!m || typeof m !== "object") return;
      if (m.type === "move") playMove(m.n, m.move);
      else if (m.type === "buzz") buzz(m.kind);
    }),
  );
  render();
  requestAnimationFrame(fit);

  return () => {
    stopPlayback();
    window.clearInterval(ticker);
    ro?.disconnect();
    offs.forEach((f) => f());
    endOffs.forEach((f) => f());
    root.remove();
  };
};

export default mount;
