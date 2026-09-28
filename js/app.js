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
var LOCALE = I18n.pick((navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language]);
var tr = I18n.make(LOCALE);
var gpuName = detectGpu();
var isMobile = detectMobile();
var detectedPreset = Gfx.detectPreset(gpuName, { mobile: isMobile });
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
  gfx = Gfx.resolve(gfxSaved(), detectedPreset, { reducedMotion: reducedMotion() });
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
    onResize: function () { refreshGfxSummary(); }
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
function startAudio() { AudioMod.start(); AudioMod.applySettings(settings); AudioMod.setCaptions(!!settings.captions, setStatus); }
function stopAudio() { AudioMod.suspend(); }
function sfx(name) { try { AudioMod.play(name); } catch (e) { /* audio is optional */ } }

// =====================================================================
//  SCREENS
// =====================================================================

// Account + cloud-sync status line for the title screen footer.
function accountText() {
  if (!Platform.hosted) return 'Offline — progress is stored on this device.';
  var name = Platform.profile ? Platform.profile.displayName : '…';
  var syncTxt = Platform.sync === 'synced' ? 'progress synced'
    : Platform.sync === 'saving' ? 'saving…'
    : 'cloud sync unavailable';
  return 'Playing as ' + name + ' · ' + syncTxt;
}

function renderTitle(root) {
  clearNode(root);
  root.appendChild(h('h1', null, ['Assembly Vale']));
  var p = h('p', null, [
    'Place production stations and conveyors to turn raw inputs into increasingly valuable goods. ',
    'Deliver them at the Exchange. Fulfilling every contract before the tick limit wins the round.'
  ]);
  root.appendChild(p);
  root.appendChild(art('./assets/keyart.webp', 'keyart'));

  function btn(label, onClick) { return h('button', { class:'btn primary big', onclick:onClick }, [label]); }
  var actions = [];
  actions.push(btn('Play', function(){ setScreen('mode-select'); }));
  actions.push(btn('Daily Challenge', function(){ startRound(Content.dailyConfig(todayStr()), 'daily'); }));
  actions.push(btn('Journey', function(){ setScreen('journey-select'); }));
  actions.push(btn('Lessons (Learn)', function(){ setScreen('lesson-select'); }));
  actions.push(btn('Challenges', function(){ setScreen('challenge-select'); }));
  actions.push(btn('Practice', function(){ setScreen('practice-select'); }));
  actions.push(btn('Score Chase', function(){ startRound(Content.scoreChaseCfg(null), 'score-chase'); }));
  root.appendChild(h('div',{class:'actions'},actions));

  var prog = loadProgress();
  var foot = h('footer',{class:'foot'},[
    h('small',null,['Rounds played: ' + prog.stats.rounds + ' · Wins: ' + prog.stats.wins + ' · Best score: ' + prog.stats.bestScore]),
    h('small',{id:'account-line'},[accountText()]),
    h('small',null,['Original. No real-money wagering, no ads, no energy pressure.'])
  ]);
  foot.appendChild(settingsButton('btn'));
  root.appendChild(foot);
}

function renderModeSelect(root) {
  clearNode(root);
  root.appendChild(h('h2', null, ['Choose a mode']));
  var p = h('p', null, [
    'Learn: interactive lessons. Journey: authored progression with mastery stages. ',
    'Daily: one shared seed per UTC day. Practice: selectable difficulty, no rating effect.'
  ]);
  root.appendChild(p);

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  actions.push(btn('Lessons (Learn)', function(){ setScreen('lesson-select'); }));
  actions.push(btn('Journey', function(){ setScreen('journey-select'); }));
  actions.push(btn('Daily Challenge', function(){ startRound(Content.dailyConfig(todayStr()), 'daily'); }));
  actions.push(btn('Challenges', function(){ setScreen('challenge-select'); }));
  actions.push(btn('Practice', function(){ setScreen('practice-select'); }));
  actions.push(btn('Score Chase', function(){ startRound(Content.scoreChaseCfg(null), 'score-chase'); }));
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,['Back to title:'])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('title');}},['Title']);
  foot.appendChild(back); root.appendChild(foot);
}

