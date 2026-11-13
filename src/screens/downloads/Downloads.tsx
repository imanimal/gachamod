// Downloads: the queue of GameBanana files and local installs, with progress, speed and time left. Owner: ONLINE area
// (docs/spec.md, "Downloads and Browse").
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Empty, IconButton, PageHeader, Panel, Progress, formatBytes, plural, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { toast } from "../../ui/toast";
import { dialogs, errorText, fileUrl, installs, queue, type QueueItem, type QueueSnapshot } from "../../lib/api";
import { go, useGame, useGames } from "../../lib/store";
import { useQueue } from "../browse/useQueue";
import { openVariantPicker } from "../browse/OnlineOverlays";
import "./downloads.css";

const finished = (i: QueueItem) => i.state === "done" || i.state === "failed" || i.state === "cancelled";

/** Bytes per second per downloading item, a moving average over the last few seconds of progress events. */
function useSpeeds(snap: QueueSnapshot): Map<number, number> {
  const samples = useRef(new Map<number, Array<{ t: number; b: number }>>());
  const [speeds, setSpeeds] = useState<Map<number, number>>(new Map());
  useEffect(() => {
    const now = performance.now();
    const next = new Map<number, number>();
    const live = new Set<number>();
    for (const i of snap.items) {
      if (i.state !== "downloading") continue;
      live.add(i.id);
      const list = samples.current.get(i.id) ?? [];
      const last = list[list.length - 1];
      if (!last || last.b !== i.received) list.push({ t: now, b: i.received });
      while (list.length > 2 && now - list[0]!.t > 6000) list.shift();
      samples.current.set(i.id, list);
      const first = list[0]!, end = list[list.length - 1]!;
      const dt = (end.t - first.t) / 1000;
      if (list.length >= 2 && dt > 0.4) next.set(i.id, Math.max(0, (end.b - first.b) / dt));
    }
    for (const id of [...samples.current.keys()]) if (!live.has(id)) samples.current.delete(id);
    setSpeeds(next);
  }, [snap]);
  return speeds;
}

function timeLeft(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return "";
  if (secs < 60) return `${Math.max(1, Math.round(secs))} s left`;
  if (secs < 3600) return `${Math.round(secs / 60)} min left`;
  return `${(secs / 3600).toFixed(1)} h left`;
}

function stateLine(i: QueueItem, speed: number | undefined): string {
  switch (i.state) {
    case "waiting": return i.archive || i.req.localPath ? "Waiting to install" : "Waiting to download";
    case "downloading": {
      const parts = [i.total ? `${formatBytes(i.received)} of ${formatBytes(i.total)}` : formatBytes(i.received)];
      if (speed) parts.push(`${formatBytes(speed)}/s`);
      if (speed && i.total) { const left = timeLeft((i.total - i.received) / speed); if (left) parts.push(left); }
      return parts.join(" · ");
    }
    case "installing": return "Installing";
    case "needsChoice": return `${plural(i.candidates.length, "mod")} inside. Pick which to install`;
    case "done": return `Installed ${i.finishedAt ? timeAgo(i.finishedAt) : ""}`.trim();
    case "failed": return i.message;
    case "cancelled": return "Cancelled";
  }
}

