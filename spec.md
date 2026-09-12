# Assembly Vale — Game Design Document (running spec)

Assembly Vale is a single-player, turn-tick production puzzle: lay conveyor belts from a mine to the Exchange, drop refining machines on the line, and fill every contract before the tick limit. This document describes the shipped game as it behaves today. Anything not yet built is listed at the end under "Design intent not yet implemented".

## 1. Overview

| | |
|---|---|
| Pitch | A valley-sized factory diorama where every build costs a tick and the clock only moves when you say so. |
| Genre | Production optimization / logistics puzzle, deterministic, no real-time pressure |
| Players | 1; asynchronous best-score comparison through local progress |
| Session | 2–6 minutes per round (120–360 ticks at 420 ms per auto-run tick, plus planning). A full Journey is 40 rounds. |
| Platforms | Desktop and mobile browsers; portrait and landscape |
| Rendering | Semantic HTML shell built by `js/app.js`; the board is a single 2D `<canvas>` redrawn from rules state. `vendor/three.module.min.js` is vendored but never loaded. |
| Audio | WebAudio synthesis with authored Opus one-shots layered on top (`sfx/`) |
| Persistence | `localStorage` key `assemblyvale.save.v1` (versioned, checksummed) |

File map:

| Path | Role |
|---|---|
| `index.html` | Entry point; loads the six classic scripts then `js/app.js` as a module. Cache-busted with `?v=gdd-1`. |
| `js/rng.js` | mulberry32 PRNG, FNV-1a `hashString`, three derived streams (rules, decor, av). UMD (`window.AVRNG`). |
| `js/rules.js` | Pure deterministic rules engine: `createGame`, `applyCommand`, `simulate`, legality checks, `hint`, hashing, serialization. UMD (`window.AVRules`). |
| `js/content.js` | Versioned data: goods, recipes, five themes, twelve ASCII layouts, 40 Journey stages, 5 lessons, 5 challenges, 3 practice presets, Score Chase, daily generator, `validateStage`. UMD (`window.AVContent`). |
| `js/store.js` | Save document (settings + progress) with FNV-1a checksum, migration, memory fallback; local leaderboard helpers; `loadRaw` parses a wrapped save string (local cache + cloud mirror). |
| `js/platform.js` | StarHermit host adapter (UMD, `window.AVPlatform`): fragment launch-token read/strip, `sub`+`game_scope` decode, Bearer auth, 45-min launch-token refresh, profile nickname, cloud-save mirror (zip+base64) with sync status. No-op without a token. |
| `js/audio.js` | Buses (music, effects, ambience, voice), 18 synthesized events, clip loader for `sfx/*.opus`, valley ambience, factory hum, generative pad. |
| `js/app.js` | Screens, board drawing, input, hints, undo, auto-run, progress recording. All UI strings live here. |
| `css/style.css` | Palette tokens, buttons, play layout, mobile breakpoint, reduced-motion rule. |
| `server.js` | Optional Node static server plus `GET /api/v1/time`. Declared in `starhermit.txt` as `server=server.js`. |
| `tests/rules.test.mjs` | 10 rules/content checks (`npm run test:rules`). |
| `tests/e2e.mjs` | Playwright playthrough at 1280×800 and 390×844 + shipped-server check (`npm run test:e2e`). |
| `sfx/manifest.txt` | Canonical SFX table (file, event id, sound, usage). `manifest.json` is the runtime/generator list of clips on disk, `manifest.md` is the human table. |
| `assets/` | Key art and illustrations (`keyart.webp`, `exchange-ledger.webp`, `help-line.webp`). |
| `coverart.png`, `icon.png`, `favicon.svg` | Store cover (1200×675), 256 px icon, tab icon. |
| `starhermit.txt` | `name=Assembly Vale`, `launch=index.html`, `owner=…`, `server=server.js`, `cover=coverart.png`. |
| `LICENSE.md` | PolyForm Noncommercial 1.0.0. |

## 2. Vision and design pillars

**The clock is yours.** Nothing moves until the player runs a tick (Space) or switches on auto-run (A). Every build, rotate, removal and upgrade also costs exactly one tick, so planning and running share one currency. Rules in: pausing at any time, unlimited thinking, undo where the mode allows. Rules out: real-time timers, input windows, anything that punishes slow reading.

**One line, then one machine.** The whole game is "goods ride belts the way the belt faces; a machine on the line turns one good into a better one". Rules in: four directions, one input and one output slot per machine, single-good contracts. Rules out: splitters, mergers, multi-input recipes, inventories, research trees.

