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
import { t, tn } from "../../lib/i18n";

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
    : q?.state === "needsChoice" ? { icon: "layers" as const, label: t("Pick the parts to install (I)"), run: () => openVariantPicker(q.id) }
    : q ? { icon: "downloads" as const, label: t("Show in Downloads (I)"), run: () => go("downloads") }
    : upd ? { icon: "update" as const, label: t("Update to the newest file (I)"), run: () => installLatest(game, mod.id, upd.id, false, false) }
    : inst ? { icon: "mods" as const, label: t("Show in Mods (I)"), run: () => showInMods(inst[0]!.id) }
    : arch ? { icon: "install" as const, label: t("Reinstall. Your settings for it come back (I)"), run: () => installLatest(game, mod.id, undefined, true, false) }
    : { icon: "install" as const, label: t("Install the newest file (I)"), run: () => installLatest(game, mod.id, undefined, false, false) };
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
      role="button" tabIndex={0} data-pad-x title={prio ? t("{name} (from a creator you prioritized)", { name: mod.name }) : mod.name}
      aria-label={mod.name} aria-describedby={stateId}
      onClick={open} onKeyDown={onKey} onContextMenu={menuHandler(() => menuFor("gbmod", { game, card: mod }))}>
      <span className="gb-card-img">
        {src && !broken
          ? <LazyImg src={src} alt="" decoding="async" draggable={false} onError={() => setBroken(true)} />
          : <span className="gb-img-broken"><Icon name="image" /></span>}
        {mod.nsfw && nsfw === "blur" && <span className="gb-nsfw-badge" title={t("Marked for adults on GameBanana")}>18+</span>}
        {mod.nsfw && nsfw === "show" && <span className="gb-nsfw-mark" title={t("Marked for adults on GameBanana")}>18+</span>}
        <span className="gb-card-state" id={stateId}>
          {prio && <span className="gb-prio" title={t("From a creator you prioritized")} aria-label={t("From a creator you prioritized")} role="img"><Icon name="crown" /></span>}
          {q && !noInstall ? <QueueBadge item={q} />
            : upd ? <Badge tone="accent" icon="update" title={noInstall ? t("A newer version is out") : t("A newer version is out. Click to update")}
              onClick={noInstall ? undefined : (e) => { e.stopPropagation(); void runQuick(); }}>{t("Update")}</Badge>
            : inst ? <Badge tone={inst.some((m) => m.enabled) ? "ok" : "muted"} icon="check"
              title={inst.some((m) => m.enabled)
                ? noInstall ? t("In your mods, turned on") : t("In your mods, turned on. Click to see it there (I)")
                : noInstall ? t("In your mods, turned off") : t("In your mods, turned off. Click to see it there (I)")}
              onClick={noInstall ? undefined : (e) => { e.stopPropagation(); showInMods(inst[0]!.id); }}>{inst.some((m) => m.enabled) ? t("Installed") : t("Installed, off")}</Badge>
            : arch ? <Badge tone="info" icon="trash" title={noInstall ? t("You removed it before. Reinstalling brings back the settings") : t("You removed it before. Reinstalling brings back the settings. Click to see it in Mods, Trash")}
              onClick={noInstall ? undefined : (e) => { e.stopPropagation(); goIn(game, { view: "library", tab: "archive" }); }}>{t("Removed")}</Badge>
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
          {mod.submitter && <CreatorLink id={mod.submitter.id} name={mod.submitter.name} avatar={mod.submitter.avatar} modId={mod.id} className="gb-card-by" tabIndex={-1}
            style={mod.submitter.style} hoverAvatar={mod.submitter.hoverAvatar} />}
          <span className="gb-stat" title={tn(mod.likes, "{n} like", "{n} likes")}><Icon name="heart" />{formatCount(mod.likes)}</span>
          <span className="gb-stat" title={tn(mod.views, "{n} view", "{n} views")}><Icon name="eye" />{formatCount(mod.views)}</span>
          <span className="gb-stat" title={mod.updated > mod.added + 60
            ? t("Added {added}, updated {updated}", { added: new Date(mod.added * 1000).toLocaleString(), updated: new Date(mod.updated * 1000).toLocaleString() })
            : t("Added {added}", { added: new Date(mod.added * 1000).toLocaleString() })}>{timeAgo(mod.updated)}</span>
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
      return <Badge tone="accent" icon="layers" title={t("This download has several parts. Click to pick the ones to install (I)")}
        onClick={(e) => { e.stopPropagation(); openVariantPicker(item.id); }}>{t("Pick")}</Badge>;
    case "downloading": {
      const pct = item.total ? `${Math.floor((item.received / item.total) * 100)}%` : formatBytes(item.received);
      return <Badge tone="info" icon="downloads" title={t("Downloading. Click to see it in Downloads")} onClick={downloads}>{pct}</Badge>;
    }
    case "installing":
      return <Badge tone="info" icon="clock" title={t("Installing. Click to see it in Downloads")} onClick={downloads}>{t("Installing")}</Badge>;
    default:
      return <Badge tone="muted" icon="clock" title={t("Waiting for the downloads ahead of it. Click to see Downloads")} onClick={downloads}>{t("Waiting")}</Badge>;
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