function renderJourneySelect(root) {
  clearNode(root);
  root.appendChild(h('h2', null, ['Journey']));
  var p = h('p', null, [
    'Forty authored stages. One mechanic at a time, then combinations. ',
    'A mastery stage closes each block of four.'
  ]);
  root.appendChild(p);

  var prog = loadProgress();
  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  for (var i=0;i<Content.JOURNEY.length;i++) {
    var st = Content.JOURNEY[i];
    var best = prog.journeyBest[st.id];
    var label = st.name + (st.mastery?' *':'') + (best ? ' — best ' + best : '');
    actions.push(btn(label, function(idx){ return function(){ startRound(Content.journeyCfg(idx),'journey'); }; }(i)));
  }
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,['* mastery stage'])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('mode-select');}},['Back']);
  foot.appendChild(back); root.appendChild(foot);
}

function renderLessonSelect(root) {
  clearNode(root);
  root.appendChild(h('h2', null, ['Lessons (Learn)']));
  root.appendChild(h('p', null, ['Five lessons. Each introduces one rule and requires the action to be performed.']));

  var prog = loadProgress();
  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  for (var i=0;i<Content.LESSONS.length;i++) {
    var l = Content.LESSONS[i];
    actions.push(btn(l.name + (prog.tutorialDone[l.id] ? ' ✓' : ''), function(idx){ return function(){ startRound(Content.lessonCfg(idx),'learn'); }; }(i)));
  }
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,['Learn mode.'])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('mode-select');}},['Back']);
  foot.appendChild(back); root.appendChild(foot);
}

function renderChallengeSelect(root) {
  clearNode(root);
  root.appendChild(h('h2', null, ['Challenges']));
  root.appendChild(h('p', null, ['Five constrained goals: move limits, speed targets, altered layouts.']));

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  for (var i=0;i<Content.CHALLENGES.length;i++) {
    var c = Content.CHALLENGES[i];
    actions.push(btn(c.name, function(idx){ return function(){ startRound(Content.challengeCfg(Content.CHALLENGES[idx].id),'challenge'); }; }(i)));
  }
  root.appendChild(h('div',{class:'actions'},actions));

  var list = h('ul',{class:'list'});
  for (var j=0;j<Content.CHALLENGES.length;j++) {
    list.appendChild(h('li',null,[Content.CHALLENGES[j].name + ' — ' + Content.CHALLENGES[j].desc]));
  }
  root.appendChild(list);

  var foot = h('footer',{class:'foot'},[h('small',null,['Constrained goals.'])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('mode-select');}},['Back']);
  foot.appendChild(back); root.appendChild(foot);
}

function renderPracticeSelect(root) {
  clearNode(root);
  root.appendChild(h('h2', null, ['Practice']));
  root.appendChild(h('p', null, ['Three difficulty presets. Selectable; no effect on competitive rating.']));

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  var diffs = ['relaxed','standard','veteran'];
  for (var i=0;i<diffs.length;i++) {
    var d = diffs[i];
    actions.push(btn(Content.PRACTICE[d].name, function(diff){ return function(){ startRound(Content.practiceCfg(diff,null),'practice'); }; }(d)));
  }
  root.appendChild(h('div',{class:'actions'},actions));

  var list = h('ul',{class:'list'});
  for (var k=0;k<diffs.length;k++) list.appendChild(h('li',null,[Content.PRACTICE[diffs[k]].name + ' — ' + Content.PRACTICE[diffs[k]].desc]));
  root.appendChild(list);

  var foot = h('footer',{class:'foot'},[h('small',null,['Selectable difficulty.'])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('mode-select');}},['Back']);
  foot.appendChild(back); root.appendChild(foot);
}

function renderHelp(root) {
  clearNode(root);
  root.appendChild(h('h2', null, ['How to play']));
  root.appendChild(h('p', null, [
    'Goods ride conveyor belts toward the Exchange, where they sell for gold. ',
    'Machines refine goods into more valuable forms. Fulfil every contract line before the tick limit to win.'
  ]));
  var list = h('ul',{class:'list'},[
    h('li',null,['Pick a tool, then click a board cell (or move the selection with the arrow keys and press Enter).']),
    h('li',null,['Belts and machines send goods out of the side they face — use Rotate to turn them.']),
    h('li',null,['Every build, rotate, removal and upgrade costs one tick, just like running the simulation.']),
    h('li',null,['Removing a building refunds half its cost; anything it was carrying is lost.']),
    h('li',null,['Practice and lesson rounds allow Undo (Z).']),
    h('li',null,['Keys: arrows move · Enter builds · Space runs a tick · A auto-run · B belt · M machine · R rotate · X remove · U upgrade · H hint · Z undo · P pause · Esc back.'])
  ]);
  root.appendChild(list);
  root.appendChild(art('./assets/help-line.webp', 'illus'));

  var foot = h('footer',{class:'foot'},[h('small',null,['Rules and controls.'])]);
  var back=h('button',{class:'btn primary',onclick:function(){ setScreen(state && !state.terminal ? 'play' : 'title'); }},['Back']);
  foot.appendChild(back); root.appendChild(foot);
}

