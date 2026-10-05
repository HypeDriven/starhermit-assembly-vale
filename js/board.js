/* Assembly Vale — board renderer (2D canvas).
 * Draws a rules state as a tabletop diorama. Every effect is gated by the
 * resolved graphics settings from gfx.js; with the Low preset it draws the
 * original flat board and runs no frame loop (redraw on change only).
 * Browser global: window.AVBoard. Presentation only — never touches rules state.
 */
(function (root, factory) {
  root.AVBoard = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var Rules = root.AVRules;
  var Content = root.AVContent;
  var Gfx = root.AVGfx;

  // ---------- small helpers ----------
  function hash3(a, b, c) {
    var h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    h ^= h >>> 16;
    return h >>> 0;
  }
  function rngFrom(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function parseHex(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // amt > 0 mixes toward white, < 0 toward black.
  function shade(hex, amt, alpha) {
    var c = parseHex(hex), t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    var r = Math.round(c[0] + (t - c[0]) * p), g = Math.round(c[1] + (t - c[1]) * p), b = Math.round(c[2] + (t - c[2]) * p);
    return alpha == null ? 'rgb(' + r + ',' + g + ',' + b + ')' : 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }
  function rgba(hex, a) { var c = parseHex(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }
  function nowMs() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }

  var SHADOW = {
    low:    { blur: 0,    off: 0.05, a: 0.32 },
    medium: { blur: 0.12, off: 0.06, a: 0.38 },
    high:   { blur: 0.2,  off: 0.08, a: 0.42 }
  };
  var MAX_PARTICLES = 320;

  /**
   * opts: {
   *   getState(): rules state | null
   *   getSelected(): {x,y} | null
   *   cellSize(state): logical cell size (the original device-pixel size)
   *   tweenMs(): duration for goods gliding between cells
   *   shared: { adaptive: 1 } — adaptive scale kept across screens
   *   onFps(fps, avgMs), onFail(), onResize()
   * }
   */
  function create(canvas, opts) {
    var cfg = Gfx.resolve({ preset: 'low' }, 'low');
    var shared = opts.shared || { adaptive: 1 };
    var st = {
      k: 1, lw: 1, lh: 1, cs: 32, cssW: 0,
      raf: 0, lastFrame: 0, samples: [], fpsAt: 0, fpsFrames: 0,
      lastState: null, pos: {}, tween: null, ticked: false, rollT: 1,
      particles: [], flash: 0, glows: [],
      staticLayer: null, staticKey: '',
      failed: false, destroyed: false, t0: nowMs(), hasWater: false
    };
    var ctx = canvas.getContext('2d');
    var ro = null;
    if (root.ResizeObserver) {
      ro = new root.ResizeObserver(function () { if (sizeCanvas()) draw(); kick(); });
      ro.observe(canvas);
    }
    // A zoom change keeps the layout width but changes the displayed size.
    var offScale = root.UIScale ? root.UIScale.on(function () { if (sizeCanvas()) draw(); kick(); }) : null;

    // ---------- sizing ----------
    // Backing store = CSS width × min(dpr, 2) × preset scale × adaptive scale;
    // drawing happens in logical cell units through a transform.
    function sizeCanvas() {
      var state = opts.getState();
      if (!state) return false;
      var cols = state.cfg.board.cols, rows = state.cfg.board.rows;
      var cs = opts.cellSize(state);
      st.cs = cs; st.lw = cols * cs; st.lh = rows * cs;
      canvas.style.setProperty('--board-ar', cols + ' / ' + rows);
      canvas.style.setProperty('--board-ar-num', String(cols / rows));
      var cssW = canvas.clientWidth || st.lw;
      st.cssW = cssW;
      // The canvas sits inside the zoomed UI (--ui-scale), so the backing store
      // also multiplies by the zoom to stay crisp on large screens.
      var dpr = Math.min(root.devicePixelRatio || 1, 2) * ((root.UIScale && root.UIScale.value) || 1);
      var pr = dpr * cfg.scale * (cfg.adaptive ? shared.adaptive : 1);
      var bw = Math.max(cols, Math.min(4096, Math.round(cssW * pr)));
      var bh = Math.max(rows, Math.round(bw * rows / cols));
      var changed = canvas.width !== bw || canvas.height !== bh;
      if (changed) { canvas.width = bw; canvas.height = bh; st.staticKey = ''; }
      st.k = bw / st.lw;
      if (changed && opts.onResize) opts.onResize(bw, bh);
      return changed;
    }

    // ---------- item positions (for gliding goods) ----------
    function itemPositions(state) {
      var cs = opts.cellSize(state), out = {};
      for (var y = 0; y < state.cfg.board.rows; y++) for (var x = 0; x < state.cfg.board.cols; x++) {
        var c = state.grid[y][x];
        if (!c) continue;
        if ((c.k === 'belt' || c.k === 'source') && c.itemRef) out[c.itemRef.id] = [x * cs + cs / 2, y * cs + cs / 2];
        else if (c.k === 'machine') {
          if (c.inBuf) out[c.inBuf.id] = [x * cs + cs * 0.24, y * cs + cs * 0.24];
          if (c.outBuf) out[c.outBuf.id] = [x * cs + cs * 0.76, y * cs + cs * 0.76];
        }
      }
      return out;
    }

    function tweenDur() { return Math.max(60, Math.min(220, (opts.tweenMs && opts.tweenMs()) || 170)); }

    // Called after every rules change; starts glides and redraws.
    function update() {
      var state = opts.getState();
      if (!state) return;
      var pos = itemPositions(state);
      if (state !== st.lastState && cfg.animation === 'animated' && st.lastState && st.ticked) {
        var from = {}, any = false;
        for (var id in pos) {
          var p0 = st.pos[id];
          if (p0 && (p0[0] !== pos[id][0] || p0[1] !== pos[id][1])) { from[id] = p0; any = true; }
        }
        var dur = tweenDur();
        st.tween = any ? { from: from, start: nowMs(), dur: dur } : null;
        st.rollT = 0; st.rollStart = nowMs(); st.rollDur = dur;
      }
      st.ticked = false;
      st.pos = pos;
      st.lastState = state;
      draw();
      kick();
    }

    function noteTick() { st.ticked = true; }

    // ---------- particles ----------
    function addParticle(p) {
      if (st.particles.length >= MAX_PARTICLES) st.particles.shift();
      st.particles.push(p);
    }
    function burst(n, x, y, make) {
      var r = rngFrom(hash3(Math.round(x), Math.round(y), st.particles.length + Math.round(nowMs())));
      for (var i = 0; i < n; i++) addParticle(make(r, i));
    }

    function events(evts) {
      var state = opts.getState();
      if (!state || !evts || cfg.particles === 'off') {
        if (evts && cfg.animation === 'animated') for (var j = 0; j < evts.length; j++) if (evts[j].type === 'deliver') st.flash = 1;
        return;
      }
      var cs = opts.cellSize(state), mul = cfg.particles === 'high' ? 1 : 0.5;
      var sink = state.cfg.sink, sx = sink.x * cs + cs / 2, sy = sink.y * cs + cs / 2;
      for (var i = 0; i < evts.length; i++) {
        var e = evts[i];
        var cx = e.x != null ? e.x * cs + cs / 2 : sx, cy = e.y != null ? e.y * cs + cs / 2 : sy;
        if (e.type === 'deliver') {
          st.flash = 1;
          burst(Math.round(10 * mul), sx, sy, function (r) {
            var a = -Math.PI / 2 + (r() - 0.5) * 1.9, v = cs * (1.6 + r() * 1.6);
            return { kind: 'coin', x: sx + (r() - 0.5) * cs * 0.3, y: sy - cs * 0.1, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: cs * 5.5,
              life: 0, max: 0.7 + r() * 0.35, size: cs * (0.05 + r() * 0.035), color: r() < 0.7 ? '#ffd166' : '#fff3c4', glow: true };
          });
        } else if (e.type === 'contract-complete') {
          var conf = ['#ffd166', '#7fd48f', '#7fa8d9', '#ff9b8a', '#f4f4f4', '#b07fd9'];
          burst(Math.round(30 * mul), sx, sy, function (r) {
            var a = r() * Math.PI * 2, v = cs * (1.4 + r() * 2.4);
            return { kind: 'confetti', x: sx, y: sy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - cs * 1.5, g: cs * 4, drag: 1.6,
              life: 0, max: 1.1 + r() * 0.6, size: cs * (0.04 + r() * 0.03), color: conf[(r() * conf.length) | 0], spin: r() * 6 };
          });
        } else if (e.type === 'craft') {
          var meta = Content.GOOD_META[e.item] || { color: '#ffd166' };
          burst(Math.round(4 * mul), cx, cy, function (r) {
            return { kind: 'puff', x: cx + (r() - 0.5) * cs * 0.4, y: cy - cs * 0.3, vx: (r() - 0.5) * cs * 0.25, vy: -cs * (0.25 + r() * 0.25),
              life: 0, max: 0.7 + r() * 0.4, size: cs * (0.05 + r() * 0.04), grow: cs * 0.1, color: '#eef0f2', alpha: 0.28 };
          });
          burst(Math.round(6 * mul), cx, cy, function (r) {
            var a = r() * Math.PI * 2, v = cs * (0.9 + r() * 1.2);
            return { kind: 'spark', x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: cs * 2, life: 0, max: 0.35 + r() * 0.25,
              size: cs * 0.035, color: meta.color, glow: true };
          });
        } else if (e.type === 'spawn') {
          burst(Math.round(4 * mul), cx, cy, function (r) {
            return { kind: 'dust', x: cx + (r() - 0.5) * cs * 0.5, y: cy + cs * 0.3, vx: (r() - 0.5) * cs * 0.6, vy: -cs * (0.2 + r() * 0.3),
              life: 0, max: 0.5 + r() * 0.3, size: cs * (0.04 + r() * 0.03), grow: cs * 0.06, color: '#c9b79a' };
          });
        } else if (e.type === 'spoil') {
          burst(Math.round(8 * mul), cx, cy, function (r) {
            var a = r() * Math.PI * 2, v = cs * (0.6 + r() * 1.0);
            return { kind: 'drop', x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - cs * 0.4, g: cs * 4, life: 0, max: 0.5 + r() * 0.3,
              size: cs * (0.04 + r() * 0.03), color: '#3a2a22' };
          });
        } else if (e.type === 'place' || e.type === 'remove') {
          burst(Math.round(8 * mul), cx, cy, function (r, k) {
            var a = (k / 8) * Math.PI * 2 + r() * 0.4, v = cs * (0.8 + r() * 0.4);
            return { kind: 'dust', x: cx + Math.cos(a) * cs * 0.3, y: cy + Math.sin(a) * cs * 0.3, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 4,
              life: 0, max: 0.45 + r() * 0.2, size: cs * 0.045, grow: cs * 0.08, color: '#d8cdb4' };
          });
        } else if (e.type === 'upgrade') {
          burst(Math.round(14 * mul), cx, cy, function (r, k) {
            var a = (k / 14) * Math.PI * 2, v = cs * (1.2 + r() * 0.5);
            return { kind: 'spark', x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 2.5, life: 0, max: 0.55 + r() * 0.2,
              size: cs * 0.04, color: '#ffd166', glow: true };
          });
        }
      }
      kick();
    }

    function stepParticles(dt) {
      var ps = st.particles, keep = [];
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        p.life += dt;
        if (p.life >= p.max) continue;
        if (p.drag) { var d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d; }
        if (p.g) p.vy += p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        keep.push(p);
      }
      st.particles = keep;
    }

    function drawParticles() {
      for (var i = 0; i < st.particles.length; i++) {
        var p = st.particles[i], f = p.life / p.max, a = 1 - f;
        var size = p.size + (p.grow || 0) * f;
        if (p.kind === 'puff' || p.kind === 'dust') {
          ctx.fillStyle = rgba(p.color, (p.alpha || 0.45) * a);
          ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill();
        } else if (p.kind === 'confetti') {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.spin * p.life * 3);
          ctx.fillStyle = rgba(p.color, Math.min(1, a * 1.5));
          ctx.fillRect(-size, -size * 0.5, size * 2, size);
          ctx.restore();
        } else {
          ctx.fillStyle = rgba(p.color, Math.min(1, a * 1.4));
          ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill();
          if (p.kind === 'coin') { ctx.strokeStyle = 'rgba(120,80,10,' + (0.8 * a) + ')'; ctx.lineWidth = size * 0.35; ctx.stroke(); }
        }
        if (p.glow) st.glows.push({ x: p.x, y: p.y, r: size * 4, color: p.color, a: 0.35 * a });
      }
    }

    // ---------- static terrain layer (cached) ----------
    function terrainKey(state) {
      return [state.cfg.id, state.cfg.theme, state.cfg.board.cols, state.cfg.board.rows, (state.cfg.terrain || []).length,
        cfg.detail, cfg.grade, canvas.width, canvas.height].join('|');
    }

    function buildStatic(state, th) {
      var layer = st.staticLayer;
      if (!layer) { layer = st.staticLayer = root.document.createElement('canvas'); }
      layer.width = canvas.width; layer.height = canvas.height;
      var g = layer.getContext('2d');
      var cs = st.cs, cols = state.cfg.board.cols, rows = state.cfg.board.rows;
      g.setTransform(st.k, 0, 0, st.k, 0, 0);
      var detailed = cfg.detail === 'detailed';
      if (cfg.grade === 'on' && 'filter' in g) g.filter = 'saturate(1.12) contrast(1.04)';
      var x, y, i;
      for (y = 0; y < rows; y++) for (x = 0; x < cols; x++) {
        g.fillStyle = ((x + y) % 2 === 0) ? th.tileA : th.tileB;
        g.fillRect(x * cs, y * cs, cs, cs);
      }
      var seed = hash3(state.cfg.seed || 1, cols, rows);
      if (detailed) {
        // soft light falloff per tile + grass tufts and specks
        for (y = 0; y < rows; y++) for (x = 0; x < cols; x++) {
          var base = ((x + y) % 2 === 0) ? th.tileA : th.tileB;
          var r = rngFrom(hash3(seed, x, y));
          var gr = g.createLinearGradient(x * cs, y * cs, x * cs + cs, y * cs + cs);
          gr.addColorStop(0, 'rgba(255,255,255,0.07)'); gr.addColorStop(1, 'rgba(0,0,0,0.06)');
          g.fillStyle = gr; g.fillRect(x * cs, y * cs, cs, cs);
          g.lineCap = 'round'; g.lineWidth = Math.max(0.8, cs * 0.028);
          for (i = 0; i < 9; i++) {
            var tx = x * cs + cs * (0.08 + r() * 0.84), ty = y * cs + cs * (0.12 + r() * 0.8), hgt = cs * (0.05 + r() * 0.07);
            g.strokeStyle = r() < 0.5 ? shade(base, 0.16, 0.7) : shade(base, -0.14, 0.7);
            g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + (r() - 0.5) * hgt * 0.8, ty - hgt); g.stroke();
          }
          if (r() < 0.35) {
            var fx = x * cs + cs * (0.15 + r() * 0.7), fy = y * cs + cs * (0.15 + r() * 0.7);
            g.fillStyle = shade(th.accent, 0.35, 0.55);
            g.beginPath(); g.arc(fx, fy, cs * 0.022, 0, Math.PI * 2); g.fill();
          }
        }
      }
      var terrain = state.cfg.terrain || [];
      st.hasWater = false;
      for (i = 0; i < terrain.length; i++) {
        var t = terrain[i], rx = t.x * cs, ry = t.y * cs;
        if (t.k === 'water') st.hasWater = true;
        if (!detailed) {
          g.fillStyle = t.k === 'water' ? th.water : th.rock;
          g.fillRect(rx + 1, ry + 1, cs - 2, cs - 2);
          continue;
        }
        var rr = rngFrom(hash3(seed, t.x + 101, t.y + 57));
        if (t.k === 'water') {
          var wg = g.createLinearGradient(rx, ry, rx, ry + cs);
          wg.addColorStop(0, shade(th.water, 0.12)); wg.addColorStop(1, shade(th.water, -0.18));
          g.fillStyle = wg; g.fillRect(rx + 1, ry + 1, cs - 2, cs - 2);
          g.strokeStyle = shade(th.water, 0.4, 0.45); g.lineWidth = Math.max(0.8, cs * 0.03); g.lineCap = 'round';
          for (var w = 0; w < 3; w++) {
            var wy = ry + cs * (0.25 + w * 0.25) + (rr() - 0.5) * cs * 0.06, wx = rx + cs * (0.15 + rr() * 0.3);
            g.beginPath(); g.moveTo(wx, wy); g.quadraticCurveTo(wx + cs * 0.12, wy - cs * 0.05, wx + cs * 0.24, wy); g.stroke();
          }
          g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = Math.max(0.8, cs * 0.02);
          g.strokeRect(rx + 1.5, ry + 1.5, cs - 3, cs - 3);
        } else {
          g.fillStyle = shade(th.rock, -0.22);
          g.fillRect(rx + 1, ry + 1, cs - 2, cs - 2);
          // three boulders, lit from the top-left
          var bs = [[0.34, 0.62, 0.26], [0.68, 0.4, 0.22], [0.66, 0.74, 0.17]];
          for (var b = 0; b < bs.length; b++) {
            var bx = rx + cs * (bs[b][0] + (rr() - 0.5) * 0.08), by = ry + cs * (bs[b][1] + (rr() - 0.5) * 0.08), br = cs * bs[b][2];
            var rg = g.createRadialGradient(bx - br * 0.35, by - br * 0.4, br * 0.1, bx, by, br);
            rg.addColorStop(0, shade(th.rock, 0.35)); rg.addColorStop(0.6, th.rock); rg.addColorStop(1, shade(th.rock, -0.3));
            g.fillStyle = rg;
            g.beginPath(); g.ellipse(bx, by, br, br * 0.82, 0, 0, Math.PI * 2); g.fill();
          }
        }
      }
      g.filter = 'none';
    }

    // ---------- drawing primitives (logical units) ----------
    function setShadow(scale) {
      if (cfg.shadows === 'off') return;
      var s = SHADOW[cfg.shadows], cs = st.cs, k = st.k;
      ctx.shadowColor = 'rgba(0,0,0,' + s.a + ')';
      ctx.shadowBlur = s.blur * cs * k * (scale || 1);
      ctx.shadowOffsetX = s.off * cs * k * (scale || 1);
      ctx.shadowOffsetY = s.off * cs * k * (scale || 1);
    }
    function clearShadow() { ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }

    // Filled block with an optional drop shadow and bevel.
    function block(x, y, w, h, color, opt) {
      opt = opt || {};
      setShadow(opt.shadowScale);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      clearShadow();
      if (cfg.detail === 'detailed' && !opt.flat) {
        var e = Math.max(1, st.cs * 0.05);
        var lg = ctx.createLinearGradient(x, y, x, y + h);
        lg.addColorStop(0, 'rgba(255,255,255,0.10)'); lg.addColorStop(1, 'rgba(0,0,0,0.12)');
        ctx.fillStyle = lg; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.20)';
        ctx.fillRect(x, y, w, e); ctx.fillRect(x, y + e, e, h - e);
        ctx.fillStyle = 'rgba(0,0,0,0.26)';
        ctx.fillRect(x, y + h - e, w, e); ctx.fillRect(x + w - e, y, e, h - e);
      }
    }

    function arrow(cx, cy, dir, len, color, width) {
      var d = Rules.DIRS[dir] || Rules.DIRS.E;
      var s = len * 0.55;
      function path() {
        ctx.beginPath();
        ctx.moveTo(cx - d[0] * len, cy - d[1] * len);
        ctx.lineTo(cx + d[0] * len, cy + d[1] * len);
        var hx = cx + d[0] * len, hy = cy + d[1] * len;
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx - d[0] * s + d[1] * s * 0.7, hy - d[1] * s + d[0] * s * 0.7);
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx - d[0] * s - d[1] * s * 0.7, hy - d[1] * s - d[0] * s * 0.7);
      }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (cfg.detail === 'detailed') { // dark keyline keeps the arrow crisp on any theme
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = (width || 3) + Math.max(1.2, st.cs * 0.035);
        path(); ctx.stroke();
      }
      ctx.strokeStyle = color; ctx.lineWidth = width || 3;
      path(); ctx.stroke();
    }

    function label(text, cx, cy, color, size, keyline) {
      ctx.font = 'bold ' + (size || Math.round(st.cs * 0.32)) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (keyline && cfg.detail === 'detailed') {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillText(text, cx + st.cs * 0.02, cy + st.cs * 0.025);
      }
      ctx.fillStyle = color;
      ctx.fillText(text, cx, cy);
    }

    function good(it, cx, cy) {
      var cs = st.cs;
      var meta = Content.GOOD_META[it.t] || { color: '#ffd166', name: it.t };
      var r = cs * 0.17;
      if (st.tween && st.tween.from[it.id]) {
        var f = ease((nowMs() - st.tween.start) / st.tween.dur), p0 = st.tween.from[it.id];
        cx = p0[0] + (cx - p0[0]) * f; cy = p0[1] + (cy - p0[1]) * f;
      }
      if (cfg.shadows !== 'off') {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath(); ctx.ellipse(cx + r * 0.25, cy + r * 0.45, r * 0.95, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      }
      if (cfg.detail === 'detailed') {
        var gr = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.1, cx, cy, r);
        gr.addColorStop(0, shade(meta.color, 0.45)); gr.addColorStop(0.55, meta.color); gr.addColorStop(1, shade(meta.color, -0.28));
        ctx.fillStyle = gr;
      } else ctx.fillStyle = meta.color;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    function beltBody(x, y, cell, th, roll) {
      var cs = st.cs, bx = x * cs + cs * 0.12, by = y * cs + cs * 0.12, bw = cs * 0.76;
      block(bx, by, bw, bw, th.belt, { shadowScale: 0.5, flat: true });
      if (cfg.detail !== 'detailed') return;
      var d = Rules.DIRS[cell.dir] || Rules.DIRS.E;
      var horiz = d[0] !== 0;
      ctx.save();
      ctx.beginPath(); ctx.rect(bx, by, bw, bw); ctx.clip();
      // rollers across the direction of travel, sliding one pitch per tick
      var pitch = bw / 4, off = roll * pitch;
      ctx.strokeStyle = shade(th.belt, 0.22, 0.55); ctx.lineWidth = Math.max(1, cs * 0.035);
      for (var i = -1; i <= 4; i++) {
        var o = i * pitch + off * (horiz ? d[0] : d[1]);
        ctx.beginPath();
        if (horiz) { ctx.moveTo(bx + o, by); ctx.lineTo(bx + o, by + bw); }
        else { ctx.moveTo(bx, by + o); ctx.lineTo(bx + bw, by + o); }
        ctx.stroke();
      }
      // side rails
      var rail = cs * 0.07;
      ctx.fillStyle = shade(th.belt, -0.35);
      if (horiz) { ctx.fillRect(bx, by, bw, rail); ctx.fillRect(bx, by + bw - rail, bw, rail); }
      else { ctx.fillRect(bx, by, rail, bw); ctx.fillRect(bx + bw - rail, by, rail, bw); }
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      if (horiz) ctx.fillRect(bx, by, bw, Math.max(0.8, rail * 0.35)); else ctx.fillRect(bx, by, Math.max(0.8, rail * 0.35), bw);
      ctx.restore();
    }

    function glow(x, y, r, color, a) { st.glows.push({ x: x, y: y, r: r, color: color, a: a }); }

    function drawGlows() {
      if (!st.glows.length) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < st.glows.length; i++) {
        var g = st.glows[i];
        var rg = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r);
        rg.addColorStop(0, rgba(g.color, g.a)); rg.addColorStop(1, rgba(g.color, 0));
        ctx.fillStyle = rg;
        ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
      }
      ctx.restore();
    }

    function drawGrade() {
      var w = st.lw, h = st.lh;
      var lg = ctx.createLinearGradient(0, 0, w, h);
      lg.addColorStop(0, 'rgba(255,238,200,0.10)'); lg.addColorStop(0.5, 'rgba(255,238,200,0)');
      lg.addColorStop(1, 'rgba(30,20,60,0.10)');
      ctx.fillStyle = lg; ctx.fillRect(0, 0, w, h);
      var R = Math.sqrt(w * w + h * h) / 2;
      var vg = ctx.createRadialGradient(w / 2, h / 2, R * 0.62, w / 2, h / 2, R);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.2)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
    }

    function drawClouds(t) {
      var w = st.lw, h = st.lh, cs = st.cs;
      for (var i = 0; i < 3; i++) {
        var speed = cs * (0.12 + i * 0.05);
        var span = w + cs * 6;
        var cx = ((t / 1000) * speed + i * span / 3) % span - cs * 3;
        var cy = h * (0.2 + i * 0.3);
        var rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cs * 2.6);
        rg.addColorStop(0, 'rgba(10,20,30,0.10)'); rg.addColorStop(1, 'rgba(10,20,30,0)');
        ctx.fillStyle = rg;
        ctx.save(); ctx.translate(cx, cy); ctx.scale(1.6, 1); ctx.translate(-cx, -cy);
        ctx.fillRect(cx - cs * 2.6, cy - cs * 2.6, cs * 5.2, cs * 5.2);
        ctx.restore();
      }
    }

    function drawWaterShimmer(state, th, t) {
      var cs = st.cs, terrain = state.cfg.terrain || [];
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = Math.max(0.8, cs * 0.025); ctx.lineCap = 'round';
      for (var i = 0; i < terrain.length; i++) {
        var tt = terrain[i];
        if (tt.k !== 'water') continue;
        for (var j = 0; j < 2; j++) {
          var ph = (t / 1000) * 0.8 + (tt.x * 1.7 + tt.y * 2.3 + j * 3.1);
          var a = 0.5 + 0.5 * Math.sin(ph * 2);
          ctx.globalAlpha = a * 0.8;
          var x0 = tt.x * cs + cs * (0.2 + 0.45 * ((Math.sin(ph) + 1) / 2)), y0 = tt.y * cs + cs * (0.35 + j * 0.3);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + cs * 0.14, y0); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // ---------- main draw ----------
    function draw(tNow) {
      if (st.destroyed || !ctx) return;
      var state = opts.getState();
      if (!state) return;
      if (!canvas.width || canvas.clientWidth !== st.cssW) sizeCanvas();
      var t = tNow != null ? tNow : nowMs();
      var th = Content.THEMES[state.cfg.theme] || Content.THEMES.meadow;
      var cs = st.cs, cols = state.cfg.board.cols, rows = state.cfg.board.rows;
      st.glows = [];
      if (st.tween && t - st.tween.start >= st.tween.dur) st.tween = null;
      var roll = 0;
      if (st.rollT < 1) {
        st.rollT = Math.min(1, (t - st.rollStart) / st.rollDur);
        roll = ease(st.rollT);
        if (st.rollT >= 1) roll = 0; // a full pitch looks identical to no offset
      }
      var animated = cfg.animation === 'animated';

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      var key = terrainKey(state);
      if (key !== st.staticKey) { buildStatic(state, th); st.staticKey = key; }
      ctx.drawImage(st.staticLayer, 0, 0);
      ctx.setTransform(st.k, 0, 0, st.k, 0, 0);

      try {
        if (animated && st.hasWater && cfg.detail === 'detailed') drawWaterShimmer(state, th, t);
        if (animated && cfg.grade === 'on') drawClouds(t);
      } catch (e) { fail(); }

      var x, y, cell;
      // belts and sources (under machines)
      for (y = 0; y < rows; y++) for (x = 0; x < cols; x++) {
        cell = state.grid[y][x];
        if (!cell) continue;
        var cx = x * cs + cs / 2, cy = y * cs + cs / 2;
        if (cell.k === 'belt') {
          beltBody(x, y, cell, th, roll);
          arrow(cx, cy, cell.dir, cs * 0.26, th.accent, Math.max(2, cs * 0.07));
        } else if (cell.k === 'source') {
          var meta = Content.GOOD_META[cell.item] || { color: '#ccc', name: cell.item };
          block(x * cs + cs * 0.08, y * cs + cs * 0.08, cs * 0.84, cs * 0.84, '#3b3f45');
          block(x * cs + cs * 0.2, y * cs + cs * 0.2, cs * 0.6, cs * 0.6, meta.color, { shadowScale: 0 });
          if (cfg.detail === 'detailed') {
            ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = Math.max(1, cs * 0.03);
            ctx.strokeRect(x * cs + cs * 0.2, y * cs + cs * 0.2, cs * 0.6, cs * 0.6);
          }
          label(meta.name.charAt(0), cx, cy - cs * 0.05, '#1b1b1b', Math.round(cs * 0.3));
          arrow(cx, cy + cs * 0.28, cell.dir, cs * 0.14, '#f4f4f4', Math.max(2, cs * 0.06));
        }
      }
      // goods on belts/sources drawn after all belts so gliding goods pass over neighbours
      for (y = 0; y < rows; y++) for (x = 0; x < cols; x++) {
        cell = state.grid[y][x];
        if (cell && (cell.k === 'belt' || cell.k === 'source') && cell.itemRef) good(cell.itemRef, x * cs + cs / 2, y * cs + cs / 2);
      }

      // machines
      for (y = 0; y < rows; y++) for (x = 0; x < cols; x++) {
        var m = state.grid[y][x];
        if (!m || m.k !== 'machine') continue;
        var mx = x * cs, my = y * cs, mcx = mx + cs / 2, mcy = my + cs / 2;
        block(mx + cs * 0.08, my + cs * 0.08, cs * 0.84, cs * 0.84, '#5b3f7a');
        ctx.strokeStyle = m.level >= 3 ? '#e74c3c' : (m.level >= 2 ? '#f1c40f' : '#2b1d3a');
        ctx.lineWidth = m.level >= 2 ? 3 : 2;
        ctx.strokeRect(mx + cs * 0.08, my + cs * 0.08, cs * 0.84, cs * 0.84);
        var rec = Rules.recipeById(state.cfg, m.recipe);
        var working = !!(m.inBuf && !m.outBuf);
        if (working && cfg.bloom === 'on') {
          var pulse = animated ? 0.75 + 0.25 * Math.sin(t / 260 + x * 1.3 + y) : 1;
          glow(mcx, mcy - cs * 0.06, cs * 0.42, '#ffb35c', 0.32 * pulse);
        }
        if (cfg.detail === 'detailed' && rec && m.prog > 0) {
          var pt = Rules.processTime(rec, m.level), fr = Math.min(1, m.prog / pt);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(mx + cs * 0.16, my + cs * 0.8, cs * 0.68, cs * 0.05);
          ctx.fillStyle = '#ffd166';
          ctx.fillRect(mx + cs * 0.16, my + cs * 0.8, cs * 0.68 * fr, cs * 0.05);
        }
        label(rec ? rec.name.charAt(0) : '?', mcx, mcy - cs * 0.06, '#ffffff', null, true);
        label('L' + m.level, mcx, mcy + cs * 0.26, '#ded3ea', Math.round(cs * 0.2));
        var dv = Rules.DIRS[m.dir] || [1, 0];
        arrow(mcx + dv[0] * cs * 0.3, mcy + dv[1] * cs * 0.3, m.dir, cs * 0.1, '#ffd166', 2);
        if (m.inBuf) good(m.inBuf, mx + cs * 0.24, my + cs * 0.24);
        if (m.outBuf) good(m.outBuf, mx + cs * 0.76, my + cs * 0.76);
      }

      // Exchange
      var sx = state.cfg.sink.x * cs, sy = state.cfg.sink.y * cs, scx = sx + cs / 2, scy = sy + cs / 2;
      block(sx + cs * 0.06, sy + cs * 0.06, cs * 0.88, cs * 0.88, '#b5342a');
      if (cfg.detail === 'detailed') { // striped awning along the top edge
        for (var s = 0; s < 6; s++) {
          ctx.fillStyle = s % 2 ? '#8e2219' : '#e9d6b0';
          ctx.fillRect(sx + cs * 0.06 + s * cs * 0.88 / 6, sy + cs * 0.06, cs * 0.88 / 6, cs * 0.14);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(sx + cs * 0.06, sy + cs * 0.2, cs * 0.88, cs * 0.03);
      }
      if (cfg.bloom === 'on') glow(scx, scy + cs * 0.04, cs * (0.5 + 0.25 * st.flash), '#ffd98a', 0.22 + 0.4 * st.flash);
      label('$', scx, scy + (cfg.detail === 'detailed' ? cs * 0.05 : 0), '#ffe9c4', Math.round(cs * 0.45), true);

      if (st.particles.length) drawParticles();

      if (cfg.post && !st.failed) {
        try {
          if (cfg.bloom === 'on') drawGlows();
          if (cfg.grade === 'on') drawGrade();
        } catch (e2) { fail(); }
      }

      // selection highlight, drawn last and never graded
      var sel = opts.getSelected && opts.getSelected();
      if (sel) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
        ctx.strokeRect(sel.x * cs + 2, sel.y * cs + 2, cs - 4, cs - 4);
        ctx.strokeStyle = '#101010'; ctx.lineWidth = 1;
        ctx.strokeRect(sel.x * cs + 4, sel.y * cs + 4, cs - 8, cs - 8);
      }
    }

    function fail() {
      if (st.failed) return;
      st.failed = true;
      if (opts.onFail) opts.onFail();
    }

    // ---------- frame loop (only when something moves) ----------
    function busy() {
      if (cfg.showFps) return true;
      if (st.tween || st.rollT < 1 || st.particles.length || st.flash > 0.01) return true;
      if (cfg.animation === 'animated' && ((st.hasWater && cfg.detail === 'detailed') || cfg.grade === 'on')) return true;
      if (cfg.bloom === 'on' && cfg.animation === 'animated') return true; // pulsing furnace windows
      return false;
    }
    function shouldLoop() {
      return cfg.loop && !st.destroyed && canvas.isConnected && !(root.document && root.document.hidden) && busy();
    }
    function kick() {
      if (!st.raf && shouldLoop()) { st.lastFrame = 0; st.raf = root.requestAnimationFrame(frame); }
    }
    function frame(t) {
      st.raf = 0;
      if (st.destroyed || !canvas.isConnected) return;
      var dtMs = st.lastFrame ? t - st.lastFrame : 16;
      st.lastFrame = t;
      var dt = Math.min(0.05, dtMs / 1000);
      if (st.flash > 0) st.flash = Math.max(0, st.flash - dt * 2.2);
      if (st.particles.length) stepParticles(dt);
      draw(t);
      if (dtMs > 0 && dtMs < 250) {
        st.samples.push(dtMs);
        st.fpsFrames++;
        if (st.samples.length >= 90) {
          var sum = 0;
          for (var i = 0; i < st.samples.length; i++) sum += st.samples[i];
          var avg = sum / st.samples.length;
          st.samples = [];
          if (cfg.adaptive) {
            var next = Gfx.adaptStep(shared.adaptive, avg);
            if (next !== shared.adaptive) { shared.adaptive = next; sizeCanvas(); }
          }
        }
        if (!st.fpsAt) st.fpsAt = t;
        if (t - st.fpsAt >= 500) {
          if (opts.onFps) opts.onFps(Math.round(st.fpsFrames * 1000 / (t - st.fpsAt)), (t - st.fpsAt) / st.fpsFrames);
          st.fpsAt = t; st.fpsFrames = 0;
        }
      }
      if (shouldLoop()) st.raf = root.requestAnimationFrame(frame);
      else { st.fpsAt = 0; st.fpsFrames = 0; }
    }

    function setConfig(resolved) {
      cfg = resolved;
      if (!cfg.adaptive) shared.adaptive = 1;
      canvas.setAttribute('data-gfx-preset', cfg.preset);
      if (cfg.particles === 'off') st.particles = [];
      if (cfg.animation !== 'animated') { st.tween = null; st.rollT = 1; }
      st.staticKey = '';
      sizeCanvas();
      draw();
      kick();
    }

    function destroy() {
      st.destroyed = true;
      if (st.raf) root.cancelAnimationFrame(st.raf);
      st.raf = 0;
      if (ro) ro.disconnect();
      if (offScale) offScale();
      if (root.document) root.document.removeEventListener('visibilitychange', onVis);
    }

    function pixels() { return [canvas.width, canvas.height]; }

    function onVis() { if (!st.destroyed) kick(); }
    if (root.document) root.document.addEventListener('visibilitychange', onVis);

    return {
      canvas: canvas,
      setConfig: setConfig,
      update: update,
      noteTick: noteTick,
      events: events,
      draw: draw,
      resize: function () { sizeCanvas(); draw(); },
      destroy: destroy,
      pixels: pixels,
      failed: function () { return st.failed; }
    };
  }

  return { create: create };
});
