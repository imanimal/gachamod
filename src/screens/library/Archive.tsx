// Mods, Trash: every mod you removed, newest first. While its files are still on the PC (the app's trash, "trash.days"),
// Put back restores them at once and Delete removes them for good. After that only a short record is left, and
// Download again gets it from GameBanana; the backend brings back its name, character, tags, notes, options and
// profile places when it installs. Forget drops the record. The route value stays "archive". Owner: LIBRARY area.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { errorText, library, type ArchiveEntry, type GameId } from "../../lib/api";
import { queueLatest } from "../../lib/gamebanana";
import { record } from "../../lib/history";
import { useNsfw } from "../../lib/prefs";
import { useTrashDays } from "../settings/automatic";
import { t, tn } from "../../lib/i18n";
import { go, onApp } from "../../lib/store";
import { held } from "../../lib/tauri";
import { menuHandler, openMenu, type MenuEntry } from "../../ui/ContextMenu";
import { Button, Confirm, Empty, IconButton, PageHeader, SearchField, Skeleton, formatBytes, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { CharLink, CreatorLink } from "../../ui/Links";
import { toast } from "../../ui/toast";
import { publish } from "./data";
import { moveInGrid } from "./gridNav";
import { Preview } from "./Preview";

const FORGET_AFTER = 7000;

/** The page under Mods' header; `tabs` is the Installed/Trash switch, which goes first in the header's action row. */
export function Archive({ game, tabs }: { game: GameId; tabs: ReactNode }) {
  const nsfw = useNsfw();
  const trashDays = useTrashDays();
  const [items, setItems] = useState<ArchiveEntry[] | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<ArchiveEntry | null>(null);
  const [askAll, setAskAll] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const pending = useRef(new Map<string, number>());

  const load = useCallback(async () => {
    // the backend command may be missing in an older build: an empty archive then
    try { setItems(await library.archive(game)); } catch { setItems((x) => x ?? []); }
  }, [game]);
  useEffect(() => {
    setItems(null);
    void load();
    const off = held(library.onChanged((p) => { if (p.game === game) void load(); }));
    const offApp = onApp((e) => { if (e.type === "library-refresh" && e.game === game) void load(); });
    return () => { off(); offApp(); };
  }, [game, load]);

  // forgetting waits a few seconds so the toast's Undo can stop it; leaving the screen does it at once
  const commit = useCallback((keys: string[]) => {
    for (const k of keys) { window.clearTimeout(pending.current.get(k)); pending.current.delete(k); }
    if (keys.length) library.archiveForget(keys).then(() => load()).catch((e) => toast(errorText(e), true));
  }, [load]);
  useEffect(() => () => { const keys = [...pending.current.keys()]; if (keys.length) commit(keys); }, [commit]);

  const forgetLater = (e: ArchiveEntry) => {
    setLeaving((s) => new Set(s).add(e.key));
    pending.current.set(e.key, window.setTimeout(() => commit([e.key]), FORGET_AFTER));
    toast(t("Forgot {mod}", { mod: e.name }), false, {
      label: t("Undo"),
      run: () => {
        window.clearTimeout(pending.current.get(e.key));
        pending.current.delete(e.key);
        setLeaving((s) => { const n = new Set(s); n.delete(e.key); return n; });
      },
    });
  };
  const forget = (e: ArchiveEntry) => { if (e.trashId !== null) setAsk(e); else forgetLater(e); };

  const reinstall = async (e: ArchiveEntry) => {
    setBusy(e.key);
    try {
      if (e.trashId !== null) {
        const ch = await library.trashRestore(e.trashId);
        publish(game, ch);
        let ids = ch.changed.map((m) => m.id);
        record({
          label: t("Put back {mod}", { mod: e.name }),
          undo: async () => { const c = await library.remove(game, ids); publish(game, c); },
          redo: async () => {
            const tr = (await library.trash(game)).find((x) => ids.includes(x.modId));
            if (!tr) throw new Error(t("The mod's files aren't in the trash anymore"));
            const c = await library.trashRestore(tr.id);
            publish(game, c);
            ids = c.changed.map((m) => m.id);
          },
        });
        void load();
      } else if (e.source) {
        const item = await queueLatest(game, e.source.modId);
        if (item) toast(t("Downloading {mod}. The settings come back when it installs", { mod: e.name }), false, { label: t("Downloads"), run: () => go("downloads") });
        else toast(t("{mod} has no files left on GameBanana", { mod: e.name }), true);
      } else {
        toast(t("The mod's files are gone and it didn't come from GameBanana, so there's nothing to download"), true);
      }
    } catch (err) { toast(errorText(err), true); }
    finally { setBusy(null); }
  };

  const menu = (e: ArchiveEntry): MenuEntry[] => [
    { header: e.name },
    { label: e.trashId !== null ? t("Put back") : t("Download again"), icon: "undo", disabled: e.trashId === null && !e.source, onClick: () => void reinstall(e) },
    !!e.character && { label: t("Open {name}'s page", { name: e.character! }), icon: "characters", onClick: () => go({ view: "characters", character: e.character! }) },
    e.source && { label: t("View on GameBanana"), icon: "browse", onClick: () => go({ view: "browse", modId: e.source!.modId }) },
    "-",
    e.trashId !== null
      ? { label: t("Delete"), icon: "trash", danger: true, title: t("Deletes its files from your PC and forgets its settings"), onClick: () => forget(e) }
      : { label: t("Forget"), icon: "x", danger: true, title: t("Deletes this record and its saved settings"), onClick: () => forget(e) },
  ];

  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (items ?? []).filter((e) => {
    if (leaving.has(e.key) || (e.nsfw && nsfw === "hide")) return false;
    const hay = `${e.name} ${e.character ?? ""} ${e.tags.join(" ")} ${e.source?.submitter ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });

  return (
    <>
    <PageHeader title={t("Mods")} icon="mods" sub={t("Mods you removed")}
      actions={<>{tabs}<SearchField value={search} onChange={setSearch} placeholder={t("Search removed mods")} className="library-search" /></>} />
    <div className="archive">
      {items !== null && items.length > 0 && (
        <div className="archive-top">
          <span className="hint archive-hint">
            {trashDays > 0
              ? tn(trashDays, "Files of removed mods stay on your PC for {n} day, then they're deleted.", "Files of removed mods stay on your PC for {n} days, then they're deleted.")
              : t("Removing a mod deletes its files.")}
            {" "}{t("Each mod's GameBanana link and settings stay here, so Download again gets it back as it was.")}
          </span>
          <Button size="sm" variant="ghost" icon="trash" title={t("Deletes every removed mod's files and saved settings. You're asked first")}
            onClick={() => setAskAll(true)}>{t("Empty trash")}</Button>
          <Button size="sm" variant="ghost" icon="settings" title={t("Keep removed mods' files (Settings, Trash and removed mods)")}
            onClick={() => go({ view: "settings", section: "set-trash-days" })}>{trashDays > 0 ? t("Change") : t("Keep files")}</Button>
        </div>
      )}
      {items === null ? (
        <div className="tiles archive-grid">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="mod-card-skel" />)}</div>
      ) : !shown.length ? (
        <Empty icon="trash" title={items.length ? t("Nothing matches") : t("The trash is empty. Very tidy")}>
          {items.length ? t("Try another search.") : t("Mods you remove show up here, so you can put them back or download them again with their settings.")}
        </Empty>
      ) : (
        <div ref={grid} className="tiles archive-grid" onKeyDown={(k) => moveInGrid(k, grid.current, ".archive-card")}>
          {shown.map((e) => {
            const files = e.trashId !== null;
            // what the Files on PC or Record only tag means, also on the tile so keyboard and controller users see it
            const kept = !files
              ? t("The mod's files were deleted from your PC. Only its name, settings and GameBanana link are kept, so Download again gets it back with its settings")
              : e.filesUntil
                ? t("The mod's files are still on your PC until {date}. Put back restores them as they were", { date: new Date(e.filesUntil * 1000).toLocaleDateString() })
                : t("The mod's files are still on your PC. Put back restores them as they were");
            return (
              <div key={e.key} className={`tile archive-card${e.nsfw && nsfw === "blur" ? " blur" : ""}`} tabIndex={0} data-pad-x
                title={files ? t("{mod}. {kept}. Enter puts it back, arrow keys move between mods", { mod: e.name, kept }) : t("{mod}. {kept}. Enter downloads it again, arrow keys move between mods", { mod: e.name, kept })}
                onKeyDown={(k) => { if (k.key === "Enter" && k.target === k.currentTarget && (files || e.source)) { k.preventDefault(); void reinstall(e); } }}
                onContextMenu={menuHandler(() => menu(e))}>
                <div className="tile-img">
                  <Preview className="archive-img" src={e.preview} icon="archive" alt={e.name} />
                  <span className="tile-tr">
                    <span className={`badge ${files ? "t-ok" : "t-muted"}`} title={kept}>
                      <Icon name={files ? "folder" : "archive"} />{files ? t("Files on PC") : t("Record only")}
                    </span>
                  </span>
                </div>
                <div className="tile-body">
                  <span className="tile-t" title={e.name}>{e.name}</span>
                  <span className="tile-sub">
                    {e.character ? <CharLink game={game} name={e.character} /> : t("No character")}
                    {e.source?.submitter && <> · <CreatorLink name={e.source.submitter} modId={e.source.modId} /></>}
                  </span>
                  <span className="tile-meta">
                    <span title={new Date(e.removedAt * 1000).toLocaleString()}><Icon name="clock" />{e.reason === "replaced" ? t("Replaced {when}", { when: timeAgo(e.removedAt) }) : t("Removed {when}", { when: timeAgo(e.removedAt) })}</span>
                    {files && e.sizeBytes > 0 && <span title={t("Space its files take on your PC")}>{formatBytes(e.sizeBytes)}</span>}
                    {e.hasOptions && <span title={t("The mod's option values are saved")}><Icon name="sliders" /></span>}
                  </span>
                  <span className="archive-a">
                    <Button size="sm" variant="primary" icon={files ? "undo" : "downloads"} busy={busy === e.key} disabled={!files && !e.source}
                      title={files ? t("Puts its files back in the Mods folder") : e.source ? t("Downloads it from GameBanana again, with its settings") : t("The files were deleted and the mod has no GameBanana link")}
                      onClick={() => void reinstall(e)}>{files ? t("Put back") : t("Download again")}</Button>
                    {files
                      ? <Button size="sm" variant="ghost" onClick={() => forget(e)} title={t("Deletes its files from your PC and forgets its settings")}>{t("Delete")}</Button>
                      : <Button size="sm" variant="ghost" onClick={() => forget(e)} title={t("Deletes this record and its saved settings")}>{t("Forget")}</Button>}
                    <IconButton icon="more" size="sm" label={t("More actions (right-click or Shift+F10)")} data-pad-x-target
                      onClick={(k) => openMenu(k.currentTarget, menu(e))} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {askAll && items && (
        <Confirm danger yes={t("Empty trash")} title={tn(items.length, "Delete all {n} removed mod?", "Delete all {n} removed mods?")}
          onYes={() => { setLeaving(new Set(items.map((x) => x.key))); commit(items.map((x) => x.key)); }} onClose={() => setAskAll(false)}>
          {t("This deletes their files still on your PC and their saved settings, so Download again can't bring them back as they were. It can't be undone.")}
        </Confirm>
      )}
      {ask && (
        <Confirm danger yes={t("Delete")} title={t("Delete {mod}?", { mod: ask.name })} onYes={() => commit([ask.key])} onClose={() => setAsk(null)}>
          {t("The mod's files are still on your PC. This deletes them and its saved settings, and can't be undone.")}
        </Confirm>
      )}
    </div>
    </>
  );
}
