// A GameBanana mod as a card: picture, name, character, creator, likes, views and what the library has of it.
// Click opens its page; the button on the picture (or I, or X on a controller) installs the newest file, updates it,
// or opens it in Mods once installed; while the queue has it, the corner shows how far along it is (Pick opens the
// variant picker). Right-click gives the gbmod menu. Used by the browser, the strips and creator pages. Owner: BROWSE area.
import { memo, useId, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { GameId } from "../../lib/api";
import { imageAt, type GbCard } from "../../lib/gamebanana";
import type { NsfwMode } from "../../lib/prefs";
import { Badge, IconButton, behindLayer, formatBytes, formatCount, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { CategoryLink, CharLink, CreatorLink } from "../../ui/Links";
import { menuFor, menuHandler } from "../../ui/ContextMenu";
import { go, goIn } from "../../lib/store";
import { hintClass } from "../../shell/hints";
import { installLatest } from "./actions";
import { openGbMod, type LibIndex } from "./state";
import { LazyImg } from "../../ui/LazyImg";
import { openVariantPicker, useQueueItem } from "./cardQueue";

export const ModCard = memo(function ModCard({ game, mod, lib, nsfw, prio, noInstall, hint, className }: {
  game: GameId; mod: GbCard; lib: LibIndex; nsfw: NsfwMode; prio?: boolean;
  /** Show the install button with the first-start outline (shell/hints.ts). */
  hint?: boolean;
  /** A mod for a game that isn't set up here: no install button. */
  noInstall?: boolean; className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const [busy, setBusy] = useState(false);
  // the state badge describes the card to screen readers (the name stays its label)
  const stateId = useId();
  const blurred = mod.nsfw && nsfw === "blur";
  const inst = lib.byMod.get(mod.id);
  const upd = inst?.find((m) => m.updateAvailable);
  const arch = !inst && lib.archived.get(mod.id);
  const src = imageAt(mod.image, 530);
  const open = () => openGbMod(mod.id);
  const q = useQueueItem(game, mod.id);
  const showInMods = (id: string) => goIn(game, { view: "library", modId: id });

  const quick = noInstall ? null
    : q?.state === "needsChoice" ? { icon: "layers" as const, label: "Pick the parts to install (I)", run: () => openVariantPicker(q.id) }
    : q ? { icon: "downloads" as const, label: "Show in Downloads (I)", run: () => go("downloads") }
    : upd ? { icon: "update" as const, label: "Update to the newest file (I)", run: () => installLatest(game, mod.id, mod.name, upd.id) }
    : inst ? { icon: "mods" as const, label: "Show in Mods (I)", run: () => showInMods(inst[0]!.id) }
    : arch ? { icon: "install" as const, label: "Reinstall. Your settings for it come back (I)", run: () => installLatest(game, mod.id, mod.name, undefined, true) }
    : { icon: "install" as const, label: "Install the newest file (I)", run: () => installLatest(game, mod.id, mod.name) };
  const runQuick = async () => {
    if (!quick || busy) return;
    setBusy(true);
    try { await quick.run(); } finally { setBusy(false); }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || behindLayer(e.currentTarget)) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    else if ((e.key === "i" || e.key === "I") && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); void runQuick(); }
  };

  return (
    <div className={`card card-btn gb-card${blurred ? " is-nsfw" : ""}${prio ? " is-prio" : ""}${className ? ` ${className}` : ""}`}
      role="button" tabIndex={0} data-pad-x title={prio ? `${mod.name} (from a creator you prioritized)` : mod.name}
      aria-label={mod.name} aria-describedby={stateId}
      onClick={open} onKeyDown={onKey} onContextMenu={menuHandler(() => menuFor("gbmod", { game, card: mod }))}>
      <span className="gb-card-img">
        {src && !broken
          ? <LazyImg src={src} alt="" decoding="async" draggable={false} onError={() => setBroken(true)} />
          : <span className="gb-img-broken"><Icon name="image" /></span>}
        {mod.nsfw && nsfw === "blur" && <span className="gb-nsfw-badge" title="Marked for adults on GameBanana">18+</span>}
        {mod.nsfw && nsfw === "show" && <span className="gb-nsfw-mark" title="Marked for adults on GameBanana">18+</span>}
        <span className="gb-card-state" id={stateId}>
          {prio && <span className="gb-prio" title="From a creator you prioritized" aria-label="From a creator you prioritized" role="img"><Icon name="crown" /></span>}
          {q && !noInstall ? <QueueBadge item={q} />
            : upd ? <Badge tone="accent" icon="update" title={noInstall ? "A newer version is out" : "A newer version is out. Click to update"}
              onClick={noInstall ? undefined : (e) => { e.stopPropagation(); void runQuick(); }}>Update</Badge>
            : inst ? <Badge tone={inst.some((m) => m.enabled) ? "ok" : "muted"} icon="check"
              title={`${inst.some((m) => m.enabled) ? "In your mods, turned on" : "In your mods, turned off"}${noInstall ? "" : ". Click to see it there (I)"}`}
              onClick={noInstall ? undefined : (e) => { e.stopPropagation(); showInMods(inst[0]!.id); }}>{inst.some((m) => m.enabled) ? "Installed" : "Installed, off"}</Badge>
            : arch ? <Badge tone="info" icon="trash" title={noInstall ? "You removed it before. Reinstalling brings back its settings" : "You removed it before. Reinstalling brings back its settings. Click to see it in Mods, Trash"}
              onClick={noInstall ? undefined : (e) => { e.stopPropagation(); goIn(game, { view: "library", tab: "archive" }); }}>Removed</Badge>
            : null}
        </span>
        {q?.state === "downloading" && !noInstall && (
          <span className="gb-card-bar" aria-hidden="true">
            <span className={q.total ? undefined : "is-unknown"} style={q.total ? { width: `${Math.min(100, (q.received / q.total) * 100)}%` } : undefined} />
          </span>
        )}
        {quick && (
          <IconButton className={`gb-card-quick${hintClass(!!hint && !busy && quick.icon === "install")}`} variant="primary" size="sm" icon={busy ? "clock" : quick.icon} label={quick.label}
            data-pad-x-target disabled={busy} tabIndex={-1}
            onClick={(e: MouseEvent) => { e.stopPropagation(); void runQuick(); }} />
        )}
      </span>
      <span className="gb-card-b">
        <span className="gb-card-t">{mod.name}</span>
        {mod.character
          ? <CharLink game={game} name={mod.character} className="gb-card-c" tabIndex={-1} />
          : mod.category && <CategoryLink game={game} category={mod.category} className="gb-card-c is-cat" tabIndex={-1} />}
        <span className="gb-card-meta">
          {mod.submitter && <CreatorLink id={mod.submitter.id} name={mod.submitter.name} avatar={mod.submitter.avatar} modId={mod.id} className="gb-card-by" tabIndex={-1} />}
          <span className="gb-stat" title={`${mod.likes} likes`}><Icon name="heart" />{formatCount(mod.likes)}</span>
          <span className="gb-stat" title={`${mod.views} views`}><Icon name="eye" />{formatCount(mod.views)}</span>
          <span className="gb-stat" title={`Added ${new Date(mod.added * 1000).toLocaleString()}${mod.updated > mod.added + 60 ? `, updated ${new Date(mod.updated * 1000).toLocaleString()}` : ""}`}>{timeAgo(mod.updated)}</span>
        </span>
      </span>
    </div>
  );
});

/** Where the queue is with this card's mod. Pick opens the variant picker; the others open Downloads. */
function QueueBadge({ item }: { item: NonNullable<ReturnType<typeof useQueueItem>> }) {
  const downloads = (e: MouseEvent) => { e.stopPropagation(); go("downloads"); };
  switch (item.state) {
    case "needsChoice":
      return <Badge tone="accent" icon="layers" title="This download has several parts. Click to pick the ones to install (I)"
        onClick={(e) => { e.stopPropagation(); openVariantPicker(item.id); }}>Pick</Badge>;
    case "downloading": {
      const pct = item.total ? `${Math.floor((item.received / item.total) * 100)}%` : formatBytes(item.received);
      return <Badge tone="info" icon="downloads" title="Downloading. Click to see it in Downloads" onClick={downloads}>{pct}</Badge>;
    }
    case "installing":
      return <Badge tone="info" icon="clock" title="Installing. Click to see it in Downloads" onClick={downloads}>Installing</Badge>;
    default:
      return <Badge tone="muted" icon="clock" title="Waiting for the downloads ahead of it. Click to see Downloads" onClick={downloads}>Waiting</Badge>;
  }
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
