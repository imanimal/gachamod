// A game's roster: the characters the backend knows, GameBanana's character list (it grows on its own as GameBanana
// adds characters; new names are saved to the backend) and every character named by an installed mod. Also the
// roster's view settings and characters the user hid. Characters marked as owned (owned.ts) are always in it.
// Owner: LIBRARY area.
import { useEffect, useMemo, useState } from "react";
import { characters as charactersApi, library, type Character, type GameId, type ModEntry } from "../../lib/api";
import { characterList, useCharacterList } from "../../lib/gamebanana";
import { jsonPref } from "../../lib/prefs";
import { useOwned } from "./owned";

export interface RosterChar {
  name: string;
  icon: string | null;
  gbCategoryId: number | null;
  /** Installed mods for this character. */
  mods: ModEntry[];
  /** How many of them are on. */
  on: number;
  /** When the newest of them was installed (unix s), 0 without mods. */
  last: number;
  hidden: boolean;
  /** Marked as owned (imported from an export, or by hand). */
  owned: boolean;
}

export type RosterSort = "mods" | "name" | "recent";
/** `owned`: only the ones marked as owned (missing in views saved before it existed). */
export interface RosterView { onlyWithMods: boolean; sort: RosterSort; owned?: boolean }
export const rosterViewPref = jsonPref<RosterView>("characters.view", { onlyWithMods: false, sort: "mods" });

/** Characters hidden from the roster, per game (lowercased names). */
export const hiddenCharsPref = jsonPref<Record<string, string[]>>("characters.hidden", {});
const norm = (s: string) => s.trim().toLowerCase();
export const isCharHidden = (game: GameId, name: string) => (hiddenCharsPref.get()[game] ?? []).includes(norm(name));
export function setCharHidden(game: GameId, name: string, hidden: boolean) {
  const all = { ...hiddenCharsPref.get() };
  const set = new Set(all[game] ?? []);
  if (hidden) set.add(norm(name)); else set.delete(norm(name));
  all[game] = [...set];
  void hiddenCharsPref.set(all, hidden ? `Hid ${name} from the roster` : `Showing ${name} in the roster again`);
}

// ── the backend's list, kept for the session so the roster draws at once when you come back to it ──

const cache = new Map<GameId, Character[]>();
const syncing = new Set<GameId>();
const subs = new Set<(game: GameId) => void>();

export function useBackendRoster(game: GameId): Character[] | null {
  const [list, setList] = useState<Character[] | null>(() => cache.get(game) ?? null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setList(cache.get(game) ?? null);
    charactersApi.list(game).then((l) => { cache.set(game, l); if (live) setList(l); }).catch(() => { if (live) setList((x) => x ?? []); });
    return () => { live = false; };
  }, [game, tick]);
  useEffect(() => {
    const f = (g: GameId) => { if (g === game) setTick((n) => n + 1); };
    subs.add(f);
    return () => { subs.delete(f); };
  }, [game]);
  return list;
}

/** Save characters GameBanana has that the backend doesn't know yet (once per change). */
function syncNew(game: GameId, known: Character[], gb: Array<{ id: number; name: string; icon: string | null }>) {
  if (syncing.has(game) || !gb.length) return;
  const have = new Map(known.map((c) => [norm(c.name), c]));
  const fresh = gb.filter((r) => { const k = have.get(norm(r.name)); return !k || (!k.icon && r.icon) || (!k.gbCategoryId && r.id); });
  if (!fresh.length) return;
  syncing.add(game);
  const refs = new Map(known.map((c) => [norm(c.name), { name: c.name, gbCategoryId: c.gbCategoryId, icon: c.icon }]));
  for (const r of gb) refs.set(norm(r.name), { name: r.name, gbCategoryId: r.id, icon: r.icon });
  charactersApi.sync(game, [...refs.values()])
    .then(() => { cache.delete(game); subs.forEach((f) => f(game)); })
    .catch(() => {})
    .finally(() => window.setTimeout(() => syncing.delete(game), 60_000));
}

/** The whole roster with each character's installed mods. Null until something to show has loaded. */
export function useRoster(game: GameId, mods: ModEntry[]): RosterChar[] | null {
  const known = useBackendRoster(game);
  const gb = useCharacterList(game);
  const hiddenAll = hiddenCharsPref.use();
  const owned = useOwned(game);
  useEffect(() => { if (known) syncNew(game, known, gb); }, [game, known, gb]);
  return useMemo(() => {
    if (!known && !gb.length && !mods.length) return null;
    const hidden = new Set(hiddenAll[game] ?? []);
    const out = new Map<string, RosterChar>();
    const add = (name: string, icon: string | null, cat: number | null) => {
      const k = norm(name);
      if (!k) return;
      const c = out.get(k);
      if (c) { c.icon ??= icon; c.gbCategoryId ??= cat; return; }
      out.set(k, { name: name.trim(), icon, gbCategoryId: cat, mods: [], on: 0, last: 0, hidden: hidden.has(k), owned: !!owned?.has(k) });
    };
    for (const c of known ?? []) add(c.name, c.icon, c.gbCategoryId);
    for (const r of gb) add(r.name, r.icon, r.id);
    for (const n of owned?.values() ?? []) add(n, null, null);
    for (const m of mods) {
      if (!m.character) continue;
      add(m.character, null, null);
      const c = out.get(norm(m.character))!;
      c.mods.push(m);
      if (m.enabled) c.on++;
      c.last = Math.max(c.last, m.installedAt);
    }
    return [...out.values()];
  }, [game, known, gb, mods, hiddenAll, owned]);
}

/** The roster as the user set it up: hidden ones and (optionally) ones without mods left out, sorted. */
export function rosterOrder(list: RosterChar[], view: RosterView, showHidden = false): RosterChar[] {
  const byName = (a: RosterChar, b: RosterChar) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const keep = list.filter((c) => (showHidden || !c.hidden) && (!view.onlyWithMods || c.mods.length > 0) && (!view.owned || c.owned));
  return keep.sort(view.sort === "name" ? byName
    : view.sort === "recent" ? (a, b) => b.last - a.last || byName(a, b)
    // nothing that changes with a toggle: a character must not jump in the strip while one of its mods turns on
    : (a, b) => b.mods.length - a.mods.length || byName(a, b));
}

/** Every character name for a game (for pickers and search), without waiting on React. */
export async function characterNames(game: GameId): Promise<Array<{ name: string; icon: string | null }>> {
  const out = new Map<string, { name: string; icon: string | null }>();
  const add = (name: string | null | undefined, icon: string | null) => {
    if (!name?.trim()) return;
    const k = norm(name);
    const c = out.get(k);
    if (!c) out.set(k, { name: name.trim(), icon });
    else if (!c.icon && icon) c.icon = icon;
  };
  const known = cache.get(game) ?? await charactersApi.list(game).catch(() => [] as Character[]);
  if (!cache.has(game) && known.length) cache.set(game, known);
  for (const c of known) add(c.name, c.icon);
  for (const r of await characterList(game).catch(() => [])) add(r.name, r.icon);
  for (const m of await library.list(game).catch(() => [] as ModEntry[])) add(m.character, null);
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
