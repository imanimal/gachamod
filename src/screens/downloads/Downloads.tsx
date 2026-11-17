// Downloads: the queue of GameBanana files and local installs, with progress, speed and time left. Shows the current
// game's downloads; "All games" (remembered, or route tab "all") shows every game's, grouped by game.
// Arrow keys move between rows, Enter does a row's main action, Delete cancels or clears it, and each row has a
// right-click menu. Rows are memo components: a progress event redraws only the row that moved.
// Owner: BROWSE area (docs/spec.md, "Downloads and Browse").
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { Badge, Button, Empty, IconButton, PageHeader, Progress, Spinner, Toggle, formatBytes, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { CharLink } from "../../ui/Links";
import { menuFor, menuHandler, type MenuEntry } from "../../ui/ContextMenu";
import { retoast, toast } from "../../ui/toast";
import { about, dialogs, errorText, fileUrl, installs, queue, shell, type ModEntry, type QueueItem, type QueueSnapshot } from "../../lib/api";
import { go, patchRoute, setGame, useGame, useGames, useRoute } from "../../lib/store";
import { useQueueState } from "../browse/useQueue";
import { openVariantPicker } from "../browse/cardQueue";
import { copyText, openExternal } from "../browse/actions";
import { EnableNewSwitch } from "../settings/Sections";
import { keepArchivesPref, otherServersPref } from "../settings/automatic";
import { canInstallLoader, getReady, pickModsFolder, useSetup } from "../../lib/setup";
import { moveInGrid } from "../library/gridNav";
import "./downloads.css";
import { LazyImg } from "../../ui/LazyImg";
import { notesText } from "../../lib/notes";
import { record } from "../../lib/history";
import { BatchHead, InstalledList, ModSwitch, ModsToggle, batches, modsOf, useInstalledState } from "./Batches";
import { isNotice, isSeen, markSeen, unseen, useSeen } from "./seen";
import { gameName as gameTitle, gameShort as shortName } from "../../lib/games";
import { t, tb, tn } from "../../lib/i18n";

const ALL_KEY = "gm.downloads.all";
const readAll = () => { try { return localStorage.getItem(ALL_KEY) === "1"; } catch { return false; } };

const finished = (i: QueueItem) => i.state === "done" || i.state === "failed" || i.state === "cancelled";

/** Bytes per second per downloading item, a moving average over the last few seconds of progress events, and since
 *  when each one has had no new bytes (for "No data for 14 s"). */
function useSpeeds(snap: QueueSnapshot): { speeds: Map<number, number>; quietSince: Map<number, number> } {
  const samples = useRef(new Map<number, Array<{ t: number; b: number }>>());
  const quiet = useRef(new Map<number, number>());
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
      if (!last || last.b !== i.received) { list.push({ t: now, b: i.received }); quiet.current.set(i.id, now); }
      while (list.length > 2 && now - list[0]!.t > 6000) list.shift();
      samples.current.set(i.id, list);
      const first = list[0]!, end = list[list.length - 1]!;
      const dt = (end.t - first.t) / 1000;
      if (list.length >= 2 && dt > 0.4) next.set(i.id, Math.max(0, (end.b - first.b) / dt));
    }
    for (const id of [...samples.current.keys()]) if (!live.has(id)) { samples.current.delete(id); quiet.current.delete(id); }
    // the same speeds keep the same Map, so a snapshot doesn't render the page twice
    setSpeeds((was) => (was.size === next.size && [...next].every(([id, v]) => was.get(id) === v) ? was : next));
  }, [snap]);
  return { speeds, quietSince: quiet.current };
}

