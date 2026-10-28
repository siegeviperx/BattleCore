# Making a Piece Pack

> For pack makers (siegeviperx and Chris). Plan and background: [PLATFORM.md](PLATFORM.md) §3.

A **pack** is one army: six chess pieces with names, colors, sticker art, 3D fight models and fight moves.
A matchup is two packs. The **pack tool** is a command-line tool you run on your own computer. It never ships
with the game: it calls Meshy to make art and models, shrinks them for the web, and writes them into the pack
folder. You commit that folder and open a pull request. Once it's merged, Netlify builds the game with the pack.

```
client/src/packs/<id>/          ← ships with the game (committed)
  pack.json                       names, colors, fight moves, which files each piece uses
  pieces/<slot>.png               sticker art, 512×640
  models/<slot>.glb               3D fight model, compressed
art-source/packs/<id>/          ← working files (committed, except raw/)
  style.md                        the look every piece shares (added to every art prompt)
  concept/                        1-5 style reference images
  pieces/<slot>.png               art straight from Meshy, before it becomes a sticker
  meshy-tasks.json                Meshy task IDs, so nothing is paid for twice
  raw/<slot>.glb                  full-size models from Meshy (gitignored, about 25 MB each)
```

**Slots** name a piece: `k q r b n p` (king, queen, rook, bishop, knight, pawn). Extra looks for the same piece
are `p2`, `p3`, `p4`, …; pawns cycle through their looks by starting file, like the four Baby Riflemen.

---

## 1. One-time setup

1. Install **Node.js 22.18 or newer** and **Python 3**, then run `pip install pillow`.
2. Install everything from the repo root:
   ```sh
   npm install
   cd client && npm install && cd ..
   cd server && npm install && cd ..
   ```
3. Get your own Meshy API key (meshy.ai → API settings) and create a file named `.env` in the repo root:
   ```
   MESHY_API_KEY=msy_your_key_here
   ```
   `.env` is gitignored. **Never commit it, paste it into chat, or put it in a screenshot.**
4. Check it works (free): `npm run pack:balance`

## 2. Start a pack

Work on a branch: `git switch platform && git switch -c pack/dragons`.

```sh
npm run pack:new -- dragons --name "Dragon Clans" --short Dragons --primary "#1f6b63" --secondary "#d9a93a" --base "#203a3a"
```

Then:
- Edit **`art-source/packs/dragons/style.md`**. This text starts every art prompt, so it keeps the six pieces
  looking like one set.
- Put **1–5 reference images** in `art-source/packs/dragons/concept/`. Every piece is generated in their style.
  The Baby Army used `docs/concept/` paintings.
- Open **`client/src/packs/dragons/pack.json`** and fill in real names and icons (any emoji). Fight moves can wait.

## 3. Make the pieces, one at a time

```sh
npm run pack:piece -- dragons k --prompt "an elder dragon king, gold crown, sitting on a stone plinth"
```

The tool shows what it will do and what it costs, then asks before spending anything:

```
Dragon Clans King, slot "k":
  • sticker art with nano-banana-pro (9 credits)
  • 3D model with meshy-7.1, textured (30 credits)
  Total: 39 credits. Your balance: 1615.
Spend 39 credits? [y/N]
```

It takes a few minutes, mostly the 3D model. When it finishes, the sticker and model are in the pack, and
`pack.json` points at them.

**Make one piece first and look at it before doing the rest.** If the style is off, fix `style.md` or the
references before spending on the other five.

Useful options:

| Option | What it does |
|---|---|
| `--image my-art.png` | Use your own transparent PNG instead of generating art. Only the 3D model costs credits. |
| `--art-only` | Make just the sticker (9 credits). Check it, then run again with `--model-only`. |
| `--model-only` | Make the 3D model from the art you already have. |
| `--ref extra.png` | One more style reference for this piece only. |
| `--fresh` | Throw away this slot's earlier Meshy results and pay for new ones (a redo). |
| `--yes` | Don't ask before spending. |

