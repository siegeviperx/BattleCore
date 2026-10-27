# BattleCore audio: AI generation prompts

Free CC0 packs (Kenney) cover the UI, impact, footstep and jingle sounds. The sounds below are the ones the packs
can't do well: the voices, a few cartoon toy-weapon effects, and the music. Generate them, then drop the files into
`art-source/audio/ai/` using the **file name** given. I trim them, set loudness, and wire them in.

Format: MP3 or WAV are both fine. Make 2–3 takes of each voice line so repeated sounds don't feel identical
(name them `giggle-1`, `giggle-2`, ...).

---

## 1. Sound effects (ElevenLabs → Sound Effects)

Set the duration where given; otherwise leave it on auto. Prompt influence around 0.5–0.7.

### Baby voices
| File | Duration | Prompt |
|---|---|---|
| `giggle-1..3` | 1.5 s | Happy toddler giggle, short burst of delighted baby laughter, close mic, dry, no background |
| `babble-1..3` | 2 s | Curious baby babbling nonsense syllables, cute and playful, close mic, dry, no background |
| `cry-1..2` | 1.5 s | Tiny toddler battle cry "Chaaarge!", brave but adorable, shouted, close mic, dry |
| `cheer-1..2` | 1.5 s | Toddler cheering "Yay!" after winning, squeaky and triumphant, close mic, dry |

### Dino voices
| File | Duration | Prompt |
|---|---|---|
| `roar-1..3` | 2 s | Cartoon armored dinosaur roar, big and menacing but family-friendly, with a metallic mechanical servo whir underneath, dry, no background |
| `growl-1..2` | 1 s | Short low dinosaur growl of satisfaction, cartoon, with a faint mechanical servo, dry |

### Cartoon toy effects (the packs don't have these)
| File | Duration | Prompt |
|---|---|---|
| `shot-dart` | 0.5 s | Toy cork popgun firing, single sharp cork pop, dry |
| `shot-bullet` | 0.5 s | Toy blaster pew, single plastic laser-gun shot, cartoon, dry |
| `shot-ball` | 0.8 s | Toy cannon firing a ball, deep cartoon thump with a puff, dry |
| `shot-boulder` | 1 s | Wooden toy catapult release, creak then heavy whoosh, cartoon, dry |
| `shot-missile` | 1 s | Cartoon bottle rocket launch, fizzing whistle, dry |
| `shot-bottle` | 0.8 s | Baby bottle thrown with a cartoon boing spring sound, dry |
| `boom` | 1.5 s | Cartoon toy explosion, punchy pop and poof of smoke, not realistic, dry |
| `bonk` | 0.5 s | Cartoon bonk on the head, hollow plastic toy hit, dry |
| `whee` | 1 s | Cartoon slide whistle going up, character launched into the air |
| `squish` | 0.6 s | Cartoon squish, squeaky rubber toy squashed flat |
| `flame` | 1.5 s | Cartoon dragon fire breath whoosh, short burst, dry |
| `scratch` | 1 s | Vinyl record scratch, music stops abruptly |
| `stamp` | 0.6 s | Heavy rubber stamp slammed onto paper on a wooden desk, dry |
| `paper-flutter` | 0.5 s | Small paper cutout flipping and fluttering through the air, short |
| `toy-clatter` | 0.5 s | Small plastic toy dinosaur dropping and clattering onto a wooden table |
| `giant-stomp` | 1.2 s | Giant toddler footstep shaking a wooden table, deep boom with rattling toys |
| `squeak-step` | 0.4 s | Squeaky toy shoe step, cute single squeak |
| `transform` | 2 s | Magical toy transformation, sparkle shimmer rising into a mechanical clank and armor locking into place |
| `suit-up` | 0.6 s | Tiny helmet and gear snapping on, plastic click and buckle |

---

## 2. Music (Suno, ElevenLabs Music, or similar; instrumental only)

The style is a military marching band played on a toy box: snare, brass, glockenspiel, kazoo accents. It should be
playful, never grim. Turn on **instrumental**.

### `music-menu` (main menu theme, 1:30–2:00, should loop cleanly)
> Instrumental playful military march, toy box orchestra, crisp snare drum and marching bass drum, cheerful brass
> fanfare melody, glockenspiel and xylophone doubling the tune, kazoo accents, music box, 112 BPM, C major,
> heroic but cute, cartoon war game title theme, loopable, no vocals

### `music-battle` (in-game loop, 2:00+, quieter so it sits under the game)
> Instrumental light tension march for a cartoon strategy game, steady marching snare and soft timpani, pizzicato
> strings, low brass hits, occasional glockenspiel and toy piano, sneaky and playful, 100 BPM, minor key with
> playful moments, background music, unobtrusive, loopable, no vocals

### `music-intro` (intro cinematic score, about 50 s)
> Instrumental cinematic score for a cartoon toy war intro, starts with distant drums and sunset horns, giant
> footsteps rhythm, then playful mischievous toy music box, a cute lullaby glockenspiel moment, sudden stop, then a
> tense snare roll building into a heroic brass standoff fanfare, no vocals

### Stings (short, 2–5 s each)
| File | Prompt |
|---|---|
| `sting-victory` | Short triumphant toy brass fanfare with snare roll and cymbal, cartoon victory jingle, 4 seconds, instrumental |
| `sting-defeat` | Short sad trombone "wah wah wah" defeat jingle, cartoon, 3 seconds, instrumental |
| `sting-draw` | Short neutral two-note kazoo shrug jingle, cartoon, 2 seconds, instrumental |
| `sting-checkmate` | Dramatic orchestral hit with timpani and brass stab, cartoon, 2 seconds, instrumental |
| `sting-cute` | Cute music box and glockenspiel twinkle, 3 seconds, instrumental |
| `sting-standoff` | Western-style standoff brass hit with snare roll, cartoon, 3 seconds, instrumental |

---

## Licensing notes
- Check that your plan's terms allow commercial use if BattleCore may ever be sold; free tiers often don't.
- Kenney packs are CC0: no credit needed (we'll still credit Kenney in the game's credits).
