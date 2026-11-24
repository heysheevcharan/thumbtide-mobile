// The phone: a stick that steps your cursor one cell at a time (hold it to keep going), a big Place button,
// and a status strip that says whose turn it is. The board is on the TV.
import { haptic, type Controller } from "@thumbtide/sdk";
import { button } from "@thumbtide/sdk/ui";
import { gamepad } from "../kit/gamepad.ts";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import { colorVars } from "./hud.ts";
import type { CascadeGame, CascadeShared } from "./shared.ts";
import "./cascade.css";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const place = (k: number) => (k === 0 ? "1st" : k === 1 ? "2nd" : k === 2 ? "3rd" : `${k + 1}th`);

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<CascadeGame>;
  const def = gameById("cascade")!;
  const tune = def.controls?.tune ?? {};
  const REPEAT_DELAY = tune["repeat-delay"] ?? 280;
  const REPEAT_EVERY = tune["repeat-every"] ?? 120;
  const STEP_BUZZ = tune["step-buzz"] ?? 6;

  const wrap = document.createElement("div");
  wrap.className = "czc";
  ctx.root.appendChild(wrap);

  let held: { dx: number; dy: number } | null = null;
  let repeat: ReturnType<typeof setTimeout> | null = null;
  const myTurn = () => {
    const s = ctl.shared;
    const o = ctl.own;
    return !!s && !!o && s.phase === "play" && s.turn === o.seat;
  };
  const step = () => {
    if (!held || !myTurn()) return;
    ctl.send({ type: "move", dx: held.dx, dy: held.dy });
    if (STEP_BUZZ) haptic(STEP_BUZZ);
  };
  const stopRepeat = () => {
    if (repeat) clearTimeout(repeat);
    repeat = null;
  };
  const again = () => {
    step();
    repeat = setTimeout(again, REPEAT_EVERY);
  };

  const pad = gamepad(wrap, def.controls!, {
    ctl,
    top: `
      <div class="czc-top">
        <div class="czc-me"><i class="czc-piece"></i><span>Your colour</span><span class="czc-wins"></span></div>
        <div class="czc-status"><i class="czc-piece czc-who"></i><div><b class="czc-big"></b><small class="czc-small"></small></div></div>
        <i class="czc-timer"><i></i></i>
      </div>`,
    onStick: ({ x, y }) => {
      // the stick snaps to four directions; one push is one cell, holding it keeps stepping
      const d = Math.hypot(x, y) < 0.5 ? null : Math.abs(x) > Math.abs(y) ? { dx: Math.sign(x), dy: 0 } : { dx: 0, dy: Math.sign(y) };
      if (d?.dx === held?.dx && d?.dy === held?.dy) return;
      stopRepeat();
      held = d;
      if (!d) return;
      step();
      repeat = setTimeout(again, REPEAT_DELAY);
    },
    onPress: (id) => {
      if (id !== "place") return;
      if (myTurn()) ctl.send({ type: "place" });
      else pad.buzz("wait");
    },
  });

  const over = document.createElement("div");
  over.className = "czc-over";
  over.setAttribute("data-scroll", "");
  over.hidden = true;
  wrap.appendChild(over);

  const $ = <T extends HTMLElement>(s: string) => wrap.querySelector(s) as T;
  const placeBtn = pad.btn("place")!;
  const timerBar = $(".czc-timer");
  const timerFill = timerBar.querySelector("i") as HTMLElement;

  let overKey = "";
  let lastTurn = -1;
  let wasMine = false;
  // the turn timer runs here from the moment the TV's word arrives
  let deadline = 0;
  let timerTotal = 0;
  let raf = 0;

  function setOver(key: string, html: string | null, cls = "") {
    if (key === overKey) return;
    overKey = key;
    over.className = `czc-over ${cls}`;
    over.hidden = html === null;
    over.innerHTML = html ?? "";
    for (const b of over.querySelectorAll<HTMLButtonElement>("[data-act]")) {
      button(b, {
        mode: "tap",
        onPress: () => {
          if (b.dataset.act === "again") ctl.send({ type: "again" });
          else ctx.exitToLobby();
        },
      });
    }
  }

  function endHtml(s: CascadeShared, mine: number) {
    const w = s.seats[s.winner];
    const k = s.standings.indexOf(mine);
    const vip = ctx.isVip();
    const sh = ctx.shell();
    const decider = sh?.players.find((p) => p.id === sh.vip)?.name;
    const head = mine === s.winner ? "You win!" : w ? `${esc(w.name)} wins` : "Round over";
    return `<div class="czc-end">
      <section class="czc-end-me" style="${colorVars(w?.color ?? "#888888")}">
        <i class="czc-piece big"></i>
        <h2>${head}</h2>
        ${mine !== s.winner && k >= 0 ? `<p>You finished ${place(k)}</p>` : `<p>Round ${s.round}</p>`}
        ${
          vip
            ? `<div class="czc-actions"><button class="czc-btn primary" data-act="again">Play again</button><button class="czc-btn" data-act="lobby">Lobby</button></div>`
            : `<p class="czc-wait"><b>${esc(decider ?? "The host")}</b> picks what's next</p>`
        }
      </section>
      <ol class="czc-results">${s.standings
        .map((i, n) => {
          const x = s.seats[i]!;
          return `<li class="${i === mine ? "me" : ""}" style="${colorVars(x.color)}"><span class="rk">${place(n)}</span><i class="czc-piece"></i><span class="nm">${esc(x.name)}</span><b>${x.wins ? `${x.wins} ${x.wins === 1 ? "win" : "wins"}` : ""}</b></li>`;
        })
        .join("")}</ol>
    </div>`;
  }

  function render() {
    const s = ctl.shared;
    const o = ctl.own;
    const me = ctl.me;
    if (!s || !o) {
      if (me && s?.watching?.includes(me.id)) {
        setOver("watch", `<h2>You're in next round</h2><p>This one's already going. Watch the board till it's over.</p>`);
      } else setOver("wait", `<div class="spinner"></div>`);
      return;
    }
    wrap.setAttribute("style", colorVars(o.color));
    const mySeat = s.seats[o.seat];
    $(".czc-wins").textContent = mySeat?.wins ? `${mySeat.wins} ${mySeat.wins === 1 ? "win" : "wins"}` : "";

    if (s.phase === "end") {
      setOver(`end:${s.round}:${ctx.isVip()}:${ctx.shell()?.vip}`, endHtml(s, o.seat), "czc-end-over");
      return;
    }
    if (mySeat && !mySeat.alive) {
      setOver("out", `<i class="czc-piece big"></i><h2>You're out</h2><p>Watch the rest play out on the TV.</p>`, "czc-out");
      return;
    }
    setOver("play", null);

    if (s.turn >= 0) lastTurn = s.turn;
    const mine = s.turn === o.seat;
    const who = s.seats[s.turn >= 0 ? s.turn : lastTurn];
    wrap.classList.toggle("czc-mine", mine);
    wrap.classList.toggle("czc-idle", !mine);
    placeBtn.classList.toggle("off", !mine);
    const whoEl = $(".czc-who");
    if (mine) {
      $(".czc-big").textContent = "Your turn";
      whoEl.setAttribute("style", colorVars(o.color));
    } else if (who) {
      $(".czc-big").textContent = `${who.name}'s turn`;
      whoEl.setAttribute("style", colorVars(who.color));
    } else $(".czc-big").textContent = "Get ready";
    const pieces = mySeat?.pieces ?? 0;
    $(".czc-small").textContent = pieces ? `${pieces} ${pieces === 1 ? "piece" : "pieces"} on the board` : "";
    if (mine && !wasMine) pad.buzz("turn");
    wasMine = mine;

    if (mine && s.timeLeft) {
      deadline = performance.now() + s.timeLeft;
      timerTotal = s.timeTotal || s.timeLeft;
    } else {
      deadline = 0;
      timerTotal = 0;
    }
    timerBar.classList.toggle("run", !!deadline);
  }

  // the timer bar, drawn locally
  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (!deadline || !timerTotal) return;
    const left = Math.max(0, deadline - performance.now());
    timerFill.style.transform = `scaleX(${left / timerTotal})`;
    timerBar.classList.toggle("low", left < 3000);
  };
  raf = requestAnimationFrame(tick);

  const offs = [
    ctl.on("state", render),
    ctx.onVip(() => {
      overKey = "";
      render();
    }),
    ctl.on("message", (d) => {
      if (d && typeof d === "object" && d.type === "buzz") pad.buzz(d.kind);
    }),
  ];
  render();

  return () => {
    stopRepeat();
    cancelAnimationFrame(raf);
    pad.destroy();
    offs.forEach((o) => o());
    wrap.remove();
  };
};

export default mount;
