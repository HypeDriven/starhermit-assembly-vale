/**
 * Assembly Vale — graphics quality model + locale table checks (node --test).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const Gfx = require(path.join(ROOT, 'js/gfx.js'));
const I18n = require(path.join(ROOT, 'js/i18n.js'));

test('hardware level picks the Auto preset (StarHermit gpu-level.js)', () => {
  assert.equal(Gfx.detectPreset('Google SwiftShader'), 'low');
  assert.equal(Gfx.detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(Gfx.detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(Gfx.detectPreset('Software (no WebGL)'), 'low');
  assert.equal(Gfx.detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'low');
  assert.equal(Gfx.detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'low');
  assert.equal(Gfx.detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)'), 'balanced');
  assert.equal(Gfx.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(Gfx.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)'), 'ultra');
  assert.equal(Gfx.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)'), 'ultra');
  assert.equal(Gfx.detectLevel('NVIDIA GeForce RTX 5090'), 20);
  assert.equal(Gfx.detectPreset('Adreno (TM) 740', { mobile: true }), 'balanced', 'phones: Balanced at most');
  assert.equal(Gfx.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090)', { mobile: true }), 'balanced');
  for (const [p, lv] of Object.entries(Gfx.LEVELS)) assert.equal(Gfx.presetForLevel(lv), p);
  assert.equal(Gfx.presetForLevel(9), 'balanced');
  assert.equal(Gfx.presetForLevel(16), 'high');
});

test('per-preset budgets are explicit, grow from Low to Ultra and scale with the level', () => {
  const keys = ['maxDpr', 'tufts', 'flowers', 'particles', 'burst', 'clouds', 'glows'];
  for (const p of Gfx.PRESETS) for (const k of keys) assert.ok(k in Gfx.BUDGETS[p], `${p}.${k}`);
  for (let i = 1; i < Gfx.PRESETS.length; i++) {
    const a = Gfx.BUDGETS[Gfx.PRESETS[i - 1]], b = Gfx.BUDGETS[Gfx.PRESETS[i]];
    for (const k of keys) assert.ok(b[k] >= a[k], `${Gfx.PRESETS[i]}.${k}`);
  }
  assert.equal(Gfx.BUDGETS.low.maxDpr, 1);
  assert.deepEqual(Gfx.budget('high', 10), Gfx.BUDGETS.high);
  assert.ok(Gfx.budget('high', 14).particles > Gfx.BUDGETS.high.particles);
  assert.ok(Gfx.budget('ultra', 20).particles <= Gfx.BUDGETS.ultra.particles * 4);
  assert.ok(Gfx.budget('ultra', 2).particles < Gfx.BUDGETS.ultra.particles);
  assert.ok(Gfx.budget('ultra', 20).burst <= Gfx.BUDGETS.ultra.burst * 2);
  assert.deepEqual(Gfx.resolve({ preset: 'low' }, 'low', { level: 0 }).budget, Gfx.BUDGETS.low);
});

test('resolve uses the detected preset for Auto and an explicit preset otherwise', () => {
  const auto = Gfx.resolve({}, 'low');
  assert.equal(auto.preset, 'low'); assert.equal(auto.auto, true);
  assert.equal(auto.shadows, 'off'); assert.equal(auto.animation, 'animated', 'Low still glides goods'); assert.equal(auto.particles, 'off');
  assert.equal(auto.post, false);
  const high = Gfx.resolve({ preset: 'high' }, 'low');
  assert.equal(high.auto, false);
  assert.equal(high.shadows, 'medium'); assert.equal(high.bloom, 'on'); assert.equal(high.post, true);
  assert.equal(Gfx.resolve({ preset: 'bogus' }, 'nope').preset, 'balanced');
});

test('resolve applies overrides, ignores invalid tiers and clamps render scale', () => {
  const r = Gfx.resolve({ preset: 'low', shadows: 'high', bloom: 'sparkly', render_scale: 9 }, 'low');
  assert.equal(r.shadows, 'high'); assert.equal(r.bloom, 'off');
  assert.deepEqual(r.overrides, { shadows: true });
  assert.equal(r.renderScale, 2);
  assert.equal(r.scale, Gfx.TABLE.low.scale * 2);
  assert.equal(Gfx.resolve({ render_scale: 0.1 }, 'high').renderScale, 0.5);
  assert.equal(Gfx.resolve({ render_scale: 'x' }, 'high').renderScale, 1);
  assert.equal(Gfx.resolve({}, 'high').adaptive, true);
  assert.equal(Gfx.resolve({ adaptive: false, show_fps: true }, 'high').showFps, true);
});

test('reduced motion turns animation and particles off', () => {
  const r = Gfx.resolve({ preset: 'ultra' }, 'low', { reducedMotion: true });
  assert.equal(r.animation, 'static'); assert.equal(r.particles, 'off');
  assert.equal(r.bloom, 'on');
});

test('choosing a preset clears overrides but keeps scale, adaptive and fps', () => {
  let s = Gfx.setOverride({ preset: 'high' }, 'shadows', 'off');
  s = Gfx.setOverride(s, 'particles', 'low');
  s.render_scale = 1.5; s.show_fps = true;
  assert.equal(Gfx.resolve(s, 'low').shadows, 'off');
  const next = Gfx.choosePreset(s, 'ultra');
  assert.deepEqual(next, { preset: 'ultra', render_scale: 1.5, adaptive: true, show_fps: true });
  assert.equal(Gfx.resolve(next, 'low').shadows, 'high');
  assert.equal(Gfx.setOverride({ shadows: 'off' }, 'shadows', 'preset').shadows, undefined);
});

test('presetTier, describe and adaptive steps', () => {
  assert.equal(Gfx.presetTier('balanced', 'shadows'), 'low');
  assert.equal(Gfx.presetTier('nope', 'shadows'), undefined);
  const d = Gfx.describe(Gfx.resolve({ preset: 'high' }, 'low'), [800, 600]);
  assert.match(d, /bloom/); assert.match(d, /800×600 px/);
  assert.ok(Gfx.cost(Gfx.resolve({ preset: 'ultra' })) > Gfx.cost(Gfx.resolve({ preset: 'low' })));
  assert.equal(Gfx.adaptStep(1, 30), 0.9);
  assert.equal(Gfx.adaptStep(0.6, 40), 0.6);
  assert.equal(Gfx.adaptStep(0.9, 10), 0.95);
  assert.equal(Gfx.adaptStep(1, 10), 1);
  assert.equal(Gfx.adaptStep(0.8, 20), 0.8);
});

test('every locale has every graphics string', () => {
  const keys = Object.keys(I18n.STRINGS['en-GB']);
  for (const loc of ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT']) {
    const table = I18n.STRINGS[loc];
    assert.ok(table, loc);
    for (const k of keys) assert.ok(typeof table[k] === 'string' && table[k].length, `${loc} missing ${k}`);
  }
  assert.equal(I18n.pick(['fr-CA']), 'fr-CA');
  assert.equal(I18n.pick(['es-MX']), 'es-419');
  assert.equal(I18n.pick(['de']), 'de-DE');
  assert.equal(I18n.pick(['ja-JP']), 'en-US');
  assert.equal(I18n.make('de-DE')('gfx.auto', { tier: 'Niedrig' }), 'Automatisch (erkannt: Niedrig)');
});
