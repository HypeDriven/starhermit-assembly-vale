// The board, as the browser build's js/board.js drew it on a 2D canvas: a
// tabletop diorama of the rules state — the checkered terrain with grass
// tufts, flowers, rocks and water, belts with rollers and rails, mines,
// machines with their level rims, progress bars and furnace glow, the
// Exchange with its awning, goods gliding between cells, particles (sale
// coins, craft steam and sparks, mine dust, spoil splats, upgrade sparks,
// confetti), glow, the colour grade, drifting cloud shadows and the
// selection. Every effect follows the look of the runtime's quality tier
// (js/gfx.js) and the player's reduced motion.
//
// The static terrain is painted once per board and size into a
// starhermit:canvas OffscreenCanvas and drawn as one image; everything that
// changes is drawn each frame with starhermit:draw primitives and small
// pre-painted sprites (goods, glows, soft shadows, clouds, bevel shading):
// the engine rasterizes canvases on the CPU, so a per-frame canvas repaint
// would cost far more than the overlay's primitives. Differences from the
// browser build: glows blend normally (the overlay has no additive
// `lighter` mode), drop shadows are pre-blurred sprites, and the terrain's
// CSS `filter: saturate() contrast()` (not supported by engine canvases) is
// left out.
//
// Drawing uses the browser build's logical units (a cell is `cellSize(cfg)`,
// 28–64 units) scaled to the board's rectangle on screen, so line widths and
// proportions match the old canvas at any size.
import { frame, levels, levelSettings, preferences, type GraphicsLevel } from "starhermit:engine";
import { OffscreenCanvas, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import * as draw from "starhermit:draw";
import { loadClassic } from "starhermit:script";
import { Content, Rules, type Cell, type Cfg, type Dir, type Item, type RulesEvent, type State } from "./rules.js";

loadClassic("js/gfx.js");

interface Budget { maxDpr: number; tufts: number; flowers: number; particles: number; burst: number; clouds: number; glows: number }
export interface Look {
  preset: "low" | "balanced" | "high" | "ultra";
  shadows: "off" | "low" | "medium" | "high";
  detail: "plain" | "detailed";
  bloom: "off" | "on";
  grade: "off" | "on";
  particles: "off" | "low" | "high";
  animation: "static" | "animated";
  post: boolean;
  budget: Budget;
}
const Gfx = (globalThis as unknown as { AVGfx: { resolve(preset: string, env: { reducedMotion: boolean; k: number }): Look } }).AVGfx;

/** The level's speed over the slowest level of its tier (budgets grow ≤ 2× within a tier). */
function tierScale(level: GraphicsLevel): number {
  const mine = levelSettings(level);
  const floor = levels.map((l) => levelSettings(l)).find((s) => s.quality === mine.quality) ?? mine;
  return floor.teraflops > 0 ? mine.teraflops / floor.teraflops : 1;
}
let lookKey = "";
let look: Look = Gfx.resolve("balanced", { reducedMotion: false, k: 1 });
/** The effects for this frame's graphics level and motion preference. */
export function currentLook(): Look {
  const f = frame();
  const reduced = preferences().reducedMotion;
  const key = `${f.quality}/${f.level}/${reduced}`;
  if (key !== lookKey) {
    lookKey = key;
    look = Gfx.resolve(f.quality, { reducedMotion: reduced, k: tierScale(f.level) });
    if (look.particles === "off") particles = [];
    if (look.animation !== "animated") { tween = null; rollT = 1; }
  }
  return look;
}

// -- Small helpers ------------------------------------------------------------------
function hash3(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return h >>> 0;
}
function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function parseHex(hex: string): [number, number, number] {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h[0]! + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** amt > 0 mixes toward white, < 0 toward black. */
function shade(hex: string, amt: number, alpha?: number): string {
  const c = parseHex(hex), t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  const r = Math.round(c[0] + (t - c[0]) * p), g = Math.round(c[1] + (t - c[1]) * p), b = Math.round(c[2] + (t - c[2]) * p);
  return alpha == null ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}
function tint(hex: string, a: number): [number, number, number, number] {
  const c = parseHex(hex);
  return [c[0] / 255, c[1] / 255, c[2] / 255, Math.max(0, Math.min(1, a))];
}
function ease(t: number): number { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }
function nowMs(): number { return frame().time * 1000; }

const SHADOW = {
  low: { blur: 0, off: 0.05, a: 0.32 },
  medium: { blur: 0.12, off: 0.06, a: 0.38 },
  high: { blur: 0.2, off: 0.08, a: 0.42 },
};

/** The browser build's logical cell size for a board (its drawing unit). */
export function cellSize(cfg: Cfg): number {
  const cols = cfg.board.cols, rows = cfg.board.rows;
  return Math.max(28, Math.min(64, Math.floor(640 / cols), Math.floor(512 / rows)));
}

// -- Sprites (painted once) ------------------------------------------------------------
interface Sprites { disc: OffscreenCanvas; glow: OffscreenCanvas; soft: Record<string, OffscreenCanvas>; cloud: OffscreenCanvas; bevel: OffscreenCanvas; pixel: OffscreenCanvas }
let sprites: Sprites | null = null;
const SOFT = 128, SOFT_IN = 64; // the soft-shadow sprite: a 64 px square in a 128 px canvas
function paintSprites(): Sprites {
  const disc = new OffscreenCanvas(64, 64);
  const d = disc.getContext("2d");
  d.fillStyle = "#ffffff";
  d.beginPath(); d.arc(32, 32, 31, 0, Math.PI * 2); d.fill();

  const glow = new OffscreenCanvas(64, 64);
  const g = glow.getContext("2d");
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, "rgba(255,255,255,1)"); rg.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);

  const soft: Record<string, OffscreenCanvas> = {};
  for (const [name, blur] of [["medium", 9], ["high", 15]] as const) {
    const c = new OffscreenCanvas(SOFT, SOFT);
    const x = c.getContext("2d");
    x.shadowColor = "#000000"; x.shadowBlur = blur; x.shadowOffsetX = 1000;
    x.fillStyle = "#000000";
    x.fillRect((SOFT - SOFT_IN) / 2 - 1000, (SOFT - SOFT_IN) / 2, SOFT_IN, SOFT_IN);
    soft[name] = c;
  }

  const cloud = new OffscreenCanvas(64, 64);
  const cl = cloud.getContext("2d");
  const cg = cl.createRadialGradient(32, 32, 0, 32, 32, 32);
  cg.addColorStop(0, "rgba(10,20,30,0.10)"); cg.addColorStop(1, "rgba(10,20,30,0)");
  cl.fillStyle = cg; cl.fillRect(0, 0, 64, 64);

  // The bevel's top-to-bottom shading (white 10 % to black 12 %).
  const bevel = new OffscreenCanvas(4, 64);
  const b = bevel.getContext("2d");
  const lg = b.createLinearGradient(0, 0, 0, 64);
  lg.addColorStop(0, "rgba(255,255,255,0.10)"); lg.addColorStop(1, "rgba(0,0,0,0.12)");
  b.fillStyle = lg; b.fillRect(0, 0, 4, 64);

  const pixel = new OffscreenCanvas(2, 2);
  const p = pixel.getContext("2d");
  p.fillStyle = "#ffffff"; p.fillRect(0, 0, 2, 2);
  return { disc, glow, soft, cloud, bevel, pixel };
}

