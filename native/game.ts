// The session: the rules engine (js/rules.js, pure and deterministic) over the
// shipped content (js/content.js), as the browser build's js/app.js drove it —
// the screen, the tool and recipe, the selected cell, undo history, auto-run,
// the status line, progress recording and the leaderboard post. Screens
// (screens.ts) read this state each frame and call the actions; the board
// renderer (board.ts) hears every change.
import { announce } from "starhermit:ui";
import { Content, Rules, type Cell, type Cfg, type Dir, type Recipe, type Result, type RulesEvent, type State } from "./rules.js";
export { Content, Rules };
import { T } from "./i18n.js";
import * as board from "./board.js";
import { persist, progress, Store } from "./save.js";
import { setHum, sfx, startAudio, stopAudio } from "./audio.js";
import { signedIn, submitScore } from "./online.js";

// -- Session state ----------------------------------------------------------------
export type Screen = "title" | "mode-select" | "journey-select" | "lesson-select" | "challenge-select"
  | "practice-select" | "help" | "paused" | "results" | "play";
export type Tool = "belt" | "machine" | "rotate" | "remove" | "upgrade";
export let screen: Screen = "title";
export let tool: Tool | null = null;
export let recipeChoice: string | null = null;
export const selected = { x: 0, y: 0 };
export let sessionCfg: Cfg | null = null;
export let state: State | null = null;
export let journeyIndex = -1;
export let auto = false;
let autoClock = 0;
let history: State[] = [];
/** The status line, kept as a function so it re-renders in the current language. */
let statusFn: () => string = () => "";
/** The results screen's leaderboard line: null, posting, or the answer. */
let lb: null | "posting" | { posted: boolean; rank: number | null } = null;
let lbSeq = 0;
/** Screen changes since start (screens.ts scrolls a new screen to its top). */
export let screenSerial = 0;

export function status(): string { return statusFn(); }
function setStatus(fn: () => string): void {
  statusFn = fn;
  const text = fn();
  if (text) announce(text);
}
function msg(key: string, vars?: Record<string, string | number>): () => string { return () => T(key, vars); }

/** The UTC day, the daily challenge's seed. */
export function todayStr(): string { return new Date().toISOString().slice(0, 10); }
export function kind(): string | null { return sessionCfg ? sessionCfg.kind : null; }
export function undoEnabled(): boolean { return !!sessionCfg?.mechanics?.undo; }
export function tickPeriodMs(): number { return 420; }

// -- Names (presentation only) ----------------------------------------------------
export function goodName(t: string): string { return Content.GOOD_META[t] ? T(`good.${t}`) : t; }
export function recipeName(rec: Recipe | null): string { return rec ? T(`rec.${rec.id}`) : T("cell.machineGeneric"); }
export function dirName(d: string): string { return T(`dir.${d}`); }
export function currentLesson(): { id: string } | null {
  const l = sessionCfg?.lesson;
  return l ? Content.LESSONS.find((x) => x.id === l.id) ?? null : null;
}
export function stageName(): string {
  const c = sessionCfg;
  if (!c) return "";
  switch (c.kind) {
    case "journey": return c.id ? T(`j.${c.id}`) : T("stage.journey");
    case "learn": { const l = currentLesson(); return T("stage.lesson", { name: l ? T(`lesson.${l.id}`) : "" }); }
    case "daily": return T("stage.daily", { date: todayStr() });
    case "challenge": return c.challengeId && Content.CHALLENGES.some((x) => x.id === c.challengeId) ? T(`ch.${c.challengeId}`) : T("stage.challenge");
    case "practice": return c.practiceDifficulty && Content.PRACTICE[c.practiceDifficulty] ? T(`pr.${c.practiceDifficulty}`) : T("stage.practice");
    case "score-chase": case "score": return T("m.score");
    default: return c.name ?? "";
  }
}
export function describeCell(x: number, y: number): string {
  const st = state;
  if (!st || !Rules.inBounds(st.cfg, x, y)) return "—";
  const cell = st.grid[y]![x];
  const where = `(${x + 1}, ${y + 1}) `;
  if (!cell) return where + T("cell.empty");
  switch (cell.k) {
    case "rock": return where + T("cell.rock");
    case "water": return where + T("cell.water");
    case "sink": return where + T("cell.sink");
    case "source": return where + T("cell.source", { good: goodName(cell.item!), dir: dirName(cell.dir!) });
    case "belt": return where + T("cell.belt", { dir: dirName(cell.dir!) }) + (cell.itemRef ? T("cell.carrying", { good: goodName(cell.itemRef.t) }) : "");
    case "machine": return where + T("cell.machine", { name: recipeName(Rules.recipeById(st.cfg, cell.recipe)), level: cell.level ?? 1, dir: dirName(cell.dir!) });
    default: return where + String((cell as Cell).k);
  }
}
export function hintText(): string {
  if (!state) return "";
  const h = Rules.hint(state);
  if (!h) return T("hint.keep");
  const c = h.cmd, why = h.why || "";
  const at = { x: c.x + 1, y: c.y + 1 };
  if (c.type === "place") {
    if (c.kind === "belt") return T("hint.belt", at);
    return T("hint.machine", { name: recipeName(Rules.recipeById(state.cfg, c.recipe)), x: at.x, y: at.y });
  }
  if (c.type === "rotate") return T("hint.rotate", at);
  if (c.type === "upgrade") return T("hint.upgrade", at);
  if (why === "deliver" || why === "win") return T("hint.keep");
  return "";
}
export function leaderboardLine(): string | null {
  if (!lb) return null;
  if (lb === "posting") return T("sh.lbPosting");
  if (!lb.posted) return T("sh.lbNotPosted");
  return lb.rank ? T("sh.lbRank", { rank: lb.rank }) : T("sh.lbPosted");
}

