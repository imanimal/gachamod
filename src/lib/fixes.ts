// Mod fixes: game updates change the hashes and buffer layouts mods target, and the community publishes fixers
// (scripts that rewrite a mod's .ini). The app keeps the fixers' hash tables, knows which hashes a game update broke,
// flags installed mods that still use them and fixes them in one click (with a backup and Undo). Mods that need more
// than a hash swap (a buffer rewrite) are marked with the fixer that does it, which the player can download from
// GameBanana here (gachamod never runs it). Owner: FIXES area.
// Rust: crates/gacha-core/src/fixes.rs, fixers.rs.
import { useEffect, useSyncExternalStore } from "react";
import { backups, errorText, fixers as fixersApi, fixes as fixesApi, shell, type FixAll, type FixerFile, type GameId, type ModBackup, type ModHealthRow, type ToolLink } from "./api";
import { newestFile, toolPage, type GbFile } from "./gamebanana";
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

/** What a fix run says about the mods it left alone ("Velina needs ZZZ Mod Fixer ..."). */
function skippedNote(r: FixAll): string {
  if (!r.skipped.length) return "";
  const first = r.skipped[0]!;
  return r.skipped.length === 1 ? `${first.name}: ${first.reason}` : `${r.skipped.length} others need a fixer gachamod can't run. Tools > Fixes has the links`;
}

/** Fix these mods (the ones that can be fixed). Resolves to how many were changed. Records an Undo step. */
export async function fixMods(game: GameId, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
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

/** Show a downloaded fixer in File Explorer. */
export function showFixer(f: FixerFile) {
  void shell.revealPath(f.main).catch((e) => toast(errorText(e), true));
}

/** Download one file of a GameBanana tool into the fixers folder. Says so in a toast with Show. */
export async function downloadFixer(game: GameId, tool: { id: number; name: string }, file: GbFile): Promise<FixerFile | null> {
  const key = `file:${file.id}`;
  if (fixerBusy.has(key)) return null;
  setBusy(key, true);
  try {
    const f = await fixersApi.download(game, { toolId: tool.id, fileId: file.id, tool: tool.name, file: file.name, url: file.downloadUrl, md5: file.md5 });
    fixerLists.set(game, [...(fixerLists.get(game) ?? []).filter((x) => x.fileId !== f.fileId), f]);
    toast(`Downloaded ${tool.name}`, false, { label: "Show", run: () => showFixer(f) });
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