**Gold is the only resource and it flows both ways.** Every sale pays gold immediately, gold buys the next building, leftover gold counts toward score when you win. Rules in: refunds on removal (half), cost scaling by stage. Rules out: energy, cooldowns, second currencies, cosmetic purchases.

**Inspectable and repeatable.** The same stage with the same command list always produces the same state hash. Seeds are visible in content, daily seeds derive from the UTC date, and the hint system uses the same legality functions the player does. Rules out: hidden multipliers, luck in resolution, hints that know things the rules do not expose.

**A tabletop you can read at a glance.** Sources are grey blocks with a letter, belts are brown with a gold arrow, machines are purple with a letter and level, the Exchange is a red `$`. Rules in: flat colour plus a glyph on every piece, a legend under the board, a text description of the selected cell. Rules out: effects that hide the arrow, camera moves, anything only expressed by animation.

## 3. Player experience

Target player: someone who likes tidy logistics puzzles and short rounds — the "one more stage" player on a phone or in a browser tab — not the 40-hour factory optimizer.

First 60 seconds (as taught by the UI, `renderTitle` → `renderJourneySelect` → `startRound` in `js/app.js`):

1. The title shows a one-paragraph rule summary, the key art, and seven mode buttons; **Play** or **Journey** is one tap away.
2. Journey stage 1 "First Ford" opens with the Belt tool already selected (`startRound` sets `tool = 'belt'`), the selection on the ore mine, the contract row "Contract Ore: 0 / 5", and the status line "Round started. Pick a tool and build toward the Exchange."
3. The footer hint (`hintText`) names a concrete cell: "Hint: place a belt at (2, 1) to carry goods onward." Pressing H selects that cell.
4. New buildings face the Exchange along the longer axis (`preferredDir`), so a first line usually points somewhere useful without touching Rotate.
5. Clicking rock says "Rock and water cannot be built on." and costs nothing; every refused action is explained in the status line (`REASON_TEXT`).
6. The first ore sells within a few ticks with a chime and "Sold Ore for 5 gold." Five sales stamp the contract and the results screen appears.

Lessons (Learn) are available from the title for players who want the rules one at a time; the Help screen (from Play or Pause) lists every rule and key.

Session shape: pick a stage → build 4–12 pieces → run → watch a stall → fix it (rotate or extend) → run to completion → results with a component breakdown → "Next stage" or "Play again". The emotional beat the game is built around is the moment a stalled line starts flowing: goods that were piling up at a machine suddenly stream to the Exchange and the sale chimes come in a run.

## 4. Core loop and rules contract

All rules live in `js/rules.js`; the UI never mutates state except through `applyCommand`.

### Board and entities (`createGame`)

- Grid of `cfg.board.cols × rows` cells (layouts are 6×4 up to 10×8). A cell is `null` (meadow) or one of:
  - `rock` / `water`: terrain, never buildable (`INVALID.BLOCKED`).
  - `source` `{item, dir, every, itemRef}`: emits one raw good (`ore`, `timber`, `wool`) every `every` ticks (4 or 5) onto itself; behaves like a belt for movement.
  - `sink`: the Exchange; exactly one per layout.
  - `belt` `{dir, itemRef}`: holds at most one good, moves it one cell per tick in `dir`.
  - `machine` `{recipe, dir, level 1–3, prog, inBuf, outBuf}`: one input slot, one output slot.
- Directions: `E S W N`; rotation order is that list (`DIR_ORDER`).
- State fields: `tick`, `gold`, `builds`, `progress` (per contract good), `sold`, `contractDone`, `score {goods, contractBonus, goldLeft, speedBonus, total}`, `elapsedMs`, `terminal`, `events`.

### Commands (`applyCommand`)

| Command | Legality (`checkPlace` / `checkRotate` / `checkRemove` / `checkUpgrade`) | Effect |
|---|---|---|
| `place {x,y,kind,recipe,dir}` | in bounds, cell empty, build limit not reached, recipe in `allowedRecipes`, gold ≥ cost | Cell created, gold −cost, `builds`+1, tick+1 |
| `rotate {x,y[,dir]}` | cell is belt or machine | Quarter turn clockwise (or explicit dir), tick+1 |
| `remove {x,y}` | cell is belt or machine | Refund `floor(cost/2)`, any carried good is lost (`spoil` event), tick+1 |
| `upgrade {x,y}` | `cfg.upgrades` true, cell is a machine below level 3, gold ≥ `upgradeCosts[level-1]` (25 then 45) | level+1, `prog` reset, tick+1 |
| `tick` | round not over | tick+1, then `stepSimulation`, then `checkTerminal` |
| `resign` | round not over | terminal `resigned`, loss |

