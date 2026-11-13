// Recently removed: mods in the app's trash (kept 14 days) with Restore and Delete for good. Owner: LIBRARY area.
import { useCallback, useEffect, useState } from "react";
import { errorText, library, type GameId } from "../../lib/api";
import type { TrashEntry } from "../../lib/api/library";
import { Button, Confirm, Dialog, Empty, Spinner, formatBytes, timeAgo } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { publish } from "./data";

export function TrashDialog({ game, onClose }: { game: GameId; onClose: () => void }) {
  const [items, setItems] = useState<TrashEntry[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [purge, setPurge] = useState<TrashEntry | "all" | null>(null);

  const load = useCallback(async (live: () => boolean) => {
    try { const t = await library.trash(game); if (live()) setItems(t); }
    catch (e) { if (live()) { setItems([]); toast(errorText(e), true); } }
  }, [game]);
  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => { live = false; };
  }, [load]);

  const restore = async (t: TrashEntry) => {
    setBusy(t.id);
    try {
      const ch = await library.trashRestore(t.id);
      publish(game, ch);
      setItems((l) => l?.filter((x) => x.id !== t.id) ?? null);
      const back = ch.changed[0];
      toast(back && back.relPath !== t.originalRel ? `Restored ${t.name} as ${back.folder}` : `Restored ${t.name}`);
    } catch (e) { toast(errorText(e), true); }
    finally { setBusy(null); }
  };

  const forGood = async (what: TrashEntry | "all") => {
    try {
      const list = what === "all" ? items ?? [] : [what];
      for (const t of list) await library.trashPurge(t.id);
      setItems((l) => (what === "all" ? [] : l?.filter((x) => x.id !== what.id) ?? null));
      toast(what === "all" ? "Emptied Recently removed" : `Deleted ${what.name} for good`);
    } catch (e) { toast(errorText(e), true); }
  };

  return (
    <Dialog title="Recently removed" icon="trash" size="lg" className="trash-dialog" onClose={onClose}
      footer={<>
        {!!items?.length && <Button variant="ghost" icon="trash" onClick={() => setPurge("all")}>Delete all for good</Button>}
        <span className="grow" />
        <Button onClick={onClose}>Close</Button>
      </>}>
      <p className="hint trash-hint">Removed mods stay here for 14 days, then they are deleted.</p>
      {items === null ? <div className="trash-loading"><Spinner /></div>
        : !items.length ? <Empty icon="trash" title="Nothing removed lately">Mods you remove show up here so you can put them back.</Empty>
        : (
          <ul className="trash-list">
            {items.map((t) => (
              <li key={t.id} className="trash-item">
                <span className="trash-item-t">
                  <span className="trash-item-name">{t.name}</span>
                  <span className="hint">{t.originalRel} · {formatBytes(t.size)} · {t.reason === "replaced" ? "old copy kept by an update" : "removed"} {timeAgo(t.removedAt)}</span>
                </span>
                <Button size="sm" icon="undo" busy={busy === t.id} onClick={() => void restore(t)}>Restore</Button>
                <Button size="sm" variant="ghost" onClick={() => setPurge(t)}>Delete for good</Button>
              </li>
            ))}
          </ul>
        )}
      {purge && (
        <Confirm danger yes="Delete for good" title={purge === "all" ? "Delete everything here for good?" : `Delete ${purge.name} for good?`}
          onYes={() => forGood(purge)} onClose={() => setPurge(null)}>
          This deletes the files from your PC. It can't be undone.
        </Confirm>
      )}
    </Dialog>
  );
}
