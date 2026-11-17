// One installed mod in a grid or list: preview, name, character (a link to its page), badges, an on/off switch and
// a "..." menu. The card's main button opens the details (Ctrl/Shift click selects). Owner: LIBRARY area.
import { memo, type KeyboardEvent, type MouseEvent } from "react";
import type { GameId, ModEntry } from "../../lib/api";
import type { ModHealth } from "../../lib/fixes";
import type { HoldKind } from "../../lib/holds";
import { go, reloadKeyOf } from "../../lib/store";
import { kindName, libKind } from "./kinds";
import { Badge, IconButton, Toggle, formatBytes } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { CharLink } from "../../ui/Links";
import { useLiveCharacter, useLiveWaiting } from "../ingame/data";
import { openDetails, setFavourite, useUpdating } from "./actions";
import { Preview, type NsfwMode } from "./Preview";
import { stops, t, tn } from "../../lib/i18n";

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
  /** `keep`: Shift was held, so the character's other mods stay on. */
  onToggle: (mod: ModEntry, on: boolean, keep: boolean) => void;
  onMenu: (mod: ModEntry, anchor: HTMLElement) => void;
  onUpdate: (mod: ModEntry) => void;
  /** The card's hover tip, when the page gives its switch another meaning (a profile's page). */
  tip?: string;
  /** The name of the mod this one is a sub-mod of. */
  parentName?: string;
  /** Its problems were set aside (lib/holds): "ignore" hides every warning, "update" the game update ones. */
  held?: HoldKind | null;
}

/** The type of a mod without a character ("UI", "Tools and fixes"): click shows every mod of that type on Mods. */
export function KindLink({ mod }: { mod: ModEntry }) {
  const kind = libKind(mod), label = kindName(kind);
  const open = (e: MouseEvent | KeyboardEvent) => { e.stopPropagation(); e.preventDefault(); go({ view: "library", kind }); };
  return (
    <span role="link" tabIndex={0} className="qlink" title={t("Show every mod in {kind}. If it's for a character, set one in its details", { kind: label })}
      onClick={open} onKeyDown={(e) => { if (e.key === "Enter") open(e); }} onMouseDown={(e) => e.stopPropagation()}>{label}</span>
  );
}

/** The broken-by-update mark's tip, with what the check found. */
function brokenTip(health: ModHealth): string {
  const text = health.needsAuthor ? t("Broken by a game update, and it needs an update from its author. Click for details")
    : health.tried ? t("Broken by a game update, and the fixer didn't repair it. Click for details")
    : health.status === "broken" || health.tool ? t("Broken by a game update. Click to see what can be tried")
    : t("Broken by a game update, and gachamod can't fix it by itself. Click for details");
  return health.reasons.length ? t("{text}: {reasons}", { text, reasons: stops(health.reasons) }) : text;
}

