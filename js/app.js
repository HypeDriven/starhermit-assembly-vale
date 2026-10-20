/* Assembly Vale — browser application.
 * Wires the pure rules engine (rules.js) and content (content.js) to a
 * semantic-HTML UI with procedural WebAudio (audio.js). The board is drawn
 * on a canvas with a keyboard-navigable selection; all state lives in the
 * rules module.
 */

var Rules = window.AVRules;
var Content = window.AVContent;
var Store = window.AVStore;
var AudioMod = window.AVAudio;
var Platform = window.AVPlatform;
var Gfx = window.AVGfx;
var Board = window.AVBoard;
var I18n = window.AVI18n;

// ---------- settings + progress (persisted) ----------
function loadSettings() { return Object.assign({}, Store.DEFAULT_SETTINGS, Store.load().settings); }
function saveSettings(s) { var doc = Store.load(); doc.settings = s; Store.save(doc); }
function loadProgress() { return Store.load().progress; }
function saveProgress(p) { var doc = Store.load(); doc.progress = p; Store.save(doc); }
var settings = loadSettings();

// ---------- session state ----------
var screen = 'title';       // title | mode-select | *-select | play | paused | results | help
var tool = null;            // 'belt' | 'machine' | 'rotate' | 'remove' | 'upgrade'
var recipeChoice = null;    // recipe id used by the machine tool
var selectedCell = { x: 0, y: 0 };
var sessionCfg = null;      // rules cfg for the active round (kind + id)
var state = null;           // current rules state
var journeyIndex = -1;      // index into Content.JOURNEY when kind === 'journey'
var autoTimer = null;       // auto-run interval handle
var history = [];           // previous states, for undo where the mode allows it
var statusText = '';        // live-region message

// ---------- graphics (quality model in gfx.js, drawing in board.js) ----------
// ---------- language (strings in i18n.js, preference in sh-language.js) ----------
// Settings → Language: explicit choice → StarHermit preferred language →
// navigator.languages → en-US. A change re-renders the current screen in place.
var LOCALE = 'en-US';
var tr = I18n.make(LOCALE);
function setLocale(locale) {
  LOCALE = I18n.LOCALES.indexOf(locale) >= 0 ? locale : 'en-US';
  tr = I18n.make(LOCALE);
  document.documentElement.lang = LOCALE;
  if (el && el.root) onLanguageChange();
}
var language = window.StarHermitLanguage ? window.StarHermitLanguage.create({
  game: 'assembly-vale', supported: I18n.LOCALES, apply: setLocale
}) : null;
if (!language) setLocale(I18n.pick((navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language]));

// Content keeps English data; names and texts are looked up by id.
function recipeName(rec) { return rec ? tr('rec.' + rec.id) : tr('cell.machineGeneric'); }
function journeyName(st) { return tr('j.' + st.id); }
function lessonName(l) { return tr('lesson.' + l.id); }
function lessonText(l) { return tr('lessonx.' + l.id); }
function challengeLabel(c) { return tr('ch.' + c.id); }
function challengeDesc(c) { return tr('chd.' + c.id); }
function practiceLabel(d) { return tr('pr.' + d); }
function practiceDesc(d) { return tr('prd.' + d); }
function dirName(d) { return tr('dir.' + d); }
var gpuName = detectGpu();
var isMobile = detectMobile();
// StarHermit hardware level 0–20 (gpu-level.js) → Auto preset: Low 0, Balanced 4, High 10, Ultra 17.
var gpuLevel = (function () {
  try { if (window.StarHermitGpu) return window.StarHermitGpu.info().level; } catch (e) { /* fall through */ }
  return Gfx.detectLevel(gpuName, { mobile: isMobile });
})();
var detectedPreset = Gfx.presetForLevel(gpuLevel);
var gfx = null;                    // resolved settings (Gfx.resolve)
var gfxShared = { adaptive: 1 };   // adaptive resolution scale, kept across screens
var gfxFailed = false;             // an overlay pass threw; the board renders without it
var boardView = null;              // renderer for the play board or the settings preview
var previewState = null;           // sample round shown in the Graphics panel
var settingsReturn = 'title';      // screen to go back to from Settings
var fpsEl = null;

// GPU name for Auto and the summary line. Software rendering (or no WebGL
// at all) is reported as such so Auto picks Low.
function detectGpu() {
  try {
    var c = document.createElement('canvas');
    var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return 'Software (no WebGL)';
    var name = '';
    // Firefox already exposes the unmasked name and warns about the extension.
    if (!/Firefox\//.test(navigator.userAgent)) {
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) name = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    }
    if (!name) name = gl.getParameter(gl.RENDERER);
    var lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return String(name || 'Unknown GPU');
  } catch (e) { return 'Unknown GPU'; }
}

function detectMobile() {
  try {
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return !!(coarse && (navigator.maxTouchPoints || 0) > 0);
  } catch (e) { return false; }
}

function reducedMotion() {
  var os = false;
  try { os = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
  return os || !!settings.reducedMotion;
}

function gfxSaved() { return settings.graphics || {}; }

// Resolve the saved graphics settings and push them to every live renderer.
function applyGraphics() {
  gfx = Gfx.resolve(gfxSaved(), detectedPreset, { reducedMotion: reducedMotion(), level: gpuLevel });
  document.body.setAttribute('data-gfx-preset', gfx.preset);
  if (boardView) boardView.setConfig(gfx);
  updateFps(null);
  refreshGfxSummary();
}

function saveGraphics(next) {
  settings.graphics = next;
  saveSettings(settings);
  applyGraphics();
}

function updateFps(fps, ms) {
  if (!gfx || !gfx.showFps) { if (fpsEl && fpsEl.parentNode) fpsEl.parentNode.removeChild(fpsEl); fpsEl = null; return; }
  if (!fpsEl) { fpsEl = h('div', { id: 'gfx-fps-readout', 'aria-hidden': 'true' }); document.body.appendChild(fpsEl); }
  fpsEl.textContent = fps == null ? '… fps' : tr('gfx.fpsReadout', { fps: fps, ms: (ms || 0).toFixed(1) });
}

function makeBoardView(canvas, getState, getSelected) {
  if (boardView) boardView.destroy();
  boardView = Board.create(canvas, {
    getState: getState,
    getSelected: getSelected,
    cellSize: function (s) { return cellSizeFor(s); },
    tweenMs: function () { return autoTimer ? Math.round(Math.max(120, 420 / (settings.simSpeed || 1)) * 0.7) : 170; },
    shared: gfxShared,
    onFps: function (fps, ms) { updateFps(fps, ms); },
    onFail: function () { gfxFailed = true; refreshGfxSummary(); },
    onResize: function () { refreshGfxSummary(); },
    // localized initials drawn on sources and machines
    goodName: function (id) { return goodName(id); },
    recipeName: function (rec) { return recipeName(rec); }
  });
  boardView.setConfig(gfx);
  return boardView;
}

// tool ids used by UI buttons
var TOOL_BELT='belt', TOOL_MACHINE='machine', TOOL_ROTATE='rotate', TOOL_REMOVE='remove', TOOL_UPGRADE='upgrade';

function now() { return Date.now(); }

// Current UTC day, used by the daily challenge seed.
function todayStr() { return new Date().toISOString().slice(0, 10); }

// ---------- DOM helpers (all elements created here) ----------
var el = {}; // id -> element, filled in init()

function h(tag, attrs, children) {
  var e = document.createElement(tag);
  if (attrs) for (var k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'for') e.htmlFor = attrs[k];
    else if (k.slice(0,2)==='on' && typeof attrs[k]==='function') e.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] != null) e.setAttribute(k, String(attrs[k]));
  }
  if (children) for (var i=0;i<children.length;i++) { var c = children[i]; if (c==null) continue; e.appendChild(typeof c==='string'?document.createTextNode(c):c); }
  return e;
}

