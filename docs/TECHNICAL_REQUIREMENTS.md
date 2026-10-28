# BattleCore: Technical Requirements

> **Status:** v1.0, written at the close of M6 (2026-10-27) · **Companion to:** [DESIGN.md](DESIGN.md)
>
> This document records what the shipped game requires and guarantees today: platforms, budgets,
> subsystem contracts, hosting and the asset pipeline. Anything not built yet is marked **(not built)**.

---

## 1. Scope

BattleCore is a browser 3D chess game: Baby Army (white) vs Armored Dinos (black), with a 3D fight
scene on every capture. It ships as two deployables:

| Part | What it is | Where it runs |
|---|---|---|
| **Client** | Static site (TypeScript, Vite, Three.js) | Netlify: https://prepotentebattle.netlify.app |
| **Game server** | Node.js WebSocket server for online play | Fly.io: `wss://battlecore-server.fly.dev` |

vs Computer and Local 2-Player run entirely in the browser. Only Online mode uses the server.

---

## 2. Platform Requirements

### 2.1 Browsers (client)

The client requires the following browser features. There is no fallback path if one is missing.

| Feature | Used for |
|---|---|
| **WebGL 2** | All rendering (Three.js r186 requires WebGL 2) |
| **ES modules + dynamic workers** (`new Worker(url, { type: 'module' })`) | The AI search worker |
| **WebAssembly** | The meshopt decoder for the compressed 3D models |
| **WebP image decoding** | Model textures (`EXT_texture_webp`) |
| **Web Audio API** | Sound effects and the music bus (audio is optional; the game runs silently without it) |
| **WebSocket** | Online play only |
| **Pointer Events** | Mouse, touch and pen input |

**Supported targets:** current Chrome, Edge, Firefox and Safari on desktop, plus iOS Safari 15+ and
Android Chrome. Music ships as MP3, not OGG, so Safari can play it.

### 2.2 Devices and layout

- **Desktop first**, mouse and keyboard; fully playable by touch on phones and tablets.
- **Portrait phones** down to **360 px** wide. The HUD reports which screen edges it covers, and the
  camera offsets the view so the board stays centered in the free area.
- Intro and fight shots keep a 16:9 frame on narrow screens: the camera widens its lens (max 70°)
  and pulls back.
- Touch targets aim for at least 40 px. Press-and-hold (450 ms) shows a piece's name tag; a tap selects it.
- **Landscape phones:** work, but have no dedicated layout.

### 2.3 Server runtime

- **Node.js 22.18 or newer.** The server runs TypeScript directly with Node's built-in type stripping,
  so there is no build step. Production uses the `node:24-slim` image.
- `shared/protocol.ts` must stay **erasable-syntax only** (no `enum`, `namespace` or parameter
  properties) so Node can run it as-is.

### 2.4 Development tooling

| Tool | Version |
|---|---|
| Node.js | 24 (Netlify build), 22.18 or newer locally |
| TypeScript | 7.x |
| Vite | 8.x |
| Vitest | 5.x |
| `@gltf-transform/cli` | 4.x (via `npx`, for model optimization) |
| ffmpeg | Any recent build (audio trimming and normalizing) |
| flyctl | Server deploys |

---

## 3. Performance Requirements

### 3.1 Download budget

Only the models gate the start of play. Music streams as it plays.

| Asset group | Size | Loading |
|---|---|---|
| JS bundle | ~870 KB (~235 KB gzip) | Blocking |
| Sticker art (`assets/pieces`, 15 PNG) | 4.7 MB | Loaded with the board |
| Fighter models (`assets/fighters`, 15 GLB) | 7.0 MB | Background preload; gates the start card |
| Intro models (`assets/intro`, 3 GLB) | 1.8 MB | Background preload; gates the start card |
| Sound effects (`assets/audio/ai`, `assets/audio/kenney`) | ~1.5 MB | On first use, then cached |
| Music (`assets/audio/music`, 5 MP3) | ~6.9 MB | Streamed per track |

**Rules**
- Every shipped GLB **must** be meshopt-compressed (§7.1). Uncompressed Meshy output runs 1–2 MB per
  model, about 3x larger.
- The "Tap to start" card waits for the intro and fighter models, **capped at 30 s**. After that, any
  model still missing is replaced by its procedural stand-in, so a fight never waits on the network.
- Netlify serves `/assets/*` with `Cache-Control: public, max-age=604800` (7 days). Asset filenames
  are **not** content-hashed, so a changed asset can reach returning players up to 7 days late.
  Either rename the file when its contents change, or accept the delay.

### 3.2 Frame rate and rendering

- **Target:** 60 fps on desktop and a steady 30 fps or better on mid-range phones, including during fights.
- **Pixel ratio cap:** 2 on desktop, 1.5 on touch devices (`pointer: coarse`).
- **Adaptive resolution:** every 2 s the renderer averages frame time. Above 24 ms it lowers the pixel
  ratio by 0.25, never below 1, and never raises it again in that session. The first 6 s, and any
  frame over 250 ms (tab switches, loading), are ignored.
