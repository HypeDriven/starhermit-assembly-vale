/* Assembly Vale — browser application.
 * Wires the pure rules engine (rules.js) and content (content.js) to a
 * semantic-HTML UI with procedural WebAudio (audio.js). No 3D, no canvas:
 * the board is drawn as DOM cells; all state lives in the rules module.
 */

var Rules = window.AVRules;
var Content = window.AVContent;
var Store = window.AVStore;
var AudioMod = window.AVAudio;

// ---------- settings (persisted) ----------
function loadSettings() { return Object.assign({}, Store.DEFAULT_SETTINGS, Store.load().settings); }
function saveSettings(s) { var doc = Store.load(); doc.settings = s; Store.save(doc); }
var settings = loadSettings();

// ---------- session state ----------
var screen = 'title';       // title | mode-select | play | paused | results | help
var tool = null;            // 'belt' | 'machine' | 'rotate' | 'upgrade'
var selectedCell = { x: 0, y: 0 };
var sessionCfg = null;      // rules cfg for the active round (kind + id)
var state = null;           // current rules state

// tool ids used by UI buttons
var TOOL_BELT='belt', TOOL_MACHINE='machine', TOOL_ROTATE='rotate', TOOL_UPGRADE='upgrade';

function now() { return Date.now(); }

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

// ---------- audio lifecycle ----------
function startAudio() { AudioMod.start(); AudioMod.applySettings(settings); if (settings.captions) AudioMod.setCaptions(true, function(t){}); }
function stopAudio() { AudioMod.suspend(); }

// =====================================================================
//  SCREENS
// =====================================================================

function renderTitle(root) {
  clearNode(root);
  root.appendChild(h('h1', null, ['Assembly Vale']));
  var p = h('p', null, [
    'Place production stations and conveyors to turn raw inputs into increasingly valuable goods.',
    'Deliver them at the Exchange. Fulfill every contract before the tick limit wins the round.'
  ]);
  root.appendChild(p);

  function btn(label, onClick) { return h('button', { class:'btn primary big', onclick:onClick }, [label]); }
  var actions = [];
  actions.push(btn('Play', function(){ setScreen('mode-select'); }));
  actions.push(h('div',{class:'spacer'}));
  actions.push(btn('Daily Challenge', function(){ startRound(Content.dailyConfig(todayStr()), 'daily'); }));
  actions.push(h('div',{class:'spacer'}));
  actions.push(btn('Journey', function(){ setScreen('journey-select'); }));
  actions.push(h('div',{class:'spacer'}));
  actions.push(btn('Lessons (Learn)', function(){ setScreen('lesson-select'); }));
  actions.push(h('div',{class:'spacer'}));
  actions.push(btn('Challenges', function(){ setScreen('challenge-select'); }));
  actions.push(h('div',{class:'spacer'}));
  actions.push(btn('Practice', function(){ setScreen('practice-select'); }));
  actions.push(h('div',{class:'spacer'}));
  actions.push(btn('Score Chase', function(){ startRound(Content.scoreChaseCfg(null), 'score-chase'); }));
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,['Original. No real-money wagering, no ads, no energy pressure.'])]);
  root.appendChild(foot);
}

function renderModeSelect(root) {
  clearNode(root);
  root.appendChild(h('h2', null, ['Choose a mode']));
  var p = h('p', null, [
    'Learn: interactive lessons. Journey: authored progression with mastery stages.',
    'Daily: one shared seed per UTC day. Practice: selectable difficulty, no rating effect.'
  ]);
  root.appendChild(p);

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  actions.push(btn('Lessons (Learn)', function(){ setScreen('lesson-select'); }));
  actions.push(h('div',{class:'spacer'}));
  actions.push(btn('Journey', function(){ setScreen('journey-select'); }));
  actions.push(h('div',{class:'spacer'}));
  actions.push(btn('Daily Challenge', function(){ startRound(Content.dailyConfig(todayStr()), 'daily'); }));
  actions.push(h('div',{class:'spacer'}));
  actions.push(btn('Challenges', function(){ setScreen('challenge-select'); }));
  actions.push(h('div',{class:'spacer'}));
  actions.push(btn('Practice', function(){ setScreen('practice-select'); }));
  actions.push(h('div',{class:'spacer'}));
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
    'Forty authored stages. One mechanic at a time, then combinations.',
    'A mastery stage closes each block of four.'
  ]);
  root.appendChild(p);

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  for (var i=0;i<Content.JOURNEY.length;i++) {
    var st = Content.JOURNEY[i];
    actions.push(btn(st.name + (st.mastery?' *':''), function(idx){ return function(){ startRound(Content.journeyCfg(idx),'journey'); }; }(i)));
    if ((i+1)%4===0 || i===Content.JOURNEY.length-1) actions.push(h('div',{class:'spacer'}));
  }
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,['* mastery stage'])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('mode-select');}},['Back']);
  foot.appendChild(back); root.appendChild(foot);
}