Costs: belt 6; Smelter 40, Press 60, Sawmill 35, Workshop 55, Loom 35, Tailor 55 (`content.js RECIPES`), all multiplied by `cfg.costScale` (always 1 today). Refused commands return `{ok:false, reason}` and never change state (asserted by `tests/rules.test.mjs`). Note that build commands advance `tick` but do not run the simulation.

### Tick resolution (`stepSimulation`, strict order)

1. **Machines push out.** In row-major scan, a machine with an `outBuf` hands it to the cell it faces: sold at the sink, moved onto an empty belt/source, or into an empty machine `inBuf`. Each target accepts one item per tick (`claimed`).
2. **Belts advance.** Every belt/source carrying a good tries to move it one cell in its facing; the list is rescanned to a fixpoint so a whole chain moves in one tick. Facing off the board spoils the good; facing meadow, rock, water or a full cell stalls it.
3. **Machines work.** A machine with `inBuf` and an empty `outBuf` adds one to `prog`; at `processTime = max(1, ceil(time × [1, 0.66, 0.5][level-1]))` it emits the recipe output (`craft` event). Times: Smelter 4/3/2, Press 6/4/3, Sawmill 3/2/2, Workshop 5/4/3, Loom 3/2/2, Tailor 5/4/3.
4. **Sources emit** when `(tick − 1) % every === 0` and the source cell is empty.

Goods chains and sale values (`GOODS`): ore 5 → ingot 14 → plate 32; timber 4 → plank 11 → frame 26; wool 4 → cloth 12 → garment 30.

### Scoring (`deliver`, `finalizeScore`)

- `goods` += sale value of every delivered good, counted immediately.
- `contractBonus` += 150 the first time a contract line reaches its quota (`CONTRACT_BONUS`).
- `goldLeft` = remaining gold, **only on a win**.
- `speedBonus` = `(tickLimit − tick) × 2`, **only on a win** with a tick limit.
- `total` = sum of the four. Integers throughout.

Worked example (First Ford, the e2e path): six belts cost 36 of 60 gold; five ore sell for 25; the contract completes at tick 32 of 120. goods 25 + contract 150 + goldLeft (60 − 36 + 25 = 49) + speed (120 − 32) × 2 = 176 → **total 400**.

### Terminal states (`checkTerminal`)

- Win: every `cfg.contracts` line has `progress ≥ quota` → `contracts-complete`. Checked after every command, so a win is recognised the moment the last sale lands.
- Loss: `tick ≥ tickLimit` → `time-up` (a limit of 0 means no limit, used by Practice Relaxed).
- Loss: `resign` → `resigned`. The UI reaches this only through "Leave round"/"Title", which abandon the round without recording it.

Ties in the local leaderboard helper (`store.js sortEntries`): won before lost, higher score, fewer invalid actions, lower duration, then session id. Journey stars (`app.js starsFor`): 1 for the win, +1 for `tick ≤ par.ticks` (par = 70% of the limit), +1 for ending with at least the starting gold.

### RNG and determinism

`cfg.seed` is `hashString('assembly-vale:' + id)` for authored stages, an explicit seed for challenges (1101–1105) and Score Chase (777001), and `hashString('assembly-vale-daily:' + YYYY-MM-DD)` for dailies. Resolution itself uses no randomness; the seed selects the daily layout/theme and feeds `RNG.streams` for cosmetic variation. `hashState` hashes a stable-stringified copy without `events`; identical command lists give identical hashes (tested). `elapsedMs` is quantised to 100 ms from `cmd.atMs` so replays are stable.

### Undo and hints

- Undo (`app.js undo`) is enabled when `cfg.mechanics.undo` is true: Practice and Lesson rounds. Up to 50 previous states are kept; undo pops one, including ticks.
- `Rules.hint` returns, in priority order: (1) a stalled machine whose output faces something unusable → rotate, or an empty cell in front of it → place a belt; (2) a contract good with no matching machine → place that machine at `bestMachineCell` (prefers cells fed by a belt, faces away from the feeder); (3) any belt with empty meadow ahead → extend it one cell; otherwise no hint and the footer says to keep delivering.

## 5. Modes and progression

