import { parsePad } from "./kit/pad.ts";
import { applyThumbs } from "./thumbs.ts";
import type { GameDef } from "./types.ts";
import cascadePad from "./cascade/cascade.pad?raw";
import cultPad from "./cult/cult.pad?raw";
import inklingPad from "./inkling/inkling.pad?raw";
import oddwordPad from "./oddword/oddword.pad?raw";

/** Every game on the platform. Modules are lazy-loaded so phones only download what they need. */
export const GAMES: GameDef[] = applyThumbs([
  {
    id: "lobby",
    title: "Lobby",
    tagline: "",
    minPlayers: 0,
    maxPlayers: 16,
    hidden: true,
    host: () => import("./lobby/host.ts"),
    controller: () => import("./lobby/controller.ts"),
  },
  {
    id: "cult",
    title: "Cult",
    tagline: "Someone here leads a cult. Vote anyway.",
    minPlayers: 1,
    maxPlayers: 8,
    colors: ["#ff4466", "#5b2bd6"],
    cover: `${import.meta.env.BASE_URL}art/cult/cover.webp`,
    glyph: "eye",
    controls: parsePad(cultPad, "cult.pad"),
    settings: [
      {
        key: "bots",
        label: "Extra computer players",
        options: [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: n ? String(n) : "None" })),
        default: 0,
      },
    ],
    host: () => import("./cult/host.ts"),
    controller: () => import("./cult/controller.ts"),
  },
  {
    id: "cascade",
    title: "Cascade",
    tagline: "Start a chain reaction. Take the whole board.",
    minPlayers: 1,
    maxPlayers: 8,
    colors: ["#e23c5c", "#2c6cd8"],
    cover: `${import.meta.env.BASE_URL}covers/cascade.webp`,
    glyph: "pulse",
    controls: parsePad(cascadePad, "cascade.pad"),
    settings: [
      {
        key: "board",
        label: "Board",
        options: [
          { value: "auto", label: "Auto" },
          { value: "small", label: "5 × 7" },
          { value: "medium", label: "6 × 9" },
          { value: "large", label: "7 × 11" },
          { value: "xl", label: "8 × 13" },
          { value: "huge", label: "10 × 16" },
          { value: "custom", label: "Custom" },
        ],
        default: "auto",
      },
      {
        key: "cols",
        label: "Columns",
        options: [4, 5, 6, 7, 8, 9, 10, 12].map((n) => ({ value: n, label: String(n) })),
        default: 7,
        when: { key: "board", value: "custom" },
      },
      {
        key: "rows",
        label: "Rows",
        options: [5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20].map((n) => ({ value: n, label: String(n) })),
        default: 11,
        when: { key: "board", value: "custom" },
      },
      {
        key: "timer",
        label: "Turn timer",
        options: [
          { value: 0, label: "Off" },
          { value: 10, label: "10s" },
          { value: 20, label: "20s" },
          { value: 30, label: "30s" },
        ],
        default: 20,
        applies: "now",
      },
      {
        key: "bots",
        label: "Computer players",
        options: [0, 1, 2, 3, 4].map((n) => ({ value: n, label: n ? String(n) : "None" })),
        default: 0,
      },
    ],
    host: () => import("./cascade/host.ts"),
    controller: () => import("./cascade/controller.ts"),
  },
  {
    id: "inkling",
    title: "Inkling",
    tagline: "Draw the secret word on your phone. Everyone else guesses.",
    minPlayers: 1,
    maxPlayers: 8,
    colors: ["#ffe46b", "#2f3a3f"],
    glyph: "eye",
    controls: parsePad(inklingPad, "inkling.pad"),
    settings: [
      {
        key: "time",
        label: "Draw time",
        options: [60, 80, 100].map((n) => ({ value: n, label: `${n} s` })),
        default: 80,
      },
      {
        key: "rounds",
        label: "Turns each",
        options: [1, 2].map((n) => ({ value: n, label: String(n) })),
        default: 1,
      },
      {
        key: "words",
        label: "Words",
        options: [
          { value: "easy", label: "Easy" },
          { value: "mixed", label: "Mixed" },
          { value: "hard", label: "Hard" },
        ],
        default: "mixed",
      },
      {
        key: "bots",
        label: "Computer players",
        options: [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: n ? String(n) : "None" })),
        default: 0,
        applies: "now",
      },
    ],
    host: () => import("./inkling/host.ts"),
    controller: () => import("./inkling/controller.ts"),
  },
  {
    id: "oddword",
    title: "Odd Word Out",
    tagline: "Everyone has the same secret word. Almost everyone.",
    minPlayers: 1,
    maxPlayers: 8,
    colors: ["#ff7a3d", "#1d1236"],
    glyph: "eye",
    controls: parsePad(oddwordPad, "oddword.pad"),
    settings: [
      {
        key: "mode",
        label: "Mode",
        options: [
          { value: "words", label: "Words (say an adjective)" },
          { value: "jobs", label: "Jobs (say what happens there)" },
        ],
        default: "words",
      },
      {
        key: "hint",
        label: "The odd one gets",
        options: [
          { value: "decoy", label: "A close word (doesn't know)" },
          { value: "blank", label: "No word (knows)" },
        ],
        default: "decoy",
      },
      {
        key: "bots",
        label: "Computer players",
        options: [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: n ? String(n) : "None" })),
        default: 0,
        applies: "now",
      },
    ],
    host: () => import("./oddword/host.ts"),
    controller: () => import("./oddword/controller.ts"),
  },
]);

export const gameById = (id: string) => GAMES.find((g) => g.id === id);
export const pickableGames = () => GAMES.filter((g) => !g.hidden);
