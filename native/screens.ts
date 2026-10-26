// The screens, built each frame with starhermit:ui in the browser build's
// layout (js/app.js and css/style.css there): the title (name, description,
// key art, the seven mode buttons, the stats / account / fair-play footer
// with Settings and Sign in or Invite), the mode, Journey, lesson, challenge
// and practice menus, How to play, Paused, Results, and the play screen —
// the header (stage, gold and tick pills, Pause, Help, Settings), the info
// panel (lesson text, contracts, score parts, building limit, the selected
// cell), the board with its legend, the tool palette and the action
// buttons, and the footer (hint, live status, Title). Settings opens the
// runtime's Options menu (sound, graphics, language, controls,
// accessibility), which replaced the browser build's Settings screen.
// Layout by window size replaces the CSS media queries: narrow (≤ 720
// logical px) stacks the columns with the board first; short landscape
// (≤ 500 px tall) keeps the board and the side columns side by side with
// the columns scrolling and the legend hidden.
import { frame, openMenu } from "starhermit:engine";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { bindingLabel } from "starhermit:input";
import { player } from "starhermit:platform";
import * as board from "./board.js";
import * as game from "./game.js";
import { Content, Rules } from "./game.js";
import { T } from "./i18n.js";
import { copyInvite, signIn } from "./online.js";
import { progress, syncStatus } from "./save.js";
import { isMuted, toggleMute } from "./audio.js";

// -- Toast --------------------------------------------------------------------------
let toastText: string | null = null;
let toastUntil = 0;
export function toast(text: string): void {
  toastText = text;
  toastUntil = frame().time + 2.6;
  ui.announce(text);
}
let signedOutNotice = false;
export function noteSignedOut(): void { signedOutNotice = true; }

// -- Helpers ------------------------------------------------------------------------
interface View { w: number; h: number; s: number; narrow: boolean; short: boolean }
function view(): View {
  const { width, height, safeArea } = frame();
  const s = ui.preferences().scale;
  const w = (width - safeArea.left - safeArea.right) / s;
  const h = (height - safeArea.top - safeArea.bottom) / s;
  return { w, h, s, narrow: w <= 720, short: h <= 500 && w > h };
}

/** Logical width of a styled button's face (padding included). */
function buttonWidth(text: string, style: readonly string[]): number {
  return ui.measureText(text, { kind: "button", style: [...style] }).width / ui.preferences().scale + 2;
}

interface Btn { id: string; text: string; style?: string[]; selected?: boolean; act: () => void }
const BIG = ["av-btn", "av-primary", "av-big"];
const PLAIN = ["av-btn"];

/** A button `width` wide (null: its text's); a label too long for it wraps inside. */
function button(b: Btn, width: number | null): void {
  const style = b.style ?? PLAIN;
  const opts: ui.ButtonOptions = { ...(b.selected !== undefined ? { selected: b.selected } : {}) };
  const s: ui.Style = width != null ? { width } : {};
  if (width != null && buttonWidth(b.text, style) > width) {
    const inner = width - 30;
    opts.content = () => { ui.paragraph(b.text, inner); };
  }
  if (ui.style(...style, s).id(b.id).button(b.text, opts)) b.act();
}

/** Buttons that flex like the browser build's `.actions .btn { flex: 1 1 220px }`:
 * rows of equal columns at least `basis` wide filling `width`. */
function actionGrid(label: string, list: Btn[], width: number, basis = 220): void {
  const gap = 10;
  const widest = Math.max(0, ...list.map((b) => buttonWidth(b.text, b.style ?? BIG)));
  const min = Math.min(width, Math.max(basis, Math.min(widest, 360)));
  const cols = Math.max(1, Math.min(list.length, Math.floor((width + gap) / (min + gap))));
  const bw = (width - gap * (cols - 1)) / cols;
  ui.column(label, () => {
    for (let i = 0; i < list.length; i += cols) {
      ui.row(`${label}-r${i}`, () => {
        for (const b of list.slice(i, i + cols)) button({ ...b, style: b.style ?? BIG }, bw);
      }, { spacing: gap, align: "stretch" });
    }
  }, { spacing: gap, padding: { top: 6, bottom: 6 } });
}

