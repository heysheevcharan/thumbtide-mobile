// A game's settings, laid out to fit a phone held upright. Used by the host menu (mid-game) and the lobby's
// game page. Each setting picks the control that fits its options:
//   switch  On/Off (true/false) settings: one row, the whole row is the switch
//   seg     a few short options: one segmented row
//   grid    many short options (numbers): an even grid, two rows at most
//   chips   a few long options: two to a row on a phone, more when there's room; labels wrap, never clip
//   pick    many long options (arenas): one row with the current value that opens the list in place
// Settings marked `advanced` fold away under "More settings".
import { button } from "@thumbtide/sdk/ui";
import type { GameDef, SettingDef, SettingValue, Settings } from "../games/types.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const valueOf = (def: GameDef, key: string, current: Settings) => current[key] ?? def.settings?.find((d) => d.key === key)?.default;
const shown = (def: GameDef, s: SettingDef, current: Settings) => !s.when || valueOf(def, s.when.key, current) === s.when.value;

type Kind = "switch" | "seg" | "grid" | "chips" | "pick";

function kindOf(s: SettingDef): Kind {
  const n = s.options.length;
  if (n === 2 && s.options.some((o) => o.value === true) && s.options.some((o) => o.value === false)) return "switch";
  const longest = Math.max(...s.options.map((o) => o.label.length));
  if (n <= 5 && longest * n <= 32) return "seg";
  if (longest <= 8) return n <= 10 ? "grid" : "pick";
  return n <= 6 ? "chips" : "pick";
}

/** What's unfolded (More settings, an open list). Kept here so the host menu's re-renders don't fold it back up. */
const unfolded = new Set<string>();
const moreId = (def: GameDef) => `${def.id}:more`;
const pickId = (def: GameDef, key: string) => `${def.id}:pick:${key}`;