function clearNode(node) { while (node.firstChild) node.removeChild(node.firstChild); }

// Decorative illustration; purely cosmetic, removed if the file is missing.
function art(src, cls) {
  var img = h('img', { class: 'art ' + (cls || ''), src: src, alt: '', 'aria-hidden': 'true', decoding: 'async' });
  img.addEventListener('error', function () { if (img.parentNode) img.parentNode.removeChild(img); });
  return img;
}

// ---------- audio lifecycle ----------
function captionStatus(text) { setStatus(function () { return tr('cap.' + text); }); }
function startAudio() { AudioMod.start(); AudioMod.applySettings(settings); AudioMod.setCaptions(!!settings.captions, captionStatus); }
function stopAudio() { AudioMod.suspend(); }
function sfx(name) { try { AudioMod.play(name); } catch (e) { /* audio is optional */ } }

// =====================================================================
//  SCREENS
// =====================================================================

// Account + cloud-sync status line for the title screen footer.
var signedOutNotice = false;
function accountText() {
  if (!Platform.hosted) return tr(signedOutNotice ? 'sh.signedOut' : 'sh.offline');
  var name = Platform.profile ? Platform.profile.displayName : '…';
  var syncTxt = Platform.sync === 'synced' ? tr('sh.synced')
    : Platform.sync === 'saving' ? tr('sh.saving')
    : tr('sh.syncOff');
  return tr('sh.playingAs', { name: name }) + ' · ' + syncTxt;
}

var toastTimer = 0;
function showToast(text) {
  var t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(t); }
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
}
function copyInvite() {
  var link = Platform.inviteLink();
  if (!link) return;
  var fail = function () { showToast(tr('sh.inviteFailed') + ' ' + link); };
  try {
    navigator.clipboard.writeText(link).then(function () { showToast(tr('sh.inviteCopied')); }, fail);
  } catch (e) { fail(); }
}
// Sign-in (platform host without a token) and invite (signed in) buttons.
function accountButtons(foot) {
  if (Platform.canSignIn())
    foot.appendChild(h('button', { class: 'btn', id: 'btn-sign-in', onclick: function () { Platform.signIn(); } }, [tr('sh.signIn')]));
  if (Platform.hosted)
    foot.appendChild(h('button', { class: 'btn', id: 'btn-invite', onclick: copyInvite }, [tr('sh.invite')]));
}

// Keyboard actions (declared as control.* in starhermit.txt); signed-in
// players' platform overrides replace these codes.
var DEFAULT_BINDINGS = {
  left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'],
  build: ['Enter', 'NumpadEnter'], tick: ['Space'], auto: ['KeyA'], belt: ['KeyB'], machine: ['KeyM'],
  rotate: ['KeyR'], remove: ['KeyX'], upgrade: ['KeyU'], hint: ['KeyH'], undo: ['KeyZ'], pause: ['KeyP', 'Escape']
};
var bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
function actionFor(code) {
  for (var a in bindings) if (bindings[a].indexOf(code) >= 0) return a;
  return null;
}
function keyName(code) {
  var named = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', NumpadEnter: 'Num Enter' };
  if (named[code]) return named[code];
  return String(code).replace(/^Key/, '').replace(/^Digit/, '');
}
function keysOf(action) { return bindings[action].map(keyName).join('/'); }
function keysLine() {
  return tr('keys.line', {
    move: keysOf('left') + ' ' + keysOf('right') + ' ' + keysOf('up') + ' ' + keysOf('down'),
    build: keysOf('build'), tick: keysOf('tick'), auto: keysOf('auto'), belt: keysOf('belt'), machine: keysOf('machine'),
    rotate: keysOf('rotate'), remove: keysOf('remove'), upgrade: keysOf('upgrade'), hint: keysOf('hint'),
    undo: keysOf('undo'), pause: keysOf('pause')
  });
}

function renderTitle(root) {
  clearNode(root);
  root.appendChild(h('h1', null, ['Assembly Vale']));
  var p = h('p', null, [tr('title.desc')]);
  root.appendChild(p);
  root.appendChild(art('./assets/keyart.webp', 'keyart'));

  function btn(label, onClick) { return h('button', { class:'btn primary big', onclick:onClick }, [label]); }
  var actions = [];
  actions.push(btn(tr('m.play'), function(){ setScreen('mode-select'); }));
  actions.push(btn(tr('m.daily'), function(){ startRound(Content.dailyConfig(todayStr()), 'daily'); }));
  actions.push(btn(tr('m.journey'), function(){ setScreen('journey-select'); }));
  actions.push(btn(tr('m.lessons'), function(){ setScreen('lesson-select'); }));
  actions.push(btn(tr('m.challenges'), function(){ setScreen('challenge-select'); }));
  actions.push(btn(tr('m.practice'), function(){ setScreen('practice-select'); }));
  actions.push(btn(tr('m.score'), function(){ startRound(Content.scoreChaseCfg(null), 'score-chase'); }));
  root.appendChild(h('div',{class:'actions'},actions));

  var prog = loadProgress();
  var foot = h('footer',{class:'foot'},[
    h('small',null,[tr('title.stats', { rounds: prog.stats.rounds, wins: prog.stats.wins, best: prog.stats.bestScore })]),
    h('small',{id:'account-line'},[accountText()]),
    h('small',null,[tr('title.fair')])
  ]);
  foot.appendChild(settingsButton('btn'));
  accountButtons(foot);
  root.appendChild(foot);
}

function renderModeSelect(root) {
  clearNode(root);
  root.appendChild(h('h2', null, [tr('modes.title')]));
  var p = h('p', null, [tr('modes.desc')]);
  root.appendChild(p);

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  actions.push(btn(tr('m.lessons'), function(){ setScreen('lesson-select'); }));
  actions.push(btn(tr('m.journey'), function(){ setScreen('journey-select'); }));
  actions.push(btn(tr('m.daily'), function(){ startRound(Content.dailyConfig(todayStr()), 'daily'); }));
  actions.push(btn(tr('m.challenges'), function(){ setScreen('challenge-select'); }));
  actions.push(btn(tr('m.practice'), function(){ setScreen('practice-select'); }));
  actions.push(btn(tr('m.score'), function(){ startRound(Content.scoreChaseCfg(null), 'score-chase'); }));
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,[tr('modes.backTitle')])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('title');}},[tr('btn.title')]);
  foot.appendChild(back); root.appendChild(foot);
}

function renderJourneySelect(root) {
  clearNode(root);
  root.appendChild(h('h2', null, [tr('m.journey')]));
  var p = h('p', null, [tr('journey.desc')]);
  root.appendChild(p);

  var prog = loadProgress();
  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  for (var i=0;i<Content.JOURNEY.length;i++) {
    var st = Content.JOURNEY[i];
    var best = prog.journeyBest[st.id];
    var label = journeyName(st) + (st.mastery?' *':'') + (best ? tr('journey.best', { n: best }) : '');
    actions.push(btn(label, function(idx){ return function(){ startRound(Content.journeyCfg(idx),'journey'); }; }(i)));
  }
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,[tr('journey.mastery')])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('mode-select');}},[tr('btn.back')]);
  foot.appendChild(back); root.appendChild(foot);
}

function renderLessonSelect(root) {
  clearNode(root);
  root.appendChild(h('h2', null, [tr('m.lessons')]));
  root.appendChild(h('p', null, [tr('lessons.desc')]));

  var prog = loadProgress();
  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  for (var i=0;i<Content.LESSONS.length;i++) {
    var l = Content.LESSONS[i];
    actions.push(btn(lessonName(l) + (prog.tutorialDone[l.id] ? ' ✓' : ''), function(idx){ return function(){ startRound(Content.lessonCfg(idx),'learn'); }; }(i)));
  }
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,[tr('lessons.foot')])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('mode-select');}},[tr('btn.back')]);
  foot.appendChild(back); root.appendChild(foot);
}

