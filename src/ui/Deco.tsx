// Decoration only: the drifting wall of ghost type behind the app, glyph strips and small device labels.
// Themes decide whether any of it shows (the Default theme hides it all; New Eridu uses it for idle motion).
// Everything here is aria-hidden and ignores the pointer.
import { memo } from "react";
import type { GameState } from "../lib/api";

/** A strip of made-up glyphs (a CSS mask in the theme draws them). `run` makes it scroll. */
export function Glyphs({ run, className }: { run?: boolean; className?: string }) {
  return <span className={`glyphs${run ? " run" : ""}${className ? ` ${className}` : ""}`} aria-hidden="true" />;
}

const BLOCKS = ["dots", "hatch", "ring", "bars", "plain"] as const;

/** Rows of huge words and textured blocks that drift sideways, tilted, behind everything. */
export const Backdrop = memo(function Backdrop({ game }: { game: GameState | null }) {
  const name = (game?.name ?? "gachamod").toUpperCase();
  const words = [name, game?.importer ?? "3DMIGOTO", "GACHAMOD", "MODS", game?.short?.toUpperCase() ?? "PROXY", "LOADOUT", "GAMEBANANA", "SKINS"];
  const rows = [0, 1, 2, 3, 4, 5].map((r) => {
    const items: Array<{ w?: string; b?: string }> = [];
    for (let i = 0; i < 4; i++) {
      items.push({ w: words[(r * 3 + i * 2) % words.length] });
      items.push({ b: BLOCKS[(r + i) % BLOCKS.length] });
      if ((r + i) % 2 === 0) items.push({ b: BLOCKS[(r * 2 + i + 2) % BLOCKS.length] });
    }
    return items;
  });
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop-wall">
        {rows.map((items, r) => (
          <div className={`backdrop-row${r % 2 ? " rev" : ""}`} key={r}>
            {[0, 1].map((copy) => (
              <div className="backdrop-run" key={copy}>
                {items.map((it, i) => it.w
                  ? <span className="bd-w" key={i}>{it.w}</span>
                  : <span className={`bd-b bd-${it.b}`} key={i} />)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

/** The label plate that fills the spare room in the sidebar. */
export function SideDeco({ game, version }: { game: GameState | null; version?: string }) {
  return (
    <div className="side-deco" aria-hidden="true">
      <Glyphs run />
      <span className="side-deco-m">{game ? `${game.importer} · ${game.modCount} MODS` : "NO GAME"}{version ? ` · VER ${version}` : ""}</span>
      <Glyphs run className="rev" />
    </div>
  );
}
