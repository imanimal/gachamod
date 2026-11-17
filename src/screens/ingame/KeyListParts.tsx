// The key list's shared parts (lib/api/keylist.ts): loading it for a game, the note beside a key, search and grouping
// by character. Used by the Keys tab of the menu over the game (OverlayKeys.tsx) and by Tools > Key list in game
// (KeyListPanel.tsx). Owner: INGAME area.
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, keyList, library, type GameId, type KeyList, type KeyListSettings, type KeyRow, type ModKeyList } from "../../lib/api";
import { t } from "../../lib/i18n";
import { onApp } from "../../lib/store";
import { held } from "../../lib/tauri";
import { onKeysChanged } from "../../ui/KeyEditor";
import "./keylist.css";

/** Mods with no character sit under this name, last. */
export const OTHER_MODS = t("Other mods");

/** The game's key list (null while reading), read again when `tick` changes, when the library changes and when a
 *  mod's keys change (a rebind, its Undo). */
export function useKeyList(game: GameId, tick = 0) {
  const [state, setState] = useState<{ game: GameId; list: KeyList | null; error: string | null }>({ game, list: null, error: null });
  const live = useRef(true);
  const load = useCallback(() => keyList.get(game)
    .then((list) => { if (live.current) setState({ game, list, error: null }); })
    .catch((e) => { if (live.current) setState((s) => (s.game === game && s.list ? s : { game, list: null, error: errorText(e) })); }), [game]);
  useEffect(() => {
    live.current = true;
    void load();
    const off = held(library.onChanged((p) => { if (p.game === game) void load(); }));
    const offApp = onApp((e) => { if (e.type === "library-refresh" && e.game === game) void load(); });
    const offKeys = onKeysChanged((g) => { if (g === game) void load(); });
    return () => { live.current = false; off(); offApp(); offKeys(); };
  }, [game, tick, load]);
  /** One mod changed (keyList.choose answered). */
  const patch = useCallback((m: ModKeyList) =>
    setState((s) => (s.list ? { ...s, list: { ...s.list, mods: s.list.mods.map((x) => (x.modId === m.modId ? m : x)) } } : s)), []);
  /** The settings changed (keyList.set answered). Who is listed can change with `own`, so the list is read again. */
  const settle = useCallback((settings: KeyListSettings) => {
    setState((s) => (s.list ? { ...s, list: { ...s.list, settings } } : s));
    void load();
  }, [load]);
  const mine = state.game === game;
  return { list: mine ? state.list : null, error: mine ? state.error : null, reload: load, patch, settle };
}

/** The dim note after what a key does: "Hold", or how many values a cycle steps through. */
export const rowNote = (r: KeyRow): string | null =>
  r.kind === "hold" ? t("Hold") : r.kind === "cycle" && r.options > 2 ? t("{n} options", { n: r.options }) : null;

/** The hover tip of a key's row. */
export function rowTip(r: KeyRow, character: string | null): string | undefined {
  const how = r.kind === "hold" ? t("Works while you hold the key")
    : r.kind === "cycle" && r.options > 2 ? t("Each press steps to the next of {n} options", { n: r.options }) : null;
  const when = r.onScreen ? t("Only while {character} is on screen", { character: character ?? t("its character") }) : null;
  return how && when ? t("{how}. {when}", { how, when }) : how ?? when ?? undefined;
}

/** The rows of a mod that match the search: all of them when its name or character matches, else the rows whose key
 *  or what it does matches. Null when nothing matches. */
export function keyHits(m: ModKeyList, words: string): KeyRow[] | null {
  if (!words) return m.rows;
  const hit = (s: string) => s.toLowerCase().includes(words);
  if (hit(m.name) || hit(m.character ?? OTHER_MODS)) return m.rows;
  const rows = m.rows.filter((r) => hit(r.what) || r.keys.some(hit));
  return rows.length ? rows : null;
}

/** Mods grouped by character: the characters in `order` first, in that order, then the rest by name, with mods that
 *  have no character last. */
export function byCharacter<T extends { character: string | null }>(mods: T[], order: string[] = []): Array<{ name: string; other: boolean; mods: T[] }> {
  const rank = (name: string) => { const i = order.indexOf(name); return i < 0 ? order.length : i; };
  const groups = new Map<string, T[]>();
  for (const m of mods) {
    const k = m.character ?? OTHER_MODS;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return [...groups].map(([name, list]) => ({ name, other: name === OTHER_MODS && !list.some((m) => m.character), mods: list }))
    .sort((a, b) => Number(a.other) - Number(b.other) || rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}