function renderLessonSelect(root) {
  clearNode(root);
  root.appendChild(h('h2', null, ['Lessons (Learn)']));
  var p = h('p', null, [
    'Five lessons. Each introduces one rule and requires the action to be performed.'
  ]);
  root.appendChild(p);

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  for (var i=0;i<Content.LESSONS.length;i++) {
    var l = Content.LESSONS[i];
    actions.push(btn(l.name, function(idx){ return function(){ startRound(Content.lessonCfg(idx),'learn'); }; }(i)));
    if ((i+1)%5===0 || i===Content.LESSONS.length-1) actions.push(h('div',{class:'spacer'}));
  }
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,['Learn mode.'])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('mode-select');}},['Back']);
  foot.appendChild(back); root.appendChild(foot);
}

function renderChallengeSelect(root) {
  clearNode(root);
  root.appendChild(h('h2', null, ['Challenges']));
  var p = h('p', null, [
    'Five constrained goals: move limits, speed targets, altered layouts.'
  ]);
  root.appendChild(p);

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  for (var i=0;i<Content.CHALLENGES.length;i++) {
    var c = Content.CHALLENGES[i];
    actions.push(btn(c.name, function(idx){ return function(){ startRound(Content.challengeCfg(Content.CHALLENGES[idx].id),'challenge'); }; }(i)));
    if ((i+1)%5===0 || i===Content.CHALLENGES.length-1) actions.push(h('div',{class:'spacer'}));
  }
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,['Constrained goals.'])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('mode-select');}},['Back']);
  foot.appendChild(back); root.appendChild(foot);
}

function renderPracticeSelect(root) {
  clearNode(root);
  root.appendChild(h('h2', null, ['Practice']));
  var p = h('p', null, [
    'Three difficulty presets. Selectable; no effect on competitive rating.'
  ]);
  root.appendChild(p);

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  for (var i=0;i<3;i++) {
    var d = ['relaxed','standard','veteran'][i];
    actions.push(btn(Content.PRACTICE[d].name, function(diff){ return function(){ startRound(Content.practiceCfg(diff,null),'practice'); }; }(d)));
    if ((i+1)%3===0 || i===2) actions.push(h('div',{class:'spacer'}));
  }
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,['Selectable difficulty.'])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('mode-select');}},['Back']);
  foot.appendChild(back); root.appendChild(foot);
}

function renderHelp(root) {
  clearNode(root);
  root.appendChild(h('h2', null, ['How to play']));
  var p = h('p', null, [
    'Goods ride conveyor belts. Machines refine goods into more valuable forms.',
    'Select a tool and tap an empty meadow cell to build; use the rotate tool (or R) to turn a building.'
  ]);
  root.appendChild(p);

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  actions.push(btn('Place / build', function(){ setTool(TOOL_BELT); }));
  actions.push(h('div',{class:'spacer'}));
  actions.push(btn('Rotate (R)', function(){ setTool(TOOL_ROTATE); }));
  actions.push(h('div',{class:'spacer'}));
  actions.push(btn('Upgrade', function(){ setTool(TOOL_UPGRADE); }));
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,['Rules and controls.'])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('play');}},['Back to play']);
  foot.appendChild(back); root.appendChild(foot);
}

