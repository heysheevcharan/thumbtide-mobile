// The phone gamepad, built from a game's .pad file: a stick on one side, candy buttons on the other, and a
// strip on top the game fills with its own info. How the stick and buttons feel lives in the .pad file, so
// every game gets the same solid controls and can tune them without touching code.
import { haptic, type Controller } from "@thumbtide/sdk";
import { button, joystick } from "@thumbtide/sdk/ui";
import { prefs } from "./prefs.ts";
import type { ButtonSpec, ChoicesSpec, PadSpec } from "./pad.ts";
import { CONTROL_ICONS } from "./icons.ts";
import "./kit.css";

export interface GamepadOptions {
  /** Sets how often stick updates are sent (from the pad's send-rate). */
  ctl?: Controller;
  onStick?: (v: { x: number; y: number; active: boolean }) => void;
  onPress?: (id: string) => void;
  onRelease?: (id: string) => void;
  /** An option was picked in one of the pad's choices lists. */
  onChoose?: (id: string, index: number) => void;
  /** HTML for the info strip above the controls. */
  top?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** One option in a choices list: its text, or text with a tone the game styles (`data-tone`) and a colour for its badge. */
export type ChoiceItem = string | { text: string; tone?: string; color?: string };
const itemText = (t: ChoiceItem) => (typeof t === "string" ? t : t.text);

export function gamepad(root: HTMLElement, pad: PadSpec, o: GamepadOptions = {}) {
  const el = document.createElement("div");
  el.className = `gp gp-b${pad.buttons.length}${pad.stick ? "" : " gp-nostick"}`;
  el.innerHTML = `
    <div class="gp-top">${o.top ?? ""}</div>
    ${pad.stick ? `<div class="gp-stick">${pad.stick.label ? `<span class="gp-stick-hint"><i></i>${esc(pad.stick.label)}</span>` : ""}</div>` : ""}
    <div class="gp-btns">${pad.buttons
      .map(
        (b) => `<button class="gp-btn ${b.style}${b.shape === "round" ? " round" : ""}" data-id="${esc(b.id)}">
          <span class="gp-ico">${b.icon ? CONTROL_ICONS[b.icon] : ""}</span><b>${esc(b.label)}</b></button>`,
      )
      .join("")}</div>
    ${pad.choices
      .map(
        (c) => `<div class="gp-choices gp-ch-${c.layout}" data-ch="${esc(c.id)}" hidden>
          ${c.label ? `<p class="gp-ch-head">${esc(c.label)}</p>` : ""}<i class="gp-ch-timer"></i><div class="gp-ch-opts"></div></div>`,
      )
      .join("")}`;
  root.appendChild(el);
  o.ctl?.setInputRate(pad.sendRate);

  const offs: Array<() => void> = [];
  // left-handed players get the buttons on the left
  const applyPrefs = () => el.classList.toggle("gp-swap", prefs.get().swap);
  applyPrefs();
  offs.push(prefs.onChange(applyPrefs));

  const zone = el.querySelector<HTMLElement>(".gp-stick");
  const s = pad.stick;
  if (zone && s && o.onStick) {
    offs.push(
      joystick(zone, {
        mode: s.mode, follow: s.follow, radius: s.travel, deadzone: s.deadzone, fullAt: s.fullAt, curve: s.curve,
        directions: s.directions, hapticTouch: s.haptic, hapticRim: s.rimHaptic,
        onMove: (v) => {
          if (v.active) el.classList.add("gp-touched"); // the label has done its job
          o.onStick!(v);
        },
      }),
    );
  }
  for (const b of el.querySelectorAll<HTMLElement>(".gp-btn")) {
    const spec = pad.buttons.find((x) => x.id === b.dataset.id)!;
    offs.push(wire(b, spec, o));
  }

  const lists = new Map(pad.choices.map((c) => [c.id, choicesList(el.querySelector<HTMLElement>(`.gp-choices[data-ch="${CSS.escape(c.id)}"]`)!, c, o)]));
  offs.push(() => lists.forEach((l) => l.clear()));

  return {
    el,
    top: el.querySelector(".gp-top") as HTMLElement,
    btn: (id: string) => el.querySelector<HTMLElement>(`.gp-btn[data-id="${CSS.escape(id)}"]`),
    /** Play one of the pad's named haptic patterns. */
    buzz(name: string) {
      const p = pad.buzz[name];
      if (p) haptic(p.length === 1 ? p[0]! : p);
    },
    /** Show a choices list with these options (it covers the other controls). `off` greys some out, `ms` runs a timer bar. */
    showChoices(id: string, items: ChoiceItem[], opts: { off?: number[]; picked?: number | null; ms?: number } = {}) {
      lists.get(id)?.show(items, opts);
    },
    hideChoices(id?: string) {
      for (const [k, l] of lists) if (!id || k === id) l.hide();
    },
    destroy() {
      offs.forEach((f) => f());
      el.remove();
    },
  };
}

/** A button that fires the way its pad says: on press, on release, or repeatedly while held. */
function wire(el: HTMLElement, b: ButtonSpec, o: GamepadOptions): () => void {
  if (b.fires === "release") {
    // fires when the finger lifts on the button; sliding off or an interruption cancels it
    return button(el, {
      mode: "tap",
      haptic: b.haptic,
      onPress: () => {
        o.onPress?.(b.id);
        o.onRelease?.(b.id);
      },
    });
  }
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const off = button(el, {
    haptic: b.haptic,
    onPress: () => {
      o.onPress?.(b.id);
      if (b.fires === "repeat") {
        stop();
        timer = setInterval(() => o.onPress?.(b.id), b.repeatMs);
      }
    },
    onRelease: () => {
      stop();
      o.onRelease?.(b.id);
    },
  });
  return () => {
    stop();
    off();
  };
}

/** One choices layer: rebuilt only when its options change, so states can be updated freely. */
function choicesList(layer: HTMLElement, c: ChoicesSpec, o: GamepadOptions) {
  const opts = layer.querySelector(".gp-ch-opts") as HTMLElement;
  const timer = layer.querySelector(".gp-ch-timer") as HTMLElement;
  let key = "";
  let armed = -1;
  let offs: Array<() => void> = [];
  const clear = () => {
    offs.forEach((f) => f());
    offs = [];
  };
  return {
    clear,
    show(items: ChoiceItem[], s: { off?: number[]; picked?: number | null; ms?: number }) {
      const k = items.map((t) => (typeof t === "string" ? t : `${t.text}|${t.tone ?? ""}|${t.color ?? ""}`)).join("\u0000");
      if (k !== key) {
        key = k;
        armed = -1;
        clear();
        opts.innerHTML = items
          .map((t, i) => {
            const tone = typeof t === "string" || !t.tone ? "" : ` data-tone="${esc(t.tone)}"`;
            const color = typeof t === "string" || !t.color ? "" : ` style="--k:${esc(t.color)}"`;
            return `<button class="gp-ch" data-i="${i}"${tone}><span class="gp-ch-k"${color}>${String.fromCharCode(65 + i)}</span><span class="gp-ch-t">${esc(itemText(t))}</span></button>`;
          })
          .join("");
        for (const b of opts.querySelectorAll<HTMLElement>(".gp-ch")) {
          const i = Number(b.dataset.i);
          offs.push(
            button(b, {
              haptic: c.haptic,
              onPress: () => {
                if (b.classList.contains("off") || layer.classList.contains("gp-ch-done")) return;
                if (c.confirm && armed !== i) {
                  armed = i;
                  opts.querySelectorAll(".gp-ch").forEach((x) => x.classList.toggle("armed", x === b));
                  return;
                }
                o.onChoose?.(c.id, i);
              },
            }),
          );
        }
        if (s.ms) {
          timer.style.setProperty("--ms", `${s.ms}ms`);
          timer.classList.remove("run");
          void timer.offsetWidth;
          timer.classList.add("run");
        }
      }
      opts.querySelectorAll<HTMLElement>(".gp-ch").forEach((b, i) => {
        b.classList.toggle("off", !!s.off?.includes(i));
        b.classList.toggle("picked", s.picked === i);
      });
      layer.classList.toggle("gp-ch-done", s.picked != null);
      timer.hidden = !s.ms;
      layer.hidden = false;
    },
    hide() {
      layer.hidden = true;
      key = "";
      clear();
    },
  };
}
