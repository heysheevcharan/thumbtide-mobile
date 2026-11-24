// The player's controller preferences, kept on their phone.
import { local, setHaptics } from "@thumbtide/sdk";

export interface Prefs {
  /** Buzz on presses and hits. */
  haptics: boolean;
  /** Left-handed: buttons on the left, stick on the right. */
  swap: boolean;
  /** Go fullscreen when joining (where the browser allows it). */
  fullscreen: boolean;
}

const KEY = "thumbtide:prefs";
const listeners = new Set<(p: Prefs) => void>();

let current: Prefs = { haptics: true, swap: false, fullscreen: true, ...read() };
setHaptics(current.haptics);

function read(): Partial<Prefs> {
  try {
    return JSON.parse(local.get(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export const prefs = {
  get: (): Prefs => current,
  set(patch: Partial<Prefs>) {
    current = { ...current, ...patch };
    local.set(KEY, JSON.stringify(current));
    setHaptics(current.haptics);
    for (const fn of listeners) fn(current);
  },
  onChange(fn: (p: Prefs) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
