// Mod fixes: game updates change the hashes and buffer layouts mods target, and the community publishes fixers
// (scripts that rewrite a mod's .ini). The app keeps the fixers' hash tables, knows which hashes a game update broke,
// flags installed mods that still use them and fixes them in one click (with a backup and Undo). A mod that needs
// more than a hash swap (a buffer rewrite) gets the fixer the data names: gachamod downloads it from GameBanana or
// GitHub and runs it on that mod, with a backup and Undo per mod. Owner: FIXES area.
// Rust: crates/gacha-core/src/fixes.rs, fixers.rs.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { backups, errorText, fixers as fixersApi, fixes as fixesApi, type FixAll, type FixTried, type FixerFile, type FixerRun, type GameId, type ModBackup, type ModHealthRow, type ToolLink } from "./api";
import { gbToolId, newestFile, toolPage, type GbFile } from "./gamebanana";
import { record } from "./history";
import { jsonPref, pref } from "./prefs";
import { emitApp, go, onApp } from "./store";
import { plural, timeAgo } from "../ui/kit";
import { toast } from "../ui/toast";
import { oxford } from "./notes";

export interface ModHealth {
  /** "broken": uses hashes a game update changed and a fix is known; "unfixable": broken and gachamod can't fix it
   *  (`tool` can); "fixed": the app fixed it; "ok": nothing known wrong. Mods missing from the map are "ok". */
  status: "broken" | "unfixable" | "fixed" | "ok";
  /** One line each, plain words ("Uses Ellen's hair hash from before 2.0"). */
  reasons: string[];
  /** The game version the broken hashes come from, when known ("1.7"). */
  since?: string | null;
  /** The fixer to run by hand for an "unfixable" mod. */
  tool?: ToolLink | null;
  /** Hash lines a fix changes. */
  swaps?: number;
  /** The game changed the model itself, so no fixer can repair the mod: it needs an update from its author. */
  needsAuthor?: boolean;
  /** The last fixer run on it that left it broken. */
  tried?: FixTried | null;
}

type Tried = Pick<ModHealth, "tried" | "needsAuthor">;
/** A fixer's name without what the fix data adds in brackets ("ZZZ Mod Fixer"). */
export const fixerName = (tool: string) => tool.replace(/\s*\(.*$/, "").replace(/[\s!.?]+$/, "") || tool;
const short = fixerName;
/** What a mod most likely needs when a fixer didn't repair it. */
const NEEDS = "It likely needs an update from its author, or a fix posted for this mod";

/** The fix button's words. Nothing is promised, and after a run that didn't help it is a retry. */
export const fixLabel = (h: Tried) => (h.tried ? "Try again" : "Attempt fix");

/** A mod that is still broken after a fixer ran on it: what the fixer did, and what the mod likely needs. */
export function triedNote(h: Tried): string | null {
  const t = h.tried;
  if (!t) return null;
  const did = t.changed
    ? `${short(t.tool)} changed ${plural(t.changed, "file")} ${timeAgo(t.at)} and the mod is still broken`
    : `${short(t.tool)} ran ${timeAgo(t.at)} and changed no files in this mod`;
  return h.needsAuthor ? did : `${did}. ${NEEDS}`;
}

const EMPTY = new Map<string, ModHealth>();
const NO_ROWS: ModHealthRow[] = [];
const maps = new Map<GameId, Map<string, ModHealth>>();
const lists = new Map<GameId, ModHealthRow[]>();
const loading = new Map<GameId, Promise<void>>();
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

const queued = new Map<GameId, Promise<void>>();
const checkFailed = new Map<GameId, unknown>();

/** Check a game's mods again. Errors stay quiet: health is a hint, not something to interrupt for. `fresh` is for
 *  after a change to the mods: a check already running may have read them before the change, so one more runs
 *  once it is done (shared by everyone who asked meanwhile). */
export function reloadHealth(game: GameId, fresh = false): Promise<void> {
  const busy = loading.get(game);
  if (busy && !fresh) return busy;
  if (busy) {
    let next = queued.get(game);
    if (!next) {
      next = busy.then(() => { queued.delete(game); return reloadHealth(game); });
      queued.set(game, next);
    }
    return next;
  }
  const p = fixesApi.health(game).then((rows) => {
    checkFailed.delete(game);
    lists.set(game, rows);
    maps.set(game, new Map(rows.map((r) => [r.modId, { status: r.status, reasons: r.reasons, since: r.since, tool: r.tool, swaps: r.swaps, needsAuthor: r.needsAuthor, tried: r.tried }])));
    notify();
    healthListeners.forEach((f) => f(game, rows));
  }).catch((e) => { checkFailed.set(game, e); }).finally(() => loading.delete(game));
  loading.set(game, p);
  return p;
}

/** Check again because someone asked: a check that fails says so, since an unchanged list would read as "all fine". */
export async function checkHealth(game: GameId): Promise<void> {
  await reloadHealth(game, true);
  const e = checkFailed.get(game);
  if (e) toast(`Couldn't check the mods: ${errorText(e)}`, true);
}

// a scan, an install or an undo changed a game's mods: check that game again (once things settle)
const timers = new Map<GameId, number>();
onApp((e) => {
  if (e.type !== "library-refresh" || !maps.has(e.game)) return;
  clearTimeout(timers.get(e.game));
  timers.set(e.game, window.setTimeout(() => void reloadHealth(e.game, true), 700));
});

/** Off mutes the broken-mod warnings: mod cards, a mod's details and the Problems filter in Mods stop showing them,
 *  and Tools > Fixes folds its list away. The Mute button in Tools > Fixes and Settings > Mods a game update broke share it. */
export const fixWarningsPref = pref<boolean>("fixes.warn", true, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));