function renderPaused(root) {
  clearNode(root);
  root.appendChild(h('h2', null, ['Paused']));
  root.appendChild(h('p', null, ['The simulation is stopped. Resume to continue the round.']));

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  actions.push(btn('Resume', function(){ setScreen('play'); }));
  actions.push(btn('Restart round', function(){ startRound(sessionCfg, sessionKind()); }));
  actions.push(btn('How to play', function(){ setScreen('help'); }));
  actions.push(btn('Sound: ' + (settings.muted ? 'off' : 'on'), function(){ toggleMute(); render(); }));
  actions.push(settingsButton('btn primary big'));
  actions.push(btn('Leave round', function(){ leaveRound(); }));
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,['Paused.'])]);
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
  sum.textContent = tr('gfx.summary', { gpu: gpuName, preset: presetLabel(gfx.preset), cost: Gfx.cost(gfx), w: px[0], h: px[1] });
  var note = document.getElementById('gfx-note');
  if (note) note.hidden = !gfxFailed;
  var mnote = document.getElementById('gfx-motion-note');
  if (mnote) mnote.hidden = !gfx.reducedMotion;
}

function renderSettings(root) {
  clearNode(root);
  root.appendChild(h('h2', { lang: LOCALE }, [tr('settings.title')]));
  root.appendChild(h('p', { lang: LOCALE }, [tr('settings.intro')]));

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
  root.appendChild(h('h2', null, [won ? 'Contracts complete' : 'Round over']));
  root.appendChild(h('p', null, [won
    ? 'Every contract line was fulfilled with ' + Math.max(0, (state.cfg.tickLimit || 0) - state.tick) + ' ticks to spare.'
    : (state.terminal && state.terminal.reason === 'resigned' ? 'You left the round early.' : 'The tick limit ran out before every contract was filled.')]));

  var list = h('ul',{class:'list'},[
    h('li',null,['Score: ' + state.score.total]),
    h('li',null,['Goods sold value: ' + state.score.goods]),
    h('li',null,['Contract bonus: ' + state.score.contractBonus]),
    h('li',null,['Gold left: ' + state.score.goldLeft]),
    h('li',null,['Speed bonus: ' + state.score.speedBonus]),
    h('li',null,['Ticks used: ' + state.tick + (state.cfg.tickLimit ? (' / ' + state.cfg.tickLimit) : '')])
  ]);
  root.appendChild(list);
  root.appendChild(art('./assets/exchange-ledger.webp', 'illus' + (won ? ' won' : ' lost')));

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  actions.push(btn('Play again (same round)', function(){ startRound(sessionCfg, sessionKind()); }));
  if (sessionKind()==='journey' && journeyIndex >= 0 && journeyIndex < Content.JOURNEY.length-1) {
    actions.push(btn('Next stage', function(){ startRound(Content.journeyCfg(journeyIndex+1), 'journey'); }));
  }
  actions.push(btn('Choose a mode', function(){ setScreen('mode-select'); }));
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,['Results.'])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('title');}},['Title']);
  foot.appendChild(back); root.appendChild(foot);
}

