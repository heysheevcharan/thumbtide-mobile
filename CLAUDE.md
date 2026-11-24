# Thumbtide Mobile

Party games in the phone's browser: every phone shows the game, one phone (the room creator) runs the game logic,
phones connect peer to peer (PeerJS). See README.md.

- Ship one game at a time. A game being ported stays `hidden: true` in `web/src/games/registry.ts` until it works on
  phones; the base version (Cult) must stay stable.
- Responsive: phones first; on tablets and laptops the phone layout is centred. Orientation prompts only on phones.
- Before pushing: `pnpm typecheck`, `pnpm test`, `pnpm build`.
