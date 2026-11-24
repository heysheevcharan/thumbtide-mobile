/**
 * Phone shell. Joins a room, keeps the connection healthy, swaps in the controller UI for whichever game
 * the screen is running, and carries everything every game shares: the top bar, how-to-play help, the
 * VIP's host menu, the pause screen — and the work of making a phone browser behave like a game
 * controller (full screen, back-gesture guard, screen awake, connection quality, orientation).
 */
import {
  Controller, canFullscreen, enterFullscreen, isFullscreen, isStandalone, keepAwake, local, normalizeRoomCode,
  onFullscreenChange, platform, session, type ControllerCloseReason,
} from "@thumbtide/sdk";
import { button, controllerSurface } from "@thumbtide/sdk/ui";
import "../style.css";
import { forgetHostedRoom, hostedBefore, installP2P, isHosting, LOCAL_URL, PEER_URL, startHosting } from "../net/p2p.ts";
import { startEngine } from "./engine.ts";
import { controlsHtml } from "../games/kit/howto.ts";
import { juicy } from "../games/kit/juicy.ts";
import { prefs } from "../games/kit/prefs.ts";
import { gameById } from "../games/registry.ts";
import { isSys, type ControllerContext, type ShellState, type SysMessage } from "../games/types.ts";
import { settingsHtml, wireSettings } from "./settings-ui.ts";

installP2P();
const form = document.getElementById("join-form") as HTMLFormElement;
const createBtn = document.getElementById("create") as HTMLButtonElement;
const codeInput = document.getElementById("code") as HTMLInputElement;
const nameInput = document.getElementById("name") as HTMLInputElement;
const errorEl = document.getElementById("join-error")!;
const gameRoot = document.getElementById("game")!;
const overlay = document.getElementById("overlay")!;
const overlayText = overlay.querySelector("p")!;
const bar = document.getElementById("shellbar")!;
const pausedEl = document.getElementById("paused")!;
const rotateEl = document.getElementById("rotate")!;
const sheet = document.getElementById("sheet")!;
const sheetPanel = sheet.querySelector(".sh-panel") as HTMLElement;
/** A fade over the pinned footer while the sheet has more below it (a scrolled-off item had no cue at all). */
function moreBelow(): void {
  sheetPanel.classList.toggle("more", sheetPanel.scrollHeight - sheetPanel.scrollTop - sheetPanel.clientHeight > 4);
}
sheetPanel.addEventListener("scroll", moreBelow, { passive: true });

const NAME_KEY = "thumbtide:name";
const ACTIVE_ROOM_KEY = "thumbtide:active-room";
const COACHED_KEY = "thumbtide:coached-fullscreen";
const PLATFORM = platform();

const CLOSE_TEXT: Record<ControllerCloseReason, string> = {
  "room-not-found": "No room with that code. Check it with whoever started the room (their page must stay open).",
  "room-full": "That room is full.",
  "room-locked": "A game is in progress and the host locked the room. Wait for the lobby.",
  kicked: "You were removed from the room.",
  "host-closed": "The host ended the room.",
  "host-timeout": "Lost the host's phone. The room has closed.",
  left: "You left the room.",
  "away-timeout": "You were away too long, so your seat was given up. Join again to play.",
  "away-timeout-locked": "You were away too long, so your seat was given up. The host locked the room for this game: join again in the lobby.",
  replaced: "You joined from another tab.",
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// The form scrolls if the keyboard needs the room; everything else is locked in place.
form.setAttribute("data-scroll", "");
controllerSurface();

// Prefill from QR link (?r=ABCD) and last used name.
const params = new URLSearchParams(location.search);
codeInput.value = normalizeRoomCode(params.get("r") ?? "");
nameInput.value = local.get(NAME_KEY) ?? "";
codeInput.addEventListener("input", () => {
  codeInput.value = normalizeRoomCode(codeInput.value);
  if (codeInput.value.length === 4 && !nameInput.value) nameInput.focus();
});
if (codeInput.value && !nameInput.value) nameInput.focus();

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const room = normalizeRoomCode(codeInput.value);
  const name = nameInput.value.trim();
  if (room.length !== 4) return void (errorEl.textContent = "Enter the 4-letter room code.");
  if (!name) return void (errorEl.textContent = "Pick a name.");
  local.set(NAME_KEY, name);
  // this tap is our chance to go full screen and keep the screen awake (both need a tap)
  if (prefs.get().fullscreen && canFullscreen()) void enterFullscreen();
  join(room, name);
});

