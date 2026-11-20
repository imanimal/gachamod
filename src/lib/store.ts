// App-wide state: the games, the current game, the current page with back and forward, nav badges and events
// between areas. Tiny external stores used with useSyncExternalStore, so any screen can read them without prop
// drilling. Owner: skeleton.
import type { AiTask } from "./ai";
import { useSyncExternalStore } from "react";
import { games as gamesApi, library as libraryApi, type GameId, type GameState } from "./api";
import { held, isMenuWindow } from "./tauri";

type Sub = () => void;
function store<T>(initial: T) {
  let value = initial;
  const subs = new Set<Sub>();
  return {
    get: () => value,
    set: (v: T) => { value = v; subs.forEach((f) => f()); },
    sub: (f: Sub) => { subs.add(f); return () => { subs.delete(f); }; },
  };
}

// ── games ──

const gameList = store<GameState[]>([]);
const LAST_GAME = "gm.game";
const ONLY_GAME = "gm.onlyGame";
const readKey = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
/** The menu over a running game is a window with pages of its own (screens/ingame/Overlay.tsx). Where it goes isn't
 *  kept: the app opens on the game and page its own window was on. */
const MENU = isMenuWindow();
const keep = (k: string, v: string) => { if (MENU) return; try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
/** One-game mode: the game the app opens on and the only one the everyday UI offers. */
const only = store<GameId | null>(readKey(ONLY_GAME) as GameId | null);
const current = store<GameId | null>((only.get() ?? readKey(LAST_GAME)) as GameId | null);

export const useGames = () => useSyncExternalStore(gameList.sub, gameList.get);
/** The shown games, in registry order. */
export const useShownGames = () => useGames().filter((g) => g.shown);
export const useGameId = () => useSyncExternalStore(current.sub, current.get);
/** The current game, or null before the list loads or when no game is set up. */
export function useGame(): GameState | null {
  const list = useGames();
  const id = useGameId();
  return list.find((g) => g.id === id) ?? null;
}
export const currentGame = (): GameState | null => gameList.get().find((g) => g.id === current.get()) ?? null;
export const allGames = (): GameState[] => gameList.get();
/** The game list once it has been read (at once when it has). */
export function whenGames(): Promise<GameState[]> {
  if (gameList.get().length) return Promise.resolve(gameList.get());
  return new Promise((done) => { const off = gameList.sub(() => { if (gameList.get().length) { off(); done(gameList.get()); } }); });
}
/** The key that reloads mods in a game (its d3dx.ini reload_config), F10 until the list loads. */
export const reloadKeyOf = (id: GameId | string): string => gameList.get().find((g) => g.id === id)?.reloadKey || "F10";

// ── one-game mode ──

/** The game picked in one-game mode, while it is shown; null when the mode is off. */
export function onlyGame(): GameState | null {
  const id = only.get();
  return (id && gameList.get().find((g) => g.id === id && g.shown)) || null;
}
export function useOnlyGame(): GameState | null {
  const id = useSyncExternalStore(only.sub, only.get);
  return useGames().find((g) => g.id === id && g.shown) ?? null;
}
/** Turn one-game mode on for a game (null turns it off). The other games stay set up and searchable. */
export function setOnlyGame(id: GameId | null) {
  only.set(id);
  try { if (id) localStorage.setItem(ONLY_GAME, id); else localStorage.removeItem(ONLY_GAME); } catch { /* storage unavailable */ }
}
/** The games the everyday UI offers (the sidebar's switcher, the game menus, Ctrl+Tab): every shown game, or in
 *  one-game mode that game plus the one open now when you went to another. */
function daily(list: GameState[], onlyId: GameId | null, cur: GameId | null): GameState[] {
  const shown = list.filter((g) => g.shown);
  if (!onlyId || !shown.some((g) => g.id === onlyId)) return shown;
  return shown.filter((g) => g.id === onlyId || g.id === cur);
}
export const dailyGames = () => daily(gameList.get(), only.get(), current.get());
export function useDailyGames(): GameState[] {
  const list = useGames();
  const onlyId = useSyncExternalStore(only.sub, only.get);
  const cur = useGameId();
  return daily(list, onlyId, cur);
}

function writeGame(id: GameId) {
  current.set(id);
  keep(LAST_GAME, id);
}

/** Switch games. It is a step in the page history, so Back returns to the game you came from. The view stays; its
 *  game-specific details (a character, a mod) are dropped. */
export function setGame(id: GameId) {
  if (current.get() === id) return;
  const r = route.get();
  const keep: Route = { view: r.view };
  if (r.view === "settings" || r.view === "tools") { if (r.section) keep.section = r.section; }
  push({ game: id, route: keep });
}

/** Replace the game list (after detect, a path change ...). Picks a current game when none is valid. */
export function setGames(list: GameState[]) {
  const loading = !gameList.get().length;
  gameList.set(list);
  const id = current.get();
  if (!id || !list.some((g) => g.id === id && g.shown)) {
    const first = list.find((g) => g.id === only.get() && g.shown) ?? list.find((g) => g.shown) ?? list[0];
    if (first) {
      writeGame(first.id);
      const e = entries[at];
      if (e) e.game = first.id;
    }
  }
  // the backend's counts can be older than the library, so read the current game's mods once the list is in
  const cur = current.get();
  if (loading && cur && list.length) recountMods(cur);
}

export async function refreshGames(detect = false): Promise<GameState[]> {
  const list = detect ? await gamesApi.detect() : await gamesApi.list();
  setGames(list);
  return list;
}

/** Patch one game in place (running state from an event, counts after a scan). */
export function patchGame(id: GameId, patch: Partial<GameState>) {
  gameList.set(gameList.get().map((g) => (g.id === id ? { ...g, ...patch } : g)));
}

// ── each game's mod counts (the game card, the corner, the Mods badge), kept in step with its library ──

const updateCounts = new Map<GameId, number>();
function showUpdateBadge() {
  const id = current.get();
  const n = id ? updateCounts.get(id) ?? 0 : 0;
  setBadge("library", n ? { count: n, tone: "accent" } : null);
}
/** Take a game's mod list as the truth for its counts: mods, mods on, and mods with an update. */
export function noteMods(game: GameId, list: Array<{ enabled: boolean; updateAvailable: boolean }>) {
  const g = gameList.get().find((x) => x.id === game);
  const on = list.filter((m) => m.enabled).length;
  if (g && (g.modCount !== list.length || g.enabledCount !== on)) patchGame(game, { modCount: list.length, enabledCount: on });
  updateCounts.set(game, list.filter((m) => m.updateAvailable).length);
  if (game === current.get()) showUpdateBadge();
}
const recountTimers = new Map<GameId, ReturnType<typeof setTimeout>>();
/** Read a game's mods again for its counts, soon (a burst of changes reads once). */
export function recountMods(game: GameId) {
  clearTimeout(recountTimers.get(game));
  recountTimers.set(game, setTimeout(() => {
    recountTimers.delete(game);
    libraryApi.list(game).then((l) => noteMods(game, l)).catch(() => { /* the next change tries again */ });
  }, 200));
}

// ── pages, with back and forward ──

export type View = "home" | "library" | "characters" | "browse" | "downloads" | "profiles" | "tools" | "settings" | "extensions";
/** The views in the sidebar (and LB/RB order). Extensions is reached from Settings and search, so it isn't here. */
export const VIEWS: View[] = ["home", "browse", "characters", "library", "profiles", "downloads", "tools", "settings"];

/** A page. Optional fields are read by the target screen (docs/spec.md, "Navigation"). Every field is part of the
 *  page, so Back and Forward bring the same thing back (an open character, an open mod, a creator's page). */
export interface Route {
  view: View;
  /** library: this mod's details (a library id). browse: this GameBanana mod's page (a number). */
  modId?: string | number;
  /** Any view: this GameBanana tool's page (a fixer, a script), opened over the page. */
  toolId?: number;
  /** characters: this character's page. library and browse: only this character. */
  character?: string;
  /** library: only mods without a character of this type ("ui", "tool", "weapon", "other"; library/kinds.ts). */
  kind?: string;
  /** library and browse: start with this search text. */
  search?: string;
  /** library: start with this filter chip on ("updates", "favourites"). */
  flag?: string;
  /** settings and tools: scroll to the section with this id. */
  section?: string;
  /** browse: this GameBanana member's page (creator id). */
  user?: number;
  /** profiles: this profile's page, with its mods. */
  profile?: number;
  /** A tab on the page ("problems" or "archive" in Mods, "online" or "ext:<extension id>" on a character's page, "all" in
   *  Downloads, "installed" in Extensions). */
  tab?: string;
  /** extensions: this extension's own page. */
  ext?: string;
}

interface Entry { game: GameId | null; route: Route; scroll?: number }

const LAST_VIEW = "gm.view";
const firstRoute = (): Route => {
  if (MENU) return { view: "library" };
  try { const v = localStorage.getItem(LAST_VIEW) as View | null; if (v && (VIEWS.includes(v) || v === "extensions")) return { view: v }; } catch { /* storage unavailable */ }
  return { view: "home" };
};
const entries: Entry[] = [{ game: current.get(), route: firstRoute() }];
let at = 0;
const route = store<Route>(entries[0]!.route);
const nav = store({ back: false, forward: false, n: 0 });
/** Set while a page comes back from history, so the shell restores its scroll position. */
let restoring: number | undefined;

const sameRoute = (a: Route, b: Route) => {
  const ka = Object.keys(a).filter((k) => a[k as keyof Route] !== undefined).sort();
  const kb = Object.keys(b).filter((k) => b[k as keyof Route] !== undefined).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k as keyof Route] === b[k as keyof Route]);
};
const clean = (r: Route): Route => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && v !== "")) as unknown as Route;

