/* Assembly Vale — pure deterministic rules engine.
 * No rendering, no DOM, no Date.now(): every transition derives from
 * (state, command) only. Usable from browser (window.AVRules) and Node.
 *
 * Core loop: raw goods spawn at sources, ride conveyors (belts), are
 * transformed by machines along recipe chains, and are sold at the
 * Exchange. Delivering goods earns gold to fund more buildings;
 * fulfilling every contract before the tick limit wins the round.
 *
 * Commands: place / rotate / remove / upgrade (building, any time),
 * tick (advance the simulation one step), resign.
 */
(function (root, factory) {
  var RNG = (typeof module === 'object' && module.exports) ? require('./rng.js') : root.AVRNG;
  var api = factory(RNG);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AVRules = api;
})(typeof self !== 'undefined' ? self : this, function (RNG) {
  'use strict';

  var STATE_VERSION = 1;
  var CONTRACT_BONUS = 150;  // per contract line completed
  var SPEED_PT = 2;          // win bonus per tick under the limit
  var REFUND_RATIO = 0.5;    // floor(cost/2) refunded on remove
  var MAX_LEVEL = 3;
  var LEVEL_TIME = [1, 0.66, 0.5]; // process-time multiplier per machine level

  var TERMINAL = {
    CONTRACTS: 'contracts-complete',
    TIME: 'time-up',
    RESIGN: 'resigned'
  };

  var INVALID = {
    ENDED: 'game-ended',
    BAD_CMD: 'unknown-command',
    BAD_SHAPE: 'malformed-command',
    OUT_OF_BOUNDS: 'out-of-bounds',
    BLOCKED: 'cell-blocked',
    OCCUPIED: 'cell-occupied',
    NOT_BUILDING: 'not-a-building',
    NO_GOLD: 'insufficient-gold',
    RECIPE_LOCKED: 'recipe-locked',
    MAX_LEVEL: 'max-level',
    UPGRADES_OFF: 'upgrade-disabled',
    BUILD_LIMIT: 'build-limit'
  };

  var DIRS = { E: [1, 0], S: [0, 1], W: [-1, 0], N: [0, -1] };
  var DIR_ORDER = ['E', 'S', 'W', 'N'];

  // ---------- helpers ----------

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Stable stringify: object keys sorted recursively → canonical hashing.
  function stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) {
      var out = '[';
      for (var i = 0; i < v.length; i++) out += (i ? ',' : '') + stableStringify(v[i]);
      return out + ']';
    }
    var keys = Object.keys(v).sort(), s = '{';
    for (var k = 0; k < keys.length; k++) {
      s += (k ? ',' : '') + JSON.stringify(keys[k]) + ':' + stableStringify(v[keys[k]]);
    }
    return s + '}';
  }

  function hashState(state) {
    var copy = clone(state);
    delete copy.events;
    return RNG.hashString(stableStringify(copy));
  }

  function inBounds(cfg, x, y) {
    return Number.isInteger(x) && Number.isInteger(y) &&
      x >= 0 && x < cfg.board.cols && y >= 0 && y < cfg.board.rows;
  }

  function cellAt(state, x, y) {
    return inBounds(state.cfg, x, y) ? state.grid[y][x] : undefined;
  }

  function recipeById(cfg, id) {
    for (var i = 0; i < cfg.recipes.length; i++) if (cfg.recipes[i].id === id) return cfg.recipes[i];
    return null;
  }

  function allowedRecipe(cfg, id) {
    return cfg.allowedRecipes.indexOf(id) >= 0;
  }

  function processTime(recipe, level) {
    return Math.max(1, Math.ceil(recipe.time * LEVEL_TIME[level - 1]));
  }

  function machineCost(state, recipe) {
    return Math.ceil(recipe.cost * (state.cfg.costScale || 1));
  }
  function beltCost(state) {
    return Math.ceil(state.cfg.beltCost * (state.cfg.costScale || 1));
  }
  function upgradeCost(state, machine) {
    return state.cfg.upgradeCosts[machine.level - 1];
  }

  function contractsComplete(state) {
    var need = state.cfg.contracts;
    for (var t in need) if ((state.progress[t] || 0) < need[t]) return false;
    return true;
  }

  // ---------- game creation ----------

  // cfg: { id, version, kind, seed, board:{cols,rows},
  //        terrain:[{x,y,k:'rock'|'water'}],
  //        sources:[{x,y,item,dir,every}], sink:{x,y},
  //        goods:{type:value}, recipes:[{id,name,input,output,time,cost}],
  //        allowedRecipes:[ids], beltCost, upgradeCosts:[l2,l3],
  //        gold, contracts:{good:count}, tickLimit, buildLimit,
  //        upgrades:true, mechanics:{undo,hint}, par:{ticks,builds},
  //        theme, costScale }
  function createGame(cfg) {
    if (!cfg || !cfg.board || !cfg.board.cols || !cfg.board.rows) {
      throw new Error('cfg.board with cols/rows is required');
    }
    var grid = [], x, y;
    for (y = 0; y < cfg.board.rows; y++) {
      var row = [];
      for (x = 0; x < cfg.board.cols; x++) row.push(null);
      grid.push(row);
    }
    (cfg.terrain || []).forEach(function (t) {
      if (inBounds(cfg, t.x, t.y)) grid[t.y][t.x] = { k: t.k };
    });
    (cfg.sources || []).forEach(function (src) {
      if (!inBounds(cfg, src.x, src.y)) throw new Error('source out of bounds');
      grid[src.y][src.x] = {
        k: 'source', item: src.item, dir: src.dir || 'E',
        every: Math.max(1, src.every || 4), itemRef: null
      };
    });
    if (!cfg.sink || !inBounds(cfg, cfg.sink.x, cfg.sink.y)) {
      throw new Error('cfg.sink in bounds is required');
    }
    grid[cfg.sink.y][cfg.sink.x] = { k: 'sink' };

    var state = {
      v: STATE_VERSION,
      cfg: clone(cfg),
      seed: cfg.seed >>> 0,
      tick: 0,
      nextId: 1,
      grid: grid,
      gold: cfg.gold,
      builds: 0,
      progress: {},        // good -> units delivered (contract accounting)
      sold: {},            // good -> units delivered (all sales)
      contractDone: {},    // good -> true once bonus awarded
      score: { goods: 0, contractBonus: 0, goldLeft: 0, speedBonus: 0, total: 0 },
      elapsedMs: 0,
      terminal: null,
      events: []
    };
    for (var t in cfg.contracts) state.progress[t] = 0;
    return state;
  }

  // ---------- legality ----------

  function buildingCost(state, kind, recipe) {
    return kind === 'belt' ? beltCost(state) : machineCost(state, recipe);
  }

  function checkPlace(state, x, y, kind, recipeId) {
    if (state.terminal) return INVALID.ENDED;
    if (!inBounds(state.cfg, x, y)) return INVALID.OUT_OF_BOUNDS;
    if (kind !== 'belt' && kind !== 'machine') return INVALID.BAD_SHAPE;
    var cell = state.grid[y][x];
    if (cell) return (cell.k === 'rock' || cell.k === 'water') ? INVALID.BLOCKED : INVALID.OCCUPIED;
    if (state.cfg.buildLimit && state.builds >= state.cfg.buildLimit) return INVALID.BUILD_LIMIT;
    var recipe = null;
    if (kind === 'machine') {
      recipe = recipeById(state.cfg, recipeId);
      if (!recipe || !allowedRecipe(state.cfg, recipeId)) return INVALID.RECIPE_LOCKED;
    }
    if (state.gold < buildingCost(state, kind, recipe)) return INVALID.NO_GOLD;
    return null;
  }

  function checkRotate(state, x, y) {
    if (state.terminal) return INVALID.ENDED;
    if (!inBounds(state.cfg, x, y)) return INVALID.OUT_OF_BOUNDS;
    var cell = state.grid[y][x];
    if (!cell || (cell.k !== 'belt' && cell.k !== 'machine')) return INVALID.NOT_BUILDING;
    return null;
  }

  function checkRemove(state, x, y) {
    if (state.terminal) return INVALID.ENDED;
    if (!inBounds(state.cfg, x, y)) return INVALID.OUT_OF_BOUNDS;
    var cell = state.grid[y][x];
    if (!cell || (cell.k !== 'belt' && cell.k !== 'machine')) return INVALID.NOT_BUILDING;
    return null;
  }

  function checkUpgrade(state, x, y) {
    if (state.terminal) return INVALID.ENDED;
    if (!state.cfg.upgrades) return INVALID.UPGRADES_OFF;
    if (!inBounds(state.cfg, x, y)) return INVALID.OUT_OF_BOUNDS;
    var cell = state.grid[y][x];
    if (!cell || cell.k !== 'machine') return INVALID.NOT_BUILDING;
    if (cell.level >= MAX_LEVEL) return INVALID.MAX_LEVEL;
    if (state.gold < upgradeCost(state, cell)) return INVALID.NO_GOLD;
    return null;
  }

  // Cells where some building could legally be placed right now.
  function legalBuildCells(state) {
    var cells = [];
    if (state.terminal) return cells;
    for (var y = 0; y < state.cfg.board.rows; y++)
      for (var x = 0; x < state.cfg.board.cols; x++) {
        if (!state.grid[y][x] &&
            (!state.cfg.buildLimit || state.builds < state.cfg.buildLimit)) {
          cells.push({ x: x, y: y });
        }
      }
    return cells;
  }

  // Build palette with per-option affordability (drives UI and hints).
  function buildCatalog(state) {
    var out = [{ kind: 'belt', cost: beltCost(state), afford: state.gold >= beltCost(state) }];
    state.cfg.allowedRecipes.forEach(function (id) {
      var r = recipeById(state.cfg, id);
      if (r) out.push({ kind: 'machine', recipe: id, input: r.input, output: r.output,
                        cost: machineCost(state, r), afford: state.gold >= machineCost(state, r) });
    });
    return out;
  }

  // ---------- delivery ----------

  function deliver(state, item, x, y) {
    var value = state.cfg.goods[item.t] || 0;
    state.gold += value;
    state.score.goods += value;
    state.sold[item.t] = (state.sold[item.t] || 0) + 1;
    if (state.cfg.contracts[item.t] != null) {
      state.progress[item.t] = (state.progress[item.t] || 0) + 1;
      if (!state.contractDone[item.t] && state.progress[item.t] >= state.cfg.contracts[item.t]) {
        state.contractDone[item.t] = true;
        state.score.contractBonus += CONTRACT_BONUS;
        state.events.push({ type: 'contract-complete', item: item.t });
      }
    }
    state.events.push({ type: 'deliver', item: item.t, value: value, x: x, y: y });
  }

  // ---------- simulation tick ----------

  function stepSimulation(s) {
    var cfg = s.cfg;
    var x, y, cell;
    var claimed = {}; // "x,y" targets already committed this tick

    // Phase 1: machines push finished goods out through their facing.
    for (y = 0; y < cfg.board.rows; y++) for (x = 0; x < cfg.board.cols; x++) {
      cell = s.grid[y][x];
      if (!cell || cell.k !== 'machine' || !cell.outBuf) continue;
      var d = DIRS[cell.dir], tx = x + d[0], ty = y + d[1];
      if (!inBounds(cfg, tx, ty) || claimed[tx + ',' + ty]) continue;
      var tgt = s.grid[ty][tx];
      if (!tgt) continue;
      var item = cell.outBuf;
      if (tgt.k === 'sink') {
        cell.outBuf = null;
        deliver(s, item, tx, ty);
      } else if ((tgt.k === 'belt' || tgt.k === 'source') && !tgt.itemRef) {
        tgt.itemRef = item;
        cell.outBuf = null;
        claimed[tx + ',' + ty] = true;
      } else if (tgt.k === 'machine' && !tgt.inBuf) {
        tgt.inBuf = item;
        cell.outBuf = null;
        claimed[tx + ',' + ty] = true;
      }
    }

    // Phase 2: belt/source items advance one cell (chain resolution to a
    // fixpoint, scan order each pass → deterministic).
    var pending = [];
    for (y = 0; y < cfg.board.rows; y++) for (x = 0; x < cfg.board.cols; x++) {
      cell = s.grid[y][x];
      if (cell && (cell.k === 'belt' || cell.k === 'source') && cell.itemRef) {
        pending.push({ x: x, y: y });
      }
    }
    var progressMade = true;
    while (progressMade && pending.length) {
      progressMade = false;
      for (var i = pending.length - 1; i >= 0; i--) {
        var m = pending[i];
        cell = s.grid[m.y][m.x];
        if (!cell.itemRef) { pending.splice(i, 1); continue; }
        var dd = DIRS[cell.dir], nx = m.x + dd[0], ny = m.y + dd[1];
        if (!inBounds(cfg, nx, ny)) { // fell off the edge of the vale
          s.events.push({ type: 'spoil', item: cell.itemRef.t, x: m.x, y: m.y });
          cell.itemRef = null;
          pending.splice(i, 1);
          progressMade = true;
          continue;
        }
        if (claimed[nx + ',' + ny]) continue;
        var nt = s.grid[ny][nx];
        if (!nt) continue; // open meadow: items only ride belts
        var moved = false;
        if (nt.k === 'sink') {
          var it = cell.itemRef;
          cell.itemRef = null;
          deliver(s, it, nx, ny);
          moved = true;
        } else if ((nt.k === 'belt' || nt.k === 'source') && !nt.itemRef) {
          nt.itemRef = cell.itemRef;
          cell.itemRef = null;
          claimed[nx + ',' + ny] = true;
          moved = true;
        } else if (nt.k === 'machine' && !nt.inBuf) {
          nt.inBuf = cell.itemRef;
          cell.itemRef = null;
          claimed[nx + ',' + ny] = true;
          moved = true;
        }
        if (moved) { pending.splice(i, 1); progressMade = true; }
      }
    }

    // Phase 3: machines work on their input buffer.
    for (y = 0; y < cfg.board.rows; y++) for (x = 0; x < cfg.board.cols; x++) {
      cell = s.grid[y][x];
      if (!cell || cell.k !== 'machine' || !cell.inBuf || cell.outBuf) continue;
      var recipe = recipeById(cfg, cell.recipe);
      cell.prog++;
      if (cell.prog >= processTime(recipe, cell.level)) {
        var out = { id: s.nextId++, t: recipe.output };
        cell.outBuf = out;
        cell.inBuf = null;
        cell.prog = 0;
        s.events.push({ type: 'craft', recipe: recipe.id, item: recipe.output, x: x, y: y });
      }
    }

    // Phase 4: sources emit raw goods on their cadence.
    for (y = 0; y < cfg.board.rows; y++) for (x = 0; x < cfg.board.cols; x++) {
      cell = s.grid[y][x];
      if (!cell || cell.k !== 'source') continue;
      if ((s.tick - 1) % cell.every !== 0) continue;
      if (cell.itemRef || claimed[x + ',' + y]) continue;
      cell.itemRef = { id: s.nextId++, t: cell.item };
      s.events.push({ type: 'spawn', item: cell.item, x: x, y: y });
    }
  }

  // ---------- commands ----------

  function noteTime(s, cmd) {
    if (typeof cmd.atMs === 'number' && isFinite(cmd.atMs) && cmd.atMs >= 0) {
      s.elapsedMs = Math.floor(cmd.atMs / 100) * 100; // quantized, replay-safe
    }
  }

  function finalizeScore(s) {
    if (s.terminal && s.terminal.won) {
      s.score.goldLeft = s.gold;
      if (s.cfg.tickLimit && s.tick < s.cfg.tickLimit) {
        s.score.speedBonus = (s.cfg.tickLimit - s.tick) * SPEED_PT;
      }
    }
    s.score.total = s.score.goods + s.score.contractBonus + s.score.goldLeft + s.score.speedBonus;
  }

  function checkTerminal(s) {
    if (s.terminal) return;
    if (contractsComplete(s)) {
      s.terminal = { reason: TERMINAL.CONTRACTS, won: true };
      s.events.push({ type: 'win', reason: TERMINAL.CONTRACTS });
      finalizeScore(s);
      return;
    }
    if (s.cfg.tickLimit && s.tick >= s.cfg.tickLimit) {
      s.terminal = { reason: TERMINAL.TIME, won: false };
      s.events.push({ type: 'lose', reason: TERMINAL.TIME });
      finalizeScore(s);
    }
  }

  function applyCommand(state, cmd) {
    if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') {
      return { ok: false, reason: INVALID.BAD_SHAPE, state: state, events: [] };
    }
    var type = cmd.type;

    if (type === 'resign') {
      if (state.terminal) return { ok: false, reason: INVALID.ENDED, state: state, events: [] };
      var rs = clone(state);
      rs.tick++;
      noteTime(rs, cmd);
      rs.terminal = { reason: TERMINAL.RESIGN, won: false };
      rs.events = [{ type: 'lose', reason: TERMINAL.RESIGN }];
      finalizeScore(rs);
      return { ok: true, state: rs, events: rs.events };
    }

    if (type === 'tick') {
      if (state.terminal) return { ok: false, reason: INVALID.ENDED, state: state, events: [] };
      var ts = clone(state);
      ts.events = [];
      ts.tick++;
      noteTime(ts, cmd);
      stepSimulation(ts);
      checkTerminal(ts);
      return { ok: true, state: ts, events: ts.events };
    }

    if (type === 'place') {
      var reason = checkPlace(state, cmd.x, cmd.y, cmd.kind, cmd.recipe);
      if (reason) return { ok: false, reason: reason, state: state, events: [] };
      var ps = clone(state);
      ps.events = [];
      ps.tick++;
      noteTime(ps, cmd);
      var dir = DIRS[cmd.dir] ? cmd.dir : 'E';
      var cell;
      if (cmd.kind === 'belt') {
        cell = { k: 'belt', dir: dir, itemRef: null };
        ps.gold -= beltCost(ps);
      } else {
        var recipe = recipeById(ps.cfg, cmd.recipe);
        cell = { k: 'machine', recipe: cmd.recipe, dir: dir, level: 1,
                 prog: 0, inBuf: null, outBuf: null };
        ps.gold -= machineCost(ps, recipe);
      }
      ps.grid[cmd.y][cmd.x] = cell;
      ps.builds++;
      ps.events.push({ type: 'place', kind: cmd.kind, recipe: cmd.recipe || null,
                       x: cmd.x, y: cmd.y, dir: dir });
      checkTerminal(ps);
      return { ok: true, state: ps, events: ps.events };
    }

    if (type === 'rotate') {
      var rreason = checkRotate(state, cmd.x, cmd.y);
      if (rreason) return { ok: false, reason: rreason, state: state, events: [] };
      if (cmd.dir != null && !DIRS[cmd.dir]) return { ok: false, reason: INVALID.BAD_SHAPE, state: state, events: [] };
      var rots = clone(state);
      rots.events = [];
      rots.tick++;
      noteTime(rots, cmd);
      var rcell = rots.grid[cmd.y][cmd.x];
      if (cmd.dir) {
        rcell.dir = cmd.dir;
      } else {
        rcell.dir = DIR_ORDER[(DIR_ORDER.indexOf(rcell.dir) + 1) % 4];
      }
      rots.events.push({ type: 'rotate', x: cmd.x, y: cmd.y, dir: rcell.dir });
      checkTerminal(rots);
      return { ok: true, state: rots, events: rots.events };
    }

    if (type === 'remove') {
      var dreason = checkRemove(state, cmd.x, cmd.y);
      if (dreason) return { ok: false, reason: dreason, state: state, events: [] };
      var ds = clone(state);
      ds.events = [];
      ds.tick++;
      noteTime(ds, cmd);
      var dcell = ds.grid[cmd.y][cmd.x];
      var cost = dcell.k === 'belt' ? beltCost(ds) : machineCost(ds, recipeById(ds.cfg, dcell.recipe));
      ds.gold += Math.floor(cost * REFUND_RATIO);
      if (dcell.itemRef) ds.events.push({ type: 'spoil', item: dcell.itemRef.t, x: cmd.x, y: cmd.y });
      if (dcell.inBuf) ds.events.push({ type: 'spoil', item: dcell.inBuf.t, x: cmd.x, y: cmd.y });
      if (dcell.outBuf) ds.events.push({ type: 'spoil', item: dcell.outBuf.t, x: cmd.x, y: cmd.y });
      ds.grid[cmd.y][cmd.x] = null;
      ds.events.push({ type: 'remove', kind: dcell.k, x: cmd.x, y: cmd.y });
      checkTerminal(ds);
      return { ok: true, state: ds, events: ds.events };
    }

    if (type === 'upgrade') {
      var ureason = checkUpgrade(state, cmd.x, cmd.y);
      if (ureason) return { ok: false, reason: ureason, state: state, events: [] };
      var us = clone(state);
      us.events = [];
      us.tick++;
      noteTime(us, cmd);
      var ucell = us.grid[cmd.y][cmd.x];
      us.gold -= upgradeCost(us, ucell);
      ucell.level++;
      ucell.prog = 0;
      us.events.push({ type: 'upgrade', x: cmd.x, y: cmd.y, level: ucell.level });
      checkTerminal(us);
      return { ok: true, state: us, events: us.events };
    }

    return { ok: false, reason: INVALID.BAD_CMD, state: state, events: [] };
  }

  // Advance the simulation n ticks (helper for tests, replays, fast-forward).
  function simulate(state, ticks) {
    var s = state, events = [];
    for (var i = 0; i < ticks && !s.terminal; i++) {
      var res = applyCommand(s, { type: 'tick' });
      s = res.state;
      events = events.concat(res.events);
    }
    return { state: s, events: events };
  }

  // ---------- hints (same legality surface as play) ----------

  function hint(state) {
    if (state.terminal) return null;
    var cfg = state.cfg;
    var x, y, cell;

    // 1) a stalled machine (finished good with nowhere to go) → rotate or
    //    place a belt in front of it.
    for (y = 0; y < cfg.board.rows; y++) for (x = 0; x < cfg.board.cols; x++) {
      cell = state.grid[y][x];
      if (cell && cell.k === 'machine' && cell.outBuf) {
        var d = DIRS[cell.dir], tx = x + d[0], ty = y + d[1];
        if (inBounds(cfg, tx, ty)) {
          var tgt = state.grid[ty][tx];
          if (tgt && tgt.k !== 'sink' && tgt.k !== 'belt' && tgt.k !== 'machine') {
            return { cmd: { type: 'rotate', x: x, y: y }, why: 'stalled-machine' };
          }
          if (!tgt && !checkPlace(state, tx, ty, 'belt')) {
            return { cmd: { type: 'place', kind: 'belt', x: tx, y: ty, dir: cell.dir }, why: 'unblock-output' };
          }
        }
      }
    }

    // 2) a contract good with no matching machine → place one next to flow.
    for (var good in cfg.contracts) {
      if ((state.progress[good] || 0) >= cfg.contracts[good]) continue;
      var recipe = null;
      for (var i = 0; i < cfg.recipes.length; i++) {
        if (cfg.recipes[i].output === good && allowedRecipe(cfg, cfg.recipes[i].id)) { recipe = cfg.recipes[i]; break; }
      }
      if (!recipe) continue;
      var haveMachine = false;
      for (y = 0; y < cfg.board.rows && !haveMachine; y++)
        for (x = 0; x < cfg.board.cols && !haveMachine; x++) {
          cell = state.grid[y][x];
          if (cell && cell.k === 'machine' && cell.recipe === recipe.id) haveMachine = true;
        }
      if (!haveMachine) {
        var spot = bestMachineCell(state, recipe);
        if (spot) {
          return { cmd: { type: 'place', kind: 'machine', recipe: recipe.id,
                          x: spot.x, y: spot.y, dir: spot.dir }, why: 'need-' + good };
        }
      }
    }

    // 3) extend any open belt end one step toward the sink.
    for (y = 0; y < cfg.board.rows; y++) for (x = 0; x < cfg.board.cols; x++) {
      cell = state.grid[y][x];
      if (cell && cell.k === 'belt') {
        var bd = DIRS[cell.dir], bx = x + bd[0], by = y + bd[1];
        if (inBounds(cfg, bx, by) && !state.grid[by][bx] &&
            !checkPlace(state, bx, by, 'belt')) {
          return { cmd: { type: 'place', kind: 'belt', x: bx, y: by, dir: cell.dir }, why: 'extend-line' };
        }
      }
    }
    return null;
  }

  // Score empty cells for a machine: prefer cells adjacent to belts/sources
  // (input supply) whose facing side can be freed toward the sink.
  function bestMachineCell(state, recipe) {
    var cfg = state.cfg;
    var best = null, bestScore = -1;
    for (var y = 0; y < cfg.board.rows; y++) for (var x = 0; x < cfg.board.cols; x++) {
      if (checkPlace(state, x, y, 'machine', recipe.id)) continue;
      var score = 0, dir = 'E';
      for (var k = 0; k < DIR_ORDER.length; k++) {
        var d = DIRS[DIR_ORDER[k]];
        var nx = x + d[0], ny = y + d[1];
        if (!inBounds(cfg, nx, ny)) continue;
        var n = state.grid[ny][nx];
        if (n && (n.k === 'belt' || n.k === 'source')) {
          score += 2;
          if (n.k === 'belt' && ((n.dir === 'E' && d[0] === 1) || (n.dir === 'W' && d[0] === -1) ||
              (n.dir === 'S' && d[1] === 1) || (n.dir === 'N' && d[1] === -1))) {
            score += 3; // belt feeds this side
            dir = DIR_ORDER[(k + 2) % 4]; // face away from the feeder
          }
        }
        if (n && n.k === 'sink') score += 2;
        if (!n) score += 1;
      }
      // crude distance-to-sink tiebreak
      score -= (Math.abs(x - cfg.sink.x) + Math.abs(y - cfg.sink.y)) * 0.05;
      if (score > bestScore) { bestScore = score; best = { x: x, y: y, dir: dir }; }
    }
    return best;
  }

  // ---------- validation (network / replay boundary) ----------

  function validateCommandShape(cmd, maxLen) {
    if (!cmd || typeof cmd !== 'object') return INVALID.BAD_SHAPE;
    if (JSON.stringify(cmd).length > (maxLen || 512)) return INVALID.BAD_SHAPE;
    var ok = ['place', 'rotate', 'remove', 'upgrade', 'tick', 'resign'];
    if (ok.indexOf(cmd.type) < 0) return INVALID.BAD_CMD;
    if (cmd.id != null && (typeof cmd.id !== 'string' || cmd.id.length > 64)) return INVALID.BAD_SHAPE;
    if (cmd.type === 'place') {
      if (cmd.kind !== 'belt' && cmd.kind !== 'machine') return INVALID.BAD_SHAPE;
      if (!Number.isInteger(cmd.x) || !Number.isInteger(cmd.y)) return INVALID.BAD_SHAPE;
      if (cmd.kind === 'machine' && typeof cmd.recipe !== 'string') return INVALID.BAD_SHAPE;
    }
    if (cmd.type === 'rotate' || cmd.type === 'remove' || cmd.type === 'upgrade') {
      if (!Number.isInteger(cmd.x) || !Number.isInteger(cmd.y)) return INVALID.BAD_SHAPE;
      if (cmd.type === 'rotate' && cmd.dir != null && !DIRS[cmd.dir]) return INVALID.BAD_SHAPE;
    }
    return null;
  }

  // ---------- serialization ----------

  function serialize(state) { return JSON.stringify(state); }
  function deserialize(json) {
    var s = JSON.parse(json);
    if (s.v !== STATE_VERSION) throw new Error('unsupported state version ' + s.v);
    return s;
  }

  return {
    STATE_VERSION: STATE_VERSION,
    TERMINAL: TERMINAL,
    INVALID: INVALID,
    DIRS: DIRS,
    MAX_LEVEL: MAX_LEVEL,
    CONTRACT_BONUS: CONTRACT_BONUS,
    createGame: createGame,
    applyCommand: applyCommand,
    simulate: simulate,
    checkPlace: checkPlace,
    checkRotate: checkRotate,
    checkRemove: checkRemove,
    checkUpgrade: checkUpgrade,
    legalBuildCells: legalBuildCells,
    buildCatalog: buildCatalog,
    contractsComplete: contractsComplete,
    processTime: processTime,
    beltCost: beltCost,
    machineCost: machineCost,
    upgradeCost: upgradeCost,
    recipeById: recipeById,
    cellAt: cellAt,
    inBounds: inBounds,
    hint: hint,
    hashState: hashState,
    stableStringify: stableStringify,
    serialize: serialize,
    deserialize: deserialize,
    clone: clone,
    validateCommandShape: validateCommandShape
  };
});