function renderChallengeSelect(root) {
  clearNode(root);
  root.appendChild(h('h2', null, [tr('m.challenges')]));
  root.appendChild(h('p', null, [tr('challenges.desc')]));

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  for (var i=0;i<Content.CHALLENGES.length;i++) {
    var c = Content.CHALLENGES[i];
    actions.push(btn(challengeLabel(c), function(idx){ return function(){ startRound(Content.challengeCfg(Content.CHALLENGES[idx].id),'challenge'); }; }(i)));
  }
  root.appendChild(h('div',{class:'actions'},actions));

  var list = h('ul',{class:'list'});
  for (var j=0;j<Content.CHALLENGES.length;j++) {
    list.appendChild(h('li',null,[challengeLabel(Content.CHALLENGES[j]) + ' — ' + challengeDesc(Content.CHALLENGES[j])]));
  }
  root.appendChild(list);

  var foot = h('footer',{class:'foot'},[h('small',null,[tr('challenges.foot')])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('mode-select');}},[tr('btn.back')]);
  foot.appendChild(back); root.appendChild(foot);
}

function renderPracticeSelect(root) {
  clearNode(root);
  root.appendChild(h('h2', null, [tr('m.practice')]));
  root.appendChild(h('p', null, [tr('practice.desc')]));

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  var diffs = ['relaxed','standard','veteran'];
  for (var i=0;i<diffs.length;i++) {
    var d = diffs[i];
    actions.push(btn(practiceLabel(d), function(diff){ return function(){ startRound(Content.practiceCfg(diff,null),'practice'); }; }(d)));
  }
  root.appendChild(h('div',{class:'actions'},actions));

  var list = h('ul',{class:'list'});
  for (var k=0;k<diffs.length;k++) list.appendChild(h('li',null,[practiceLabel(diffs[k]) + ' — ' + practiceDesc(diffs[k])]));
  root.appendChild(list);

  var foot = h('footer',{class:'foot'},[h('small',null,[tr('practice.foot')])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('mode-select');}},[tr('btn.back')]);
  foot.appendChild(back); root.appendChild(foot);
}

function renderHelp(root) {
  clearNode(root);
  root.appendChild(h('h2', null, [tr('help.title')]));
  root.appendChild(h('p', null, [tr('help.intro')]));
  var list = h('ul',{class:'list'},[
    h('li',null,[tr('help.1')]),
    h('li',null,[tr('help.2')]),
    h('li',null,[tr('help.3')]),
    h('li',null,[tr('help.4')]),
    h('li',null,[tr('help.5', { keys: keysOf('undo') })]),
    h('li',null,[keysLine()])
  ]);
  root.appendChild(list);
  root.appendChild(art('./assets/help-line.webp', 'illus'));

  var foot = h('footer',{class:'foot'},[h('small',null,[tr('help.foot')])]);
  var back=h('button',{class:'btn primary',onclick:function(){ setScreen(state && !state.terminal ? 'play' : 'title'); }},[tr('btn.back')]);
  foot.appendChild(back); root.appendChild(foot);
}

function renderPaused(root) {
  clearNode(root);
  root.appendChild(h('h2', null, [tr('paused.title')]));
  root.appendChild(h('p', null, [tr('paused.desc')]));

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  actions.push(btn(tr('btn.resume'), function(){ setScreen('play'); }));
  actions.push(btn(tr('btn.restart'), function(){ startRound(sessionCfg, sessionKind()); }));
  actions.push(btn(tr('btn.howto'), function(){ setScreen('help'); }));
  actions.push(btn(tr(settings.muted ? 'sound.off' : 'sound.on'), function(){ toggleMute(); render(); }));
  actions.push(settingsButton('btn primary big'));
  actions.push(btn(tr('btn.leave'), function(){ leaveRound(); }));
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,[tr('paused.foot')])]);
  root.appendChild(foot);
}

// ---------- Settings screen (Graphics) ----------
function settingsButton(cls) {
  return h('button', { class: cls, id: screen === 'play' ? 'open-settings-play' : 'open-settings', 'data-action': 'open-settings',
    onclick: function () { openSettings(); } }, [tr('settings.open')]);
}

function openSettings() {
  settingsReturn = screen;
  setScreen('settings');
}

function closeSettings() {
  var back = settingsReturn || 'title';
  if ((back === 'play' || back === 'paused') && !(state && !state.terminal)) back = 'title';
  setScreen(back);
}

// A small built line on the "First Smelter" layout, stepped a few ticks, so
// the preview shows belts, goods, a working machine and the Exchange.
function buildPreviewState() {
  var cfg = Content.journeyCfg(4);
  var s = Rules.createGame(cfg);
  var cmds = [
    { type: 'place', x: 4, y: 2, kind: 'machine', recipe: 'smelt', dir: 'E' },
    { type: 'place', x: 1, y: 0, kind: 'belt', dir: 'E' }, { type: 'place', x: 2, y: 0, kind: 'belt', dir: 'E' },
    { type: 'place', x: 3, y: 0, kind: 'belt', dir: 'E' }, { type: 'place', x: 4, y: 0, kind: 'belt', dir: 'S' },
    { type: 'place', x: 4, y: 1, kind: 'belt', dir: 'S' }
  ];
  for (var i = 0; i < cmds.length; i++) { var r = Rules.applyCommand(s, cmds[i]); if (r.ok) s = r.state; }
  for (var k = 0; k < 13; k++) { var rt = Rules.applyCommand(s, { type: 'tick', atMs: 0 }); if (rt.ok) s = rt.state; }
  return s;
}

var previewTimer = null;
function stopPreview() { if (previewTimer) { clearInterval(previewTimer); previewTimer = null; } }

function tierLabel(tier) { return tr('gfx.tier.' + tier); }
function presetLabel(p) { return tr('gfx.preset.' + p); }

function gfxSelect(id, dataKey, label, options, value, onChange) {
  var sel = h('select', { id: id, 'data-gfx': dataKey, onchange: function () { onChange(sel.value); } });
  for (var i = 0; i < options.length; i++) {
    var o = h('option', { value: options[i][0] }, [options[i][1]]);
    if (options[i][0] === value) o.selected = true;
    sel.appendChild(o);
  }
  return h('div', { class: 'gfx-row' }, [h('label', { for: id }, [label]), sel]);
}

function gfxToggle(id, dataKey, label, checked, onChange) {
  var cb = h('input', { type: 'checkbox', id: id, 'data-gfx': dataKey, onchange: function () { onChange(cb.checked); } });
  cb.checked = !!checked;
  return h('div', { class: 'gfx-row gfx-check' }, [cb, h('label', { for: id }, [label])]);
}