**Credits are never spent twice by accident.** Each Meshy job is recorded in `meshy-tasks.json` the moment it
starts. If your connection drops or you press Ctrl+C, run the same command again and it picks up the same job
for free. Failed jobs are refunded by Meshy. To redo a piece you didn't like, add `--fresh`.

## 4. See it fight and tune it

```sh
npm run pack:preview -- dragons            # Dragons attack Dinos
npm run pack:preview -- dragons --side b   # Dragons play black
```

This opens the fight preview, where you can pick any attacker and defender. It also prints a link to the full
game with your pack in it. If a model looks wrong, fix it in that look's `tuning` in `pack.json`, not by
regenerating:

| `tuning` field | Use it when |
|---|---|
| `"yaw": 3.14` | The model faces the wrong way (radians: 1.57 is a quarter turn, 3.14 a half turn) |
| `"scale": 1.2` | It's too small or too big next to the other pieces |
| `"muzzle": [0.3, 0.6, 0.4]` | Shots come from the wrong place (side, height, forward, as fractions of its height) |
| `"flier": true` | It should hover (or `false` if the model brings its own flight stand) |

Save `pack.json` and the preview page reloads.

## 5. Pick fight moves

Each piece has an `attack` and a `knockout`. Pick them from the move library (`npm run pack:check` lists the
current names):

| Attacks | |
|---|---|
| `burst` | Rapid shots. Options: `shots`, `projectile`, `color`, `"then": "tackle"` |
| `snipe` | One aimed shot |
| `pounce` | Leap onto the target |
| `charge` | Run it down |
| `dive` | Swoop from above. Option: `strafe: { shots, projectile, color }` |
| `volley` | Lobbed shots. Options: `count`, `projectile`, `color`, `arc`, `"windup": "roar"` or `"command"` |
| `twirl` | Spin attack. Options: `turns`, `shots`, `projectile`, `color` |
| `breath` | Breathe fire |

Knockouts: `pratfall`, `spinout`, `launch`, `topple`, `flatten`.
Projectiles: `dart`, `ball`, `boulder`, `missile`, `bottle`, `bullet`.

Example:
```json
"attack": { "kind": "volley", "count": 3, "projectile": "ball", "color": "#ff7a1a", "arc": 1.1, "windup": "roar" },
"knockout": { "kind": "spinout" }
```

A brand-new kind of move, like a wing-buffet gust, is code: ask siegeviperx.

## 6. Check and send it in

```sh
npm run pack:check -- dragons
```

✖ lines must be fixed (for example a missing file or a misspelled move). ⚠ lines are fine while the pack is
unfinished: a piece with no art shows a drawn placeholder, and a piece with no model fights as a procedural toy.

Then commit the pack folder and the `art-source/packs/dragons/` files (`raw/` is ignored automatically), push the
branch, and open a pull request into **`platform`**. GitHub runs the tests and `pack:check` on every pull
request.

---

## Art rules

- **Original or public-domain characters only.** No DC, Marvel, Disney, Pokémon or other brands, even renamed.
  Aesop's Fables, myths and generic types ("caped crusader") are fine.
- **Kid characters hold clearly toy weapons** (foam-dart blasters, water pistols). Meshy refuses "toddler with a
  rifle". Refused prompts aren't charged.
- **Toy-like and funny, never gory:** fierce but cute, slapstick knockouts.
- Each army needs **its own colors**, different enough from the army it fights (the Dinos are red).
- Keep a plain background in prompts; the tool asks Meshy to remove it.

## If something goes wrong

| Message | Fix |
|---|---|
| `MESHY_API_KEY is not set` | Create `.env` in the repo root (step 1.3) |
| `402` / not enough credits | Check `npm run pack:balance`; nano-banana-pro needs a Meshy Pro plan |
| `Python was not found` / `Sticker build failed` | Install Python 3 and run `pip install pillow` |
| A Meshy task `failed` | It was refunded. Change the prompt and re-run with `--fresh` |
| `pack.json is not valid JSON` | A comma or quote is off; the message gives the position |
| Pack doesn't show up in the preview | The folder name must equal the pack's `"id"`; run `pack:check` |