// Shaded goods, one sprite per colour and detail.
const goodSprites = new Map<string, OffscreenCanvas>();
function goodSprite(color: string, detailed: boolean): OffscreenCanvas {
  const key = `${color}/${detailed}`;
  let c = goodSprites.get(key);
  if (c) return c;
  c = new OffscreenCanvas(64, 64);
  const x = c.getContext("2d");
  const r = 29;
  if (detailed) {
    const gr = x.createRadialGradient(32 - r * 0.4, 32 - r * 0.45, r * 0.1, 32, 32, r);
    gr.addColorStop(0, shade(color, 0.45)); gr.addColorStop(0.55, color); gr.addColorStop(1, shade(color, -0.28));
    x.fillStyle = gr;
  } else x.fillStyle = color;
  x.beginPath(); x.arc(32, 32, r, 0, Math.PI * 2); x.fill();
  x.strokeStyle = "#1b1b1b"; x.lineWidth = 4.5; x.stroke();
  goodSprites.set(key, c);
  return c;
}

// -- Renderer state ------------------------------------------------------------------
interface Particle {
  kind: "coin" | "confetti" | "puff" | "spark" | "dust" | "drop";
  x: number; y: number; vx: number; vy: number; g?: number; drag?: number;
  life: number; max: number; size: number; grow?: number; color: string; alpha?: number; glow?: boolean; spin?: number;
}
let lastState: State | null = null;
let pos: Record<number, [number, number]> = {};
let tween: { from: Record<number, [number, number]>; start: number; dur: number } | null = null;
let rollT = 1, rollStart = 0, rollDur = 170;
let particles: Particle[] = [];
let flash = 0;
let glows: { x: number; y: number; r: number; color: string; a: number }[] = [];
let tweenMsFn: () => number = () => 170;

/** The glide length source (game.ts: shorter while auto-run runs). */
export function setTweenSource(fn: () => number): void { tweenMsFn = fn; }

function itemPositions(state: State): Record<number, [number, number]> {
  const cs = cellSize(state.cfg), out: Record<number, [number, number]> = {};
  for (let y = 0; y < state.cfg.board.rows; y++) for (let x = 0; x < state.cfg.board.cols; x++) {
    const c = state.grid[y]![x];
    if (!c) continue;
    if ((c.k === "belt" || c.k === "source") && c.itemRef) out[c.itemRef.id] = [x * cs + cs / 2, y * cs + cs / 2];
    else if (c.k === "machine") {
      if (c.inBuf) out[c.inBuf.id] = [x * cs + cs * 0.24, y * cs + cs * 0.24];
      if (c.outBuf) out[c.outBuf.id] = [x * cs + cs * 0.76, y * cs + cs * 0.76];
    }
  }
  return out;
}

/** A new round: no glides or particles carried over. */
export function reset(state: State): void {
  lastState = state;
  pos = itemPositions(state);
  tween = null; rollT = 1; particles = []; flash = 0;
}

