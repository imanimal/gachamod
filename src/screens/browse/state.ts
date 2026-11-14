// Shared state for the GameBanana browser: the filters (one set per game, remembered, shared by the Browse page,
// Home's embedded browser and the character pages, so Expand keeps them), what the library has (installed and
// archived mods by GameBanana id) and opening a mod's page. Owner: BROWSE area.
import { useEffect, useSyncExternalStore } from "react";
import { library, type ArchiveEntry, type GameId, type ModEntry } from "../../lib/api";
import type { GbCategoryRef, GbKind, GbSort } from "../../lib/gamebanana";
import { closeRoute, currentRoute, go, onApp } from "../../lib/store";

// ── filters ──

/** GameBanana's sorts plus "foryou" (lib/recommend.ts). */
export type BrowseSort = GbSort | "foryou";

export interface BrowseFilters {
  sort: BrowseSort;
  /** One type of mod (outfits, tools ...); null is every type. */
  kind: GbKind | null;
  /** A category that isn't a character ("UI", "Weapons"). */
  category: GbCategoryRef | null;
  /** A character's name. */
  character: string | null;
  /** Only mods that pass the High quality filter. */
  hq: boolean;
  /** Leave out mods already in the library. */
  hideInstalled: boolean;
  /** Only creators the user follows. */
  followed: boolean;
  /** Search text (not remembered between sessions). */
  search: string;
}

export const SORTS: Array<{ value: BrowseSort; label: string; title: string }> = [
  { value: "foryou", label: "For you", title: "Mods you don't have that fit the characters and creators in your library" },
  { value: "newest", label: "New", title: "Newest first" },
  { value: "updated", label: "Updated", title: "Recently updated mods" },
  { value: "week", label: "Popular this week", title: "Most liked of the mods added in the last 7 days" },
  { value: "month", label: "Popular this month", title: "Most liked of the mods added in the last 30 days" },
  { value: "popular", label: "Most downloaded", title: "Most downloaded of all time (best match when searching)" },
  { value: "likes", label: "Most liked", title: "Most liked of all time" },
  { value: "views", label: "Most viewed", title: "Most viewed of all time" },
];
export const sortLabel = (s: BrowseSort) => SORTS.find((x) => x.value === s)?.label ?? "Most downloaded";

export const KINDS: Array<{ value: GbKind; label: string; title: string }> = [
  { value: "outfit", label: "Outfits", title: "Character outfits and model edits" },
  { value: "texture", label: "Recolors and textures", title: "Recolors, makeup, face and texture edits" },
  { value: "weapon", label: "Weapons", title: "Weapon models" },
  { value: "tool", label: "Tools and fixes", title: "Shaders, effect removers, camera mods and other fixes" },
  { value: "ui", label: "UI", title: "Menus, icons and loading screens" },
  { value: "other", label: "Other", title: "NPCs, Bangboo, objects and the rest" },
];
export const kindLabel = (k: GbKind | null) => (k ? KINDS.find((x) => x.value === k)?.label ?? "All types" : "All types");

const DEFAULTS: BrowseFilters = { sort: "popular", kind: null, category: null, character: null, hq: false, hideInstalled: false, followed: false, search: "" };
const filterKey = (game: GameId) => `gm.browse.filters.${game}`;
const filters = new Map<GameId, BrowseFilters>();
const filterSubs = new Set<() => void>();

function readFilters(game: GameId): BrowseFilters {
  const hit = filters.get(game);
  if (hit) return hit;
  let f: BrowseFilters = { ...DEFAULTS };
  try {
    const raw = JSON.parse(localStorage.getItem(filterKey(game)) ?? "null") as Partial<BrowseFilters> | null;
    if (raw && typeof raw === "object") {
      f = {
        ...f,
        sort: SORTS.some((s) => s.value === raw.sort) ? raw.sort! : f.sort,
        kind: KINDS.some((k) => k.value === raw.kind) ? raw.kind! : null,
        category: raw.category && typeof raw.category.id === "number" && typeof raw.category.name === "string" ? raw.category : null,
        character: typeof raw.character === "string" && raw.character ? raw.character : null,
        hq: raw.hq === true, hideInstalled: raw.hideInstalled === true, followed: raw.followed === true,
      };
    }
  } catch { /* storage off or bad */ }
  filters.set(game, f);
  return f;
}

