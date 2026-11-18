// Time spent in each game, for the year card in Settings, Fun extras. The backend counts it (gacha-core playtime.rs),
// so it adds up while gachamod runs in the background with no window; this reads it. Kept in the app's settings by
// year and game, in seconds. Owner: SETTINGS/AI area.
import { settings } from "./api";

type Years = Record<string, Record<string, number>>;

/** Seconds played per game in a year, and when counting began (0: never). Read fresh each time. */
export async function playedIn(year: number): Promise<{ games: Record<string, number>; since: number }> {
  const [played, since] = await Promise.all([settings.getJson<Years>("stats.played", {}), settings.getJson<number>("stats.playedSince", 0)]);
  return { games: played[String(year)] ?? {}, since: typeof since === "number" ? since : 0 };
}
