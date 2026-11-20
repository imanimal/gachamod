// Settings › Storage: where disk space goes. The total, a breakdown by category, game or character, the biggest mods,
// mods installed twice, the backups, and a few cleaning suggestions that show only when they would free a fair amount
// and stay hidden once dismissed (a button brings them back). Mod sizes come from the library at once; the rest is measured off the UI thread
// (gacha-core storage.rs) and can be skipped, starting when the page first shows (or a search draws a panel), not when
// Settings opens. The report lives for the session, and mod changes anywhere update it.
// Everything gachamod keeps has a row here with a size, what it is and a button that opens it; what gachamod can
// make again has a Clear, and the author's copies of changed mod files can be cleared after a question.
// Owner: SYSTEM area.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Badge, Button, Confirm, IconButton, Panel, Segmented, Select, Toggle, Waiting, formatBytes, timeAgo } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { Preview, useNsfwMode } from "../library/Preview";
import { about, backups, dev, errorText, library, shell, storage, type BackupEntry, type GameId, type ModEntry, type StorageCategory, type StorageClearKind, type StorageDuplicate, type StorageItem, type StorageMod, type StorageReport, type StorageStep } from "../../lib/api";
import { cacheBytes, cacheCount, clearCaches } from "../../lib/cacheKeys";
import { pref } from "../../lib/prefs";
import { SetRow } from "./parts";
import { held } from "../../lib/tauri";
import { allGames, emitApp, go, goIn, useGames } from "../../lib/store";
import { record } from "../../lib/history";
import { registerCommands } from "../../lib/search";
import { onPublish, publish, removeMods } from "../library/data";
import { gameName, gameShort } from "../../lib/games";
import { t, tb, tn } from "../../lib/i18n";
import "./storage.css";

// ── the report, shared by the page's panels for the session ──

interface State { report: StorageReport | null; measuring: boolean; step: StorageStep | null }
let state: State = { report: null, measuring: false, step: null };
const subs = new Set<() => void>();
const setState = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
const useStorage = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);
const patchReport = (f: (r: StorageReport) => StorageReport) => { if (state.report) setState({ report: f(state.report) }); };

let scope: GameId | "all" = "all";
const scopeSubs = new Set<() => void>();
const setScope = (s: GameId | "all") => { scope = s; scopeSubs.forEach((f) => f()); };
const useScope = () => useSyncExternalStore((f) => { scopeSubs.add(f); return () => scopeSubs.delete(f); }, () => scope);

let skipped = false;

// what the window keeps in saved page data (lib/cacheKeys.ts), shown as a row
let browserBytes = -1;
const browserSubs = new Set<() => void>();
const browserSnapshot = () => (browserBytes < 0 ? (browserBytes = cacheBytes()) : browserBytes);
const refreshBrowser = () => { browserBytes = cacheBytes(); browserSubs.forEach((f) => f()); };
const useBrowserBytes = () => useSyncExternalStore((f) => { browserSubs.add(f); return () => browserSubs.delete(f); }, browserSnapshot);

/** Thumbnails and .gachamod previews that were made a long time ago go at start (backend setting "storage.trim"). */
const trimPref = pref<boolean>("storage.trim", true, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));

/** Read the library's sizes at once, then measure everything else. One measure runs at a time. */
async function measure() {
  if (state.measuring) return;
  skipped = false;
  setState({ measuring: true, step: null });
  refreshBrowser();
  void loadBackups();
  const off = held(storage.onProgress((step) => setState({ step })));
  try {
    if (!state.report) setState({ report: await storage.measure(false) });
    // Skip pressed while the library was read: the full pass doesn't start
    if (!skipped) setState({ report: await storage.measure(true) });
  } catch (e) { toast(errorText(e), true); }
  finally { off(); setState({ measuring: false, step: null }); }
}

const skip = () => { skipped = true; storage.cancel().catch(() => {}); };

/** The report. A panel drawn by itself (search results draw them one at a time) measures the first time it shows;
 *  the Storage page's own panels (`onPage`) wait for the page to show (`storageShown`), since Settings draws every
 *  page at once. */
function useReport(onPage?: boolean) {
  const s = useStorage();
  useEffect(() => { if (!onPage && !state.report && !state.measuring) void measure(); }, [onPage]);
  return s;
}

/** Settings shows a page: the Storage page measures the first time it shows. */
export function storageShown(page: string | null) {
  if (page === "disk" && !state.report && !state.measuring) void measure();
}

const fromEntry = (m: ModEntry): StorageMod => ({ id: m.id, game: m.game, name: m.name, character: m.character, enabled: m.enabled || !!m.standby, bytes: m.sizeBytes,
  files: m.fileCount, path: m.path, installedAt: m.installedAt, preview: m.preview, thumb: m.thumb ?? null, nsfw: m.nsfw });

// mods removed, put back, toggled or renamed anywhere keep the report right
onPublish((game, change) => patchReport((r) => {
  const gone = new Set(change.removed);
  const mods = r.mods.filter((m) => !(m.game === game && gone.has(m.id)));
  for (const e of change.changed) {
    const i = mods.findIndex((m) => m.id === e.id);
    if (i >= 0) mods[i] = fromEntry(e); else mods.push(fromEntry(e));
  }
  mods.sort((a, b) => b.bytes - a.bytes);
  // groups stay: the panel shows only copies still in the list, so a copy put back with Undo shows again
  return { ...r, mods };
}));

/** The report's items with each game's "mods-on" and "mods-off" worked out from the mods as they are now. */
function liveGames(r: StorageReport) {
  return r.games.map((g) => {
    const mine = r.mods.filter((m) => m.game === g.game);
    const others = g.items.filter((i) => i.key !== "mods-on" && i.key !== "mods-off");
    const path = g.items.find((i) => i.key === "mods-on" || i.key === "mods-off")?.path ?? null;
    const mods: StorageItem[] = ([["mods-on", true], ["mods-off", false]] as const).map(([key, on]) => {
      const list = mine.filter((m) => m.enabled === on);
      return { key, category: on ? "on" : "off", bytes: list.reduce((s, m) => s + m.bytes, 0), count: list.length, path, name: null };
    });
    const items = [...mods, ...others].filter((i) => i.bytes > 0 || i.count > 0);
    return { game: g.game, items, bytes: items.reduce((s, i) => s + i.bytes, 0) };
  });
}

// ── words ──

const CATEGORIES: StorageCategory[] = ["on", "off", "trash", "downloads", "backups", "loader", "others", "app"];

function categoryLabel(c: StorageCategory): string {
  switch (c) {
    case "on": return t("Mods that are on");
    case "off": return t("Mods that are off");
    case "trash": return t("Trash");
    case "downloads": return t("Downloads");
    case "backups": return t("Backups");
    case "loader": return t("Mod loaders, caches and logs");
    case "others": return t("Mods in other managers");
    case "app": return t("gachamod data");
  }
}

function categoryTip(c: StorageCategory): string {
  switch (c) {
    case "on": return t("Mod folders the game loads");
    case "off": return t("Mod folders that are turned off. The game skips them, but they stay on disk");
    case "trash": return t("Removed mods whose files are kept for a while, so Put back works without downloading");
    case "downloads": return t("Archives kept after installing, and downloads that didn't finish");
    case "backups": return t("Copies gachamod keeps so a change can be undone: mod files from before a fix, key change or in-game switch, the author's copy of each mod file it changed, daily copies of the database, and settings from before an import");
    case "loader": return t("XXMI Launcher, each game's mod loader folder, the shader cache, frame dumps, 3DMigoto log and the in-game menu's pictures");
    case "others": return t("Mods another mod manager keeps outside the Mods folder, which gachamod doesn't list");
    case "app": return t("The database, picture thumbnails and other caches, logs, extensions and the data they save, fix tools, game icons, profile pictures, the GameBanana sign-in, AI helper files, what No Reload Mod Manager left and the window's cache");
  }
}