// ── dead ends: broken mods no fix here will help ──

/** A broken mod nothing in gachamod is likely to fix: the game changed its model, no fixer is known for it, or its
 *  fixer already ran and left it broken. It needs an update from its author. */
export const isDeadEnd = (h: Pick<ModHealth, "status" | "needsAuthor" | "tool" | "tried">) =>
  h.status === "unfixable" && (!!h.needsAuthor || !h.tool || !!h.tried);

/** Muted dead ends per game, as "<modId>#<what's wrong>": a mod whose problem changes (another update) shows again. */
export const mutedPref = jsonPref<Record<string, string[]>>("fixes.muted", {});
/** Turn off and mute dead ends as soon as a check finds them. Off by default. */
export const autoMutePref = pref<boolean>("fixes.autoMute", false, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));

const sig = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
export const muteKey = (modId: string, h: Pick<ModHealth, "reasons">) => `${modId}#${sig(h.reasons.join("\n"))}`;
export const isMuted = (muted: Record<string, string[]>, game: GameId, modId: string, h: Pick<ModHealth, "reasons">) =>
  !!muted[game]?.includes(muteKey(modId, h));

/** Called after each check with the game's rows (Tools > Fixes turns dead ends off when autoMutePref is on). */
const healthListeners = new Set<(game: GameId, rows: ModHealthRow[]) => void>();
export function onHealth(f: (game: GameId, rows: ModHealthRow[]) => void) { healthListeners.add(f); return () => { healthListeners.delete(f); }; }

/** Health of every installed mod of a game, keyed by mod id. Updates when a scan or fix finishes. Empty while the
 *  warnings are muted, and leaves out the mods muted one by one. */
export function useModHealth(game: GameId | null | undefined): Map<string, ModHealth> {
  const warn = fixWarningsPref.use();
  const muted = mutedPref.use();
  const map = useSyncExternalStore(subscribe, () => (game && warn ? maps.get(game) ?? EMPTY : EMPTY));
  useEffect(() => { if (game && warn && !maps.has(game)) void reloadHealth(game); }, [game, warn]);
  return useMemo(() => {
    if (!game || !muted[game]?.length) return map;
    return new Map([...map].filter(([id, h]) => !isMuted(muted, game, id, h)));
  }, [map, muted, game]);
}