- **Shadows:** one directional sun with PCF shadows. The shadow map is 2048² on desktop and 1024² on touch devices.
- **Model budget:** each fighter is about 20–50k triangles with one 1024² WebP texture. Intro
  characters are 40–65k triangles with one 2048² texture each.
- **No first-use hitches:** once the models load, the board view uploads each model's textures
  (`initTexture`) and compiles its shaders (`compileAsync`), **one model per frame**. The intro
  waits for this to finish.

### 3.3 AI responsiveness

The search runs in a Web Worker and never blocks rendering or input.

| Level | Depth cap | Time budget | Deliberate error (centipawns) |
|---|---|---|---|
| Easy | 2 | none | 150 |
| Medium | 3 | none | 40 |
| Hard | 8 | 1.0 s | 0 |
| Max | 64 | 2.5 s | 0 |

A crashed or cancelled worker is recreated on the next request.

---

## 4. Functional Requirements by Subsystem

### 4.1 Chess core (`client/src/core`)

- Standard chess rules via the **shared rules engine** (`shared/rules/`, used by the client, AI and server;
  cross-checked against chess.js in tests): castling, en passant, promotion (player chooses Q/R/B/N),
  check, checkmate, stalemate, threefold repetition, insufficient material and the fifty-move rule.
- Game logic **never imports rendering code** (this keeps a future engine port small; see DESIGN.md §9).
- Pawn looks are assigned by **starting file** (`pieces.json` `looks`, `core/looks.ts`), so a pawn
  keeps its look for the whole game.

### 4.2 Rendering (`client/src/render`)

- Board pieces are **paper-cutout stickers** (PNG textures with an alpha mask). Picking is
  pixel-accurate, using an alpha mask downsampled 8x.
- A camera rig with orbit, optional auto-rotate each turn, view offsets for HUD insets and
  tweened cinematic shots.
- Check effects: the king shivers and flashes red, a ring pulses and the board shakes. Checkmate
  effects: the king topples and turns grey, a flash, a gold ring, and the winning pieces bounce.

### 4.3 Fight scenes (`client/src/fight`)

- Each capture plays a 3D fight between the two pieces, choreographed from `data/fights.json`.
- Modes: **Full** (~3–6 s), **Quick** (~1.5 s) and **Off** (a poof only).
- The models are static textured Meshy GLBs moved by code. The one exception is the **rigged Baby
  Rifleman** (`w-p`), which plays its idle and hit-reaction clips and holds a toy blaster on its
  `RightHand` bone. Its Meshy attack clip is deliberately not used.
- Per-model yaw, scale, muzzle point, flier flag and hand bone live in `data/fighter-models.json`.
- Any fight must be abortable at once (undo, new game, menu) and hand the camera back.

### 4.4 Intro cinematic (`client/src/cutscene`)

- About 50 s across 11 beats. It can be skipped with any key or tap.
- Setting: **Always / First time (default) / Never**, saved in `localStorage`. `?intro=1` forces the
  intro and `?intro=0` skips it.

### 4.5 Audio (`client/src/audio`)

- Every sound goes through a named cue (`sfx('name')`). Cues with a recording play the file; the rest
  fall back to a Web Audio synth recipe.
- The audio context unlocks on the first pointer or key event (browser autoplay rules). The start
  card guarantees that gesture.
- Separate **music** and **effects** buses feed one master bus and a compressor.
- Settings: Sound mode (On / Effects / Off), a mute button, and **Music** and **Effects** volume
  sliders (0–100 %, applied as gain = level²), all saved in `localStorage`.
- Audio pauses while the tab is hidden.

### 4.6 HUD and menus (`client/src/ui`)

- Modes: vs Computer, Local 2-Player and Online.
- Settings for side, difficulty, auto-rotate, capture fights, intro and sound.
- Undo, flip, menu and forfeit buttons (forfeit needs two clicks). On phones the toolbar becomes an icon row.
- A credits dialog lists Meshy AI, ElevenLabs, Kenney (CC0) and three.js.

### 4.7 Persistence (client)

`localStorage` holds settings only; no game progress is saved. Every read and write tolerates
storage being unavailable.

| Key | Contents |
|---|---|
| `battlecore.menu.v1` | Menu choices (mode, side, level, fights, intro, auto-rotate) |
| `battlecore.audio.v1` | Sound mode, mute, music and effects volume |
| `battlecore.intro.seen` | Whether the first-time intro has played |

Resuming an online game after a page reload is **(not built)**.

---

## 5. Online Play

### 5.1 Protocol (`shared/protocol.ts`)

- JSON over WebSocket. `PROTOCOL_VERSION = 1`. The client must send `hello` with its version first,
  and a mismatch is refused with `bad-version`.