function renderPaused(root) {
  clearNode(root);
  root.appendChild(h('h2', null, ['Paused']));
  var p = h('p', null, [
    'Resume to continue. Settings and help are available from the play screen.'
  ]);
  root.appendChild(p);

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  actions.push(btn('Resume', function(){ setScreen('play'); }));
  actions.push(h('div',{class:'spacer'}));
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,['Paused.'])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('play');}},['Resume']);
  foot.appendChild(back); root.appendChild(foot);
}

function renderResults(root) {
  clearNode(root);
  root.appendChild(h('h2', null, ['Round over']));
  var p = h('p', null, [
    'Score: ' + state.score.total,
    'Goods sold value: ' + state.score.goods,
    'Contract bonus: ' + state.score.contractBonus,
    'Gold left: ' + state.score.goldLeft,
    'Speed bonus: ' + state.score.speedBonus
  ]);
  root.appendChild(p);

  function btn(label, onClick) { return h('button',{class:'btn primary big',onclick:onClick},[label]); }
  var actions=[];
  actions.push(btn('Play again (same round)', function(){ startRound(sessionCfg, sessionKind()); }));
  actions.push(h('div',{class:'spacer'}));
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,['Results.'])]);
  var back=h('button',{class:'btn',onclick:function(){setScreen('title');}},['Title']);
  foot.appendChild(back); root.appendChild(foot);
}

function renderPlay(root) {
  clearNode(root);
  // header: stage name, gold, tick/limit
  var head = h('div',{class:'head'},[
    h('h2',null,[stageName()]),
    h('span',{class:'gold'},['Gold: ' + state.gold]),
    h('span',{class:'tick'},['Tick: ' + state.tick + (state.cfg.tickLimit ? (' / '+state.cfg.tickLimit) : '')])
  ]);
  root.appendChild(head);

  // body: info | canvas | tools
  var body = h('div',{class:'body'});
  var left = h('div',{class:'col'},[infoPanel()]);
  var center = h('div',{class:'canvas-wrap'},[boardCanvas()]);
  var right = h('div',{class:'col'},[toolButtons(), actionButtons()]);
  body.appendChild(left); body.appendChild(center); body.appendChild(right);
  root.appendChild(body);

  // footer: hint + back to title
  var foot = h('footer',{class:'foot'});
  if (hintText()) foot.appendChild(h('small',null,[hintText()]));
  var back=h('button',{class:'btn',onclick:function(){setScreen('title');}},['Title']);
  foot.appendChild(back); root.appendChild(foot);
}

function infoPanel() {
  var d = h('div',{class:'panel'});
  // objective: contracts with progress
  for (var good in state.cfg.contracts) {
    var need = state.cfg.contracts[good];
    var have = state.progress[good] || 0;
    d.appendChild(h('div',{class:'row'},['Contract ' + goodName(good) + ': ' + have + ' / ' + need]));
  }
  // score components (live)
  d.appendChild(h('hr'));
  d.appendChild(h('div',{class:'row'},['Score: ' + state.score.total]));
  d.appendChild(h('div',{class:'row dim'},['Goods value: ' + state.score.goods]));
  d.appendChild(h('div',{class:'row dim'},['Contract bonus: ' + state.score.contractBonus]));
  d.appendChild(h('div',{class:'row dim'},['Gold left (final): ' + state.score.goldLeft]));
  d.appendChild(h('div',{class:'row dim'},['Speed bonus: ' + state.score.speedBonus]));
  return d;
}

function boardCanvas() {
  var c = h('canvas',{ id:'board', width:'640', height:'512' });
  drawBoard(c);
  return c;
}

