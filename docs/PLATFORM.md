# BattleCore Platform: Piece Packs and Creative Boards

> **Status:** Plan v0.1 · **Branch:** `platform` · **Written:** 2026-10-27
> **Authors of packs:** siegeviperx and Chris (repo access; siegeviperx is teaching the workflow)
> **Companions:** [DESIGN.md](DESIGN.md) (the game) · [TECHNICAL_REQUIREMENTS.md](TECHNICAL_REQUIREMENTS.md) (what ships today)

`main` stays the live Babies vs Dinos game. This branch turns BattleCore into a platform that supports:

1. **Piece packs.** You can swap one piece or a whole army: Dragons vs Dinos, Aesop's Fables, and so on.
2. **Creative boards.** Themed boards, plus **hazard squares that change the rules** (walls, fire, ice).
   Hazards must work in **online play from day one**.

The first proof is **Dragons vs Dinos**.

---

## 1. Decisions So Far

| Question | Decision |
|---|---|
| Who makes packs? | siegeviperx and Chris, committing to the repo. No player uploads for now. |
| Hazards online? | Yes, from day one. The server must enforce hazard rules, not just display them. |
| First matchup | **Dragons (white) vs Dinos (black).** It reuses the existing Dino army. |
| Branching | Develop on `platform`. `main` stays live until the platform build matches it. |

---

## 2. Core Idea: Two Kinds of Change

| | Piece packs | Board themes | Hazards |
|---|---|---|---|
| Changes the rules? | No | No | **Yes** |
| Needs server changes? | Only the pack IDs | Only the board ID | **Yes: the server runs the hazard rules** |
| Risk | Low | Low | High |
| Mostly | Data and art | Data and art | Code |

Packs and themes are content work. Hazards are engineering work: chess.js cannot model blocked squares, so
the game needs its own rules engine, shared by the client, the AI and the server (§5).

---

## 3. Piece Packs

### 3.1 The unit is one army, not a matchup

A **pack** is one army. A matchup is just two packs chosen in the menu, so the existing Dino pack
pairs with Dragons, Babies, or anything else without new work.

"Upload one piece" means replacing a single slot in a pack. Fallbacks (§3.4) keep a half-finished pack playable.

### 3.2 Pack layout

> **Status: done (P1 step 2).** Babies and Dinos live in `client/src/packs/babies` and `client/src/packs/dinos`,
> loaded by `client/src/packs/index.ts`. Packs sit under `src/` (not `public/`) so the build gives every
> asset a content-hashed URL, which fixes the 7-day cache problem. Each piece has a `looks` array; a look has
> `art`, `model` and `tuning`. Board definitions follow the same pattern in `client/src/boards/`.

```
client/src/packs/<pack-id>/        (found automatically; folder name = pack id)
  pack.json            manifest (below)
  pieces/<slot>.png    paper-cutout sticker art
  models/<slot>.glb    3D fighter model (meshopt-compressed)
  audio/<cue>.mp3      optional voice and effect overrides
art-source/packs/<pack-id>/
  concept/             prompts, concept images, rejected takes
  meshy-tasks.json     Meshy task IDs (raw downloads stay gitignored)
```

Slots are `k q r b n p`. Extra pawn looks are `p2`, `p3`, `p4`.

```jsonc
// pack.json
{
  "id": "dragons",
  "version": 1,
  "name": "Dragon Clans",
  "short": "Dragons",
  "colors": { "primary": "#1f6b63", "secondary": "#d9a93a", "base": "#203a3a", "emblem": "flame" },
  "credits": [{ "role": "3D models & art", "name": "Meshy AI" }],
  "pieces": {
    "k": {
      "name": "Elder Wyrm",
      "icon": "🐉",
      "art": "pieces/k.png",
      "model": "models/k.glb",
      "tuning": { "yaw": 0, "scale": 1.1, "muzzle": [0, 0.8, 0.5], "flier": false },
      "attack": { "kind": "breath", "projectile": "flame", "color": "#ff7a1a" },
      "knockout": { "kind": "topple" },
      "voice": { "attack": "audio/roar.mp3" }
    },
    "p": { "name": "Hatchling", "looks": ["p", "p2", "p3", "p4"] }
  },
  "summoner": null
}
```

