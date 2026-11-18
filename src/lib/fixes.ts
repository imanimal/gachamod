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
import { timeAgo } from "../ui/kit";
import { stops, t, tb, tn } from "./i18n";
import { toast } from "../ui/toast";
import { oxford } from "./notes";
import { holdsPref, useHolds } from "./holds";

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
const NEEDS = t("It likely needs an update from its author, or a fix posted for this mod");

/** The fix button's words. Nothing is promised, and after a run that didn't help it is a retry. */
export const fixLabel = (h: Tried) => (h.tried ? t("Try again") : t("Attempt fix"));

/** A mod that is still broken after a fixer ran on it: what the fixer did, and what the mod likely needs. */
export function triedNote(h: Tried): string | null {
  const run = h.tried;
  if (!run) return null;
  const p = { tool: short(run.tool), when: timeAgo(run.at) };
  const did = run.changed
    ? tn(run.changed, "{tool} changed {n} file {when} and the mod is still broken", "{tool} changed {n} files {when} and the mod is still broken", p)
    : t("{tool} ran {when} and changed no files in this mod", p);
  return h.needsAuthor ? did : t("{note}. {needs}", { note: did, needs: NEEDS });
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
    maps.set(game, new Map(rows.map((r) => [r.modId, { status: r.status, reasons: r.reasons.map((x) => tb(x)), since: r.since, tool: r.tool, swaps: r.swaps, needsAuthor: r.needsAuthor, tried: r.tried }])));
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
  if (e) toast(t("Couldn't check the mods: {error}", { error: errorText(e) }), true);
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

/** Mutes from before holds.ts, per game, as "<modId>#<what's wrong>". Read once to move them into holds. */
const mutedPref = jsonPref<Record<string, string[]>>("fixes.muted", {});
let moved = false;
/** Old mutes become waits for an update (holds.ts), which take the mod's version the next time the list loads. */
async function moveMutes() {
  if (moved) return;
  moved = true;
  await Promise.all([mutedPref.ready, holdsPref.ready]);
  const old = mutedPref.get();
  if (!Object.values(old).some((l) => l.length)) return;
  const all = { ...holdsPref.get() };
  for (const [game, keys] of Object.entries(old)) {
    const mine = { ...(all[game] ?? {}) };
    for (const k of keys) { const id = k.split("#")[0]!; mine[id] ??= { kind: "update", at: Date.now() }; }
    all[game] = mine;
  }
  await holdsPref.set(all);
  await mutedPref.set({});
}
/** Turn off and mute dead ends as soon as a check finds them. Off by default. */
export const autoMutePref = pref<boolean>("fixes.autoMute", false, (r) => (r === "1" ? true : r === "0" ? false : undefined), (v) => (v ? "1" : "0"));


/** Called after each check with the game's rows (Tools > Fixes turns dead ends off when autoMutePref is on). */
const healthListeners = new Set<(game: GameId, rows: ModHealthRow[]) => void>();
export function onHealth(f: (game: GameId, rows: ModHealthRow[]) => void) { healthListeners.add(f); return () => { healthListeners.delete(f); }; }

/** Health of every installed mod of a game, keyed by mod id. Updates when a scan or fix finishes. Empty while the
 *  warnings are muted, and leaves out the mods whose problems were set aside (holds.ts). */
export function useModHealth(game: GameId | null | undefined): Map<string, ModHealth> {
  const warn = fixWarningsPref.use();
  const holds = useHolds(game);
  const map = useSyncExternalStore(subscribe, () => (game && warn ? maps.get(game) ?? EMPTY : EMPTY));
  useEffect(() => { if (game && warn && !maps.has(game)) void reloadHealth(game); }, [game, warn]);
  useEffect(() => { void moveMutes(); }, []);
  return useMemo(() => {
    if (!game || !Object.keys(holds).length) return map;
    return new Map([...map].filter(([id]) => !holds[id]));
  }, [map, holds, game]);
}

/** The mods a game update broke (and the ones gachamod fixed), with their names, for Tools > Fixes. null until the
 *  first check is done. */
export function useHealthRows(game: GameId): ModHealthRow[] | null {
  const rows = useSyncExternalStore(subscribe, () => (maps.has(game) ? lists.get(game) ?? NO_ROWS : null));
  useEffect(() => { if (!maps.has(game)) void reloadHealth(game); }, [game]);
  return rows;
}

/** Mods a game update broke that are on and not set aside (holds.ts), for the Tools badge. Empty while the warnings
 *  are muted, null until the first check is done. */
export function useBrokenOn(game: GameId | null | undefined): string[] | null {
  const warn = fixWarningsPref.use();
  const holds = useHolds(game);
  const rows = useSyncExternalStore(subscribe, () => (game && maps.has(game) ? lists.get(game) ?? NO_ROWS : null));
  useEffect(() => { if (game && warn && !maps.has(game)) void reloadHealth(game); }, [game, warn]);
  return useMemo(() => {
    if (!rows) return null;
    if (!warn) return [];
    return rows.filter((r) => r.enabled && (r.status === "broken" || r.status === "unfixable") && !holds[r.modId]).map((r) => r.modId);
  }, [rows, warn, holds]);
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

const VIEW_FIXES = { label: t("View in Fixes"), run: () => go({ view: "tools", section: "fixes" }) };

/** What a fix run says about the mods it left alone ("Velina: the model changed, so it needs an update from its
 *  author"). */
function skippedNote(r: FixAll): string {
  if (!r.skipped.length) return "";
  // the same reason for several mods reads once: "A, B, and C: the model changed, so it needs an update from its author"
  const byReason = new Map<string, string[]>();
  for (const s of r.skipped) byReason.set(s.reason, [...(byReason.get(s.reason) ?? []), s.name]);
  const parts = [...byReason].map(([reason, names]) => t("{names}: {reason}", { names: oxford(names, 4), reason: tb(reason) }));
  return parts.length > 3
    ? tn(parts.length - 3, "{notes}. And {n} more reason", "{notes}. And {n} more reasons", { notes: stops(parts.slice(0, 3)) })
    : stops(parts);
}

/** Try to fix these mods: outdated hashes are swapped here, and a mod that needs more gets its fixer run on it.
 *  Resolves to how many were changed. The whole run is one Undo step and one toast. A fixer that leaves a mod broken
 *  is remembered (health's `tried`), and the mod can always be tried again. */
export async function fixMods(game: GameId, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  if (!maps.has(game)) await reloadHealth(game);
  const health = healthNow(game);
  // a mod whose fixer is running already (asked twice) is left to that run
  const asked = ids.length;
  ids = ids.filter((id) => !fixerBusy.has(`mod:${id}`));
  if (!ids.length) { toast(asked === 1 ? t("A fixer is already running on that mod") : t("A fixer is already running on those mods")); return 0; }
  const needFixer = ids.filter((id) => health.get(id)?.status === "unfixable" && health.get(id)?.tool);
  const swap = ids.filter((id) => !needFixer.includes(id));
  const out: FixOutcome = { changed: [], notes: [], errors: [], untouched: 0 };
  if (swap.length) await swapHashes(game, swap, out);
  if (needFixer.length) await runFixers(game, needFixer.map((id) => ({ modId: id, tool: health.get(id)!.tool! })), out);
  if (out.changed.length) emitApp({ type: "library-refresh", game });
  await reloadHealth(game, true);
  const after = healthNow(game);
  const still = (id: string) => ["broken", "unfixable"].includes(after.get(id)?.status ?? "");
  const changed = out.changed.map((c) => c.b);
  const fixedN = out.changed.filter((c) => !still(c.b.modId)).length;
  const stillN = out.changed.length - fixedN + out.untouched;
  if (changed.length) {
    const one = out.changed.length === 1 ? out.changed[0]! : null;
    const label = one
      ? (one.tool
        ? (still(one.b.modId) ? t("Ran {tool} on {name}", { tool: one.tool, name: one.b.name }) : t("Fixed {name} with {tool}", { tool: one.tool, name: one.b.name }))
        : t("Fixed {name} for the game update", { name: one.b.name }))
      : fixedN === changed.length
        ? tn(changed.length, "Fixed {n} mod for the game update", "Fixed {n} mods for the game update")
        : tn(changed.length, "Tried to fix {n} mod", "Tried to fix {n} mods");
    recordFixes(game, label, changed);
  }
  // one toast: a single mod gets its own story, several get a count and the way to the list
  const lines: string[] = [];
  let view: { label: string; run: () => void } | undefined = VIEW_FIXES;
  if (ids.length === 1) {
    const id = ids[0]!;
    const c = out.changed.find((x) => x.b.modId === id);
    if (c && !still(id)) lines.push(c.tool ? t("Fixed {name} with {tool}", { tool: c.tool, name: c.b.name }) : t("Fixed {name}", { name: c.b.name }));
    else if (c) {
      const did = c.tool
        ? tn(c.files ?? 1, "{tool} changed {n} file in {name} and it is still broken", "{tool} changed {n} files in {name} and it is still broken", { tool: c.tool, name: c.b.name })
        : t("Swapped the outdated hashes in {name} and it is still broken", { name: c.b.name });
      lines.push(t("{note}. {needs}", { note: did, needs: NEEDS }));
    }
    lines.push(...out.notes, ...out.errors);
    view = { label: t("View mod"), run: () => go({ view: "library", modId: id }) };
  } else {
    const fixedLine = tn(fixedN, "Fixed {n} mod", "Fixed {n} mods"), stillLine = tn(stillN, "{n} still broken", "{n} still broken");
    if (fixedN && stillN) lines.push(t("{fixed}, {still}", { fixed: fixedLine, still: stillLine }));
    else if (fixedN) lines.push(fixedLine);
    else if (stillN) lines.push(stillLine);
    lines.push(...out.errors);
  }
  if (!lines.length) { lines.push(t("Nothing there could be fixed automatically")); view = undefined; }
  toast(changed.length ? t("{text}. Undo puts the files back", { text: stops(lines) }) : stops(lines), !fixedN && (stillN > 0 || out.errors.length > 0), view);
  return changed.length;
}

/** What one Attempt fix did, gathered for its one Undo step and one toast. */
interface FixOutcome {
  /** Mods that changed, with the fixer's name when one ran. */
  changed: Array<{ b: ModBackup; tool?: string; files?: number }>;
  /** Plain lines about mods left as they were, for a single mod's toast. */
  notes: string[];
  /** What went wrong getting or running a fixer. */
  errors: string[];
  /** Mods asked about that nothing changed. */
  untouched: number;
}

async function swapHashes(game: GameId, ids: string[], out: FixOutcome) {
  let r: FixAll;
  try { r = await fixesApi.apply(game, ids); } catch (e) { out.errors.push(errorText(e)); return; }
  for (const b of r.changed) out.changed.push({ b });
  if (r.skipped.length) { out.notes.push(skippedNote(r)); out.untouched += r.skipped.length; }
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
    toast(t("Downloaded {name}", { name: tool.name }));
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
    if (!tool || !file) { toast(tool ? t("{name} has no file to download on GameBanana", { name: tool.name }) : t("GameBanana didn't send this fixer's page"), true); return null; }
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
    if (!page || !file) throw new Error(page ? t("GameBanana has no file for {name}", { name: tool.name }) : t("GameBanana didn't send {name}'s page", { name: tool.name }));
    if (file.analysis === "pending") throw new Error(t("GameBanana is still checking {name}'s newest file for viruses. Try again in a few minutes", { name: tool.name }));
    if (file.analysis && file.analysis !== "clean") throw new Error(t("GameBanana's virus check flagged {name}'s newest file, so gachamod won't run it", { name: tool.name }));
    const have = (fixerLists.get(game) ?? (await fixersApi.list(game))).find((x) => x.fileId === file.id);
    f = have ?? await fixersApi.download(game, { toolId: id, fileId: file.id, tool: page.name || tool.name, file: file.name, url: file.downloadUrl, md5: file.md5 });
  }
  fixerLists.set(game, [...(fixerLists.get(game) ?? []).filter((x) => x.fileId !== f.fileId), f]);
  notify();
  return f;
}

/** A fixer's window is being watched (useFixerBusy has "waiting"): stop, and go by what it changed so far. */
export const stopWaiting = () => { void fixersApi.stopWaiting().catch(() => {}); };

/** Run the fixer each mod needs on it, adding what happened to `out`. */
async function runFixers(game: GameId, rows: Array<{ modId: string; tool: ToolLink }>, out: FixOutcome) {
  const byTool = new Map<string, { tool: ToolLink; ids: string[] }>();
  for (const r of rows) byTool.set(r.tool.url, { tool: r.tool, ids: [...(byTool.get(r.tool.url)?.ids ?? []), r.modId] });
  /** `quiet`: a mod nobody asked about that the fixer's one run covered too. Its result shows on the mod, not in a toast. */
  const done: Array<{ run: FixerRun; tool: string; quiet?: boolean }> = [];
  const named = short;
  for (const { tool, ids } of byTool.values()) {
    ids.forEach((id) => setBusy(`mod:${id}`, true));
    try {
      let f: FixerFile;
      try { f = await getFixer(game, tool); } catch (e) { out.errors.push(t("Couldn't get {name}: {error}", { name: tool.name, error: errorText(e) })); out.untouched += ids.length; continue; }
      if (f.window) {
        // it opens its own window and goes through the whole Mods folder there: one run covers every mod that
        // needs it, so the window doesn't come back for each of them
        const rest = [...healthNow(game)].filter(([id, h]) => h.status === "unfixable" && h.tool?.url === tool.url && !ids.includes(id) && !fixerBusy.has(`mod:${id}`)).map(([id]) => id);
        rest.forEach((id) => setBusy(`mod:${id}`, true));
        setBusy("waiting", true);
        toast(t("{tool} is open in a separate window. Run it there. gachamod sees what it changes, so the window can stay open", { tool: named(f.tool) }), false, { label: t("Stop waiting"), run: stopWaiting });
        try {
          const runs = await fixersApi.runAll(game, f.fileId, [...ids, ...rest]);
          for (const run of runs) done.push({ run, tool: named(f.tool), quiet: !ids.includes(run.modId) });
        } catch (e) { out.errors.push(errorText(e)); }
        finally { setBusy("waiting", false); rest.forEach((id) => setBusy(`mod:${id}`, false)); }
        continue;
      }
      for (const id of ids) {
        try { done.push({ run: await fixersApi.run(game, f.fileId, id), tool: named(f.tool) }); }
        catch (e) { out.errors.push(errorText(e)); out.untouched++; }
        finally { setBusy(`mod:${id}`, false); }
      }
    } finally {
      ids.forEach((id) => setBusy(`mod:${id}`, false));
    }
  }
  for (const { run: r, tool, quiet } of done) {
    if (r.backup) { out.changed.push({ b: { modId: r.modId, name: r.name, backup: r.backup }, tool, files: r.changed }); continue; }
    if (quiet) continue;
    out.untouched++;
    out.notes.push(r.stopped
      ? t("{tool} was still running on {name} after 2 minutes, so gachamod stopped it. It changed no files", { tool, name: r.name })
      : t("{note}. {needs}", { note: t("{tool} changed no files in {name}", { tool, name: r.name }), needs: NEEDS }));
  }
}
