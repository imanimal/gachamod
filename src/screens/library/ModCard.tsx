// One mod in the library grid or list: preview, name, character, badges, an on/off switch and a "..." menu.
// The card's main button opens the details (Ctrl/Shift click selects). Owner: LIBRARY area.
import { memo, type MouseEvent } from "react";
import type { ModEntry } from "../../lib/api";
import { Badge, IconButton, Toggle, formatBytes } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { Preview, type NsfwMode } from "./Preview";

export interface ModCardProps {
  mod: ModEntry;
  index: number;
  row: boolean;
  selected: boolean;
  nsfw: NsfwMode;
  /** The character's portrait, shown when the mod has no picture of its own. */
  portrait?: string | null;
  onOpen: (mod: ModEntry, e: MouseEvent) => void;
  onToggle: (mod: ModEntry, on: boolean) => void;
  onMenu: (mod: ModEntry, anchor: HTMLElement) => void;
  onUpdate: (mod: ModEntry) => void;
}

export const ModCard = memo(function ModCard({ mod, index, row, selected, nsfw, portrait, onOpen, onToggle, onMenu, onUpdate }: ModCardProps) {
  const who = mod.character ?? mod.group ?? "No character";
  const cls = ["card", "mod-card", row && "is-row", selected && "sel", !mod.enabled && "is-off"].filter(Boolean).join(" ");
  return (
    <div className={cls} data-pad-x>
      <button type="button" className="mod-card-hit" data-idx={index} data-mod={mod.id} aria-pressed={selected}
        title={`${mod.name}. Enter opens details, Space turns it ${mod.enabled ? "off" : "on"}, Ctrl+click selects`}
        onClick={(e) => onOpen(mod, e)}>
        <Preview className="mod-card-img" src={mod.preview} blur={mod.nsfw && nsfw === "blur"} icon="mods" portrait={portrait} label={row ? null : mod.character ?? mod.name} />
        <span className="mod-card-body">
          <span className="mod-card-name">{mod.name}</span>
          <span className="mod-card-char">{who}</span>
          {row && <span className="mod-card-meta">{formatBytes(mod.sizeBytes)}{mod.version ? ` · v${mod.version.replace(/^v/i, "")}` : ""}</span>}
        </span>
      </button>
      <span className="mod-card-badges">
        {mod.favorite && <span className="mod-card-fav" title="Favourite"><Icon name="star" /></span>}
        {mod.updateAvailable && mod.source && (
          <button type="button" className="badge t-accent mod-card-update" title="A newer version is on GameBanana. Click to download it"
            onClick={() => onUpdate(mod)}><Icon name="update" />Update</button>
        )}
        {mod.conflicts > 0 && <Badge tone="bad" icon="warn" title={`Changes the same parts as ${mod.conflicts === 1 ? "another mod" : `${mod.conflicts} other mods`} that ${mod.conflicts === 1 ? "is" : "are"} on`}>Conflict</Badge>}
        {mod.iniCount === 0 && <Badge tone="warn" icon="warn" title="No .ini file found, so the game won't load it">No ini</Badge>}
        {mod.hasKeys && <Badge tone="muted" icon="key" title="Has key bindings or options (open the details to see them)">Keys</Badge>}
      </span>
      <span className="mod-card-foot">
        <Toggle size="sm" checked={mod.enabled} onChange={(v) => onToggle(mod, v)} label={<span className="sr-only">{mod.enabled ? "On" : "Off"}</span>} />
        <IconButton icon="more" size="sm" label="More actions" className="mod-card-more" data-pad-x-target
          onClick={(e) => onMenu(mod, e.currentTarget)} />
      </span>
    </div>
  );
});
