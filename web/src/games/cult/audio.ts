// Sound for the TV, made with WebAudio (no files). Plays through the TV page's shared engine (shell/sound.ts).

export function createAudio(ctx: AudioContext | null) {
  if (!ctx) return null;
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const env = (g: GainNode, t: number, peak: number, attack: number, decay: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  const tone = (freq: number, at: number, dur: number, type: OscillatorType = "sine", peak = 0.3, to?: number) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
    env(g, at, peak, 0.008, dur);
    o.connect(g).connect(master);
    o.start(at);
    o.stop(at + dur + 0.05);
  };
  const burst = (at: number, dur: number, from: number, to: number, peak: number, type: BiquadFilterType = "lowpass") => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(from, at);
    f.frequency.exponentialRampToValueAtTime(to, at + dur);
    const g = ctx.createGain();
    env(g, at, peak, 0.01, dur);
    s.connect(f).connect(g).connect(master);
    s.start(at, Math.random() * 0.5);
    s.stop(at + dur + 0.05);
  };
  const now = () => ctx.currentTime;

  return {
    dispose() {
      master.disconnect();
    },
    /** Someone voted (the vote itself stays secret). */
    tick() {
      tone(1200, now(), 0.05, "sine", 0.08);
    },
    /** It's someone's move. */
    nudge() {
      const t = now();
      tone(660, t, 0.12, "triangle", 0.12);
      tone(880, t + 0.1, 0.16, "triangle", 0.12);
    },
    /** The votes flip over. */
    reveal() {
      const t = now();
      for (let i = 0; i < 6; i++) burst(t + i * 0.05, 0.06, 1800, 900, 0.12, "bandpass");
    },
    passed() {
      const t = now() + 0.3;
      [523, 659, 784].forEach((f, i) => tone(f, t + i * 0.07, 0.5, "triangle", 0.14));
    },
    failed() {
      const t = now() + 0.3;
      tone(220, t, 0.5, "sawtooth", 0.08, 140);
      tone(165, t + 0.12, 0.6, "sawtooth", 0.07, 110);
    },
    /** A law is slammed onto the board. */
    law(town: boolean) {
      const t = now();
      burst(t, 0.18, 3000, 300, 0.4);
      tone(town ? 196 : 98, t, 0.5, "sine", 0.4, town ? 180 : 70);
      if (town) [784, 988, 1175].forEach((f, i) => tone(f, t + 0.12 + i * 0.06, 0.4, "triangle", 0.1));
      else [233, 220, 208].forEach((f, i) => tone(f, t + 0.15 + i * 0.12, 0.5, "square", 0.05));
    },
    riot() {
      const t = now();
      for (let i = 0; i < 8; i++) burst(t + i * 0.09, 0.25, 900 + Math.random() * 900, 300, 0.18, "bandpass");
      tone(110, t, 0.9, "sawtooth", 0.06, 80);
    },
    /** A power is handed to the Mayor. */
    power() {
      const t = now();
      [392, 466, 587].forEach((f, i) => tone(f, t + i * 0.1, 0.6, "triangle", 0.1));
    },
    burn() {
      const t = now();
      burst(t, 1.6, 400, 4000, 0.35, "bandpass");
      for (let i = 0; i < 14; i++) burst(t + 0.2 + Math.random() * 1.4, 0.04, 6000, 3000, 0.15, "highpass");
      tone(80, t, 1.2, "sine", 0.3, 50);
    },
    win(town: boolean) {
      const t = now();
      const notes = town ? [523, 659, 784, 1047] : [220, 262, 311, 370];
      notes.forEach((f, i) => tone(f, t + i * 0.12, 0.9, "triangle", 0.14));
      notes.forEach((f, i) => tone(f / 2, t + i * 0.12, 0.9, "square", 0.04));
    },
  };
}

export type Sfx = NonNullable<ReturnType<typeof createAudio>>;