Each pack's `pack.json` replaces what is spread across `pieces.json`, `fighter-models.json`,
`fights.json` and the audio cues today. The timing and camera settings in `fights.json` stay global.

### 3.3 Fights use a shared move library

Attacks and knockouts are picked by name from a shared library: `burst`, `dive`, `snipe`, `breath`,
`volley`, `charge`, `pounce`, `flatten`, `twirl`, `pratfall`, `topple`, `launch` and `spinout`. A pack
chooses moves and sets the projectile and color; it never contains code.

A new kind of move (say a wing-buffet gust for dragons) is written once in `client/src/fight/moves.ts`,
and then any pack can use it.

### 3.4 Fallbacks

Every missing piece of a pack still plays:

| Missing | Falls back to |
|---|---|
| `model` | The procedural toy fighter (exists today) |
| `art` | A plain cutout with the chess symbol in the pack's colors |
| `attack` / `knockout` | The default move for that piece type |
| Audio | The shared cue, then its synth recipe (exists today) |
| `summoner` | The generic intro (§3.6) |

### 3.5 Pack tool (`npm run pack:*`)

This automates the steps that were done by hand for the Baby Army:

```sh
npm run pack:new dragons                                     # scaffold the folders and pack.json
npm run pack:piece dragons k --prompt "..." [--image ref.png]
  # 1. sticker art   nano-banana-pro      (9 credits)
  # 2. 3D model      Meshy image-to-3d, meshy-7.1, textured   (30 credits)
  # 3. web copy      gltf-transform optimize + meshopt (see TECHNICAL_REQUIREMENTS §7.1)
  # 4. auto-tune     scale from the bounding box, weapon tip from the top-front of the box
  # 5. record task IDs in art-source/packs/<id>/meshy-tasks.json
npm run pack:check dragons     # validate pack.json, files, sizes, triangle and texture budgets
npm run pack:preview dragons   # open the fight preview with this pack loaded
```

**Rules for the tool**
- The tool **prints the credit cost and waits for confirmation** before spending anything.
- The Meshy API key comes from `MESHY_API_KEY` in a local `.env`, which is gitignored. It is never committed.
- `pack:check` runs in CI. A pack that fails cannot merge.

### 3.6 Intro

The current intro is built around the Giant Baby and the Baby Dino. It becomes:
- **A generic intro:** two hands dump toy chests onto the table, and each army suits up.
  It works with any pair of packs.
- **An optional `summoner` per pack** (e.g. the Giant Baby for the Babies) that replaces a hand when present.
- **Babies vs Dinos keeps today's intro exactly**, as a matchup-specific override.

### 3.7 Online play

- `create` carries the host's two pack IDs. The joining player's client downloads any pack it doesn't
  already have before the game starts. Packs are static files on Netlify, so this needs no new hosting.
- `PROTOCOL_VERSION` goes to 2. Old clients are refused with `bad-version`, as they are today.
- The server only checks that the pack IDs are on its known list. Packs never change the rules.

### 3.8 Content guidelines

- **Original or public-domain only on the public site.** DC and Marvel characters are trademarked
  and copyrighted, so use original superhero types instead (e.g. "Caped Crusader Corps"). Aesop's
  Fables are public domain.
- **Religious figures:** legally fine, but slapstick knockouts may offend. If a pack does this, give
  it gentler knockouts (e.g. a `bow-out` move instead of `pratfall`) and get a second opinion before merging.
- **Keep the house style:** fierce but toy-like, slapstick instead of gore, readable at sticker size.

---

## 4. Creative Boards

### 4.1 Board definition

```
client/public/boards/<board-id>/
  board.json
  textures/, models/   optional theme assets
```

```jsonc
// board.json
{
  "id": "volcano",
  "name": "Volcano Pass",
  "theme": { "squares": ["#5a3a2a", "#2a1a14"], "table": "basalt", "sky": "ember", "ambient": ["embers", "heat-haze"] },
  // Rank 8 first (as in FEN). "." = normal square; other characters map to hazards.
  "grid": [
    "........",
    "........",
    "...##...",
    "..f..f..",
    "..f..f..",
    "...##...",
    "........",
    "........"
  ],
  "hazards": { "#": "wall", "f": "fire" }
}
```

`boards/classic` is today's board. A board with no hazards is a **theme only**, and the rules are standard chess.

### 4.2 Tier 1: themes (visual only)

