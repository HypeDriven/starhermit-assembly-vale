/* Assembly Vale — persistence: versioned, checksummed local save document.
 * Never stores credentials or tokens. Browser global: window.AVStore.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AVStore = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var SAVE_VERSION = 1;
  var KEY = 'assemblyvale.save.v1';
  var LB_KEY = 'assemblyvale.leaderboards.v1';

  var DEFAULT_SETTINGS = {
    music: 0.55, effects: 0.9, ambience: 0.5, voice: 0.8,
    muted: false, captions: false,
    graphicsTier: 'auto',       // auto | low | medium | high
    theme: 'meadow',            // cosmetic override for free modes
    reducedMotion: false,
    highContrast: false,
    colorPalette: 'standard',   // standard | high-visibility
    largeText: false,
    leftHanded: false,
    simSpeed: 1,                // 1 | 2 | 4 ticks pace multiplier
    haptics: true,
    boardMirror: false,         // always-visible DOM board
    confirmBuilds: false        // timing assistance: tap target again to confirm
  };

  function defaultProgress() {
    return {
      tutorialDone: {},        // lessonId -> true
      journeyStars: {},        // levelId -> 0..3
      journeyBest: {},         // levelId -> score
      challengeBest: {},       // challengeId -> score
      dailiesDone: {},         // dateStr -> score
      scoreChaseBest: 0,
      achievements: {},        // key -> unlockedAtMs
      stats: { rounds: 0, wins: 0, goodsSold: 0, contractsDone: 0,
               buildingsPlaced: 0, bestScore: 0, playMs: 0, dailyStreak: 0, lastDaily: '' },
      cosmetics: { theme: 'meadow' }
    };
  }

  function checksum(str) { // FNV-1a, decimal string
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  function migrate(doc) {
    // v1 is current; older shapes are upgraded field-by-field here.
    if (!doc || typeof doc !== 'object') return null;
    if (doc.v > SAVE_VERSION) return null; // future format: don't clobber
    doc.v = SAVE_VERSION;
    doc.settings = Object.assign({}, DEFAULT_SETTINGS, doc.settings || {});
    doc.progress = Object.assign(defaultProgress(), doc.progress || {});
    doc.progress.stats = Object.assign(defaultProgress().stats, doc.progress.stats || {});
    return doc;
  }

  function fresh() {
    return { v: SAVE_VERSION, settings: Object.assign({}, DEFAULT_SETTINGS), progress: defaultProgress() };
  }

  var memoryFallback = null; // used when localStorage is unavailable

  // Parses a wrapped {sum, payload} string into a migrated doc; null if the
  // checksum fails or the shape is unrecognizable. Used for both the local
  // cache and the cloud mirror (remote-preferred load goes through here).
  function loadRaw(raw) {
    if (raw == null) return null;
    try {
      var doc = JSON.parse(raw);
      if (!doc || doc.sum !== checksum(doc.payload)) return null; // corrupt
      return migrate(JSON.parse(doc.payload));
    } catch (e) { return null; }
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
    if (raw == null && memoryFallback) raw = memoryFallback;
    var doc = loadRaw(raw);
    return doc || fresh();
  }

  function save(doc) {
    doc.v = SAVE_VERSION;
    var payload = JSON.stringify(doc);
    var wrapped = JSON.stringify({ sum: checksum(payload), payload: payload });
    memoryFallback = wrapped;
    try { localStorage.setItem(KEY, wrapped); } catch (e) { /* memory fallback keeps session */ }
    if (root.AVPlatform && typeof root.AVPlatform.onLocalSave === 'function')
      root.AVPlatform.onLocalSave(wrapped); // host adapter mirrors to the cloud slot
  }

  // ---------- leaderboards (local; host adapter may sync) ----------
  function loadBoards() {
    try {
      var raw = localStorage.getItem(LB_KEY);
      return raw ? JSON.parse(raw) : { entries: [] };
    } catch (e) { return { entries: [] }; }
  }
  function saveBoards(b) {
    try { localStorage.setItem(LB_KEY, JSON.stringify(b)); } catch (e) {}
  }

  // Ties: contract completion, higher score, fewer invalid actions, lower
  // elapsed, then stable session id. Returns sorted copy.
  function sortEntries(entries) {
    return entries.slice().sort(function (a, b) {
      if ((b.won ? 1 : 0) !== (a.won ? 1 : 0)) return (b.won ? 1 : 0) - (a.won ? 1 : 0);
      if (b.score !== a.score) return b.score - a.score;
      if ((a.invalid || 0) !== (b.invalid || 0)) return (a.invalid || 0) - (b.invalid || 0);
      if ((a.durationMs || 0) !== (b.durationMs || 0)) return (a.durationMs || 0) - (b.durationMs || 0);
      return String(a.sessionId).localeCompare(String(b.sessionId));
    });
  }

  return {
    SAVE_VERSION: SAVE_VERSION,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    load: load, save: save, fresh: fresh, migrate: migrate,
    checksum: checksum, loadRaw: loadRaw,
    loadBoards: loadBoards, saveBoards: saveBoards, sortEntries: sortEntries
  };
});
