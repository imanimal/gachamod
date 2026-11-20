// What the window keeps in its saved page data (localStorage) that gachamod can load again: character portraits, game
// icons, GameBanana lookups (creator stats, character lists, the quality bar), key descriptions, the character sync
// time, the message of the day and the palette's recent picks. Settings > Storage shows the size and clears it
// (screens/settings/Storage.tsx). Theme, layout, saved filters and other choices are not here and are never touched.
// Owner: SYSTEM area.

/** Key prefixes (or whole keys) of the caches. A cache written under a new key must be listed here. */
export const CACHE_KEY_PREFIXES = [
  "gm.portraits.", // character portraits per game (lib/portraits.ts)
  "gm.appicon.", // game icons (ui/GameBadge.tsx)
  "gm.gb.", // GameBanana lookups: members, records, characters, games, the quality bar (lib/gamebanana.ts)
  "gm.charsync.", // when each game's characters were last read (lib/warmup.ts)
  "gm.desckeys.", // key descriptions read from a mod's page (ui/KeyEditor.tsx)
  "gm.motd", // the message of the day (lib/motd.ts)
  "gm.palette.recent", // the palette's recent picks (lib/search.ts)
] as const;

function cacheKeys(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && CACHE_KEY_PREFIXES.some((p) => k.startsWith(p))) out.push(k);
    }
  } catch { /* storage unavailable */ }
  return out;
}

/** About how many bytes the caches take (two bytes a character, as the browser stores them). */
export function cacheBytes(): number {
  let n = 0;
  for (const k of cacheKeys()) {
    try { n += (k.length + (localStorage.getItem(k)?.length ?? 0)) * 2; } catch { /* storage unavailable */ }
  }
  return n;
}

/** How many entries the caches hold. */
export function cacheCount(): number { return cacheKeys().length; }

/** Delete the caches. Returns the bytes freed. */
export function clearCaches(): number {
  const freed = cacheBytes();
  for (const k of cacheKeys()) {
    try { localStorage.removeItem(k); } catch { /* storage unavailable */ }
  }
  return freed;
}