Square colors and materials, table, sky, props, lighting and ambient effects. "Half the board on
fire" can be purely visual: flames and embers over ranks 5–8 with standard chess rules.

### 4.3 Tier 2: hazards (rule changes)

First set. Every rule here is a draft to playtest.

| Hazard | Rule | Notes |
|---|---|---|
| **Wall** | No piece may enter. Sliders stop before it, and it blocks attacks (and so blocks check). | The simplest one, so it's built first |
| **Fire** | A piece may pass over it. A piece that **ends its move** there is removed at the end of that turn. A king may never end on fire. | A suicide move is legal but pointless; the AI must know that |
| **Ice** | A piece that lands there slides one more square the same way, if that square is free. | Knights and kings included; it changes what counts as check |
| **Crater** | Only knights may cross it or land on it. | Like a wall, except for knights |

**Board validity rules** (enforced by `pack:check`'s twin, `board:check`):
- Ranks 1, 2, 7 and 8 must be hazard-free, so every army starts complete.
- The layout must be mirror-symmetric between the two sides, so neither side gets an advantage.
- **Static hazards come first.** Hazards that move or spread (fire spreading each turn) come later and
  need a seed shared by the server, both clients and the AI.

**Open rule questions to settle in playtesting**
- Can a king castle **through** fire? (Proposal: no, the same as castling through check.)
- What about a pawn promoting onto fire? (It can't happen: rank 8 is always clear.)
- En passant onto ice: does the capturing pawn slide? (Proposal: yes, after the capture.)
- Do repetition and the fifty-move rule stay unchanged? (Proposal: yes.)

### 4.4 Notation

FEN can't describe hazards. A game is identified by **`boardId` + FEN + moves**. For the server and
the AI, the board's hazard mask is fixed input loaded from `board.json`. Moves stay in UCI.

---

## 5. Rules Engine: Replacing chess.js

> **Status: done (P1 step 1).** `shared/rules/board.ts` (move generator) and `shared/rules/game.ts` (SAN, FEN,
> history, endings) now run the client, AI and server. `client/src/core/rules.test.ts` cross-checks them against
> chess.js on random games (60 by default, `RULES_GAMES=1000` for a deep run). chess.js is a dev dependency only.

Hazards in online play mean the **server** must know the hazard rules. chess.js can't model them, so
the game moves onto one rules engine of its own.

**The starting point already exists.** `client/src/ai/engine.ts` has its own complete move generator
(a `Board` class on a 0x88 board, with `perft` tests) and doesn't use chess.js. The plan:

1. **Move the move generator into `shared/rules/`.** It stays dependency-free with erasable syntax only,
   so the Node server runs it directly, as it does `shared/protocol.ts`.
2. **Add a hazard mask:** a 128-entry array beside the board (0x88 indexing). Sliding loops stop at
   walls and craters, landing checks handle fire and ice, and attack detection respects walls.
3. **Swap callers over:**
   - `client/src/core/game.ts`, the 166-line wrapper that is the only chess.js user in the client
   - `server/src/rooms.ts`
   - The AI imports the move generator from `shared/rules`; its search stays in `client/src/ai`.
4. **Prove nothing changed on the classic board.** Run perft against chess.js on standard test
   positions, plus a randomized cross-check of thousands of games. These must match exactly before
   chess.js is removed.
5. **Make the AI hazard-aware.** For walls, the search handles it alone. For fire and ice, scoring
   must penalize standing on or next to them, or the AI walks into fire.

This engine is the critical path: hazards and online play both depend on it.

---

## 6. Dragons vs Dinos (First Matchup)

Dragons play **white** (they move first); the existing Dinos stay **black**. The Dragons must look
different from the red Dinos, so their colors are teal and gold. Roster draft, open to changes:

| Slot | Piece | Look (toy-like, fierce but cute) | Attack / knockout |
|---|---|---|---|
| K | **Elder Wyrm** | Big horned dragon in a gold crown, on a stone plinth | `breath` (flame) / `topple` |
| Q | **Storm Queen** | Sleek teal dragon with lightning crest | `volley` (lightning bolts) / `spinout` |
| R | **Dragon Roost** | Rocky tower with a dragon coiled around it | `volley` (fireballs) / `topple` |
| B | **Wyvern Sage** | Wyvern in hooded robes holding a glowing staff | `snipe` (magic bolt) / `twirl` |
| N | **Wyvern Rider** | Armored wyvern on a flight stand (`flier`) | `dive` / `launch` |
| P | **Hatchling** | Chubby baby dragon in an eggshell helmet; 4 looks (red, green, blue, gold) | `burst` (sparks) / `pratfall` |

**Budget estimate** (confirm before spending):

| Item | Credits |
|---|---|
| 6 pieces at about 39 each (9 for art + 30 for the 3D model) | ~234 |
| 3 extra hatchling looks | ~117 |
| Retakes allowance | ~80 |
| **Total** | **~430** |

The Meshy balance was about 1615 at the end of M6.

The matchup is done when:
- Dragons vs Dinos is playable in every mode, with every capture showing a real model.
- The generic intro plays it.
- `pack:check` passes.
- A Babies vs Dinos game looks exactly as it does on `main`.

---

## 7. Phases

| Phase | Deliverable | Done when |
|---|---|---|
| **P1: Refactor** | Babies and Dinos moved into `packs/`, `boards/classic`, a loader for packs and boards. **Rules engine in `shared/rules/`**, used by the client, AI and server; chess.js removed. | The game looks and plays exactly like `main`; perft and cross-checks match |
| **P2: Pack tool + Dragons** | `pack:new/piece/check/preview`, CI check, army picker in the menu, pack IDs in the protocol (v2), generic intro. Dragon pack built **by Chris**, with siegeviperx pairing. | Dragons vs Dinos works online between two browsers |
| **P3: Themes + walls** | `board.json`, two or three themes (volcano, haunted, frozen), wall hazard, board picker, server enforces walls | An online game on a walled board, with a server test that refuses an illegal move through a wall |
| **P4: Fire, ice, craters** | Remaining static hazards, a hazard-aware AI, the open rule questions settled | Playtested; the AI avoids fire |
| **P5: Later** | Moving and spreading hazards (shared seed), more packs, maybe player uploads | — |

P1 is the big refactor and should land before Chris starts on content, so his packs drop into the
final format.

---

## 8. Working Together (siegeviperx and Chris)

### 8.1 Branches and reviews

- `platform` is the integration branch. Netlify branch deploys give it its own preview URL.
- Pack work happens on `pack/<id>` branches (e.g. `pack/dragons`), with a pull request into `platform`.
- Engine and code work happens on `feat/<topic>` branches, with a pull request into `platform`.
- Every pull request: `npm test` and `npm run typecheck` (client and server), `pack:check` / `board:check`,
  and one review from the other person.
- `platform` merges into `main` only after P1's "looks exactly like `main`" check passes, so the live site
  never breaks.

### 8.2 Chris's onboarding checklist

1. Clone the repo, run `npm install` in `client/` and `server/`, and run both (see README "Run it").
2. Get his own Meshy API key into `.env` (`MESHY_API_KEY=...`). Never commit it.
3. Read this document, §3 and §6, plus TECHNICAL_REQUIREMENTS §7 (asset pipeline).
4. First exercise: re-skin **one** slot of a scratch pack (e.g. `pack/scratch`) and get it through `pack:check` and `pack:preview`.
5. Then build the Dragons pack, slot by slot, with a credit check before each generation.

### 8.3 Credit discipline

- Every generation states its cost first, and the person spending confirms it.
- Record every task ID in `meshy-tasks.json`, so nothing is generated twice.
- Fix facing and scale in `pack.json` tuning instead of regenerating.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| The rules-engine swap breaks normal chess | Perft plus a randomized cross-check against chess.js before chess.js is removed |
| Client and server rules drift apart | One rules module in `shared/`, imported by both |
| Hazard rules turn out unfun or unbalanced | Static walls first, mirror-symmetric boards, playtesting before fire and ice ship |
| AI is blind to hazards | Hazard-aware scoring in P4; walls work through search alone |
| Generated art is inconsistent across a pack | Shared style prompt per pack in `art-source/packs/<id>/concept/`, preview every slot before 3D |
| Pack size bloats downloads | `pack:check` budgets: about 50k triangles, one 1024² texture and under 1 MB per model |
| Assets cached for 7 days (`/assets/*` and future pack files) | Version pack paths (`packs/<id>/v<version>/`) or content-hash filenames |
