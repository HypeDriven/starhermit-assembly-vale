/* Assembly Vale — procedural WebAudio: original short transients per logical
 * event, layered material impacts, quiet valley ambience, adaptive music pad.
 * No audio assets; everything is synthesized. Browser global: window.AVAudio.
 */
(function (root) {
  'use strict';

  var ctx = null, master = null;
  var buses = {}; // music, effects, ambience, voice
  var settings = { music: 0.55, effects: 0.9, ambience: 0.5, voice: 0.8, muted: false };
  var captions = false;
  var captionFn = null;
  var started = false;
  var musicTimer = null, ambienceNodes = null, humNodes = null;
  var avRng = null; // seeded variants for replay consistency

  function ensureCtx() {
    if (ctx) return true;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    ['music', 'effects', 'ambience', 'voice'].forEach(function (name) {
      var g = ctx.createGain();
      g.gain.value = settings.muted ? 0 : (settings[name] != null ? settings[name] : 0.8);
      g.connect(master);
      buses[name] = g;
    });
    return true;
  }

  function applySettings(s) {
    Object.assign(settings, s || {});
    if (!ctx) return;
    Object.keys(buses).forEach(function (name) {
      var v = settings.muted ? 0 : (settings[name] != null ? settings[name] : 0.8);
      buses[name].gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    });
  }

  function caption(text) {
    if (captions && captionFn && text) captionFn(text);
  }

  // ---------- primitive builders ----------
  function blip(freq, dur, type, gain, bus, when, sweepTo) {
    var t = (when || ctx.currentTime);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(buses[bus || 'effects']);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noiseBurst(dur, gain, cutoff, type, when) { // filtered noise impact
    var t = when || ctx.currentTime;
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = cutoff;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(buses.effects);
    src.start(t);
  }

  function variant(base) { // seeded pitch variant (±5%) when replay consistency matters
    var r = avRng ? avRng.next() : Math.random();
    return base * (0.95 + r * 0.10);
  }

  // ---------- event map ----------
  var SFX = {
    'ui':        function () { blip(660, 0.06, 'triangle', 0.12); },
    'tool':      function () { blip(variant(520), 0.08, 'sine', 0.16); blip(variant(780), 0.06, 'sine', 0.07, 'effects', ctx.currentTime + 0.03); caption('tool selected'); },
    'place':     function () { noiseBurst(0.08, 0.5, 1000); blip(variant(220), 0.1, 'sine', 0.14); caption('build'); },
    'remove':    function () { noiseBurst(0.1, 0.4, 700); blip(180, 0.12, 'sine', 0.1, 'effects', ctx.currentTime, 120); caption('remove'); },
    'rotate':    function () { blip(variant(440), 0.06, 'triangle', 0.12); blip(variant(550), 0.06, 'triangle', 0.1, 'effects', ctx.currentTime + 0.05); caption('rotate'); },
    'upgrade':   function () { [0, 5, 9].forEach(function (st, i) { blip(variant(440 * Math.pow(2, st / 12)), 0.12, 'triangle', 0.12, 'effects', ctx.currentTime + i * 0.06); }); caption('upgrade'); },
    'invalid':   function () { blip(160, 0.16, 'square', 0.07); blip(150, 0.14, 'square', 0.05, 'effects', ctx.currentTime + 0.05); caption('not allowed'); },
    'craft':     function () { noiseBurst(0.05, 0.3, 2400, 'bandpass'); blip(variant(1180), 0.07, 'triangle', 0.05, 'effects', ctx.currentTime + 0.01); caption('crafted'); },
    'deliver':   function () { blip(variant(880), 0.09, 'sine', 0.14); blip(variant(1320), 0.1, 'sine', 0.09, 'effects', ctx.currentTime + 0.06); caption('sale'); },
    'contract':  function () { blip(523, 0.3, 'sine', 0.14); blip(784, 0.35, 'sine', 0.12, 'effects', ctx.currentTime + 0.12); caption('contract complete'); },
    'spoil':     function () { blip(220, 0.2, 'sawtooth', 0.06, 'effects', ctx.currentTime, 110); caption('goods lost'); },
    'win':       function () {
      [0, 4, 7, 12].forEach(function (st, i) {
        blip(523 * Math.pow(2, st / 12), 0.5, 'triangle', 0.14, 'effects', ctx.currentTime + i * 0.12);
      });
      caption('contracts complete');
    },
    'lose':      function () { blip(300, 0.5, 'sine', 0.16, 'effects', ctx.currentTime, 180); blip(200, 0.6, 'sine', 0.1, 'effects', ctx.currentTime + 0.15, 120); caption('round lost'); },
    'undo':      function () { blip(500, 0.08, 'triangle', 0.1, 'effects', ctx.currentTime, 380); caption('undo'); },
    'hint':      function () { blip(990, 0.12, 'sine', 0.1); blip(1320, 0.14, 'sine', 0.07, 'effects', ctx.currentTime + 0.07); caption('hint'); },
    'star':      function () { blip(1568, 0.18, 'sine', 0.1); },
    'spawn':     function () { noiseBurst(0.04, 0.12, 900); blip(variant(330), 0.05, 'triangle', 0.04); },
    'auto':      function () { blip(110, 0.35, 'sawtooth', 0.05, 'effects', ctx.currentTime, 165); caption('auto-run'); }
  };

  // ---------- authored one-shot samples (sfx/*.opus); synthesis is the fallback ----------
  var sampleFor = null; // event name -> clip basename, from sfx/manifest.json
  var clipBufs = {};    // basename -> AudioBuffer
  var clipState = {};   // basename -> 'loading' | 'ready' | 'failed'

  function loadManifest() {
    if (sampleFor || typeof root.fetch !== 'function') return;
    sampleFor = {};
    root.fetch('sfx/manifest.json').then(function (res) {
      if (!res.ok) throw new Error('manifest ' + res.status);
      return res.json();
    }).then(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (entry) {
        if (entry && entry.event && entry.name && SFX[entry.event] && !sampleFor[entry.event]) {
          sampleFor[entry.event] = entry.name;
        }
      });
    }).catch(function () { /* keep empty map: synthesis only */ });
  }

  function fetchClip(name) {
    if (clipState[name]) return;
    clipState[name] = 'loading';
    root.fetch('sfx/' + encodeURIComponent(name) + '.opus').then(function (res) {
      if (!res.ok) throw new Error('clip ' + res.status);
      return res.arrayBuffer();
    }).then(function (bytes) {
      return ctx.decodeAudioData(bytes);
    }).then(function (buf) {
      clipBufs[name] = buf;
      clipState[name] = 'ready';
    }).catch(function () {
      clipState[name] = 'failed';
    });
  }

  function playClip(buf) {
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(buses.effects);
    src.start();
  }

  function play(name) {
    if (!started || !ctx || settings.muted) return;
    if (ctx.state === 'suspended') ctx.resume();
    var clip = sampleFor && sampleFor[name];
    if (clip) {
      if (clipState[clip] === 'ready') { playClip(clipBufs[clip]); return; }
      if (!clipState[clip]) fetchClip(clip); // kick off load; synthesize meanwhile
    }
    var fn = SFX[name];
    if (fn) fn();
  }

  // ---------- ambience: valley air (filtered noise, very quiet) ----------
  function startAmbience() {
    if (!ctx || ambienceNodes) return;
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) { // brown-ish noise
      var w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    var g = ctx.createGain(); g.gain.value = 0.32;
    src.connect(f); f.connect(g); g.connect(buses.ambience);
    src.start();
    ambienceNodes = { src: src, gain: g };
  }

  // ---------- factory hum: appears while the simulation runs ----------
  function setHum(on) {
    if (!ctx) return;
    if (on && !humNodes) {
      var o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = 55;
      f.type = 'lowpass'; f.frequency.value = 180;
      g.gain.value = 0;
      g.gain.setTargetAtTime(0.10, ctx.currentTime, 0.4);
      o.connect(f); f.connect(g); g.connect(buses.ambience);
      o.start();
      humNodes = { o: o, g: g };
    } else if (!on && humNodes) {
      humNodes.g.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      var nodes = humNodes;
      humNodes = null;
      setTimeout(function () { try { nodes.o.stop(); } catch (e) {} }, 900);
    }
  }

  // ---------- music: slow generative pad, seeded chord walk ----------
  var CHORDS = [
    [220.0, 261.63, 329.63], // A  C  E
    [196.0, 246.94, 293.66], // G  B  D
    [174.61, 220.0, 261.63], // F  A  C
    [164.81, 220.0, 246.94]  // E  A  B
  ];
  var chordIdx = 0;
  function schedulePad() {
    if (!ctx || settings.muted) return;
    var t = ctx.currentTime + 0.1;
    var chord = CHORDS[chordIdx % CHORDS.length];
    chordIdx++;
    chord.forEach(function (freq, i) {
      var o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = freq * 0.5;
      f.type = 'lowpass'; f.frequency.value = 650;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 1.8);
      g.gain.linearRampToValueAtTime(0.0001, t + 6.4);
      o.connect(f); f.connect(g); g.connect(buses.music);
      o.start(t); o.stop(t + 6.6);
    });
  }
  function startMusic() {
    if (musicTimer || !ctx) return;
    schedulePad();
    musicTimer = setInterval(schedulePad, 5200);
  }

  function start(opts) {
    if (!ensureCtx()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    started = true;
    loadManifest();
    startAmbience();
    startMusic();
    return true;
  }

  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }
  function resume() { if (ctx && started && ctx.state === 'suspended') ctx.resume(); }

  function setAvRng(rng) { avRng = rng; }
  function setCaptions(on, fn) { captions = !!on; captionFn = fn || captionFn; }

  root.AVAudio = {
    start: start, play: play, applySettings: applySettings,
    suspend: suspend, resume: resume, setHum: setHum,
    setAvRng: setAvRng, setCaptions: setCaptions,
    isStarted: function () { return started; }
  };
})(typeof self !== 'undefined' ? self : this);