function gfxControls() {
  var saved = gfxSaved();
  var box = h('div', { class: 'gfx-controls', id: 'gfx-controls' });
  var presetOpts = [['auto', tr('gfx.auto', { tier: presetLabel(detectedPreset) })]];
  for (var i = 0; i < Gfx.PRESETS.length; i++) presetOpts.push([Gfx.PRESETS[i], presetLabel(Gfx.PRESETS[i])]);
  var cur = Gfx.PRESETS.indexOf(saved.preset) >= 0 ? saved.preset : 'auto';
  box.appendChild(gfxSelect('gfx-preset', 'preset', tr('gfx.quality'), presetOpts, cur, function (v) {
    saveGraphics(Gfx.choosePreset(gfxSaved(), v)); rebuildGfxControls('gfx-preset');
  }));

  var pct = Math.round(Gfx.clampScale(saved.render_scale) * 100);
  var out = h('output', { id: 'gfx-scale-value', for: 'gfx-scale' }, [pct + '%']);
  var range = h('input', { type: 'range', id: 'gfx-scale', 'data-gfx': 'render_scale', min: '50', max: '200', step: '5', value: String(pct) });
  range.addEventListener('input', function () { out.textContent = range.value + '%'; });
  range.addEventListener('change', function () {
    var next = Object.assign({}, gfxSaved(), { render_scale: Number(range.value) / 100 });
    saveGraphics(next);
  });
  box.appendChild(h('div', { class: 'gfx-row gfx-range' }, [h('label', { for: 'gfx-scale' }, [tr('gfx.scale')]), range, out]));

  for (var c = 0; c < Gfx.CATEGORY_ORDER.length; c++) {
    var cat = Gfx.CATEGORY_ORDER[c];
    var tiers = Gfx.CATEGORIES[cat];
    var opts = [['preset', tr('gfx.fromPreset', { tier: tierLabel(Gfx.presetTier(gfx.preset, cat)) })]];
    for (var j = 0; j < tiers.length; j++) opts.push([tiers[j], tierLabel(tiers[j])]);
    box.appendChild(gfxSelect('gfx-' + cat, cat, tr('gfx.cat.' + cat), opts, tiers.indexOf(saved[cat]) >= 0 ? saved[cat] : 'preset',
      (function (category) { return function (v) { saveGraphics(Gfx.setOverride(gfxSaved(), category, v)); }; })(cat)));
  }

  box.appendChild(gfxToggle('gfx-adaptive', 'adaptive', tr('gfx.adaptive'), saved.adaptive !== false, function (on) {
    saveGraphics(Object.assign({}, gfxSaved(), { adaptive: on }));
  }));
  box.appendChild(gfxToggle('gfx-fps', 'show_fps', tr('gfx.fps'), !!saved.show_fps, function (on) {
    saveGraphics(Object.assign({}, gfxSaved(), { show_fps: on }));
  }));
  return box;
}

// Rebuild the controls (preset labels change) and keep keyboard focus.
function rebuildGfxControls(focusId) {
  var old = document.getElementById('gfx-controls');
  if (!old) return;
  var fresh = gfxControls();
  old.parentNode.replaceChild(fresh, old);
  var f = focusId && document.getElementById(focusId);
  if (f) f.focus();
}

function refreshGfxSummary() {
  var sum = document.getElementById('gfx-summary');
  if (!sum || !gfx) return;
  var px = boardView ? boardView.pixels() : [0, 0];
  sum.textContent = tr('gfx.summary', { gpu: gpuName, level: gpuLevel, preset: presetLabel(gfx.preset), cost: Gfx.cost(gfx), w: px[0], h: px[1] });
  var note = document.getElementById('gfx-note');
  if (note) note.hidden = !gfxFailed;
  var mnote = document.getElementById('gfx-motion-note');
  if (mnote) mnote.hidden = !gfx.reducedMotion;
}

// Language changed (Settings → Language, or the account preference arrived).
// Settings relabels in place so the open Language control keeps focus; every
// other screen re-renders from state (a running round, its auto-run timer and
// the board state are untouched).
function onLanguageChange() {
  if (screen === 'settings') {
    var set = function (sel, text) { var n = el.root.querySelector(sel); if (n) n.textContent = text; };
    set('#settings-title', tr('settings.title'));
    set('#settings-intro', tr('settings.intro'));
    set('#gfx-heading', tr('gfx.heading'));
    set('#gfx-note', tr('gfx.postNote'));
    set('#gfx-motion-note', tr('gfx.motionNote'));
    set('#settings-back', tr('settings.back'));
    var prev = document.getElementById('gfx-preview');
    if (prev) prev.setAttribute('aria-label', tr('gfx.preview'));
    el.root.querySelectorAll('[lang]').forEach(function (n) { n.setAttribute('lang', LOCALE); });
    rebuildGfxControls(null);
    refreshGfxSummary();
    if (boardView) boardView.update();
  } else {
    var focusId = document.activeElement && document.activeElement.id;
    render();
    var f = focusId && document.getElementById(focusId);
    if (f) f.focus();
  }
  if (fpsEl) updateFps(null);
}

function renderSettings(root) {
  clearNode(root);
  root.appendChild(h('h2', { lang: LOCALE, id: 'settings-title' }, [tr('settings.title')]));
  root.appendChild(h('p', { lang: LOCALE, id: 'settings-intro' }, [tr('settings.intro')]));

  var panel = h('section', { class: 'panel gfx-panel', id: 'gfx-panel', lang: LOCALE, 'aria-labelledby': 'gfx-heading' });
  panel.appendChild(h('h3', { id: 'gfx-heading' }, [tr('gfx.heading')]));
  var layout = h('div', { class: 'gfx-layout' });
  var prev = h('canvas', { id: 'gfx-preview', class: 'gfx-preview', role: 'img', 'aria-label': tr('gfx.preview'), style: '--board-ar: 6 / 4' });
  previewState = buildPreviewState();
  layout.appendChild(h('div', { class: 'gfx-preview-wrap' }, [prev]));
  layout.appendChild(gfxControls());
  panel.appendChild(layout);
  panel.appendChild(h('p', { id: 'gfx-summary', class: 'gfx-summary', 'aria-live': 'polite' }, ['']));
  panel.appendChild(h('p', { id: 'gfx-note', class: 'gfx-note', hidden: 'hidden' }, [tr('gfx.postNote')]));
  panel.appendChild(h('p', { id: 'gfx-motion-note', class: 'gfx-note', hidden: 'hidden' }, [tr('gfx.motionNote')]));
  root.appendChild(panel);

  var foot = h('footer', { class: 'foot' }, [h('small', null, [''])]);
  foot.appendChild(h('button', { class: 'btn primary', id: 'settings-back', onclick: function () { closeSettings(); } }, [tr('settings.back')]));
  root.appendChild(foot);

  makeBoardView(prev, function () { return previewState; }, function () { return null; });
  refreshGfxSummary();
  // Keep the preview line moving so animation, particles and glow are visible.
  stopPreview();
  previewTimer = setInterval(function () {
    if (screen !== 'settings' || !boardView || document.hidden) return;
    if (previewState.tick > 60) previewState = buildPreviewState();
    var r = Rules.applyCommand(previewState, { type: 'tick', atMs: 0 });
    if (!r.ok) { previewState = buildPreviewState(); return; }
    boardView.noteTick();
    previewState = r.state;
    boardView.events(r.events);
    boardView.update();
  }, 520);
}

function renderResults(root) {
  clearNode(root);
  var won = !!(state.terminal && state.terminal.won);
  root.appendChild(h('h2', null, [tr(won ? 'res.won' : 'res.over')]));
  root.appendChild(h('p', null, [won
    ? tr('res.wonDesc', { n: Math.max(0, (state.cfg.tickLimit || 0) - state.tick) })
    : tr(state.terminal && state.terminal.reason === 'resigned' ? 'res.resigned' : 'res.lost')]));

  var list = h('ul',{class:'list'},[
    h('li',null,[tr('res.score', { n: state.score.total })]),
    h('li',null,[tr('res.goods', { n: state.score.goods })]),
    h('li',null,[tr('res.bonus', { n: state.score.contractBonus })]),
    h('li',null,[tr('res.gold', { n: state.score.goldLeft })]),
    h('li',null,[tr('res.speed', { n: state.score.speedBonus })]),
    h('li',null,[tr('res.ticks', { n: state.tick + (state.cfg.tickLimit ? (' / ' + state.cfg.tickLimit) : '') })])
  ]);
  root.appendChild(list);
  if (lbStatus) root.appendChild(h('p', { id: 'results-lb', role: 'status' }, [lbText()]));
  root.appendChild(art('./assets/exchange-ledger.webp', 'illus' + (won ? ' won' : ' lost')));

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  actions.push(btn(tr('btn.again'), function(){ startRound(sessionCfg, sessionKind()); }));
  if (sessionKind()==='journey' && journeyIndex >= 0 && journeyIndex < Content.JOURNEY.length-1) {
    actions.push(btn(tr('btn.next'), function(){ startRound(Content.journeyCfg(journeyIndex+1), 'journey'); }));
  }
  actions.push(btn(tr('btn.modes'), function(){ setScreen('mode-select'); }));
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,[tr('res.foot')])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('title');}},[tr('btn.title')]);
  foot.appendChild(back); root.appendChild(foot);
}