/** Buttons at their own widths in rows that wrap at `width` (CSS flex-wrap). */
function flow(label: string, list: Btn[], width: number, gap = 10): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  for (const b of list) {
    const bw = Math.min(width, buttonWidth(b.text, b.style ?? PLAIN));
    if (rows.at(-1)!.length && used + gap + bw > width) { rows.push([]); used = 0; }
    used += (rows.at(-1)!.length ? gap : 0) + bw;
    rows.at(-1)!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      for (const b of row) button(b, buttonWidth(b.text, b.style ?? PLAIN) > width ? width : null);
    }, { spacing: gap, align: "center" }));
  }, { spacing: gap });
}

function h1(text: string): void { ui.style("av-h1").heading(text); }
function h2(text: string, id?: string): void { (id ? ui.id(id) : ui).style("av-h2").heading(text); }
function p(text: string, width: number, id?: string): void { (id ? ui.id(id) : ui).style("av-p").paragraph(text, Math.min(width, 530)); }
function list(items: string[], width: number, label: string): void {
  const w = Math.min(width, 600);
  ui.column(label, () => {
    items.forEach((t, i) => ui.row(`${label}-${i}`, () => {
      ui.style("av-li").label("•");
      ui.style("av-li").id(`${label}-${i}-t`).paragraph(t, w - 22);
    }, { spacing: 8, align: "start" }));
  }, { spacing: 4, padding: { start: 6 } });
}
function hr(width: number): void { ui.widget("", { role: "none", size: { width, height: 1 }, style: "av-hr" }); }
function art(cls: string, width: number, ratio: number, maxH = Infinity): void {
  const h = Math.min(maxH, width / ratio);
  ui.widget("", { role: "image", size: { width, height: h }, style: cls });
}

/** The footer: small notes, then its buttons (`.foot`). */
function foot(label: string, notes: string[], buttons: Btn[], width: number): void {
  ui.style("av-foot").column(label, () => {
    notes.forEach((n, i) => { if (n) ui.style("av-small").id(`${label}-n${i}`).paragraph(n, width); });
    if (buttons.length) flow(`${label}-b`, buttons, width);
  }, { width, spacing: 10, padding: { top: 10 } });
}

function settingsBtn(id = "btn-settings"): Btn { return { id, text: T("settings.open"), act: openMenu }; }

/** A key's label for on-screen prompts: the runtime's, shortened as the browser build did. */
function keyName(label: string): string {
  // (natively without a keyboard layout the runtime answers the code, KeyD;
  // browsers answer the layout's character, d)
  const named: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc", NumpadEnter: "Num Enter" };
  if (named[label]) return named[label]!;
  if (/^Key[A-Z]$/.test(label)) return label.slice(3);
  if (/^Digit\d$/.test(label)) return label.slice(5);
  if ([...label].length === 1) return label.toUpperCase();
  return label;
}
function keysOf(action: string): string { return keyName(bindingLabel(action, "keyboard")); }
function keysLine(): string {
  return T("keys.line", {
    move: `${keysOf("left")} ${keysOf("right")} ${keysOf("up")} ${keysOf("down")}`,
    build: keysOf("build"), tick: keysOf("tick"), auto: keysOf("auto"), belt: keysOf("belt"), machine: keysOf("machine"),
    rotate: keysOf("rotate"), remove: keysOf("remove"), upgrade: keysOf("upgrade"), hint: keysOf("hint"),
    undo: keysOf("undo"), pause: keysOf("pause"),
  });
}

// -- Menus --------------------------------------------------------------------------
function accountText(): string {
  const me = player();
  if (!me) return T(signedOutNotice ? "sh.signedOut" : "sh.offline");
  const sync = syncStatus();
  return `${T("sh.playingAs", { name: me.displayName.slice(0, 40) })} · ${T(sync === "synced" ? "sh.synced" : sync === "saving" ? "sh.saving" : "sh.syncOff")}`;
}

