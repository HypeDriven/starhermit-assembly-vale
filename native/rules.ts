// The rules engine (js/rules.js, pure and deterministic) and the shipped
// content (js/content.js), loaded as classic scripts so the node tests run
// the same files, with the types of the parts the client uses.
import { loadClassic } from "starhermit:script";

loadClassic("js/rng.js");
loadClassic("js/rules.js");
loadClassic("js/content.js");

export type Dir = "N" | "E" | "S" | "W";
export interface Item { id: number; t: string }
export interface Cell {
  k: "rock" | "water" | "sink" | "source" | "belt" | "machine";
  dir?: Dir; item?: string; itemRef?: Item | null; recipe?: string; level?: number;
  inBuf?: Item | null; outBuf?: Item | null; prog?: number;
}
export interface Recipe { id: string; name: string; input: string; output: string }
export interface Cfg {
  id?: string; kind: string; name?: string; theme?: string; seed?: number;
  board: { cols: number; rows: number };
  terrain?: { x: number; y: number; k: "rock" | "water" }[];
  sources?: { x: number; y: number }[];
  sink: { x: number; y: number };
  contracts: Record<string, number>;
  tickLimit?: number; buildLimit?: number; gold: number; upgrades?: boolean;
  allowedRecipes?: string[];
  mechanics?: { undo?: boolean };
  lesson?: { id: string };
  challengeId?: string; practiceDifficulty?: string;
  par?: { ticks?: number };
}
export interface State {
  cfg: Cfg; tick: number; gold: number; builds: number;
  grid: (Cell | null)[][];
  progress: Record<string, number>;
  sold: Record<string, number>;
  contractDone: Record<string, boolean>;
  score: { goods: number; contractBonus: number; goldLeft: number; speedBonus: number; total: number };
  terminal: { won: boolean; reason?: string } | null;
}
export interface RulesEvent { type: string; x?: number; y?: number; kind?: string; dir?: Dir; level?: number; item?: string; value?: number }
export interface Result { ok: boolean; reason?: string; state: State; events: RulesEvent[] }
interface Command { type: string; [k: string]: unknown }
interface RulesApi {
  DIRS: Record<Dir, [number, number]>;
  createGame(cfg: Cfg): State;
  applyCommand(state: State, cmd: Command): Result;
  hint(state: State): { cmd: Command & { x: number; y: number; kind?: string; recipe?: string }; why?: string } | null;
  buildCatalog(state: State): { kind: string; recipe?: string; cost: number; afford: boolean }[];
  beltCost(state: State): number;
  recipeById(cfg: Cfg, id: string | undefined): Recipe | null;
  processTime(rec: Recipe, level: number): number;
  inBounds(cfg: Cfg, x: number, y: number): boolean;
}
interface ContentApi {
  GOOD_META: Record<string, { color: string; name: string }>;
  THEMES: Record<string, { tileA: string; tileB: string; rock: string; water: string; belt: string; accent: string }>;
  JOURNEY: { id: string; mastery?: boolean }[];
  LESSONS: { id: string }[];
  CHALLENGES: { id: string }[];
  PRACTICE: Record<string, unknown>;
  journeyCfg(i: number): Cfg;
  lessonCfg(i: number): Cfg;
  challengeCfg(id: string): Cfg;
  practiceCfg(diff: string, seed: null): Cfg;
  scoreChaseCfg(seed: null): Cfg;
  dailyConfig(day: string): Cfg;
}
const G = globalThis as unknown as { AVRules: RulesApi; AVContent: ContentApi };
export const Rules = G.AVRules;
export const Content = G.AVContent;

