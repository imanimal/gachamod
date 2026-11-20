// Mod of the day: a GameBanana mod a day, picked by animal and listed in curated/mod-of-the-day.json in gachamod's
// repository. Nothing shows while that file says "enabled": false. When it's on, Browse gets a small button beside
// "Open GameBanana" for the pick of the current game, and Settings, Fun extras can hide it. Only people who can push to the
// repository can change the picks; the app only reads the file (once every 12 hours, and not at all while hidden).
// scripts/motd.mjs adds a pick. Owner: ONLINE area.
import { useEffect, useState } from "react";
import { pref } from "./prefs";

export const MOTD_URL = "https://raw.githubusercontent.com/imanimal/gachamod/main/curated/mod-of-the-day.json";
export const motdPref = pref<boolean>("fun.motd", true, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));

export interface MotdPick { date: string; game: string; modId: number; name?: string; note?: string }
interface Feed { enabled: boolean; picks: MotdPick[] }
const CACHE = "gm.motd";
const TTL = 12 * 3600_000;

function cached(): { at: number; feed: Feed } | null {
  try { const c = JSON.parse(localStorage.getItem(CACHE) ?? "null"); return c && typeof c.at === "number" && c.feed ? c : null; } catch { return null; }
}

let loading: Promise<Feed | null> | null = null;
/** The list of picks, from the cache when it's fresh. Null when it can't be read. */
export function motdFeed(): Promise<Feed | null> {
  const c = cached();
  if (c && Date.now() - c.at < TTL) return Promise.resolve(c.feed);
  // hidden in Settings (Fun extras or Online lookups): the list isn't asked for, the saved one is all there is
  return loading ??= motdPref.ready
    .then(() => (motdPref.get() ? fetch(MOTD_URL, { headers: { Accept: "application/json" } }) : null))
    .then((r) => (r ? (r.ok ? r.json() : null) : undefined))
    .then((raw: unknown) => {
      if (raw === undefined) return c?.feed ?? null;
      const o = raw as Partial<Feed> | null;
      const feed: Feed | null = o && typeof o.enabled === "boolean" && Array.isArray(o.picks)
        ? { enabled: o.enabled, picks: o.picks.filter((p) => p && typeof p.date === "string" && typeof p.game === "string" && Number.isInteger(p.modId)) }
        : null;
      try { localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), feed: feed ?? { enabled: false, picks: [] } })); } catch { /* no storage */ }
      return feed;
    })
    .catch(() => c?.feed ?? null)
    .finally(() => { loading = null; });
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Today's pick for a game (or the latest from the last three days), or null. */
export function pickFor(feed: Feed | null, game: string): MotdPick | null {
  if (!feed?.enabled) return null;
  const now = today();
  const recent = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10);
  return feed.picks.filter((p) => p.game === game && p.date <= now && p.date >= recent).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}

/** Whether the curated list is switched on (Settings, Fun extras shows its row only then). */
export function useMotdOn(): boolean {
  const [on, setOn] = useState(() => !!cached()?.feed.enabled);
  useEffect(() => { void motdFeed().then((f) => setOn(!!f?.enabled)); }, []);
  return on;
}

/** The pick for a game, while Mod of the day is shown. */
export function useMotd(game: string): MotdPick | null {
  const shown = motdPref.use();
  const [pick, setPick] = useState<MotdPick | null>(() => (shown ? pickFor(cached()?.feed ?? null, game) : null));
  useEffect(() => {
    if (!shown) { setPick(null); return; }
    let live = true;
    void motdFeed().then((f) => { if (live) setPick(pickFor(f, game)); });
    return () => { live = false; };
  }, [game, shown]);
  return pick;
}