/** Re-render every second while something downloads, so a download with no new bytes counts up how long. */
function useTicking(on: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!on) return;
    const timer = window.setInterval(() => setT((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [on]);
}

/** How long a failure or pending choice has to be on screen before it counts as seen. */
const SEEN_AFTER = 5000;

/** Marks a highlighted row seen once most of it has been on screen for SEEN_AFTER while the window shows (rows
 *  scrolled out of view and time spent minimised don't count). Returns the ref for those rows (data-dl-id). */
function useSeenOnScreen(items: QueueItem[]) {
  const byId = useRef(new Map<number, QueueItem>());
  byId.current = new Map(items.map((i) => [i.id, i]));
  const timers = useRef(new Map<Element, number>());
  const watched = useRef(new Set<Element>());
  const [obs] = useState(() => typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
    for (const e of entries) {
      const timer = timers.current.get(e.target);
      if (e.isIntersecting && document.visibilityState === "visible") {
        if (timer !== undefined) continue;
        timers.current.set(e.target, window.setTimeout(() => {
          timers.current.delete(e.target);
          const it = byId.current.get(Number((e.target as HTMLElement).dataset.dlId));
          if (it && e.target.isConnected) markSeen([it]);
        }, SEEN_AFTER));
      } else if (timer !== undefined) { window.clearTimeout(timer); timers.current.delete(e.target); }
    }
  }, { threshold: 0.6 }));
  useEffect(() => {
    // hidden: stop every count; shown again: look at what is on screen now
    const h = () => {
      timers.current.forEach((x) => window.clearTimeout(x));
      timers.current.clear();
      if (document.visibilityState === "visible" && obs) for (const el of watched.current) { obs.unobserve(el); if (el.isConnected) obs.observe(el); }
    };
    document.addEventListener("visibilitychange", h);
    return () => {
      document.removeEventListener("visibilitychange", h);
      obs?.disconnect();
      timers.current.forEach((x) => window.clearTimeout(x));
    };
  }, [obs]);
  return (el: HTMLElement | null) => {
    if (!el || !obs || watched.current.has(el)) return;
    for (const old of watched.current) if (!old.isConnected) { obs.unobserve(old); watched.current.delete(old); }
    watched.current.add(el);
    obs.observe(el);
  };
}

// Rows being cleared: hidden at once, removed from the queue once the Undo toast has had its time.
const clearing = new Set<number>();
const clearSubs = new Set<() => void>();
let clearVer = 0;
const clearEmit = () => { clearVer++; clearSubs.forEach((f) => f()); };
const useClearing = () => useSyncExternalStore((f) => { clearSubs.add(f); return () => { clearSubs.delete(f); }; }, () => clearVer);
const CLEAR_AFTER = 9500;

/** Clear finished rows from the list, with Undo. The mods stay installed. */
function clearRows(items: QueueItem[]) {
  const ids = items.map((i) => i.id).filter((id) => !clearing.has(id));
  if (!ids.length) return;
  ids.forEach((id) => clearing.add(id));
  clearEmit();
  const one = ids.length === 1 ? items.find((i) => i.id === ids[0])?.req.meta.name : undefined;
  const timer = window.setTimeout(() => {
    void Promise.all(ids.map((id) => queue.remove(id)))
      .catch((e) => toast(errorText(e), true))
      .finally(() => { ids.forEach((id) => clearing.delete(id)); clearEmit(); });
  }, CLEAR_AFTER);
  const tid = toast(one ? t("Cleared {name} from the list", { name: one }) : tn(ids.length, "Cleared {n} download from the list", "Cleared {n} downloads from the list"), false, {
    label: t("Undo"),
    run: () => {
      window.clearTimeout(timer);
      ids.forEach((id) => clearing.delete(id));
      clearEmit();
      retoast(tid, one ? t("Put back {name}", { name: one }) : tn(ids.length, "Put back {n} download", "Put back {n} downloads"));
    },
  });
}

// Which bundles have their mod list open or closed, for the session.
const openedRows = new Map<number, boolean>();

/** What a waiting row waits behind: the downloads ahead of it, or the install that runs now. */
interface Ahead { downloading: number; installing: string | null }
const MAX_DOWNLOADS = 3;

function timeLeft(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return "";
  if (secs < 60) return t("{n} s left", { n: Math.max(1, Math.round(secs)) });
  if (secs < 3600) return t("{n} min left", { n: Math.round(secs / 60) });
  return t("{n} h left", { n: Math.round(secs / 360) / 10 });
}

function stateLine(i: QueueItem, speed: number | undefined, ahead: Ahead, quietSecs: number, moveSlow: boolean): string {
  // the backend writes its steps in English
  const note = i.progress?.step ? tb(i.progress.step) : undefined;
  switch (i.state) {
    case "waiting":
      if (i.archive || i.req.localPath) return ahead.installing ? t("Waiting for {name} to finish installing", { name: ahead.installing }) : t("Waiting to install");
      return ahead.downloading >= MAX_DOWNLOADS ? t("Waiting for a free slot. {n} files download at a time", { n: MAX_DOWNLOADS }) : t("Waiting to download");
    case "downloading": {
      if (!i.received) return note || t("Connecting to GameBanana");
      const parts = [i.total ? t("{done} of {total}", { done: formatBytes(i.received), total: formatBytes(i.total) }) : formatBytes(i.received)];
      if (speed) parts.push(t("{size}/s", { size: formatBytes(speed) }));
      if (speed && i.total) { const left = timeLeft((i.total - i.received) / speed); if (left) parts.push(left); }
      if (note) parts.push(note);
      else if (quietSecs >= 10) parts.push(moveSlow
        ? t("No data for {n} s. GameBanana's server may be busy; gachamod moves to another one if it stays slow", { n: quietSecs })
        : t("No data for {n} s. GameBanana's server may be busy", { n: quietSecs }));
      return parts.join(" · ");
    }
    case "installing": return note || t("Getting ready to unpack");
    case "needsChoice": return tn(i.candidates.length, "{n} mod inside. Pick which to install", "{n} mods inside. Pick which to install");
    case "done": {
      const n = i.modIds?.length ?? 0;
      if (n > 1) return i.finishedAt ? t("Installed {n} mods {ago}", { n, ago: timeAgo(i.finishedAt) }) : t("Installed {n} mods", { n });
      return i.finishedAt ? t("Installed {ago}", { ago: timeAgo(i.finishedAt) }) : t("Installed");
    }
    case "failed": return tb(i.message);
    case "cancelled": return t("Cancelled");
  }
}