function modeButtons(order: "title" | "modes"): Btn[] {
  const b = {
    play: { id: "m-play", text: T("m.play"), act: () => game.setScreen("mode-select") },
    daily: { id: "m-daily", text: T("m.daily"), act: game.startDaily },
    journey: { id: "m-journey", text: T("m.journey"), act: () => game.setScreen("journey-select") },
    lessons: { id: "m-lessons", text: T("m.lessons"), act: () => game.setScreen("lesson-select") },
    challenges: { id: "m-challenges", text: T("m.challenges"), act: () => game.setScreen("challenge-select") },
    practice: { id: "m-practice", text: T("m.practice"), act: () => game.setScreen("practice-select") },
    score: { id: "m-score", text: T("m.score"), act: game.startScoreChase },
  };
  return order === "title"
    ? [b.play, b.daily, b.journey, b.lessons, b.challenges, b.practice, b.score]
    : [b.lessons, b.journey, b.daily, b.challenges, b.practice, b.score];
}

function titleScreen(w: number, v: View): void {
  h1("Assembly Vale");
  p(T("title.desc"), w);
  art("av-keyart", w, 1536 / 864, v.short ? 160 : 300);
  actionGrid("title-actions", modeButtons("title"), w);
  const s = progress().stats;
  const buttons = [settingsBtn()];
  if (!player()) buttons.push({ id: "btn-sign-in", text: T("sh.signIn"), act: signIn });
  else buttons.push({ id: "btn-invite", text: T("sh.invite"), act: () => toast(copyInvite()) });
  foot("foot", [T("title.stats", { rounds: s.rounds, wins: s.wins, best: s.bestScore }), accountText(), T("title.fair")], buttons, w);
}

function modeSelect(w: number): void {
  h2(T("modes.title"));
  p(T("modes.desc"), w);
  actionGrid("modes", modeButtons("modes"), w);
  foot("foot", [T("modes.backTitle")], [{ id: "btn-title", text: T("btn.title"), act: () => game.setScreen("title") }], w);
}

function back(to: game.Screen): Btn { return { id: "btn-back", text: T("btn.back"), act: () => game.setScreen(to) }; }

function journeySelect(w: number): void {
  h2(T("m.journey"));
  p(T("journey.desc"), w);
  const prog = progress();
  actionGrid("journey", Content.JOURNEY.map((st, i) => {
    const best = prog.journeyBest[st.id];
    return { id: `j-${st.id}`, text: T(`j.${st.id}`) + (st.mastery ? " *" : "") + (best ? T("journey.best", { n: best }) : ""), act: () => game.startJourney(i) };
  }), w);
  foot("foot", [T("journey.mastery")], [back("mode-select")], w);
}

function lessonSelect(w: number): void {
  h2(T("m.lessons"));
  p(T("lessons.desc"), w);
  const prog = progress();
  actionGrid("lessons", Content.LESSONS.map((l, i) => ({ id: `l-${l.id}`, text: T(`lesson.${l.id}`) + (prog.tutorialDone[l.id] ? " ✓" : ""), act: () => game.startLesson(i) })), w);
  foot("foot", [T("lessons.foot")], [back("mode-select")], w);
}

function challengeSelect(w: number): void {
  h2(T("m.challenges"));
  p(T("challenges.desc"), w);
  actionGrid("challenges", Content.CHALLENGES.map((c) => ({ id: `c-${c.id}`, text: T(`ch.${c.id}`), act: () => game.startChallenge(c.id) })), w);
  list(Content.CHALLENGES.map((c) => `${T(`ch.${c.id}`)} — ${T(`chd.${c.id}`)}`), w, "ch-list");
  foot("foot", [T("challenges.foot")], [back("mode-select")], w);
}

function practiceSelect(w: number): void {
  h2(T("m.practice"));
  p(T("practice.desc"), w);
  const diffs = ["relaxed", "standard", "veteran"];
  actionGrid("practice", diffs.map((d) => ({ id: `p-${d}`, text: T(`pr.${d}`), act: () => game.startPractice(d) })), w);
  list(diffs.map((d) => `${T(`pr.${d}`)} — ${T(`prd.${d}`)}`), w, "pr-list");
  foot("foot", [T("practice.foot")], [back("mode-select")], w);
}

function helpScreen(w: number, v: View): void {
  h2(T("help.title"));
  p(T("help.intro"), w);
  list([T("help.1"), T("help.2"), T("help.3"), T("help.4"), T("help.5", { keys: keysOf("undo") }), keysLine()], w, "help-list");
  art("av-helpart", Math.min(w, 520, v.h * 0.3 * 1024 / 576), 1024 / 576);
  foot("foot", [T("help.foot")], [{ id: "btn-help-back", text: T("btn.back"), style: ["av-btn", "av-primary"], act: game.closeHelp }], w);
}

