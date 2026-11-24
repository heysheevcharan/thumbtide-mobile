// Play stats for the lobby, kept on the TV (localStorage; a try/catch everywhere: it can be missing or full).
// One small record per game id: [total milliseconds played, time of the last play]. The shell calls begin() when a
// game mounts and end() when it leaves (End game, back to the lobby, page unload); the lobby only reads.
const KEY = "thumbtide:played";
type Rec = [total: number, last: number];

function load(): Record<string, Rec> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

let open: { id: string; at: number } | null = null;

export function begin(id: string) {
  end();
  if (id !== "lobby") open = { id, at: Date.now() };
}

/** Add the time since begin() to the game's total and set its last-played time. */
export function end() {
  if (!open) return;
  const { id, at } = open;
  open = null;
  const now = Date.now();
  const ms = Math.min(Math.max(0, now - at), 12 * 3600_000); // a forgotten TV does not count for days
  try {
    const all = load();
    const r = all[id] ?? [0, 0];
    all[id] = [r[0] + ms, now];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: the stats just stay empty */
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", end);
  window.addEventListener("beforeunload", end);
}

export function playedText(id: string, now = Date.now()): { played: string; last: string } {
  const r = load()[id];
  if (!r || !r[1]) return { played: "", last: "Never played" };
  const mins = Math.round(r[0] / 60_000);
  const played = mins < 1 ? "Played under 1 min" : mins < 60 ? `Played ${mins} min` : `Played ${Math.floor(mins / 60)} h ${mins % 60} min`;
  const ago = now - r[1];
  const m = Math.floor(ago / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(ago / 86_400_000);
  const when =
    m < 1 ? "just now" : m < 60 ? `${m} min ago` : h < 24 ? `${h} h ago` : d === 1 ? "yesterday" : d < 14 ? `${d} days ago` : d < 60 ? `${Math.floor(d / 7)} weeks ago` : `${Math.floor(d / 30)} months ago`;
  return { played, last: `Last played ${when}` };
}
