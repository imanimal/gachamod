// Getting games ready for mods without picking folders: one click installs XXMI Launcher and each game's mod loader
// (gacha-core xxmi_setup.rs), and while a game is still missing its Mods folder the app looks again by itself, when the
// window comes back to the front and every 30 seconds. Every place that offers setup uses this: the first start,
// Settings, Games, and a download that had nowhere to go. Owner: SYSTEM area.
import { oxford } from "./notes";
import { useSyncExternalStore } from "react";
import { dialogs, errorText, games as gamesApi, xxmi, type GameId, type GameState, type SetupProgress } from "./api";
import { allGames, refreshGames, setGames } from "./store";
import { toast } from "../ui/toast";

export interface SetupState {
  running: boolean;
  /** What the install is doing now. */
  step: SetupProgress | null;
  /** When it started, for the wait's timer. */
  since: number;
  error: string | null;
}

let state: SetupState = { running: false, step: null, since: 0, error: null };
const subs = new Set<() => void>();
const put = (patch: Partial<SetupState>) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };
export const useSetup = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  void xxmi.onSetup((p) => { if (state.running) put({ step: p }); }).catch(() => {});
}

/** XXMI Launcher can give this game a mod loader: the game is on this PC and has no Mods folder yet. */
export const canInstallLoader = (g: GameState) => g.xxmi && !g.modsDir && (g.installed || !!g.gameDir);

const names = (list: GameState[]) => oxford(list.map((g) => g.short), 12);

/** Install XXMI Launcher and the mod loaders of `ids` (every XXMI game found on this PC when left out). Resolves with
 *  the games after, or null when it failed (the error is toasted with Try again). */
export async function installLoaders(ids?: GameId[]): Promise<GameState[] | null> {
  if (state.running) return null;
  wire();
  const before = new Set(allGames().filter((g) => g.modsDir).map((g) => g.id));
  put({ running: true, step: null, since: Date.now(), error: null });
  try {
    const list = await xxmi.install(ids);
    setGames(list);
    put({ running: false, step: null });
    const ready = list.filter((g) => g.modsDir && !before.has(g.id));
    toast(ready.length ? `${names(ready)} ${ready.length === 1 ? "is" : "are"} ready for mods` : "XXMI Launcher is installed. Games you install later get their mod loader here");
    return list;
  } catch (e) {
    const msg = errorText(e);
    put({ running: false, step: null, error: msg });
    toast(`Couldn't install the mod loaders: ${msg}`, true, { label: "Try again", run: () => void installLoaders(ids) });
    return null;
  }
}

let lastCheck = 0;
let checking: Promise<GameState[] | null> | null = null;

/** Look for games again (XXMI, launchers, Steam). Quiet: at most every 15 seconds unless `force`. */
export function recheck(force = false): Promise<GameState[] | null> {
  if (state.running) return Promise.resolve(null);
  if (checking) return checking;
  if (!force && Date.now() - lastCheck < 15_000) return Promise.resolve(null);
  lastCheck = Date.now();
  checking = refreshGames(true).catch(() => null).finally(() => { checking = null; });
  return checking;
}

/** Something to look for: no game has a Mods folder, or a game in the sidebar has none. */
const missing = () => { const l = allGames(); return !l.some((g) => g.modsDir) || l.some((g) => g.shown && !g.modsDir); };

/** While something is missing, look again when the window comes back to the front and every 30 seconds. */
export function watchSetup(): () => void {
  const onFocus = () => { if (missing()) void recheck(); };
  window.addEventListener("focus", onFocus);
  const t = window.setInterval(() => { if (missing() && document.visibilityState === "visible") void recheck(); }, 30_000);
  return () => { window.removeEventListener("focus", onFocus); window.clearInterval(t); };
}

/** Give one game a Mods folder the easy way: install its mod loader when XXMI can, else look for it again. True when
 *  the game has a Mods folder after. */
export async function getReady(id: GameId): Promise<boolean> {
  const has = (list: GameState[] | null) => !!list?.find((g) => g.id === id)?.modsDir;
  const g = allGames().find((x) => x.id === id);
  if (!g) return false;
  if (g.modsDir) return true;
  if (canInstallLoader(g)) return has(await installLoaders([id]));
  if (has(await recheck(true))) return true;
  toast(g.xxmi ? `Still no Mods folder for ${g.short}. Pick it, or open the game once with XXMI Launcher`
    : `Still no Mods folder for ${g.short}. Install a 3DMigoto loader for it, then pick the Mods folder next to the loader's d3dx.ini`, false,
    { label: "Pick folder", run: () => void pickModsFolder(id) });
  return false;
}

/** Pick a game's Mods folder by hand (the way past detection). True when one was set. */
export async function pickModsFolder(id: GameId): Promise<boolean> {
  const g = allGames().find((x) => x.id === id);
  if (!g) return false;
  try {
    const dir = await dialogs.pickFolder(`Pick ${g.name}'s Mods folder`);
    if (!dir) { if (!("__TAURI_INTERNALS__" in window)) toast("Picking folders works in the app"); return false; }
    setGames(await gamesApi.setPaths(id, { gameDir: g.gameDir, importerDir: g.importerDir, modsDir: dir, viaXxmi: g.viaXxmi }));
    return true;
  } catch (e) { toast(errorText(e), true); return false; }
}