function pausedScreen(w: number): void {
  h2(T("paused.title"));
  p(T("paused.desc"), w);
  actionGrid("paused", [
    { id: "btn-resume", text: T("btn.resume"), act: () => game.setScreen("play") },
    { id: "btn-restart", text: T("btn.restart"), act: game.restart },
    { id: "btn-howto", text: T("btn.howto"), act: () => game.setScreen("help") },
    { id: "btn-sound", text: T(isMuted() ? "sound.off" : "sound.on"), act: () => game.soundStatus(toggleMute()) },
    { ...settingsBtn("btn-settings-paused"), style: BIG },
    { id: "btn-leave", text: T("btn.leave"), act: game.leaveRound },
  ], w);
  foot("foot", [T("paused.foot")], [], w);
}

function resultsScreen(w: number, v: View): void {
  const st = game.state!;
  const won = !!st.terminal?.won;
  h2(T(won ? "res.won" : "res.over"));
  p(won ? T("res.wonDesc", { n: Math.max(0, (st.cfg.tickLimit || 0) - st.tick) })
    : T(st.terminal?.reason === "resigned" ? "res.resigned" : "res.lost"), w);
  const ticks = st.tick + (st.cfg.tickLimit ? ` / ${st.cfg.tickLimit}` : "");
  list([T("res.score", { n: st.score.total }), T("res.goods", { n: st.score.goods }), T("res.bonus", { n: st.score.contractBonus }),
    T("res.gold", { n: st.score.goldLeft }), T("res.speed", { n: st.score.speedBonus }), T("res.ticks", { n: ticks })], w, "res-list");
  const lb = game.leaderboardLine();
  if (lb) ui.style("av-p").id("results-lb").paragraph(lb, w);
  art(won ? "av-ledger" : "av-ledger-lost", Math.min(w, 520, v.h * 0.3 * 1024 / 576), 1024 / 576);
  const actions: Btn[] = [{ id: "btn-again", text: T("btn.again"), act: game.restart }];
  if (game.kind() === "journey" && game.journeyIndex >= 0 && game.journeyIndex < Content.JOURNEY.length - 1) {
    const next = game.journeyIndex + 1;
    actions.push({ id: "btn-next", text: T("btn.next"), act: () => game.startJourney(next) });
  }
  actions.push({ id: "btn-modes", text: T("btn.modes"), act: () => game.setScreen("mode-select") });
  actionGrid("res-actions", actions, w);
  foot("foot", [T("res.foot")], [{ id: "btn-title", text: T("btn.title"), act: () => game.setScreen("title") }], w);
}

// -- The play screen ------------------------------------------------------------------
function header(w: number, v: View): void {
  const st = game.state!;
  const tick = st.tick + (st.cfg.tickLimit ? ` / ${st.cfg.tickLimit}` : "");
  const pills = [T("hud.gold", { n: st.gold }), T("hud.tick", { n: tick })];
  const btns: Btn[] = [
    { id: "btn-pause", text: T("btn.pause"), act: () => game.setScreen("paused") },
    { id: "btn-help", text: T("btn.help"), act: () => game.setScreen("help") },
    settingsBtn("btn-settings-play"),
  ];
  const s = v.s;
  const pillW = pills.map((t) => ui.measureText(t, { style: ["av-pill"] }).width / s + 26);
  const btnW = btns.map((b) => buttonWidth(b.text, PLAIN));
  const tools = pillW.reduce((a, b) => a + b + 10, 0) + btnW.reduce((a, b) => a + b + 10, 0);
  const titleW = ui.measureText(game.stageName(), { kind: "heading", style: ["av-h2", ...(v.short ? [{ text: { size: 17.6 } }] : [])] }).width / s;
  const pillsRow = (): void => {
    pills.forEach((t, i) => ui.style("av-pill").id(`pill-${i}`).label(t));
  };
  const titleStyle = ["av-h2", v.short && { text: { size: 17.6 } }];
  ui.style("av-head").column("head", () => {
    if (titleW + tools + 10 <= w) {
      ui.row("head-row", () => {
        ui.style(...titleStyle).id("stage").heading(game.stageName());
        ui.spacer();
        pillsRow();
        for (const b of btns) button(b, null);
      }, { width: w, spacing: v.short ? 8 : 10, align: "center" });
    } else {
      ui.style(...titleStyle).id("stage").heading(game.stageName());
      ui.row("head-pills", pillsRow, { spacing: 10, align: "center" });
      flow("head-btns", btns, w, v.short ? 8 : 10);
    }
  }, { width: w, spacing: v.short ? 6 : 10, padding: { bottom: v.short ? 6 : 10 } });
}