/** The mods a game update broke (and the ones gachamod fixed), with their names, for Tools > Fixes. null until the
 *  first check is done. */
export function useHealthRows(game: GameId): ModHealthRow[] | null {
  const rows = useSyncExternalStore(subscribe, () => (maps.has(game) ? lists.get(game) ?? NO_ROWS : null));
  useEffect(() => { if (!maps.has(game)) void reloadHealth(game); }, [game]);
  return rows;
}

/** The last known health of a game's mods (for menus and panels outside React's tree). */
export const healthNow = (game: GameId) => maps.get(game) ?? EMPTY;

/** Record fixes so Undo restores every changed mod (and Redo makes the fixes again). */
function recordFixes(game: GameId, label: string, changed: ModBackup[]) {
  let next = changed.slice();
  const flip = async () => {
    const out: ModBackup[] = [];
    let failed: unknown = null;
    for (const c of next) {
      try { out.push({ ...c, backup: await backups.restore(c.backup.id) }); } catch (e) { failed ??= e; out.push(c); }
    }
    next = out;
    emitApp({ type: "library-refresh", game });
    void reloadHealth(game, true);
    if (failed) throw failed;
  };
  record({ label, undo: flip, redo: flip });
}

const VIEW_FIXES = { label: "View in Fixes", run: () => go({ view: "tools", section: "fixes" }) };

/** What a fix run says about the mods it left alone ("Velina: the model changed, so it needs an update from its
 *  author"). */
function skippedNote(r: FixAll): string {
  if (!r.skipped.length) return "";
  // the same reason for several mods reads once: "A, B, and C: the model changed, so it needs an update from its author"
  const byReason = new Map<string, string[]>();
  for (const s of r.skipped) byReason.set(s.reason, [...(byReason.get(s.reason) ?? []), s.name]);
  const parts = [...byReason].map(([reason, names]) => `${oxford(names, 4)}: ${reason}`);
  return parts.length > 3 ? `${parts.slice(0, 3).join(". ")}. And ${parts.length - 3} more reasons` : parts.join(". ");
}

/** Try to fix these mods: outdated hashes are swapped here, and a mod that needs more gets its fixer run on it.
 *  Resolves to how many were changed. Each change can be undone. A fixer that leaves a mod broken is remembered
 *  (health's `tried`), and the mod can always be tried again. */
export async function fixMods(game: GameId, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  if (!maps.has(game)) await reloadHealth(game);
  const health = healthNow(game);
  // a mod whose fixer is running already (asked twice) is left to that run
  const asked = ids.length;
  ids = ids.filter((id) => !fixerBusy.has(`mod:${id}`));
  if (!ids.length) { toast(asked === 1 ? "A fixer is already running on that mod" : "A fixer is already running on those mods"); return 0; }
  const needFixer = ids.filter((id) => health.get(id)?.status === "unfixable" && health.get(id)?.tool);
  const swap = ids.filter((id) => !needFixer.includes(id));
  let n = swap.length ? await swapHashes(game, swap) : 0;
  if (needFixer.length) n += await runFixers(game, needFixer.map((id) => ({ modId: id, tool: health.get(id)!.tool! })));
  return n;
}

async function swapHashes(game: GameId, ids: string[]): Promise<number> {
  let r: FixAll;
  try { r = await fixesApi.apply(game, ids); } catch (e) { toast(errorText(e), true); return 0; }
  if (r.changed.length) {
    const label = r.changed.length === 1 ? `Fixed ${r.changed[0]!.name} for the game update` : `Fixed ${r.changed.length} mods for the game update`;
    recordFixes(game, label, r.changed);
    emitApp({ type: "library-refresh", game });
    if (r.skipped.length) toast(skippedNote(r), false, VIEW_FIXES);
  } else if (r.skipped.length) {
    toast(skippedNote(r), true, VIEW_FIXES);
  } else {
    toast("Nothing there could be fixed automatically");
  }
  void reloadHealth(game, true);
  return r.changed.length;
}