// Draw the whole board: terrain, then items (belts/sources), then machines.
function drawBoard(canvas) {
  var ctx = canvas.getContext('2d');
  var cols = state.cfg.board.cols, rows = state.cfg.board.rows;
  var W = canvas.width, Hh = canvas.height;
  var cw = Math.floor(W / cols);
  var chh = Math.floor(Hh / rows);

  function cellRect(x,y){ return { x: x*cw, y: (rows-1-y)*chh }; }

  // terrain base
  for (var y=0;y<rows;y++) for (var x=0;x<cols;x++) {
    var t = state.cfg.terrain ? null : null;
    ctx.fillStyle = '#cfe8b9';
    var r = cellRect(x,y);
    ctx.fillRect(r.x, r.y, cw+1, chh+1);
  }

  // items (belts and sources) — under machines so machine bodies sit on top.
  for (var y=0;y<rows;y++) for (var x=0;x<cols;x++) {
    var cell = state.grid[y][x];
    if (!cell || (cell.k!=='belt' && cell.k!=='source')) continue;
    ctx.fillStyle = '#3a6ea5';
    var r = cellRect(x,y);
    ctx.beginPath(); ctx.arc(r.x+cw/2, r.y+chh/2, Math.min(cw,chh)/2-4, 0, Math.PI*2); ctx.fill();
    if (cell.itemRef) {
      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(r.x+cw/2, r.y+chh/2, Math.min(cw,chh)/4, 0, Math.PI*2); ctx.fill();
    }
  }

  // machines (on top)
  for (var y=0;y<rows;y++) for (var x=0;x<cols;x++) {
    var cell = state.grid[y][x];
    if (!cell || cell.k!=='machine') continue;
    ctx.fillStyle = '#8e44ad';
    var r = cellRect(x,y);
    ctx.beginPath(); ctx.arc(r.x+cw/2, r.y+chh/2, Math.min(cw,chh)/2-3, 0, Math.PI*2); ctx.fill();
    if (cell.level>=2) { ctx.strokeStyle='#f1c40f'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(r.x+cw/2,r.y+chh/2,Math.min(cw,chh)/2-8,0,Math.PI*2); ctx.stroke(); }
    if (cell.level>=3) { ctx.strokeStyle='#e74c3c'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(r.x+cw/2,r.y+chh/2,Math.min(cw,chh)/2-13,0,Math.PI*2); ctx.stroke(); }
  }

  // sink (Exchange) — drawn last so it is always visible on top.
  var sx = state.cfg.sink.x, sy = state.cfg.sink.y;
  ctx.fillStyle = '#e74c3c';
  var sr = cellRect(sx,sy);
  ctx.beginPath(); ctx.arc(sr.x+cw/2, sr.y+chh/2, Math.min(cw,chh)/2-6, 0, Math.PI*2); ctx.fill();
}

function toolButtons() {
  var d = h('div',{class:'panel'});
  function tbtn(label,id){ return h('button',{class:'tool'+(tool===id?' active':''),onclick:function(){setTool(id);}},[label]); }
  d.appendChild(tbtn('Belt (place)', TOOL_BELT));
  d.appendChild(h('div',{class:'gap'}));
  d.appendChild(tbtn('Machine (place)', TOOL_MACHINE));
  d.appendChild(h('div',{class:'gap'}));
  d.appendChild(tbtn('Rotate', TOOL_ROTATE));
  d.appendChild(h('div',{class:'gap'}));
  d.appendChild(tbtn('Upgrade', TOOL_UPGRADE));
  return d;
}

function actionButtons() {
  var d = h('div',{class:'panel actions-col'});
  function abtn(label,onClick){ return h('button',{class:'act primary big',onclick:onClick},[label]); }
  d.appendChild(abtn('Run one tick (Space)', function(){ doTick(); }));
  d.appendChild(h('div',{class:'gap'}));
  d.appendChild(abtn('Hint', function(){ showHint(); }));
  d.appendChild(h('div',{class:'gap'}));
  return d;
}

// ---------- names / labels (presentation only) ----------
function stageName() {
  var k = sessionCfg.kind;
  if (k==='journey') return 'Journey';
  if (k==='learn') return 'Lesson: ' + lessonTitle();
  if (k==='daily') return 'Daily ' + todayStr();
  if (k==='challenge') return challengeName();
  if (k==='practice') return practiceDiffName();
  if (k==='score-chase' || k==='score') return 'Score Chase';
  return '';
}

function lessonTitle() {
  var l = sessionCfg.lesson; if (!l) return '';
  for (var i=0;i<Content.LESSONS.length;i++) if (Content.LESSONS[i].id===l.id) return Content.LESSONS[i].name;
  return '';
}

function challengeName() {
  var id = sessionCfg.challengeId; if (!id) return '';
  for (var i=0;i<Content.CHALLENGES.length;i++) if (Content.CHALLENGES[i].id===id) return Content.CHALLENGES[i].name;
  return '';
}