function renderPlay(root) {
  clearNode(root);
  // header: stage name, gold, tick/limit, pause
  el.gold = h('span',{class:'gold'},['Gold: ' + state.gold]);
  el.tick = h('span',{class:'tick'},['Tick: ' + state.tick + (state.cfg.tickLimit ? (' / '+state.cfg.tickLimit) : '')]);
  var head = h('div',{class:'head'},[
    h('h2',null,[stageName()]),
    el.gold,
    el.tick,
    h('button',{class:'btn',onclick:function(){ setScreen('paused'); }},['Pause (P)']),
    h('button',{class:'btn',onclick:function(){ setScreen('help'); }},['Help']),
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
  el.status = h('div',{class:'status',role:'status','aria-live':'polite'},[statusText]);
  foot.appendChild(el.hint);
  foot.appendChild(el.status);
  var back=h('button',{class:'btn',onclick:function(){ leaveRound(); }},['Title']);
  foot.appendChild(back); root.appendChild(foot);
}

function infoPanel() {
  var d = h('div',{class:'panel'});
  var lesson = currentLessonDef();
  if (lesson) {
    d.appendChild(h('div',{class:'row lesson'},[lesson.text]));
    d.appendChild(h('hr'));
  }
  // objective: contracts with progress
  for (var good in state.cfg.contracts) {
    var need = state.cfg.contracts[good];
    var have = state.progress[good] || 0;
    d.appendChild(h('div',{class:'row' + (have>=need ? ' done' : '')},['Contract ' + goodName(good) + ': ' + have + ' / ' + need]));
  }
  // score components (live)
  d.appendChild(h('hr'));
  d.appendChild(h('div',{class:'row'},['Score: ' + state.score.total]));
  d.appendChild(h('div',{class:'row dim'},['Goods value: ' + state.score.goods]));
  d.appendChild(h('div',{class:'row dim'},['Contract bonus: ' + state.score.contractBonus]));
  d.appendChild(h('div',{class:'row dim'},['Gold left (final): ' + state.score.goldLeft]));
  d.appendChild(h('div',{class:'row dim'},['Speed bonus: ' + state.score.speedBonus]));
  if (state.cfg.buildLimit) {
    d.appendChild(h('div',{class:'row dim'},['Buildings: ' + state.builds + ' / ' + state.cfg.buildLimit]));
  }
  d.appendChild(h('hr'));
  d.appendChild(h('div',{class:'row dim'},['Selected: ' + describeCell(selectedCell.x, selectedCell.y)]));
  return d;
}

function legend() {
  var d = h('div',{class:'legend'});
  d.appendChild(h('span',{class:'key src'},['Source']));
  d.appendChild(h('span',{class:'key belt'},['Belt']));
  d.appendChild(h('span',{class:'key mach'},['Machine']));
  d.appendChild(h('span',{class:'key sink'},['Exchange']));
  d.appendChild(h('span',{class:'key rock'},['Rock / water']));
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
    'aria-label':'Assembly Vale board. Arrow keys move the selection, Enter applies the current tool.',
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
      class:'tool'+(tool===id?' active':''),
      'aria-pressed': tool===id ? 'true' : 'false',
      onclick:function(){setTool(id);}
    },[label]);
  }
  d.appendChild(tbtn('Belt (place) — ' + Rules.beltCost(state) + 'g', TOOL_BELT));
  var cat = Rules.buildCatalog(state);
  for (var i=0;i<cat.length;i++) {
    if (cat[i].kind!=='machine') continue;
    var rec = Rules.recipeById(state.cfg, cat[i].recipe);
    var lbl = rec.name + ' (' + goodName(rec.input) + '→' + goodName(rec.output) + ') — ' + cat[i].cost + 'g';
    d.appendChild(h('button',{
      class:'tool'+(tool===TOOL_MACHINE && recipeChoice===cat[i].recipe ? ' active':'') + (cat[i].afford ? '' : ' poor'),
      'aria-pressed': (tool===TOOL_MACHINE && recipeChoice===cat[i].recipe) ? 'true' : 'false',
      onclick:function(id){ return function(){ recipeChoice=id; setTool(TOOL_MACHINE); }; }(cat[i].recipe)
    },[lbl]));
  }
  if (cat.length<2) d.appendChild(h('div',{class:'row dim'},['No machines in this stage.']));
  d.appendChild(tbtn('Rotate', TOOL_ROTATE));
  d.appendChild(tbtn('Remove', TOOL_REMOVE));
  if (state.cfg.upgrades) d.appendChild(tbtn('Upgrade', TOOL_UPGRADE));
  return d;
}

