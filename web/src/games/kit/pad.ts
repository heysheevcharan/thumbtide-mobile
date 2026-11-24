// Pad: Thumbtide's little language for a game's phone controller and how it feels.
//
// Each game keeps a `<game>.pad` file next to its code. It says which controls the phone shows, how the stick
// and buttons feel, the haptic patterns the game plays, and any movement numbers the game wants tunable.
// Change a number, save, and the phones pick it up: no code changes.
//
//   # comments start with a hash
//   controller                       a block starts at the left edge: <kind> [name]
//     orientation  landscape         its settings are indented: <setting> <value…>
//
//   stick move
//     travel   40px
//     full-at  85%
//
//   button splat
//     label    "SPLAT!"
//
//   choices answer                   a list of options the game fills in (answers, votes…)
//     layout   auto
//
// Values: numbers (with an optional unit: px, ms, hz or %), words, "quoted text", yes/no.
// Mistakes are reported with the file and line, e.g. `wetpaint.pad:14: stick "travel" must be 16–120px`.

import type { ControlIcon } from "../types.ts";

export interface StickSpec {
  id: string;
  /** A word or two shown faintly in the stick area until the first touch. */
  label: string;
  mode: "floating" | "fixed";
  /** Floating only: the base slides after the thumb when it passes the rim. */
  follow: boolean;
  /** Thumb travel from centre to rim, px. */
  travel: number;
  /** 0–1 of travel ignored around the centre. */
  deadzone: number;
  /** 0–1 of travel where full tilt is reached. */
  fullAt: number;
  /** Response curve: 1 linear, <1 livelier near the centre, >1 finer. */
  curve: number;
  /** 0 = any direction, or snap to 4 / 8. */
  directions: 0 | 4 | 8;
  /** Haptic ms when the thumb lands / reaches full tilt (0 = off). */
  haptic: number;
  rimHaptic: number;
}

export interface ButtonSpec {
  id: string;
  label: string;
  /** A few words for the help sheet. */
  hint: string;
  icon?: ControlIcon;
  /** "primary" gets the most room and the game's colour. */
  style: "primary" | "secondary";
  /** "rounded": a rounded rectangle that fills its space. "round": one big circle, like an arcade buzzer. */
  shape: "rounded" | "round";
  /** Haptic ms on press (0 = off). */
  haptic: number;
  /** "press": the instant a finger lands. "release": when it lifts. "repeat": on landing, then every `repeatMs` while held. */
  fires: "press" | "release" | "repeat";
  repeatMs: number;
}

/** A list of options the game fills in when it needs a choice (an answer, a vote). Covers the other controls while shown. */
export interface ChoicesSpec {
  id: string;
  /** A heading above the options. */
  label: string;
  hint: string;
  /** "list": one per row. "grid": two across. "row": all side by side, like cards in a hand. "auto": a list held upright, a grid held sideways. */
  layout: "auto" | "list" | "grid" | "row";
  /** Haptic ms when an option is picked (0 = off). */
  haptic: number;
  /** Ask for a second tap before a pick counts. */
  confirm: boolean;
}

export interface PadSpec {
  /** How the phone should be held. */
  orientation: "any" | "landscape" | "portrait";
  /** Stick updates sent per second. */
  sendRate: number;
  stick?: StickSpec;
  buttons: ButtonSpec[];
  choices: ChoicesSpec[];
  /** Named haptic patterns (ms on, off, on…) the game plays with `pad.buzz(name)`. */
  buzz: Record<string, number[]>;
  /** Game-side feel numbers (movement speed, acceleration…). The game reads the names it knows. */
  tune: Record<string, number>;
}

export class PadError extends Error {
  constructor(
    readonly file: string,
    readonly line: number,
    message: string,
  ) {
    super(`${file}:${line}: ${message}`);
    this.name = "PadError";
  }
}

// ------------------------------------------------------------------------------------------ reading the text

