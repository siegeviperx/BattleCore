# BattleCore

Baby Army vs Armored Dinosaurs: a 3D chess game where every capture is a fight.

A giant baby and a baby dinosaur dump their toys onto a war-table chessboard. The dinos armor up, the
babies put on war paint, and both armies flatten into paper cutouts for a full game of chess. Every capture
plays an animated 3D fight scene.

![Concept](docs/concept/baby-army-vs-armored-dinosaurs.png)

- **Design doc:** [docs/DESIGN.md](docs/DESIGN.md)
- **Modes:** vs Computer · Local 2-Player · Online
- **Stack:** TypeScript · Vite · Three.js · chess.js · custom alpha-beta AI · Node WebSocket server

## Status

**M1, playable chess:** done. A 3D board with placeholder cutout pieces, full rules, vs Computer
(our own AI, 4 difficulty levels) and Local 2-Player. Next up: **M2, online play**.

## Run it

Requires Node 20+.

```sh
cd client
npm install
npm run dev        # http://localhost:5173
npm test           # rules + AI tests (perft, mate finding)
npm run build      # production build in client/dist
```

Dev-only preview pages: `/src/render/preview.html` (board and animations), `/src/ui/preview.html` (menus and HUD).