function renderPlay(root) {
  clearNode(root);
  // header: stage name, gold, tick/limit, pause
  el.gold = h('span',{class:'gold'},[goldText()]);
  el.tick = h('span',{class:'tick'},[tickText()]);
  var head = h('div',{class:'head'},[
    h('h2',null,[stageName()]),
    el.gold,
    el.tick,
    h('button',{class:'btn',onclick:function(){ setScreen('paused'); }},[tr('btn.pause')]),
    h('button',{class:'btn',onclick:function(){ setScreen('help'); }},[tr('btn.help')]),
    settingsButton('btn')
  ]);
  root.appendChild(head);

  // body: info | board | tools
  var body = h('div',{class:'body'});
  el.info = infoPanel();
  var left = h('div',{class:'col'},[el.info]);
  var center = h('div',{class:'canvas-wrap'},[boardCanvas(), legend()]);
  el.tools = toolButtons();
  var right = h('div',{class:'col'},[el.tools, actionButtons()]);
  body.appendChild(left); body.appendChild(center); body.appendChild(right);
  root.appendChild(body);

  // footer: hint, live status and back to title
  var foot = h('footer',{class:'foot'});
  el.hint = h('small',{class:'hint'},[hintText()]);
  el.status = h('div',{class:'status',role:'status','aria-live':'polite'},[statusMessage()]);
  foot.appendChild(el.hint);
  foot.appendChild(el.status);
  var back=h('button',{class:'btn',onclick:function(){ leaveRound(); }},[tr('btn.title')]);
  foot.appendChild(back); root.appendChild(foot);
}

function goldText() { return tr('hud.gold', { n: state.gold }); }
function tickText() { return tr('hud.tick', { n: state.tick + (state.cfg.tickLimit ? (' / ' + state.cfg.tickLimit) : '') }); }

function infoPanel() {
  var d = h('div',{class:'panel'});
  var lesson = currentLessonDef();
  if (lesson) {
    d.appendChild(h('div',{class:'row lesson'},[lessonText(lesson)]));
    d.appendChild(h('hr'));
  }
  // objective: contracts with progress
  for (var good in state.cfg.contracts) {
    var need = state.cfg.contracts[good];
    var have = state.progress[good] || 0;
    d.appendChild(h('div',{class:'row' + (have>=need ? ' done' : '')},[tr('info.contract', { good: goodName(good), have: have, need: need })]));
  }
  // score components (live)
  d.appendChild(h('hr'));
  d.appendChild(h('div',{class:'row'},[tr('info.score', { n: state.score.total })]));
  d.appendChild(h('div',{class:'row dim'},[tr('info.goods', { n: state.score.goods })]));
  d.appendChild(h('div',{class:'row dim'},[tr('info.bonus', { n: state.score.contractBonus })]));
  d.appendChild(h('div',{class:'row dim'},[tr('info.gold', { n: state.score.goldLeft })]));
  d.appendChild(h('div',{class:'row dim'},[tr('info.speed', { n: state.score.speedBonus })]));
  if (state.cfg.buildLimit) {
    d.appendChild(h('div',{class:'row dim'},[tr('info.builds', { n: state.builds, max: state.cfg.buildLimit })]));
  }
  d.appendChild(h('hr'));
  d.appendChild(h('div',{class:'row dim'},[tr('info.selected', { cell: describeCell(selectedCell.x, selectedCell.y) })]));
  return d;
}

function legend() {
  var d = h('div',{class:'legend'});
  d.appendChild(h('span',{class:'key src'},[tr('lg.source')]));
  d.appendChild(h('span',{class:'key belt'},[tr('lg.belt')]));
  d.appendChild(h('span',{class:'key mach'},[tr('lg.machine')]));
  d.appendChild(h('span',{class:'key sink'},[tr('lg.exchange')]));
  d.appendChild(h('span',{class:'key rock'},[tr('lg.rock')]));
  return d;
}

// Logical cell size (the board's drawing unit). The backing store is sized
// from the CSS width × pixel ratio × render scale by board.js.
function cellSizeFor(s) {
  var cols = s.cfg.board.cols, rows = s.cfg.board.rows;
  return Math.max(28, Math.min(64, Math.floor(640/cols), Math.floor(512/rows)));
}
function cellSize() { return cellSizeFor(state); }

function boardCanvas() {
  var cols = state.cfg.board.cols, rows = state.cfg.board.rows, cs = cellSize();
  var c = h('canvas',{
    id:'board', tabindex:'0', role:'application',
    'aria-label':tr('board.aria'),
    width: String(cols*cs), height: String(rows*cs),
    style: '--board-ar: ' + cols + ' / ' + rows + '; --board-ar-num: ' + (cols / rows)
  });
  c.addEventListener('click', onBoardClick);
  c.addEventListener('mousemove', onBoardHover);
  el.boardCanvas = c;
  makeBoardView(c, function(){ return state; }, function(){ return selectedCell; });
  return c;
}

function pointerCell(canvas, ev) {
  var rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  var x = Math.floor((ev.clientX - rect.left) / rect.width * state.cfg.board.cols);
  var y = Math.floor((ev.clientY - rect.top) / rect.height * state.cfg.board.rows);
  if (!Rules.inBounds(state.cfg, x, y)) return null;
  return { x: x, y: y };
}

function onBoardHover(ev) {
  var c = pointerCell(ev.currentTarget, ev);
  ev.currentTarget.style.cursor = c ? 'pointer' : 'default';
}

function onBoardClick(ev) {
  var c = pointerCell(ev.currentTarget, ev);
  if (!c) return;
  selectCell(c.x, c.y);
  applyToolAt(c.x, c.y);
}

function toolButtons() {
  var d = h('div',{class:'panel'});
  function tbtn(label,id){
    return h('button',{
      'data-key': id,
      class:'tool'+(tool===id?' active':''),
      'aria-pressed': tool===id ? 'true' : 'false',
      onclick:function(){setTool(id);}
    },[label]);
  }
  d.appendChild(tbtn(tr('tool.belt', { cost: Rules.beltCost(state) }), TOOL_BELT));
  var cat = Rules.buildCatalog(state);
  for (var i=0;i<cat.length;i++) {
    if (cat[i].kind!=='machine') continue;
    var rec = Rules.recipeById(state.cfg, cat[i].recipe);
    var lbl = tr('tool.machine', { name: recipeName(rec), in: goodName(rec.input), out: goodName(rec.output), cost: cat[i].cost });
    d.appendChild(h('button',{
      'data-key': 'machine:' + cat[i].recipe,
      class:'tool'+(tool===TOOL_MACHINE && recipeChoice===cat[i].recipe ? ' active':'') + (cat[i].afford ? '' : ' poor'),
      'aria-pressed': (tool===TOOL_MACHINE && recipeChoice===cat[i].recipe) ? 'true' : 'false',
      onclick:function(id){ return function(){ recipeChoice=id; setTool(TOOL_MACHINE); }; }(cat[i].recipe)
    },[lbl]));
  }
  if (cat.length<2) d.appendChild(h('div',{class:'row dim'},[tr('tool.none')]));
  d.appendChild(tbtn(tr('tool.rotate'), TOOL_ROTATE));
  d.appendChild(tbtn(tr('tool.remove'), TOOL_REMOVE));
  if (state.cfg.upgrades) d.appendChild(tbtn(tr('tool.upgrade'), TOOL_UPGRADE));
  return d;
}

