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

// ---------- audio lifecycle ----------
function startAudio() { AudioMod.start(); AudioMod.applySettings(settings); AudioMod.setCaptions(!!settings.captions, setStatus); }
function stopAudio() { AudioMod.suspend(); }
function sfx(name) { try { AudioMod.play(name); } catch (e) { /* audio is optional */ } }

// =====================================================================
//  SCREENS
// =====================================================================

function renderTitle(root) {
  clearNode(root);
  root.appendChild(h('h1', null, ['Assembly Vale']));
  var p = h('p', null, [
    'Place production stations and conveyors to turn raw inputs into increasingly valuable goods. ',
    'Deliver them at the Exchange. Fulfilling every contract before the tick limit wins the round.'
  ]);
  root.appendChild(p);

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
    h('small',null,['Original. No real-money wagering, no ads, no energy pressure.'])
  ]);
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
  actions.push(btn('Leave round', function(){ leaveRound(); }));
  root.appendChild(h('div',{class:'actions'},actions));

  var foot = h('footer',{class:'foot'},[h('small',null,['Paused.'])]);
  root.appendChild(foot);
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
    h('button',{class:'btn',onclick:function(){ setScreen('help'); }},['Help'])
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

// Cell size in device pixels; the canvas is scaled down by CSS on narrow screens.
function cellSize() {
  var cols = state.cfg.board.cols, rows = state.cfg.board.rows;
  return Math.max(28, Math.min(64, Math.floor(640/cols), Math.floor(512/rows)));
}

function boardCanvas() {
  var cs = cellSize();
  var c = h('canvas',{
    id:'board', tabindex:'0', role:'application',
    'aria-label':'Assembly Vale board. Arrow keys move the selection, Enter applies the current tool.',
    width: String(state.cfg.board.cols*cs), height: String(state.cfg.board.rows*cs)
  });
  c.addEventListener('click', onBoardClick);
  c.addEventListener('mousemove', onBoardHover);
  el.boardCanvas = c;
  drawBoard(c);
  return c;
}

function theme() { return Content.THEMES[state.cfg.theme] || Content.THEMES.meadow; }

