// The lobby's logic (runs on the hosting phone). Every phone draws the lobby itself (controller.ts): the room code,
// the invite link, who's in, and for the VIP the game picker. Here we only hand out colours and open on a game.
import { colorFor } from "../../config.ts";
import { shell } from "../../shell/host-state.ts";
import { pickableGames } from "../registry.ts";
import type { HostMount } from "../types.ts";
import type { LobbyOwn } from "./shared.ts";

const mount: HostMount = (ctx) => {
  const { host } = ctx;
  const owned = new Map<string, string>();
  function render() {
    for (const p of host.players.values()) {
      const color = colorFor(p.index);
      if (owned.get(p.id) === color) continue;
      owned.set(p.id, color);
      const own: LobbyOwn = { color };
      host.setOwn(p.id, own);
    }
  }
  const offs = [host.on("room", render), host.on("join", render), host.on("rejoin", (p) => (owned.delete(p.id), render())), host.on("leave", render)];
  if (!shell.state?.selected) shell.select(pickableGames()[0]!.id);
  render();
  return () => offs.forEach((o) => o());
};

export default mount;
