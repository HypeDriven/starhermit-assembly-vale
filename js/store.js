/* Assembly Vale — the save document (pure: no storage, no DOM).
 * { v: 1, settings, progress }: the progress (lessons done, Journey stars and
 * bests, challenge bests, dailies, Score Chase best, counters) is the game's
 * save (native/save.ts keeps it in starhermit:storage `saves`, on the device
 * and in the account's cloud slot). The browser build wrote the same document
 * wrapped as { sum, payload } (an FNV-1a checksum over the JSON payload) into
 * the cloud slot game:<slug> (the JS SDK's zipped save.json): `loadRaw` reads
 * that text, so an old cloud save migrates by `mergeDocs(loadRaw(text), doc)`.
 * Settings in the document are the browser build's; on the engine the
 * runtime's Options hold sound, graphics and motion, and only the progress is
 * saved. UMD: globalThis.AVStore (loadClassic) and Node (require). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AVStore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SAVE_VERSION = 1;

  // The browser build's settings (kept so old documents migrate field by field).
  var DEFAULT_SETTINGS = {
    music: 0.55, effects: 0.9, ambience: 0.5, voice: 0.8,
    muted: false, captions: false,
    graphicsTier: 'auto',
    theme: 'meadow',
    reducedMotion: false,
    highContrast: false,
    colorPalette: 'standard',
    largeText: false,
    leftHanded: false,
    simSpeed: 1,
    haptics: true,
    boardMirror: false,
    confirmBuilds: false
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

  function checksum(str) { // FNV-1a, base 36
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  function migrate(doc) {
    // v1 is current; older shapes are upgraded field-by-field here.
    if (!isObj(doc)) return null;
    if (doc.v > SAVE_VERSION) return null; // future format: don't clobber
    doc.v = SAVE_VERSION;
    doc.settings = Object.assign({}, DEFAULT_SETTINGS, isObj(doc.settings) ? doc.settings : {});
    doc.progress = Object.assign(defaultProgress(), isObj(doc.progress) ? doc.progress : {});
    doc.progress.stats = Object.assign(defaultProgress().stats, isObj(doc.progress.stats) ? doc.progress.stats : {});
    ['tutorialDone', 'journeyStars', 'journeyBest', 'challengeBest', 'dailiesDone', 'achievements'].forEach(function (k) {
      if (!isObj(doc.progress[k])) doc.progress[k] = {};
    });
    return doc;
  }

  function fresh() {
    return { v: SAVE_VERSION, settings: Object.assign({}, DEFAULT_SETTINGS), progress: defaultProgress() };
  }

  /** A document from the engine save's data ({ v, progress }), or a fresh one. */
  function fromData(data) {
    return migrate(isObj(data) ? JSON.parse(JSON.stringify(data)) : null) || fresh();
  }

  /** What the engine save keeps: the version and the progress. */
  function toData(doc) {
    return { v: SAVE_VERSION, progress: JSON.parse(JSON.stringify(doc.progress)) };
  }

  /** The browser build's wrapped {sum, payload} text → a migrated document;
   * null if the checksum fails or the shape is unrecognizable. */
  function loadRaw(raw) {
    if (raw == null) return null;
    try {
      var doc = JSON.parse(raw);
      if (!doc || doc.sum !== checksum(doc.payload)) return null; // corrupt
      return migrate(JSON.parse(doc.payload));
    } catch (e) { return null; }
  }

  /** The browser build's wrapping of a document (tests write old saves with it). */
  function wrap(doc) {
    var payload = JSON.stringify(doc);
    return JSON.stringify({ sum: checksum(payload), payload: payload });
  }

  // Two devices' documents as one so neither side's progress is lost.
  // Records keep the better value (stars, best scores, counters, latest
  // daily), unlock maps are unioned, and the local settings win.
  function mergeDocs(remote, local) {
    var r = migrate(remote ? JSON.parse(JSON.stringify(remote)) : null);
    var l = migrate(local ? JSON.parse(JSON.stringify(local)) : null);
    if (!r) return l || fresh();
    if (!l) return r;
    var rp = r.progress, lp = l.progress, out = l;
    function better(a, b) {
      if (typeof a === 'number' && typeof b === 'number') return Math.max(a, b);
      if (typeof a === 'string' && typeof b === 'string') return a > b ? a : b;
      return a || b;
    }
    function mergeMap(a, b) {
      var m = {}, k;
      for (k in a) m[k] = a[k];
      for (k in b) m[k] = k in m ? better(m[k], b[k]) : b[k];
      return m;
    }
    ['tutorialDone', 'journeyStars', 'journeyBest', 'challengeBest', 'dailiesDone', 'stats'].forEach(function (k) {
      out.progress[k] = mergeMap(rp[k] || {}, lp[k] || {});
    });
    var ach = {}, key;
    for (key in rp.achievements) ach[key] = rp.achievements[key];
    for (key in lp.achievements) ach[key] = ach[key] ? Math.min(ach[key], lp.achievements[key]) : lp.achievements[key];
    out.progress.achievements = ach;
    out.progress.scoreChaseBest = Math.max(rp.scoreChaseBest || 0, lp.scoreChaseBest || 0);
    return out;
  }

  /** One star for the win, one for beating par ticks, one for spare gold. */
  function starsFor(state) {
    var stars = 1;
    var par = (state.cfg.par && state.cfg.par.ticks) || 0;
    if (par && state.tick <= par) stars++;
    if (state.gold >= state.cfg.gold) stars++;
    return stars;
  }

  /** Records a finished round into the progress (prog is changed in place).
   * kind: the session kind (journey, challenge, daily, score-chase, learn,
   * practice); day: the UTC date of a daily. */
  function recordResult(prog, state, kind, day) {
    var s = prog.stats, total = state.score.total, id = state.cfg.id, won = !!(state.terminal && state.terminal.won);
    s.rounds++;
    if (won) s.wins++;
    for (var g in state.sold) s.goodsSold += state.sold[g];
    for (var c in state.contractDone) if (state.contractDone[c]) s.contractsDone++;
    s.buildingsPlaced += state.builds;
    if (total > s.bestScore) s.bestScore = total;
    if (kind === 'journey') {
      if (!prog.journeyBest[id] || total > prog.journeyBest[id]) prog.journeyBest[id] = total;
      if (won) prog.journeyStars[id] = Math.max(prog.journeyStars[id] || 0, starsFor(state));
    } else if (kind === 'challenge') {
      if (!prog.challengeBest[id] || total > prog.challengeBest[id]) prog.challengeBest[id] = total;
    } else if (kind === 'daily') {
      if (!prog.dailiesDone[day] || total > prog.dailiesDone[day]) prog.dailiesDone[day] = total;
      s.lastDaily = day;
    } else if (kind === 'score-chase' || kind === 'score') {
      if (total > prog.scoreChaseBest) prog.scoreChaseBest = total;
    } else if (kind === 'learn' && won && state.cfg.lesson) {
      prog.tutorialDone[state.cfg.lesson.id] = true;
    }
    return prog;
  }

  return {
    SAVE_VERSION: SAVE_VERSION,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    defaultProgress: defaultProgress,
    fresh: fresh, migrate: migrate, fromData: fromData, toData: toData,
    checksum: checksum, loadRaw: loadRaw, wrap: wrap, mergeDocs: mergeDocs,
    starsFor: starsFor, recordResult: recordResult
  };
});