function actionButtons() {
  var d = h('div',{class:'panel actions-col'});
  function abtn(label,onClick,cls){ return h('button',{class:'act ' + (cls||'primary big'),onclick:onClick},[label]); }
  d.appendChild(abtn(tr('act.tick'), function(){ doTick(); }));
  el.autoBtn = abtn(tr(autoTimer ? 'act.stop' : 'act.auto'), function(){ toggleAuto(); });
  d.appendChild(el.autoBtn);
  d.appendChild(abtn(tr('act.hint'), function(){ showHint(); }));
  if (undoEnabled()) d.appendChild(abtn(tr('act.undo'), function(){ undo(); }, 'act'));
  d.appendChild(abtn(tr('btn.restart'), function(){ startRound(sessionCfg, sessionKind()); }, 'act'));
  return d;
}

// ---------- names / labels (presentation only) ----------
function stageName() {
  var k = sessionCfg.kind;
  if (k==='journey') return sessionCfg.id ? tr('j.' + sessionCfg.id) : tr('stage.journey');
  if (k==='learn') return tr('stage.lesson', { name: lessonTitle() });
  if (k==='daily') return tr('stage.daily', { date: todayStr() });
  if (k==='challenge') return challengeName();
  if (k==='practice') return practiceDiffName();
  if (k==='score-chase' || k==='score') return tr('m.score');
  return sessionCfg.name || '';
}

function currentLessonDef() {
  var l = sessionCfg && sessionCfg.lesson; if (!l) return null;
  for (var i=0;i<Content.LESSONS.length;i++) if (Content.LESSONS[i].id===l.id) return Content.LESSONS[i];
  return null;
}

function lessonTitle() {
  var l = currentLessonDef();
  return l ? lessonName(l) : '';
}

function challengeName() {
  var id = sessionCfg.challengeId; if (!id) return tr('stage.challenge');
  for (var i=0;i<Content.CHALLENGES.length;i++) if (Content.CHALLENGES[i].id===id) return challengeLabel(Content.CHALLENGES[i]);
  return tr('stage.challenge');
}

function practiceDiffName() {
  var d = sessionCfg.practiceDifficulty; if (!d) return tr('stage.practice');
  return Content.PRACTICE[d] ? practiceLabel(d) : tr('stage.practice');
}

function goodName(t) {
  return Content.GOOD_META[t] ? tr('good.' + t) : t;
}

function describeCell(x,y) {
  if (!Rules.inBounds(state.cfg, x, y)) return '—';
  var cell = state.grid[y][x];
  var where = '(' + (x+1) + ', ' + (y+1) + ') ';
  if (!cell) return where + tr('cell.empty');
  if (cell.k==='rock') return where + tr('cell.rock');
  if (cell.k==='water') return where + tr('cell.water');
  if (cell.k==='sink') return where + tr('cell.sink');
  if (cell.k==='source') return where + tr('cell.source', { good: goodName(cell.item), dir: dirName(cell.dir) });
  if (cell.k==='belt') return where + tr('cell.belt', { dir: dirName(cell.dir) }) + (cell.itemRef ? tr('cell.carrying', { good: goodName(cell.itemRef.t) }) : '');
  if (cell.k==='machine') {
    var rec = Rules.recipeById(state.cfg, cell.recipe);
    return where + tr('cell.machine', { name: recipeName(rec), level: cell.level, dir: dirName(cell.dir) });
  }
  return where + cell.k;
}

// ---------- tool / cell selection ----------
function setTool(id) {
  tool = id;
  sfx('tool');
  setStatus(function () { return tr('st.tool', { tool: tr('tn.' + id) }); });
  refreshPlay();
}

function selectCell(x,y) {
  if (!Rules.inBounds(state.cfg, x, y)) return;
  selectedCell.x=x; selectedCell.y=y;
  setStatus(function () { return describeCell(x, y); });
  refreshPlay();
}

function moveSelection(dx,dy) {
  selectCell(
    Math.min(state.cfg.board.cols-1, Math.max(0, selectedCell.x+dx)),
    Math.min(state.cfg.board.rows-1, Math.max(0, selectedCell.y+dy))
  );
}

function applyToolAt(x,y) {
  if (!tool) { setStatus(msg('st.pickTool')); refreshPlay(); return; }
  if (tool===TOOL_BELT) placeAt(x,y,'belt',null);
  else if (tool===TOOL_MACHINE) {
    if (!recipeChoice) { setStatus(msg('st.pickMachine')); refreshPlay(); return; }
    placeAt(x,y,'machine',recipeChoice);
  }
  else if (tool===TOOL_ROTATE) rotateAt(x,y);
  else if (tool===TOOL_REMOVE) removeAt(x,y);
  else if (tool===TOOL_UPGRADE) upgradeAt(x,y);
}

function hintText() {
  var hres = Rules.hint(state); if (!hres) return tr('hint.keep');
  var c = hres.cmd, why = hres.why||'';
  var at = { x: c.x + 1, y: c.y + 1 };
  if (c.type==='place') {
    if (c.kind==='belt') return tr('hint.belt', at);
    return tr('hint.machine', { name: recipeName(Rules.recipeById(state.cfg, c.recipe)), x: at.x, y: at.y });
  }
  if (c.type==='rotate') return tr('hint.rotate', at);
  if (c.type==='upgrade') return tr('hint.upgrade', at);
  if (why==='deliver' || why==='win') return tr('hint.keep');
  return '';
}

// =====================================================================
//  ACTIONS
// =====================================================================

function reasonText(reason) {
  var key = 'reason.' + reason;
  var text = tr(key);
  return text !== key ? text : tr('reason.other', { reason: reason });
}

function undoEnabled() { return !!(sessionCfg && sessionCfg.mechanics && sessionCfg.mechanics.undo); }

function undo() {
  if (!undoEnabled() || !history.length) { setStatus(msg('st.nothingUndo')); refreshPlay(); return; }
  state = history.pop();
  sfx('undo');
  setStatus(msg('st.undid'));
  refreshPlay();
}

function commit(res) {
  if (!res.ok) { flashInvalid(res.reason); return false; }
  // rules states are fresh copies, so keeping the previous one is enough
  if (undoEnabled()) { history.push(state); if (history.length > 50) history.shift(); }
  state = res.state;
  playEvents(res.events);
  if (boardView && screen==='play') boardView.events(res.events);
  afterStateChange();
  return true;
}

function doTick() {
  if (boardView) boardView.noteTick();
  commit(Rules.applyCommand(state, { type:'tick', atMs: now() }));
}

function placeAt(x,y,kind,recipeId) {
  commit(Rules.applyCommand(state,{ type:'place', x:x, y:y, kind:kind, recipe:recipeId||null, dir:preferredDir(x,y), atMs: now() }));
}

// Face a new building toward the Exchange along its longer remaining axis,
// so a first-time player's line usually points somewhere useful.
function preferredDir(x,y) {
  var dx = state.cfg.sink.x - x, dy = state.cfg.sink.y - y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W';
  return dy >= 0 ? 'S' : 'N';
}

function rotateAt(x,y) {
  commit(Rules.applyCommand(state,{ type:'rotate', x:x, y:y, atMs: now() }));
}

function removeAt(x,y) {
  commit(Rules.applyCommand(state,{ type:'remove', x:x, y:y, atMs: now() }));
}

function upgradeAt(x,y) {
  commit(Rules.applyCommand(state,{ type:'upgrade', x:x, y:y, atMs: now() }));
}

