// A mod's name in a Tools list: click opens it in Mods, right-click (Shift+F10, the Menu key) gives the same mod
// menu as everywhere else. Owner: TOOLS area.
import type { MouseEvent } from "react";
import { errorText, library, type GameId, type ModEntry } from "../../lib/api";
import { t } from "../../lib/i18n";
import { withoutKeys } from "../../lib/menuHints";
import { go } from "../../lib/store";
import { menuFor, openMenu } from "../../ui/ContextMenu";
import { toast } from "../../ui/toast";
import { knownMod } from "../library/menus";

export function ModLink({ game, modId, name, className }: { game: GameId | null; modId: string; name: string; className?: string }) {
  const onMenu = (e: MouseEvent<HTMLButtonElement>) => {
    if (!game) return;
    e.preventDefault();
    e.stopPropagation();
    const at = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : e.currentTarget;
    // the list's keys (Space, F2, Del) belong to the mod grid, not to this row
    const show = (mod: ModEntry | undefined) => {
      if (mod) openMenu(at, withoutKeys(menuFor("mod", { game, mod })));
      else toast(t("That mod isn't installed anymore"));
    };
    const known = knownMod(game, modId);
    if (known) show(known);
    else library.list(game).then((all) => show(all.find((m) => m.id === modId)), (err) => toast(errorText(err), true));
  };
  return (
    <button type="button" className={`tp-link${className ? ` ${className}` : ""}`} title={t("Open in Mods. Right-click for more")}
      onClick={() => go({ view: "library", modId })} onContextMenu={onMenu}>{name}</button>
  );
}
