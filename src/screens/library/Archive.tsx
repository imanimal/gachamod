// Mods, Trash: every mod you removed, newest first. While its files are still on the PC (the app's trash, "trash.days"),
// Put back restores them at once and Delete removes them for good. After that only a short record is left, and
// Download again gets it from GameBanana; the backend brings back its name, character, tags, notes, options and
// profile places when it installs. Forget drops the record. The route value stays "archive". Owner: LIBRARY area.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { errorText, library, type ArchiveEntry, type GameId } from "../../lib/api";
import { queueLatest } from "../../lib/gamebanana";
import { record } from "../../lib/history";
import { useNsfw } from "../../lib/prefs";
import { trashPhrase, useTrashDays } from "../settings/automatic";
import { go, onApp } from "../../lib/store";
import { held } from "../../lib/tauri";
import { menuHandler, type MenuEntry } from "../../ui/ContextMenu";
import { Button, Confirm, Empty, PageHeader, SearchField, Skeleton, formatBytes, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { CharLink, CreatorLink } from "../../ui/Links";
import { toast } from "../../ui/toast";
import { publish } from "./data";
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
    toast(`Forgot ${e.name}`, false, {
      label: "Undo",
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
          label: `Put back ${e.name}`,
          undo: async () => { const c = await library.remove(game, ids); publish(game, c); },
          redo: async () => {
            const t = (await library.trash(game)).find((x) => ids.includes(x.modId));
            if (!t) throw new Error("Its files aren't in the trash anymore");
            const c = await library.trashRestore(t.id);
            publish(game, c);
            ids = c.changed.map((m) => m.id);
          },
        });
        void load();
      } else if (e.source) {
        const item = await queueLatest(game, e.source.modId);
        if (item) toast(`Downloading ${e.name}. Its settings come back when it installs`, false, { label: "Downloads", run: () => go("downloads") });
        else toast(`${e.name} has no files left on GameBanana`, true);
      } else {
        toast("Its files are gone and it didn't come from GameBanana, so there's nothing to download", true);
      }
    } catch (err) { toast(errorText(err), true); }
    finally { setBusy(null); }
  };

  const menu = (e: ArchiveEntry): MenuEntry[] => [
    { header: e.name },
    { label: e.trashId !== null ? "Put back" : "Download again", icon: "undo", disabled: e.trashId === null && !e.source, onClick: () => void reinstall(e) },
    !!e.character && { label: `Open ${e.character}'s page`, icon: "characters", onClick: () => go({ view: "characters", character: e.character! }) },
    e.source && { label: "View on GameBanana", icon: "browse", onClick: () => go({ view: "browse", modId: e.source!.modId }) },
    "-",
    e.trashId !== null
      ? { label: "Delete", icon: "trash", danger: true, title: "Deletes its files from your PC and forgets its settings", onClick: () => forget(e) }
      : { label: "Forget", icon: "x", danger: true, title: "Deletes this record and its saved settings", onClick: () => forget(e) },
  ];

  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (items ?? []).filter((e) => {
    if (leaving.has(e.key) || (e.nsfw && nsfw === "hide")) return false;
    const hay = `${e.name} ${e.character ?? ""} ${e.tags.join(" ")} ${e.source?.submitter ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });

  return (
    <>
    <PageHeader title="My Mods" icon="mods" sub="Mods you removed"
      actions={<>{tabs}<SearchField value={search} onChange={setSearch} placeholder="Search removed mods" className="library-search" /></>} />
    <div className="archive">
      {items !== null && items.length > 0 && (
        <div className="archive-top">
          <span className="hint archive-hint">
            {trashDays > 0
              ? `Files of removed mods ${trashPhrase(trashDays)}, then they're deleted. `
              : "Removing a mod deletes its files. "}
            Each mod's GameBanana link and settings stay here, so Download again gets it back as it was.
          </span>
          <Button size="sm" variant="ghost" icon="settings" title="Keep removed mods' files (Settings, Trash and removed mods)"
            onClick={() => go({ view: "settings", section: "set-trash-days" })}>{trashDays > 0 ? "Change" : "Keep files"}</Button>
        </div>
      )}
      {items === null ? (
        <div className="tiles archive-grid">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="mod-card-skel" />)}</div>
      ) : !shown.length ? (
        <Empty icon="trash" title={items.length ? "Nothing matches" : "The trash is empty. Very tidy"}>
          {items.length ? "Try another search." : "Mods you remove show up here, so you can put them back or download them again with their settings."}
        </Empty>
      ) : (
        <div className="tiles archive-grid">
          {shown.map((e) => {
            const files = e.trashId !== null;
            return (
              <div key={e.key} className={`tile archive-card${e.nsfw && nsfw === "blur" ? " blur" : ""}`} onContextMenu={menuHandler(() => menu(e))}>
                <div className="tile-img">
                  <Preview className="archive-img" src={e.preview} icon="archive" alt={e.name} />
                  <span className="tile-tr">
                    <span className={`badge ${files ? "t-ok" : "t-muted"}`}
                      title={files
                        ? `Its files are still on your PC${e.filesUntil ? ` until ${new Date(e.filesUntil * 1000).toLocaleDateString()}` : ""}. Put back restores them as they were`
                        : "Its files were deleted from your PC. Only its name, settings and GameBanana link are kept, so Download again gets it back with its settings"}>
                      <Icon name={files ? "folder" : "archive"} />{files ? "Files on PC" : "Record only"}
                    </span>
                  </span>
                </div>
                <div className="tile-body">
                  <span className="tile-t" title={e.name}>{e.name}</span>
                  <span className="tile-sub">
                    {e.character ? <CharLink game={game} name={e.character} /> : "No character"}
                    {e.source?.submitter && <> · <CreatorLink name={e.source.submitter} modId={e.source.modId} /></>}
                  </span>
                  <span className="tile-meta">
                    <span title={new Date(e.removedAt * 1000).toLocaleString()}><Icon name="clock" />{e.reason === "replaced" ? "Replaced" : "Removed"} {timeAgo(e.removedAt)}</span>
                    {files && e.sizeBytes > 0 && <span title="Space its files take on your PC">{formatBytes(e.sizeBytes)}</span>}
                    {e.hasOptions && <span title="Its option values are saved"><Icon name="sliders" /></span>}
                  </span>
                  <span className="archive-a">
                    <Button size="sm" variant="primary" icon={files ? "undo" : "downloads"} busy={busy === e.key} disabled={!files && !e.source}
                      title={files ? "Puts its files back in the Mods folder" : e.source ? "Downloads it from GameBanana again, with its settings" : "Its files were deleted and it has no GameBanana link"}
                      onClick={() => void reinstall(e)}>{files ? "Put back" : "Download again"}</Button>
                    {files
                      ? <Button size="sm" variant="ghost" onClick={() => forget(e)} title="Deletes its files from your PC and forgets its settings">Delete</Button>
                      : <Button size="sm" variant="ghost" onClick={() => forget(e)} title="Deletes this record and its saved settings">Forget</Button>}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {ask && (
        <Confirm danger yes="Delete" title={`Delete ${ask.name}?`} onYes={() => commit([ask.key])} onClose={() => setAsk(null)}>
          Its files are still on your PC. This deletes them and its saved settings, and can't be undone.
        </Confirm>
      )}
    </div>
    </>
  );
}