| Mode | Entry | Content | Undo | What is recorded |
|---|---|---|---|---|
| Journey | Title → Journey, or Play → Journey | 40 authored stages (`JOURNEY`), any stage playable at any time; mastery stages marked `*` | no | `journeyBest[id]` (score), `journeyStars[id]` on a win |
| Lessons (Learn) | Title/Play → Lessons | 5 lessons (`LESSONS`), each a small stage with an explanatory paragraph in the info panel | yes | `tutorialDone[id]` = true on a win; `✓` on the list |
| Daily Challenge | Title/Play → Daily Challenge | One config per UTC date (`dailyConfig`), tick limit 300, upgrades on | no | `dailiesDone[date]` best score, `stats.lastDaily` |
| Challenges | Title/Play → Challenges | Shoestring (90 gold), Express (190 ticks), Bare Hands (no upgrades), Lean Works (16 buildings), Grand Vale (all six recipes) | no | `challengeBest[id]` |
| Practice | Title/Play → Practice | Relaxed (basin, no limit), Standard (delta, 280), Veteran (delta, 280, plate + garment) | yes | global stats only |
| Score Chase | Title/Play → Score Chase | Fixed seed 777001, basin, all recipes, 8 plate + 8 frame + 8 garment, 500 gold, 360 ticks | no | `scoreChaseBest` |

Difficulty curve of the Journey (`content.js JOURNEY`): stages 1–4 belts only (ore contracts 5→12) on ford/bend/narrows/gorge; 5–8 add the Smelter; 9–12 the Sawmill and two-trade contracts; 13–16 upgrades and the Press (two-step chain); 17–20 the Loom on frost layouts; 21–25 Tailor and Workshop, ending in a four-recipe mastery on delta; 26–30 build limits (14–26 buildings); 31–35 lean purses; 36–40 "Express" stages with tight limits on tiers/switchback/crossroads, closing with Vale Mastery (six recipes, three contract lines, 600 gold, 340 ticks). Every fourth stage is a mastery stage. Themes rotate meadow → ember → frost → dusk → canyon by block.

Daily generation: `tier = dayNumber % 3` picks a recipe set (2, 3 or all 6 recipes) and a layout list that contains every needed source; the seeded rules stream picks layout and theme. The date comes from the client clock (`todayStr()`), and the config is immutable for that string (tested).

Content validation: `validateStage` checks that every contract good has an on-map raw source, every recipe in its chain is allowed, and the purse covers one chain plus four belts. `npm run test:rules` runs it over every Journey, Challenge, Practice and Score Chase definition.

Progress and unlocks: nothing is locked; stars, best scores and lesson ticks are the progression signals. Title footer shows rounds, wins and best score.

## 6. Controls and interaction

Desktop keyboard (`onKeyDown`, play screen only unless noted):

| Key | Action |
|---|---|
| Arrows | Move the selection cursor (clamped to the board) |
| Enter | Apply the current tool at the selection (ignored while a button has focus) |
| Space | Run one tick (ignored while a button has focus) |
| B / M / R / X / U | Select Belt / Machine (last chosen recipe) / Rotate / Remove / Upgrade |
| H | Hint: selects the suggested cell and explains it |
| Z | Undo (Practice and Lessons) |
| A | Toggle auto-run |
| P or Esc | Pause; on Pause, P/Esc resumes; on Help, Esc returns; on other screens Esc returns to the title |
| Tab | Standard focus order through every button and the board canvas |

Mouse and touch: tap a tool button, then tap a board cell — the tap both selects the cell and applies the tool (`onBoardClick`). Hover shows a pointer cursor over the board. There are no drags, no multi-touch, no long-press; `touch-action: manipulation` removes the double-tap zoom delay. Pointer position is mapped through the canvas bounding box, so the scaled-down mobile canvas stays accurate.

Input locking: there is none to lock — every command resolves synchronously. Auto-run advances one tick every `max(120, 420 / simSpeed)` ms and stops itself on a terminal state, on pause, or when the tab is hidden (`visibilitychange` → paused).

Feedback for every input: tool select → clink + "Tool: belt"; build → thunk + "Built a belt."; rotate → ratchet + "Rotated to face S."; remove → scrape; upgrade → servo; refused → buzz + reason; hint → chime; undo → zip; tick events → craft/deliver/contract/spoil sounds with sale text in the status line; auto-run → motor sound and the factory hum while running.

## 7. Screens and UI flow

State machine (`screen` in `app.js`, rendered by `render()`):

```
title ─┬─ mode-select ─┬─ journey-select ──┐
       ├─ journey-select│  lesson-select    │
       ├─ lesson-select ├─ challenge-select ├─ play ⇄ paused
       ├─ challenge-sel.├─ practice-select  │   │      └─ help → play
       ├─ practice-sel. ├─ daily (direct)   │   ├─ help → play
       ├─ daily (direct)└─ score-chase      │   └─ terminal → results ─┬─ play (again / next stage)
       └─ score-chase (direct) ─────────────┘                          ├─ mode-select
                                                                       └─ title
```