/** After every rules change: start glides (a tick moves goods) and the events' particles. */
export function changed(state: State, events: RulesEvent[], ticked: boolean): void {
  const L = currentLook();
  const next = itemPositions(state);
  if (state !== lastState && L.animation === "animated" && lastState && ticked) {
    const from: Record<number, [number, number]> = {};
    let any = false;
    for (const id in next) {
      const p0 = pos[id];
      if (p0 && (p0[0] !== next[id]![0] || p0[1] !== next[id]![1])) { from[id] = p0; any = true; }
    }
    const dur = Math.max(60, Math.min(220, tweenMsFn()));
    tween = any ? { from, start: nowMs(), dur } : null;
    rollT = 0; rollStart = nowMs(); rollDur = dur;
  }
  pos = next;
  lastState = state;
  burstEvents(state, events, L);
}

function addParticle(p: Particle, L: Look): void {
  const cap = L.budget.particles;
  while (particles.length >= cap) particles.shift();
  particles.push(p);
}
function burst(n: number, x: number, y: number, L: Look, make: (r: () => number, i: number) => Particle): void {
  const r = rngFrom(hash3(Math.round(x), Math.round(y), particles.length + Math.round(nowMs())));
  for (let i = 0; i < n; i++) addParticle(make(r, i), L);
}

function burstEvents(state: State, evts: RulesEvent[], L: Look): void {
  if (L.particles === "off") {
    if (L.animation === "animated") for (const e of evts) if (e.type === "deliver") flash = 1;
    return;
  }
  const cs = cellSize(state.cfg), mul = (L.particles === "high" ? 1 : 0.5) * L.budget.burst;
  const sink = state.cfg.sink, sx = sink.x * cs + cs / 2, sy = sink.y * cs + cs / 2;
  for (const e of evts) {
    const cx = e.x != null ? e.x * cs + cs / 2 : sx, cy = e.y != null ? e.y * cs + cs / 2 : sy;
    if (e.type === "deliver") {
      flash = 1;
      burst(Math.round(10 * mul), sx, sy, L, (r) => {
        const a = -Math.PI / 2 + (r() - 0.5) * 1.9, v = cs * (1.6 + r() * 1.6);
        return { kind: "coin", x: sx + (r() - 0.5) * cs * 0.3, y: sy - cs * 0.1, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: cs * 5.5,
          life: 0, max: 0.7 + r() * 0.35, size: cs * (0.05 + r() * 0.035), color: r() < 0.7 ? "#ffd166" : "#fff3c4", glow: true };
      });
    } else if (e.type === "contract-complete") {
      const conf = ["#ffd166", "#7fd48f", "#7fa8d9", "#ff9b8a", "#f4f4f4", "#b07fd9"];
      burst(Math.round(30 * mul), sx, sy, L, (r) => {
        const a = r() * Math.PI * 2, v = cs * (1.4 + r() * 2.4);
        return { kind: "confetti", x: sx, y: sy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - cs * 1.5, g: cs * 4, drag: 1.6,
          life: 0, max: 1.1 + r() * 0.6, size: cs * (0.04 + r() * 0.03), color: conf[(r() * conf.length) | 0]!, spin: r() * 6 };
      });
    } else if (e.type === "craft") {
      const meta = Content.GOOD_META[e.item ?? ""] ?? { color: "#ffd166" };
      burst(Math.round(4 * mul), cx, cy, L, (r) => ({ kind: "puff", x: cx + (r() - 0.5) * cs * 0.4, y: cy - cs * 0.3, vx: (r() - 0.5) * cs * 0.25, vy: -cs * (0.25 + r() * 0.25),
        life: 0, max: 0.7 + r() * 0.4, size: cs * (0.05 + r() * 0.04), grow: cs * 0.1, color: "#eef0f2", alpha: 0.28 }));
      burst(Math.round(6 * mul), cx, cy, L, (r) => {
        const a = r() * Math.PI * 2, v = cs * (0.9 + r() * 1.2);
        return { kind: "spark", x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: cs * 2, life: 0, max: 0.35 + r() * 0.25,
          size: cs * 0.035, color: meta.color, glow: true };
      });
    } else if (e.type === "spawn") {
      burst(Math.round(4 * mul), cx, cy, L, (r) => ({ kind: "dust", x: cx + (r() - 0.5) * cs * 0.5, y: cy + cs * 0.3, vx: (r() - 0.5) * cs * 0.6, vy: -cs * (0.2 + r() * 0.3),
        life: 0, max: 0.5 + r() * 0.3, size: cs * (0.04 + r() * 0.03), grow: cs * 0.06, color: "#c9b79a" }));
    } else if (e.type === "spoil") {
      burst(Math.round(8 * mul), cx, cy, L, (r) => {
        const a = r() * Math.PI * 2, v = cs * (0.6 + r() * 1.0);
        return { kind: "drop", x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - cs * 0.4, g: cs * 4, life: 0, max: 0.5 + r() * 0.3,
          size: cs * (0.04 + r() * 0.03), color: "#3a2a22" };
      });
    } else if (e.type === "place" || e.type === "remove") {
      burst(Math.round(8 * mul), cx, cy, L, (r, k) => {
        const a = (k / 8) * Math.PI * 2 + r() * 0.4, v = cs * (0.8 + r() * 0.4);
        return { kind: "dust", x: cx + Math.cos(a) * cs * 0.3, y: cy + Math.sin(a) * cs * 0.3, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 4,
          life: 0, max: 0.45 + r() * 0.2, size: cs * 0.045, grow: cs * 0.08, color: "#d8cdb4" };
      });
    } else if (e.type === "upgrade") {
      burst(Math.round(14 * mul), cx, cy, L, (r, k) => {
        const a = (k / 14) * Math.PI * 2, v = cs * (1.2 + r() * 0.5);
        return { kind: "spark", x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 2.5, life: 0, max: 0.55 + r() * 0.2,
          size: cs * 0.04, color: "#ffd166", glow: true };
      });
    }
  }
}