function actionButtons() {
  var d = h('div',{class:'panel actions-col'});
  function abtn(label,onClick,cls){ return h('button',{class:'act ' + (cls||'primary big'),onclick:onClick},[label]); }
  d.appendChild(abtn('Run one tick (Space)', function(){ doTick(); }));
  el.autoBtn = abtn(autoTimer ? 'Stop auto-run (A)' : 'Auto-run (A)', function(){ toggleAuto(); });
  d.appendChild(el.autoBtn);
  d.appendChild(abtn('Hint (H)', function(){ showHint(); }));
  if (undoEnabled()) d.appendChild(abtn('Undo (Z)', function(){ undo(); }, 'act'));
  d.appendChild(abtn('Restart round', function(){ startRound(sessionCfg, sessionKind()); }, 'act'));
  return d;
}

// ---------- names / labels (presentation only) ----------
function stageName() {
  var k = sessionCfg.kind;
  if (k==='journey') return sessionCfg.name || 'Journey';
  if (k==='learn') return 'Lesson: ' + lessonTitle();
  if (k==='daily') return 'Daily ' + todayStr();
  if (k==='challenge') return challengeName();
  if (k==='practice') return practiceDiffName();
  if (k==='score-chase' || k==='score') return 'Score Chase';
  return sessionCfg.name || '';
}

function currentLessonDef() {
  var l = sessionCfg && sessionCfg.lesson; if (!l) return null;
  for (var i=0;i<Content.LESSONS.length;i++) if (Content.LESSONS[i].id===l.id) return Content.LESSONS[i];
  return null;
}

function lessonTitle() {
  var l = currentLessonDef();
  return l ? l.name : '';
}

function challengeName() {
  var id = sessionCfg.challengeId; if (!id) return 'Challenge';
  for (var i=0;i<Content.CHALLENGES.length;i++) if (Content.CHALLENGES[i].id===id) return Content.CHALLENGES[i].name;
  return 'Challenge';
}

function practiceDiffName() {
  var d = sessionCfg.practiceDifficulty; if (!d) return 'Practice';
  return Content.PRACTICE[d] ? Content.PRACTICE[d].name : 'Practice';
}

function goodName(t) {
  var m = Content.GOOD_META[t]; return m ? m.name : t;
}

function describeCell(x,y) {
  if (!Rules.inBounds(state.cfg, x, y)) return '—';
  var cell = state.grid[y][x];
  var where = '(' + (x+1) + ', ' + (y+1) + ') ';
  if (!cell) return where + 'empty meadow';
  if (cell.k==='rock') return where + 'rock';
  if (cell.k==='water') return where + 'water';
  if (cell.k==='sink') return where + 'Exchange';
  if (cell.k==='source') return where + goodName(cell.item) + ' source facing ' + cell.dir;
  if (cell.k==='belt') return where + 'belt facing ' + cell.dir + (cell.itemRef ? ' carrying ' + goodName(cell.itemRef.t) : '');
  if (cell.k==='machine') {
    var rec = Rules.recipeById(state.cfg, cell.recipe);
    return where + (rec ? rec.name : 'machine') + ' level ' + cell.level + ' facing ' + cell.dir;
  }
  return where + cell.k;
}

// ---------- tool / cell selection ----------
function setTool(id) {
  tool = id;
  sfx('tool');
  setStatus('Tool: ' + id);
  refreshPlay();
}

function selectCell(x,y) {
  if (!Rules.inBounds(state.cfg, x, y)) return;
  selectedCell.x=x; selectedCell.y=y;
  setStatus(describeCell(x,y));
  refreshPlay();
}

function moveSelection(dx,dy) {
  selectCell(
    Math.min(state.cfg.board.cols-1, Math.max(0, selectedCell.x+dx)),
    Math.min(state.cfg.board.rows-1, Math.max(0, selectedCell.y+dy))
  );
}

function applyToolAt(x,y) {
  if (!tool) { setStatus('Pick a tool first.'); refreshPlay(); return; }
  if (tool===TOOL_BELT) placeAt(x,y,'belt',null);
  else if (tool===TOOL_MACHINE) {
    if (!recipeChoice) { setStatus('Pick a machine type first.'); refreshPlay(); return; }
    placeAt(x,y,'machine',recipeChoice);
  }
  else if (tool===TOOL_ROTATE) rotateAt(x,y);
  else if (tool===TOOL_REMOVE) removeAt(x,y);
  else if (tool===TOOL_UPGRADE) upgradeAt(x,y);
}

