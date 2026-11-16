// Time spent in each game, counted on this PC from when gachamod sees it start until it closes, for the year card
// in Settings, Fun extras. Kept in the app's settings by year and game, in seconds. Owner: SETTINGS/AI area.
import { jsonPref } from "./prefs";

type Years = Record<string, Record<string, number>>;
const played = jsonPref<Years>("stats.played", {});
const since = jsonPref<number>("stats.playedSince", 0);
const started = new Map<string, number>();

/** The game's running state changed (from the game-state event). */
export function notePlaying(game: string, running: boolean) {
  const now = Date.now();
  if (running) { if (!started.has(game)) started.set(game, now); return; }
  const from = started.get(game);
  started.delete(game);
  if (from === undefined) return;
  const secs = Math.round((now - from) / 1000);
  if (secs < 30) return;
  const year = String(new Date(from).getFullYear());
  const all = { ...played.get() };
  all[year] = { ...(all[year] ?? {}), [game]: (all[year]?.[game] ?? 0) + secs };
  void played.set(all);
  if (!since.get()) void since.set(from);
}

/** Seconds played per game in a year, and when counting began (0: never). */
export async function playedIn(year: number): Promise<{ games: Record<string, number>; since: number }> {
  await Promise.all([played.ready, since.ready]);
  return { games: played.get()[String(year)] ?? {}, since: since.get() };
}