export const ModCard = memo(function ModCard({ game, mod, index, row, selected, nsfw, showCharacter, health, portrait, onOpen, onToggle, onMenu, onUpdate, tip, parentName, held }: ModCardProps) {
  const quiet = held === "ignore";
  const cls = ["card", "mod-card", row && "is-row", selected && "sel", !mod.enabled && "is-off"].filter(Boolean).join(" ");
  const broken = health && (health.status === "broken" || health.status === "unfixable");
  const by = mod.source?.submitter;
  const live = useLiveCharacter(game, mod.id);
  const waiting = useLiveWaiting(game, mod.id);
  const updating = useUpdating(mod.id);
  return (
    <div className={cls} data-pad-x data-mod={mod.id}>
      {/* the button holds the picture; its ::after covers the whole card, so a click anywhere opens it. The text sits
          beside it, so the character link isn't inside a button and stays above the cover (library.css) */}
      <button type="button" className="mod-card-hit" data-idx={index} aria-pressed={selected} aria-label={mod.name}
        title={tip ?? (mod.enabled ? t("{mod}. Enter opens the details, Space turns it off, Ctrl+click or Ctrl+Space selects", { mod: mod.name }) : t("{mod}. Enter opens the details, Space turns it on, Ctrl+click or Ctrl+Space selects", { mod: mod.name }))}
        onClick={(e) => onOpen(mod, e)}>
        <Preview className="mod-card-img" src={mod.preview} thumb={mod.thumb} blur={mod.nsfw && nsfw === "blur"} icon="mods" portrait={portrait} label={row ? null : mod.character ?? mod.name} />
      </button>
      <span className="mod-card-body">
        <span className="mod-card-name">{mod.name}</span>
        <span className="mod-card-char">
          {showCharacter
            ? mod.character ? <CharLink game={game} name={mod.character} /> : <KindLink mod={mod} />
            : by ? t("by {creator}", { creator: by }) : mod.version ? `v${mod.version.replace(/^v/i, "")}` : formatBytes(mod.sizeBytes)}
        </span>
        {row && <span className="mod-card-meta">{formatBytes(mod.sizeBytes)}{mod.version ? ` · v${mod.version.replace(/^v/i, "")}` : ""}</span>}
      </span>
      <span className="mod-card-badges">
        {broken && (
          <button type="button" className={`mod-card-health${health.status === "unfixable" ? " is-bad" : ""}`} aria-label={t("Broken by a game update")}
            title={brokenTip(health)}
            onClick={() => openDetails(mod)}>
            <Icon name="warn" />
          </button>
        )}
        {mod.favorite && (
          <button type="button" className="mod-card-fav" title={t("Favourite. Click to take it out of your favourites")}
            onClick={() => void setFavourite(game, [mod], false)}><Icon name="star" /></button>
        )}
        {held === "update" && !(mod.updateAvailable && mod.source) && (
          <Badge tone="muted" icon="bell-off" onClick={() => openDetails(mod)}
            title={t("A game update broke it, and you're waiting for its author to post an update. Its warnings show again once you install a newer version. Click for details")}>{t("Waiting for update")}</Badge>
        )}
        {mod.updateAvailable && mod.source && (
          <button type="button" className="badge t-accent mod-card-update" aria-busy={updating} disabled={updating}
            title={updating ? t("Finding the newer file on GameBanana") : t("A newer version is on GameBanana. Click to download it")}
            onClick={() => onUpdate(mod)}><Icon name={updating ? "clock" : "update"} />{updating ? t("Finding file") : t("Update")}</button>
        )}
        {mod.conflicts > 0 && !quiet && (
          <Badge tone="bad" icon="warn" onClick={() => openDetails(mod, "conflicts")}
            title={mod.conflicts === 1 ? t("Changes the same parts as another mod that is on. Click to pick which one wins") : t("Changes the same parts as {n} other mods that are on. Click to pick which one wins", { n: mod.conflicts })}>{t("Conflict")}</Badge>
        )}
        {mod.iniCount === 0 && !quiet && <Badge tone="warn" icon="warn" onClick={() => openDetails(mod, "files")} title={t("No .ini file found, so the game won't load it. Click to see its files")}>{t("No ini")}</Badge>}
        {(mod.parts ?? 0) > 0 && <Badge tone="muted" icon="layers" onClick={() => openDetails(mod, "parts")} title={t("Folders inside it that turn on and off by themselves. Click to switch them")}>{tn(mod.parts ?? 0, "{n} part", "{n} parts")}</Badge>}
        {mod.parent && parentName && <Badge tone="muted" icon="link" onClick={() => openDetails({ id: mod.parent! })}
          title={t("A sub-mod of {mod}: it turns off with it and never counts as another skin. Click to open {mod}", { mod: parentName })}>{t("Sub-mod")}</Badge>}
        {mod.hasKeys && <Badge tone="muted" icon="key" onClick={() => openDetails(mod, "keys")} title={t("Has toggles or options. Click to see them")}>{t("Toggles")}</Badge>}
        {live && !waiting && <Badge tone="muted" icon="swap" onClick={() => openDetails(mod, "ingame")}
          title={t("Turning it on switches {name}'s skin in game at once, without {key}. Click for its in-game options", { name: live, key: reloadKeyOf(game) })}>{t("Live")}</Badge>}
        {live && waiting && <Badge tone="warn" icon="swap" onClick={() => openDetails(mod, "ingame")}
          title={t("gachamod couldn't key this pick into the game, so {name} wears it after the game reloads its mods ({key}). Click for its in-game options", { name: live, key: reloadKeyOf(game) })}>{t("Next reload")}</Badge>}
      </span>
      <span className="mod-card-foot">
        <Toggle size="sm" checked={mod.enabled} onChange={(v, shift) => onToggle(mod, v, shift)} ariaLabel={mod.name}
          title={mod.enabled ? t("Turn off (Space)") : live ? t("Turn on (Space). It replaces {name}'s skin in game. Shift+click or Shift+Space shows it next to that skin instead, and it stops switching in game", { name: live })
            : mod.character ? t("Turn on (Space). Shift+click or Shift+Space turns it on next to {name}'s other mods without asking", { name: mod.character }) : t("Turn on (Space)")} />
        <IconButton icon="more" size="sm" label={t("More actions (right-click or Shift+F10, X on a controller)")} className="mod-card-more" data-pad-x-target
          onClick={(e) => onMenu(mod, e.currentTarget)} />
      </span>
    </div>
  );
});