// Start a room: this phone becomes the room (it runs the game for everyone) and joins it as the first player.
let engineStarted = false;
/** This page is in a room (or on its way in): a second Start or Join is ignored. */
let inRoom = false;
let starting = false;
async function host(name: string) {
  if (inRoom || starting) return;
  starting = true;
  form.hidden = true;
  showOverlay("Starting a room…");
  try {
    const code = await startHosting();
    if (!engineStarted) {
      engineStarted = true;
      startEngine();
    }
    starting = false;
    join(code, name);
  } catch (e) {
    starting = false;
    showOverlay(null);
    form.hidden = false;
    errorEl.textContent = e instanceof Error ? e.message : "Couldn't start a room.";
  }
}
createBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!name) {
    errorEl.textContent = "Pick a name first.";
    return nameInput.focus();
  }
  local.set(NAME_KEY, name);
  if (prefs.get().fullscreen && canFullscreen()) void enterFullscreen();
  void host(name);
});

// Refreshed mid-game? Jump straight back in as the same player (the host phone brings its room back).
const active = session.get(ACTIVE_ROOM_KEY);
if (hostedBefore() && nameInput.value) {
  void host(nameInput.value);
} else if (active && (!codeInput.value || codeInput.value === active) && nameInput.value) {
  join(active, nameInput.value);
}

// Restored from the back/forward cache: the connection is gone, start clean (we rejoin as the same player).
window.addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload();
});

function showOverlay(text: string | null) {
  overlay.hidden = text === null;
  if (text) overlayText.textContent = text;
}

