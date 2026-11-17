// Shared state for the GameBanana browser: the filters (one set per game, shared by the Browse page, Home's
// embedded browser and the character pages, so Expand keeps them; a return within half an hour keeps them, a later
// visit starts plain), what the library has (installed and
// archived mods by GameBanana id) and opening a mod's page. Owner: BROWSE area.
import { useEffect, useSyncExternalStore } from "react";
import { library, type ArchiveEntry, type GameId, type ModEntry } from "../../lib/api";
import { type GbCategoryRef, type GbKind, type GbSort } from "../../lib/gamebanana";
import { closeRoute, currentRoute, go, onApp } from "../../lib/store";
import { onPublish } from "../library/data";

// ── filters ──

/** GameBanana's sorts plus "foryou" (lib/recommend.ts). "relevance" only goes with a search. */
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
  { value: "relevance", label: "Relevance", title: "Best match for the search first" },
  { value: "foryou", label: "For you", title: "Mods you don't have that fit the characters and creators in your library" },
  { value: "newest", label: "New", title: "Newest first" },
  { value: "updated", label: "Updated", title: "Recently updated mods" },
  { value: "week", label: "Popular this week", title: "Most liked of the mods added in the last 7 days" },
  { value: "month", label: "Popular this month", title: "Most liked of the mods added in the last 30 days" },
  { value: "popular", label: "Most downloaded", title: "Most downloaded of all time" },
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
  { value: "other", label: "Other", title: "NPCs, objects and the rest" },
];
/** A type's tip for one game (Other names Bangboo in Zenless Zone Zero). */
export const kindTitle = (k: { value: GbKind; title: string }, game: GameId) =>
  k.value === "other" && game === "zzz" ? "NPCs, Bangboo, objects and the rest" : k.title;
export const kindLabel = (k: GbKind | null) => (k ? KINDS.find((x) => x.value === k)?.label ?? "All types" : "All types");

/** What a visit starts with: newest mods first, nothing filtered. */
export const DEFAULTS: BrowseFilters = { sort: "newest", kind: null, category: null, character: null, hq: false, hideInstalled: false, followed: false, search: "" };
const filters = new Map<GameId, BrowseFilters>();
const filterSubs = new Set<() => void>();
/** The sort from before a search switched to Relevance, put back when the search is cleared. */
const sortBeforeSearch = new Map<GameId, BrowseSort>();
const browseSort = (game: GameId, s: BrowseSort) => (s === "relevance" ? sortBeforeSearch.get(game) ?? DEFAULTS.sort : s);

// filters were kept between visits before; a visit now always starts plain (saved filter sets put one back)
try { for (const k of Object.keys(localStorage)) if (k.startsWith("gm.browse.filters.")) localStorage.removeItem(k); } catch { /* storage off */ }

function readFilters(game: GameId): BrowseFilters {
  const hit = filters.get(game);
  if (hit) return hit;
  const f: BrowseFilters = { ...DEFAULTS };
  filters.set(game, f);
  return f;
}

export function getFilters(game: GameId): BrowseFilters { return readFilters(game); }

/** How many filters are on, besides the sort and the search (the Filters button's count). */
export function filterCount(f: BrowseFilters, fixedChar = false): number {
  return [f.kind, f.category && !f.character, !fixedChar && f.character, f.hq, f.followed, f.hideInstalled].filter(Boolean).length;
}

/** Change some filters of a game. They last while a browser stays open (and across Home's Expand); a visit more
 *  than half an hour after the last one starts from DEFAULTS. */
export function setFilters(game: GameId, patch: Partial<BrowseFilters>) {
  const cur = readFilters(game);
  const next = { ...cur, ...patch };
  if (patch.character) next.category = null;
  if (patch.category) next.character = null;
  // a new search sorts by relevance (For you would only search its own picks); clearing it puts the sort back
  if (patch.sort === undefined && next.search && !cur.search) next.sort = "relevance";
  if (next.sort === "relevance") {
    if (!next.search) next.sort = browseSort(game, "relevance");
    else if (cur.sort !== "relevance") sortBeforeSearch.set(game, cur.sort);
  }
  if (Object.keys(next).every((k) => next[k as keyof BrowseFilters] === cur[k as keyof BrowseFilters])) return;
  filters.set(game, next);
  filterSubs.forEach((f) => f());
}

// A browser opening fresh drops the last visit's filters, unless something opened it to show them (a category link,
// See all, Expand). Those mark the game just before they navigate.
const carry = new Map<GameId, number>();

/** Set filters for the browser that is about to open (and keep them when it does). */
export function openWithFilters(game: GameId, patch: Partial<BrowseFilters> = {}) {
  setFilters(game, patch);
  carry.set(game, Date.now());
}

/** A return within this long keeps the filters (and Browse's place in the grid): a toast's Show, Back, a quick look
 *  at Downloads. A visit after that starts plain. */
const KEEP_MS = 30 * 60 * 1000;
/** When a browser of the game last closed. */
const leftAt = new Map<GameId, number>();
/** Where the full Browse grid was when it closed: how far it was scrolled and how many cards it showed. */
const place = new Map<GameId, { scroll: number; limit: number }>();

/** Called once as a browser mounts, before it reads the filters. Doesn't notify: nothing else shows them yet.
 *  Returns whether the last visit's filters were kept. */
export function beginVisit(game: GameId): boolean {
  const at = carry.get(game);
  if (at !== undefined && Date.now() - at < 5000) return true;
  const left = leftAt.get(game);
  if (left !== undefined && Date.now() - left < KEEP_MS) return true;
  sortBeforeSearch.delete(game);
  place.delete(game);
  filters.set(game, { ...DEFAULTS });
  return false;
}

/** A browser of the game closed. `at`: the full grid's place, to put back on a return. */
export function endVisit(game: GameId, at?: { scroll: number; limit: number }) {
  leftAt.set(game, Date.now());
  if (at) place.set(game, at);
}

/** The full grid's place from the last visit, once (null when there is none to put back). */
export function takePlace(game: GameId): { scroll: number; limit: number } | null {
  const p = place.get(game) ?? null;
  place.delete(game);
  return p;
}

/** The browser has mounted: a mark left for it is used up. */
export function endCarry(game: GameId) { carry.delete(game); }

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
  // a mod turned on or off here or in Mods
  onPublish((game) => reload(game));
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
  const { toolId: _, ...r } = currentRoute();
  go({ ...r, modId: id });
}
export function closeGbMod() { closeRoute(["modId"]); }

/** Open a GameBanana tool's page (a fixer) over the current page, the same way. It takes the place of an open mod
 *  page or mod details (Back brings them back). */
export function openGbTool(id: number) {
  const { modId: _, ...r } = currentRoute();
  go({ ...r, toolId: id });
}
export function closeGbTool() { closeRoute(["toolId"]); }

/** The GameBanana mod id the route opens, if any: a number anywhere, a numeric text in Browse. */
export function gbModOfRoute(r: { view: string; modId?: string | number }): number | null {
  if (typeof r.modId === "number") return r.modId > 0 ? r.modId : null;
  if (r.view === "browse" && typeof r.modId === "string" && /^\d+$/.test(r.modId)) return Number(r.modId);
  return null;
}