function practiceDiffName() {
  var d = sessionCfg.practiceDifficulty; if (!d) return '';
  for (var k in Content.PRACTICE) if (k===d) return Content.PRACTICE[k].name;
  return '';
}

function goodName(t) {
  var m = Content.GOOD_META[t]; return m ? m.name : t;
}

// ---------- tool / cell selection ----------
function setTool(id) { tool = id; }

function selectCell(x,y) { selectedCell.x=x; selectedCell.y=y; }

function hintText() {
  var hres = Rules.hint(state); if (!hres) return '';
  var c = hres.cmd, why = hres.why||'';
  if (c.type==='place') {
    if (c.kind==='belt') return 'Place a belt: tap an empty meadow cell next to the ore mine and keep laying belts toward the Exchange.';
    return 'Place a machine on the line that needs it.';
  }
  if (c.type==='rotate') return 'Rotate this building so its output faces onward.';
  if (c.type==='upgrade') return 'Upgrade this machine to work faster.';
  if (why==='deliver' || why==='win') return 'Keep delivering goods at the Exchange until every contract line is complete.';
  return '';
}

// =====================================================================
//  ACTIONS
// =====================================================================

function doTick() {
  var res = Rules.applyCommand(state, { type:'tick', atMs: now() });
  if (!res.ok) { flashInvalid(res.reason); return; }
  state = res.state;
  afterStateChange();
}

function placeAt(x,y,kind,recipeId) {
  var reason = Rules.checkPlace(state,x,y,kind,recipeId);
  if (reason) { flashInvalid(reason); return; }
  var dir='E';
  var res = Rules.applyCommand(state,{ type:'place', x:x,y:y, kind:kind, recipe:recipeId||null, dir:dir });
  if (!res.ok) { flashInvalid(res.reason); return; }
  state=res.state; afterStateChange();
}

function rotateAt(x,y) {
  var reason = Rules.checkRotate(state,x,y);
  if (reason) { flashInvalid(reason); return; }
  var res = Rules.applyCommand(state,{ type:'rotate', x:x,y:y });
  if (!res.ok) { flashInvalid(res.reason); return; }
  state=res.state; afterStateChange();
}

function removeAt(x,y) {
  var reason = Rules.checkRemove(state,x,y);
  if (reason) { flashInvalid(reason); return; }
  var res = Rules.applyCommand(state,{ type:'remove', x:x,y:y });
  if (!res.ok) { flashInvalid(res.reason); return; }
  state=res.state; afterStateChange();
}

function upgradeAt(x,y) {
  var reason = Rules.checkUpgrade(state,x,y);
  if (reason) { flashInvalid(reason); return; }
  var res = Rules.applyCommand(state,{ type:'upgrade', x:x,y:y });
  if (!res.ok) { flashInvalid(res.reason); return; }
  state=res.state; afterStateChange();
}

function showHint() {
  var hres = Rules.hint(state); if (!hres) return;
  // (hint text is shown in the footer via hintText())
}

function flashInvalid(reason) { /* reserved for future toast */ }

// Called after every rules state change: persist settings, redraw board.
function afterStateChange() {
  saveSettings(settings);
  if (el.boardCanvas) drawBoard(el.boardCanvas);
}

// =====================================================================
//  NAVIGATION / LIFECYCLE
// =====================================================================

function setScreen(name) { screen = name; render(); }

function startRound(cfg, kind) {
  sessionCfg = cfg;
  state = Rules.createGame(cfg);
  tool = null; selectedCell={x:0,y:0};
  if (kind==='learn') settings.tutorialDone[cfg.lesson.id]=true;
  saveSettings(settings);
  startAudio();
  setScreen('play');
}

function render() {
  var root = el.root; clearNode(root);
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
}

function init() {
  el.root = document.getElementById('root');
  el.boardCanvas = null; // set in renderPlay via canvas id lookup below
  var c = document.getElementById('board'); if (c) el.boardCanvas=c;
  // WebAudio is unlocked by startRound's user gesture, never during page load.
  render();
}

window.addEventListener('DOMContentLoaded', function(){ init(); });
