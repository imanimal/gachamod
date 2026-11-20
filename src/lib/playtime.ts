// Time spent in each game, for the year card in Settings, Fun extras. The backend counts it (gacha-core playtime.rs),
// so it adds up while gachamod runs in the background with no window; this reads it. Kept in the app's settings by
// year and game, in seconds. Owner: SETTINGS/AI area.
import { settings } from "./api";
import { pref } from "./prefs";

type Years = Record<string, Record<string, number>>;

/** Seconds played per game in a year, and when counting began (0: never). Read fresh each time. */
export async function playedIn(year: number): Promise<{ games: Record<string, number>; since: number }> {
  const [played, since] = await Promise.all([settings.getJson<Years>("stats.played", {}), settings.getJson<number>("stats.playedSince", 0)]);
  return { games: played[String(year)] ?? {}, since: typeof since === "number" ? since : 0 };
}

/** Count the hours each game is open (gacha-core playtime.rs reads "stats.playtime": only "0" turns it off). */
export const playtimePref = pref<boolean>("stats.playtime", true, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));

/** Everything kept: seconds per game across all years, and when counting began (0: never). */
export async function playedAll(): Promise<{ games: Record<string, number>; since: number }> {
  const [played, since] = await Promise.all([settings.getJson<Years>("stats.played", {}), settings.getJson<number>("stats.playedSince", 0)]);
  const games: Record<string, number> = {};
  for (const year of Object.values(played)) for (const [g, secs] of Object.entries(year)) games[g] = (games[g] ?? 0) + secs;
  return { games, since: typeof since === "number" ? since : 0 };
}

/** The kept values as saved, for putting them back after a reset. */
export type PlayedRaw = { played: string; since: string };

/** Erase the counts. Resolves to what was there, so the reset can be undone. */
export async function clearPlayed(): Promise<PlayedRaw> {
  const [played, since] = await Promise.all([settings.get("stats.played"), settings.get("stats.playedSince")]);
  await Promise.all([settings.set("stats.played", "{}"), settings.set("stats.playedSince", "0")]);
  return { played: played ?? "{}", since: since ?? "0" };
}

export async function restorePlayed(raw: PlayedRaw): Promise<void> {
  await Promise.all([settings.set("stats.played", raw.played), settings.set("stats.playedSince", raw.since)]);
}
