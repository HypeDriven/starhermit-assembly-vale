/**
 * Assembly Vale — rules engine checks (dev only, not shipped).
 * Pure, deterministic: no browser, no network. Run: npm run test:rules
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const Rules = require(path.join(ROOT, 'js/rules.js'));
const Content = require(path.join(ROOT, 'js/content.js'));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const apply = (s, cmd) => {
  const res = Rules.applyCommand(s, cmd);
  assert.equal(res.ok, true, `command ${cmd.type} rejected: ${res.reason}`);
  return res.state;
};

test('every journey, challenge and practice stage validates', () => {
  const defs = [...Content.JOURNEY, ...Content.CHALLENGES, ...Object.values(Content.PRACTICE).map((p, i) => ({ id: 'practice-' + i, ...p })), Content.SCORE_CHASE];
  for (const def of defs) {
    assert.deepEqual(Content.validateStage(def), [], `stage ${def.id || def.name} failed validation`);
  }
});

test('every stage config builds a game with an in-bounds sink and sources', () => {
  const cfgs = [
    ...Content.JOURNEY.map((_, i) => Content.journeyCfg(i)),
    ...Content.LESSONS.map((_, i) => Content.lessonCfg(i)),
    ...Content.CHALLENGES.map((c) => Content.challengeCfg(c.id)),
    ...['relaxed', 'standard', 'veteran'].map((d) => Content.practiceCfg(d, null)),
    Content.scoreChaseCfg(null),
    Content.dailyConfig('2026-09-07'),
  ];
  for (const cfg of cfgs) {
    const s = Rules.createGame(cfg);
    assert.ok(Rules.inBounds(cfg, cfg.sink.x, cfg.sink.y));
    assert.ok(cfg.sources.length > 0, `${cfg.id} has no source`);
    assert.equal(s.grid[cfg.sink.y][cfg.sink.x].k, 'sink');
  }
});

test('challenge and practice configs carry their identifiers', () => {
  assert.equal(Content.challengeCfg('shoestring').challengeId, 'shoestring');
  assert.equal(Content.practiceCfg('relaxed', null).practiceDifficulty, 'relaxed');
  assert.equal(Content.practiceCfg('nonsense', null).practiceDifficulty, 'standard');
});

test('the daily config is stable for a given UTC date', () => {
  const a = Content.dailyConfig('2026-09-07');
  const b = Content.dailyConfig('2026-09-07');
  assert.equal(Rules.stableStringify(a), Rules.stableStringify(b));
});

test('a belt line from the mine to the Exchange wins journey stage 1', () => {
  let s = Rules.createGame(Content.journeyCfg(0));
  for (const [x, y, dir] of [[1, 0, 'E'], [2, 0, 'E'], [3, 0, 'E'], [4, 0, 'S'], [4, 1, 'E'], [5, 1, 'S']]) {
    s = apply(s, { type: 'place', x, y, kind: 'belt', dir });
  }
  assert.equal(s.gold, 24, 'six belts cost 36 gold');
  assert.equal(s.tick, 6, 'each build costs a tick');
  const run = Rules.simulate(s, 80);
  s = run.state;
  assert.ok(s.terminal && s.terminal.won, 'the round should be won');
  assert.equal(s.terminal.reason, Rules.TERMINAL.CONTRACTS);
  assert.equal(s.progress.ore, 5);
  assert.ok(s.score.total > 0);
});

test('illegal commands are refused without changing the state', () => {
  const s = Rules.createGame(Content.journeyCfg(0));
  const before = Rules.hashState(s);
  for (const [cmd, reason] of [
    [{ type: 'place', x: 2, y: 1, kind: 'belt' }, Rules.INVALID.BLOCKED],       // rock
    [{ type: 'place', x: 0, y: 0, kind: 'belt' }, Rules.INVALID.OCCUPIED],      // source
    [{ type: 'place', x: 99, y: 0, kind: 'belt' }, Rules.INVALID.OUT_OF_BOUNDS],
    [{ type: 'place', x: 1, y: 0, kind: 'machine', recipe: 'smelt' }, Rules.INVALID.RECIPE_LOCKED],
    [{ type: 'rotate', x: 3, y: 3 }, Rules.INVALID.NOT_BUILDING],
    [{ type: 'upgrade', x: 3, y: 3 }, Rules.INVALID.UPGRADES_OFF],
    [{ type: 'nope' }, Rules.INVALID.BAD_CMD],
  ]) {
    const res = Rules.applyCommand(s, cmd);
    assert.equal(res.ok, false, `expected ${JSON.stringify(cmd)} to be refused`);
    assert.equal(res.reason, reason);
  }
  assert.equal(Rules.hashState(s), before, 'a refused command must not mutate the state');
});

test('a machine refines goods, upgrades speed it up, removal refunds half', () => {
  const cfg = Content.journeyCfg(12); // Tune-Up: smelter allowed, upgrades on
  let s = Rules.createGame(cfg);
  const goldBefore = s.gold;
  s = apply(s, { type: 'place', x: 1, y: 0, kind: 'machine', recipe: 'smelt', dir: 'E' });
  const cost = Rules.machineCost(s, Rules.recipeById(cfg, 'smelt'));
  assert.equal(s.gold, goldBefore - cost);
  assert.equal(Rules.processTime(Rules.recipeById(cfg, 'smelt'), 1), 4);
  s = apply(s, { type: 'upgrade', x: 1, y: 0 });
  assert.equal(s.grid[0][1].level, 2);
  assert.equal(Rules.processTime(Rules.recipeById(cfg, 'smelt'), 2), 3);
  const goldBeforeRemove = s.gold;
  s = apply(s, { type: 'remove', x: 1, y: 0 });
  assert.equal(s.gold, goldBeforeRemove + Math.floor(cost / 2));
  assert.equal(s.grid[0][1], null);
});

test('the tick limit ends the round as a loss', () => {
  const cfg = Content.journeyCfg(0);
  const s = Rules.simulate(Rules.createGame(cfg), cfg.tickLimit + 5).state;
  assert.equal(s.terminal.reason, Rules.TERMINAL.TIME);
  assert.equal(s.terminal.won, false);
  assert.equal(s.tick, cfg.tickLimit);
});

test('identical command sequences produce identical state hashes', () => {
  const play = () => {
    let s = Rules.createGame(Content.dailyConfig('2026-09-07'));
    s = apply(s, { type: 'place', x: 1, y: 0, kind: 'belt', dir: 'E' });
    return Rules.hashState(Rules.simulate(s, 40).state);
  };
  assert.equal(play(), play());
});

test('serialization round-trips', () => {
  const s = Rules.simulate(Rules.createGame(Content.journeyCfg(4)), 10).state;
  assert.equal(Rules.hashState(Rules.deserialize(Rules.serialize(s))), Rules.hashState(s));
});

console.log(`\nRULES PASS — ${passed} checks`);