function infoPanel(w: number, v: View): void {
  const st = game.state!;
  const pad = v.short ? 8 : 12;
  const inner = w - pad * 2 - 2;
  ui.style("av-panel").column("info", () => {
    const lesson = game.currentLesson();
    if (lesson) {
      ui.style("av-lesson").id("lesson-text").paragraph(T(`lessonx.${lesson.id}`), inner);
      hr(inner);
    }
    for (const good of Object.keys(st.cfg.contracts)) {
      const need = st.cfg.contracts[good]!, have = st.progress[good] || 0;
      ui.style(have >= need ? "av-done" : "av-row").id(`contract-${good}`).paragraph(T("info.contract", { good: game.goodName(good), have, need }), inner);
    }
    hr(inner);
    ui.style("av-row").id("info-score").label(T("info.score", { n: st.score.total }));
    ui.style("av-dim").id("info-goods").label(T("info.goods", { n: st.score.goods }));
    ui.style("av-dim").id("info-bonus").label(T("info.bonus", { n: st.score.contractBonus }));
    ui.style("av-dim").id("info-gold").paragraph(T("info.gold", { n: st.score.goldLeft }), inner);
    ui.style("av-dim").id("info-speed").label(T("info.speed", { n: st.score.speedBonus }));
    if (st.cfg.buildLimit) ui.style("av-dim").id("info-builds").label(T("info.builds", { n: st.builds, max: st.cfg.buildLimit }));
    hr(inner);
    ui.style("av-dim").id("info-selected").paragraph(T("info.selected", { cell: game.describeCell(game.selected.x, game.selected.y) }), inner);
  }, { width: w, padding: pad, spacing: 4 });
}

function toolPanel(w: number, v: View): void {
  const st = game.state!;
  const pad = v.short ? 8 : 12;
  const inner = w - pad * 2 - 2;
  const tb = (id: game.Tool, text: string): void => button({ id: `tool-${id}`, text, style: ["av-tool"], selected: game.tool === id, act: () => game.setTool(id) }, inner);
  ui.style("av-panel").column("tools", () => {
    tb("belt", T("tool.belt", { cost: Rules.beltCost(st) }));
    const cat = Rules.buildCatalog(st);
    for (const c of cat) {
      if (c.kind !== "machine" || !c.recipe) continue;
      const rec = Rules.recipeById(st.cfg, c.recipe)!;
      const recipe = c.recipe;
      const text = T("tool.machine", { name: game.recipeName(rec), in: game.goodName(rec.input), out: game.goodName(rec.output), cost: c.cost });
      button({ id: `tool-machine-${recipe}`, text, style: ["av-tool", ...(c.afford ? [] : ["av-poor"])],
        selected: game.tool === "machine" && game.recipeChoice === recipe, act: () => game.chooseMachine(recipe) }, inner);
    }
    if (cat.length < 2) ui.style("av-dim").id("tool-none").paragraph(T("tool.none"), inner);
    tb("rotate", T("tool.rotate"));
    tb("remove", T("tool.remove"));
    if (st.cfg.upgrades) tb("upgrade", T("tool.upgrade"));
  }, { width: w, padding: pad, spacing: v.short ? 6 : 8 });
}