function show() {
  const e = entries[at]!;
  if (e.game && e.game !== current.get()) writeGame(e.game);
  route.set(e.route);
  nav.set({ back: at > 0, forward: at < entries.length - 1, n: nav.get().n + 1 });
  keep(LAST_VIEW, e.route.view);
}

function push(e: Entry) {
  const cur = entries[at];
  if (cur && cur.game === e.game && sameRoute(cur.route, e.route)) return;
  if (cur) cur.scroll = scrollOfView();
  entries.splice(at + 1);
  entries.push(e);
  if (entries.length > 120) entries.shift();
  at = entries.length - 1;
  restoring = undefined;
  show();
}

const scrollOfView = () => (document.querySelector(".app .view") as HTMLElement | null)?.scrollTop ?? 0;

export const useRoute = () => useSyncExternalStore(route.sub, route.get);
export const currentRoute = () => route.get();
/** Call `cb` after every page change (usage counts). Returns what stops it. */
export const onRoute = (cb: () => void) => route.sub(cb);
/** Whether Back and Forward have somewhere to go. */
export const useNav = () => useSyncExternalStore(nav.sub, nav.get);

/** Go to a page (a new step in the history). */
export function go(to: Route | View) {
  const r = clean(typeof to === "string" ? { view: to } : to);
  push({ game: current.get(), route: r });
}

