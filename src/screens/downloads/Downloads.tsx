// Downloads: the queue of GameBanana files and local installs, with progress, speed and time left. Shows the current
// game's downloads; "All games" (remembered, or route tab "all") shows every game's, grouped by game.
// Owner: BROWSE area (docs/spec.md, "Downloads and Browse").
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Empty, IconButton, PageHeader, Panel, Progress, Toggle, formatBytes, plural, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { CharLink } from "../../ui/Links";
import { toast } from "../../ui/toast";
import { dialogs, errorText, fileUrl, installs, queue, type QueueItem, type QueueSnapshot } from "../../lib/api";
import { go, patchRoute, useGame, useGames, useRoute } from "../../lib/store";
import { useQueue } from "../browse/useQueue";
import { openVariantPicker } from "../browse/OnlineOverlays";
import { EnableNewSwitch } from "../settings/Sections";
import { canInstallLoader, getReady, pickModsFolder, useSetup } from "../../lib/setup";
import "./downloads.css";
import { LazyImg } from "../../ui/LazyImg";
import { notesText } from "../../lib/notes";

const ALL_KEY = "gm.downloads.all";
const readAll = () => { try { return localStorage.getItem(ALL_KEY) === "1"; } catch { return false; } };

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
  const route = useRoute();
  const snap = useQueue();
  const speeds = useSpeeds(snap);
  const setup = useSetup();
  const [busy, setBusy] = useState(false);
  const [allPref, setAllPref] = useState(readAll);
  const all = route.tab === "all" || allPref || !game;
  const setAll = (v: boolean) => {
    setAllPref(v);
    try { localStorage.setItem(ALL_KEY, v ? "1" : "0"); } catch { /* storage off */ }
    if (route.tab === "all" && !v) patchRoute({ tab: undefined });
  };

  const act = (job: () => Promise<unknown>) => { job().catch((e) => toast(errorText(e), true)); };
  const mine = all ? snap.items : snap.items.filter((i) => i.req.game === game?.id);
  const elsewhere = snap.items.length - mine.length;
  const active = mine.filter((i) => !finished(i));
  const done = mine.filter(finished).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));

  const addFiles = async () => {
    if (!game) return;
    setBusy(true);
    try {
      const paths = await dialogs.pickFiles({ title: "Pick mod archives", extensions: ["zip", "7z", "rar"], multiple: true });
      if (!paths) { if (!("__TAURI_INTERNALS__" in window)) toast("Picking files works in the app. Drop archives on the window there"); return; }
      const o = await installs.local(game.id, paths);
      toast(o.notes.length ? notesText(o.notes) : `Installing ${plural(paths.length, "mod")}`);
    } catch (e) { toast(errorText(e), true); }
    finally { setBusy(false); }
  };

  const gameName = (id: string) => games.find((g) => g.id === id)?.short ?? id;
  /** The game a failed download had nowhere to go in (no Mods folder yet), or null. */
  const noFolder = (i: QueueItem) => { const g = games.find((x) => x.id === i.req.game); return g && !g.modsDir ? g : null; };
  const row = (i: QueueItem) => {
    const thumb = fileUrl(i.req.thumb ?? i.req.meta.previewUrl ?? null);
    const name = i.req.meta.name || i.req.fileName || "Mod";
    const other = !!game && i.req.game !== game.id;
    const speed = speeds.get(i.id);
    const progress = i.state === "downloading" && i.total ? i.received / i.total : null;
    return (
      <li key={i.id} className={`dl-item is-${i.state}`}>
        <span className="dl-thumb">
          {thumb ? <LazyImg src={thumb} alt="" decoding="async" onError={(e) => { e.currentTarget.style.display = "none"; }} />
            : <Icon name={i.req.localPath ? "folder" : "package"} />}
        </span>
        <div className="dl-main">
          <div className="dl-name">
            {i.req.gbModId > 0 && !other
              ? <button type="button" className="dl-t dl-t-link" title={`${i.req.fileName}. Open its GameBanana page`} onClick={() => go({ view: "downloads", tab: route.tab, modId: i.req.gbModId })}>{name}</button>
              : <span className="dl-t" title={i.req.fileName}>{name}</span>}
            {i.req.meta.character && (other ? <span className="dl-c">{i.req.meta.character}</span> : <CharLink game={i.req.game} name={i.req.meta.character} className="dl-c" />)}
            {other && !all && <Badge title="Installs into this game">{gameName(i.req.game)}</Badge>}
            {i.req.meta.replaces && <Badge tone="accent" icon="update">Update</Badge>}
          </div>
          <div className={`dl-line hint${i.state === "failed" ? " dl-bad" : ""}`}>{stateLine(i, speed)}</div>
          {(i.state === "downloading" || i.state === "installing") && <Progress value={progress} label={`${name}: ${stateLine(i, speed)}`} />}
        </div>
        <div className="dl-act">
          {i.state === "needsChoice" && <Button variant="primary" size="sm" icon="layers" onClick={() => openVariantPicker(i.id)} title="This download has more than one version. Pick the ones to install">Pick</Button>}
          {i.state === "done" && i.modIds?.[0] && (
            <Button size="sm" icon="mods" onClick={() => go({ view: "library", modId: i.modIds[0] })} disabled={other}
              title={other ? `Switch to ${gameName(i.req.game)} to see it` : "Open it in Mods"}>Show in Mods</Button>
          )}
          {(i.state === "failed" || i.state === "cancelled") && (noFolder(i)
            ? <>
                <Button size="sm" variant="primary" icon={canInstallLoader(noFolder(i)!) ? "install" : "search"} busy={setup.running}
                  title={canInstallLoader(noFolder(i)!) ? `Installs XXMI Launcher and ${noFolder(i)!.short}'s mod loader, then installs this mod` : `Looks for ${noFolder(i)!.short}'s Mods folder again, then installs this mod`}
                  onClick={() => void getReady(i.req.game).then((ok) => { if (ok) act(() => queue.retry(i.id)); })}>
                  {canInstallLoader(noFolder(i)!) ? "Install mod loader" : "Find Mods folder"}
                </Button>
                <Button size="sm" icon="folder" title={`Pick ${noFolder(i)!.short}'s Mods folder yourself, then install this mod`}
                  onClick={() => void pickModsFolder(i.req.game).then((ok) => { if (ok) act(() => queue.retry(i.id)); })}>Pick folder</Button>
              </>
            : <Button size="sm" icon="refresh" onClick={() => act(() => queue.retry(i.id))}>Retry</Button>)}
          {!finished(i) && i.state !== "installing" && <IconButton icon="x" label="Cancel" onClick={() => act(() => queue.cancel(i.id))} />}
          {finished(i) && <IconButton icon="x" label="Clear from list" title="Clear from list. The mod stays installed" onClick={() => act(() => queue.remove(i.id))} />}
        </div>
      </li>
    );
  };

  /** Rows, with a heading per game when showing every game. */
  const list = (items: QueueItem[]) => {
    const ids = [...new Set(items.map((i) => i.req.game))];
    if (!all || ids.length < 2) return <ul className="dl-list">{items.map(row)}</ul>;
    ids.sort((a, b) => (a === game?.id ? -1 : b === game?.id ? 1 : gameName(a).localeCompare(gameName(b))));
    return ids.map((g) => (
      <div key={g} className="dl-group">
        <h4 className="dl-group-h">{games.find((x) => x.id === g)?.name ?? g}</h4>
        <ul className="dl-list">{items.filter((i) => i.req.game === g).map(row)}</ul>
      </div>
    ));
  };

  const running = active.filter((i) => i.state === "downloading" || i.state === "installing").length;
  const waiting = active.filter((i) => i.state === "waiting").length;
  const sub = running + waiting > 0 ? `${running} running, ${waiting} waiting` : "Mods you install from Browse, links and dropped files show up here";
  const clearFinished = () => act(() => (all ? queue.clearFinished() : Promise.all(done.map((i) => queue.remove(i.id)))));
  return (
    <div className="page dl-page">
      <PageHeader title="Downloads" icon="downloads" sub={sub}
        actions={<>
          <span title="A mod turns on as soon as it installs, and its character's other skin turns off. Also in Settings, Mods and downloads"><EnableNewSwitch size="sm" label="Turn on new mods" /></span>
          {game && <span title="Show the downloads of every game, grouped by game"><Toggle size="sm" checked={all} onChange={setAll} label="All games" /></span>}
          <Button icon="import" busy={busy} disabled={!game} onClick={() => void addFiles()} title="Install .zip, .7z or .rar files from this PC (or drop them on the window)">Install from files</Button>
          <Button variant="ghost" icon="trash" disabled={!done.length} title={all ? "Clear every finished download" : `Clear ${game?.short ?? "this game"}'s finished downloads`}
            onClick={clearFinished}>Clear finished</Button>
          <IconButton icon="settings" label="Download settings (Settings, Downloads and installing)" onClick={() => go({ view: "settings", section: "set-archives" })} />
        </>} />
      {mine.length === 0 ? (
        <Empty icon="downloads" title={elsewhere ? `Nothing downloading for ${game?.short ?? "this game"}` : "Nothing downloading"}
          actions={<>
            <Button variant="primary" icon="browse" onClick={() => go("browse")}>Browse mods</Button>
            {elsewhere > 0 && <Button icon="layers" onClick={() => setAll(true)}>Show all games ({elsewhere})</Button>}
          </>}>
          Install a mod from Browse, open a GameBanana link, or drop an archive or folder on the window.
        </Empty>
      ) : (
        <>
          {active.length > 0 && <Panel title="In progress" icon="downloads" count={active.length} className="dl-panel">{list(active)}</Panel>}
          {done.length > 0 && <Panel title="Finished" icon="check" count={done.length} className="dl-panel">{list(done)}</Panel>}
          {!all && elsewhere > 0 && (
            <p className="hint dl-elsewhere">{plural(elsewhere, "download")} for other games. <button type="button" className="dl-more" onClick={() => setAll(true)}>Show all games</button></p>
          )}
        </>
      )}
    </div>
  );
}