function actionPanel(w: number, v: View): void {
  const pad = v.short ? 8 : 12;
  const inner = w - pad * 2 - 2;
  const primary = ["av-btn", "av-primary", "av-big"];
  ui.style("av-panel").column("actions", () => {
    button({ id: "act-tick", text: T("act.tick"), style: primary, act: game.doTick }, inner);
    button({ id: "act-auto", text: T(game.auto ? "act.stop" : "act.auto"), style: primary, act: game.toggleAuto }, inner);
    button({ id: "act-hint", text: T("act.hint"), style: primary, act: game.showHint }, inner);
    if (game.undoEnabled()) button({ id: "act-undo", text: T("act.undo"), act: game.undo }, inner);
    button({ id: "act-restart", text: T("btn.restart"), act: game.restart }, inner);
  }, { width: w, padding: pad, spacing: v.short ? 6 : 8 });
}

const LEGEND: [string, string][] = [["lg.source", "#3b3f45"], ["lg.belt", "#4c4438"], ["lg.machine", "#5b3f7a"], ["lg.exchange", "#b5342a"], ["lg.rock", "#8b8f96"]];
function legend(w: number): void {
  const items = LEGEND.map(([k, c]) => ({ text: T(k), c, width: ui.measureText(T(k), { style: ["av-legend"] }).width / ui.preferences().scale + 20 }));
  const rows: (typeof items)[] = [[]];
  let used = 0;
  for (const it of items) {
    if (rows.at(-1)!.length && used + 8 + it.width > w) { rows.push([]); used = 0; }
    used += (rows.at(-1)!.length ? 8 : 0) + it.width;
    rows.at(-1)!.push(it);
  }
  ui.column("legend", () => {
    rows.forEach((row, ri) => ui.row(`legend-${ri}`, () => {
      for (const it of row) {
        ui.row(`lg-${it.text}`, () => {
          ui.widget("", { role: "none", size: { width: 14, height: 14 }, style: "av-swatch",
            draw: (r, st) => { draw.roundRect(r.x + st.scale, r.y + st.scale, r.width - 2 * st.scale, r.height - 2 * st.scale, 2 * st.scale, it.c); } });
          ui.style("av-legend").label(it.text);
        }, { spacing: 6, align: "center" });
      }
    }, { spacing: 8, align: "center" }));
  }, { spacing: 4, padding: { top: 8 } });
}

/** Presses on the board this frame (a pointer or finger, not Enter on the focused board). */
let boardPressFrame = -1;
export function notePointerPress(): void { boardPressFrame = frame().frame; }

function boardWidget(width: number, height: number): void {
  const st = game.state!;
  const names = { good: game.goodName, recipe: (id: string | undefined) => game.recipeName(Rules.recipeById(st.cfg, id)) };
  const res = ui.id("board").widget(T("board.aria"), {
    role: "region", size: { width, height }, style: "av-board",
    draw: (r, state) => {
      const b = state.scale;
      board.drawBoard(st, { x: r.x + b, y: r.y + b, width: r.width - 2 * b, height: r.height - 2 * b }, game.selected, names);
    },
  });
  if (!res.activated) return;
  const pt = res.pointer;
  const b = ui.preferences().scale;
  if (pt && pt.inside && Math.abs(boardPressFrame - frame().frame) <= 2) {
    const c = board.cellAt(st, { x: b, y: b, width: res.width - 2 * b, height: res.height - 2 * b }, pt.x, pt.y);
    if (!c) return;
    game.selectCell(c.x, c.y);
    game.applyToolAt(c.x, c.y);
  } else game.applyToolAt(game.selected.x, game.selected.y);
}

function boardColumn(w: number, maxH: number, v: View): void {
  const st = game.state!;
  const ar = st.cfg.board.cols / st.cfg.board.rows;
  const bw = Math.max(120, Math.min(w, maxH * ar));
  ui.column("canvas-wrap", () => {
    boardWidget(bw, bw / ar);
    if (!v.short) legend(w);
  }, { width: w, align: v.short ? "center" : "start" });
}