Every screen is rebuilt from scratch on transition (`clearNode(root)`); the play screen refreshes in place (`refreshPlay`) so keyboard focus survives and the canvas is not recreated. Leaving a round from Play or Pause discards it without a result.

Layouts:

- **Desktop (>720 px)**: header row (stage name, Gold pill, Tick pill, Pause, Help); three-column body — info panel (contracts, live score components, selected cell) | board canvas + legend | tool palette and action panel; footer with hint, live status line and Title button. Root is capped at 1180 px and centred.
- **Portrait and landscape mobile (≤720 px)**: columns stack; the board moves to the top (`order: -1`), then info, then tools/actions, then the footer. Header pills wrap onto a second line. The canvas scales to width with `height: auto`.
- Safe areas: `#root` padding is `max(12px, env(safe-area-inset-*))` on all four sides and the viewport uses `viewport-fit=cover`.
- Must never be cut off: the board, the Gold/Tick pills, the active tool button, "Run one tick", the status line. All are in normal flow, nothing is fixed or absolutely positioned, so the page scrolls rather than clips.

Board rendering (`drawBoard`): cell size = clamp(28, min(64, 640/cols, 512/rows)) device pixels; terrain checker, then belts/sources with their goods, then machines (input good top-left, output good bottom-right, `L2`/`L3` badge, gold facing tick), then the Exchange, then the white selection frame.

## 8. Art direction

The hero of every screen is the board: a clean tabletop diorama of a green valley with a handful of readable pieces. Chrome is dark forest green so the meadow glows; gold is reserved for primary actions, the selected tool, arrows on belts and the status line.

Palette (CSS tokens in `css/style.css`, canvas colours in `app.js`/`content.js`):

| Token / use | Hex |
|---|---|
| `--bg` page, `--bg-panel`, `--bg-panel-2` | `#101a14`, `#1b2a21`, `#24382b` |
| `--ink`, `--ink-dim` | `#eef6ee`, `#b7c9ba` |
| `--accent` (primary buttons, focus ring, belt arrows, status), `--accent-ink` | `#ffd166`, `#20180a` |
| `--line`, `--good`, `--bad` | `#3c5a45`, `#7fd48f`, `#ff9b8a` |
| Meadow tiles (theme `meadow`) | `#7fae66` / `#74a35c`; rock `#8b8f96`; water `#5f9ec7`; belt `#4c4438` |
| Source block, machine body, Exchange | `#3b3f45`, `#5b3f7a`, `#b5342a` |
| Machine level rings L1/L2/L3 | `#2b1d3a`, `#f1c40f`, `#e74c3c` |
| Goods | ore `#8d97a5`, ingot `#e0883b`, plate `#f2c14e`, timber `#9a6a3f`, plank `#c98d4b`, frame `#e0b06a`, wool `#e8e4da`, cloth `#7fa8d9`, garment `#b07fd9` |

Five stage themes (`THEMES`) recolour tiles, rock, water, belts and the arrow accent: Meadow, Ember (`#8a5340` tiles, `#ff9d5c` accent), Frost (`#bcccda`, `#7fd4ff`), Dusk (`#665580`, `#e8a0e8`), Canyon (`#c08153`, `#ffe08a`).

Shape language: everything is an inset square on a square tile — sources at 84%, belts at 76%, machines at 84%, the Exchange at 88% — with round-capped arrows and a single bold glyph (good initial, machine initial, `$`). Goods are small filled circles with a dark outline so they read on any theme.

Typography: `system-ui` stack, 16 px body, `h1` clamp(1.8rem, 5vw, 2.6rem), tabular numerals on pills and score rows, 62–70 ch measure on paragraphs and lists.

Motion: none in the board — state changes are instantaneous redraws, which keeps the tick as the unit of time. The only transitions are button press (1 px translate, removed under `prefers-reduced-motion`) and gain ramps in audio.

Visual assets the design calls for (all in `assets/`, generated with FLUX.2 klein, compressed to WebP, wired as decorative `<img alt="">` that remove themselves if the file fails to load):

- `keyart.webp` — title-screen hero and source of the cover: aerial diorama of the mine, a belt line, a purple smelter and the red-roofed Exchange.
- `exchange-ledger.webp` — results-screen illustration: the Exchange counter with stacked goods and a stamped ledger; desaturated on a loss (`.illus.lost`).
- `help-line.webp` — Help-screen diagram-style shot of mine → belts → smelter → Exchange.
- `coverart.png` — 1200×675 store cover cropped from the key art with the title set in DejaVu Sans Bold.

