// App-wide state: the games, the current game, the current view and its parameters. Tiny external stores used with
// useSyncExternalStore, so any screen can read them without prop drilling. Owner: skeleton.
import { useSyncExternalStore } from "react";
import { games as gamesApi, type GameId, type GameState } from "./api";

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
const readLast = () => { try { return localStorage.getItem(LAST_GAME); } catch { return null; } };
const current = store<GameId | null>(readLast());

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

export function setGame(id: GameId) {
  current.set(id);
  try { localStorage.setItem(LAST_GAME, id); } catch { /* storage unavailable */ }
}

/** Replace the game list (after detect, a path change ...). Picks a current game when none is valid. */
export function setGames(list: GameState[]) {
  gameList.set(list);
  const id = current.get();
  if (!id || !list.some((g) => g.id === id && g.shown)) {
    const first = list.find((g) => g.shown) ?? list[0];
    if (first) setGame(first.id);
  }
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

// ── navigation ──

export type View = "home" | "library" | "characters" | "browse" | "downloads" | "profiles" | "tools" | "settings";
export const VIEWS: View[] = ["home", "library", "characters", "browse", "downloads", "profiles", "tools", "settings"];

/** Where to go. Optional fields are read by the target screen (docs/spec.md, "Navigation"). */
export interface Route {
  view: View;
  /** library: open this mod's drawer. browse: open this GameBanana mod's page (a number). */
  modId?: string | number;
  /** library and browse: filter to this character. */
  character?: string;
  /** browse: start with this search text. */
  search?: string;
  /** settings and tools: scroll to the section with this id. */
  section?: string;
}

const LAST_VIEW = "gm.view";
const route = store<Route>((() => {
  try { const v = localStorage.getItem(LAST_VIEW) as View | null; if (v && VIEWS.includes(v)) return { view: v }; } catch { /* storage unavailable */ }
  return { view: "home" };
})());

export const useRoute = () => useSyncExternalStore(route.sub, route.get);
export function go(to: Route | View) {
  const r = typeof to === "string" ? { view: to } : to;
  route.set(r);
  try { localStorage.setItem(LAST_VIEW, r.view); } catch { /* storage unavailable */ }
}
/** Clear one-shot route params once a screen used them (so going back to the view doesn't reopen the drawer). */
export function consumeRoute(keys: Array<keyof Route>) {
  const r = { ...route.get() };
  let changed = false;
  for (const k of keys) if (k !== "view" && r[k] !== undefined) { delete r[k]; changed = true; }
  if (changed) route.set(r);
}

// ── nav badges: each area sets its own count ("library": updates, "downloads": active, "tools": problems) ──

const badgeStore = store<Partial<Record<View, { count?: number; tone?: "accent" | "bad" | "run" }>>>({});
export const useBadges = () => useSyncExternalStore(badgeStore.sub, badgeStore.get);
export function setBadge(view: View, badge: { count?: number; tone?: "accent" | "bad" | "run" } | null) {
  const b = { ...badgeStore.get() };
  if (badge && (badge.count || badge.tone)) b[view] = badge; else delete b[view];
  badgeStore.set(b);
}

// ── app events between areas (docs/spec.md, "Cross-area events") ──

export type AppEvent =
  | { type: "open-pack"; path: string }
  | { type: "install-paths"; paths: string[] }
  | { type: "export-mods"; game: GameId; modIds: string[] }
  | { type: "export-profile"; game: GameId; profileId: number }
  | { type: "open-gb-link"; url: string }
  | { type: "library-refresh"; game: GameId };

export function emitApp(e: AppEvent) { window.dispatchEvent(new CustomEvent("gm-app", { detail: e })); }
export function onApp(cb: (e: AppEvent) => void): () => void {
  const h = (ev: Event) => cb((ev as CustomEvent<AppEvent>).detail);
  window.addEventListener("gm-app", h);
  return () => window.removeEventListener("gm-app", h);
}
