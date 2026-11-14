// A game's icon, sharp at any size and rounded like an app icon. Where it comes from, in order:
//   1. the game's own exe icon (games.icon, a 256 px PNG the backend keeps; null until the game folder is known)
//   2. the App Store's 512 px icon (gameMeta(id).appStore, looked up once and kept for 30 days)
//   3. a lettered badge in the game's accent ("ZZZ", "WuWa", or the id like "HSR" when the short name is long)
// GameBanana's own game icons are 32 px, so they are never used here. Owner: SHELL area.
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { fileUrl, games, type GameId, type GameState } from "../lib/api";
import { gameMeta } from "../lib/games";
import { onColor } from "../lib/theme";

const MONTH = 30 * 24 * 3600 * 1000;
const DAY = 24 * 3600 * 1000;

// what is known per game: undefined = still looking, null = no picture
const known = new Map<GameId, string | null>();
const looking = new Set<GameId>();
const subs = new Set<() => void>();
let version = 0;
const changed = () => { version++; subs.forEach((f) => f()); };

function readStore(id: number): string | null | undefined {
  try {
    const raw = localStorage.getItem(`gm.appicon.${id}`);
    if (!raw) return undefined;
    const o = JSON.parse(raw) as { url: string | null; at: number };
    const age = Date.now() - o.at;
    if (o.url ? age > MONTH : age > DAY) return undefined;
    return o.url;
  } catch { return undefined; }
}
function writeStore(id: number, url: string | null) {
  try { localStorage.setItem(`gm.appicon.${id}`, JSON.stringify({ url, at: Date.now() })); } catch { /* storage unavailable */ }
}

async function appStoreIcon(id: number): Promise<string | null> {
  const stored = readStore(id);
  if (stored !== undefined) return stored;
  try {
    const r = await fetch(`https://itunes.apple.com/lookup?id=${id}`);
    if (!r.ok) return null; // offline or refused: try again next session
    const o = (await r.json()) as { results?: Array<{ artworkUrl512?: string }> };
    const url = o.results?.[0]?.artworkUrl512 ?? null;
    writeStore(id, url);
    return url;
  } catch { return null; }
}

async function look(id: GameId) {
  if (looking.has(id)) return;
  looking.add(id);
  let url: string | null = null;
  try { url = fileUrl(await games.icon(id)) ?? null; } catch { /* no exe icon command or no folder */ }
  if (!url) { const app = gameMeta(id).appStore; if (app) url = await appStoreIcon(app); }
  known.set(id, url);
  looking.delete(id);
  changed();
}

/** The sharp icon URL for a game, or null for the lettered badge. Starts the lookup on first use. */
export function useGameIcon(id: GameId): string | null {
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => version);
  useEffect(() => { if (!known.has(id)) void look(id); }, [id]);
  return known.get(id) ?? null;
}

/** Forget a game's icon (its folder changed) so the next render looks again. */
export function refreshGameIcon(id: GameId) { known.delete(id); changed(); }

export function GameBadge({ game, size = 40, className }: { game: Pick<GameState, "id" | "short" | "name" | "accent"> & { gamebananaId?: number }; size?: number; className?: string }) {
  const icon = useGameIcon(game.id);
  const [broken, setBroken] = useState<string | null>(null);
  const showImg = !!icon && broken !== icon;
  const label = game.short.length <= 4 ? game.short : game.id.toUpperCase().slice(0, 4);
  return (
    <span className={`gbadge${showImg ? " has-img" : ""}${className ? ` ${className}` : ""}`} data-game={game.id} data-len={Math.min(label.length, 4)}
      style={{ width: size, height: size, "--gb-size": `${size}px`, "--g-accent": game.accent, "--g-on": onColor(game.accent) } as CSSProperties}>
      {showImg ? <img src={icon} alt="" draggable={false} onError={() => setBroken(icon)} /> : <span className="gbadge-t">{label}</span>}
    </span>
  );
}

/** The icon URL known right now (for menus, which can't wait), or null. */
export const gameIconNow = (id: GameId): string | null => { if (!known.has(id)) void look(id); return known.get(id) ?? null; };