// ── fixers downloaded from GameBanana ──

const NO_FILES: FixerFile[] = [];
const fixerLists = new Map<GameId, FixerFile[]>();
const fixerLoading = new Set<GameId>();
/** "tool:<id>" and "file:<id>" while a download runs. */
let fixerBusy: ReadonlySet<string> = new Set();
const setBusy = (key: string, on: boolean) => {
  const next = new Set(fixerBusy);
  if (on) next.add(key); else next.delete(key);
  fixerBusy = next;
  notify();
};

function loadFixers(game: GameId) {
  if (fixerLoading.has(game)) return;
  fixerLoading.add(game);
  fixersApi.list(game).then((l) => { fixerLists.set(game, l); notify(); }).catch(() => {}).finally(() => fixerLoading.delete(game));
}

/** The fixer files downloaded for a game. */
export function useFixerFiles(game: GameId | null | undefined): FixerFile[] {
  const list = useSyncExternalStore(subscribe, () => (game ? fixerLists.get(game) ?? NO_FILES : NO_FILES));
  useEffect(() => { if (game && !fixerLists.has(game)) loadFixers(game); }, [game]);
  return list;
}

/** Downloads running now ("tool:<id>", "file:<id>"). */
export function useFixerBusy(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => fixerBusy);
}

/** Download one file of a GameBanana tool into the fixers folder. Says so in a toast with Show. */
export async function downloadFixer(game: GameId, tool: { id: number; name: string }, file: GbFile): Promise<FixerFile | null> {
  const key = `file:${file.id}`;
  if (fixerBusy.has(key)) return null;
  setBusy(key, true);
  try {
    const f = await fixersApi.download(game, { toolId: tool.id, fileId: file.id, tool: tool.name, file: file.name, url: file.downloadUrl, md5: file.md5 });
    fixerLists.set(game, [...(fixerLists.get(game) ?? []).filter((x) => x.fileId !== f.fileId), f]);
    toast(`Downloaded ${tool.name}`);
    return f;
  } catch (e) {
    toast(errorText(e), true);
    return null;
  } finally {
    setBusy(key, false);
  }
}

/** Download a tool's newest file (the one-click Download in Tools > Fixes). */
export async function downloadNewestFixer(game: GameId, toolId: number): Promise<FixerFile | null> {
  const key = `tool:${toolId}`;
  if (fixerBusy.has(key)) return null;
  setBusy(key, true);
  try {
    const tool = await toolPage(toolId);
    const file = tool && newestFile(tool);
    if (!tool || !file) { toast(tool ? `${tool.name} has no file to download on GameBanana` : "GameBanana didn't send this fixer's page", true); return null; }
    return await downloadFixer(game, tool, file);
  } catch (e) {
    toast(errorText(e), true);
    return null;
  } finally {
    setBusy(key, false);
  }
}

// ── running a fixer on the mods that need it ──

/** The fixer a link names, ready to run: GameBanana's newest file for the tool (once GameBanana's virus check passed
 *  it), or the newest release of a GitHub project. A copy already downloaded is used when it's still the newest. */
async function getFixer(game: GameId, tool: ToolLink): Promise<FixerFile> {
  const id = gbToolId(tool.url);
  let f: FixerFile;
  if (id === null) {
    f = await fixersApi.github(game, tool.url, tool.name);
  } else {
    const page = await toolPage(id);
    const file = page && newestFile(page);
    if (!page || !file) throw new Error(page ? `GameBanana has no file for ${tool.name}` : `GameBanana didn't send ${tool.name}'s page`);
    if (file.analysis === "pending") throw new Error(`GameBanana is still checking ${tool.name}'s newest file for viruses. Try again in a few minutes`);
    if (file.analysis && file.analysis !== "clean") throw new Error(`GameBanana's virus check flagged ${tool.name}'s newest file, so gachamod won't run it`);
    const have = (fixerLists.get(game) ?? (await fixersApi.list(game))).find((x) => x.fileId === file.id);
    f = have ?? await fixersApi.download(game, { toolId: id, fileId: file.id, tool: page.name || tool.name, file: file.name, url: file.downloadUrl, md5: file.md5 });
  }
  fixerLists.set(game, [...(fixerLists.get(game) ?? []).filter((x) => x.fileId !== f.fileId), f]);
  notify();
  return f;
}