## 9. Audio direction

Mix philosophy: the round should sound like a small workshop in a quiet valley. Short dry transients on the effects bus for every logical event, a very quiet brown-noise "valley air" bed on the ambience bus, a 55 Hz low-passed sawtooth hum on the same bus only while auto-run is on, and a slow four-chord generative pad (A–G–F–E minor-ish walk, 5.2 s cycle, ≤0.05 gain) on the music bus. Bus gains: music 0.55, effects 0.9, ambience 0.5, voice 0.8 (`DEFAULT_SETTINGS`); "Sound: on/off" on the Pause screen mutes the master. Audio starts only from the user gesture that starts a round and is suspended when leaving to the title.

Clips: `js/audio.js` fetches `sfx/manifest.json` on start, binds each `event` to its `name`, and lazily decodes `sfx/<name>.opus` on first use. Until a clip is ready — or if it fails — the synthesized version plays, so the game is never silent and needs no preloading.

SFX event table (source of `sfx/manifest.txt`):

| Event id | File | Sound | Usage |
|---|---|---|---|
| `ui` | `ui-click.opus` | Soft wooden button click | Reserved generic acknowledgment (menus are silent today) |
| `tool` | `tool-clink.opus` | Wrench clink on a vice | Tool selected (button or B/M/R/X/U) |
| `place` | `place-thunk.opus` | Crate set down on concrete | Belt or machine placed |
| `remove` | `remove-scrape.opus` | Plank pulled free, soft thud | Building removed |
| `rotate` | `rotate-ratchet.opus` | Two ratchet clicks | Building rotated |
| `upgrade` | `upgrade-servo.opus` | Servo whir ending in a latch | Machine upgraded |
| `invalid` | `invalid-buzz.opus` | Dull rubbery buzz | Any refused command |
| `craft` | `craft-hammer.opus` | Hammer tap on metal | Machine finishes a recipe |
| `deliver` | `deliver-chime.opus` | Cash-register chime, coins | Good sold at the Exchange |
| `contract` | `contract-stamp.opus` | Rubber stamp then bell | Contract line completed |
| `spoil` | `spoil-splat.opus` | Wet splat | Good lost off the edge or in a removal |
| `win` | `win-fanfare.opus` | Short brass fanfare with bells | All contracts complete |
| `lose` | `lose-fall.opus` | Descending trombone slide | Tick limit or resignation |
| `undo` | `undo-zip.opus` | Tape measure rewinding | Undo |
| `hint` | `hint-chime.opus` | Glass-rod ping with shimmer | Hint |
| `star` | `star-sparkle.opus` | Glockenspiel sparkle | Reserved for star awards (not triggered yet) |
| `spawn` | `mine-spawn.opus` | Tiny pebble tock from a mine chute | Source emits a raw good |
| `auto` | `conveyor-motor.opus` | Conveyor motor spinning up | Auto-run toggled (synth fallback until the clip is decoded) |

Captions: when `settings.captions` is true, each event also writes a short caption ("build", "sale", "contract complete") to the status line via `setCaptions`.

## 10. Localization

Shipped language: English only. All player-facing strings are literals in `js/app.js` (screen text, `REASON_TEXT`, status messages, hint sentences) and `js/content.js` (stage, lesson, challenge and good names). There is no locale table, no language selection, and `<html lang="en">` is fixed. Spelling is mixed ("Fulfilling" on the title, "Fulfil" on Help). The nine target locales (en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT) are listed under "Design intent not yet implemented". Layout allowance for translation exists already: buttons are `flex: 1 1 220px` and wrap, tool labels are full-width, and no text is fixed-width, so 30% expansion does not clip.

## 11. Accessibility

