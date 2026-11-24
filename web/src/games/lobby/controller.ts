// The phone in the lobby. The VIP taps a game in a grid of cards (every tap goes to the TV at once; the TV shows
// that game until Play), sees its settings, and presses Play. Everyone else sees who is picking and what.
import { button } from "@thumbtide/sdk/ui";
import { qrSvg } from "@thumbtide/sdk/qr";
import { joinDisplay, joinUrl } from "../../config.ts";
import { settingsHtml, syncSettings, wireSettings } from "../../shell/settings-ui.ts";
import { gameById, pickableGames } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import { coverHtml, esc, gameColors, playersText } from "./library.ts";
import type { LobbyOwn } from "./shared.ts";
import "./lobby.css";

const mount: ControllerMount = (ctx) => {
  const { ctl, root, isVip, startGame } = ctx;
  const games = pickableGames();
  root.innerHTML = `<div class="lp" data-scroll></div>`;
  const el = root.firstElementChild as HTMLElement;
  let cleanups: Array<() => void> = [];
  let lastKey = "";
  let sel = games[0]!.id; // the game shown (the VIP's own taps lead; the TV's word follows)
  let shownSel = "";
  let pendingUntil = 0; // after a tap, ignore older confirmations from the TV for a moment
  // friends join from their own phones: the code, a QR to scan off this screen, and a link to send
  const INVITE = `<section class="lp-invite"><div class="lp-qr" aria-label="QR code to join"></div><div class="lp-inv-text">
      <small>Invite friends</small><b class="lp-code">${esc(ctl.room)}</b><span>${esc(joinDisplay())}</span>
      <button class="lp-share">Share invite link</button></div></section>`;

  const serverSel = () => {
    const id = ctx.shell()?.selected;
    return id && gameById(id) ? id : games[0]!.id;
  };

  function render(force = false) {
    const own = ctl.own as LobbyOwn | null;
    const me = ctl.me;
    const s = ctx.shell();
    if (!me) return;
    const vip = isVip();
    const players = s?.players.filter((p) => p.connected).length ?? 1;
    if (!vip || performance.now() >= pendingUntil || serverSel() === sel) sel = serverSel();
    const vipName = s?.players.find((p) => p.id === s.vip)?.name;
    // Rebuild only when the page itself changes; a selection updates in place, so a tap in progress, the
    // scroll position and the settings' state survive.
    const key = JSON.stringify([own?.color, me.name, vip, vip ? null : sel, vip ? null : vipName]);
    if (key === lastKey && !force) {
      wireInvite();
      patch(players);
      return;
    }
    lastKey = key;
    cleanups.forEach((c) => c());
    cleanups = [];
    el.style.setProperty("--c", own?.color ?? "#7c5cff");
    el.className = "lp";
    shownSel = "";

    if (vip) {
      el.classList.add("lp-vip");
      el.innerHTML = `
        ${INVITE}
        <header class="lp-head"><h1>Pick a game</h1><span class="lp-count"></span></header>
        <ul class="lp-grid">${games
          .map((g) => `<li><button class="lp-gc" data-id="${esc(g.id)}" style="--ga:${gameColors(g)[0]}">${coverHtml(g, { title: false })}<b>${esc(g.title)}</b><small>${playersText(g)}</small></button></li>`)
          .join("")}</ul>
        <section class="lp-settings"><h2 class="lp-sh">Settings</h2><div class="lp-st"></div></section>
        <section class="lp-players"><h2>Players</h2><ul class="lp-pl"></ul></section>
        <div class="lp-go"><button class="lp-start"></button></div>`;
      const grid = el.querySelector(".lp-grid") as HTMLElement;
      const onGrid = (e: Event) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>(".lp-gc");
        if (b?.dataset.id) pick(b.dataset.id);
      };
      grid.addEventListener("click", onGrid);
      cleanups.push(() => grid.removeEventListener("click", onGrid));
      const start = el.querySelector(".lp-start") as HTMLButtonElement;
      cleanups.push(button(start, { mode: "tap", haptic: 25, onPress: () => !start.disabled && startGame(sel) }));
      wireInvite();
      patch(players);
      return;
    }

    // everyone else: you, and what the host is picking
    const g = gameById(sel)!;
    el.classList.add("lp-guest");
    el.style.setProperty("--ga", gameColors(g)[0]);
    el.style.setProperty("--gb", gameColors(g)[1]);
    el.innerHTML = `
      <div class="lp-me">
        <span class="lp-av">${esc((me.name.trim()[0] ?? "?").toUpperCase())}</span>
        <h1>${esc(me.name)}</h1>
        <p>You're in</p>
      </div>
      ${INVITE}
      <div class="lp-next">
        <p class="lp-label">${vipName ? `<b>${esc(vipName)}</b> is picking` : "Waiting for the host"}</p>
        ${coverHtml(g, { title: false })}
        <div class="lp-title"><h2>${esc(g.title)}</h2><span>${playersText(g)}</span></div>
      </div>`;
    wireInvite();
  }

  function wireInvite() {
    const code = ctl.room;
    const url = joinUrl(code);
    const qr = el.querySelector(".lp-qr") as HTMLElement | null;
    if (qr) void qrSvg(url, { margin: 1 }).then((svg) => (qr.innerHTML = svg));
    const share = el.querySelector(".lp-share") as HTMLButtonElement | null;
    if (!share) return;
    cleanups.push(
      button(share, {
        mode: "tap",
        haptic: 12,
        onPress: async () => {
          const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
          try {
            if (nav.share) await nav.share({ title: "Thumbtide", text: `Join my Thumbtide room: ${code}`, url });
            else {
              await navigator.clipboard.writeText(url);
              share.textContent = "Link copied";
              setTimeout(() => (share.textContent = "Share invite link"), 1800);
            }
          } catch {
            /* the share sheet was closed */
          }
        },
      }),
    );
  }

  /** A tap on a card: show it here at once and tell the TV straight away (no debounce). */
  function pick(id: string) {
    if (id === sel || !gameById(id)) return;
    sel = id;
    pendingUntil = performance.now() + 600;
    ctx.sys({ $sys: "select", game: sel });
    patch(ctx.shell()?.players.filter((p) => p.connected).length ?? 1);
  }

  /** In-place updates: the selected game, player count, the Play button, settings confirmed by the TV. */
  function patch(players: number) {
    const count = el.querySelector(".lp-count");
    if (count) count.textContent = `${players} ${players === 1 ? "player" : "players"}`;
    if (!el.classList.contains("lp-vip")) return;
    const g = gameById(sel)!;
    const s = ctx.shell();
    if (shownSel !== g.id) {
      shownSel = g.id;
      el.style.setProperty("--ga", gameColors(g)[0]);
      el.style.setProperty("--gb", gameColors(g)[1]);
      el.querySelector(".lp-sh")!.textContent = `${g.title} settings`;
      const st = el.querySelector(".lp-settings") as HTMLElement;
      st.hidden = !g.settings?.length;
      // the TV's settings for this game arrive with its confirmation; until then show the defaults
      const mine = s?.selected === g.id ? s.settings : {};
      el.querySelector(".lp-st")!.innerHTML = g.settings?.length ? settingsHtml(g, mine) : "";
      if (g.settings?.length) wireSettings(el, g, (k, v) => ctx.sys({ $sys: "setting", game: g.id, key: k, value: v }));
    } else if (s?.selected === g.id) {
      syncSettings(el, g, s.settings ?? {});
    }
    // who's in (the host menu up top has Remove); a short list, so it's rebuilt each time
    const list = el.querySelector(".lp-pl");
    const all = s?.players ?? [];
    if (list) {
      list.innerHTML = all
        .map((p) => {
          const here = p.connected && !p.away;
          return `<li class="${here ? "" : "away"}">${esc(p.name)}${p.id === ctl.me?.id ? " <small>(you)</small>" : here ? "" : " <small>(away)</small>"}</li>`;
        })
        .join("");
    }
    for (const b of el.querySelectorAll<HTMLElement>(".lp-gc")) {
      const on = b.dataset.id === g.id;
      b.classList.toggle("sel", on);
      b.setAttribute("aria-pressed", String(on));
      b.classList.toggle("locked", players < (gameById(b.dataset.id!)?.minPlayers ?? 1));
    }
    const start = el.querySelector(".lp-start") as HTMLButtonElement | null;
    if (start) {
      const enough = players >= g.minPlayers;
      start.disabled = !enough;
      start.textContent = enough ? `Play ${g.title}` : `Needs ${g.minPlayers} players`;
    }
  }

  const offs = [ctl.on("state", () => render()), ctl.on("ready", () => render()), ctx.onShell(() => render())];
  render(true);
  return () => {
    offs.forEach((o) => o());
    cleanups.forEach((c) => c());
  };
};

export default mount;