/** A fixer's window is being watched (useFixerBusy has "waiting"): stop, and go by what it changed so far. */
export const stopWaiting = () => { void fixersApi.stopWaiting().catch(() => {}); };

/** Run the fixer each mod needs on it. One Undo step per mod that changed. Resolves to how many changed. */
async function runFixers(game: GameId, rows: Array<{ modId: string; tool: ToolLink }>): Promise<number> {
  const byTool = new Map<string, { tool: ToolLink; ids: string[] }>();
  for (const r of rows) byTool.set(r.tool.url, { tool: r.tool, ids: [...(byTool.get(r.tool.url)?.ids ?? []), r.modId] });
  /** `quiet`: a mod nobody asked about that the fixer's one run covered too. Its result shows on the mod, not in a toast. */
  const done: Array<{ run: FixerRun; tool: string; quiet?: boolean }> = [];
  const named = short;
  for (const { tool, ids } of byTool.values()) {
    ids.forEach((id) => setBusy(`mod:${id}`, true));
    try {
      let f: FixerFile;
      try { f = await getFixer(game, tool); } catch (e) { toast(`Couldn't get ${tool.name}: ${errorText(e)}`, true); continue; }
      if (f.window) {
        // it opens its own window and goes through the whole Mods folder there: one run covers every mod that
        // needs it, so the window doesn't come back for each of them
        const rest = [...healthNow(game)].filter(([id, h]) => h.status === "unfixable" && h.tool?.url === tool.url && !ids.includes(id) && !fixerBusy.has(`mod:${id}`)).map(([id]) => id);
        rest.forEach((id) => setBusy(`mod:${id}`, true));
        setBusy("waiting", true);
        toast(`${named(f.tool)} is open in its own window. Run it there. gachamod sees what it changes, so the window can stay open`, false, { label: "Stop waiting", run: stopWaiting });
        try {
          const runs = await fixersApi.runAll(game, f.fileId, [...ids, ...rest]);
          for (const run of runs) done.push({ run, tool: named(f.tool), quiet: !ids.includes(run.modId) });
        } catch (e) { toast(errorText(e), true); }
        finally { setBusy("waiting", false); rest.forEach((id) => setBusy(`mod:${id}`, false)); }
        continue;
      }
      for (const id of ids) {
        try { done.push({ run: await fixersApi.run(game, f.fileId, id), tool: named(f.tool) }); }
        catch (e) { toast(errorText(e), true); }
        finally { setBusy(`mod:${id}`, false); }
      }
    } finally {
      ids.forEach((id) => setBusy(`mod:${id}`, false));
    }
  }
  if (!done.length) return 0;
  emitApp({ type: "library-refresh", game });
  await reloadHealth(game, true);
  const after = healthNow(game);
  let changed = 0;
  for (const { run: r, tool, quiet } of done) {
    const view = { label: "View mod", run: () => go({ view: "library", modId: r.modId }) };
    if (!r.backup) {
      if (!quiet) toast(r.stopped
        ? `${tool} was still running on ${r.name} after 2 minutes, so gachamod stopped it. It changed no files`
        : `${tool} changed no files in ${r.name}. ${NEEDS}`, true, view);
      continue;
    }
    changed++;
    const still = ["broken", "unfixable"].includes(after.get(r.modId)?.status ?? "");
    recordFixes(game, still ? `Ran ${tool} on ${r.name}` : `Fixed ${r.name} with ${tool}`, [{ modId: r.modId, name: r.name, backup: r.backup }]);
    if (still && !quiet) toast(`${tool} changed ${plural(r.changed, "file")} in ${r.name} and it is still broken. ${NEEDS}. Undo puts its files back`, true, view);
  }
  return changed;
}
