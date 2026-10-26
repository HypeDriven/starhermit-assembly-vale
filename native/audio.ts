// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json maps rules events to clips) on the
// runtime's mixer, and the synthesized beds on its Web Audio graph — the
// quiet valley air (brown noise through a low-pass), the factory hum while
// auto-run runs (a low sawtooth), and the slow generative pad (a seeded
// chord walk) on the music bus. The browser build's own buses become the
// runtime's: music → "music", effects and ambience → "effects", the UI click
// → "interface"; their volumes, mute and the voice limit are the player's
// (Options › Audio). The game keeps its own "Sound: on/off" (the pause
// menu), saved in the game's settings (with the account when signed in).
import { files, frame } from "starhermit:engine";
import { context, loadClip, play as playClip, type AudioClip, type GainNode, type OscillatorNode, type AudioBufferSourceNode } from "starhermit:audio";
import { settings } from "starhermit:storage";

// The browser build's default bus levels, folded into each sound's gain.
const LEVEL = { music: 0.55, effects: 0.9, ambience: 0.5 };
const INTERFACE = new Set(["ui", "tool", "hint", "invalid"]);

const clipFor = new Map<string, string>();
const clips = new Map<string, AudioClip>();
const lastPlayed = new Map<string, number>();

function readMuted(): boolean {
  try { return settings.get("sfx.muted") === true; } catch { return false; }
}
let muted = readMuted();
let started = false;
settings.onChange((key, value) => {
  if (key !== "sfx.muted") return;
  muted = value === true;
  applyMute();
});

/** Loads the clip table and every clip at the start (a browser hands them
 * to its mixer at the player's first press); a clip that fails stays silent. */
export async function loadSfx(): Promise<void> {
  try {
    const list = files.readJson("sfx/manifest.json") as unknown as { name?: string; event?: string }[];
    for (const e of list) if (e && e.name && e.event && !clipFor.has(e.event)) clipFor.set(e.event, e.name);
  } catch (e) { console.warn(`sfx manifest: ${String(e)}`); }
  await Promise.all([...new Set(clipFor.values())].map(async (name) => {
    try { clips.set(name, await loadClip(`sfx/${name}.opus`)); }
    catch (e) { console.warn(`sfx ${name}: ${String(e)}`); }
  }));
}

export function isMuted(): boolean { return muted; }
export function setMuted(m: boolean): void {
  muted = m;
  try { settings.set("sfx.muted", m); } catch { /* this session only */ }
  applyMute();
}
export function toggleMute(): boolean { setMuted(!muted); return muted; }

/** Plays an event's clip (once per event within 50 ms). */
export function sfx(event: string): void {
  if (muted || !started) return;
  const name = clipFor.get(event);
  if (!name) return;
  const now = frame().time;
  const last = lastPlayed.get(event);
  if (last !== undefined && now - last < 0.05) return;
  lastPlayed.set(event, now);
  const clip = clips.get(name);
  if (!clip) return;
  try {
    playClip(clip, { bus: INTERFACE.has(event) ? "interface" : "effects", gain: LEVEL.effects });
  } catch {
    // A clip the mixer lost throws rather than staying silent: load it again.
    clips.delete(name);
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, () => { /* stays silent */ });
  }
}

// -- The synthesized beds --------------------------------------------------------
let ambience: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let hum: { o: OscillatorNode; g: GainNode } | null = null;
let humWanted = false;
let nextPad = 0;
let chordIdx = 0;
const CHORDS = [
  [220.0, 261.63, 329.63], // A  C  E
  [196.0, 246.94, 293.66], // G  B  D
  [174.61, 220.0, 261.63], // F  A  C
  [164.81, 220.0, 246.94], // E  A  B
];

function startAmbience(): void {
  if (ambience || muted) return;
  try {
    const src = context.createBufferSource();
    src.buffer = context.createNoiseBuffer(2, "brown");
    src.loop = true;
    const f = context.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 300;
    const g = context.createGain();
    g.gain.value = 0.32 * LEVEL.ambience;
    src.connect(f); f.connect(g); g.connect(context.bus("effects"));
    src.start();
    ambience = { src, gain: g };
  } catch (e) { console.warn(`ambience: ${String(e)}`); }
}
function stopAmbience(): void {
  if (!ambience) return;
  try { ambience.src.stop(); } catch { /* ended */ }
  ambience = null;
}

function startHum(): void {
  if (hum || muted) return;
  try {
    const o = context.createOscillator(), g = context.createGain(), f = context.createBiquadFilter();
    o.type = "sawtooth"; o.frequency.value = 55;
    f.type = "lowpass"; f.frequency.value = 180;
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.10 * LEVEL.ambience, context.currentTime, 0.4);
    o.connect(f); f.connect(g); g.connect(context.bus("effects"));
    o.start();
    hum = { o, g };
  } catch (e) { console.warn(`hum: ${String(e)}`); }
}
function stopHum(): void {
  if (!hum) return;
  const nodes = hum;
  hum = null;
  try {
    nodes.g.gain.setTargetAtTime(0, context.currentTime, 0.3);
    nodes.o.stop(context.currentTime + 0.9);
  } catch { /* ended */ }
}

/** The factory hum follows auto-run. */
export function setHum(on: boolean): void {
  humWanted = on;
  if (on) startHum(); else stopHum();
}

function schedulePad(): void {
  const t = context.currentTime + 0.1;
  const chord = CHORDS[chordIdx % CHORDS.length]!;
  chordIdx++;
  chord.forEach((freq, i) => {
    try {
      const o = context.createOscillator(), g = context.createGain(), f = context.createBiquadFilter();
      o.type = i === 0 ? "triangle" : "sine";
      o.frequency.value = freq * 0.5;
      f.type = "lowpass"; f.frequency.value = 650;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05 * LEVEL.music, t + 1.8);
      g.gain.linearRampToValueAtTime(0.0001, t + 6.4);
      o.connect(f); f.connect(g); g.connect(context.bus("music"));
      o.start(t); o.stop(t + 6.6);
    } catch { /* over the graph's budget: skip this voice */ }
  });
}

/** The beds start with the first round (the browser build's audio unlock). */
export function startAudio(): void {
  started = true;
  if (muted) return;
  startAmbience();
  if (humWanted) startHum();
}

/** Leaving a round to the title silences the beds (the browser build suspended its context). */
export function stopAudio(): void {
  started = false;
  stopAmbience();
  stopHum();
}

function applyMute(): void {
  if (muted) { stopAmbience(); stopHum(); }
  else if (started) { startAmbience(); if (humWanted) startHum(); }
}

/** Each frame: the pad's next chord every 5.2 s of mixer time while a round plays. */
export function updateAudio(): void {
  if (!started || muted || context.state !== "running") return;
  const now = context.currentTime;
  if (now >= nextPad) {
    schedulePad();
    nextPad = now + 5.2;
  }
}