type Token = { kind: "num"; value: number; unit: string } | { kind: "word"; value: string } | { kind: "text"; value: string };

interface Setting {
  key: string;
  values: Token[];
  line: number;
}

interface Block {
  kind: string;
  name: string;
  line: number;
  settings: Setting[];
}

function tokenize(text: string, file: string, line: number): Token[] {
  const out: Token[] = [];
  const re = /\s*(?:"((?:[^"\\]|\\.)*)"|([^\s",]+)|(,))/y;
  let pos = 0;
  while (pos < text.length && text.slice(pos).trim()) {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) throw new PadError(file, line, `can't read "${text.slice(pos).trim()}"`);
    pos = re.lastIndex;
    if (m[1] !== undefined) out.push({ kind: "text", value: m[1].replace(/\\(.)/g, "$1") });
    else if (m[2] !== undefined) {
      const n = /^(-?\d+(?:\.\d+)?)(px|ms|hz|%)?$/i.exec(m[2]);
      out.push(n ? { kind: "num", value: Number(n[1]), unit: (n[2] ?? "").toLowerCase() } : { kind: "word", value: m[2] });
    }
  }
  return out;
}

function stripComment(raw: string): string {
  let inText = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"' && raw[i - 1] !== "\\") inText = !inText;
    else if (c === "#" && !inText) return raw.slice(0, i);
  }
  return raw;
}

function readBlocks(src: string, file: string): Block[] {
  const blocks: Block[] = [];
  src.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const text = stripComment(raw);
    if (!text.trim()) return;
    const indented = /^\s/.test(text);
    if (!indented) {
      const [kind, name, ...extra] = text.trim().split(/\s+/);
      if (extra.length) throw new PadError(file, line, `a block is "<kind> [name]", got "${text.trim()}"`);
      blocks.push({ kind: kind!, name: name ?? "", line, settings: [] });
      return;
    }
    const block = blocks[blocks.length - 1];
    if (!block) throw new PadError(file, line, "this setting isn't inside a block (blocks start at the left edge)");
    const tokens = tokenize(text.trim(), file, line);
    const head = tokens.shift();
    if (!head || head.kind !== "word") throw new PadError(file, line, "a setting starts with its name");
    block.settings.push({ key: head.value, values: tokens, line });
  });
  return blocks;
}

// ------------------------------------------------------------------------------------------ checking values

type Read<T> = (s: Setting, ctx: string) => T;

const fail = (file: string, s: Setting, ctx: string, msg: string): never => {
  throw new PadError(file, s.line, `${ctx} "${s.key}" ${msg}`);
};

function reader(file: string) {
  const one = (s: Setting, ctx: string): Token => {
    if (s.values.length !== 1) fail(file, s, ctx, `takes one value`);
    return s.values[0]!;
  };
  const num =
    (min: number, max: number, unit = ""): Read<number> =>
    (s, ctx) => {
      const t = one(s, ctx);
      const label = `${min}–${max}${unit}`;
      if (t.kind !== "num" || (t.unit && t.unit !== unit)) return fail(file, s, ctx, `must be ${label}`);
      if (t.value < min || t.value > max) fail(file, s, ctx, `must be ${label}`);
      return t.value;
    };
  /** 0–1, written as a fraction (0.85) or a percentage (85%). */
  const frac =
    (min: number, max: number): Read<number> =>
    (s, ctx) => {
      const t = one(s, ctx);
      const v = t.kind === "num" ? (t.unit === "%" ? t.value / 100 : t.unit ? NaN : t.value) : NaN;
      if (!(v >= min && v <= max)) fail(file, s, ctx, `must be ${min * 100}–${max * 100}%`);
      return v;
    };
  const word =
    <W extends string>(...options: W[]): Read<W> =>
    (s, ctx) => {
      const t = one(s, ctx);
      const v = t.kind === "num" ? String(t.value) : t.value;
      if (!options.includes(v as W)) fail(file, s, ctx, `must be one of: ${options.join(", ")}`);
      return v as W;
    };
  const yesNo: Read<boolean> = (s, ctx) => {
    const v = word("yes", "no", "on", "off", "true", "false")(s, ctx);
    return v === "yes" || v === "on" || v === "true";
  };
  const text: Read<string> = (s, ctx) => {
    const t = one(s, ctx);
    if (t.kind === "num") return String(t.value);
    return t.value;
  };
  const msList: Read<number[]> = (s, ctx) => {
    if (!s.values.length) fail(file, s, ctx, "needs at least one duration in ms");
    return s.values.map((t) => {
      if (t.kind !== "num" || (t.unit && t.unit !== "ms") || t.value < 0 || t.value > 2000) fail(file, s, ctx, "is a list of 0–2000ms durations");
      return (t as { value: number }).value;
    });
  };
  return { num, frac, word, yesNo, text, msList };
}