function itemLabel(i: StorageItem): string {
  switch (i.key) {
    case "mods-on": return t("Mods that are on");
    case "mods-off": return t("Mods that are off");
    case "trash": return t("Removed mods");
    case "archives": return t("Downloaded archives");
    case "parts": return t("Unfinished downloads");
    case "backups": return t("Backups");
    case "fixers": return t("Fix tools");
    case "shader-cache": return t("Shader cache");
    case "frame-dumps": return t("Frame dumps");
    case "log": return t("3DMigoto log");
    case "live-menu": return t("In-game menu pictures");
    case "originals": return t("Original mod files");
    case "loader": return t("Loader files");
    case "others": return i.name ?? t("Another mod manager");
    case "database": return t("Database");
    case "thumbs": return t("Picture thumbnails");
    case "cache": return t("Other caches");
    case "logs": return t("gachamod logs");
    case "staging": return t("Unpacked downloads");
    case "extensions": return t("Extensions");
    case "extensions-trash": return t("Removed extensions");
    case "extension-data": return t("Extension data");
    case "archive": return t("Pictures of removed mods");
    case "media": return t("Profile pictures");
    case "icons": return t("Game icons");
    case "ai": return t("AI helper files");
    case "login": return t("GameBanana sign-in");
    case "setup": return t("XXMI install downloads");
    case "nrmm-trash": return t("No Reload Mod Manager leftovers");
    case "webview": return t("Window cache");
    case "browser-cache": return t("Saved online data");
    case "xxmi": return t("XXMI Launcher");
    default: return i.name ?? t("Other files");
  }
}

function itemTip(i: StorageItem, game: GameId | null): string | undefined {
  switch (i.key) {
    case "trash": return t("Files of removed mods kept for the days set in Settings, Mods");
    case "archives": return t("Archives kept after installing. Settings, Downloads decides whether they stay");
    case "parts": return t("Downloads that stopped part way. Retry in Downloads picks them up");
    case "backups": return game
      ? t("Copies of mod files from before a fix, key change or in-game switch, so the change can be undone")
      : t("Daily copies of gachamod's database, settings from before an import, and old data a reset moved aside");
    case "shader-cache": return t("The game rebuilds it on the next start");
    case "frame-dumps": return t("FrameAnalysis folders a frame dump made while making a mod");
    case "log": return t("A high log level makes this file grow on every start");
    case "live-menu": return t("The pictures of the skin menu over the game, drawn by gachamod while Switch skins in game is on. They're drawn again when the list changes");
    case "originals": return t("The author's copy of each mod file gachamod changed. Put back original files uses them. They stay until the mod's record is deleted for good, or you clear them");
    case "loader": return t("ShaderFixes, d3dx.ini and the loader's dll files. The game needs these");
    case "others": return t("Mods this manager keeps outside the Mods folder");
    case "staging": return t("Files unpacked from an archive while it installs. Left over when an install stopped part way");
    case "thumbs": return t("Small copies of mod pictures, so lists load fast. They're made again when a mod shows. Ones older than 60 days are deleted at start");
    case "cache": return t("Pictures taken out of .gachamod files for their preview. They're taken out again when a file is opened. Ones older than 30 days are deleted at start");
    case "database": return t("Your library, settings and profiles. Daily copies are under Backups");
    case "logs": return t("gachamod's log files, crash files and the rendering log. Clear deletes the old log, crash files already sent and rendering incident files. The logs in use stay");
    case "extensions": return t("The extensions you installed");
    case "extensions-trash": return t("A removed or replaced extension waits here for 14 days, so Undo in Extensions can bring it back");
    case "extension-data": return t("What extensions saved, like their settings. It goes with a removed extension once the copy in the trash is gone");
    case "ai": return t("The Gemini key you pasted and the working files of AI runs. Settings, AI helper can remove the key");
    case "login": return t("The saved GameBanana sign-in and the window it signs in through. Signing out in Settings, GameBanana deletes both");
    case "setup": return t("Files the XXMI Launcher install downloads while it runs. The install deletes them when it finishes");
    case "nrmm-trash": return t("Everything No Reload Mod Manager made, moved here when gachamod took over the mods from it. Kept in case you want the files back");
    case "archive": return t("A small copy of each removed mod's picture, kept with the mod's record in Mods, Trash");
    case "media": return t("Banner pictures that profiles brought in from .gachamod files");
    case "icons": return t("Each game's icon, taken from the game's exe. It's taken again when needed. The icons of desktop quickstart shortcuts stay");
    case "fixers": return t("Fix tools gachamod downloaded to repair mods. They download again when a mod needs one");
    case "webview": return t("Pictures and pages the window keeps so they load faster, plus saved settings. Clear deletes the cached copies the next time gachamod starts. Saved settings stay");
    case "browser-cache": return t("Character portraits, game icons, creator stats and recent searches the window keeps. They load again when needed");
    case "other": return t("A file or folder in gachamod's data folder that has no row, like the saved look or the game list that gachamod setup reads. Show in Explorer opens it");
    case "xxmi": return t("The launcher and the loaders of games gachamod doesn't manage");
    default: return undefined;
  }
}

function stepText(s: StorageStep | null): string {
  const game = s?.game ? gameShort(allGames().find((g) => g.id === s.game)) || s.game : "";
  switch (s?.step) {
    case "data": return t("Measuring the trash, downloads and backups");
    case "loader": return t("Measuring {game} loader folder", { game });
    case "copies": return t("Comparing {game} mods that look alike", { game });
    case "others": return t("Looking for {game} mods in other managers", { game });
    case "xxmi": return t("Measuring XXMI Launcher");
    default: return t("Reading mod sizes");
  }
}

const shortOf = (game: GameId) => gameShort(allGames().find((g) => g.id === game)) || game;
const nameOf = (game: GameId) => gameName(allGames().find((g) => g.id === game)) || game;

const reveal = (p: string | null | undefined) => { if (p) shell.revealPath(p).catch((e) => toast(errorText(e), true)); };

// ── actions ──

async function recycleArchives(game: GameId | null) {
  try {
    const b = await storage.recycleArchives(game);
    if (b) toast(t("Moved {size} of archives to the Recycle Bin", { size: formatBytes(b) }));
    else toast(t("No archive to move. Downloads in progress keep theirs"), false, { label: t("Downloads"), run: () => go("downloads") });
    patchReport((r) => ({ ...r, games: r.games.map((g) => (game && g.game !== game ? g : { ...g, items: g.items.filter((i) => i.key !== "archives") })) }));
  } catch (e) { toast(errorText(e), true); }
}

async function clearCache(game: GameId) {
  const g = allGames().find((x) => x.id === game);
  if (g?.running) { toast(t("Close the game first")); return; }
  try {
    const b = await dev.clearShaderCache(game);
    toast(b ? t("Freed {size}", { size: formatBytes(b) }) : t("The shader cache is already empty"));
    dropItem(game, "shader-cache");
  } catch (e) { toast(errorText(e), true); }
}