function join(room: string, name: string) {
  if (inRoom) return;
  inRoom = true;
  // put the keyboard away before the controller appears
  (document.activeElement as HTMLElement | null)?.blur?.();
  errorEl.textContent = "";
  form.hidden = true;
  gameRoot.hidden = false;
  bar.hidden = false;
  showOverlay("Joining…");
  session.set(ACTIVE_ROOM_KEY, room);
  const releaseWake = keepAwake();

  const hosting = isHosting();
  const ctl = new Controller({ server: hosting ? LOCAL_URL : PEER_URL, room, name });
  let state: ShellState | null = null;
  const shellListeners = new Set<(s: ShellState) => void>();
  let unmount: (() => void) | null = null;
  let mountSeq = 0;
  let sheetKind: "help" | "host" | "leave" | "coach" | null = null;
  let closed = false;

  const isVip = () => !!ctl.me && state?.vip === ctl.me.id;
  const sys = (m: SysMessage) => ctl.send(m);
  const currentGame = () => gameById(ctl.config?.game ?? "lobby");

  const ctx: ControllerContext = {
    ctl,
    root: gameRoot,
    isVip,
    onVip(fn) {
      const f = () => fn();
      shellListeners.add(f);
      return () => shellListeners.delete(f);
    },
    shell: () => state,
    onShell(fn) {
      shellListeners.add(fn);
      return () => shellListeners.delete(fn);
    },
    startGame: (id) => sys({ $sys: "start", game: id }),
    exitToLobby: () => sys({ $sys: "exit" }),
    sys,
  };

  async function mount(id: string) {
    const def = gameById(id) ?? gameById("lobby")!;
    const seq = ++mountSeq;
    unmount?.();
    unmount = null;
    gameRoot.replaceChildren();
    if (sheetKind === "help" || sheetKind === "host") closeSheet();
    const mod = await def.controller();
    if (seq !== mountSeq) return;
    unmount = mod.default(ctx);
    renderBar();
    checkOrientation();
    // In the lobby, offer iPhone players the full-screen setup once.
    if (def.id === "lobby" && PLATFORM === "ios" && !isStandalone() && !local.get(COACHED_KEY)) {
      setTimeout(() => !sheetKind && openSheet("coach"), 900);
    }
  }

  // ---------------------------------------------------------------- back gesture / back button guard
  // A swipe from the screen edge (iPhone) or the back button (Android) would leave the page and drop you
  // from the game. We keep an extra history entry so "back" lands here instead, and ask first.
  history.pushState({ thumbtide: true }, "");
  const onPop = () => {
    if (closed) return;
    history.pushState({ thumbtide: true }, "");
    openSheet("leave");
  };
  window.addEventListener("popstate", onPop);
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (closed || ctl.config?.game === "lobby") return;
    e.preventDefault();
    e.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  // ---------------------------------------------------------------- top bar
  const helpBtn = bar.querySelector(".sb-help") as HTMLButtonElement;
  const hostBtn = bar.querySelector(".sb-host") as HTMLButtonElement;
  const fsBtn = bar.querySelector(".sb-fs") as HTMLButtonElement;
  const net = bar.querySelector(".sb-net") as HTMLElement;
  button(helpBtn, { onPress: () => openSheet("help") });
  button(hostBtn, { onPress: () => openSheet("host") });
  button(fsBtn, { onPress: () => void enterFullscreen().then(renderBar) });
  onFullscreenChange(() => renderBar());

  function renderBar() {
    (bar.querySelector(".sb-room") as HTMLElement).textContent = room;
    (bar.querySelector(".sb-me") as HTMLElement).textContent = ctl.me?.name ?? name;
    const def = currentGame();
    helpBtn.hidden = false;
    helpBtn.title = def?.id === "lobby" ? "Controller settings" : "How to play";
    hostBtn.hidden = !isVip();
    fsBtn.hidden = !canFullscreen() || isFullscreen() || isStandalone();
  }

  // connection quality, at a glance: green / amber / red
  const netTimer = setInterval(() => {
    const rtt = ctl.rtt;
    const level = ctl.status !== "open" ? "bad" : rtt === 0 ? "" : rtt < 90 ? "good" : rtt < 200 ? "ok" : "bad";
    net.dataset.level = level;
    net.title = ctl.status === "open" ? `Connection: ${Math.round(rtt)}ms` : "Reconnecting…";
  }, 1000);

  // ---------------------------------------------------------------- orientation
  const portraitQuery = window.matchMedia("(orientation: portrait)");
  function checkOrientation() {
    const want = currentGame()?.controls?.orientation ?? "any";
    const portrait = portraitQuery.matches;
    // an open keyboard shrinks the viewport (a portrait phone can look landscape): never cover a field being typed in
    const a = document.activeElement as HTMLElement | null;
    const typing = !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
    // only a phone in the hand is asked to turn: tablets and laptops show the game as it is (centred)
    const phone = window.matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 600;
    const wrong = phone && !typing && ((want === "landscape" && portrait) || (want === "portrait" && !portrait));
    rotateEl.hidden = !wrong;
    rotateEl.classList.toggle("to-portrait", want === "portrait");
    (rotateEl.querySelector("p") as HTMLElement).textContent = want === "portrait" ? "Turn your phone upright" : "Turn your phone sideways";
    if (want !== "any" && isFullscreen()) void enterFullscreen(want);
  }
  portraitQuery.addEventListener("change", checkOrientation);
  // the keyboard closes when the field loses focus: check again then
  document.addEventListener("focusout", () => setTimeout(checkOrientation, 300));

  // ---------------------------------------------------------------- sheets
  sheet.querySelector(".sh-backdrop")!.addEventListener("pointerdown", () => closeSheet());

  function openSheet(kind: NonNullable<typeof sheetKind>) {
    sheetKind = kind;
    sheet.hidden = false;
    renderSheet();
  }
  function closeSheet() {
    sheetKind = null;
    sheet.hidden = true;
    sheetPanel.replaceChildren();
  }
  const head = (title: string) => `<div class="sh-head"><h2>${title}</h2><button class="sh-x" aria-label="Close">✕</button></div>`;

  function controllerPrefsHtml() {
    const p = prefs.get();
    const fs = canFullscreen()
      ? `<label class="sh-toggle"><span>Full screen<small>Hides the browser bars</small></span><button class="sh-switch ${p.fullscreen ? "on" : ""}" data-pref="fullscreen"></button></label>`
      : PLATFORM === "ios" && !isStandalone()
        ? `<button class="sh-act sh-coach" data-cmd="coach">Make it full screen…</button>`
        : "";
    return `<section><h3>Your controller</h3>
      <label class="sh-toggle"><span>Vibration<small>${PLATFORM === "ios" ? "Taps on button presses (iOS 18+)" : "Buzz on presses and hits"}</small></span><button class="sh-switch ${p.haptics ? "on" : ""}" data-pref="haptics"></button></label>
      <label class="sh-toggle"><span>Left-handed<small>Buttons on the left, stick on the right</small></span><button class="sh-switch ${p.swap ? "on" : ""}" data-pref="swap"></button></label>
      ${fs}
      <button class="sh-act danger sh-leave" data-cmd="leave">${hosting ? "End the room" : "Leave room"}</button>
    </section>`;
  }

  function renderSheet() {
    if (!sheetKind) return;
    const game = ctl.config?.game ?? "lobby";
    const def = gameById(game);

    if (sheetKind === "leave") {
      sheetPanel.innerHTML = `${head("Leave the room?")}
        <div class="sh-body"><p class="sh-note">${hosting ? "This phone is running the room: leaving ends it for everyone." : game === "lobby" ? "You can come back with the same code." : "You'll drop out of the game. You can come back with the same code."}</p>
        <div class="sh-actions"><button class="sh-act" data-cmd="stay">Stay</button><button class="sh-act danger" data-cmd="leave">Leave</button></div></div>`;
    } else if (sheetKind === "coach") {
      local.set(COACHED_KEY, "1");
      const share = `<svg class="sh-ico" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>`;
      sheetPanel.innerHTML = `${head("Play full screen")}
        <div class="sh-body">
          <p class="sh-note">Safari's bars take up space on iPhone. Two ways to lose them:</p>
          <ol class="sh-steps">
            <li><b>Best:</b> tap ${share} <b>Share</b>, then <b>Add to Home Screen</b>. Open Thumbtide from your home screen next time: no bars at all.</li>
            <li><b>Quick:</b> tap <b>aA</b> (or ⋯) in the address bar, then <b>Hide Toolbar</b>.</li>
          </ol>
          <div class="sh-actions"><button class="sh-act" data-cmd="stay">Got it</button></div>
        </div>`;
    } else if (sheetKind === "help") {
      sheetPanel.innerHTML = `${head(esc(def && def.id !== "lobby" ? def.title : "Controller"))}
        <div class="sh-body">${def && def.id !== "lobby" ? `<section>${controlsHtml(def)}</section>` : ""}${controllerPrefsHtml()}</div>`;
    } else {
      if (!isVip()) return closeSheet();
      const s = state;
      const inGame = game !== "lobby";
      const others = (s?.players ?? []).filter((p) => p.id !== ctl.me?.id);
      // Upright phone: the game's settings first (key ones, then "More settings" folded), then the room and its
      // players, End game last, and Pause / Restart pinned to the bottom under the thumb.
      const scroll = sheetPanel.scrollTop;
      sheetPanel.innerHTML = `${head(inGame ? esc(def?.title ?? "Game") : "Host controls")}
        <div class="sh-body sh-host">
          ${inGame && def?.settings?.length ? `<section><h3>Settings</h3>${settingsHtml(def, s?.settings ?? {})}</section>` : ""}
          <section><h3>Room ${esc(room)}<span class="sh-count">${others.length + 1} ${others.length ? "players" : "player"}</span></h3>
            ${inGame ? `<button class="sh-toggle sh-lock" data-cmd="lock"><span>Lock the room<small>New players can't join mid-game</small></span><i class="sh-switch ${s?.locked ? "on" : ""}"></i></button>` : ""}
            <ul class="sh-players">${
              others.length
                ? others
                    .map((p) => `<li class="${p.connected && !p.away ? "" : "away"}"><span>${esc(p.name)}${p.connected && !p.away ? "" : " <small>(away)</small>"}</span><button class="sh-kick" data-id="${esc(p.id)}">Remove</button></li>`)
                    .join("")
                : `<li class="sh-empty">Nobody else here yet</li>`
            }</ul>
          </section>
          ${inGame && !s?.canPause ? `<button class="sh-act danger sh-end" data-cmd="exit">⏏ End game</button>` : ""}
        </div>
        ${
          // End game sits in the pinned footer too: at the end of a long list it hid under the footer, and testers
          // tapped Restart instead (QA, 390×664 and 400×860 phones with 3+ players)
          inGame && s?.canPause
            ? `<div class="sh-foot sh-foot3">
                <button class="sh-act" data-cmd="${s.paused ? "resume" : "pause"}">${s.paused ? "▶ Resume" : "❚❚ Pause"}</button>
                <button class="sh-act" data-cmd="restart">↻ Restart</button>
                <button class="sh-act danger" data-cmd="exit">⏏ End game</button>
              </div>`
            : ""
        }`;
      sheetPanel.scrollTop = scroll;
      for (const b of sheetPanel.querySelectorAll<HTMLButtonElement>(".sh-kick")) {
        button(b, {
          mode: "tap",
          onPress: () => {
            if (b.dataset.confirm) sys({ $sys: "kick", id: b.dataset.id! });
            else {
              b.dataset.confirm = "1";
              b.textContent = "Sure?";
            }
          },
        });
      }
      if (def) wireSettings(sheetPanel, def, (key, value) => sys({ $sys: "setting", game: def.id, key, value }));
    }

    for (const b of sheetPanel.querySelectorAll<HTMLButtonElement>("[data-cmd]")) {
      button(b, {
          mode: "tap",
        onPress: () => {
          const cmd = b.dataset.cmd!;
          if (cmd === "stay") closeSheet();
          else if (cmd === "coach") openSheet("coach");
          else if (cmd === "leave") leave();
          else if (cmd === "lock") sys({ $sys: "lock", locked: !state?.locked });
          else if (cmd === "exit" && !b.dataset.confirm) {
            // End game sits next to Restart in the footer: a second tap ends it
            b.dataset.confirm = "1";
            b.textContent = "Tap again";
          } else if (cmd === "exit") {
            sys({ $sys: "exit" });
            closeSheet();
          } else {
            sys({ $sys: cmd as "pause" | "resume" | "restart" });
            if (cmd !== "pause") closeSheet();
          }
        },
      });
    }
    for (const b of sheetPanel.querySelectorAll<HTMLButtonElement>("[data-pref]")) {
      button(b, {
          mode: "tap",
        onPress: () => {
          const key = b.dataset.pref as "haptics" | "swap" | "fullscreen";
          const on = !prefs.get()[key];
          prefs.set({ [key]: on });
          b.classList.toggle("on", on);
          if (key === "fullscreen" && on) void enterFullscreen();
          if (key === "fullscreen" && !on && isFullscreen()) void document.exitFullscreen().catch(() => {});
        },
      });
    }
    sheetPanel.classList.toggle("has-foot", !!sheetPanel.querySelector(".sh-foot"));
    moreBelow();
    const x = sheetPanel.querySelector(".sh-x") as HTMLButtonElement | null;
    if (x) button(x, { mode: "tap", onPress: closeSheet });
  }

  // ---------------------------------------------------------------- pause screen
  function renderPaused() {
    const paused = !!state?.paused && (ctl.config?.game ?? "lobby") !== "lobby";
    pausedEl.hidden = !paused;
    if (!paused) return;
    // name who paused; if that player has left or their phone is gone (a closed tab keeps the seat for a while),
    // say only that the game is paused
    const by = state?.pausedBy ?? null;
    const pauser = by ? state?.players.find((p) => p.id === by) : undefined;
    const byName = pauser?.connected ? pauser.name : undefined;
    const line = by && ctl.me?.id === by ? "You paused the game." : byName ? `${esc(byName)} paused the game.` : "The game is paused.";
    pausedEl.innerHTML = `
      <div class="pz-title">${juicy("Paused", "candy")}</div>
      <p>${line}</p>
      ${isVip() ? `<button class="big pz-resume">▶ Resume</button>` : ""}`;
    const r = pausedEl.querySelector(".pz-resume") as HTMLButtonElement | null;
    if (r) button(r, { mode: "tap", onPress: () => sys({ $sys: "resume" }) });
  }

  // ---------------------------------------------------------------- leaving
  function leave() {
    closeSheet();
    ctl.leave();
    // the room lives on this phone: leaving ends it for everyone
    if (hosting) setTimeout(() => {
      forgetHostedRoom();
      location.replace(location.pathname);
    }, 200);
  }

  // ---------------------------------------------------------------- connection
  const refreshOverlay = () => {
    if (ctl.status === "connecting") return showOverlay("Joining…");
    if (ctl.status === "reconnecting") return showOverlay("Reconnecting…");
    if (ctl.status === "open" && !ctl.hostConnected) return showOverlay("Waiting for the host…");
    if (ctl.status === "open") return showOverlay(null);
  };

  ctl.on("status", refreshOverlay);
  ctl.on("host", refreshOverlay);
  ctl.on("ready", () => {
    refreshOverlay();
    renderBar();
  });
  ctl.on("game", (g) => void mount(g));
  ctl.on("message", (d) => {
    if (!isSys(d) || d.$sys !== "shell") return;
    state = d.state;
    renderBar();
    renderPaused();
    if (sheetKind === "host") renderSheet();
    for (const fn of shellListeners) fn(state);
  });
  ctl.on("closed", (reason) => {
    closed = true;
    inRoom = false;
    unmount?.();
    unmount = null;
    releaseWake();
    clearInterval(netTimer);
    window.removeEventListener("popstate", onPop);
    window.removeEventListener("beforeunload", onBeforeUnload);
    portraitQuery.removeEventListener("change", checkOrientation);
    session.set(ACTIVE_ROOM_KEY, null);
    showOverlay(null);
    closeSheet();
    pausedEl.hidden = true;
    rotateEl.hidden = true;
    bar.hidden = true;
    gameRoot.hidden = true;
    gameRoot.replaceChildren();
    form.hidden = false;
    errorEl.textContent = CLOSE_TEXT[reason] ?? "Disconnected.";
    // seat given up while away: the code and name are filled in, so joining again is one tap
    if (reason === "away-timeout" || reason === "away-timeout-locked") codeInput.value = room;
  });
}