- **Room codes:** 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, with no 0/O/1/I/L to avoid misreads.
- Player names are 16 characters at most, with control characters stripped (`cleanName`).
- Moves are sent as UCI with a `ply` counter, so stale or duplicate sends are rejected.
- Supported actions: resign, offer and answer a draw, rematch (sides swap) and leave.

### 5.2 Server guarantees (`server/`)

- **The server is authoritative.** It validates every move with the shared rules engine; clients only send requests.
- **Reconnects:** a dropped player's seat is held for **60 s** (`RECONNECT_GRACE_MS`). After that the
  player forfeits (`abandon`).
- **Limits:** messages are 4 KB at most, text frames only, and 20 messages per second per connection
  (going over closes the socket with 1008). A heartbeat ping runs every 15 s.
- `GET /health` serves Fly's health check. The server shuts down gracefully on SIGTERM.

### 5.3 Hosting constraints

- **Rooms live in memory,** so the server must run on **exactly one always-on machine**:
  `auto_stop_machines = "off"`, `min_machines_running = 1`, and always deploy with
  `fly deploy --ha=false`. A restart or redeploy ends every game in progress.
- Machine: Fly `shared-cpu-1x`, 256 MB, region `iad`, internal port 8787.
- Scaling past one machine would need shared room state (e.g. Redis) or sticky routing by room code
  **(not built)**.

---

## 6. Build, Deploy and Configuration

| Item | Value |
|---|---|
| Client build | `cd client && npm run build` (typecheck, then `vite build`, output in `client/dist`) |
| Client deploy | Netlify builds automatically from `main` (`netlify.toml`, `base = "client"`) |
| Server URL | `VITE_SERVER_URL`, baked in at build time and set in `netlify.toml`, which overrides the Netlify UI |
| Server deploy | `fly deploy --ha=false` from the repo root (the root `Dockerfile` copies `shared/` and `server/`) |
| Local client | `npx --prefix client vite client --port 5174` |
| Local server | `cd server && npm start` (`ws://localhost:8787`) |

**Changing the server URL requires a client redeploy.**

Dev-only pages:

| Page | Shows |
|---|---|
| `src/render/preview.html` | Board and animations |
| `src/ui/preview.html` | Menus and HUD |
| `src/fight/preview.html` | Any attacker vs defender, a sound board and music |

---

## 7. Asset Pipeline Requirements

### 7.1 3D models

1. Generate the model with Meshy image-to-3D (`meshy-7.1`) from the sticker art in `art-source/pieces/`.
   Task IDs are recorded in `art-source/models/meshy-tasks.json`, and the raw downloads (gitignored)
   go to `art-source/models/raw/`.
2. Optimize the model for the web:
   ```sh
   npx @gltf-transform/cli optimize in.glb out.glb --compress false \
     --simplify-ratio 0.025 --simplify-error 0.002 --texture-compress webp --texture-size 1024
   npx @gltf-transform/cli meshopt out.glb client/public/assets/fighters/<key>.glb
   ```
3. Load every model through `render/gltf.ts` (`gltfLoader()`), which has the meshopt decoder.
   A plain `GLTFLoader` **cannot** read the shipped files.
4. Each model must face local +Z after its `yaw` tuning. Tune yaw, scale and muzzle in
   `fighter-models.json`, not in the file.
5. **Rigging:** Meshy auto-rig works only on **empty-handed T-pose** models; weapons are attached in
   code. Do not auto-rig models that are already holding weapons.

### 7.2 Audio

- Sound effects come from Kenney packs (CC0) and ElevenLabs. They are trimmed and normalized with
  ffmpeg and shipped as **MP3**. Generation prompts are recorded in `art-source/audio/PROMPTS.md`.
- Every recorded cue must keep a synth fallback in `cues.ts`.

### 7.3 Licensing

- **Kenney assets:** CC0.
- **ElevenLabs and Meshy output:** used under the account owner's plan terms.
- **Credits:** every new third-party source must be added to the credits dialog (`CREDITS` in `ui/index.ts`).

---

## 8. Quality and Testing

- **Unit tests (Vitest):** chess rules and perft, AI mate-finding, piece looks and fight choreography
  in the client; protocol, rules and reconnects on the server (the message-size and rate limits are not
  covered yet). Both `npm test` suites and
  `npm run typecheck` must pass before a push.
- **Visual checks:** WebGL renders in headless Chrome with
  `--use-angle=swiftshader --enable-unsafe-swiftshader`, which is good enough for static screenshots.
  Animation timing and feel must be judged in a real browser or on a real phone.
- **Playwright smoke tests:** **(not built)**.

---

## 9. Known Limitations

- Asset filenames are not content-hashed (see §3.1 caching).
- The server keeps rooms in memory, runs on a single machine and has no persistence (§5.3).
- There are no accounts, matchmaking, clocks, spectators or ratings.
- Landscape phones have no dedicated layout.
- Of the fighter models, only the Baby Rifleman is rigged; the rest are moved by code.
- The JS bundle is one chunk of about 870 KB; it is not code-split.