async function clearDumps(game: GameId) {
  try {
    const b = await dev.clearFrameDumps(game);
    toast(b ? t("Moved {size} of frame dumps to the Recycle Bin", { size: formatBytes(b) }) : t("There are no frame dumps to move"));
    dropItem(game, "frame-dumps");
  } catch (e) { toast(errorText(e), true); }
}

async function purgeOverdue() {
  try {
    const n = await library.trashPurge(null);
    if (n) toast(tn(n, "Deleted the files of {n} removed mod. Mods, Trash keeps the record", "Deleted the files of {n} removed mods. Mods, Trash keeps their records"), false,
      { label: t("View trash"), run: () => go({ view: "library", tab: "archive" }) });
    else toast(t("Nothing in the trash was older than the set days"), false,
      { label: t("Trash settings"), run: () => go({ view: "settings", section: "set-trash-days" }) });
    patchReport((r) => ({ ...r, trashOverdue: 0 }));
  } catch (e) { toast(errorText(e), true); }
}

function dropItem(game: GameId, key: string) {
  patchReport((r) => ({ ...r, games: r.games.map((g) => (g.game === game ? { ...g, items: g.items.filter((i) => i.key !== key) } : g)) }));
}

/** An item's size after `freed` bytes went (all of it when `all`), in one game's list or the shared one. */
function shrinkItem(game: GameId | null, key: string, freed: number, all: boolean) {
  const less = (items: StorageItem[]) => items
    .map((i) => (i.key !== key ? i : { ...i, bytes: all ? 0 : Math.max(0, i.bytes - freed), count: all ? 0 : i.count }))
    .filter((i) => i.key !== key || i.bytes > 0);
  patchReport((r) => (game
    ? { ...r, games: r.games.map((g) => (g.game === game ? { ...g, items: less(g.items) } : g)) }
    : { ...r, app: less(r.app) }));
}

/** Delete something gachamod can make again, or an unused copy. `all`: the whole row goes (not just part of it). */
async function clearStored(kind: StorageClearKind, game: GameId | null, key: string, all: boolean, none = t("Nothing to clear")) {
  try {
    const freed = await storage.clear(kind, game);
    if (!freed) { toast(none); return; }
    toast(t("Freed {size}", { size: formatBytes(freed) }));
    shrinkItem(game, key, freed, all);
    // a clear with no game can reach several games' folders, so the sizes are measured again
    if (!game && kind.startsWith("originals")) void measure();
  } catch (e) { toast(errorText(e), true); }
}

/** What No Reload Mod Manager made, kept after a takeover, goes to the Recycle Bin. */
async function recycleNrmm() {
  try {
    const b = await storage.clear("nrmm-trash", null);
    if (!b) { toast(t("Nothing to move")); return; }
    toast(t("Moved {size} to the Recycle Bin", { size: formatBytes(b) }));
    shrinkItem(null, "nrmm-trash", b, true);
  } catch (e) { toast(errorText(e), true); }
}

/** The window's cache is deleted at the next start, since the window holds its files open until then. */
async function clearWindowCache() {
  try {
    const freed = await storage.clear("webview", null);
    if (!freed) { toast(t("The window has no cache to clear")); return; }
    toast(t("{size} of the window's cache is deleted when gachamod restarts", { size: formatBytes(freed) }), false,
      { label: t("Restart"), run: () => void about.relaunch().catch((e) => toast(errorText(e), true)) });
  } catch (e) { toast(errorText(e), true); }
}

function clearBrowserCache() {
  const freed = clearCaches();
  refreshBrowser();
  toast(freed ? t("Freed {size}", { size: formatBytes(freed) }) : t("Nothing to clear"));
}

/** A Clear that asks first, for copies that can't be made again. */
function ClearAsk({ label, title, heading, what, onYes }: { label: string; title: string; heading: string; what: string; onYes: () => Promise<void> }) {
  const [ask, setAsk] = useState(false);
  return <>
    <Button size="sm" variant="ghost" onClick={() => setAsk(true)} title={title}>{label}</Button>
    {ask && <Confirm title={heading} yes={label} danger onYes={onYes} onClose={() => setAsk(false)}><p>{what}</p></Confirm>}
  </>;
}

/** Send copies to the trash (kept at least 10 minutes), with Undo. */
async function removeCopies(groups: StorageDuplicate[]) {
  const byGame = new Map<GameId, string[]>();
  for (const d of groups) byGame.set(d.game, [...(byGame.get(d.game) ?? []), ...d.remove]);
  let gone = new Map<GameId, string[]>();
  const send = async () => {
    const next = new Map<GameId, string[]>();
    for (const [game, ids] of byGame) {
      const change = await storage.removeCopies(game, ids);
      publish(game, change);
      if (change.notes.length) toast(change.notes.join(". "), true);
      if (change.removed.length) next.set(game, change.removed);
    }
    gone = next;
  };
  try { await send(); } catch (e) { toast(errorText(e), true); return; }
  const n = [...gone.values()].reduce((s, ids) => s + ids.length, 0);
  if (!n) return;
  const freed = groups.reduce((s, d) => s + d.bytes, 0);
  record({
    label: tn(n, "Moved {n} copy to the trash, {size}", "Moved {n} copies to the trash, {size}", { size: formatBytes(freed) }),
    undo: async () => {
      for (const [game, ids] of gone) {
        const trash = await library.trash(game);
        for (const id of ids) {
          const tr = trash.find((x) => x.modId === id);
          if (tr) publish(game, await library.trashRestore(tr.id));
        }
      }
    },
    redo: send,
  });
}

async function trashMod(m: StorageMod) {
  try {
    const entry = (await library.list(m.game)).find((x) => x.id === m.id);
    if (!entry) { toast(t("That mod isn't in the library anymore. Rescan to refresh the list"), true); return; }
    await removeMods(m.game, [entry]);
  } catch (e) { toast(errorText(e), true); }
}

const openMod = (m: { game: GameId; id: string }) => goIn(m.game, { view: "library", modId: m.id });

// ── suggestions ──

const MB = 1024 * 1024;
const GB = 1024 * MB;
const TIPS_KEY = "gm.storage.tips";

/** Dismissed suggestions with the amount they named, so one comes back only when that amount has doubled. */
function readDismissed(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(TIPS_KEY) ?? "{}") as Record<string, number>; } catch { return {}; }
}

interface Tip { id: string; bytes: number; text: string; action?: { label: string; title: string; run: () => void }; more?: { label: string; title: string; run: () => void } }