/** A row's main action (Enter) and its Delete action. */
interface RowKeys { primary?: () => void; del?: () => void }

type Game = ReturnType<typeof useGames>[number];

const act = (job: () => Promise<unknown>) => { job().catch((e) => toast(errorText(e), true)); };
/** The downloaded archive (or the file picked on this PC), when it is kept. */
const fileOf = (i: QueueItem) => i.archive || i.req.localPath || null;
const gbUrl = (i: QueueItem) => i.req.meta.source?.url || `https://gamebanana.com/mods/${i.req.gbModId}`;
/** Install a removed mod again from where it came from. */
const reinstall = (i: QueueItem) => act(async () => {
  await queue.add({ ...i.req, meta: { ...i.req.meta, replaces: null } });
  const name = i.req.meta.name || i.req.fileName;
  toast(name ? t("Installing {name} again", { name }) : t("Installing it again"));
});
/** Get the game ready (mod loader or Mods folder), then retry. */
const fixFolder = (i: QueueItem) => void getReady(i.req.game).then((ok) => { if (ok) act(() => queue.retry(i.id)); });

/** What a row needs from the page that changes with it. Held in a ref, so passing it never redraws a row. */
interface RowCtx {
  showInMods: (game: QueueItem["req"]["game"], modId: string) => void;
  showTrash: (game: QueueItem["req"]["game"]) => void;
  openPage: (i: QueueItem) => void;
  flip: (i: QueueItem) => void;
  see: (i: QueueItem) => void;
  focused: (id: number) => void;
  watchSeen: (el: HTMLElement | null) => void;
  rowKeys: Map<number, RowKeys>;
}

interface RowProps {
  i: QueueItem;
  ctx: RefObject<RowCtx>;
  fresh: boolean;
  /** This row is the list's one Tab stop. */
  tabStop: boolean;
  open: boolean;
  speed: number | undefined;
  quietSecs: number;
  aheadDownloading: number;
  aheadInstalling: string | null;
  moveSlow: boolean;
  /** Belongs to another game than the current one. */
  other: boolean;
  all: boolean;
  gameShort: string;
  /** The game a failed row had nowhere to go in (no Mods folder yet). */
  nf: Game | null;
  setupRunning: boolean;
  installed: Map<string, ModEntry>;
  /** Its game's mod list has loaded, so a missing mod was removed rather than not read yet. */
  loaded: boolean;
}