function stepParticles(dt: number): void {
  const keep: Particle[] = [];
  for (const p of particles) {
    p.life += dt;
    if (p.life >= p.max) continue;
    if (p.drag) { const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d; }
    if (p.g) p.vy += p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    keep.push(p);
  }
  particles = keep;
}

// -- The terrain layer (cached) ---------------------------------------------------------
type Theme = (typeof Content.THEMES)[string];
let layer: OffscreenCanvas | null = null;
let layerKey = "";
let wantKey = "";
let wantSince = 0;
let hasWater = false;

function paintTerrain(state: State, th: Theme, L: Look, w: number, h: number): OffscreenCanvas {
  const cfg = state.cfg, cs = cellSize(cfg), cols = cfg.board.cols, rows = cfg.board.rows;
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext("2d", { alpha: false });
  g.setTransform(w / (cols * cs), 0, 0, h / (rows * cs), 0, 0);
  const detailed = L.detail === "detailed";
  const B = L.budget;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    g.fillStyle = (x + y) % 2 === 0 ? th.tileA : th.tileB;
    g.fillRect(x * cs, y * cs, cs + 0.5, cs + 0.5);
  }
  const seed = hash3(cfg.seed || 1, cols, rows);
  if (detailed) {
    // soft light falloff per tile + grass tufts and specks
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const base = (x + y) % 2 === 0 ? th.tileA : th.tileB;
      const r = rngFrom(hash3(seed, x, y));
      const gr = g.createLinearGradient(x * cs, y * cs, x * cs + cs, y * cs + cs);
      gr.addColorStop(0, "rgba(255,255,255,0.07)"); gr.addColorStop(1, "rgba(0,0,0,0.06)");
      g.fillStyle = gr; g.fillRect(x * cs, y * cs, cs, cs);
      g.lineCap = "round"; g.lineWidth = Math.max(0.8, cs * 0.028);
      for (let i = 0; i < B.tufts; i++) {
        const tx = x * cs + cs * (0.08 + r() * 0.84), ty = y * cs + cs * (0.12 + r() * 0.8), hgt = cs * (0.05 + r() * 0.07);
        g.strokeStyle = r() < 0.5 ? shade(base, 0.16, 0.7) : shade(base, -0.14, 0.7);
        g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + (r() - 0.5) * hgt * 0.8, ty - hgt); g.stroke();
      }
      if (r() < B.flowers) {
        const fx = x * cs + cs * (0.15 + r() * 0.7), fy = y * cs + cs * (0.15 + r() * 0.7);
        g.fillStyle = shade(th.accent, 0.35, 0.55);
        g.beginPath(); g.arc(fx, fy, cs * 0.022, 0, Math.PI * 2); g.fill();
      }
    }
  }
  hasWater = false;
  for (const t of cfg.terrain ?? []) {
    const rx = t.x * cs, ry = t.y * cs;
    if (t.k === "water") hasWater = true;
    if (!detailed) {
      g.fillStyle = t.k === "water" ? th.water : th.rock;
      g.fillRect(rx + 1, ry + 1, cs - 2, cs - 2);
      continue;
    }
    const rr = rngFrom(hash3(seed, t.x + 101, t.y + 57));
    if (t.k === "water") {
      const wg = g.createLinearGradient(rx, ry, rx, ry + cs);
      wg.addColorStop(0, shade(th.water, 0.12)); wg.addColorStop(1, shade(th.water, -0.18));
      g.fillStyle = wg; g.fillRect(rx + 1, ry + 1, cs - 2, cs - 2);
      g.strokeStyle = shade(th.water, 0.4, 0.45); g.lineWidth = Math.max(0.8, cs * 0.03); g.lineCap = "round";
      for (let k = 0; k < 3; k++) {
        const wy = ry + cs * (0.25 + k * 0.25) + (rr() - 0.5) * cs * 0.06, wx = rx + cs * (0.15 + rr() * 0.3);
        g.beginPath(); g.moveTo(wx, wy); g.quadraticCurveTo(wx + cs * 0.12, wy - cs * 0.05, wx + cs * 0.24, wy); g.stroke();
      }
      g.strokeStyle = "rgba(255,255,255,0.18)"; g.lineWidth = Math.max(0.8, cs * 0.02);
      g.strokeRect(rx + 1.5, ry + 1.5, cs - 3, cs - 3);
    } else {
      g.fillStyle = shade(th.rock, -0.22);
      g.fillRect(rx + 1, ry + 1, cs - 2, cs - 2);
      // three boulders, lit from the top-left
      const bs = [[0.34, 0.62, 0.26], [0.68, 0.4, 0.22], [0.66, 0.74, 0.17]] as const;
      for (const b of bs) {
        const bx = rx + cs * (b[0] + (rr() - 0.5) * 0.08), by = ry + cs * (b[1] + (rr() - 0.5) * 0.08), br = cs * b[2];
        const rg = g.createRadialGradient(bx - br * 0.35, by - br * 0.4, br * 0.1, bx, by, br);
        rg.addColorStop(0, shade(th.rock, 0.35)); rg.addColorStop(0.6, th.rock); rg.addColorStop(1, shade(th.rock, -0.3));
        g.fillStyle = rg;
        g.beginPath(); g.ellipse(bx, by, br, br * 0.82, 0, 0, Math.PI * 2); g.fill();
      }
    }
  }
  return c;
}

