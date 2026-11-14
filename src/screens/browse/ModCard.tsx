// A GameBanana mod as a card: picture, name, character, creator, likes, views and what the library has of it.
// Click opens its page; the button on the picture (or I, or X on a controller) installs the newest file;
// right-click gives the gbmod menu. Used by the browser, the strips and creator pages. Owner: BROWSE area.
import { useState, type KeyboardEvent, type MouseEvent } from "react";
import type { GameId } from "../../lib/api";
import { imageAt, type GbCard } from "../../lib/gamebanana";
import type { NsfwMode } from "../../lib/prefs";
import { Badge, IconButton, formatCount, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { CategoryLink, CharLink, CreatorLink } from "../../ui/Links";
import { menuFor, menuHandler } from "../../ui/ContextMenu";
import { go } from "../../lib/store";
import { installLatest } from "./actions";
import { openGbMod, type LibIndex } from "./state";

export function ModCard({ game, mod, lib, nsfw, prio, noInstall, className }: {
  game: GameId; mod: GbCard; lib: LibIndex; nsfw: NsfwMode; prio?: boolean;
  /** A mod for a game that isn't set up here: no install button. */
  noInstall?: boolean; className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const [busy, setBusy] = useState(false);
  const blurred = mod.nsfw && nsfw === "blur";
  const inst = lib.byMod.get(mod.id);
  const upd = inst?.find((m) => m.updateAvailable);
  const arch = !inst && lib.archived.get(mod.id);
  const src = imageAt(mod.image, 530);
  const open = () => openGbMod(mod.id);

  const quick = noInstall ? null : upd ? { icon: "update" as const, label: "Update to the newest file (I)", run: () => installLatest(game, mod.id, mod.name, upd.id) }
    : inst ? null
    : arch ? { icon: "install" as const, label: "Reinstall. Your settings for it come back (I)", run: () => installLatest(game, mod.id, mod.name, undefined, true) }
    : { icon: "install" as const, label: "Install the newest file (I)", run: () => installLatest(game, mod.id, mod.name) };
  const runQuick = async () => {
    if (!quick || busy) return;
    setBusy(true);
    try { await quick.run(); } finally { setBusy(false); }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    else if ((e.key === "i" || e.key === "I") && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); void runQuick(); }
  };

  return (
    <div className={`card card-btn gb-card${blurred ? " is-nsfw" : ""}${prio ? " is-prio" : ""}${className ? ` ${className}` : ""}`}
      role="button" tabIndex={0} data-pad-x title={mod.name} aria-label={mod.name}
      onClick={open} onKeyDown={onKey} onContextMenu={menuHandler(() => menuFor("gbmod", { game, card: mod }))}>
      <span className="gb-card-img">
        {src && !broken
          ? <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />
          : <span className="gb-img-broken"><Icon name="image" /></span>}
        {mod.nsfw && nsfw === "blur" && <span className="gb-nsfw-badge" title="Marked for adults on GameBanana">18+</span>}
        {mod.nsfw && nsfw === "show" && <span className="gb-nsfw-mark" title="Marked for adults on GameBanana">18+</span>}
        <span className="gb-card-state">
          {prio && <span className="gb-prio" title="A creator you prioritized"><Icon name="crown" /></span>}
          {upd ? <Badge tone="accent" icon="update" title={noInstall ? "A newer version is out" : "A newer version is out. Click to update"}
              onClick={noInstall ? undefined : (e) => { e.stopPropagation(); void runQuick(); }}>Update</Badge>
            : inst ? <Badge tone="ok" icon="check" title={noInstall ? "In your mods" : "In your mods. Click to see it there"}
              onClick={noInstall ? undefined : (e) => { e.stopPropagation(); go({ view: "library", modId: inst[0]!.id }); }}>Installed</Badge>
            : arch ? <Badge tone="info" icon="trash" title={noInstall ? "You removed it before. Reinstalling brings back its settings" : "You removed it before. Reinstalling brings back its settings. Click to see it in Mods, Trash"}
              onClick={noInstall ? undefined : (e) => { e.stopPropagation(); go({ view: "library", tab: "archive" }); }}>Removed</Badge>
            : null}
        </span>
        {quick && (
          <IconButton className="gb-card-quick" variant="primary" size="sm" icon={busy ? "clock" : quick.icon} label={quick.label}
            data-pad-x-target disabled={busy} tabIndex={-1}
            onClick={(e: MouseEvent) => { e.stopPropagation(); void runQuick(); }} />
        )}
      </span>
      <span className="gb-card-b">
        <span className="gb-card-t">{mod.name}</span>
        {mod.character
          ? <CharLink game={game} name={mod.character} className="gb-card-c" />
          : mod.category && <CategoryLink game={game} category={mod.category} className="gb-card-c is-cat" />}
        <span className="gb-card-meta">
          {mod.submitter && <CreatorLink id={mod.submitter.id} name={mod.submitter.name} avatar={mod.submitter.avatar} modId={mod.id} className="gb-card-by" />}
          <span className="gb-stat" title={`${mod.likes} likes`}><Icon name="heart" />{formatCount(mod.likes)}</span>
          <span className="gb-stat" title={`${mod.views} views`}><Icon name="eye" />{formatCount(mod.views)}</span>
          <span className="gb-stat" title={`Added ${new Date(mod.added * 1000).toLocaleString()}${mod.updated > mod.added + 60 ? `, updated ${new Date(mod.updated * 1000).toLocaleString()}` : ""}`}>{timeAgo(mod.updated)}</span>
        </span>
      </span>
    </div>
  );
}

/** A card-shaped placeholder while a page loads. */
export function CardSkeleton() {
  return (
    <div className="card gb-card gb-card-skel" aria-hidden="true">
      <span className="gb-card-img skel" />
      <span className="gb-card-b"><span className="skel" style={{ width: "80%", height: "1rem" }} /><span className="skel" style={{ width: "50%", height: ".8rem" }} /></span>
    </div>
  );
}