function hintText() {
  var hres = Rules.hint(state); if (!hres) return 'Keep delivering goods at the Exchange until every contract line is complete.';
  var c = hres.cmd, why = hres.why||'';
  if (c.type==='place') {
    if (c.kind==='belt') return 'Hint: place a belt at (' + (c.x+1) + ', ' + (c.y+1) + ') to carry goods onward.';
    return 'Hint: place a ' + (Rules.recipeById(state.cfg, c.recipe)||{name:'machine'}).name + ' at (' + (c.x+1) + ', ' + (c.y+1) + ').';
  }
  if (c.type==='rotate') return 'Hint: rotate the building at (' + (c.x+1) + ', ' + (c.y+1) + ') so its output faces onward.';
  if (c.type==='upgrade') return 'Hint: upgrade the machine at (' + (c.x+1) + ', ' + (c.y+1) + ') to work faster.';
  if (why==='deliver' || why==='win') return 'Keep delivering goods at the Exchange until every contract line is complete.';
  return '';
}

// =====================================================================
//  ACTIONS
// =====================================================================

var REASON_TEXT = {
  'game-ended': 'The round is over.',
  'out-of-bounds': 'That cell is off the board.',
  'cell-blocked': 'Rock and water cannot be built on.',
  'cell-occupied': 'That cell is already occupied.',
  'not-a-building': 'There is no belt or machine there.',
  'insufficient-gold': 'Not enough gold.',
  'recipe-locked': 'That machine is not available in this stage.',
  'max-level': 'That machine is already at maximum level.',
  'upgrade-disabled': 'Upgrades are disabled in this stage.',
  'build-limit': 'The building limit for this stage is reached.',
  'malformed-command': 'That action is not possible here.',
  'unknown-command': 'That action is not possible here.'
};

function undoEnabled() { return !!(sessionCfg && sessionCfg.mechanics && sessionCfg.mechanics.undo); }

function undo() {
  if (!undoEnabled() || !history.length) { setStatus('Nothing to undo.'); refreshPlay(); return; }
  state = history.pop();
  sfx('undo');
  setStatus('Undid the last action.');
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
  setStatus(hintText());
  refreshPlay();
}

function flashInvalid(reason) {
  sfx('invalid');
  setStatus(REASON_TEXT[reason] || ('Not allowed: ' + reason));
  refreshPlay();
}

// Map rules events onto sound and the live region.
function playEvents(events) {
  if (!events) return;
  var spoke = '';
  for (var i=0;i<events.length;i++) {
    var e = events[i];
    if (e.type==='place') { sfx('place'); spoke = 'Built a ' + e.kind + '.'; }
    else if (e.type==='remove') { sfx('remove'); spoke = 'Removed a ' + e.kind + '.'; }
    else if (e.type==='rotate') { sfx('rotate'); spoke = 'Rotated to face ' + e.dir + '.'; }
    else if (e.type==='upgrade') { sfx('upgrade'); spoke = 'Upgraded to level ' + e.level + '.'; }
    else if (e.type==='craft') sfx('craft');
    else if (e.type==='spawn') sfx('spawn');
    else if (e.type==='deliver') { sfx('deliver'); spoke = 'Sold ' + goodName(e.item) + ' for ' + e.value + ' gold.'; }
    else if (e.type==='contract-complete') { sfx('contract'); spoke = 'Contract complete: ' + goodName(e.item) + '.'; }
    else if (e.type==='spoil') { sfx('spoil'); spoke = goodName(e.item) + ' was lost.'; }
    else if (e.type==='win') { sfx('win'); spoke = 'All contracts complete.'; }
    else if (e.type==='lose') { sfx('lose'); spoke = 'The round ended.'; }
  }
  if (spoke) setStatus(spoke);
}

function setStatus(text) {
  statusText = text || '';
  if (el.status) { clearNode(el.status); el.status.appendChild(document.createTextNode(statusText)); }
}

// Called after every rules state change: refresh the play screen and handle
// the terminal transition.
function afterStateChange() {
  if (state.terminal) {
    setAuto(false);
    recordResult();
    setScreen('results');
    return;
  }
  refreshPlay();
}