function showHint() {
  var hres = Rules.hint(state);
  sfx('hint');
  if (hres && hres.cmd && hres.cmd.x != null) selectCell(hres.cmd.x, hres.cmd.y);
  setStatus(hintText);
  refreshPlay();
}

function flashInvalid(reason) {
  sfx('invalid');
  setStatus(function () { return reasonText(reason); });
  refreshPlay();
}

// Map rules events onto sound and the live region.
function playEvents(events) {
  if (!events) return;
  var spoke = '';
  for (var i=0;i<events.length;i++) {
    var e = events[i];
    if (e.type==='place') { sfx('place'); spoke = eventText(e.kind === 'machine' ? 'ev.placeMachine' : 'ev.placeBelt'); }
    else if (e.type==='remove') { sfx('remove'); spoke = eventText(e.kind === 'machine' ? 'ev.removeMachine' : 'ev.removeBelt'); }
    else if (e.type==='rotate') { sfx('rotate'); spoke = eventText('ev.rotate', { dir: e.dir }); }
    else if (e.type==='upgrade') { sfx('upgrade'); spoke = eventText('ev.upgrade', { n: e.level }); }
    else if (e.type==='craft') sfx('craft');
    else if (e.type==='spawn') sfx('spawn');
    else if (e.type==='deliver') { sfx('deliver'); spoke = eventText('ev.deliver', { good: e.item, n: e.value }); }
    else if (e.type==='contract-complete') { sfx('contract'); spoke = eventText('ev.contract', { good: e.item }); }
    else if (e.type==='spoil') { sfx('spoil'); spoke = eventText('ev.spoil', { good: e.item }); }
    else if (e.type==='win') { sfx('win'); spoke = eventText('ev.win'); }
    else if (e.type==='lose') { sfx('lose'); spoke = eventText('ev.lose'); }
  }
  if (spoke) setStatus(spoke);
}

// The live-region message is kept as a function of the current language so a
// language change re-renders it; event values (good ids, directions) are
// translated when it is read.
function msg(key, vars) { return function () { return tr(key, vars); }; }
function eventText(key, vars) {
  return function () {
    var v = Object.assign({}, vars || {});
    if (v.good) v.good = goodName(v.good);
    if (v.dir) v.dir = dirName(v.dir);
    return tr(key, v);
  };
}
function statusMessage() { return typeof statusText === 'function' ? statusText() : (statusText || ''); }
function setStatus(text) {
  statusText = text || '';
  if (el.status) { clearNode(el.status); el.status.appendChild(document.createTextNode(statusMessage())); }
}

// Called after every rules state change: refresh the play screen and handle
// the terminal transition.
function afterStateChange() {
  if (state.terminal) {
    setAuto(false);
    recordResult();
    postToLeaderboard();
    setScreen('results');
    return;
  }
  refreshPlay();
}

// Copy the text, class and pressed state of a freshly built panel onto the
// one on screen when both hold the same controls (same tags and keys), so its
// buttons stay the same elements; false when the controls differ.
function patchPanel(cur, fresh) {
  var a = cur.children, b = fresh.children, i;
  if (a.length !== b.length) return false;
  for (i=0;i<a.length;i++) if (a[i].tagName !== b[i].tagName || a[i].getAttribute('data-key') !== b[i].getAttribute('data-key')) return false;
  for (i=0;i<a.length;i++) {
    if (a[i].className !== b[i].className) a[i].className = b[i].className;
    var pressed = b[i].getAttribute('aria-pressed');
    if (pressed !== null && a[i].getAttribute('aria-pressed') !== pressed) a[i].setAttribute('aria-pressed', pressed);
    if (a[i].textContent !== b[i].textContent) a[i].textContent = b[i].textContent;
  }
  return true;
}

// Update the play screen in place (keeps focus and avoids canvas churn).
function refreshPlay() {
  if (screen!=='play' || !state) return;
  if (el.gold) { clearNode(el.gold); el.gold.appendChild(document.createTextNode(goldText())); }
  if (el.tick) { clearNode(el.tick); el.tick.appendChild(document.createTextNode(tickText())); }
  if (el.info && el.info.parentNode) { var fresh = infoPanel(); el.info.parentNode.replaceChild(fresh, el.info); el.info = fresh; }
  if (el.tools && el.tools.parentNode) {
    // Costs and affordability change with gold, and auto-run refreshes every
    // tick: while the palette holds the same tools its buttons are updated in
    // place (a button replaced between press and release loses its click);
    // it is rebuilt only when the set of tools changes, keeping keyboard
    // focus on the same button.
    var t = toolButtons();
    if (!patchPanel(el.tools, t)) {
      var focusIdx = -1;
      var old = el.tools.querySelectorAll('button');
      for (var i=0;i<old.length;i++) if (old[i]===document.activeElement) focusIdx = i;
      el.tools.parentNode.replaceChild(t, el.tools);
      el.tools = t;
      if (focusIdx >= 0) {
        var fresh2 = t.querySelectorAll('button');
        if (fresh2[focusIdx]) fresh2[focusIdx].focus();
      }
    }
  }
  if (el.autoBtn) { clearNode(el.autoBtn); el.autoBtn.appendChild(document.createTextNode(tr(autoTimer ? 'act.stop' : 'act.auto'))); }
  if (el.hint) { clearNode(el.hint); el.hint.appendChild(document.createTextNode(hintText())); }
  if (el.boardCanvas && boardView) boardView.update();
}

// ---------- auto-run ----------
function setAuto(on) {
  if (on && !autoTimer) {
    var period = Math.max(120, Math.round(420 / (settings.simSpeed || 1)));
    autoTimer = setInterval(function(){
      if (screen!=='play' || !state || state.terminal) { setAuto(false); return; }
      doTick();
    }, period);
    AudioMod.setHum(true);
  } else if (!on && autoTimer) {
    clearInterval(autoTimer); autoTimer = null;
    AudioMod.setHum(false);
  }
}
function toggleAuto() { setAuto(!autoTimer); sfx('auto'); refreshPlay(); }

function toggleMute() {
  settings.muted = !settings.muted;
  saveSettings(settings);
  AudioMod.applySettings(settings);
}

// ---------- results / progression ----------
function recordResult() {
  var prog = loadProgress();
  var s = prog.stats;
  s.rounds++;
  if (state.terminal.won) s.wins++;
  for (var g in state.sold) s.goodsSold += state.sold[g];
  for (var c in state.contractDone) if (state.contractDone[c]) s.contractsDone++;
  s.buildingsPlaced += state.builds;
  if (state.score.total > s.bestScore) s.bestScore = state.score.total;

  var kind = sessionKind(), id = sessionCfg.id;
  if (kind==='journey') {
    if (!prog.journeyBest[id] || state.score.total > prog.journeyBest[id]) prog.journeyBest[id] = state.score.total;
    if (state.terminal.won) prog.journeyStars[id] = Math.max(prog.journeyStars[id]||0, starsFor());
  } else if (kind==='challenge') {
    if (!prog.challengeBest[id] || state.score.total > prog.challengeBest[id]) prog.challengeBest[id] = state.score.total;
  } else if (kind==='daily') {
    var day = todayStr();
    if (!prog.dailiesDone[day] || state.score.total > prog.dailiesDone[day]) prog.dailiesDone[day] = state.score.total;
    prog.stats.lastDaily = day;
  } else if (kind==='score-chase' || kind==='score') {
    if (state.score.total > prog.scoreChaseBest) prog.scoreChaseBest = state.score.total;
  } else if (kind==='learn' && state.terminal.won && sessionCfg.lesson) {
    prog.tutorialDone[sessionCfg.lesson.id] = true;
  }
  saveProgress(prog);
}