- Keyboard-only path: every screen is reachable by Tab + Enter on real `<button>`s; the board canvas is focusable (`tabindex=0`, `role=application`, descriptive `aria-label`) and fully playable with arrows, Enter, Space and the letter keys. There are no keyboard traps; Esc always goes back.
- Focus: `:focus-visible` draws a 3 px gold outline on buttons and the canvas; `refreshPlay` restores focus to the same tool button after the palette is rebuilt.
- Screen reader: the status line is `role=status aria-live=polite` and announces the selected cell ("(2, 1) belt facing E carrying Ore"), every result of an action, every sale and every refusal. Tool buttons carry `aria-pressed`. Contracts and score are plain text rows.
- Contrast: `#eef6ee` on `#101a14` (≈15:1), `#20180a` on `#ffd166` (≈11:1), dim text `#b7c9ba` on panels (≈8:1).
- Target size: all buttons are ≥44 px tall with 8–10 px gaps; board cells are ≥28 device px and scale with the canvas.
- Reduced motion: honoured by the `prefers-reduced-motion` rule; the game has no other animation.
- Colour is never the only cue: every piece has a glyph, machines show `L2/L3` text, the legend labels each colour, and the info panel describes the selection in words.
- Audio is optional: nothing in the rules depends on hearing an event; captions can mirror events to the status line.

## 12. StarHermit integration

