// Assembly Vale on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), natively in the StarHermit client and in browsers on the
// engine's web runtime. Lay conveyors from the mines to the Exchange, refine
// goods with machines and fill every contract before the tick limit.
import { onRender, onStart, onSuspend, onUpdate } from "starhermit:engine";
import { onAction, onPointerButton, onTouch } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onPlayerChange, onSessionEnded } from "starhermit:platform";
import * as board from "./board.js";
import * as game from "./game.js";
import { refresh } from "./online.js";
import { initSave } from "./save.js";
import { buildUi, drawBackground, notePointerPress, noteSignedOut, toast } from "./screens.js";
import { loadSfx, updateAudio } from "./audio.js";
import { initStyles } from "./style.js";
import { T } from "./i18n.js";

board.setTweenSource(game.tweenMs);

onStart(() => {
  initStyles();
  initSave();
  refresh();
  void loadSfx(); // the title needs no sound to show; clips load behind it
});

onPlayerChange(() => refresh());
onSessionEnded(() => { noteSignedOut(); toast(T("sh.signedOut")); });
// Backgrounding pauses a running round (the browser build's visibilitychange).
onSuspend(() => game.suspend());

// A press on the board is a pointer's or a finger's (Enter on the focused board is the keyboard's).
onPointerButton((e) => { if (e.pressed && e.button === 0) notePointerPress(); });
onTouch((e) => { if (e.phase === "start" || e.phase === "end") notePointerPress(); });

// The manifest's actions (players rebind them in the runtime's Options).
onAction((e) => {
  if (!e.pressed || ui.capturingKeys()) return;
  const screen = game.screen;
  if (screen === "paused") {
    if (e.action === "pause") game.setScreen("play");
    return;
  }
  if (screen !== "play" || !game.state || game.state.terminal) return;
  // Enter and Space on a focused button are the button's (the board's Enter is its own).
  const onWidget = e.source === "keyboard" && ui.focused() !== null;
  switch (e.action) {
    // the arrows move the board selection (as the browser build's did), not the UI focus
    case "left": ui.setFocus(null); game.moveSelection(-1, 0); break;
    case "right": ui.setFocus(null); game.moveSelection(1, 0); break;
    case "up": ui.setFocus(null); game.moveSelection(0, -1); break;
    case "down": ui.setFocus(null); game.moveSelection(0, 1); break;
    case "build": if (!onWidget) game.applyToolAt(game.selected.x, game.selected.y); break;
    case "tick": if (!onWidget) game.doTick(); break;
    case "belt": game.setTool("belt"); break;
    case "machine": game.setTool("machine"); break;
    case "rotate": game.setTool("rotate"); break;
    case "remove": game.setTool("remove"); break;
    case "upgrade": game.setTool("upgrade"); break;
    case "hint": game.showHint(); break;
    case "undo": game.undo(); break;
    case "auto": game.toggleAuto(); break;
    case "pause": game.setScreen("paused"); break;
  }
});

onUpdate((dt) => {
  game.update(dt);
  updateAudio();
  buildUi();
});
onRender(() => {
  drawBackground();
});