const DlRow = memo(function DlRow({ i, ctx, fresh, tabStop, open, speed, quietSecs, aheadDownloading, aheadInstalling, moveSlow, other, all, gameShort: short, nf, setupRunning, installed, loaded }: RowProps) {
  const c = ctx.current!;
  const thumb = fileUrl(i.req.thumb ?? i.req.meta.previewUrl ?? null);
  const name = i.req.meta.name || i.req.fileName || t("Mod");
  const p = i.state === "installing" ? i.progress : null;
  const progress = i.state === "downloading" && i.total ? i.received / i.total : p && p.total > 0 ? p.done / p.total : null;
  const mods = useMemo(() => modsOf(i, installed), [i, installed]);
  const gone = i.state === "done" && loaded ? (i.modIds?.length ?? 0) - mods.length : 0;
  const removed = gone > 0 && mods.length === 0;
  const canReinstall = i.req.gbModId > 0 || !!i.req.localPath;
  let line = stateLine(i, speed, { downloading: aheadDownloading, installing: aheadInstalling }, quietSecs, moveSlow);
  if (removed) line = gone > 1 ? t("{line}. They were removed since", { line }) : t("{line}. It was removed since", { line });
  else if (gone > 0) line = tn(gone, "{line}. {n} of them was removed since", "{line}. {n} of them were removed since", { line });
  const slowOff = quietSecs >= 10 && !moveSlow && !i.progress?.step;
  const failed = i.state === "failed" || i.state === "cancelled";
  const fixable = failed ? nf : null;
  const gb = i.req.gbModId > 0;
  const file = fileOf(i);
  const openPage = () => c.openPage(i);
  // the .part stays, so Undo (or Retry) carries on where it stopped
  const cancel = () => act(async () => {
    await queue.cancel(i.id);
    const what = i.req.meta.name || i.req.fileName;
    record({ label: what ? t("Cancelled {name}", { name: what }) : t("Cancelled the download"), undo: () => queue.retry(i.id), redo: () => queue.cancel(i.id) });
  });
  const clear = () => clearRows([i]);

  // Enter: the row's main action; Delete: cancel or clear
  const primary = i.state === "needsChoice" ? () => openVariantPicker(i.id)
    : i.state === "done" && mods[0] ? () => c.showInMods(i.req.game, mods[0]!.id)
    : removed ? () => c.showTrash(i.req.game)
    : failed ? (fixable ? () => fixFolder(i) : () => act(() => queue.retry(i.id)))
    : gb && !other ? openPage : undefined;
  c.rowKeys.set(i.id, { primary, del: finished(i) ? clear : i.state !== "installing" ? cancel : undefined });

  const menu = (): MenuEntry[] => {
    const list: MenuEntry[] = [
      i.state === "needsChoice" && { label: t("Pick mods to install"), icon: "layers", keys: "Enter", onClick: () => openVariantPicker(i.id) },
      i.state === "done" && mods[0] && { label: t("Show in Mods"), icon: "mods", keys: "Enter", onClick: () => c.showInMods(i.req.game, mods[0]!.id) },
      removed && { label: t("View trash"), icon: "trash", keys: "Enter", title: t("Open Mods, Trash, to put it back"), onClick: () => c.showTrash(i.req.game) },
      removed && canReinstall && { label: t("Reinstall"), icon: "install", onClick: () => reinstall(i) },
      failed && fixable && { label: canInstallLoader(fixable) ? t("Install mod loader") : t("Find Mods folder"), icon: canInstallLoader(fixable) ? "install" : "search", keys: "Enter", onClick: () => fixFolder(i) },
      failed && fixable && { label: t("Pick folder"), icon: "folder", onClick: () => void pickModsFolder(i.req.game).then((ok) => { if (ok) act(() => queue.retry(i.id)); }) },
      failed && !fixable && { label: t("Retry"), icon: "refresh", keys: "Enter", onClick: () => act(() => queue.retry(i.id)) },
      !!file && { label: t("Show file"), icon: "folder", onClick: () => act(() => shell.revealPath(file)) },
      "-",
      gb && !other && { label: t("Open mod page"), icon: "browse", keys: primary === openPage ? "Enter" : undefined, onClick: openPage },
      gb && { label: t("Open on GameBanana"), icon: "external", onClick: () => openExternal(gbUrl(i)) },
      gb && { label: t("Copy link"), icon: "link", onClick: () => copyText(gbUrl(i), t("Copied the link")) },
      "-",
      !finished(i) && i.state !== "installing" && { label: t("Cancel"), icon: "x", keys: "Del", onClick: cancel },
      i.state === "installing" && { label: t("Cancel"), icon: "x", disabled: true, title: t("It's being installed right now and will be done in a moment") },
      finished(i) && { label: t("Clear from list"), icon: "x", keys: "Del", title: t("The mod stays installed"), onClick: clear },
    ];
    // a finished one-mod row also gets that mod's own menu
    if (i.state === "done" && mods.length === 1) list.push("-", { header: mods[0]!.name }, ...menuFor("mod", { game: i.req.game, mod: mods[0]! }));
    return list;
  };

  return (
    <li data-dl-id={i.id} ref={fresh ? c.watchSeen : undefined} tabIndex={tabStop ? 0 : -1}
      className={`dl-item is-${i.state}${fresh ? " is-new" : ""}`}
      onMouseEnter={() => c.see(i)} onFocus={() => { c.see(i); c.focused(i.id); }} onPointerDown={() => c.see(i)}
      onContextMenu={menuHandler(menu)}>
      <span className="dl-thumb">
        {thumb ? <LazyImg src={thumb} alt="" decoding="async" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          : <Icon name={i.req.localPath ? "folder" : "package"} />}
      </span>
      <div className="dl-main">
        <div className="dl-name">
          {gb && !other
            ? <button type="button" className="dl-t dl-t-link" tabIndex={-1} title={t("{file}. Open its GameBanana page", { file: i.req.fileName })} onClick={openPage}>{name}</button>
            : <span className="dl-t" title={i.req.fileName}>{name}</span>}
          {i.req.meta.character && (other ? <span className="dl-c">{i.req.meta.character}</span> : <CharLink game={i.req.game} name={i.req.meta.character} className="dl-c" />)}
          {other && !all && <Badge title={t("Installs into {game}. Click to switch to it", { game: short })} onClick={() => setGame(i.req.game)}>{short}</Badge>}
          {i.req.meta.replaces && (
            <Badge tone="accent" icon="update" title={t("Updates a mod you have. Click to open it in Mods")}
              onClick={() => c.showInMods(i.req.game, i.req.meta.replaces!)}>{t("Update")}</Badge>
          )}
          {i.state === "done" && i.unsure && (
            <Badge tone="warn" icon="warn" title={t("{note}. Click to see the files", { note: tb(i.unsure) })}
              onClick={() => { const at = mods[0]?.path ?? file; if (at) act(() => mods[0] ? shell.openPath(at) : shell.revealPath(at)); }}>{t("Check files")}</Badge>
          )}
        </div>
        <div className={`dl-line hint${i.state === "failed" ? " dl-bad" : ""}`}>
          {line}
          {slowOff && <> <button type="button" className="dl-more" title={t("Open the setting that moves slow downloads to another of GameBanana's servers")}
            onClick={() => go({ view: "settings", section: "set-other-servers" })}>{t("Move slow downloads")}</button></>}
        </div>
        {(i.state === "downloading" || i.state === "installing") && <Progress value={progress} label={t("{name}: {status}", { name, status: line })} />}
        {p && p.mods.length > 1 && (
          <ul className="dl-mods" aria-label={tn(p.mods.length, "{n} mod found inside", "{n} mods found inside")}>
            {p.mods.map((m, n) => (
              <li key={n} className={n < p.placed ? "is-in" : n === p.placed ? "is-now" : undefined}
                title={n < p.placed ? t("Installed") : n === p.placed ? t("Installing now") : t("Waiting its turn")}>
                {n < p.placed ? <Icon name="check" /> : n === p.placed ? <Spinner size={12} /> : <span className="dl-mods-dot" />}
                <span>{m}</span>
              </li>
            ))}
          </ul>
        )}
        {mods.length > 1 && open && <InstalledList mods={mods} all={installed} gone={0} />}
      </div>
      <div className="dl-act">
        {mods.length > 1 && <ModsToggle mods={mods} open={open} onToggle={() => c.flip(i)} />}
        {mods.length === 1 && <ModSwitch mod={mods[0]!} all={installed} />}
        {i.state === "needsChoice" && <Button variant="primary" size="sm" icon="layers" onClick={() => openVariantPicker(i.id)} title={t("This download has more than one version. Pick the ones to install (Enter)")}>{t("Pick")}</Button>}
        {i.state === "done" && mods[0] && (
          <Button size="sm" icon="mods" onClick={() => c.showInMods(i.req.game, mods[0]!.id)}
            title={other ? t("Switch to {game} and open it in Mods (Enter)", { game: short }) : t("Open it in Mods (Enter)")}>{t("Show in Mods")}</Button>
        )}
        {removed && <Button size="sm" icon="trash" onClick={() => c.showTrash(i.req.game)} title={t("Open Mods, Trash, where you can put it back (Enter)")}>{t("View trash")}</Button>}
        {removed && canReinstall && <Button size="sm" icon="install" onClick={() => reinstall(i)} title={gb ? t("Download it from GameBanana and install it again") : t("Install it again from the same file")}>{t("Reinstall")}</Button>}
        {failed && (fixable
          ? <>
              <Button size="sm" variant="primary" icon={canInstallLoader(fixable) ? "install" : "search"} busy={setupRunning}
                title={canInstallLoader(fixable) ? t("Installs XXMI Launcher and {game}'s mod loader, then installs this mod (Enter)", { game: shortName(fixable) }) : t("Looks for {game}'s Mods folder again, then installs this mod (Enter)", { game: shortName(fixable) })}
                onClick={() => fixFolder(i)}>
                {canInstallLoader(fixable) ? t("Install mod loader") : t("Find Mods folder")}
              </Button>
              <Button size="sm" icon="folder" title={t("Pick {game}'s Mods folder yourself, then install this mod", { game: shortName(fixable) })}
                onClick={() => void pickModsFolder(i.req.game).then((ok) => { if (ok) act(() => queue.retry(i.id)); })}>{t("Pick folder")}</Button>
            </>
          : <Button size="sm" icon="refresh" title={t("Try this download again (Enter)")} onClick={() => act(() => queue.retry(i.id))}>{t("Retry")}</Button>)}
        {failed && file && (
          <Button size="sm" icon="folder" title={i.req.fileName ? t("Show {file} in File Explorer, to place its files yourself", { file: i.req.fileName }) : t("Show the file in File Explorer, to place its files yourself")}
            onClick={() => act(() => shell.revealPath(file))}>{t("Show file")}</Button>
        )}
        {i.state === "done" && file && <IconButton icon="folder" label={t("Show file")} title={i.req.fileName ? t("Show {file} in File Explorer", { file: i.req.fileName }) : t("Show the downloaded file in File Explorer")} onClick={() => act(() => shell.revealPath(file))} />}
        {!finished(i) && i.state !== "installing" && <IconButton icon="x" label={t("Cancel")} title={t("Cancel (Delete)")} onClick={cancel} />}
        {i.state === "installing" && (
          <span title={t("It's being installed right now and will be done in a moment")}><IconButton icon="x" label={t("Cancel")} title="" disabled /></span>
        )}
        {finished(i) && <IconButton icon="x" label={t("Clear from list")} title={t("Clear from list (Delete). The mod stays installed")} onClick={clear} />}
      </div>
    </li>
  );
});