// -- Navigation ---------------------------------------------------------------------
export function setScreen(name: Screen): void {
  if (name !== "play") setAuto(false);
  if (name !== screen) screenSerial++;
  screen = name;
}

export function leaveRound(): void {
  setAuto(false);
  stopAudio();
  setScreen("title");
}

/** Back from Help: to the round in play, else the title. */
export function closeHelp(): void { setScreen(state && !state.terminal ? "play" : "title"); }

export function startRound(cfg: Cfg, k: string): void {
  setAuto(false);
  lbSeq++; lb = null;
  sessionCfg = cfg;
  state = Rules.createGame(cfg);
  history = [];
  tool = "belt";
  recipeChoice = cfg.allowedRecipes?.[0] ?? null;
  journeyIndex = k === "journey" ? Content.JOURNEY.findIndex((j) => j.id === cfg.id) : -1;
  const src = cfg.sources?.[0];
  selected.x = src ? src.x : 0; selected.y = src ? src.y : 0;
  if (k === "learn" && cfg.lesson) {
    const p = progress();
    if (!p.tutorialDone[cfg.lesson.id]) { p.tutorialDone[cfg.lesson.id] = false; persist(); }
  }
  board.reset(state);
  setStatus(msg("st.started"));
  startAudio();
  setScreen("play");
}

export function restart(): void { if (sessionCfg) startRound(sessionCfg, sessionCfg.kind); }
export function startDaily(): void { startRound(Content.dailyConfig(todayStr()), "daily"); }
export function startScoreChase(): void { startRound(Content.scoreChaseCfg(null), "score-chase"); }
export function startJourney(i: number): void { startRound(Content.journeyCfg(i), "journey"); }
export function startLesson(i: number): void { startRound(Content.lessonCfg(i), "learn"); }
export function startChallenge(id: string): void { startRound(Content.challengeCfg(id), "challenge"); }
export function startPractice(diff: string): void { startRound(Content.practiceCfg(diff, null), "practice"); }

// -- Tools and selection --------------------------------------------------------------
export function setTool(id: Tool): void {
  if (!state) return;
  tool = id;
  sfx("tool");
  setStatus(() => T("st.tool", { tool: T(`tn.${id}`) }));
}
export function chooseMachine(recipe: string): void { recipeChoice = recipe; setTool("machine"); }

export function selectCell(x: number, y: number): void {
  if (!state || !Rules.inBounds(state.cfg, x, y)) return;
  selected.x = x; selected.y = y;
  setStatus(() => describeCell(x, y));
}
export function moveSelection(dx: number, dy: number): void {
  if (!state) return;
  selectCell(Math.min(state.cfg.board.cols - 1, Math.max(0, selected.x + dx)), Math.min(state.cfg.board.rows - 1, Math.max(0, selected.y + dy)));
}

// Face a new building toward the Exchange along its longer remaining axis,
// so a first-time player's line usually points somewhere useful.
function preferredDir(x: number, y: number): Dir {
  const dx = state!.cfg.sink.x - x, dy = state!.cfg.sink.y - y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "E" : "W";
  return dy >= 0 ? "S" : "N";
}

export function applyToolAt(x: number, y: number): void {
  if (!state || state.terminal) return;
  if (!tool) { setStatus(msg("st.pickTool")); return; }
  if (tool === "belt") place(x, y, "belt", null);
  else if (tool === "machine") {
    if (!recipeChoice) { setStatus(msg("st.pickMachine")); return; }
    place(x, y, "machine", recipeChoice);
  } else commit(Rules.applyCommand(state, { type: tool, x, y, atMs: Date.now() }));
}
function place(x: number, y: number, k: string, recipe: string | null): void {
  commit(Rules.applyCommand(state!, { type: "place", x, y, kind: k, recipe, dir: preferredDir(x, y), atMs: Date.now() }));
}

// -- Actions ------------------------------------------------------------------------
function reasonText(reason: string | undefined): string {
  const key = `reason.${reason}`;
  const text = T(key);
  return text !== key ? text : T("reason.other", { reason: String(reason) });
}