function playScreen(w: number, v: View): void {
  header(w, v);
  const gap = v.short ? 10 : 14;
  if (v.narrow && !v.short) {
    boardColumn(w, v.h * 0.62, v);
    infoPanel(w, v);
    toolPanel(w, v);
    actionPanel(w, v);
  } else if (v.short) {
    // short landscape: the columns keep 200 px and scroll; the board takes the height
    const colW = 200;
    const centerW = Math.max(160, w - 2 * colW - 2 * gap);
    const colH = Math.max(120, v.h - 80);
    ui.row("body", () => {
      ui.scrollArea("col-left", { width: colW, height: colH }, () => infoPanel(colW - 8, v));
      boardColumn(centerW, v.h - 110, v);
      ui.scrollArea("col-right", { width: colW, height: colH }, () => {
        ui.column("col-right-in", () => { toolPanel(colW - 8, v); actionPanel(colW - 8, v); }, { spacing: 8 });
      });
    }, { spacing: gap, align: "start" });
  } else {
    // .col { flex: 1 1 220px } .canvas-wrap { flex: 2 1 420px }
    const free = w - 2 * gap;
    let side = Math.max(200, free / 4);
    let center = free - 2 * side;
    if (center < 420 && free - 2 * 200 >= 420) { center = 420; side = (free - center) / 2; }
    ui.row("body", () => {
      ui.column("col-left", () => infoPanel(side, v), { width: side });
      boardColumn(center, v.h - 150, v);
      ui.column("col-right", () => { toolPanel(side, v); actionPanel(side, v); }, { width: side, spacing: 12 });
    }, { spacing: gap, align: "start" });
  }
  ui.style("av-foot").column("play-foot", () => {
    ui.style("av-hint").id("hint").paragraph(game.hintText(), w);
    ui.style("av-status").id("status").paragraph(game.status() || " ", w);
    button({ id: "btn-title-play", text: T("btn.title"), act: game.leaveRound }, null);
  }, { width: w, spacing: 8, padding: { top: v.short ? 6 : 10 } });
}

// -- The frame ---------------------------------------------------------------------------
let shownSerial = -1;
let changedFrame = 0;
/** Builds this frame's UI (from onUpdate, so a press's frame may sign in or copy). */
export function buildUi(): void {
  const v = view();
  const { width, height, safeArea } = frame();
  if (game.screenSerial !== shownSerial) { shownSerial = game.screenSerial; changedFrame = frame().frame; }
  // Back (Escape, East) on the menus, as the browser build's Escape did; the
  // pause action (P, Escape) is main.ts's. Not on the frame a screen opened,
  // so the Escape that paused does not also resume.
  if (ui.back() && frame().frame > changedFrame) {
    switch (game.screen) {
      case "help": game.closeHelp(); break;
      case "paused": break; // the pause action resumes
      case "play": case "title": break;
      default: game.setScreen("title");
    }
  }
  // A changed screen starts at the top (the browser build scrolled to 0).
  const scrollTo = frame().frame - changedFrame < 2 ? { top: 0, behavior: "instant" as const } : undefined;
  const pad = v.short ? 6 : 12;
  ui.area({ x: safeArea.left, y: safeArea.top, width: width - safeArea.left - safeArea.right, height: height - safeArea.top - safeArea.bottom }, () => {
    ui.scrollArea(`page-${game.screen}`, { width: v.w, height: v.h }, () => {
      const w = Math.min(game.screen === "play" && v.w > 1600 ? 1500 : 1180, v.w) - pad * 2;
      ui.column("page", () => {
        ui.column("root", () => {
          switch (game.screen) {
            case "title": titleScreen(w, v); break;
            case "mode-select": modeSelect(w); break;
            case "journey-select": journeySelect(w); break;
            case "lesson-select": lessonSelect(w); break;
            case "challenge-select": challengeSelect(w); break;
            case "practice-select": practiceSelect(w); break;
            case "help": helpScreen(w, v); break;
            case "paused": pausedScreen(w); break;
            case "results": if (game.state) resultsScreen(w, v); else game.setScreen("title"); break;
            case "play": if (game.state) playScreen(w, v); else game.setScreen("title"); break;
          }
        }, { width: w, padding: { top: pad, bottom: pad }, spacing: v.short ? 8 : 12 });
      }, { width: v.w, align: "center" });
    }, scrollTo ? { scrollTo } : {});
  });
  if (toastText && frame().time > toastUntil) toastText = null;
  if (toastText) {
    const text = toastText;
    ui.place("toast", { anchor: "bottom", y: 20 }, () => {
      ui.style("av-toast").paragraph(text, Math.min(v.w - 32, 560));
    });
  }
}

/** The page's background (the browser build's body gradient), under the UI. */
export function drawBackground(): void {
  const { width, height } = frame();
  draw.box(0, 0, width, height, "av-page");
}

