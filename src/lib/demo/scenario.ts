// What the demo pretends is on the PC, set from the console (dev/console) and kept in the browser's
// storage so a reload keeps it. Demo handlers read it; nothing here runs in the app. Owner: skeleton.
import { demoEmit } from "../tauri";

/** A line the demo backend "writes to gachamod.log", so the console shows what a move did. */
export const demoLog = (text: string, level: "info" | "warn" | "error" = "info") => demoEmit("app-log", { level, text });

export interface Scenario {
  /** Integrated Mod Manager has mods for Zenless and Genshin. */
  imm: boolean;
  /** No Reload Mod Manager has mods for Zenless. */
  nrmm: boolean;
  /** XX Mod Manager and WZMM (Zenless), JASM and GIMM (Genshin) are found. */
  others: boolean;
  /** GIMM is open, so bringing its mods in waits for it to close. */
  running: boolean;
  /** Splitting a merged mod is refused with a reason. */
  blockedSplit: boolean;
  /** The new problem checks show on some mods (second copy of a library, missing library, FPS cost). */
  newChecks: boolean;
}

const KEY = "gm.demo.scenario";
const DEFAULTS: Scenario = { imm: true, nrmm: true, others: true, running: false, blockedSplit: false, newChecks: true };

function read(): Scenario {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Scenario>) }; } catch { return { ...DEFAULTS }; }
}

let now = read();
const subs = new Set<() => void>();

export const scenario = (): Scenario => now;
export function setScenario(patch: Partial<Scenario>) {
  now = { ...now, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(now)); } catch { /* storage blocked: lasts until reload */ }
  subs.forEach((f) => f());
}
export function onScenario(f: () => void): () => void { subs.add(f); return () => { subs.delete(f); }; }

/** Moves already done in this page load, so "Put the managers back" can offer them again. */
const resets = new Set<() => void>();
export function onDemoReset(f: () => void) { resets.add(f); }
export function resetMoves() { resets.forEach((f) => f()); }
