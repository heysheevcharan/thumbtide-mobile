/** The link people open to join a room (the room code goes on as ?r=ABCD). */
export function joinBase(): string {
  return new URL("/", location.href).toString();
}

export function joinUrl(code: string): string {
  const u = new URL(joinBase());
  u.searchParams.set("r", code);
  return u.toString();
}

/** Display host for "go to ___ and enter code" text. */
export function joinDisplay(): string {
  const u = new URL(joinBase());
  return `${u.host}${u.pathname.replace(/\/$/, "")}`;
}

/** Player colors by join index. */
export const PLAYER_COLORS = [
  "#ff5d73", "#3ec5ff", "#ffd23f", "#7cf29a", "#c18cff", "#ff9f43",
  "#ff6ad5", "#2de2c9", "#f7f7f7", "#a3e048", "#ff7a59", "#6c8cff",
  "#ffb3c6", "#9ad1d4", "#e0c097", "#b8b8ff",
];
export const colorFor = (index: number) => PLAYER_COLORS[index % PLAYER_COLORS.length]!;
