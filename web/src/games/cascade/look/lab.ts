// Look lab: the three candidate looks on one page, playing real games so the chains can be judged.
// Open /lab/cascade/ on the dev server.
import "./lab.css";
import { botMove } from "../bots.ts";
import { Game, capacity } from "../rules.ts";
import { CultureLook } from "./culture.ts";
import { Director } from "./director.ts";
import type { Look } from "./look.ts";
import { MarblesLook } from "./marbles.ts";
import { ReactorLook } from "./reactor.ts";
import { Stage } from "./stage.ts";

const SIZES: [number, number][] = [
  [9, 6],
  [12, 8],
  [20, 12],
];
/** Seconds a computer player shows its cursor before it plays. */
const THINK = 0.55;

const looks: Look[] = [new MarblesLook(), new ReactorLook(), new CultureLook()];
const params = new URLSearchParams(location.search);
const state = {
  look: Math.max(0, looks.findIndex((l) => l.info.id === params.get("look"))),
  size: params.get("size") === "large" ? 1 : params.get("size") === "huge" ? 2 : 0,
  players: Math.min(8, Math.max(2, Number(params.get("players")) || 4)),
  speed: 1,
  auto: params.get("auto") !== "off",
};

const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="lab-view"></div>
  <header class="lab-bar">
    <div class="lab-title"><b>Cascade</b><span>Look lab</span></div>
    <div class="lab-seg" data-looks>${looks.map((l, i) => `<button data-look="${i}">${l.info.name}<kbd>${i + 1}</kbd></button>`).join("")}</div>
    <div class="lab-controls">
      <label>Players <select data-players>${[2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}">${n}</option>`).join("")}</select></label>
      <label>Board <select data-size>${SIZES.map(([w, h], i) => `<option value="${i}">${w} × ${h}</option>`).join("")}</select></label>
      <label>Speed <select data-speed><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option></select></label>
      <button class="lab-btn" data-auto>Autoplay</button>
      <button class="lab-btn" data-chain>Big chain</button>
      <button class="lab-btn primary" data-restart>Restart</button>
    </div>
  </header>
  <p class="lab-blurb"></p>
  <footer class="lab-players"></footer>
`;
const $ = <T extends HTMLElement>(sel: string) => app.querySelector(sel) as T;
const view = $<HTMLDivElement>(".lab-view");
const blurb = $<HTMLParagraphElement>(".lab-blurb");
const strip = $<HTMLElement>(".lab-players");
const playersSel = $<HTMLSelectElement>("[data-players]");
const sizeSel = $<HTMLSelectElement>("[data-size]");
const speedSel = $<HTMLSelectElement>("[data-speed]");
const autoBtn = $<HTMLButtonElement>("[data-auto]");

const stage = new Stage(view);
let look = looks[state.look]!;
let [W, H] = SIZES[state.size]!;
let game = new Game(W, H, state.players);
const director = new Director(look);
/** What the player strip shows: the board's state as of the end of the animation playing now. */
let shown = { alive: game.alive.slice(), winner: -1 };
let botCell = -1;
let botT = 0;
let winT = 0;
let mouseCell = -1;

function snap() {
  shown = { alive: game.alive.slice(), winner: game.winner };
}

function syncLook() {
  snap();
  look.clear();
  for (let i = 0; i < W * H; i++) look.setCell(i, game.board.owner[i]!, game.board.count[i]!);
  look.turn(game.winner >= 0 ? game.winner : game.turn);
  if (game.winner >= 0) look.win(game.winner);
}

function useLook(i: number) {
  director.cancel();
  look.dispose();
  state.look = i;
  look = looks[i]!;
  look.build(W, H);
  director.look = look;
  stage.use(look, W, H);
  syncLook();
  refresh();
}

function newGame() {
  director.cancel();
  [W, H] = SIZES[state.size]!;
  game = new Game(W, H, state.players);
  if (look.w !== W || look.h !== H) {
    look.build(W, H);
    stage.use(look, W, H);
  }
  syncLook();
  botCell = -1;
  winT = 0;
  refresh();
}

/** Every cell one short of bursting, owners mixed: one more piece anywhere sets off the whole board. */
function bigChain() {
  newGame();
  for (let i = 0; i < W * H; i++) {
    game.board.owner[i] = Math.floor(Math.random() * state.players);
    game.board.count[i] = capacity(W, H, i) - 1;
  }
  game.moved.fill(true);
  syncLook();
  refresh();
}

function play(i: number) {
  if (director.busy || !game.canPlay(i)) return;
  const move = game.play(i);
  if (!move) return;
  botCell = -1;
  look.hover(-1, 0);
  director.play(move, () => {
    if (game.winner < 0) look.turn(game.turn);
    snap();
    refresh();
  });
  refresh();
}

function refresh() {
  app.querySelectorAll<HTMLButtonElement>("[data-look]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.look) === state.look)));
  autoBtn.setAttribute("aria-pressed", String(state.auto));
  playersSel.value = String(state.players);
  sizeSel.value = String(state.size);
  speedSel.value = String(state.speed);
  blurb.textContent = look.info.blurb;
  const chips = Array.from({ length: game.players }, (_, p) => {
    const c = look.info.colors[p]!;
    const turn = !director.busy && shown.winner < 0 && game.turn === p;
    const cls = ["lab-chip", turn ? "turn" : "", shown.alive[p] ? "" : "out"].join(" ");
    return `<span class="${cls}" style="${turn ? `border-color:${c}` : ""}"><i style="background:${c}"></i>P${p + 1}</span>`;
  });
  if (shown.winner >= 0) chips.push(`<span class="lab-win" style="color:${look.info.colors[shown.winner]}">P${shown.winner + 1} wins</span>`);
  strip.innerHTML = chips.join("");
}

// ---------------------------------------------------------------------------------------------------- input
app.querySelector("[data-looks]")!.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-look]");
  if (b) useLook(Number(b.dataset.look));
});
playersSel.addEventListener("change", () => {
  state.players = Number(playersSel.value);
  newGame();
});
sizeSel.addEventListener("change", () => {
  state.size = Number(sizeSel.value);
  newGame();
});
speedSel.addEventListener("change", () => {
  state.speed = Number(speedSel.value);
});
autoBtn.addEventListener("click", () => {
  state.auto = !state.auto;
  refresh();
});
$("[data-chain]").addEventListener("click", bigChain);
$("[data-restart]").addEventListener("click", newGame);

view.addEventListener("pointermove", (e) => {
  mouseCell = stage.pick(e.clientX, e.clientY);
});
view.addEventListener("pointerleave", () => {
  mouseCell = -1;
});
view.addEventListener("click", (e) => play(stage.pick(e.clientX, e.clientY)));
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLSelectElement) return;
  const n = Number(e.key);
  if (n >= 1 && n <= looks.length) useLook(n - 1);
  else if (e.key === " ") {
    state.auto = !state.auto;
    refresh();
    e.preventDefault();
  } else if (e.key === "c") bigChain();
  else if (e.key === "r") newGame();
});

// ---------------------------------------------------------------------------------------------------- loop
look.build(W, H);
stage.use(look, W, H);
syncLook();
refresh();

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const sdt = dt * state.speed;
  look.update(sdt, stage.camera);
  director.update(sdt);

  if (!director.busy && game.winner < 0) {
    if (state.auto) {
      if (botCell < 0) {
        botCell = botMove(game);
        botT = 0;
      }
      botT += sdt;
      look.hover(botCell, game.turn);
      if (botT >= THINK) play(botCell);
    } else look.hover(mouseCell, game.turn, game.canPlay(mouseCell));
  }
  if (game.winner >= 0 && !director.busy) {
    winT += dt;
    if (winT > 5 && state.auto) newGame();
  }
  stage.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

Object.assign(window, { __lab: { stage, director, get game() { return game; }, get look() { return look; }, useLook, bigChain, newGame, play } });