/** Go to a page of another game (a mod installed in that game's Mods), switching to it. */
export function goIn(game: GameId, to: Route | View) {
  const r = clean(typeof to === "string" ? { view: to } : to);
  push({ game, route: r });
}

/** Change the current page without a new history step (a filter, a closed drawer). */
export function replaceRoute(to: Route) {
  const r = clean(to);
  const e = entries[at];
  if (e && sameRoute(e.route, r)) return;
  if (e) e.route = r; else entries.push({ game: current.get(), route: r });
  route.set(r);
  keep(LAST_VIEW, r.view);
}

/** Set some fields of the current page in place (`undefined` clears one). */
export function patchRoute(p: Partial<Route>) { replaceRoute({ ...route.get(), ...p }); }

export function back() {
  if (at <= 0) return false;
  entries[at]!.scroll = scrollOfView();
  at--;
  restoring = entries[at]!.scroll;
  show();
  return true;
}
export function forward() {
  if (at >= entries.length - 1) return false;
  entries[at]!.scroll = scrollOfView();
  at++;
  restoring = entries[at]!.scroll;
  show();
  return true;
}

/** Leave a part of the page (close a drawer, leave a character's page): Back when the step before is the same page
 *  without it, otherwise drop those fields in place. Keeps the history free of dead ends. */
