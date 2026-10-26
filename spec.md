# Assembly Vale — Game Design Document (running spec)

Assembly Vale is a single-player, turn-tick production puzzle: lay conveyor belts from a mine to the Exchange, drop refining machines on the line, and fill every contract before the tick limit. It is a StarHermit engine script game (engine 1.13.2, host API 1.15): one package that the StarHermit client plays natively and browsers play on the engine's web runtime. This document describes the shipped game as it behaves today. Anything not yet built is listed at the end under "Design intent not yet implemented".

## 1. Overview

| | |
|---|---|
| Pitch | A valley-sized factory diorama where every build costs a tick and the clock only moves when you say so. |
| Genre | Production optimization / logistics puzzle, deterministic, no real-time pressure |
| Players | 1; best scores in local progress and, signed in, the StarHermit `high-score` leaderboard |
| Session | 2–6 minutes per round (120–360 ticks at 420 ms per auto-run tick, plus planning). A full Journey is 40 rounds. |
| Platforms | The StarHermit client (Windows, Linux) natively; desktop and mobile browsers on the engine's web runtime; portrait and landscape |
| Runtime | StarHermit engine script game: `native/main.ts` (TypeScript on the host API), pinned to `engine.version=1.13.2`, `engine.minor=15` |
| Rendering | `starhermit:ui` screens (immediate mode) styled from `assets/ui-style.json`; the board is drawn by `native/board.ts` with `starhermit:canvas` (the cached terrain layer) and `starhermit:draw` (everything that moves), per the runtime's graphics tier (§8) |
| Audio | Authored Opus one-shots (`sfx/`) on the runtime's mixer plus synthesized beds (valley air, factory hum, generative pad) on its Web Audio graph (§9) |
| Persistence | The engine save (`starhermit:storage` `saves`: device + the account's cloud slot), the game's Sound toggle in the game settings (§12) |

File map:

| Path | Role |
|---|---|
| `starhermit.txt` | Manifest: name, description, owner, `server=score-script.js`, `cover=cover.jpg`, `launch=index.html`, the `engine.*` keys, 15 `control.*` actions with groups and `engine.gamepad.*` defaults. |
| `index.html`, `starhermit-files.json` | The engine's web loader and file index, written by `npm run package` (`starhermit package --web .`); never edited by hand. |
| `native/main.ts` | Entry: start-up, the manifest's actions, pointer/touch notes, suspend → pause, the frame (`onUpdate`: auto-run, audio, UI; `onRender`: the page background). |
| `native/rules.ts` | Loads `js/rng.js`, `js/rules.js`, `js/content.js` with `loadClassic` and types the parts the client uses. |
| `native/game.ts` | The session (the browser build's `app.js` logic): screen state, tool and recipe, selection, undo history, auto-run, status line, names, hints, progress recording, leaderboard post. |
| `native/board.ts` | Board renderer: graphics look per tier, terrain layer, sprites, pieces, goods glides, particles, glow, grade, clouds, selection, cell picking. |
| `native/screens.ts` | Every screen with `starhermit:ui`; the layout by window size. |
| `native/style.ts` | Registers the theme, tokens and styles from `assets/ui-style.json`. |
| `native/audio.ts` | Clips, synthesized beds, the game's Sound toggle. |
| `native/save.ts` | The progress as the engine save; conflict merge; the browser build's cloud save and settings migration. |
| `native/online.ts` | Score posting through `score-script.js`, invite link, sign-in request. |
| `native/i18n.ts` | Locale from the runtime's interface language; `T(id, vars)` over `js/i18n.js`. |
| `js/rng.js`, `js/rules.js`, `js/content.js` | Pure rules engine, RNG and content (UMD classic scripts; unchanged from the browser build). |
| `js/store.js` | The save document (pure): migration, checksum, the old wrapped format, merge, `recordResult`, `starsFor`. |
| `js/gfx.js` | Graphics look model (pure): what each quality tier draws, per-tier budgets. |
| `js/i18n.js` | Locale tables for every player-facing string in the nine locales. |
| `score-script.js` | StarHermit platform script (`server=`): range-checks a finished round's score and posts it to the `high-score` leaderboard. |
| `tools/ui-style.css` → `assets/ui-style.json` | The class-based style sheet and its conversion (`npm run css`, `starhermit css`). |
| `tools/package-web.mjs` | `npm run package`. |
| `tests/` | Unit, localization, native play-script and browser checks (§14). |
| `sfx/` | Clips; `manifest.json` maps rules events to clip names (read at start), `manifest.txt`/`manifest.md` are the human tables. |
| `assets/` | Key art and illustrations, the converted UI styles. |
| `cover.jpg`, `coverart.png`, `icon.png`, `favicon.png` | Store cover (`cover=`), 1200×675 cover art, icon. |
| `LICENSE.md` | PolyForm Noncommercial 1.0.0. |

## 2. Vision and design pillars

**The clock is yours.** Nothing moves until the player runs a tick (Space) or switches on auto-run (A). Every build, rotate, removal and upgrade also costs exactly one tick, so planning and running share one currency. Rules in: pausing at any time, unlimited thinking, undo where the mode allows. Rules out: real-time timers, input windows, anything that punishes slow reading.

**One line, then one machine.** The whole game is "goods ride belts the way the belt faces; a machine on the line turns one good into a better one". Rules in: four directions, one input and one output slot per machine, single-good contracts. Rules out: splitters, mergers, multi-input recipes, inventories, research trees.

**Gold is the only resource and it flows both ways.** Every sale pays gold immediately, gold buys the next building, leftover gold counts toward score when you win. Rules in: refunds on removal (half), cost scaling by stage. Rules out: energy, cooldowns, second currencies, cosmetic purchases.

**Inspectable and repeatable.** The same stage with the same command list always produces the same state hash. Seeds are visible in content, daily seeds derive from the UTC date, and the hint system uses the same legality functions the player does. Rules out: hidden multipliers, luck in resolution, hints that know things the rules do not expose.

**A tabletop you can read at a glance.** Sources are grey blocks with a letter, belts are brown with a gold arrow, machines are purple with a letter and level, the Exchange is a red `$`. Rules in: flat colour plus a glyph on every piece, a legend under the board, a text description of the selected cell. Rules out: effects that hide the arrow, camera moves, anything only expressed by animation.

## 3. Player experience

Target player: someone who likes tidy logistics puzzles and short rounds — the "one more stage" player on a phone, in a browser tab or in the StarHermit client — not the 40-hour factory optimizer.

First 60 seconds (as taught by the UI: the title → Journey → `startRound` in `native/game.ts`):

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

Journey stars (`store.js starsFor`): 1 for the win, +1 for `tick ≤ par.ticks` (par = 70% of the limit), +1 for ending with at least the starting gold.

### RNG and determinism

`cfg.seed` is `hashString('assembly-vale:' + id)` for authored stages, an explicit seed for challenges (1101–1105) and Score Chase (777001), and `hashString('assembly-vale-daily:' + YYYY-MM-DD)` for dailies. Resolution itself uses no randomness; the seed selects the daily layout/theme and feeds `RNG.streams` for cosmetic variation. `hashState` hashes a stable-stringified copy without `events`; identical command lists give identical hashes (tested). `elapsedMs` is quantised to 100 ms from `cmd.atMs` so replays are stable.

### Undo and hints

- Undo (`game.ts undo`) is enabled when `cfg.mechanics.undo` is true: Practice and Lesson rounds. Up to 50 previous states are kept; undo pops one, including ticks.
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

Content validation: `validateStage` checks that every contract good has an on-map raw source, every recipe in its chain is allowed, and the purse covers one chain plus four belts. `tests/rules.test.mjs` runs it over every Journey, Challenge, Practice and Score Chase definition.

Progress and unlocks: nothing is locked; stars, best scores and lesson ticks are the progression signals. Title footer shows rounds, wins and best score.

## 6. Controls and interaction

The manifest declares 15 actions; players rebind keys and pads in the runtime's Options (F1 › Controls), grouped there as Board, Simulation, Tools and Assists. On-screen prompts (button labels with keys, the How to play keys line) read the current keyboard bindings with `bindingLabel`.

| Action | Keys | Gamepad | What it does (play screen) |
|---|---|---|---|
| `left` `right` `up` `down` | Arrows | D-pad, left stick | Move the selection (clamped to the board; takes the UI focus off buttons, as the browser build's arrows did) |
| `build` | Enter, Numpad Enter | South | Apply the current tool at the selection (Enter on a focused button is the button's) |
| `tick` | Space | North | Run one tick (Space on a focused button is the button's) |
| `auto` | A | West | Toggle auto-run |
| `belt` `machine` `rotate` `remove` `upgrade` | B M R X U | LB, RB, RT, LT, right stick press | Select a tool (Machine keeps the last chosen recipe) |
| `hint` | H | Select | Hint: selects the suggested cell and explains it |
| `undo` | Z | left stick press | Undo (Practice and Lessons) |
| `pause` | P, Escape | Start | Pause; on Pause, P/Escape (or Start) resumes |

Back (Escape, gamepad East) on How to play returns to the round (or the title); on the mode, Journey, lesson, challenge and practice menus it returns to the title. Tab / Shift+Tab and the gamepad D-pad move the UI focus through every button and the board; Enter, Space or South activates.

Mouse and touch: tap a tool button, then tap a board cell — the tap both selects the cell and applies the tool. The board is one `ui.widget` region; a pointer press or finger in that frame picks the cell under it, while Enter on the focused board applies the tool at the selection. No drags, no multi-touch, no long-press.

Input locking: none is needed — every command resolves synchronously. Auto-run advances one tick every 420 ms of game time (`game.update`) and stops itself on a terminal state, on leaving the play screen, or when the window or tab is hidden (`onSuspend` pauses the round).

Feedback for every input: tool select → clink + "Tool: belt"; build → thunk + "Built a belt."; rotate → ratchet + "Rotated to face S."; remove → scrape; upgrade → servo; refused → buzz + reason; hint → chime + the hint text. Every status line is also announced to screen readers (`ui.announce`).

## 7. Screens and UI flow

State machine (`screen` in `native/game.ts`, drawn by `buildUi` in `native/screens.ts` each frame):

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

**Settings** (the title footer, the play header, Pause) opens the runtime's Options menu (`openMenu`): sound volumes, mute and voice limit, graphics level and frame-rate limit, language, controls, accessibility (interface and text size, high contrast, reduced motion) and the account. It replaced the browser build's Settings / Graphics screen and its Sound, frame-rate, Language and Report a problem panel.

Screens: the title (name, rules paragraph, key art, seven mode buttons, footer with stats, the account line and the fair-play note, Settings and Sign in or Invite); Choose a mode; Journey (40 stages, `*` marks mastery, best scores); Lessons (`✓` when done); Challenges and Practice (buttons and a description list); How to play (rules list, the live keys line, the help illustration); Paused (Resume, Restart round, How to play, Sound on/off, Settings, Leave round); Results (score breakdown, the leaderboard line when signed in, the ledger illustration, Play again, Next stage in the Journey, Choose a mode, Title); Play.

The UI is immediate mode: every frame rebuilds from state, so a language change, a rebinding or a cloud-save merge shows at once with the round untouched. A changed screen starts scrolled to the top. Each page is a scroll area inside the safe area.

Layouts (logical pixels, `ui.preferences().scale` applied, so the player's interface and text size enlarge everything):

- **Desktop (> 720 px wide)**: page width up to 1180 (1500 on the play screen above 1600); header row (stage name, Gold pill, Tick pill, Pause, Help, Settings; it wraps into stage / pills / buttons when it does not fit); three-column body — info panel (lesson text, contracts, live score components, building limit, selected cell) | board + legend | tool palette and action buttons; footer (hint, status, Title). The board is as wide as its column, capped so it fits the window height.
- **Narrow (≤ 720 px)**: columns stack with the board first, then info, tools, actions and the footer; the board takes up to 62 % of the height.
- **Short landscape (≤ 500 px tall, wider than tall)**: the board and two 200 px side columns stay side by side; the side columns scroll; the board's width comes from the height; the legend is hidden; panels and the title shrink.
- Mode buttons flex as the browser build's `flex: 1 1 220px`: equal columns at least 220 px (or the widest label) wide; a label too long for its button wraps inside it.
- Must never be cut off: the board, the Gold/Tick pills, the active tool button, "Run one tick", the status line; everything is in normal flow and the page scrolls rather than clips.

## 8. Art direction

The hero of every screen is the board: a clean tabletop diorama of a green valley with a handful of readable pieces. Chrome is dark forest green so the meadow glows; gold is reserved for primary actions, the selected tool, arrows on belts and the status line.

Palette (tokens in `tools/ui-style.css`, board colours in `native/board.ts`/`content.js`):

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

Typography: the runtime's `system-ui` faces, 16 px body, 40 px title, 24 px headings, tabular numerals on pills and score rows, 62–70 ch measure on paragraphs and lists.

Motion: the tick stays the unit of time — goods glide to their new cell and belt rollers slide one pitch only when a tick runs (≈170 ms, or 70% of the auto-run period), and nothing on the board moves between ticks except ambient water shimmer, drifting cloud shadows, furnace-window pulses and event particles. Under `prefers-reduced-motion` (or `settings.reducedMotion`) animation and particles are forced off. Other transitions: button press (1 px translate, removed under reduced motion) and gain ramps in audio.

**Graphics.** Light comes from the top-left: detailed pieces are bevelled (lit top/left edge, shaded bottom/right) with a soft top-to-bottom gradient and cast drop shadows toward the bottom-right (hard at Low tier, blurred at Medium, wider at High); goods are shaded spheres with a contact shadow. The ground is a cached layer with per-tile light falloff and seeded grass tufts and flowers, rocks are three lit boulders, water has a depth gradient, ripples and a moving glint. Belts have side rails and rollers that slide one pitch per tick, and arrows and machine letters get a dark keyline so they stay readable on every theme. Machines show a progress bar while working; with glow on, a working machine's window pulses warm orange and the Exchange (striped awning) glows, flaring on each sale. Particles: coins from the Exchange on a sale, confetti on a completed contract, steam and sparks on a craft, dust from a mine spawn, a dust ring on build/remove, dark drops on a spoil, a spark ring on upgrade (live cap from the preset budget). The colour grade adds a warm-to-cool light wash, a mild vignette (≤20% at the corners) and drifting cloud shadows under the pieces. Low is the original flat board (no shadows, plain surfaces, no particles, glow or grade) with goods gliding and rollers turning.

Visual assets the design calls for (all in `assets/`, generated with FLUX.2 klein, compressed to WebP, drawn as decorative image boxes styled with `background: url() cover`):

- `keyart.webp` — title-screen hero and source of the cover: aerial diorama of the mine, a belt line, a purple smelter and the red-roofed Exchange.
- `exchange-ledger.webp` — results-screen illustration: the Exchange counter with stacked goods and a stamped ledger; dimmed on a loss (`.av-ledger-lost`).
- `help-line.webp` — Help-screen diagram-style shot of mine → belts → smelter → Exchange.
- `coverart.png` — 1200×675 store cover cropped from the key art with the title set in DejaVu Sans Bold.

**Graphics levels.** The runtime owns Auto and the graphics level (Options › Graphics: ten levels in four tiers, a frame-rate limit, render scale, adaptive resolution). The board takes its look from the frame's tier (`frame().quality`: low, balanced, high, ultra) through `js/gfx.js`, one row per tier (the browser build's four presets):

| Tier | Shadows | Surface detail | Glow | Grade + clouds | Particles | Animation |
|---|---|---|---|---|---|---|
| Low | off | plain (flat board) | off | off | off | animated |
| Balanced | low (hard offset) | detailed | off | on | low | animated |
| High | medium (soft) | detailed | on | on | high | animated |
| Ultra | high (softer) | detailed | on | on | high | animated |

Per-tier budgets (`BUDGETS`): the terrain layer's pixel-ratio cap (1 / 1.5 / 2 / 2), grass tufts per tile (0 / 5 / 9 / 16) and flower chance (0 / 25 / 35 / 60 %), the particle cap (48 / 120 / 320 / 640) and per-event count (×0.5 / 0.75 / 1 / 1.5), cloud shadows (0 / 2 / 3 / 4) and glow sprites (0 / 24 / 64 / 160). Within a tier the particle cap and burst grow with the level's speed over the tier's first level (`levelSettings().teraflops`), at most twice. Reduced motion (the runtime's accessibility setting) turns animation and particles off.

**How the board draws.** The terrain (checker tiles, light falloff, tufts, flowers, rocks, water) is painted once per stage, tier and size into an `OffscreenCanvas` and drawn as one image (repainted once a new window size has held for 0.2 s). Everything else is drawn each frame with `starhermit:draw` rectangles, lines, text and pre-painted sprites (shaded goods per colour, a disc, a radial glow, two pre-blurred shadow squares, a cloud, the bevel gradient), in the browser build's logical units scaled to the board's rectangle, so proportions and line widths match the old canvas. Differences from the browser build: glows blend normally (the overlay has no additive mode), soft shadows are pre-blurred sprites rather than `shadowBlur`, and the terrain's CSS `filter: saturate() contrast()` lift is gone (engine canvases have no `filter`).

## 9. Audio direction

Mix philosophy: the round should sound like a small workshop in a quiet valley. Short dry transients on the effects bus for every logical event, a very quiet brown-noise "valley air" bed on the ambience bus, a 55 Hz low-passed sawtooth hum on the same bus only while auto-run is on, and a slow four-chord generative pad (A–G–F–E minor-ish walk, 5.2 s cycle, ≤0.05 gain) on the music bus. Relative levels: music 0.55, effects 0.9, ambience 0.5. "Sound: on/off" on the Pause screen silences the game. The beds start with the first round and stop when leaving to the title.

Implementation (`native/audio.ts`): at start the game reads `sfx/manifest.json`, binds each `event` to its clip and loads every clip with `loadClip` (in browsers the mixer gets them at the player's first press). One-shots play on the runtime's buses — tool, hint, invalid and ui on "interface", the rest on "effects" — at most once per event within 50 ms. The beds are synthesized on the engine's Web Audio graph (`context`): valley air (2 s of brown noise looped through a 300 Hz low-pass), the factory hum while auto-run runs (55 Hz sawtooth through a 180 Hz low-pass, eased in and out) and the pad (a four-chord walk, one chord every 5.2 s, on "music"); they start with the first round and stop on leaving to the title. The browser build's bus levels (music 0.55, effects 0.9, ambience 0.5) are folded into each sound's gain; the player's volumes, mute and voice limit are the runtime's (Options › Audio). The game's own **Sound: on/off** (Pause screen) is saved in the game settings (`sfx.muted`, with the account when signed in) and silences clips and beds.

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

The browser build's hidden caption option (no UI) is not ported; every event already writes its status line, which screen readers announce.

## 10. Localization

Nine locales ship for all player-facing text: **en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT**.

- **Strings**: `js/i18n.js` holds every screen, the play header, info panel, tools, actions, hints, status lines, refusal reasons, content names (goods, recipes, stages, lessons, challenges, practice presets) and the StarHermit texts, keyed by id; en-GB is the base table, en-US adds US spelling, es-ES and fr-CA add their regional texts over es-419 and fr-FR.
- **Language**: the runtime's interface language (Options › Language, else the device's) picks the table (`native/i18n.ts`: exact tag, then regional variants such as en-AU → en-GB, es-MX → es-419, then the language). A change shows on the next frame.
- **Coverage**: `tests/i18n.test.mjs` checks that every id the client uses has a text in every locale with its placeholders intact.
- Layout allowance: buttons wrap their labels when too long, header items wrap, no text is fixed-width.

## 11. Accessibility

- Keyboard and gamepad: every screen is reachable by Tab / D-pad and Enter / South on real UI buttons; the board is a focusable region and fully playable with the actions (§6).
- Focus: the runtime draws a 3 px gold ring (`focusVisible` in the styles) on the focused button.
- Screen reader: every widget is in the runtime's accessibility tree; the status line (the selected cell, each action's result, sales, refusals) is announced with `ui.announce`; the board region's name explains its keys; tool buttons are toggles announced pressed.
- The runtime's accessibility settings apply over the game's styles: interface size and text size (all layout is in logical pixels and text is measured), high contrast, and reduced motion (board animation and particles off).
- Contrast: `#eef6ee` on `#101a14` (≈15:1), `#20180a` on `#ffd166` (≈11:1), dim text `#b7c9ba` on panels (≈8:1).
- Target size: buttons are ≥ 44 px tall with 8–10 px gaps; board cells scale with the board.
- Colour is never the only cue: every piece has a glyph, machines show `L2/L3` text, the legend labels each colour, and the info panel describes the selection in words.
- Audio is optional: nothing in the rules depends on hearing an event.

## 12. StarHermit integration

The game is a StarHermit engine script game; everything platform-related goes through the host API (`starhermit:platform`, `starhermit:storage`), with no token, key or request of its own. A guest (signed out) makes no platform calls.

- **Packaging**: `starhermit.txt` (§1) with `engine.capabilities=platform,storage,clipboard`; `.starhermitignore` leaves out `tests/` and `tools/` (the engine's defaults leave out dot-names, `node_modules/`, `package.json`, `tsconfig.json`). `npm run package` writes the web loader and file index after every change; both are committed. Pushing does not publish; publishing is a separate step.
- **Platform script**: `score-script.js` (unchanged) accepts `{type:'result', scores}` on a practice session, range-checks each score against its board and writes it to the `high-score` board (integer, higher is better, 0–100,000).
- **Leaderboard**: signed in, every finished round except lessons posts its total (`online.ts submitScore`: `sessions.practice()`, `connectGame`, the result command, the script's `result-ack`); the results screen shows "Posting score…", then the rank among the first 100 ("Leaderboard rank: #n"), "Score posted" or "Score not posted".
- **Sign-in**: guests see **Sign in with StarHermit** in the title footer (`requestSignIn`, the runtime's Account flow); signed in, the footer shows **Invite a friend**, which copies the invite link (`clipboard.writeText`) and confirms with a toast. Signing out mid-session shows a toast and keeps saving on the device.
- **Identity**: the account line reads "Playing as <display name> · progress synced / saving… / cloud sync unavailable" from `player()` and the save's sync state; guests see "Offline — progress is stored on this device."
- **Saves**: the progress document (`js/store.js`, `{v: 1, progress}`) is the engine save (`saves.save`, schema 1), on the device at once and in the account's cloud slot debounced. When another device saved first, `onConflict` merges both (better records win, unlocks are unioned); a replaced device copy is merged in on `onStatus`.
- **Migration from the browser build**: its cloud slot `game:<slug>` held the same document wrapped as `{sum, payload}` in a zipped `save.json`. The engine shows it as a foreign save; `save.ts` reads its text with `Store.loadRaw`, merges it with the device's progress and saves with `replaceForeign` once. Its account settings (the old `DEFAULT_SETTINGS` keys and `graphics`) arrive as legacy settings: `muted` becomes the game's Sound toggle (unless set since), and every known key is removed. Guests' old browser `localStorage` progress does not migrate (the engine cannot read another origin's storage).
- **Controls**: the 15 actions in the manifest; the platform keeps the bindings with the account.
- **Language**: the runtime's interface language (it follows the account's preferred language).

Not used: matchmaking, session invites, chat, replays, server achievements, per-mode leaderboards, avatars. Multiplayer is out of scope.

## 13. Technical architecture

- **Module boundaries**: `rng` → `rules`, `content` (UMD classic scripts, Node-testable, no host API, no `Date`), `store`, `gfx`, `i18n` (pure tables and models) are loaded with `loadClassic`, so the node tests run the shipped files. `native/game.ts` is the only caller of `Rules.applyCommand`; `board.ts` and `screens.ts` only read state.
- **Determinism**: rules never read time or randomness; `applyCommand` returns a fresh clone and the old state is kept for undo. `validateCommandShape` bounds command size (512 bytes).
- **Frame**: `onUpdate` runs auto-run, the audio pad and the UI build; the board draws inside its widget's draw callback; `onRender` draws the page background. Nothing sizes at load: `frame()` is 0×0 before the first frame.
- **Performance**: the static terrain is a cached canvas; the moving board is about 2,500 overlay items at most on the largest boards; canvas work happens only on a new stage, tier or window size.
- **Resilience**: a clip that fails stays silent (and reloads if the mixer lost it); a missing image leaves its box's colour; storage errors keep the session going; hiding the window pauses the round.
- **Engine requirements**: `engine.minor=15` (host API 1.15: levels, styled boxes, the UI's CSS model, foreign saves and legacy settings).

## 14. Testing and acceptance criteria

`npm test` = `test:unit` then `test:native` (set `STARHERMIT` to the engine runtime; without it the native step checks only the web index).

- `tests/rules.test.mjs` (10 checks): every stage validates; configs build; determinism and hashing; tick resolution order; scoring; terminal states; undo; hints.
- `tests/gfx.test.mjs`: every runtime tier has a look, budgets grow from Low to Ultra and within a tier (at most twice), reduced motion.
- `tests/progress.test.mjs`: engine save data round trip; the browser build's wrapped cloud save migrating (and a corrupt one refused); conflict merges; recording a finished First Ford round (score 400, stars, daily, Score Chase).
- `tests/i18n.test.mjs`: every id the client uses has a text in all nine locales with placeholders intact; all tables hold the same ids; tag picking.
- `tests/native.mjs`: the web index matches the files (`npm run package` ran after the last change); `starhermit check .` passes with no warning; every `tests/native/*.play` script passes as a signed-out offscreen run driving the real UI:
  - `full-round.play` — Journey → First Ford, six belts by keyboard, auto-run to "Contracts complete", Score 400, Next stage.
  - `actions.play` — a refused click on the Exchange, tool keys and buttons, build, Undo, Space, Hint, Pause/Resume (Escape, P), the Sound toggle, How to play and back, Leave round.
  - `menus.play` — Daily, Score Chase, Restart, a challenge, a practice preset, Back by Escape.
  - `touch.play` — fingers on the menus, the board and the buttons.
- `tests/browser.mjs` (`npm run test:browser`, after `npm run package`): the packaged loader on loopback in headless Chrome at 1366×768, a 390×844 phone and the phone in landscape; the title shows, the keyboard reaches a lesson and plays a tick, a hint and a belt, with no console errors or warnings and no error screen (`--shots DIR` saves screenshots).
- Type check: `npm run typecheck` (TypeScript 5.9 against `starhermit types .`'s declarations).

QA bar as checkable statements:

- A new player sees rules on the title, a lesson track, a preselected tool, a concrete hint and an explained refusal within the first round.
- Every implemented feature is reachable by visible buttons; nothing requires a console or URL parameter.
- Zero console errors or warnings natively and in the browser check.
- No text or control is clipped at desktop, 390×844 portrait or landscape phones: all content is in normal flow and the page scrolls.

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/keyart.webp` | Title hero (1536×864 → WebP) | FLUX.2 klein, seed 61001, 28 steps | generated in this pass, wired |
| `assets/exchange-ledger.webp` | Results illustration (1024×576) | FLUX.2 klein, seed 61002 | generated in this pass, wired |
| `assets/help-line.webp` | Help diagram illustration (1024×576) | FLUX.2 klein, seed 61003 | generated in this pass, wired |
| `coverart.png` | 1200×675 store cover | key art crop + ffmpeg drawtext title | generated in this pass (replaces the placeholder abstract cover) |
| `icon.png`, `favicon.png` | Launcher icon, tab icon | authored earlier | shipped |
| `sfx/*.opus` (18 clips) | Event one-shots, see §9 | MOSS-SoundEffect v2.0 | shipped |
| `sfx/mine-spawn.opus` | `spawn` event | MOSS-SoundEffect | generated in this pass |
| `sfx/conveyor-motor.opus` | `auto` event | MOSS-SoundEffect | generated in this pass |
| 3D models, character animation | — | — | not called for: 2D board presentation, no characters |

## 16. Known limitations

- Lesson `steps` in `content.js` are authored but only the lesson paragraph is shown; steps are not tracked, and a lesson counts as done when its contracts are met.
- Journey stars are computed and saved (`journeyStars`) but never displayed; the Journey list shows best score only.
- The browser build's unused settings (captions, sim speed, large text, colour palette, left-handed, confirm builds, board mirror) have no UI and are not ported; sound, graphics, text size, contrast and reduced motion are the runtime's.
- The board has no per-cell accessibility nodes; a screen-reader user navigates by the status line and the "Selected:" row.
- The daily date comes from the device clock (UTC), so players near midnight UTC on a skewed clock can see a different day than others.
- The hint is greedy and can suggest extending a belt into a dead end.
- Removing a building loses its carried goods with no confirmation (documented on Help).
- Glow blends normally rather than additively, and the terrain has no saturation/contrast filter (engine limits, §8).

## Design intent not yet implemented

- Separate StarHermit leaderboards for Daily and Score Chase (entries carry ruleset version, seed, score components, tick count) and a small achievement set (first win, first upgrade, all lessons, a mastery stage, 100 goods sold) (ties: won before lost, higher score, fewer refusals, shorter round).
- Daily date from `/api/v1/time` with round-trip offset.
- Lesson step tracking driven by rules events, with the current step highlighted in the info panel.
- Star display on the Journey list and a `star` sound on the results screen.
