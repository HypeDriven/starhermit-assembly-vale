/* Assembly Vale — graphics quality model: presets, per-category overrides,
 * GPU detection and a cost summary. Pure (no DOM, no canvas), so the board
 * renderer, the Graphics panel and the unit tests agree on what a setting
 * means. UMD: window.AVGfx in the browser, module.exports in Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AVGfx = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PRESETS = ['low', 'balanced', 'high', 'ultra'];

  // Category -> allowed tiers, cheapest first. Only effects the 2D board has.
  var CATEGORIES = {
    shadows: ['off', 'low', 'medium', 'high'],   // drop shadows under pieces
    detail: ['plain', 'detailed'],               // textured ground, bevels, rollers, shaded goods
    bloom: ['off', 'on'],                        // glow on emissive parts (furnace windows, Exchange, sparks)
    grade: ['off', 'on'],                        // sunlight wash, saturation lift, vignette
    particles: ['off', 'low', 'high'],           // sale coins, craft steam, mine dust, spoil splats
    animation: ['static', 'animated']            // goods glide, belt rollers, water shimmer, cloud shadows
  };
  var CATEGORY_ORDER = ['shadows', 'detail', 'bloom', 'grade', 'particles', 'animation'];

  // Each preset is a row of tiers plus a render scale (multiplies the device
  // pixel ratio, itself capped by the preset budget's maxDpr). Low is the
  // original flat look with goods gliding and rollers turning.
  var TABLE = {
    low:      { scale: 0.85, shadows: 'off',    detail: 'plain',    bloom: 'off', grade: 'off', particles: 'off',  animation: 'animated' },
    balanced: { scale: 1,    shadows: 'low',    detail: 'detailed', bloom: 'off', grade: 'on',  particles: 'low',  animation: 'animated' },
    high:     { scale: 1,    shadows: 'medium', detail: 'detailed', bloom: 'on',  grade: 'on',  particles: 'high', animation: 'animated' },
    ultra:    { scale: 1.25, shadows: 'high',   detail: 'detailed', bloom: 'on',  grade: 'on',  particles: 'high', animation: 'animated' }
  };

  var SCALE_MIN = 0.5, SCALE_MAX = 2;

  // StarHermit hardware level (0–20, gpu-level.js) at which Auto starts choosing each preset.
  var LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };

  // Per-preset budgets, each tuned to hold 60 FPS on the weakest device Auto gives that preset
  // (Low: level 0 phones / Intel UHD; Balanced: level 4 Iris Xe; High: level 10 GTX 1070;
  // Ultra: level 17 RTX 4080). Only visuals change; the simulation is identical.
  //   maxDpr     — device-pixel-ratio cap for the board's backing store
  //   tufts      — grass tufts per tile baked into the cached terrain layer (Surface detail: Detailed)
  //   flowers    — chance of a flower speck per tile in that layer
  //   particles  — live particle cap (sale coins, steam, dust, confetti), scaled by hardware level
  //   burst      — particles per event × this (before the Particles tier's ½ for Low)
  //   clouds     — drifting cloud shadows when Colour grade and animation are on
  //   glows      — additive glow sprites drawn per frame (Bloom)
  var BUDGETS = {
    low:      { maxDpr: 1,   tufts: 0,  flowers: 0,    particles: 48,  burst: 0.5,  clouds: 0, glows: 0 },
    balanced: { maxDpr: 1.5, tufts: 5,  flowers: 0.25, particles: 120, burst: 0.75, clouds: 2, glows: 24 },
    high:     { maxDpr: 2,   tufts: 9,  flowers: 0.35, particles: 320, burst: 1,    clouds: 3, glows: 64 },
    ultra:    { maxDpr: 2,   tufts: 16, flowers: 0.6,  particles: 640, burst: 1.5,  clouds: 4, glows: 160 }
  };

  function gpuApi() {
    if (typeof StarHermitGpu !== 'undefined') return StarHermitGpu;
    if (typeof require === 'function') { try { return require('../gpu-level.js'); } catch (e) { /* not bundled */ } }
    return null;
  }

  /** Hardware level 0–20 for a renderer string (system: optional detectSystem() fields, e.g. mobile). */
  function detectLevel(gpu, system) {
    var G = gpuApi();
    if (!G) return 0;
    return G.detectLevel(Object.assign({ webgl: true, webgl2: true }, system || {}, { gpu: String(gpu || '') }));
  }

  /** Auto preset for a hardware level: Low 0, Balanced 4, High 10, Ultra 17. */
  function presetForLevel(level) {
    var G = gpuApi();
    if (G) return G.presetForLevel(level, LEVELS);
    return PRESETS.filter(function (p) { return LEVELS[p] <= level; }).pop() || 'low';
  }

  /** Best preset for this GPU (hardware level → preset). */
  function detectPreset(gpu, system) {
    return presetForLevel(detectLevel(gpu, system));
  }

  /** The preset's budget; particle cap and burst size scale with the level within the preset. */
  function budget(preset, level) {
    var b = BUDGETS[preset] || BUDGETS.balanced;
    var G = gpuApi(), floor = LEVELS[preset] || 0;
    var lv = isFinite(level) && level != null ? level : floor;
    var k = G ? G.scaleBudget(1, lv, floor) : 1;
    return Object.assign({}, b, { particles: Math.max(8, Math.round(b.particles * k)), burst: Math.round(b.burst * Math.min(2, k) * 100) / 100 });
  }

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  function clampScale(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return 1;
    return clamp(n, SCALE_MIN, SCALE_MAX);
  }

  /**
   * Resolve saved settings into concrete tiers.
   * saved: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }
   * env:   { reducedMotion, level } — level: hardware level for the budget; reduced motion forces animation static and particles off.
   */
  function resolve(saved, detected, env) {
    var s = saved || {};
    var auto = PRESETS.indexOf(s.preset) < 0;
    var preset = auto ? (PRESETS.indexOf(detected) >= 0 ? detected : 'balanced') : s.preset;
    var row = TABLE[preset];
    var out = { preset: preset, auto: auto, renderScale: clampScale(s.render_scale), overrides: {} };
    out.scale = row.scale * out.renderScale;
    for (var i = 0; i < CATEGORY_ORDER.length; i++) {
      var cat = CATEGORY_ORDER[i];
      var ok = CATEGORIES[cat].indexOf(s[cat]) >= 0;
      out[cat] = ok ? s[cat] : row[cat];
      if (ok) out.overrides[cat] = true;
    }
    out.budget = budget(preset, env && env.level);
    out.adaptive = s.adaptive !== false;
    out.showFps = !!s.show_fps;
    out.reducedMotion = !!(env && env.reducedMotion);
    if (out.reducedMotion) { out.animation = 'static'; out.particles = 'off'; }
    // Overlay passes drawn after the pieces (the 2D analogue of a post chain).
    out.post = out.bloom === 'on' || out.grade === 'on';
    // A frame loop runs only when something moves; otherwise the board is
    // redrawn on change, exactly like the original renderer.
    out.loop = out.animation === 'animated' || out.particles !== 'off' || out.showFps;
    return out;
  }

  /** The preset's own tier for a category (for "From preset (…)" labels). */
  function presetTier(preset, cat) {
    var row = TABLE[preset];
    return row ? row[cat] : undefined;
  }

  /** New saved settings after choosing a preset: category overrides are cleared. */
  function choosePreset(saved, preset) {
    var s = saved || {};
    var out = {
      preset: (preset === 'auto' || PRESETS.indexOf(preset) >= 0) ? preset : 'auto',
      render_scale: clampScale(s.render_scale),
      adaptive: s.adaptive !== false,
      show_fps: !!s.show_fps
    };
    return out;
  }

  /** New saved settings with one category override ('preset' removes it). */
  function setOverride(saved, cat, tier) {
    var out = Object.assign({}, saved || {});
    if (!CATEGORIES[cat]) return out;
    if (CATEGORIES[cat].indexOf(tier) >= 0) out[cat] = tier;
    else delete out[cat];
    return out;
  }

  /** Relative per-frame cost, 1 = the flat Low renderer at the same resolution. */
  function cost(r) {
    var c = 1;
    c += { off: 0, low: 0.15, medium: 0.4, high: 0.7 }[r.shadows] || 0;
    if (r.detail === 'detailed') c += 0.25;
    if (r.bloom === 'on') c += 0.3;
    if (r.grade === 'on') c += 0.15;
    c += { off: 0, low: 0.1, high: 0.25 }[r.particles] || 0;
    return Math.round(c * 10) / 10;
  }

  /** Short cost summary (English fallback; the panel localizes its own labels). */
  function describe(r, pixels) {
    var parts = [
      r.shadows === 'off' ? 'no shadows' : r.shadows + ' shadows',
      r.detail === 'detailed' ? 'detailed' : 'plain',
      r.bloom === 'on' ? 'bloom' : null,
      r.grade === 'on' ? 'grade' : null,
      r.particles === 'off' ? null : r.particles + ' particles',
      r.loop ? 'animated' : 'redraw on change',
      'cost ×' + cost(r),
      pixels ? pixels[0] + '×' + pixels[1] + ' px' : null
    ];
    return parts.filter(Boolean).join(' · ');
  }

  // Adaptive resolution: average ~90 frames, step down 0.1 when slow
  // (> 26 ms, min 0.6), back up 0.05 when fast (< 14 ms, max 1).
  function adaptStep(scale, avgMs) {
    if (avgMs > 26) return Math.max(0.6, Math.round((scale - 0.1) * 100) / 100);
    if (avgMs < 14) return Math.min(1, Math.round((scale + 0.05) * 100) / 100);
    return scale;
  }

  return {
    PRESETS: PRESETS,
    CATEGORIES: CATEGORIES,
    CATEGORY_ORDER: CATEGORY_ORDER,
    TABLE: TABLE,
    LEVELS: LEVELS,
    BUDGETS: BUDGETS,
    detectLevel: detectLevel,
    presetForLevel: presetForLevel,
    budget: budget,
    SCALE_MIN: SCALE_MIN,
    SCALE_MAX: SCALE_MAX,
    detectPreset: detectPreset,
    resolve: resolve,
    presetTier: presetTier,
    choosePreset: choosePreset,
    setOverride: setOverride,
    clampScale: clampScale,
    cost: cost,
    describe: describe,
    adaptStep: adaptStep
  };
});
