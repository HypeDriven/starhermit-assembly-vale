// The player's progress (js/store.js: lessons done, Journey stars and bests,
// challenge and daily bests, the Score Chase best, lifetime counters) as the
// game's save: starhermit:storage `saves` keeps it on the device and, signed
// in, in the account's cloud slot, with conflicts merged (better records win,
// unlocks are unioned). Players of the browser build keep their progress: its
// cloud slot game:<slug> held the same document as the wrapped {sum, payload}
// text in a zipped save.json, which the engine shows as a foreign save; it is
// merged in and replaces the slot once (`replaceForeign`). The browser build's
// account settings (its sound, graphics and accessibility keys) are read once:
// the mute becomes the game's Sound toggle, the rest is the runtime's now.
import type { JsonValue } from "starhermit:engine";
import { saves, settings } from "starhermit:storage";
import { loadClassic } from "starhermit:script";
import { setMuted } from "./audio.js";

loadClassic("js/store.js");

export interface Progress {
  tutorialDone: Record<string, boolean>;
  journeyStars: Record<string, number>;
  journeyBest: Record<string, number>;
  challengeBest: Record<string, number>;
  dailiesDone: Record<string, number>;
  scoreChaseBest: number;
  achievements: Record<string, number>;
  stats: { rounds: number; wins: number; goodsSold: number; contractsDone: number; buildingsPlaced: number; bestScore: number; lastDaily: string };
}
export interface Doc { v: number; settings: Record<string, unknown>; progress: Progress }
interface StoreApi {
  DEFAULT_SETTINGS: Record<string, unknown>;
  fresh(): Doc;
  fromData(data: unknown): Doc;
  toData(doc: Doc): unknown;
  loadRaw(text: string | null): Doc | null;
  mergeDocs(remote: unknown, local: unknown): Doc;
  recordResult(prog: Progress, state: unknown, kind: string, day: string): Progress;
}
export const Store = (globalThis as unknown as { AVStore: StoreApi }).AVStore;

const SCHEMA = 1;
let doc: Doc = load();

function load(): Doc {
  try { return Store.fromData(saves.load()?.data); } catch { return Store.fresh(); }
}

export function progress(): Progress { return doc.progress; }

/** Saves the document (device at once; the account debounced). */
export function persist(): void {
  try { saves.save(Store.toData(doc) as JsonValue, { schema: SCHEMA }); } catch (e) { console.warn(`save: ${String(e)}`); }
}

/** The account's copy replaced the device's (another device saved last). */
function reload(): void {
  const now = saves.load();
  if (now) doc = Store.mergeDocs(Store.fromData(now.data), doc);
}

/** A browser-build save in the slot: merge it in and replace it, once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  doc = Store.mergeDocs(Store.loadRaw(old.text), doc);
  try { saves.save(Store.toData(doc) as JsonValue, { schema: SCHEMA, replaceForeign: true }); }
  catch (e) { console.warn(`save migration: ${String(e)}`); }
}

/** Starts listening; call once at start. */
export function initSave(): void {
  saves.onConflict((local, remote) => ({
    merged: Store.toData(Store.mergeDocs(Store.fromData(remote.data), Store.fromData(local?.data))) as JsonValue,
  }));
  saves.onStatus((_, state) => {
    if (state === "foreign") migrateForeign();
    else reload();
  });
  if (saves.state() === "foreign") migrateForeign();
  settings.onLegacy(importLegacySettings);
  importLegacySettings();
}

/** The browser build's settings keys (its DEFAULT_SETTINGS and `graphics`). */
export function importLegacySettings(): void {
  const keys = settings.legacyKeys();
  if (!keys) return;
  const known = new Set([...Object.keys(Store.DEFAULT_SETTINGS), "graphics"]);
  for (const key of keys) {
    if (!known.has(key)) continue;
    if (key === "muted") {
      const old = settings.legacy("muted");
      if (typeof old === "boolean" && settings.get("sfx.muted") === undefined) setMuted(old);
    }
    settings.removeLegacy(key);
  }
}

/** For the account line: the save's sync state in the browser build's words. */
export function syncStatus(): "synced" | "saving" | "off" {
  switch (saves.state()) {
    case "ready": return saves.status() === "pending" ? "saving" : "synced";
    case "loading": case "foreign": case "uploading": return "saving";
    default: return "off";
  }
}