export function closeRoute(keys: Array<keyof Route>) {
  const cur = route.get();
  const without = { ...cur };
  for (const k of keys) delete without[k];
  const prev = entries[at - 1];
  if (prev && prev.game === current.get() && sameRoute(prev.route, clean(without))) { back(); return; }
  replaceRoute(without);
}

/** Clear one-shot fields once a screen used them (Settings' section scroll). No history step. */
export function consumeRoute(keys: Array<keyof Route>) {
  const r = { ...route.get() };
  let changed = false;
  for (const k of keys) if (k !== "view" && r[k] !== undefined) { delete r[k]; changed = true; }
  if (changed) replaceRoute(r);
}

/** The scroll position to put back after Back or Forward, once (the shell asks after the page renders). */
export function takeRestoreScroll(): number | undefined { const s = restoring; restoring = undefined; return s; }

/** The last few pages, newest first, for the history menu on the Back key. */
export function recentPages(dir: -1 | 1, n = 10): Array<{ index: number; game: GameId | null; route: Route }> {
  const out: Array<{ index: number; game: GameId | null; route: Route }> = [];
  for (let i = at + dir; i >= 0 && i < entries.length && out.length < n; i += dir) out.push({ index: i, game: entries[i]!.game, route: entries[i]!.route });
  return out;
}
/** Jump to a page from recentPages. */
export function goIndex(index: number) {
  if (index < 0 || index >= entries.length || index === at) return;
  entries[at]!.scroll = scrollOfView();
  at = index;
  restoring = entries[at]!.scroll;
  show();
}

// ── nav badges: each area sets its own count ("library": updates, "downloads": active, "tools": problems) ──

const badgeStore = store<Partial<Record<View, { count?: number; tone?: "accent" | "bad" | "run" }>>>({});
export const useBadges = () => useSyncExternalStore(badgeStore.sub, badgeStore.get);
export function setBadge(view: View, badge: { count?: number; tone?: "accent" | "bad" | "run" } | null) {
  const now = badgeStore.get()[view];
  const next = badge && (badge.count || badge.tone) ? badge : undefined;
  if (now?.count === next?.count && now?.tone === next?.tone) return;
  const b = { ...badgeStore.get() };
  if (next) b[view] = next; else delete b[view];
  badgeStore.set(b);
}

// ── app events between areas (docs/spec.md, "Cross-area events") ──

export type AppEvent =
  | { type: "open-pack"; path: string }
  | { type: "install-paths"; paths: string[] }
  | { type: "export-mods"; game: GameId; modIds: string[] }
  | { type: "export-profile"; game: GameId; profileId: number }
  /** Share a game's whole library with its profiles ("game"), or every game's ("all"). */
  | { type: "export-pack"; game: GameId; scope: "game" | "all" }
  | { type: "open-gb-link"; url: string }
  | { type: "library-refresh"; game: GameId }
  /** Open the command palette, optionally with text in it. `typed`: a key typed with nothing focused, added to
   *  the text when the palette is already open (keys typed in a quick burst arrive before it has focus). */
  | { type: "palette"; text?: string; typed?: boolean }
  /** Open the AI helper (lib/ai.ts askAi). */
  | { type: "ai"; task: AiTask };

export function emitApp(e: AppEvent) { window.dispatchEvent(new CustomEvent("gm-app", { detail: e })); }
export function onApp(cb: (e: AppEvent) => void): () => void {
  const h = (ev: Event) => cb((ev as CustomEvent<AppEvent>).detail);
  window.addEventListener("gm-app", h);
  return () => window.removeEventListener("gm-app", h);
}

// the counts follow the library: a game switch, a refresh asked for anywhere, or the backend saying it changed
// (not in tests, which run without a window)
if (typeof window !== "undefined") {
  current.sub(() => {
    showUpdateBadge();
    const id = current.get();
    if (id && gameList.get().length) recountMods(id);
  });
  onApp((e) => { if (e.type === "library-refresh") recountMods(e.game); });
  held(libraryApi.onChanged((p) => recountMods(p.game)));
}