export function Downloads() {
  const game = useGame();
  const games = useGames();
  const snap = useQueue();
  const speeds = useSpeeds(snap);
  const [busy, setBusy] = useState(false);

  const act = (job: () => Promise<unknown>) => { job().catch((e) => toast(errorText(e), true)); };
  const active = snap.items.filter((i) => !finished(i));
  const done = snap.items.filter(finished).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));

  const addFiles = async () => {
    if (!game) return;
    setBusy(true);
    try {
      const paths = await dialogs.pickFiles({ title: "Pick mod archives", extensions: ["zip", "7z", "rar"], multiple: true });
      if (!paths) { if (!("__TAURI_INTERNALS__" in window)) toast("Picking files works in the app. Drop archives on the window there"); return; }
      const o = await installs.local(game.id, paths);
      toast(o.notes[0] ?? `Installing ${plural(paths.length, "mod")}`);
    } catch (e) { toast(errorText(e), true); }
    finally { setBusy(false); }
  };

  const gameName = (id: string) => games.find((g) => g.id === id)?.short ?? id;
  const row = (i: QueueItem) => {
    const thumb = fileUrl(i.req.thumb ?? i.req.meta.previewUrl ?? null);
    const name = i.req.meta.name || i.req.fileName || "Mod";
    const other = game && i.req.game !== game.id;
    const speed = speeds.get(i.id);
    const progress = i.state === "downloading" && i.total ? i.received / i.total : null;
    return (
      <li key={i.id} className={`dl-item is-${i.state}`}>
        <span className="dl-thumb">
          {thumb ? <img src={thumb} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.style.display = "none"; }} />
            : <Icon name={i.req.localPath ? "folder" : "package"} />}
        </span>
        <div className="dl-main">
          <div className="dl-name">
            <span className="dl-t" title={i.req.fileName}>{name}</span>
            {i.req.meta.character && <span className="dl-c">{i.req.meta.character}</span>}
            {other && <Badge title="Installs into this game">{gameName(i.req.game)}</Badge>}
            {i.req.meta.replaces && <Badge tone="accent" icon="update">Update</Badge>}
          </div>
          <div className={`dl-line hint${i.state === "failed" ? " dl-bad" : ""}`}>{stateLine(i, speed)}</div>
          {(i.state === "downloading" || i.state === "installing") && <Progress value={progress} label={`${name}: ${stateLine(i, speed)}`} />}
        </div>
        <div className="dl-act">
          {i.state === "needsChoice" && <Button variant="primary" size="sm" icon="layers" onClick={() => openVariantPicker(i.id)}>Pick</Button>}
          {i.state === "done" && i.modIds?.[0] && (
            <Button size="sm" icon="mods" onClick={() => go({ view: "library", modId: i.modIds[0] })} disabled={!!other}
              title={other ? `Switch to ${gameName(i.req.game)} to see it` : "Open it in Mods"}>Show in Mods</Button>
          )}
          {(i.state === "failed" || i.state === "cancelled") && <Button size="sm" icon="refresh" onClick={() => act(() => queue.retry(i.id))}>Retry</Button>}
          {!finished(i) && i.state !== "installing" && <IconButton icon="x" label="Cancel" onClick={() => act(() => queue.cancel(i.id))} />}
          {finished(i) && <IconButton icon="trash" label="Remove from the list" onClick={() => act(() => queue.remove(i.id))} />}
        </div>
      </li>
    );
  };

  const s = snap.summary;
  const sub = s.running + s.waiting > 0 ? `${s.running} running, ${s.waiting} waiting` : "Mods you install from Browse, links and dropped files show up here";
  return (
    <div className="page dl-page">
      <PageHeader title="Downloads" icon="downloads" sub={sub}
        actions={<>
          <Button icon="import" busy={busy} disabled={!game} onClick={() => void addFiles()} title="Install .zip, .7z or .rar files from this PC (or drop them on the window)">Install from files</Button>
          <Button variant="ghost" icon="trash" disabled={!done.length} onClick={() => act(() => queue.clearFinished())}>Clear finished</Button>
        </>} />
      {snap.items.length === 0 ? (
        <Empty icon="downloads" title="Nothing downloading" actions={<Button variant="primary" icon="browse" onClick={() => go("browse")}>Browse mods</Button>}>
          Install a mod from Browse, open a GameBanana link, or drop an archive or folder on the window.
        </Empty>
      ) : (
        <>
          {active.length > 0 && <Panel title="In progress" icon="downloads" count={active.length} className="dl-panel"><ul className="dl-list">{active.map(row)}</ul></Panel>}
          {done.length > 0 && <Panel title="Finished" icon="check" count={done.length} className="dl-panel"><ul className="dl-list">{done.map(row)}</ul></Panel>}
        </>
      )}
    </div>
  );
}
