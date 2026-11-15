// Mod fixes: game updates change the hashes and buffer layouts mods target, and the community publishes fixers
// (scripts that rewrite a mod's .ini). The app keeps the fixers' hash tables, knows which hashes a game update broke,
// flags installed mods that still use them and fixes them in one click (with a backup and Undo). A mod that needs
// more than a hash swap (a buffer rewrite) gets the fixer the data names: gachamod downloads it from GameBanana or
// GitHub and runs it on that mod, with a backup and Undo per mod. Owner: FIXES area.
// Rust: crates/gacha-core/src/fixes.rs, fixers.rs.
import { useEffect, useSyncExternalStore } from "react";
import { backups, errorText, fixers as fixersApi, fixes as fixesApi, type FixAll, type FixerFile, type FixerRun, type GameId, type ModBackup, type ModHealthRow, type ToolLink } from "./api";
import { gbToolId, newestFile, toolPage, type GbFile } from "./gamebanana";
import { record } from "./history";
import { emitApp, onApp } from "./store";
import { toast } from "../ui/toast";

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
}

const EMPTY = new Map<string, ModHealth>();
const NO_ROWS: ModHealthRow[] = [];
const maps = new Map<GameId, Map<string, ModHealth>>();
const lists = new Map<GameId, ModHealthRow[]>();
const loading = new Map<GameId, Promise<void>>();
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Check a game's mods again. Errors stay quiet: health is a hint, not something to interrupt for. */
export function reloadHealth(game: GameId): Promise<void> {
  const busy = loading.get(game);
  if (busy) return busy;
  const p = fixesApi.health(game).then((rows) => {
    lists.set(game, rows);
    maps.set(game, new Map(rows.map((r) => [r.modId, { status: r.status, reasons: r.reasons, since: r.since, tool: r.tool, swaps: r.swaps }])));
    notify();
  }).catch(() => {}).finally(() => loading.delete(game));
  loading.set(game, p);
  return p;
}

// a scan, an install or an undo changed a game's mods: check that game again (once things settle)
const timers = new Map<GameId, number>();
onApp((e) => {
  if (e.type !== "library-refresh" || !maps.has(e.game)) return;
  clearTimeout(timers.get(e.game));
  timers.set(e.game, window.setTimeout(() => void reloadHealth(e.game), 700));
});

/** Health of every installed mod of a game, keyed by mod id. Updates when a scan or fix finishes. */
export function useModHealth(game: GameId | null | undefined): Map<string, ModHealth> {
  const map = useSyncExternalStore(subscribe, () => (game ? maps.get(game) ?? EMPTY : EMPTY));
  useEffect(() => { if (game && !maps.has(game)) void reloadHealth(game); }, [game]);
  return map;
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
    void reloadHealth(game);
    if (failed) throw failed;
  };
  record({ label, undo: flip, redo: flip });
}

/** What a fix run says about the mods it left alone ("Velina: the model changed, so it needs an update from its
 *  author"). */
function skippedNote(r: FixAll): string {
  if (!r.skipped.length) return "";
  const first = r.skipped[0]!;
  return r.skipped.length === 1 ? `${first.name}: ${first.reason}` : `${r.skipped.length} others couldn't be fixed. Tools > Fixes says why for each`;
}

/** Fix these mods: outdated hashes are swapped here, and a mod that needs more gets its fixer run on it. Resolves to
 *  how many were changed. Each change can be undone. */
export async function fixMods(game: GameId, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  if (!maps.has(game)) await reloadHealth(game);
  const health = healthNow(game);
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
    if (r.skipped.length) toast(skippedNote(r));
  } else if (r.skipped.length) {
    toast(skippedNote(r), true);
  } else {
    toast("Nothing there could be fixed automatically");
  }
  void reloadHealth(game);
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

/** Run the fixer each mod needs on it. One Undo step per mod that changed. Resolves to how many changed. */
async function runFixers(game: GameId, rows: Array<{ modId: string; tool: ToolLink }>): Promise<number> {
  const byTool = new Map<string, { tool: ToolLink; ids: string[] }>();
  for (const r of rows) byTool.set(r.tool.url, { tool: r.tool, ids: [...(byTool.get(r.tool.url)?.ids ?? []), r.modId] });
  const done: Array<{ run: FixerRun; tool: string }> = [];
  const named = (t: string) => t.replace(/[\s!.?]+$/, "");
  for (const { tool, ids } of byTool.values()) {
    ids.forEach((id) => setBusy(`mod:${id}`, true));
    try {
      let f: FixerFile;
      try { f = await getFixer(game, tool); } catch (e) { toast(`Couldn't get ${tool.name}: ${errorText(e)}`, true); continue; }
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
  await reloadHealth(game);
  const after = healthNow(game);
  let changed = 0;
  for (const { run: r, tool } of done) {
    if (!r.backup) {
      toast(`${tool} changed nothing in ${r.name}${r.stopped ? ". It was still running after 2 minutes, so gachamod stopped it" : ""}`, true);
      continue;
    }
    changed++;
    const still = ["broken", "unfixable"].includes(after.get(r.modId)?.status ?? "");
    recordFixes(game, still ? `Ran ${tool} on ${r.name}` : `Fixed ${r.name} with ${tool}`, [{ modId: r.modId, name: r.name, backup: r.backup }]);
    if (still) toast(`${r.name} still looks broken after ${tool}. Undo puts its files back`, true);
  }
  return changed;
}