/** Apply a block's settings against a table of readers. Unknown settings are mistakes, not silently ignored. */
function apply<T extends object>(file: string, b: Block, ctx: string, target: T, table: { [K in keyof T]?: [string, Read<T[K]>] }) {
  const byKey = new Map(Object.entries(table).map(([prop, v]) => [(v as [string, unknown])[0], [prop, (v as [string, Read<unknown>])[1]] as const]));
  const seen = new Set<string>();
  for (const s of b.settings) {
    const entry = byKey.get(s.key);
    if (!entry) throw new PadError(file, s.line, `${ctx} has no setting "${s.key}" (it has: ${[...byKey.keys()].join(", ")})`);
    if (seen.has(s.key)) throw new PadError(file, s.line, `${ctx} "${s.key}" is set twice`);
    seen.add(s.key);
    (target as Record<string, unknown>)[entry[0]] = entry[1](s, ctx);
  }
  return target;
}

const ICONS: ControlIcon[] = ["splat", "dash", "pulse", "jump", "action", "special", "eye"];

// ------------------------------------------------------------------------------------------ the language

export function parsePad(src: string, file = "controls.pad"): PadSpec {
  const r = reader(file);
  const spec: PadSpec = { orientation: "any", sendRate: 40, buttons: [], choices: [], buzz: {}, tune: {} };
  const ids = new Set<string>();
  const seenBlocks = new Set<string>();

  const named = (b: Block) => {
    if (!b.name) throw new PadError(file, b.line, `a ${b.kind} needs a name, e.g. "${b.kind} ${b.kind === "stick" ? "move" : "jump"}"`);
    if (!/^[a-z][a-z0-9-]*$/.test(b.name)) throw new PadError(file, b.line, `"${b.name}" isn't a good name (lowercase letters, digits and dashes)`);
    if (ids.has(b.name)) throw new PadError(file, b.line, `there's already a control called "${b.name}"`);
    ids.add(b.name);
    return b.name;
  };
  const single = (b: Block) => {
    if (b.name) throw new PadError(file, b.line, `"${b.kind}" doesn't take a name`);
    if (seenBlocks.has(b.kind)) throw new PadError(file, b.line, `there's already a "${b.kind}" block`);
    seenBlocks.add(b.kind);
  };

  for (const b of readBlocks(src, file)) {
    switch (b.kind) {
      case "controller":
        single(b);
        apply(file, b, "controller", spec, {
          orientation: ["orientation", r.word("any", "landscape", "portrait")],
          sendRate: ["send-rate", r.num(10, 60, "hz")],
        });
        break;

      case "stick": {
        if (spec.stick) throw new PadError(file, b.line, "a controller has one stick");
        const stick: StickSpec = {
          id: named(b), label: "", mode: "floating", follow: true, travel: 40, deadzone: 0.08, fullAt: 0.85, curve: 0.9,
          directions: 0, haptic: 8, rimHaptic: 0,
        };
        apply(file, b, "stick", stick, {
          label: ["label", r.text],
          mode: ["mode", r.word("floating", "fixed")],
          follow: ["follow", r.yesNo],
          travel: ["travel", r.num(16, 120, "px")],
          deadzone: ["deadzone", r.frac(0, 0.4)],
          fullAt: ["full-at", r.frac(0.3, 1)],
          curve: ["curve", r.num(0.3, 3)],
          directions: ["directions", (s, ctx) => {
            const v = r.word("any", "4", "8")(s, ctx);
            return v === "any" ? 0 : (Number(v) as 4 | 8);
          }],
          haptic: ["haptic", r.num(0, 100, "ms")],
          rimHaptic: ["rim-haptic", r.num(0, 100, "ms")],
        });
        if (stick.fullAt <= stick.deadzone + 0.05) throw new PadError(file, b.line, `stick "full-at" must be well past the deadzone`);
        spec.stick = stick;
        break;
      }

      case "button": {
        const btn: ButtonSpec = {
          id: named(b), label: "", hint: "", style: "secondary", shape: "rounded", haptic: 14, fires: "press", repeatMs: 0,
        };
        apply(file, b, "button", btn, {
          label: ["label", r.text],
          hint: ["hint", r.text],
          icon: ["icon", r.word(...ICONS)],
          style: ["style", r.word("primary", "secondary")],
          shape: ["shape", r.word("rounded", "round")],
          haptic: ["haptic", r.num(0, 100, "ms")],
          fires: ["fires", (s, ctx) => {
            const [mode, every] = s.values;
            const m = mode?.kind === "word" ? mode.value : "";
            if (m === "press" || m === "release") {
              if (every) fail(file, s, ctx, `"${m}" doesn't take a time`);
              return m;
            }
            if (m === "repeat") {
              if (every?.kind !== "num" || (every.unit && every.unit !== "ms") || every.value < 50 || every.value > 2000) {
                fail(file, s, ctx, `"repeat" needs how often, e.g. "fires repeat 150ms"`);
              }
              btn.repeatMs = (every as { value: number }).value;
              return m;
            }
            return fail(file, s, ctx, "must be press, release or repeat <ms>");
          }],
        });
        if (!btn.label) throw new PadError(file, b.line, `button "${btn.id}" needs a label`);
        if (spec.buttons.length >= 4) throw new PadError(file, b.line, "a controller has at most 4 buttons");
        spec.buttons.push(btn);
        break;
      }

      case "choices": {
        const ch: ChoicesSpec = { id: named(b), label: "", hint: "", layout: "auto", haptic: 14, confirm: false };
        apply(file, b, "choices", ch, {
          label: ["label", r.text],
          hint: ["hint", r.text],
          layout: ["layout", r.word("auto", "list", "grid", "row")],
          haptic: ["haptic", r.num(0, 100, "ms")],
          confirm: ["confirm", r.yesNo],
        });
        spec.choices.push(ch);
        break;
      }

      case "buzz":
        single(b);
        for (const s of b.settings) {
          if (spec.buzz[s.key]) throw new PadError(file, s.line, `buzz "${s.key}" is set twice`);
          spec.buzz[s.key] = r.msList(s, "buzz");
        }
        break;

      case "tune":
        single(b);
        for (const s of b.settings) {
          if (s.key in spec.tune) throw new PadError(file, s.line, `tune "${s.key}" is set twice`);
          const t = s.values[0];
          if (s.values.length !== 1 || t?.kind !== "num") throw new PadError(file, s.line, `tune "${s.key}" takes one number`);
          spec.tune[s.key] = t.value;
        }
        break;

      default:
        throw new PadError(file, b.line, `unknown block "${b.kind}" (blocks: controller, stick, button, choices, buzz, tune)`);
    }
  }
  if (!spec.stick && !spec.buttons.length && !spec.choices.length) throw new PadError(file, 1, "a controller needs a stick, a button or choices");
  return spec;
}