function commit(res: Result, ticked = false): boolean {
  if (!res.ok) {
    sfx("invalid");
    setStatus(() => reasonText(res.reason));
    return false;
  }
  // rules states are fresh copies, so keeping the previous one is enough
  if (undoEnabled()) { history.push(state!); if (history.length > 50) history.shift(); }
  state = res.state;
  playEvents(res.events);
  board.changed(state, res.events, ticked);
  if (state.terminal) {
    setAuto(false);
    recordResult();
    postToLeaderboard();
    setScreen("results");
  }
  return true;
}

export function doTick(): void {
  if (!state || state.terminal) return;
  commit(Rules.applyCommand(state, { type: "tick", atMs: Date.now() }), true);
}

export function undo(): void {
  if (!state || state.terminal) return;
  if (!undoEnabled() || !history.length) { setStatus(msg("st.nothingUndo")); return; }
  state = history.pop()!;
  board.changed(state, [], false);
  sfx("undo");
  setStatus(msg("st.undid"));
}

export function showHint(): void {
  if (!state || state.terminal) return;
  const h = Rules.hint(state);
  sfx("hint");
  if (h && h.cmd && h.cmd.x != null) { selected.x = h.cmd.x; selected.y = h.cmd.y; }
  setStatus(hintText);
}

// Rules events onto sound and the status line (and the screen reader).
function playEvents(events: RulesEvent[]): void {
  let spoke: (() => string) | null = null;
  const ev = (key: string, vars?: Record<string, string | number>): (() => string) => () => {
    const v: Record<string, string | number> = { ...(vars ?? {}) };
    if (typeof v.good === "string") v.good = goodName(v.good);
    if (typeof v.dir === "string") v.dir = dirName(v.dir);
    return T(key, v);
  };
  for (const e of events) {
    switch (e.type) {
      case "place": sfx("place"); spoke = ev(e.kind === "machine" ? "ev.placeMachine" : "ev.placeBelt"); break;
      case "remove": sfx("remove"); spoke = ev(e.kind === "machine" ? "ev.removeMachine" : "ev.removeBelt"); break;
      case "rotate": sfx("rotate"); spoke = ev("ev.rotate", { dir: e.dir ?? "" }); break;
      case "upgrade": sfx("upgrade"); spoke = ev("ev.upgrade", { n: e.level ?? 0 }); break;
      case "craft": sfx("craft"); break;
      case "spawn": sfx("spawn"); break;
      case "deliver": sfx("deliver"); spoke = ev("ev.deliver", { good: e.item ?? "", n: e.value ?? 0 }); break;
      case "contract-complete": sfx("contract"); spoke = ev("ev.contract", { good: e.item ?? "" }); break;
      case "spoil": sfx("spoil"); spoke = ev("ev.spoil", { good: e.item ?? "" }); break;
      case "win": sfx("win"); spoke = ev("ev.win"); break;
      case "lose": sfx("lose"); spoke = ev("ev.lose"); break;
    }
  }
  if (spoke) setStatus(spoke);
}

// -- Auto-run -------------------------------------------------------------------------
export function setAuto(on: boolean): void {
  if (on === auto) return;
  auto = on;
  autoClock = 0;
  setHum(on);
}
export function toggleAuto(): void {
  if (!state || state.terminal) return;
  setAuto(!auto);
  sfx("auto");
}

/** Each frame (seconds since the last): auto-run ticks every 420 ms of play. */
export function update(dt: number): void {
  if (!auto) return;
  if (screen !== "play" || !state || state.terminal) { setAuto(false); return; }
  autoClock += Math.min(dt, 0.25) * 1000;
  if (autoClock >= tickPeriodMs()) {
    autoClock -= tickPeriodMs();
    if (autoClock > tickPeriodMs()) autoClock = 0;
    doTick();
  }
}

/** The tween length for goods gliding between cells: shorter while auto-run runs. */
export function tweenMs(): number { return auto ? Math.round(tickPeriodMs() * 0.7) : 170; }

// -- Sound toggle --------------------------------------------------------------------
export function soundStatus(isMuted: boolean): void { setStatus(msg(isMuted ? "sound.off" : "sound.on")); }

// -- Results and progression ---------------------------------------------------------
function recordResult(): void {
  const st = state!;
  Store.recordResult(progress(), st, kind() ?? "", todayStr());
  persist();
}

// Signed in only: post the finished round's total (lessons excluded) and
// show the board rank on the results screen. A guest posts nothing.
function postToLeaderboard(): void {
  const seq = ++lbSeq;
  lb = null;
  if (!signedIn() || kind() === "learn") return;
  lb = "posting";
  submitScore(state!.score.total).then((r) => { if (seq === lbSeq) lb = r; }, () => { /* never rejects */ });
}

/** Backgrounding pauses a running round (the browser build's visibilitychange). */
export function suspend(): void {
  if (screen === "play") { setAuto(false); setScreen("paused"); }
}
