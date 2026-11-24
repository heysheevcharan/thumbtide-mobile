// The game's controls as a short list (icon, name, a few words), for the phone's help sheet.
// Deliberately brief: the controls are labelled, and people learn by playing.
import type { GameDef } from "../types.ts";
import { CONTROL_ICONS, STICK_ICON } from "./icons.ts";
import "./kit.css";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function controlsHtml(def: GameDef): string {
  const c = def.controls;
  if (!c) return "";
  const [a, b] = def.colors ?? ["#7c5cff", "#2de2c9"];
  const rows = [
    c.stick ? `<li><span class="ct-ico">${STICK_ICON}</span><b>${esc(c.stick.label || "Stick")}</b></li>` : "",
    ...c.buttons.map(
      (btn) =>
        `<li><span class="ct-ico ${btn.style}">${btn.icon ? CONTROL_ICONS[btn.icon] : ""}</span><b>${esc(btn.label)}</b>${btn.hint ? `<span>${esc(btn.hint)}</span>` : ""}</li>`,
    ),
  ].join("");
  return `<ul class="ct" style="--ga:${a};--gb:${b}">${rows}</ul>`;
}
