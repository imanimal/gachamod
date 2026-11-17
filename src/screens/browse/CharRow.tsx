// The character filter: one row of portraits that scrolls sideways (wheel, arrows, keys), or every character in a
// grid when expanded. Fine with 100+ characters. Owner: BROWSE area.
import { useEffect, useRef } from "react";
import type { GameId } from "../../lib/api";
import { charNoun } from "../../lib/games";
import type { GbCategoryRef } from "../../lib/gamebanana";
import { usePortraitBatch } from "../../lib/portraits";
import { IconButton } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { menuFor, menuHandler, type MenuEntry } from "../../ui/ContextMenu";
import { Portrait } from "../../ui/Portrait";
import { reveal, rowKeys, useRovingTab, useSideScroll } from "./sideScroll";

const EXPAND_KEY = "gm.browse.charsOpen";

export function CharRow({ game, chars, value, onChange, expanded, onExpanded }: {
  game: GameId; chars: GbCategoryRef[]; value: string | null; onChange: (name: string | null) => void;
  expanded: boolean; onExpanded: (v: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { left, right, page } = useSideScroll(ref, [chars.length, expanded]);
  usePortraitBatch(game, chars.map((c) => c.name));
  // one Tab stop for the whole row; the arrow keys move inside it
  useRovingTab(ref, ".gb-ch");
  const noun = charNoun(game);

  // keep the picked character in view (scrolling the row only: the page stays where it is)
  useEffect(() => {
    const row = ref.current, el = row?.querySelector<HTMLElement>(".gb-ch.on");
    if (row && el && !expanded) reveal(row, el, "center");
  }, [value, chars.length, expanded]);

  // the shared character menu, but "Find mods online" filters Browse here instead of leaving it
  const browseMenu = (name: string, on: boolean): MenuEntry[] => menuFor("character", { game, name }).map((it) =>
    it && it !== "-" && "label" in it && it.label === "Find mods online"
      ? on ? { label: "Show all", icon: "characters", onClick: () => onChange(null) } : { label: `Show only ${name}`, icon: "browse", onClick: () => onChange(name) }
      : it);

  if (!chars.length) return null;
  const want = value?.toLowerCase();
  return (
    <div className={`gb-chars${expanded ? " is-open" : ""}`}>
      {!expanded && <IconButton className="gb-chars-arrow" size="sm" icon="left" label="Scroll left" disabled={!left} onClick={() => page(-1)} />}
      <div ref={ref} className="gb-chars-list" role="toolbar" aria-label={noun} onKeyDown={(e) => rowKeys(e, ".gb-ch")}>
        <button type="button" className={`gb-ch gb-ch-all${!value ? " on" : ""}`} aria-pressed={!value} title={`Every ${charNoun(game, true).toLowerCase()}`} onClick={() => onChange(null)}>
          <span className="gb-ch-img"><Icon name="characters" /></span>
          <span className="gb-ch-t">All</span>
        </button>
        {chars.map((c) => {
          const on = c.name.toLowerCase() === want;
          return (
            <button key={c.id} type="button" className={`gb-ch${on ? " on" : ""}`} aria-pressed={on} title={on ? `${c.name} (click again for all)` : c.name}
              onClick={() => onChange(on ? null : c.name)} onContextMenu={menuHandler(() => browseMenu(c.name, on))}>
              <Portrait game={game} name={c.name} icon={c.icon} size="2.6rem" className="gb-ch-img" />
              <span className="gb-ch-t">{c.name}</span>
            </button>
          );
        })}
      </div>
      {!expanded && <IconButton className="gb-chars-arrow" size="sm" icon="right" label="Scroll right" disabled={!right} onClick={() => page(1)} />}
      <IconButton className="gb-chars-more" size="sm" icon={expanded ? "collapse" : "grid"} on={expanded}
        label={expanded ? `Show ${noun.toLowerCase()} in one row` : `Show every ${charNoun(game, true).toLowerCase()} (${chars.length})`}
        onClick={() => { onExpanded(!expanded); try { localStorage.setItem(EXPAND_KEY, expanded ? "0" : "1"); } catch { /* storage off */ } }} />
    </div>
  );
}

export const charsOpenAtStart = () => { try { return localStorage.getItem(EXPAND_KEY) === "1"; } catch { return false; } };
