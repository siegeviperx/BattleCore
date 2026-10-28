# BattleCore

Baby Army vs Armored Dinosaurs: a 3D chess game where every capture is a fight.

A giant baby and a baby dinosaur dump their toys onto a war-table chessboard. The dinos armor up, the
babies put on war paint, and both armies flatten into paper cutouts for a full game of chess. Every capture
plays an animated 3D fight scene.

![Concept](docs/concept/baby-army-vs-armored-dinosaurs.png)

- **Design doc:** [docs/DESIGN.md](docs/DESIGN.md)
- **Technical requirements:** [docs/TECHNICAL_REQUIREMENTS.md](docs/TECHNICAL_REQUIREMENTS.md)
- **Modes:** vs Computer · Local 2-Player · Online · Training (How to Play guide + 18 lessons)
- **Stack:** TypeScript · Vite · Three.js · chess.js · custom alpha-beta AI · Node WebSocket server

## Status

- **M1, playable chess:** done. A 3D board with placeholder cutout pieces, full rules, vs Computer
  (our own AI, 4 difficulty levels) and Local 2-Player.
- **M2, online play:** done. Private rooms with a 6-character code or invite link, a server that
  checks every move, reconnecting within 60 s, resign, draw offers, and rematches (sides swap).

Next up: **M3, real cutout art**.

## Run it

Requires Node 22.18+ (the server runs TypeScript directly).

```sh
# Game server (needed for online play): ws://localhost:8787
cd server
npm install
npm start
npm test           # protocol, rules and reconnect tests

# Client: http://localhost:5173
cd client
npm install
npm run dev
npm test           # rules + AI tests (perft, mate finding)
npm run build      # production build in client/dist
```

To play online on one computer, open two browser windows: one creates a room, the other joins with
the code. Set `VITE_SERVER_URL` (e.g. `wss://your-server.example`) when building for a hosted server.

The wire protocol lives in [`shared/protocol.ts`](shared/protocol.ts).

Dev-only preview pages: `/src/render/preview.html` (board and animations), `/src/ui/preview.html` (menus and HUD).