// Update the play screen in place (keeps focus and avoids canvas churn).
function refreshPlay() {
  if (screen!=='play' || !state) return;
  if (el.gold) { clearNode(el.gold); el.gold.appendChild(document.createTextNode('Gold: ' + state.gold)); }
  if (el.tick) { clearNode(el.tick); el.tick.appendChild(document.createTextNode('Tick: ' + state.tick + (state.cfg.tickLimit ? (' / '+state.cfg.tickLimit) : ''))); }
  if (el.info && el.info.parentNode) { var fresh = infoPanel(); el.info.parentNode.replaceChild(fresh, el.info); el.info = fresh; }
  if (el.tools && el.tools.parentNode) {
    // Rebuild the palette (costs and affordability change with gold) while
    // keeping keyboard focus on the same button.
    var focusIdx = -1;
    var old = el.tools.querySelectorAll('button');
    for (var i=0;i<old.length;i++) if (old[i]===document.activeElement) focusIdx = i;
    var t = toolButtons();
    el.tools.parentNode.replaceChild(t, el.tools);
    el.tools = t;
    if (focusIdx >= 0) {
      var fresh2 = t.querySelectorAll('button');
      if (fresh2[focusIdx]) fresh2[focusIdx].focus();
    }
  }
  if (el.autoBtn) { clearNode(el.autoBtn); el.autoBtn.appendChild(document.createTextNode(autoTimer ? 'Stop auto-run (A)' : 'Auto-run (A)')); }
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
  statusText = 'Round started. Pick a tool and build toward the Exchange.';
  startAudio();
  setScreen('play');
}

function render() {
  var root = el.root; clearNode(root);
  el.gold = el.tick = el.info = el.tools = el.hint = el.status = el.autoBtn = null;
  el.boardCanvas = null;
  if (boardView) { boardView.destroy(); boardView = null; }
  stopPreview();
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
  var key = ev.key;
  var onButton = ev.target && ev.target.tagName === 'BUTTON';

  if (screen==='paused') {
    if (key==='Escape' || key==='p' || key==='P') { ev.preventDefault(); setScreen('play'); }
    return;
  }
  if (screen==='settings') {
    if (key==='Escape') { ev.preventDefault(); closeSettings(); }
    return;
  }
  if (screen==='help') {
    if (key==='Escape') { ev.preventDefault(); setScreen(state && !state.terminal ? 'play' : 'title'); }
    return;
  }
  if (screen!=='play') {
    if (key==='Escape' && screen!=='title') { ev.preventDefault(); setScreen('title'); }
    return;
  }

  if (key==='ArrowLeft') { ev.preventDefault(); moveSelection(-1,0); return; }
  if (key==='ArrowRight') { ev.preventDefault(); moveSelection(1,0); return; }
  if (key==='ArrowUp') { ev.preventDefault(); moveSelection(0,-1); return; }
  if (key==='ArrowDown') { ev.preventDefault(); moveSelection(0,1); return; }
  if (key==='Enter' && !onButton) { ev.preventDefault(); applyToolAt(selectedCell.x, selectedCell.y); return; }
  if (key===' ' && !onButton) { ev.preventDefault(); doTick(); return; }
  switch (key) {
    case 'b': case 'B': ev.preventDefault(); setTool(TOOL_BELT); break;
    case 'm': case 'M': ev.preventDefault(); setTool(TOOL_MACHINE); break;
    case 'r': case 'R': ev.preventDefault(); setTool(TOOL_ROTATE); break;
    case 'x': case 'X': ev.preventDefault(); setTool(TOOL_REMOVE); break;
    case 'u': case 'U': ev.preventDefault(); setTool(TOOL_UPGRADE); break;
    case 'h': case 'H': ev.preventDefault(); showHint(); break;
    case 'z': case 'Z': ev.preventDefault(); undo(); break;
    case 'a': case 'A': ev.preventDefault(); toggleAuto(); break;
    case 'p': case 'P': case 'Escape': ev.preventDefault(); setScreen('paused'); break;
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
      onSync: function () { if (screen === 'title') render(); }
    });
    var remoteDoc = remoteRaw ? Store.loadRaw(remoteRaw) : null;
    if (remoteDoc) {
      Store.save(remoteDoc); // local cache mirrors the remote doc
      settings = loadSettings();
      applyGraphics();
      render();
    }
  } catch (e) { /* offline or no token: the local save is already loaded */ }
}

window.addEventListener('DOMContentLoaded', function(){ init(); });
