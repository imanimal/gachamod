// One installed mod in a grid or list: preview, name, character (a link to its page), badges, an on/off switch and
// a "..." menu. The card's main button opens the details (Ctrl/Shift click selects). Owner: LIBRARY area.
import { memo, type KeyboardEvent, type MouseEvent } from "react";
import type { GameId, ModEntry } from "../../lib/api";
import type { ModHealth } from "../../lib/fixes";
import { go } from "../../lib/store";
import { kindName, libKind } from "./kinds";
import { Badge, IconButton, Toggle, formatBytes } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { CharLink } from "../../ui/Links";
import { useLiveCharacter } from "../ingame/data";
import { openDetails, setFavourite } from "./actions";
import { Preview, type NsfwMode } from "./Preview";

export interface ModCardProps {
  game: GameId;
  mod: ModEntry;
  index: number;
  row: boolean;
  selected: boolean;
  nsfw: NsfwMode;
  /** Show the character's name (off on a character's own page, where the creator shows instead). */
  showCharacter: boolean;
  health?: ModHealth;
  /** The character's portrait, shown when the mod has no picture of its own. */
  portrait?: string | null;
  onOpen: (mod: ModEntry, e: MouseEvent) => void;
  onToggle: (mod: ModEntry, on: boolean) => void;
  onMenu: (mod: ModEntry, anchor: HTMLElement) => void;
  onUpdate: (mod: ModEntry) => void;
  /** The card's hover tip, when the page gives its switch another meaning (a profile's page). */
  tip?: string;
  /** The name of the mod this one is a sub-mod of. */
  parentName?: string;
}

/** The type of a mod without a character ("UI", "Tools and fixes"): click shows every mod of that type on Mods. */
export function KindLink({ mod }: { mod: ModEntry }) {
  const kind = libKind(mod), label = kindName(kind);
  const open = (e: MouseEvent | KeyboardEvent) => { e.stopPropagation(); e.preventDefault(); go({ view: "library", kind }); };
  return (
    <span role="link" tabIndex={0} className="qlink" title={`Show every mod in ${label}. If it's for a character, set one in its details`}
      onClick={open} onKeyDown={(e) => { if (e.key === "Enter") open(e); }} onMouseDown={(e) => e.stopPropagation()}>{label}</span>
  );
}

export const ModCard = memo(function ModCard({ game, mod, index, row, selected, nsfw, showCharacter, health, portrait, onOpen, onToggle, onMenu, onUpdate, tip, parentName }: ModCardProps) {
  const cls = ["card", "mod-card", row && "is-row", selected && "sel", !mod.enabled && "is-off"].filter(Boolean).join(" ");
  const broken = health && (health.status === "broken" || health.status === "unfixable");
  const by = mod.source?.submitter;
  const live = useLiveCharacter(game, mod.id);
  return (
    <div className={cls} data-pad-x data-mod={mod.id}>
      <button type="button" className="mod-card-hit" data-idx={index} aria-pressed={selected}
        title={tip ?? `${mod.name}. Enter opens the details, Space turns it ${mod.enabled ? "off" : "on"}, Ctrl+click selects`}
        onClick={(e) => onOpen(mod, e)}>
        <Preview className="mod-card-img" src={mod.preview} blur={mod.nsfw && nsfw === "blur"} icon="mods" portrait={portrait} label={row ? null : mod.character ?? mod.name} />
        <span className="mod-card-body">
          <span className="mod-card-name">{mod.name}</span>
          <span className="mod-card-char">
            {showCharacter
              ? mod.character ? <CharLink game={game} name={mod.character} /> : <KindLink mod={mod} />
              : by ? `by ${by}` : mod.version ? `v${mod.version.replace(/^v/i, "")}` : formatBytes(mod.sizeBytes)}
          </span>
          {row && <span className="mod-card-meta">{formatBytes(mod.sizeBytes)}{mod.version ? ` · v${mod.version.replace(/^v/i, "")}` : ""}</span>}
        </span>
      </button>
      <span className="mod-card-badges">
        {broken && (
          <button type="button" className={`mod-card-health${health.status === "unfixable" ? " is-bad" : ""}`} aria-label="Broken by a game update"
            title={`${health.status === "broken" ? "Broken by a game update. Click to see the fix" : "Broken by a game update, and gachamod can't fix it by itself. Click for details"}${health.reasons.length ? `: ${health.reasons.slice(0, 3).join(". ")}` : ""}`}
            onClick={() => openDetails(mod)}>
            <Icon name="warn" />
          </button>
        )}
        {mod.favorite && (
          <button type="button" className="mod-card-fav" title="Favourite. Click to take it out of your favourites"
            onClick={() => void setFavourite(game, [mod], false)}><Icon name="star" /></button>
        )}
        {mod.updateAvailable && mod.source && (
          <button type="button" className="badge t-accent mod-card-update" title="A newer version is on GameBanana. Click to download it"
            onClick={() => onUpdate(mod)}><Icon name="update" />Update</button>
        )}
        {mod.conflicts > 0 && (
          <Badge tone="bad" icon="warn" onClick={() => openDetails(mod, "conflicts")}
            title={`Changes the same parts as ${mod.conflicts === 1 ? "another mod" : `${mod.conflicts} other mods`} that ${mod.conflicts === 1 ? "is" : "are"} on. Click to pick which one wins`}>Conflict</Badge>
        )}
        {mod.iniCount === 0 && <Badge tone="warn" icon="warn" onClick={() => openDetails(mod, "files")} title="No .ini file found, so the game won't load it. Click to see its files">No ini</Badge>}
        {(mod.parts ?? 0) > 0 && <Badge tone="muted" icon="layers" onClick={() => openDetails(mod, "parts")} title="Folders inside it that turn on and off by themselves. Click to switch them">{mod.parts} parts</Badge>}
        {mod.parent && parentName && <Badge tone="muted" icon="link" onClick={() => openDetails({ id: mod.parent! })}
          title={`A sub-mod of ${parentName}: it turns off with it and never counts as another skin. Click to open ${parentName}`}>Sub-mod</Badge>}
        {mod.hasKeys && <Badge tone="muted" icon="key" onClick={() => openDetails(mod, "keys")} title="Has toggles or options. Click to see them">Toggles</Badge>}
        {live && <Badge tone="muted" icon="swap" onClick={() => openDetails(mod, "ingame")}
          title={`Turning it on switches ${live}'s skin in game at once, without F10. Click for its in-game options`}>Live</Badge>}
      </span>
      <span className="mod-card-foot">
        <Toggle size="sm" checked={mod.enabled} onChange={(v) => onToggle(mod, v)} label={<span className="sr-only">{mod.enabled ? "On" : "Off"}</span>} />
        <IconButton icon="more" size="sm" label="More actions (right-click, or X on a controller)" className="mod-card-more" data-pad-x-target
          onClick={(e) => onMenu(mod, e.currentTarget)} />
      </span>
    </div>
  );
});