// The colour grade: a sunlight wash and a vignette over the board, per size.
let gradeLayer: OffscreenCanvas | null = null;
let gradeKey = "";
function paintGrade(w: number, h: number): OffscreenCanvas {
  const c = new OffscreenCanvas(w, h);
  const x: OffscreenCanvasRenderingContext2D = c.getContext("2d");
  const lg = x.createLinearGradient(0, 0, w, h);
  lg.addColorStop(0, "rgba(255,238,200,0.10)"); lg.addColorStop(0.5, "rgba(255,238,200,0)");
  lg.addColorStop(1, "rgba(30,20,60,0.10)");
  x.fillStyle = lg; x.fillRect(0, 0, w, h);
  const R = Math.sqrt(w * w + h * h) / 2;
  const vg = x.createRadialGradient(w / 2, h / 2, R * 0.62, w / 2, h / 2, R);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.2)");
  x.fillStyle = vg; x.fillRect(0, 0, w, h);
  return c;
}

// -- Drawing (board units → window pixels) ----------------------------------------
let ox = 0, oy = 0, u = 1, csL = 32;
let clip: { x: number; y: number; width: number; height: number } = { x: 0, y: 0, width: 0, height: 0 };
let L: Look = look;
function X(v: number): number { return ox + v * u; }
function Y(v: number): number { return oy + v * u; }
function rect(x: number, y: number, w: number, h: number, color: string): void { draw.rect(X(x), Y(y), w * u, h * u, color, { clip }); }
function line(x1: number, y1: number, x2: number, y2: number, color: string, width: number, c = clip): void {
  draw.line(X(x1), Y(y1), X(x2), Y(y2), color, Math.max(1, width * u), { clip: c });
}
function disc(cx: number, cy: number, r: number, color: string, a = 1): void {
  draw.image(sprites!.disc, X(cx - r), Y(cy - r), r * 2 * u, r * 2 * u, { tint: tint(color, a), clip });
}
function strokeBox(x: number, y: number, w: number, h: number, color: string, width: number): void {
  // the canvas strokes on the edge: the overlay's outline sits inside, so grow it by half the width
  const lw = Math.max(1, width * u);
  draw.strokeRect(X(x) - lw / 2, Y(y) - lw / 2, w * u + lw, h * u + lw, color, lw, { clip });
}

function shadowFor(x: number, y: number, w: number, h: number, scale: number): void {
  if (L.shadows === "off" || scale === 0) return;
  const s = SHADOW[L.shadows], off = s.off * csL * scale;
  if (L.shadows === "low") { rect(x + off, y + off, w, h, `rgba(0,0,0,${s.a})`); return; }
  // the sprite's square is half its size: the blur spreads over the other half
  const sp = sprites!.soft[L.shadows]!;
  const k = SOFT / SOFT_IN;
  const bw = w * k, bh = h * k;
  draw.image(sp, X(x + off - (bw - w) / 2), Y(y + off - (bh - h) / 2), bw * u, bh * u, { tint: [1, 1, 1, s.a], clip });
}

/** A filled block with an optional drop shadow and bevel. */
function block(x: number, y: number, w: number, h: number, color: string, opt: { shadowScale?: number; flat?: boolean } = {}): void {
  shadowFor(x, y, w, h, opt.shadowScale ?? 1);
  rect(x, y, w, h, color);
  if (L.detail === "detailed" && !opt.flat) {
    const e = Math.max(1, csL * 0.05);
    draw.image(sprites!.bevel, X(x), Y(y), w * u, h * u, { clip });
    rect(x, y, w, e, "rgba(255,255,255,0.20)"); rect(x, y + e, e, h - e, "rgba(255,255,255,0.20)");
    rect(x, y + h - e, w, e, "rgba(0,0,0,0.26)"); rect(x + w - e, y, e, h - e, "rgba(0,0,0,0.26)");
  }
}

function arrow(cx: number, cy: number, dir: Dir | undefined, len: number, color: string, width: number): void {
  const d = Rules.DIRS[dir ?? "E"] ?? Rules.DIRS.E;
  const s = len * 0.55;
  const hx = cx + d[0] * len, hy = cy + d[1] * len;
  const segs: [number, number, number, number][] = [
    [cx - d[0] * len, cy - d[1] * len, hx, hy],
    [hx, hy, hx - d[0] * s + d[1] * s * 0.7, hy - d[1] * s + d[0] * s * 0.7],
    [hx, hy, hx - d[0] * s - d[1] * s * 0.7, hy - d[1] * s - d[0] * s * 0.7],
  ];
  const stroke = (c: string, w: number): void => {
    for (const g of segs) line(g[0], g[1], g[2], g[3], c, w);
    // round caps and joins
    for (const g of segs) { disc(g[0], g[1], w / 2, c); disc(g[2], g[3], w / 2, c); }
  };
  if (L.detail === "detailed") stroke("rgba(0,0,0,0.35)", width + Math.max(1.2, csL * 0.035)); // dark keyline keeps the arrow crisp on any theme
  stroke(color, width);
}