// Hosted play only: post the finished round's total (lessons excluded) and
// show the board rank on the results screen. Standalone posts nothing.
var lbStatus = null, lbSeq = 0; // null | 'posting' | { posted, rank }
function lbText() {
  if (lbStatus === 'posting') return tr('sh.lbPosting');
  if (!lbStatus.posted) return tr('sh.lbNotPosted');
  return lbStatus.rank ? tr('sh.lbRank', { rank: lbStatus.rank }) : tr('sh.lbPosted');
}
function showLbLine() {
  var line = document.getElementById('results-lb');
  if (line && lbStatus) line.textContent = lbText();
}
function postToLeaderboard() {
  var seq = ++lbSeq;
  lbStatus = null;
  if (!Platform.hosted || sessionKind() === 'learn') return;
  lbStatus = 'posting';
  Platform.submitScore(state.score.total).then(function (r) {
    if (seq !== lbSeq) return;
    lbStatus = r;
    showLbLine();
  });
}

// One star for the win, one for beating par ticks, one for spare gold.
function starsFor() {
  var stars = 1;
  var par = (state.cfg.par && state.cfg.par.ticks) || 0;
  if (par && state.tick <= par) stars++;
  if (state.gold >= state.cfg.gold) stars++;
  return stars;
}

// =====================================================================
//  NAVIGATION / LIFECYCLE
// =====================================================================

function sessionKind() { return sessionCfg ? sessionCfg.kind : null; }

function setScreen(name) {
  if (name!=='play') setAuto(false);
  screen = name;
  render();
}

function leaveRound() {
  setAuto(false);
  stopAudio();
  setScreen('title');
}

function startRound(cfg, kind) {
  setAuto(false);
  lbSeq++; lbStatus = null;
  sessionCfg = cfg;
  state = Rules.createGame(cfg);
  history = [];
  tool = TOOL_BELT;
  recipeChoice = (cfg.allowedRecipes && cfg.allowedRecipes[0]) || null;
  journeyIndex = -1;
  if (kind==='journey') {
    for (var i=0;i<Content.JOURNEY.length;i++) if (Content.JOURNEY[i].id===cfg.id) journeyIndex = i;
  }
  selectedCell = { x: 0, y: 0 };
  var src = (cfg.sources && cfg.sources[0]);
  if (src) selectedCell = { x: src.x, y: src.y };
  if (kind==='learn' && cfg.lesson) {
    var prog = loadProgress();
    prog.tutorialDone[cfg.lesson.id] = prog.tutorialDone[cfg.lesson.id] || false;
    saveProgress(prog);
  }
  statusText = msg('st.started');
  startAudio();
  setScreen('play');
}

var lastRenderedScreen = null;
function render() {
  var root = el.root; clearNode(root);
  el.gold = el.tick = el.info = el.tools = el.hint = el.status = el.autoBtn = null;
  el.boardCanvas = null;
  if (boardView) { boardView.destroy(); boardView = null; }
  stopPreview();
  // A new screen starts at the top: the page keeps its scroll position otherwise
  // (e.g. Settings opened from a title scrolled to reach its button).
  if (screen !== lastRenderedScreen) { lastRenderedScreen = screen; window.scrollTo(0, 0); }
  if (screen==='title') renderTitle(root);
  else if (screen==='mode-select') renderModeSelect(root);
  else if (screen==='journey-select') renderJourneySelect(root);
  else if (screen==='lesson-select') renderLessonSelect(root);
  else if (screen==='challenge-select') renderChallengeSelect(root);
  else if (screen==='practice-select') renderPracticeSelect(root);
  else if (screen==='help') renderHelp(root);
  else if (screen==='paused') renderPaused(root);
  else if (screen==='results') renderResults(root);
  else if (screen==='play') renderPlay(root);
  else if (screen==='settings') renderSettings(root);
}

// ---------- keyboard ----------
function onKeyDown(ev) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  var act = actionFor(ev.code);
  var back = ev.code === 'Escape';
  var onButton = ev.target && ev.target.tagName === 'BUTTON';

  if (screen==='paused') {
    if (back || act==='pause') { ev.preventDefault(); setScreen('play'); }
    return;
  }
  if (screen==='settings') {
    if (back) { ev.preventDefault(); closeSettings(); }
    return;
  }
  if (screen==='help') {
    if (back) { ev.preventDefault(); setScreen(state && !state.terminal ? 'play' : 'title'); }
    return;
  }
  if (screen!=='play') {
    if (back && screen!=='title') { ev.preventDefault(); setScreen('title'); }
    return;
  }

  if (act==='left') { ev.preventDefault(); moveSelection(-1,0); return; }
  if (act==='right') { ev.preventDefault(); moveSelection(1,0); return; }
  if (act==='up') { ev.preventDefault(); moveSelection(0,-1); return; }
  if (act==='down') { ev.preventDefault(); moveSelection(0,1); return; }
  if (act==='build' && !onButton) { ev.preventDefault(); applyToolAt(selectedCell.x, selectedCell.y); return; }
  if (act==='tick' && !onButton) { ev.preventDefault(); doTick(); return; }
  switch (act) {
    case 'belt': ev.preventDefault(); setTool(TOOL_BELT); break;
    case 'machine': ev.preventDefault(); setTool(TOOL_MACHINE); break;
    case 'rotate': ev.preventDefault(); setTool(TOOL_ROTATE); break;
    case 'remove': ev.preventDefault(); setTool(TOOL_REMOVE); break;
    case 'upgrade': ev.preventDefault(); setTool(TOOL_UPGRADE); break;
    case 'hint': ev.preventDefault(); showHint(); break;
    case 'undo': ev.preventDefault(); undo(); break;
    case 'auto': ev.preventDefault(); toggleAuto(); break;
    case 'pause': ev.preventDefault(); setScreen('paused'); break;
    default: break;
  }
}

async function init() {
  el.root = document.getElementById('root');
  document.addEventListener('keydown', onKeyDown);
  // Backgrounding pauses the solo simulation (spec §state machine).
  document.addEventListener('visibilitychange', function(){
    if (document.hidden && screen==='play') { setAuto(false); setScreen('paused'); }
  });
  applyGraphics();
  // WebAudio is unlocked by startRound's user gesture, never during page load.
  render();

  // StarHermit host adapter: identity, token refresh and the cloud save
  // mirror. When a remote save exists it wins over the local cache (the app
  // re-reads the doc from storage, so persisting the remote doc is enough);
  // localStorage remains the offline fallback either way.
  try {
    var remoteRaw = await Platform.init({
      onProfile: function () { if (screen === 'title') render(); },
      onSync: function () { if (screen === 'title') render(); },
      onAuth: function (a) { if (!a.signedIn) signedOutNotice = true; if (screen === 'title') render(); },
      // Another device saved first: merge both documents (better records win,
      // this device's settings stay; the round in progress is in memory) and
      // save the merge.
      onConflict: function (raw) {
        Store.save(Store.mergeDocs(raw ? Store.loadRaw(raw) : null, Store.load()));
        if (screen !== 'play' && screen !== 'settings') render();
      }
    });
    if (Platform.hosted) bindings = await Platform.loadBindings(DEFAULT_BINDINGS);
    var remoteDoc = remoteRaw ? Store.loadRaw(remoteRaw) : null;
    var ps = Platform.platformSettings;
    if (remoteDoc || ps) {
      if (!remoteDoc) remoteDoc = Store.load();
      // platform settings KV wins over the saved document's preferences
      if (ps) Object.keys(Store.DEFAULT_SETTINGS).forEach(function (k) { if (k in ps) remoteDoc.settings[k] = ps[k]; });
      Store.save(remoteDoc); // local cache mirrors the remote doc
      settings = loadSettings();
      applyGraphics();
      render();
    }
  } catch (e) { /* offline or no token: the local save is already loaded */ }
}

window.addEventListener('DOMContentLoaded', function(){ init(); });
