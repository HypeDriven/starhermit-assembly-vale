// The graphics look model (js/gfx.js): one look per runtime quality tier,
// budgets that grow from Low to Ultra and within a tier by the level's speed,
// reduced motion. Run: node --test tests/gfx.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const Gfx = createRequire(import.meta.url)('../js/gfx.js');

test('every runtime tier has a look; an unknown tier is Balanced', () => {
  for (const p of ['low', 'balanced', 'high', 'ultra']) {
    const r = Gfx.resolve(p, {});
    assert.equal(r.preset, p);
    for (const cat of Gfx.CATEGORY_ORDER) assert.ok(Gfx.CATEGORIES[cat].includes(r[cat]), `${p} ${cat}`);
  }
  assert.equal(Gfx.resolve('bogus', {}).preset, 'balanced');
  const low = Gfx.resolve('low', {});
  assert.equal(low.detail, 'plain');
  assert.equal(low.shadows, 'off');
  assert.equal(low.post, false);
  assert.equal(Gfx.resolve('ultra', {}).post, true);
});

test('budgets grow from Low to Ultra and scale within a tier (at most twice)', () => {
  const order = ['low', 'balanced', 'high', 'ultra'];
  for (let i = 1; i < order.length; i++) {
    const a = Gfx.budget(order[i - 1], 1), b = Gfx.budget(order[i], 1);
    for (const k of ['particles', 'tufts', 'glows']) assert.ok(b[k] >= a[k], `${order[i]} ${k}`);
  }
  assert.equal(Gfx.budget('high', 1).particles, 320);
  assert.equal(Gfx.budget('high', 1.5).particles, 480);
  assert.equal(Gfx.budget('high', 9).particles, 640);
  assert.equal(Gfx.budget('high', 0.2).particles, 320);
  assert.ok(Gfx.budget('ultra', 2).particles <= Gfx.MAX_PARTICLES);
});

test('reduced motion turns animation and particles off', () => {
  const r = Gfx.resolve('ultra', { reducedMotion: true });
  assert.equal(r.animation, 'static');
  assert.equal(r.particles, 'off');
  assert.equal(r.bloom, 'on');
});
