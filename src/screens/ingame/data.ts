// Live switching state for the Tools panel and the mod drawer: one store per game, reloaded when the library
// changes, and the actions with their Undo. Owner: INGAME area.
import { useEffect, useSyncExternalStore } from "react";
import { errorText, live, type GameId, type LiveChange, type LiveGroup, type LiveInfo, type MenuSettings } from "../../lib/api";
import { record } from "../../lib/history";
import { emitApp, onApp } from "../../lib/store";
import { toast } from "../../ui/toast";
import { onPublish } from "../library/data";
import { sayF10Note } from "../../lib/elevation";

const infos = new Map<GameId, LiveInfo | null>();
const subs = new Set<() => void>();
const ping = () => subs.forEach((f) => f());

export async function reloadLive(game: GameId) {
  try { infos.set(game, await live.info(game)); } catch { infos.set(game, { groups: [], ready: [], running: false, menu: { style: "window", key: "F7", pad: true }, blocked: false, all: false }); }
  ping();
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  // a mod turned on or off (a live skin turned on is a pick), renamed, removed: names and states in the groups follow
  let t = 0;
  const later = (game: GameId) => {
    if (!infos.has(game)) return;
    window.clearTimeout(t);
    t = window.setTimeout(() => void reloadLive(game), 500);
  };
  onApp((e) => { if (e.type === "library-refresh") later(e.game); });
  onPublish((game) => later(game));
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const load = (game: GameId) => { if (!infos.has(game)) { infos.set(game, null); void reloadLive(game); } };

/** The game's live groups, or null while loading. */
export function useLive(game: GameId): LiveInfo | null {
  wire();
  const v = useSyncExternalStore(subscribe, () => infos.get(game) ?? null);
  useEffect(() => load(game), [game]);
  return v;
}

/** The same outside React: null when it isn't a live skin or the game's groups haven't loaded. */
export const liveCharacterOf = (game: GameId, modId: string): string | null =>
  infos.get(game)?.groups.find((g) => g.mods.some((m) => m.modId === modId))?.character ?? null;

/** The character whose live skins a mod switches with, or null (for its card's tag). */
export function useLiveCharacter(game: GameId, modId: string): string | null {
  wire();
  const v = useSyncExternalStore(subscribe, () => infos.get(game)?.groups.find((g) => g.mods.some((m) => m.modId === modId))?.character ?? null);
  useEffect(() => load(game), [game]);
  return v;
}

const after = (game: GameId) => { emitApp({ type: "library-refresh", game }); void reloadLive(game); };

function skippedNote(c: LiveChange) {
  const s = c.skipped[0];
  if (!s) return;
  const more = c.skipped.length > 1 ? ` (and ${c.skipped.length - 1} more)` : "";
  toast(`${s.name} can't be switched in game: ${s.reason}${more}`, true);
}

/** Make mods live (normally all of one character's). One Undo step takes them out again. */
export async function makeLive(game: GameId, ids: string[], who: string) {
  try {
    const c = await live.add(game, ids);
    after(game);
    skippedNote(c);
    if (!c.changed.length) return;
    record({
      label: `Made ${who} switch in game. It starts after the game reloads once`,
      undo: async () => { await live.remove(game, c.changed); after(game); },
      redo: async () => { await live.add(game, c.changed); after(game); },
    });
  } catch (e) { toast(errorText(e), true); }
}

/** Stop switching mods live. The one showing stays on. */
export async function stopLive(game: GameId, ids: string[], who: string) {
  try {
    const c = await live.remove(game, ids);
    after(game);
    if (!c.changed.length) return;
    record({
      label: `Stopped switching ${who} in game`,
      undo: async () => { await live.add(game, c.changed); after(game); },
      redo: async () => { await live.remove(game, c.changed); after(game); },
    });
  } catch (e) { toast(errorText(e), true); }
}

/** Every mod that has a character switches in game, and new ones join by themselves. Undo takes out what this added. */
export async function setAll(game: GameId, on: boolean) {
  try {
    const c = await live.setAll(game, on);
    after(game);
    skippedNote(c);
    const n = c.changed.length;
    record({
      label: !on ? "New mods no longer start switching in game by themselves"
        : n ? `Made every character switch in game (${n} ${n === 1 ? "mod" : "mods"} added). It starts after the game reloads once`
        : "New mods start switching in game by themselves",
      undo: async () => { await live.setAll(game, !on); if (on && n) await live.remove(game, c.changed); after(game); },
      redo: async () => { await live.setAll(game, on); after(game); },
    });
  } catch (e) { toast(errorText(e), true); }
}

/** Change how the skin menu opens while playing. Undo puts the old way back. */
export async function setMenu(game: GameId, before: MenuSettings, menu: MenuSettings) {
  try {
    await live.setMenu(game, menu);
    await reloadLive(game);
    record({
      label: menu.style === "off" ? "Turned the in-game menu off" : `Set the in-game menu to ${menu.style === "window" ? "open over the game" : "be drawn by the game"} with ${menu.key}`,
      undo: async () => { await live.setMenu(game, before); await reloadLive(game); },
      redo: async () => { await live.setMenu(game, menu); await reloadLive(game); },
    });
  } catch (e) { toast(errorText(e), true); }
}

const nameOf = (g: LiveGroup, slot: number) => g.mods.find((m) => m.slot === slot)?.name ?? "that mod";

/** Show a group's slot (0: none). Sent to the game when it runs. Undo picks the one before. */
export async function pickLive(game: GameId, g: LiveGroup, slot: number) {
  const before = g.active;
  const put = async (s: number) => {
    const p = await live.pick(game, g.group, s);
    // the library shows the picked skin as on and the others as off
    after(game);
    return p;
  };
  try {
    // also the one the app thinks shows: the game may show another, picked in its own menu
    const p = await put(slot);
    const f10 = sayF10Note(p.note);
    if (before === slot) { if (p.note && !f10) toast(p.note); return; }
    const what = slot === 0 ? `none of ${g.character}'s live skins` : nameOf(g, slot);
    const label = p.reload ? `Turned on ${what}. It shows after the game reloads`
      : p.send ? `Switched to ${what} in game` : `Picked ${what} for the next start`;
    record({ label: p.note && !f10 ? `${label}. ${p.note}` : label, undo: async () => { await put(before); }, redo: async () => { await put(slot); } });
  } catch (e) { toast(errorText(e), true); }
}
