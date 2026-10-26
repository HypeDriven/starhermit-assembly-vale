// The save document (js/store.js): the engine save's data, the browser
// build's cloud save (the wrapped {sum, payload} text of game:<slug>, shown
// to the engine as a foreign save) migrating into it, conflict merges, and
// recording finished rounds. The signed-in paths themselves (foreign save,
// legacy settings, score posting) cannot run here; native/save.ts only wires
// these functions to starhermit:storage. Run: node --test tests/progress.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const S = req('../js/store.js');
const Rules = req('../js/rules.js');
const Content = req('../js/content.js');

test('fresh documents and engine save data round-trip', () => {
  const d = S.fresh();
  d.progress.journeyBest.j01 = 400;
  const data = S.toData(d);
  assert.deepEqual(Object.keys(data), ['v', 'progress']);
  const back = S.fromData(JSON.parse(JSON.stringify(data)));
  assert.equal(back.progress.journeyBest.j01, 400);
  assert.equal(back.progress.stats.rounds, 0);
  assert.equal(S.fromData(null).progress.scoreChaseBest, 0);
  assert.equal(S.fromData({ v: 99, progress: { scoreChaseBest: 5 } }).progress.scoreChaseBest, 0, 'a future format is not adopted');
  assert.deepEqual(S.fromData({ v: 1, progress: { journeyStars: 'junk' } }).progress.journeyStars, {});
});

test('the browser build\'s cloud save (wrapped text) migrates; a corrupt one does not', () => {
  const old = S.fresh();
  old.progress.journeyStars = { j01: 3, j02: 1 };
  old.progress.tutorialDone = { belts: true };
  old.progress.stats.rounds = 12;
  old.settings.muted = true;
  const text = S.wrap(old);
  assert.equal(JSON.parse(text).sum, S.checksum(JSON.parse(text).payload));
  const local = S.fresh();
  local.progress.journeyStars = { j01: 1 };
  local.progress.stats.rounds = 2;
  const merged = S.mergeDocs(S.loadRaw(text), local);
  assert.deepEqual(merged.progress.journeyStars, { j01: 3, j02: 1 });
  assert.equal(merged.progress.tutorialDone.belts, true);
  assert.equal(merged.progress.stats.rounds, 12);
  assert.equal(S.loadRaw(text.replace('\\"rounds\\":12', '\\"rounds\\":99')), null, 'checksum mismatch');
  assert.equal(S.loadRaw('not json'), null);
  assert.equal(S.mergeDocs(S.loadRaw(null), local).progress.stats.rounds, 2, 'no foreign text keeps the device save');
});

test('conflicts merge to the better records', () => {
  const mine = S.fresh(); mine.progress.journeyStars = { j01: 3 }; mine.progress.stats.rounds = 4; mine.progress.stats.lastDaily = '2026-10-01';
  mine.progress.achievements = { a: 200 };
  const theirs = S.fresh(); theirs.progress.journeyStars = { j01: 1, j02: 2 }; theirs.progress.scoreChaseBest = 900;
  theirs.progress.stats.rounds = 7; theirs.progress.stats.lastDaily = '2026-10-15'; theirs.progress.achievements = { a: 100, b: 300 };
  const m = S.mergeDocs(theirs, mine);
  assert.deepEqual(m.progress.journeyStars, { j01: 3, j02: 2 });
  assert.equal(m.progress.scoreChaseBest, 900);
  assert.equal(m.progress.stats.rounds, 7);
  assert.equal(m.progress.stats.lastDaily, '2026-10-15');
  assert.deepEqual(m.progress.achievements, { a: 100, b: 300 });
});

function playFirstFord() {
  const cfg = Content.journeyCfg(0);
  let s = Rules.createGame(cfg);
  for (const [x, y, dir] of [[1, 0, 'E'], [2, 0, 'E'], [3, 0, 'E'], [4, 0, 'S'], [4, 1, 'E'], [5, 1, 'S']]) {
    const r = Rules.applyCommand(s, { type: 'place', x, y, kind: 'belt', dir, atMs: 0 });
    assert.ok(r.ok, r.reason);
    s = r.state;
  }
  while (!s.terminal) s = Rules.applyCommand(s, { type: 'tick', atMs: 0 }).state;
  return s;
}

test('a finished Journey round records stats, best and stars', () => {
  const s = playFirstFord();
  assert.equal(s.terminal.won, true);
  assert.equal(s.score.total, 400);
  const prog = S.fresh().progress;
  S.recordResult(prog, s, 'journey', '2026-10-26');
  assert.equal(prog.stats.rounds, 1);
  assert.equal(prog.stats.wins, 1);
  assert.equal(prog.stats.bestScore, 400);
  assert.equal(prog.journeyBest.j01, 400);
  assert.equal(prog.journeyStars.j01, S.starsFor(s));
  assert.equal(prog.stats.buildingsPlaced, 6);
  S.recordResult(prog, s, 'daily', '2026-10-26');
  assert.equal(prog.dailiesDone['2026-10-26'], 400);
  assert.equal(prog.stats.lastDaily, '2026-10-26');
  S.recordResult(prog, s, 'score-chase', '');
  assert.equal(prog.scoreChaseBest, 400);
});