export function getFilters(game: GameId): BrowseFilters { return readFilters(game); }

/** Change some filters of a game (remembered, except the search text). */
export function setFilters(game: GameId, patch: Partial<BrowseFilters>) {
  const cur = readFilters(game);
  const next = { ...cur, ...patch };
  if (patch.character) next.category = null;
  if (patch.category) next.character = null;
  if (Object.keys(next).every((k) => next[k as keyof BrowseFilters] === cur[k as keyof BrowseFilters])) return;
  filters.set(game, next);
  try { const { search: _s, ...keep } = next; localStorage.setItem(filterKey(game), JSON.stringify(keep)); } catch { /* storage off */ }
  filterSubs.forEach((f) => f());
}

const subFilters = (f: () => void) => { filterSubs.add(f); return () => { filterSubs.delete(f); }; };
export function useFilters(game: GameId): BrowseFilters {
  return useSyncExternalStore(subFilters, () => readFilters(game));
}

// ── what the library has ──

export interface LibIndex {
  /** Installed mods by GameBanana mod id. */
  byMod: Map<number, ModEntry[]>;
  /** Removed mods (trash or archive) by GameBanana mod id, only for mods not installed now. */
  archived: Map<number, ArchiveEntry>;
}
const EMPTY: LibIndex = { byMod: new Map(), archived: new Map() };
const libs = new Map<GameId, LibIndex>();
const libLoading = new Set<GameId>();
const libSubs = new Set<() => void>();
let wired = false;

async function loadLib(game: GameId) {
  libLoading.add(game);
  try {
    const [lib, archive] = await Promise.all([
      library.list(game).catch(() => [] as ModEntry[]),
      // the archive command may not exist yet in every build: no archive then
      library.archive(game).catch(() => [] as ArchiveEntry[]),
    ]);
    const byMod = new Map<number, ModEntry[]>();
    for (const e of lib) if (e.source?.modId) byMod.set(e.source.modId, [...(byMod.get(e.source.modId) ?? []), e]);
    const archived = new Map<number, ArchiveEntry>();
    for (const a of Array.isArray(archive) ? archive : []) {
      const id = a?.source?.modId;
      if (id && !byMod.has(id) && !archived.has(id)) archived.set(id, a);
    }
    libs.set(game, { byMod, archived });
    libSubs.forEach((f) => f());
  } finally { libLoading.delete(game); }
}

function wire() {
  if (wired) return;
  wired = true;
  const reload = (game: GameId) => { if (libs.has(game)) void loadLib(game); };
  void library.onChanged((p) => reload(p.game)).catch(() => {});
  onApp((e) => { if (e.type === "library-refresh") reload(e.game); });
}

/** The library index of a game, loading it on first use and keeping it current. */
const subLib = (f: () => void) => { libSubs.add(f); return () => { libSubs.delete(f); }; };
export function useLibIndex(game: GameId | null | undefined): LibIndex {
  useEffect(() => { if (game) libIndexNow(game); }, [game]);
  return useSyncExternalStore(subLib, () => (game ? libs.get(game) ?? EMPTY : EMPTY));
}

/** The same, read once (for menus). Starts loading when it isn't there yet. */
export function libIndexNow(game: GameId): LibIndex {
  wire();
  if (!libs.has(game) && !libLoading.has(game)) void loadLib(game);
  return libs.get(game) ?? EMPTY;
}

// ── a mod's page ──

/** Open a GameBanana mod's page over the current page (a step in the history, so Back closes it). */
export function openGbMod(id: number) {
  go({ ...currentRoute(), modId: id });
}
export function closeGbMod() { closeRoute(["modId"]); }

/** The GameBanana mod id the route opens, if any: a number anywhere, a numeric text in Browse. */
export function gbModOfRoute(r: { view: string; modId?: string | number }): number | null {
  if (typeof r.modId === "number") return r.modId > 0 ? r.modId : null;
  if (r.view === "browse" && typeof r.modId === "string" && /^\d+$/.test(r.modId)) return Number(r.modId);
  return null;
}
