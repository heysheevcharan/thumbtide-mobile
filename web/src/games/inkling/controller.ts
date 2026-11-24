// The phone. A status line at the top (your marker, what's happening, seconds left), and one screen below it:
//  - the artist picks one of three words (tap, then confirm), then draws on a white sheet with the same faint grid
//    as the TV, with a toolbar at the bottom: 8 colours, 3 brush sizes, an eraser, undo and clear;
//  - a guesser sees the blanks and types guesses (the field sits high, so the keyboard never covers it); their
//    guesses are listed with a private "close!" when one nearly had it;
//  - everything else (someone else picking, the word reveal, the final page) is one plain card.
// Strokes go to the hosting phone as small batches of points (0–1000 of the sheet) about every 50 ms while drawing.
import { haptic, type Controller } from "@thumbtide/sdk";
import { button } from "@thumbtide/sdk/ui";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import { ASPECT, bakeGrid, drawStroke, INK_NAMES, INKS, SIZES } from "./look.ts";
import { decodeStrokes, ERASER, MAX_BATCH, type Stroke } from "./rules.ts";
import type { InkGame, InkOwn, InkShared } from "./shared.ts";
import "./inkling.css";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const LEVEL = { 1: "Easy", 2: "Medium", 3: "Hard" } as const;
const ICON = {
  eraser: `<svg viewBox="0 0 24 24"><path d="M4 16.5L13.5 7a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L13 19.5H7z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M9 11.5l6 6M7 19.5h13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  undo: `<svg viewBox="0 0 24 24"><path d="M9 7L4.5 11.5 9 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  clear: `<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

type Scene = "info" | "pick" | "draw" | "guess";

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<InkGame>;
  const pad = gameById("inkling")!.controls!;
  const buzz = (name: string) => {
    const p = pad.buzz[name];
    if (p) haptic(p.length === 1 ? p[0]! : p);
  };

  const root = document.createElement("div");
  root.className = "ikp";
  root.innerHTML = `
    <header class="ikp-head"><i class="ikp-tip"></i><span class="ikp-status"></span><b class="ikp-time"></b></header>
    <div class="ikp-main">
      <section class="ikp-scene ikp-info" data-scene="info"></section>
      <section class="ikp-scene ikp-pick" data-scene="pick" hidden>
        <h2>Pick a word to draw</h2>
        <p>Harder words score more for every right guess.</p>
        <div class="ikp-cards"></div>
        <button class="ikp-btn primary ikp-go" disabled>Pick one</button>
      </section>
      <section class="ikp-scene ikp-draw" data-scene="draw" hidden>
        <div class="ikp-pad"><div class="ikp-sheet"><canvas class="ikp-grid"></canvas><canvas class="ikp-ink"></canvas></div></div>
        <div class="ikp-tools">
          <div class="ikp-row">${INKS.slice(0, 4).map((k, i) => `<button class="ikp-sw" data-ink="${i}" style="--k:${k}" aria-label="${INK_NAMES[i]}"></button>`).join("")}</div>
          <div class="ikp-row">${INKS.slice(4).map((k, i) => `<button class="ikp-sw" data-ink="${i + 4}" style="--k:${k}" aria-label="${INK_NAMES[i + 4]}"></button>`).join("")}</div>
          <div class="ikp-row">
            ${[0, 1, 2].map((s) => `<button class="ikp-tool" data-size="${s}" aria-label="${["Fine", "Medium", "Bold"][s]}"><i class="dot" style="width:${6 + s * 7}px;height:${6 + s * 7}px"></i></button>`).join("")}
            <button class="ikp-tool" data-tool="eraser">${ICON.eraser}<span>Eraser</span></button>
            <button class="ikp-tool" data-tool="undo">${ICON.undo}<span>Undo</span></button>
            <button class="ikp-tool" data-tool="clear">${ICON.clear}<span>Clear</span></button>
          </div>
        </div>
      </section>
      <section class="ikp-scene ikp-guess" data-scene="guess" hidden>
        <div class="ikp-view"><div class="ikp-vsheet"><canvas class="ikp-vgrid"></canvas><canvas class="ikp-vink"></canvas></div></div>
        <div class="ikp-blanks"></div>
        <form class="ikp-form" autocomplete="off">
          <input class="ikp-input" maxlength="40" placeholder="Type a guess" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="send" />
          <button class="ikp-btn primary ikp-send" type="submit">Guess</button>
        </form>
        <div class="ikp-gotcard" hidden></div>
        <ul class="ikp-said" data-scroll></ul>
      </section>
    </div>`;
  ctx.root.appendChild(root);
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const status = $(".ikp-status");
  const time = $(".ikp-time");
  const scenes = [...root.querySelectorAll<HTMLElement>(".ikp-scene")];
  const info = $(".ikp-info");
  const cards = $(".ikp-cards");
  const go = $<HTMLButtonElement>(".ikp-go");
  const padBox = $(".ikp-pad");
  const sheet = $(".ikp-sheet");
  const gridC = $<HTMLCanvasElement>(".ikp-grid");
  const inkC = $<HTMLCanvasElement>(".ikp-ink");
  const ictx = inkC.getContext("2d")!;
  const blanks = $(".ikp-blanks");
  const form = $<HTMLFormElement>(".ikp-form");
  const input = $<HTMLInputElement>(".ikp-input");
  const said = $(".ikp-said");
  const gotCard = $(".ikp-gotcard");
  const viewBox = $(".ikp-view");
  const vsheet = $(".ikp-vsheet");
  const vgrid = $<HTMLCanvasElement>(".ikp-vgrid");
  const vink = $<HTMLCanvasElement>(".ikp-vink");
  const vctx = vink.getContext("2d")!;
  const offs: Array<() => void> = [];

  // ------------------------------------------------------------------ the drawing
  let strokes: Stroke[] = [];
  let turn = -1;
  let nextSid = 1;
  let ink = 0;
  let size = 1;
  let eraser = false;
  let cur: Stroke | null = null;
  let pointer: number | null = null;
  let batch: number[] = [];
  let flushTimer = 0;
  let appliedSeq = -1;
  let needSync = false;
  let W = 0, H = 0;

  function layoutSheet() {
    const bw = padBox.clientWidth, bh = padBox.clientHeight;
    if (!bw || !bh) return;
    const w = Math.floor(Math.min(bw, bh * ASPECT));
    const h = Math.floor(w / ASPECT);
    if (w === W && h === H) return;
    W = w;
    H = h;
    sheet.style.width = `${w}px`;
    sheet.style.height = `${h}px`;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    for (const c of [gridC, inkC]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    bakeGrid(gridC.getContext("2d")!, gridC.width, gridC.height);
    redraw();
  }
  function redraw() {
    ictx.clearRect(0, 0, inkC.width, inkC.height);
    for (const s of strokes) drawStroke(ictx, s, inkC.width, inkC.height);
  }

  // ------------------------------------------------------------------ the drawing, as everyone else sees it
  let view: Stroke[] = [];
  let vTurn = -1;
  let vRev = -1;
  let VW = 0, VH = 0;
  let askedAt = 0;
  function layoutView() {
    const bw = viewBox.clientWidth, bh = viewBox.clientHeight;
    if (!bw || !bh) return;
    const w = Math.floor(Math.min(bw, bh * ASPECT));
    const h = Math.floor(w / ASPECT);
    if (w === VW && h === VH) return;
    VW = w;
    VH = h;
    vsheet.style.width = `${w}px`;
    vsheet.style.height = `${h}px`;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    for (const c of [vgrid, vink]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    bakeGrid(vgrid.getContext("2d")!, vgrid.width, vgrid.height);
    redrawView();
  }
  // the space for the sheet changes as the screen does ("You got it" appears, the keyboard opens): fit it again
  const viewObs = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => scene === "guess" && layoutView());
  viewObs?.observe(viewBox);
  const padObs = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => scene === "draw" && layoutSheet());
  padObs?.observe(padBox);
  function redrawView() {
    vctx.clearRect(0, 0, vink.width, vink.height);
    for (const s of view) drawStroke(vctx, s, vink.width, vink.height);
  }
  function askSheet() {
    if (performance.now() - askedAt < 1000) return;
    askedAt = performance.now();
    ctl.send({ type: "sync" });
  }
  function applySheet(m: Extract<InkGame["toController"], { type: "sheet" }>) {
    if (m.full !== undefined) {
      view = decodeStrokes(m.full);
      vTurn = m.turn;
      vRev = m.rev;
      return redrawView();
    }
    if (m.turn !== vTurn || m.rev !== vRev || (m.at ?? 0) > view.length) return askSheet();
    const at = m.at ?? 0;
    const off = m.off ?? 0;
    for (const [k, [id, c, w, p]] of (m.s ?? []).entries()) {
      const i = at + k;
      const had = view[i];
      if (k === 0 && off > 0) {
        if (!had || had.id !== id || had.p.length !== off) return askSheet();
        had.p.push(...p);
        drawStroke(vctx, had, vink.width, vink.height, off);
      } else {
        const st: Stroke = { id, c, w, p: p.slice(), done: false };
        view[i] = st;
        drawStroke(vctx, st, vink.width, vink.height);
      }
    }
  }

  const send = (msg: InkGame["toHost"]) => {
    if (!ctl.send(msg)) needSync = true;
  };
  function flush(end = false) {
    if (!cur || (!batch.length && !end)) return;
    const msg: InkGame["toHost"] = { type: "ink", k: turn, s: cur.id, c: cur.c, w: cur.w, p: batch };
    if (end) msg.e = 1;
    batch = [];
    send(msg);
  }
  const pt = (e: PointerEvent) => {
    const r = inkC.getBoundingClientRect();
    return [Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 1000), Math.round(Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) * 1000)] as const;
  };
  const drawing = () => ctl.shared?.phase === "draw" && ctl.own?.role === "artist";

  inkC.addEventListener("pointerdown", (e) => {
    if (pointer !== null || !drawing()) return;
    e.preventDefault();
    pointer = e.pointerId;
    try {
      inkC.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    const [x, y] = pt(e);
    cur = { id: nextSid++, c: eraser ? ERASER : ink, w: size, p: [x, y], done: false };
    strokes.push(cur);
    batch = [x, y];
    drawStroke(ictx, cur, inkC.width, inkC.height);
    flush();
    flushTimer = window.setInterval(() => flush(), 50);
  });
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointer || !cur) return;
    const evs = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [e]) {
      const [x, y] = pt(ev);
      const n = cur.p.length;
      // a little simplification: skip points closer than 4/1000 of the sheet to the last one
      if (Math.hypot(x - cur.p[n - 2]!, (y - cur.p[n - 1]!) / ASPECT) < 4) continue;
      const from = cur.p.length;
      cur.p.push(x, y);
      batch.push(x, y);
      drawStroke(ictx, cur, inkC.width, inkC.height, from);
      if (batch.length >= MAX_BATCH * 2) flush();
    }
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    window.clearInterval(flushTimer);
    flush(true);
    if (cur) cur.done = true;
    cur = null;
  };
  inkC.addEventListener("pointermove", move);
  inkC.addEventListener("pointerup", up);
  inkC.addEventListener("pointercancel", up);
  inkC.addEventListener("lostpointercapture", up);

  // tools
  const tools = () => {
    for (const b of root.querySelectorAll<HTMLElement>("[data-ink]")) b.classList.toggle("on", !eraser && Number(b.dataset.ink) === ink);
    for (const b of root.querySelectorAll<HTMLElement>("[data-size]")) b.classList.toggle("on", Number(b.dataset.size) === size);
    $("[data-tool=eraser]").classList.toggle("on", eraser);
  };
  let clearArmed = 0;
  for (const b of root.querySelectorAll<HTMLElement>("[data-ink]")) {
    offs.push(button(b, { mode: "tap", haptic: 8, onPress: () => ((ink = Number(b.dataset.ink)), (eraser = false), tools()) }));
  }
  for (const b of root.querySelectorAll<HTMLElement>("[data-size]")) {
    offs.push(button(b, { mode: "tap", haptic: 8, onPress: () => ((size = Number(b.dataset.size)), tools()) }));
  }
  offs.push(
    button($("[data-tool=eraser]"), { mode: "tap", haptic: 8, onPress: () => ((eraser = !eraser), tools()) }),
    button($("[data-tool=undo]"), {
      mode: "tap",
      haptic: 12,
      onPress: () => {
        if (!drawing() || cur || !strokes.length) return;
        strokes.pop();
        redraw();
        send({ type: "undo", k: turn });
      },
    }),
    button($("[data-tool=clear]"), {
      mode: "tap",
      haptic: 20,
      onPress: () => {
        const el = $("[data-tool=clear]");
        if (!drawing() || cur) return;
        // a second tap within 2 s clears the sheet
        if (!clearArmed) {
          el.classList.add("warn");
          el.querySelector("span")!.textContent = "Sure?";
          clearArmed = window.setTimeout(disarm, 2000);
          return;
        }
        disarm();
        strokes = [];
        redraw();
        send({ type: "clear", k: turn });
      },
    }),
  );
  function disarm() {
    window.clearTimeout(clearArmed);
    clearArmed = 0;
    const el = $("[data-tool=clear]");
    el.classList.remove("warn");
    el.querySelector("span")!.textContent = "Clear";
  }
  tools();

  /** The TV's copy of the strokes, for a phone that came back mid-turn. */
  function applyRestore(o: InkOwn) {
    const r = o.restore;
    if (!r || r.seq === appliedSeq || o.turn !== turn) return;
    appliedSeq = r.seq;
    const mine = strokes.filter((s) => s.id >= r.next); // drawn since the snapshot
    strokes = [...decodeStrokes(r.s), ...mine];
    nextSid = Math.max(nextSid, r.next, ...strokes.map((s) => s.id + 1));
    redraw();
  }

  // ------------------------------------------------------------------ guessing
  interface Said {
    text: string;
    how: "wait" | "right" | "close" | "wrong";
    at: number;
    /** Someone else's guess (from the feed): their name and colour. */
    who?: string;
    color?: string;
  }
  let mine: Said[] = [];
  const drawSaid = () => {
    said.innerHTML = mine
      .slice(-30)
      .reverse()
      .map((g) =>
        g.who
          ? `<li class="other ${g.how}" style="--c:${g.color}"><span><i class="ikp-dot"></i><b>${esc(g.who)}</b> ${g.how === "right" ? "got it!" : esc(g.text)}</span></li>`
          : `<li class="${g.how}"><span>${esc(g.text)}</span>${g.how === "close" ? "<em>Close!</em>" : g.how === "wrong" ? "<em>No</em>" : g.how === "right" ? "<em>Yes!</em>" : ""}</li>`,
      )
      .join("");
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!text || ctl.shared?.phase !== "draw" || ctl.own?.role !== "guess" || ctl.own.got) return;
    input.value = "";
    mine.push({ text, how: "wait", at: performance.now() });
    if (mine.length > 60) mine.shift();
    drawSaid();
    ctl.send({ type: "guess", text });
    input.focus();
  });
  // keep the keyboard up when the button is tapped
  const sendBtn = $(".ikp-send");
  sendBtn.addEventListener("pointerdown", (e) => e.preventDefault());
  sendBtn.addEventListener("mousedown", (e) => e.preventDefault());

  // ------------------------------------------------------------------ picking
  let picked: number | null = null;
  let pickKey = "";
  let pickSent = "";
  function buildPick(o: InkOwn) {
    const k = `${o.turn}|${o.choices.map((c) => c.w).join()}`;
    if (k === pickKey) return;
    pickKey = k;
    picked = null;
    cards.innerHTML = o.choices
      .map((c, i) => `<button class="ikp-card" data-pick="${i}"><b>${esc(c.w)}</b><small>${LEVEL[c.d]}<br>${c.pts} a guess</small></button>`)
      .join("");
    for (const b of cards.querySelectorAll<HTMLElement>("[data-pick]")) {
      pickOffs.push(
        button(b, {
          mode: "tap",
          haptic: 10,
          onPress: () => {
            if (pickSent === pickKey) return;
            picked = Number(b.dataset.pick);
            refreshPick();
          },
        }),
      );
    }
    refreshPick();
  }
  let pickOffs: Array<() => void> = [];
  function refreshPick() {
    const o = ctl.own;
    cards.querySelectorAll<HTMLElement>("[data-pick]").forEach((b) => b.classList.toggle("on", Number(b.dataset.pick) === picked));
    const sent = pickSent === pickKey;
    go.disabled = picked === null || sent;
    const c = picked !== null ? o?.choices[picked] : undefined;
    go.textContent = sent ? "Sent" : c ? `Draw “${c.w}”` : "Pick one";
  }
  offs.push(
    button(go, {
      mode: "tap",
      haptic: 14,
      onPress: () => {
        if (picked === null || go.disabled) return;
        if (!ctl.send({ type: "pick", i: picked })) return;
        pickSent = pickKey;
        refreshPick();
      },
    }),
  );

  // ------------------------------------------------------------------ the info card
  let infoKey = "";
  let infoOffs: Array<() => void> = [];
  function setInfo(key: string, html: string) {
    if (key === infoKey) return;
    infoKey = key;
    infoOffs.forEach((f) => f());
    infoOffs = [];
    info.innerHTML = html;
    for (const b of info.querySelectorAll<HTMLElement>("[data-act]")) {
      infoOffs.push(
        button(b, {
          mode: "tap",
          haptic: 14,
          onPress: () => {
            if (b.dataset.act === "again") ctl.send({ type: "again" });
            else ctx.exitToLobby();
          },
        }),
      );
    }
  }
  function scoresHtml(s: InkShared, gained: boolean) {
    if (!s.scores?.length) return "";
    return `<ol class="ikp-scores">${s.scores
      .map((x, i) => `<li class="${x.away ? "away" : ""}" style="--c:${x.color}"><em>${i + 1}</em><i class="ikp-dot"></i><span>${esc(x.name)}</span>${gained && x.gained ? `<small>+${x.gained}</small>` : ""}<b>${x.score}</b></li>`)
      .join("")}</ol>`;
  }
  function infoFor(s: InkShared, o: InkOwn | null): [string, string] {
    const tip = (c: string) => `<i class="ikp-tip" style="--c:${c}"></i>`;
    if (!o || o.role === "watch") return ["watch", `<h2>The table is full</h2><p>You get a seat when one comes free.</p>`];
    switch (s.phase) {
      case "wait":
        return ["wait", `<h2>Waiting for players</h2><p>Two or more to play.</p>`];
      case "pick":
        return [`pick${s.artist}${JSON.stringify(s.scores)}`, `${tip(s.artistColor)}<h2>${esc(s.artist)} is picking a word</h2><p>Get ready to guess.</p>${scoresHtml(s, false)}`];
      case "reveal":
        return [
          `reveal${s.turn}${o.gained}${JSON.stringify(s.scores)}`,
          `<p>${esc(s.why)}. The word was</p><div class="ikp-big">${esc(s.mask)}</div><p>${o.gained ? `You scored <b>+${o.gained}</b>` : "No points this turn"} · ${o.score} in all</p>${scoresHtml(s, true)}<p>${s.next ? `<b>${esc(s.next)}</b> draws next` : "That was the last turn"}</p>`,
        ];
      case "match": {
        const vip = ctx.isVip();
        const sh = ctx.shell();
        const decider = sh?.players.find((p) => p.id === sh.vip)?.name;
        const won = s.winners.includes(o.name);
        return [
          `match${o.rank}${o.score}${vip}${decider}`,
          `<h2>${won ? "You win!" : `${esc(s.winners.join(" & ") || "Nobody")} ${s.winners.length > 1 ? "win" : "wins"}`}</h2>
           <div class="ikp-big">${ordinal(o.rank)}</div><p>${o.score} points</p>${scoresHtml(s, false)}
           ${vip ? `<div class="ikp-actions"><button class="ikp-btn primary" data-act="again">Play again</button><button class="ikp-btn" data-act="lobby">Back to lobby</button></div>` : `<p><b>${esc(decider ?? "The host")}</b> picks what's next.</p>`}`,
        ];
      }
      default:
        return ["", ""];
    }
  }

  // ------------------------------------------------------------------ the whole screen
  let scene: Scene | "" = "";
  let lastLeft = 0;
  let leftAt = 0;
  let gotKey = "";

  function show(next: Scene) {
    if (next === scene) return;
    scene = next;
    for (const el of scenes) el.hidden = el.dataset.scene !== next;
    if (next === "draw") requestAnimationFrame(layoutSheet);
    if (next === "guess") requestAnimationFrame(layoutView);
    if (next !== "guess" && document.activeElement === input) input.blur();
  }

  function render() {
    const s = ctl.shared;
    const o = ctl.own;
    root.style.setProperty("--c", o?.color ?? "#8d9aa1");
    if (!s || !o) {
      status.textContent = "Joining…";
      show("info");
      setInfo("join", `<h2>Finding a seat…</h2>`);
      return;
    }
    // a new turn: a clean sheet and a clean list
    if (o.turn !== turn) {
      turn = o.turn;
      strokes = [];
      nextSid = 1;
      cur = null;
      pointer = null;
      window.clearInterval(flushTimer);
      mine = [];
      drawSaid();
      redraw();
    }
    lastLeft = s.left;
    leftAt = performance.now();

    const artist = o.role === "artist";
    if (artist && s.phase === "pick" && o.choices.length) {
      status.innerHTML = "Your turn to draw";
      buildPick(o);
      refreshPick();
      show("pick");
    } else if (artist && s.phase === "draw") {
      status.innerHTML = `Draw <b>${esc(o.word)}</b>`;
      show("draw");
      applyRestore(o);
    } else if ((o.role === "guess" || o.role === "watch") && s.phase === "draw") {
      status.innerHTML = `<b>${esc(s.artist)}</b> is drawing`;
      show("guess");
      blanks.innerHTML = (o.got ? o.word : s.mask)
        .split(" ")
        .map((w) => `<span>${[...w].map((ch) => (ch === "_" ? "<i></i>" : /[a-z0-9À-ɏ]/i.test(ch) ? `<i>${esc(ch)}</i>` : `<i class="mark">${esc(ch)}</i>`)).join("")}</span>`)
        .join("");
      form.hidden = o.got || o.role === "watch";
      const gk = o.got ? `${o.turn}|${o.word}|${o.gained}` : "";
      if (gk !== gotKey) {
        gotKey = gk;
        gotCard.hidden = !o.got;
        gotCard.innerHTML = o.got ? `<div class="ikp-got"><small>You got it</small><b>${esc(o.word)}</b><span>+${o.gained}</span></div>` : "";
        if (o.got && document.activeElement === input) input.blur();
      }
    } else {
      const [k, html] = infoFor(s, o);
      status.innerHTML =
        s.phase === "match" ? "Final scores" : s.phase === "reveal" ? `Turn ${s.turn} of ${s.turns}` : s.phase === "pick" ? `Turn ${s.turn} of ${s.turns}` : o.role === "watch" ? "Watching" : "Inkling";
      show("info");
      setInfo(k, html);
    }
    tick();
  }

  // the seconds count down between the TV's updates
  function tick() {
    // a guess the TV did not take (too fast, paused, offline) drops off the list
    const stale = mine.filter((g) => !g.who && g.how === "wait" && performance.now() - g.at > 4000);
    if (stale.length) {
      mine = mine.filter((g) => !stale.includes(g));
      drawSaid();
    }
    const s = ctl.shared;
    const live = s && (s.phase === "draw" || s.phase === "pick");
    const left = live ? Math.max(0, Math.ceil(lastLeft - (performance.now() - leftAt) / 1000)) : 0;
    time.textContent = live ? String(left) : "";
    time.classList.toggle("low", !!live && s.phase === "draw" && left <= 10);
  }
  const ticker = window.setInterval(tick, 250);

  const onResize = () => {
    if (scene === "draw") layoutSheet();
    if (scene === "guess") layoutView();
  };
  window.addEventListener("resize", onResize);

  offs.push(
    ctl.on("state", render),
    ctx.onVip(() => {
      infoKey = "";
      render();
    }),
    ctl.on("message", (m) => {
      if (!m || typeof m !== "object") return;
      if (m.type === "said") {
        // match the reply to the same guess only (never to an older one still waiting)
        const g = mine.find((x) => !x.who && x.how === "wait" && x.text === m.text);
        if (g) g.how = m.how;
        else mine.push({ text: m.text, how: m.how, at: performance.now() });
        drawSaid();
        if (m.how === "close") buzz("close");
        if (m.how === "right") buzz("got");
      } else if (m.type === "sheet") applySheet(m);
      else if (m.type === "feed") {
        // my own guesses are already on the list
        if (m.name === ctl.own?.name) return;
        mine.push({ text: m.text, how: m.right ? "right" : "wrong", at: performance.now(), who: m.name, color: m.color });
        if (mine.length > 60) mine.shift();
        drawSaid();
      } else if (m.type === "buzz") buzz(m.kind === "turn" ? "turn" : m.kind === "got" ? "drawn" : "end");
    }),
    // back after a drop or a reload: the artist takes the TV's strokes
    ctl.on("ready", () => {
      ctl.send({ type: "sync" });
      needSync = false;
    }),
  );
  render();
  ctl.send({ type: "sync" });
  // a batch that could not be sent: ask for the TV's copy once the link is back
  const syncTimer = window.setInterval(() => {
    if (needSync && ctl.status === "open" && drawing() && !cur) {
      needSync = false;
      ctl.send({ type: "sync" });
    }
  }, 1000);

  return () => {
    offs.forEach((f) => f());
    pickOffs.forEach((f) => f());
    infoOffs.forEach((f) => f());
    window.clearInterval(flushTimer);
    window.clearInterval(ticker);
    window.clearInterval(syncTimer);
    window.clearTimeout(clearArmed);
    window.removeEventListener("resize", onResize);
    viewObs?.disconnect();
    padObs?.disconnect();
    root.remove();
  };
};

export default mount;