Packaging follows the wiki conventions (https://wiki.starhermit.com/): `starhermit.txt` at the distribution root with `name`, `launch=index.html`, `owner`, `server=server.js`, `cover=coverart.png`; everything beside it is uploaded.

Used today:

- **Server script**: `server.js` serves the static distribution, refuses paths outside the root, answers `GET /api/v1/time` with `{time}` (ms). It has no game logic and holds no state.
- **Host adapter** `js/platform.js`: reads `#game_token=<jwt>` from the URL fragment (query fallbacks for local dev, stripped after read), decodes `sub` + `game_scope` (slug never hard-coded), sends `Authorization: Bearer`, re-mints the token every 45 min via `POST /api/v1/games/{slug}/launch-token` (60 s retry on failure), fetches the display name from `GET /api/v1/users/{sub}/profile` (nickname, fallback `Player ` + id8; never `/api/v1/me`, never usernames), and mirrors the save document to the cloud slot `GET/PUT /api/v1/me/cloud-saves/{slug}` (stored-zip + base64, one slot). Remote save wins on load; localStorage stays the offline cache; saves debounce 2 s and flush on `pagehide`/hidden. Without a token every call is a no-op and play is unchanged. The title footer shows the account line (nickname + sync status).

Not used: presence heartbeats, achievements, leaderboards (the `store.js` board helpers and tie-break order exist but `app.js` never calls them), sessions/matchmaking, replays upload, chat, voice, relay. Multiplayer is out of scope for this ruleset. The daily uses the client clock rather than `/api/v1/time`.

## 13. Technical architecture

- **Module boundaries**: `rng` → `rules`, `content` (both UMD, Node-testable, no DOM, no `Date`); `store` and `audio` are browser globals; `app.js` is the only module that touches the DOM and the only caller of `Rules.applyCommand`. `content.js` is data plus validators; it never resolves rules.
- **Determinism**: rules never read time or randomness; `applyCommand` returns a fresh clone (`clone` = JSON round-trip) and the old state is kept for undo. `validateCommandShape` bounds command size (512 bytes) and checks types for any future network/replay boundary. `serialize`/`deserialize` are version-checked (`STATE_VERSION 1`).
- **Persistence**: one document `{v, settings, progress}` wrapped as `{sum, payload}` with an FNV-1a checksum; a bad checksum or a newer version yields a clean slate; an in-memory fallback covers private mode. `migrate` fills new settings and stats keys.
- **Performance**: the board is redrawn whole on each refresh (≤80 cells, one `fillRect` set per cell); no animation loop runs, so idle CPU is zero. Auto-run is a `setInterval` at 120–420 ms. Audio nodes are created per event and garbage-collected; the ambience buffer is 2 s looped.
- **Resilience**: missing clips fall back to synthesis; missing images remove themselves; `localStorage` failures fall back to memory; hiding the tab pauses the round.
- **How the e2e drives the real UI**: `tests/e2e.mjs` starts its own static server on an ephemeral port, launches system Chrome through `playwright-core`, and only uses `getByRole('button', {name})` and canvas clicks positioned by grid fraction — the same surface a player uses. It then spawns `server.js` on port 8117 (override `E2E_SERVER_PORT`) to check the shipped server.

## 14. Testing and acceptance criteria

`npm test` = `test:rules` then `test:e2e`.

`tests/rules.test.mjs` (10 checks): every stage definition validates; every config builds with an in-bounds sink and at least one source; challenge/practice configs carry their ids and unknown difficulties fall back to Standard; the daily is stable per date; a six-belt line wins First Ford (gold 24, tick 6, `contracts-complete`, 5 ore); seven illegal commands are refused with the right reason and leave the hash unchanged; a Smelter costs its price, upgrades from 4 to 3 ticks, and refunds half on removal; the tick limit ends the round as `time-up` at exactly the limit; identical command sequences hash identically; serialization round-trips.

`tests/e2e.mjs`, at 1280×800 and again at 390×844 with touch: title heading and all seven mode buttons visible; mode select and back; Journey lists 40 stages; First Ford header shows name, `Gold: 60`, `Tick: 0 / 120` and the contract row; six canvas clicks build the line and cost 36 gold and 6 ticks; a click on rock reports "rock" and costs no tick; clicking "Run one tick" until the results screen shows "Contracts complete" with a positive score; the save document records the win and `journeyBest.j01`; Space ticks, ArrowRight+Enter builds, P pauses, Resume works; Practice Relaxed starts with `Gold: 300` and Undo rolls the tick back; five lessons listed and "Lay the line" starts with its text; five challenges listed and Shoestring starts with `Gold: 90`, `Tick: 0 / 210`; the daily header carries a date; Score Chase auto-run advances and stops. Any console error or page error fails the pass. Finally `server.js` must serve `index.html` at `/`, refuse `/%2e%2e/` escapes, answer 400 to malformed encoding, and return a numeric time.

QA bar (agents/qa.md) as checkable statements:

- A new player sees rules on the title, a lesson track, a preselected tool, a concrete hint and an explained refusal within the first round.
- Every implemented feature is reachable by clicking visible buttons; nothing requires a console or URL parameter.
- Zero console errors or warnings on either viewport (enforced by the e2e).
- No text or control is clipped at 1280×800, 390×844 portrait, or landscape phones: all content is in normal flow and the page scrolls.

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/keyart.webp` | Title hero (1536×864 → WebP) | FLUX.2 klein, seed 61001, 28 steps | generated in this pass, wired |
| `assets/exchange-ledger.webp` | Results illustration (1024×576) | FLUX.2 klein, seed 61002 | generated in this pass, wired |
| `assets/help-line.webp` | Help diagram illustration (1024×576) | FLUX.2 klein, seed 61003 | generated in this pass, wired |
| `coverart.png` | 1200×675 store cover | key art crop + ffmpeg drawtext title | generated in this pass (replaces the placeholder abstract cover) |
| `icon.png`, `favicon.svg` | Launcher icon, tab icon | authored earlier | shipped |
| `sfx/*.opus` (16 clips) | Event one-shots, see §9 | MOSS-SoundEffect v2.0 | shipped |
| `sfx/mine-spawn.opus` | `spawn` event | MOSS-SoundEffect | generated in this pass |
| `sfx/conveyor-motor.opus` | `auto` event | MOSS-SoundEffect | generated in this pass |
| `vendor/three.module.min.js` | — | three.js | shipped, unused (not referenced by `index.html`) |
| 3D models, character animation | — | — | not called for: 2D canvas presentation, no characters |

## 16. Known limitations

- No localization: English strings inline in `app.js`/`content.js`; mixed US/UK spelling.
- Lesson `steps` in `content.js` are authored but `app.js` shows only the lesson paragraph; steps are not tracked or ticked off, and a lesson counts as done when its contracts are met.
- Journey stars are computed and saved (`journeyStars`) but never displayed; the Journey list shows best score only.
- Most `DEFAULT_SETTINGS` (captions, simSpeed, largeText, highContrast, colorPalette, leftHanded, confirmBuilds, boardMirror, graphicsTier) have no UI; only Sound on/off is exposed, on the Pause screen.
- The board has no DOM mirror; a screen-reader user navigates by the status line and the "Selected:" row.
- `server.js` serves every file under the game root, including `tests/` and `tools/`, and does not implement the `/ws` upgrade its header comment mentions.
- The daily date comes from the client clock, so players near midnight UTC on a skewed clock can see a different day than the platform.
- Rotating a belt that a hint suggested does not re-run the hint until the next refresh; the hint is greedy and can suggest extending a belt into a dead end.
- Removing a building loses its carried goods with no confirmation (documented on Help).

## Design intent not yet implemented

- Localization table with en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT, chosen from the platform profile or `navigator.language`, with a language switch on the title.
- StarHermit leaderboards for Daily and Score Chase (entries carry ruleset version, seed, score components, tick count) and a small achievement set (first win, first upgrade, all lessons, a mastery stage, 100 goods sold), using `store.js sortEntries` ordering for ties.
- Daily date from `/api/v1/time` with round-trip offset.
- Lesson step tracking driven by rules events, with the current step highlighted in the info panel.
- Star display on the Journey list and a `star` sound on the results screen.
- Settings screen exposing the persisted options (captions, sim speed, large text, high contrast, left-handed layout).
