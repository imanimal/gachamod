// A game's icon for the rail and headers: GameBanana's game icon when it loads, else a short label on the game's
// colour ("ZZZ", "WuWa", or the id like "HSR" when the short name is longer than four letters). Owner: skeleton
// (THEME styles it).
import { useEffect, useState, type CSSProperties } from "react";
import type { GameState } from "../lib/api";
import { gameInfo } from "../lib/gamebanana";
import { onColor } from "../lib/theme";

const cache = new Map<number, string | null>();

export function GameBadge({ game, size = 40 }: { game: Pick<GameState, "id" | "short" | "name" | "accent" | "gamebananaId">; size?: number }) {
  const [icon, setIcon] = useState<string | null>(cache.get(game.gamebananaId) ?? null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (cache.has(game.gamebananaId)) { setIcon(cache.get(game.gamebananaId) ?? null); return; }
    let live = true;
    gameInfo(game.gamebananaId).then((g) => { cache.set(game.gamebananaId, g?.icon ?? null); if (live) setIcon(g?.icon ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [game.gamebananaId]);
  const showImg = !!icon && !broken;
  const label = game.short.length <= 4 ? game.short : game.id.toUpperCase().slice(0, 4);
  return (
    <span className={`gbadge${showImg ? " has-img" : ""}`} data-game={game.id} data-len={Math.min(label.length, 4)}
      style={{ width: size, height: size, "--gb-size": `${size}px`, "--g-accent": game.accent, "--g-on": onColor(game.accent) } as CSSProperties}>
      {showImg ? <img src={icon ?? undefined} alt="" onError={() => setBroken(true)} /> : <span className="gbadge-t">{label}</span>}
    </span>
  );
}