function label(text: string, cx: number, cy: number, color: string, size: number | null, keyline = false): void {
  const px = (size ?? Math.round(csL * 0.32)) * u;
  const m = draw.measureText(text, { size: px, weight: "bold", font: "system-ui" });
  const top = Y(cy) - m.height / 2;
  if (keyline && L.detail === "detailed") {
    draw.text(text, X(cx + csL * 0.02), top + csL * 0.025 * u, { size: px, weight: "bold", color: "rgba(0,0,0,0.35)", align: "center", clip });
  }
  draw.text(text, X(cx), top, { size: px, weight: "bold", color, align: "center", clip });
}

function good(it: Item, cx: number, cy: number): void {
  const meta = Content.GOOD_META[it.t] ?? { color: "#ffd166", name: it.t };
  const r = csL * 0.17;
  if (tween && tween.from[it.id]) {
    const f = ease((nowMs() - tween.start) / tween.dur), p0 = tween.from[it.id]!;
    cx = p0[0] + (cx - p0[0]) * f; cy = p0[1] + (cy - p0[1]) * f;
  }
  if (L.shadows !== "off") {
    draw.image(sprites!.disc, X(cx + r * 0.25 - r * 0.95), Y(cy + r * 0.45 - r * 0.7), r * 1.9 * u, r * 1.4 * u, { tint: [0, 0, 0, 0.28], clip });
  }
  const sp = goodSprite(meta.color, L.detail === "detailed");
  const k = 32 / 29; // the sprite's disc is 29 of its 32 px radius
  draw.image(sp, X(cx - r * k), Y(cy - r * k), r * k * 2 * u, r * k * 2 * u, { clip });
}

function beltBody(x: number, y: number, cell: Cell, th: Theme, roll: number): void {
  const cs = csL, bx = x * cs + cs * 0.12, by = y * cs + cs * 0.12, bw = cs * 0.76;
  block(bx, by, bw, bw, th.belt, { shadowScale: 0.5, flat: true });
  if (L.detail !== "detailed") return;
  const d = Rules.DIRS[cell.dir ?? "E"] ?? Rules.DIRS.E;
  const horiz = d[0] !== 0;
  const inner = { x: X(bx), y: Y(by), width: bw * u, height: bw * u };
  // rollers across the direction of travel, sliding one pitch per tick
  const pitch = bw / 4, off = roll * pitch;
  const col = shade(th.belt, 0.22, 0.55), lw = Math.max(1, cs * 0.035);
  for (let i = -1; i <= 4; i++) {
    const o = i * pitch + off * (horiz ? d[0] : d[1]);
    if (horiz) line(bx + o, by, bx + o, by + bw, col, lw, inner);
    else line(bx, by + o, bx + bw, by + o, col, lw, inner);
  }
  // side rails
  const rail = cs * 0.07;
  const railCol = shade(th.belt, -0.35);
  if (horiz) { rect(bx, by, bw, rail, railCol); rect(bx, by + bw - rail, bw, rail, railCol); }
  else { rect(bx, by, rail, bw, railCol); rect(bx + bw - rail, by, rail, bw, railCol); }
  const hi = Math.max(0.8, rail * 0.35);
  if (horiz) rect(bx, by, bw, hi, "rgba(255,255,255,0.12)"); else rect(bx, by, hi, bw, "rgba(255,255,255,0.12)");
}

function glow(x: number, y: number, r: number, color: string, a: number): void { glows.push({ x, y, r, color, a }); }
function drawGlows(): void {
  for (let i = 0; i < glows.length && i < L.budget.glows; i++) {
    const g = glows[i]!;
    draw.image(sprites!.glow, X(g.x - g.r), Y(g.y - g.r), g.r * 2 * u, g.r * 2 * u, { tint: tint(g.color, g.a), clip });
  }
}

function drawClouds(t: number, w: number, h: number): void {
  const cs = csL, n = L.budget.clouds;
  for (let i = 0; i < n; i++) {
    const speed = cs * (0.12 + i * 0.05);
    const span = w + cs * 6;
    const cx = ((t / 1000) * speed + i * span / n) % span - cs * 3;
    const cy = h * (0.2 + ((i * 0.3) % 0.9));
    const r = cs * 2.6;
    draw.image(sprites!.cloud, X(cx - r * 1.6), Y(cy - r), r * 3.2 * u, r * 2 * u, { clip });
  }
}

function drawWaterShimmer(state: State, t: number): void {
  const cs = csL;
  const lw = Math.max(0.8, cs * 0.025);
  for (const tt of state.cfg.terrain ?? []) {
    if (tt.k !== "water") continue;
    for (let j = 0; j < 2; j++) {
      const ph = (t / 1000) * 0.8 + (tt.x * 1.7 + tt.y * 2.3 + j * 3.1);
      const a = (0.5 + 0.5 * Math.sin(ph * 2)) * 0.8;
      const x0 = tt.x * cs + cs * (0.2 + 0.45 * ((Math.sin(ph) + 1) / 2)), y0 = tt.y * cs + cs * (0.35 + j * 0.3);
      line(x0, y0, x0 + cs * 0.14, y0, `rgba(255,255,255,${0.35 * a})`, lw);
    }
  }
}

