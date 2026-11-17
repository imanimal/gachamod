// Other apps' keys that are also gachamod's (lib/api/otherkeys.ts): one list shared by the note in Switch skins in
// game and the toasts that ask when gachamod starts and when a game starts, and the answers: "Use F9" (gachamod's
// key moves, the other app's stays), "Change Medal's key" (the other way round, where gachamod can) and "Keep F7"
// (stop asking). Owner: INGAME area.
import { useMemo, useSyncExternalStore } from "react";
import { errorText, games, otherKeys, type AppKeyClash, type GameId } from "../../lib/api";
import { record } from "../../lib/history";
import { t, tb } from "../../lib/i18n";
import { go } from "../../lib/store";
import { held, isMenuWindow } from "../../lib/tauri";
import { toast, type ToastAction } from "../../ui/toast";
import { liveReady, reloadLive } from "./data";

let list: AppKeyClash[] = [];
const subs = new Set<() => void>();
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Read the clashes again. The other apps' settings are read each time, so a key changed there shows up. */
export async function reloadKeyClashes() {
  try { list = await otherKeys.clashes(); } catch { list = []; }
  subs.forEach((f) => f());
}

/** The clashes that hit this game's skin menu key or key list key. */
export function useKeyClashes(game: GameId): AppKeyClash[] {
  const all = useSyncExternalStore(subscribe, () => list);
  return useMemo(() => all.filter((c) => c.menuGames.includes(game) || c.keyListGames.includes(game)), [all, game]);
}

/** The "Use F9" answer: gachamod's key moves to the free key in every game that used the old one, and the other
 *  app's key stays as it is. Undo moves it back. */
export async function moveKey(c: AppKeyClash) {
  const free = c.suggestion;
  if (!free) return;
  const put = async (from: string, to: string) => {
    const m = await otherKeys.move(from, to);
    // the panels that show the key follow
    await Promise.all([...new Set([...m.menuGames, ...m.keyListGames])].filter(liveReady).map((g) => reloadLive(g)));
    await reloadKeyClashes();
    return m;
  };
  try {
    const m = await put(c.key, free);
    record({ label: t("{done}. {app} keeps {key}", { done: tb(m.text), app: c.app, key: c.key }), undo: () => put(free, c.key), redo: () => put(c.key, free) });
  } catch (e) {
    toast(errorText(e), true);
    void reloadKeyClashes();
  }
}

/** The "Change Medal's key" answer: the other app gets the free key and gachamod keeps its own. The backend says
 *  what to do when it can't (the app has to be closed first) and keeps a copy of the app's settings before the
 *  change. Undo puts the app's old key back, under the same rule. */
export async function changeOtherKey(c: AppKeyClash) {
  const free = c.otherKey;
  if (!free) return;
  const put = async (from: string, to: string, undo: boolean) => {
    const done = await otherKeys.change(c.appId, from, to, undo);
    await reloadKeyClashes();
    return done;
  };
  try {
    const done = await put(c.key, free, false);
    record({ label: t("{done}. gachamod keeps {key}", { done: tb(done.text), key: c.key }), undo: () => put(free, c.key, true), redo: () => put(c.key, free, false) });
  } catch (e) {
    toast(errorText(e), true);
    void reloadKeyClashes();
  }
}

/** The "Keep F7" answer: both apps keep the key and gachamod stops asking. Undo brings the question back. */
export async function keepKey(c: AppKeyClash) {
  const put = async (on: boolean) => { await otherKeys.keep(c.appId, c.key, on); await reloadKeyClashes(); };
  try {
    await put(true);
    record({ label: t("Kept {key}, which {app} uses too", { key: c.key, app: c.app }), undo: () => put(false), redo: () => put(true) });
  } catch (e) { toast(errorText(e), true); }
}

/** A profile hotkey is the player's pick, so that clash gets the way to its setting. */
const answer = (c: AppKeyClash): ToastAction => c.suggestion
  ? { label: t("Use {key}", { key: c.suggestion }), run: () => moveKey(c) }
  : { label: t("Hotkey settings"), run: () => go({ view: "settings", section: "hotkeys" }) };

/** One toast per clash, with the button that moves gachamod's key and one that keeps it as it is (and stops asking).
 *  The backend stops after three per clash. */
export async function askKeyClashes() {
  let ask: AppKeyClash[];
  try { ask = await otherKeys.ask(); } catch { return; }
  for (const c of ask) toast(c.ask, false, answer(c), { label: t("Keep {key}", { key: c.key }), run: () => keepKey(c) });
}

/** Ask a moment after the window shows (the opening screen is over by then) and each time a game starts. Returns
 *  what stops it. */
export function watchKeyClashes(): () => void {
  if (isMenuWindow()) return () => {};
  const timer = window.setTimeout(() => void askKeyClashes(), 2500);
  const off = held(games.onState((p) => { if (p.running) void askKeyClashes(); }));
  return () => { window.clearTimeout(timer); off(); };
}
