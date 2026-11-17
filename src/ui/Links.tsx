// Names that go somewhere: a character's name opens that character's page, a creator's name opens their page in
// Browse. Right-click gives the same menu the thing has everywhere (ui/ContextMenu.tsx registry). Use these wherever
// the UI writes a character, creator or category name. They stop the click, so they work inside clickable cards; pass
// tabIndex={-1} there so the card stays one Tab stop. Owner: skeleton.
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { GameId } from "../lib/api";
import type { GbCategoryRef } from "../lib/gamebanana";
import { openWithFilters } from "../screens/browse/state";
import { go } from "../lib/store";
import { menuFor, menuHandler } from "./ContextMenu";
import { Portrait } from "./Portrait";
import { LazyImg } from "./LazyImg";

const stop = (e: MouseEvent | KeyboardEvent) => { e.stopPropagation(); };

/** A character's name: click opens their page (Characters), right-click their menu. */
export function CharLink({ game, name, icon, children, className, portrait, tabIndex = 0 }:
  { game: GameId; name: string; icon?: string | null; children?: ReactNode; className?: string; portrait?: boolean; tabIndex?: number }) {
  return (
    <span role="link" tabIndex={tabIndex} className={`qlink qlink-char${className ? ` ${className}` : ""}`} title={`Open ${name}'s page`}
      onClick={(e) => { stop(e); e.preventDefault(); go({ view: "characters", character: name }); }}
      onKeyDown={(e) => { if (e.key === "Enter") { stop(e); e.preventDefault(); go({ view: "characters", character: name }); } }}
      onMouseDown={stop} onContextMenu={menuHandler(() => menuFor("character", { game, name }))}>
      {portrait && <Portrait game={game} name={name} icon={icon} size="1.2em" className="qlink-img" />}
      {children ?? name}
    </span>
  );
}

/** A GameBanana member's name: click opens their page in Browse, right-click their menu (follow, block ...). */
export function CreatorLink({ id, name, avatar, modId, children, className, tabIndex = 0 }:
  { id?: number | null; name: string; avatar?: string | null; modId?: number | null; children?: ReactNode; className?: string; tabIndex?: number }) {
  const open = () => {
    if (id) go({ view: "browse", user: id });
    else window.dispatchEvent(new CustomEvent("gm-find-creator", { detail: { name, modId } }));
  };
  return (
    <span role="link" tabIndex={tabIndex} className={`qlink qlink-user${className ? ` ${className}` : ""}`} title={`Mods by ${name}`}
      onClick={(e) => { stop(e); e.preventDefault(); open(); }}
      onKeyDown={(e) => { if (e.key === "Enter") { stop(e); e.preventDefault(); open(); } }}
      onMouseDown={stop} onContextMenu={menuHandler(() => menuFor("creator", { id, name, avatar, modId }))}>
      {avatar && <LazyImg className="qlink-img" src={avatar} alt="" />}
      {children ?? name}
    </span>
  );
}

/** A GameBanana category's name ("UI", "Weapons"): click shows its mods in Browse, right-click the same. */
export function CategoryLink({ game, category, children, className, tabIndex = 0 }:
  { game: GameId; category: GbCategoryRef; children?: ReactNode; className?: string; tabIndex?: number }) {
  const open = () => { openWithFilters(game, { category, character: null }); go({ view: "browse" }); };
  return (
    <span role="link" tabIndex={tabIndex} className={`qlink qlink-cat${className ? ` ${className}` : ""}`} title={`Browse ${category.name} mods`}
      onClick={(e) => { stop(e); e.preventDefault(); open(); }}
      onKeyDown={(e) => { if (e.key === "Enter") { stop(e); e.preventDefault(); open(); } }}
      onMouseDown={stop} onContextMenu={menuHandler(() => [{ label: `Browse ${category.name} mods`, icon: "browse", onClick: open }])}>
      {children ?? category.name}
    </span>
  );
}