function tipsFor(r: StorageReport): Tip[] {
  if (!r.complete) return [];
  const out: Tip[] = [];
  const games = liveGames(r);
  const sum = (key: string) => games.reduce((s, g) => s + (g.items.find((i) => i.key === key)?.bytes ?? 0), 0);
  const archives = sum("archives");
  if (archives >= 500 * MB) {
    out.push({
      id: "archives", bytes: archives,
      text: t("Downloaded archives take {size}. The mods are installed, so they're only needed to install again without downloading.", { size: formatBytes(archives) }),
      action: { label: t("Move to Recycle Bin"), title: t("Moves the kept archives to the Recycle Bin. Downloads in progress keep theirs"), run: () => void recycleArchives(null) },
      more: r.keepArchives ? { label: t("Archive setting"), title: t("Opens Settings, Downloads: Delete downloaded archives"), run: () => go({ view: "settings", section: "set-archives" }) } : undefined,
    });
  }
  if (r.trashOverdue >= 50 * MB) {
    out.push({
      id: "trash", bytes: r.trashOverdue,
      text: t("{size} in the trash is past the days you set and wasn't deleted. A file was probably open at the time.", { size: formatBytes(r.trashOverdue) }),
      action: { label: t("Delete now"), title: t("Deletes those files as your trash setting says. Mods, Trash keeps each mod's record and GameBanana link"), run: () => void purgeOverdue() },
      more: { label: t("Trash settings"), title: t("Opens Settings, Mods: Trash and removed mods"), run: () => go({ view: "settings", section: "storage" }) },
    });
  }
  for (const g of games) {
    const get = (key: string) => g.items.find((i) => i.key === key);
    const name = nameOf(g.game);
    const cache = get("shader-cache");
    if (cache && cache.bytes >= GB) {
      out.push({ id: `cache:${g.game}`, bytes: cache.bytes, text: t("{game} shader cache is {size}. It rebuilds on the next start, which then takes a little longer.", { game: name, size: formatBytes(cache.bytes) }),
        action: { label: t("Clear"), title: t("Deletes the shader cache. The game rebuilds it on the next start"), run: () => void clearCache(g.game) } });
    }
    const dumps = get("frame-dumps");
    if (dumps && dumps.bytes >= 200 * MB) {
      out.push({ id: `dumps:${g.game}`, bytes: dumps.bytes, text: t("Frame dumps in the {game} loader folder take {size}. They're only needed while making a mod.", { game: name, size: formatBytes(dumps.bytes) }),
        action: { label: t("Move to Recycle Bin"), title: t("Moves the FrameAnalysis folders to the Recycle Bin"), run: () => void clearDumps(g.game) } });
    }
    const log = get("log");
    if (log && log.bytes >= 100 * MB) {
      out.push({ id: `log:${g.game}`, bytes: log.bytes, text: t("The {game} 3DMigoto log is {size}. A high log level writes this much, and the log only helps while making mods.", { game: name, size: formatBytes(log.bytes) }),
        action: { label: t("Log settings"), title: t("Opens Settings, Mod maker switches, where the log level is"), run: () => goIn(g.game, { view: "settings", section: "migoto" }) } });
    }
    for (const o of g.items.filter((i) => i.key === "others" && i.bytes >= 500 * MB)) {
      out.push({ id: `others:${g.game}:${o.name ?? ""}`, bytes: o.bytes,
        text: t("{manager} still keeps {size} of {game} mods outside the Mods folder. gachamod doesn't list them.", { manager: o.name ?? t("Another mod manager"), size: formatBytes(o.bytes), game: name }),
        action: { label: t("Move them in"), title: t("Opens Tools, Share and import: Mods from other managers"), run: () => goIn(g.game, { view: "tools", section: "others" }) } });
    }
  }
  return out;
}

/** The one automatic cleanup: pictures gachamod can make again, when they haven't been used for a long time. */
function TrimRow() {
  const on = trimPref.use();
  return (
    <div className="set-rows st-auto">
      <SetRow id="set-cache-trim" label={t("Delete old pictures at start")} hint={t("Thumbnails older than 60 days and .gachamod previews older than 30")}
        tip={t("These are copies gachamod makes again when a mod or a file shows. Nothing you made is deleted")}>
        <Toggle checked={on} onChange={(v) => void trimPref.set(v, v ? t("Deleting old pictures at start") : t("Keeping old pictures"))} />
      </SetRow>
    </div>
  );
}

