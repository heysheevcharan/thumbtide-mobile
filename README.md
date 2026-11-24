# Thumbtide Mobile

Party games played on everyone's phone: a website for the phone's browser, with no TV, no app and no server to
run. One person starts a room, friends join with a 4-letter code (or by scanning the QR code), and every phone
shows the game and its controls.

A mobile take on [Thumbtide](https://github.com/dupenodi/thumbtide), where a TV showed the game and phones were
controllers.

## The games

| Game | Players | Status |
|---|---|---|
| **Cult** | 1–8 (computers fill seats up to 5) | Live. Hidden roles: the town votes in leaders while a secret cult tries to take over |
| **Odd Word Out** | 1–8 | Live. Everyone has the same secret word, almost. Describe it, then vote out the odd one |
| **Inkling** | 1–8 | Live. One player draws the secret word on their phone; it appears live on everyone else's while they guess |
| Cascade | 1–8 | Being ported |

Games are added one at a time. A game still being ported is hidden from the library (`/?game=<id>` on the room
creator's page still opens it for testing).

## How it works

```
 phone ──┐                         ┌─ phone that started the room
 phone ──┼── WebRTC (peer to peer) ┤  runs the relay and the game logic in its browser,
 phone ──┘                         └─ and plays like everyone else
```

- There is **no game server**. The phone that starts the room runs the relay (`web/src/net/rooms.ts`) and the
  game logic (`web/src/shell/engine.ts`) inside its browser. Other phones connect straight to it over WebRTC data
  channels (`web/src/net/p2p.ts`).
- [PeerJS](https://peerjs.com)'s free public service introduces the phones to each other, and relays traffic
  through its TURN servers when two phones can't reach each other directly (e.g. on mobile data).
- The site is static, so it's hosted on Vercel.
- **Keep the room creator's page open.** If that phone locks or leaves the page, the game pauses for everyone. If
  it reloads, the room comes back with the same code and seats, and the current game restarts.

## Develop

Needs Node 22+ and pnpm.

```sh
pnpm install
pnpm dev        # http://localhost:5173. Open a second tab to be a second player
pnpm test       # game-rule and SDK tests
pnpm typecheck
pnpm build      # static site in web/dist
```

To test on a real phone in dev, open `http://<your computer's LAN IP>:5173` on the phone.

## Layout

- `web/index.html`, `web/src/shell/app.ts`: the page: home (start or join), the shell bar, host menu and help
- `web/src/shell/engine.ts`: the game engine that runs on the room creator's phone
- `web/src/net/`: the peer-to-peer transport and the in-browser relay
- `web/src/games/<id>/`: each game: `rules.ts` (tested), `host.ts` (logic), `controller.ts` (the phone screen)
- `packages/sdk`, `packages/protocol`: the room SDK and wire protocol from Thumbtide