export function Downloads() {
  const game = useGame();
  const games = useGames();
  const route = useRoute();
  const { snap, error, loading, reload } = useQueueState();
  const { speeds, quietSince } = useSpeeds(snap);
  useTicking(snap.items.some((i) => i.state === "downloading"));
  const moveSlow = otherServersPref.use();
  const keepArchives = keepArchivesPref.use();
  const aheadDownloading = snap.items.filter((i) => i.state === "downloading").length;
  const aheadInstalling = (() => { const x = snap.items.find((i) => i.state === "installing"); return x ? x.req.meta.name || x.req.fileName || t("another mod") : null; })();
  const setup = useSetup();
  const [busy, setBusy] = useState(false);
  const [allPref, setAllPref] = useState(readAll);
  const all = route.tab === "all" || allPref || !game;
  const setAll = (v: boolean) => {
    setAllPref(v);
    try { localStorage.setItem(ALL_KEY, v ? "1" : "0"); } catch { /* storage off */ }
    if (route.tab === "all" && !v) patchRoute({ tab: undefined });
  };

  useClearing();
  const items = snap.items.filter((i) => !clearing.has(i.id));
  const mine = all ? items : items.filter((i) => i.req.game === game?.id);
  const elsewhere = items.length - mine.length;
  // failures and choices not looked at yet: highlighted until hovered, focused, clicked or on screen a few seconds
  const seen = useSeen();
  const watchSeen = useSeenOnScreen(mine);
  const fresh = (i: QueueItem) => isNotice(i) && !isSeen(i, seen);
  const failedElsewhere = all ? 0 : unseen(items.filter((i) => i.req.game !== game?.id), seen).filter((i) => i.state === "failed").length;
  const active = mine.filter((i) => !finished(i));
  const done = mine.filter(finished).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  const { byId: installed, loaded } = useInstalledState(done.filter((i) => i.state === "done").map((i) => i.req.game));
  // a row's mod list: what the user chose this session, else open for a bundle that finished in the last quarter hour
  const [, bump] = useState(0);
  const isOpen = (i: QueueItem) => openedRows.get(i.id) ?? (!!i.finishedAt && Date.now() / 1000 - i.finishedAt < 15 * 60);

  const addFiles = async () => {
    if (!game) return;
    setBusy(true);
    try {
      const paths = await dialogs.pickFiles({ title: t("Pick mod archives"), extensions: ["zip", "7z", "rar"], multiple: true });
      if (!paths) { if (!("__TAURI_INTERNALS__" in window)) toast(t("Picking files works in the app. Drop archives on the window there")); return; }
      const o = await installs.local(game.id, paths);
      toast(o.notes.length ? notesText(o.notes) : tn(paths.length, "Installing {n} mod", "Installing {n} mods"));
    } catch (e) { toast(errorText(e), true); }
    finally { setBusy(false); }
  };

  /** The folder gachamod downloads archives into: this game's, else the whole downloads folder. */
  const openDownloadsFolder = () => act(async () => {
    const dir = await about.dataDir();
    const sep = dir.includes("\\") ? "\\" : "/";
    const base = `${dir}${sep}downloads`;
    const tries = [...(game && !all ? [`${base}${sep}${game.id}`] : []), base, dir];
    for (const p of tries) { try { await shell.openPath(p); return; } catch { /* not made yet, try the one above */ } }
  });

  const gameName = (id: string) => { const g = games.find((x) => x.id === id); return g ? shortName(g) : id; };
  /** The game a failed download had nowhere to go in (no Mods folder yet), or null. */
  const noFolder = (i: QueueItem) => { const g = games.find((x) => x.id === i.req.game); return g && !g.modsDir ? g : null; };
  /** Failed rows a plain Retry can help (not the ones still missing a Mods folder). */
  const retryable = (list: QueueItem[]) => list.filter((i) => i.state === "failed" && !noFolder(i));
  const retryAll = (list: QueueItem[]) => act(() => Promise.all(retryable(list).map((i) => queue.retry(i.id))));

  // keyboard: Enter and Delete per row, the arrows between rows (one Tab stop for the whole list)
  const pageRef = useRef<HTMLDivElement>(null);
  const [lastRow, setLastRow] = useState<number | null>(null);
  // one object for the page's life, refreshed each render, so a memo row's handlers always reach the latest page
  const ctx = useRef<RowCtx>({ rowKeys: new Map<number, RowKeys>() } as RowCtx);
  Object.assign(ctx.current, {
    /** Open a mod in Mods, switching to its game first when it's another one (like the install toast's Open). */
    showInMods: (gameId, modId) => { if (game?.id !== gameId) setGame(gameId); go({ view: "library", modId }); },
    showTrash: (gameId) => { if (game?.id !== gameId) setGame(gameId); go({ view: "library", tab: "archive" }); },
    openPage: (i) => go({ view: "downloads", tab: route.tab, modId: i.req.gbModId }),
    flip: (i) => { openedRows.set(i.id, !isOpen(i)); bump((n) => n + 1); },
    see: (i) => { if (fresh(i)) markSeen([i]); },
    focused: (id) => setLastRow(id),
    watchSeen,
  } satisfies Omit<RowCtx, "rowKeys">);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (el.closest("input, textarea, select, [contenteditable='true']")) return;
    const rowEl = el.closest<HTMLElement>(".dl-item");
    if (!rowEl || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Home" || e.key === "End") { moveInGrid(e, pageRef.current, ".dl-item"); return; }
    const keys = ctx.current.rowKeys.get(Number(rowEl.dataset.dlId));
    if (e.key === "Enter" && el === rowEl && keys?.primary) { e.preventDefault(); keys.primary(); }
    else if (e.key === "Delete" && keys?.del) { e.preventDefault(); keys.del(); }
  };

  /** Rows by game when showing every game (current game first), else one group. */
  const groups = (rows: QueueItem[]): Array<[string | null, QueueItem[]]> => {
    const ids = [...new Set(rows.map((i) => i.req.game))];
    if (!all || ids.length < 2) return [[null, rows]];
    ids.sort((a, b) => (a === game?.id ? -1 : b === game?.id ? 1 : gameName(a).localeCompare(gameName(b))));
    return ids.map((g) => [g, rows.filter((i) => i.req.game === g)]);
  };
  const activeGroups = groups(active);
  const doneGroups = groups(done).map(([g, rows]) => [g, batches(rows)] as const);
  // the list's one Tab stop: the row focused last, else the first row on the page
  const order = [...activeGroups.flatMap(([, r]) => r), ...doneGroups.flatMap(([, b]) => b.flat())].map((i) => i.id);
  const tabStop = lastRow !== null && order.includes(lastRow) ? lastRow : order[0];

  const row = (i: QueueItem) => {
    const since = quietSince.get(i.id);
    return (
      <DlRow key={i.id} i={i} ctx={ctx} fresh={fresh(i)} tabStop={i.id === tabStop} open={isOpen(i)}
        speed={speeds.get(i.id)}
        quietSecs={i.state === "downloading" && i.received && since ? Math.floor((performance.now() - since) / 1000) : 0}
        aheadDownloading={aheadDownloading} aheadInstalling={aheadInstalling} moveSlow={moveSlow}
        other={!!game && i.req.game !== game.id} all={all} gameShort={gameName(i.req.game)}
        nf={i.state === "failed" || i.state === "cancelled" ? noFolder(i) : null} setupRunning={setup.running}
        installed={installed} loaded={loaded.has(i.req.game)} />
    );
  };
  /** A finished batch (downloads that ran together) is a heading with its rows under it; a batch of one is its row. */
  const batchRows = (b: QueueItem[]) => b.length === 1 ? row(b[0]!) : (
    <li key={`b${b[0]!.id}`} className="dl-batch">
      <BatchHead items={b} all={installed} onClear={() => clearRows(b)}
        onRetry={retryable(b).length ? () => retryAll(b) : undefined} />
      <ul className="dl-list">{b.map(row)}</ul>
    </li>
  );
  const grouped = <T,>(list: ReadonlyArray<readonly [string | null, T[]]>, draw: (x: T) => ReactNode) => list.map(([g, xs]) => g === null
    ? <ul key="all" className="dl-list">{xs.map(draw)}</ul>
    : (
      <div key={g} className="dl-group">
        <h3 className="dl-group-h">{gameTitle(games.find((x) => x.id === g)) || g}</h3>
        <ul className="dl-list">{xs.map(draw)}</ul>
      </div>
    ));

  const running = active.filter((i) => i.state === "downloading" || i.state === "installing").length;
  const waiting = active.filter((i) => i.state === "waiting").length;
  const failedHere = done.filter((i) => i.state === "failed").length;
  const counts = [running && t("{n} running", { n: running }), waiting && t("{n} waiting", { n: waiting }), failedHere && t("{n} failed", { n: failedHere })].filter(Boolean);
  const sub = counts.length ? counts.join(", ") : t("Mods you install from Browse, links and dropped files show up here");
  const toRetry = retryable(done).length;
  return (
    <div className="page dl-page" ref={pageRef} onKeyDown={onKeyDown}>
      <PageHeader title={t("Downloads")} icon="downloads" sub={sub}
        actions={<>
          <span title={t("A mod turns on as soon as it installs, and its character's other skin turns off. Also in Settings, Mods")}><EnableNewSwitch size="sm" label={t("Turn on new mods")} /></span>
          {game && <span title={t("Show the downloads of every game, grouped by game")}><Toggle size="sm" checked={all} onChange={setAll} label={t("All games")} /></span>}
          <Button icon="import" busy={busy} disabled={!game} onClick={() => void addFiles()} title={t("Install .zip, .7z or .rar files from this PC (or drop them on the window)")}>{t("Install from files")}</Button>
          {toRetry > 0 && <Button icon="refresh" onClick={() => retryAll(done)} title={t("Try every failed download on this page again")}>{t("Retry failed ({n})", { n: toRetry })}</Button>}
          <Button variant="ghost" icon="trash" disabled={!done.length} title={all || !game ? t("Clear every finished download from the list. The mods stay installed") : t("Clear {game}'s finished downloads from the list. The mods stay installed", { game: shortName(game) })}
            onClick={() => clearRows(done)}>{t("Clear finished")}</Button>
          <IconButton icon="folder" label={t("Open the downloads folder")}
            title={keepArchives ? t("Open the downloads folder. Downloaded archives stay there after installing") : t("Open the downloads folder. Archives are deleted once they install, so it holds the ones that didn't")}
            onClick={openDownloadsFolder} />
          <IconButton icon="settings" label={t("Download settings (Settings, Downloads and installing)")} onClick={() => go({ view: "settings", section: "set-archives" })} />
        </>} />
      {error && !items.length ? (
        <Empty icon="warn" title={t("Couldn't read the download queue")}
          actions={<Button variant="primary" icon="refresh" busy={loading} onClick={reload}>{loading ? t("Reading the queue") : t("Try again")}</Button>}>
          {error}
        </Empty>
      ) : mine.length === 0 ? (
        <Empty icon="downloads" title={elsewhere && game ? t("Nothing downloading for {game}", { game: shortName(game) }) : t("Nothing downloading")}
          actions={<>
            <Button variant="primary" icon="browse" onClick={() => go("browse")}>{t("Browse mods")}</Button>
            {elsewhere > 0 && <Button icon="layers" onClick={() => setAll(true)}>{t("Show all games ({n})", { n: elsewhere })}</Button>}
          </>}>
          {t("Install a mod from Browse, open a GameBanana link, or drop an archive or folder on the window.")}
        </Empty>
      ) : (
        <>
          {active.length > 0 && (
            <section className="dl-sec" aria-label={t("In progress, {n}", { n: active.length })}>
              <h2 className="dl-sec-h">{t("In progress")} <span className="dl-sec-n">{active.length}</span></h2>
              {grouped(activeGroups, row)}
            </section>
          )}
          {done.length > 0 && (
            <section className="dl-sec" aria-label={t("Finished, {n}", { n: done.length })}>
              <h2 className="dl-sec-h">{t("Finished")} <span className="dl-sec-n">{done.length}</span></h2>
              {grouped(doneGroups, batchRows)}
            </section>
          )}
          {!all && elsewhere > 0 && (
            <p className="hint dl-elsewhere">{failedElsewhere
              ? tn(elsewhere, "{n} download for other games ({failed} failed).", "{n} downloads for other games ({failed} failed).", { failed: failedElsewhere })
              : tn(elsewhere, "{n} download for other games.", "{n} downloads for other games.")} <button type="button" className="dl-more" onClick={() => setAll(true)}>{t("Show all games")}</button></p>
          )}
        </>
      )}
    </div>
  );
}
