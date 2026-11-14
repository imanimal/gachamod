// Saved filter sets for Browse, per game: one click puts a whole set back (sort, type, category or character, search,
// High quality ...). Named after what they hold ("Ellen Joe, Outfits, High quality") and renamable. Kept in the
// window's storage like the filters themselves. Owner: BROWSE area.
import { useSyncExternalStore } from "react";
import type { GameId } from "../../lib/api";
import { record } from "../../lib/history";
import { getFilters, kindLabel, setFilters, sortLabel, type BrowseFilters } from "./state";

export interface SavedFilter { id: string; name: string; f: BrowseFilters }

const key = (game: GameId) => `gm.browse.saved.${game}`;
const sets = new Map<GameId, SavedFilter[]>();
const subs = new Set<() => void>();

function read(game: GameId): SavedFilter[] {
  const hit = sets.get(game);
  if (hit) return hit;
  let list: SavedFilter[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(key(game)) ?? "[]") as unknown;
    if (Array.isArray(raw)) list = raw.filter((x): x is SavedFilter => !!x && typeof x.id === "string" && typeof x.name === "string" && !!x.f);
  } catch { /* storage off or bad */ }
  sets.set(game, list);
  return list;
}
function write(game: GameId, list: SavedFilter[]) {
  sets.set(game, list);
  try { localStorage.setItem(key(game), JSON.stringify(list)); } catch { /* storage full */ }
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useSavedFilters = (game: GameId) => useSyncExternalStore(subscribe, () => read(game));

/** A name from what the filters hold: "Ellen Joe, Outfits, High quality". */
export function describe(f: BrowseFilters): string {
  const parts = [
    f.search && `"${f.search}"`,
    f.character ?? f.category?.name,
    f.kind && kindLabel(f.kind),
    f.hq && "High quality",
    f.followed && "Following",
    f.hideInstalled && "Not installed",
    f.sort !== "popular" && sortLabel(f.sort),
  ].filter(Boolean) as string[];
  return parts.join(", ") || sortLabel(f.sort);
}

const same = (a: BrowseFilters, b: BrowseFilters) =>
  a.sort === b.sort && a.kind === b.kind && (a.category?.id ?? null) === (b.category?.id ?? null) && a.character === b.character
  && a.hq === b.hq && a.hideInstalled === b.hideInstalled && a.followed === b.followed && a.search.trim() === b.search.trim();

/** The saved set that matches the filters now, if any. */
export const matching = (list: SavedFilter[], f: BrowseFilters) => list.find((s) => same(s.f, f)) ?? null;

/** Nothing to save: the plain default view. */
export const isPlain = (f: BrowseFilters) =>
  f.sort === "popular" && !f.kind && !f.category && !f.character && !f.hq && !f.hideInstalled && !f.followed && !f.search.trim();

/** Save the game's filters now, with Undo. Returns the saved set (the existing one when they match one already). */
export function saveFilters(game: GameId): SavedFilter {
  const f = { ...getFilters(game), search: getFilters(game).search.trim() };
  const list = read(game);
  const have = matching(list, f);
  if (have) return have;
  const s: SavedFilter = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: describe(f), f };
  write(game, [...list, s]);
  record({ label: `Saved the filters "${s.name}"`, undo: async () => write(game, read(game).filter((x) => x.id !== s.id)), redo: async () => write(game, [...read(game), s]) });
  return s;
}

/** Put a saved set back. */
export function applySaved(game: GameId, s: SavedFilter) { setFilters(game, { ...s.f }); }

export function renameSaved(game: GameId, id: string, name: string) {
  const list = read(game);
  const old = list.find((x) => x.id === id);
  const n = name.trim();
  if (!old || !n || n === old.name) return;
  const put = (v: string) => write(game, read(game).map((x) => (x.id === id ? { ...x, name: v } : x)));
  put(n);
  record({ label: `Renamed saved filters to "${n}"`, undo: async () => put(old.name), redo: async () => put(n) });
}

export function removeSaved(game: GameId, id: string) {
  const list = read(game);
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return;
  const s = list[i]!;
  write(game, list.filter((x) => x.id !== id));
  record({
    label: `Removed saved filters "${s.name}"`,
    undo: async () => { const now = read(game); write(game, [...now.slice(0, i), s, ...now.slice(i)]); },
    redo: async () => write(game, read(game).filter((x) => x.id !== id)),
  });
}
