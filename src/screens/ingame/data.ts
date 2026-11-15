// The menu over the game: its settings per game for Tools and the check, and changing them with Undo.
// Owner: INGAME area.
import { useEffect, useSyncExternalStore } from "react";
import { errorText, ingame, type GameId, type MenuInfo, type MenuSettings } from "../../lib/api";
import { record } from "../../lib/history";
import { toast } from "../../ui/toast";

const infos = new Map<GameId, MenuInfo | null>();
const subs = new Set<() => void>();
const ping = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export async function reloadMenu(game: GameId) {
  try { infos.set(game, await ingame.info(game)); } catch { infos.set(game, { menu: { style: "window", key: "F7", pad: true }, running: false, blocked: false, reloads: true }); }
  ping();
}

/** The game's menu settings, or null while loading. */
export function useMenuInfo(game: GameId): MenuInfo | null {
  const v = useSyncExternalStore(subscribe, () => infos.get(game) ?? null);
  useEffect(() => { if (!infos.has(game)) { infos.set(game, null); void reloadMenu(game); } }, [game]);
  return v;
}

/** Change how the menu opens while playing. Undo puts the old way back. */
export async function setMenu(game: GameId, before: MenuSettings, menu: MenuSettings) {
  const put = async (m: MenuSettings) => { await ingame.setMenu(game, m); await reloadMenu(game); };
  try {
    await put(menu);
    record({
      label: menu.style === "off" ? "Turned the menu while playing off"
        : before.style === "off" ? `Turned the menu while playing on (${menu.key})`
        : before.key !== menu.key ? `The menu while playing opens with ${menu.key}`
        : menu.pad ? "Both sticks open the menu while playing" : "Both sticks no longer open the menu",
      undo: () => put(before),
      redo: () => put(menu),
    });
  } catch (e) { toast(errorText(e), true); }
}