function pointerCell(canvas, ev) {
  var rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  var cs = cellSize();
  var px = (ev.clientX - rect.left) * (canvas.width / rect.width);
  var py = (ev.clientY - rect.top) * (canvas.height / rect.height);
  var x = Math.floor(px / cs), y = Math.floor(py / cs);
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

// Draw the whole board: terrain, then items (belts/sources), then machines.
function drawBoard(canvas) {
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  var th = theme();
  var cols = state.cfg.board.cols, rows = state.cfg.board.rows;
  var cs = cellSize();

  function cellRect(x,y){ return { x: x*cs, y: y*cs }; }
  function center(x,y){ var r=cellRect(x,y); return { x:r.x+cs/2, y:r.y+cs/2 }; }

  function arrow(cx, cy, dir, len, color, width) {
    var d = Rules.DIRS[dir] || Rules.DIRS.E;
    ctx.strokeStyle = color; ctx.lineWidth = width || 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - d[0]*len, cy - d[1]*len);
    ctx.lineTo(cx + d[0]*len, cy + d[1]*len);
    ctx.stroke();
    // head
    var hx = cx + d[0]*len, hy = cy + d[1]*len, s = len*0.55;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - d[0]*s + d[1]*s*0.7, hy - d[1]*s + d[0]*s*0.7);
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - d[0]*s - d[1]*s*0.7, hy - d[1]*s - d[0]*s*0.7);
    ctx.stroke();
  }

  function label(text, cx, cy, color, size) {
    ctx.fillStyle = color; ctx.font = 'bold ' + (size || Math.round(cs*0.32)) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy);
  }

  function item(it, cx, cy) {
    var meta = Content.GOOD_META[it.t] || { color:'#ffd166', name: it.t };
    ctx.fillStyle = meta.color;
    ctx.beginPath(); ctx.arc(cx, cy, cs*0.17, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // terrain base (checkered meadow, then rocks and water)
  for (var y=0;y<rows;y++) for (var x=0;x<cols;x++) {
    var r = cellRect(x,y);
    ctx.fillStyle = ((x+y)%2===0) ? th.tileA : th.tileB;
    ctx.fillRect(r.x, r.y, cs, cs);
  }
  (state.cfg.terrain||[]).forEach(function(t){
    var r = cellRect(t.x, t.y);
    ctx.fillStyle = t.k==='water' ? th.water : th.rock;
    ctx.fillRect(r.x+1, r.y+1, cs-2, cs-2);
  });

  // belts and sources — under machines so machine bodies sit on top.
  for (y=0;y<rows;y++) for (x=0;x<cols;x++) {
    var cell = state.grid[y][x];
    if (!cell) continue;
    var c = center(x,y);
    if (cell.k==='belt') {
      var rb = cellRect(x,y);
      ctx.fillStyle = th.belt;
      ctx.fillRect(rb.x+cs*0.12, rb.y+cs*0.12, cs*0.76, cs*0.76);
      arrow(c.x, c.y, cell.dir, cs*0.26, th.accent, Math.max(2, cs*0.07));
      if (cell.itemRef) item(cell.itemRef, c.x, c.y);
    } else if (cell.k==='source') {
      var rs = cellRect(x,y);
      ctx.fillStyle = '#3b3f45';
      ctx.fillRect(rs.x+cs*0.08, rs.y+cs*0.08, cs*0.84, cs*0.84);
      var meta = Content.GOOD_META[cell.item] || { color:'#ccc', name: cell.item };
      ctx.fillStyle = meta.color;
      ctx.fillRect(rs.x+cs*0.2, rs.y+cs*0.2, cs*0.6, cs*0.6);
      // the good's initial keeps a source distinct from plain rock
      label(meta.name.charAt(0), c.x, c.y - cs*0.05, '#1b1b1b', Math.round(cs*0.3));
      arrow(c.x, c.y + cs*0.28, cell.dir, cs*0.14, '#f4f4f4', Math.max(2, cs*0.06));
      if (cell.itemRef) item(cell.itemRef, c.x, c.y);
    }
  }

  // machines (on top)
  for (y=0;y<rows;y++) for (x=0;x<cols;x++) {
    var m = state.grid[y][x];
    if (!m || m.k!=='machine') continue;
    var mc = center(x,y), rm = cellRect(x,y);
    ctx.fillStyle = '#5b3f7a';
    ctx.fillRect(rm.x+cs*0.08, rm.y+cs*0.08, cs*0.84, cs*0.84);
    ctx.strokeStyle = m.level>=3 ? '#e74c3c' : (m.level>=2 ? '#f1c40f' : '#2b1d3a');
    ctx.lineWidth = m.level>=2 ? 3 : 2;
    ctx.strokeRect(rm.x+cs*0.08, rm.y+cs*0.08, cs*0.84, cs*0.84);
    var rec = Rules.recipeById(state.cfg, m.recipe);
    label(rec ? rec.name.charAt(0) : '?', mc.x, mc.y - cs*0.06, '#ffffff');
    label('L' + m.level, mc.x, mc.y + cs*0.26, '#ded3ea', Math.round(cs*0.2));
    arrow(mc.x + (Rules.DIRS[m.dir]||[1,0])[0]*cs*0.3, mc.y + (Rules.DIRS[m.dir]||[1,0])[1]*cs*0.3, m.dir, cs*0.1, '#ffd166', 2);
    if (m.inBuf) item(m.inBuf, rm.x+cs*0.24, rm.y+cs*0.24);
    if (m.outBuf) item(m.outBuf, rm.x+cs*0.76, rm.y+cs*0.76);
  }

  // sink (Exchange) — drawn late so it is always visible.
  var sx = state.cfg.sink.x, sy = state.cfg.sink.y;
  var sr = cellRect(sx,sy), sc = center(sx,sy);
  ctx.fillStyle = '#b5342a';
  ctx.fillRect(sr.x+cs*0.06, sr.y+cs*0.06, cs*0.88, cs*0.88);
  label('$', sc.x, sc.y, '#ffe9c4', Math.round(cs*0.45));

  // selection highlight, drawn last
  var selr = cellRect(selectedCell.x, selectedCell.y);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
  ctx.strokeRect(selr.x+2, selr.y+2, cs-4, cs-4);
  ctx.strokeStyle = '#101010'; ctx.lineWidth = 1;
  ctx.strokeRect(selr.x+4, selr.y+4, cs-8, cs-8);
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
  afterStateChange();
  return true;
}

function doTick() {
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
  if (el.boardCanvas) drawBoard(el.boardCanvas);
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
function toggleAuto() { setAuto(!autoTimer); sfx('ui'); refreshPlay(); }

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

// ---------- keyboard ----------
function onKeyDown(ev) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  var key = ev.key;
  var onButton = ev.target && ev.target.tagName === 'BUTTON';

  if (screen==='paused') {
    if (key==='Escape' || key==='p' || key==='P') { ev.preventDefault(); setScreen('play'); }
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

function init() {
  el.root = document.getElementById('root');
  document.addEventListener('keydown', onKeyDown);
  // Backgrounding pauses the solo simulation (spec §state machine).
  document.addEventListener('visibilitychange', function(){
    if (document.hidden && screen==='play') { setAuto(false); setScreen('paused'); }
  });
  // WebAudio is unlocked by startRound's user gesture, never during page load.
  render();
}

window.addEventListener('DOMContentLoaded', function(){ init(); });
