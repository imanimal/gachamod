// Names that go somewhere: a character's name opens that character's page, a creator's name opens their page in
// Browse. Right-click gives the same menu the thing has everywhere (ui/ContextMenu.tsx registry). Use these wherever
// the UI writes a character, creator or category name. They stop the click, so they work inside clickable cards; pass
// tabIndex={-1} there so the card stays one Tab stop. Owner: skeleton.
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { GameId } from "../lib/api";
import type { GbCategoryRef, GbNameStyle } from "../lib/gamebanana";
import { openWithFilters } from "../screens/browse/state";
import { go } from "../lib/store";
import { useCreatorStyles } from "../lib/prefs";
import { useTheme } from "../lib/theme";
import { nameStyleProps } from "../lib/nameStyle";
import { menuFor, menuHandler } from "./ContextMenu";
import { Portrait } from "./Portrait";
import { LazyImg } from "./LazyImg";
import { t } from "../lib/i18n";
import "./name-style.css";

const stop = (e: MouseEvent | KeyboardEvent) => { e.stopPropagation(); };

/** A character's name: click opens their page (Characters), right-click their menu. */
export function CharLink({ game, name, icon, children, className, portrait, tabIndex = 0 }:
  { game: GameId; name: string; icon?: string | null; children?: ReactNode; className?: string; portrait?: boolean; tabIndex?: number }) {
  return (
    <span role="link" tabIndex={tabIndex} className={`qlink qlink-char${className ? ` ${className}` : ""}`} title={t("Open {name}'s page", { name })}
      onClick={(e) => { stop(e); e.preventDefault(); go({ view: "characters", character: name }); }}
      onKeyDown={(e) => { if (e.key === "Enter") { stop(e); e.preventDefault(); go({ view: "characters", character: name }); } }}
      onMouseDown={stop} onContextMenu={menuHandler(() => menuFor("character", { game, name }))}>
      {portrait && <Portrait game={game} name={name} icon={icon} size="1.2em" className="qlink-img" />}
      {children ?? name}
    </span>
  );
}

/** A GameBanana member's name: click opens their page in Browse, right-click their menu (follow, block ...). With
 *  `style` (from GameBanana's records) the name takes their colour, font and effect, their upic stands in for the
 *  name, and `hoverAvatar` swaps in on hover, unless Settings, Creators turned name styles off. */
export function CreatorLink({ id, name, avatar, modId, children, className, tabIndex = 0, style, hoverAvatar }:
  { id?: number | null; name: string; avatar?: string | null; modId?: number | null; children?: ReactNode; className?: string; tabIndex?: number;
    style?: GbNameStyle | null; hoverAvatar?: string | null }) {
  const shown = useCreatorStyles();
  useTheme(); // the readable colour depends on the theme
  const [upicBroken, setUpicBroken] = useState<string | null>(null);
  const open = () => {
    if (id) go({ view: "browse", user: id });
    else window.dispatchEvent(new CustomEvent("gm-find-creator", { detail: { name, modId } }));
  };
  const own = shown && style ? nameStyleProps(style) : null;
  const upic = shown && style?.upic && upicBroken !== style.upic && !children ? style.upic : null;
  return (
    <span role="link" tabIndex={tabIndex} className={`qlink qlink-user${own ? ` ${own.className}` : ""}${className ? ` ${className}` : ""}`} style={own?.style}
      title={t("Mods by {name}", { name })}
      onClick={(e) => { stop(e); e.preventDefault(); open(); }}
      onKeyDown={(e) => { if (e.key === "Enter") { stop(e); e.preventDefault(); open(); } }}
      onMouseDown={stop} onContextMenu={menuHandler(() => menuFor("creator", { id, name, avatar, modId }))}>
      {avatar && <LazyImg className="qlink-img" src={avatar} alt="" />}
      {avatar && shown && hoverAvatar && <LazyImg className="qlink-img qlink-hov" src={hoverAvatar} alt="" />}
      {upic ? <img className="gb-upic" src={upic} alt={name} loading="lazy" decoding="async" onError={() => setUpicBroken(upic)} /> : children ?? name}
    </span>
  );
}

/** A GameBanana category's name ("UI", "Weapons"): click shows its mods in Browse, right-click the same. */
export function CategoryLink({ game, category, children, className, tabIndex = 0 }:
  { game: GameId; category: GbCategoryRef; children?: ReactNode; className?: string; tabIndex?: number }) {
  const open = () => { openWithFilters(game, { category, character: null }); go({ view: "browse" }); };
  return (
    <span role="link" tabIndex={tabIndex} className={`qlink qlink-cat${className ? ` ${className}` : ""}`} title={t("Browse {category} mods", { category: category.name })}
      onClick={(e) => { stop(e); e.preventDefault(); open(); }}
      onKeyDown={(e) => { if (e.key === "Enter") { stop(e); e.preventDefault(); open(); } }}
      onMouseDown={stop} onContextMenu={menuHandler(() => [{ label: t("Browse {category} mods", { category: category.name }), icon: "browse", onClick: open }])}>
      {children ?? category.name}
    </span>
  );
}