/** Draws the board into a window rectangle (its aspect is the board's). */
export function drawBoard(state: State, r: { x: number; y: number; width: number; height: number }, sel: { x: number; y: number } | null,
  names: { good(id: string): string; recipe(id: string | undefined): string }): void {
  L = currentLook();
  if (!sprites) sprites = paintSprites();
  const cfg = state.cfg, cols = cfg.board.cols, rows = cfg.board.rows;
  csL = cellSize(cfg);
  const lw = cols * csL, lh = rows * csL;
  u = r.width / lw;
  ox = r.x; oy = r.y;
  clip = { x: r.x, y: r.y, width: r.width, height: r.height };
  const th = Content.THEMES[cfg.theme ?? "meadow"] ?? Content.THEMES.meadow!;
  const t = nowMs();
  const dt = Math.min(0.05, frame().delta);
  if (flash > 0) flash = Math.max(0, flash - dt * 2.2);
  if (particles.length) stepParticles(dt);
  glows = [];
  if (tween && t - tween.start >= tween.dur) tween = null;
  let roll = 0;
  if (rollT < 1) {
    rollT = Math.min(1, (t - rollStart) / rollDur);
    roll = ease(rollT);
    if (rollT >= 1) roll = 0; // a full pitch looks identical to no offset
  }
  const animated = L.animation === "animated";

  // The terrain: painted at the window's pixel ratio capped by the budget
  // (the browser build's backing store), repainted once a new size holds.
  const scale = frame().scale;
  const ratio = Math.min(scale, L.budget.maxDpr) / scale;
  let pw = Math.max(cols, Math.round(r.width * ratio)), ph = Math.max(rows, Math.round(r.height * ratio));
  const fit = Math.min(1, 4096 / pw, 4096 / ph, Math.sqrt(8388608 / (pw * ph)));
  pw = Math.floor(pw * fit); ph = Math.floor(ph * fit);
  const key = [cfg.id, cfg.theme, cols, rows, cfg.seed, (cfg.terrain ?? []).length, L.detail, L.budget.tufts, L.budget.flowers, pw, ph].join("|");
  if (key !== layerKey) {
    if (key !== wantKey) { wantKey = key; wantSince = t; }
    const sameBoard = layerKey.split("|").slice(0, 9).join("|") === key.split("|").slice(0, 9).join("|");
    if (!layer || !sameBoard || t - wantSince > 200) { layer = paintTerrain(state, th, L, pw, ph); layerKey = key; }
  }
  draw.image(layer!, r.x, r.y, r.width, r.height);

  if (animated && hasWater && L.detail === "detailed") drawWaterShimmer(state, t);
  if (animated && L.grade === "on") drawClouds(t, lw, lh);

  const cs = csL;
  // belts and sources (under machines)
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const cell = state.grid[y]![x];
    if (!cell) continue;
    const cx = x * cs + cs / 2, cy = y * cs + cs / 2;
    if (cell.k === "belt") {
      beltBody(x, y, cell, th, roll);
      arrow(cx, cy, cell.dir, cs * 0.26, th.accent, Math.max(2, cs * 0.07));
    } else if (cell.k === "source") {
      const meta = Content.GOOD_META[cell.item ?? ""] ?? { color: "#cccccc", name: cell.item ?? "" };
      block(x * cs + cs * 0.08, y * cs + cs * 0.08, cs * 0.84, cs * 0.84, "#3b3f45");
      block(x * cs + cs * 0.2, y * cs + cs * 0.2, cs * 0.6, cs * 0.6, meta.color, { shadowScale: 0 });
      if (L.detail === "detailed") strokeBox(x * cs + cs * 0.2, y * cs + cs * 0.2, cs * 0.6, cs * 0.6, "rgba(0,0,0,0.35)", Math.max(1, cs * 0.03));
      label(names.good(cell.item ?? "").charAt(0), cx, cy - cs * 0.05, "#1b1b1b", Math.round(cs * 0.3));
      arrow(cx, cy + cs * 0.28, cell.dir, cs * 0.14, "#f4f4f4", Math.max(2, cs * 0.06));
    }
  }
  // goods on belts/sources drawn after all belts so gliding goods pass over neighbours
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const cell = state.grid[y]![x];
    if (cell && (cell.k === "belt" || cell.k === "source") && cell.itemRef) good(cell.itemRef, x * cs + cs / 2, y * cs + cs / 2);
  }

  // machines
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const m = state.grid[y]![x];
    if (!m || m.k !== "machine") continue;
    const level = m.level ?? 1;
    const mx = x * cs, my = y * cs, mcx = mx + cs / 2, mcy = my + cs / 2;
    block(mx + cs * 0.08, my + cs * 0.08, cs * 0.84, cs * 0.84, "#5b3f7a");
    strokeBox(mx + cs * 0.08, my + cs * 0.08, cs * 0.84, cs * 0.84, level >= 3 ? "#e74c3c" : level >= 2 ? "#f1c40f" : "#2b1d3a", level >= 2 ? 3 : 2);
    const rec = Rules.recipeById(cfg, m.recipe);
    const working = !!(m.inBuf && !m.outBuf);
    if (working && L.bloom === "on") {
      const pulse = animated ? 0.75 + 0.25 * Math.sin(t / 260 + x * 1.3 + y) : 1;
      glow(mcx, mcy - cs * 0.06, cs * 0.42, "#ffb35c", 0.32 * pulse);
    }
    if (L.detail === "detailed" && rec && (m.prog ?? 0) > 0) {
      const pt = Rules.processTime(rec, level), fr = Math.min(1, (m.prog ?? 0) / pt);
      rect(mx + cs * 0.16, my + cs * 0.8, cs * 0.68, cs * 0.05, "rgba(0,0,0,0.35)");
      rect(mx + cs * 0.16, my + cs * 0.8, cs * 0.68 * fr, cs * 0.05, "#ffd166");
    }
    label(rec ? names.recipe(m.recipe).charAt(0) : "?", mcx, mcy - cs * 0.06, "#ffffff", null, true);
    label(`L${level}`, mcx, mcy + cs * 0.26, "#ded3ea", Math.round(cs * 0.2));
    const dv = Rules.DIRS[m.dir ?? "E"] ?? [1, 0];
    arrow(mcx + dv[0] * cs * 0.3, mcy + dv[1] * cs * 0.3, m.dir, cs * 0.1, "#ffd166", 2);
    if (m.inBuf) good(m.inBuf, mx + cs * 0.24, my + cs * 0.24);
    if (m.outBuf) good(m.outBuf, mx + cs * 0.76, my + cs * 0.76);
  }

  // Exchange
  const sx = cfg.sink.x * cs, sy = cfg.sink.y * cs, scx = sx + cs / 2, scy = sy + cs / 2;
  block(sx + cs * 0.06, sy + cs * 0.06, cs * 0.88, cs * 0.88, "#b5342a");
  if (L.detail === "detailed") { // striped awning along the top edge
    for (let s = 0; s < 6; s++) rect(sx + cs * 0.06 + s * cs * 0.88 / 6, sy + cs * 0.06, cs * 0.88 / 6, cs * 0.14, s % 2 ? "#8e2219" : "#e9d6b0");
    rect(sx + cs * 0.06, sy + cs * 0.2, cs * 0.88, cs * 0.03, "rgba(0,0,0,0.25)");
  }
  if (L.bloom === "on") glow(scx, scy + cs * 0.04, cs * (0.5 + 0.25 * flash), "#ffd98a", 0.22 + 0.4 * flash);
  label("$", scx, scy + (L.detail === "detailed" ? cs * 0.05 : 0), "#ffe9c4", Math.round(cs * 0.45), true);

  // particles
  for (const p of particles) {
    const f = p.life / p.max, a = 1 - f;
    const size = p.size + (p.grow ?? 0) * f;
    if (p.kind === "puff" || p.kind === "dust") disc(p.x, p.y, size, p.color, (p.alpha ?? 0.45) * a);
    else if (p.kind === "confetti") {
      const cx = X(p.x), cy = Y(p.y);
      draw.image(sprites.pixel, cx - size * u, cy - size * 0.5 * u, size * 2 * u, size * u,
        { tint: tint(p.color, Math.min(1, a * 1.5)), rotation: (p.spin ?? 0) * p.life * 3, origin: { x: cx, y: cy }, clip });
    } else {
      if (p.kind === "coin") disc(p.x, p.y, size * 1.17, "#78500a", 0.8 * a);
      disc(p.x, p.y, size, p.color, Math.min(1, a * 1.4));
    }
    if (p.glow) glows.push({ x: p.x, y: p.y, r: size * 4, color: p.color, a: 0.35 * a });
  }

  if (L.post) {
    if (L.bloom === "on") drawGlows();
    if (L.grade === "on") {
      const gk = `${Math.round(r.width / 8)}x${Math.round(r.height / 8)}`;
      if (gk !== gradeKey || !gradeLayer) { gradeLayer = paintGrade(Math.max(8, Math.round(r.width / 4)), Math.max(8, Math.round(r.height / 4))); gradeKey = gk; }
      draw.image(gradeLayer, r.x, r.y, r.width, r.height);
    }
  }

  // selection highlight, drawn last and never graded
  if (sel) {
    draw.strokeRect(X(sel.x * cs + 2) - 1.5 * u, Y(sel.y * cs + 2) - 1.5 * u, (cs - 4 + 3) * u, (cs - 4 + 3) * u, "#ffffff", Math.max(1, 3 * u), { clip });
    draw.strokeRect(X(sel.x * cs + 4) - 0.5 * u, Y(sel.y * cs + 4) - 0.5 * u, (cs - 8 + 1) * u, (cs - 8 + 1) * u, "#101010", Math.max(1, u), { clip });
  }
}

/** The cell under a window point, or null. */
export function cellAt(state: State, r: { x: number; y: number; width: number; height: number }, px: number, py: number): { x: number; y: number } | null {
  if (!r.width || !r.height) return null;
  const x = Math.floor((px - r.x) / r.width * state.cfg.board.cols);
  const y = Math.floor((py - r.y) / r.height * state.cfg.board.rows);
  return Rules.inBounds(state.cfg, x, y) ? { x, y } : null;
}