const chevron = `<svg class="st-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function rowHtml(def: GameDef, s: SettingDef, current: Settings): string {
  const kind = kindOf(s);
  const value = valueOf(def, s.key, current);
  const hide = shown(def, s, current) ? "" : "hidden";
  const when = s.applies === "now" ? "" : `<small>next round</small>`;
  const label = `<span class="st-label">${esc(s.label)}${when}</span>`;
  if (kind === "switch") {
    return `<button class="st-row st-tog" data-row="${esc(s.key)}" data-key="${esc(s.key)}" role="switch" aria-checked="${value === true}" ${hide}>
      ${label}<i class="sh-switch ${value === true ? "on" : ""}"></i></button>`;
  }
  const pills = s.options
    .map((o, i) => `<button class="st-pill ${value === o.value ? "on" : ""}" data-i="${i}">${esc(o.label)}</button>`)
    .join("");
  if (kind === "pick") {
    const open = unfolded.has(pickId(def, s.key));
    const cur = s.options.find((o) => o.value === value)?.label ?? "";
    return `<div class="st-row st-pick" data-row="${esc(s.key)}" ${hide}>
      <button class="st-open" aria-expanded="${open}">${label}<span class="st-cur">${esc(cur)}</span>${chevron}</button>
      <div class="st-pills st-chips" data-key="${esc(s.key)}" ${open ? "" : "hidden"}>${pills}</div></div>`;
  }
  const cols = kind === "grid" ? ` style="--cols:${Math.min(5, Math.ceil(s.options.length / 2))}"` : "";
  return `<div class="st-row" data-row="${esc(s.key)}" ${hide}>${label}
    <div class="st-pills st-${kind}" data-key="${esc(s.key)}"${cols}>${pills}</div></div>`;
}

export function settingsHtml(def: GameDef, current: Settings): string {
  const all = def.settings ?? [];
  const main = all.filter((s) => !s.advanced);
  const extra = all.filter((s) => s.advanced);
  const open = unfolded.has(moreId(def));
  const more = extra.length
    ? `<button class="st-more" aria-expanded="${open}"><span>More settings<small>${extra.length}</small></span>${chevron}</button>
       <div class="st-adv" ${open ? "" : "hidden"}>${extra.map((s) => rowHtml(def, s, current)).join("")}</div>`
    : "";
  return `<div class="st">${main.map((s) => rowHtml(def, s, current)).join("")}${more}</div>`;
}

/** Bring rendered rows up to date: which option is on, and which rows show. */
export function syncSettings(root: HTMLElement, def: GameDef, current: Settings) {
  for (const s of def.settings ?? []) {
    const row = root.querySelector<HTMLElement>(`[data-row="${s.key}"]`);
    if (!row) continue;
    row.hidden = !shown(def, s, current);
    const value = valueOf(def, s.key, current);
    const sw = row.querySelector(".sh-switch");
    if (sw) {
      sw.classList.toggle("on", value === true);
      row.setAttribute("aria-checked", String(value === true));
      continue;
    }
    row.querySelectorAll<HTMLElement>(".st-pill").forEach((p, i) => p.classList.toggle("on", s.options[i]?.value === value));
    const cur = row.querySelector(".st-cur");
    if (cur) cur.textContent = s.options.find((o) => o.value === value)?.label ?? "";
  }
}

/** The values the controls show right now. */
function picked(root: HTMLElement, def: GameDef): Settings {
  const out: Settings = {};
  for (const s of def.settings ?? []) {
    const sw = root.querySelector(`[data-row="${s.key}"] .sh-switch`);
    if (sw) {
      out[s.key] = sw.classList.contains("on");
      continue;
    }
    const i = [...root.querySelectorAll(`.st-pills[data-key="${s.key}"] .st-pill`)].findIndex((p) => p.classList.contains("on"));
    if (i >= 0) out[s.key] = s.options[i]!.value;
  }
  return out;
}

function fold(btn: HTMLElement, body: HTMLElement, id: string, open: boolean) {
  body.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  if (open) unfolded.add(id);
  else unfolded.delete(id);
}

export function wireSettings(root: HTMLElement, def: GameDef, onChange: (key: string, value: SettingValue) => void) {
  // show a change straight away; the TV's confirmation re-renders with the same result
  const set = (s: SettingDef, value: SettingValue) => {
    const now = picked(root, def);
    now[s.key] = value;
    syncSettings(root, def, now);
    onChange(s.key, value);
  };

  for (const row of root.querySelectorAll<HTMLElement>(".st-pills")) {
    const s = def.settings?.find((d) => d.key === row.dataset.key);
    if (!s) continue;
    const pick = row.closest(".st-pick");
    for (const pill of row.querySelectorAll<HTMLButtonElement>(".st-pill")) {
      button(pill, {
        mode: "tap",
        haptic: 8,
        onPress: () => {
          const opt = s.options[Number(pill.dataset.i)];
          if (!opt) return;
          set(s, opt.value);
          if (pick) fold(pick.querySelector(".st-open") as HTMLElement, row, pickId(def, s.key), false);
        },
      });
    }
    if (pick) {
      const open = pick.querySelector(".st-open") as HTMLElement;
      button(open, { mode: "tap", haptic: 8, onPress: () => fold(open, row, pickId(def, s.key), row.hidden) });
    }
  }

  for (const row of root.querySelectorAll<HTMLElement>(".st-tog")) {
    const s = def.settings?.find((d) => d.key === row.dataset.key);
    if (!s) continue;
    button(row, { mode: "tap", haptic: 8, onPress: () => set(s, !row.querySelector(".sh-switch")!.classList.contains("on")) });
  }

  const more = root.querySelector<HTMLElement>(".st-more");
  const adv = root.querySelector<HTMLElement>(".st-adv");
  if (more && adv) button(more, { mode: "tap", haptic: 8, onPress: () => fold(more, adv, moreId(def), adv.hidden) });
}
