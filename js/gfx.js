/* Assembly Vale — graphics look model: what each of the runtime's quality
 * tiers draws on the board. Pure (no canvas), so the board renderer
 * (native/board.ts) and the unit tests agree on what a tier means. The
 * runtime's Options own the rest of what the browser build's Graphics panel
 * did: Auto and the level, render scale, adaptive resolution, the frame-rate
 * limit and the FPS readout. UMD: globalThis.AVGfx (loadClassic) and Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AVGfx = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PRESETS = ['low', 'balanced', 'high', 'ultra'];

  // Category -> tiers, cheapest first. Only effects the 2D board has.
  var CATEGORIES = {
    shadows: ['off', 'low', 'medium', 'high'],   // drop shadows under pieces
    detail: ['plain', 'detailed'],               // textured ground, bevels, rollers, shaded goods
    bloom: ['off', 'on'],                        // glow on emissive parts (furnace windows, Exchange, sparks)
    grade: ['off', 'on'],                        // sunlight wash, vignette, cloud shadows
    particles: ['off', 'low', 'high'],           // sale coins, craft steam, mine dust, spoil splats
    animation: ['static', 'animated']            // goods glide, belt rollers, water shimmer, cloud shadows
  };
  var CATEGORY_ORDER = ['shadows', 'detail', 'bloom', 'grade', 'particles', 'animation'];

  // The browser build's four presets, one per runtime quality tier. Low is the
  // original flat look with goods gliding and rollers turning.
  var TABLE = {
    low:      { shadows: 'off',    detail: 'plain',    bloom: 'off', grade: 'off', particles: 'off',  animation: 'animated' },
    balanced: { shadows: 'low',    detail: 'detailed', bloom: 'off', grade: 'on',  particles: 'low',  animation: 'animated' },
    high:     { shadows: 'medium', detail: 'detailed', bloom: 'on',  grade: 'on',  particles: 'high', animation: 'animated' },
    ultra:    { shadows: 'high',   detail: 'detailed', bloom: 'on',  grade: 'on',  particles: 'high', animation: 'animated' }
  };

  // Per-preset budgets, each tuned to hold 60 FPS on the weakest device given
  // that tier. Only visuals change; the simulation is identical.
  //   maxDpr     — pixel-ratio cap for the board's painted terrain layer
  //   tufts      — grass tufts per tile in the terrain layer (Detailed)
  //   flowers    — chance of a flower speck per tile in that layer
  //   particles  — live particle cap (sale coins, steam, dust, confetti), scaled by level
  //   burst      — particles per event × this (before the Particles tier's ½ for Low)
  //   clouds     — drifting cloud shadows when the grade and animation are on
  //   glows      — glow sprites drawn per frame (Bloom)
  var BUDGETS = {
    low:      { maxDpr: 1,   tufts: 0,  flowers: 0,    particles: 48,  burst: 0.5,  clouds: 0, glows: 0 },
    balanced: { maxDpr: 1.5, tufts: 5,  flowers: 0.25, particles: 120, burst: 0.75, clouds: 2, glows: 24 },
    high:     { maxDpr: 2,   tufts: 9,  flowers: 0.35, particles: 320, burst: 1,    clouds: 3, glows: 64 },
    ultra:    { maxDpr: 2,   tufts: 16, flowers: 0.6,  particles: 640, burst: 1.5,  clouds: 4, glows: 160 }
  };
  var MAX_PARTICLES = 1280;

  /** The preset's budget; `k` (≥ 1, the level's speed over its tier's first
   * level, at most 2) grows the particle cap and burst size within the tier. */
  function budget(preset, k) {
    var b = BUDGETS[preset] || BUDGETS.balanced;
    var m = Math.max(1, Math.min(2, isFinite(k) ? k : 1));
    return Object.assign({}, b, {
      particles: Math.min(MAX_PARTICLES, Math.max(8, Math.round(b.particles * m))),
      burst: Math.round(b.burst * m * 100) / 100
    });
  }

  /** The look for a quality tier: { preset, <category>: tier, budget, post, reducedMotion }.
   * env: { reducedMotion, k } — reduced motion turns animation and particles off. */
  function resolve(preset, env) {
    var p = PRESETS.indexOf(preset) >= 0 ? preset : 'balanced';
    var row = TABLE[p];
    var out = { preset: p };
    for (var i = 0; i < CATEGORY_ORDER.length; i++) out[CATEGORY_ORDER[i]] = row[CATEGORY_ORDER[i]];
    out.budget = budget(p, env && env.k);
    out.reducedMotion = !!(env && env.reducedMotion);
    if (out.reducedMotion) { out.animation = 'static'; out.particles = 'off'; }
    // Overlay passes drawn after the pieces (the 2D analogue of a post chain).
    out.post = out.bloom === 'on' || out.grade === 'on';
    return out;
  }

  return {
    PRESETS: PRESETS,
    CATEGORIES: CATEGORIES,
    CATEGORY_ORDER: CATEGORY_ORDER,
    TABLE: TABLE,
    BUDGETS: BUDGETS,
    MAX_PARTICLES: MAX_PARTICLES,
    budget: budget,
    resolve: resolve
  };
});
