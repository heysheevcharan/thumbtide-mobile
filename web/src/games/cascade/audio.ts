// Sound for the TV, in three flavours to match the looks: Culture is wet and bubbly, Marbles is glass on wood,
// Reactor is zaps and explosions. Mostly short recordings (from Kenney's CC0 Interface, Impact and Sci-fi sound
// packs, in ./sounds) with a few synth notes on top. Each wave of a chain plays a step higher than the last.
import type { LookId } from "./shared.ts";

// Bundled into the script as data: the TV app runs from file://, where fetching files can fail.
const FILES = import.meta.glob<string>("./sounds/*.mp3", { eager: true, query: "?inline", import: "default" });

/** Pentatonic steps, in semitones. */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const semi = (n: number) => 2 ** (n / 12);
/** Playback speed for a wave of a chain: speeding a recording up raises its pitch. */
const climb = (wave: number) => semi(SCALE[Math.min(wave, 7)]! - 4);

export function createAudio(ctx: AudioContext | null) {
  if (!ctx) return null;
  const master = ctx.createGain();
  master.gain.value = 0.6;
  // a long chain stacks up a lot of sound: squash the peaks rather than clip
  const squash = ctx.createDynamicsCompressor();
  squash.threshold.value = -12;
  squash.knee.value = 8;
  squash.ratio.value = 4;
  squash.attack.value = 0.003;
  squash.release.value = 0.25;
  master.connect(squash).connect(ctx.destination);
  let look: LookId = "culture";

  // "marbles-clack-3.mp3" is one take of "marbles-clack"; each play picks a take at random
  const takes = new Map<string, AudioBuffer[]>();
  for (const [path, url] of Object.entries(FILES)) {
    const name = path.replace(/^.*\//, "").replace(/-\d+\.mp3$/, "");
    const bin = atob(url.slice(url.indexOf(",") + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    ctx.decodeAudioData(
      bytes.buffer,
      (b) => takes.set(name, [...(takes.get(name) ?? []), b]),
      () => {},
    );
  }

  const now = () => ctx.currentTime;
  const on = () => ctx.state === "running";

  /** One take of a sound, `at` seconds from now. `rate` above 1 plays it faster and higher. */
  const play = (name: string, at = 0, gain = 1, rate = 1) => {
    const list = takes.get(name);
    if (!list) return;
    const s = ctx.createBufferSource();
    s.buffer = list[Math.floor(Math.random() * list.length)]!;
    s.playbackRate.value = rate * (0.97 + Math.random() * 0.06); // never quite the same twice
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(g).connect(master);
    s.start(now() + at);
  };
  const tone = (freq: number, at: number, dur: number, type: OscillatorType = "sine", peak = 0.3, to?: number) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = now() + at;
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.006 + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  };

  return {
    setLook(l: LookId) {
      look = l;
    },
    dispose() {
      master.disconnect();
      squash.disconnect();
    },
    /** The cursor moved one cell. */
    step() {
      if (!on()) return;
      if (look === "marbles") play("marbles-knock", 0, 0.14, 1.8);
      else if (look === "reactor") tone(1500, 0, 0.03, "square", 0.025);
      else play("culture-bloop", 0, 0.12, 1.9);
    },
    /** It's someone else's turn now. */
    turn() {
      if (!on()) return;
      if (look === "marbles") {
        play("marbles-clack", 0, 0.3);
        play("marbles-clack", 0.1, 0.22, 1.26);
      } else if (look === "reactor") {
        tone(440, 0, 0.08, "triangle", 0.05);
        tone(660, 0.06, 0.1, "triangle", 0.05);
      } else {
        play("culture-bloop", 0, 0.35);
        play("culture-bloop", 0.09, 0.3, 1.33);
      }
    },
    /** A piece goes in. */
    place() {
      if (!on()) return;
      if (look === "marbles") {
        // dropped into a wooden pit: it hits, then bounces twice (matches the animation)
        play("marbles-clack", 0.2, 0.8);
        play("marbles-knock", 0.2, 0.6);
        play("marbles-clack", 0.4, 0.35, 1.05);
        play("marbles-clack", 0.5, 0.15, 1.1);
      } else if (look === "reactor") {
        play("reactor-clunk", 0, 0.45);
        tone(220, 0, 0.16, "sawtooth", 0.05, 880);
      } else {
        play("culture-thud", 0, 0.7);
        play("culture-bloop", 0.02, 0.55, 0.8);
      }
    },
    /** A wave of bursts: it climbs with each wave, and more cells make it bigger. */
    burst(wave: number, cells: number) {
      if (!on()) return;
      const big = Math.min(1, 0.55 + Math.log2(cells + 1) * 0.12);
      const r = climb(wave);
      if (look === "marbles") {
        play("marbles-knock", 0, 0.55 * big, 0.9);
        play("marbles-ring", 0, 0.45 * big, r);
      } else if (look === "reactor") {
        play("reactor-crunch", 0, 0.55 * big, 0.9 + 0.03 * Math.min(wave, 8));
        if (cells >= 3) play("reactor-boom", 0, 0.5 * big);
        tone(330 * semi(SCALE[Math.min(wave, SCALE.length - 1)]!), 0, 0.14, "square", 0.05 * big);
      } else {
        play("culture-bubble", 0, 0.75 * big, r);
        if (cells >= 3) play("culture-thud", 0, 0.4 * big, 0.8);
        if (cells >= 5) play("culture-squelch", 0, 0.3, 1.2);
      }
    },
    /** A wave's pieces arrive in their new cells. */
    land(wave: number) {
      if (!on()) return;
      if (look === "marbles") {
        play("marbles-clack", 0, 0.5);
        play("marbles-knock", 0, 0.25);
      } else if (look === "reactor") play("reactor-zap", 0, 0.22, 1.1 + 0.04 * Math.min(wave, 8));
      else play("culture-bloop", 0, 0.3, climb(wave) * 1.2);
    },
    /** Tried to play somewhere they can't. */
    nope() {
      if (!on()) return;
      tone(180, 0, 0.08, "square", 0.05);
      tone(150, 0.1, 0.1, "square", 0.05);
    },
    /** Someone is knocked out. */
    out() {
      if (!on()) return;
      if (look === "marbles") play("marbles-thunk", 0, 0.7, 0.7);
      else if (look === "reactor") play("reactor-boom", 0, 0.6, 0.7);
      else play("culture-squelch", 0, 0.6, 0.75);
      tone(392, 0, 0.25, "triangle", 0.08, 196);
      tone(294, 0.2, 0.4, "triangle", 0.07, 147);
    },
    win() {
      if (!on()) return;
      const chord = [0, 4, 7, 12, 16];
      if (look === "marbles") chord.forEach((n, i) => play("marbles-ring", i * 0.09, 0.45, semi(n - 4)));
      else if (look === "reactor") {
        play("reactor-boom", 0, 0.5);
        chord.forEach((n, i) => tone(330 * semi(n), i * 0.09, 0.5, "sawtooth", 0.05));
      } else chord.forEach((n, i) => play("culture-bubble", i * 0.09, 0.5, semi(n - 2)));
      tone(349 * semi(24), 0.5, 0.9, "sine", 0.08);
    },
    /** The turn timer is about to run out. */
    tick() {
      if (!on()) return;
      if (look === "marbles") play("marbles-knock", 0, 0.45, 1.4);
      else if (look === "reactor") tone(1200, 0, 0.04, "sine", 0.05);
      else play("culture-bloop", 0, 0.3, 1.6);
    },
  };
}

export type Sfx = NonNullable<ReturnType<typeof createAudio>>;