function Tips({ report }: { report: StorageReport }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const all = tipsFor(report);
  const isHidden = (tip: Tip) => !!dismissed[tip.id] && tip.bytes < dismissed[tip.id]! * 2;
  const tips = all.filter((tip) => !isHidden(tip));
  const hidden = all.filter(isHidden);
  const save = (next: Record<string, number>) => {
    setDismissed(next);
    try { localStorage.setItem(TIPS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  const hide = (tip: Tip) => save({ ...dismissed, [tip.id]: tip.bytes });
  const restore = () => {
    const next = { ...dismissed };
    for (const tip of hidden) delete next[tip.id];
    save(next);
  };
  if (!tips.length && !hidden.length) return null;
  return <>
    {tips.length > 0 && <ul className="st-tips" aria-label={t("Cleaning suggestions")}>
      {tips.map((tip) => (
        <li key={tip.id} className="st-tip">
          <span className="st-tip-t">{tip.text}</span>
          {tip.action && <Button size="sm" onClick={tip.action.run} title={tip.action.title}>{tip.action.label}</Button>}
          {tip.more && <Button size="sm" variant="ghost" onClick={tip.more.run} title={tip.more.title}>{tip.more.label}</Button>}
          <IconButton size="sm" icon="x" label={t("Hide this suggestion")} onClick={() => hide(tip)} />
        </li>
      ))}
    </ul>}
    {hidden.length > 0 && <Button size="sm" variant="ghost" className="st-more st-restore" onClick={restore}
      title={t("Brings back the cleaning suggestions you hid")}>{tn(hidden.length, "Show {n} hidden suggestion", "Show {n} hidden suggestions")}</Button>}
  </>;
}

// ── the overview ──

type View = "category" | "game" | "character";
let lastView: View = "category";

function Bar({ value, max }: { value: number; max: number }) {
  return <span className="st-bar" aria-hidden="true"><span style={{ width: `${max ? Math.max(1, (value / max) * 100) : 0}%` }} /></span>;
}

/** The actions a single item offers, beside "Show in Explorer". */
function ItemActions({ game, item }: { game: GameId | null; item: StorageItem }) {
  const running = !!game && !!allGames().find((g) => g.id === game)?.running;
  switch (item.key) {
    case "trash": return <>
      {game && <Button size="sm" variant="ghost" onClick={() => goIn(game, { view: "library", tab: "archive" })} title={t("Opens Mods > Trash")}>{t("View trash")}</Button>}
      <Button size="sm" variant="ghost" onClick={() => go({ view: "settings", section: "storage" })} title={t("Opens Settings, Mods: Trash and removed mods")}>{t("Trash settings")}</Button>
    </>;
    case "archives": return <Button size="sm" variant="ghost" onClick={() => void recycleArchives(game)} title={t("Moves the kept archives to the Recycle Bin. Downloads in progress keep theirs")}>{t("Move to Recycle Bin")}</Button>;
    case "parts": return <Button size="sm" variant="ghost" onClick={() => go("downloads")} title={t("Opens Downloads, where Retry picks them up")}>{t("Downloads")}</Button>;
    case "backups": return <Button size="sm" variant="ghost" onClick={() => go({ view: "settings", section: "disk-backups" })} title={t("Shows each backup: what it is, when it was made and the size")}>{t("View backups")}</Button>;
    case "shader-cache": return game ? <Button size="sm" variant="ghost" disabled={running} onClick={() => void clearCache(game)} title={running ? t("Close the game first") : t("Deletes the shader cache. The game rebuilds it on the next start")}>{t("Clear")}</Button> : null;
    case "frame-dumps": return game ? <Button size="sm" variant="ghost" onClick={() => void clearDumps(game)} title={t("Moves the FrameAnalysis folders to the Recycle Bin")}>{t("Move to Recycle Bin")}</Button> : null;
    case "log": return game ? <>
      <Button size="sm" variant="ghost" disabled={running} onClick={() => void clearStored("log", game, "log", true)} title={running ? t("Close the game first") : t("Deletes the log. The game starts a new one")}>{t("Clear")}</Button>
      <Button size="sm" variant="ghost" onClick={() => goIn(game, { view: "settings", section: "migoto" })} title={t("Opens Settings, Mod maker switches, where the log level is")}>{t("Log settings")}</Button>
    </> : null;
    case "live-menu": return game ? <Button size="sm" variant="ghost" onClick={() => goIn(game, { view: "tools", section: "ingame" })} title={t("Opens Switch skins in game")}>{t("Switch skins in game")}</Button> : null;
    case "originals": return <>
      <Button size="sm" variant="ghost" onClick={() => void clearStored("originals-gone", game, "originals", false, t("No removed mod has copies here"))}
        title={t("Deletes the copies of mods that are no longer installed or in the trash")}>{t("Clear unused")}</Button>
      {game && <ClearAsk label={t("Clear all")} title={t("Deletes every original copy, after asking")} heading={t("Delete the original mod files?")}
        what={t("Put back original files can't bring the author's version back for these mods afterwards. A copy is kept again the next time gachamod changes a file.")}
        onYes={() => clearStored("originals", game, "originals", true)} />}
    </>;
    case "thumbs": return <Button size="sm" variant="ghost" onClick={() => void clearStored("thumbs", null, "thumbs", true)} title={t("Deletes the thumbnails. They're made again when a mod shows")}>{t("Clear")}</Button>;
    case "cache": return <Button size="sm" variant="ghost" onClick={() => void clearStored("cache", null, "cache", true)} title={t("Deletes the pictures taken out of .gachamod files. They're taken out again when a file is opened")}>{t("Clear")}</Button>;
    case "staging": return <Button size="sm" variant="ghost" onClick={() => void clearStored("staging", null, "staging", false, t("Nothing to clear. Installs in progress keep their files"))}
      title={t("Deletes files left from unpacking downloads. Installs in progress keep theirs")}>{t("Clear")}</Button>;
    case "icons": return <Button size="sm" variant="ghost" onClick={() => void clearStored("icons", null, "icons", true)} title={t("Deletes the saved game icons. They're taken from the games again when needed. Desktop quickstart shortcuts keep their icons")}>{t("Clear")}</Button>;
    case "media": return <Button size="sm" variant="ghost" onClick={() => void clearStored("media-unused", null, "media", false, t("Every picture here is used by a profile"))}
      title={t("Deletes the pictures no profile uses")}>{t("Clear unused")}</Button>;
    case "extensions":
    case "extensions-trash": return <Button size="sm" variant="ghost" onClick={() => go({ view: "extensions" })} title={t("Opens Extensions")}>{t("View extensions")}</Button>;
    case "database": return <Button size="sm" variant="ghost" onClick={() => go({ view: "settings", section: "disk-backups" })} title={t("Shows the daily copies of the database, with the size of each")}>{t("View backups")}</Button>;
    case "logs": return <>
      <Button size="sm" variant="ghost" onClick={() => void clearStored("logs-old", null, "logs", false, t("No old logs to clear. The logs in use stay"))}
        title={t("Deletes the old log, crash files already sent and rendering incident files. The logs in use stay")}>{t("Clear old")}</Button>
      <Button size="sm" variant="ghost" onClick={() => go({ view: "settings", section: "logs" })} title={t("Opens Settings, Feedback, privacy and logs: Log files")}>{t("Log settings")}</Button>
    </>;
    case "fixers": return <Button size="sm" variant="ghost" onClick={() => go({ view: "tools", section: "fixes" })} title={t("Opens Tools > Fixes")}>{t("Open Fixes")}</Button>;
    case "ai": return <Button size="sm" variant="ghost" onClick={() => go({ view: "settings", section: "set-ai-key" })} title={t("Opens Settings, AI helper: the Gemini key")}>{t("AI helper settings")}</Button>;
    case "login": return <Button size="sm" variant="ghost" onClick={() => go({ view: "settings", section: "account" })} title={t("Opens Settings, GameBanana: signing out deletes the sign-in")}>{t("GameBanana settings")}</Button>;
    case "setup": return <Button size="sm" variant="ghost" onClick={() => void clearStored("setup", null, "setup", false, t("Nothing to clear. An install in progress keeps the files"))}
      title={t("Deletes files left by an XXMI Launcher install that stopped part way")}>{t("Clear")}</Button>;
    case "nrmm-trash": return <Button size="sm" variant="ghost" onClick={() => void recycleNrmm()}
      title={t("Moves the leftovers to the Recycle Bin, where Windows can still put them back")}>{t("Move to Recycle Bin")}</Button>;
    case "xxmi": return <Button size="sm" variant="ghost" onClick={() => go({ view: "settings", section: "xxmi" })} title={t("Opens Settings, Games: XXMI Launcher, where it can be uninstalled")}>{t("XXMI Launcher settings")}</Button>;
    case "extension-data": return <>
      <Button size="sm" variant="ghost" onClick={() => go({ view: "extensions" })} title={t("Opens Extensions")}>{t("View extensions")}</Button>
      <Button size="sm" variant="ghost" onClick={() => void clearStored("extension-data-gone", null, "extension-data", false, t("No removed extension has saved data"))}
        title={t("Deletes the saved data of extensions that are no longer installed")}>{t("Clear unused")}</Button>
      <ClearAsk label={t("Clear all")} title={t("Deletes what every extension saved, after asking")} heading={t("Delete what extensions saved?")}
        what={t("Extensions lose their saved settings and start fresh.")} onYes={() => clearStored("extension-data", null, "extension-data", true)} />
    </>;
    case "archive": return <Button size="sm" variant="ghost" onClick={() => go({ view: "library", tab: "archive" })} title={t("Opens Mods > Trash")}>{t("View trash")}</Button>;
    case "webview": return <Button size="sm" variant="ghost" onClick={() => void clearWindowCache()} title={t("Deletes the window's cached pictures and pages the next time gachamod starts. Saved settings stay")}>{t("Clear")}</Button>;
    case "browser-cache": return <Button size="sm" variant="ghost" onClick={clearBrowserCache} title={t("Deletes the saved portraits, icons, creator stats and recent searches. They load again when needed")}>{t("Clear")}</Button>;
    case "others": return game ? <Button size="sm" variant="ghost" onClick={() => goIn(game, { view: "tools", section: "others" })} title={t("Opens Tools, Share and import: Mods from other managers")}>{t("Move them in")}</Button> : null;
    default: return null;
  }
}

function countText(i: StorageItem): string {
  if (!i.count) return "";
  if (i.key === "mods-on" || i.key === "mods-off" || i.key === "trash" || i.key === "others") return tn(i.count, "{n} mod", "{n} mods");
  if (i.key === "backups") return tn(i.count, "{n} backup", "{n} backups");
  return tn(i.count, "{n} file", "{n} files");
}

function ItemRow({ game, item, showGame }: { game: GameId | null; item: StorageItem; showGame: boolean }) {
  const tip = itemTip(item, game);
  const meta = [showGame && game ? shortOf(game) : "", countText(item)].filter(Boolean).join(" · ");
  return (
    <li className="st-item">
      <span className="st-item-t" title={tip}><b>{itemLabel(item)}</b>{meta && <span className="hint">{meta}</span>}</span>
      <span className="st-size">{formatBytes(item.bytes)}</span>
      <span className="st-acts">
        <ItemActions game={game} item={item} />
        {item.path && <IconButton size="sm" icon="folder" label={t("Show in Explorer")} onClick={() => reveal(item.path)} />}
      </span>
    </li>
  );
}

export function StoragePanel({ onPage }: { onPage?: boolean }) {
  const { report, measuring, step } = useReport(onPage);
  const sc = useScope();
  const games = useGames();
  const [view, setViewState] = useState<View>(lastView);
  const setView = (v: View) => { lastView = v; setViewState(v); };
  const [open, setOpen] = useState<StorageCategory | null>(null);
  const [allChars, setAllChars] = useState(false);

  const browser = useBrowserBytes();
  const live = useMemo(() => (report ? liveGames(report) : []), [report]);
  const inScope = sc === "all" ? live : live.filter((g) => g.game === sc);
  // the window's saved page data isn't a folder, so the report doesn't have it
  const appItems = useMemo<StorageItem[]>(() => [...(report?.app ?? []),
    ...(report && browser > 0 ? [{ key: "browser-cache", category: "app" as const, bytes: browser, count: cacheCount(), path: null, name: null }] : [])], [report, browser]);
  const app = sc === "all" ? appItems : [];
  const total = inScope.reduce((s, g) => s + g.bytes, 0) + app.reduce((s, i) => s + i.bytes, 0);

  const cats = useMemo(() => {
    const rows = CATEGORIES.map((c) => ({ c, items: [] as Array<{ game: GameId | null; item: StorageItem }>, bytes: 0 }));
    for (const g of inScope) for (const item of g.items) rows.find((r) => r.c === item.category)?.items.push({ game: g.game, item });
    for (const item of app) rows.find((r) => r.c === item.category)?.items.push({ game: null, item });
    for (const r of rows) { r.items.sort((a, b) => b.item.bytes - a.item.bytes); r.bytes = r.items.reduce((s, x) => s + x.item.bytes, 0); }
    return rows.filter((r) => r.bytes > 0);
  }, [inScope, app]);

  const chars = useMemo(() => {
    const by = new Map<string, { game: GameId; name: string | null; bytes: number; mods: number }>();
    for (const m of report?.mods ?? []) {
      if (sc !== "all" && m.game !== sc) continue;
      const name = m.character?.trim() || null;
      const k = `${m.game}\u0000${name ?? ""}`;
      const c = by.get(k) ?? { game: m.game, name, bytes: 0, mods: 0 };
      c.bytes += m.bytes; c.mods++;
      by.set(k, c);
    }
    return [...by.values()].sort((a, b) => b.bytes - a.bytes);
  }, [report, sc]);

  const scopes = [{ value: "all", label: t("All games") }, ...live.map((g) => ({ value: g.game, label: gameName(games.find((x) => x.id === g.game)) || g.game }))];
  const appBytes = appItems.reduce((s, i) => s + i.bytes, 0);

  return (
    <Panel title={t("Disk space")} icon="box" id="disk"
      actions={<Button size="sm" variant="ghost" icon="refresh" busy={measuring} onClick={() => void measure()} title={t("Measure every folder again")}>{t("Measure again")}</Button>}>
      {!report
        ? <Waiting what={stepText(step)}><Button size="sm" onClick={skip} title={t("Stop measuring and show what's measured so far")}>{t("Skip")}</Button></Waiting>
        : <>
          <div className="st-head">
            <div className="st-total"><b>{formatBytes(total)}</b>
              <span className="hint">{report.complete
                ? t("Measured {when}", { when: timeAgo(report.measuredAt) })
                : measuring ? t("Mods so far. Measuring the rest") : t("Only part was measured. Measure again for the rest")}</span>
            </div>
            <span className="st-pick">
              {scopes.length > 2 && <Select value={sc} onChange={(v) => setScope(v)} options={scopes} title={t("Which games to count")} />}
              <Segmented value={view} onChange={setView} label={t("Break down by")} size="sm" options={[
                { value: "category", label: t("Category"), title: t("Mods, the trash, downloads, backups, loaders and gachamod data") },
                { value: "game", label: t("Game"), title: t("Each game with everything that belongs to it") },
                { value: "character", label: t("Character"), title: t("Each character's mods") },
              ]} />
            </span>
          </div>
          {measuring && <Waiting className="st-wait" what={stepText(step)}><Button size="sm" onClick={skip} title={t("Stop measuring and show what's measured so far")}>{t("Skip")}</Button></Waiting>}
          <Tips report={report} />
          <TrimRow />

          {view === "category" && (
            <ul className="st-rows">
              {cats.map((r) => (
                <li key={r.c} className="st-row">
                  <button type="button" className="st-row-b" aria-expanded={open === r.c} onClick={() => setOpen(open === r.c ? null : r.c)} title={categoryTip(r.c)}>
                    <span className="st-row-t">{categoryLabel(r.c)}</span>
                    <Bar value={r.bytes} max={cats[0]?.bytes ?? 0} />
                    <span className="st-size">{formatBytes(r.bytes)}</span>
                  </button>
                  {open === r.c && <ul className="st-items">{r.items.map((x, i) => <ItemRow key={`${x.game ?? ""}:${x.item.key}:${x.item.name ?? ""}:${i}`} game={x.game} item={x.item} showGame={sc === "all"} />)}</ul>}
                </li>
              ))}
            </ul>
          )}

          {view === "game" && (
            <ul className="st-rows">
              {live.map((g) => (
                <li key={g.game} className="st-row">
                  <button type="button" className="st-row-b" onClick={() => { setScope(g.game); setView("category"); }} title={t("Show what {game} uses, by category", { game: nameOf(g.game) })}>
                    <span className="st-row-t">{nameOf(g.game)}</span>
                    <Bar value={g.bytes} max={Math.max(live[0]?.bytes ?? 0, appBytes)} />
                    <span className="st-size">{formatBytes(g.bytes)}</span>
                  </button>
                </li>
              ))}
              {appBytes > 0 && (
                <li className="st-row">
                  <button type="button" className="st-row-b" onClick={() => { setScope("all"); setView("category"); setOpen("app"); }} title={t("XXMI Launcher and gachamod data, which no single game owns")}>
                    <span className="st-row-t">{t("Shared by all games")}</span>
                    <Bar value={appBytes} max={Math.max(live[0]?.bytes ?? 0, appBytes)} />
                    <span className="st-size">{formatBytes(appBytes)}</span>
                  </button>
                </li>
              )}
            </ul>
          )}

          {view === "character" && (
            chars.length ? <>
              <ul className="st-rows">
                {(allChars ? chars : chars.slice(0, 15)).map((c) => (
                  <li key={`${c.game}:${c.name ?? ""}`} className="st-row">
                    <button type="button" className="st-row-b" onClick={() => goIn(c.game, c.name ? { view: "library", character: c.name } : { view: "library" })}
                      title={c.name ? t("Show {name}'s mods", { name: c.name }) : t("Show the mods")}>
                      <span className="st-row-t">{c.name ?? t("No character")}<span className="hint">{[sc === "all" ? shortOf(c.game) : "", tn(c.mods, "{n} mod", "{n} mods")].filter(Boolean).join(" · ")}</span></span>
                      <Bar value={c.bytes} max={chars[0]?.bytes ?? 0} />
                      <span className="st-size">{formatBytes(c.bytes)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {chars.length > 15 && <Button size="sm" variant="ghost" className="st-more" onClick={() => setAllChars(!allChars)}>{allChars ? t("Show fewer") : tn(chars.length - 15, "Show {n} more", "Show {n} more")}</Button>}
            </> : <p className="hint">{t("No mods yet.")}</p>
          )}
        </>}
    </Panel>
  );
}

// ── the biggest mods ──

/** A panel shown before the first measure is back, so one drawn alone in search results isn't blank. */
function Measuring({ title, icon, id }: { title: string; icon: "sort" | "layers"; id: string }) {
  const { step } = useStorage();
  return <Panel title={title} icon={icon} id={id}><Waiting what={stepText(step)}><Button size="sm" onClick={skip} title={t("Stop measuring and show what's measured so far")}>{t("Skip")}</Button></Waiting></Panel>;
}

export function BiggestModsPanel({ onPage }: { onPage?: boolean }) {
  const { report } = useReport(onPage);
  const sc = useScope();
  const nsfw = useNsfwMode();
  const [which, setWhich] = useState<"all" | "off">("all");
  const [shown, setShown] = useState(10);
  if (!report) return <Measuring title={t("Biggest mods")} icon="sort" id="disk-big" />;
  const list = report.mods.filter((m) => (sc === "all" || m.game === sc) && (which === "all" || !m.enabled));
  return (
    <Panel title={t("Biggest mods")} icon="sort" id="disk-big"
      actions={<Segmented size="sm" value={which} onChange={(v) => { setWhich(v); setShown(10); }} label={t("Which mods")} options={[
        { value: "all", label: t("All"), title: t("Every mod, biggest first") },
        { value: "off", label: t("Off"), title: t("Mods that are turned off. The game skips them, but they still take space") },
      ]} />}>
      {!list.length
        ? <p className="hint">{which === "off" ? t("No mod is turned off.") : t("No mods yet.")}</p>
        : <>
          <ul className="st-mods">
            {list.slice(0, shown).map((m) => (
              <li key={m.id} className="st-mod">
                <button type="button" className="st-mod-b" onClick={() => openMod(m)} title={t("Open {name} in Mods", { name: m.name })}>
                  <Preview className="st-thumb" src={m.nsfw && nsfw === "hide" ? null : m.preview} thumb={m.thumb} blur={m.nsfw && nsfw === "blur"} icon="mods" />
                  <span className="st-mod-t"><b>{m.name}</b>
                    <span className="hint">{[m.character ?? "", sc === "all" ? shortOf(m.game) : "", tn(m.files, "{n} file", "{n} files")].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
                {!m.enabled && <Badge>{t("Off")}</Badge>}
                <span className="st-size">{formatBytes(m.bytes)}</span>
                <span className="st-acts">
                  <IconButton size="sm" icon="folder" label={t("Show in Explorer")} onClick={() => reveal(m.path)} />
                  <IconButton size="sm" icon="trash" label={t("Move to trash")} onClick={() => void trashMod(m)} />
                </span>
              </li>
            ))}
          </ul>
          {list.length > shown && <Button size="sm" variant="ghost" className="st-more" onClick={() => setShown(shown + 20)}>{tn(Math.min(20, list.length - shown), "Show {n} more", "Show {n} more")}</Button>}
        </>}
    </Panel>
  );
}

// ── mods installed twice ──

export function DuplicatesPanel({ onPage }: { onPage?: boolean }) {
  const { report, measuring } = useReport(onPage);
  const sc = useScope();
  const [busy, setBusy] = useState<string | null>(null);
  if (!report) return <Measuring title={t("Mods installed twice")} icon="layers" id="disk-dupes" />;
  const mods = new Map(report.mods.map((m) => [m.id, m]));
  const groups = report.duplicates.filter((d) => (sc === "all" || d.game === sc) && mods.has(d.keep) && d.remove.some((id) => mods.has(id)))
    .map((d) => ({ ...d, remove: d.remove.filter((id) => mods.has(id)) }));
  const same = groups.filter((d) => d.kind === "same");
  const run = async (key: string, list: StorageDuplicate[]) => { setBusy(key); try { await removeCopies(list); } finally { setBusy(null); } };
  const keepLabel = (d: StorageDuplicate) => {
    const keep = mods.get(d.keep)!;
    const newest = d.remove.every((id) => (mods.get(id)?.installedAt ?? 0) <= keep.installedAt);
    return newest ? t("Keep newest") : t("Keep the one on");
  };
  return (
    <Panel title={t("Mods installed twice")} icon="layers" id="disk-dupes" count={groups.length || undefined}
      actions={same.length > 1 ? <Button size="sm" busy={busy === "all"} onClick={() => void run("all", same)}
        title={t("Keeps one copy of each mod with the same files and moves the others to the trash. Undo puts them back")}>{t("Keep one of each")}</Button> : undefined}>
      {!groups.length
        ? <p className="hint">{report.complete ? t("No mod is installed twice.") : measuring ? t("Copies are compared once the rest is measured.") : t("Copies weren't compared. Measure again to look for them.")}</p>
        : <ul className="st-dupes">
          {groups.map((d) => {
            const key = `${d.game}:${d.keep}`;
            return (
              <li key={key} className="st-dupe">
                <div className="st-dupe-h">
                  <span className="hint">{d.kind === "same"
                    ? t("Same files, {size} to free", { size: formatBytes(d.bytes) })
                    : t("Same GameBanana download, but the files differ now. One may have been edited or fixed since. {size} to free", { size: formatBytes(d.bytes) })}{sc === "all" ? ` · ${shortOf(d.game)}` : ""}</span>
                  <Button size="sm" busy={busy === key} onClick={() => void run(key, [d])} title={t("Moves the other copies to the trash. Undo puts them back")}>{keepLabel(d)}</Button>
                </div>
                <ul className="st-dupe-l">
                  {[d.keep, ...d.remove].map((id) => {
                    const m = mods.get(id)!;
                    return (
                      <li key={id}>
                        <button type="button" className="st-link" onClick={() => openMod(m)} title={t("Open {name} in Mods", { name: m.name })}>{m.name}</button>
                        <span className="hint">{[m.enabled ? t("On") : t("Off"), t("added {when}", { when: timeAgo(m.installedAt) })].join(" · ")}</span>
                        {id === d.keep ? <Badge tone="ok">{t("Stays")}</Badge> : <Badge>{t("Goes to trash")}</Badge>}
                        <IconButton size="sm" icon="folder" label={t("Show in Explorer")} onClick={() => reveal(m.path)} />
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>}
    </Panel>
  );
}

// ── backups ──

interface Bk { list: BackupEntry[] | null; loading: boolean }
let bk: Bk = { list: null, loading: false };
const bkSubs = new Set<() => void>();
const setBk = (p: Partial<Bk>) => { bk = { ...bk, ...p }; bkSubs.forEach((f) => f()); };
const useBackups = () => useSyncExternalStore((f) => { bkSubs.add(f); return () => bkSubs.delete(f); }, () => bk);

/** Read what's in the backups folder. It runs with each measure, and after a restore. */
async function loadBackups() {
  if (bk.loading) return;
  setBk({ loading: true });
  try { setBk({ list: await backups.entries() }); }
  catch (e) { toast(errorText(e), true); setBk({ list: bk.list ?? [] }); }
  finally { setBk({ loading: false }); }
}

function backupTitle(e: BackupEntry): string {
  switch (e.kind) {
    case "mod": return e.label ? tb(e.label) : t("Mod files");
    case "database": return t("Daily copy of gachamod's database");
    case "settings": return t("Settings from before an import");
    case "reset": return t("Old data from Reset gachamod");
    default: return e.id;
  }
}

function backupTip(e: BackupEntry): string {
  switch (e.kind) {
    case "mod": return t("The mod's files from before this change. Restore puts them back");
    case "database": return t("gachamod copies the database once a day and keeps the last five");
    case "settings": return t("Taken before settings were brought in from a file. gachamod keeps the last ten");
    case "reset": return t("The database, trash and settings that Reset gachamod moved aside");
    default: return t("Something else in the backups folder");
  }
}

/** The report's backup sizes without backups that were just moved to the Recycle Bin. */
function dropBackups(gone: BackupEntry[]) {
  patchReport((r) => {
    const games = new Set<string>(r.games.map((g) => g.game));
    const less = (items: StorageItem[], list: BackupEntry[]) => !list.length ? items : items
      .map((i) => (i.key !== "backups" ? i : { ...i, bytes: Math.max(0, i.bytes - list.reduce((s, e) => s + e.bytes, 0)), count: Math.max(0, i.count - list.length) }))
      .filter((i) => i.key !== "backups" || i.bytes > 0);
    return {
      ...r,
      games: r.games.map((g) => ({ ...g, items: less(g.items, gone.filter((e) => e.game === g.game)) })),
      app: less(r.app, gone.filter((e) => !e.game || !games.has(e.game))),
    };
  });
}

async function recycleBackups(list: BackupEntry[]) {
  try {
    const b = await backups.recycle(list.map((e) => e.id));
    toast(b ? t("Moved {size} of backups to the Recycle Bin", { size: formatBytes(b) }) : t("Those backups are already gone"));
    const gone = new Set(list.map((e) => e.id));
    setBk({ list: (bk.list ?? []).filter((e) => !gone.has(e.id)) });
    dropBackups(list);
  } catch (e) { toast(errorText(e), true); void loadBackups(); }
}

/** Put a mod's files back from a backup. Undo brings the change back (the restore takes a backup of its own). */
async function restoreBackup(e: BackupEntry) {
  const refresh = () => { if (e.game) emitApp({ type: "library-refresh", game: e.game as GameId }); void loadBackups(); };
  try {
    let back = await backups.restore(e.id);
    refresh();
    const flip = async () => { back = await backups.restore(back.id); refresh(); };
    record({ label: t("Restored a mod's files from a backup"), undo: flip, redo: flip });
  } catch (err) { toast(errorText(err), true); }
}

type BkSort = "newest" | "biggest";
type BkAge = "7" | "30" | "all";
let lastBkSort: BkSort = "newest";

export function BackupsPanel({ onPage }: { onPage?: boolean }) {
  const { list } = useBackups();
  const sc = useScope();
  const [sort, setSortState] = useState<BkSort>(lastBkSort);
  const setSort = (s: BkSort) => { lastBkSort = s; setSortState(s); setShown(15); };
  const [shown, setShown] = useState(15);
  const [age, setAge] = useState<BkAge>("30");
  const [busy, setBusy] = useState<string | null>(null);
  // a panel drawn by itself (a search result) reads the folder the first time it shows; the page's own waits for a measure
  useEffect(() => { if (!onPage && !bk.list && !bk.loading) void loadBackups(); }, [onPage]);

  const mine = useMemo(() => {
    const l = (list ?? []).filter((e) => sc === "all" || e.game === sc);
    return sort === "biggest" ? [...l].sort((a, b) => b.bytes - a.bytes) : l;
  }, [list, sc, sort]);
  const cut = age === "all" ? Infinity : Date.now() / 1000 - Number(age) * 86_400;
  const old = mine.filter((e) => e.at < cut);
  const oldBytes = old.reduce((s, e) => s + e.bytes, 0);
  const folder = list?.[0]?.path.replace(/[\\/][^\\/]*$/, "");
  const run = async (key: string, f: () => Promise<void>) => { setBusy(key); try { await f(); } finally { setBusy(null); } };

  return (
    <Panel title={t("Backups")} icon="history" id="disk-backups"
      actions={<>
        <Segmented size="sm" value={sort} onChange={setSort} label={t("Sort backups")} options={[
          { value: "newest", label: t("Newest"), title: t("Newest first") },
          { value: "biggest", label: t("Biggest"), title: t("Biggest first") },
        ]} />
        {folder && <IconButton size="sm" icon="folder" label={t("Open the backups folder")} onClick={() => shell.openPath(folder).catch((e) => toast(errorText(e), true))} />}
      </>}>
      <p className="hint st-bk-intro">{t("Before gachamod changes a mod's files (a fix, a key change, an in-game switch), it copies them here so the change can be undone. It also keeps daily copies of the database.")}</p>
      {!list
        ? <Waiting what={t("Reading backups")} />
        : !mine.length
          ? <p className="hint">{t("No backups.")}</p>
          : <>
            <ul className="st-bks">
              {mine.slice(0, shown).map((e) => (
                <li key={e.id} className="st-bk">
                  <span className="st-bk-t" title={backupTip(e)}>
                    <b>{backupTitle(e)}</b>
                    <span className="hint">{[sc === "all" && e.game ? shortOf(e.game as GameId) : "", e.kind === "mod" && e.files ? tn(e.files, "{n} file", "{n} files") : "", timeAgo(e.at)].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="st-size">{formatBytes(e.bytes)}</span>
                  <span className="st-acts">
                    {e.kind === "mod" && <Button size="sm" variant="ghost" busy={busy === `r:${e.id}`} onClick={() => void run(`r:${e.id}`, () => restoreBackup(e))}
                      title={t("Puts the mod's files back as they were before this change. Undo brings the change back")}>{t("Restore")}</Button>}
                    <IconButton size="sm" icon="folder" label={t("Show in Explorer")} onClick={() => reveal(e.path)} />
                    <IconButton size="sm" icon="trash" label={t("Move to Recycle Bin")} disabled={busy === `d:${e.id}`} onClick={() => void run(`d:${e.id}`, () => recycleBackups([e]))} />
                  </span>
                </li>
              ))}
            </ul>
            {mine.length > shown && <Button size="sm" variant="ghost" className="st-more" onClick={() => setShown(shown + 30)}>{tn(Math.min(30, mine.length - shown), "Show {n} more", "Show {n} more")}</Button>}
            <div className="st-bk-clear">
              <Select value={age} onChange={setAge} title={t("Which backups to move to the Recycle Bin")} options={[
                { value: "7", label: t("Older than a week") },
                { value: "30", label: t("Older than a month") },
                { value: "all", label: t("All backups") },
              ]} />
              <span className="hint">{old.length ? tn(old.length, "{n} backup, {size}", "{n} backups, {size}", { size: formatBytes(oldBytes) }) : t("None")}</span>
              <Button size="sm" disabled={!old.length} busy={busy === "old"} onClick={() => void run("old", () => recycleBackups(old))}
                title={t("Moves these backups to the Recycle Bin, where Windows can still put them back. Changes they belong to can't be undone in gachamod after that")}>{t("Move to Recycle Bin")}</Button>
            </div>
          </>}
    </Panel>
  );
}

/** The Storage page in Settings: the overview, the biggest mods, mods installed twice and the backups. */
export function StoragePage() {
  return <><StoragePanel onPage /><BiggestModsPanel onPage /><DuplicatesPanel onPage /><BackupsPanel onPage /></>;
}

// the page itself; its panels ("Disk space", "Biggest mods", "Mods installed twice", "Backups") are listed by settingsSearch.ts
registerCommands("storage", () => [
  { id: "page:storage", title: t("Storage"), section: "Pages", icon: "box", where: t("Settings"),
    keywords: "disk space storage size cleanup clean free space duplicates big biggest", run: () => go({ view: "settings", section: "disk" }) },
]);
