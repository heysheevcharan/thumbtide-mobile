// The phone, built the conventional way: your role card face down in the middle (hold it to turn it over), and a
// panel at the bottom that says what's happening and, when it's your move, lets you choose and then confirm.
// Mobile: the public table (law boards, unrest, what's happening, the seats) sits at the top of every phone.
import { haptic, type Controller } from "@thumbtide/sdk";
import { button } from "@thumbtide/sdk/ui";
import { inked } from "../kit/inked.ts";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import { statusLine } from "./view.ts";
import {
  POWER_ART, POWER_NAME, ROLE_ART, ROLE_NAME, ROLE_TONE, WIN_LINE, artVars,
  type ArtName, type CultGame, type CultOwn, type CultShared, type Law,
} from "./shared.ts";
import "./cult.css";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const GOAL = {
  town: "Pass town laws. Find the Prophet and burn them.",
  cult: "Pass cult laws. Get the Prophet elected Sheriff.",
  prophet: "Stay hidden. After three cult laws, get elected Sheriff.",
};

/** What the panel shows: `key` changes when it needs rebuilding; `tall` lets it take the whole screen (lists). */
interface Scene {
  key: string;
  html: string;
  tall?: boolean;
  /** A choice to make, confirmed with the panel's main button. */
  pick?: { kind: "seat" | "card"; options: number[]; label: (i: number) => string };
}

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<CultGame>;
  // haptics and button labels come from cult.pad
  const pad = gameById("cult")!.controls!;
  const buzz = (name: string) => {
    const p = pad.buzz[name];
    if (p) haptic(p.length === 1 ? p[0]! : p);
  };
  const label = (id: string, fallback: string) => pad.buttons.find((b) => b.id === id)?.label ?? fallback;
  const feel = (id: string) => pad.choices.find((c) => c.id === id)?.haptic ?? 14;

  const root = document.createElement("div");
  root.className = "cp";
  artVars(root);
  root.innerHTML = `
    <header class="cp-head"><span class="cp-dot"></span><span class="cp-name"></span><span class="cp-chip"></span></header>
    <section class="cp-table">
      <div class="cp-tracks">
        <div class="cp-track town"><span>Town</span><div class="cp-slots"></div></div>
        <div class="cp-track cult"><span>Cult</span><div class="cp-slots"></div></div>
      </div>
      <div class="cp-meta"><span class="cp-unrest">Unrest <i></i><i></i><i></i></span><span class="cp-deck"></span><span class="cp-tnote"></span></div>
      <p class="cp-status"></p>
      <ol class="cp-seats"></ol>
    </section>
    <div class="cp-banner" hidden></div>
    <section class="cp-stage">
      <div class="cp-card" aria-label="Hold to see your role">
        <div class="cp-card-in">
          <div class="cp-face cp-back"></div>
          <div class="cp-face cp-front"><i class="cp-front-art"></i><div class="cp-front-text"></div></div>
        </div>
      </div>
      <p class="cp-hint">Hold the card to see your role</p>
    </section>
    <section class="cp-panel" data-scroll></section>`;
  ctx.root.appendChild(root);
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const card = $(".cp-card");
  const panel = $(".cp-panel");

  const offs: Array<() => void> = [];
  let panelOffs: Array<() => void> = [];
  // hold to look; let go and it's face down again
  offs.push(
    button(card, {
      haptic: 12,
      onPress: () => card.classList.add("open"),
      onRelease: () => card.classList.remove("open"),
    }),
  );

  let scene: Scene | null = null;
  let selected: number | null = null;
  /** The panel we sent a move from: it stays settled until the TV moves on. */
  let sentKey = "";

  // ------------------------------------------------------------------ bits of the panel
  const nameOf = (s: CultShared, i: number | null) => (i === null || !s.seats[i] ? "" : s.seats[i]!.name);
  const who = (s: CultShared, i: number | null) =>
    i === null || !s.seats[i] ? "" : `<b class="cp-who" style="--c:${s.seats[i]!.color}">${esc(s.seats[i]!.name)}</b>`;
  const title = (h: string, p = "", icon?: ArtName) =>
    `<div class="cp-title">${icon ? `<i class="cp-ico" style="background-image:var(--art-${icon})"></i>` : ""}<div><h2>${h}</h2>${p ? `<p>${p}</p>` : ""}</div></div>`;
  const btn = (act: string, text: string, cls = "primary") => `<button class="cp-btn ${cls}" data-act="${act}" data-text="${esc(text)}">${esc(text)}</button>`;
  const actions = (...b: string[]) => `<div class="cp-actions">${b.join("")}</div>`;
  const tile = (s: CultShared, i: number | null, art: ArtName, role: string) =>
    i === null ? "" : `<div class="cp-tile"><i style="background-image:var(--art-${art})"></i><span>${who(s, i)}<small>${role}</small></span></div>`;
  const government = (s: CultShared) => `<div class="cp-gov">${tile(s, s.mayor, "badge-mayor", "Mayor")}${tile(s, s.sheriff, "badge-sheriff", "Sheriff")}</div>`;
  const lawName = (l: Law) => (l === "town" ? "Town law" : "Cult law");
  const laws = (hand: Law[], cls: string, pickable = true) =>
    `<div class="cp-laws ${cls}">${hand
      .map((l, i) => `<button class="cp-law ${l}" ${pickable ? `data-pick="${i}"` : "disabled"}><span>${lawName(l)}</span></button>`)
      .join("")}</div>`;
  const people = (s: CultShared, seats: number[]) =>
    `<div class="cp-list">${seats
      .map((j, k) => {
        const x = s.seats[j]!;
        return `<button class="cp-row" data-pick="${k}"><span class="cp-av" style="--c:${x.color}">${esc((x.name.trim()[0] ?? "?").toUpperCase())}</span><span class="cp-row-name">${esc(x.name)}</span><span class="cp-radio"></span></button>`;
      })
      .join("")}</div>`;

  // ------------------------------------------------------------------ what the panel says, phase by phase
  function sceneFor(s: CultShared, o: CultOwn): Scene {
    const me = o.seat;
    const at = (...more: unknown[]) => [s.phase, s.mayor, s.sheriff, s.target, s.town, s.cult, ...more].join(":");
    const M = who(s, s.mayor);
    const S = who(s, s.sheriff);
    if (!s.seats[me]?.alive && s.phase !== "end") return { key: "burned", html: title("You've been burned", "No talking from here on. Watch the town decide.") };

    switch (s.phase) {
      case "roles":
        return { key: at(), html: title("Your role is dealt", "Hold the card to look. Keep it to yourself.") + actions(btn("ready", "I'm ready")) };

      case "nominate":
        if (me !== s.mayor) return { key: at(), html: title(`${M} is Mayor`, "They're choosing a Sheriff.") };
        return {
          key: at(s.eligible.join()),
          tall: true,
          html: title("Choose your Sheriff", "Then everyone votes on the two of you.", "badge-sheriff") + people(s, s.eligible) + actions(btn("confirm", "Choose someone")),
          pick: { kind: "seat", options: s.eligible, label: (k) => `Nominate ${nameOf(s, s.eligible[k]!)}` },
        };

      case "vote":
        return {
          key: at(),
          html:
            title("Vote", "Should these two run the town?") +
            government(s) +
            `<div class="cp-vote">${btn("yes", label("yes", "Yes"), "yes")}${btn("no", label("no", "No"), "no")}</div>` +
            `<p class="cp-note">You can change your vote until everyone's in.</p>`,
        };

      case "tally":
        return { key: at(), html: title(s.passed ? "Elected" : "Rejected", s.passed ? "They take office." : "The town grows restless.") + government(s) };

      case "mayor":
        if (me !== s.mayor || !o.hand) return { key: at(), html: title(`${M} is choosing`, `They throw one law away and pass two to ${S}.`) };
        return {
          key: at(o.hand.join()),
          html: title("Discard one law", `The other two go to ${S}.`) + laws(o.hand, "discard") + actions(btn("confirm", "Pick one to discard")),
          pick: { kind: "card", options: o.hand.map((_, i) => i), label: (i) => `Discard the ${lawName(o.hand![i]!).toLowerCase()}` },
        };

      case "sheriff":
        if (me !== s.sheriff || !o.hand) return { key: at(), html: title(`${S} is choosing`, "They enact one of two laws.") };
        return {
          key: at(o.hand.join(), o.canVeto),
          html:
            title("Enact one law", "The other one is discarded.") +
            laws(o.hand, "enact") +
            actions(btn("confirm", "Pick one to enact"), o.canVeto ? btn("veto", "Ask to veto both", "ghost") : ""),
          pick: { kind: "card", options: o.hand.map((_, i) => i), label: (i) => `Enact the ${lawName(o.hand![i]!).toLowerCase()}` },
        };

      case "veto":
        if (me !== s.mayor) return { key: at(), html: title("Veto requested", `${S} wants to throw both laws away. ${M} decides.`) };
        return { key: at(), html: title("Veto both laws?", `${S} asked. If you refuse, they have to enact one.`) + actions(btn("agree", "Agree to veto"), btn("refuse", "Refuse", "ghost")) };

      case "enacted":
        return {
          key: at(),
          html: s.riot
            ? title("Riot!", `Three failed votes. A ${s.law} law was forced through.`)
            : title(s.law === "town" ? "A town law passed" : "A cult law passed", ""),
        };

      case "power":
        return powerScene(s, o, at, M);

      case "end":
        return endScene(s, o);
    }
    return { key: at(), html: "" };
  }

  function powerScene(s: CultShared, o: CultOwn, at: (...m: unknown[]) => string, M: string): Scene {
    const power = s.power!;
    const T = who(s, s.target);
    if (o.seat !== s.mayor) {
      const doing = {
        investigate: s.target === null ? ["Investigation", `${M} is looking into someone.`] : ["Investigation", `${M} looked into ${T}.`],
        peek: ["Peek", `${M} is looking at the next three laws.`],
        pick: s.target === null ? ["Next Mayor", `${M} is choosing the next Mayor.`] : ["Next Mayor", `${T} will be Mayor.`],
        burn: s.target === null ? ["A burning", `${M} is choosing who to burn.`] : ["A burning", `${T} burns.`],
      }[power];
      return { key: at(), html: title(doing[0]!, doing[1]!, POWER_ART[power]) };
    }
    if (power === "peek") {
      return {
        key: at((o.peek ?? []).join()),
        html: title("The next three laws", "Top of the deck first. Share it, or don't.", POWER_ART.peek) + laws(o.peek ?? [], "peek", false) + actions(btn("done", "Done")),
      };
    }
    if (power === "investigate" && s.target !== null) {
      const f = o.found.find((x) => x.seat === s.target);
      return {
        key: at(f?.party),
        html:
          title(`${T} is…`, "Only you know this.", POWER_ART.investigate) +
          (f ? `<div class="cp-verdict"><i style="background-image:var(--art-${f.party === "town" ? "role-town" : "role-cult"})"></i>${inked(f.party === "town" ? "Town" : "Cult", f.party)}</div>` : "") +
          actions(btn("done", "Done")),
      };
    }
    if (s.target !== null) return { key: at(), html: title(power === "burn" ? `${T} burns` : `${T} will be Mayor`, "", POWER_ART[power]) };
    const ask = {
      investigate: ["Investigate someone", "You'll see their party. Nobody else will.", (n: string) => `Investigate ${n}`],
      pick: ["Choose the next Mayor", "After them, the order carries on from you.", (n: string) => `Make ${n} Mayor`],
      burn: ["Burn someone", "If it's the Prophet, the town wins.", (n: string) => `Burn ${n}`],
    }[power as "investigate" | "pick" | "burn"];
    return {
      key: at(s.targets.join()),
      tall: true,
      html: title(ask[0] as string, ask[1] as string, POWER_ART[power]) + people(s, s.targets) + actions(btn("confirm", "Choose someone", power === "burn" ? "primary danger" : "primary")),
      pick: { kind: "seat", options: s.targets, label: (k) => (ask[2] as (n: string) => string)(nameOf(s, s.targets[k]!)) },
    };
  }

  function endScene(s: CultShared, o: CultOwn): Scene {
    if (!s.winner || !s.reason || !s.roles) return { key: "end", html: "" };
    const won = (o.role === "town") === (s.winner === "town");
    const vip = ctx.isVip();
    const sh = ctx.shell();
    const decider = sh?.players.find((p) => p.id === sh.vip)?.name;
    return {
      key: `end:${s.winner}:${vip}:${decider}`,
      tall: true,
      html: `<div class="cp-end">
        <i class="cp-end-art" style="background-image:var(--art-${s.winner === "town" ? "win-town" : "win-cult"})"></i>
        <h2>${inked(won ? "You win" : "You lose", won ? (s.winner === "town" ? "town" : "cult") : "bone")}</h2>
        <p>${s.winner === "town" ? "The town wins" : "The cult wins"}. ${esc(WIN_LINE[s.reason][s.winner])}.</p>
        <ul class="cp-roles">${s.seats
          .map((x, j) => `<li><span class="cp-av" style="--c:${x.color}">${esc((x.name.trim()[0] ?? "?").toUpperCase())}</span>${esc(x.name)}<em class="r-${s.roles![j]}">${ROLE_NAME[s.roles![j]!]}</em></li>`)
          .join("")}</ul>
      </div>${
        vip
          ? actions(btn("again", "Play again"), btn("lobby", "Back to lobby", "ghost"))
          : `<p class="cp-note"><b>${esc(decider ?? "The host")}</b> picks what's next.</p>`
      }`,
    };
  }

  // ------------------------------------------------------------------ doing things
  function act(name: string) {
    const s = ctl.shared;
    switch (name) {
      case "ready":
        ctl.send({ type: "ready" });
        break;
      case "yes":
      case "no":
        if (s?.phase === "vote") ctl.send({ type: "vote", yes: name === "yes" });
        return; // votes can change until everyone's in
      case "agree":
      case "refuse":
        ctl.send({ type: "veto-answer", yes: name === "agree" });
        break;
      case "veto":
        ctl.send({ type: "veto" });
        break;
      case "confirm": {
        if (!scene?.pick || selected === null) return;
        const v = scene.pick.options[selected]!;
        ctl.send(scene.pick.kind === "seat" ? { type: "pick", seat: v } : { type: "card", i: v });
        break;
      }
      case "done":
        ctl.send({ type: "done" });
        break;
      case "again":
        ctl.send({ type: "again" });
        break;
      case "lobby":
        ctx.exitToLobby();
        return;
    }
    sentKey = scene?.key ?? "";
    // a move the TV never got (lost on a reconnect, or refused) must not leave the panel settled for good: if
    // the TV hasn't moved on after a while, the buttons work again (the rules ignore a repeat)
    const k = sentKey;
    clearTimeout(sentTimer);
    sentTimer = setTimeout(() => {
      if (sentKey === k && scene?.key === k) {
        sentKey = "";
        refresh();
      }
    }, 5000);
    refresh();
  }
  let sentTimer: ReturnType<typeof setTimeout> | undefined;

  function wire() {
    panelOffs.forEach((f) => f());
    panelOffs = [];
    for (const el of panel.querySelectorAll<HTMLElement>("[data-pick]")) {
      panelOffs.push(
        button(el, {
          mode: "tap",
          haptic: feel(scene?.pick?.kind === "card" ? "cards" : "pick"),
          onPress: () => {
            if (sentKey === scene?.key) return;
            selected = Number(el.dataset.pick);
            refresh();
          },
        }),
      );
    }
    for (const el of panel.querySelectorAll<HTMLElement>("[data-act]")) {
      const a = el.dataset.act!;
      const spec = pad.buttons.find((b) => b.id === a);
      panelOffs.push(button(el, { mode: "tap", haptic: spec?.haptic ?? 12, onPress: () => !(el as HTMLButtonElement).disabled && act(a) }));
    }
  }

  /** Updates the panel in place: what's selected, what's been sent, how you voted. */
  function refresh() {
    const o = ctl.own;
    const sent = !!scene && sentKey === scene.key;
    panel.querySelectorAll<HTMLElement>("[data-pick]").forEach((el) => el.classList.toggle("on", Number(el.dataset.pick) === selected));
    panel.classList.toggle("picking", selected !== null);
    for (const b of panel.querySelectorAll<HTMLButtonElement>("[data-act]")) {
      const a = b.dataset.act!;
      if (a === "yes" || a === "no") {
        const mine = o?.vote === (a === "yes");
        b.classList.toggle("on", o?.vote != null && mine);
        b.classList.toggle("dim", o?.vote != null && !mine);
        continue;
      }
      if (a === "confirm") {
        b.disabled = selected === null || sent;
        b.textContent = sent ? "Sent" : selected !== null && scene?.pick ? scene.pick.label(selected) : b.dataset.text!;
      } else if (a === "ready" && o?.ready) {
        b.disabled = true;
        b.textContent = "Waiting for the others…";
      } else if (a !== "lobby" && a !== "again") {
        b.disabled = sent;
      }
    }
  }

  // ------------------------------------------------------------------ the public table
  const tableKeys: Record<string, string> = {};
  const setHtml = (sel: string, html: string) => {
    if (tableKeys[sel] === html) return;
    tableKeys[sel] = html;
    $(sel).innerHTML = html;
  };
  function drawTable(s: CultShared) {
    const playing = s.phase !== "roles" && s.phase !== "end";
    setHtml(".cp-track.town .cp-slots", Array.from({ length: 5 }, (_, i) => `<i class="${i < s.town ? "on" : ""}${i === 4 ? " goal" : ""}"></i>`).join(""));
    setHtml(
      ".cp-track.cult .cp-slots",
      Array.from({ length: 6 }, (_, i) => {
        const p = s.powers[i];
        const ico = i >= s.cult && p ? `<b style="background-image:var(--art-${POWER_ART[p]})" title="${POWER_NAME[p]}"></b>` : "";
        return `<i class="${i < s.cult ? "on" : ""}${i === 5 ? " goal" : ""}">${ico}</i>`;
      }).join(""),
    );
    root.querySelectorAll(".cp-unrest i").forEach((d, i) => d.classList.toggle("on", i < s.unrest));
    $(".cp-deck").textContent = `Deck ${s.deck}`;
    const notes = [s.cult >= 3 && playing ? "Prophet as Sheriff wins it for the cult" : "", s.vetoOpen ? "Veto is open" : ""].filter(Boolean).join(" · ");
    $(".cp-tnote").textContent = notes;
    const line =
      s.phase === "roles"
        ? `Check your role. ${s.ready.filter((i) => !s.seats[i]!.bot).length}/${s.seats.filter((x) => !x.bot).length} ready`
        : s.phase === "end"
          ? s.winner === "town" ? "The town wins!" : "The cult wins!"
          : statusLine(s).replace(/cf-who/g, "cp-who").replace(/cf-count/g, "cp-count");
    setHtml(".cp-status", line);
    setHtml(
      ".cp-seats",
      s.seats
        .map((x, i) => {
          const badge = playing && i === s.mayor ? `<em class="mayor">Mayor</em>` : playing && i === s.sheriff ? `<em class="sheriff">Sheriff</em>` : "";
          const v = s.votes?.[i];
          const stamp =
            s.phase === "tally" && v != null ? `<em class="${v ? "yes" : "no"}">${v ? "Yes" : "No"}</em>`
            : (s.phase === "vote" && s.voted.includes(i)) || (s.phase === "roles" && s.ready.includes(i)) ? `<em class="done">✓</em>`
            : s.roles ? `<em class="r-${s.roles[i]}">${ROLE_NAME[s.roles[i]!]}</em>`
            : x.away ? `<em>away</em>`
            : x.bot ? `<em>bot</em>` : "";
          const cls = [!x.alive ? "dead" : "", x.away ? "away" : "", s.phase === "power" && s.target === i ? "target" : "", i === ctl.own?.seat ? "me" : ""].join(" ");
          return `<li class="${cls}" style="--c:${x.color}"><span class="cp-av">${esc((x.name.trim()[0] ?? "?").toUpperCase())}</span><span class="cp-sn">${esc(x.name)}</span>${badge}${stamp}</li>`;
        })
        .join(""),
    );
  }

  const bannerEl = $(".cp-banner");
  let bannerTimer: ReturnType<typeof setTimeout> | undefined;
  function banner(m: Extract<CultGame["toController"], { type: "banner" }>) {
    bannerEl.innerHTML = `${m.art ? `<i style="background-image:var(--art-${m.art})"></i>` : ""}<div>${inked(m.text, m.tone)}${m.sub ? `<small>${m.sub}</small>` : ""}</div>`;
    bannerEl.hidden = false;
    bannerEl.classList.remove("show");
    void bannerEl.offsetWidth;
    bannerEl.classList.add("show");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => (bannerEl.hidden = true), Math.max(900, Math.min(2600, m.ms)));
  }
  bannerEl.addEventListener("pointerdown", () => (bannerEl.hidden = true));

  // ------------------------------------------------------------------ drawing
  function render() {
    const s = ctl.shared;
    const o = ctl.own;
    const me = ctl.me;
    if (s) drawTable(s);
    $(".cp-name").textContent = me?.name ?? "";

    let next: Scene;
    if (!s) next = { key: "wait", html: title("Setting the table…") };
    else if (!o) {
      next = me && s.watching.includes(me.id)
        ? { key: "watch", html: title("You're watching", "You'll be dealt in next game.") }
        : { key: "wait", html: title("Dealing you in…") };
    } else next = sceneFor(s, o);

    root.classList.toggle("has-role", !!o);
    if (o && s) {
      root.style.setProperty("--c", o.color);
      const alive = s.seats[o.seat]?.alive ?? true;
      const playing = s.phase !== "roles" && s.phase !== "end";
      const chip = $(".cp-chip");
      chip.textContent = !alive ? "Burned" : playing && o.seat === s.mayor ? "Mayor" : playing && o.seat === s.sheriff ? "Sheriff" : "";
      chip.dataset.kind = !alive ? "dead" : o.seat === s.mayor ? "mayor" : "sheriff";
      root.classList.toggle("burned", !alive);
      drawCard(s, o);
    }

    if (next.key !== scene?.key) {
      const fresh = !scene || next.html !== scene.html;
      scene = next;
      selected = null;
      // a new panel was never sent from, even when its key matches an older one (a refused veto brings the
      // Sheriff's same hand back)
      sentKey = "";
      root.classList.toggle("tall", !!next.tall);
      if (fresh) {
        panel.innerHTML = next.html;
        panel.classList.remove("swap");
        void panel.offsetWidth;
        panel.classList.add("swap");
        wire();
      }
    }
    refresh();
  }

  let cardKey = "";
  function drawCard(s: CultShared, o: CultOwn) {
    const key = `${o.role}:${o.allies.map((a) => a.seat).join()}:${o.found.map((f) => `${f.seat}${f.party}`).join()}`;
    if (key === cardKey) return;
    cardKey = key;
    $<HTMLElement>(".cp-front-art").style.backgroundImage = `var(--art-${ROLE_ART[o.role]})`;
    const allies = o.allies.length
      ? `<p class="cp-allies">${o.allies.map((a) => `${who(s, a.seat)}${a.role === "prophet" ? " · Prophet" : ""}`).join("<br>")}</p>`
      : o.role === "prophet"
        ? `<p class="cp-allies">Your cult knows you. You don't know them.</p>`
        : "";
    const found = o.found.length ? `<p class="cp-allies">${o.found.map((f) => `${who(s, f.seat)} is ${f.party === "town" ? "Town" : "Cult"}`).join("<br>")}</p>` : "";
    $(".cp-front-text").innerHTML = `<small>You are</small><h3>${inked(ROLE_NAME[o.role], ROLE_TONE[o.role])}</h3><p>${GOAL[o.role]}</p>${allies}${found}`;
  }

  offs.push(
    ctl.on("state", render),
    ctx.onVip(() => {
      scene = null;
      render();
    }),
    ctl.on("message", (d) => {
      if (d && typeof d === "object" && d.type === "buzz") buzz(d.kind);
      else if (d && typeof d === "object" && d.type === "banner") banner(d);
    }),
  );
  render();

  return () => {
    clearTimeout(sentTimer);
    clearTimeout(bannerTimer);
    offs.forEach((f) => f());
    panelOffs.forEach((f) => f());
    root.remove();
  };
};

export default mount;
