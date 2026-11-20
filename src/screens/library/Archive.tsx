// Mods, Trash: every mod you removed, newest first. While its files are still on the PC (the app's trash, "trash.days"),
// Put back restores them at once and Delete removes them for good. After that only a short record is left, and
// Download again gets it from GameBanana; the backend brings back its name, character, tags, notes, options and
// profile places when it installs. Forget drops the record. The route value stays "archive".
// A mod with files still here and no GameBanana link can't be downloaded again, so deleting it follows
// "trash.unsourced": ask (Recycle Bin or delete for good, with Remember my choice), or do one without asking.
// Owner: LIBRARY area.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { errorText, library, shell, type ArchiveEntry, type GameId } from "../../lib/api";
import { queueLatest } from "../../lib/gamebanana";
import { record } from "../../lib/history";
import { useNsfw } from "../../lib/prefs";
import { unsourcedPref, useTrashDays, useUnsourced } from "../settings/automatic";
import { t, tn } from "../../lib/i18n";
import { go, onApp } from "../../lib/store";
import { held } from "../../lib/tauri";
import { menuHandler, openMenu, type MenuEntry } from "../../ui/ContextMenu";
import { Button, Checkbox, Confirm, Dialog, Empty, IconButton, PageHeader, SearchField, Skeleton, formatBytes, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { CharLink, CreatorLink } from "../../ui/Links";
import { toast } from "../../ui/toast";
import { publish } from "./data";
import { moveInGrid } from "./gridNav";
import { Preview } from "./Preview";

const FORGET_AFTER = 7000;

/** Files still on the PC and no GameBanana link: nothing can download them again. */
const unsourced = (e: ArchiveEntry) => e.trashId !== null && !e.source;

/** What a delete says when it's done: one mod, or the whole trash (`all`). */
function doneText(list: ArchiveEntry[], all: boolean, recycle: boolean): string {
  const binned = recycle ? list.filter(unsourced).length : 0;
  if (all) {
    return binned
      ? tn(binned, "Emptied the trash. {n} mod that isn't on GameBanana went to the Recycle Bin", "Emptied the trash. {n} mods that aren't on GameBanana went to the Recycle Bin")
      : t("Emptied the trash");
  }
  return binned ? t("Moved the mod to the Recycle Bin") : t("Deleted the mod");
}

/** The page under Mods' header; `tabs` is the Installed/Trash switch, which goes first in the header's action row. */
export function Archive({ game, tabs }: { game: GameId; tabs: ReactNode }) {
  const nsfw = useNsfw();
  const trashDays = useTrashDays();
  const mode = useUnsourced();
  const [items, setItems] = useState<ArchiveEntry[] | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<ArchiveEntry | null>(null);
  const [askAll, setAskAll] = useState(false);
  const [choose, setChoose] = useState<{ list: ArchiveEntry[]; all: boolean } | null>(null);
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

  // forgetting waits a few seconds so the toast's Undo can stop it; leaving the screen does it at once. `recycle`
  // sends the files of mods with no GameBanana link to the Recycle Bin, `said` is the toast once it's done.
  const commit = useCallback((keys: string[], recycle = false, said?: string) => {
    for (const k of keys) { window.clearTimeout(pending.current.get(k)); pending.current.delete(k); }
    if (!keys.length) return;
    library.archiveForget(keys, recycle)
      .then(() => { if (said) toast(said); })
      .catch((e) => {
        toast(errorText(e), true);
        setLeaving((s) => { const n = new Set(s); keys.forEach((k) => n.delete(k)); return n; });
      })
      .finally(() => void load());
  }, [load]);
  useEffect(() => () => { const keys = [...pending.current.keys()]; if (keys.length) commit(keys); }, [commit]);

  /** Delete entries now, files and all. */
  const drop = (list: ArchiveEntry[], all: boolean, recycle: boolean) => {
    const keys = list.map((x) => x.key);
    setLeaving((s) => { const n = new Set(s); keys.forEach((k) => n.add(k)); return n; });
    commit(keys, recycle, doneText(list, all, recycle));
  };

  const forgetLater = (e: ArchiveEntry) => {
    setLeaving((s) => new Set(s).add(e.key));
    pending.current.set(e.key, window.setTimeout(() => commit([e.key]), FORGET_AFTER));
    toast(t("Forgot the mod"), false, {
      label: t("Undo"),
      run: () => {
        window.clearTimeout(pending.current.get(e.key));
        pending.current.delete(e.key);
        setLeaving((s) => { const n = new Set(s); n.delete(e.key); return n; });
      },
    });
  };
  const forget = (e: ArchiveEntry) => {
    if (e.trashId === null) forgetLater(e);
    else if (!unsourced(e)) setAsk(e);
    else if (mode === "ask") setChoose({ list: [e], all: false });
    else drop([e], false, mode === "recycle");
  };
  const emptyTrash = () => {
    if (items && mode === "ask" && items.some(unsourced)) setChoose({ list: items, all: true });
    else setAskAll(true);
  };
  const deleteTip = (e: ArchiveEntry) =>
    !unsourced(e) || mode === "delete" ? t("Deletes the files from your PC and forgets the settings")
      : mode === "recycle" ? t("Moves the files to the Recycle Bin and forgets the settings")
      : t("Forgets it and the settings. You choose whether the files go to the Recycle Bin or are deleted for good");

  const reinstall = async (e: ArchiveEntry) => {
    setBusy(e.key);
    try {
      if (e.trashId !== null) {
        const ch = await library.trashRestore(e.trashId);
        publish(game, ch);
        let ids = ch.changed.map((m) => m.id);
        record({
          label: t("Put back {mod}", { mod: e.name }),
          brief: t("Put the mod back"),
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
        if (item) toast(t("Downloading the mod. The settings come back when it installs"), false, { label: t("Downloads"), run: () => go("downloads") });
        else toast(t("The mod has no files left on GameBanana"), true);
      } else {
        toast(t("The mod's files are gone and it didn't come from GameBanana, so there's nothing to download"), true);
      }
    } catch (err) { toast(errorText(err), true); }
    finally { setBusy(null); }
  };

  const showFiles = (e: ArchiveEntry) => { if (e.path) shell.openPath(e.path).catch((err) => toast(errorText(err), true)); };

  const menu = (e: ArchiveEntry): MenuEntry[] => [
    { header: e.name },
    { label: e.trashId !== null ? t("Put back") : t("Download again"), icon: "undo", disabled: e.trashId === null && !e.source, onClick: () => void reinstall(e) },
    e.trashId !== null && !!e.path && { label: t("Open folder"), icon: "folder", title: t("Shows the removed mod's files in File Explorer"), onClick: () => showFiles(e) },
    !!e.character && { label: t("Open {name}'s page", { name: e.character! }), icon: "characters", onClick: () => go({ view: "characters", character: e.character! }) },
    e.source && { label: t("View on GameBanana"), icon: "browse", onClick: () => go({ view: "browse", modId: e.source!.modId }) },
    "-",
    e.trashId !== null
      ? { label: t("Delete"), icon: "trash", danger: true, title: deleteTip(e), onClick: () => forget(e) }
      : { label: t("Forget"), icon: "x", danger: true, title: t("Deletes this record and the saved settings"), onClick: () => forget(e) },
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
              : mode === "delete" ? t("Removing a mod deletes the files.") : t("Removing a mod deletes the files, or moves them to the Recycle Bin when it isn't on GameBanana.")}
            {" "}{t("Each mod's GameBanana link and settings stay here, so Download again gets it back as it was.")}
          </span>
          <Button size="sm" variant="ghost" icon="trash" title={t("Deletes every removed mod's files and saved settings. You're asked first")}
            onClick={emptyTrash}>{t("Empty trash")}</Button>
          <Button size="sm" variant="ghost" icon="settings" title={t("Keep removed mods' files (Settings, Trash and removed mods)")}
            onClick={() => go({ view: "settings", section: "set-trash-days" })}>{trashDays > 0 ? t("Change") : t("Keep files")}</Button>
        </div>
      )}
      {items === null ? (
        <div className="tiles archive-grid">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="mod-card-skel" />)}</div>
      ) : !shown.length ? (
        <Empty icon="trash" title={items.length ? t("Nothing matches") : t("The trash is empty")}>
          {items.length ? t("Try another search.") : t("Mods you remove show up here, so you can put them back or download them again with their settings.")}
        </Empty>
      ) : (
        <div ref={grid} className="tiles archive-grid" onKeyDown={(k) => moveInGrid(k, grid.current, ".archive-card")}>
          {shown.map((e) => {
            const files = e.trashId !== null;
            // what the Files on PC or Record only tag means, also on the tile so keyboard and controller users see it
            const kept = !files
              ? t("The mod's files were deleted from your PC. Only the name, settings and GameBanana link are kept, so Download again gets it back with the settings")
              : e.filesUntil
                ? t("The mod's files are still on your PC until {date}. Put back restores them as they were", { date: new Date(e.filesUntil * 1000).toLocaleDateString() })
                : t("The mod's files are still on your PC. Put back restores them as they were");
            return (
              <div key={e.key} className="tile archive-card" tabIndex={0} data-pad-x
                title={files ? t("{mod}. {kept}. Enter puts it back, arrow keys move between mods", { mod: e.name, kept }) : t("{mod}. {kept}. Enter downloads it again, arrow keys move between mods", { mod: e.name, kept })}
                onKeyDown={(k) => { if (k.key === "Enter" && k.target === k.currentTarget && (files || e.source)) { k.preventDefault(); void reinstall(e); } }}
                onContextMenu={menuHandler(() => menu(e))}>
                <div className="tile-img">
                  <Preview className="archive-img" src={e.preview} icon="archive" alt={e.name} blur={e.nsfw && nsfw === "blur"} />
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
                    {files && e.sizeBytes > 0 && (e.path
                      ? <button type="button" className="link-btn" title={t("Space the files take on your PC. Click to open the folder")} onClick={() => showFiles(e)}>{formatBytes(e.sizeBytes)}</button>
                      : <span title={t("Space the files take on your PC")}>{formatBytes(e.sizeBytes)}</span>)}
                    {e.hasOptions && <span title={t("The mod's option values are saved")}><Icon name="sliders" /></span>}
                  </span>
                  <span className="archive-a">
                    <Button size="sm" variant="primary" icon={files ? "undo" : "downloads"} busy={busy === e.key} disabled={!files && !e.source}
                      title={files ? t("Puts the files back in the Mods folder") : e.source ? t("Downloads it from GameBanana again, with the settings") : t("The files were deleted and the mod has no GameBanana link")}
                      onClick={() => void reinstall(e)}>{files ? t("Put back") : t("Download again")}</Button>
                    {files
                      ? <Button size="sm" variant="ghost" onClick={() => forget(e)} title={deleteTip(e)}>{t("Delete")}</Button>
                      : <Button size="sm" variant="ghost" onClick={() => forget(e)} title={t("Deletes this record and the saved settings")}>{t("Forget")}</Button>}
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
          onYes={() => drop(items, true, mode === "recycle")} onClose={() => setAskAll(false)}>
          {t("This deletes their files still on your PC and their saved settings, so Download again can't bring them back as they were. It can't be undone.")}
          {mode === "recycle" && items.some(unsourced) && <>{" "}{t("Files of mods that aren't on GameBanana go to the Recycle Bin instead.")}</>}
        </Confirm>
      )}
      {ask && (
        <Confirm danger yes={t("Delete")} title={t("Delete {mod}?", { mod: ask.name })} onYes={() => drop([ask], false, false)} onClose={() => setAsk(null)}>
          {t("The mod's files are still on your PC. This deletes them and the saved settings, and can't be undone.")}
        </Confirm>
      )}
      {choose && (
        <RecycleChoice list={choose.list} all={choose.all} onClose={() => setChoose(null)}
          onChoose={(recycle) => drop(choose.list, choose.all, recycle)} />
      )}
    </div>
    </>
  );
}

/** Deleting mods whose files nothing can download again: Recycle Bin or delete for good. Remember my choice saves it
 *  as "trash.unsourced", which Settings, Trash and removed mods can change; without it this asks again next time. */
function RecycleChoice({ list, all, onChoose, onClose }:
  { list: ArchiveEntry[]; all: boolean; onChoose: (recycle: boolean) => void; onClose: () => void }) {
  const [remember, setRemember] = useState(false);
  const pick = (recycle: boolean) => {
    if (remember) void unsourcedPref.set(recycle ? "recycle" : "delete");
    onChoose(recycle);
    onClose();
  };
  const lost = list.filter(unsourced).length;
  const title = all ? tn(list.length, "Delete all {n} removed mod?", "Delete all {n} removed mods?") : t("Delete {mod}?", { mod: list[0]?.name ?? "" });
  return (
    <Dialog title={title} size="sm" onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
      <Button variant="danger" onClick={() => pick(false)} title={t("Deletes the files now. Nothing can bring them back")}>{t("Delete for good")}</Button>
      {/* the safe answer has the focus, so a stray Enter or A press keeps the files */}
      <Button variant="primary" autoFocus onClick={() => pick(true)} title={t("You can restore the files from the Recycle Bin until you empty it")}>{t("Move to Recycle Bin")}</Button>
    </>}>
      <div className="lib-say">
        <p>
          {all
            ? <>{tn(lost, "{n} of them isn't on GameBanana, so it can't be downloaded again.", "{n} of them aren't on GameBanana, so they can't be downloaded again.")}
              {" "}{t("Move those files to the Recycle Bin, or delete them for good? The other removed mods and every saved setting are deleted either way.")}</>
            : t("{mod} isn't on GameBanana, so it can't be downloaded again. Move the files to the Recycle Bin, or delete them for good?", { mod: list[0]?.name ?? "" })}
        </p>
        <p>
          <Checkbox checked={remember} onChange={setRemember} label={t("Remember my choice")}
            title={t("Stops asking and does the same next time")} />
        </p>
        <p className="hint">{t("You can change this later in Settings, under Trash and removed mods.")}</p>
        <Button size="sm" variant="ghost" icon="settings" title={t("Opens Settings, Trash and removed mods")}
          onClick={() => { onClose(); go({ view: "settings", section: "set-trash-unsourced" }); }}>{t("Open setting")}</Button>
      </div>
    </Dialog>
  );
}
